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
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  const options = eventId ? { eventID: eventId } : undefined;
  window.fbq("track", eventName, parameters, options);
}
