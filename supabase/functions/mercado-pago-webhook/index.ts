import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function validSignature(request: Request, dataId: string, secret: string) {
  const signature = request.headers.get("x-signature") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const parts = Object.fromEntries(signature.split(",").map((part) => part.trim().split("=")));
  if (!parts.ts || !parts.v1 || !requestId) return false;
  const normalizedId = /[a-z]/i.test(dataId) ? dataId.toLowerCase() : dataId;
  const template = `id:${normalizedId};request-id:${requestId};ts:${parts.ts};`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(template));
  return hex(digest) === parts.v1;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const url = new URL(request.url);
  const body = await request.json().catch(() => ({}));
  const dataId = String(url.searchParams.get("data.id") ?? url.searchParams.get("data_id") ?? body?.data?.id ?? "");
  const secret = Deno.env.get("MERCADO_PAGO_WEBHOOK_SECRET") ?? "";
  if (!dataId || !secret || !(await validSignature(request, dataId, secret))) return new Response("Invalid signature", { status: 401 });

  const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
  if (!accessToken) return new Response("Provider not configured", { status: 503 });
  const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(dataId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!paymentResponse.ok) return new Response("Payment lookup failed", { status: 502 });
  const payment = await paymentResponse.json();
  const match = String(payment.external_reference ?? "").match(/^booking:(\d+)$/);
  if (!match) return new Response("ok", { status: 200 });

  const bookingId = Number(match[1]);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const statusMap: Record<string, string> = {
    approved: "paid", pending: "pending", in_process: "pending",
    rejected: "failed", cancelled: "failed", refunded: "refunded", charged_back: "refunded",
  };
  const paymentStatus = statusMap[payment.status] ?? "pending";
  await supabase.from("payments").update({
    status: paymentStatus,
    provider_status: payment.status,
    paid_at: payment.status === "approved" ? (payment.date_approved ?? new Date().toISOString()) : null,
    updated_at: new Date().toISOString(),
  }).eq("booking_id", bookingId).eq("external_id", dataId);

  if (payment.status === "approved") {
    await supabase.from("bookings").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", bookingId);
  } else if (["rejected", "cancelled"].includes(payment.status)) {
    const { data: booking } = await supabase.from("bookings").select("slot_id").eq("id", bookingId).single();
    await supabase.from("bookings").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", bookingId).eq("status", "awaiting_payment");
    if (booking?.slot_id) await supabase.from("slots").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", booking.slot_id);
  }

  return new Response("ok", { status: 200 });
});
