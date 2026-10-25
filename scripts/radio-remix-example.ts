import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import { generateGermanDivider, GERMAN_DIVIDER_VERSION } from "../src/lib/radio/imaging";
import { mixDryBulletin, joinNewsParts, type Cue, type VoiceSegment } from "../src/lib/radio/mix";
import { GERMAN_NEWS_VERSION } from "../src/lib/radio/news";
import { stationTime } from "../src/lib/radio/config";
import { command, withJob } from "../src/lib/radio/store";
import type { Prisma } from "@prisma/client";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("UUID eines bestehenden deutschen Hörbeispiels angeben");
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id } });
  const metadata = (source.metadata || {}) as Record<string, unknown> & { language?: string; backgroundMusic?: boolean; timeline?: Cue[]; mainAssetId?: string };
  if (source.kind !== "demo" || metadata.language !== "de" || metadata.backgroundMusic !== false || !metadata.timeline?.length)
    throw new Error("Nur ein deutsches Hörbeispiel ohne Musik unter Sprache kann verlustarm neu gemischt werden");
  await generateGermanDivider();
  const baseKey = `news-example:${GERMAN_NEWS_VERSION}:de:${stationTime().date}`, key = `${baseKey}:service-v2`;
  await withJob(key, async () => {
    if (await prisma.radioAsset.findUnique({ where: { key }, select: { id: true } })) return;
    const dir = await mkdtemp(join(tmpdir(), "ahd-news-remix-"));
    try {
      const path = join(dir, "source.mp3"); await writeFile(path, source.audio);
      const cues = metadata.timeline!.filter(c => ["intro", "story", "weather", "traffic", "outro"].includes(c.kind));
      const split = cues.findIndex(c => c.kind === "weather");
      if (split < 2 || !cues.some(c => c.kind === "traffic")) throw new Error("Hauptteil und Service sind im Beispiel nicht getrennt dokumentiert");
      const segments: VoiceSegment[] = [];
      for (const [i, cue] of cues.entries()) {
        if (!Number.isFinite(cue.start) || cue.end <= cue.start || cue.end > source.duration + 0.1) throw new Error("Ungültige Audio-Timeline");
        const clip = join(dir, `voice-${i}.wav`);
        await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", path, "-ss", String(cue.start), "-t", String(cue.end - cue.start), "-ar", "44100", "-ac", "2", "-y", clip]);
        segments.push({ audio: await readFile(clip), kind: cue.kind as VoiceSegment["kind"] });
      }
      const main = await mixDryBulletin(segments.slice(0, split), { closer: false });
      const service = await mixDryBulletin(segments.slice(split), { opener: false, leadingDivider: true });
      const mainKey = `${baseKey}:main:remix:${source.id}`;
      const originalMain = metadata.mainAssetId ? await prisma.radioAsset.findUnique({ where: { id: metadata.mainAssetId } }) : null;
      const mainAsset = await prisma.radioAsset.upsert({ where: { key: mainKey }, update: {}, create: {
        key: mainKey, kind: "demo-part", title: "Hörbeispiel · Elias · Ruhige Meldungspausen", script: originalMain?.script,
        audio: main.audio, duration: main.duration,
        metadata: { ...((originalMain?.metadata as Prisma.JsonObject) || {}), timeline: main.timeline, dividerVersion: GERMAN_DIVIDER_VERSION,
          remixedFrom: originalMain?.id || source.id, modelCalls: [] },
      } });
      const audio = await joinNewsParts(mainAsset.audio, service.audio), offset = mainAsset.duration + 0.45;
      await prisma.radioAsset.create({ data: { key, kind: "demo", title: "Hörbeispiel · Elias & Jane · Ruhige Übergänge", script: source.script, ...audio,
        metadata: { ...(source.metadata as Prisma.JsonObject), programmeVersion: GERMAN_NEWS_VERSION, dividerVersion: GERMAN_DIVIDER_VERSION,
          mainAssetId: mainAsset.id, remixedFrom: source.id, modelCalls: [], speechReused: true,
          timeline: [...main.timeline, ...service.timeline.map(c => ({ ...c, start: c.start + offset, end: c.end + offset }))] } } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const result = await prisma.radioAsset.findUniqueOrThrow({ where: { key } });
  const base = resolve("artifacts/nachrichten-mainz-de-sanfte-uebergaenge");
  await writeFile(`${base}.mp3`, result.audio); await writeFile(`${base}.txt`, result.script || "");
  await writeFile(`${base}.json`, JSON.stringify({ id: result.id, duration: result.duration, metadata: result.metadata }, null, 2));
  const m = result.metadata as { timeline: Cue[] };
  const weather = m.timeline.find(c => c.kind === "weather")!;
  const handover = m.timeline.filter(c => c.kind === "outro" && c.end < weather.start).at(-1)!;
  const excerpt = resolve("artifacts/uebergaenge-neu-hoerprobe.mp3"), seconds = weather.start + 8 - handover.start;
  await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", `${base}.mp3`, "-ss", String(handover.start), "-t", String(seconds), "-af", `afade=t=out:st=${seconds - 0.3}:d=0.3`, "-c:a", "libmp3lame", "-b:a", "128k", "-y", excerpt]);
  console.log({ id: result.id, duration: result.duration, excerpt, audio: `${base}.mp3`, speechReused: true });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
