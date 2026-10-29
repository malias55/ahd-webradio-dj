export const FAMILY_CONTENT_VERSION = "all-ages-v1";
export const FAMILY_CONTENT_POLICY = `JUGENDFREIE INHALTE IN BEIDEN SPRACHEN:
Alle Meldungen, Einleitungen, Abschlüsse und Hinweise müssen für ein Publikum einschließlich kleiner Kinder geeignet sein.
Keine Erotik, Pornografie, sexualisierten Darstellungen, Nacktheit, vulgäre oder beleidigende Sprache. Keine Empfehlungen für Filme, Serien, Spiele oder Veranstaltungen mit nicht jugendfreien Inhalten oder Altersfreigaben ab 16/18.
Keine drastischen, bedrohlichen oder verstörenden Schilderungen, Gewaltverherrlichung, Horror, Splatter, Missbrauch, Suizid, Selbstverletzung, Drogenkonsum, Glücksspiel oder Werbung für Alkohol, Tabak und Wetten. Das gilt auch für Kultur-, Unterhaltungs- und Wissenschaftsmeldungen.
Ungeeignete Themen vollständig auslassen, nicht durch Euphemismen scheinbar harmlos machen. Bei Zweifel eine andere, belegte und familiengeeignete Meldung wählen oder kürzer bleiben.
Sachlich notwendige Wetter- und Verkehrshinweise bleiben verständlich erhalten, ohne Verletztenzahlen, Gewaltdetails oder dramatische Schilderungen.`;

// An additional gate for explicit terms. Semantic suitability is also checked by
// the author and independent reviewer; this list is deliberately not a rating.
export function familyContentAllowed(value: string) {
  return !/(?:\b(?:fick\w*|fuck\w*|scheiß\w*|scheiss\w*|arschloch\w*|hurensohn\w*|erotik\w*|erotic\w*|pornograf\w*|pornograph\w*|porno\w*|sexszene\w*|sexualisier\w*|sexuell\w*|nacktheit|nackt\w*|nudity|prostitu\w*|bordell\w*|fetisch\w*|horror\w*|gewaltverherrlich\w*|selbstverletz\w*|vulgär\w*|splatter\w*|gore|folter\w*|verstümmel\w*|vergewaltig\w*|missbrauch\w*|suizid\w*|suicide|selbstmord\w*|kokain|heroin|cannabis|glücksspiel\w*|gambling|drogenkonsum\w*)\b|\bFSK\s*[-:]?\s*(?:16|18)\b|\b18\s*\+|\b(?:alkohol|tabak|wett)[- ]?werbung\b|(?:^|[^\p{L}])(?:amk|orospu\p{L}*|siktir\p{L}*|piç|cinsel|ç[ıi]plak\p{L}*|müstehcen\p{L}*|fuhuş|genelev\p{L}*|işkence\p{L}*|tecavüz\p{L}*|intihar\p{L}*|uyuşturucu\p{L}*|kumar\p{L}*|cinayet\p{L}*)(?=$|[^\p{L}]))/iu.test(value.normalize("NFKC").toLowerCase().replace(/\u0307/g, ""));
}
export function assertFamilyContent(text: string) {
  if (!familyContentAllowed(text)) throw new Error("Inhalt nicht für das jugendfreie Radioprogramm geeignet");
}

export function familyAssetAllowed(asset: { kind: string; script?: string | null; metadata?: unknown }) {
  if (!["news", "news-main", "demo", "demo-part"].includes(asset.kind)) return true;
  const m = asset.metadata as { sources?: { title?: string }[] } | null;
  return familyContentAllowed([asset.script || "", ...(m?.sources || []).map(s => s.title || "")].join(" "));
}
