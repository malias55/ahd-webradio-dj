import { spawn, type ChildProcess } from "node:child_process";
import { realtime } from "./realtime";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { prisma } from "../prisma";
import { hatimWindowEnd } from "./config";
import { command } from "./store";
import manifest from "./hatim-manifest.json";

export const HATIM_ID = "mp3quran-mishary-hafs-123-v1";
export const HATIM_SOURCE = { reciter: manifest.reciter, url: "https://mp3quran.net/eng/afs", permission: manifest.permission };
export type HatimCursor = { surah: number; offsetSeconds: number; completedLoops: number };
export type HatimChapter = { surah: number; name: string; verses: number[][] };
export const HATIM_CHAPTERS: HatimChapter[] = manifest.chapters;

export function nextHatimCursor(cursor: HatimCursor, chapters = HATIM_CHAPTERS): HatimCursor {
  return { surah: cursor.surah === chapters.length ? 1 : cursor.surah + 1, offsetSeconds: 0,
    completedLoops: cursor.completedLoops + (cursor.surah === chapters.length ? 1 : 0) };
}

// Euzu and Besmele open every listening session, Sadakallahulazim closes it
// after the night's last verse. Mishary Alafasy's chapter files already begin
// with the Besmele (Al-Fatiha with Euzu and Besmele, At-Tawba with Euzu only),
// so a session that starts at a chapter's beginning adds only what is missing;
// one that resumes mid-chapter adds Euzu and Besmele (At-Tawba: Euzu only).
// Euzu and Besmele are cut from Mishary's own recordings (Al-Fatiha, Al-Baqara).
// He never says Sadakallahulazim in this recitation, so it comes from Abdulbasit
// Abdulsamad's Mujawwad recording of An-Nas, levelled to Mishary's loudness.
export type HatimClip = "euzu" | "besmele" | "sadakallahulazim";
export const HATIM_CLIP_SECONDS: Record<HatimClip, number> = { euzu: 6.7, besmele: 6.4, sadakallahulazim: 8.4 };
export function hatimClipFile(clip: HatimClip) { return join(process.cwd(), "src/lib/radio/hatim-audio", `${clip}.flac`); }
export function hatimOpening(surah: number, offset: number): HatimClip[] {
  if (offset <= 0) return surah === 1 || surah === 9 ? [] : ["euzu"];
  return surah === 9 ? ["euzu"] : ["euzu", "besmele"];
}

// Resume at the beginning of the unfinished verse, or at the next verse when
// the last saved position was its predecessor's end. No speech recognition/TTS.
export function hatimSegment(chapter: HatimChapter, offset: number, duration: number, remaining: number) {
  const verse = chapter.verses.find(([, , end]) => end > offset + 0.05);
  if (!verse) return null;
  const start = offset <= 0 ? 0 : verse[1];
  // Reserve two seconds for decoder startup and the final MP3 packets, so the
  // station's 04:00 cutoff cannot cut the last selected verse.
  if (duration - start <= remaining - 2) return { start, end: duration, windowComplete: false, chapterComplete: true };
  const fitting = chapter.verses.filter(([, , end]) => end > start && end - start <= remaining - 2);
  const end = fitting.at(-1)?.[2] ?? start;
  return { start, end, windowComplete: true, chapterComplete: end >= chapter.verses.at(-1)![2] };
}

const directory = join(tmpdir(), "ahd-hatim-cache");
const downloads = new Map<number, Promise<{ file: string; duration: number }>>();
export function prepareHatimChapter(surah: number) {
  const existing = downloads.get(surah);
  if (existing) return existing;
  const work = (async () => {
    const chapter = HATIM_CHAPTERS[surah - 1];
    if (!chapter || chapter.surah !== surah) throw new Error("Ungültige Hatim-Sure");
    await mkdir(directory, { recursive: true });
    const file = join(directory, `${String(surah).padStart(3, "0")}.mp3`);
    if (!await stat(file).then(info => info.size > 1024).catch(() => false)) {
      const temporary = `${file}.part`;
      try {
        const response = await fetch(`${manifest.baseUrl}${String(surah).padStart(3, "0")}.mp3`, { signal: AbortSignal.timeout(120_000), redirect: "error" });
        if (!response.ok || !response.body) throw new Error(`Hatim-Download fehlgeschlagen (HTTP ${response.status})`);
        let bytes = 0;
        const limit = new Transform({ transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          callback(bytes > 200 * 1024 * 1024 ? new Error("Hatim-Datei zu groß") : null, chunk);
        } });
        await pipeline(Readable.fromWeb(response.body as never), limit, createWriteStream(temporary));
        if (bytes < 1024) throw new Error("Hatim-Audio ist leer");
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    }
    const duration = Number(await command(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], 20_000));
    const lastEnd = chapter.verses.at(-1)![2];
    if (!Number.isFinite(duration) || duration < lastEnd - 0.15 || duration > lastEnd + 30) {
      await rm(file, { force: true });
      throw new Error(`Hatim-Audio und Verszeiten passen nicht zusammen (Sure ${surah})`);
    }
    // Keep this chapter plus its neighbours, so prefetch cannot evict playback.
    const keep = new Set([surah, surah === 1 ? 114 : surah - 1, surah === 114 ? 1 : surah + 1]);
    for (const name of await readdir(directory)) {
      if (/^\d{3}\.mp3$/.test(name) && !keep.has(Number(name.slice(0, 3)))) await rm(join(directory, name), { force: true });
    }
    return { file, duration };
  })();
  downloads.set(surah, work);
  void work.finally(() => downloads.delete(surah)).catch(() => {});
  return work;
}

