import { spokenNumbers } from "./spoken-numbers";
export const TURKISH_PRONUNCIATION_VERSION = "tr-dorsuk-terete-numbers-v2";
export const NUMBER_PRONUNCIATION_VERSION = "de-tr-spoken-numbers-v1";

// Normalize only the speaking copy; source material and values stay unchanged.
export function speechText(text: string, language: "de" | "tr") {
  if (language !== "tr") return spokenNumbers(text, language);
  return spokenNumbers(text
    .replace(/\b(?:Dörrschuck|Doerrschuck)\b/giu, "Dörşuk")
    .replace(/(?<![\p{L}\p{N}])T\.?\s*R\.?\s*T\.?(?!\p{L})/giu, "TERETE")
    .replace(/TERETE(?=\d)/g, "TERETE "), language);
}
