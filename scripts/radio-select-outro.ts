import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { GERMAN_OUTRO_KEY } from "../src/lib/radio/imaging";
import { command } from "../src/lib/radio/store";
async function main() {
  const source = await prisma.radioAsset.findUniqueOrThrow({ where: { id: process.argv[2] } });
  if (source.kind !== "imaging" || (source.metadata as { role?: string }).role !== "closer-candidate") throw new Error("Outro candidate required");
  const existing = await prisma.radioAsset.findUnique({ where: { key: GERMAN_OUTRO_KEY } });
  if (existing) { console.log({ id: existing.id, duration: existing.duration, reused: true }); return; }
  const dir = await mkdtemp(join(tmpdir(), "ahd-outro-selected-"));
  try {
    const input = join(dir, "candidate.mp3"), output = join(dir, "selected.mp3"); await writeFile(input, source.audio);
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", input, "-af", `afade=t=out:st=${Math.max(0, source.duration - 0.1)}:d=0.1`, "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", "-y", output]);
    const duration = Number(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output]));
    const asset = await prisma.radioAsset.create({ data: { key: GERMAN_OUTRO_KEY, kind: "imaging", title: "Mainz · Energetischer Radioabschluss", audio: await readFile(output), duration,
      metadata: { ...(source.metadata as object), role: "closer", sourceAssetId: source.id, selectedAfterReview: true, audioReviewer: "gpt-audio-1.5", editorialReviewer: "claude-opus-5-5", usage: "Einmal nach dem letzten gesprochenen Wort, niemals unter Sprache oder zwischen Meldungen", fadeOutSeconds: 0.1 } } });
    console.log({ id: asset.id, duration, sourceAssetId: source.id });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Selection failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
