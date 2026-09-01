import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import {
  type BookingEmailDetails,
  type ServicePaymentEmailDetails,
  firstRelation,
  sendCustomerPaymentConfirmedEmail,
  sendCustomerServicePaymentEmail,
  sendProfessionalPaymentConfirmedEmail,
  sendProfessionalServicePaymentEmail,
} from "./booking-emails.ts";

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function sha256(value: string) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

export async function sendMetaPurchase(supabase: ReturnType<typeof createClient>, bookingId: number, approvedAt?: string) {
  const accessToken = Deno.env.get("META_CONVERSIONS_API_TOKEN");
  if (!accessToken) return console.warn("Meta Conversions API not configured");
  const { data: booking, error } = await supabase.from("bookings").select("id,booking_source,deposit_cents,leads(name,email,phone,source),services(id,name,slug)").eq("id", bookingId).single();
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
  const pixelId = Deno.env.get("META_PIXEL_ID") ?? "1633028891341714";
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${pixelId}/events?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: [{
        event_name: "Purchase",
        event_time: Math.floor(new Date(approvedAt ?? Date.now()).getTime() / 1000),
        event_id: `booking-${booking.id}-purchase`,
        event_source_url: booking.booking_source === "direct" ? "https://agenda.psestetica.com.br" : "https://quiz.psestetica.com.br",
        action_source: "website",
        user_data: userData,
        custom_data: { currency: "BRL", value: Number(booking.deposit_cents) / 100, content_name: service?.name ?? "Agendamento PS Estética", content_ids: [String(service?.slug ?? service?.id ?? booking.id)], content_type: "product", order_id: String(booking.id) },
      }],
      ...(Deno.env.get("META_TEST_EVENT_CODE") ? { test_event_code: Deno.env.get("META_TEST_EVENT_CODE") } : {}),
    }),
  });
  if (!response.ok) console.error("Meta Conversions API failed", response.status, await response.text());
}

export async function sendPaymentConfirmationEmails(supabase: ReturnType<typeof createClient>, bookingId: number) {
  const { data: booking, error } = await supabase.from("bookings").select("id,deposit_cents,leads(name,email,phone),services(name),slots(starts_at),professional:staff_profiles!bookings_professional_id_fkey(full_name,email)").eq("id", bookingId).single();
  if (error || !booking) throw error ?? new Error("Booking not found for confirmation emails");
  const lead = firstRelation(booking.leads); const service = firstRelation(booking.services); const slot = firstRelation(booking.slots); const professional = firstRelation(booking.professional);
  if (!lead?.email || !slot?.starts_at) throw new Error("Booking has no customer email or scheduled time");
  const details: BookingEmailDetails = { bookingId: booking.id, customerName: lead.name?.trim() || "Cliente", customerEmail: lead.email, customerPhone: lead.phone, serviceName: service?.name || "Avaliação na PS Estética", startsAt: slot.starts_at, professionalName: professional?.full_name, professionalEmail: professional?.email, depositCents: booking.deposit_cents };
  await Promise.all([sendCustomerPaymentConfirmedEmail(details), sendProfessionalPaymentConfirmedEmail(details)]);
}

export async function sendServicePaymentConfirmationEmails(supabase: ReturnType<typeof createClient>, bookingId: number, paymentId: string, paymentCents: number) {
  const { data: booking, error } = await supabase.from("bookings").select("id,price_cents,deposit_cents,leads(name,email,phone),services(name),slots(starts_at),professional:staff_profiles!bookings_professional_id_fkey(full_name,email),payments(status,amount_cents),service_payments(status,amount_cents)").eq("id", bookingId).single();
  if (error || !booking) throw error ?? new Error("Booking not found for service payment emails");
  const lead = firstRelation(booking.leads); const service = firstRelation(booking.services); const slot = firstRelation(booking.slots); const professional = firstRelation(booking.professional);
  if (!lead?.email || !slot?.starts_at) throw new Error("Booking has no customer email or scheduled time");
  const totalPaidCents = [...(booking.payments ?? []).filter((item) => item.status === "paid"), ...(booking.service_payments ?? []).filter((item) => item.status === "paid")].reduce((sum, item) => sum + Number(item.amount_cents ?? 0), 0);
  const details: ServicePaymentEmailDetails = { bookingId: booking.id, customerName: lead.name?.trim() || "Cliente", customerEmail: lead.email, customerPhone: lead.phone, serviceName: service?.name || "Avaliação na PS Estética", startsAt: slot.starts_at, professionalName: professional?.full_name, professionalEmail: professional?.email, depositCents: booking.deposit_cents, paymentCents, totalPaidCents, servicePriceCents: Number(booking.price_cents) };
  await Promise.all([sendCustomerServicePaymentEmail(details, paymentId), sendProfessionalServicePaymentEmail(details, paymentId)]);
}
