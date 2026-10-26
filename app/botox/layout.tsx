import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Botox em São Bernardo do Campo | PS Estética",
  description: "Faça o quiz de Botox da PS Estética e descubra em 1 minuto se a toxina botulínica faz sentido para você. Avaliação individual em São Bernardo do Campo, ABC Paulista.",
  alternates: { canonical: "https://quiz.psestetica.com.br/botox" },
  openGraph: {
    title: "Botox em São Bernardo do Campo: faça o quiz de 1 minuto",
    description: "Faça o quiz de Botox da PS Estética e descubra em 1 minuto se a toxina botulínica faz sentido para você. Avaliação individual em São Bernardo do Campo, ABC Paulista.",
    url: "https://quiz.psestetica.com.br/botox",
    siteName: "PS Estética",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    title: "Botox em São Bernardo do Campo: faça o quiz de 1 minuto",
    description: "Faça o quiz de Botox da PS Estética e descubra em 1 minuto se a toxina botulínica faz sentido para você. Avaliação individual em São Bernardo do Campo, ABC Paulista.",
  },
};

export default function BotoxLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
