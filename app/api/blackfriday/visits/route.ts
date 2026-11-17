import { createHmac } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { attributionKeys } from "../../../blackfriday/tracking";

const canonicalOrigin = "https://quiz.psestetica.com.br";
const metaPattern = /^fb\.\d+\.\d{13}\.[\w.-]{1,512}$/;

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin !== canonicalOrigin && !(process.env.NODE_ENV !== "production" && origin === request.nextUrl.origin)) return NextResponse.json({ error: "Origin not allowed" }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 8192) return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  try {
    const body = await request.json();
    if (!/^[0-9a-f-]{36}$/i.test(body.visit_id || "")) return NextResponse.json({ error: "Invalid visit" }, { status: 400 });
    const attribution: Record<string, string> = {};
    for (const key of attributionKeys) if (typeof body.attribution?.[key] === "string") attribution[key] = body.attribution[key].slice(0, 512);
    const payload: Record<string, unknown> = { operation: "visit", visit_id: body.visit_id, attribution };
    for (const key of ["fbp", "fbc"] as const) {
      const value = body[key] || request.cookies.get(`_${key}`)?.value;
      if (typeof value === "string" && metaPattern.test(value)) payload[key] = value;
    }
    const secret = process.env.WHATSAPP_GROUP_MONITOR_SECRET;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!secret || !supabaseUrl) return NextResponse.json({ ok: true, skipped: "visit_storage_unavailable" }, { status: 202 });
    const raw = JSON.stringify(payload);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
    const response = await fetch(`${supabaseUrl}/functions/v1/blackfriday-group-tracking`, { method: "POST", signal: AbortSignal.timeout(5000), headers: { "content-type": "application/json", "x-monitor-timestamp": timestamp, "x-monitor-signature": signature }, body: raw });
    return NextResponse.json({ ok: response.ok }, { status: response.ok ? 200 : 202 });
  } catch { return NextResponse.json({ ok: true, skipped: "visit_storage_unavailable" }, { status: 202 }); }
}
