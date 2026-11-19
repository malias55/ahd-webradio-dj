import { spokenNumbers } from "./spoken-numbers";
export const TURKISH_PRONUNCIATION_VERSION = "tr-dorsuk-terete-nokta-joined-endings-v4";
export const NUMBER_PRONUNCIATION_VERSION = "de-tr-spoken-numbers-v2";

// Turkish writes a case ending after a proper noun behind an apostrophe:
// "Erdoğan'ın". The apostrophe is not spoken, and the last consonant of the
// name opens the next syllable: Er-do-ğa-nın. The voice model stops at the
// apostrophe instead and reads the ending as a word of its own (Er-do-ğan | ın).
// The speaking copy therefore joins the ending to the name, exactly as Turkish
// spells every common noun (adamın, evde).
//
// Only names that are read as they are written are joined. For a foreign name
// the apostrophe keeps the stem recognisable ("Google'ın", "Biden'ın",
// "Renault'nun"); joined, it would be read letter by letter in Turkish. Such a
// name shows itself by an ending that follows its pronunciation rather than its
// spelling, by letters outside the Turkish alphabet, or by letter groups that
// Turkish spelling does not use (sch, ch, th, two vowels in a row).
const TURKISH_WORD = /^[abcçdefgğhıijklmnoöprsştuüvyzâîû]+$/u;
const FOREIGN_SPELLING = /sch|ch|ck|ph|th|sh|tz|[aeıioöuüâîû]{2}/u;
const BACK = "aıouâû", VOWELS = "aeıioöuüâîû", VOICELESS = "pçtkfhsş";
const ENDING = new RegExp(`^(?:${[
  "l[ae]r(?:[ıi](?:n(?:[ıi]n?|[ae]|d[ae]n?))?|[ae]|d[ae]n?|l[ae])?", // -lar, -ları, -larının, -lara, -larda
  "[yn]?[ıiuü]n?",             // -ı, -yı, -nı, -ın, -nın
  "[yn]?[ae]",                 // -a, -ya, -na
  "n?[dt][ae]n?",              // -da, -dan, -nda, -ndan, -ta, -tan
  "n?[dt][ae]k[iü](?:ler)?",   // -daki, -ndeki
  "n?[ıiuü]nk[iü]",            // -ınki, -nınki
  "y?l[ae]",                   // -la, -yla
  "[dt][ıiuü]r", "l[ıiuü]", "[cç][ae]",
].join("|")})$`, "u");

function joinsAsWritten(stem: string, ending: string) {
  // Acronyms are spelled out letter by letter and keep their apostrophe.
  if (stem.length < 2 || stem === stem.toLocaleUpperCase("tr")) return false;
  const word = stem.toLocaleLowerCase("tr");
  if (!TURKISH_WORD.test(word) || FOREIGN_SPELLING.test(word) || !ENDING.test(ending)) return false;
  const lastVowel = [...word].reverse().find(letter => VOWELS.includes(letter));
  const endingVowel = [...ending].find(letter => VOWELS.includes(letter));
  if (!lastVowel || !endingVowel) return false;
  // Vowel harmony: the ending must be the one the spelling calls for.
  const expected = "ae".includes(endingVowel) ? (BACK.includes(lastVowel) ? "a" : "e")
    : "aıâ".includes(lastVowel) ? "ı" : "eiî".includes(lastVowel) ? "i" : "ouû".includes(lastVowel) ? "u" : "ü";
  if (endingVowel !== expected) return false;
  const last = word.at(-1)!, first = ending[0];
  if (VOWELS.includes(last)) return !VOWELS.includes(first);
  // After a consonant there is no buffer letter, and d/c harden after a voiceless one.
  if (/^[yn][ıiuüae]/u.test(ending) || /^n[dt]/u.test(ending)) return false;
  if ("dc".includes(first)) return !VOICELESS.includes(last);
  if ("tç".includes(first)) return VOICELESS.includes(last);
  return true;
}

export function joinTurkishEndings(text: string) {
  return text.replace(/(?<![\p{L}\p{N}'’‘ʼ])(\p{L}+)['’‘ʼ](\p{Ll}+)(?![\p{L}\p{N}'’‘ʼ])/gu,
    (match, stem: string, ending: string) => joinsAsWritten(stem, ending) ? stem + ending : match);
}

// Normalize only the speaking copy; source material and values stay unchanged.
export function speechText(text: string, language: "de" | "tr") {
  if (language !== "tr") return spokenNumbers(text, language);
  return spokenNumbers(joinTurkishEndings(text
    .replace(/\b(?:Dörrschuck|Doerrschuck)\b/giu, "Dörşuk"))
    .replace(/(?<![\p{L}\p{N}])T\.?\s*R\.?\s*T\.?(?!\p{L})/giu, "TERETE")
    .replace(/TERETE(?=\d)/g, "TERETE "), language);
}
