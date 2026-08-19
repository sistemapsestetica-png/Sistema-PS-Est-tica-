import type { Metadata } from "next";
import "./globals.css";
import "./brand-system.css";
import { MetaPixel } from "./meta-pixel";

export const metadata: Metadata = {
  title: "PS Estética | Diagnóstico Estético Personalizado",
  description: "Descubra qual tratamento da PS Estética combina com o seu objetivo e consulte as próximas datas.",
  icons: {
    icon: [{ url: "/favicon.svg?v=2", type: "image/svg+xml" }],
    shortcut: "/favicon.svg?v=2",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const configuredPixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID?.trim() || "1633028891341714";
  const pixelId = configuredPixelId && /^\d+$/.test(configuredPixelId) ? configuredPixelId : null;

  return (
    <html lang="pt-BR">
      <body>
        {children}
        {pixelId && <MetaPixel pixelId={pixelId} />}
      </body>
    </html>
  );
}
