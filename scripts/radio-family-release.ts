import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { bulletinKey, mainNewsKey, renderGermanHourly, GERMAN_NEWS_VERSION, GERMAN_EDITORIAL_VERSION, GERMAN_HANDOVER, TURKISH_NEWS_VERSION } from "../src/lib/radio/news";
import { FAMILY_CONTENT_VERSION, familyAssetAllowed } from "../src/lib/radio/family";
import { presenterForHour, speech, servicePresenter } from "../src/lib/radio/providers";
import { mixDryBulletin, type Cue, type VoiceSegment } from "../src/lib/radio/mix";
import { command, withJob } from "../src/lib/radio/store";
import { collectHourlyService, trafficReport, warningDetail } from "../src/lib/radio/service";

type Service = Awaited<ReturnType<typeof collectHourlyService>>;
async function german(sourceId: string) {
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id: sourceId } });
  const m = source.metadata as { mainAssetId?: string; service?: Service };
  if (!source.slot || source.kind !== "news" || !familyAssetAllowed(source) || !m.mainAssetId || !m.service) throw new Error("A documented, family-suitable German news edition is required");
  const slot = source.slot, key = bulletinKey(slot), mainKey = mainNewsKey(slot);
  const oldMain = await prisma.radioAsset.findUniqueOrThrow({ where: { id: m.mainAssetId } });
  if (!familyAssetAllowed(oldMain)) throw new Error("Unsuitable main news");
  await withJob(mainKey, async () => {
    if (await prisma.radioAsset.findUnique({ where: { key: mainKey } })) return;
    const dir = await mkdtemp(join(tmpdir(), "ahd-main-no-fx-"));
    try {
      const input = join(dir, "old.mp3"); await writeFile(input, oldMain.audio);
      const oldMetadata = oldMain.metadata as { timeline: Cue[]; modelCalls?: unknown[] };
      const cues = oldMetadata.timeline.filter(c => ["intro", "story", "outro"].includes(c.kind));
      const paragraphs = oldMain.script!.split(/\n\n+/);
      if (cues.length !== paragraphs.length) throw new Error("Incomplete original main timeline");
      const segments: VoiceSegment[] = [];
      for (let i = 0; i < cues.length; i++) {
        const cue = cues[i]; let audio: Buffer;
        if (cue.kind === "outro") { paragraphs[i] = GERMAN_HANDOVER; audio = await speech(GERMAN_HANDOVER, presenterForHour(8).voiceId); }
        else if (cue.kind === "intro") {
          paragraphs[i] = paragraphs[i].replace("Hier kommt unser KI-generierten Magazins", "Hier kommt unser KI-generiertes Magazin");
          audio = await speech(paragraphs[i], presenterForHour(8).voiceId);
        } else {
          const start = Math.max(0, cue.start - 0.04), end = Math.min(oldMain.duration, cue.end + 0.04);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Invalid speech interval");
          for (const effect of oldMetadata.timeline.filter(c => ["opener", "closer", "divider"].includes(c.kind))) if (start < effect.end && end > effect.start) throw new Error("Speech extraction overlaps imaging");
          const path = join(dir, `voice-${i}.wav`);
          await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", input, "-ss", String(start), "-t", String(end - start), "-ar", "44100", "-ac", "2", "-y", path]);
          audio = await readFile(path);
        }
        segments.push({ kind: cue.kind as VoiceSegment["kind"], audio });
      }
      const { timeline, ...audio } = await mixDryBulletin(segments, { opener: false, closer: false });
      await prisma.radioAsset.create({ data: { key: mainKey, kind: "news-main", title: oldMain.title, slot, script: paragraphs.join("\n\n"), ...audio,
        metadata: { ...(oldMain.metadata as object), timeline, programmeVersion: GERMAN_NEWS_VERSION, editorialVersion: GERMAN_EDITORIAL_VERSION, familyContentVersion: FAMILY_CONTENT_VERSION,
          remixedFrom: oldMain.id, imagingVersion: null, dividerVersion: null, modelCalls: [], originalModelCalls: oldMetadata.modelCalls || [] } as Prisma.InputJsonValue } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  await withJob(key, async () => {
    if (await prisma.radioAsset.findUnique({ where: { key } })) return;
    const main = await prisma.radioAsset.findUniqueOrThrow({ where: { key: mainKey } });
    // This is an archive remix: preserve the real 08:00 edition's data timestamps.
    const service: Service = JSON.parse(JSON.stringify(m.service));
    service.weather.text = service.weather.text.replace("Das Wetter für Mainz und Umgebung, Messstand", "Ihr Wetter für Mainz und Umgebung! Stand").replace("Es sind rund", "Aktuell rund")
      .replace("Der Wind erreicht im Mittel rund", "Der Wind weht im Mittel mit").replace("Kilometer pro Stunde", "Kilometern pro Stunde")
      .replace("Die Wetterdaten kommen vom Deutschen Wetterdienst über Bright Sky.", "Wetterdaten: Deutscher Wetterdienst, über Bright Sky.");
    service.traffic = trafficReport(service.traffic.events.map(e => e.category === "warning" ? { ...e, detail: warningDetail(e.location, [e.detail]) } : e), service.traffic.successfulFeeds, new Date(service.fetchedAt));
    const rendered = await renderGermanHourly(slot, main, false, new Date(service.fetchedAt), service);
    await prisma.radioAsset.create({ data: { key, kind: "news", title: `KI-Magazin · 8:00 Uhr · Elias & ${servicePresenter().name} · Ohne Übergangssounds`, slot, ...rendered,
      metadata: { ...rendered.metadata, correctedAt: new Date().toISOString(), remixedFrom: source.id, correction: "Family content policy, no German imaging, energetic weather and traffic", modelCalls: [] } } });
  });
  const result = await prisma.radioAsset.findUniqueOrThrow({ where: { key } });
  if (result.id !== source.id) await prisma.radioAsset.update({ where: { id: source.id }, data: { metadata: { ...(source.metadata as object), supersededBy: result.id } } });
  const path = resolve("artifacts/nachrichten-mainz-de-susanne.mp3"); await writeFile(path, result.audio); await writeFile(path.replace(/mp3$/, "txt"), result.script || "");
  const metadata = result.metadata as { timeline: Cue[] };
  if (metadata.timeline.some(c => ["opener", "closer", "divider"].includes(c.kind))) throw new Error("Unexpected German imaging");
  const weather = metadata.timeline.find(c => c.kind === "weather")!;
  const seconds = Math.min(25, result.duration - weather.start);
  await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", path, "-ss", String(weather.start), "-t", String(seconds), "-af", `afade=t=out:st=${seconds - 0.3}:d=0.3`, "-c:a", "libmp3lame", "-b:a", "128k", "-y", resolve("artifacts/susanne-wetter-hoerprobe.mp3")]);
  return { id: result.id, duration: result.duration, path, modelCalls: 0 };
}
async function turkish(sourceId: string) {
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id: sourceId } });
  if (!source.slot || !familyAssetAllowed(source)) throw new Error("Turkish edition unsuitable");
  const key = bulletinKey(source.slot);
  const result = await prisma.radioAsset.upsert({ where: { key }, update: {}, create: { key, kind: "news", slot: source.slot, title: source.title, script: source.script, audio: source.audio, duration: source.duration,
    metadata: { ...(source.metadata as object), programmeVersion: TURKISH_NEWS_VERSION, familyContentVersion: FAMILY_CONTENT_VERSION, remixedFrom: source.id, correctedAt: new Date().toISOString(), correction: "Family content policy applied; existing recording retained", modelCalls: [] } } });
  if (result.id !== source.id) await prisma.radioAsset.update({ where: { id: source.id }, data: { metadata: { ...(source.metadata as object), supersededBy: result.id } } });
  return { id: result.id, duration: result.duration, ttsCalls: 0, modelCalls: 0 };
}
async function main() { await mkdir(resolve("artifacts"), { recursive: true }); console.log(JSON.stringify({ german: await german(process.argv[2]), turkish: await turkish(process.argv[3]) }, null, 2)); }
main().catch(e => { console.error(e instanceof Error ? e.message : "Release failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
