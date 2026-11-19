import test from "node:test";
import assert from "node:assert/strict";
import { speechText, providerNormalization } from "../src/lib/radio/pronunciation";
import { spokenNumber } from "../src/lib/radio/spoken-numbers";
import { speech, serviceVoiceSettings } from "../src/lib/radio/providers";

test("German quantities preserve thousands, decimal zeroes, signs and units", () => {
  assert.equal(speechText("1.234 Besucher, 3,05 Prozent und 12,50 Euro.", "de"), "eintausendzweihundertvierunddreißig Besucher, drei Komma null fünf Prozent und zwölf Euro und fünfzig Cent.");
  assert.equal(speechText("€12,05, 1,01 Euro und 2,00 €", "de"), "zwölf Euro und fünf Cent, ein Euro und ein Cent und zwei Euro");
  assert.equal(speechText("-3,5 °C, 37 km/h, +2,00 % und 3–5 Minuten.", "de"), "minus drei Komma fünf Grad Celsius, siebenunddreißig Kilometer pro Stunde, plus zwei Komma null null Prozent und drei bis fünf Minuten.");
  assert.equal(speechText("€1, $2,641.08 und ₺41,05", "de"), "1 Euro, zweitausendsechshunderteinundvierzig Komma null acht US-Dollar und einundvierzig Komma null fünf türkische Lira");
  assert.equal(speechText("1 Euro, 1 Minute, 1 Grad, -3,05%", "de"), "1 Euro, 1 Minute, 1 Grad, minus drei Komma null fünf Prozent");
  assert.equal(speechText("mit 1 Euro, für 1 Minute und 1 Kind", "de"), "mit 1 Euro, für 1 Minute und 1 Kind", "the provider must infer gender and grammatical case");
});

test("Turkish market prices preserve magnitude and the first zero after the comma", () => {
  const cases = [
    ["41,05", "kırk bir nokta sıfır beş"], ["2.641,08", "iki bin altı yüz kırk bir nokta sıfır sekiz"],
    ["73,25", "yetmiş üç nokta iki beş"], ["9.876,54", "dokuz bin sekiz yüz yetmiş altı nokta beş dört"],
    ["0,0050", "sıfır nokta sıfır sıfır beş sıfır"], ["2,00", "iki nokta sıfır sıfır"],
  ];
  for (const [input, expected] of cases) assert.equal(spokenNumber(input, "tr"), expected);
  assert.equal(speechText("%3,05 ve 2,5%", "tr"), "yüzde üç nokta sıfır beş ve yüzde iki nokta beş");
  assert.equal(speechText("₺41,05, $73,25 ve €1", "tr"), "kırk bir nokta sıfır beş Türk lirası, yetmiş üç nokta iki beş Amerikan doları ve bir avro");
});

test("requested station pronunciation reads every decimal digit with nokta or Komma", () => {
  const cases = [
    ["41,05", "einundvierzig Komma null fünf", "kırk bir nokta sıfır beş"],
    ["1.234,50", "eintausendzweihundertvierunddreißig Komma fünf null", "bin iki yüz otuz dört nokta beş sıfır"],
    ["3,05%", "drei Komma null fünf Prozent", "yüzde üç nokta sıfır beş"],
    ["0,005‰", "null Komma null null fünf Promille", "binde sıfır nokta sıfır sıfır beş"],
    ["%-3,05", "minus drei Komma null fünf Prozent", "eksi yüzde üç nokta sıfır beş"],
    ["73,25", "dreiundsiebzig Komma zwei fünf", "yetmiş üç nokta iki beş"],
  ];
  for (const [input, de, tr] of cases) {
    assert.equal(speechText(input, "de"), de);
    assert.equal(speechText(input, "tr"), tr);
  }
  assert.equal(speechText("Kırk bir virgül sıfır beş. Bu cümlede virgül kullanılır.", "tr"), "Kırk bir nokta sıfır beş. Bu cümlede virgül kullanılır.");
  assert.equal(speechText("Değer 41,05. Sonraki değer 73,25.", "tr"), "Değer kırk bir nokta sıfır beş. Sonraki değer yetmiş üç nokta iki beş.");
  assert.equal(speechText("Der Kurs beträgt 41,05. Es folgt der nächste Wert.", "de"), "Der Kurs beträgt einundvierzig Komma null fünf. Es folgt der nächste Wert.");
});

