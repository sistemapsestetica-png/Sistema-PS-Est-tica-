"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

type DayKey = "lavieen" | "laser" | "ultraformer" | "botox";
type Step = 1 | 2 | 3 | 4 | 5 | 6;

type OpenSlot = {
  slot_id: number;
  service_name: string;
  starts_at: string;
  ends_at: string;
};

type BookingConfirmation = {
  booking_id: number;
  service_name: string;
  starts_at: string;
  ends_at: string;
};

const days: Record<DayKey, { name: string; icon: string; short: string; result: string; how: string; expected: string; cta: string }> = {
  lavieen: {
    name: "Lavieen Day",
    icon: "✦",
    short: "Manchas, poros ou textura irregular",
    result: "Manchas, poros aparentes e textura irregular",
    how: "Laser fracionado que estimula a renovação da pele",
    expected: "Aparência mais uniforme e textura revitalizada",
    cta: "Descobrir se o Lavieen combina comigo",
  },
  laser: {
    name: "Laser Day",
    icon: "◉",
    short: "Pelos indesejados",
    result: "Pelos indesejados em diferentes regiões",
    how: "Plano personalizado conforme região, pele e objetivo",
    expected: "Redução progressiva dos pelos ao longo das sessões",
    cta: "Descobrir meu plano de Laser",
  },
  ultraformer: {
    name: "Ultraformer Day",
    icon: "⌁",
    short: "Flacidez, papada ou contorno",
    result: "Flacidez, papada e perda de definição do contorno",
    how: "Ultrassom micro e macrofocado aplicado de forma personalizada",
    expected: "Melhora gradual da firmeza e do contorno",
    cta: "Saber se o Ultraformer é para mim",
  },
  botox: {
    name: "Botox Day",
    icon: "≈",
    short: "Rugas e linhas de expressão",
    result: "Rugas dinâmicas e linhas de expressão",
    how: "Aplicação planejada após análise individual da expressão",
    expected: "Linhas suavizadas com aparência natural",
    cta: "Quero avaliar meu Botox",
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

function formatSlot(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
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
  const [slots, setSlots] = useState<OpenSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState<BookingConfirmation | null>(null);
  const [leadId, setLeadId] = useState<number | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<OpenSlot | null>(null);

  const progress = step === 6 ? 100 : step * 20;
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
      booking
        ? `Horário reservado: ${formatSlot(booking.starts_at)}. Quero confirmar minha avaliação.`
        : "Não encontrei um horário ideal e quero falar com a equipe.",
    ].join("\n");
    return `https://wa.me/5511934580476?text=${encodeURIComponent(message)}`;
  }, [booking, experience, name, phone, result, timing]);

  function pickDay(value: DayKey) {
    setLeadId(null);
    setDay(value);
    window.setTimeout(() => setStep(2), 160);
  }

  function startWithDay(value: DayKey) {
    setLeadId(null);
    setDay(value);
    setStep(2);
    document.getElementById("quiz")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  async function captureLead() {
    if (!day) return null;
    if (leadId) return leadId;

    const params = new URLSearchParams(window.location.search);
    const source = {
      utm_source: params.get("utm_source"),
      utm_medium: params.get("utm_medium"),
      utm_campaign: params.get("utm_campaign"),
      utm_content: params.get("utm_content"),
      utm_term: params.get("utm_term"),
      referrer: document.referrer || null,
    };

    const { data, error } = await supabase.rpc("capture_lead", {
      p_name: name.trim(),
      p_phone: phone.replace(/\D/g, ""),
      p_service_slug: day,
      p_experience: experience,
      p_timing: timing,
      p_source: source,
    });
    if (error || !data) return null;
    const capturedLeadId = Number(data);
    setLeadId(capturedLeadId);
    return capturedLeadId;
  }

  async function loadOpenSlots() {
    if (!day) return;
    setLoadingSlots(true);
    setSaveNotice("");
    const { data, error } = await supabase.rpc("list_open_slots", { p_service_slug: day });
    if (error) {
      setSlots([]);
      setSaveNotice("Não foi possível carregar a agenda agora. Fale com a equipe pelo WhatsApp.");
    } else {
      setSlots(((data ?? []) as OpenSlot[]).slice(0, 8));
    }
    setLoadingSlots(false);
  }

  async function continueToSlots(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!day || saving) return;
    setSaveNotice("");
    setSaving(true);
    const capturedLeadId = await captureLead();
    if (!capturedLeadId) {
      setSaveNotice("Não conseguimos registrar seus dados agora. Tente novamente ou fale com a equipe pelo WhatsApp.");
      setSaving(false);
      return;
    }
    setStep(5);
    await loadOpenSlots();
    setSaving(false);
  }

  async function reserveSlot(slot: OpenSlot) {
    if (!day || saving) return;
    setSaving(true);
    setSaveNotice("");
    const capturedLeadId = await captureLead();
    if (!capturedLeadId) {
      setSaveNotice("Não conseguimos registrar seus dados agora. Tente novamente ou fale com a equipe pelo WhatsApp.");
      setSaving(false);
      return;
    }

    const { data, error } = await supabase.rpc("reserve_slot", {
      p_lead_id: capturedLeadId,
      p_slot_id: slot.slot_id,
    });
    if (error || !data?.[0]) {
      setSaveNotice("Esse horário acabou de ficar indisponível. Escolha outra opção abaixo.");
      await loadOpenSlots();
      setSaving(false);
      return;
    }

    setBooking(data[0] as BookingConfirmation);
    setSelectedSlot(null);
    setSaving(false);
    setStep(6);
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
          <p className="eyebrow hero-reveal hero-reveal-one">Quiz estético + agenda online</p>
          <h1 className="hero-reveal hero-reveal-two">Descubra seu protocolo. <em>Escolha sua data.</em></h1>
          <p className="lede hero-reveal hero-reveal-three">
            Responda perguntas rápidas, receba uma indicação inicial e pré-reserve sua avaliação na PS Estética.
          </p>
          <div className="proof-row hero-reveal hero-reveal-four">
            <span><b>Rápido e simples</b><small>leva menos de 3 minutos</small></span>
            <span><b>Indicação inicial</b><small>baseada no seu objetivo</small></span>
            <span><b>Agenda online</b><small>pré-reserve na mesma hora</small></span>
          </div>
          <p className="location hero-reveal hero-reveal-four"><span /> São Bernardo do Campo · SP</p>
        </div>

        <div className="quiz-shell" id="quiz" aria-live="polite">
          <div className="quiz-aura" aria-hidden="true" />
          <div className="quiz-top">
            <span>{step === 6 ? "Pré-reserva criada" : step === 5 ? "Escolha da data" : `Etapa ${step} de 5`}</span>
            <span>{progress}%</span>
          </div>
          <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>

          {step === 1 && (
            <div className="quiz-step">
              <p className="quiz-kicker">Comece pelo que mais incomoda você</p>
              <h2>Se pudesse melhorar uma coisa primeiro, qual seria?</h2>
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
              <p className="quiz-kicker">Sua experiência importa</p>
              <h2>Você já realizou esse tipo de tratamento?</h2>
              <div className="option-grid compact">
                {Object.entries(experienceLabels).map(([key, label]) => (
                  <button key={key} className="option" onClick={() => { setExperience(key); setLeadId(null); setStep(3); }}>
                    <span className="radio" /> <span>{label}</span><span className="option-arrow">→</span>
                  </button>
                ))}
              </div>
              <button className="back" onClick={() => setStep(1)}>← Voltar</button>
            </div>
          )}

          {step === 3 && (
            <div className="quiz-step">
              <p className="quiz-kicker">Vamos encontrar o melhor momento</p>
              <h2>Quando você gostaria de começar a cuidar disso?</h2>
              <div className="option-grid compact">
                {Object.entries(timingLabels).map(([key, label]) => (
                  <button key={key} className="option" onClick={() => { setTiming(key); setLeadId(null); setStep(4); }}>
                    <span className="radio" /> <span>{label}</span><span className="option-arrow">→</span>
                  </button>
                ))}
              </div>
              <button className="back" onClick={() => setStep(2)}>← Voltar</button>
            </div>
          )}

          {step === 4 && (
            <form className="quiz-step" onSubmit={continueToSlots}>
              <p className="quiz-kicker">Sua indicação inicial está quase pronta</p>
              <h2>Preencha seus dados para liberar a agenda.</h2>
              <label>Seu nome<input required value={name} onChange={(e) => { setName(e.target.value); setLeadId(null); }} placeholder="Como podemos chamar você?" autoComplete="name" /></label>
              <label>WhatsApp<input required value={phone} onChange={(e) => { setPhone(formatBrazilianMobile(e.target.value)); setLeadId(null); }} placeholder="(11) 90000-0000" inputMode="numeric" autoComplete="tel" maxLength={15} minLength={15} pattern="\(\d{2}\) \d{5}-\d{4}" title="Digite um celular com DDD, por exemplo: (11) 90000-0000" /></label>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "Preparando sua agenda…" : "Liberar horários disponíveis"} <span>→</span></button>
              {saveNotice && <p className="save-notice" role="status">{saveNotice}</p>}
              <button className="back" type="button" onClick={() => setStep(3)}>← Voltar</button>
              <p className="privacy">Seus dados ficam protegidos e serão usados apenas para seu atendimento na PS Estética.</p>
            </form>
          )}

          {step === 5 && result && (
            <div className="quiz-step">
              <p className="quiz-kicker">Última etapa</p>
              <h2>Escolha o horário que melhor cabe na sua rotina.</h2>
              <p className="prebook-copy">Ao pré-reservar, a vaga fica separada para você. Depois, basta confirmar os detalhes com nossa equipe pelo WhatsApp.</p>
              {loadingSlots && <p className="slot-loading" role="status">Consultando a agenda…</p>}
              {!loadingSlots && slots.length > 0 && (
                <div className="slot-options">
                  {slots.map((slot) => (
                    <button key={slot.slot_id} className={`slot-option ${selectedSlot?.slot_id === slot.slot_id ? "selected-slot" : ""}`} disabled={saving} onClick={() => setSelectedSlot(slot)}>
                      <span><small>{selectedSlot?.slot_id === slot.slot_id ? "Vaga selecionada" : "Horário disponível"}</small>{formatSlot(slot.starts_at)}</span><span aria-hidden="true">{selectedSlot?.slot_id === slot.slot_id ? "✓" : "→"}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedSlot && <div className="prebook-bar"><div><small>Você escolheu</small><b>{formatSlot(selectedSlot.starts_at)}</b></div><button className="primary-button" onClick={() => reserveSlot(selectedSlot)} disabled={saving}>{saving ? "Criando pré-reserva…" : "Pré-reservar este horário"} <span>→</span></button></div>}
              {!loadingSlots && slots.length === 0 && (
                <div className="no-slots">
                  <b>Novos horários serão abertos em breve.</b>
                  <span>Fale com a equipe para entrar na lista da próxima data.</span>
                  <a className="whatsapp-button" href={whatsappUrl} target="_blank" rel="noreferrer">Pedir próxima data <span>↗</span></a>
                  <button className="restart" onClick={() => setStep(6)}>Ver minha indicação</button>
                </div>
              )}
              {saveNotice && <p className="save-notice" role="status">{saveNotice}</p>}
              <button className="back" onClick={() => setStep(4)} disabled={saving}>← Voltar</button>
            </div>
          )}

          {step === 6 && result && (
            <div className="quiz-step result-step">
              <div className="result-icon">{result.icon}</div>
              <p className="quiz-kicker">Com base nas suas respostas</p>
              <h2>{result.name}</h2>
              <p className="result-copy">{result.result}</p>
              <div className={`availability ${booking ? "reserved" : ""}`}>
                <span className="pulse" />
                <span>{booking ? <><b>Pré-reserva criada</b> {formatSlot(booking.starts_at)}</> : <><b>Sem horário reservado</b> fale com a equipe para escolher uma data</>}</span>
              </div>
              {saveNotice && <p className="save-notice" role="status">{saveNotice}</p>}
              <a className="whatsapp-button" href={whatsappUrl} target="_blank" rel="noreferrer">{booking ? "Confirmar pré-reserva no WhatsApp" : "Pedir uma data no WhatsApp"} <span>↗</span></a>
              <button className="restart" onClick={() => { setStep(1); setDay(null); setBooking(null); setSlots([]); setLeadId(null); }}>Refazer o diagnóstico</button>
              <p className="disclaimer">Esta é uma indicação inicial. O protocolo, número de sessões e possíveis contraindicações serão definidos após avaliação profissional.</p>
            </div>
          )}
        </div>
      </section>

      <section className="trust-strip" aria-label="Diferenciais" data-reveal>
        <div className="trust-track"><span>AVALIAÇÃO PROFISSIONAL</span><i>✦</i><span>TECNOLOGIA AVANÇADA</span><i>✦</i><span>PRÉ-RESERVA ONLINE</span><i>✦</i><span>ATENDIMENTO PERSONALIZADO</span><i>✦</i></div>
      </section>

      <section className="journey-section" id="jornada" aria-labelledby="journey-title">
        <div className="journey-heading" data-reveal>
          <p className="eyebrow">Seu cuidado, do seu jeito</p>
          <h2 id="journey-title">Uma escolha bem orientada muda <em>toda a experiência.</em></h2>
          <p>Antes de indicar qualquer tratamento, queremos entender o que você deseja, o que cabe na sua rotina e como podemos cuidar de você com naturalidade.</p>
        </div>
        <div className="journey-grid">
          <article className="journey-card" data-reveal>
            <div className="journey-card-top"><span>01</span><i /></div>
            <small>Entenda seu objetivo</small>
            <h3>Conte o que deseja melhorar.</h3>
            <p>Responda perguntas rápidas e organize suas prioridades para uma avaliação mais objetiva.</p>
          </article>
          <article className="journey-card journey-card-accent" data-reveal>
            <div className="journey-card-top"><span>02</span><i /></div>
            <small>Escolha sua data</small>
            <h3>Encontre o horário ideal.</h3>
            <p>Veja a agenda disponível e faça sua pré-reserva na hora, sem esperar por mensagens.</p>
            <a href="#quiz">Ver horários <b>→</b></a>
          </article>
          <article className="journey-card" data-reveal>
            <div className="journey-card-top"><span>03</span><i /></div>
            <small>Confirme com segurança</small>
            <h3>Defina seu plano na avaliação.</h3>
            <p>A profissional analisa seu caso e confirma o cuidado mais adequado para você.</p>
          </article>
        </div>
      </section>

      <section className="days-section" id="tratamentos">
        <div className="section-heading" data-reveal>
          <p className="eyebrow">Quatro protocolos, uma escolha personalizada</p>
          <h2>O resultado que você procura começa com <em>a indicação correta.</em></h2>
          <p>Conheça os protocolos disponíveis e responda ao quiz para descobrir qual deles pode fazer mais sentido para seu objetivo neste momento.</p>
        </div>
        <div className="days-grid">
          {(Object.entries(days) as [DayKey, (typeof days)[DayKey]][]).map(([key, item], index) => (
            <article className="day-card" key={key} data-reveal="scale">
              <div className="day-card-top"><span>0{index + 1}</span><span className="date-chip"><i /> datas recorrentes</span></div>
              <div className="day-symbol">{item.icon}</div>
              <h3>{item.name}</h3>
              <dl className="day-details">
                <div><dt>O que resolve</dt><dd>{item.result}</dd></div>
                <div><dt>Como funciona</dt><dd>{item.how}</dd></div>
                <div><dt>Resultado esperado</dt><dd>{item.expected}</dd></div>
              </dl>
              <button onClick={() => startWithDay(key)}><span>{item.cta}</span><span aria-hidden="true">→</span></button>
            </article>
          ))}
        </div>
      </section>

      <section className="benefits-section" id="beneficios" aria-labelledby="benefits-title">
        <div className="benefits-heading" data-reveal>
          <p className="eyebrow">Ultraformer III</p>
          <h2 id="benefits-title">Tecnologia para realçar seus traços <em>com naturalidade.</em></h2>
          <p>Um tratamento não invasivo, indicado após avaliação, que atua em diferentes profundidades para estimular colágeno e melhorar a firmeza da pele.</p>
          <a href="#quiz" className="text-link">Descobrir se é para mim <span>→</span></a>
        </div>
        <div className="benefits-grid">
          <article data-reveal="scale"><span>01</span><h3>Estímulo de colágeno</h3><p>Ajuda a melhorar sustentação, firmeza e qualidade da pele de forma gradual.</p></article>
          <article data-reveal="scale"><span>02</span><h3>Efeito lifting</h3><p>Contribui para elevar e redefinir contornos sem cirurgia ou cortes.</p></article>
          <article data-reveal="scale"><span>03</span><h3>Linhas mais suaves</h3><p>Favorece uma aparência mais uniforme em áreas com sinais de flacidez.</p></article>
          <article data-reveal="scale"><span>04</span><h3>Pescoço e colo</h3><p>Permite tratar regiões delicadas com planejamento personalizado.</p></article>
          <article data-reveal="scale"><span>05</span><h3>Contorno mandibular</h3><p>Ajuda a valorizar a linha da mandíbula e a harmonia do perfil.</p></article>
          <article data-reveal="scale"><span>06</span><h3>Cuidado para papada</h3><p>Possibilita uma abordagem direcionada para a região abaixo do queixo.</p></article>
        </div>
      </section>

      <section className="results-section" id="resultados" aria-labelledby="results-title">
        <div className="results-heading" data-reveal>
          <div><p className="eyebrow">Resultados reais</p><h2 id="results-title">Mudanças sutis.<br /><em>Diferenças que se percebem.</em></h2></div>
          <p>Conheça alguns resultados de tratamentos com Ultraformer III realizados pela PS Estética.</p>
        </div>
        <div className="results-grid">
          {[
            ["19.png", "20.png"],
            ["21.png", "22.png"],
            ["23.png", "24.png"],
          ].map(([before, after], index) => (
            <article className="result-case" key={before} data-reveal="scale">
              <div className="result-case-head"><span>CASO 0{index + 1}</span><small>Ultraformer III</small></div>
              <div className="comparison-pair">
                <figure><img src={`https://psestetica.com.br/images/${before}`} alt={`Antes do tratamento, caso ${index + 1}`} /><figcaption>Antes</figcaption></figure>
                <figure><img src={`https://psestetica.com.br/images/${after}`} alt={`Depois do tratamento, caso ${index + 1}`} /><figcaption>Depois</figcaption></figure>
              </div>
            </article>
          ))}
        </div>
        <div className="results-foot" data-reveal><p>Resultados individuais podem variar. A indicação e o plano de tratamento são definidos após avaliação profissional.</p><a href="#quiz">Quero uma avaliação <span>→</span></a></div>
      </section>

      <section className="experience-section">
        <div className="experience-photo" data-reveal="left">
          <img src="https://psestetica.com.br/images/007.JPG" alt="Cliente recebendo tratamento facial na PS Estética" />
          <div className="photo-note"><img src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="" /><p><b>Tecnologia com propósito</b><small>Cuidado em cada detalhe</small></p></div>
        </div>
        <div className="experience-copy" data-reveal="right">
          <h2>Da sua dúvida à pré-reserva,<br /><em>sem complicação.</em></h2>
          <div className="feature-list">
            <div><span>01</span><p><b>Conte o que deseja melhorar</b><small>Responda perguntas rápidas sobre seu objetivo e sua experiência.</small></p></div>
            <div><span>02</span><p><b>Receba uma indicação inicial</b><small>Descubra qual protocolo pode ser o melhor ponto de partida para sua avaliação.</small></p></div>
            <div><span>03</span><p><b>Escolha sua data</b><small>Veja os horários disponíveis e faça sua pré-reserva pela própria página.</small></p></div>
          </div>
          <a href="#quiz" className="text-link">Descobrir meu protocolo <span>→</span></a>
        </div>
      </section>

      <section className="social-proof proof-ready" data-reveal>
        <p className="eyebrow">Confiança não se promete. Constrói-se.</p>
        <h2>Uma experiência pensada para você se sentir <em>segura em cada decisão.</em></h2>
        <p className="proof-intro">Da primeira resposta à confirmação da data, você entende o próximo passo, conversa com a equipe e só avança quando estiver confortável.</p>
        <div className="proof-placeholders" aria-label="Conteúdos de confiança em preparação">
          <article><span>01</span><b>Orientação antes de decidir</b><small>Entenda o protocolo e tire suas dúvidas com a equipe</small></article>
          <article><span>02</span><b>Atendimento personalizado</b><small>Cada plano é ajustado ao seu objetivo e às suas características</small></article>
          <article><span>03</span><b>Pré-reserva transparente</b><small>Escolha sua vaga e receba a confirmação pelo WhatsApp</small></article>
        </div>
      </section>

      <section className="final-section" data-reveal>
        <div>
          <p className="eyebrow">Seu próximo passo leva menos de 3 minutos</p>
          <h2>Descubra por onde começar e <em>encontre sua melhor data.</em></h2>
        </div>
        <a href="#quiz" className="final-button">Quero minha indicação inicial <span>→</span></a>
      </section>

      <section className="faq-section" id="duvidas" data-reveal>
        <div><p className="eyebrow">Você pergunta. A gente responde.</p><h2>Escolher com <em>segurança</em> faz parte do cuidado.</h2></div>
        <div className="faq-list">
          <details><summary>O quiz substitui uma avaliação profissional?<span>+</span></summary><p>Não. Ele entrega uma indicação inicial e organiza suas preferências. O protocolo adequado é confirmado pela equipe.</p></details>
          <details><summary>A pré-reserva já garante o atendimento?<span>+</span></summary><p>Ela bloqueia a vaga escolhida no sistema. A equipe confirma os detalhes do atendimento com você pelo WhatsApp.</p></details>
          <details><summary>Posso conversar com a equipe antes de escolher?<span>+</span></summary><p>Sim. Você pode falar diretamente pelo WhatsApp (11) 93458-0476.</p></details>
        </div>
      </section>

      <footer>
        <a className="wordmark footer-brand" href="#inicio"><img className="brand-logo" src="/ps-estetica-logo-oficial.png" width="246" height="80" alt="PS Estética Avançada" /></a>
        <div><b>São Bernardo do Campo</b><span>Av. Imperador Pedro II, 635 · Nova Petrópolis</span></div>
        <div><b>Atendimento</b><a href="https://wa.me/5511934580476" target="_blank" rel="noreferrer">(11) 93458-0476</a><a className="admin-link" href="/admin">Área da equipe</a></div>
        <p>© 2026 PS Estética. Todos os direitos reservados.</p>
      </footer>

      <a className="mobile-whatsapp" href="#quiz">Descobrir meu protocolo <span>→</span></a>
    </main>
  );
}
