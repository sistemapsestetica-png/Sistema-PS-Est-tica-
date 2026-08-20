import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { firstRelation } from "../_shared/booking-emails.ts";

function corsHeaders(request: Request) {
  const panelUrl = (Deno.env.get("PANEL_URL") ?? "https://painel.psestetica.com.br").replace(/\/$/, "");
  const origin = request.headers.get("origin")?.replace(/\/$/, "") ?? "";
  return {
    "Access-Control-Allow-Origin": origin === panelUrl ? origin : panelUrl,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8" },
});

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (request.method !== "POST") return json(request, { error: "Método não permitido." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "");
  if (!token) return json(request, { error: "Acesso não autorizado." }, 401);

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
  const { data: authData, error: authError } = await authClient.auth.getUser(token);
  if (authError || !authData.user) return json(request, { error: "Sessão inválida." }, 401);

  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: profile } = await supabase.from("staff_profiles").select("role,active").eq("user_id", authData.user.id).maybeSingle();
  if (!profile?.active || profile.role !== "receptionist") return json(request, { error: "Apenas a recepção pode gerar cobranças." }, 403);

  try {
    const body = await request.json();
    const bookingId = Number(body.bookingId);
    if (!Number.isInteger(bookingId) || bookingId <= 0) return json(request, { error: "Agendamento inválido." }, 400);

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id,status,price_cents,deposit_cents,leads(name,email),services(name),payments(status,amount_cents),service_payments(status,amount_cents,checkout_url,created_at)")
      .eq("id", bookingId)
      .single();
    if (bookingError || !booking) return json(request, { error: "Agendamento não encontrado." }, 404);
    if (!["confirmed", "rescheduled", "completed"].includes(booking.status)) return json(request, { error: "O pagamento do sinal precisa estar confirmado." }, 409);

    const lead = firstRelation(booking.leads);
    const service = firstRelation(booking.services);
    if (!lead?.email) return json(request, { error: "A cliente precisa ter um e-mail cadastrado." }, 422);

    const depositPaid = (booking.payments ?? []).filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount_cents ?? 0), 0);
    const servicePaid = (booking.service_payments ?? []).filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount_cents ?? 0), 0);
    const outstandingCents = Math.max(0, Number(booking.price_cents) - depositPaid - servicePaid);
    if (outstandingCents <= 0) return json(request, { error: "Este atendimento já está totalmente pago." }, 409);

    const reusable = [...(booking.service_payments ?? [])]
      .filter((payment) => payment.status === "pending" && Number(payment.amount_cents) === outstandingCents && payment.checkout_url)
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
    if (reusable?.checkout_url) return json(request, { checkoutUrl: reusable.checkout_url, amountCents: outstandingCents, reused: true });

    const accessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN");
    const webhookUrl = Deno.env.get("MERCADO_PAGO_WEBHOOK_URL");
    if (!accessToken || !webhookUrl) return json(request, {
      error: "Mercado Pago aguardando Access Token e configuração do webhook.",
      code: "mercado_pago_not_configured",
    }, 503);

    const { data: ledger, error: ledgerError } = await supabase.from("service_payments").insert({
      booking_id: booking.id,
      payment_type: depositPaid > 0 ? "balance" : "full",
      method: "mercado_pago",
      status: "pending",
      amount_cents: outstandingCents,
      created_by: authData.user.id,
    }).select("id").single();
    if (ledgerError || !ledger) throw ledgerError ?? new Error("Não foi possível criar o lançamento financeiro");

    const panelUrl = (Deno.env.get("PANEL_URL") ?? "https://painel.psestetica.com.br").replace(/\/$/, "");
    const preferencePayload: Record<string, unknown> = {
      items: [{
        id: `booking-${booking.id}-balance`,
        title: `Saldo — ${service?.name ?? "PS Estética"}`,
        quantity: 1,
        currency_id: "BRL",
        unit_price: outstandingCents / 100,
      }],
      payer: { name: lead.name, email: lead.email },
      external_reference: `booking-balance:${booking.id}:${ledger.id}`,
      back_urls: {
        success: `${panelUrl}/admin?pagamento=aprovado`,
        pending: `${panelUrl}/admin?pagamento=pendente`,
        failure: `${panelUrl}/admin?pagamento=falhou`,
      },
      auto_return: "approved",
      statement_descriptor: "PS ESTETICA",
      expires: true,
      expiration_date_from: new Date().toISOString(),
      expiration_date_to: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    };
    preferencePayload.notification_url = webhookUrl;

    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(preferencePayload),
    });
    const preference = await response.json();
    if (!response.ok || !preference.init_point) {
      await supabase.from("service_payments").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", ledger.id);
      console.error("Mercado Pago preference failed", response.status, preference);
      return json(request, { error: "Não foi possível gerar o link de pagamento." }, 502);
    }

    await supabase.from("service_payments").update({
      provider_preference_id: String(preference.id),
      checkout_url: preference.init_point,
      updated_at: new Date().toISOString(),
    }).eq("id", ledger.id);

    return json(request, { checkoutUrl: preference.init_point, amountCents: outstandingCents }, 201);
  } catch (error) {
    console.error(error);
    return json(request, { error: "Erro interno ao gerar a cobrança." }, 500);
  }
});
