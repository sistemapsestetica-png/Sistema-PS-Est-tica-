"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { trackMetaCustomEvent, trackMetaEvent } from "../../lib/meta-pixel";
import { supabase } from "../../lib/supabase";
import { formatBrazilianWhatsapp, INVALID_WHATSAPP_MESSAGE, isValidBrazilianWhatsapp, whatsappDigits } from "../../lib/whatsapp";
import s from "../lavieen/lavieen.module.css";

type Step = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
type Key = "concern" | "impact" | "priority" | "intent";
type Answers = Record<Key, string>;
type Slot = { slot_id: number; service_name: string; starts_at: string; ends_at: string };
type Lead = { lead_id: number; reservation_token: string };
type Booking = { booking_id: number; booking_token: string; service_name: string; starts_at: string; ends_at: string; deposit_cents: number; payment_expires_at: string };
type Pix = { pix_copy_paste?: string; qr_code_base64?: string; ticket_url?: string };

const questions: Array<{ key: Key; title: string; help?: string; options: Array<{ label: string; detail?: string }> }> = [
  { key: "concern", title: "Quando você olha para sua pele hoje, o que mais chama sua atenção?", help: "Escolha a opção que melhor representa o que você gostaria de melhorar.", options: [
    { label: "Manchas ou tom irregular", detail: "Percebo manchas, marcas do sol ou diferenças na tonalidade." },
    { label: "Textura ou poros aparentes", detail: "Gostaria que a pele tivesse uma aparência mais lisa e uniforme." },
    { label: "Falta de viço", detail: "Minha pele parece opaca, sem luminosidade ou com aparência cansada." },
    { label: "Linhas e sinais de envelhecimento", detail: "Comecei a perceber mudanças na qualidade e aparência da pele." },
  ] },
  { key: "impact", title: "E quanto isso incomoda você atualmente?", options: [
    { label: "Pouco — mas comecei a perceber" }, { label: "Moderadamente — reparo com frequência" },
    { label: "Bastante — é uma das primeiras coisas que noto" }, { label: "Muito — já procurei formas de melhorar" },
  ] },
  { key: "priority", title: "O que faria mais diferença para você ao cuidar da sua pele?", options: [
    { label: "Perceber o tom com aparência mais uniforme" }, { label: "Melhorar a aparência da textura e dos poros" },
    { label: "Recuperar luminosidade e aspecto bem cuidado" }, { label: "Cuidar dos sinais de envelhecimento" },
  ] },
  { key: "intent", title: "Se houver uma possibilidade adequada ao seu objetivo no próximo Laser Day, o que você gostaria de fazer?", options: [
    { label: "Quero consultar as condições e disponibilidade" }, { label: "Quero conversar com a equipe antes" }, { label: "Quero entender melhor como funciona" },
  ] },
];

const objectives: Record<string, string> = {
  "Manchas ou tom irregular": "manchas e uniformidade do tom",
  "Textura ou poros aparentes": "textura e aparência dos poros",
  "Falta de viço": "viço e luminosidade",
  "Linhas e sinais de envelhecimento": "sinais visíveis de envelhecimento",
};

const benefits = [
  ["01", "Manchas e uniformidade", "Cuidados voltados à aparência de manchas e diferenças de tonalidade."],
  ["02", "Textura da pele", "Protocolos que podem contribuir para uma aparência mais uniforme."],
  ["03", "Poros aparentes", "Cuidados direcionados à qualidade da pele e à aparência dos poros."],
  ["04", "Viço e luminosidade", "Para quem percebe uma aparência mais opaca ou cansada."],
  ["05", "Sinais de envelhecimento", "Possibilidades para mudanças percebidas na qualidade e aparência da pele."],
];

