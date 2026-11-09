type Language = "de" | "tr";
const DE = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
const TR = ["sıfır", "bir", "iki", "üç", "dört", "beş", "altı", "yedi", "sekiz", "dokuz"];
const DE_TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];
const TR_TENS = ["", "on", "yirmi", "otuz", "kırk", "elli", "altmış", "yetmiş", "seksen", "doksan"];

function small(n: number, language: Language): string {
  if (language === "tr") return [n >= 100 ? (n >= 200 ? TR[Math.floor(n / 100)] + " " : "") + "yüz" : "", TR_TENS[Math.floor(n % 100 / 10)], n % 10 ? TR[n % 10] : ""].filter(Boolean).join(" ") || "sıfır";
  if (n < 20) return DE[n];
  if (n < 100) return (n % 10 ? (n % 10 === 1 ? "ein" : DE[n % 10]) + "und" : "") + DE_TENS[Math.floor(n / 10)];
  return (Math.floor(n / 100) === 1 ? "ein" : DE[Math.floor(n / 100)]) + "hundert" + (n % 100 ? small(n % 100, language) : "");
}

function integer(digits: string, language: Language): string {
  const n = BigInt(digits);
  if (n < 1000n) return small(Number(n), language);
  // Never round through a floating-point number. Very long identifiers are
  // spoken digit by digit rather than being mistaken for an enormous quantity.
  if (n >= 1_000_000_000_000_000n) return [...digits].map(d => (language === "de" ? DE : TR)[+d]).join(" ");
  const scales: [bigint, string, string][] = language === "de"
    ? [[1_000_000_000_000n, "Billion", "Billionen"], [1_000_000_000n, "Milliarde", "Milliarden"], [1_000_000n, "Million", "Millionen"]]
    : [[1_000_000_000_000n, "trilyon", "trilyon"], [1_000_000_000n, "milyar", "milyar"], [1_000_000n, "milyon", "milyon"]];
  for (const [scale, singular, plural] of scales) {
    if (n < scale) continue;
    const count = n / scale, rest = n % scale;
    return `${count === 1n && language === "de" ? "eine" : integer(String(count), language)} ${count === 1n ? singular : plural}${rest ? " " + integer(String(rest), language) : ""}`;
  }
  const thousands = Number(n / 1000n), rest = Number(n % 1000n);
  return language === "de" ? (thousands === 1 ? "ein" : small(thousands, language)) + "tausend" + (rest ? small(rest, language) : "")
    : [thousands === 1 ? "bin" : small(thousands, language) + " bin", rest ? small(rest, language) : ""].filter(Boolean).join(" ");
}

// Both programme languages use comma decimals and dot thousands. Also accept
// unambiguous English feed formatting (1,234.56), never infer an exchange rate.
function parts(raw: string): { whole: string; fraction?: string } | null {
  const value = raw.replace(/[\s\u00a0\u202f]/g, "");
  if (/^\d{1,3}(?:,\d{3})+\.\d+$/.test(value)) { const [whole, fraction] = value.split("."); return { whole: whole.replace(/,/g, ""), fraction }; }
  if (/^\d{1,3}(?:\.\d{3})+(?:,\d+)?$/.test(value)) { const [whole, fraction] = value.split(","); return { whole: whole.replace(/\./g, ""), fraction }; }
  if (/^\d+(?:,\d+)?$/.test(value)) { const [whole, fraction] = value.split(","); return { whole, fraction }; }
  if (/^\d+\.\d+$/.test(value)) { const [whole, fraction] = value.split("."); return { whole, fraction }; }
  return null;
}

export function spokenNumber(raw: string, language: Language): string {
  const parsed = parts(raw);
  if (!parsed) return raw;
  const { whole, fraction } = parsed;
  const head = whole.length > 1 && whole.startsWith("0") ? [...whole].map(d => (language === "de" ? DE : TR)[+d]).join(" ") : integer(whole, language);
  // Preserve every decimal place, especially leading/trailing zeroes in quotes.
  const tail = fraction && (language === "tr" && fraction.length <= 2 && !fraction.startsWith("0") ? integer(fraction, language) : [...fraction].map(d => (language === "de" ? DE : TR)[+d]).join(" "));
  return head + (tail ? (language === "de" ? " Komma " : " virgül ") + tail : "");
}

const NUM = "\\d+(?:[.,]\\d+)*(?:[\\u00a0\\u202f ]\\d{3})*(?:,\\d+)?";
const MONTHS = {
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
  tr: ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"],
};
function dayWord(day: number, language: Language, before: string) {
  if (language === "tr") return integer(String(day), language);
  const stems = ["", "erst", "zweit", "dritt", "viert", "fünft", "sechst", "siebt", "acht"];
  const stem = stems[day] || integer(String(day), "de") + (day < 20 ? "t" : "st");
  return stem + (/\b(?:am|vom|zum|ab|bis zum|seit dem|nach dem|vor dem)\s*$/i.test(before) ? "en" : /\bder\s*$/i.test(before) ? "e" : "er");
}

