"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { trackMetaCustomEvent, trackMetaEvent } from "../../lib/meta-pixel";
import { supabase } from "../../lib/supabase";
import { isValidBrazilianWhatsapp, maskWhatsappInput, SHORT_INVALID_WHATSAPP_MESSAGE, whatsappDigits } from "../../lib/whatsapp";
import { cpfDigits, formatCpf, INVALID_CPF_MESSAGE, isValidCpf } from "../../lib/cpf";
import s from "../lavieen/lavieen.module.css";
import b from "./botox.module.css";

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

const faq = [
  ["Dói?", "A maioria das pessoas descreve um desconforto leve e rápido, porque as agulhas são muito finas. A equipe explica o procedimento antes e você pode tirar dúvidas durante a avaliação."],
  ["Vou ficar com a expressão “congelada”?", "O objetivo de um bom planejamento é suavizar as linhas mantendo a naturalidade. Dose e pontos de aplicação são definidos de forma individual, depois de analisar como você se expressa."],
  ["Quando o Botox começa a fazer efeito?", "O efeito aparece aos poucos, geralmente a partir de 2 a 5 dias, e costuma chegar ao ponto máximo em cerca de duas semanas. O tempo varia de pessoa para pessoa."],
  ["Quanto tempo o Botox dura?", "Em geral, de 3 a 6 meses, dependendo da região, da dose e do organismo. A avaliação define a melhor frequência para o seu caso."],
  ["Existe algum risco?", "Como todo procedimento, sim. Os mais comuns são pequenos roxos, dor ou irritação no local, dor de cabeça e assimetria temporária. Mais raro, pode ocorrer queda da pálpebra ou da sobrancelha, em geral quando a dose ou o ponto de aplicação não é adequado. Por isso a avaliação e a escolha do profissional importam."],
  ["O que faço depois da sessão?", "A equipe passa as orientações para o seu caso, como evitar esforço físico intenso e exposição ao sol se houver roxo."],
  ["Quanto custa?", "O valor depende das regiões e da dose indicadas para você, e é informado na avaliação, antes de você decidir."],
  ["Quem não deve fazer Botox?", "Gestantes e lactantes, pessoas com alergia aos componentes, infecção na região, doenças neuromusculares ou fraqueza muscular. Por isso a avaliação e o histórico de saúde vêm antes de qualquer aplicação."],
  ["Preciso decidir agora?", "Não. O quiz e a avaliação servem para você entender as possibilidades. A aplicação só acontece se for indicada e se você decidir seguir."],
];

