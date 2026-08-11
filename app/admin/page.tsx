"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import "./admin.css";

const ADMIN_EMAIL = "sistemapsestetica@gmail.com";

function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL?.trim();
  const url = configuredUrl || vercelUrl || window.location.origin;
  const absoluteUrl = url.startsWith("http") ? url : `https://${url}`;
  return absoluteUrl.replace(/\/$/, "");
}

type Service = {
  id: number;
  slug: string;
  name: string;
  description: string;
  price_cents: number | null;
  duration_minutes: number | null;
  deposit_percent: number;
  active: boolean;
};

type Lead = {
  id: number;
  name: string;
  phone: string;
  service_slug: string;
  timing: string;
  status: string;
  created_at: string;
};

type Slot = {
  id: number;
  service_id: number;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string;
};

type Settings = {
  deposit_percent: number;
  reschedule_notice_hours: number;
  payment_provider: string | null;
  pix_enabled: boolean;
};

type Booking = {
  id: number;
  status: string;
  created_at: string;
  lead_id: number;
  slot_id: number;
  leads: { name: string; phone: string } | null;
  services: { name: string } | null;
  slots: { starts_at: string; ends_at: string } | null;
};

const leadStatus: Record<string, string> = {
  new: "Novo",
  contacted: "Contatado",
  qualified: "Qualificado",
  scheduled: "Agendado",
  lost: "Perdido",
};

const timingLabel: Record<string, string> = {
  semana: "Esta semana",
  quinzena: "Próximas 2 semanas",
  pesquisando: "Pesquisando",
};

const bookingStatus: Record<string, string> = {
  pending: "Pendente",
  awaiting_payment: "Aguardando pagamento",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Concluído",
  no_show: "Não compareceu",
};

const weekdayOptions = [
  [1, "Segunda-feira"], [2, "Terça-feira"], [3, "Quarta-feira"],
  [4, "Quinta-feira"], [5, "Sexta-feira"], [6, "Sábado"], [0, "Domingo"],
] as const;

