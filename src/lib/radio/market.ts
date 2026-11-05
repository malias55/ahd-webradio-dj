import { XMLParser } from "fast-xml-parser";
import { load } from "cheerio";
import { stationTime } from "./config";

const GOLD = "https://api.gold-api.com/price/XAU";
const FX = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";
const OIL = "https://www.aa.com.tr/tr/enerjiterminali/petrol";
const BIST = "https://www.aa.com.tr/tr/rss/default?cat=ekonomi";
const xml = new XMLParser({ ignoreAttributes: false });
const money = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateLabel = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", timeZone: "Europe/Berlin" });

async function marketText(url: string) {
  const r = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error("Market source unavailable");
  const text = await r.text();
  if (text.length > 2_000_000) throw new Error("Market source too large");
  return text;
}

function quoteAge(time: string, slot: Date, hours: number) {
  const age = slot.getTime() - Date.parse(time);
  return Number.isFinite(age) && age >= 0 && age <= hours * 3_600_000;
}

async function gold(slot: Date) {
  const quotes = await Promise.all([GOLD, GOLD + "/EUR"].map(async url => JSON.parse(await marketText(url))));
  if (!quotes.every((q, i) => q.symbol === "XAU" && q.currency === ["USD", "EUR"][i] && Number.isFinite(q.price) && q.price > 0 && quoteAge(q.updatedAt, slot, 4))) return null;
  const [usd, eur] = quotes;
  if (Math.abs(Date.parse(usd.updatedAt) - Date.parse(eur.updatedAt)) > 60_000) return null;
  return { text: `Altının onsu yaklaşık ${money.format(usd.price)} Amerikan doları, yani ${money.format(eur.price)} avro.`,
    title: "Gold API · Ons altın (USD/EUR)", url: GOLD, publishedAt: usd.updatedAt as string };
}

async function exchange(slot: Date) {
  const cube = xml.parse(await marketText(FX))?.["gesmes:Envelope"]?.Cube?.Cube;
  const day = cube?.["@_time"], rates: { "@_currency": string; "@_rate": string }[] = cube?.Cube;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day || "") || !Array.isArray(rates)) return null;
  const publishedAt = new Date(day + "T12:00:00Z").toISOString();
  if (day > stationTime(slot).date || !quoteAge(publishedAt, slot, 120)) return null;
  const tryPerEuro = Number(rates.find(r => r["@_currency"] === "TRY")?.["@_rate"]);
  const usdPerEuro = Number(rates.find(r => r["@_currency"] === "USD")?.["@_rate"]);
  if (![tryPerEuro, usdPerEuro].every(x => Number.isFinite(x) && x > 0)) return null;
  return { text: `Avrupa Merkez Bankasının ${dateLabel.format(new Date(publishedAt))} tarihli referansına göre, bir avro ${money.format(tryPerEuro)} Türk lirası. Bir Amerikan doları ise yaklaşık ${money.format(tryPerEuro / usdPerEuro)} Türk lirası.`,
    title: "Europäische Zentralbank · Referenzkurse für EUR, USD und TRY", url: FX, publishedAt: day as string };
}

async function brent(slot: Date) {
  const index = load(await marketText(OIL));
  const url = index("a[href]").map((_, a) => index(a).attr("href")).get().find(href =>
    /^https:\/\/www\.aa\.com\.tr\/tr\/enerjiterminali\/petrol\/brent-petrolun-varili-\d+-\d+-dolardan-islem-goruyor\/\d+$/.test(href));
  if (!url) return null;
  const article = load(await marketText(url));
  const title = article('meta[property="og:title"]').attr("content") || "";
  const price = title.match(/^Brent petrolün varili (\d+,\d{2}) dolardan işlem görüyor$/iu)?.[1];
  const [ , day, month, year, hour, minute ] = article("body").text().match(/\b(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2})\b/) || [];
  const time = Date.parse(`${year}-${month}-${day}T${hour}:${minute}:00+03:00`);
  if (!price || !Number.isFinite(time) || !quoteAge(new Date(time).toISOString(), slot, 48)) return null;
  const publishedAt = new Date(time).toISOString();
  return { text: `Anadolu Ajansının ${dateLabel.format(new Date(time))} tarihli haberinde, Brent petrolün varili ${price} Amerikan doları olarak bildirildi.`,
    title, url, publishedAt };
}

async function bist(slot: Date) {
  const items = xml.parse(await marketText(BIST))?.rss?.channel?.item;
  if (!Array.isArray(items)) return null;
  for (const row of items) {
    const time = Date.parse(row.pubDate);
    if (!Number.isFinite(time) || !quoteAge(new Date(time).toISOString(), slot, 48)) continue;
    if (typeof row.link !== "string" || !row.link.startsWith("https://www.aa.com.tr/tr/ekonomi/")) continue;
    const summary = load(String(row.description || "")).text();
    const close = summary.match(/BIST 100 endeksi, günü [^.]*?(\d{1,3}(?:\.\d{3})*,\d{2}) puandan tamamladı/iu);
    if (close) return { text: `Borsa İstanbul'da BİST yüz endeksi, ${dateLabel.format(new Date(time))} seansını ${close[1]} puanla tamamladı.`,
      title: "Anadolu Ajansı · BIST 100", url: row.link, publishedAt: new Date(time).toISOString() };
  }
  return null;
}

export async function collectMarketReport(slot: Date, now = new Date()) {
  const results = await Promise.allSettled([gold(slot), brent(slot), exchange(slot), bist(slot)]);
  const available = results.flatMap(r => r.status === "fulfilled" && r.value ? [r.value] : []);
  return { slot: slot.toISOString(), fetchedAt: now.toISOString(),
    text: available.length ? "Piyasalara bakalım. " + available.map(q => q.text).join(" ") : "Güncel piyasa verilerine şu anda ulaşılamıyor.",
    sources: available.map(({ title, url, publishedAt }) => ({ title, url, publishedAt })) };
}
