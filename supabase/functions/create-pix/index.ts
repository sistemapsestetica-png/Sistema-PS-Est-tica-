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

function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

function bookingDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

async function sendPrebookingEmail(booking: Record<string, unknown>) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  if (!apiKey || !from) {
    console.warn("Resend booking email not configured");
    return false;
  }

  const lead = firstRelation(booking.leads as { name?: string; email?: string } | { name?: string; email?: string }[] | null);
  const service = firstRelation(booking.services as { name?: string } | { name?: string }[] | null);
  const slot = firstRelation(booking.slots as { starts_at?: string } | { starts_at?: string }[] | null);
  if (!lead?.email || !slot?.starts_at) return false;

  const name = escapeHtml(lead.name?.trim() || "Cliente");
  const procedure = escapeHtml(service?.name || "Avaliação na PS Estética");
  const scheduledFor = escapeHtml(bookingDate(slot.starts_at));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `booking-${booking.id}-prebooking`,
    },
    body: JSON.stringify({
      from,
      to: [lead.email.trim().toLowerCase()],
      reply_to: Deno.env.get("RESEND_REPLY_TO") || undefined,
      subject: "Recebemos sua pré-reserva | PS Estética",
      html: `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#f4f0e8;color:#24221f;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fffdf8;border:1px solid #d8cfbf;border-radius:4px 28px 4px 28px"><tr><td style="padding:38px 34px"><p style="margin:0 0 12px;color:#8b7040;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">PS Estética • São Bernardo do Campo</p><h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:34px;font-weight:400;line-height:1.08">Recebemos sua pré-reserva</h1><p style="margin:0 0 22px;color:#5f5a52;font-size:15px;line-height:1.65">Olá, ${name}. Seu horário foi separado temporariamente enquanto você conclui a confirmação.</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3ecdd;border:1px solid #ddcda9;border-radius:3px 16px 3px 16px"><tr><td style="padding:20px"><p style="margin:0 0 6px;color:#7a746a;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Procedimento</p><p style="margin:0 0 16px;font-size:16px;font-weight:700">${procedure}</p><p style="margin:0 0 6px;color:#7a746a;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase">Data e horário</p><p style="margin:0;font-size:16px;font-weight:700;text-transform:capitalize">${scheduledFor}</p></td></tr></table><p style="margin:22px 0 0;color:#6f6960;font-size:13px;line-height:1.6">A confirmação definitiva acontece após a conclusão do sinal dentro do prazo exibido na página. Se precisar de ajuda, responda este e-mail.</p></td></tr></table></td></tr></table></body></html>`,
    }),
  });
  if (!response.ok) {
    console.error("Resend booking email failed", response.status, await response.text());
    return false;
  }
  return true;
}

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
      .select("id,status,deposit_cents,payment_expires_at,public_token,leads(name,email),services(name),slots(starts_at,ends_at)")
      .eq("public_token", bookingToken)
      .single();

    if (bookingError || !booking) return json({ error: "Reserva não encontrada." }, 404);

    const lead = firstRelation(booking.leads);
    const service = firstRelation(booking.services);
    if (!lead?.email) return json({ error: "Informe um e-mail válido para gerar o Pix." }, 422);

    let emailSent = false;
    if (request.method === "POST" && booking.status === "awaiting_payment" && new Date(booking.payment_expires_at) > new Date()) {
      emailSent = await sendPrebookingEmail(booking as unknown as Record<string, unknown>);
    }

    const { data: currentPayment } = await supabase
      .from("payments")
      .select("status,pix_copy_paste,qr_code_base64,ticket_url,expires_at")
      .eq("booking_id", booking.id)
      .maybeSingle();

    if (request.method === "GET" || currentPayment?.pix_copy_paste) {
      return json({ bookingStatus: booking.status, payment: currentPayment, emailSent });
    }

    if (booking.status !== "awaiting_payment" || new Date(booking.payment_expires_at) <= new Date()) {
      return json({ error: "O prazo desta reserva expirou." }, 409);
    }

    const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
    if (!accessToken) return json({
      error: "Pix ainda não configurado.",
      code: "mercado_pago_not_configured",
    }, 503);

    const notificationUrl = Deno.env.get("MERCADO_PAGO_WEBHOOK_URL");
    const paymentPayload: Record<string, unknown> = {
      transaction_amount: Number(booking.deposit_cents) / 100,
      description: `Sinal de reserva — ${service?.name ?? "PS Estética"}`,
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
      emailSent,
    }, 201);
  } catch (error) {
    console.error(error);
    return json({ error: "Erro interno ao processar o Pix." }, 500);
  }
});
