import { familyContentAllowed } from "./family";
import { stationTime } from "./config";

// Structured hourly service data, deliberately without another model call.
export const SERVICE_ROADS = ["A60", "A63", "A643"] as const;
const WEATHER_URL = "https://api.brightsky.dev/current_weather?lat=49.9929&lon=8.2473";
const AUTOBAHN_URL = "https://verkehr.autobahn.de/o/autobahn";
export type ServiceSource = { title: string; url: string; publishedAt: string; attribution: string };
type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const list = (v: unknown): unknown[] => Array.isArray(v) ? v : [];
const number = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const text = (v: unknown) => typeof v === "string" ? v.replace(/<[^>]*>/g, " ").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim() : "";
const rounded = (value: number) => Math.round(value).toLocaleString("de-DE");
function nearMainz(source: Json) {
  return number(source.distance) && source.distance <= 30_000;
}
const weatherIcons: Record<string, string> = {
  "clear-day": "sonnig", "clear-night": "klar", "partly-cloudy-day": "teils bewölkt", "partly-cloudy-night": "teils bewölkt",
  cloudy: "bewölkt", fog: "neblig", wind: "windig", rain: "regnerisch", sleet: "mit Schneeregen", snow: "mit Schneefall", hail: "mit Hagel", thunderstorm: "gewittrig",
};

export function weatherReport(current: unknown, forecast: unknown, now: Date, slot: Date) {
  const data = object(current), observation = object(data.weather);
  const observedAt = new Date(text(observation.timestamp));
  const sources = list(data.sources).map(object);
  const station = sources.find(s => s.id === observation.source_id);
  const usable = station && nearMainz(station) && Number.isFinite(observedAt.getTime()) &&
    now.getTime() - observedAt.getTime() <= 90 * 60_000 && observedAt.getTime() - now.getTime() <= 5 * 60_000 &&
    number(observation.temperature) && observation.temperature >= -50 && observation.temperature <= 55;
  if (!usable) return { available: false, text: "Das Wetter für Mainz: Aktuelle, ausreichend frische Wetterdaten sind gerade nicht verfügbar.", observedAt: null, observation: null, forecast: [] };
  const icon = weatherIcons[text(observation.icon)];
  let script = `Ihr Wetter für Mainz und Umgebung! Aktuell rund ${rounded(observation.temperature as number)} Grad${icon ? ` und ${icon}` : ""}.`;
  const wind = observation.wind_speed_10;
  if (number(wind) && wind >= 0 && wind <= 300) script += ` Der Wind weht im Mittel mit ${rounded(wind)} Kilometern pro Stunde.`;
  const prediction = object(forecast), forecastSources = list(prediction.sources).map(object);
  const future = list(prediction.weather).map(object).filter(row => {
    const t = Date.parse(text(row.timestamp)), source = forecastSources.find(s => s.id === row.source_id);
    return source?.observation_type === "forecast" && nearMainz(source) && t >= slot.getTime() && t <= slot.getTime() + 3 * 3_600_000 &&
      number(row.temperature) && row.temperature >= -50 && row.temperature <= 55;
  });
  const fullForecast = [0, 1, 2, 3].every(hour => future.some(r => Date.parse(text(r.timestamp)) === slot.getTime() + hour * 3_600_000));
  if (fullForecast) {
    const temperatures = future.map(r => Math.round(r.temperature as number)), min = Math.min(...temperatures), max = Math.max(...temperatures);
    script += ` Für die nächsten drei Stunden: ${min === max ? `etwa ${rounded(min)}` : `${rounded(min)} bis ${rounded(max)}`} Grad.`;
    const probabilities = future.map(r => r.precipitation_probability).filter(number).filter(n => n >= 0 && n <= 100);
    if (probabilities.length === future.length) script += ` Regenwahrscheinlichkeit: bis zu ${rounded(Math.max(...probabilities))} Prozent.`;
  }
  return { available: true, text: script, observedAt: observedAt.toISOString(),
    observation: { temperature: observation.temperature as number, icon: text(observation.icon), windKmh: number(wind) ? wind : null, station: text(station.station_name) },
    forecast: future.map(r => ({ timestamp: text(r.timestamp), temperature: r.temperature as number, precipitationProbability: number(r.precipitation_probability) ? r.precipitation_probability : null })) };
}

