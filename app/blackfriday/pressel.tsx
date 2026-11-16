"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import s from "./pressel.module.css";
import { groupTrackingHref, trackBlackFriday } from "./tracking";

function Arrow() { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function WhatsApp() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11.6a8 8 0 0 1-11.8 7l-4.4 1.2L5 15.5A8 8 0 1 1 20 11.6Z" stroke="currentColor" strokeWidth="1.5" /><path d="M9 8c.4 2.9 2.2 4.8 5.3 5.7l1-1.4 1.8 1c-.1 1.8-1.2 2.5-2.7 2.1-4.4-1.1-7-4.2-7.2-7.3 0-.7.6-1.4 1.3-1.4L9 8Z" fill="currentColor" /></svg>; }

const benefits = [
  ["01", "As condições, em primeira mão.", "Conheça os valores e as ofertas quando a Black Friday abrir. Tudo é apresentado no grupo da PS Estética."],
  ["02", "Um dia para o seu cuidado.", "Botox, Lavieen, preenchimento labial, depilação a laser e outras possibilidades em uma edição especial."],
  ["03", "A equipe por perto.", "Receba as orientações para tirar dúvidas, consultar os horários e entender o próximo passo."],
];

export function BlackFriday({ serifClass }: { serifClass: string }) {
  const root = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [started, setStarted] = useState(false);
  const trackedView = useRef(false);
  const trackedVideo = useRef(false);

  useEffect(() => {
    const href = groupTrackingHref();
    root.current?.querySelectorAll<HTMLAnchorElement>("[data-bf-group]").forEach(link => { link.href = href; });
    if (!trackedView.current) {
      trackedView.current = true;
      trackBlackFriday("ViewContent", "page");
    }
  }, []);

  useEffect(() => {
    const nodes = root.current?.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!nodes || !window.IntersectionObserver || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add(s.visible); observer.unobserve(entry.target); } });
    }, { threshold: 0.12 });
    nodes.forEach((node) => { node.classList.add(s.reveal); observer.observe(node); });
    return () => observer.disconnect();
  }, []);

  function track(place: string) {
    // A click is contact intent, not proof of a lead or of group membership.
    trackBlackFriday("Contact", place);
  }

  const cta = (place: string, label = "Quero entrar no grupo") => <a className={s.cta} data-bf-group href="/grupovip" onClick={event => { event.currentTarget.href = groupTrackingHref(); track(place); }}><WhatsApp /><span>{label}</span><Arrow /></a>;

  async function playVideo() {
    if (!video.current) return;
    video.current.muted = false;
    try {
      await video.current.play(); setStarted(true);
      if (!trackedVideo.current) { trackedVideo.current = true; trackBlackFriday("blackfriday_video_play", "video"); }
    } catch { setStarted(false); }
  }

  return <main ref={root} className={`${s.page} ${serifClass}`}>
    <div className={s.ambient} aria-hidden="true" />
    <header className={s.header}>
      <Image src="/blackfriday/logo-vertical.png" width={112} height={78} alt="PS Estética Avançada — SPA & Salão de Beleza" priority />
      <span>São Bernardo do Campo <i aria-hidden="true" /> SP</span>
    </header>

    <section className={s.hero} aria-labelledby="black-friday-title">
      <div className={s.heroCopy}>
        <div className={s.firstScreen}>
        <p className={s.eyebrow}><span /> Black Friday · edição 2026</p>
        <h1 id="black-friday-title">Este ano,<br />o presente é<br /><em>cuidar de você.</em></h1>
        <p className={s.lead}>Entre no grupo da Black Friday e receba as <strong>condições especiais da PS Estética</strong> em primeira mão.</p>
        <div className={s.eventDate}><span className={s.day}>27<small>NOV</small></span><div><b>Uma sexta-feira especial.</b><span>27 de novembro · das 9h às 19h</span></div></div>
        <div className={s.heroAction}>{cta("hero")}<p>Grupo no WhatsApp · acesso gratuito</p></div>
        </div>
        <div className={s.note}><span aria-hidden="true">✧</span><p>Os valores serão revelados no grupo.<br />Você conhece as condições antes de decidir.</p></div>
      </div>

      <div className={s.filmColumn}>
        <div className={s.filmTop}><span>Um convite da Priscila</span><span>PS / 2026</span></div>
        <div className={s.film} data-playing={started}>
          <video ref={video} src="/blackfriday/convite-sem-logo.mp4" poster="/blackfriday/poster-sem-logo.jpg" playsInline preload="none" controls={started} onPlay={() => setStarted(true)} aria-label="Priscila apresenta a Black Friday da PS Estética" />
          {!started && <button className={s.play} onClick={() => void playVideo()} type="button" aria-label="Assistir ao convite da Priscila com som"><span className={s.playIcon}><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m9 5 11 7-11 7V5Z" /></svg></span><span>Assista ao convite<small>Toque para ouvir</small></span></button>}
        </div>
        <p className={s.filmCaption}>O seu próximo cuidado começa com uma escolha.</p>
        <div className={s.videoAction}>{cta("video", "Entrar no grupo")}</div>
        <span className={s.orbit} aria-hidden="true" />
      </div>
    </section>

    <div className={s.treatments} aria-label="Procedimentos participantes"><span>Um dia. Diferentes possibilidades.</span><p><span>Botox</span><span>Lavieen</span><span>Preenchimento labial</span><span>Depilação a laser</span></p></div>

    <section className={s.group} data-reveal aria-labelledby="group-title">
      <div className={s.groupIntro}><p className={s.eyebrow}>Por dentro da Black Friday</p><h2 id="group-title">O cuidado é seu.<br /><em>O convite também.</em></h2><p>Reunimos as informações em um só lugar para você acompanhar a nossa edição especial com tranquilidade.</p></div>
      <div className={s.benefits}>{benefits.map(([number, title, text]) => <article key={number}><span>{number}</span><div><h3>{title}</h3><p>{text}</p></div></article>)}</div>
    </section>

    <section className={s.invite} data-reveal>
      <p className={s.eyebrow}>Anote na sua agenda</p>
      <div className={s.inviteTitle}><span>27</span><div><h2>novembro</h2><p>sexta-feira, das 9h às 19h</p></div></div>
      <p className={s.inviteCopy}>Entre no grupo e deixe as notificações ativadas.<br /> A equipe avisa quando as ofertas abrirem.</p>
      {cta("convite")}
      <small>As condições especiais serão apresentadas no grupo e são válidas para o dia do evento.</small>
    </section>

    <section className={s.faq} data-reveal aria-labelledby="faq-title">
      <div><p className={s.eyebrow}>Antes de entrar</p><h2 id="faq-title">Tudo claro,<br /><em>desde o começo.</em></h2></div>
      <div className={s.questions}>
        <details><summary>Onde vou receber os valores?<span>+</span></summary><p>Os valores e as condições serão apresentados no grupo do WhatsApp na abertura da Black Friday. Acompanhe as mensagens para conhecer as opções.</p></details>
        <details><summary>Preciso agendar ao entrar no grupo?<span>+</span></summary><p>Não. Entrar no grupo permite acompanhar as informações. Você pode conhecer as condições e tirar dúvidas antes de decidir sobre o agendamento.</p></details>
        <details><summary>Como sei qual procedimento faz sentido para mim?<span>+</span></summary><p>A equipe orienta sobre as possibilidades. A indicação e a definição do protocolo dependem de avaliação individual; os resultados variam de pessoa para pessoa.</p></details>
        <details><summary>Onde fica a PS Estética?<span>+</span></summary><p>Na Av. Imperador Pedro II, 635, Nova Petrópolis, em São Bernardo do Campo/SP.</p></details>
      </div>
    </section>

    <footer className={s.footer}><Image src="/blackfriday/logo-vertical.png" alt="PS Estética" width={108} height={75} /><p>Av. Imperador Pedro II, 635 · Nova Petrópolis<br />São Bernardo do Campo/SP</p><small>Ao entrar no grupo, você opta por receber as mensagens da campanha no WhatsApp. Pode sair quando quiser.</small><small>Procedimentos sujeitos à avaliação profissional e à disponibilidade da agenda.</small></footer>
  </main>;
}