test("fractions and mixed numbers preserve their exact value in both languages", () => {
  const cases = [
    ["1/2", "ein Halb", "yarım"], ["3/4", "drei Viertel", "dörtte üç"],
    ["3/2", "drei Halbe", "ikide üç"], ["0½", "ein Halb", "yarım"],
    ["2/3", "zwei Drittel", "üçte iki"], ["1/10", "ein Zehntel", "onda bir"],
    ["1/16", "eins geteilt durch sechzehn", "bir bölü on altı"],
    ["½", "ein Halb", "yarım"], ["¾", "drei Viertel", "dörtte üç"],
    ["2⁄3", "zwei Drittel", "üçte iki"], ["1½", "eineinhalb", "bir buçuk"],
    ["2 1/2", "zweieinhalb", "iki buçuk"], ["2¾", "zwei und drei Viertel", "iki tam dörtte üç"],
    ["-3/4", "minus drei Viertel", "eksi dörtte üç"], ["½%", "ein halbes Prozent", "yüzde sıfır nokta beş"],
    ["%1/2", "ein halbes Prozent", "yüzde sıfır nokta beş"],
    ["3/100%", "drei Hundertstel Prozent", "yüzde sıfır nokta sıfır üç"],
    ["%1/3", "ein Drittel Prozent", "yüzde üçte bir"],
  ];
  for (const [input, de, tr] of cases) {
    assert.equal(speechText(input, "de"), de, input);
    assert.equal(speechText(input, "tr"), tr, input);
    assert.equal(speechText(de, "de"), de, "normalization stays idempotent");
    assert.equal(speechText(tr, "tr"), tr, "normalization stays idempotent");
  }
  assert.equal(speechText("3/4 € und 1½ Euro", "de"), "fünfundsiebzig Cent und ein Euro und fünfzig Cent");
  assert.equal(speechText("3/4 ₺ ve 1½ €", "tr"), "dörtte üç Türk lirası ve bir buçuk avro");
  for (const input of ["2026/27", "09/11/2026", "A60/63", "3/0", "3/00", "3⁄0", "24/7", "50/50"]) for (const language of ["de", "tr"] as const)
    assert.equal(speechText(input, language), input, "dates, seasons, road references and invalid fractions are not silently reinterpreted");
});

test("dates, event times, years and roads have explicit spoken forms", () => {
  assert.equal(speechText("Am 09.11.2026 um 13:05 Uhr auf der A60 und A 643.", "de"), "Am neunten November zweitausendsechsundzwanzig um dreizehn Uhr fünf auf der A sechzig und A sechshundertdreiundvierzig.");
  assert.equal(speechText("am 1. Januar, der 9. November, um 01:00 Uhr", "de"), "am ersten Januar, der neunte November, um ein Uhr");
  assert.equal(speechText("09.11.2026, saat 13:05. 2026’da TRT2.", "tr"), "dokuz Kasım iki bin yirmi altı, saat on üç sıfır beş. iki bin yirmi altıda TERETE iki.");
  assert.equal(speechText("Die B 40 und Mainz 05", "de"), "Die B vierzig und Mainz null fünf");
  assert.equal(speechText("2. Bundesliga und 3. Platz", "de"), "2. Bundesliga und 3. Platz", "unknown ordinal grammar is left to the enabled provider normalizer");
  assert.equal(speechText("2024’ün", "tr"), "2024’ün", "suffixes requiring consonant changes are left to the provider normalizer");
});

