"use client";

import { Fragment, FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { AGENDA_URL, PANEL_URL, PROFESSIONAL_URL, QUIZ_URL } from "../../lib/public-urls";
import { RevenueDashboard } from "./revenue-dashboard";
import "./admin.css";

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
  archived_at?: string | null;
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
  min_deposit_cents: number;
  max_deposit_cents: number;
  reservation_expiry_minutes: number;
  reschedule_notice_hours: number;
  whatsapp: string;
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

type StaffProfile = { user_id: string; full_name: string; email: string; role: "receptionist" | "professional"; active: boolean; is_master: boolean };
type StaffInvite = { email: string; full_name: string; role: "receptionist" | "professional"; service_id: number | null; active: boolean; created_at: string };
type StaffAccessRequest = { id: number; user_id: string; email: string; full_name: string; status: "pending" | "approved" | "rejected"; created_at: string };
type Assignment = { professional_id: string; service_id: number };
type BookingLink = { id: number; token: string; label: string; service_id: number | null; professional_id: string | null; active: boolean; uses: number; created_at: string };
type AdminSection = "overview" | "clients" | "agenda" | "revenue" | "team" | "access" | "services" | "links" | "settings";
type LeadQueue = "conversion" | "prebooking" | "confirmed" | "expired" | "archived";

const adminSections: { id: AdminSection; label: string; description: string; group: "Operação" | "Gestão" }[] = [
  { id: "overview", label: "Início", description: "Resumo da operação e prioridades", group: "Operação" },
  { id: "clients", label: "Atendimento", description: "Conversão, pré-agendamentos e clientes", group: "Operação" },
  { id: "agenda", label: "Agenda", description: "Horários e atendimentos confirmados", group: "Operação" },
  { id: "revenue", label: "Faturamento", description: "Recebimentos, saldos e indicadores", group: "Operação" },
  { id: "team", label: "Equipe", description: "Profissionais, acessos e modalidades", group: "Gestão" },
  { id: "access", label: "Acessos", description: "Aprovação e bloqueio de recepcionistas", group: "Gestão" },
  { id: "services", label: "Catálogo", description: "Procedimentos, preços e duração", group: "Gestão" },
  { id: "links", label: "Links", description: "Agendas diretas e compartilhamento", group: "Gestão" },
  { id: "settings", label: "Configurações", description: "Pagamento e regras da clínica", group: "Gestão" },
];

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

const leadQueueLabel: Record<LeadQueue, string> = {
  conversion: "Para converter",
  prebooking: "Pré-agendado",
  confirmed: "Agendado",
  expired: "Expirado",
  archived: "Arquivado",
};

const leadQueueDescription: Record<LeadQueue, string> = {
  conversion: "Sem reserva ativa",
  prebooking: "Aguardando o sinal",
  confirmed: "Pagamento confirmado",
  expired: "Recuperar pelo WhatsApp",
  archived: "Fora da operação",
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

function slugify(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export default function AdminPage() {
  const [activeSection, setActiveSection] = useState<AdminSection>("overview");
  const [session, setSession] = useState<Session | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [isMaster, setIsMaster] = useState(false);
  const [accessRequestStatus, setAccessRequestStatus] = useState<"pending" | "approved" | "rejected" | null>(null);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [signupName, setSignupName] = useState("");
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
  const [leadQueue, setLeadQueue] = useState<LeadQueue>("conversion");
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [invites, setInvites] = useState<StaffInvite[]>([]);
  const [accessRequests, setAccessRequests] = useState<StaffAccessRequest[]>([]);
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
  const [newServiceName, setNewServiceName] = useState("");
  const [newServiceDescription, setNewServiceDescription] = useState("");
  const [newServicePrice, setNewServicePrice] = useState("");
  const [newServiceDuration, setNewServiceDuration] = useState("60");

  async function loadDashboard() {
    setLoading(true);
    const [serviceResult, leadResult, slotResult, settingsResult, bookingResult, staffResult, inviteResult, assignmentResult, linkResult, accessResult] = await Promise.all([
      supabase.from("services").select("*").order("id"),
      supabase.from("leads").select("*").order("created_at", { ascending: false }).limit(250),
      supabase.from("slots").select("id,service_id,professional_id,starts_at,ends_at,status,notes").gte("starts_at", new Date().toISOString()).order("starts_at").limit(100),
      supabase.from("clinic_settings").select("deposit_percent,min_deposit_cents,max_deposit_cents,reservation_expiry_minutes,reschedule_notice_hours,whatsapp,payment_provider,pix_enabled").eq("id", true).single(),
      supabase.from("bookings").select("id,status,created_at,lead_id,slot_id,leads(name,phone),services(name),slots(starts_at,ends_at),professional:staff_profiles!bookings_professional_id_fkey(full_name),payments(status)").order("created_at", { ascending: false }).limit(250),
      supabase.from("staff_profiles").select("user_id,full_name,email,role,active,is_master").order("full_name"),
      supabase.from("staff_invites").select("email,full_name,role,service_id,active,created_at").order("created_at", { ascending: false }),
      supabase.from("professional_services").select("professional_id,service_id").eq("active", true),
      supabase.from("booking_links").select("id,token,label,service_id,professional_id,active,uses,created_at").order("created_at", { ascending: false }).limit(50),
      supabase.from("staff_access_requests").select("id,user_id,email,full_name,status,created_at").order("created_at", { ascending: false }),
    ]);

    const firstError = serviceResult.error || leadResult.error || slotResult.error || settingsResult.error || bookingResult.error || staffResult.error || inviteResult.error || assignmentResult.error || linkResult.error || accessResult.error;
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
    setInvites((inviteResult.data ?? []) as StaffInvite[]);
    setAccessRequests((accessResult.data ?? []) as StaffAccessRequest[]);
    setAssignments((assignmentResult.data ?? []) as Assignment[]);
    setBookingLinks((linkResult.data ?? []) as BookingLink[]);
    const firstActiveService = loadedServices.find((service) => service.active);
    if (firstActiveService) {
      setSlotServiceId((current) => current || String(firstActiveService.id));
      setRecurringServiceId((current) => current || String(firstActiveService.id));
      setInviteServiceId((current) => current || String(firstActiveService.id));
      setLinkServiceId((current) => current || String(firstActiveService.id));
    }
    setLoading(false);
  }

  async function verifyAndLoad() {
    setLoading(true);
    const userId = (await supabase.auth.getUser()).data.user?.id ?? "";
    const { data: profile } = await supabase
      .from("staff_profiles")
      .select("user_id,role,active,is_master")
      .eq("user_id", userId)
      .maybeSingle();

    if (!profile?.active || profile.role !== "receptionist") {
      const { data: request } = await supabase
        .from("staff_access_requests")
        .select("status")
        .eq("user_id", userId)
        .maybeSingle();
      setAccessRequestStatus((request?.status as "pending" | "approved" | "rejected" | undefined) ?? null);
      setIsMaster(false);
      setAuthorized(false);
      setLoading(false);
      return;
    }
    setAccessRequestStatus(null);
    setIsMaster(Boolean(profile.is_master));
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
    queueMicrotask(() => void verifyAndLoad());
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
        options: { emailRedirectTo: PANEL_URL, data: { full_name: signupName.trim() } },
      });
      if (error) setMessage(error.message);
      else if (!data.session) setMessage("Cadastro recebido. Confirme o e-mail; depois a conta ficará aguardando aprovação do master.");
      else setMessage("Cadastro recebido e aguardando aprovação do master.");
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

  function updateServiceText(id: number, field: "name" | "description", value: string) {
    setServices((current) => current.map((service) => service.id === id ? { ...service, [field]: value } : service));
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
      name: service.name.trim(),
      description: service.description.trim(),
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

  async function createService(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const priceCents = parsePriceInput(newServicePrice);
    const duration = Number(newServiceDuration);
    const name = newServiceName.trim();
    if (name.length < 2 || !priceCents || priceCents <= 0 || !duration || duration < 5) {
      setMessage("Informe nome, preço e duração válidos para criar o procedimento.");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("services").insert({
      name,
      slug: slugify(name),
      description: newServiceDescription.trim(),
      price_cents: priceCents,
      duration_minutes: duration,
      deposit_percent: settings?.deposit_percent ?? 10,
      active: true,
    });
    setBusy(false);
    if (error) {
      setMessage(error.code === "23505" ? "Já existe um procedimento com esse nome." : `Erro ao criar procedimento: ${error.message}`);
      return;
    }
    setNewServiceName(""); setNewServiceDescription(""); setNewServicePrice(""); setNewServiceDuration("60");
    setMessage("Procedimento criado e disponível nas agendas.");
    await loadDashboard();
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings || busy) return;
    const whatsapp = settings.whatsapp.replace(/\D/g, "");
    if (settings.deposit_percent < 1 || settings.deposit_percent > 100) return setMessage("O sinal padrão deve ficar entre 1% e 100%.");
    if (settings.min_deposit_cents < 0) return setMessage("O valor mínimo do sinal não pode ser negativo.");
    if (settings.max_deposit_cents < settings.min_deposit_cents) return setMessage("O valor máximo do sinal deve ser maior ou igual ao mínimo.");
    if (settings.reservation_expiry_minutes < 5 || settings.reservation_expiry_minutes > 1440) return setMessage("A reserva deve expirar entre 5 minutos e 24 horas.");
    if (settings.reschedule_notice_hours < 0 || settings.reschedule_notice_hours > 720) return setMessage("O prazo de remarcação deve ficar entre 0 e 720 horas.");
    if (!/^\d{10,13}$/.test(whatsapp)) return setMessage("Informe o WhatsApp da clínica com DDD e somente números.");
    setBusy(true);
    const { error } = await supabase.from("clinic_settings").update({
      deposit_percent: settings.deposit_percent,
      min_deposit_cents: settings.min_deposit_cents,
      max_deposit_cents: settings.max_deposit_cents,
      reservation_expiry_minutes: settings.reservation_expiry_minutes,
      reschedule_notice_hours: settings.reschedule_notice_hours,
      whatsapp,
      updated_at: new Date().toISOString(),
    }).eq("id", true);
    setBusy(false);
    if (error) setMessage(`Não foi possível salvar as configurações: ${error.message}`);
    else { setSettings({ ...settings, whatsapp }); setMessage("Configurações salvas e aplicadas aos próximos agendamentos."); }
  }

  async function removeService(service: Service) {
    if (!window.confirm(`Remover ${service.name}? Se já houver histórico, ele será arquivado para preservar os agendamentos.`)) return;
    setMessage("");
    const { error } = await supabase.from("services").delete().eq("id", service.id);
    if (!error) {
      setMessage(`${service.name} excluído.`);
      await loadDashboard();
      return;
    }
    const { error: archiveError } = await supabase.from("services").update({ active: false }).eq("id", service.id);
    if (archiveError) setMessage(`Não foi possível remover: ${archiveError.message}`);
    else {
      setMessage(`${service.name} possui histórico e foi arquivado. Ele não aparece mais para clientes.`);
      await loadDashboard();
    }
  }

  async function restoreService(service: Service) {
    const { error } = await supabase.from("services").update({ active: true }).eq("id", service.id);
    if (error) setMessage(`Não foi possível restaurar: ${error.message}`);
    else { setMessage(`${service.name} restaurado.`); await loadDashboard(); }
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

  async function deleteSlot(slot: Slot) {
    if (!['open', 'blocked'].includes(slot.status) || !window.confirm("Excluir este horário da agenda?")) return;
    const { error } = await supabase.from("slots").delete().eq("id", slot.id);
    if (error) setMessage(`Erro ao excluir horário: ${error.message}`);
    else { setMessage("Horário excluído."); await loadDashboard(); }
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
    else {
      setLeads((current) => current.map((lead) => lead.id === id ? { ...lead, status } : lead));
      setSelectedLead((current) => current?.id === id ? { ...current, status } : current);
    }
  }

  async function archiveLead(lead: Lead) {
    if (!window.confirm(`Arquivar ${lead.name}? O histórico será preservado e poderá ser restaurado.`)) return;
    const archivedAt = new Date().toISOString();
    const { error } = await supabase.from("leads").update({ archived_at: archivedAt }).eq("id", lead.id);
    if (error) setMessage(`Não foi possível arquivar: ${error.message}`);
    else { setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, archived_at: archivedAt } : item)); setSelectedLead(null); setMessage(`${lead.name} foi arquivado.`); }
  }

  async function restoreLead(lead: Lead) {
    const { error } = await supabase.from("leads").update({ archived_at: null }).eq("id", lead.id);
    if (error) setMessage(`Não foi possível restaurar: ${error.message}`);
    else { setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, archived_at: null } : item)); setSelectedLead(null); setMessage(`${lead.name} voltou para a lista de leads ativos.`); }
  }

  async function permanentlyDeleteLead(lead: Lead) {
    const confirmation = window.prompt(`Esta ação não pode ser desfeita. Digite EXCLUIR para apagar permanentemente ${lead.name}.`);
    if (confirmation !== "EXCLUIR") { if (confirmation !== null) setMessage("Exclusão cancelada: digite exatamente EXCLUIR."); return; }
    const { error } = await supabase.rpc("permanently_delete_lead", { p_lead_id: lead.id });
    if (error) { setMessage(error.message.includes("agendamentos") ? "Este lead possui agendamentos e deve permanecer arquivado para preservar o histórico." : `Não foi possível excluir: ${error.message}`); return; }
    setLeads((current) => current.filter((item) => item.id !== lead.id)); setSelectedLead(null); setMessage(`${lead.name} foi excluído permanentemente.`);
  }

  async function inviteProfessional(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    const { error } = await supabase.from("staff_invites").upsert({
      email: inviteEmail.trim().toLowerCase(), full_name: inviteName.trim(), role: "professional",
      service_id: Number(inviteServiceId), invited_by: session?.user.id, active: true,
    }, { onConflict: "email" });
    setBusy(false);
    if (error) setMessage(`Erro ao autorizar profissional: ${error.message}`);
    else {
      setMessage("Autorização criada. O profissional ficará pendente até criar a própria senha.");
      setInviteName(""); setInviteEmail("");
      await loadDashboard();
    }
  }

  async function copyProfessionalAccess(invite: StaffInvite) {
    const url = `${PROFESSIONAL_URL}?email=${encodeURIComponent(invite.email)}&primeiro=1`;
    await navigator.clipboard.writeText(url);
    setMessage(`Link de primeiro acesso de ${invite.full_name} copiado.`);
  }

  async function cancelInvite(invite: StaffInvite) {
    if (!window.confirm(`Cancelar o acesso pendente de ${invite.full_name}?`)) return;
    const { error } = await supabase.from("staff_invites").update({ active: false }).eq("email", invite.email);
    if (error) setMessage(`Erro ao cancelar convite: ${error.message}`);
    else { setMessage("Autorização pendente cancelada."); await loadDashboard(); }
  }

  async function toggleProfessionalActive(professional: StaffProfile) {
    const nextActive = !professional.active;
    if (!nextActive && !window.confirm(`Desativar ${professional.full_name}? A agenda existente será preservada, mas o acesso e novos vínculos ficarão indisponíveis.`)) return;
    const { error } = await supabase.from("staff_profiles").update({ active: nextActive }).eq("user_id", professional.user_id);
    if (error) setMessage(`Erro ao alterar profissional: ${error.message}`);
    else { setMessage(nextActive ? "Profissional reativado." : "Profissional desativado."); await loadDashboard(); }
  }

  async function reviewAccessRequest(request: StaffAccessRequest, approve: boolean) {
    if (busy) return;
    if (!approve && !window.confirm(`Recusar o acesso de ${request.full_name}?`)) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.rpc("review_staff_access_request", { p_request_id: request.id, p_approve: approve });
    setBusy(false);
    if (error) setMessage(`Não foi possível ${approve ? "aprovar" : "recusar"}: ${error.message}`);
    else { setMessage(approve ? `${request.full_name} foi autorizada como recepcionista.` : `Solicitação de ${request.full_name} recusada.`); await loadDashboard(); }
  }

  async function toggleReceptionistActive(receptionist: StaffProfile) {
    if (!isMaster || receptionist.is_master || busy) return;
    const nextActive = !receptionist.active;
    if (!nextActive && !window.confirm(`Bloquear o acesso de ${receptionist.full_name}?`)) return;
    setBusy(true); setMessage("");
    const { error } = await supabase.from("staff_profiles").update({ active: nextActive }).eq("user_id", receptionist.user_id).eq("is_master", false);
    setBusy(false);
    if (error) setMessage(`Não foi possível alterar o acesso: ${error.message}`);
    else { setMessage(nextActive ? `${receptionist.full_name} foi reativada.` : `${receptionist.full_name} foi bloqueada.`); await loadDashboard(); }
  }

  async function toggleProfessionalService(professional: StaffProfile, service: Service) {
    const assigned = assignments.some((item) => item.professional_id === professional.user_id && item.service_id === service.id);
    if (assigned) {
      const hasFutureSlots = slots.some((slot) => slot.professional_id === professional.user_id && slot.service_id === service.id && slot.status !== "completed");
      if (hasFutureSlots) {
        setMessage(`Remova ou conclua os horários futuros de ${service.name} antes de retirar essa modalidade.`);
        return;
      }
      const { error } = await supabase.from("professional_services").delete().eq("professional_id", professional.user_id).eq("service_id", service.id);
      if (error) setMessage(`Erro ao retirar modalidade: ${error.message}`);
      else { setMessage(`${service.name} removido da agenda de ${professional.full_name}.`); await loadDashboard(); }
      return;
    }
    const { error } = await supabase.from("professional_services").upsert({ professional_id: professional.user_id, service_id: service.id, active: true });
    if (error) setMessage(`Erro ao atribuir modalidade: ${error.message}`);
    else { setMessage(`${service.name} adicionado à agenda de ${professional.full_name}.`); await loadDashboard(); }
  }

  async function createBookingLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage(""); setBusy(true);
    const { data, error } = await supabase.from("booking_links").insert({
      label: linkLabel.trim() || "Agenda direta", service_id: linkServiceId ? Number(linkServiceId) : null,
      professional_id: linkProfessionalId || null, created_by: session?.user.id,
    }).select("id,token,label,service_id,professional_id,active,uses,created_at").single();
    setBusy(false);
    if (error) setMessage(`Erro ao criar link: ${error.message}`);
    else if (data) { setBookingLinks((current) => [data as BookingLink, ...current]); setMessage("Link de agenda criado e pronto para envio."); }
  }

  async function toggleBookingLink(link: BookingLink) {
    const { error } = await supabase.from("booking_links").update({ active: !link.active }).eq("id", link.id);
    if (error) setMessage(`Erro ao alterar link: ${error.message}`);
    else { setMessage(link.active ? "Link desativado." : "Link reativado."); await loadDashboard(); }
  }

  async function copyScheduleLink(token?: string) {
    const url = token ? `${AGENDA_URL}?convite=${token}` : AGENDA_URL;
    await navigator.clipboard.writeText(url); setMessage("Link da agenda copiado.");
  }

  const serviceNames = useMemo(() => Object.fromEntries(services.map((service) => [service.id, service.name])), [services]);
  const activeServices = services.filter((service) => service.active);
  const allProfessionals = staff.filter((member) => member.role === "professional");
  const professionals = allProfessionals.filter((member) => member.active);
  const receptionists = staff.filter((member) => member.role === "receptionist");
  const pendingAccessRequests = accessRequests.filter((request) => request.status === "pending");
  const professionalEmails = new Set(allProfessionals.map((member) => member.email.toLowerCase()));
  const pendingInvites = invites.filter((invite) => invite.role === "professional" && invite.active && !professionalEmails.has(invite.email.toLowerCase()));
  const professionalsFor = (serviceId: string) => serviceId
    ? professionals.filter((professional) => assignments.some((assignment) => assignment.professional_id === professional.user_id && assignment.service_id === Number(serviceId)))
    : professionals;
  const professionalNames = Object.fromEntries(allProfessionals.map((professional) => [professional.user_id, professional.full_name]));
  const openSlots = slots.filter((slot) => slot.status === "open").length;
  const latestBookingByLead = new Map<number, Booking>();
  bookings.forEach((booking) => { if (!latestBookingByLead.has(booking.lead_id)) latestBookingByLead.set(booking.lead_id, booking); });
  const queueForLead = (lead: Lead): LeadQueue => {
    if (lead.archived_at) return "archived";
    const booking = latestBookingByLead.get(lead.id);
    if (!booking) return "conversion";
    if (["pending", "awaiting_payment"].includes(booking.status)) return "prebooking";
    if (["confirmed", "rescheduled", "completed", "no_show"].includes(booking.status)) return "confirmed";
    if (["expired", "cancelled"].includes(booking.status)) return "expired";
    return "conversion";
  };
  const queueCounts = leads.reduce<Record<LeadQueue, number>>((counts, lead) => {
    counts[queueForLead(lead)] += 1;
    return counts;
  }, { conversion: 0, prebooking: 0, confirmed: 0, expired: 0, archived: 0 });
  const newLeads = queueCounts.conversion;
  const filteredLeads = leads.filter((lead) => {
    const query = leadSearch.trim().toLowerCase();
    const matchesQuery = !query || lead.name.toLowerCase().includes(query) || lead.phone.includes(query.replace(/\D/g, ""));
    return queueForLead(lead) === leadQueue && matchesQuery && (leadStatusFilter === "all" || lead.status === leadStatusFilter) && (leadServiceFilter === "all" || lead.service_slug === leadServiceFilter);
  });
  const visibleAdminSections = adminSections.filter((section) => section.id !== "access" || isMaster);
  const currentSection = visibleAdminSections.find((section) => section.id === activeSection) ?? visibleAdminSections[0];

  if (!session) {
    return (
      <main className="admin-login">
        <section className="login-card">
          <Link className="admin-wordmark" href={QUIZ_URL}><img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética Avançada" /></Link>
          <p className="admin-eyebrow">Área restrita</p>
          <h1>{authMode === "login" ? "Entrar no painel" : "Criar primeiro acesso"}</h1>
          <p>Use o e-mail autorizado da clínica e uma senha segura.</p>
          <form onSubmit={handleAuth}>
            {authMode === "signup" && <label>Nome completo<input type="text" required value={signupName} onChange={(event) => setSignupName(event.target.value)} autoComplete="name" /></label>}
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
    return <main className="admin-loading access-waiting"><p className="admin-eyebrow">Acesso ao painel</p><h1>{accessRequestStatus === "rejected" ? "Solicitação não aprovada" : "Aguardando aprovação"}</h1><p>{accessRequestStatus === "rejected" ? "O master não autorizou esta conta. Fale com a administração da clínica se precisar revisar o acesso." : "Seu cadastro e seu e-mail foram confirmados. O master da PS Estética precisa autorizar seu perfil antes do primeiro acesso."}</p><span>{session?.user.email}</span><button onClick={() => supabase.auth.signOut()}>Sair</button></main>;
  }

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div className="admin-header-brand">
          <Link className="admin-header-logo" href={QUIZ_URL} aria-label="Voltar ao quiz da PS Estética"><img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética Avançada" /></Link>
          <div><p className="admin-eyebrow">Gestão PS Estética</p><h1>Painel da clínica</h1></div>
        </div>
        <div className="admin-account"><span>{session.user.email}</span><button onClick={() => supabase.auth.signOut()}>Sair</button></div>
      </header>

      {message && <div className="admin-message banner" role="status">{message}<button onClick={() => setMessage("")}>×</button></div>}

      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-sidebar-heading"><p className="admin-eyebrow">Navegação</p><strong>Organize seu dia</strong></div>
          <nav className="admin-nav" aria-label="Seções do painel">
            {visibleAdminSections.map((section, index) => <Fragment key={section.id}>
              {(index === 0 || visibleAdminSections[index - 1].group !== section.group) && <span className="admin-nav-group">{section.group}</span>}
              <button type="button" className={activeSection === section.id ? "active" : ""} onClick={() => setActiveSection(section.id)} aria-current={activeSection === section.id ? "page" : undefined}>
                <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                <span><b>{section.label}</b><small>{section.description}</small></span>
              </button>
            </Fragment>)}
          </nav>
          <div className="sidebar-shortcuts"><Link href={AGENDA_URL} target="_blank">Abrir agenda pública ↗</Link><Link href={QUIZ_URL} target="_blank">Abrir quiz ↗</Link></div>
        </aside>

        <div className="admin-content">
          <header className="section-intro"><p className="admin-eyebrow">Painel / {currentSection.label}</p><h2>{currentSection.label}</h2><p>{currentSection.description}.</p></header>

      {activeSection === "overview" && <>

      <section className="stats-grid" aria-label="Resumo">
        <article><span>Para converter</span><b>{queueCounts.conversion}</b><small>leads sem reserva ativa</small></article>
        <article><span>Pré-agendados</span><b>{queueCounts.prebooking}</b><small>aguardando pagamento</small></article>
        <article><span>Agendados</span><b>{queueCounts.confirmed}</b><small>pagamento confirmado</small></article>
        <article><span>Expirados</span><b>{queueCounts.expired}</b><small>recepção deve recuperar</small></article>
      </section>

      <section className="admin-panel overview-actions">
        <div className="panel-heading"><div><p className="admin-eyebrow">Acesso rápido</p><h2>O que você quer fazer?</h2></div><p>As tarefas mais usadas ficam a um toque de distância.</p></div>
        <div className="overview-action-grid">
          <button type="button" onClick={() => setActiveSection("agenda")}><span>Agenda</span><b>Abrir ou bloquear horários</b><small>{openSlots} horário(s) aberto(s)</small></button>
          <button type="button" onClick={() => { setLeadQueue("conversion"); setActiveSection("clients"); }}><span>Clientes</span><b>Acompanhar novos contatos</b><small>{newLeads} lead(s) para converter</small></button>
          <button type="button" onClick={() => setActiveSection("team")}><span>Equipe</span><b>Gerenciar profissionais</b><small>{professionals.length} profissional(is) ativo(s)</small></button>
          <button type="button" onClick={() => setActiveSection("links")}><span>Compartilhar</span><b>Copiar links da agenda</b><small>{bookingLinks.filter((link) => link.active).length} link(s) ativo(s)</small></button>
        </div>
      </section>
      </>}

      {activeSection === "team" &&
      <section className="admin-panel team-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Equipe e permissões</p><h2>Agendas por profissional</h2></div><p>Cada profissional cria a própria senha e visualiza somente a modalidade atribuída. A recepção continua com controle master.</p></div>
        <div className="team-layout">
          <form className="slot-form" onSubmit={inviteProfessional}>
            <label>Nome do profissional<input required minLength={2} value={inviteName} onChange={(event) => setInviteName(event.target.value)} placeholder="Nome completo" /></label>
            <label>E-mail de acesso<input required type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="profissional@email.com" /></label>
            <label>Modalidade inicial<select required value={inviteServiceId} onChange={(event) => setInviteServiceId(event.target.value)}>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
            <button disabled={busy || activeServices.length === 0}>{busy ? "Salvando…" : "Autorizar profissional"}</button>
            <small className="form-help">Após autorizar, copie o link individual de primeiro acesso.</small>
          </form>
          <div className="staff-list">
            {pendingInvites.map((invite) => <article className="staff-card pending" key={invite.email}>
              <span className="staff-avatar">{invite.full_name.slice(0,1)}</span>
              <div className="staff-card-content"><div className="staff-card-title"><div><b>{invite.full_name}</b><small>{invite.email} · {invite.service_id ? serviceNames[invite.service_id] : "Sem modalidade"}</small></div><span className="status-badge pending">Aguardando senha</span></div>
                <div className="staff-actions"><button onClick={() => copyProfessionalAccess(invite)}>Copiar primeiro acesso</button><button className="danger-link" onClick={() => cancelInvite(invite)}>Cancelar</button></div>
              </div>
            </article>)}
            {allProfessionals.length === 0 && pendingInvites.length === 0 && <p className="empty-state">Nenhum profissional cadastrado ainda.</p>}
            {allProfessionals.map((professional) => <article className={`staff-card ${professional.active ? "" : "inactive"}`} key={professional.user_id}>
              <span className="staff-avatar">{professional.full_name.slice(0,1)}</span>
              <div className="staff-card-content"><div className="staff-card-title"><div><b>{professional.full_name}</b><small>{professional.email}</small></div><span className={`status-badge ${professional.active ? "active" : "inactive"}`}>{professional.active ? "Ativo" : "Inativo"}</span></div>
                <div className="service-checks" aria-label={`Modalidades de ${professional.full_name}`}>{activeServices.map((service) => { const checked = assignments.some((item) => item.professional_id === professional.user_id && item.service_id === service.id); return <label key={service.id}><input type="checkbox" checked={checked} disabled={!professional.active} onChange={() => toggleProfessionalService(professional, service)} />{service.name}</label>; })}</div>
                <div className="staff-actions"><button className={professional.active ? "danger-link" : ""} onClick={() => toggleProfessionalActive(professional)}>{professional.active ? "Desativar profissional" : "Reativar profissional"}</button></div>
              </div>
            </article>)}
          </div>
        </div>
      </section>}

      {activeSection === "access" && isMaster && <>
      <section className="admin-panel access-approval-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Controle master</p><h2>Solicitações de acesso</h2></div><p>Somente o master pode autorizar novas recepcionistas. O cadastro não libera acesso automaticamente.</p></div>
        <div className="access-request-list">
          {pendingAccessRequests.length === 0 && <p className="empty-state">Nenhuma solicitação aguardando aprovação.</p>}
          {pendingAccessRequests.map((request) => <article key={request.id}>
            <span className="staff-avatar">{request.full_name.slice(0,1).toUpperCase()}</span>
            <div><b>{request.full_name}</b><small>{request.email} · solicitado em {formatDate(request.created_at)}</small></div>
            <div className="access-request-actions"><button type="button" disabled={busy} onClick={() => reviewAccessRequest(request, true)}>Autorizar recepcionista</button><button type="button" className="danger-button" disabled={busy} onClick={() => reviewAccessRequest(request, false)}>Recusar</button></div>
          </article>)}
        </div>
      </section>

      <section className="admin-panel access-approval-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Pessoas autorizadas</p><h2>Acesso da recepção</h2></div><p>O master é protegido contra bloqueio. Recepcionistas podem ser desativadas sem apagar o histórico.</p></div>
        <div className="access-request-list">
          {receptionists.map((receptionist) => <article className={receptionist.active ? "" : "inactive"} key={receptionist.user_id}>
            <span className="staff-avatar">{receptionist.full_name.slice(0,1).toUpperCase()}</span>
            <div><b>{receptionist.full_name}</b><small>{receptionist.email}</small></div>
            <span className={`status-badge ${receptionist.is_master ? "master" : receptionist.active ? "active" : "inactive"}`}>{receptionist.is_master ? "Master" : receptionist.active ? "Autorizada" : "Bloqueada"}</span>
            {!receptionist.is_master && <button type="button" className={receptionist.active ? "danger-button" : "secondary-action"} disabled={busy} onClick={() => toggleReceptionistActive(receptionist)}>{receptionist.active ? "Bloquear acesso" : "Reativar acesso"}</button>}
          </article>)}
        </div>
      </section>
      </>}

      {activeSection === "links" && <section className="admin-panel direct-links-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Agendamento sem quiz</p><h2>Links diretos da agenda</h2></div><button className="copy-master" onClick={() => copyScheduleLink()}>Copiar agenda geral</button></div>
        <form className="link-form" onSubmit={createBookingLink}>
          <label>Identificação<input value={linkLabel} onChange={(event) => setLinkLabel(event.target.value)} placeholder="Ex.: Agenda Laser da Ana" /></label>
          <label>Modalidade<select value={linkServiceId} onChange={(event) => { setLinkServiceId(event.target.value); setLinkProfessionalId(""); }}><option value="">Todas</option>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
          <label>Profissional<select value={linkProfessionalId} onChange={(event) => setLinkProfessionalId(event.target.value)}><option value="">Qualquer profissional</option>{professionalsFor(linkServiceId).map((professional) => <option key={professional.user_id} value={professional.user_id}>{professional.full_name}</option>)}</select></label>
          <button disabled={busy}>{busy ? "Criando…" : "Criar link"}</button>
        </form>
        <div className="link-list">{bookingLinks.map((link) => <article className={link.active ? "" : "inactive"} key={link.id}><div><b>{link.label}</b><small>{link.service_id ? serviceNames[link.service_id] : "Todas as modalidades"}{link.professional_id ? ` · ${professionalNames[link.professional_id]}` : ""} · {link.uses} uso(s) · {link.active ? "ativo" : "desativado"}</small></div><div className="link-actions"><button disabled={!link.active} onClick={() => copyScheduleLink(link.token)}>Copiar</button><button className="secondary-action" onClick={() => toggleBookingLink(link)}>{link.active ? "Desativar" : "Reativar"}</button></div></article>)}</div>
      </section>}

      {activeSection === "services" && <section className="admin-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Configuração</p><h2>Procedimentos</h2></div><p>Crie, edite ou remova modalidades. Preço e duração alimentam a agenda e o cálculo automático do sinal.</p></div>
        <form className="new-service-form" onSubmit={createService}>
          <div><p className="admin-eyebrow">Novo procedimento</p><h3>Adicionar à agenda</h3></div>
          <label>Nome<input required minLength={2} value={newServiceName} onChange={(event) => setNewServiceName(event.target.value)} placeholder="Ex.: Bioestimulador" /></label>
          <label>Descrição<input value={newServiceDescription} onChange={(event) => setNewServiceDescription(event.target.value)} placeholder="Resumo para a cliente" /></label>
          <label>Preço (R$)<input required inputMode="decimal" value={newServicePrice} onChange={(event) => setNewServicePrice(event.target.value.replace(/[^\d,.-]/g, ""))} placeholder="0,00" /></label>
          <label>Duração (min)<input required type="number" min="5" max="720" step="5" value={newServiceDuration} onChange={(event) => setNewServiceDuration(event.target.value)} /></label>
          <button disabled={busy}>{busy ? "Criando…" : "Criar procedimento"}</button>
        </form>
        <div className="service-editor">
          {services.map((service) => (
            <article className={service.active ? "" : "archived"} key={service.id}>
              <div className="service-card-heading"><div><h3>{service.name}</h3><span>{service.slug}</span></div>{!service.active && <span className="status-badge inactive">Arquivado</span>}</div>
              <label>Nome<input value={service.name} onChange={(event) => updateServiceText(service.id, "name", event.target.value)} /></label>
              <label>Descrição<input value={service.description ?? ""} onChange={(event) => updateServiceText(service.id, "description", event.target.value)} placeholder="Descrição curta" /></label>
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
              <div className="service-actions"><button onClick={() => saveService(service)}>Salvar</button>{service.active ? <button className="danger-button" onClick={() => removeService(service)}>Excluir</button> : <button className="secondary-action" onClick={() => restoreService(service)}>Restaurar</button>}</div>
            </article>
          ))}
        </div>
      </section>}

      {activeSection === "agenda" && <>
      <section className="admin-panel split-panel">
        <div>
          <div className="panel-heading"><div><p className="admin-eyebrow">Agenda</p><h2>Abrir horário</h2></div></div>
          <form className="slot-form" onSubmit={createSlot}>
            <label>Procedimento<select required value={slotServiceId} onChange={(event) => { setSlotServiceId(event.target.value); setSlotProfessionalId(""); }}>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name} · {formatMoney(service.price_cents)}</option>)}</select></label>
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
            {slots.map((slot) => <article key={slot.id}><div><b>{serviceNames[slot.service_id] ?? "Procedimento"}</b><span>{professionalNames[slot.professional_id ?? ""] ?? "Equipe PS"} · {formatDate(slot.starts_at)}</span></div><div className="slot-actions"><button className={slot.status} disabled={!['open', 'blocked'].includes(slot.status)} onClick={() => toggleSlot(slot)}>{slot.status === "open" ? "Aberto" : slot.status === "reserved" ? "Reservado" : slot.status === "completed" ? "Concluído" : "Bloqueado"}</button>{['open', 'blocked'].includes(slot.status) && <button className="delete-slot" onClick={() => deleteSlot(slot)} aria-label="Excluir horário">Excluir</button>}</div></article>)}
          </div>
        </div>
      </section>

      <section className="admin-panel">
        <div className="panel-heading"><div><p className="admin-eyebrow">Automação</p><h2>Gerar horários recorrentes</h2></div><p>Cria a agenda semanal em lote e ignora automaticamente datas que já existem.</p></div>
        <form className="recurring-form" onSubmit={createRecurringSlots}>
          <label>Procedimento<select required value={recurringServiceId} onChange={(event) => { setRecurringServiceId(event.target.value); setRecurringProfessionalId(""); }}>{activeServices.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
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
      </>}

      {activeSection === "clients" && <section className="admin-panel crm-section">
        <div className="panel-heading"><div><p className="admin-eyebrow">CRM</p><h2>Funil de atendimento</h2></div><p>A recepção acompanha as clientes até o pagamento; depois da confirmação, o atendimento segue para o especialista.</p></div>
        <div className="crm-funnel-grid" role="tablist" aria-label="Etapas do funil">
          {(["conversion", "prebooking", "confirmed", "expired", "archived"] as LeadQueue[]).map((queue) => <button key={queue} role="tab" aria-selected={leadQueue === queue} className={`crm-funnel-card ${queue} ${leadQueue === queue ? "active" : ""}`} onClick={() => setLeadQueue(queue)}><span>{leadQueueLabel[queue]}</span><b>{queueCounts[queue]}</b><small>{leadQueueDescription[queue]}</small></button>)}
        </div>
        <div className="crm-filter-panel">
          <label className="crm-search">Buscar lead<input value={leadSearch} onChange={(event) => setLeadSearch(event.target.value)} placeholder="Nome ou WhatsApp" /></label>
          <label>Status<select value={leadStatusFilter} onChange={(event) => setLeadStatusFilter(event.target.value)}><option value="all">Todos os status</option>{Object.entries(leadStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Procedimento<select value={leadServiceFilter} onChange={(event) => setLeadServiceFilter(event.target.value)}><option value="all">Todos</option>{services.map((service) => <option key={service.slug} value={service.slug}>{service.name}</option>)}</select></label>
          {(leadSearch || leadStatusFilter !== "all" || leadServiceFilter !== "all") && <button className="crm-clear-filters" onClick={() => { setLeadSearch(""); setLeadStatusFilter("all"); setLeadServiceFilter("all"); }}>Limpar filtros</button>}
        </div>
        <div className="crm-list-heading"><div><p className="admin-eyebrow">Lista atual</p><h3>{leadQueueLabel[leadQueue]}</h3></div><span className="crm-total">{filteredLeads.length} {filteredLeads.length === 1 ? "contato" : "contatos"}</span></div>
        <div className="table-wrap crm-table-wrap">
          <table className="crm-table">
            <thead><tr><th>Cliente</th><th>Interesse</th><th>Prioridade</th><th>Entrada</th><th>Etapa</th><th>Contato</th><th>Detalhes</th></tr></thead>
            <tbody>
              {filteredLeads.length === 0 && <tr><td colSpan={7} className="empty-state">Nenhum lead nesta etapa.</td></tr>}
              {filteredLeads.map((lead) => <tr key={lead.id}><td><button className="lead-open" onClick={() => setSelectedLead(lead)}><b>{lead.name}</b><small>{lead.phone}</small></button></td><td>{services.find((service) => service.slug === lead.service_slug)?.name ?? lead.service_slug}</td><td>{timingLabel[lead.timing] ?? lead.timing}</td><td>{formatDate(lead.created_at)}</td><td><span className={`funnel-stage ${queueForLead(lead)}`}>{leadQueueLabel[queueForLead(lead)]}</span></td><td><a className="crm-whatsapp" href={`https://wa.me/55${lead.phone.replace(/^55/, "")}`} target="_blank" rel="noreferrer">WhatsApp ↗</a></td><td><button className="view-lead" onClick={() => setSelectedLead(lead)}>Abrir perfil</button></td></tr>)}
            </tbody>
          </table>
        </div>
      </section>}

      {activeSection === "revenue" && <RevenueDashboard />}

      {activeSection === "settings" && <>
      <section className="payment-note">
        <div><p className="admin-eyebrow">Pagamento integrado</p><h2>Pix automático</h2><p>Após escolher o horário, o sistema calcula {settings?.deposit_percent ?? 10}% com mínimo de {formatMoney(settings?.min_deposit_cents ?? 3000)} e máximo de {formatMoney(settings?.max_deposit_cents ?? 10000)}, confirma pelo webhook e libera vagas expiradas automaticamente.</p></div>
        <span>{settings?.pix_enabled ? "Mercado Pago ativo" : "Pronto para credenciais"}</span>
      </section>

      <section className="admin-panel settings-summary">
        <div className="panel-heading"><div><p className="admin-eyebrow">Regras da clínica</p><h2>Configuração da operação</h2></div><p>As alterações passam a valer para novos procedimentos e agendamentos. Reservas existentes são preservadas.</p></div>
        {settings && <form className="settings-form" onSubmit={saveSettings}>
          <label>Sinal padrão (%)<input type="number" min="1" max="100" value={settings.deposit_percent} onChange={(event) => setSettings({ ...settings, deposit_percent: Number(event.target.value) })} /><small>Usado ao criar novos procedimentos.</small></label>
          <label>Sinal mínimo (R$)<input type="number" min="0" step="0.01" value={(settings.min_deposit_cents / 100).toFixed(2)} onChange={(event) => setSettings({ ...settings, min_deposit_cents: Math.round(Number(event.target.value) * 100) })} /><small>Evita sinais muito baixos.</small></label>
          <label>Sinal máximo (R$)<input type="number" min="0" step="0.01" value={(settings.max_deposit_cents / 100).toFixed(2)} onChange={(event) => setSettings({ ...settings, max_deposit_cents: Math.round(Number(event.target.value) * 100) })} /><small>Evita que o sinal se torne uma barreira.</small></label>
          <label>Expiração da reserva (min)<input type="number" min="5" max="1440" value={settings.reservation_expiry_minutes} onChange={(event) => setSettings({ ...settings, reservation_expiry_minutes: Number(event.target.value) })} /><small>Libera a vaga se o Pix não for pago.</small></label>
          <label>Remarcação mínima (h)<input type="number" min="0" max="720" value={settings.reschedule_notice_hours} onChange={(event) => setSettings({ ...settings, reschedule_notice_hours: Number(event.target.value) })} /><small>Antecedência exigida da cliente.</small></label>
          <label>WhatsApp da clínica<input inputMode="numeric" value={settings.whatsapp} onChange={(event) => setSettings({ ...settings, whatsapp: event.target.value.replace(/\D/g, "").slice(0, 13) })} /><small>País + DDD + número, sem símbolos.</small></label>
          <div className="settings-provider"><span>Pagamento</span><b>{settings.payment_provider || "Mercado Pago"}</b><small>{settings.pix_enabled ? "Pix automático ativo" : "Aguardando credenciais"}</small></div>
          <button type="submit" disabled={busy}>{busy ? "Salvando…" : "Salvar configurações"}</button>
        </form>}
      </section>
      </>}
        </div>
      </div>

      {selectedLead && <div className="drawer-backdrop" onClick={() => setSelectedLead(null)} role="presentation">
        <aside className="lead-drawer" onClick={(event) => event.stopPropagation()} aria-label={`Perfil de ${selectedLead.name}`}>
          <button className="drawer-close" onClick={() => setSelectedLead(null)} aria-label="Fechar">×</button>
          <p className="admin-eyebrow">Perfil da cliente</p><h2>{selectedLead.name}</h2>
          <a className="drawer-whatsapp" href={`https://wa.me/55${selectedLead.phone.replace(/^55/, "")}`} target="_blank" rel="noreferrer">Conversar no WhatsApp ↗</a>
          <dl><div><dt>Telefone</dt><dd>{selectedLead.phone}</dd></div><div><dt>Procedimento</dt><dd>{services.find((service) => service.slug === selectedLead.service_slug)?.name ?? selectedLead.service_slug}</dd></div><div><dt>Experiência</dt><dd>{selectedLead.experience ? (experienceLabel[selectedLead.experience] ?? selectedLead.experience) : "Não informada"}</dd></div><div><dt>Prazo</dt><dd>{timingLabel[selectedLead.timing] ?? selectedLead.timing}</dd></div><div><dt>Entrada</dt><dd>{formatDate(selectedLead.created_at)}</dd></div><div><dt>Status do atendimento</dt><dd><select className="drawer-status-select" value={selectedLead.status} onChange={(event) => updateLeadStatus(selectedLead.id, event.target.value)}>{Object.entries(leadStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></dd></div></dl>
          <div className="source-card"><b>Origem da campanha</b><p>{selectedLead.source?.utm_source || "Acesso direto"}{selectedLead.source?.utm_campaign ? ` · ${selectedLead.source.utm_campaign}` : ""}</p><small>{selectedLead.source?.referrer || "Sem referência externa registrada"}</small></div>
          <div className="drawer-note"><b>Observações</b><p>{selectedLead.notes || "Nenhuma observação registrada para esta cliente."}</p></div>
          <div className="lead-management"><b>Gerenciar cadastro</b><p>{selectedLead.archived_at ? `Arquivado em ${formatDate(selectedLead.archived_at)}. Você pode restaurar este contato ou acessar as opções avançadas.` : "Arquive contatos que não precisam aparecer na lista principal. O histórico e os agendamentos serão preservados."}</p><div className="lead-management-actions">{selectedLead.archived_at ? <button className="secondary-action" onClick={() => restoreLead(selectedLead)}>Restaurar lead</button> : <button className="secondary-action" onClick={() => archiveLead(selectedLead)}>Arquivar lead</button>}</div>{selectedLead.archived_at && <details className="advanced-options"><summary>Opções avançadas</summary><p>A exclusão permanente só é permitida para leads sem agendamentos vinculados.</p><button className="danger-button" onClick={() => permanentlyDeleteLead(selectedLead)}>Excluir permanentemente</button></details>}</div>
        </aside>
      </div>}
    </main>
  );
}