const CTA_TEXT = "Quero agendar minha avaliação de Botox";
const CTA_MICRO = "Quiz de 1 minuto. Sem compromisso. A aplicação só acontece depois da avaliação.";

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
  const quizSectionRef = useRef<HTMLElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLSpanElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [quizInView, setQuizInView] = useState(false);
  const current = step >= 2 && step <= 4 ? questions[step - 2] : null;
  const progress = step === 0 ? 0 : step <= 5 ? step * 16 : step === 6 ? 90 : 100;
  const city = cityChoice === "Outra cidade" ? otherCity.trim() : cityChoice;
  const phoneError = phoneTouched && !isValidBrazilianWhatsapp(phone);
  const moreRegionsOpen = showMoreRegions || selectedRegions.some((region) => regions.indexOf(region) >= primaryRegionCount);
  const stickyVisible = scrolled && step === 0 && !quizInView;

  function getLeadSessionToken() {
    leadSessionToken.current ??= window.crypto.randomUUID();
    return leadSessionToken.current;
  }

  const whatsapp = useMemo(() => {
    const location = city ? ` Sou de ${city}.` : "";
    const message = booking
      ? `Olá! Sou ${name}.${location} Fiz o quiz de Botox e pré-reservei ${formatSlot(booking.starts_at)}. Quero confirmar os detalhes.`
      : "Olá! Fiz o quiz de Botox da PS Estética e quero agendar minha avaliação.";
    return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  }, [booking, city, name]);

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

  // Rolagem: botão fixo do mobile (aparece depois do topo e some com o quiz à vista ou aberto), barra de leitura, cabeçalho e parallax.
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      setScrolled(y > 520);
      const root = rootRef.current;
      if (root) { root.style.setProperty("--sy", String(Math.round(y))); root.dataset.scrolled = y > 12 ? "1" : "0"; }
      if (barRef.current) barRef.current.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => { window.removeEventListener("scroll", onScroll); if (frame) window.cancelAnimationFrame(frame); };
  }, []);

  // Revelação ao rolar: só esconde o que está abaixo da dobra e mostra quando entra na tela (sem script ou com movimento reduzido, tudo aparece).
  useEffect(() => {
    const root = rootRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target as HTMLElement;
        observer.unobserve(el);
        el.classList.add(b.revealIn);
        window.setTimeout(() => el.classList.remove(b.revealPre, b.revealIn), 1500 + (Number.parseFloat(el.style.transitionDelay) || 0));
      });
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    root.querySelectorAll<HTMLElement>("[data-reveal]").forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
      const siblings = Array.from(el.parentElement?.children ?? []).filter((child) => child.hasAttribute("data-reveal"));
      el.style.transitionDelay = `${Math.max(0, siblings.indexOf(el)) * 90}ms`;
      el.classList.add(b.revealPre);
      observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = quizSectionRef.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const observer = new IntersectionObserver(([entry]) => setQuizInView(entry.isIntersecting), { threshold: 0.05 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  function start() {
    if (step !== 0) return;
    if (!trackedQuizStart.current) {
      trackedQuizStart.current = true;
      trackMetaCustomEvent("QuizStart", trackingContent);
    }
    setStep(1);
  }

  // Todos os CTAs da página usam esta ação: o mesmo "Começar o quiz" (start), ou voltam ao quiz se ele já está aberto.
  function goToQuiz() {
    if (step === 0) { start(); return; }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRef.current?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }

  const cta = (withMicro: boolean, light = false, hero = false) => (
    <div className={b.cta} {...(hero ? {} : { "data-reveal": "" })}>
      <button type="button" className={`${s.primary} ${b.ctaBtn} ${light ? b.light : ""} ${hero ? b.ctaHero : ""}`} onClick={goToQuiz}>{CTA_TEXT} <span>›</span></button>
      {withMicro && <p className={b.micro}>{CTA_MICRO}</p>}
    </div>
  );

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

  return <main ref={rootRef} className={`${s.page} ${b.landing}`}>
    <div className={b.bar} aria-hidden="true"><span ref={barRef} /></div>
    <header className={`${s.header} ${b.headerBar}`}>
      <a href="#inicio" aria-label="PS Estética, início"><Image src="/ps-estetica-logo-oficial.png" width={246} height={80} alt="PS Estética Avançada" priority /></a>
      <a className={s.headerCta} href={whatsapp} target="_blank" rel="noreferrer">Falar com a equipe</a>
    </header>

    <section className={`${s.hero} ${b.heroOn}`} id="inicio">
      <div className={`${s.heroCopy} ${b.heroIn}`}>
        <p className={s.eyebrow}>Botox • PS Estética • São Bernardo do Campo</p>
        <h1>Botox para suavizar rugas e linhas de expressão, <em>com aparência natural</em></h1>
        <p className={s.heroText}>Responda 5 perguntas rápidas, veja se o Botox faz sentido para você e agende sua avaliação na PS Estética, em São Bernardo do Campo.</p>
        {cta(true, false, true)}
        <ul className={b.trust}><li>Avaliação individual antes de qualquer aplicação</li><li>Profissional habilitado</li><li>Atendimento em São Bernardo do Campo, ABC Paulista</li></ul>
      </div>
      <div className={`${s.heroPanel} ${b.panelIn}`}><span className={`${s.orbit} ${b.orbitPulse}`} aria-hidden="true" /><p>Indicação inicial em 1 minuto</p><strong>5 perguntas</strong><ul><li>Avaliação individual antes de qualquer aplicação</li><li>Profissional habilitado</li><li>Atendimento em São Bernardo do Campo, ABC Paulista</li></ul><small>Sem diagnóstico automático. Você será avaliado individualmente.</small></div>
    </section>

    <section className={s.benefits}>
      <div className={s.sectionIntro} data-reveal><p className={s.eyebrow}>Reconhecimento</p><h2>Você olha no espelho e vê isso?</h2></div>
      <div className={`${s.benefitGrid} ${b.grid4}`}>
        <article data-reveal><span>01</span><h3>Linhas na testa quando levanta a sobrancelha.</h3></article>
        <article data-reveal><span>02</span><h3>A linha vertical entre as sobrancelhas, o “11”, que dá cara de bravo ou de cansaço.</h3></article>
        <article data-reveal><span>03</span><h3>Pés de galinha ao redor dos olhos quando sorri.</h3></article>
        <article data-reveal><span>04</span><h3>Vontade de fazer Botox, mas medo de exagerar e ficar com o rosto sem expressão.</h3></article>
      </div>
      <p className={b.lead} data-reveal>Se você se reconheceu, o Botox pode ser uma opção para avaliar. E a PS Estética começa pela avaliação, não pela agulha.</p>
      {cta(false)}
    </section>

    <div className={b.band}><section className={s.benefits}>
      <div className={s.sectionIntro} data-reveal><p className={s.eyebrow}>O que é</p><h2>O que é o Botox e como ele funciona</h2><p>Botox é o nome mais conhecido da toxina botulínica, um medicamento aplicado em pontos específicos do rosto. Os músculos do rosto se contraem quando o nervo manda um sinal. O Botox bloqueia esse sinal em pontos escolhidos. Com o músculo trabalhando com menos força ali, a pele marca menos as rugas de expressão.</p></div>
      <div className={`${s.benefitGrid} ${b.grid2}`}>
        <article data-reveal><span>01</span><h3>O efeito é temporário</h3><p>Ele vai diminuindo aos poucos e o músculo volta a se mover normalmente. Por isso o tratamento é repetido ao longo do tempo, na frequência que a avaliação indicar.</p></article>
        <article data-reveal><span>02</span><h3>Por que tanta gente tem medo de ficar com o rosto parado?</h3><p>Porque dose e pontos de aplicação mal planejados tiram movimento demais. Na PS Estética, os dois são definidos olhando como você levanta a sobrancelha e como você sorri.</p></article>
      </div>
      <p className={s.disclaimer} data-reveal>Cada pessoa responde de uma forma. Indicação, dose e protocolo são definidos individualmente por profissional habilitado, e os resultados não são garantidos.</p>
    </section></div>

    <section className={s.benefits}>
      <div className={s.sectionIntro} data-reveal><p className={s.eyebrow}>Onde pode ajudar</p><h2>Onde o Botox pode ajudar</h2><p>Cada região é avaliada separadamente. Você só faz o que for indicado para o seu caso.</p></div>
      <div className={`${s.benefitGrid} ${b.grid3}`}>
        <article data-reveal><span>01</span><h3>Testa</h3><p>As linhas horizontais que aparecem quando você levanta a sobrancelha.</p></article>
        <article data-reveal><span>02</span><h3>Entre as sobrancelhas</h3><p>As linhas verticais que dão cara de cansaço ou de bravo.</p></article>
        <article data-reveal><span>03</span><h3>Ao redor dos olhos</h3><p>Os pés de galinha, que aparecem quando você sorri.</p></article>
      </div>
      {cta(false)}
    </section>

    <section className={s.fit}>
      <div data-reveal><p className={s.eyebrow}>Nosso cuidado</p><h2>Como a PS Estética cuida do seu Botox</h2></div>
      <div className={s.fitCards}>
        <article data-reveal><span>01</span><h3>Avaliação antes de tudo</h3><p>Ninguém aplica nada sem olhar seu histórico de saúde, suas expectativas e a sua expressão.</p></article>
        <article data-reveal><span>02</span><h3>Plano feito para o seu rosto</h3><p>Dose e pontos definidos individualmente, sem protocolo genérico.</p></article>
        {/* TODO PROFISSIONAL HABILITADO: [[nome e registro profissional (CRM e RQE, se médico; ou o conselho correspondente) do responsável técnico: obrigatório em publicidade de saúde]]. O item "Profissional habilitado." só entra com esse dado. */}
        <article data-reveal><span>03</span><h3>Sem pressão</h3><p>Você entende as possibilidades e decide no seu tempo.</p></article>
      </div>
    </section>

    <section className={s.benefits}>
      <div className={s.sectionIntro} data-reveal><p className={s.eyebrow}>Para quem</p><h2>O Botox faz sentido para você?</h2></div>
      <div className={b.two}>
        <div className={`${b.col} ${b.yes}`} data-reveal><h3>Pode fazer sentido se você</h3><ul><li>Quer suavizar as linhas sem perder a mobilidade do rosto.</li><li>Quer entender possibilidades e cuidados antes de decidir.</li><li>Pode ir a uma avaliação presencial em São Bernardo do Campo.</li></ul></div>
        <div className={`${b.col} ${b.no}`} data-reveal><h3>Não deve fazer</h3><ul><li>Gestantes e lactantes.</li><li>Pessoas com alergia aos componentes.</li><li>Pessoas com infecção na região.</li><li>Pessoas com doenças neuromusculares ou fraqueza muscular.</li></ul></div>
      </div>
      <p className={s.disclaimer} data-reveal>Por isso a avaliação e o histórico de saúde vêm antes de qualquer aplicação.</p>
    </section>

    <div className={b.band}><section className={`${s.how} ${b.howWide}`}>
      <div className={s.sectionIntro} data-reveal><p className={s.eyebrow}>Passo a passo</p><h2>Do quiz à sessão de Botox em 5 passos</h2></div>
      <ol className={b.steps5}>
        <li data-reveal><span>1</span><div><h3>Responda o quiz</h3><p>5 perguntas, menos de 1 minuto.</p></div></li>
        <li data-reveal><span>2</span><div><h3>Receba a indicação inicial</h3><p>Você vê se a avaliação de Botox é um bom próximo passo.</p></div></li>
        <li data-reveal><span>3</span><div><h3>Escolha o horário</h3><p>Pré-agende online ou fale direto pelo WhatsApp.</p></div></li>
        <li data-reveal><span>4</span><div><h3>Faça a avaliação presencial</h3><p>Um profissional habilitado analisa seu histórico, suas expectativas e a sua expressão.</p></div></li>
        <li data-reveal><span>5</span><div><h3>Faça a sessão, se for indicada</h3><p>A aplicação só acontece se o profissional indicar e se você decidir seguir.</p></div></li>
      </ol>
      {cta(false)}
    </section></div>

    {/* TODO PROVA SOCIAL (seção não renderizada até ter conteúdo real). Título previsto: "Quem já fez conta como foi". Conteúdo: [[vídeos curtos de 15 a 20s e/ou prints de depoimentos de pacientes reais, com autorização por escrito]] [[nota e número de avaliações do Google]]. Não publicar sem conteúdo real. */}

    {/* TODO QUEM VAI CUIDAR DE VOCÊ (versão completa): [[foto, nome, registro profissional e 2 linhas sobre o profissional responsável]] [[foto e endereço da clínica]]. Enquanto isso, só o texto abaixo. */}
    <section className={s.benefits}>
      <div className={s.sectionIntro} data-reveal><p className={s.eyebrow}>Quem vai cuidar de você</p><p className={b.lead} style={{ margin: 0 }} data-reveal>PS Estética Avançada, em São Bernardo do Campo, ABC Paulista. Atendimento individualizado.</p></div>
    </section>

    <section className={s.faq}><div className={s.sectionIntro} data-reveal><p className={s.eyebrow}>Dúvidas</p><h2>Perguntas frequentes sobre Botox</h2></div>
      {/* TODO FAQ (textos renderizados, aguardando confirmação da clínica): [[confirmar o prazo de efeito máximo com o profissional responsável]] [[confirmar o protocolo de pós-aplicação da clínica]] [[confirmar o valor/condição: se houver valor da avaliação ou condição promocional, informar aqui e no fechamento]] */}
      <div className={`${s.faqList} ${b.faqx}`}>{faq.map(([question, answer]) => <details key={question} data-reveal><summary>{question}</summary><p>{answer}</p></details>)}</div></section>

    <section className={`${s.confidence} ${b.closing}`}>
      <p className={s.eyebrow} data-reveal>Decisão com segurança</p>
      <h2 data-reveal>Descubra em 1 minuto se o Botox serve para você</h2>
      <p data-reveal>São 5 perguntas sobre as regiões que você quer avaliar, o seu histórico e o que você espera do resultado. No final, você escolhe um horário para a avaliação ou fala com a equipe pelo WhatsApp.</p>
      {cta(true, true)}
      <p className={b.closingNote} data-reveal>A avaliação vem antes de qualquer aplicação. Você só faz Botox se for indicado e se quiser.</p>
    </section>

    <section className={s.quizSection} id="diagnostico" ref={quizSectionRef}>
      <div className={s.quizIntro}><p className={s.eyebrow}>Seu quiz de Botox</p><h2>Poucas respostas para uma conversa mais objetiva.</h2><p>Leva cerca de um minuto. Ao final, você pode escolher um horário para a avaliação ou falar com a equipe pelo WhatsApp.</p></div>
      <div className={`${s.quizCard} ${b.cardTop}`} ref={cardRef} aria-live="polite">
        <div className={s.quizTop}><span>{step === 0 ? "Pronto para começar" : step <= 5 ? `Pergunta ${step} de 5` : step === 6 ? "Seus dados" : step === 7 ? "Indicação e agenda" : "Pré-reserva"}</span><b>{progress}%</b></div><div className={s.progress}><span style={{ width: `${progress}%` }} /></div>
        <div key={step} className={b.stepIn}>
        {step === 0 && <div className={s.quizBody}><p className={s.quizKicker}>5 perguntas • menos de 1 minuto</p><h3>Vamos ver se o Botox faz sentido para você</h3><p className={s.quizText}>No final, você recebe uma indicação inicial e escolhe o horário da sua avaliação.</p><ol className={b.preview}><li><span>1</span>Regiões que você quer avaliar</li><li><span>2</span>Seu histórico com o procedimento</li><li><span>3</span>O que você espera do resultado</li><li><span>4</span>Quando você quer fazer</li><li><span>5</span>Sua cidade</li></ol><button className={s.primary} onClick={start}>Começar o quiz <span>›</span></button><p className={s.cardTrust}>Sem diagnóstico automático. Você será avaliado individualmente.</p></div>}
        {step === 1 && <div className={`${s.quizBody} ${s.regionsStep}`}><p className={s.quizKicker}>Vamos começar pelo seu objetivo</p><h3>Quais regiões você gostaria de avaliar?</h3><p className={s.quizText}>Escolha quantas quiser.</p><div className={s.options}>{regions.map((region, index) => (index < primaryRegionCount || moreRegionsOpen) && regionButton(region))}</div>{!moreRegionsOpen && <button type="button" className={s.moreRegions} aria-expanded="false" onClick={() => setShowMoreRegions(true)}>Ver mais regiões <span aria-hidden="true">+</span></button>}<div className={s.regionsAction}><button type="button" className={s.primary} disabled={selectedRegions.length === 0} onClick={() => setStep(2)}>{selectedRegions.length === 0 ? "Escolha uma opção" : `Continuar • ${selectedRegions.length} ${selectedRegions.length === 1 ? "opção" : "opções"}`} <span>›</span></button></div></div>}
        {current && <div className={s.quizBody}><p className={s.quizKicker}>{current.eyebrow}</p><h3>{current.title}</h3><div className={s.options}>{current.options.map((option) => <button key={option} className={answers[current.key] === option ? s.selected : ""} onClick={() => choose(option)}><span>{option}</span><i>›</i></button>)}</div><button className={s.back} onClick={() => setStep((step - 1) as Step)}>Voltar</button></div>}
        {step === 5 && <div className={s.quizBody}><p className={s.quizKicker}>Localização do atendimento</p><h3>Você está em São Bernardo do Campo ou região?</h3><p className={s.quizText}>Essa informação ajuda a equipe a priorizar a melhor forma de atendimento.</p><div className={s.options}>{cityOptions.map((option) => <button key={option} className={cityChoice === option ? s.selected : ""} onClick={() => { setCityChoice(option); setLead(null); setNotice(""); if (option !== "Outra cidade") window.setTimeout(() => setStep(6), 140); }}><span>{option}</span><i>›</i></button>)}</div>{cityChoice === "Outra cidade" && <div className={s.contactForm}><label>Qual cidade?<input required minLength={2} maxLength={120} value={otherCity} onChange={(event) => { setOtherCity(event.target.value); setLead(null); }} placeholder="Digite sua cidade" autoComplete="address-level2" /></label><button type="button" className={s.primary} disabled={otherCity.trim().length < 2} onClick={() => setStep(6)}>Continuar <span>›</span></button></div>}<button className={s.back} onClick={() => setStep(4)}>Voltar</button></div>}
        {step === 6 && <form className={`${s.quizBody} ${s.contactForm}`} onSubmit={submitContact}><p className={s.quizKicker}>Sua indicação inicial está quase pronta</p><h3>Deixe seu nome e WhatsApp para ver a indicação.</h3><p className={s.quizText}>Você também poderá escolher um horário para a avaliação na PS Estética.</p><label>Nome<input required value={name} onChange={(e) => { setName(e.target.value); setLead(null); }} autoComplete="name" enterKeyHint="next" placeholder="Como podemos chamar você?" minLength={2} /></label><label>WhatsApp<input ref={phoneRef} type="tel" value={phone} onChange={(e) => { setPhone(maskWhatsappInput(e.target.value)); setLead(null); setNotice(""); }} onBlur={() => { if (phone) setPhoneTouched(true); }} autoComplete="tel-national" inputMode="numeric" enterKeyHint="send" placeholder="(11) 90000-0000" aria-invalid={phoneError} aria-describedby={phoneError ? "botox-phone-error" : undefined} />{phoneError && <small id="botox-phone-error" className={s.fieldError} role="alert">{SHORT_INVALID_WHATSAPP_MESSAGE}</small>}</label><button className={s.primary} disabled={loading} type="submit">{loading ? "Preparando sua indicação…" : "Ver minha indicação"} <span>›</span></button>{notice && <p className={s.notice}>{notice}</p>}<button className={s.back} type="button" onClick={() => setStep(5)}>Voltar</button><small className={s.privacy}>Seus dados serão usados apenas para o atendimento da PS Estética.</small></form>}
        {step === 7 && <div className={s.quizBody}><h3>Sua indicação inicial</h3><p className={s.resultText}>Pelas suas respostas, a avaliação de Botox pode ser um bom próximo passo. Quem confirma é o profissional, na avaliação presencial.</p><div className={s.answerSummary}><span>O que você busca</span><strong>{answers.goal}</strong></div><div className={b.resultActions}><button type="button" className={s.primary} onClick={() => document.getElementById("horarios")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Escolher meu horário <span>›</span></button><a className={s.whatsapp} href={whatsapp} target="_blank" rel="noreferrer">Falar com a equipe no WhatsApp</a></div><div className={`${s.scheduleHead} ${b.anchorTop}`} id="horarios"><p className={s.quizKicker}>Próximo passo opcional</p><h4>Escolha um horário para sua avaliação</h4></div>{loading && <p className={s.notice}>Consultando a agenda…</p>}{!loading && slots.length > 0 && <div className={s.slots}>{slots.map((slot) => <button key={slot.slot_id} onClick={() => { setSelected(slot); setNotice(""); }} className={selected?.slot_id === slot.slot_id ? s.selectedSlot : ""}><span><small>{selected?.slot_id === slot.slot_id ? "Selecionado" : "Disponível"}</small>{formatSlot(slot.starts_at)}</span><i>{selected?.slot_id === slot.slot_id ? "✓" : "›"}</i></button>)}</div>}{!loading && slots.length === 0 && <div className={s.empty}><b>Não encontrou um horário?</b><p>A equipe pode consultar outras possibilidades para você.</p><a href={whatsapp} target="_blank" rel="noreferrer">Falar pelo WhatsApp</a></div>}{selected && <form className={s.reserveBox} onSubmit={reserve}><div><small>Horário escolhido</small><b>{formatSlot(selected.starts_at)}</b></div><label>E-mail para receber a confirmação<input required type="email" value={email} onChange={(e) => { setEmail(e.target.value); setNotice(""); }} autoComplete="email" placeholder="voce@exemplo.com" /></label><label>CPF para gerar o Pix<input required inputMode="numeric" autoComplete="off" maxLength={14} value={cpf} onChange={(event) => { setCpf(formatCpf(event.target.value)); setNotice(""); }} placeholder="000.000.000-00" /></label><button className={s.primary} disabled={loading} type="submit">{loading ? "Criando pré-reserva…" : "Pré-reservar este horário"} <span>›</span></button></form>}{!loading && slots.length > 0 && <a className={s.whatsapp} href={whatsapp} target="_blank" rel="noreferrer">Prefiro falar com a equipe no WhatsApp</a>}{notice && <p className={s.notice}>{notice}</p>}</div>}
        {step === 8 && booking && <div className={s.quizBody}><p className={s.resultLabel}>Horário separado para você</p><h3>{formatSlot(booking.starts_at)}</h3><p className={s.quizText}>A pré-reserva é confirmada após o pagamento do sinal. O valor será descontado do atendimento.</p>{paid && <p className={s.success}>Pagamento confirmado. Seu horário está garantido.</p>}{!paid && pix?.qr_code_base64 && <div className={s.pixBox}><div><small>Sinal da avaliação</small><strong>{new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(booking.deposit_cents / 100)}</strong><p>Escaneie o QR Code ou copie o código Pix.</p>{pix.pix_copy_paste && <button type="button" onClick={copyPix}>Copiar código Pix</button>}</div><Image unoptimized src={`data:image/png;base64,${pix.qr_code_base64}`} width={140} height={140} alt="QR Code para pagamento Pix" /></div>}{notice && <p className={s.notice}>{notice}</p>}<a className={s.whatsapp} href={whatsapp} target="_blank" rel="noreferrer">Falar com a equipe no WhatsApp</a></div>}
        </div>
      </div>
    </section>
    <footer className={`${s.footer} ${b.footerPad}`}><Image src="/ps-estetica-logo-oficial.png" width={246} height={80} alt="PS Estética" /><p>São Bernardo do Campo • ABC Paulista</p><small>O conteúdo desta página é informativo. A indicação de qualquer procedimento depende de avaliação individual por profissional habilitado, e os resultados variam de pessoa para pessoa.</small>{/* TODO RESPONSÁVEL TÉCNICO no rodapé: "Responsável técnico: [[nome, registro profissional e RQE, se houver]]". Não renderizar sem o dado. */}</footer>
    <div className={`${b.sticky} ${stickyVisible ? b.stickyOn : ""}`} aria-hidden={!stickyVisible}><button type="button" className={s.primary} tabIndex={stickyVisible ? 0 : -1} onClick={goToQuiz}>{CTA_TEXT} <span>›</span></button></div>
  </main>;
}
