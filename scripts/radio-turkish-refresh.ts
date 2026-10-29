import { mkdtemp, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { bulletinKey, TURKISH_NEWS_VERSION, TURKISH_OPENING, TURKISH_OPENING_VERSION, turkishStaticSpeech, turkishInvocation, type Story } from "../src/lib/radio/news";
import { speechText, TURKISH_PRONUNCIATION_VERSION } from "../src/lib/radio/pronunciation";
import { speech, presenterForHour } from "../src/lib/radio/providers";
import { turkishSignatureAsset, TURKISH_SIGNATURE_KEY } from "../src/lib/radio/imaging";
import { command, withJob } from "../src/lib/radio/store";
import { mixDryBulletin, frameTurkishProgramme, type Cue, type VoiceSegment } from "../src/lib/radio/mix";

async function main() {
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id: process.argv[2] } });
  const m = source.metadata as { language?: string; backgroundMusic?: boolean; timeline?: Cue[]; stories?: Story[]; originalModelCalls?: unknown[]; modelCalls?: unknown[] };
  if (source.kind !== "news" || !source.slot || m.language !== "tr" || m.backgroundMusic !== false || !m.stories?.length) throw new Error("A dry Turkish news edition with documented stories is required");
  const voices = m.timeline?.filter(c => c.kind === "story");
  if (voices?.length !== m.stories.length) throw new Error("Incomplete speech timeline");
  const key = bulletinKey(source.slot);
  await withJob(key, async () => {
    if (await prisma.radioAsset.findUnique({ where: { key } })) return;
    const dir = await mkdtemp(join(tmpdir(), "ahd-tr-refresh-"));
    try {
      const [intro, outro, invocation, signature] = [await turkishStaticSpeech("intro"), await turkishStaticSpeech("outro"), await turkishInvocation(), await turkishSignatureAsset()];
      const input = join(dir, "source.mp3"); await writeFile(input, source.audio);
      const segments: VoiceSegment[] = [{ audio: Buffer.from(intro.audio), kind: "intro" }];
      const regenerated: number[] = [], reused: number[] = [];
      for (let i = 0; i < m.stories!.length; i++) {
        const text = m.stories![i].text;
        let audio: Buffer;
        if (speechText(text, "tr") !== text) {
          audio = await speech(text, presenterForHour(7).voiceId, "tr"); regenerated.push(i);
        } else {
          const cue = voices![i], start = Math.max(0, cue.start - 0.04), end = Math.min(source.duration, cue.end + 0.04);
          if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Invalid speech interval");
          for (const effect of m.timeline!.filter(c => ["opener", "divider", "closer"].includes(c.kind)))
            if (start < effect.end && end > effect.start) throw new Error("Speech cut overlaps an effect");
          const output = join(dir, `story-${i}.wav`);
          await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", input, "-ss", String(start), "-t", String(end - start), "-ar", "44100", "-ac", "2", "-y", output]);
          audio = await readFile(output); reused.push(i);
        }
        segments.push({ audio, kind: "story" });
      }
      segments.push({ audio: Buffer.from(outro.audio), kind: "outro" });
      const body = await mixDryBulletin(segments, { opener: false, closer: false });
      const { timeline, ...audio } = await frameTurkishProgramme(invocation, signature, body);
      const script = TURKISH_OPENING + [intro.script, ...m.stories!.map(s => speechText(s.text, "tr")), outro.script].join("\n\n");
      const metadata = { ...(source.metadata as object) } as Record<string, unknown>; delete metadata.supersededBy;
      await prisma.radioAsset.create({ data: { key, kind: "news", title: source.title, slot: source.slot, script, ...audio,
        metadata: { ...metadata, programmeVersion: TURKISH_NEWS_VERSION, openingVersion: TURKISH_OPENING_VERSION, pronunciationVersion: TURKISH_PRONUNCIATION_VERSION,
          imagingVersion: TURKISH_SIGNATURE_KEY, signatureAssetId: signature.id, staticSpeechAssetIds: [intro.id, outro.id], dividerVersion: null, timeline,
          remixedFrom: source.id, correctedAt: new Date().toISOString(), correction: "Autohaus Dörşuk, TERETE pronunciation and approved short intro", reusedStories: reused, resynthesizedStories: regenerated,
          modelCalls: [], originalModelCalls: m.originalModelCalls || m.modelCalls || [] } as Prisma.InputJsonValue } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const corrected = await prisma.radioAsset.findUnique({ where: { key } });
  if (!corrected) throw new Error("Edition is not ready; a generation lock is still active");
  if (source.id !== corrected.id) await prisma.radioAsset.update({ where: { id: source.id }, data: { metadata: { ...(source.metadata as object), supersededBy: corrected.id } } });
  await mkdir(resolve("artifacts"), { recursive: true });
  const path = resolve("artifacts", "haberler-turkiye-tr-dorsuk.mp3"); await writeFile(path, corrected.audio); await writeFile(path.replace(/mp3$/, "txt"), corrected.script || "");
  console.log(JSON.stringify({ id: corrected.id, duration: corrected.duration, path, modelCalls: 0, metadata: { reusedStories: (corrected.metadata as Record<string, unknown>).reusedStories, resynthesizedStories: (corrected.metadata as Record<string, unknown>).resynthesizedStories } }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Refresh failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