test("Turkish case endings are joined to names that are read as written", () => {
  const joined: [string, string][] = [
    ["Cumhurbaşkanı Erdoğan'ın açıklaması", "Cumhurbaşkanı Erdoğanın açıklaması"],
    ["Erdoğan’a göre Türkiye'nin kararı", "Erdoğana göre Türkiyenin kararı"],
    ["Ankara'dan İstanbul'daki Meclis'te", "Ankaradan İstanbuldaki Mecliste"],
    ["Berlin'de, Köln'de, Frankfurt'ta, Münih'te, Irak'a, Suriye'yle", "Berlinde, Kölnde, Frankfurtta, Münihte, Iraka, Suriyeyle"],
    ["Dışişleri Bakanlığı'nın, Cumhurbaşkanlığı'ndan, Meclisi'nde", "Dışişleri Bakanlığının, Cumhurbaşkanlığından, Meclisinde"],
    ["Fenerbahçe'nin, Galatasaray'ın, Beşiktaş'ın, Türkler'in", "Fenerbahçenin, Galatasarayın, Beşiktaşın, Türklerin"],
    ["Autohaus Dörrschuck Radyo'dan merhaba. Almanya'dan", "Autohaus Dörşuk Radyodan merhaba. Almanyadan"],
    ["Allah'ın selamı üzerinize olsun.", "Allahın selamı üzerinize olsun."],
  ];
  for (const [input, expected] of joined) {
    assert.equal(speechText(input, "tr"), expected);
    assert.equal(speechText(expected, "tr"), expected, "joining stays idempotent");
  }
  // The apostrophe stays where it keeps a differently pronounced stem intact.
  for (const kept of [
    "Google'ın", "Biden'ın", "Trump'ın", "Musk'ın", "Starmer'ın", // ending follows the pronunciation
    "Renault'nun", "Mainz'da",                                    // buffer letter or voicing contradicts the spelling
    "Washington'da", "Scholz'un", "Steinmeier'in", "Seattle'da",  // foreign spelling
    "AB'nin", "ABD'de", "TBMM'ye", "NATO'nun",                    // acronyms
    "Kur'an", "Kur'an'ı", "mes'ul", "Moody's", "O'Brien", "Côte d'Ivoire", "Kemal'in",
  ]) assert.equal(speechText(kept, "tr"), kept);
  assert.equal(speechText("TRT'nin kararı", "tr"), "TERETE'nin kararı");
  assert.equal(speechText("Erdoğan'ın Rede in Türkiye's", "de"), "Erdoğan'ın Rede in Türkiye's", "German speech is unchanged");
});

test("the provider may only rewrite Turkish text in which no name can be separated from its ending", () => {
  // Without digits the text reaches the voice exactly as prepared.
  const plain = speechText("Biden'ın ve Erdoğan'ın açıklaması ABD'de, Kur'an'ı ve Kemal'in sözleri.", "tr");
  assert.equal(plain, "Biden'ın ve Erdoğanın açıklaması ABD'de, Kur'an'ı ve Kemal'in sözleri.");
  assert.equal(providerNormalization(plain, "tr"), "off");
  assert.equal(providerNormalization(speechText("Dolar 41,05 lira, artış %3.", "tr"), "tr"), "off", "the station's own number rules leave no digit");
  // Figures left to the provider: every ending is joined before it rewrites the text.
  const figures = speechText("Erdoğan'ın 3. ziyareti: Biden'ın, Google'ın, Kemal'in, Mainz'da, TRT'nin, Kur'an'ı; ABD'nin ve AB'de 2024’ün kararı.", "tr");
  assert.equal(figures, "Erdoğanın 3. ziyareti: Bidenın, Googleın, Kemalin, Mainzda, TERETEnin, Kur'anı; ABD'nin ve AB'de 2024’ün kararı.");
  assert.equal(providerNormalization(figures, "tr"), "on");
  assert.doesNotMatch(figures.replace(/\b[A-ZÇĞİÖŞÜ]{2,}['’]\p{Ll}+|\d+['’]\p{Ll}+|Kur'an/gu, ""), /['’]/, "only acronyms, figures and inner apostrophes keep one");
  assert.equal(speechText(figures, "tr"), figures, "preparation stays idempotent");
  assert.equal(speechText("Erdoğan´ın, Ankara`da ve Türkiye′nin", "tr"), "Erdoğanın, Ankarada ve Türkiyenin", "look-alike apostrophes are understood");
  // German always keeps the provider normalization and its text.
  assert.equal(providerNormalization("Ohne Zahlen.", "de"), "on");
});

