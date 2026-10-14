"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../lib/supabase";

type ReportPreset = "day" | "week" | "month" | "custom";
type Lead = { id: number; name: string; service_slug: string; status: string; notes: string | null; created_at: string; updated_at: string; source: Record<string, unknown> | null };
type LeadEvent = { id: number; lead_id: number; event_type: string; created_at: string; booking_id: number | null; leads: { name: string; service_slug: string } | null };
type Booking = { id: number; status: string; created_at: string; updated_at: string; deposit_cents: number; leads: { name: string } | null; services: { name: string } | null; slots: { starts_at: string } | null };
type Payment = { id: number; amount_cents: number; paid_at: string | null; provider: string | null; bookings: { leads: { name: string } | null; services: { name: string } | null } | null };
type ServicePayment = { id: number; amount_cents: number; paid_at: string | null; method: string; bookings: { leads: { name: string } | null; services: { name: string } | null } | null };
type ScheduledSlot = { id: number; starts_at: string; status: string; bookings: { id: number; status: string; leads: { name: string } | null }[] | null };

const EVENT_LABEL: Record<string, string> = {
  lead_created: "Novo lead recebido",
  quiz_started: "Quiz iniciado",
  quiz_completed: "Quiz concluído",
  lead_qualified: "Lead qualificado",
  whatsapp_opened: "WhatsApp aberto",
  lead_contacted: "Contato iniciado",
  lead_replied: "Cliente respondeu",
  interested: "Cliente demonstrou interesse",
  lead_lost: "Lead encerrado",
  slots_viewed: "Horários consultados",
  booking_started: "Pré-reserva iniciada",
  booking_completed: "Reserva criada",
  booking_cancelled: "Reserva cancelada ou expirada",
  appointment_completed: "Atendimento concluído",
  no_show: "Não compareceu",
  payment_pending: "Pagamento aguardando",
  payment_confirmed: "Pagamento confirmado",
  lead_note_updated: "Observação do atendimento atualizada",
};

const LEAD_STATUS_LABEL: Record<string, string> = { qualified: "Novo", contacted: "Em conversa", replied: "Em conversa", interested: "Interessado", slots_viewed: "Interessado", booking_started: "Pré-reservado", booked: "Pré-reservado", confirmed: "Agendado", completed: "Concluído", no_show: "Não compareceu", lost: "Encerrado" };

const PAYMENT_LABEL: Record<string, string> = { asaas: "Asaas", mercado_pago: "Mercado Pago", cash: "Dinheiro", card_machine: "Maquininha", pix_manual: "Pix manual", transfer: "Transferência", other: "Outro" };

