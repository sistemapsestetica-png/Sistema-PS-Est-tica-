"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { trackMetaCustomEvent, trackMetaEvent } from "../../lib/meta-pixel";
import { supabase } from "../../lib/supabase";
import { isValidBrazilianWhatsapp, maskWhatsappInput, SHORT_INVALID_WHATSAPP_MESSAGE, whatsappDigits } from "../../lib/whatsapp";
import { cpfDigits, formatCpf, INVALID_CPF_MESSAGE, isValidCpf } from "../../lib/cpf";
import s from "../lavieen/lavieen.module.css";

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
type Key = "experience" | "goal" | "timing";
type Answers = Record<Key, string>;
type Slot = { slot_id: number; service_name: string; starts_at: string; ends_at: string };
type Lead = { lead_id: number; reservation_token: string };
type Booking = { booking_id: number; booking_token: string; service_name: string; starts_at: string; ends_at: string; deposit_cents: number; payment_expires_at: string };
type Pix = { status: string; pix_copy_paste?: string; qr_code_base64?: string; ticket_url?: string; expires_at?: string };

const WHATSAPP_NUMBER = "5511934580476";
const UNSURE_REGION = "Ainda não sei, quero orientação";
const regions = ["Testa", "Entre as sobrancelhas", "Ao redor dos olhos", UNSURE_REGION, "Linhas ao lado do nariz", "Região do buço", "Queixo", "Mandíbula", "Pescoço", "Outra região"];
const primaryRegionCount = 4;

const questions: Array<{ key: Key; eyebrow: string; title: string; options: string[] }> = [
  { key: "experience", eyebrow: "Seu histórico ajuda na avaliação", title: "Você já fez toxina botulínica antes?", options: ["Nunca fiz", "Já fiz há menos de 6 meses", "Já fiz há mais de 6 meses"] },
  { key: "goal", eyebrow: "Entendendo o que você espera", title: "O que você busca com o tratamento?", options: ["Resultado natural, sem perder a expressão", "Suavizar linhas que já me incomodam", "Cuidar da pele e prevenir linhas", "Ainda não sei, quero entender melhor"] },
  { key: "timing", eyebrow: "Última pergunta", title: "Quando você gostaria de fazer a avaliação?", options: ["O quanto antes", "Nas próximas semanas", "Estou pesquisando por enquanto"] },
];

const cityOptions = ["São Bernardo do Campo", "Santo André", "São Caetano do Sul", "Diadema", "Outra cidade"] as const;

const benefits = [
  ["01", "Testa", "Linhas horizontais que aparecem ao levantar as sobrancelhas."],
  ["02", "Entre as sobrancelhas", "Linhas verticais que marcam uma expressão de cansaço ou tensão."],
  ["03", "Ao redor dos olhos", "Linhas finas que se formam ao sorrir, os conhecidos pés de galinha."],
  ["04", "Cuidado preventivo", "Quando indicado, ajuda a suavizar a marcação repetida das linhas de expressão."],
  ["05", "Expressão natural", "Pontos e doses planejados para suavizar sem apagar a sua expressão."],
];

const faq = [
  ["Dói?", "A maioria das pessoas descreve como um desconforto leve e rápido, já que as agulhas são muito finas. A equipe explica o procedimento antes e você pode tirar dúvidas durante a avaliação."],
  ["Quando começo a ver o efeito?", "O efeito costuma aparecer de forma gradual nos primeiros dias e chegar ao ponto máximo em cerca de duas semanas. O tempo varia de pessoa para pessoa."],
  ["Quanto tempo dura?", "Em geral, de 3 a 6 meses, dependendo da região, da dose e do organismo. Por isso a avaliação define a melhor frequência para o seu caso."],
  ["Vou ficar com a expressão “congelada”?", "O objetivo de um bom planejamento é suavizar as linhas mantendo a naturalidade. A dose e os pontos de aplicação são definidos de forma individual, depois de analisar como você se expressa."],
  ["Quem não deve fazer?", "Gestantes e lactantes, pessoas com alergia aos componentes, infecção na região ou algumas doenças neuromusculares não devem realizar. Por isso, a avaliação e o histórico de saúde vêm antes de qualquer aplicação."],
  ["Preciso decidir agora?", "Não. O quiz e a avaliação servem para você entender as possibilidades. A aplicação só acontece se for indicada e se você decidir seguir."],
];