type HatimStatus = { surah: number; title: string; completedLoops: number };
type Dependencies = {
  publish: (audio: Buffer) => void;
  status: (status: HatimStatus | null) => void;
  error: (error: unknown) => void;
  load: () => Promise<HatimCursor>;
  save: (cursor: HatimCursor) => Promise<unknown>;
  prepare: typeof prepareHatimChapter;
  spawn: (args: string[]) => ChildProcess;
  now: () => Date;
  chapters: HatimChapter[];
};

export class HatimPlayer {
  private deps: Dependencies;
  private cursor: HatimCursor | null = null;
  private process: ChildProcess | null = null;
  private revision = 0;
  private loading = false;
  private until = 0;
  private lastSave = 0;
  private writes: Promise<unknown> = Promise.resolve();
  // True once this session's opening was heard; any break starts a new one.
  private opened = false;

  constructor(callbacks: Pick<Dependencies, "publish" | "status" | "error"> & Partial<Dependencies>) {
    this.deps = {
      load: async () => await prisma.hatimProgress.findUnique({ where: { id: HATIM_ID } }) ?? { surah: 1, offsetSeconds: 0, completedLoops: 0 },
      save: cursor => prisma.hatimProgress.upsert({ where: { id: HATIM_ID }, create: { id: HATIM_ID, ...cursor }, update: cursor }),
      prepare: prepareHatimChapter,
      spawn: args => spawn(/* turbopackIgnore: true */ process.env.FFMPEG_PATH || "ffmpeg", args, { stdio: ["ignore", "pipe", "pipe", "pipe"] }),
      now: () => new Date(), chapters: HATIM_CHAPTERS, ...callbacks,
    };
  }

  private save() {
    if (!this.cursor) return;
    const snapshot = { surah: this.cursor.surah, offsetSeconds: this.cursor.offsetSeconds, completedLoops: this.cursor.completedLoops };
    this.writes = this.writes.catch(() => {}).then(() => this.deps.save(snapshot));
    void this.writes.catch(this.deps.error);
    this.lastSave = this.deps.now().getTime();
  }