function money(cents: number) { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100); }
function dateTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
function dateOnly(value: string) { return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long" }).format(new Date(`${value}T12:00:00-03:00`)); }
function todayInSaoPaulo() { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
function shiftDay(day: string, amount: number) { const value = new Date(`${day}T12:00:00-03:00`); value.setDate(value.getDate() + amount); return value.toISOString().slice(0, 10); }
function startOfWeek(day: string) { const value = new Date(`${day}T12:00:00-03:00`); return shiftDay(day, -((value.getDay() + 6) % 7)); }
function startOfMonth(day: string) { return `${day.slice(0, 7)}-01`; }
function dateRange(start: string, end: string) { return { from: `${start}T00:00:00-03:00`, to: `${shiftDay(end, 1)}T00:00:00-03:00` }; }
function sourceLabel(source: Record<string, unknown> | null) {
  const value = source?.utm_campaign || source?.utm_source || source?.origin || source?.page;
  return typeof value === "string" && value.trim() ? value.trim() : "Direto / não informado";
}

export function OperationsReport() {
  const [preset, setPreset] = useState<ReportPreset>("month");
  const [start, setStart] = useState(() => startOfMonth(todayInSaoPaulo()));
  const [end, setEnd] = useState(todayInSaoPaulo);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [notesLeads, setNotesLeads] = useState<Lead[]>([]);
  const [events, setEvents] = useState<LeadEvent[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [servicePayments, setServicePayments] = useState<ServicePayment[]>([]);
  const [scheduledSlots, setScheduledSlots] = useState<ScheduledSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function choosePreset(next: ReportPreset) {
    const today = todayInSaoPaulo();
    setPreset(next);
    if (next === "day") { setStart(today); setEnd(today); }
    if (next === "week") { setStart(startOfWeek(today)); setEnd(today); }
    if (next === "month") { setStart(startOfMonth(today)); setEnd(today); }
  }

  async function load() {
    if (!start || !end || end < start) return;
    setLoading(true); setError("");
    const { from, to } = dateRange(start, end);
    const [leadResult, noteResult, eventResult, bookingResult, paymentResult, servicePaymentResult, slotResult] = await Promise.all([
      supabase.from("leads").select("id,name,service_slug,status,notes,created_at,updated_at,source").gte("created_at", from).lt("created_at", to).order("created_at", { ascending: false }).limit(5000),
      supabase.from("leads").select("id,name,service_slug,status,notes,created_at,updated_at,source").not("notes", "is", null).gte("updated_at", from).lt("updated_at", to).order("updated_at", { ascending: false }).limit(5000),
      supabase.from("lead_events").select("id,lead_id,event_type,created_at,booking_id,leads(name,service_slug)").gte("created_at", from).lt("created_at", to).order("created_at", { ascending: false }).limit(5000),
      supabase.from("bookings").select("id,status,created_at,updated_at,deposit_cents,leads(name),services(name),slots(starts_at)").gte("created_at", from).lt("created_at", to).order("created_at", { ascending: false }).limit(3000),
      supabase.from("payments").select("id,amount_cents,paid_at,provider,bookings(leads(name),services(name))").eq("status", "paid").gte("paid_at", from).lt("paid_at", to).order("paid_at", { ascending: false }).limit(5000),
      supabase.from("service_payments").select("id,amount_cents,paid_at,method,bookings(leads(name),services(name))").eq("status", "paid").gte("paid_at", from).lt("paid_at", to).order("paid_at", { ascending: false }).limit(5000),
      supabase.from("slots").select("id,starts_at,status,bookings(id,status,leads(name))").gte("starts_at", from).lt("starts_at", to).order("starts_at", { ascending: true }).limit(5000),
    ]);
    const firstError = leadResult.error || noteResult.error || eventResult.error || bookingResult.error || paymentResult.error || servicePaymentResult.error || slotResult.error;
    if (firstError) setError(`Não foi possível gerar o relatório: ${firstError.message}`);
    setLeads((leadResult.data ?? []) as Lead[]);
    setNotesLeads((noteResult.data ?? []) as Lead[]);
    setEvents((eventResult.data ?? []) as unknown as LeadEvent[]);
    setBookings((bookingResult.data ?? []) as unknown as Booking[]);
    setPayments((paymentResult.data ?? []) as unknown as Payment[]);
    setServicePayments((servicePaymentResult.data ?? []) as unknown as ServicePayment[]);
    setScheduledSlots((slotResult.data ?? []) as unknown as ScheduledSlot[]);
    setLoading(false);
  }

  useEffect(() => { queueMicrotask(() => { void load(); }); }, [start, end]); // eslint-disable-line react-hooks/exhaustive-deps

  const report = useMemo(() => {
    const revenue = [...payments, ...servicePayments].reduce((sum, item) => sum + Number(item.amount_cents ?? 0), 0);
    const confirmed = bookings.filter((booking) => ["confirmed", "rescheduled", "completed", "no_show"].includes(booking.status)).length;
    const scheduled = scheduledSlots.filter((slot) => (slot.bookings ?? []).some((booking) => ["confirmed", "rescheduled"].includes(booking.status))).length;
    const cancelled = events.filter((event) => event.event_type === "booking_cancelled").length;
    const attended = events.filter((event) => event.event_type === "appointment_completed").length;
    const noShows = events.filter((event) => event.event_type === "no_show").length;
    const contacted = events.filter((event) => ["lead_contacted", "lead_replied", "interested"].includes(event.event_type)).length;
    const booked = events.filter((event) => ["booking_started", "booking_completed"].includes(event.event_type)).length;
    const byService = [...payments, ...servicePayments].reduce<Record<string, number>>((groups, item) => {
      const service = item.bookings?.services?.name || "Não informado";
      groups[service] = (groups[service] ?? 0) + Number(item.amount_cents ?? 0);
      return groups;
    }, {});
    const bySource = leads.reduce<Record<string, number>>((groups, lead) => { const source = sourceLabel(lead.source); groups[source] = (groups[source] ?? 0) + 1; return groups; }, {});
    const notes = notesLeads.filter((lead) => Boolean(lead.notes?.trim()));
    const activity = [
      ...events.map((event) => ({ at: event.created_at, title: EVENT_LABEL[event.event_type] ?? event.event_type, detail: event.leads ? `${event.leads.name} · ${event.leads.service_slug}` : "" })),
      ...bookings.map((booking) => ({ at: booking.created_at, title: "Pré-reserva criada", detail: `${booking.leads?.name ?? "Cliente"} · ${booking.services?.name ?? "Procedimento"}` })),
      ...payments.filter((payment) => payment.paid_at).map((payment) => ({ at: payment.paid_at!, title: `Sinal recebido · ${PAYMENT_LABEL[payment.provider ?? ""] ?? "Pagamento"}`, detail: `${payment.bookings?.leads?.name ?? "Cliente"} · ${money(Number(payment.amount_cents))}` })),
      ...servicePayments.filter((payment) => payment.paid_at).map((payment) => ({ at: payment.paid_at!, title: `Recebimento registrado · ${PAYMENT_LABEL[payment.method] ?? payment.method}`, detail: `${payment.bookings?.leads?.name ?? "Cliente"} · ${money(Number(payment.amount_cents))}` })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { revenue, confirmed, scheduled, cancelled, attended, noShows, contacted, booked, byService, bySource, notes, activity };
  }, [leads, notesLeads, events, bookings, payments, servicePayments, scheduledSlots]);

  const periodDescription = `${dateOnly(start)} a ${dateOnly(end)}`;
  return <section className="operations-report" id="operations-report">
    <div className="report-toolbar no-print">
      <div><p className="admin-eyebrow">Relatório automático</p><h3>Movimentações da clínica</h3><p>Dados consolidados do funil, agenda e financeiro. Nenhuma informação é digitada manualmente.</p></div>
      <div className="report-toolbar-actions"><button type="button" className="report-refresh" onClick={() => void load()} disabled={loading}>{loading ? "Atualizando…" : "Atualizar dados"}</button><button type="button" className="report-export" onClick={() => window.print()} disabled={loading}>Exportar PDF</button></div>
    </div>

    <div className="report-period no-print" aria-label="Escolha o período do relatório">
      {(["day", "week", "month"] as ReportPreset[]).map((item) => <button type="button" key={item} className={preset === item ? "active" : ""} onClick={() => choosePreset(item)}>{item === "day" ? "Hoje" : item === "week" ? "Esta semana" : "Este mês"}</button>)}
      <button type="button" className={preset === "custom" ? "active" : ""} onClick={() => setPreset("custom")}>Personalizado</button>
      <label>De<input type="date" value={start} onChange={(event) => { setPreset("custom"); setStart(event.target.value); }} /></label>
      <label>Até<input type="date" value={end} min={start} onChange={(event) => { setPreset("custom"); setEnd(event.target.value); }} /></label>
    </div>

    {error && <div className="admin-message banner" role="status">{error}</div>}
    <article className="report-document">
      <header className="report-document-header"><div><p>PS ESTÉTICA · RELATÓRIO OPERACIONAL</p><h2>Resumo de movimentações</h2><span>{periodDescription}</span></div><div className="report-document-meta"><b>Gerado automaticamente</b><span>{dateTime(new Date().toISOString())}</span></div></header>
      <section className="report-kpis">
        <article><span>Leads recebidos</span><b>{leads.length}</b><small>novos contatos no período</small></article>
        <article><span>Contatos em andamento</span><b>{report.contacted}</b><small>interações registradas</small></article>
        <article><span>Agenda prevista</span><b>{report.scheduled}</b><small>{report.confirmed} reserva(s) confirmada(s) no período</small></article>
        <article><span>Receita recebida</span><b>{money(report.revenue)}</b><small>sinais e pagamentos efetivos</small></article>
      </section>
      <section className="report-insights">
        <div><p className="admin-eyebrow">Leitura do período</p><h3>O que aconteceu</h3><ul><li><b>{report.booked}</b> movimentos de pré-reserva e reserva foram registrados.</li><li><b>{report.attended}</b> atendimento(s) concluído(s) e <b>{report.noShows}</b> ausência(s) foram informados.</li><li><b>{report.cancelled}</b> reserva(s) foi(foram) cancelada(s) ou expirou(ram).</li></ul></div>
        <div><p className="admin-eyebrow">Resumo gerencial</p><h3>Leitura rápida para a gestão</h3><p>{leads.length ? `A clínica recebeu ${leads.length} novo(s) lead(s), confirmou ${report.confirmed} reserva(s) e possui ${report.scheduled} atendimento(s) previsto(s) no período selecionado.` : "Não houve novos leads registrados no período selecionado."} A receita considera apenas valores com pagamento efetivamente confirmado.</p></div>
      </section>
      <section className="report-breakdown-grid">
        <article><p className="admin-eyebrow">Captação por origem</p><h3>De onde vieram os contatos</h3>{Object.entries(report.bySource).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => <p className="report-row" key={label}><span>{label}</span><b>{value}</b></p>)}{!leads.length && <small>Sem novos contatos no período.</small>}</article>
        <article><p className="admin-eyebrow">Receita por procedimento</p><h3>Valores recebidos</h3>{Object.entries(report.byService).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([label, value]) => <p className="report-row" key={label}><span>{label}</span><b>{money(value)}</b></p>)}{!Object.keys(report.byService).length && <small>Sem recebimentos no período.</small>}</article>
      </section>
      <section className="report-notes"><div className="report-timeline-heading"><div><p className="admin-eyebrow">Atendimento</p><h3>Observações registradas</h3></div><span>{report.notes.length} registro(s)</span></div>{loading ? <p className="report-empty">Carregando observações…</p> : report.notes.length ? <ol>{report.notes.slice(0, 150).map((lead) => <li key={lead.id}><time>{dateTime(lead.updated_at || lead.created_at)}</time><div><b>{lead.name} · {LEAD_STATUS_LABEL[lead.status] ?? lead.status}</b><p>{lead.notes}</p></div></li>)}</ol> : <p className="report-empty">Nenhuma observação foi registrada nos leads deste período.</p>}</section>
      <section className="report-timeline"><div className="report-timeline-heading"><div><p className="admin-eyebrow">Linha do tempo</p><h3>Todas as movimentações registradas</h3></div><span>{report.activity.length} registro(s)</span></div>{loading ? <p className="report-empty">Carregando as movimentações…</p> : report.activity.length ? <ol>{report.activity.slice(0, 150).map((item, index) => <li key={`${item.at}-${item.title}-${index}`}><time>{dateTime(item.at)}</time><div><b>{item.title}</b>{item.detail && <span>{item.detail}</span>}</div></li>)}</ol> : <p className="report-empty">Nenhuma movimentação foi registrada neste período.</p>}</section>
      <footer className="report-footer">Relatório gerado pelo painel PS Estética · Dados administrativos e financeiros do período selecionado.</footer>
    </article>
  </section>;
}
