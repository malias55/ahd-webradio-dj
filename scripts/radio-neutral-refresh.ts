import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { germanIntroSpeech, bulletinKey, mainNewsKey, GERMAN_NEWS_VERSION } from "../src/lib/radio/news";
import { germanBrandingAllowed } from "../src/lib/radio/presentation";
import { familyAssetAllowed } from "../src/lib/radio/family";
import { command, normalizeAudio, withJob } from "../src/lib/radio/store";
import type { Cue } from "../src/lib/radio/mix";

// Replaces only a documented opening clip. Original recordings/playbacks remain
// intact; no editorial model calls and no new stories, weather or traffic.
async function refresh(id: string, replacements: Map<string, string>) {
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id } });
  const m = source.metadata as { language?: string; timeline?: Cue[]; mainAssetId?: string };
  if (!source.slot || !["news", "news-main"].includes(source.kind) || m?.language !== "de" || !familyAssetAllowed(source)) throw new Error("Geprüfte deutsche Ausgabe erforderlich");
  const opening = m.timeline?.[0], firstStory = m.timeline?.[1];
  if (opening?.kind !== "intro" || firstStory?.kind !== "story" || firstStory.start <= opening.end) throw new Error("Keine sichere Intro-Schnittgrenze vorhanden");
  const key = source.kind === "news-main" ? mainNewsKey(source.slot) : bulletinKey(source.slot);
  await withJob(key, async () => {
    if (await prisma.radioAsset.findUnique({ where: { key }, select: { id: true } })) return;
    const intro = await germanIntroSpeech();
    const paragraphs = (source.script || "").split(/\n\n+/); paragraphs[0] = intro.script || "";
    const script = paragraphs.join("\n\n");
    if (!germanBrandingAllowed(script)) throw new Error("Weitere Autohausnennung außerhalb des Intros; gezielte Korrektur erforderlich");
    const dir = await mkdtemp(join(tmpdir(), "ahd-neutral-refresh-"));
    try {
      const old = join(dir, "source.mp3"), voice = join(dir, "intro.mp3"), out = join(dir, "neutral.wav");
      await writeFile(old, source.audio); await writeFile(voice, intro.audio);
      const storyStart = 0.25 + intro.duration + 0.5, offset = storyStart - firstStory.start;
      await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", voice, "-i", old,
        "-filter_complex", `[0:a]adelay=250:all=1,apad=whole_dur=${storyStart},atrim=duration=${storyStart},asetpts=PTS-STARTPTS[v];[1:a]atrim=start=${firstStory.start},asetpts=PTS-STARTPTS[b];[v][b]concat=n=2:v=0:a=1[out]`,
        "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", out]);
      const audio = await normalizeAudio(await readFile(out), 270);
      const metadata = { ...(source.metadata as Record<string, unknown>) }; delete metadata.supersededBy;
      if (metadata.audioDesignReview) { metadata.sourceAudioDesignReview = metadata.audioDesignReview; delete metadata.audioDesignReview; }
      await prisma.radioAsset.create({ data: { key, kind: source.kind, title: source.title, slot: source.slot, script, ...audio,
        metadata: { ...metadata, programmeVersion: GERMAN_NEWS_VERSION,
          ...(m.mainAssetId && replacements.has(m.mainAssetId) ? { mainAssetId: replacements.get(m.mainAssetId) } : {}),
          openingSpeechAssetId: intro.id, correctedAt: new Date().toISOString(), correction: "Senderneutrale Begrüßung; Meldungen, Wetter und Verkehr unverändert übernommen", remixedFrom: source.id, modelCalls: [],
          timeline: [{ kind: "intro", start: 0.25, end: 0.25 + intro.duration }, ...m.timeline!.slice(1).map(c => ({ ...c, start: c.start + offset, end: c.end + offset }))] } as Prisma.InputJsonValue } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const asset = await prisma.radioAsset.findUniqueOrThrow({ where: { key } });
  if (asset.id !== source.id) await prisma.radioAsset.update({ where: { id: source.id }, data: { metadata: { ...(source.metadata as object), supersededBy: asset.id } } });
  replacements.set(source.id, asset.id);
  console.log(JSON.stringify({ id: asset.id, key, duration: asset.duration, remixedFrom: source.id, branded: !germanBrandingAllowed(asset.script || "") }));
}
async function main() { const replacements = new Map<string, string>(); for (const id of process.argv.slice(2)) await refresh(id, replacements); }
main().catch(e => { console.error(e instanceof Error ? e.message : "Intro-Korrektur fehlgeschlagen"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
