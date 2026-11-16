import type { Metadata } from "next";
import { Lora } from "next/font/google";
import { BlackFriday } from "./pressel";

const lora = Lora({ subsets: ["latin"], style: ["normal", "italic"], display: "swap", variable: "--bf-serif" });

export const metadata: Metadata = {
  metadataBase: new URL("https://quiz.psestetica.com.br"),
  title: "Black Friday PS Estética | 27 de novembro",
  description: "Entre no grupo da Black Friday da PS Estética e receba as condições especiais de 27 de novembro. São Bernardo do Campo.",
  alternates: { canonical: "https://quiz.psestetica.com.br/blackfriday" },
  openGraph: { title: "O seu próximo cuidado começa aqui.", description: "Black Friday PS Estética. 27 de novembro, das 9h às 19h. Entre no grupo para conhecer as condições.", images: [{ url: "/blackfriday/poster.jpg", width: 720, height: 1280 }], locale: "pt_BR", type: "website" },
};

export default function Page() {
  return <BlackFriday serifClass={lora.variable} />;
}
