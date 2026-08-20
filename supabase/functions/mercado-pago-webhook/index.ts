import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import {
  type BookingEmailDetails,
  firstRelation,
  sendCustomerPaymentConfirmedEmail,
  sendProfessionalPaymentConfirmedEmail,
} from "../_shared/booking-emails.ts";

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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(digest);
}

async function sendMetaPurchase(
  supabase: ReturnType<typeof createClient>,
  bookingId: number,
  approvedAt: string | undefined,
) {
  const pixelId = Deno.env.get("META_PIXEL_ID") ?? "1633028891341714";
  const accessToken = Deno.env.get("META_CONVERSIONS_API_TOKEN");
  if (!accessToken) {
    console.warn("Meta Conversions API not configured");
    return;
  }

  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id,booking_source,deposit_cents,leads(name,email,phone,source),services(id,name,slug)")
    .eq("id", bookingId)
    .single();
  if (error || !booking) throw error ?? new Error("Booking not found for Meta event");

  const lead = firstRelation(booking.leads);
  const service = firstRelation(booking.services);
  const email = String(lead?.email ?? "").trim().toLowerCase();
  const localPhone = String(lead?.phone ?? "").replace(/\D/g, "");
  const phone = localPhone && !localPhone.startsWith("55") ? `55${localPhone}` : localPhone;
  const source = lead?.source && typeof lead.source === "object" ? lead.source as Record<string, unknown> : {};
  const userData: Record<string, string | string[]> = {};
  if (email) userData.em = [await sha256(email)];
  if (phone) userData.ph = [await sha256(phone)];
  if (typeof source.fbp === "string" && source.fbp) userData.fbp = source.fbp;
  if (typeof source.fbc === "string" && source.fbc) userData.fbc = source.fbc;
  if (!userData.em && !userData.ph) throw new Error("Meta event has no matching user data");

  const graphVersion = Deno.env.get("META_GRAPH_API_VERSION") ?? "v23.0";
  const event = {
    event_name: "Purchase",
    event_time: Math.floor(new Date(approvedAt ?? Date.now()).getTime() / 1000),
    event_id: `booking-${booking.id}-purchase`,
    event_source_url: booking.booking_source === "direct"
      ? "https://agenda.psestetica.com.br"
      : "https://quiz.psestetica.com.br",
    action_source: "website",
    user_data: userData,
    custom_data: {
      currency: "BRL",
      value: Number(booking.deposit_cents) / 100,
      content_name: service?.name ?? "Agendamento PS Estética",
      content_ids: [String(service?.slug ?? service?.id ?? booking.id)],
      content_type: "product",
      order_id: String(booking.id),
    },
  };
  const testEventCode = Deno.env.get("META_TEST_EVENT_CODE");
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [event],
        ...(testEventCode ? { test_event_code: testEventCode } : {}),
      }),
    },
  );
  if (!response.ok) {
    console.error("Meta Conversions API failed", response.status, await response.text());
  }
}

async function sendPaymentConfirmationEmails(
  supabase: ReturnType<typeof createClient>,
  bookingId: number,
) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id,deposit_cents,leads(name,email,phone),services(name),slots(starts_at),professional:staff_profiles!bookings_professional_id_fkey(full_name,email)")
    .eq("id", bookingId)
    .single();
  if (error || !booking) throw error ?? new Error("Booking not found for confirmation emails");

  const lead = firstRelation(booking.leads);
  const service = firstRelation(booking.services);
  const slot = firstRelation(booking.slots);
  const professional = firstRelation(booking.professional);
  if (!lead?.email || !slot?.starts_at) throw new Error("Booking has no customer email or scheduled time");

  const details: BookingEmailDetails = {
    bookingId: booking.id,
    customerName: lead.name?.trim() || "Cliente",
    customerEmail: lead.email,
    customerPhone: lead.phone,
    serviceName: service?.name || "Avaliação na PS Estética",
    startsAt: slot.starts_at,
    professionalName: professional?.full_name,
    professionalEmail: professional?.email,
    depositCents: booking.deposit_cents,
  };
  await Promise.all([
    sendCustomerPaymentConfirmedEmail(details),
    sendProfessionalPaymentConfirmedEmail(details),
  ]);
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
    try {
      await sendPaymentConfirmationEmails(supabase, bookingId);
    } catch (error) {
      console.error("Payment confirmation emails failed", error);
    }
    try {
      await sendMetaPurchase(supabase, bookingId, payment.date_approved);
    } catch (error) {
      console.error("Meta Purchase event failed", error);
    }
  } else if (["rejected", "cancelled"].includes(payment.status)) {
    const { data: booking } = await supabase.from("bookings").select("slot_id").eq("id", bookingId).single();
    await supabase.from("bookings").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", bookingId).eq("status", "awaiting_payment");
    if (booking?.slot_id) await supabase.from("slots").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", booking.slot_id);
  }

  return new Response("ok", { status: 200 });
});
