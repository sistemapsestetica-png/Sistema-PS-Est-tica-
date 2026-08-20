import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import {
  type BookingEmailDetails,
  firstRelation,
  sendCustomerPaymentConfirmedEmail,
  sendCustomerPrebookingEmail,
  sendProfessionalPaymentConfirmedEmail,
  sendProfessionalPrebookingEmail,
} from "../_shared/booking-emails.ts";

function corsHeaders(request: Request) {
  const configured = [
    Deno.env.get("SITE_URL"),
    Deno.env.get("AGENDA_URL"),
    ...(Deno.env.get("PUBLIC_ALLOWED_ORIGINS") ?? "").split(","),
  ].map((value) => value?.trim().replace(/\/$/, "")).filter(Boolean) as string[];
  const origin = request.headers.get("origin")?.replace(/\/$/, "") ?? "";
  return {
    "Access-Control-Allow-Origin": configured.includes(origin) ? origin : (configured[0] ?? "*"),
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8" },
});

function emailDetails(booking: Record<string, unknown>): BookingEmailDetails | null {
  const lead = firstRelation(booking.leads as { name?: string; email?: string; phone?: string } | { name?: string; email?: string; phone?: string }[] | null);
  const service = firstRelation(booking.services as { name?: string } | { name?: string }[] | null);
  const slot = firstRelation(booking.slots as { starts_at?: string } | { starts_at?: string }[] | null);
  const professional = firstRelation(booking.professional as { full_name?: string; email?: string } | { full_name?: string; email?: string }[] | null);
  if (!lead?.email || !slot?.starts_at) return null;
  return {
    bookingId: Number(booking.id),
    customerName: lead.name?.trim() || "Cliente",
    customerEmail: lead.email,
    customerPhone: lead.phone,
    serviceName: service?.name || "Avaliação na PS Estética",
    startsAt: slot.starts_at,
    professionalName: professional?.full_name,
    professionalEmail: professional?.email,
    depositCents: Number(booking.deposit_cents),
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const url = new URL(request.url);
    const payload = request.method === "POST" ? await request.json() : {};
    const bookingToken = String(payload.bookingToken ?? url.searchParams.get("token") ?? "");
    if (!bookingToken) return json(request, { error: "Reserva inválida." }, 400);

    await supabase.rpc("release_expired_reservations");
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id,lead_id,status,deposit_cents,payment_expires_at,public_token,leads(name,email,phone),services(name),slots(starts_at,ends_at),professional:staff_profiles!bookings_professional_id_fkey(full_name,email)")
      .eq("public_token", bookingToken)
      .single();

    if (bookingError || !booking) return json(request, { error: "Reserva não encontrada." }, 404);

    const lead = firstRelation(booking.leads);
    const service = firstRelation(booking.services);
    if (!lead?.email) return json(request, { error: "Informe um e-mail válido para gerar o Pix." }, 422);

    const details = emailDetails(booking as unknown as Record<string, unknown>);
    let emailSent = false;
    let professionalEmailSent = false;
    if (request.method === "POST" && booking.status === "awaiting_payment" && new Date(booking.payment_expires_at) > new Date() && details) {
      await supabase.from("leads").update({ status: "qualified", updated_at: new Date().toISOString() }).eq("id", booking.lead_id).neq("status", "lost");
      [emailSent, professionalEmailSent] = await Promise.all([
        sendCustomerPrebookingEmail(details),
        sendProfessionalPrebookingEmail(details),
      ]);
    }

    const { data: currentPayment } = await supabase
      .from("payments")
      .select("status,pix_copy_paste,qr_code_base64,ticket_url,expires_at")
      .eq("booking_id", booking.id)
      .maybeSingle();

    if (request.method === "GET" || currentPayment?.pix_copy_paste) {
      return json(request, { bookingStatus: booking.status, payment: currentPayment, emailSent, professionalEmailSent });
    }

    if (booking.status !== "awaiting_payment" || new Date(booking.payment_expires_at) <= new Date()) {
      return json(request, { error: "O prazo desta reserva expirou." }, 409);
    }

    const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
    const notificationUrl = Deno.env.get("MERCADO_PAGO_WEBHOOK_URL");
    if (!accessToken || !notificationUrl) return json(request, {
      error: "Pix ainda não configurado.",
      code: "mercado_pago_not_configured",
    }, 503);

    const paymentPayload: Record<string, unknown> = {
      transaction_amount: Number(booking.deposit_cents) / 100,
      description: `Sinal de reserva — ${service?.name ?? "PS Estética"}`,
      payment_method_id: "pix",
      external_reference: `booking:${booking.id}`,
      date_of_expiration: booking.payment_expires_at,
      payer: { email: lead.email, first_name: lead.name },
    };
    paymentPayload.notification_url = notificationUrl;

    const mercadoPagoResponse = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": booking.public_token,
      },
      body: JSON.stringify(paymentPayload),
    });
    const mercadoPago = await mercadoPagoResponse.json();
    if (!mercadoPagoResponse.ok) {
      console.error("Mercado Pago create payment failed", mercadoPago);
      return json(request, { error: "Não foi possível gerar o Pix agora." }, 502);
    }

    const transaction = mercadoPago.point_of_interaction?.transaction_data ?? {};
    const { error: saveError } = await supabase.from("payments").upsert({
      booking_id: booking.id,
      provider: "mercado_pago",
      status: mercadoPago.status === "approved" ? "paid" : "pending",
      provider_status: mercadoPago.status,
      amount_cents: booking.deposit_cents,
      external_id: String(mercadoPago.id),
      pix_copy_paste: transaction.qr_code ?? null,
      qr_code_base64: transaction.qr_code_base64 ?? null,
      ticket_url: transaction.ticket_url ?? null,
      expires_at: booking.payment_expires_at,
      paid_at: mercadoPago.status === "approved" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "booking_id" });
    if (saveError) throw saveError;

    let customerConfirmationEmailSent = false;
    let professionalConfirmationEmailSent = false;
    if (mercadoPago.status === "approved") {
      await supabase.from("bookings").update({
        status: "confirmed",
        updated_at: new Date().toISOString(),
      }).eq("id", booking.id).eq("status", "awaiting_payment");
      await supabase.from("leads").update({ status: "scheduled", updated_at: new Date().toISOString() }).eq("id", booking.lead_id);
      if (details) {
        [customerConfirmationEmailSent, professionalConfirmationEmailSent] = await Promise.all([
          sendCustomerPaymentConfirmedEmail(details),
          sendProfessionalPaymentConfirmedEmail(details),
        ]);
      }
    }

    await supabase.from("clinic_settings").update({
      payment_provider: "mercado_pago",
      pix_enabled: true,
      updated_at: new Date().toISOString(),
    }).eq("id", true);

    return json(request, {
      bookingStatus: mercadoPago.status === "approved" ? "confirmed" : booking.status,
      payment: {
        status: mercadoPago.status === "approved" ? "paid" : "pending",
        pix_copy_paste: transaction.qr_code,
        qr_code_base64: transaction.qr_code_base64,
        ticket_url: transaction.ticket_url,
        expires_at: booking.payment_expires_at,
      },
      emailSent,
      professionalEmailSent,
      customerConfirmationEmailSent,
      professionalConfirmationEmailSent,
    }, 201);
  } catch (error) {
    console.error(error);
    return json(request, { error: "Erro interno ao processar o Pix." }, 500);
  }
});
