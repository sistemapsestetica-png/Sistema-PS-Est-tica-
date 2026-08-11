"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type DayKey = "lavieen" | "laser" | "ultraformer" | "botox";
type Step = 1 | 2 | 3 | 4 | 5;

const days: Record<DayKey, { name: string; icon: string; short: string; result: string; how: string; expected: string; cta: string }> = {
  lavieen: {
    name: "Lavieen Day",
    icon: "✦",
    short: "Manchas, poros ou textura irregular",
    result: "Manchas, poros dilatados, textura irregular",
    how: "Renovação da pele em sessões, sem tempo de recuperação",
    expected: "Pele mais uniforme já nas primeiras sessões",
    cta: "Avaliar se o Lavieen serve para o meu caso",
  },
  laser: {
    name: "Laser Day",
    icon: "◉",
    short: "Pelos indesejados",
    result: "Depilação recorrente",
    how: "Plano por tipo de pele e região tratada",
    expected: "Redução progressiva com efeito de meses",
    cta: "Montar meu plano de laser",
  },
  ultraformer: {
    name: "Ultraformer Day",
    icon: "⌁",
    short: "Flacidez, papada ou contorno",
    result: "Flacidez, papada, contorno facial",
    how: "Ultrassom micro e macrofocado, sem cirurgia",
    expected: "Firmeza perceptível, sem afastamento da rotina",
    cta: "Entender se o Ultraformer é indicado para mim",
  },
  botox: {
    name: "Botox Day",
    icon: "≈",
    short: "Rugas e linhas de expressão",
    result: "Rugas e linhas de expressão",
    how: "Aplicação dosada por avaliação individual",
    expected: "Expressão suavizada, sem efeito “congelado”",
    cta: "Agendar avaliação para Botox",
  },
};

const experienceLabels: Record<string, string> = {
  primeira: "Será minha primeira vez",
  ja_fiz: "Já fiz esse procedimento",
};

const timingLabels: Record<string, string> = {
  semana: "Quero agendar esta semana",
  quinzena: "Nas próximas duas semanas",
  pesquisando: "Estou pesquisando por enquanto",
};