test("large quantities and feed number formats do not round or change magnitude", () => {
  assert.equal(spokenNumber("1.234.567,08", "de"), "eine Million zweihundertvierunddreißigtausendfünfhundertsiebenundsechzig Komma null acht");
  assert.equal(spokenNumber("1.234.567,08", "tr"), "bir milyon iki yüz otuz dört bin beş yüz altmış yedi nokta sıfır sekiz");
  assert.equal(spokenNumber("1 234,56", "tr"), spokenNumber("1.234,56", "tr"));
  assert.equal(spokenNumber("1\u202f234,56", "de"), spokenNumber("1,234.56", "de"));
  assert.equal(spokenNumber("1.000.000.000", "de"), "eine Milliarde");
  assert.equal(spokenNumber("1.000.000.000", "tr"), "bir milyar");
  assert.equal(spokenNumber("9007199254740993", "de"), "neun null null sieben eins neun neun zwei fünf vier sieben vier null neun neun drei");
  assert.equal(spokenNumber("12.34.56", "de"), "12.34.56", "ambiguous punctuation is not silently reinterpreted");
});

test("the TTS boundary can normalize twice without changing meaning or source identifiers", () => {
  const samples = ["am 09.11.2026 um 13:05 Uhr: -3,5 °C, A643, 1.234,05 €", "2026’da TRT2 ve %3,05. 41,05 Türk lirası.", "1.234.567,08", "https://example.com/2026/123 person123@example.com X123 2026-11-09"];
  for (const language of ["de", "tr"] as const) for (const input of samples) {
    const once = speechText(input, language);
    assert.equal(speechText(once, language), once);
  }
  assert.equal(speechText(samples[3], "de"), samples[3]);
  for (const language of ["de", "tr"] as const) {
    for (const n of [0, 1, 11, 16, 17, 21, 99, 100, 101, 999, 1000, 1001, 999999, 1000000, 21000001]) {
      const result = speechText(String(n), language);
      assert.doesNotMatch(result, /\d|undefined|NaN/);
      assert.equal(speechText(result, language), result);
    }
  }
});

test("actual ElevenLabs request uses normalized words and provider normalization only where figures remain", async () => {
  const originalFetch = globalThis.fetch, key = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-only";
  const requests: any[] = [];
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } }); };
  try {
    const slot = new Date("2026-11-10T09:00:00Z");
    await speech("Auf der A643: 8 Minuten Zeitverlust.", "test-voice", "de", "service", slot);
    await speech("Bir dolar 41,05 Türk lirası.", "test-voice", "tr");
    assert.equal(requests[0].text, "Auf der A sechshundertdreiundvierzig: acht Minuten Zeitverlust.");
    assert.equal(requests[1].text, "Bir dolar kırk bir nokta sıfır beş Türk lirası.");
    await speech("Erdoğan'ın 3. ziyareti ve Biden'ın açıklaması.", "test-voice", "tr");
    assert.equal(requests[0].apply_text_normalization, "on");
    assert.equal(requests[1].apply_text_normalization, "off", "Turkish text without digits is not rewritten by the provider");
    assert.equal(requests[2].text, "Erdoğanın 3. ziyareti ve Bidenın açıklaması.");
    assert.equal(requests[2].apply_text_normalization, "on");
    assert.deepEqual(requests[0].voice_settings, serviceVoiceSettings(slot));
    assert.equal(requests[1].language_code, "tr");
  } finally { globalThis.fetch = originalFetch; if (key === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = key; }
});
