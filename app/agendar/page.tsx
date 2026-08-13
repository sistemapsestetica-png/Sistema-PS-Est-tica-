"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import "./agendar.css";

type Service = { id: number; slug: string; name: string; description: string; price_cents: number; deposit_percent: number };
type Slot = { slot_id: number; service_slug: string; service_name: string; professional_id: string | null; professional_name: string; starts_at: string; ends_at: string; price_cents: number; deposit_cents: number };
type Pix = { status: string; pix_copy_paste?: string; qr_code_base64?: string; ticket_url?: string; expires_at?: string };

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function phoneMask(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export default function DirectSchedulePage() {
  const [services, setServices] = useState<Service[]>([]);
  const [serviceSlug, setServiceSlug] = useState("");
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [lockedProfessional, setLockedProfessional] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [pix, setPix] = useState<Pix | null>(null);
  const [bookingToken, setBookingToken] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    async function initialize() {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("convite");
      const { data } = await supabase.from("services").select("id,slug,name,description,price_cents,deposit_percent").eq("active", true).not("price_cents", "is", null).order("id");
      setServices((data ?? []) as Service[]);
      if (token) {
        const { data: option } = await supabase.rpc("get_booking_link_options", { p_link_token: token });
        const fixed = option?.[0];
        if (fixed) setLinkToken(token);
        if (fixed?.service_slug) setServiceSlug(fixed.service_slug);
        if (fixed?.professional_id) setLockedProfessional(fixed.professional_id);
        if (!fixed) setNotice("Este convite de agenda expirou. Você ainda pode escolher uma opção disponível abaixo.");
      }
    }
    void initialize();
  }, []);

  useEffect(() => {
    if (!serviceSlug) return;
    queueMicrotask(() => {
      setBusy(true); setSelected(null); setNotice("");
      supabase.rpc("list_open_slots", { p_service_slug: serviceSlug }).then(({ data, error }) => {
        const available = ((data ?? []) as Slot[]).filter((slot) => !lockedProfessional || slot.professional_id === lockedProfessional);
        setSlots(available);
        if (error) setNotice("Não foi possível consultar a agenda agora.");
        else if (!available.length) setNotice("Não há horários abertos para este serviço no momento.");
        setBusy(false);
      });
    });
  }, [serviceSlug, lockedProfessional]);

  useEffect(() => {
    if (!bookingToken || confirmed) return;
    const timer = window.setInterval(async () => {
      const { data: status } = await supabase.rpc("get_booking_public_status", { p_booking_token: bookingToken });
      if (status?.[0]?.booking_status === "confirmed") { setConfirmed(true); window.clearInterval(timer); }
      if (status?.[0]?.booking_status === "expired") { setNotice("O Pix expirou e o horário foi liberado novamente."); window.clearInterval(timer); }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [bookingToken, confirmed]);

  const chosenService = useMemo(() => services.find((service) => service.slug === serviceSlug), [services, serviceSlug]);

  async function reserve(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("create_direct_booking", {
      p_service_slug: serviceSlug,
      p_slot_id: selected.slot_id,
      p_name: name.trim(),
      p_phone: phone.replace(/\D/g, ""),
      p_email: email.trim().toLowerCase(),
      p_link_token: linkToken,
    });
    if (error || !data?.[0]) { setNotice(error?.message ?? "Não foi possível criar a reserva."); setBusy(false); return; }
    const token = data[0].booking_token as string;
    setBookingToken(token);
    const { data: pixData, error: pixError } = await supabase.functions.invoke("create-pix", { body: { bookingToken: token } });
    if (pixError || !pixData?.payment) {
      setNotice(pixData?.code === "mercado_pago_not_configured" ? "Sua vaga foi separada. O Pix automático será liberado assim que a clínica concluir a configuração do Mercado Pago." : (pixData?.error ?? "A vaga foi separada, mas não foi possível gerar o Pix agora."));
    } else setPix(pixData.payment as Pix);
    setBusy(false);
  }

  async function copyPix() {
    if (!pix?.pix_copy_paste) return;
    await navigator.clipboard.writeText(pix.pix_copy_paste);
    setNotice("Código Pix copiado.");
  }

  return (
    <main className="schedule-page">
      <header className="schedule-header"><Link href="/"><img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética" /></Link><span>Agenda online</span></header>
      <section className="schedule-intro"><p>PRÉ-RESERVA ONLINE</p><h1>Escolha seu cuidado.<br /><em>Encontre sua melhor data.</em></h1><span>O horário é confirmado automaticamente após o pagamento do sinal de 10% via Pix.</span></section>

      <section className="schedule-card">
        {confirmed ? <div className="schedule-success"><span>✓</span><p>Pagamento confirmado</p><h2>Sua avaliação está agendada.</h2><p>{selected ? dateTime(selected.starts_at) : ""}</p><a href="https://wa.me/5511934580476" target="_blank" rel="noreferrer">Falar com a equipe →</a></div> : pix ? <div className="pix-panel"><p className="step-label">ÚLTIMA ETAPA</p><h2>Pague o sinal para confirmar</h2><div className="pix-summary"><span>Sinal de 10%</span><b>{selected ? money(selected.deposit_cents) : ""}</b></div>{pix.qr_code_base64 && <img className="pix-qr" src={`data:image/png;base64,${pix.qr_code_base64}`} alt="QR Code Pix" />}<button className="schedule-primary" onClick={copyPix}>Copiar código Pix</button>{pix.ticket_url && <a className="pix-link" href={pix.ticket_url} target="_blank" rel="noreferrer">Abrir pagamento em outra tela ↗</a>}<small>Assim que o banco confirmar o Pix, esta tela será atualizada automaticamente.</small></div> : <>
          <div className="schedule-step"><span>01</span><div><p>Escolha o serviço</p><h2>Qual cuidado você deseja agendar?</h2></div></div>
          <div className="service-options">{services.map((service) => <button key={service.id} className={serviceSlug === service.slug ? "active" : ""} onClick={() => { setSlots([]); setServiceSlug(service.slug); }}><b>{service.name}</b><small>{money(service.price_cents)} · sinal de {service.deposit_percent}%</small></button>)}</div>
          {serviceSlug && <><div className="schedule-step second"><span>02</span><div><p>Escolha o horário</p><h2>Datas disponíveis para {chosenService?.name}</h2></div></div><div className="slot-options direct">{busy && <p>Consultando agenda…</p>}{slots.map((slot) => <button key={slot.slot_id} className={selected?.slot_id === slot.slot_id ? "active" : ""} onClick={() => setSelected(slot)}><span><small>{slot.professional_name}</small>{dateTime(slot.starts_at)}</span><b>{selected?.slot_id === slot.slot_id ? "✓" : "→"}</b></button>)}</div></>}
          {selected && <form className="client-form" onSubmit={reserve}><div className="schedule-step third"><span>03</span><div><p>Seus dados</p><h2>Reserve este horário</h2></div></div><label>Nome completo<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} /></label><label>WhatsApp<input required value={phone} onChange={(event) => setPhone(phoneMask(event.target.value))} placeholder="(11) 90000-0000" /></label><label>E-mail para o pagamento<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@email.com" /></label><div className="deposit-box"><span>Sinal para confirmação</span><b>{money(selected.deposit_cents)}</b><small>10% do serviço · Pix gerado automaticamente</small></div><button className="schedule-primary" disabled={busy}>{busy ? "Gerando seu Pix…" : "Reservar e gerar Pix"} <span>→</span></button></form>}
        </>}
        {notice && <p className="schedule-notice" role="status">{notice}</p>}
      </section>
      <footer className="schedule-footer"><span>PS Estética · São Bernardo do Campo</span><small>Ambiente seguro para sua pré-reserva</small></footer>
    </main>
  );
}
