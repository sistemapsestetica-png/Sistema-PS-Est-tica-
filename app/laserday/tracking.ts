import { supabase } from "../../lib/supabase";

// ViewContent do Laser Day também pelo servidor (função meta-laserday), com o MESMO eventID do Pixel,
// para a Meta deduplicar. user_data: fbp/fbc (+ IP e navegador, que a função lê do próprio pedido).
const metaIdPattern = /^fb\.\d+\.\d{13}\.[A-Za-z0-9_.-]{1,512}$/;

function readCookie(name: string) {
  try { return decodeURIComponent(document.cookie.split("; ").find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) || ""); }
  catch { return ""; }
}

function matchingData(fbclid: string | null) {
  const fbp = readCookie("_fbp");
  let fbc = readCookie("_fbc");
  // Se a pessoa chegou por anúncio e o Pixel ainda não gravou o _fbc, monta no formato oficial da Meta.
  if (fbclid && !fbc.endsWith(`.${fbclid}`)) fbc = `fb.1.${Date.now()}.${fbclid}`;
  return { fbp: metaIdPattern.test(fbp) ? fbp : "", fbc: metaIdPattern.test(fbc) ? fbc : "" };
}

export async function sendLaserDayViewContent(eventId: string, attribution: Record<string, string | null>) {
  try {
    let matching = matchingData(attribution.fbclid ?? null);
    // O Pixel pode criar o _fbp um instante depois do clique; espera um pouco sem travar a tela.
    for (let attempt = 0; !matching.fbp && !matching.fbc && attempt < 10; attempt++) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
      matching = matchingData(attribution.fbclid ?? null);
    }
    if (!matching.fbp && !matching.fbc) return;
    const utm: Record<string, string> = {};
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
      const value = attribution[key];
      if (value) utm[key] = value;
    }
    const { error } = await supabase.functions.invoke("meta-laserday", {
      body: { event_name: "ViewContent", event_id: eventId, attribution: utm, ...matching },
    });
    if (error) console.warn("Meta Conversions API ViewContent was not sent", error.message);
  } catch { /* O rastreamento nunca pode travar o quiz. */ }
}
