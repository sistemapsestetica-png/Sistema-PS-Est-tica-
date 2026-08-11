import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PS Estética | Diagnóstico Estético Personalizado",
  description: "Descubra qual tratamento da PS Estética combina com o seu objetivo e consulte as próximas datas.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