export type TrafficEvent = { id: string; road: string; category: string; location: string; detail: string; distanceKm: number; url: string };
// Provider period strings are local German time. Compare local wall times, never
// parse them in the host's timezone. Ignore the later overall-project end date.
function localPeriodEnd(lines: string[]) {
  const match = lines.find(s => /^Ende:/i.test(s))?.match(/Ende:\s*(\d{2})\.(\d{2})\.(\d{2}|\d{4})\s+um\s+(\d{2}):(\d{2})/i);
  return match ? `${match[3].length === 2 ? "20" : ""}${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}` : null;
}
function roadText(value: string) {
  return value.replace(/\bAS\b/g, "Anschlussstelle").replace(/\bAD\b/g, "Autobahndreieck").replace(/\bAK\b/g, "Autobahnkreuz")
    .replace(/\bMZ\b/g, "Mainz").replace(/\bA(\d+)\b/g, "A $1").replace(/\bzw\./g, "zwischen").replace(/\bu\./g, "und").replace(/->/g, " Richtung ").replace(/\s+/g, " ").trim();
}
export function warningDetail(location: string, lines: string[]) {
  const raw = lines.join(" ");
  // Report only travel-relevant facts, never raw accident/injury descriptions.
  const condition = /Falschfahrer|Geisterfahrer/i.test(raw) ? "Achtung: Auf diesem Abschnitt wird ein Falschfahrer gemeldet. Bitte die Warnhinweise beachten."
    : /Glatteis|Glätte|vereist/i.test(raw) ? "Achtung: Hier wird Glätte gemeldet. Bitte besonders vorsichtig fahren."
    : /im Stillstand/i.test(raw) ? "Der Verkehr steht."
    : /Stau|stockend|angespannt/i.test(raw) ? "Der Verkehr stockt."
    : /Sperrung|gesperrt/i.test(raw) ? "Hier ist eine Sperrung gemeldet."
    : /Baustelle/i.test(raw) ? "Hier ist eine Baustelle gemeldet."
    : /Hindernis|Gegenst[aä]nd/i.test(raw) ? "Hier sind Hindernisse auf der Fahrbahn gemeldet."
    : /Gefahr|Unfall/i.test(raw) ? "Hier liegt eine Verkehrswarnung vor. Bitte vorsichtig fahren."
    : "Hier liegt eine Verkehrsmeldung vor. Bitte auf die Beschilderung achten.";
  const delay = raw.match(/(?:Reisezeitverlust|Zeitverlust):\s*(\d+)\s*Minuten?/i);
  const minutes = delay ? Number(delay[1]) : 0;
  return `${familyContentAllowed(location) ? location + ": " : ""}${condition}${minutes > 0 && minutes <= 240 ? ` Gemeldeter Zeitverlust: ${minutes} Minuten.` : ""}`;
}

export function trafficEvents(value: unknown, road: string, category: "warning" | "closure", slot: Date): TrafficEvent[] {
  const payload = object(value);
  if (!Array.isArray(payload[category])) throw new Error("Ungültige Verkehrsdaten");
  const local = stationTime(slot), localSlot = `${local.date}T${String(local.hour).padStart(2, "0")}:${String(local.minute).padStart(2, "0")}`;
  return list(payload[category]).flatMap(item => {
    const event = object(item), coordinate = object(event.coordinate), lat = coordinate.lat, lon = coordinate.long;
    if (!number(lat) || !number(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return [];
    const distance = 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.sin((lat - 49.9929) * Math.PI / 360) ** 2 +
      Math.cos(49.9929 * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.sin((lon - 8.2473) * Math.PI / 360) ** 2)));
    if (distance > 30) return [];
    const start = Date.parse(text(event.startTimestamp)), end = Date.parse(text(event.endTimestamp));
    if (event.future === true || event.future === "true" || (Number.isFinite(start) && start > slot.getTime()) || (Number.isFinite(end) && end <= slot.getTime())) return [];
    const lines = list(event.description).map(text).filter(Boolean), periodEnd = localPeriodEnd(lines);
    if (periodEnd && periodEnd <= localSlot) return [];
    const id = text(event.identifier), rawLocation = roadText(text(event.subtitle) || text(event.title));
    const location = familyContentAllowed(rawLocation) && !/Unfall|verletz|tödlich|Todesopfer/i.test(rawLocation) ? rawLocation : roadText(road);
    if (!id || !location) return [];
    const operational = lines.find(s => /^(Auffahrt auf|Abfahrt von) die |^(Auffahrt auf|Abfahrt von) der |^A\d+\s*:/i.test(s));
    const access = operational?.match(/^(Auffahrt auf die|Abfahrt von der)\s+A\d+:\s*(.+)$/i);
    // Describe the restriction without sensational incident details or invented delays.
    const detail = category === "closure" ? access ? `Die ${access[1].startsWith("Auffahrt") ? "Auffahrt" : "Abfahrt"} an der ${roadText(access[2])} ist gesperrt.`
      : `${operational ? roadText(operational) : location}: Hier wird eine ${event.display_type === "CLOSURE_ENTRY_EXIT" ? "gesperrte Auf- oder Abfahrt" : "Sperrung"} gemeldet.`
      : warningDetail(location, lines);
    return [{ id, road, category, location, detail: detail.slice(0, 420), distanceKm: Math.round(distance), url: `${AUTOBAHN_URL}/details/${category}/${encodeURIComponent(id)}` }];
  });
}

