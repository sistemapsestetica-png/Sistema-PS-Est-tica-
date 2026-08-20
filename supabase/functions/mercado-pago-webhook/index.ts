import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import {
  type BookingEmailDetails,
  type ServicePaymentEmailDetails,
  firstRelation,
  sendCustomerPaymentConfirmedEmail,
  sendCustomerServicePaymentEmail,
  sendProfessionalPaymentConfirmedEmail,
  sendProfessionalServicePaymentEmail,
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
  const actual = hex(digest);
  const expected = String(parts.v1).toLowerCase();
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < actual.length; index += 1) difference |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return difference === 0;
}

function paymentAmountCents(payment: Record<string, unknown>) {
  return Math.round(Number(payment.transaction_amount ?? 0) * 100);
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

async function sendServicePaymentConfirmationEmails(
  supabase: ReturnType<typeof createClient>,
  bookingId: number,
  paymentId: string,
  paymentCents: number,
) {
  const { data: booking, error } = await supabase
    .from("bookings")
    .select("id,price_cents,deposit_cents,leads(name,email,phone),services(name),slots(starts_at),professional:staff_profiles!bookings_professional_id_fkey(full_name,email),payments(status,amount_cents),service_payments(status,amount_cents)")
    .eq("id", bookingId)
    .single();
  if (error || !booking) throw error ?? new Error("Booking not found for service payment emails");

  const lead = firstRelation(booking.leads);
  const service = firstRelation(booking.services);
  const slot = firstRelation(booking.slots);
  const professional = firstRelation(booking.professional);
  if (!lead?.email || !slot?.starts_at) throw new Error("Booking has no customer email or scheduled time");
  const totalPaidCents = [
    ...(booking.payments ?? []).filter((item) => item.status === "paid"),
    ...(booking.service_payments ?? []).filter((item) => item.status === "paid"),
  ].reduce((sum, item) => sum + Number(item.amount_cents ?? 0), 0);
  const details: ServicePaymentEmailDetails = {
    bookingId: booking.id,
    customerName: lead.name?.trim() || "Cliente",
    customerEmail: lead.email,
    customerPhone: lead.phone,
    serviceName: service?.name || "Avaliação na PS Estética",
    startsAt: slot.starts_at,
    professionalName: professional?.full_name,
    professionalEmail: professional?.email,
    depositCents: booking.deposit_cents,
    paymentCents,
    totalPaidCents,
    servicePriceCents: Number(booking.price_cents),
  };
  await Promise.all([
    sendCustomerServicePaymentEmail(details, paymentId),
    sendProfessionalServicePaymentEmail(details, paymentId),
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
  const externalReference = String(payment.external_reference ?? "");
  const depositMatch = externalReference.match(/^booking:(\d+)$/);
  const balanceMatch = externalReference.match(/^booking-balance:(\d+):(\d+)$/);
  if (!depositMatch && !balanceMatch) return new Response("ok", { status: 200 });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  if (balanceMatch) {
    const bookingId = Number(balanceMatch[1]);
    const ledgerId = Number(balanceMatch[2]);
    const { data: ledger } = await supabase.from("service_payments").select("id,status,amount_cents").eq("id", ledgerId).eq("booking_id", bookingId).eq("method", "mercado_pago").maybeSingle();
    if (!ledger) return new Response("Payment ledger not found", { status: 404 });
    if (paymentAmountCents(payment) !== Number(ledger.amount_cents)) return new Response("Payment amount mismatch", { status: 409 });
    const balanceStatusMap: Record<string, string> = {
      approved: "paid", pending: "pending", in_process: "pending",
      rejected: "failed", cancelled: "cancelled", refunded: "refunded", charged_back: "refunded",
    };
    let transitioned = false;
    let balanceUpdate = supabase.from("service_payments").update({
      status: balanceStatusMap[payment.status] ?? "pending",
      provider_external_id: String(payment.id),
      paid_at: payment.status === "approved" ? (payment.date_approved ?? new Date().toISOString()) : null,
      updated_at: new Date().toISOString(),
    }).eq("id", ledgerId).eq("booking_id", bookingId).eq("method", "mercado_pago");
    if (payment.status === "approved") balanceUpdate = balanceUpdate.neq("status", "paid");
    const { data: updatedLedger } = await balanceUpdate.select("id").maybeSingle();
    transitioned = payment.status === "approved" && Boolean(updatedLedger);
    if (transitioned) {
      try {
        await sendServicePaymentConfirmationEmails(supabase, bookingId, String(payment.id), paymentAmountCents(payment));
      } catch (error) {
        console.error("Service payment confirmation emails failed", error);
      }
    }
    return new Response("ok", { status: 200 });
  }

  const bookingId = Number(depositMatch![1]);
  const { data: expectedPayment } = await supabase.from("payments").select("id,status,amount_cents").eq("booking_id", bookingId).eq("external_id", dataId).maybeSingle();
  if (!expectedPayment) return new Response("Payment record not found", { status: 404 });
  if (paymentAmountCents(payment) !== Number(expectedPayment.amount_cents)) return new Response("Payment amount mismatch", { status: 409 });
  const statusMap: Record<string, string> = {
    approved: "paid", pending: "pending", in_process: "pending",
    rejected: "failed", cancelled: "failed", refunded: "refunded", charged_back: "refunded",
  };
  const paymentStatus = statusMap[payment.status] ?? "pending";
  let paymentUpdate = supabase.from("payments").update({
    status: paymentStatus,
    provider_status: payment.status,
    paid_at: payment.status === "approved" ? (payment.date_approved ?? new Date().toISOString()) : null,
    updated_at: new Date().toISOString(),
  }).eq("booking_id", bookingId).eq("external_id", dataId);
  if (payment.status === "approved") paymentUpdate = paymentUpdate.neq("status", "paid");
  const { data: updatedPayment } = await paymentUpdate.select("id").maybeSingle();
  const transitioned = payment.status === "approved" && Boolean(updatedPayment);

  if (payment.status === "approved") {
    const { data: confirmedBooking } = await supabase.from("bookings").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", bookingId).select("lead_id").maybeSingle();
    if (confirmedBooking?.lead_id) await supabase.from("leads").update({ status: "scheduled", updated_at: new Date().toISOString() }).eq("id", confirmedBooking.lead_id);
    if (transitioned) {
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
    }
  } else if (["rejected", "cancelled"].includes(payment.status)) {
    const { data: booking } = await supabase.from("bookings").select("slot_id,lead_id").eq("id", bookingId).single();
    await supabase.from("bookings").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", bookingId).eq("status", "awaiting_payment");
    if (booking?.lead_id) await supabase.from("leads").update({ status: "contacted", updated_at: new Date().toISOString() }).eq("id", booking.lead_id).eq("status", "qualified");
    if (booking?.slot_id) await supabase.from("slots").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", booking.slot_id);
  }

  return new Response("ok", { status: 200 });
});