  async tick() {
    const windowEnd = hatimWindowEnd(this.deps.now());
    if (!windowEnd) { this.opened = false; if (this.process || this.loading) await this.stop(); return; }
    if (this.process || this.loading || this.deps.now().getTime() < this.until) return;
    this.loading = true;
    const revision = this.revision;
    try {
      await this.writes;
      this.cursor ??= await this.deps.load();
      const chapter = this.deps.chapters[this.cursor.surah - 1];
      if (!chapter || !Number.isFinite(this.cursor.offsetSeconds) || this.cursor.offsetSeconds < 0) throw new Error("Ungültiger gespeicherter Hatim-Stand");
      const { file, duration } = await this.deps.prepare(chapter.surah);
      if (revision !== this.revision || !hatimWindowEnd(this.deps.now())) return;
      const remaining = Math.max(0, (windowEnd.getTime() - this.deps.now().getTime()) / 1000);
      const seconds = (clips: HatimClip[]) => clips.reduce((sum, clip) => sum + HATIM_CLIP_SECONDS[clip], 0);
      const opening = this.opened ? [] : hatimOpening(chapter.surah, this.cursor.offsetSeconds);
      // Keep room for the opening and the closing, so the last verse is never cut.
      const segment = hatimSegment(chapter, this.cursor.offsetSeconds, duration, remaining - seconds(opening) - HATIM_CLIP_SECONDS.sadakallahulazim);
      if (!segment) { this.cursor = nextHatimCursor(this.cursor, this.deps.chapters); this.save(); return; }
      this.cursor.offsetSeconds = segment.start;
      const audioSeconds = segment.end - segment.start;
      const before: HatimClip[] = audioSeconds > 0 ? opening : [];
      const after: HatimClip[] = segment.windowComplete && (audioSeconds > 0 || this.opened) ? ["sadakallahulazim"] : [];
      const introSeconds = seconds(before), total = introSeconds + audioSeconds + seconds(after);
      let input: string[];
      if (before.length || after.length) {
        // FFmpeg's -re would read the chapter file during the opening and then
        // send that backlog at once; pace the joined programme instead.
        const parts = [...before.map(clip => ["-i", hatimClipFile(clip)]), ...audioSeconds > 0 ? [["-ss", String(segment.start), "-i", file]] : [], ...after.map(clip => ["-i", hatimClipFile(clip)])];
        const format = "aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo";
        const chains = parts.map((_, index) => index === before.length && audioSeconds > 0
          ? `[${index}:a]atrim=duration=${audioSeconds},asetpts=PTS-STARTPTS,${format}[p${index}]` : `[${index}:a]${format}[p${index}]`);
        input = [...parts.flat(), "-filter_complex", `${chains.join(";")};${parts.map((_, index) => `[p${index}]`).join("")}concat=n=${parts.length}:v=0:a=1,apad,arealtime[out]`,
          "-map", "[out]", "-t", String(segment.windowComplete ? Math.max(remaining, total) : total)];
      } else input = audioSeconds > 0 ? [...realtime(), "-ss", String(segment.start), "-i", file, "-af", `atrim=duration=${audioSeconds},apad`, "-t", String(segment.windowComplete ? remaining : audioSeconds)]
        : [...realtime(), "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(remaining)];
      if (audioSeconds > 0) this.opened = true;
      if (after.length) this.opened = false;
      const proc = this.deps.spawn(["-hide_banner", "-loglevel", "error", "-nostdin", ...input,
        "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k", "-vn", "-id3v2_version", "0", "-write_xing", "0", "-flush_packets", "1",
        "-progress", "pipe:3", "-stats_period", "1", "-f", "mp3", "pipe:1"]);
      this.process = proc;
      this.deps.status({ surah: chapter.surah, title: `Hatim · ${manifest.reciter} · Sure ${chapter.surah} · ${chapter.name}`, completedLoops: this.cursor.completedLoops });
      proc.stdout!.on("data", chunk => { if (revision === this.revision) this.deps.publish(chunk); });
      let progress = "";
      const update = (text: string) => {
        progress += text;
        const lines = progress.split("\n"); progress = lines.pop() || "";
        for (const line of lines) if (line.startsWith("out_time_us=") && revision === this.revision && this.cursor) {
          const played = Number(line.slice(12)) / 1_000_000 - introSeconds;
          if (Number.isFinite(played)) this.cursor.offsetSeconds = Math.min(segment.end, segment.start + Math.max(0, played));
          if (this.deps.now().getTime() - this.lastSave >= 10_000) this.save();
        }
      };
      proc.stdio[3]?.on("data", chunk => update(String(chunk)));
      proc.stderr?.on("data", () => {});
      proc.on("error", error => { this.deps.error(error); });
      proc.once("close", code => {
        if (revision !== this.revision || this.process !== proc || !this.cursor) return;
        this.process = null;
        if (code === 0) {
          this.cursor = segment.chapterComplete ? nextHatimCursor(this.cursor, this.deps.chapters) : { ...this.cursor, offsetSeconds: segment.end };
          if (segment.windowComplete) this.until = windowEnd.getTime();
        } else { this.opened = false; this.until = this.deps.now().getTime() + 10_000; this.deps.error(new Error("Hatim-Wiedergabe unterbrochen; Wiederaufnahme am Versanfang.")); }
        this.save(); this.deps.status(null);
      });
      if (!segment.windowComplete) void this.deps.prepare(nextHatimCursor(this.cursor, this.deps.chapters).surah).catch(() => {});
    } catch (error) { this.until = this.deps.now().getTime() + 30_000; this.deps.error(error); }
    finally { this.loading = false; }
  }

  async stop() {
    this.revision++;
    this.loading = false;
    this.opened = false;
    const proc = this.process; this.process = null;
    proc?.kill("SIGTERM");
    this.save();
    this.deps.status(null);
    await this.writes.catch(() => {});
  }
}
