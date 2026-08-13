"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { PROFESSIONAL_URL, QUIZ_URL } from "../../lib/public-urls";
import "../admin/admin.css";
import "./profissional.css";

type Profile = { user_id: string; full_name: string; email: string; role: string };
type Service = { id: number; slug: string; name: string; duration_minutes: number | null };
type Slot = { id: number; service_id: number; starts_at: string; ends_at: string; status: string; notes: string };
type Booking = { id: number; status: string; deposit_cents: number; leads: { name: string; phone: string } | null; services: { name: string } | null; slots: { starts_at: string } | null; payments: { status: string }[] | null };

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

export default function ProfessionalPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signup, setSignup] = useState(false);
  const [start, setStart] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadPanel() {
    setLoading(true);
    const { data: currentProfile } = await supabase.from("staff_profiles").select("user_id,full_name,email,role").eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "").maybeSingle();
    if (!currentProfile || currentProfile.role !== "professional") { setProfile(null); setLoading(false); return; }
    setProfile(currentProfile as Profile);
    const { data: assignments } = await supabase.from("professional_services").select("services(id,slug,name,duration_minutes)").eq("professional_id", currentProfile.user_id).eq("active", true);
    const assignedServices = (assignments ?? []).map((item) => item.services).filter(Boolean) as unknown as Service[];
    setServices(assignedServices); setServiceId((current) => current || String(assignedServices[0]?.id ?? ""));
    const [slotResult, bookingResult] = await Promise.all([
      supabase.from("slots").select("id,service_id,starts_at,ends_at,status,notes").gte("starts_at", new Date().toISOString()).order("starts_at"),
      supabase.from("bookings").select("id,status,deposit_cents,leads(name,phone),services(name),slots(starts_at),payments(status)").order("created_at", { ascending: false }).limit(100),
    ]);
    setSlots((slotResult.data ?? []) as Slot[]); setBookings((bookingResult.data ?? []) as unknown as Booking[]);
    if (slotResult.error || bookingResult.error) setMessage("Não foi possível carregar todos os dados da agenda.");
    setLoading(false);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) queueMicrotask(() => void loadPanel()); }, [session]);

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setMessage(""); setLoading(true);
    const normalized = email.trim().toLowerCase();
    if (signup) {
      const { data, error } = await supabase.auth.signUp({ email: normalized, password, options: { emailRedirectTo: PROFESSIONAL_URL } });
      if (error) setMessage(error.message); else if (!data.session) setMessage("Confira seu e-mail para confirmar o acesso.");
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email: normalized, password });
      if (error) setMessage("E-mail ou senha inválidos.");
    }
    setLoading(false);
  }

  async function createSlot(event: FormEvent) {
    event.preventDefault();
    const service = services.find((item) => item.id === Number(serviceId));
    if (!service?.duration_minutes) return setMessage("A recepção precisa configurar a duração deste serviço.");
    const begins = new Date(start); if (begins <= new Date()) return setMessage("Escolha uma data futura.");
    const { error } = await supabase.from("slots").insert({ service_id: service.id, professional_id: profile?.user_id, starts_at: begins.toISOString(), ends_at: new Date(begins.getTime() + service.duration_minutes * 60000).toISOString(), notes: "Aberto pelo profissional" });
    if (error) setMessage(error.message); else { setStart(""); setMessage("Horário aberto."); await loadPanel(); }
  }

  async function toggleSlot(slot: Slot) {
    if (!["open", "blocked"].includes(slot.status)) return;
    const { error } = await supabase.from("slots").update({ status: slot.status === "open" ? "blocked" : "open" }).eq("id", slot.id);
    if (error) setMessage(error.message); else await loadPanel();
  }

  async function updateBooking(id: number, status: string) {
    const { error } = await supabase.rpc("professional_update_booking_status", { p_booking_id: id, p_status: status });
    if (error) setMessage(error.message); else { setMessage("Atendimento atualizado."); await loadPanel(); }
  }

  const serviceNames = useMemo(() => Object.fromEntries(services.map((service) => [service.id, service.name])), [services]);

  if (!session) return <main className="admin-login"><section className="login-card"><Link className="admin-wordmark" href={QUIZ_URL}><img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética" /></Link><p className="admin-eyebrow">Portal do profissional</p><h1>{signup ? "Criar meu acesso" : "Minha agenda"}</h1><p>Entre com o e-mail previamente autorizado pela recepção.</p><form onSubmit={authenticate}><label>E-mail<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Senha<input type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button disabled={loading}>{loading ? "Aguarde…" : signup ? "Criar acesso" : "Entrar"}</button></form>{message && <p className="admin-message">{message}</p>}<button className="mode-switch" onClick={() => setSignup(!signup)}>{signup ? "Já tenho acesso" : "Primeiro acesso? Criar senha"}</button></section></main>;
  if (loading) return <main className="admin-loading">Carregando sua agenda…</main>;
  if (!profile) return <main className="admin-loading"><p>Este usuário não possui uma agenda profissional ativa.</p><button onClick={() => supabase.auth.signOut()}>Sair</button></main>;

  return <main className="admin-page professional-page"><header className="admin-header"><div className="admin-header-brand"><Link className="admin-header-logo" href={QUIZ_URL}><img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética" /></Link><div><p className="admin-eyebrow">Agenda profissional</p><h1>{profile.full_name}</h1></div></div><div className="admin-account"><span>{services.map((service) => service.name).join(" · ")}</span><button onClick={() => supabase.auth.signOut()}>Sair</button></div></header>
    {message && <div className="admin-message banner">{message}<button onClick={() => setMessage("")}>×</button></div>}
    <section className="stats-grid professional-stats"><article><span>Atendimentos</span><b>{bookings.length}</b><small>na sua agenda</small></article><article><span>Confirmados</span><b>{bookings.filter((booking) => booking.status === "confirmed").length}</b><small>pagamento aprovado</small></article><article><span>Horários abertos</span><b>{slots.filter((slot) => slot.status === "open").length}</b><small>disponíveis para clientes</small></article><article><span>Hoje</span><b>{bookings.filter((booking) => booking.slots && new Date(booking.slots.starts_at).toDateString() === new Date().toDateString()).length}</b><small>atendimentos previstos</small></article></section>
    <section className="admin-panel split-panel"><div><div className="panel-heading"><div><p className="admin-eyebrow">Disponibilidade</p><h2>Abrir horário</h2></div></div><form className="slot-form" onSubmit={createSlot}><label>Modalidade<select value={serviceId} onChange={(event) => setServiceId(event.target.value)}>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label><label>Data e hora<input type="datetime-local" required value={start} onChange={(event) => setStart(event.target.value)} /></label><button>Abrir na minha agenda</button></form></div><div><div className="panel-heading"><div><p className="admin-eyebrow">Próximos</p><h2>Meus horários</h2></div></div><div className="slot-list">{slots.length === 0 && <p className="empty-state">Nenhum horário futuro.</p>}{slots.map((slot) => <article key={slot.id}><div><b>{serviceNames[slot.service_id]}</b><span>{formatDate(slot.starts_at)}</span></div><button className={slot.status} disabled={!["open","blocked"].includes(slot.status)} onClick={() => toggleSlot(slot)}>{slot.status === "open" ? "Aberto" : slot.status === "reserved" ? "Reservado" : slot.status === "completed" ? "Concluído" : "Bloqueado"}</button></article>)}</div></div></section>
    <section className="admin-panel"><div className="panel-heading"><div><p className="admin-eyebrow">Atendimentos</p><h2>Minha agenda</h2></div><p>Somente clientes vinculadas às suas modalidades aparecem aqui.</p></div><div className="table-wrap"><table><thead><tr><th>Cliente</th><th>Serviço</th><th>Data</th><th>Pagamento</th><th>Atendimento</th><th>Contato</th></tr></thead><tbody>{bookings.length === 0 && <tr><td className="empty-state" colSpan={6}>Nenhum atendimento agendado.</td></tr>}{bookings.map((booking) => <tr key={booking.id}><td><b>{booking.leads?.name}</b><small>{booking.leads?.phone}</small></td><td>{booking.services?.name}</td><td>{booking.slots ? formatDate(booking.slots.starts_at) : "—"}</td><td><span className={`payment-pill ${booking.payments?.[0]?.status ?? "pending"}`}>{booking.payments?.[0]?.status === "paid" ? "Pago" : "Aguardando"}</span></td><td><select value={booking.status} onChange={(event) => updateBooking(booking.id,event.target.value)} disabled={booking.status === "awaiting_payment"}><option value="awaiting_payment">Aguardando Pix</option><option value="confirmed">Confirmado</option><option value="completed">Concluído</option><option value="no_show">Não compareceu</option></select></td><td>{booking.leads?.phone && <a href={`https://wa.me/55${booking.leads.phone.replace(/^55/,"")}`} target="_blank" rel="noreferrer">WhatsApp ↗</a>}</td></tr>)}</tbody></table></div></section>
  </main>;
}
