import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Botox em São Bernardo do Campo | PS Estética",
  description: "Faça o quiz de 1 minuto e veja se a avaliação de toxina botulínica faz sentido para você. Avaliação individual no ABC Paulista.",
  alternates: { canonical: "https://quiz.psestetica.com.br/botox" },
  openGraph: {
    title: "Suavizar as linhas sem perder a minha cara | PS Estética",
    description: "Faça o quiz de 1 minuto e veja se a avaliação de toxina botulínica faz sentido para você. Avaliação individual no ABC Paulista.",
    url: "https://quiz.psestetica.com.br/botox",
    siteName: "PS Estética",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    title: "Suavizar as linhas sem perder a minha cara | PS Estética",
    description: "Faça o quiz de 1 minuto e veja se a avaliação de toxina botulínica faz sentido para você. Avaliação individual no ABC Paulista.",
  },
};

export default function BotoxLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
