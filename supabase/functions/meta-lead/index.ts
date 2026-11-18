import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const productionOrigins = new Set(["https://quiz.psestetica.com.br", "https://painel.psestetica.com.br"]);
const allowedOrigins = new Set([
  "https://quiz.psestetica.com.br",
  "https://painel.psestetica.com.br", // /laserday também é servido por este host
  "http://localhost:3000",
]);

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

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

function normalizedPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits && !digits.startsWith("55") ? `55${digits}` : digits;
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405, origin);
  if (origin && !allowedOrigins.has(origin)) return json({ error: "Origin not allowed" }, 403, origin);
  // Fora da produção (localhost etc.) nunca envia evento real: só com META_TEST_EVENT_CODE (vai como teste).
  // Pedido sem cabeçalho Origin segue como antes (aceito); localhost sempre manda Origin e cai aqui.
  if (origin && !productionOrigins.has(origin)) {
    if (!Deno.env.get("META_TEST_EVENT_CODE")) return json({ ok: true, skipped: "non_production" }, 202, origin);
  }

  try {
    const body = await request.json();
    const leadId = Number(body?.lead_id);
    const reservationToken = String(body?.reservation_token ?? "");
    if (!Number.isSafeInteger(leadId) || leadId <= 0 || !/^[0-9a-f-]{36}$/i.test(reservationToken)) {
      return json({ error: "Invalid lead" }, 400, origin);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const accessToken = Deno.env.get("META_CONVERSIONS_API_TOKEN");
    if (!supabaseUrl || !serviceRoleKey || !accessToken) {
      console.error("Meta lead event is not configured");
      return json({ error: "Tracking unavailable" }, 503, origin);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);
    const { data: lead, error } = await supabase
      .from("leads")
      .select("id,name,email,phone,service_slug,source,created_at")
      .eq("id", leadId)
      .eq("reservation_token", reservationToken)
      .single();
    if (error || !lead) return json({ error: "Lead not found" }, 404, origin);

    const email = String(lead.email ?? "").trim().toLowerCase();
    const phone = normalizedPhone(String(lead.phone ?? ""));
    const source = lead.source && typeof lead.source === "object" ? lead.source as Record<string, unknown> : {};
    const userData: Record<string, string | string[]> = {};
    if (email) userData.em = [await sha256(email)];
    if (phone) userData.ph = [await sha256(phone)];
    if (typeof source.fbp === "string" && source.fbp) userData.fbp = source.fbp;
    if (typeof source.fbc === "string" && source.fbc) userData.fbc = source.fbc;
    const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwardedFor) userData.client_ip_address = forwardedFor;
    const userAgent = request.headers.get("user-agent");
    if (userAgent) userData.client_user_agent = userAgent;
    if (!userData.em && !userData.ph) return json({ error: "No matching data" }, 422, origin);

    const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") ?? "v23.0";
    const pixelId = Deno.env.get("META_PIXEL_ID") ?? "1633028891341714";
    const landing: Record<string, { url: string; name: string }> = {
      lavieen: { url: "https://quiz.psestetica.com.br/lavieen", name: "Quiz Lavieen" },
      botox: { url: "https://quiz.psestetica.com.br/botox", name: "Quiz Botox" },
      laser: { url: "https://quiz.psestetica.com.br/laserday", name: "laserday" },
    };
    const eventSourceUrl = landing[lead.service_slug]?.url ?? "https://quiz.psestetica.com.br";
    const response = await fetch(`https://graph.facebook.com/${graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [{
          event_name: "Lead",
          event_time: Math.floor(new Date(lead.created_at).getTime() / 1000),
          event_id: `lead-${lead.id}-lead`,
          event_source_url: eventSourceUrl,
          action_source: "website",
          user_data: userData,
          custom_data: { content_name: landing[lead.service_slug]?.name ?? "Quiz PS Estética", content_category: lead.service_slug },
        }],
        // test_event_code só fora da produção: em produção o evento é sempre real.
        ...((origin && !productionOrigins.has(origin)) && Deno.env.get("META_TEST_EVENT_CODE") ? { test_event_code: Deno.env.get("META_TEST_EVENT_CODE") } : {}),
      }),
    });
    if (!response.ok) {
      console.error("Meta Lead CAPI failed", response.status, await response.text());
      return json({ error: "Tracking unavailable" }, 502, origin);
    }
    return json({ ok: true }, 200, origin);
  } catch (error) {
    console.error("Meta Lead CAPI failed", error);
    return json({ error: "Tracking unavailable" }, 500, origin);
  }
});
