import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { type BookingEmailDetails, firstRelation, sendCustomerPrebookingEmail, sendProfessionalPrebookingEmail } from "../_shared/booking-emails.ts";
import { asaasDueDate, asaasFetch, cpfDigits, getOrCreateAsaasCustomer, isAsaasConfigured, validCpf } from "../_shared/asaas.ts";

function corsHeaders(request: Request) {
  const configured = [Deno.env.get("SITE_URL"), Deno.env.get("AGENDA_URL"), ...(Deno.env.get("PUBLIC_ALLOWED_ORIGINS") ?? "").split(",")]
    .map((value) => value?.trim().replace(/\/$/, "")).filter(Boolean) as string[];
  const origin = request.headers.get("origin")?.replace(/\/$/, "") ?? "";
  return { "Access-Control-Allow-Origin": configured.includes(origin) ? origin : (configured[0] ?? "*"), "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", Vary: "Origin" };
}

const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(request), "content-type": "application/json; charset=utf-8" } });

function emailDetails(booking: Record<string, unknown>): BookingEmailDetails | null {
  const lead = firstRelation(booking.leads as { name?: string; email?: string; phone?: string } | { name?: string; email?: string; phone?: string }[] | null);
  const service = firstRelation(booking.services as { name?: string } | { name?: string }[] | null);
  const slot = firstRelation(booking.slots as { starts_at?: string } | { starts_at?: string }[] | null);
  const professional = firstRelation(booking.professional as { full_name?: string; email?: string } | { full_name?: string; email?: string }[] | null);
  if (!lead?.email || !slot?.starts_at) return null;
  return { bookingId: Number(booking.id), customerName: lead.name?.trim() || "Cliente", customerEmail: lead.email, customerPhone: lead.phone, serviceName: service?.name || "Avaliação na PS Estética", startsAt: slot.starts_at, professionalName: professional?.full_name, professionalEmail: professional?.email, depositCents: Number(booking.deposit_cents) };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(request) });
  if (!["GET", "POST"].includes(request.method)) return json(request, { error: "Método não permitido." }, 405);
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  try {
    const url = new URL(request.url);
    const payload = request.method === "POST" ? await request.json() : {};
    const bookingToken = String(payload.bookingToken ?? url.searchParams.get("token") ?? "");
    if (!bookingToken) return json(request, { error: "Reserva inválida." }, 400);
    await supabase.rpc("release_expired_reservations");
    const { data: booking, error: bookingError } = await supabase.from("bookings")
      .select("id,lead_id,status,deposit_cents,payment_expires_at,public_token,leads(name,email,phone),services(name),slots(starts_at,ends_at),professional:staff_profiles!bookings_professional_id_fkey(full_name,email)")
      .eq("public_token", bookingToken).single();
    if (bookingError || !booking) return json(request, { error: "Reserva não encontrada." }, 404);
    const lead = firstRelation(booking.leads);
    const service = firstRelation(booking.services);
    if (!lead?.email) return json(request, { error: "Informe um e-mail válido para gerar o Pix." }, 422);
    const { data: currentPayment } = await supabase.from("payments").select("provider,status,pix_copy_paste,qr_code_base64,ticket_url,expires_at").eq("booking_id", booking.id).maybeSingle();
    if (request.method === "GET" || currentPayment?.status === "paid" || (currentPayment?.provider === "asaas" && currentPayment?.pix_copy_paste)) return json(request, { bookingStatus: booking.status, payment: currentPayment });
    if (booking.status !== "awaiting_payment" || new Date(booking.payment_expires_at) <= new Date()) return json(request, { error: "O prazo desta reserva expirou." }, 409);
    if (currentPayment && currentPayment.provider !== "asaas") return json(request, { error: "Esta reserva possui uma cobrança anterior. Fale com a equipe para gerar um novo Pix." }, 409);
    const cpf = cpfDigits(payload.cpf);
    if (!validCpf(cpf)) return json(request, { error: "Informe um CPF válido para gerar o Pix.", code: "invalid_cpf" }, 422);
    if (!isAsaasConfigured()) return json(request, { error: "Pix ainda não configurado.", code: "asaas_not_configured" }, 503);

    const details = emailDetails(booking as unknown as Record<string, unknown>);
    let emailSent = false;
    let professionalEmailSent = false;
    if (details) {
      await supabase.from("leads").update({ status: "qualified", updated_at: new Date().toISOString() }).eq("id", booking.lead_id).neq("status", "lost");
      [emailSent, professionalEmailSent] = await Promise.all([sendCustomerPrebookingEmail(details), sendProfessionalPrebookingEmail(details)]);
    }
    const customer = await getOrCreateAsaasCustomer({ leadId: booking.lead_id, name: lead.name ?? "Cliente PS Estética", email: lead.email, phone: lead.phone, cpf });
    const payment = await asaasFetch("/payments", { method: "POST", body: JSON.stringify({ customer: customer.id, billingType: "PIX", value: Number(booking.deposit_cents) / 100, dueDate: asaasDueDate(booking.payment_expires_at), description: `Sinal de reserva — ${service?.name ?? "PS Estética"}`, externalReference: `booking:${booking.id}` }) });
    const qr = await asaasFetch(`/payments/${encodeURIComponent(payment.id)}/pixQrCode`);
    const { error: saveError } = await supabase.from("payments").upsert({ booking_id: booking.id, provider: "asaas", status: "pending", provider_status: payment.status, amount_cents: booking.deposit_cents, external_id: payment.id, pix_copy_paste: qr.payload ?? null, qr_code_base64: qr.encodedImage ?? null, ticket_url: payment.invoiceUrl ?? null, expires_at: booking.payment_expires_at, paid_at: null, updated_at: new Date().toISOString() }, { onConflict: "booking_id" });
    if (saveError) throw saveError;
    await supabase.from("clinic_settings").update({ payment_provider: "asaas", pix_enabled: true, updated_at: new Date().toISOString() }).eq("id", true);
    return json(request, { bookingStatus: booking.status, payment: { status: "pending", pix_copy_paste: qr.payload, qr_code_base64: qr.encodedImage, ticket_url: payment.invoiceUrl, expires_at: booking.payment_expires_at }, emailSent, professionalEmailSent }, 201);
  } catch (error) {
    console.error("Asaas Pix error", error instanceof Error ? error.message : error);
    return json(request, { error: "Não foi possível gerar o Pix agora." }, 502);
  }
});
