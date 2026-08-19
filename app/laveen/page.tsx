"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { trackMetaEvent } from "../../lib/meta-pixel";
import { supabase } from "../../lib/supabase";
import s from "./laveen.module.css";

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type Key = "concern" | "duration" | "treatment" | "priority";
type Answers = Record<Key, string>;
type Slot = { slot_id: number; service_name: string; starts_at: string; ends_at: string };
type Lead = { lead_id: number; reservation_token: string };
type Booking = { booking_id: number; booking_token: string; service_name: string; starts_at: string; ends_at: string; deposit_cents: number; payment_expires_at: string };
type Pix = { status: string; pix_copy_paste?: string; qr_code_base64?: string; ticket_url?: string; expires_at?: string };

const questions: Array<{ key: Key; eyebrow: string; title: string; options: string[] }> = [
  { key: "concern", eyebrow: "Vamos começar pelo seu objetivo", title: "O que você mais gostaria de melhorar na sua pele?", options: ["Manchas e marcas do sol", "Poros aparentes", "Textura irregular", "Falta de viço", "Linhas finas"] },
  { key: "duration", eyebrow: "Entendendo o seu momento", title: "Há quanto tempo isso incomoda você?", options: ["Menos de 6 meses", "De 6 a 12 meses", "Mais de 1 ano"] },
  { key: "treatment", eyebrow: "Seu histórico ajuda na avaliação", title: "Você já realizou algum tratamento para isso?", options: ["Nunca", "Sim, mas quero uma nova opção", "Estou em tratamento atualmente"] },
  { key: "priority", eyebrow: "Última pergunta", title: "Qual é a sua principal prioridade?", options: ["Clarear manchas", "Melhorar textura", "Mais viço", "Uniformizar o tom", "Rejuvenescimento"] },
];

const concernImages: Record<string, { src: string; tone: string }> = {
  "Manchas e marcas do sol": { src: "/quiz-concerns/sunspots.png", tone: "amber" },
  "Poros aparentes": { src: "/quiz-concerns/pores.png", tone: "peach" },
  "Textura irregular": { src: "/quiz-concerns/texture.png", tone: "terracotta" },
  "Falta de viço": { src: "/quiz-concerns/dullness.png", tone: "lilac" },
  "Linhas finas": { src: "/quiz-concerns/fine-lines.png", tone: "taupe" },
};

const benefits = [
  ["01", "Manchas e tom", "Aparência de manchas, marcas do sol e tom irregular."],
  ["02", "Textura", "Renovação da aparência e sensação de pele mais uniforme."],
  ["03", "Poros", "Atenuação da aparência de poros aparentes."],
  ["04", "Viço", "Mais luminosidade e uniformidade visual para a pele."],
  ["05", "Linhas finas", "Cuidado dos sinais iniciais de envelhecimento."],
];