function formatMoney(cents: number | null) {
  if (cents === null) return "Não configurado";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function formatPriceInput(cents: number | null) {
  if (cents === null) return "";
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function parsePriceInput(value: string) {
  const sanitizedValue = value.replace(/[^\d,.-]/g, "").trim();
  if (!sanitizedValue) return null;

  const decimalParts = sanitizedValue.split(".");
  const normalizedValue = sanitizedValue.includes(",")
    ? sanitizedValue.replace(/\./g, "").replace(",", ".")
    : decimalParts.length === 2 && decimalParts[1].length <= 2
      ? sanitizedValue
      : sanitizedValue.replace(/\./g, "");
  const amount = Number(normalizedValue);

  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function AdminPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState(ADMIN_EMAIL);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [services, setServices] = useState<Service[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [servicePriceDrafts, setServicePriceDrafts] = useState<Record<number, string>>({});
  const [slotServiceId, setSlotServiceId] = useState("");
  const [slotStart, setSlotStart] = useState("");
  const [slotNotes, setSlotNotes] = useState("");
  const [recurringServiceId, setRecurringServiceId] = useState("");
  const [recurringWeekday, setRecurringWeekday] = useState("1");
  const [recurringTime, setRecurringTime] = useState("09:00");
  const [recurringWeeks, setRecurringWeeks] = useState("8");
  const [recurringSlotsPerDay, setRecurringSlotsPerDay] = useState("1");
  const [recurringInterval, setRecurringInterval] = useState("60");

  async function loadDashboard() {
    setLoading(true);
    const [serviceResult, leadResult, slotResult, settingsResult, bookingResult] = await Promise.all([
      supabase.from("services").select("*").order("id"),
      supabase.from("leads").select("id,name,phone,service_slug,timing,status,created_at").order("created_at", { ascending: false }).limit(100),
      supabase.from("slots").select("id,service_id,starts_at,ends_at,status,notes").gte("starts_at", new Date().toISOString()).order("starts_at").limit(100),
      supabase.from("clinic_settings").select("deposit_percent,reschedule_notice_hours,payment_provider,pix_enabled").eq("id", true).single(),
      supabase.from("bookings").select("id,status,created_at,lead_id,slot_id,leads(name,phone),services(name),slots(starts_at,ends_at)").order("created_at", { ascending: false }).limit(100),
    ]);

    const firstError = serviceResult.error || leadResult.error || slotResult.error || settingsResult.error || bookingResult.error;
    if (firstError) setMessage(`Não foi possível carregar o painel: ${firstError.message}`);
    const loadedServices = (serviceResult.data ?? []) as Service[];
    setServices(loadedServices);
    setServicePriceDrafts(Object.fromEntries(
      loadedServices.map((service) => [service.id, formatPriceInput(service.price_cents)]),
    ));
    setLeads((leadResult.data ?? []) as Lead[]);
    setSlots((slotResult.data ?? []) as Slot[]);
    setBookings((bookingResult.data ?? []) as unknown as Booking[]);
    setSettings(settingsResult.data as Settings | null);
    if (serviceResult.data?.[0]) {
      setSlotServiceId((current) => current || String(serviceResult.data[0].id));
      setRecurringServiceId((current) => current || String(serviceResult.data[0].id));
    }
    setLoading(false);
  }

  async function verifyAndLoad(userEmail: string) {
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_allowlist")
      .select("email, active")
      .eq("email", userEmail.toLowerCase())
      .eq("active", true)
      .maybeSingle();

    if (error || !data) {
      setAuthorized(false);
      setLoading(false);
      return;
    }
    setAuthorized(true);
    await loadDashboard();
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user.email) return;
    const userEmail = session.user.email;
    queueMicrotask(() => void verifyAndLoad(userEmail));
    // Supabase is a module singleton; this effect intentionally follows only the session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const normalizedEmail = email.trim().toLowerCase();

    if (normalizedEmail !== ADMIN_EMAIL) {
      setMessage("Este e-mail não está autorizado para administrar a clínica.");
      setBusy(false);
      return;
    }

    if (authMode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: { emailRedirectTo: `${getSiteUrl()}/admin` },
      });
      if (error) setMessage(error.message);
      else if (!data.session) setMessage("Cadastro iniciado. Confirme o e-mail recebido e depois entre no painel.");
      else setMessage("Acesso criado com sucesso.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: normalizedEmail, password });
      if (error) setMessage("E-mail ou senha inválidos, ou o e-mail ainda não foi confirmado.");
    }
    setBusy(false);
  }

  function updateServiceDuration(id: number, value: string) {
    setServices((current) => current.map((service) => service.id === id ? {
      ...service,
      duration_minutes: value === "" ? null : Number(value),
    } : service));
  }

  function updateServicePrice(id: number, value: string) {
    setServicePriceDrafts((current) => ({
      ...current,
      [id]: value.replace(/[^\d,.-]/g, ""),
    }));
  }

  function normalizeServicePrice(id: number) {
    setServicePriceDrafts((current) => {
      const priceCents = parsePriceInput(current[id] ?? "");
      return { ...current, [id]: formatPriceInput(priceCents) };
    });
  }

  async function saveService(service: Service) {
    setMessage("");
    const priceCents = parsePriceInput(servicePriceDrafts[service.id] ?? "");
    if (priceCents === null || priceCents <= 0 || !service.duration_minutes) {
      setMessage("Informe preço e duração antes de salvar.");
      return;
    }
    const { error } = await supabase.from("services").update({
      price_cents: priceCents,
      duration_minutes: service.duration_minutes,
    }).eq("id", service.id);
    if (error) {
      setMessage(`Erro ao salvar: ${error.message}`);
      return;
    }
    setServices((current) => current.map((item) => item.id === service.id ? { ...item, price_cents: priceCents } : item));
    setServicePriceDrafts((current) => ({ ...current, [service.id]: formatPriceInput(priceCents) }));
    setMessage(`${service.name} atualizado.`);
  }

  async function createSlot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const service = services.find((item) => item.id === Number(slotServiceId));
    if (!service?.duration_minutes) {
      setMessage("Configure a duração desse procedimento antes de abrir horários.");
      return;
    }
    const startsAt = new Date(slotStart);
    const endsAt = new Date(startsAt.getTime() + service.duration_minutes * 60_000);
    if (Number.isNaN(startsAt.getTime()) || startsAt <= new Date()) {
      setMessage("Escolha uma data e horário futuros.");
      return;
    }
    const { error } = await supabase.from("slots").insert({
      service_id: service.id,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      notes: slotNotes.trim(),
    });
    if (error) setMessage(`Erro ao criar horário: ${error.message}`);
    else {
      setMessage("Horário aberto com sucesso.");
      setSlotStart("");
      setSlotNotes("");
      await loadDashboard();
    }
  }

  async function toggleSlot(slot: Slot) {
    if (!["open", "blocked"].includes(slot.status)) return;
    const nextStatus = slot.status === "open" ? "blocked" : "open";
    const { error } = await supabase.from("slots").update({ status: nextStatus }).eq("id", slot.id);
    if (error) setMessage(`Erro ao alterar horário: ${error.message}`);
    else await loadDashboard();
  }

  async function createRecurringSlots(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const { data, error } = await supabase.rpc("create_recurring_slots", {
      p_service_id: Number(recurringServiceId),
      p_weekday: Number(recurringWeekday),
      p_start_time: recurringTime,
      p_weeks: Number(recurringWeeks),
      p_slots_per_day: Number(recurringSlotsPerDay),
      p_interval_minutes: Number(recurringInterval),
    });
    if (error) {
      setMessage(`Erro ao gerar agenda: ${error.message}`);
      return;
    }
    setMessage(`${data ?? 0} horário(s) criado(s). Datas repetidas foram ignoradas.`);
    await loadDashboard();
  }

  async function updateBookingStatus(id: number, status: string) {
    const { error } = await supabase.from("bookings").update({ status }).eq("id", id);
    if (error) {
      setMessage(`Erro ao atualizar agendamento: ${error.message}`);
      return;
    }
    setBookings((current) => current.map((booking) => booking.id === id ? { ...booking, status } : booking));
    setMessage(status === "cancelled" ? "Agendamento cancelado e horário reaberto." : "Agendamento atualizado.");
    await loadDashboard();
  }

  async function updateLeadStatus(id: number, status: string) {
    const { error } = await supabase.from("leads").update({ status }).eq("id", id);
    if (error) setMessage(`Erro ao atualizar lead: ${error.message}`);
    else setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, status } : lead));
  }

  const serviceNames = useMemo(() => Object.fromEntries(services.map((service) => [service.id, service.name])), [services]);
  const openSlots = slots.filter((slot) => slot.status === "open").length;
  const activeBookings = bookings.filter((booking) => ["pending", "awaiting_payment", "confirmed"].includes(booking.status)).length;
  const pendingServices = services.filter((service) => !service.price_cents || !service.duration_minutes).length;

  if (!session) {
    return (
      <main className="admin-login">
        <section className="login-card">
          <Link className="admin-wordmark" href="/"><img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética Avançada" /></Link>
          <p className="admin-eyebrow">Área restrita</p>
          <h1>{authMode === "login" ? "Entrar no painel" : "Criar primeiro acesso"}</h1>
          <p>Use o e-mail autorizado da clínica e uma senha segura.</p>
          <form onSubmit={handleAuth}>
            <label>E-mail<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" /></label>
            <label>Senha<input type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === "login" ? "current-password" : "new-password"} /></label>
            <button type="submit" disabled={busy}>{busy ? "Aguarde…" : authMode === "login" ? "Entrar" : "Criar acesso"}</button>
          </form>
          {message && <p className="admin-message" role="status">{message}</p>}
          <button className="mode-switch" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setMessage(""); }}>
            {authMode === "login" ? "Primeiro acesso? Criar senha" : "Já tem acesso? Entrar"}
          </button>
          <Link className="back-site" href="/">← Voltar ao site</Link>
        </section>
      </main>
    );
  }

  if (loading || authorized === null) return <main className="admin-loading">Carregando painel…</main>;

  if (!authorized) {
    return <main className="admin-loading"><p>Este usuário não está autorizado.</p><button onClick={() => supabase.auth.signOut()}>Sair</button></main>;
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div><p className="admin-eyebrow">PS Estética</p><h1>Painel da clínica</h1></div>
        <div className="admin-account"><span>{session.user.email}</span><button onClick={() => supabase.auth.signOut()}>Sair</button></div>
      </header>

      {message && <div className="admin-message banner" role="status">{message}<button onClick={() => setMessage("")}>×</button></div>}

      <section className="stats-grid" aria-label="Resumo">
        <article><span>Agendamentos ativos</span><b>{activeBookings}</b><small>pendentes e confirmados</small></article>
        <article><span>Horários abertos</span><b>{openSlots}</b><small>datas futuras</small></article>
        <article><span>Configuração</span><b>{pendingServices}</b><small>procedimentos pendentes</small></article>
        <article><span>Sinal</span><b>{settings?.deposit_percent ?? 10}%</b><small>remarcação até {settings?.reschedule_notice_hours ?? 48}h antes</small></article>
      </section>

      <section className="admin-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Configuração</p><h2>Procedimentos</h2></div><p>Preço e duração são definidos aqui e usados para calcular o futuro sinal de 10%.</p></div>
        <div className="service-editor">
          {services.map((service) => (
            <article key={service.id}>
              <div><h3>{service.name}</h3><span>{service.slug}</span></div>
              <label>
                Preço
                <span className="currency-input">
                  <span aria-hidden="true">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={servicePriceDrafts[service.id] ?? ""}
                    onChange={(event) => updateServicePrice(service.id, event.target.value)}
                    onBlur={() => normalizeServicePrice(service.id)}
                    aria-label={`Preço de ${service.name} em reais`}
                    placeholder="0,00"
                  />
                </span>
              </label>
              <label>Duração (min)<input type="number" min="5" max="720" step="5" value={service.duration_minutes ?? ""} onChange={(event) => updateServiceDuration(service.id, event.target.value)} placeholder="60" /></label>
              <button onClick={() => saveService(service)}>Salvar</button>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel split-panel">
        <div>
          <div className="panel-heading"><div><p className="admin-eyebrow">Agenda</p><h2>Abrir horário</h2></div></div>
          <form className="slot-form" onSubmit={createSlot}>
            <label>Procedimento<select required value={slotServiceId} onChange={(event) => setSlotServiceId(event.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name} · {formatMoney(service.price_cents)}</option>)}</select></label>
            <label>Início<input type="datetime-local" required value={slotStart} onChange={(event) => setSlotStart(event.target.value)} /></label>
            <label>Observação<input value={slotNotes} onChange={(event) => setSlotNotes(event.target.value)} placeholder="Opcional" /></label>
            <button type="submit">Abrir horário</button>
          </form>
        </div>
        <div>
          <div className="panel-heading"><div><p className="admin-eyebrow">Próximos</p><h2>Horários cadastrados</h2></div></div>
          <div className="slot-list">
            {slots.length === 0 && <p className="empty-state">Nenhum horário futuro cadastrado.</p>}
            {slots.map((slot) => <article key={slot.id}><div><b>{serviceNames[slot.service_id] ?? "Procedimento"}</b><span>{formatDate(slot.starts_at)}</span></div><button className={slot.status} disabled={!['open', 'blocked'].includes(slot.status)} onClick={() => toggleSlot(slot)}>{slot.status === "open" ? "Aberto" : slot.status === "reserved" ? "Reservado" : slot.status === "completed" ? "Concluído" : "Bloqueado"}</button></article>)}
          </div>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Automação</p><h2>Gerar horários recorrentes</h2></div><p>Cria a agenda semanal em lote e ignora automaticamente datas que já existem.</p></div>
        <form className="recurring-form" onSubmit={createRecurringSlots}>
          <label>Procedimento<select required value={recurringServiceId} onChange={(event) => setRecurringServiceId(event.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label>Dia da semana<select value={recurringWeekday} onChange={(event) => setRecurringWeekday(event.target.value)}>{weekdayOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Primeiro horário<input type="time" required value={recurringTime} onChange={(event) => setRecurringTime(event.target.value)} /></label>
          <label>Semanas à frente<input type="number" min="1" max="52" value={recurringWeeks} onChange={(event) => setRecurringWeeks(event.target.value)} /></label>
          <label>Horários por dia<input type="number" min="1" max="12" value={recurringSlotsPerDay} onChange={(event) => setRecurringSlotsPerDay(event.target.value)} /></label>
          <label>Intervalo (min)<input type="number" min="5" max="720" step="5" value={recurringInterval} onChange={(event) => setRecurringInterval(event.target.value)} /></label>
          <button type="submit">Gerar agenda</button>
        </form>
      </section>

      <section className="admin-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Agenda</p><h2>Agendamentos</h2></div><p>Reservas feitas no quiz aparecem aqui. Ao cancelar, o horário volta à agenda automaticamente.</p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Cliente</th><th>Procedimento</th><th>Data reservada</th><th>Status</th><th>Contato</th></tr></thead>
            <tbody>
              {bookings.length === 0 && <tr><td colSpan={5} className="empty-state">Ainda não há agendamentos.</td></tr>}
              {bookings.map((booking) => <tr key={booking.id}><td><b>{booking.leads?.name ?? "Cliente"}</b><small>{booking.leads?.phone ?? ""}</small></td><td>{booking.services?.name ?? "Procedimento"}</td><td>{booking.slots ? formatDate(booking.slots.starts_at) : "—"}</td><td><select value={booking.status} onChange={(event) => updateBookingStatus(booking.id, event.target.value)}>{Object.entries(bookingStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td>{booking.leads?.phone ? <a href={`https://wa.me/55${booking.leads.phone.replace(/^55/, "")}`} target="_blank" rel="noreferrer">WhatsApp ↗</a> : "—"}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">CRM</p><h2>Leads do quiz</h2></div><p>Os novos contatos aparecem automaticamente após o envio do diagnóstico.</p></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lead</th><th>Interesse</th><th>Prazo</th><th>Entrada</th><th>Status</th><th>Contato</th></tr></thead>
            <tbody>
              {leads.length === 0 && <tr><td colSpan={6} className="empty-state">Ainda não há leads cadastrados.</td></tr>}
              {leads.map((lead) => <tr key={lead.id}><td><b>{lead.name}</b><small>{lead.phone}</small></td><td>{services.find((service) => service.slug === lead.service_slug)?.name ?? lead.service_slug}</td><td>{timingLabel[lead.timing] ?? lead.timing}</td><td>{formatDate(lead.created_at)}</td><td><select value={lead.status} onChange={(event) => updateLeadStatus(lead.id, event.target.value)}>{Object.entries(leadStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td><a href={`https://wa.me/55${lead.phone.replace(/^55/, "")}`} target="_blank" rel="noreferrer">WhatsApp ↗</a></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="payment-note">
        <div><p className="admin-eyebrow">Próxima integração</p><h2>Pix automático</h2><p>Estrutura preparada para sinal de {settings?.deposit_percent ?? 10}% e regra de remarcação de {settings?.reschedule_notice_hours ?? 48} horas.</p></div>
        <span>{settings?.pix_enabled ? "Ativo" : "Aguardando escolha do provedor"}</span>
      </section>
    </main>
  );
}