const formatSlot = (value: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
const cookie = (name: string) => document.cookie.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;

export default function LaserDayPage() {
  const [step, setStep] = useState<Step>(0);
  const [answers, setAnswers] = useState<Answers>({ concern: "", impact: "", priority: "", intent: "" });
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [email, setEmail] = useState("");
  const [lead, setLead] = useState<Lead | null>(null); const [slots, setSlots] = useState<Slot[]>([]); const [selected, setSelected] = useState<Slot | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null); const [pix, setPix] = useState<Pix | null>(null); const [paid, setPaid] = useState(false);
  const [loading, setLoading] = useState(false); const [notice, setNotice] = useState("");
  const viewTracked = useRef(false); const startTracked = useRef(false); const leadTracked = useRef<number | null>(null); const purchaseTracked = useRef<number | null>(null);
  const current = step >= 1 && step <= 4 ? questions[step - 1] : null;
  const progress = step === 0 ? 0 : step <= 4 ? step * 20 : step === 5 ? 90 : 100;
  const objective = objectives[answers.concern] ?? "seu principal objetivo";
  const whatsapp = useMemo(() => `https://wa.me/5511934580476?text=${encodeURIComponent(booking ? `Olá! Sou ${name}. Fiz o quiz Laser Day e pré-reservei ${formatSlot(booking.starts_at)}.` : `Olá! Sou ${name || "cliente"}. Fiz o quiz Laser Day e quero consultar a próxima edição.`)}`, [booking, name]);

  useEffect(() => { if (!viewTracked.current) { viewTracked.current = true; trackMetaEvent("ViewContent", { content_name: "Quiz Laser Day", content_category: "laser", content_ids: ["laser"], content_type: "product" }); } }, []);
  function start() { if (!startTracked.current) { startTracked.current = true; trackMetaCustomEvent("QuizStart", { content_name: "Quiz Laser Day", content_category: "laser", content_ids: ["laser"], content_type: "product" }); } setStep(1); setTimeout(() => document.getElementById("quiz-laser")?.scrollIntoView({ behavior: "smooth", block: "start" }), 40); }
  function choose(value: string) { if (!current) return; setAnswers((old) => ({ ...old, [current.key]: value })); setLead(null); setTimeout(() => setStep((step + 1) as Step), 140); }
  function source() { const p = new URLSearchParams(location.search); return { landing_page: "laserday", quiz_answers: answers, utm_source: p.get("utm_source"), utm_medium: p.get("utm_medium"), utm_campaign: p.get("utm_campaign"), utm_content: p.get("utm_content"), utm_term: p.get("utm_term"), referrer: document.referrer || null, fbp: cookie("_fbp"), fbc: cookie("_fbc") }; }
  async function saveLead() {
    if (lead) return lead;
    const { data, error } = await supabase.rpc("capture_lead_session", { p_name: name.trim(), p_phone: whatsappDigits(phone), p_service_slug: "laser", p_experience: "primeira", p_timing: answers.intent.includes("disponibilidade") ? "semana" : "pesquisando", p_source: source(), p_email: email.trim().toLowerCase() });
    const row = data?.[0] as Lead | undefined; if (error || !row) return null;
    const next = { lead_id: Number(row.lead_id), reservation_token: row.reservation_token }; setLead(next);
    if (leadTracked.current !== next.lead_id) { leadTracked.current = next.lead_id; trackMetaEvent("Lead", { content_name: "Quiz Laser Day", content_category: "laser" }); }
    return next;
  }
  async function loadSlots() { const { data, error } = await supabase.rpc("list_open_slots", { p_service_slug: "laser" }); if (error) { setSlots([]); setNotice("Não foi possível consultar a agenda agora."); } else setSlots(((data ?? []) as Slot[]).slice(0, 8)); }
  async function submitContact(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (loading) return; if (!isValidBrazilianWhatsapp(phone)) return setNotice(INVALID_WHATSAPP_MESSAGE); setLoading(true); setNotice(""); if (!await saveLead()) { setNotice("Não conseguimos registrar seus dados agora. Confira e tente novamente."); setLoading(false); return; } setStep(6); await loadSlots(); setLoading(false); }
  async function reserve(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || loading) return; setLoading(true); setNotice(""); const session = await saveLead();
    if (!session) { setNotice("Não foi possível validar seus dados."); setLoading(false); return; }
    const { data, error } = await supabase.rpc("reserve_slot_secure", { p_lead_id: session.lead_id, p_reservation_token: session.reservation_token, p_slot_id: selected.slot_id });
    if (error || !data?.[0]) { setNotice("Este horário ficou indisponível. Escolha outra opção."); await loadSlots(); setSelected(null); setLoading(false); return; }
    const next = data[0] as Booking; setBooking(next); setStep(7); trackMetaEvent("Schedule", { content_name: next.service_name, content_ids: ["laser"], content_type: "product", currency: "BRL", value: next.deposit_cents / 100 }, `booking-${next.booking_id}-schedule`);
    const { data: pixData, error: pixError } = await supabase.functions.invoke("create-pix", { body: { bookingToken: next.booking_token } });
    if (pixError || !pixData?.payment) setNotice(pixData?.error ?? "Sua vaga foi separada, mas não foi possível gerar o Pix agora."); else { setPix(pixData.payment as Pix); trackMetaEvent("InitiateCheckout", { content_name: next.service_name, content_ids: ["laser"], content_type: "product", currency: "BRL", value: next.deposit_cents / 100 }); } setLoading(false);
  }
  useEffect(() => { if (!booking?.booking_token || paid) return; const timer = setInterval(async () => { const { data } = await supabase.rpc("get_booking_public_status", { p_booking_token: booking.booking_token }); if (data?.[0]?.booking_status === "confirmed") { setPaid(true); if (purchaseTracked.current !== booking.booking_id) { purchaseTracked.current = booking.booking_id; trackMetaEvent("Purchase", { content_name: booking.service_name, content_ids: ["laser"], content_type: "product", currency: "BRL", value: booking.deposit_cents / 100 }, `booking-${booking.booking_id}-purchase`); } clearInterval(timer); } if (data?.[0]?.booking_status === "expired") { setNotice("O prazo do Pix terminou e o horário foi liberado."); clearInterval(timer); } }, 5000); return () => clearInterval(timer); }, [booking, paid]);
  async function copyPix() { if (pix?.pix_copy_paste) { await navigator.clipboard.writeText(pix.pix_copy_paste); setNotice("Código Pix copiado."); } }

  return <main className={s.page}>
    <header className={s.header}><a href="#inicio"><Image src="/ps-estetica-logo-oficial.png" width={246} height={80} alt="PS Estética Avançada" priority /></a><a className={s.headerCta} href={whatsapp} target="_blank" rel="noreferrer">Falar com a equipe</a></header>
    <section className={s.hero} id="inicio"><div className={s.heroCopy}><p className={s.eyebrow}>Laser Day • PS Estética</p><h1>O que você mais gostaria de melhorar <em>na sua pele hoje?</em></h1><p className={s.heroText}>Manchas, poros aparentes, textura irregular, falta de luminosidade ou sinais de envelhecimento?</p><p className={s.heroText}>Responda <b>4 perguntas rápidas</b> e entenda se existem possibilidades no próximo Laser Day que façam sentido para seu objetivo.</p><button className={s.primary} onClick={start}>Descobrir em 1 minuto <span>›</span></button><p className={s.heroTrust}><b>PS Estética • São Bernardo do Campo</b><span>Avaliação individualizada antes da definição de qualquer protocolo.</span></p></div><div className={s.heroPanel}><span className={s.orbit} /><p>Comece pelo que você percebe</p><strong>4 perguntas</strong><ul><li>Principal objetivo</li><li>Nível de incômodo</li><li>Prioridade de cuidado</li></ul><small>O quiz não realiza diagnóstico nem define tratamento.</small></div></section>
    <section className={s.quizSection} id="quiz-laser"><div className={s.quizIntro}><p className={s.eyebrow}>Seu objetivo vem primeiro</p><h2>Sua pele não precisa do mesmo cuidado que todas as outras.</h2><p>Antes de falar em tecnologia, queremos entender o que você gostaria de melhorar.</p></div><div className={s.quizCard} aria-live="polite"><div className={s.quizTop}><span>{step === 0 ? "Pronto para começar" : step <= 4 ? `Pergunta ${step} de 4` : step === 5 ? "Seus dados" : step === 6 ? "Sua análise inicial" : "Pré-reserva"}</span><b>{progress}%</b></div><div className={s.progress}><span style={{ width: `${progress}%` }} /></div>
      {step === 0 && <div className={s.quizBody}><p className={s.quizKicker}>Laser Day • PS Estética</p><h3>O que você mais gostaria de melhorar na sua pele hoje?</h3><p className={s.quizText}>Manchas, poros, textura, luminosidade ou sinais de envelhecimento? São apenas 4 perguntas.</p><button className={s.primary} onClick={start}>Começar <span>›</span></button><p className={s.cardTrust}>PS Estética • São Bernardo do Campo<br /><span>Este quiz não realiza diagnóstico nem define indicação.</span></p></div>}
      {current && <div className={s.quizBody}><p className={s.quizKicker}>Pergunta {step} de 4</p><h3>{current.title}</h3>{current.help && <p className={s.quizText}>{current.help}</p>}<div className={s.options}>{current.options.map((option) => <button key={option.label} className={answers[current.key] === option.label ? s.selected : ""} onClick={() => choose(option.label)}><span><b>{option.label}</b>{option.detail && <><br /><small>{option.detail}</small></>}</span><i>›</i></button>)}</div>{step > 1 && <button className={s.back} onClick={() => setStep((step - 1) as Step)}>Voltar</button>}</div>}
      {step === 5 && <form className={`${s.quizBody} ${s.contactForm}`} onSubmit={submitContact}><p className={s.quizKicker}>Sua análise inicial está quase pronta</p><h3>Deixe seus dados para ver o resultado.</h3><p className={s.quizText}>Você também poderá consultar as próximas disponibilidades do Laser Day.</p><label>Nome<input required minLength={2} value={name} onChange={(e) => { setName(e.target.value); setLead(null); }} autoComplete="name" /></label><label>WhatsApp<input required value={phone} onChange={(e) => { setPhone(formatBrazilianWhatsapp(e.target.value)); setLead(null); setNotice(""); }} inputMode="numeric" maxLength={15} minLength={15} pattern="\([1-9]\d\) 9\d{4}-\d{4}" title={INVALID_WHATSAPP_MESSAGE} placeholder="(11) 90000-0000" /><small>Informe um celular com DDD e todos os 9 dígitos.</small></label><label>E-mail<input required type="email" value={email} onChange={(e) => { setEmail(e.target.value); setLead(null); }} autoComplete="email" /></label><button className={s.primary} disabled={loading}>{loading ? "Analisando…" : "Ver minha análise"} <span>›</span></button>{notice && <p className={s.notice}>{notice}</p>}<button className={s.back} type="button" onClick={() => setStep(4)}>Voltar</button><small className={s.privacy}>Seus dados serão usados apenas no atendimento da PS Estética.</small></form>}
      {step === 6 && <div className={s.quizBody}><p className={s.resultLabel}>Sua análise inicial</p><h3>Existem possibilidades no Laser Day que podem ser avaliadas para seu objetivo.</h3><p className={s.resultText}>Seu principal objetivo parece relacionado a <b>{objective}</b>. Você não precisa escolher qual laser ou protocolo fazer. A definição depende da sua pele, do seu histórico e da avaliação profissional.</p><div className={s.answerSummary}><span>Seu principal objetivo</span><strong>{objective}</strong></div><div className={s.scheduleHead}><p className={s.quizKicker}>Próximo passo opcional</p><h4>Consulte a disponibilidade do Laser Day</h4></div>{loading && <p className={s.notice}>Consultando a agenda…</p>}{!loading && slots.length > 0 && <div className={s.slots}>{slots.map((slot) => <button key={slot.slot_id} onClick={() => setSelected(slot)} className={selected?.slot_id === slot.slot_id ? s.selectedSlot : ""}><span><small>Disponível</small>{formatSlot(slot.starts_at)}</span><i>›</i></button>)}</div>}{!loading && slots.length === 0 && <div className={s.empty}><b>Novas datas serão abertas em breve.</b><p>A equipe pode informar a próxima edição.</p><a href={whatsapp} target="_blank" rel="noreferrer">Consultar pelo WhatsApp</a></div>}{selected && <form className={s.reserveBox} onSubmit={reserve}><div><small>Horário escolhido</small><b>{formatSlot(selected.starts_at)}</b></div><p className={s.reserveEmail}>A confirmação será enviada para <b>{email}</b></p><button className={s.primary} disabled={loading}>{loading ? "Criando pré-reserva…" : "Pré-reservar este horário"} <span>›</span></button></form>}{notice && <p className={s.notice}>{notice}</p>}</div>}
      {step === 7 && booking && <div className={s.quizBody}><p className={s.resultLabel}>Horário separado para você</p><h3>{formatSlot(booking.starts_at)}</h3>{paid ? <div className={s.paid}><b>Pagamento confirmado</b><p>Seu horário está confirmado.</p><a href={whatsapp} target="_blank" rel="noreferrer">Falar com a equipe</a></div> : <><p className={s.resultText}>Conclua o sinal de R$ {(booking.deposit_cents / 100).toFixed(2).replace(".", ",")} para confirmar. Se o prazo expirar, o horário volta a ficar disponível.</p>{pix?.qr_code_base64 && <Image className={s.qr} src={`data:image/png;base64,${pix.qr_code_base64}`} width={220} height={220} alt="QR Code Pix" />}{pix?.pix_copy_paste && <button className={s.primary} type="button" onClick={copyPix}>Copiar código Pix</button>}{pix?.ticket_url && <a className={s.paymentLink} href={pix.ticket_url} target="_blank" rel="noreferrer">Abrir pagamento</a>}</>}{notice && <p className={s.notice}>{notice}</p>}</div>}
    </div></section>
    <section className={s.benefits}><div className={s.sectionIntro}><p className={s.eyebrow}>Uma data especial na PS Estética</p><h2>O que é o Laser Day?</h2><p>É uma data dedicada a protocolos de cuidado da pele. A proposta é entender o que você deseja melhorar e avaliar as possibilidades adequadas entre os protocolos participantes.</p></div><div className={s.benefitGrid}>{benefits.map(([n, title, text]) => <article key={n}><span>{n}</span><h3>{title}</h3><p>{text}</p></article>)}</div><p className={s.disclaimer}>A disponibilidade dos protocolos e sua indicação devem ser confirmadas individualmente pela equipe.</p></section>
    <section className={s.fit}><div><p className={s.eyebrow}>Por que é um “Day”?</p><h2>Não é simplesmente um procedimento com outro nome.</h2><p>Você chega com um objetivo, a equipe avalia sua pele e, havendo indicação, orienta o protocolo adequado entre as possibilidades do evento.</p></div><div className={s.fitCards}><article><span>01</span><h3>Você conta o que gostaria de melhorar</h3><p>O quiz organiza suas principais queixas.</p></article><article><span>02</span><h3>A equipe avalia seu caso</h3><p>Pele, histórico e objetivos são considerados.</p></article><article><span>03</span><h3>Você decide com informação</h3><p>Entende a proposta antes de qualquer procedimento.</p></article></div></section>
    <section className={s.confidence}><p className={s.eyebrow}>Decisão com segurança</p><h2>O foco não é “fazer laser”.</h2><p>É cuidar daquilo que você realmente percebe na sua pele. O quiz organiza prioridades, mas não representa diagnóstico ou indicação definitiva.</p><div><span>PS Estética</span><span>São Bernardo do Campo</span><span>Avaliação individualizada</span></div><a className={s.primary} href={whatsapp} target="_blank" rel="noreferrer">Consultar o próximo Laser Day <span>›</span></a></section>
  </main>;
}
