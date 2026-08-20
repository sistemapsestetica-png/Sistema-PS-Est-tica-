"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type Payment = { status: string; amount_cents: number; paid_at: string | null; provider: string };
type ServicePayment = { id: number; status: string; amount_cents: number; paid_at: string | null; method: string; checkout_url: string | null; notes: string | null };
type Booking = {
  id: number;
  status: string;
  price_cents: number;
  deposit_cents: number;
  leads: { name: string; phone: string } | null;
  services: { name: string } | null;
  slots: { starts_at: string } | null;
  professional: { full_name: string } | null;
  payments: Payment[] | null;
  service_payments: ServicePayment[] | null;
};

const methodLabel: Record<string, string> = {
  mercado_pago: "Mercado Pago",
  cash: "Dinheiro",
  card_machine: "Maquininha",
  pix_manual: "Pix externo",
  transfer: "Transferência",
  other: "Outro",
};

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function date(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function currentMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

function monthOf(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}`;
}

export function RevenueDashboard() {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [month, setMonth] = useState(currentMonth);
  const [bookingId, setBookingId] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("card_machine");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("bookings")
      .select("id,status,price_cents,deposit_cents,leads(name,phone),services(name),slots(starts_at),professional:staff_profiles!bookings_professional_id_fkey(full_name),payments(status,amount_cents,paid_at,provider),service_payments(id,status,amount_cents,paid_at,method,checkout_url,notes)")
      .in("status", ["confirmed", "rescheduled", "completed", "no_show"])
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) setMessage(`Não foi possível carregar o faturamento: ${error.message}`);
    setBookings((data ?? []) as unknown as Booking[]);
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  const totals = (booking: Booking) => {
    const deposit = (booking.payments ?? []).filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount_cents ?? 0), 0);
    const service = (booking.service_payments ?? []).filter((payment) => payment.status === "paid").reduce((sum, payment) => sum + Number(payment.amount_cents ?? 0), 0);
    return { deposit, service, paid: deposit + service, outstanding: Math.max(0, Number(booking.price_cents) - deposit - service) };
  };

  const transactions = useMemo(() => bookings.flatMap((booking) => [
    ...(booking.payments ?? []).filter((payment) => payment.status === "paid" && payment.paid_at).map((payment) => ({ booking, amount: Number(payment.amount_cents), paidAt: payment.paid_at!, method: "Sinal · Mercado Pago" })),
    ...(booking.service_payments ?? []).filter((payment) => payment.status === "paid" && payment.paid_at).map((payment) => ({ booking, amount: Number(payment.amount_cents), paidAt: payment.paid_at!, method: methodLabel[payment.method] ?? payment.method })),
  ]), [bookings]);
  const periodTransactions = transactions.filter((transaction) => monthOf(transaction.paidAt) === month);
  const revenue = periodTransactions.reduce((sum, transaction) => sum + transaction.amount, 0);
  const paidBookings = new Set(periodTransactions.map((transaction) => transaction.booking.id)).size;
  const averageTicket = paidBookings ? Math.round(revenue / paidBookings) : 0;
  const outstanding = bookings.reduce((sum, booking) => sum + totals(booking).outstanding, 0);

  const groupRevenue = (key: "service" | "professional") => Object.entries(periodTransactions.reduce<Record<string, number>>((groups, transaction) => {
    const label = key === "service" ? transaction.booking.services?.name : transaction.booking.professional?.full_name;
    groups[label || "Não informado"] = (groups[label || "Não informado"] ?? 0) + transaction.amount;
    return groups;
  }, {})).sort((a, b) => b[1] - a[1]);

  const eligibleBookings = bookings.filter((booking) => totals(booking).outstanding > 0 && ["confirmed", "rescheduled", "completed"].includes(booking.status));
  const selected = eligibleBookings.find((booking) => booking.id === Number(bookingId));

  function selectBooking(value: string) {
    setBookingId(value);
    const booking = eligibleBookings.find((item) => item.id === Number(value));
    setAmount(booking ? (totals(booking).outstanding / 100).toFixed(2) : "");
  }

  async function recordManualPayment(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    const amountCents = Math.round(Number(amount.replace(",", ".")) * 100);
    const balance = totals(selected).outstanding;
    if (!amountCents || amountCents <= 0 || amountCents > balance) return setMessage(`Informe um valor entre R$ 0,01 e ${money(balance)}.`);
    setBusy(true); setMessage("");
    const { error } = await supabase.from("service_payments").insert({
      booking_id: selected.id,
      payment_type: totals(selected).paid > 0 ? "balance" : "full",
      method,
      status: "paid",
      amount_cents: amountCents,
      paid_at: new Date().toISOString(),
      notes: notes.trim() || null,
    });
    if (error) setMessage(`Não foi possível registrar: ${error.message}`);
    else {
      setMessage("Pagamento registrado no faturamento.");
      setBookingId(""); setAmount(""); setNotes("");
      await load();
    }
    setBusy(false);
  }

  async function createMercadoPagoLink(booking: Booking) {
    if (busy) return;
    const popup = window.open("about:blank", "_blank");
    setBusy(true); setMessage("");
    const { data, error } = await supabase.functions.invoke("create-service-payment", { body: { bookingId: booking.id } });
    setBusy(false);
    if (error || !data?.checkoutUrl) {
      popup?.close();
      setMessage(data?.error ?? "Não foi possível gerar o link do Mercado Pago.");
      return;
    }
    if (popup) popup.location.href = data.checkoutUrl;
    await navigator.clipboard.writeText(data.checkoutUrl);
    setMessage(`Link de ${money(data.amountCents)} aberto e copiado.`);
    await load();
  }

  return <>
    <section className="revenue-header">
      <div><p className="admin-eyebrow">Financeiro</p><h2>Faturamento real</h2><p>Sinal, saldo do atendimento, recebimentos manuais e Mercado Pago em um único lugar.</p></div>
      <label>Período<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>
    </section>
    {message && <div className="admin-message banner" role="status">{message}<button onClick={() => setMessage("")}>×</button></div>}
    <section className="stats-grid revenue-stats">
      <article><span>Receita no período</span><b>{money(revenue)}</b><small>valores efetivamente pagos</small></article>
      <article><span>Atendimentos pagos</span><b>{paidBookings}</b><small>reservas com recebimento</small></article>
      <article><span>Ticket médio</span><b>{money(averageTicket)}</b><small>por atendimento recebido</small></article>
      <article><span>Saldo pendente</span><b>{money(outstanding)}</b><small>total ainda a receber</small></article>
    </section>
    <section className="admin-panel revenue-breakdowns">
      <div><p className="admin-eyebrow">Por procedimento</p>{groupRevenue("service").length ? groupRevenue("service").map(([label, value]) => <p key={label}><span>{label}</span><b>{money(value)}</b></p>) : <small>Sem recebimentos no período.</small>}</div>
      <div><p className="admin-eyebrow">Por profissional</p>{groupRevenue("professional").length ? groupRevenue("professional").map(([label, value]) => <p key={label}><span>{label}</span><b>{money(value)}</b></p>) : <small>Sem recebimentos no período.</small>}</div>
    </section>
    <section className="admin-panel revenue-manual">
      <div className="panel-heading"><div><p className="admin-eyebrow">Recebimento presencial</p><h2>Registrar pagamento manual</h2></div><p>Use para dinheiro, maquininha, Pix externo ou transferência.</p></div>
      <form onSubmit={recordManualPayment}>
        <label>Atendimento<select required value={bookingId} onChange={(event) => selectBooking(event.target.value)}><option value="">Selecione</option>{eligibleBookings.map((booking) => <option key={booking.id} value={booking.id}>{booking.leads?.name} · {booking.services?.name} · saldo {money(totals(booking).outstanding)}</option>)}</select></label>
        <label>Valor recebido (R$)<input required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d,.]/g, ""))} /></label>
        <label>Forma<select value={method} onChange={(event) => setMethod(event.target.value)}><option value="card_machine">Maquininha</option><option value="cash">Dinheiro</option><option value="pix_manual">Pix externo</option><option value="transfer">Transferência</option><option value="other">Outro</option></select></label>
        <label>Observação<input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Opcional" /></label>
        <button disabled={busy}>{busy ? "Registrando…" : "Registrar recebimento"}</button>
      </form>
    </section>
    <section className="admin-panel">
      <div className="panel-heading"><div><p className="admin-eyebrow">Contas a receber</p><h2>Saldo dos atendimentos</h2></div><p>O link aceita as formas disponibilizadas na sua conta do Mercado Pago.</p></div>
      <div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Procedimento</th><th>Profissional</th><th>Valor total</th><th>Recebido</th><th>Saldo</th><th>Cobrar</th></tr></thead><tbody>
        {loading && <tr><td colSpan={7} className="empty-state">Carregando faturamento…</td></tr>}
        {!loading && bookings.length === 0 && <tr><td colSpan={7} className="empty-state">Nenhum atendimento confirmado.</td></tr>}
        {!loading && bookings.map((booking) => { const summary = totals(booking); return <tr key={booking.id}><td><b>{booking.leads?.name ?? "Cliente"}</b><small>{booking.slots ? date(booking.slots.starts_at) : ""}</small></td><td>{booking.services?.name ?? "—"}</td><td>{booking.professional?.full_name ?? "Equipe"}</td><td>{money(booking.price_cents)}</td><td className="revenue-paid">{money(summary.paid)}</td><td className={summary.outstanding ? "revenue-due" : "revenue-settled"}>{summary.outstanding ? money(summary.outstanding) : "Quitado"}</td><td>{summary.outstanding > 0 && ["confirmed", "rescheduled", "completed"].includes(booking.status) ? <button className="revenue-charge" disabled={busy} onClick={() => createMercadoPagoLink(booking)}>Gerar link</button> : "—"}</td></tr>; })}
      </tbody></table></div>
    </section>
  </>;
}
