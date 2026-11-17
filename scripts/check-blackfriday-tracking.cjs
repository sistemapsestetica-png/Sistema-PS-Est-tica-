const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const root = process.argv[2] || require('path').resolve(__dirname, '..');
const ts = require(root + '/node_modules/typescript');
const memory = new Map(), pixels = [], requests = [];
const browser = { exports: {}, console, Date, URLSearchParams, crypto: require('crypto').webcrypto,
  location: { search: '?utm_source=meta&utm_medium=paid&utm_campaign=black&utm_content=video1&utm_term=teste&utm_id=10&campaign_id=11&adset_id=12&ad_id=13&placement=feed&fbclid=click123' },
  localStorage: { getItem: k=>memory.get(k)||null, setItem:(k,v)=>memory.set(k,v) },
  document:{cookie:'_fbp=fb.1.123.456'}, window:{fbq:(...args)=>pixels.push(args),setTimeout},
  fetch: async (...args)=>{ requests.push(args); return {ok:true}; }
};
function execute(path, context) { vm.runInNewContext('(function(){'+ts.transpileModule(fs.readFileSync(root+path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText+'})()',context); }
execute('/app/blackfriday/tracking.ts',browser);
let client=browser.exports;
assert.equal(Object.keys(client.captureAttribution().values).length,11);
browser.location.search='';
assert.equal(client.captureAttribution().values.ad_id,'13');
assert.match(client.groupTrackingHref(),/utm_source=meta/);
client.trackBlackFriday('ViewContent','page');
assert.equal(pixels[0][0],'track');
assert.equal(pixels[0][1],'ViewContent');
const sent=JSON.parse(requests[0][1].body);
assert.equal(sent.event_id,pixels[0][3].eventID);
assert.equal(sent.attribution.placement,'feed');
assert.match(sent.fbc,/^fb\.1\.\d+\.click123$/);
assert.equal(requests[0][1].keepalive,true);
client.trackBlackFriday('Contact','hero');
client.trackBlackFriday('Contact','video');
assert.equal(pixels.filter(row=>row[1]==='Contact').length,0,'Group clicks must not emit a conversion');
assert.equal(requests.length,1);
browser.location.search='?utm_source=google&utm_campaign=new';
assert.equal(client.captureAttribution().values.ad_id,undefined);
assert.equal(client.captureAttribution().values.utm_source,'google');
const old=JSON.parse(memory.values().next().value);old.capturedAt=Date.now()-31*86400000;
memory.set('ps-blackfriday-attribution-v1',JSON.stringify(old));
browser.location.search='';
browser.exports={};execute('/app/blackfriday/tracking.ts',browser);client=browser.exports;
assert.equal(Object.keys(client.captureAttribution().values).length,0);
browser.localStorage.getItem=()=>{throw Error('blocked')};
browser.localStorage.setItem=()=>{throw Error('blocked')};
browser.location.search='?utm_source=private';
assert.equal(client.captureAttribution().values.utm_source,'private');
browser.location.search='';
assert.equal(client.captureAttribution().values.utm_source,'private');
const provider=[];
const server={exports:{},console,URLSearchParams,AbortSignal,Date,process:{env:{NODE_ENV:'production'}},
 require:name=>name==='next/server'?{NextResponse:{json:(data,init)=>({data,status:init?.status||200})}}:{attributionKeys:client.attributionKeys},
 fetch:async(url,opts)=>{provider.push(JSON.parse(opts.body));return{ok:true,json:async()=>({events_received:1})}}
};
execute('/app/api/blackfriday/events/route.ts',server);
function request(body,origin='https://quiz.psestetica.com.br') { return {headers:new Headers({origin,'user-agent':'test','x-forwarded-for':'127.0.0.1'}),nextUrl:{origin},text:async()=>JSON.stringify(body)}; }
(async()=>{
 assert.equal((await server.exports.POST(request(sent,'https://other.example'))).status,403);
 assert.equal((await server.exports.POST(request({...sent,event_name:'Lead'}))).status,400);
 assert.equal((await server.exports.POST(request(sent))).status,503);
 server.process.env.META_CONVERSIONS_API_TOKEN='mock-token';
 assert.equal((await server.exports.POST(request(sent))).status,200);
 assert.equal(provider[0].data[0].event_id,pixels[0][3].eventID);
 assert.equal(provider[0].data[0].event_name,'ViewContent');
 assert.equal(provider[0].data[0].custom_data.ad_id,'13');
 assert.equal((await server.exports.POST(request({...sent,event_name:'Contact'}))).status,202);
 const providerCount=provider.length;
 assert.equal((await server.exports.POST(request({...sent,fbp:'',fbc:''}))).status,202);
 assert.equal(provider.length,providerCount,'No matching data must not reach Meta');
 const cookieFallback=request({...sent,fbp:'',fbc:''});cookieFallback.cookies={get:key=>key==='_fbp'?{value:'fb.1.1794850000000.1234567890'}:undefined};
 assert.equal((await server.exports.POST(cookieFallback)).status,200);
 delete server.process.env.META_CONVERSIONS_API_TOKEN;
 server.process.env.NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co';
 server.process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='mock-publishable';
 let relay;
 server.fetch=async(url,options)=>{relay={url,options};return{ok:true,json:async()=>({ok:true})}};
 assert.equal((await server.exports.POST(request(sent))).status,200);
 assert.equal(relay.url,'https://example.supabase.co/functions/v1/meta-blackfriday');
 assert.equal(JSON.parse(relay.options.body).data[0].event_id,sent.event_id);
 const edge={exports:{},console,URLSearchParams,AbortSignal,Date,Response,
 Deno:{env:{get:key=>key==='META_CONVERSIONS_API_TOKEN'?'mock-token':undefined},serve:handler=>{edge.handler=handler}},
 fetch:async(url,options)=>{edge.payload=JSON.parse(options.body);return{ok:true,json:async()=>({events_received:1})}}
 };
 execute('/supabase/functions/meta-blackfriday/index.ts',edge);
 const edgeRequest=payload=>new Request('https://example.supabase.co/functions/v1/meta-blackfriday',{method:'POST',headers:{origin:'https://quiz.psestetica.com.br'},body:JSON.stringify(payload)});
 assert.equal((await edge.handler(edgeRequest(JSON.parse(relay.options.body)))).status,200);
 assert.equal(edge.payload.data[0].event_id,sent.event_id);
 const noMatch=JSON.parse(relay.options.body);noMatch.data[0].user_data={client_ip_address:'127.0.0.1',client_user_agent:'test'};
 assert.equal((await edge.handler(edgeRequest(noMatch))).status,202);
 assert.equal((await edge.handler(edgeRequest({data:[{event_name:'Lead'}]}))).status,400);
 const clickEvent=JSON.parse(relay.options.body);clickEvent.data[0].event_name='Contact';
 assert.equal((await edge.handler(edgeRequest(clickEvent))).status,202);
 server.fetch=async()=>({ok:false,json:async()=>({error:'test'})});
 assert.equal((await server.exports.POST(request(sent))).status,502);
 const lateRequests=[],latePixels=[];
 const late={...browser,exports:{},location:{search:''},document:{cookie:''},localStorage:{getItem:()=>null,setItem:()=>{}},window:{fbq:(...args)=>latePixels.push(args),setTimeout},fetch:async(url,options)=>{lateRequests.push(JSON.parse(options.body));return{ok:true}}};
 execute('/app/blackfriday/tracking.ts',late);late.exports.trackBlackFriday('ViewContent','page');
 assert.equal(lateRequests.length,0);
 late.document.cookie='_fbp=fb.1.1794850000000.1234567890';
 await new Promise(resolve=>setTimeout(resolve,180));
 assert.equal(lateRequests.length,1);assert.equal(lateRequests[0].fbp,'fb.1.1794850000000.1234567890');
 assert.equal(lateRequests[0].event_id,latePixels[0][3].eventID);
 const blocked={...late,exports:{},document:{cookie:''},fetch:async()=>{throw Error('Unmatchable event must not be sent')}};
 execute('/app/blackfriday/tracking.ts',blocked);blocked.exports.trackBlackFriday('ViewContent','page');
 await new Promise(resolve=>setTimeout(resolve,1650));
 console.log('PASS: campaign capture/persistence/replacement/expiry, blocked storage, click payload, IDs, server allowlist, missing token, mocked CAPI delivery and rejection. No Meta requests sent.');
})().catch(e=>{console.error(e);process.exitCode=1});
