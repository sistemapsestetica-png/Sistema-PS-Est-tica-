export const attributionKeys = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id", "campaign_id", "adset_id", "ad_id", "placement", "fbclid"] as const;
const storageKey = "ps-blackfriday-attribution-v1";
const visitStorageKey = "ps-blackfriday-visit-v1";
const maxAge = 30 * 24 * 60 * 60 * 1000;
type Attribution = Partial<Record<typeof attributionKeys[number], string>>;
type Touch = { capturedAt: number; values: Attribution };
let current: Touch | undefined;
const metaIdPattern = /^fb\.\d+\.\d{13}\.[A-Za-z0-9_.-]{1,512}$/;

export function captureAttribution(): Touch {
  const now = Date.now();
  let saved = current;
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey) || "null") as Touch | null;
    if (parsed && Number.isFinite(parsed.capturedAt) && now - parsed.capturedAt < maxAge && parsed.capturedAt <= now && parsed.values) {
      const values: Attribution = {};
      for (const key of attributionKeys) if (typeof parsed.values[key] === "string") values[key] = parsed.values[key]!.slice(0, 512);
      saved = { capturedAt: parsed.capturedAt, values };
    }
  } catch { /* Storage can be unavailable in private browsers. */ }
  const query = new URLSearchParams(location.search);
  const incoming: Attribution = {};
  for (const key of attributionKeys) {
    const value = query.get(key)?.trim().slice(0, 512);
    if (value) incoming[key] = value;
  }
  // A new tagged visit replaces the previous campaign; untagged visits preserve it.
  const hasIncoming = Object.keys(incoming).length > 0;
  const sameTouch = saved && Object.keys(incoming).every(key => incoming[key as keyof Attribution] === saved.values[key as keyof Attribution]);
  current = hasIncoming && !sameTouch ? { capturedAt: now, values: incoming } : saved || { capturedAt: now, values: incoming };
  if (now - current.capturedAt >= maxAge) current = { capturedAt: now, values: incoming };
  try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch { /* Keep in memory. */ }
  return current;
}

export function groupTrackingHref() {
  const query = new URLSearchParams(captureAttribution().values as Record<string, string>);
  return `/grupovip${query.size ? `?${query}` : ""}`;
}

function cookie(name: string) {
  try { return decodeURIComponent(document.cookie.split("; ").find(value => value.startsWith(`${name}=`))?.slice(name.length + 1) || ""); }
  catch { return ""; }
}

function matchingData(touch: Touch) {
  const fbp = cookie("_fbp");
  let fbc = cookie("_fbc");
  const click = touch.values.fbclid;
  if (click && !fbc.endsWith(`.${click}`)) {
    fbc = `fb.1.${touch.capturedAt}.${click}`;
    try { document.cookie = `_fbc=${encodeURIComponent(fbc)}; Max-Age=${maxAge / 1000}; Path=/; SameSite=Lax; Secure`; } catch { /* A genuine URL click ID remains usable when cookie writes are blocked. */ }
  }
  return { fbp: metaIdPattern.test(fbp) ? fbp : "", fbc: metaIdPattern.test(fbc) ? fbc : "" };
}

export function recordBlackFridayVisit() {
  try {
    const touch = captureAttribution();
    let visitId = localStorage.getItem(visitStorageKey) || "";
    if (!/^[0-9a-f-]{36}$/i.test(visitId)) {
      visitId = crypto.randomUUID();
      localStorage.setItem(visitStorageKey, visitId);
    }
    const matching = matchingData(touch);
    void fetch("/api/blackfriday/visits", {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visit_id: visitId, attribution: touch.values, ...matching }),
    }).catch(() => {});
  } catch { /* Visit persistence must never affect the page. */ }
}

async function sendServerEvent(eventName: string, eventId: string, place: string, touch: Touch) {
  let matching = matchingData(touch);
  // The SDK can create _fbp after this page's effect. Give it time without
  // delaying navigation, inventing an ID, or sending an unmatchable event.
  for (let attempt = 0; !matching.fbp && !matching.fbc && attempt < 10; attempt++) {
    await new Promise<void>(resolve => window.setTimeout(resolve, 150));
    matching = matchingData(touch);
  }
  if (!matching.fbp && !matching.fbc) return;
  try {
    const response = await fetch("/api/blackfriday/events", {
      method: "POST", keepalive: true, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name: eventName, event_id: eventId, place, attribution: touch.values, ...matching }),
    });
    if (!response.ok) console.warn("Black Friday: envio de servidor indisponível", response.status);
  } catch { /* Never block WhatsApp. */ }
}

export function trackBlackFriday(eventName: "ViewContent" | "Contact" | "blackfriday_video_play", place: string) {
  try {
    // Retain this guard for older callers; clicks are not confirmed joins.
    if (eventName === "Contact") return;
    const touch = captureAttribution();
    const eventId = `bf-${crypto.randomUUID()}`;
    const parameters = { content_name: "black-friday-2026", content_category: place, ...touch.values };
    const dispatch = (attempt = 0) => {
      if (typeof window.fbq === "function") window.fbq(eventName === "blackfriday_video_play" ? "trackCustom" : "track", eventName, parameters, { eventID: eventId });
      else if (attempt < 20) window.setTimeout(() => dispatch(attempt + 1), 100);
    };
    dispatch();
    void sendServerEvent(eventName, eventId, place, touch);
  } catch { /* Analytics must never prevent navigation or video playback. */ }
}