function normalize(text: string, language: Language) {
  let result = text;
  // Dates before decimal numbers; validate calendar dates before expanding.
  result = result.replace(/(?<![\p{L}\d])([0-3]?\d)\.([01]?\d)\.(\d{4})(?!\d)/gu, (match, d, m, y, offset) => {
    const date = new Date(Date.UTC(+y, +m - 1, +d));
    if (date.getUTCFullYear() !== +y || date.getUTCMonth() !== +m - 1 || date.getUTCDate() !== +d) return match;
    return `${dayWord(+d, language, result.slice(0, offset))} ${MONTHS[language][+m - 1]} ${integer(y, language)}`;
  });
  if (language === "de") result = result.replace(new RegExp(`(?<![\\p{L}\\d])([0-3]?\\d)\\.\\s+(${MONTHS.de.join("|")})\\b`, "giu"), (match, day, month, offset) => +day >= 1 && +day <= 31 ? `${dayWord(+day, language, result.slice(0, offset))} ${month}` : match);
  result = result.replace(/(?<![\p{L}\d])([01]?\d|2[0-3]):([0-5]\d)(?:\s*Uhr)?(?!\d)/gu, (_match, h, m) => language === "de"
    ? `${+h === 1 ? "ein" : integer(String(+h), language)} Uhr${+m ? " " + integer(String(+m), language) : ""}`
    : `${integer(String(+h), language)}${+m ? " " + (+m < 10 ? "sıfır " : "") + integer(String(+m), language) : ""}`);
  // Explicit road names must not become a spelling of the individual digits.
  if (language === "de") result = result.replace(/\b([AB])\s?(\d{1,3})(?![\p{L}\d])/gu, (_match, road, number) => `${road} ${integer(number, language)}`);
  // Resolve signs while digits are still present (including before a currency
  // or percentage). A dash between two unsigned numbers denotes a range.
  result = result.replace(/(\d)\s*[–−-]\s*(?=\d)/gu, language === "de" ? "$1 bis " : "$1 ila ");
  result = result.replace(new RegExp(`(?<![\\p{L}\\d])([+−-])(?=${NUM}|[€$₺])`, "gu"), (_m, sign) => sign === "+" ? (language === "de" ? "plus " : "artı ") : (language === "de" ? "minus " : "eksi "));
  // German prices sound more natural as euros and cents than as a sequence of
  // decimal digits. Exact fractions other than two places remain decimals.
  if (language === "de") {
    const euro = (value: string) => {
      const parsed = parts(value);
      if (!parsed || parsed.fraction?.length !== 2) return `${spokenNumber(value, language)} Euro`;
      const euros = integer(parsed.whole, language), cents = Number(parsed.fraction);
      return `${euros === "eins" ? "ein" : euros} Euro${cents ? ` und ${cents === 1 ? "ein" : integer(String(cents), language)} Cent` : ""}`;
    };
    result = result.replace(new RegExp(`€\\s*(${NUM})`, "gu"), (_m, value) => value === "1" ? "1 Euro" : euro(value));
    result = result.replace(new RegExp(`(?<![\\p{L}\\d])(${NUM})\\s*(?:Euro\\b|€)`, "gu"), (_m, value) => value === "1" ? "1 Euro" : euro(value));
  }
  const currency = (symbol: string) => language === "de" ? ({ "€": "Euro", "$": "US-Dollar", "₺": "türkische Lira" }[symbol]!) : ({ "€": "avro", "$": "Amerikan doları", "₺": "Türk lirası" }[symbol]!);
  const amount = (value: string, symbol: string) => `${language === "de" && value === "1" ? "1" : spokenNumber(value, language)} ${currency(symbol)}`;
  result = result.replace(new RegExp(`([€$₺])\\s*(${NUM})`, "gu"), (_match, symbol, value) => amount(value, symbol));
  result = result.replace(new RegExp(`(?<![\\p{L}\\d])(${NUM})\\s*([€$₺])`, "gu"), (_match, value, symbol) => amount(value, symbol));
  const percent = (value: string) => language === "de" ? spokenNumber(value, language) + " Prozent" : "yüzde " + spokenNumber(value, language);
  result = result.replace(new RegExp(`%\\s*(${NUM})`, "gu"), (_match, value) => percent(value));
  result = result.replace(new RegExp(`(?<![\\p{L}\\d])(${NUM})\\s*%`, "gu"), (_match, value) => percent(value));
  result = result.replace(/°\s*C\b/gu, language === "de" ? "Grad Celsius" : "santigrat derece").replace(/\bkm\/h\b/gu, language === "de" ? "Kilometer pro Stunde" : "kilometre bölü saat");
  // Apostrophised Turkish numeric suffixes stay attached to the spoken number.
  result = result.replace(new RegExp(`(?<![\\p{L}\\d.,])(${NUM})(?:['’](\\p{L}+))?(?![\\p{L}\\d])`, "gu"), (match, value, suffix, offset) => {
    const parsed = parts(value);
    if (!parsed) return match;
    // Grammar-dependent ordinals and Turkish suffixes needing consonant
    // changes remain available to the enabled provider normalizer.
    if (/^\.\s*\p{L}/u.test(result.slice(offset + match.length))) return match;
    if (suffix && language === "tr" && !/^(?:da|de|ta|te|dan|den|tan|ten)$/u.test(suffix)) return match;
    let spoken = spokenNumber(value, language);
    if (language === "de" && value === "1") {
      const following = result.slice(offset + match.length);
      // ein/eine/einen/einem depends on gender and case (mit 1 Euro). Let the
      // provider infer this from the sentence instead of inserting "eins".
      if (/^\s+\p{L}/u.test(following)) return match;
    }
    return spoken + (suffix ? (language === "tr" ? suffix : "’" + suffix) : "");
  });
  return result;
}

export function spokenNumbers(text: string, language: Language) {
  // Leave URLs, email addresses and machine identifiers untouched. Only the
  // speaking copy is transformed; structured source numbers stay unchanged.
  return text.split(/(https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\b\d{4}-\d{2}-\d{2}(?:T[^\s]+)?\b)/giu)
    .map((part, index) => index % 2 ? part : normalize(part, language)).join("");
}