function phoneMask(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatSlot(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function cookie(name: string) {
  const prefix = `${name}=`;
  return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? null;
}

export default function LavieenPage() {
  const [step, setStep] = useState<Step>(0);
  const [answers, setAnswers] = useState<Answers>({ concern: "", duration: "", treatment: "", priority: "" });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [lead, setLead] = useState<Lead | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [pix, setPix] = useState<Pix | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [paid, setPaid] = useState(false);
  const trackedLead = useRef<number | null>(null);
  const trackedPurchase = useRef<number | null>(null);
  const current = step >= 1 && step <= 4 ? questions[step - 1] : null;
  const progress = step === 0 ? 0 : step <= 4 ? step * 20 : step === 5 ? 90 : 100;

  const whatsapp = useMemo(() => {
    const message = booking ? `Olá! Sou ${name}. Fiz o quiz Lavieen e pré-reservei ${formatSlot(booking.starts_at)}. Quero confirmar os detalhes.` : `Olá! Sou ${name || "cliente"}. Fiz o quiz Lavieen da PS Estética e quero falar sobre uma avaliação.`;
    return `https://wa.me/5511934580476?text=${encodeURIComponent(message)}`;
  }, [booking, name]);

  function start() {
    if (step === 0) setStep(1);
    window.setTimeout(() => document.getElementById("diagnostico")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
  }

  function choose(value: string) {
    if (!current) return;
    setAnswers((old) => ({ ...old, [current.key]: value }));
    setLead(null);
    window.setTimeout(() => setStep((step + 1) as Step), 140);
  }

  function source() {
    const p = new URLSearchParams(window.location.search);
    return { landing_page: "laveen", quiz_answers: answers, utm_source: p.get("utm_source"), utm_medium: p.get("utm_medium"), utm_campaign: p.get("utm_campaign"), utm_content: p.get("utm_content"), utm_term: p.get("utm_term"), referrer: document.referrer || null, fbp: cookie("_fbp"), fbc: cookie("_fbc") };
  }

  async function saveLead(withEmail = false) {
    if (lead && !withEmail) return lead;
    const { data, error } = await supabase.rpc("capture_lead_session", {
      p_name: name.trim(), p_phone: phone.replace(/\D/g, ""), p_service_slug: "lavieen",
      p_experience: answers.treatment === "Nunca" ? "primeira" : "ja_fiz", p_timing: "pesquisando",
      p_source: source(), p_email: withEmail ? email.trim().toLowerCase() : null,
    });
    const row = data?.[0] as Lead | undefined;
    if (error || !row) return null;
    const next = { lead_id: Number(row.lead_id), reservation_token: row.reservation_token };
    setLead(next);
    if (trackedLead.current !== next.lead_id) {
      trackedLead.current = next.lead_id;
      trackMetaEvent("Lead", { content_name: "Quiz Lavieen", content_category: "lavieen" });
    }
    return next;
  }

  async function loadSlots() {
    const { data, error } = await supabase.rpc("list_open_slots", { p_service_slug: "lavieen" });
    if (error) { setSlots([]); setNotice("Não foi possível consultar a agenda agora. Fale com a equipe pelo WhatsApp."); }
    else setSlots(((data ?? []) as Slot[]).slice(0, 8));
  }

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    setLoading(true); setNotice("");
    if (!await saveLead(true)) { setNotice("Não conseguimos registrar seus dados agora. Confira os dados e tente novamente."); setLoading(false); return; }
    setStep(6);
    await loadSlots();
    setLoading(false);
  }

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || loading) return;
    setLoading(true); setNotice("");
    const session = await saveLead(true);
    if (!session) { setNotice("Não foi possível validar seus dados. Confira o e-mail e tente novamente."); setLoading(false); return; }
    const { data, error } = await supabase.rpc("reserve_slot_secure", { p_lead_id: session.lead_id, p_reservation_token: session.reservation_token, p_slot_id: selected.slot_id });
    if (error || !data?.[0]) { setNotice("Este horário acabou de ficar indisponível. Escolha outra opção."); await loadSlots(); setSelected(null); setLoading(false); return; }
    const next = data[0] as Booking;
    setBooking(next); setStep(7);
    const { data: pixData, error: pixError } = await supabase.functions.invoke("create-pix", { body: { bookingToken: next.booking_token } });
    if (pixError || !pixData?.payment) setNotice(pixData?.error ?? "Sua vaga foi separada, mas não foi possível gerar o Pix agora.");
    else {
      setPix(pixData.payment as Pix);
      trackMetaEvent("InitiateCheckout", { content_name: next.service_name, content_ids: ["lavieen"], content_type: "product", currency: "BRL", value: next.deposit_cents / 100 });
    }
    setLoading(false);
  }

  useEffect(() => {
    if (!booking?.booking_token || paid) return;
    const timer = window.setInterval(async () => {
      const { data } = await supabase.rpc("get_booking_public_status", { p_booking_token: booking.booking_token });
      if (data?.[0]?.booking_status === "confirmed") {
        setPaid(true);
        if (trackedPurchase.current !== booking.booking_id) {
          trackedPurchase.current = booking.booking_id;
          trackMetaEvent("Purchase", { content_name: booking.service_name, content_ids: ["lavieen"], content_type: "product", currency: "BRL", value: booking.deposit_cents / 100 }, `booking-${booking.booking_id}-purchase`);
        }
        window.clearInterval(timer);
      }
      if (data?.[0]?.booking_status === "expired") { setNotice("O prazo do Pix terminou e o horário foi liberado."); window.clearInterval(timer); }
    }, 5000);
    return () => window.clearInterval(timer);
  }, [booking, paid]);

  async function copyPix() {
    if (!pix?.pix_copy_paste) return;
    await navigator.clipboard.writeText(pix.pix_copy_paste);
    setNotice("Código Pix copiado.");
  }

  return <main className={s.page}>
    <header className={s.header}>
      <a href="#inicio" aria-label="PS Estética — início"><Image src="/ps-estetica-logo-oficial.png" width={246} height={80} alt="PS Estética Avançada" priority /></a>
      <a className={s.headerCta} href={whatsapp} target="_blank" rel="noreferrer">Falar com a equipe</a>
    </header>

    <section className={s.hero} id="inicio">
      <div className={s.heroCopy}><p className={s.eyebrow}>Quiz Lavieen • PS Estética</p><h1>Descubra se o Lavieen faz sentido <em>para a sua pele</em></h1><p className={s.heroText}>Responda algumas perguntas rápidas sobre manchas, textura, poros e viço. Em poucos minutos, você recebe uma indicação inicial de acordo com seus objetivos.</p><button className={s.primary} onClick={start}>Começar o quiz <span>›</span></button><p className={s.heroTrust}><b>Atendimento na PS Estética • ABC Paulista</b><span>Avaliação individualizada antes da definição do protocolo</span></p></div>
      <div className={s.heroPanel}><span className={s.orbit} aria-hidden="true" /><p>Indicação inicial em poucos minutos</p><strong>4 perguntas</strong><ul><li>Objetivo da sua pele</li><li>Histórico de cuidados</li><li>Prioridade do tratamento</li></ul><small>Sem diagnóstico automático. Sua pele será avaliada individualmente.</small></div>
    </section>

    <section className={s.benefits}><div className={s.sectionIntro}><p className={s.eyebrow}>Benefícios possíveis</p><h2>O que o Lavieen pode ajudar a melhorar?</h2><p>O Lavieen é uma tecnologia de laser fracionado de túlio 1927 nm utilizada em protocolos de renovação da pele. A indicação depende da avaliação de cada caso.</p></div><div className={s.benefitGrid}>{benefits.map(([n, title, text]) => <article key={n}><span>{n}</span><h3>{title}</h3><p>{text}</p></article>)}</div><p className={s.disclaimer}>Cada pele responde de uma forma. Por isso, indicação, parâmetros e protocolo devem ser definidos individualmente por profissional habilitado.</p></section>

    <section className={s.fit}><div><p className={s.eyebrow}>Para quem pode fazer sentido</p><h2>Um protocolo pensado a partir do que você vê e sente na sua pele</h2></div><div className={s.fitCards}><article><span>01</span><h3>Você percebe alterações na aparência da pele</h3><p>Manchas, tom irregular, poros aparentes, textura ou falta de luminosidade estão entre suas queixas.</p></article><article><span>02</span><h3>Você busca uma orientação personalizada</h3><p>Quer entender possibilidades sem escolher um protocolo apenas por tendência ou indicação genérica.</p></article><article><span>03</span><h3>Você está disponível para uma avaliação</h3><p>O histórico da pele, tratamentos em andamento e a avaliação presencial ajudam a definir se e como realizar.</p></article></div></section>

    <section className={s.how}><div className={s.sectionIntro}><p className={s.eyebrow}>Como funciona</p><h2>Do seu objetivo a uma recomendação mais consciente</h2></div><ol><li><span>1</span><div><h3>Conte o que incomoda</h3><p>Quatro perguntas objetivas ajudam a organizar suas prioridades.</p></div></li><li><span>2</span><div><h3>Receba a indicação inicial</h3><p>Entenda se o Lavieen pode ser uma possibilidade para conversar com a equipe.</p></div></li><li><span>3</span><div><h3>Pré-agende sua avaliação</h3><p>Escolha um horário disponível e confirme sua pré-reserva online.</p></div></li></ol></section>

    <section className={s.confidence}><p className={s.eyebrow}>Decisão com segurança</p><h2>Tecnologia não substitui avaliação.</h2><p>O quiz organiza seus objetivos, mas não realiza diagnóstico e não garante indicação. Antes do protocolo, a equipe considera as características e o momento da sua pele.</p><div><span>PS Estética</span><span>São Bernardo do Campo</span><span>Atendimento individualizado</span></div></section>

    <section className={`${s.quizSection} ${current?.key === "concern" ? s.concernSection : ""}`} id="diagnostico">
      <div className={s.quizIntro}><p className={s.eyebrow}>Seu quiz Lavieen</p><h2>Quatro respostas para começar uma conversa mais objetiva.</h2><p>Leva cerca de um minuto. Ao final, você poderá consultar a disponibilidade da PS Estética.</p></div>
      <div className={`${s.quizCard} ${current?.key === "concern" ? s.concernCard : ""}`} aria-live="polite">
        <div className={s.quizTop}><span>{step === 0 ? "Pronto para começar" : step <= 4 ? `Pergunta ${step} de 4` : step === 5 ? "Seus dados" : step === 6 ? "Indicação e agenda" : "Pré-reserva"}</span><b>{progress}%</b></div><div className={s.progress}><span style={{ width: `${progress}%` }} /></div>
        {step === 0 && <div className={s.quizBody}><p className={s.quizKicker}>Quiz Lavieen • PS Estética</p><h3>Descubra se o Lavieen faz sentido para a sua pele</h3><p className={s.quizText}>Responda algumas perguntas rápidas sobre manchas, textura, poros e viço. Em poucos minutos, você recebe uma indicação inicial de acordo com seus objetivos.</p><button className={s.primary} onClick={() => setStep(1)}>Começar o quiz <span>›</span></button><p className={s.cardTrust}>Atendimento na PS Estética • ABC Paulista<br /><span>Avaliação individualizada antes da definição do protocolo</span></p></div>}
        {current && <div className={s.quizBody}><p className={s.quizKicker}>{current.eyebrow}</p><h3>{current.title}</h3><div className={s.options}>{current.options.map((option) => <button key={option} className={`${answers[current.key] === option ? s.selected : ""} ${current.key === "concern" ? s.visualOption : ""}`} data-tone={current.key === "concern" ? concernImages[option].tone : undefined} onClick={() => choose(option)}>{current.key === "concern" && <Image className={s.optionImage} src={concernImages[option].src} width={76} height={76} sizes="(max-width: 620px) 64px, 76px" alt="" />}<span>{option}</span><i>›</i></button>)}</div>{current.key === "concern" && <small className={s.illustrativeNote}>Imagens ilustrativas geradas por IA.</small>}{step > 1 && <button className={s.back} onClick={() => setStep((step - 1) as Step)}>Voltar</button>}</div>}
        {step === 5 && <form className={`${s.quizBody} ${s.contactForm}`} onSubmit={submitContact}><p className={s.quizKicker}>Sua indicação inicial está quase pronta</p><h3>Deixe seus dados para ver a recomendação.</h3><p className={s.quizText}>Você também poderá verificar a disponibilidade para avaliação na PS Estética.</p><label>Nome<input required value={name} onChange={(e) => { setName(e.target.value); setLead(null); }} autoComplete="name" placeholder="Como podemos chamar você?" minLength={2} /></label><label>WhatsApp<input required value={phone} onChange={(e) => { setPhone(phoneMask(e.target.value)); setLead(null); }} autoComplete="tel" inputMode="numeric" placeholder="(11) 90000-0000" maxLength={15} minLength={15} pattern="\(\d{2}\) \d{5}-\d{4}" /></label><label>E-mail<input required type="email" value={email} onChange={(e) => { setEmail(e.target.value); setLead(null); }} autoComplete="email" placeholder="voce@exemplo.com" /></label><button className={s.primary} disabled={loading} type="submit">{loading ? "Preparando sua indicação…" : "Ver minha indicação"} <span>›</span></button>{notice && <p className={s.notice}>{notice}</p>}<button className={s.back} type="button" onClick={() => setStep(4)}>Voltar</button><small className={s.privacy}>Seus dados serão usados apenas para o atendimento da PS Estética.</small></form>}
        {step === 6 && <div className={s.quizBody}><p className={s.resultLabel}>Sua indicação inicial</p><h3>O Lavieen pode ser uma opção compatível com seus objetivos.</h3><p className={s.resultText}>Pelas suas respostas, seus objetivos de <b>{answers.priority.toLowerCase()}</b> e sua queixa sobre <b>{answers.concern.toLowerCase()}</b> podem ser conversados em uma avaliação de Lavieen. A indicação final depende de avaliação profissional.</p><div className={s.answerSummary}><span>Seu principal objetivo</span><strong>{answers.priority}</strong></div><div className={s.scheduleHead}><p className={s.quizKicker}>Próximo passo opcional</p><h4>Escolha um horário para sua avaliação</h4></div>{loading && <p className={s.notice}>Consultando a agenda…</p>}{!loading && slots.length > 0 && <div className={s.slots}>{slots.map((slot) => <button key={slot.slot_id} onClick={() => { setSelected(slot); setNotice(""); }} className={selected?.slot_id === slot.slot_id ? s.selectedSlot : ""}><span><small>{selected?.slot_id === slot.slot_id ? "Selecionado" : "Disponível"}</small>{formatSlot(slot.starts_at)}</span><i>{selected?.slot_id === slot.slot_id ? "✓" : "›"}</i></button>)}</div>}{!loading && slots.length === 0 && <div className={s.empty}><b>Não encontrou um horário?</b><p>A equipe pode consultar outras possibilidades para você.</p><a href={whatsapp} target="_blank" rel="noreferrer">Falar pelo WhatsApp</a></div>}{selected && <form className={s.reserveBox} onSubmit={reserve}><div><small>Horário escolhido</small><b>{formatSlot(selected.starts_at)}</b></div><p className={s.reserveEmail}>Confirmação enviada para <b>{email}</b></p><button className={s.primary} disabled={loading} type="submit">{loading ? "Criando pré-reserva…" : "Pré-reservar este horário"} <span>›</span></button></form>}{notice && <p className={s.notice}>{notice}</p>}</div>}
        {step === 7 && booking && <div className={s.quizBody}><p className={s.resultLabel}>Horário separado para você</p><h3>{formatSlot(booking.starts_at)}</h3><p className={s.quizText}>A pré-reserva é confirmada após o pagamento do sinal. O valor será descontado do atendimento.</p>{paid && <p className={s.success}>Pagamento confirmado. Seu horário está garantido.</p>}{!paid && pix?.qr_code_base64 && <div className={s.pixBox}><div><small>Sinal da avaliação</small><strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(booking.deposit_cents / 100)}</strong><p>Escaneie o QR Code ou copie o código Pix.</p>{pix.pix_copy_paste && <button type="button" onClick={copyPix}>Copiar código Pix</button>}</div><Image unoptimized src={`data:image/png;base64,${pix.qr_code_base64}`} width={140} height={140} alt="QR Code para pagamento Pix" /></div>}{notice && <p className={s.notice}>{notice}</p>}<a className={s.whatsapp} href={whatsapp} target="_blank" rel="noreferrer">Falar com a equipe no WhatsApp</a></div>}
      </div>
    </section>
    <footer className={s.footer}><Image src="/ps-estetica-logo-oficial.png" width={246} height={80} alt="PS Estética" /><p>São Bernardo do Campo • ABC Paulista</p><small>O conteúdo desta página é informativo. A indicação de qualquer procedimento depende de avaliação individual.</small></footer>
  </main>;
}
