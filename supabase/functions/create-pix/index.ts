import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("SITE_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "content-type": "application/json; charset=utf-8" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );

  try {
    const url = new URL(request.url);
    const payload = request.method === "POST" ? await request.json() : {};
    const bookingToken = String(payload.bookingToken ?? url.searchParams.get("token") ?? "");
    if (!bookingToken) return json({ error: "Reserva inválida." }, 400);

    await supabase.rpc("release_expired_reservations");
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id,status,deposit_cents,payment_expires_at,public_token,leads(name,email),services(name)")
      .eq("public_token", bookingToken)
      .single();

    if (bookingError || !booking) return json({ error: "Reserva não encontrada." }, 404);

    const { data: currentPayment } = await supabase
      .from("payments")
      .select("status,pix_copy_paste,qr_code_base64,ticket_url,expires_at")
      .eq("booking_id", booking.id)
      .maybeSingle();

    if (request.method === "GET" || currentPayment?.pix_copy_paste) {
      return json({ bookingStatus: booking.status, payment: currentPayment });
    }

    if (booking.status !== "awaiting_payment" || new Date(booking.payment_expires_at) <= new Date()) {
      return json({ error: "O prazo desta reserva expirou." }, 409);
    }

    const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
    if (!accessToken) return json({
      error: "Pix ainda não configurado.",
      code: "mercado_pago_not_configured",
    }, 503);

    const lead = Array.isArray(booking.leads) ? booking.leads[0] : booking.leads;
    const service = Array.isArray(booking.services) ? booking.services[0] : booking.services;
    if (!lead?.email) return json({ error: "Informe um e-mail válido para gerar o Pix." }, 422);

    const notificationUrl = Deno.env.get("MERCADO_PAGO_WEBHOOK_URL");
    const paymentPayload: Record<string, unknown> = {
      transaction_amount: Number(booking.deposit_cents) / 100,
      description: `Sinal de 10% — ${service?.name ?? "PS Estética"}`,
      payment_method_id: "pix",
      external_reference: `booking:${booking.id}`,
      date_of_expiration: booking.payment_expires_at,
      payer: { email: lead.email, first_name: lead.name },
    };
    if (notificationUrl) paymentPayload.notification_url = notificationUrl;

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
      return json({ error: "Não foi possível gerar o Pix agora." }, 502);
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

    if (mercadoPago.status === "approved") {
      await supabase.from("bookings").update({
        status: "confirmed",
        updated_at: new Date().toISOString(),
      }).eq("id", booking.id).eq("status", "awaiting_payment");
    }

    await supabase.from("clinic_settings").update({
      payment_provider: "mercado_pago",
      pix_enabled: true,
      updated_at: new Date().toISOString(),
    }).eq("id", true);

    return json({
      bookingStatus: mercadoPago.status === "approved" ? "confirmed" : booking.status,
      payment: {
        status: mercadoPago.status === "approved" ? "paid" : "pending",
        pix_copy_paste: transaction.qr_code,
        qr_code_base64: transaction.qr_code_base64,
        ticket_url: transaction.ticket_url,
        expires_at: booking.payment_expires_at,
      },
    }, 201);
  } catch (error) {
    console.error(error);
    return json({ error: "Erro interno ao processar o Pix." }, 500);
  }
});