function formatSlot(value: string) {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function cookie(name: string) {
  const prefix = `${name}=`;
  return document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const trackingContent = { content_name: "Quiz Botox", content_category: "botox", content_ids: ["botox"], content_type: "product" };

export default function BotoxPage() {
  const [step, setStep] = useState<Step>(0);
  const [answers, setAnswers] = useState<Answers>({ experience: "", goal: "", timing: "" });
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [showMoreRegions, setShowMoreRegions] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [cityChoice, setCityChoice] = useState("");
  const [otherCity, setOtherCity] = useState("");
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
  const trackedViewContent = useRef(false);
  const trackedQuizStart = useRef(false);
  const trackedContactView = useRef(false);
  const leadSessionToken = useRef<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const previousStep = useRef<Step>(0);
  const current = step >= 2 && step <= 4 ? questions[step - 2] : null;
  const progress = step === 0 ? 0 : step <= 5 ? step * 16 : step === 6 ? 90 : 100;
  const city = cityChoice === "Outra cidade" ? otherCity.trim() : cityChoice;
  const phoneError = phoneTouched && !isValidBrazilianWhatsapp(phone);
  const moreRegionsOpen = showMoreRegions || selectedRegions.some((region) => regions.indexOf(region) >= primaryRegionCount);
  const regionsLabel = selectedRegions.length ? selectedRegions.join(", ") : "as regiões escolhidas";

  function getLeadSessionToken() {
    leadSessionToken.current ??= window.crypto.randomUUID();
    return leadSessionToken.current;
  }

  const whatsapp = useMemo(() => {
    const location = city ? ` Sou de ${city}.` : "";
    const areas = selectedRegions.length ? ` Tenho interesse em: ${selectedRegions.join(", ")}.` : "";
    const message = booking
      ? `Olá! Sou ${name}.${location} Fiz o quiz de Botox e pré-reservei ${formatSlot(booking.starts_at)}. Quero confirmar os detalhes.`
      : `Olá! Sou ${name || "cliente"}.${location}${areas} Fiz o quiz de Botox da PS Estética e quero falar sobre uma avaliação.`;
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  }, [booking, city, name, selectedRegions]);

  useEffect(() => {
    if (trackedViewContent.current) return;
    trackedViewContent.current = true;
    trackMetaEvent("ViewContent", trackingContent);
  }, []);

  useEffect(() => {
    if (step === 6 && !trackedContactView.current) {
      trackedContactView.current = true;
      trackMetaCustomEvent("QuizContactView", trackingContent);
    }
  }, [step]);

  // A cada troca de etapa, leva o topo do cartão (progresso + título) para a vista e move o foco para o título.
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    const card = cardRef.current;
    if (!card) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const frame = requestAnimationFrame(() => {
      card.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      const title = card.querySelector<HTMLElement>("h3");
      if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
    });
    return () => cancelAnimationFrame(frame);
  }, [step]);

  function start() {
    if (step !== 0) return;
    if (!trackedQuizStart.current) {
      trackedQuizStart.current = true;
      trackMetaCustomEvent("QuizStart", trackingContent);
    }
    setStep(1);
  }

  function toggleRegion(region: string) {
    setLead(null);
    setSelectedRegions((old) => {
      if (old.includes(region)) return old.filter((item) => item !== region);
      return region === UNSURE_REGION ? [region] : [...old.filter((item) => item !== UNSURE_REGION), region];
    });
  }

  function choose(value: string) {
    if (!current) return;
    setAnswers((old) => ({ ...old, [current.key]: value }));
    setLead(null);
    window.setTimeout(() => setStep((step + 1) as Step), 140);
  }

  function source() {
    const p = new URLSearchParams(window.location.search);
    return {
      landing_page: "botox", quiz_answers: { ...answers, regions: selectedRegions, city },
      utm_source: p.get("utm_source"), utm_medium: p.get("utm_medium"), utm_campaign: p.get("utm_campaign"), utm_content: p.get("utm_content"), utm_term: p.get("utm_term"), fbclid: p.get("fbclid"),
      referrer: document.referrer || null, fbp: cookie("_fbp"), fbc: cookie("_fbc"),
    };
  }

  async function saveLead(withEmail = false) {
    if (lead && !withEmail) return lead;
    const timing = answers.timing === "O quanto antes" ? "semana" : answers.timing === "Nas próximas semanas" ? "quinzena" : "pesquisando";
    const { data, error } = await supabase.rpc("capture_lead_session_v2", {
      p_session_token: getLeadSessionToken(), p_name: name.trim(), p_phone: whatsappDigits(phone), p_service_slug: "botox",
      p_experience: answers.experience === "Nunca fiz" ? "primeira" : "ja_fiz", p_timing: timing,
      p_city: city, p_source: source(), p_email: withEmail ? email.trim().toLowerCase() : null,
    });
    const row = data?.[0] as Lead | undefined;
    if (error || !row) return null;
    const next = { lead_id: Number(row.lead_id), reservation_token: row.reservation_token };
    setLead(next);
    if (trackedLead.current !== next.lead_id) {
      trackedLead.current = next.lead_id;
      trackMetaEvent("Lead", { content_name: "Quiz Botox", content_category: "botox" }, `lead-${next.lead_id}-lead`);
      void supabase.functions.invoke("meta-lead", {
        body: { lead_id: next.lead_id, reservation_token: next.reservation_token },
      }).then(({ error: capiError }) => {
        if (capiError) console.warn("Meta Conversions API Lead event was not sent", capiError.message);
      });
    }
    return next;
  }

  async function loadSlots() {
    const { data, error } = await supabase.rpc("list_open_slots", { p_service_slug: "botox" });
    if (error) { setSlots([]); setNotice("Não foi possível consultar a agenda agora. Fale com a equipe pelo WhatsApp."); }
    else setSlots(((data ?? []) as Slot[]).slice(0, 8));
  }

  async function submitContact(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;
    if (city.length < 2) { setNotice("Informe sua cidade para continuar."); return; }
    if (!isValidBrazilianWhatsapp(phone)) { setPhoneTouched(true); phoneRef.current?.focus(); return; }
    setLoading(true); setNotice("");
    if (!await saveLead()) { setNotice("Não conseguimos registrar seus dados agora. Confira os dados e tente novamente."); setLoading(false); return; }
    setStep(7);
    await loadSlots();
    setLoading(false);
  }

  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || loading) return;
    if (!isValidCpf(cpf)) { setNotice(INVALID_CPF_MESSAGE); return; }
    setLoading(true); setNotice("");
    const session = await saveLead(true);
    if (!session) { setNotice("Não foi possível validar seus dados. Confira o e-mail e tente novamente."); setLoading(false); return; }
    const { data, error } = await supabase.rpc("reserve_slot_secure", { p_lead_id: session.lead_id, p_reservation_token: session.reservation_token, p_slot_id: selected.slot_id });
    if (error || !data?.[0]) { setNotice("Este horário acabou de ficar indisponível. Escolha outra opção."); await loadSlots(); setSelected(null); setLoading(false); return; }
    const next = data[0] as Booking;
    setBooking(next); setStep(8);
    trackMetaEvent("Schedule", { content_name: next.service_name, content_ids: ["botox"], content_type: "product", currency: "BRL", value: next.deposit_cents / 100 }, `booking-${next.booking_id}-schedule`);
    const { data: pixData, error: pixError } = await supabase.functions.invoke("create-pix", { body: { bookingToken: next.booking_token, cpf: cpfDigits(cpf) } });
    if (pixError || !pixData?.payment) setNotice(pixData?.error ?? "Sua vaga foi separada, mas não foi possível gerar o Pix agora.");
    else {
      setPix(pixData.payment as Pix);
      trackMetaEvent("InitiateCheckout", { content_name: next.service_name, content_ids: ["botox"], content_type: "product", currency: "BRL", value: next.deposit_cents / 100 });
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
          trackMetaEvent("Purchase", { content_name: booking.service_name, content_ids: ["botox"], content_type: "product", currency: "BRL", value: booking.deposit_cents / 100 }, `booking-${booking.booking_id}-purchase`);
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

  const regionButton = (region: string) => (
    <button type="button" key={region} className={selectedRegions.includes(region) ? s.selected : ""} aria-pressed={selectedRegions.includes(region)} onClick={() => toggleRegion(region)}>
      <span>{region}</span><i>{selectedRegions.includes(region) ? "✓" : "+"}</i>
    </button>
  );

  return <main className={s.page}>
    <header className={s.header}>
      <a href="#inicio" aria-label="PS Estética — início"><Image src="/ps-estetica-logo-oficial.png" width={246} height={80} alt="PS Estética Avançada" priority /></a>
      <a className={s.headerCta} href={whatsapp} target="_blank" rel="noreferrer">Falar com a equipe</a>
    </header>

    <section className={s.hero} id="inicio">
      <div className={s.heroCopy}><p className={s.eyebrow}>Botox • PS Estética</p><h1>Linhas de expressão suavizadas, <em>com a sua expressão preservada</em></h1><p className={s.heroText}>Responda algumas perguntas rápidas sobre as regiões que você gostaria de avaliar. Em menos de um minuto, você recebe uma indicação inicial e pode escolher um horário para a avaliação.</p><button className={s.primary} onClick={start}>Começar o quiz <span>›</span></button><p className={s.heroTrust}><b>Atendimento na PS Estética • ABC Paulista</b><span>Avaliação individual antes de qualquer aplicação</span></p></div>
      <div className={s.heroPanel}><span className={s.orbit} aria-hidden="true" /><p>Indicação inicial em menos de 1 minuto</p><strong>5 perguntas</strong><ul><li>Regiões que você quer avaliar</li><li>Seu histórico com o procedimento</li><li>O que você espera do resultado</li></ul><small>Sem diagnóstico automático. Você será avaliado individualmente.</small></div>
    </section>

    <section className={s.benefits}><div className={s.sectionIntro}><p className={s.eyebrow}>Onde pode ajudar</p><h2>O que o Botox pode ajudar a suavizar?</h2><p>O Botox é o nome popular da toxina botulínica, um medicamento que relaxa a musculatura responsável pelas linhas de expressão. A indicação, a dose e os pontos de aplicação dependem da avaliação de cada pessoa.</p></div><div className={s.benefitGrid}>{benefits.map(([n, title, text]) => <article key={n}><span>{n}</span><h3>{title}</h3><p>{text}</p></article>)}</div><p className={s.disclaimer}>Cada pessoa responde de uma forma. Por isso, indicação, dose e protocolo são definidos individualmente por profissional habilitado, e os resultados não são garantidos.</p></section>

    <section className={s.fit}><div><p className={s.eyebrow}>Para quem pode fazer sentido</p><h2>Um planejamento pensado a partir de como você se expressa</h2></div><div className={s.fitCards}><article><span>01</span><h3>Você quer naturalidade</h3><p>Prefere suavizar as linhas sem perder a mobilidade e o jeito de se expressar.</p></article><article><span>02</span><h3>Você busca orientação personalizada</h3><p>Quer entender possibilidades e cuidados antes de decidir, sem pressão e sem protocolo genérico.</p></article><article><span>03</span><h3>Você está disponível para uma avaliação</h3><p>Histórico de saúde, expectativas e a análise da sua expressão ajudam a definir se e como realizar.</p></article></div></section>

    <section className={s.how}><div className={s.sectionIntro}><p className={s.eyebrow}>Como funciona</p><h2>Da sua dúvida a uma decisão com mais segurança</h2></div><ol><li><span>1</span><div><h3>Responda o quiz</h3><p>Perguntas objetivas ajudam a organizar o que você quer avaliar.</p></div></li><li><span>2</span><div><h3>Receba a indicação inicial</h3><p>Entenda se a avaliação de toxina botulínica pode ser um bom próximo passo.</p></div></li><li><span>3</span><div><h3>Pré-agende sua avaliação</h3><p>Escolha um horário e confirme a pré-reserva online, ou prefira falar direto pelo WhatsApp.</p></div></li></ol></section>

    <section className={s.faq}><div className={s.sectionIntro}><p className={s.eyebrow}>Dúvidas frequentes</p><h2>O que as pessoas mais perguntam</h2></div><div className={s.faqList}>{faq.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>

    <section className={s.confidence}><p className={s.eyebrow}>Decisão com segurança</p><h2>Avaliação antes de qualquer aplicação.</h2><p>O quiz organiza seus objetivos, mas não realiza diagnóstico e não garante indicação. A aplicação é feita por profissional habilitado, depois de avaliar seu histórico, suas expectativas e a sua expressão.</p><div><span>PS Estética</span><span>São Bernardo do Campo</span><span>Atendimento individualizado</span></div><a className={s.primary} href="#diagnostico">Fazer o quiz <span>›</span></a></section>

    <section className={s.quizSection} id="diagnostico">
      <div className={s.quizIntro}><p className={s.eyebrow}>Seu quiz de Botox</p><h2>Poucas respostas para uma conversa mais objetiva.</h2><p>Leva cerca de um minuto. Ao final, você pode escolher um horário para a avaliação ou falar com a equipe pelo WhatsApp.</p></div>
      <div className={s.quizCard} ref={cardRef} aria-live="polite">
        <div className={s.quizTop}><span>{step === 0 ? "Pronto para começar" : step <= 5 ? `Pergunta ${step} de 5` : step === 6 ? "Seus dados" : step === 7 ? "Indicação e agenda" : "Pré-reserva"}</span><b>{progress}%</b></div><div className={s.progress}><span style={{ width: `${progress}%` }} /></div>
        {step === 0 && <div className={s.quizBody}><p className={s.quizKicker}>Quiz Botox • PS Estética</p><h3>Descubra se o Botox faz sentido para você</h3><p className={s.quizText}>Responda algumas perguntas rápidas. Em menos de um minuto, você recebe uma indicação inicial de acordo com seus objetivos.</p><button className={s.primary} onClick={start}>Começar o quiz <span>›</span></button><p className={s.cardTrust}>Atendimento na PS Estética • ABC Paulista<br /><span>Avaliação individual antes de qualquer aplicação</span></p></div>}
        {step === 1 && <div className={`${s.quizBody} ${s.regionsStep}`}><p className={s.quizKicker}>Vamos começar pelo seu objetivo</p><h3>Quais regiões você gostaria de avaliar?</h3><p className={s.quizText}>Escolha quantas quiser.</p><div className={s.options}>{regions.map((region, index) => (index < primaryRegionCount || moreRegionsOpen) && regionButton(region))}</div>{!moreRegionsOpen && <button type="button" className={s.moreRegions} aria-expanded="false" onClick={() => setShowMoreRegions(true)}>Ver mais regiões <span aria-hidden="true">+</span></button>}<div className={s.regionsAction}><button type="button" className={s.primary} disabled={selectedRegions.length === 0} onClick={() => setStep(2)}>{selectedRegions.length === 0 ? "Escolha uma opção" : `Continuar • ${selectedRegions.length} ${selectedRegions.length === 1 ? "opção" : "opções"}`} <span>›</span></button></div></div>}
        {current && <div className={s.quizBody}><p className={s.quizKicker}>{current.eyebrow}</p><h3>{current.title}</h3><div className={s.options}>{current.options.map((option) => <button key={option} className={answers[current.key] === option ? s.selected : ""} onClick={() => choose(option)}><span>{option}</span><i>›</i></button>)}</div><button className={s.back} onClick={() => setStep((step - 1) as Step)}>Voltar</button></div>}
        {step === 5 && <div className={s.quizBody}><p className={s.quizKicker}>Localização do atendimento</p><h3>Você está em São Bernardo do Campo ou região?</h3><p className={s.quizText}>Essa informação ajuda a equipe a priorizar a melhor forma de atendimento.</p><div className={s.options}>{cityOptions.map((option) => <button key={option} className={cityChoice === option ? s.selected : ""} onClick={() => { setCityChoice(option); setLead(null); setNotice(""); if (option !== "Outra cidade") window.setTimeout(() => setStep(6), 140); }}><span>{option}</span><i>›</i></button>)}</div>{cityChoice === "Outra cidade" && <div className={s.contactForm}><label>Qual cidade?<input required minLength={2} maxLength={120} value={otherCity} onChange={(event) => { setOtherCity(event.target.value); setLead(null); }} placeholder="Digite sua cidade" autoComplete="address-level2" /></label><button type="button" className={s.primary} disabled={otherCity.trim().length < 2} onClick={() => setStep(6)}>Continuar <span>›</span></button></div>}<button className={s.back} onClick={() => setStep(4)}>Voltar</button></div>}
        {step === 6 && <form className={`${s.quizBody} ${s.contactForm}`} onSubmit={submitContact}><p className={s.quizKicker}>Sua indicação inicial está quase pronta</p><h3>Deixe seu nome e WhatsApp para ver a indicação.</h3><p className={s.quizText}>Você também poderá escolher um horário para a avaliação na PS Estética.</p><label>Nome<input required value={name} onChange={(e) => { setName(e.target.value); setLead(null); }} autoComplete="name" enterKeyHint="next" placeholder="Como podemos chamar você?" minLength={2} /></label><label>WhatsApp<input ref={phoneRef} type="tel" value={phone} onChange={(e) => { setPhone(maskWhatsappInput(e.target.value)); setLead(null); setNotice(""); }} onBlur={() => { if (phone) setPhoneTouched(true); }} autoComplete="tel-national" inputMode="numeric" enterKeyHint="send" placeholder="(11) 90000-0000" aria-invalid={phoneError} aria-describedby={phoneError ? "botox-phone-error" : undefined} />{phoneError && <small id="botox-phone-error" className={s.fieldError} role="alert">{SHORT_INVALID_WHATSAPP_MESSAGE}</small>}</label><button className={s.primary} disabled={loading} type="submit">{loading ? "Preparando sua indicação…" : "Ver minha indicação"} <span>›</span></button>{notice && <p className={s.notice}>{notice}</p>}<button className={s.back} type="button" onClick={() => setStep(5)}>Voltar</button><small className={s.privacy}>Seus dados serão usados apenas para o atendimento da PS Estética.</small></form>}
        {step === 7 && <div className={s.quizBody}><p className={s.resultLabel}>Sua indicação inicial</p><h3>Uma avaliação de toxina botulínica pode ser uma boa conversa para você.</h3><p className={s.resultText}>Pelas suas respostas, o seu interesse em <b>{regionsLabel.toLowerCase()}</b> pode ser conversado em uma avaliação individual. A indicação final, a dose e os pontos de aplicação dependem de avaliação profissional.</p><div className={s.answerSummary}><span>O que você busca</span><strong>{answers.goal}</strong></div><div className={s.scheduleHead}><p className={s.quizKicker}>Próximo passo opcional</p><h4>Escolha um horário para sua avaliação</h4></div>{loading && <p className={s.notice}>Consultando a agenda…</p>}{!loading && slots.length > 0 && <div className={s.slots}>{slots.map((slot) => <button key={slot.slot_id} onClick={() => { setSelected(slot); setNotice(""); }} className={selected?.slot_id === slot.slot_id ? s.selectedSlot : ""}><span><small>{selected?.slot_id === slot.slot_id ? "Selecionado" : "Disponível"}</small>{formatSlot(slot.starts_at)}</span><i>{selected?.slot_id === slot.slot_id ? "✓" : "›"}</i></button>)}</div>}{!loading && slots.length === 0 && <div className={s.empty}><b>Não encontrou um horário?</b><p>A equipe pode consultar outras possibilidades para você.</p><a href={whatsapp} target="_blank" rel="noreferrer">Falar pelo WhatsApp</a></div>}{selected && <form className={s.reserveBox} onSubmit={reserve}><div><small>Horário escolhido</small><b>{formatSlot(selected.starts_at)}</b></div><label>E-mail para receber a confirmação<input required type="email" value={email} onChange={(e) => { setEmail(e.target.value); setNotice(""); }} autoComplete="email" placeholder="voce@exemplo.com" /></label><label>CPF para gerar o Pix<input required inputMode="numeric" autoComplete="off" maxLength={14} value={cpf} onChange={(event) => { setCpf(formatCpf(event.target.value)); setNotice(""); }} placeholder="000.000.000-00" /></label><button className={s.primary} disabled={loading} type="submit">{loading ? "Criando pré-reserva…" : "Pré-reservar este horário"} <span>›</span></button></form>}{!loading && slots.length > 0 && <a className={s.whatsapp} href={whatsapp} target="_blank" rel="noreferrer">Prefiro falar com a equipe no WhatsApp</a>}{notice && <p className={s.notice}>{notice}</p>}</div>}
        {step === 8 && booking && <div className={s.quizBody}><p className={s.resultLabel}>Horário separado para você</p><h3>{formatSlot(booking.starts_at)}</h3><p className={s.quizText}>A pré-reserva é confirmada após o pagamento do sinal. O valor será descontado do atendimento.</p>{paid && <p className={s.success}>Pagamento confirmado. Seu horário está garantido.</p>}{!paid && pix?.qr_code_base64 && <div className={s.pixBox}><div><small>Sinal da avaliação</small><strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(booking.deposit_cents / 100)}</strong><p>Escaneie o QR Code ou copie o código Pix.</p>{pix.pix_copy_paste && <button type="button" onClick={copyPix}>Copiar código Pix</button>}</div><Image unoptimized src={`data:image/png;base64,${pix.qr_code_base64}`} width={140} height={140} alt="QR Code para pagamento Pix" /></div>}{notice && <p className={s.notice}>{notice}</p>}<a className={s.whatsapp} href={whatsapp} target="_blank" rel="noreferrer">Falar com a equipe no WhatsApp</a></div>}
      </div>
    </section>
    <footer className={s.footer}><Image src="/ps-estetica-logo-oficial.png" width={246} height={80} alt="PS Estética" /><p>São Bernardo do Campo • ABC Paulista</p><small>O conteúdo desta página é informativo. A indicação de qualquer procedimento depende de avaliação individual por profissional habilitado, e os resultados variam de pessoa para pessoa.</small></footer>
  </main>;
}
