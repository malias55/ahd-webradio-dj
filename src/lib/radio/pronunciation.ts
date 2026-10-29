export const TURKISH_PRONUNCIATION_VERSION = "tr-dorsuk-terete-v1";

// Explicit editorial pronunciations only; source material stays unchanged.
export function speechText(text: string, language: "de" | "tr") {
  if (language !== "tr") return text;
  return text
    .replace(/\b(?:Dörrschuck|Doerrschuck)\b/giu, "Dörşuk")
    .replace(/(?<![\p{L}\p{N}])T\.?\s*R\.?\s*T\.?(?!\p{L})/giu, "TERETE")
    .replace(/TERETE(?=\d)/g, "TERETE ");
}
