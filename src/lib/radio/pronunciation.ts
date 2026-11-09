import { spokenNumbers } from "./spoken-numbers";
export const TURKISH_PRONUNCIATION_VERSION = "tr-dorsuk-terete-nokta-v3";
export const NUMBER_PRONUNCIATION_VERSION = "de-tr-spoken-numbers-v2";

// Normalize only the speaking copy; source material and values stay unchanged.
export function speechText(text: string, language: "de" | "tr") {
  if (language !== "tr") return spokenNumbers(text, language);
  return spokenNumbers(text
    .replace(/\b(?:Dörrschuck|Doerrschuck)\b/giu, "Dörşuk")
    .replace(/(?<![\p{L}\p{N}])T\.?\s*R\.?\s*T\.?(?!\p{L})/giu, "TERETE")
    .replace(/TERETE(?=\d)/g, "TERETE "), language);
}
