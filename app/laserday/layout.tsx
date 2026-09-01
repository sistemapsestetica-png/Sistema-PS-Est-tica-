import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Laser Day: depilação a laser em São Bernardo | PS Estética",
  description: "Escolha as regiões que gostaria de tratar e consulte a condição especial do próximo Laser Day de depilação a laser da PS Estética.",
  alternates: { canonical: "https://quiz.psestetica.com.br/laserday" },
  openGraph: {
    title: "Laser Day de depilação a laser | PS Estética",
    description: "Responda quatro perguntas, escolha suas regiões e consulte a próxima edição em São Bernardo do Campo.",
    url: "https://quiz.psestetica.com.br/laserday",
  },
};

export default function LaserDayLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
