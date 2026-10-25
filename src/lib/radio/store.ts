import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../prisma";

export async function command(binary: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(/* turbopackIgnore: true */ binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", b => { out = (out + b).slice(-16000); });
    p.stderr.on("data", b => { err = (err + b).slice(-2000); });
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new Error(`${binary} timed out`)); }, timeout);
    p.on("error", e => { clearTimeout(timer); reject(e); });
    p.on("close", code => { clearTimeout(timer); code === 0 ? resolve(out) : reject(new Error(`${binary} exited ${code}: ${err}`)); });
  });
}

export async function normalizeAudio(input: Buffer, maxDuration = 600) {
  const dir = await mkdtemp(join(tmpdir(), "ahd-audio-"));
  try {
    const src = join(dir, "input"), dst = join(dir, "output.mp3");
    await writeFile(src, input);
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", src,
      "-t", String(maxDuration), "-vn", "-af", "loudnorm=I=-18:TP=-2:LRA=9",
      "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", "-y", dst]);
    const duration = Number(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", dst]));
    if (!Number.isFinite(duration) || duration < 1) throw new Error("Invalid generated audio");
    return { audio: await readFile(dst), duration };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

const cacheDir = join(tmpdir(), "ahd-radio-cache");
export async function assetFile(id: string) {
  await mkdir(cacheDir, { recursive: true });
  const path = join(cacheDir, `${id}.mp3`);
  try { await readFile(path); return path; } catch {}
  const asset = await prisma.radioAsset.findUniqueOrThrow({ where: { id }, select: { audio: true } });
  await writeFile(path, asset.audio);
  return path;
}

export async function withJob(key: string, work: () => Promise<void>) {
  await prisma.radioJob.createMany({ data: [{ key }], skipDuplicates: true });
  const claimed = await prisma.radioJob.updateMany({ where: {
    key, attempts: { lt: 3 }, OR: [{ status: "pending" }, { status: "failed", leaseUntil: { lt: new Date() } }, { status: "running", leaseUntil: { lt: new Date() } }],
  }, data: { status: "running", attempts: { increment: 1 }, leaseUntil: new Date(Date.now() + 15 * 60_000), error: null } });
  if (!claimed.count) return false;
  try {
    await work();
    await prisma.radioJob.update({ where: { key }, data: { status: "done", leaseUntil: null } });
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Generation failed";
    await prisma.radioJob.update({ where: { key }, data: { status: "failed", error: message.slice(0, 500), leaseUntil: new Date(Date.now() + 60_000) } });
    throw e;
  }
}

export async function pruneCache() {
  const assets = await prisma.radioAsset.findMany({ select: { id: true } });
  const keep = new Set(assets.map(a => `${a.id}.mp3`));
  const files = await readdir(cacheDir).catch(() => [] as string[]);
  await Promise.all(files.filter(f => !keep.has(f)).map(f => rm(join(cacheDir, f), { force: true })));
}
