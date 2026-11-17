import {createClient} from "npm:@supabase/supabase-js@2";

const json=(data:Record<string,unknown>,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const hex64=/^[a-f0-9]{64}$/;
const groupPattern=/^[0-9-]+@g\.us$/;
const eventPattern=/^bf-group-[a-f0-9]{64}$/;
const encoder=new TextEncoder();

async function hmac(secret:string,value:string){
  const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(value)))).map(byte=>byte.toString(16).padStart(2,"0")).join("");
}
function safeEqual(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}

Deno.serve(async request=>{
  if(request.method!=="POST")return json({ok:false,code:"METHOD_NOT_ALLOWED"},405);
  if(Number(request.headers.get("content-length"))>12000)return json({ok:false,code:"PAYLOAD_TOO_LARGE"},413);
  const raw=await request.text();
  if(raw.length>12000)return json({ok:false,code:"PAYLOAD_TOO_LARGE"},413);
  const secret=Deno.env.get("WHATSAPP_GROUP_MONITOR_SECRET")||"";
  const timestamp=request.headers.get("x-monitor-timestamp")||"";
  const signature=request.headers.get("x-monitor-signature")||"";
  const seconds=Number(timestamp);
  if(!secret||!Number.isInteger(seconds)||Math.abs(Date.now()/1000-seconds)>300||!hex64.test(signature)||!safeEqual(signature,await hmac(secret,`${timestamp}.${raw}`)))return json({ok:false,code:"UNAUTHORIZED"},401);
  let body:Record<string,unknown>;
  try{body=JSON.parse(raw)}catch{return json({ok:false,code:"INVALID_JSON"},400)}
  const supabaseUrl=Deno.env.get("SUPABASE_URL")||"";
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
  const db=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  // Best-effort retention: campaign visits expire after 30 days and the phone
  // hash used for Meta matching is removed after 90 days. Idempotency keys stay.
  await db.from("bf_tracking_visits").delete().lt("expires_at",new Date().toISOString());
  await db.from("bf_group_entries").update({phone_sha256:null}).lt("created_at",new Date(Date.now()-90*86400000).toISOString()).not("phone_sha256","is",null);

  if(body.operation==="visit"){
    const visitId=String(body.visit_id||"");
    if(!/^[0-9a-f-]{36}$/i.test(visitId))return json({ok:false,code:"INVALID_VISIT"},400);
    const allowed=["utm_source","utm_medium","utm_campaign","utm_content","utm_term","utm_id","campaign_id","adset_id","ad_id","placement","fbclid"];
    const attribution:Record<string,string>={};
    for(const key of allowed)if(typeof (body.attribution as Record<string,unknown>)?.[key]==="string")attribution[key]=String((body.attribution as Record<string,unknown>)[key]).slice(0,512);
    const metaPattern=/^fb\.\d+\.\d{13}\.[\w.-]{1,512}$/;
    const fbp=typeof body.fbp==="string"&&metaPattern.test(body.fbp)?body.fbp:null;
    const fbc=typeof body.fbc==="string"&&metaPattern.test(body.fbc)?body.fbc:null;
    const now=new Date().toISOString();
    const {error}=await db.from("bf_tracking_visits").upsert({visit_id:visitId,last_seen_at:now,attribution,fbp,fbc,expires_at:new Date(Date.now()+30*86400000).toISOString()},{onConflict:"visit_id",ignoreDuplicates:false});
    return error?json({ok:false,code:"DATABASE_ERROR"},503):json({ok:true,sent:true});
  }

  if(body.operation==="register-group"){
    const groupId=String(body.group_id||"");const subject=String(body.subject||"").trim().slice(0,200);const inviteHash=String(body.invite_hash||"");
    if(!groupPattern.test(groupId)||!subject||!hex64.test(inviteHash)||inviteHash!==Deno.env.get("BLACKFRIDAY_GROUP_INVITE_HASH"))return json({ok:false,code:"INVALID_GROUP"},400);
    const {data:existing,error:readError}=await db.from("bf_tracking_groups").select("group_id,invite_hash").maybeSingle();
    if(readError)return json({ok:false,code:"DATABASE_ERROR"},503);
    if(existing&&(existing.group_id!==groupId||existing.invite_hash!==inviteHash))return json({ok:false,code:"GROUP_ALREADY_REGISTERED"},409);
    if(!existing){const {error}=await db.from("bf_tracking_groups").insert({group_id:groupId,subject,invite_hash:inviteHash});if(error)return json({ok:false,code:"DATABASE_ERROR"},503)}
    return json({ok:true,sent:true});
  }

  if(body.operation!=="confirm-join")return json({ok:false,code:"INVALID_OPERATION"},400);
  const groupId=String(body.group_id||"");const participantKey=String(body.participant_key||"");const eventId=String(body.event_id||"");const phoneHash=String(body.phone_sha256||"");
  const observedAt=new Date(String(body.observed_at||""));const confirmedAt=new Date(String(body.confirmed_at||""));
  if(!groupPattern.test(groupId)||!hex64.test(participantKey)||!eventPattern.test(eventId)||!hex64.test(phoneHash)||body.proof_method!=="baileys_add+metadata"||body.attribution_state!=="unattributed"||!Number.isFinite(observedAt.getTime())||!Number.isFinite(confirmedAt.getTime())||confirmedAt.getTime()<observedAt.getTime()||Date.now()-observedAt.getTime()>86400000||confirmedAt.getTime()>Date.now()+60000)return json({ok:false,code:"INVALID_JOIN"},400);
  const {data:group}=await db.from("bf_tracking_groups").select("group_id").eq("group_id",groupId).maybeSingle();
  if(!group)return json({ok:false,code:"UNKNOWN_GROUP"},400);
  const entry={event_id:eventId,group_id:groupId,participant_key:participantKey,phone_sha256:phoneHash,observed_at:observedAt.toISOString(),confirmed_at:confirmedAt.toISOString(),confirmation_state:"confirmed",proof_method:"baileys_add+metadata",attribution_state:"unattributed",visit_id:null,delivery_state:"queued"};
  const {error:insertError}=await db.from("bf_group_entries").insert(entry);
  if(insertError&&!insertError.message.includes("duplicate key"))return json({ok:false,code:"DATABASE_ERROR"},503);
  const {data:current}=await db.from("bf_group_entries").select("delivery_state,attempts").eq("event_id",eventId).maybeSingle();
  if(current?.delivery_state==="sent")return json({ok:true,sent:true,duplicate:true});
  await db.from("bf_group_entries").update({delivery_state:"sending",attempts:(current?.attempts||0)+1,last_attempt_at:new Date().toISOString(),last_error:null}).eq("event_id",eventId);
  const token=Deno.env.get("META_CONVERSIONS_API_TOKEN");
  if(!token){await db.from("bf_group_entries").update({delivery_state:"failed",last_error:"META_NOT_CONFIGURED"}).eq("event_id",eventId);return json({ok:false,code:"META_NOT_CONFIGURED"},503)}
  try{
    const meta=await fetch(`https://graph.facebook.com/${Deno.env.get("META_GRAPH_API_VERSION")||"v23.0"}/${Deno.env.get("META_PIXEL_ID")||"1633028891341714"}/events`,{method:"POST",signal:AbortSignal.timeout(8000),headers:{"content-type":"application/json",Authorization:`Bearer ${token}`},body:JSON.stringify({data:[{event_name:"Lead",event_id:eventId,event_time:Math.floor(confirmedAt.getTime()/1000),action_source:"chat",user_data:{ph:[phoneHash]},custom_data:{content_name:"black-friday-2026",conversion_source:"confirmed_whatsapp_group_join",attribution_state:"unattributed"}}]})});
    const result=await meta.json();
    if(!meta.ok||result.events_received!==1){const code=`META_${result.error?.code||meta.status}`;await db.from("bf_group_entries").update({delivery_state:"failed",last_error:code}).eq("event_id",eventId);return json({ok:false,code},502)}
    await db.from("bf_group_entries").update({delivery_state:"sent",sent_at:new Date().toISOString(),last_error:null}).eq("event_id",eventId);
    return json({ok:true,sent:true});
  }catch{await db.from("bf_group_entries").update({delivery_state:"failed",last_error:"META_NETWORK_ERROR"}).eq("event_id",eventId);return json({ok:false,code:"META_NETWORK_ERROR"},502)}
});
