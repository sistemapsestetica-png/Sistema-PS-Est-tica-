import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Botox em São Bernardo do Campo | PS Estética",
  description: "Faça o quiz da PS Estética e descubra se a toxina botulínica (Botox) pode ser compatível com seus objetivos. Avaliação individual no ABC Paulista.",
  alternates: { canonical: "https://quiz.psestetica.com.br/botox" },
  openGraph: {
    title: "Botox com expressão natural: descubra se faz sentido para você",
    description: "Responda a algumas perguntas rápidas e receba uma indicação inicial. A aplicação só acontece após avaliação individual.",
    url: "https://quiz.psestetica.com.br/botox",
    siteName: "PS Estética",
    locale: "pt_BR",
    type: "website",
  },
};

export default function BotoxLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
