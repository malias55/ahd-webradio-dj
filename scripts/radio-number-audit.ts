// Explicit, bounded paid QA: three variants for each of the three radio voices.
// All values are synthetic test fixtures, never programme or market content.
import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { speechText } from "../src/lib/radio/pronunciation";
import { presenterForHour, servicePresenter, serviceVoiceSettings } from "../src/lib/radio/providers";
import { assertNewsCredits, elevenLabsError } from "../src/lib/radio/elevenlabs";

async function main() {
  const dir = resolve(process.argv[2] || "artifacts/number-pronunciation");
  await mkdir(dir, { recursive: true });
  const previous = await readFile(join(dir, "manifest.json"), "utf8").then(s => JSON.parse(s)).catch(() => null);
  await assertNewsCredits();
  const fixtures = [
    { role: "elias", language: "de" as const, voice: presenterForHour(10).voiceId, text: "Im Jahr 2026 kamen 1.234 Besucher. Das waren 3,05 Prozent mehr. Der Eintritt kostet 12,50 Euro. Die Ausstellung beginnt am 09.11.2026 um 13:05 Uhr." },
    { role: "susanne", language: "de" as const, voice: servicePresenter().voiceId, text: "In Mainz sind es -3,5 Grad. Der Wind weht mit 37 Kilometern pro Stunde. Auf der A 60 und der A 643 gibt es 8 Minuten Zeitverlust. Die Sperrung dauert bis 13:05 Uhr." },
    { role: "cavit", language: "tr" as const, voice: presenterForHour(7).voiceId, text: "Bir Amerikan doları 41,05 Türk lirası. Altının onsu 2.641,08 Amerikan doları. Brent petrol 73,25 dolar. BİST yüz endeksi 9.876,54 puan. Artış yüzde 3,05. Yıl 2026." },
  ];
  const manifest = [];
  let totalCharacters = 0;
  for (const [i, fixture] of fixtures.entries()) {
    for (const [j, variant] of ["auto", "normalizer", "words"].entries()) {
      const name = `sample-${i + 1}-${j + 1}.mp3`, file = join(dir, name);
      const text = variant === "words" ? speechText(fixture.text, fixture.language) : fixture.text;
      const body = { text, model_id: process.env.ELEVENLABS_TTS_MODEL || "eleven_multilingual_v2", language_code: fixture.language,
        apply_text_normalization: variant === "auto" ? "auto" : "on", seed: 246810,
        voice_settings: fixture.role === "susanne" ? serviceVoiceSettings(new Date()) : { stability: 0.65, similarity_boost: 0.75, style: 0.15, use_speaker_boost: true } };
      const record = { file: name, role: fixture.role, voice: fixture.voice, variant, original: fixture.text, request: body };
      const exists = await access(file).then(() => true, () => false);
      if (exists) {
        const saved = previous?.clips?.find((clip: { file: string }) => clip.file === name);
        if (saved?.voice !== fixture.voice || JSON.stringify(saved?.request) !== JSON.stringify(body)) throw new Error(`Existing ${name} belongs to a different audit. Use a new output directory.`);
        manifest.push(record); console.log(`Reusing ${name}`); continue;
      }
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(fixture.voice)}?output_format=mp3_44100_128`, {
        method: "POST", headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) throw elevenLabsError(response.status, await response.json().catch(() => null));
      if (!response.headers.get("content-type")?.includes("audio/")) throw new Error("No audio returned");
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
      manifest.push(record);
      totalCharacters += text.length;
      await writeFile(join(dir, "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), synthetic: true, totalCharacters, clips: manifest }, null, 2));
      console.log(JSON.stringify({ file: name, characters: text.length, reportedCost: response.headers.get("character-cost") }));
    }
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify({ generatedAt: new Date().toISOString(), synthetic: true, totalCharacters, clips: manifest }, null, 2));
  console.log(JSON.stringify({ clips: manifest.length, totalCharacters, directory: dir }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Number audit failed"); process.exitCode = 1; });
