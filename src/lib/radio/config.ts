export const RADIO_TIMEZONE = "Europe/Berlin";
export const RADIO_STREAM_PATH = "/api/radio/stream";

export function stationTime(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: RADIO_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: +get("hour"), minute: +get("minute"), second: +get("second") };
}

export function radioEnabled() { return process.env.RADIO_ENABLED !== "false"; }
export function isOnAir(date = new Date()) {
  const { hour } = stationTime(date);
  return radioEnabled() && hour >= 8 && hour < 18;
}

export function isNewsSlot(date: Date) {
  const t = stationTime(date);
  return t.hour >= 8 && t.hour < 18 && t.minute === 0 && t.second === 0;
}

export function upcomingNewsSlot(date = new Date()): Date | null {
  // Advance absolute instants, then inspect Berlin time: handles DST without host TZ assumptions.
  const start = Math.floor(date.getTime() / 3_600_000) * 3_600_000;
  for (let i = 0; i < 26; i++) {
    const candidate = new Date(start + i * 3_600_000);
    if (candidate.getTime() >= date.getTime() && isNewsSlot(candidate)) return candidate;
  }
  return null;
}

export function publicOrigin() {
  return (process.env.RADIO_PUBLIC_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : `http://localhost:${process.env.PORT || 3000}`)).replace(/\/$/, "");
}

export function nativeSource(zone: { defaultSource: string; streamUrl: string | null }, origin = publicOrigin(), date = new Date()): string | null {
  if (zone.defaultSource === "silent") return null;
  // Old zone rows move to the built-in station without ever contacting the retired backend.
  if (zone.defaultSource === "radio" || zone.defaultSource === "azuracast") {
    return isOnAir(date) ? `${origin}${RADIO_STREAM_PATH}` : null;
  }
  return zone.defaultSource === "custom_url" ? zone.streamUrl : null;
}
