"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

type MetaPixelProps = {
  pixelId: string;
};

export function MetaPixel({ pixelId }: MetaPixelProps) {
  const pathname = usePathname();
  const privatePath = pathname.startsWith("/admin") ||
    pathname.startsWith("/profissional") ||
    pathname.startsWith("/auth");
  if (privatePath) return null;

  return (
    <>
      <Script id="meta-pixel" strategy="afterInteractive">
        {`
          if (!['painel.psestetica.com.br', 'profissional.psestetica.com.br'].includes(window.location.hostname)) {
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window,document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '${pixelId}');
            fbq('track', 'PageView');
          }
        `}
      </Script>
    </>
  );
}
