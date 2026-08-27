import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Laser Day | Quiz PS Estética",
  description: "Responda 4 perguntas e entenda quais possibilidades do Laser Day podem ser avaliadas para a sua pele.",
};

export default function LaserDayLayout({ children }: Readonly<{ children: React.ReactNode }>) { return children; }
