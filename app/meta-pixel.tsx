"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";

type MetaPixelProps = {
  pixelId: string;
};

// Hosts internos (painel da equipe e área do profissional). Neles o Pixel fica desligado,
// exceto nas landings públicas de anúncio abaixo, que também são servidas por esses hosts.
const INTERNAL_HOSTS = ["painel.psestetica.com.br", "profissional.psestetica.com.br"];
const PUBLIC_AD_ROUTES = ["/laserday", "/lavieen", "/botox", "/blackfriday"];

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
          (function () {
            var internalHost = ${JSON.stringify(INTERNAL_HOSTS)}.indexOf(window.location.hostname) !== -1;
            var path = window.location.pathname;
            var adRoute = ${JSON.stringify(PUBLIC_AD_ROUTES)}.some(function (route) { return path === route || path.indexOf(route + '/') === 0; });
            if (internalHost && !adRoute) return;
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window,document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', ${JSON.stringify(pixelId)});
            var pageViewId = 'pv-' + (window.crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
            fbq('track', 'PageView', {}, { eventID: pageViewId });
          })();
        `}
      </Script>
    </>
  );
}
