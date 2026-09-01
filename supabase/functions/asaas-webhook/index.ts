import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { asaasFetch, secureEquals } from "../_shared/asaas.ts";
import { sendMetaPurchase, sendPaymentConfirmationEmails, sendServicePaymentConfirmationEmails } from "../_shared/payment-confirmations.ts";

function amountCents(payment: Record<string, unknown>) { return Math.round(Number(payment.value ?? 0) * 100); }

async function releaseAwaitingBooking(supabase: ReturnType<typeof createClient>, bookingId: number) {
  const { data: booking } = await supabase.from("bookings").select("slot_id,lead_id,status").eq("id", bookingId).maybeSingle();
  if (booking?.status !== "awaiting_payment") return;
  const { data: expired } = await supabase.from("bookings").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", bookingId).eq("status", "awaiting_payment").select("id").maybeSingle();
  if (!expired) return;
  if (booking.lead_id) await supabase.from("leads").update({ status: "contacted", updated_at: new Date().toISOString() }).eq("id", booking.lead_id).eq("status", "qualified");
  if (booking.slot_id) await supabase.from("slots").update({ status: "open", updated_at: new Date().toISOString() }).eq("id", booking.slot_id).eq("status", "held");
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("ASAAS_WEBHOOK_TOKEN") ?? "";
  if (!secret || !secureEquals(request.headers.get("asaas-access-token") ?? "", secret)) return new Response("Invalid token", { status: 401 });
  if (!Deno.env.get("ASAAS_API_KEY")) return new Response("Provider not configured", { status: 503 });
  try {
    const body = await request.json();
    const paymentId = String(body?.payment?.id ?? "");
    if (!paymentId) return new Response("ok", { status: 200 });
    const payment = await asaasFetch(`/payments/${encodeURIComponent(paymentId)}`);
    const externalReference = String(payment.externalReference ?? "");
    const depositMatch = externalReference.match(/^booking:(\d+)$/);
    const balanceMatch = externalReference.match(/^booking-balance:(\d+):(\d+)$/);
    if (!depositMatch && !balanceMatch) return new Response("ok", { status: 200 });
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

    if (balanceMatch) {
      const bookingId = Number(balanceMatch[1]);
      const ledgerId = Number(balanceMatch[2]);
      const { data: ledger } = await supabase.from("service_payments").select("id,status,amount_cents").eq("id", ledgerId).eq("booking_id", bookingId).eq("method", "asaas").eq("provider_external_id", paymentId).maybeSingle();
      if (!ledger) return new Response("Payment ledger not found", { status: 404 });
      if (amountCents(payment) !== Number(ledger.amount_cents)) return new Response("Payment amount mismatch", { status: 409 });
      const settled = payment.status === "RECEIVED" || (payment.status === "CONFIRMED" && payment.billingType === "CREDIT_CARD");
      const statusMap: Record<string, string> = { RECEIVED: "paid", CONFIRMED: settled ? "paid" : "pending", PENDING: "pending", OVERDUE: "failed", DELETED: "cancelled", REFUNDED: "refunded", REFUND_REQUESTED: "refunded", REFUND_IN_PROGRESS: "refunded", PARTIALLY_REFUNDED: "refunded" };
      let update = supabase.from("service_payments").update({ status: statusMap[payment.status] ?? "pending", provider_external_id: paymentId, paid_at: settled ? (payment.paymentDate ?? payment.confirmedDate ?? new Date().toISOString()) : null, updated_at: new Date().toISOString() }).eq("id", ledgerId).eq("booking_id", bookingId).eq("method", "asaas");
      if (settled) update = update.neq("status", "paid");
      const { data: updated } = await update.select("id").maybeSingle();
      if (settled && updated) {
        try { await sendServicePaymentConfirmationEmails(supabase, bookingId, paymentId, amountCents(payment)); } catch (error) { console.error("Service payment confirmation emails failed", error); }
      }
      return new Response("ok", { status: 200 });
    }

    const bookingId = Number(depositMatch![1]);
    const { data: expected } = await supabase.from("payments").select("id,status,amount_cents").eq("booking_id", bookingId).eq("provider", "asaas").eq("external_id", paymentId).maybeSingle();
    if (!expected) return new Response("Payment record not found", { status: 404 });
    if (amountCents(payment) !== Number(expected.amount_cents)) return new Response("Payment amount mismatch", { status: 409 });
    const { data: booking } = await supabase.from("bookings").select("status,payment_expires_at,slot_id,lead_id").eq("id", bookingId).maybeSingle();
    if (!booking) return new Response("Booking not found", { status: 404 });

    if (payment.status === "RECEIVED") {
      if (expected.status === "paid") return new Response("ok", { status: 200 });
      const mayConfirm = booking.status === "confirmed" || (booking.status === "awaiting_payment" && new Date(booking.payment_expires_at) > new Date());
      const paidAt = payment.paymentDate ?? payment.confirmedDate ?? new Date().toISOString();
      if (!mayConfirm) {
        await supabase.from("payments").update({ status: "paid", provider_status: "RECEIVED_AFTER_EXPIRY_REVIEW_REQUIRED", paid_at: paidAt, updated_at: new Date().toISOString() }).eq("id", expected.id).neq("status", "paid");
        return new Response("ok", { status: 200 });
      }
      const { data: transitioned } = await supabase.from("payments").update({ status: "paid", provider_status: payment.status, paid_at: paidAt, updated_at: new Date().toISOString() }).eq("id", expected.id).neq("status", "paid").select("id").maybeSingle();
      await supabase.from("bookings").update({ status: "confirmed", updated_at: new Date().toISOString() }).eq("id", bookingId).eq("status", "awaiting_payment");
      if (booking.lead_id) await supabase.from("leads").update({ status: "scheduled", updated_at: new Date().toISOString() }).eq("id", booking.lead_id);
      if (transitioned) {
        try { await sendPaymentConfirmationEmails(supabase, bookingId); } catch (error) { console.error("Payment confirmation emails failed", error); }
        try { await sendMetaPurchase(supabase, bookingId, paidAt); } catch (error) { console.error("Meta Purchase event failed", error); }
      }
      return new Response("ok", { status: 200 });
    }

    const statusMap: Record<string, string> = { CONFIRMED: "pending", PENDING: "pending", OVERDUE: "expired", DELETED: "failed", REFUNDED: "refunded", REFUND_REQUESTED: "refunded", REFUND_IN_PROGRESS: "refunded", PARTIALLY_REFUNDED: "refunded" };
    await supabase.from("payments").update({ status: statusMap[payment.status] ?? "pending", provider_status: payment.status, updated_at: new Date().toISOString() }).eq("id", expected.id).neq("status", "paid");
    if (["OVERDUE", "DELETED"].includes(payment.status)) await releaseAwaitingBooking(supabase, bookingId);
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error("Asaas webhook error", error instanceof Error ? error.message : error);
    return new Response("Webhook processing failed", { status: 500 });
  }
});
