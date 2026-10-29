import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { bulletinKey, serviceOutroSpeech, turkishStaticSpeech, GERMAN_NEWS_VERSION, TURKISH_NEWS_VERSION } from "../src/lib/radio/news";
import { germanOutroAsset, turkishSignatureAsset } from "../src/lib/radio/imaging";
import { familyAssetAllowed } from "../src/lib/radio/family";
import { mixDryBulletin, appendNewsOutro, type Cue } from "../src/lib/radio/mix";
import { command, withJob } from "../src/lib/radio/store";

async function replaceClosing(id: string) {
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id } });
  const m = source.metadata as { language: "de" | "tr"; timeline: Cue[] };
  if (source.kind !== "news" || !source.slot || !familyAssetAllowed(source) || !["de", "tr"].includes(m.language)) throw new Error("A family-suitable news recording is required");
  const slot = source.slot, key = bulletinKey(slot);
  await withJob(key, async () => {
    if (await prisma.radioAsset.findUnique({ where: { key } })) return;
    const closeVoice = m.language === "tr" ? await turkishStaticSpeech("outro") : await serviceOutroSpeech();
    const sound = m.language === "tr" ? await turkishSignatureAsset() : await germanOutroAsset();
    const previous = m.timeline.filter(c => c.kind === "outro").at(-1);
    if (!previous) throw new Error("Closing speech timeline missing");
    const cutEnd = previous.start - 0.15;
    const precedingSpeech = m.timeline.filter(c => ["invocation", "intro", "story", "weather", "traffic", "outro"].includes(c.kind) && c.end <= previous.start);
    if (cutEnd <= Math.max(...precedingSpeech.map(c => c.end)) || cutEnd <= 0) throw new Error("Closing cut would truncate speech");
    const dir = await mkdtemp(join(tmpdir(), "ahd-outro-release-"));
    try {
      const input = join(dir, "old.mp3"), prefix = join(dir, "prefix.wav"), close = join(dir, "closing.mp3"), combined = join(dir, "combined.wav");
      await writeFile(input, source.audio);
      await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", input, "-t", String(cutEnd), "-ar", "44100", "-ac", "2", "-y", prefix]);
      const duration = Number(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", prefix]));
      const closing = await mixDryBulletin([{ kind: "outro", audio: Buffer.from(closeVoice.audio) }], { opener: false, closer: false });
      await writeFile(close, closing.audio);
      await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", prefix, "-i", close, "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", combined]);
      const beforeTimeline = [...m.timeline.filter(c => c.end <= cutEnd), ...closing.timeline.map(c => ({ ...c, start: c.start + duration, end: c.end + duration }))];
      const { timeline, ...audio } = await appendNewsOutro({ audio: await readFile(combined), duration: duration + closing.duration, timeline: beforeTimeline }, sound);
      const paragraphs = (source.script || "").split(/\n\n+/); paragraphs[paragraphs.length - 1] = closeVoice.script || "";
      const metadata = { ...(source.metadata as Record<string, unknown>) }; delete metadata.supersededBy;
      await prisma.radioAsset.create({ data: { key, kind: "news", title: m.language === "tr" ? source.title : "KI-Magazin · 8:00 Uhr · Elias & Susanne", slot, script: paragraphs.join("\n\n"), ...audio,
        metadata: { ...metadata, programmeVersion: m.language === "tr" ? TURKISH_NEWS_VERSION : GERMAN_NEWS_VERSION, imagingVersion: sound.key, timeline, outroAssetId: sound.id, closingSpeechAssetId: closeVoice.id,
          correctedAt: new Date().toISOString(), correction: "Energetic musical close after speech; corrected closing wording", remixedFrom: source.id, remainingSpeechReused: true, modelCalls: [] } as Prisma.InputJsonValue } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const asset = await prisma.radioAsset.findUniqueOrThrow({ where: { key } });
  if (source.id !== asset.id) await prisma.radioAsset.update({ where: { id: source.id }, data: { metadata: { ...(source.metadata as object), supersededBy: asset.id } } });
  const name = m.language === "tr" ? "haberler-turkiye-tr-outro" : "nachrichten-mainz-de-outro";
  const path = resolve("artifacts", name + ".mp3"); await writeFile(path, asset.audio); await writeFile(path.replace(/mp3$/, "txt"), asset.script || "");
  const timeline = (asset.metadata as { timeline: Cue[] }).timeline;
  const voice = timeline.filter(c => c.kind === "outro").at(-1)!, sound = timeline.find(c => c.kind === "closer")!;
  const excerpt = resolve(`artifacts/outro-review/${m.language}-final-outro.mp3`);
  await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", path, "-ss", String(Math.max(0, voice.start - 0.15)), "-c:a", "libmp3lame", "-b:a", "128k", "-y", excerpt]);
  const report = { language: m.language, id: asset.id, duration: asset.duration, path, excerpt, gapAfterSpeech: sound.start - voice.end, musicalSeconds: sound.end - sound.start, ending: asset.script?.split(/\n\n+/).at(-1), allOtherSpeechReused: true };
  await writeFile(resolve(`artifacts/outro-review/${m.language}-engineering.json`), JSON.stringify(report, null, 2));
  return report;
}
async function main() { await mkdir(resolve("artifacts/outro-review"), { recursive: true }); console.log(JSON.stringify([await replaceClosing(process.argv[2]), await replaceClosing(process.argv[3])], null, 2)); }
main().catch(e => { console.error(e instanceof Error ? e.message : "Closing remix failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
