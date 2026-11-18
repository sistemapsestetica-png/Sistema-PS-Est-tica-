// Conversions API do Laser Day: ViewContent (início do quiz) com o mesmo eventID do Pixel do navegador.
// No início do quiz a pessoa ainda não digitou nada, então user_data leva só fbp/fbc + IP + navegador.
// O Lead continua na função meta-lead (com e-mail e telefone em hash).
const allowedOrigins = new Set([
  "https://quiz.psestetica.com.br",
  "https://painel.psestetica.com.br",
  "http://localhost:3000",
]);
const metaIdPattern = /^fb\.\d+\.\d{13}\.[A-Za-z0-9_.-]{1,512}$/;
const eventIdPattern = /^laserday-viewcontent-[0-9a-f-]{36}$/i;
const utmKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];

function corsHeaders(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin) ? origin : "https://quiz.psestetica.com.br",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body: Record<string, unknown>, status = 200, origin: string | null = null) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), "Content-Type": "application/json" } });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (!origin || !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  if (Number(request.headers.get("content-length")) > 4096) return json({ error: "Payload too large" }, 413, origin);

  try {
    const raw = await request.text();
    if (raw.length > 4096) return json({ error: "Payload too large" }, 413, origin);
    const body = JSON.parse(raw);
    if (body?.event_name !== "ViewContent" || !eventIdPattern.test(String(body?.event_id ?? ""))) {
      return json({ error: "Invalid event" }, 400, origin);
    }

    const userData: Record<string, string> = {};
    for (const key of ["fbp", "fbc"]) {
      const value = body[key];
      if (typeof value === "string" && metaIdPattern.test(value)) userData[key] = value;
    }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (ip && /^[0-9a-f:.]{3,45}$/i.test(ip)) userData.client_ip_address = ip;
    const agent = request.headers.get("user-agent")?.slice(0, 1024);
    if (agent?.trim()) userData.client_user_agent = agent;
    // Sem fbp/fbc a Meta não consegue ligar o evento a ninguém: não envia (o Pixel do navegador já registrou).
    if ((!userData.fbp && !userData.fbc) || !userData.client_user_agent) {
      return json({ ok: true, skipped: "missing_matching_data" }, 202, origin);
    }

    const token = Deno.env.get("META_CONVERSIONS_API_TOKEN");
    const pixelId = Deno.env.get("META_PIXEL_ID");
    if (!token || !pixelId) {
      console.error("Meta laserday event is not configured");
      return json({ error: "Tracking unavailable" }, 503, origin);
    }

    const attribution = new URLSearchParams();
    for (const key of utmKeys) {
      const value = body?.attribution?.[key];
      if (typeof value === "string" && value.trim()) attribution.set(key, value.trim().slice(0, 150));
    }
    const eventSourceUrl = `${origin}/laserday${attribution.size ? `?${attribution}` : ""}`;

    const response = await fetch(`https://graph.facebook.com/${Deno.env.get("META_GRAPH_API_VERSION") ?? "v23.0"}/${pixelId}/events`, {
      method: "POST",
      signal: AbortSignal.timeout(5000),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        data: [{
          event_name: "ViewContent",
          event_id: body.event_id,
          event_time: Math.floor(Date.now() / 1000),
          event_source_url: eventSourceUrl,
          action_source: "website",
          user_data: userData,
          custom_data: { content_name: "laserday", content_category: "laser", content_ids: ["laser"], content_type: "product" },
        }],
        ...(Deno.env.get("META_TEST_EVENT_CODE") ? { test_event_code: Deno.env.get("META_TEST_EVENT_CODE") } : {}),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.events_received !== 1) {
      console.error("Meta laserday ViewContent rejected", response.status, result?.error?.code, result?.error?.error_subcode);
      return json({ error: "Provider rejected event" }, 502, origin);
    }
    return json({ ok: true, event_id: body.event_id }, 200, origin);
  } catch (error) {
    console.error("Meta laserday ViewContent failed", error instanceof Error ? error.message : "unknown");
    return json({ error: "Tracking unavailable" }, 500, origin);
  }
});
