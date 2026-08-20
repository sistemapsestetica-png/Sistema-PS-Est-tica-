export type BookingEmailDetails = {
  bookingId: number;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  serviceName: string;
  startsAt: string;
  professionalName?: string;
  professionalEmail?: string;
  depositCents?: number;
};

export function firstRelation<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character] ?? character);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long",
    year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(new Date(value));
}

function formatPhone(value?: string) {
  const digits = String(value ?? "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value?.trim() || "Não informado";
}

function formatMoney(cents?: number) {
  if (typeof cents !== "number") return "";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function detailsTable(rows: Array<[string, string]>) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3ecdd;border:1px solid #ddcda9;border-radius:4px 20px 4px 20px"><tr><td style="padding:22px 24px">${rows.map(([label, value], index) => `<p style="margin:${index ? "18px" : "0"} 0 5px;color:#7a746a;font-size:10px;font-weight:700;letter-spacing:1.1px;text-transform:uppercase">${escapeHtml(label)}</p><p style="margin:0;color:#24221f;font-size:16px;font-weight:700;line-height:1.45;text-transform:${label === "Data e horário" ? "capitalize" : "none"}">${escapeHtml(value)}</p>`).join("")}</td></tr></table>`;
}

function template(title: string, intro: string, details: string, footer: string, eyebrow: string) {
  return `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f4f0e8;color:#24221f;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fffdf8;border:1px solid #d8cfbf;border-radius:4px 30px 4px 30px;overflow:hidden"><tr><td style="background:#1f211e;padding:18px 30px;color:#f6f0e5;font-family:Georgia,serif;font-size:20px;letter-spacing:2px">PS ESTÉTICA</td></tr><tr><td style="padding:34px 30px"><p style="margin:0 0 12px;color:#8b7040;font-size:11px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase">${escapeHtml(eyebrow)}</p><h1 style="margin:0 0 18px;font-family:Georgia,serif;font-size:32px;font-weight:400;line-height:1.12">${escapeHtml(title)}</h1><p style="margin:0 0 22px;color:#5f5a52;font-size:15px;line-height:1.65">${escapeHtml(intro)}</p>${details}<p style="margin:22px 0 0;color:#6f6960;font-size:13px;line-height:1.6">${escapeHtml(footer)}</p></td></tr><tr><td style="background:#eee5d5;padding:16px 30px;color:#756e64;font-size:11px;line-height:1.5">PS Estética • São Bernardo do Campo • Atendimento individualizado</td></tr></table></td></tr></table></body></html>`;
}

async function sendEmail(to: string | undefined, subject: string, html: string, idempotencyKey: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");
  const recipient = to?.trim().toLowerCase();
  if (!apiKey || !from || !recipient) {
    console.warn("Resend email skipped: missing configuration or recipient", idempotencyKey);
    return false;
  }
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ from, to: [recipient], reply_to: Deno.env.get("RESEND_REPLY_TO") || undefined, subject, html }),
    });
    if (!response.ok) {
      console.error("Resend email failed", idempotencyKey, response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.error("Resend email request failed", idempotencyKey, error);
    return false;
  }
}

export function sendCustomerPrebookingEmail(details: BookingEmailDetails) {
  const rows: Array<[string, string]> = [["Procedimento", details.serviceName], ["Data e horário", formatDate(details.startsAt)]];
  if (details.professionalName) rows.push(["Profissional", details.professionalName]);
  return sendEmail(details.customerEmail, "Recebemos sua pré-reserva | PS Estética", template(
    "Recebemos sua pré-reserva",
    `Olá, ${details.customerName}. Seu horário foi separado temporariamente enquanto você conclui a confirmação.`,
    detailsTable(rows),
    "A confirmação definitiva acontece após a conclusão do sinal dentro do prazo exibido na página.",
    "Pré-reserva recebida",
  ), `booking-${details.bookingId}-prebooking`);
}

export function sendProfessionalPrebookingEmail(details: BookingEmailDetails) {
  return sendEmail(details.professionalEmail, "Nova pré-reserva na sua agenda | PS Estética", template(
    "Nova pré-reserva na sua agenda",
    `Olá, ${details.professionalName || "profissional"}. Um novo horário foi reservado e aguarda o pagamento do sinal.`,
    detailsTable([["Cliente", details.customerName], ["WhatsApp", formatPhone(details.customerPhone)], ["Procedimento", details.serviceName], ["Data e horário", formatDate(details.startsAt)]]),
    "Você receberá outra mensagem quando o pagamento for aprovado e o atendimento estiver confirmado.",
    "Nova oportunidade",
  ), `booking-${details.bookingId}-prebooking-professional`);
}

export function sendCustomerPaymentConfirmedEmail(details: BookingEmailDetails) {
  const rows: Array<[string, string]> = [["Procedimento", details.serviceName], ["Data e horário", formatDate(details.startsAt)]];
  if (details.professionalName) rows.push(["Profissional", details.professionalName]);
  if (typeof details.depositCents === "number") rows.push(["Sinal confirmado", formatMoney(details.depositCents)]);
  return sendEmail(details.customerEmail, "Seu horário está confirmado | PS Estética", template(
    "Pagamento confirmado",
    `Olá, ${details.customerName}. Recebemos o sinal e seu atendimento está confirmado.`,
    detailsTable(rows),
    "Se precisar alterar o horário, fale com a equipe da PS Estética com antecedência.",
    "Reserva confirmada",
  ), `booking-${details.bookingId}-payment-confirmed-customer`);
}

export function sendProfessionalPaymentConfirmedEmail(details: BookingEmailDetails) {
  return sendEmail(details.professionalEmail, "Atendimento confirmado na sua agenda | PS Estética", template(
    "Atendimento confirmado",
    `Olá, ${details.professionalName || "profissional"}. O pagamento do sinal foi aprovado e este atendimento está confirmado.`,
    detailsTable([["Cliente", details.customerName], ["WhatsApp", formatPhone(details.customerPhone)], ["Procedimento", details.serviceName], ["Data e horário", formatDate(details.startsAt)]]),
    "O horário já consta como confirmado na agenda da PS Estética.",
    "Pagamento aprovado",
  ), `booking-${details.bookingId}-payment-confirmed-professional`);
}
