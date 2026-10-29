import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import { bulletinKey, TURKISH_NEWS_VERSION, TURKISH_OPENING } from "../src/lib/radio/news";
import { command, normalizeAudio, withJob } from "../src/lib/radio/store";
import type { Cue } from "../src/lib/radio/mix";

// Reuse every spoken sample. This is possible only for already dry recordings;
// this operation deliberately refuses any recording with a background bed.
async function main() {
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id: process.argv[2] } });
  const m = source.metadata as { language?: string; backgroundMusic?: boolean; timeline?: Cue[] };
  if (m.language !== "tr" || m.backgroundMusic !== false || !source.script?.startsWith(TURKISH_OPENING)) throw new Error("Only correctly pronounced, dry Turkish editions can be remixed");
  const voices = m.timeline?.filter(c => ["invocation", "intro", "story", "outro"].includes(c.kind));
  if (!voices?.length || voices[0].kind !== "invocation" || voices.at(-1)?.kind !== "outro" || !source.slot) throw new Error("Incomplete speech timeline");
  const key = bulletinKey(source.slot);
  await withJob(key, async () => {
    if (await prisma.radioAsset.findUnique({ where: { key } })) return;
    const dir = await mkdtemp(join(tmpdir(), "ahd-tr-speech-only-"));
    try {
      const input = join(dir, "original.mp3"), output = join(dir, "speech.wav");
      await writeFile(input, source.audio);
      const filters: string[] = [], streams: string[] = [], timeline: Cue[] = [];
      let cursor = 0;
      voices.forEach((cue, i) => {
        // Include the small encoder margin only where it remains inside silence.
        const sounds = m.timeline!.filter(c => ["opener", "closer", "divider"].includes(c.kind));
        const start = Math.max(0, cue.start - 0.04, ...sounds.filter(c => c.end <= cue.start).map(c => c.end));
        const end = Math.min(source.duration, cue.end + 0.04, ...sounds.filter(c => c.start >= cue.end).map(c => c.start));
        const length = end - start;
        if (!Number.isFinite(start) || !Number.isFinite(length) || length <= 0 || cue.start < 0 || cue.end > source.duration) throw new Error("Invalid speech interval");
        for (const sound of m.timeline!.filter(c => ["opener", "closer", "divider"].includes(c.kind)))
          if (start < sound.end && end > sound.start) throw new Error("Speech extraction would retain a sound effect");
        filters.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[v${i}]`);
        streams.push(`[v${i}]`);
        timeline.push({ kind: cue.kind, start: cursor, end: cursor + length });
        cursor += length;
        if (i < voices.length - 1) {
          filters.push(`anullsrc=r=44100:cl=stereo,atrim=duration=0.7[s${i}]`);
          streams.push(`[s${i}]`); cursor += 0.7;
        }
      });
      filters.push(`${streams.join("")}concat=n=${streams.length}:v=0:a=1[out]`);
      await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", input, "-filter_complex", filters.join(";"), "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", output]);
      const audio = await normalizeAudio(await readFile(output), 270);
      await prisma.radioAsset.create({ data: { key, kind: "news", title: source.title, slot: source.slot, script: source.script, ...audio,
        metadata: { ...(source.metadata as object), programmeVersion: TURKISH_NEWS_VERSION, imagingVersion: null, dividerVersion: null, timeline,
          remixedFrom: source.id, correctedAt: new Date().toISOString(), correction: "Speech and pauses only; all imaging removed", speechReused: true, modelCalls: [] } } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const corrected = await prisma.radioAsset.findUnique({ where: { key } });
  if (!corrected) throw new Error("Remix nicht bereit; ein laufender oder kürzlich fehlgeschlagener Job muss zuerst seine Sperrzeit beenden.");
  if (source.id !== corrected.id) await prisma.radioAsset.update({ where: { id: source.id }, data: { metadata: { ...(source.metadata as object), supersededBy: corrected.id } } });
  await mkdir(resolve("artifacts"), { recursive: true });
  const path = resolve("artifacts", "haberler-turkiye-tr-nur-sprache.mp3");
  await writeFile(path, corrected.audio);
  console.log(JSON.stringify({ id: corrected.id, duration: corrected.duration, path, modelCalls: 0, ttsCalls: 0, transitionSounds: 0 }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Remix failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
