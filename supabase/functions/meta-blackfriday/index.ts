const origin = "https://quiz.psestetica.com.br";
const events = new Set(["ViewContent", "Contact", "blackfriday_video_play"]);
const places = new Set(["page", "hero", "video", "convite"]);
const keys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "campaign_id", "adset_id", "ad_id", "placement", "fbclid"];
const json = (data: Record<string, unknown>, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async request => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (request.headers.get("origin") !== origin) return json({ error: "Origin not allowed" }, 403);
  if (Number(request.headers.get("content-length")) > 12000) return json({ error: "Payload too large" }, 413);
  try {
    const raw = await request.text();
    if (raw.length > 12000) return json({ error: "Payload too large" }, 413);
    const body = JSON.parse(raw);
    const event = body?.data?.[0];
    if (body?.data?.length !== 1 || !events.has(event?.event_name) || !places.has(event?.custom_data?.content_category) || !/^bf-[0-9a-f-]{36}$/i.test(event?.event_id || "")) return json({ error: "Invalid event" }, 400);
    if (event.event_name === "Contact") return json({ ok: true, skipped: "group_membership_not_confirmed" }, 202);
    const attribution: Record<string, string> = {};
    for (const key of keys) if (typeof event.custom_data[key] === "string") attribution[key] = event.custom_data[key].slice(0, 512);
    const userData: Record<string, string> = {};
    for (const key of ["fbp", "fbc"]) if (typeof event.user_data?.[key] === "string" && /^fb\.\d+\.\d{13}\.[\w.-]{1,512}$/.test(event.user_data[key])) userData[key] = event.user_data[key];
    const ip = event.user_data?.client_ip_address;
    if (typeof ip === "string" && /^[0-9a-f:.]{3,45}$/i.test(ip)) userData.client_ip_address = ip;
    const agent = event.user_data?.client_user_agent;
    if (typeof agent === "string") userData.client_user_agent = agent.slice(0, 1024);
    if ((!userData.fbp && !userData.fbc) || !userData.client_user_agent?.trim()) {
      console.info("meta_blackfriday_skipped", event.event_name, "missing_matching_data");
      return json({ ok: true, skipped: "missing_matching_data" }, 202);
    }
    const token = Deno.env.get("META_CONVERSIONS_API_TOKEN");
    if (!token) return json({ error: "Tracking unavailable" }, 503);
    const response = await fetch(`https://graph.facebook.com/${Deno.env.get("META_GRAPH_API_VERSION") || "v23.0"}/${Deno.env.get("META_PIXEL_ID") || "1633028891341714"}/events`, {
      method: "POST", signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ data: [{ event_name: event.event_name, event_id: event.event_id, event_time: Math.floor(Date.now() / 1000), action_source: "website", event_source_url: `${origin}/blackfriday${Object.keys(attribution).length ? `?${new URLSearchParams(attribution)}` : ""}`, user_data: userData, custom_data: { content_name: "black-friday-2026", content_category: event.custom_data.content_category, ...(event.event_name === "Contact" ? { action: "open_whatsapp_group", membership_confirmed: "no" } : {}), ...attribution } }] }),
    });
    const result = await response.json();
    if (!response.ok || result.events_received !== 1) {
      console.error("Black Friday Meta delivery rejected", response.status, result.error?.code, result.error?.error_subcode);
      return json({ error: "Provider rejected event" }, 502);
    }
    return json({ ok: true });
  } catch { return json({ error: "Tracking unavailable" }, 502); }
});
