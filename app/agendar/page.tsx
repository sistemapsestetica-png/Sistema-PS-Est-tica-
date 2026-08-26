"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { supabase } from "../../lib/supabase";
import { trackMetaEvent } from "../../lib/meta-pixel";
import { formatBrazilianWhatsapp, INVALID_WHATSAPP_MESSAGE, isValidBrazilianWhatsapp, whatsappDigits } from "../../lib/whatsapp";
import "./agendar.css";

type Service = { id: number; slug: string; name: string; description: string; price_cents: number | null; deposit_percent: number };
type Slot = { slot_id: number; service_slug: string; service_name: string; professional_id: string | null; professional_name: string; starts_at: string; ends_at: string; price_cents: number | null; deposit_cents: number };
type Pix = { status: string; pix_copy_paste?: string; qr_code_base64?: string; ticket_url?: string; expires_at?: string };

function money(cents: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
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
  const [bookingId, setBookingId] = useState<number | null>(null);
  const trackedPurchaseId = useRef<number | null>(null);
  const chosenService = useMemo(() => services.find((service) => service.slug === serviceSlug), [services, serviceSlug]);

  useEffect(() => {
    async function initialize() {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("convite");
      const { data } = await supabase.from("services").select("id,slug,name,description,price_cents,deposit_percent").eq("active", true).order("id");
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
      if (status?.[0]?.booking_status === "confirmed") {
        setConfirmed(true);
        if (bookingId && trackedPurchaseId.current !== bookingId) {
          trackedPurchaseId.current = bookingId;
          trackMetaEvent("Purchase", {
            content_name: chosenService?.name ?? "Agendamento PS Estética",
            content_ids: [serviceSlug],
            content_type: "product",
            currency: "BRL",
            value: (selected?.deposit_cents ?? 0) / 100,
          }, `booking-${bookingId}-purchase`);
        }
        window.clearInterval(timer);
      }
      if (status?.[0]?.booking_status === "expired") { setNotice("O Pix expirou e o horário foi liberado novamente."); window.clearInterval(timer); }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [bookingId, bookingToken, chosenService?.name, confirmed, selected?.deposit_cents, serviceSlug]);

  async function reserve(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy) return;
    if (!isValidBrazilianWhatsapp(phone)) { setNotice(INVALID_WHATSAPP_MESSAGE); return; }
    setBusy(true); setNotice("");
    const { data, error } = await supabase.rpc("create_direct_booking", {
      p_service_slug: serviceSlug,
      p_slot_id: selected.slot_id,
      p_name: name.trim(),
      p_phone: whatsappDigits(phone),
      p_email: email.trim().toLowerCase(),
      p_link_token: linkToken,
    });
    if (error || !data?.[0]) { setNotice(error?.message ?? "Não foi possível criar a reserva."); setBusy(false); return; }
    const token = data[0].booking_token as string;
    const nextBookingId = Number(data[0].booking_id);
    setBookingToken(token);
    setBookingId(nextBookingId);
    trackMetaEvent("Lead", {
      content_name: "Agenda direta",
      content_category: serviceSlug,
    });
    trackMetaEvent("Schedule", {
      content_name: chosenService?.name ?? "Agendamento PS Estética",
      content_ids: [serviceSlug],
      content_type: "product",
      currency: "BRL",
      value: selected.deposit_cents / 100,
    }, `booking-${nextBookingId}-schedule`);
    const { data: pixData, error: pixError } = await supabase.functions.invoke("create-pix", { body: { bookingToken: token } });
    if (pixError || !pixData?.payment) {
      setNotice(pixData?.code === "mercado_pago_not_configured" ? "Sua vaga foi separada. O Pix automático será liberado assim que a clínica concluir a configuração do Mercado Pago." : (pixData?.error ?? "A vaga foi separada, mas não foi possível gerar o Pix agora."));
    } else {
      setPix(pixData.payment as Pix);
      trackMetaEvent("InitiateCheckout", {
        content_name: chosenService?.name ?? "Agendamento PS Estética",
        content_ids: [serviceSlug],
        content_type: "product",
        currency: "BRL",
        value: selected.deposit_cents / 100,
      });
    }
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
      <section className="schedule-intro"><p>PRÉ-RESERVA ONLINE</p><h1>Escolha seu cuidado.<br /><em>Encontre sua melhor data.</em></h1><span>O horário é confirmado automaticamente após o pagamento do sinal via Pix.</span></section>

      <section className="schedule-card">
        {confirmed ? <div className="schedule-success"><span>✓</span><p>Pagamento confirmado</p><h2>Sua avaliação está agendada.</h2><p>{selected ? dateTime(selected.starts_at) : ""}</p><a href="https://wa.me/5511934580476" target="_blank" rel="noreferrer">Falar com a equipe →</a></div> : pix ? <div className="pix-panel"><p className="step-label">ÚLTIMA ETAPA</p><h2>Pague o sinal para confirmar</h2><div className="pix-summary"><span>Sinal via Pix</span><b>{selected ? money(selected.deposit_cents) : ""}</b></div>{pix.qr_code_base64 && <img className="pix-qr" src={`data:image/png;base64,${pix.qr_code_base64}`} alt="QR Code Pix" />}<button className="schedule-primary" onClick={copyPix}>Copiar código Pix</button>{pix.ticket_url && <a className="pix-link" href={pix.ticket_url} target="_blank" rel="noreferrer">Abrir pagamento em outra tela ↗</a>}<small>Assim que o banco confirmar o Pix, esta tela será atualizada automaticamente.</small></div> : <>
          <div className="schedule-step"><span>01</span><div><p>Escolha o serviço</p><h2>Qual cuidado você deseja agendar?</h2></div></div>
          <div className="service-options">{services.map((service) => <button key={service.id} className={serviceSlug === service.slug ? "active" : ""} onClick={() => { setSlots([]); setServiceSlug(service.slug); }}><b>{service.name}</b><small>Valor definido após avaliação · sinal fixo de R$ 50</small></button>)}</div>
          {serviceSlug && <><div className="schedule-step second"><span>02</span><div><p>Escolha o horário</p><h2>Datas disponíveis para {chosenService?.name}</h2></div></div><div className="slot-options direct">{busy && <p>Consultando agenda…</p>}{!busy && slots.length === 0 && <div className="schedule-empty"><b>Nenhuma data aberta neste momento.</b><span>A equipe pode avisar você quando novos horários forem liberados.</span><a href="https://wa.me/5511934580476" target="_blank" rel="noreferrer">Pedir próxima data ↗</a></div>}{slots.map((slot) => <button key={slot.slot_id} className={selected?.slot_id === slot.slot_id ? "active" : ""} onClick={() => setSelected(slot)}><span><small>{slot.professional_name}</small>{dateTime(slot.starts_at)}</span><b>{selected?.slot_id === slot.slot_id ? "✓" : "→"}</b></button>)}</div></>}
          {selected && <form className="client-form" onSubmit={reserve}><div className="schedule-step third"><span>03</span><div><p>Seus dados</p><h2>Reserve este horário</h2></div></div><label>Nome completo<input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label><label>WhatsApp<input required minLength={15} maxLength={15} pattern="\([1-9]\d\) 9\d{4}-\d{4}" title={INVALID_WHATSAPP_MESSAGE} value={phone} onChange={(event) => { setPhone(formatBrazilianWhatsapp(event.target.value)); setNotice(""); }} placeholder="(11) 90000-0000" inputMode="numeric" autoComplete="tel-national" aria-describedby="whatsapp-help-schedule" /><small id="whatsapp-help-schedule">Informe um celular com DDD e todos os 9 dígitos.</small></label><label>E-mail para o pagamento<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@email.com" autoComplete="email" /></label><div className="deposit-box"><span>Sinal fixo para confirmação</span><b>{money(selected.deposit_cents)}</b><small>O valor final é definido após a avaliação. Este sinal será descontado integralmente.</small></div><button className="schedule-primary" disabled={busy}>{busy ? "Gerando seu Pix…" : "Reservar e gerar Pix"} <span>→</span></button></form>}
        </>}
        {notice && <p className="schedule-notice" role="status">{notice}</p>}
      </section>
      <footer className="schedule-footer"><span>PS Estética · São Bernardo do Campo</span><small>Ambiente seguro para sua pré-reserva</small></footer>
    </main>
  );
}
