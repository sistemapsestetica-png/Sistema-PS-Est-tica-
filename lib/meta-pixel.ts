type MetaEventParameters = Record<string, string | number | string[] | undefined>;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function trackMetaEvent(
  eventName: string,
  parameters: MetaEventParameters = {},
  eventId?: string,
) {
  dispatchMetaEvent("track", eventName, parameters, eventId);
}

export function trackMetaCustomEvent(
  eventName: string,
  parameters: MetaEventParameters = {},
) {
  dispatchMetaEvent("trackCustom", eventName, parameters);
}

function dispatchMetaEvent(
  command: "track" | "trackCustom",
  eventName: string,
  parameters: MetaEventParameters,
  eventId?: string,
  attempt = 0,
) {
  if (typeof window === "undefined") return;
  if (typeof window.fbq !== "function") {
    if (attempt < 20) window.setTimeout(() => dispatchMetaEvent(command, eventName, parameters, eventId, attempt + 1), 100);
    return;
  }
  const options = eventId ? { eventID: eventId } : undefined;
  window.fbq(command, eventName, parameters, options);
}