export function trafficReport(events: TrafficEvent[], successfulFeeds: number, fetchedAt: Date) {
  const complete = successfulFeeds === SERVICE_ROADS.length * 2;
  const ordered = [...events].sort((a, b) => (a.category === "warning" ? 0 : 1) - (b.category === "warning" ? 0 : 1) || a.distanceKm - b.distanceKm);
  const seen = new Set<string>(), selected = ordered.filter(e => { const key = `${e.road}:${e.detail}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 2);
  let script = `Jetzt der Blick auf die Straßen rund um Mainz! `;
  if (!successfulFeeds) script += "Aktuelle Verkehrsmeldungen sind gerade nicht abrufbar. Eine verlässliche Auskunft zur Verkehrslage ist deshalb nicht möglich.";
  else {
    if (!complete) script += "Die Daten liegen momentan nur teilweise vor. ";
    script += selected.length ? selected.map(e => `Auf der ${e.road.replace(/^A/, "A ")}: ${e.detail}`).join(" ")
      : `In den ${complete ? "abgerufenen" : "erreichbaren"} Meldungen für die A 60, A 63 und A 643 im Umkreis von Mainz finden sich gerade keine aktuellen Hinweise.`;
    script += " Der innerstädtische Verkehr ist dabei nicht erfasst.";
  }
  return { available: successfulFeeds > 0, complete, successfulFeeds, totalFeeds: SERVICE_ROADS.length * 2, events: selected, text: script };
}

async function fetchJson(url: string) {
  const r = await fetch(url, { cache: "no-store", headers: { "User-Agent": "AHD-Radio/1.0" }, signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Servicedaten HTTP ${r.status}`);
  const body = await r.text();
  if (body.length > 2_000_000) throw new Error("Servicedaten zu groß");
  return JSON.parse(body) as unknown;
}

export async function collectHourlyService(slot: Date, now = new Date()) {
  const forecastUrl = `https://api.brightsky.dev/weather?lat=49.9929&lon=8.2473&date=${encodeURIComponent(slot.toISOString())}&last_date=${encodeURIComponent(new Date(slot.getTime() + 3 * 3_600_000).toISOString())}`;
  const requests = SERVICE_ROADS.flatMap(road => (["warning", "closure"] as const).map(category => ({ road, category, url: `${AUTOBAHN_URL}/${road}/services/${category}` })));
  const [weatherResult, forecastResult, ...trafficResults] = await Promise.allSettled([fetchJson(WEATHER_URL), fetchJson(forecastUrl), ...requests.map(r => fetchJson(r.url))]);
  const weather = weatherReport(weatherResult.status === "fulfilled" ? weatherResult.value : null, forecastResult.status === "fulfilled" ? forecastResult.value : null, now, slot);
  const events: TrafficEvent[] = [], sources: ServiceSource[] = [], errors: string[] = [];
  if (weather.available) sources.push({ title: "Mainz · DWD-Wetter über Bright Sky", url: WEATHER_URL, publishedAt: weather.observedAt!, attribution: "Deutscher Wetterdienst (DWD), bereitgestellt über Bright Sky" });
  else errors.push("Keine frischen Wetterbeobachtungen für Mainz verfügbar");
  if (weather.forecast.length) sources.push({ title: "Mainz · DWD-Dreistundenvorhersage über Bright Sky", url: forecastUrl, publishedAt: now.toISOString(), attribution: "Deutscher Wetterdienst (DWD), bereitgestellt über Bright Sky" });
  let successfulFeeds = 0;
  trafficResults.forEach((result, i) => {
    const request = requests[i];
    try {
      if (result.status !== "fulfilled") throw new Error("Abruf fehlgeschlagen");
      events.push(...trafficEvents(result.value, request.road, request.category, slot)); successfulFeeds++;
      sources.push({ title: `${request.road} · ${request.category === "warning" ? "Verkehrsmeldungen" : "Sperrungen"}`, url: request.url, publishedAt: now.toISOString(), attribution: "Die Autobahn GmbH des Bundes" });
    } catch { errors.push(`${request.road}: ${request.category} nicht verfügbar`); }
  });
  return { fetchedAt: now.toISOString(), slot: slot.toISOString(), weather, traffic: trafficReport(events, successfulFeeds, now), sources, errors };
}

// A bulletin prepared early through the dashboard must not carry stale service
// data into the hour. Missing data is announced in a fresh, explicit fallback.
export function serviceFreshForSlot(metadata: unknown, slot: Date) {
  const m = object(metadata), service = object(m.service), fetched = Date.parse(text(service.fetchedAt));
  return service.slot === slot.toISOString() && Number.isFinite(fetched) && fetched >= slot.getTime() - 10 * 60_000 && fetched <= slot.getTime();
}
