import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { naturalRadioText } from "../src/lib/radio/presentation";
import { familyAssetAllowed } from "../src/lib/radio/family";
import { bulletinKey, mainNewsKey, renderGermanHourly, GERMAN_NEWS_VERSION, TURKISH_NEWS_VERSION, turkishStaticSpeech, turkishInvocation } from "../src/lib/radio/news";
import { newsModelConfig } from "../src/lib/radio/models";
import { collectHourlyService } from "../src/lib/radio/service";
import { turkishSignatureAsset } from "../src/lib/radio/imaging";
import { mixDryBulletin, frameTurkishProgramme, type Cue } from "../src/lib/radio/mix";
import { command, withJob } from "../src/lib/radio/store";

function metadata(source: unknown) { const m = { ...(source as Record<string, unknown>) }; delete m.supersededBy; return m; }
async function correct(id: string) {
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id } });
  if (!source.slot || source.kind !== "news" || !familyAssetAllowed(source)) throw new Error("A documented family-suitable news edition is required");
  const m = source.metadata as { language: string; mainAssetId?: string; service?: Awaited<ReturnType<typeof collectHourlyService>>; timeline: Cue[] };
  const slot = source.slot, key = bulletinKey(slot);
  await withJob(key, async () => {
    if (await prisma.radioAsset.findUnique({ where: { key } })) return;
    if (m.language === "de") {
      if (!m.mainAssetId || !m.service) throw new Error("German main/service references missing");
      const oldMain = await prisma.radioAsset.findUniqueOrThrow({ where: { id: m.mainAssetId } });
      if (!oldMain.script || naturalRadioText(oldMain.script) !== oldMain.script) throw new Error("Main news also needs a speech correction");
      const main = await prisma.radioAsset.upsert({ where: { key: mainNewsKey(slot) }, update: {}, create: { key: mainNewsKey(slot), kind: "news-main", title: oldMain.title, slot,
        audio: oldMain.audio, duration: oldMain.duration, script: oldMain.script, metadata: { ...metadata(oldMain.metadata), programmeVersion: GERMAN_NEWS_VERSION, remixedFrom: oldMain.id } as Prisma.InputJsonValue } });
      const service = structuredClone(m.service); service.weather.text = naturalRadioText(service.weather.text); service.traffic.text = naturalRadioText(service.traffic.text);
      const rendered = await renderGermanHourly(slot, main, false, new Date(service.fetchedAt), service);
      await prisma.radioAsset.create({ data: { key, kind: "news", title: source.title, slot, ...rendered,
        metadata: { ...rendered.metadata, correctedAt: new Date().toISOString(), remixedFrom: source.id, correction: "Natural presentation without technical timestamps or dashboard comments", mainSpeechReused: true, modelPolicy: newsModelConfig(), modelCalls: [] } } });
    } else if (m.language === "tr") {
      const introCue = m.timeline.find(c => c.kind === "intro"), outroCue = m.timeline.find(c => c.kind === "outro");
      if (!introCue || !outroCue) throw new Error("Turkish body timeline missing");
      const outro = await turkishStaticSpeech("outro"), invocation = await turkishInvocation(), signature = await turkishSignatureAsset();
      const dir = await mkdtemp(join(tmpdir(), "ahd-tr-natural-"));
      try {
        const input = join(dir, "old.mp3"), output = join(dir, "body.wav"); await writeFile(input, source.audio);
        // Intro and all stories already have dry voice. Keep their complete span,
        // including pauses, so no story needs another TTS call.
        const start = Math.max(0, introCue.start - 0.04), end = outroCue.start - 0.15;
        if (end <= start) throw new Error("Invalid Turkish body interval");
        await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", input, "-ss", String(start), "-t", String(end - start), "-ar", "44100", "-ac", "2", "-y", output]);
        const prefixDuration = Number(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output]));
        const close = await mixDryBulletin([{ kind: "outro", audio: Buffer.from(outro.audio) }], { opener: false, closer: false });
        const bodyPath = join(dir, "joined.wav"), closePath = join(dir, "close.mp3"); await writeFile(closePath, close.audio);
        await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", output, "-i", closePath, "-filter_complex", "[0:a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", bodyPath]);
        const bodyTimeline = [...m.timeline.filter(c => ["intro", "story"].includes(c.kind)).map(c => ({ ...c, start: c.start - start, end: c.end - start })), ...close.timeline.map(c => ({ ...c, start: c.start + prefixDuration, end: c.end + prefixDuration }))];
        const { timeline, ...audio } = await frameTurkishProgramme(invocation, signature, { audio: await readFile(bodyPath), duration: prefixDuration + close.duration, timeline: bodyTimeline });
        await prisma.radioAsset.create({ data: { key, kind: "news", title: source.title, slot, script: naturalRadioText(source.script || ""), ...audio,
          metadata: { ...metadata(source.metadata), programmeVersion: TURKISH_NEWS_VERSION, timeline, correctedAt: new Date().toISOString(), remixedFrom: source.id,
            correction: "Natural Turkish closing without panel references", modelPolicy: newsModelConfig(), modelCalls: [], storiesSpeechReused: true } as Prisma.InputJsonValue } });
      } finally { await rm(dir, { recursive: true, force: true }); }
    } else throw new Error("Unknown language");
  });
  const result = await prisma.radioAsset.findUniqueOrThrow({ where: { key } });
  if (/Messstand|Abrufstand|Stand\s*\d|Dashboard|radyo panelimizden/iu.test(result.script || "")) throw new Error("Unwanted production comment remains");
  if (source.id !== result.id) await prisma.radioAsset.update({ where: { id: source.id }, data: { metadata: { ...metadata(source.metadata), supersededBy: result.id } as Prisma.InputJsonValue } });
  const path = resolve("artifacts", m.language === "tr" ? "haberler-turkiye-tr-natuerlich.mp3" : "nachrichten-mainz-de-natuerlich.mp3");
  await writeFile(path, result.audio); await writeFile(path.replace(/mp3$/, "txt"), result.script || "");
  return { language: m.language, id: result.id, duration: result.duration, path, editorialModelCalls: 0 };
}
async function main() { await mkdir(resolve("artifacts"), { recursive: true }); console.log(JSON.stringify([await correct(process.argv[2]), await correct(process.argv[3])], null, 2)); }
main().catch(e => { console.error(e instanceof Error ? e.message : "Correction failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
