import type { Metadata } from "next";

const description = "A PS Estética Avançada, SPA & Salão de Beleza, está contratando cabeleireiro(a) e manicure. Chame no WhatsApp e venha fazer parte da nossa equipe em Nova Petrópolis, São Bernardo do Campo.";

export const metadata: Metadata = {
  title: "Vagas para Cabeleireiro(a) e Manicure | PS Estética",
  description,
  alternates: { canonical: "https://quiz.psestetica.com.br/vagas" },
  openGraph: {
    title: "Estamos contratando: Cabeleireiro(a) e Manicure",
    description,
    url: "https://quiz.psestetica.com.br/vagas",
    siteName: "PS Estética",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    title: "Estamos contratando: Cabeleireiro(a) e Manicure",
    description,
  },
};

export default function VagasLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
