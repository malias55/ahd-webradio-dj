import { spokenNumbers } from "./spoken-numbers";
export const TURKISH_PRONUNCIATION_VERSION = "tr-dorsuk-terete-nokta-joined-endings-v5";
export const NUMBER_PRONUNCIATION_VERSION = "de-tr-spoken-numbers-v2";

// Turkish writes a case ending after a proper noun behind an apostrophe:
// "Erdoğan'ın". The apostrophe is not spoken: Er-do-ğa-nın.
//
// Measured with the station voice (2026-11-19): the voice reads the apostrophe
// correctly, but the provider's text normalization does not. Whenever it
// rewrites a text (it does for digits, acronyms and unusual characters) it
// replaces these apostrophes with a space, and the voice then reads two words:
// "Erdoğan. In", "Türkiye. Nin". Three measures prevent that:
//  1. Names read as written get their ending joined, as Turkish spells every
//     common noun (adamın, evde). The normalization leaves such words alone.
//  2. A text without digits is sent with provider normalization switched off
//     (providerNormalization); every apostrophe then reaches the voice intact.
//  3. A text that still needs the provider for its numbers gets every
//     remaining ending joined as well, also after foreign names.
//
// In step 1 only names that are read as they are written are joined. For a foreign name
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

// Real acronyms keep their apostrophe: the provider spells them out and keeps
// it ("A B D'nin"). TERETE is the station's respelling of TRT and is a word.
function joinsAnyEnding(stem: string, ending: string) {
  if (!ENDING.test(ending)) return false;
  return stem === "TERETE" || (stem.length >= 2 && stem !== stem.toLocaleUpperCase("tr"));
}

// `all` joins every ending, for texts the provider normalization will rewrite.
// The stem may itself contain an apostrophe ("Kur'an'ı" becomes "Kur'anı").
export function joinTurkishEndings(text: string, all = false) {
  return text.replace(/(?<![\p{L}\p{N}'’‘ʼ])((?:\p{L}+['’‘ʼ])*\p{L}+)['’‘ʼ](\p{Ll}+)(?![\p{L}\p{N}'’‘ʼ])/gu,
    (match, stem: string, ending: string) => (all ? joinsAnyEnding(stem, ending) : joinsAsWritten(stem, ending)) ? stem + ending : match);
}

// Digits and symbols that the station's own number rules deliberately leave to
// the provider (ordinals, endings on figures).
function needsProvider(spoken: string) { return /[\p{N}§#&+=<>]/u.test(spoken); }

// What to request from the provider for a text that speechText has prepared.
export function providerNormalization(spoken: string, language: "de" | "tr"): "on" | "off" {
  return language === "tr" && !needsProvider(spoken) ? "off" : "on";
}

// Normalize only the speaking copy; source material and values stay unchanged.
export function speechText(text: string, language: "de" | "tr") {
  if (language !== "tr") return spokenNumbers(text, language);
  const spoken = spokenNumbers(joinTurkishEndings(text
    // Accents and primes typed in place of an apostrophe make the provider
    // rewrite the text; give them the standard form first.
    .replace(/(?<=[\p{L}\p{N}])[´`′ʹ‛＇](?=\p{L})/gu, "'")
    .replace(/\b(?:Dörrschuck|Doerrschuck)\b/giu, "Dörşuk"))
    .replace(/(?<![\p{L}\p{N}])T\.?\s*R\.?\s*T\.?(?!\p{L})/giu, "TERETE")
    .replace(/TERETE(?=\d)/g, "TERETE "), language);
  return needsProvider(spoken) ? joinTurkishEndings(spoken, true) : spoken;
}
