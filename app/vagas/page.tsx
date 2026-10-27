"use client";

import Image from "next/image";
import { Lora } from "next/font/google";
import v from "./vagas.module.css";

const serif = Lora({ subsets: ["latin"], style: ["normal", "italic"], display: "swap" });

const WHATSAPP_NUMBER = "5511932886284";
const WHATSAPP_LABEL = "11 93288-6284";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent("Olá! Vi a vaga na PS Estética e quero me candidatar. Sou (cabeleireiro(a) ou manicure).")}`;

const steps = [
  { n: "1", title: "Chame no WhatsApp", text: "Toque no botão e envie sua mensagem. O texto já vem pronto." },
  { n: "2", title: "Conte sobre você", text: "Diga se atua com cabelo ou manicure e há quanto tempo." },
  { n: "3", title: "Conversamos com você", text: "Nossa equipe responde pelo WhatsApp com as próximas informações." },
];

function WhatsIcon() {
  return (
    <svg viewBox="0 0 32 32" width="22" height="22" aria-hidden="true" fill="currentColor">
      <path d="M16.04 3C9.4 3 4 8.4 4 15.03c0 2.35.68 4.6 1.97 6.55L4 29l7.6-1.94a12 12 0 0 0 4.44 0.85C22.67 27.9 28 22.6 28 15.97 28 9.3 22.68 3 16.04 3Zm0 22.2c-1.44 0-2.85-.4-4.07-1.15l-.3-.18-4.5 1.15 1.2-4.37-.2-.32a10 10 0 0 1-1.55-5.3c0-5.5 4.5-9.97 10.05-9.97 5.5 0 9.97 4.47 9.97 9.97 0 5.55-4.5 10.17-10.6 10.17Zm5.5-7.5c-.3-.15-1.78-.88-2.05-.98-.28-.1-.48-.15-.68.15-.2.3-.78.98-.95 1.18-.18.2-.35.22-.65.08-.3-.15-1.27-.47-2.42-1.5a9 9 0 0 1-1.67-2.08c-.18-.3 0-.47.13-.62.13-.13.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.68-1.65-.93-2.25-.25-.58-.5-.5-.68-.5h-.58c-.2 0-.53.08-.8.38-.28.3-1.05 1.03-1.05 2.5s1.08 2.9 1.23 3.1c.15.2 2.1 3.2 5.08 4.5.7.3 1.25.48 1.68.62.7.22 1.35.2 1.85.12.57-.08 1.78-.73 2.03-1.43.25-.7.25-1.3.18-1.43-.08-.12-.28-.2-.58-.35Z" />
    </svg>
  );
}

export default function VagasPage() {
  // Evento padrão do Meta para o clique no WhatsApp (só dispara se o Pixel carregou).
  const track = (place: string) => {
    try {
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      fbq?.("track", "Contact", { content_name: "vagas-cabeleireiro-manicure", content_category: place });
    } catch {
      // rastreamento nunca pode impedir o contato
    }
  };

  const cta = (place: string, extra = "") => (
    <a className={`${v.cta} ${extra}`} href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" onClick={() => track(place)}>
      <WhatsIcon /> Quero me candidatar agora
    </a>
  );

  return (
    <main className={`${v.page} ${serif.className}`}>
      <span className={v.glow} aria-hidden="true" />
      <header className={v.header}>
        <Image src="/ps-estetica-logo-oficial.png" alt="PS Estética Avançada, SPA & Salão de Beleza" width={190} height={58} priority />
      </header>

      <section className={v.hero}>
        <div className={v.heroCopy}>
          <p className={v.eyebrow}>Vagas abertas</p>
          <h1>
            <span className={v.estamos}>Estamos</span>
            <em>contratando</em>
          </h1>
          <div className={v.roles}>
            <span>Cabeleireiro(a)</span>
            <i aria-hidden="true">·</i>
            <span>Manicure</span>
          </div>
          <p className={v.lead}>Venha fazer parte da <em>nossa equipe.</em></p>
          <p className={v.sub}>Um ambiente sofisticado, feito para quem ama o que faz.</p>
          <div className={v.ctaWrap}>
            {cta("hero")}
            <p className={v.micro}>Resposta pelo WhatsApp · {WHATSAPP_LABEL}</p>
          </div>
        </div>

        <div className={v.arches}>
            <figure>
              <div className={v.arch}><Image src="/vagas/cabelo.jpg" alt="Profissional escovando e modelando os cabelos de uma cliente" fill sizes="(max-width: 860px) 44vw, 260px" /></div>
              <figcaption><strong>Cabeleireiro(a)</strong><span>Vaga aberta</span></figcaption>
            </figure>
            <figure>
              <div className={v.arch}><Image src="/vagas/manicure.jpg" alt="Manicure aplicando esmalte nas unhas de uma cliente" fill sizes="(max-width: 860px) 44vw, 260px" /></div>
              <figcaption><strong>Manicure</strong><span>Vaga aberta</span></figcaption>
            </figure>
          </div>
      </section>

      <section className={v.band}>
        <div className={v.wrap}>
          <p className={v.eyebrow}>Como funciona</p>
          <h2>É simples se <em>candidatar</em></h2>
          <ol className={v.steps}>
            {steps.map((step) => (
              <li key={step.n}>
                <span>{step.n}</span>
                <div>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className={v.ctaCenter}>{cta("passos")}</div>
        </div>
      </section>

      <section className={v.contact}>
        <div className={v.wrap}>
          <p className={v.eyebrow}>Fale com a gente</p>
          <h2>no <em>WhatsApp</em></h2>
          <a className={v.phone} href={WHATSAPP_URL} target="_blank" rel="noopener noreferrer" onClick={() => track("contato")}>
            <WhatsIcon /> {WHATSAPP_LABEL}
          </a>
          <p className={v.address}>Av. Imperador Pedro II, 635<br /><span>Nova Petrópolis · São Bernardo do Campo</span></p>
        </div>
      </section>

      <footer className={v.footer}>
        <small>PS Estética Avançada · SPA & Salão de Beleza</small>
      </footer>

      <div className={v.sticky}>{cta("fixo", v.ctaFull)}</div>
    </main>
  );
}
