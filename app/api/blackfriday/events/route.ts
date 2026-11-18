import { NextRequest, NextResponse } from "next/server";
import { attributionKeys } from "../../../blackfriday/tracking";

const eventNames = new Set(["ViewContent", "Contact", "blackfriday_video_play"]);
const places = new Set(["page", "hero", "video", "convite"]);
const canonicalOrigin = "https://quiz.psestetica.com.br";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const permittedOrigin = origin === canonicalOrigin || (process.env.NODE_ENV !== "production" && origin === request.nextUrl.origin);
  if (!permittedOrigin) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  // Fora da produção (localhost em desenvolvimento) não repassa à Meta: evita evento real com URL de teste.
  if (origin !== canonicalOrigin) return NextResponse.json({ ok: true, skipped: "non_production" }, { status: 202 });
  if (Number(request.headers.get("content-length")) > 8192) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  try {
    const raw = await request.text();
    if (raw.length > 8192) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    const body = JSON.parse(raw);
    if (!eventNames.has(body.event_name) || !places.has(body.place) || !/^bf-[0-9a-f-]{36}$/i.test(body.event_id || "")) return NextResponse.json({ error: "Invalid event" }, { status: 400 });
    if (body.event_name === "Contact") return NextResponse.json({ ok: true, skipped: "group_membership_not_confirmed" }, { status: 202 });
    const token = process.env.META_CONVERSIONS_API_TOKEN;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!token && (!supabaseUrl || !supabaseKey)) return NextResponse.json({ error: "Server tracking not configured" }, { status: 503 });
    const attribution: Record<string, string> = {};
    for (const key of attributionKeys) if (typeof body.attribution?.[key] === "string") attribution[key] = body.attribution[key].slice(0, 512);
    const userData: Record<string, string> = {};
    for (const key of ["fbp", "fbc"]) {
      const value = body[key] || request.cookies?.get(`_${key}`)?.value;
      if (typeof value === "string" && /^fb\.\d+\.\d{13}\.[\w.-]{1,512}$/.test(value)) userData[key] = value;
    }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    if (ip) userData.client_ip_address = ip;
    const agent = request.headers.get("user-agent");
    if (agent) userData.client_user_agent = agent;
    if ((!userData.fbp && !userData.fbc) || !agent?.trim()) {
      console.info("meta_blackfriday_skipped", body.event_name, "missing_matching_data");
      return NextResponse.json({ ok: true, skipped: "missing_matching_data" }, { status: 202 });
    }
    const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim();
    if (token && !pixelId) return NextResponse.json({ error: "Server tracking not configured" }, { status: 503 });
    const endpoint = token ? `https://graph.facebook.com/${process.env.META_GRAPH_API_VERSION || "v23.0"}/${pixelId}/events` : `${supabaseUrl}/functions/v1/meta-blackfriday`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    else { headers.apikey = supabaseKey!; headers.Origin = canonicalOrigin; }
    const response = await fetch(endpoint, {
      method: "POST", signal: AbortSignal.timeout(8000), headers,
      body: JSON.stringify({ data: [{ event_name: body.event_name, event_id: body.event_id, event_time: Math.floor(Date.now() / 1000), action_source: "website", event_source_url: `${canonicalOrigin}/blackfriday${Object.keys(attribution).length ? `?${new URLSearchParams(attribution)}` : ""}`, user_data: userData, custom_data: { content_name: "black-friday-2026", content_category: body.place, ...(body.event_name === "Contact" ? { action: "open_whatsapp_group", membership_confirmed: "no" } : {}), ...attribution } }] }),
    });
    const result = await response.json();
    if (!token && response.ok && result.skipped) return NextResponse.json({ ok: true, skipped: result.skipped }, { status: 202 });
    if (!response.ok || (token ? result.events_received !== 1 : result.ok !== true)) return NextResponse.json({ error: "Provider rejected event" }, { status: 502 });
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Tracking unavailable" }, { status: 502 }); }
}
