export const RADIO_TIMEZONE = "Europe/Berlin";
export const NEWS_SCHEDULE = { mode: "daily-morning", hours: [7, 8], timezone: RADIO_TIMEZONE } as const;
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
export function isMusicHours(date = new Date()) {
  const { hour } = stationTime(date);
  return radioEnabled() && hour >= 8 && hour < 18;
}
export function isTurkishNewsWindow(date = new Date()) {
  const { hour, minute } = stationTime(date);
  return radioEnabled() && hour === 7 && minute < 5;
}
export function isOnAir(date = new Date()) { return isMusicHours(date) || isTurkishNewsWindow(date); }
export function newsLanguage(slot: Date): "de" | "tr" { return stationTime(slot).hour === 7 ? "tr" : "de"; }

export function stationDayBounds(day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Ungültiges Datum");
  const nominal = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(nominal.getTime()) || nominal.toISOString().slice(0, 10) !== day) throw new Error("Ungültiges Datum");
  const midnight = (base: Date) => {
    let candidate = base.getTime();
    for (let i = 0; i < 3; i++) {
      const local = stationTime(new Date(candidate));
      const wall = Date.parse(`${local.date}T${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}:00Z`);
      candidate -= wall - base.getTime();
    }
    return new Date(candidate);
  };
  return { start: midnight(nominal), end: midnight(new Date(nominal.getTime() + 86400_000)) };
}

export function isNewsSlot(date: Date) {
  const t = stationTime(date);
  return NEWS_SCHEDULE.hours.some(hour => hour === t.hour) && t.minute === 0 && t.second === 0 && date.getMilliseconds() === 0;
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
