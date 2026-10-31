import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { elevenLabsError } from "../src/lib/radio/elevenlabs";

// Explicit maintenance command only. Purchase one complete new performance,
// save the raw audio before further processing, then reuse that exact purchase.
async function main() {
  const directory = resolve(process.argv[2] || "artifacts/turkish-broadcast-divider");
  await mkdir(directory, { recursive: true });
  const file = join(directory, "original-elevenlabs.mp3");
  try { await readFile(file); console.log("Original generation already saved; no new purchase."); return; } catch {}
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY fehlt");
  const prompt = "Original complete 2-second professional news-radio transition. Four tight electronic beats at 120 BPM, restrained low synth pulse, crisp dry ticking percussion and a short smooth rising noise texture; finish with one clean confident synthetic chord. Modern, factual, credible daytime newsroom sound, polished and understated. No brass, comedy, folk instruments, plucks, bells, jazz, vocals, spoken words, alarm, siren, cinematic boom or long reverb.";
  const model = "eleven_text_to_sound_v2", seconds = 2;
  const response = await fetch("https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128", {
    method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ text: prompt, duration_seconds: seconds, prompt_influence: 0.65, model_id: model }), signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) { let error: unknown; try { error = await response.json(); } catch {} throw elevenLabsError(response.status, error); }
  if (!response.headers.get("content-type")?.includes("audio/")) throw new Error("ElevenLabs returned no audio");
  const audio = Buffer.from(await response.arrayBuffer());
  await writeFile(file, audio);
  const provenance = { provider: "elevenlabs", model, prompt, requestedSeconds: seconds, sourceExcerpt: false, createdAt: new Date().toISOString(), billedCredits: response.headers.get("character-cost") };
  await writeFile(join(directory, "generation.json"), JSON.stringify(provenance, null, 2));
  console.log(JSON.stringify({ file, bytes: audio.length, billedCredits: provenance.billedCredits, sourceExcerpt: false }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Sound generation failed"); process.exitCode = 1; });
