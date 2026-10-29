import { mkdir, writeFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { prisma } from "../src/lib/prisma";
import { composeMusic } from "../src/lib/radio/providers";
import { command, withJob } from "../src/lib/radio/store";
const prompts = [
  "An original four-second instrumental daytime radio magazine closing button. Energetic, sunny, confident, polished, welcoming. Tight 112 BPM pop-soul rhythm, warm rounded electric bass, clean rhythmic electric guitar, bright natural piano chord stabs. One immediately memorable three-note rising hook, a tasteful single drum pickup, then a clearly resolved major chord with a short natural tail. Starts instantly and finishes decisively within four seconds. Studio-clean broadcast sound, modest dynamics. No singing, no speech, no spoken station name, no choir, no metallic chimes, no bells, no vibraphone, no swoosh, no sci-fi alarm or news panic, no harsh cymbals, no long pad or ambient wash. Premium mainstream adult radio for a friendly car showroom, not a commercial fanfare.",
  "Original four-second instrumental radio magazine outro, uplifting and rhythmically confident at 108 BPM. Crisp but soft kick and brushed snare pickup, warm bass groove, a catchy syncopated clean guitar phrase answered by two bright piano chords. Contemporary German adult daytime radio feel, friendly and energetic, natural acoustic texture with polished production. Very short musical signature: quick lift, satisfying major-key resolution and clean end, no fade-out song excerpt. Not dramatic or urgent. No voices, no vocals, no bells, no chimes, no beeps, no synthetic whoosh, no distorted or aggressive drums, no long silence at the end. Whole musical idea complete within four seconds.",
  "Original four-second upbeat daytime radio closing signature, full energy from the very first beat. Punchy modern pop-funk groove at 120 BPM: tight kick, crisp snare and handclap, warm electric bass, bright syncopated clean guitar, and two short cheerful brass chord stabs. A confident rising musical hook leads to a strong, clearly resolved major-key ending. Contemporary mainstream radio, positive and memorable, not a relaxing lounge pad. Whole compact musical idea, no long build-up and no long fade. Clean polished mix, round bass, lively rhythm, smooth treble. Pure instrumental: no speech, no singing, no choir, no siren, no alarm, no metallic chime, no distorted impact. A complete energetic sign-off finished within four seconds.",
];
async function main() {
  await mkdir(resolve("artifacts/outro-review"), { recursive: true });
  for (const [index, prompt] of prompts.entries()) {
    const key = `imaging:de-outro-candidate-v1:${index}`;
    await withJob(key, async () => {
      if (await prisma.radioAsset.findUnique({ where: { key } })) return;
      const rawPath = resolve(`artifacts/outro-review/german-raw-${index + 1}.mp3`);
      let raw: Buffer;
      try { raw = await readFile(rawPath); } catch { raw = await composeMusic(prompt, 4); await writeFile(rawPath, raw); }
      const dir = await mkdtemp(join(tmpdir(), "ahd-outro-candidate-"));
      try {
        const input = join(dir, "raw.mp3"), output = join(dir, "outro.mp3"); await writeFile(input, raw);
        await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", input, "-t", "4.2", "-af", `areverse,silenceremove=start_periods=1:start_duration=0.04:start_threshold=-50dB:start_silence=0.08,areverse,highpass=f=40,lowpass=f=12000,loudnorm=I=${index === 2 ? -18.5 : -20}:TP=-2:LRA=7`, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", "-y", output]);
        const duration = Number(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output]));
        if (!Number.isFinite(duration) || duration < 1 || duration > 5) throw new Error(`Invalid outro candidate duration: ${duration}`);
        await prisma.radioAsset.create({ data: { key, kind: "imaging", title: `Deutscher Radioabschluss · Kandidat ${index + 1}`, duration, audio: await readFile(output), metadata: { role: "closer-candidate", prompt, language: "de", generated: true, musicModel: process.env.ELEVENLABS_MUSIC_MODEL || "music_v2", loudnessLufs: index === 2 ? -18.5 : -20, peakDbtp: -2 } } });
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
    const asset = await prisma.radioAsset.findUniqueOrThrow({ where: { key } });
    const path = resolve(`artifacts/outro-review/german-candidate-${index + 1}.mp3`); await writeFile(path, asset.audio);
    console.log({ id: asset.id, duration: asset.duration, path });
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Generation failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
