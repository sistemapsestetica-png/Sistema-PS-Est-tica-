import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Lavieen em São Bernardo do Campo | PS Estética",
  description: "Faça o quiz Lavieen da PS Estética e descubra se a tecnologia pode ser compatível com seus objetivos de pele. Atendimento no ABC Paulista.",
  alternates: { canonical: "https://quiz.psestetica.com.br/laveen" },
  openGraph: {
    title: "Descubra se o Lavieen faz sentido para a sua pele",
    description: "Responda a quatro perguntas e receba uma indicação inicial de acordo com seus objetivos.",
    url: "https://quiz.psestetica.com.br/laveen",
    siteName: "PS Estética",
    locale: "pt_BR",
    type: "website",
  },
};

export default function LavieenLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
