"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import "./admin.css";

function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelUrl = process.env.NEXT_PUBLIC_VERCEL_URL?.trim();
  const url = configuredUrl || vercelUrl || (typeof window !== "undefined" ? window.location.origin : "https://ps-estetica-sbc.vercel.app");
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
  experience?: string;
  source?: Record<string, string | null> | null;
  notes?: string | null;
};

type Slot = {
  id: number;
  service_id: number;
  professional_id: string | null;
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
  professional?: { full_name: string } | null;
  payments?: { status: string }[] | null;
};

type StaffProfile = { user_id: string; full_name: string; email: string; role: "receptionist" | "professional"; active: boolean };
type Assignment = { professional_id: string; service_id: number };
type BookingLink = { id: number; token: string; label: string; service_id: number | null; professional_id: string | null; active: boolean; uses: number; created_at: string };

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

const experienceLabel: Record<string, string> = {
  primeira: "Será a primeira vez",
  ja_fiz: "Já realizou o procedimento",
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
  const [email, setEmail] = useState("");
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
  const [leadSearch, setLeadSearch] = useState("");
  const [leadStatusFilter, setLeadStatusFilter] = useState("all");
  const [leadServiceFilter, setLeadServiceFilter] = useState("all");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [bookingLinks, setBookingLinks] = useState<BookingLink[]>([]);
  const [slotProfessionalId, setSlotProfessionalId] = useState("");
  const [recurringProfessionalId, setRecurringProfessionalId] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteServiceId, setInviteServiceId] = useState("");
  const [linkLabel, setLinkLabel] = useState("Agenda direta");
  const [linkServiceId, setLinkServiceId] = useState("");
  const [linkProfessionalId, setLinkProfessionalId] = useState("");

  async function loadDashboard() {
    setLoading(true);
    const [serviceResult, leadResult, slotResult, settingsResult, bookingResult, staffResult, assignmentResult, linkResult] = await Promise.all([
      supabase.from("services").select("*").order("id"),
      supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(250),
      supabase.from("slots").select("id,service_id,professional_id,starts_at,ends_at,status,notes").gte("starts_at", new Date().toISOString()).order("starts_at").limit(100),
      supabase.from("clinic_settings").select("deposit_percent,reschedule_notice_hours,payment_provider,pix_enabled").eq("id", true).single(),
      supabase.from("bookings").select("id,status,created_at,lead_id,slot_id,leads(name,phone),services(name),slots(starts_at,ends_at),professional:staff_profiles!bookings_professional_id_fkey(full_name),payments(status)").order("created_at", { ascending: false }).limit(100),
      supabase.from("staff_profiles").select("user_id,full_name,email,role,active").order("full_name"),
      supabase.from("professional_services").select("professional_id,service_id").eq("active", true),
      supabase.from("booking_links").select("id,token,label,service_id,professional_id,active,uses,created_at").order("created_at", { ascending: false }).limit(50),
    ]);

    const firstError = serviceResult.error || leadResult.error || slotResult.error || settingsResult.error || bookingResult.error || staffResult.error || assignmentResult.error || linkResult.error;
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
    setStaff((staffResult.data ?? []) as StaffProfile[]);
    setAssignments((assignmentResult.data ?? []) as Assignment[]);
    setBookingLinks((linkResult.data ?? []) as BookingLink[]);
    if (serviceResult.data?.[0]) {
      setSlotServiceId((current) => current || String(serviceResult.data[0].id));
      setRecurringServiceId((current) => current || String(serviceResult.data[0].id));
      setInviteServiceId((current) => current || String(serviceResult.data[0].id));
      setLinkServiceId((current) => current || String(serviceResult.data[0].id));
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
      professional_id: slotProfessionalId || null,
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
      p_professional_id: recurringProfessionalId || null,
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

  async function inviteProfessional(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const { error } = await supabase.from("staff_invites").upsert({
      email: inviteEmail.trim().toLowerCase(), full_name: inviteName.trim(), role: "professional",
      service_id: Number(inviteServiceId), invited_by: session?.user.id, active: true,
    }, { onConflict: "email" });
    if (error) setMessage(`Erro ao autorizar profissional: ${error.message}`);
    else { setMessage("Profissional autorizado. Envie o acesso /profissional para que crie a senha."); setInviteName(""); setInviteEmail(""); }
  }

  async function createBookingLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const { data, error } = await supabase.from("booking_links").insert({
      label: linkLabel.trim() || "Agenda direta", service_id: linkServiceId ? Number(linkServiceId) : null,
      professional_id: linkProfessionalId || null, created_by: session?.user.id,
    }).select("id,token,label,service_id,professional_id,active,uses,created_at").single();
    if (error) setMessage(`Erro ao criar link: ${error.message}`);
    else if (data) { setBookingLinks((current) => [data as BookingLink, ...current]); setMessage("Link de agenda criado e pronto para envio."); }
  }

  async function copyScheduleLink(token?: string) {
    const url = token ? `${getSiteUrl()}/agendar?convite=${token}` : `${getSiteUrl()}/agendar`;
    await navigator.clipboard.writeText(url); setMessage("Link da agenda copiado.");
  }

  const serviceNames = useMemo(() => Object.fromEntries(services.map((service) => [service.id, service.name])), [services]);
  const professionals = staff.filter((member) => member.role === "professional" && member.active);
  const professionalsFor = (serviceId: string) => professionals.filter((professional) => assignments.some((assignment) => assignment.professional_id === professional.user_id && assignment.service_id === Number(serviceId)));
  const professionalNames = Object.fromEntries(professionals.map((professional) => [professional.user_id, professional.full_name]));
  const openSlots = slots.filter((slot) => slot.status === "open").length;
  const activeBookings = bookings.filter((booking) => ["pending", "awaiting_payment", "confirmed"].includes(booking.status)).length;
  const newLeads = leads.filter((lead) => lead.status === "new").length;
  const filteredLeads = leads.filter((lead) => {
    const query = leadSearch.trim().toLowerCase();
    const matchesQuery = !query || lead.name.toLowerCase().includes(query) || lead.phone.includes(query.replace(/\D/g, ""));
    return matchesQuery && (leadStatusFilter === "all" || lead.status === leadStatusFilter) && (leadServiceFilter === "all" || lead.service_slug === leadServiceFilter);
  });

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
        <div className="admin-header-brand">
          <Link className="admin-header-logo" href="/" aria-label="Voltar ao site da PS Estética"><img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética Avançada" /></Link>
          <div><p className="admin-eyebrow">Gestão PS Estética</p><h1>Painel da clínica</h1></div>
        </div>
        <div className="admin-account"><span>{session.user.email}</span><button onClick={() => supabase.auth.signOut()}>Sair</button></div>
      </header>

      {message && <div className="admin-message banner" role="status">{message}<button onClick={() => setMessage("")}>×</button></div>}

      <section className="stats-grid" aria-label="Resumo">
        <article><span>Agendamentos ativos</span><b>{activeBookings}</b><small>pendentes e confirmados</small></article>
        <article><span>Horários abertos</span><b>{openSlots}</b><small>datas futuras</small></article>
        <article><span>Leads novos</span><b>{newLeads}</b><small>aguardando primeiro contato</small></article>
        <article><span>Sinal</span><b>{settings?.deposit_percent ?? 10}%</b><small>remarcação até {settings?.reschedule_notice_hours ?? 48}h antes</small></article>
      </section>

      <section className="admin-panel team-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Equipe e permissões</p><h2>Agendas por profissional</h2></div><p>Cada profissional cria a própria senha e visualiza somente a modalidade atribuída. A recepção continua com controle master.</p></div>
        <div className="team-layout">
          <form className="slot-form" onSubmit={inviteProfessional}>
            <label>Nome do profissional<input required minLength={2} value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Nome completo" /></label>
            <label>E-mail de acesso<input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="profissional@email.com" /></label>
            <label>Modalidade<select required value={inviteServiceId} onChange={(event) => setInviteServiceId(event.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
            <button>Autorizar profissional</button>
            <small className="form-help">Depois, envie: <b>{getSiteUrl()}/profissional</b></small>
          </form>
          <div className="staff-list">
            {professionals.length === 0 && <p className="empty-state">Nenhum profissional cadastrado ainda.</p>}
            {professionals.map((professional) => <article key={professional.user_id}><span className="staff-avatar">{professional.full_name.slice(0,1)}</span><div><b>{professional.full_name}</b><small>{assignments.filter((item) => item.professional_id === professional.user_id).map((item) => serviceNames[item.service_id]).join(" · ") || "Sem modalidade"}</small></div><span className="staff-active">Ativo</span></article>)}
          </div>
        </div>
      </section>

      <section className="admin-panel direct-links-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Agendamento sem quiz</p><h2>Links diretos da agenda</h2></div><button className="copy-master" onClick={() => copyScheduleLink()}>Copiar agenda geral</button></div>
        <form className="link-form" onSubmit={createBookingLink}>
          <label>Identificação<input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="Ex.: Agenda Laser da Ana" /></label>
          <label>Modalidade<select value={linkServiceId} onChange={(event) => { setLinkServiceId(event.target.value); setLinkProfessionalId(""); }}><option value="">Todas</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label>Profissional<select value={linkProfessionalId} onChange={(event) => setLinkProfessionalId(event.target.value)}><option value="">Qualquer profissional</option>{professionalsFor(linkServiceId).map((professional) => <option key={professional.user_id} value={professional.user_id}>{professional.full_name}</option>)}</select></label>
          <button>Criar link</button>
        </form>
        <div className="link-list">{bookingLinks.map((link) => <article key={link.id}><div><b>{link.label}</b><small>{link.service_id ? serviceNames[link.service_id] : "Todas as modalidades"}{link.professional_id ? ` · ${professionalNames[link.professional_id]}` : ""} · {link.uses} uso(s)</small></div><button onClick={() => copyScheduleLink(link.token)}>Copiar link</button></article>)}</div>
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
            <label>Procedimento<select required value={slotServiceId} onChange={(event) => { setSlotServiceId(event.target.value); setSlotProfessionalId(""); }}>{services.map((service) => <option key={service.id} value={service.id}>{service.name} · {formatMoney(service.price_cents)}</option>)}</select></label>
            <label>Profissional<select value={slotProfessionalId} onChange={(event) => setSlotProfessionalId(event.target.value)}><option value="">Equipe / ainda não atribuído</option>{professionalsFor(slotServiceId).map((professional) => <option key={professional.user_id} value={professional.user_id}>{professional.full_name}</option>)}</select></label>
            <label>Início<input type="datetime-local" required value={slotStart} onChange={(event) => setSlotStart(event.target.value)} /></label>
            <label>Observação<input value={slotNotes} onChange={(event) => setSlotNotes(event.target.value)} placeholder="Opcional" /></label>
            <button type="submit">Abrir horário</button>
          </form>
        </div>
        <div>
          <div className="panel-heading"><div><p className="admin-eyebrow">Próximos</p><h2>Horários cadastrados</h2></div></div>
          <div className="slot-list">
            {slots.length === 0 && <p className="empty-state">Nenhum horário futuro cadastrado.</p>}
            {slots.map((slot) => <article key={slot.id}><div><b>{serviceNames[slot.service_id] ?? "Procedimento"}</b><span>{professionalNames[slot.professional_id ?? ""] ?? "Equipe PS"} · {formatDate(slot.starts_at)}</span></div><button className={slot.status} disabled={!['open', 'blocked'].includes(slot.status)} onClick={() => toggleSlot(slot)}>{slot.status === "open" ? "Aberto" : slot.status === "reserved" ? "Reservado" : slot.status === "completed" ? "Concluído" : "Bloqueado"}</button></article>)}
          </div>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Automação</p><h2>Gerar horários recorrentes</h2></div><p>Cria a agenda semanal em lote e ignora automaticamente datas que já existem.</p></div>
        <form className="recurring-form" onSubmit={createRecurringSlots}>
          <label>Procedimento<select required value={recurringServiceId} onChange={(event) => { setRecurringServiceId(event.target.value); setRecurringProfessionalId(""); }}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label>Profissional<select value={recurringProfessionalId} onChange={(event) => setRecurringProfessionalId(event.target.value)}><option value="">Equipe</option>{professionalsFor(recurringServiceId).map((professional) => <option key={professional.user_id} value={professional.user_id}>{professional.full_name}</option>)}</select></label>
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
            <thead><tr><th>Cliente</th><th>Procedimento</th><th>Profissional</th><th>Data reservada</th><th>Pagamento</th><th>Status</th><th>Contato</th></tr></thead>
            <tbody>
              {bookings.length === 0 && <tr><td colSpan={7} className="empty-state">Ainda não há agendamentos.</td></tr>}
              {bookings.map((booking) => <tr key={booking.id}><td><b>{booking.leads?.name ?? "Cliente"}</b><small>{booking.leads?.phone ?? ""}</small></td><td>{booking.services?.name ?? "Procedimento"}</td><td>{booking.professional?.full_name ?? "Equipe"}</td><td>{booking.slots ? formatDate(booking.slots.starts_at) : "—"}</td><td><span className={`payment-status ${booking.payments?.[0]?.status ?? "pending"}`}>{booking.payments?.[0]?.status === "paid" ? "Pago" : booking.status === "awaiting_payment" ? "Aguardando Pix" : "—"}</span></td><td><select value={booking.status} onChange={(event) => updateBookingStatus(booking.id, event.target.value)}>{Object.entries(bookingStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td>{booking.leads?.phone ? <a href={`https://wa.me/55${booking.leads.phone.replace(/^55/, "")}`} target="_blank" rel="noreferrer">WhatsApp ↗</a> : "—"}</td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">CRM</p><h2>Leads do quiz</h2></div><p>Os novos contatos aparecem automaticamente após o envio do diagnóstico.</p></div>
        <div className="crm-toolbar">
          <label className="crm-search">Buscar lead<input value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Nome ou WhatsApp" /></label>
          <label>Status<select value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value)}><option value="all">Todos os status</option>{Object.entries(leadStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Procedimento<select value={leadServiceFilter} onChange={(event) => setLeadServiceFilter(event.target.value)}><option value="all">Todos</option>{services.map((service) => <option key={service.slug} value={service.slug}>{service.name}</option>)}</select></label>
          <span className="crm-total">{filteredLeads.length} contato(s)</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Lead</th><th>Interesse</th><th>Prazo</th><th>Entrada</th><th>Status</th><th>Contato</th></tr></thead>
            <tbody>
              {filteredLeads.length === 0 && <tr><td colSpan={6} className="empty-state">Nenhum lead corresponde aos filtros.</td></tr>}
              {filteredLeads.map((lead) => <tr key={lead.id}><td><button className="lead-open" onClick={() => setSelectedLead(lead)}><b>{lead.name}</b><small>{lead.phone}</small></button></td><td>{services.find((service) => service.slug === lead.service_slug)?.name ?? lead.service_slug}</td><td>{timingLabel[lead.timing] ?? lead.timing}</td><td>{formatDate(lead.created_at)}</td><td><select value={lead.status} onChange={(event) => updateLeadStatus(lead.id, event.target.value)}>{Object.entries(leadStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td><td><a href={`https://wa.me/55${lead.phone.replace(/^55/, "")}`} target="_blank" rel="noreferrer">WhatsApp ↗</a></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="payment-note">
        <div><p className="admin-eyebrow">Pagamento integrado</p><h2>Pix automático</h2><p>Após escolher o horário, o sistema gera o Pix de {settings?.deposit_percent ?? 10}%, confirma pelo webhook e libera vagas expiradas sem ação da recepção.</p></div>
        <span>{settings?.pix_enabled ? "Mercado Pago ativo" : "Pronto para credenciais"}</span>
      </section>

      {selectedLead && <div className="drawer-backdrop" onClick={() => setSelectedLead(null)} role="presentation">
        <aside className="lead-drawer" onClick={(event) => event.stopPropagation()} aria-label={`Perfil de ${selectedLead.name}`}>
          <button className="drawer-close" onClick={() => setSelectedLead(null)} aria-label="Fechar">×</button>
          <p className="admin-eyebrow">Perfil da cliente</p><h2>{selectedLead.name}</h2>
          <a className="drawer-whatsapp" href={`https://wa.me/55${selectedLead.phone.replace(/^55/, "")}`} target="_blank" rel="noreferrer">Conversar no WhatsApp ↗</a>
          <dl><div><dt>Telefone</dt><dd>{selectedLead.phone}</dd></div><div><dt>Procedimento</dt><dd>{services.find((service) => service.slug === selectedLead.service_slug)?.name ?? selectedLead.service_slug}</dd></div><div><dt>Experiência</dt><dd>{selectedLead.experience ? (experienceLabel[selectedLead.experience] ?? selectedLead.experience) : "Não informada"}</dd></div><div><dt>Prazo</dt><dd>{timingLabel[selectedLead.timing] ?? selectedLead.timing}</dd></div><div><dt>Entrada</dt><dd>{formatDate(selectedLead.created_at)}</dd></div><div><dt>Status</dt><dd>{leadStatus[selectedLead.status] ?? selectedLead.status}</dd></div></dl>
          <div className="source-card"><b>Origem da campanha</b><p>{selectedLead.source?.utm_source || "Acesso direto"}{selectedLead.source?.utm_campaign ? ` · ${selectedLead.source.utm_campaign}` : ""}</p><small>{selectedLead.source?.referrer || "Sem referência externa registrada"}</small></div>
          <div className="drawer-note"><b>Observações</b><p>{selectedLead.notes || "Nenhuma observação registrada para esta cliente."}</p></div>
        </aside>
      </div>}
    </main>
  );
}
