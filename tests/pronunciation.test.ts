import test from "node:test";
import assert from "node:assert/strict";
import { speechText } from "../src/lib/radio/pronunciation";
import { spokenNumber } from "../src/lib/radio/spoken-numbers";
import { speech, serviceVoiceSettings } from "../src/lib/radio/providers";

test("German quantities preserve thousands, decimal zeroes, signs and units", () => {
  assert.equal(speechText("1.234 Besucher, 3,05 Prozent und 12,50 Euro.", "de"), "eintausendzweihundertvierunddreißig Besucher, drei Komma null fünf Prozent und zwölf Euro und fünfzig Cent.");
  assert.equal(speechText("€12,05, 1,01 Euro und 2,00 €", "de"), "zwölf Euro und fünf Cent, ein Euro und ein Cent und zwei Euro");
  assert.equal(speechText("-3,5 °C, 37 km/h, +2,00 % und 3–5 Minuten.", "de"), "minus drei Komma fünf Grad Celsius, siebenunddreißig Kilometer pro Stunde, plus zwei Komma null null Prozent und drei bis fünf Minuten.");
  assert.equal(speechText("€1, $2,641.08 und ₺41,05", "de"), "ein Euro, zweitausendsechshunderteinundvierzig Komma null acht US-Dollar und einundvierzig Komma null fünf türkische Lira");
  assert.equal(speechText("1 Euro, 1 Minute, 1 Grad, -3,05%", "de"), "ein Euro, eine Minute, ein Grad, minus drei Komma null fünf Prozent");
});

test("Turkish market prices preserve magnitude and the first zero after the comma", () => {
  const cases = [
    ["41,05", "kırk bir virgül sıfır beş"], ["2.641,08", "iki bin altı yüz kırk bir virgül sıfır sekiz"],
    ["73,25", "yetmiş üç virgül yirmi beş"], ["9.876,54", "dokuz bin sekiz yüz yetmiş altı virgül elli dört"],
    ["0,0050", "sıfır virgül sıfır sıfır beş sıfır"], ["2,00", "iki virgül sıfır sıfır"],
  ];
  for (const [input, expected] of cases) assert.equal(spokenNumber(input, "tr"), expected);
  assert.equal(speechText("%3,05 ve 2,5%", "tr"), "yüzde üç virgül sıfır beş ve yüzde iki virgül beş");
  assert.equal(speechText("₺41,05, $73,25 ve €1", "tr"), "kırk bir virgül sıfır beş Türk lirası, yetmiş üç virgül yirmi beş Amerikan doları ve bir avro");
});

test("dates, event times, years and roads have explicit spoken forms", () => {
  assert.equal(speechText("Am 09.11.2026 um 13:05 Uhr auf der A60 und A 643.", "de"), "Am neunten November zweitausendsechsundzwanzig um dreizehn Uhr fünf auf der A sechzig und A sechshundertdreiundvierzig.");
  assert.equal(speechText("am 1. Januar, der 9. November, um 01:00 Uhr", "de"), "am ersten Januar, der neunte November, um ein Uhr");
  assert.equal(speechText("09.11.2026, saat 13:05. 2026’da TRT2.", "tr"), "dokuz Kasım iki bin yirmi altı, saat on üç sıfır beş. iki bin yirmi altıda TERETE iki.");
  assert.equal(speechText("Die B 40 und Mainz 05", "de"), "Die B vierzig und Mainz null fünf");
  assert.equal(speechText("2. Bundesliga und 3. Platz", "de"), "2. Bundesliga und 3. Platz", "unknown ordinal grammar is left to the enabled provider normalizer");
  assert.equal(speechText("2024’ün", "tr"), "2024’ün", "suffixes requiring consonant changes are left to the provider normalizer");
});

test("large quantities and feed number formats do not round or change magnitude", () => {
  assert.equal(spokenNumber("1.234.567,08", "de"), "eine Million zweihundertvierunddreißigtausendfünfhundertsiebenundsechzig Komma null acht");
  assert.equal(spokenNumber("1.234.567,08", "tr"), "bir milyon iki yüz otuz dört bin beş yüz altmış yedi virgül sıfır sekiz");
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

test("actual ElevenLabs request always uses normalized words and enabled provider normalization", async () => {
  const originalFetch = globalThis.fetch, key = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "test-only";
  const requests: any[] = [];
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return new Response(new Uint8Array([1, 2]), { headers: { "content-type": "audio/mpeg" } }); };
  try {
    const slot = new Date("2026-11-10T09:00:00Z");
    await speech("Auf der A643: 8 Minuten Zeitverlust.", "test-voice", "de", "service", slot);
    await speech("Bir dolar 41,05 Türk lirası.", "test-voice", "tr");
    assert.equal(requests[0].text, "Auf der A sechshundertdreiundvierzig: acht Minuten Zeitverlust.");
    assert.equal(requests[1].text, "Bir dolar kırk bir virgül sıfır beş Türk lirası.");
    for (const request of requests) assert.equal(request.apply_text_normalization, "on");
    assert.deepEqual(requests[0].voice_settings, serviceVoiceSettings(slot));
    assert.equal(requests[1].language_code, "tr");
  } finally { globalThis.fetch = originalFetch; if (key === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = key; }
});
