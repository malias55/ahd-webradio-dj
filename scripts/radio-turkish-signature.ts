import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { command, withJob } from "../src/lib/radio/store";
import { TURKISH_SIGNATURE_KEY } from "../src/lib/radio/imaging";

async function main() {
  const source = process.argv[2];
  if (!source) throw new Error("Path to approved audio required");
  await withJob(TURKISH_SIGNATURE_KEY, async () => {
    if (await prisma.radioAsset.findUnique({ where: { key: TURKISH_SIGNATURE_KEY } })) return;
    const original = await readFile(source), dir = await mkdtemp(join(tmpdir(), "ahd-tr-signature-"));
    try {
      const input = join(dir, "source.opus"), output = join(dir, "intro.mp3");
      await writeFile(input, original);
      await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", input,
        "-af", "areverse,silenceremove=start_periods=1:start_duration=0.05:start_threshold=-48dB:start_silence=0.10,areverse,loudnorm=I=-21:TP=-4:LRA=7",
        "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", "-y", output]);
      const sourceDuration = Number(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input]));
      const duration = Number(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", output]));
      if (!Number.isFinite(duration) || duration < 1 || duration > 5) throw new Error("Invalid signature duration");
      await prisma.radioAsset.create({ data: { key: TURKISH_SIGNATURE_KEY, kind: "imaging", title: "Türkçe · Ausgewähltes kurzes Intro", audio: await readFile(output), duration,
        metadata: { language: "tr", role: "opener", imported: true, approvedByUser: true, sourceName: basename(source), sourceSha256: createHash("sha256").update(original).digest("hex"), trailingSilenceTrimmed: true, sourceDurationSeconds: sourceDuration, loudnessLufs: -21, peakDbtp: -4, usage: "Einmal nach dem gesprochenen Einstieg; keine Sprache darunter" } } });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  console.log(await prisma.radioAsset.findUniqueOrThrow({ where: { key: TURKISH_SIGNATURE_KEY }, select: { id: true, title: true, duration: true } }));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Import failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