function formatBrazilianMobile(value: string) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export default function Home() {
  const [step, setStep] = useState<Step>(1);
  const [day, setDay] = useState<DayKey | null>(null);
  const [experience, setExperience] = useState("");
  const [timing, setTiming] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState("");

  const progress = step === 5 ? 100 : step * 25;
  const result = day ? days[day] : null;

  useEffect(() => {
    document.body.classList.add("motion-ready");
    const revealItems = document.querySelectorAll<HTMLElement>("[data-reveal]");
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -40px" });
    revealItems.forEach((item) => observer.observe(item));
    return () => {
      observer.disconnect();
      document.body.classList.remove("motion-ready");
    };
  }, []);

  const whatsappUrl = useMemo(() => {
    if (!result) return "https://wa.me/5511934580476";
    const message = [
      `Olá! Sou ${name} e acabei de fazer o quiz da PS Estética.`,
      "",
      `Resultado: ${result.name}`,
      `Principal queixa: ${result.short}`,
      `Experiência: ${experienceLabels[experience] ?? "Não informado"}`,
      `Prazo: ${timingLabels[timing] ?? "Não informado"}`,
      `Meu WhatsApp: ${phone}`,
      "",
      "Quero conhecer as próximas datas e confirmar minha avaliação.",
    ].join("\n");
    return `https://wa.me/5511934580476?text=${encodeURIComponent(message)}`;
  }, [experience, name, phone, result, timing]);

  function pickDay(value: DayKey) {
    setDay(value);
    window.setTimeout(() => setStep(2), 160);
  }

  function startWithDay(value: DayKey) {
    setDay(value);
    setStep(2);
    document.getElementById("quiz")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!day || saving) return;

    setSaving(true);
    setSaveNotice("");
    const params = new URLSearchParams(window.location.search);
    const source = {
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_content: params.get("utm_content"),
      utm_term: params.get("utm_term"),
      referrer: document.referrer || null,
    };

    const { error } = await supabase.rpc("capture_lead", {
      p_name: name.trim(),
      p_phone: phone.replace(/\D/g, ""),
      p_service_slug: day,
      p_experience: experience,
      p_timing: timing,
      p_source: source,
    });

    if (error) {
      setSaveNotice("Não conseguimos registrar agora, mas você ainda pode falar com a equipe pelo WhatsApp.");
    }
    setSaving(false);
    setStep(5);
  }

  return (
    <main>
      <header className="topbar">
        <a className="wordmark" href="#inicio" aria-label="PS Estética — início">
          <img className="brand-logo" src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética Avançada — SPA & Salão de Beleza" />
        </a>
        <nav className="header-nav" aria-label="Navegação principal">
          <a href="#tratamentos">Tratamentos</a>
          <a className="header-link" href="https://wa.me/5511934580476" target="_blank" rel="noreferrer">Falar com a equipe <span aria-hidden="true">↗</span></a>
        </nav>
      </header>

      <section className="hero" id="inicio">
        <div className="hero-glow hero-glow-one" />
        <div className="hero-glow hero-glow-two" />
        <div className="hero-ring" aria-hidden="true" />
        <div className="hero-copy">
          <p className="eyebrow hero-reveal hero-reveal-one">Diagnóstico estético personalizado</p>
          <h1 className="hero-reveal hero-reveal-two">Qual dos <em>4 tratamentos</em> é o certo para você?</h1>
          <p className="lede hero-reveal hero-reveal-three">
            Responda 4 perguntas sobre sua pele. Nossa equipe indica o protocolo e as próximas datas — sem consulta, sem espera.
          </p>
          <div className="proof-row hero-reveal hero-reveal-four">
            <span><b>4 perguntas</b><small>leva 4 minutos</small></span>
            <span><b>4 protocolos</b><small>Lavieen, Laser, Ultraformer, Botox</small></span>
            <span><b>Resposta imediata</b><small>sem espera por retorno</small></span>
          </div>
          <p className="location hero-reveal hero-reveal-four"><span /> São Bernardo do Campo · SP</p>
        </div>

        <div className="quiz-shell" id="quiz" aria-live="polite">
          <div className="quiz-aura" aria-hidden="true" />
          <div className="quiz-top">
            <span>{step === 5 ? "Diagnóstico concluído" : `Etapa ${step} de 4`}</span>
            <span>{progress}%</span>
          </div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>

          {step === 1 && (
            <div className="quiz-step">
              <p className="quiz-kicker">Vamos começar</p>
              <h2>O que você quer tratar primeiro?</h2>
              <div className="option-grid">
                {(Object.entries(days) as [DayKey, (typeof days)[DayKey]][]).map(([key, item]) => (
                  <button className={`option ${day === key ? "selected" : ""}`} key={key} onClick={() => pickDay(key)}>
                    <span className="option-icon">{item.icon}</span>
                    <span>{item.short}</span>
                    <span className="option-arrow">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="quiz-step">
              <p className="quiz-kicker">Sobre você</p>
              <h2>Você já fez esse tipo de procedimento?</h2>
              <div className="option-grid compact">
                {Object.entries(experienceLabels).map(([key, label]) => (
                  <button key={key} className="option" onClick={() => { setExperience(key); setStep(3); }}>
                    <span className="radio" /> <span>{label}</span><span className="option-arrow">→</span>
                  </button>
                ))}
              </div>
              <button className="back" onClick={() => setStep(1)}>← Voltar</button>
            </div>
          )}

          {step === 3 && (
            <div className="quiz-step">
              <p className="quiz-kicker">Sua prioridade</p>
              <h2>Quando você gostaria de cuidar disso?</h2>
              <div className="option-grid compact">
                {Object.entries(timingLabels).map(([key, label]) => (
                  <button key={key} className="option" onClick={() => { setTiming(key); setStep(4); }}>
                    <span className="radio" /> <span>{label}</span><span className="option-arrow">→</span>
                  </button>
                ))}
              </div>
              <button className="back" onClick={() => setStep(2)}>← Voltar</button>
            </div>
          )}

          {step === 4 && (
            <form className="quiz-step" onSubmit={submitLead}>
              <p className="quiz-kicker">Seu resultado está pronto</p>
              <h2>Para onde enviamos as próximas datas?</h2>
              <label>Seu nome<input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Como podemos chamar você?" autoComplete="name" /></label>
              <label>WhatsApp<input required value={phone} onChange={(e) => setPhone(formatBrazilianMobile(e.target.value))} placeholder="(11) 90000-0000" inputMode="numeric" autoComplete="tel" maxLength={15} minLength={15} pattern="\(\d{2}\) \d{5}-\d{4}" title="Digite um celular com DDD, por exemplo: (11) 90000-0000" /></label>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "Salvando…" : "Ver meu diagnóstico"} <span>→</span></button>
              <button className="back" type="button" onClick={() => setStep(3)}>← Voltar</button>
              <p className="privacy">Seus dados serão usados somente para este atendimento.</p>
            </form>
          )}

          {step === 5 && result && (
            <div className="quiz-step result-step">
              <div className="result-icon">{result.icon}</div>
              <p className="quiz-kicker">Sua indicação inicial</p>
              <h2>{result.name}</h2>
              <p className="result-copy">{result.result}</p>
              <div className="availability"><span className="pulse" /><span><b>Agenda recorrente</b> com novas datas ao longo do mês</span></div>
              {saveNotice && <p className="save-notice" role="status">{saveNotice}</p>}
              <a className="whatsapp-button" href={whatsappUrl} target="_blank" rel="noreferrer">Confirmar pelo WhatsApp <span>↗</span></a>
              <button className="restart" onClick={() => { setStep(1); setDay(null); }}>Refazer o diagnóstico</button>
              <p className="disclaimer">Indicação inicial. O protocolo ideal é definido após avaliação profissional.</p>
            </div>
          )}
        </div>
      </section>

      <section className="trust-strip" aria-label="Diferenciais" data-reveal>
        <span>Avaliação profissional antes de qualquer protocolo</span>
        <span>Agenda com data fixa semanal por tratamento</span>
        <span>Sem pacote fechado sem avaliação prévia</span>
      </section>

      <section className="days-section" id="tratamentos">
        <div className="section-heading" data-reveal>
          <p className="eyebrow">Calendário recorrente</p>
          <h2>4 tratamentos.<br /><em>4 dias fixos da semana.</em></h2>
          <p>Escolha seu dia e entre na rotina — ou deixe o diagnóstico indicar o protocolo certo.</p>
        </div>
        <div className="days-grid">
          {(Object.entries(days) as [DayKey, (typeof days)[DayKey]][]).map(([key, item], index) => (
            <article className="day-card" key={key} data-reveal>
              <div className="day-card-top"><span>0{index + 1}</span><span className="date-chip"><i /> datas recorrentes</span></div>
              <div className="day-symbol">{item.icon}</div>
              <h3>{item.name}</h3>
              <div className="day-details">
                <p><b>O que resolve:</b> {item.result}</p>
                <p><b>Como:</b> {item.how}</p>
                <p><b>Resultado esperado:</b> {item.expected}</p>
              </div>
              <button onClick={() => startWithDay(key)}>{item.cta} <span>→</span></button>
            </article>
          ))}
        </div>
      </section>

      <section className="experience-section">
        <div className="experience-photo" data-reveal="left">
          <img src="https://psestetica.com.br/images/007.JPG" alt="Cliente recebendo tratamento facial na PS Estética" />
          <div className="photo-note"><img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="" /><p><b>Tecnologia com propósito</b><small>Cuidado em cada detalhe</small></p></div>
        </div>
        <div className="experience-copy" data-reveal="right">
          <h2>Do diagnóstico à sessão,<br /><em>em 3 passos.</em></h2>
          <div className="feature-list">
            <div><span>01</span><p><b>Diagnóstico inicial</b><small>Você responde 4 perguntas sobre seu objetivo.</small></p></div>
            <div><span>02</span><p><b>Avaliação profissional</b><small>Nossa equipe confirma o protocolo — sem indicação automática.</small></p></div>
            <div><span>03</span><p><b>Data mais conveniente</b><small>Você escolhe entre as datas já disponíveis na semana do seu Day.</small></p></div>
          </div>
          <a href="#quiz" className="text-link">Iniciar meu diagnóstico <span>→</span></a>
        </div>
      </section>

      <section className="social-proof" data-reveal>
        <p className="quote-mark">“</p>
        <blockquote>Fiz 3 sessões de Ultraformer. Na primeira já notei a pele mais firme, sem dor e sem parar a rotina. Hoje o Day é parte fixa da minha agenda.</blockquote>
        <p className="quote-author"><b>Ana Paula M.</b><span>Cliente PS Estética · São Bernardo do Campo</span></p>
      </section>

      <section className="final-section" data-reveal>
        <div>
          <p className="eyebrow">Seu próximo passo</p>
          <h2>4 perguntas. <em>1 indicação clara.</em> Datas já disponíveis.</h2>
        </div>
        <a href="#quiz" className="final-button">Iniciar diagnóstico <span>→</span></a>
      </section>

      <footer>
        <a className="wordmark footer-brand" href="#inicio"><img className="brand-logo" src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética Avançada" /></a>
        <div><b>São Bernardo do Campo</b><span>Av. Imperador Pedro II, 635 · Nova Petrópolis</span></div>
        <div><b>Atendimento</b><a href="https://wa.me/5511934580476" target="_blank" rel="noreferrer">(11) 93458-0476</a><a className="admin-link" href="/admin">Área da equipe</a></div>
        <p>© 2026 PS Estética. Todos os direitos reservados.</p>
      </footer>

      <a className="mobile-whatsapp" href="#quiz">Iniciar diagnóstico <span>→</span></a>
    </main>
  );
}
