import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetFile, command, normalizeAudio } from "./store";
import { imagingAsset } from "./imaging";

export type VoiceSegment = { audio: Buffer; kind: "intro" | "story" | "outro" };
export type Cue = { kind: string; start: number; end: number };

export function newsTimeline(durations: number[]) {
  let cursor = 3.2;
  const cues: Cue[] = [{ kind: "opener", start: 0, end: 6 }];
  for (let i = 0; i < durations.length; i++) {
    const kind = i === 0 ? "intro" : i === durations.length - 1 ? "outro" : "story";
    cues.push({ kind, start: cursor, end: cursor + durations[i] });
    cursor += durations[i];
    if (kind === "story" && i < durations.length - 2) {
      cues.push({ kind: "divider", start: cursor + 0.1, end: cursor + 1.2 });
      cursor += 1.65;
    } else cursor += 0.45;
  }
  cues.push({ kind: "closer", start: cursor - 1, end: cursor + 4 });
  return { cues, duration: cursor + 4 };
}

export async function mixBulletin(segments: VoiceSegment[]) {
  const dir = await mkdtemp(join(tmpdir(), "ahd-news-mix-"));
  try {
    const clips = [];
    for (let i = 0; i < segments.length; i++) {
      const normalized = await normalizeAudio(segments[i].audio);
      const path = join(dir, `voice-${i}.mp3`);
      await writeFile(path, normalized.audio);
      clips.push({ path, duration: normalized.duration });
    }
    const [opener, bed, closer, divider] = await Promise.all(["news-open", "news-bed", "news-close", "divider"].map(role => imagingAsset(role as "news-open" | "news-bed" | "news-close" | "divider")));
    const timeline = newsTimeline(clips.map(c => c.duration));
    if (timeline.duration > 250) throw new Error("Nachrichten mit Jingles überschreiten vier Minuten; Ausgabe wird nicht gesendet.");
    const args = ["-v", "error", "-nostdin"];
    for (const clip of clips) args.push("-i", clip.path);
    for (const asset of [opener, bed, closer, divider]) {
      if (asset === bed) args.push("-stream_loop", "-1");
      args.push("-i", await assetFile(asset.id));
    }
    const n = clips.length, filter: string[] = [];
    const voiceCues = timeline.cues.filter(c => ["intro", "story", "outro"].includes(c.kind));
    voiceCues.forEach((cue, i) => filter.push(`[${i}:a]adelay=${Math.round(cue.start * 1000)}:all=1[v${i}]`));
    filter.push(`${voiceCues.map((_, i) => `[v${i}]`).join("")}amix=inputs=${n}:normalize=0,apad=whole_dur=${timeline.duration},atrim=duration=${timeline.duration},asplit=2[voice][trigger]`);
    const bedDuration = timeline.duration - 3.2;
    filter.push(`[${n + 1}:a]atrim=duration=${bedDuration},asetpts=PTS-STARTPTS,volume=0.32,afade=t=in:d=0.8,afade=t=out:st=${bedDuration - 2}:d=2,adelay=3200:all=1[bed]`);
    filter.push("[bed][trigger]sidechaincompress=threshold=0.04:ratio=3:attack=15:release=350[ducked]");
    filter.push(`[${n}:a]atrim=duration=6,asetpts=PTS-STARTPTS,volume=0.75,afade=t=out:st=3:d=3[open]`);
    const closeCue = timeline.cues.find(c => c.kind === "closer")!;
    filter.push(`[${n + 2}:a]atrim=duration=5,asetpts=PTS-STARTPTS,volume=0.7,afade=t=out:st=3.5:d=1.5,adelay=${Math.round(closeCue.start * 1000)}:all=1[close]`);
    const effectCues = timeline.cues.filter(c => c.kind === "divider");
    effectCues.forEach((cue, i) => filter.push(`[${n + 3}:a]atrim=duration=1.1,asetpts=PTS-STARTPTS,volume=0.45,adelay=${Math.round(cue.start * 1000)}:all=1[s${i}]`));
    const stems = ["voice", "ducked", "open", "close", ...effectCues.map((_, i) => `s${i}`)];
    filter.push(`${stems.map(s => `[${s}]`).join("")}amix=inputs=${stems.length}:normalize=0,atrim=duration=${timeline.duration},alimiter=limit=0.79:level=false[out]`);
    const output = join(dir, "mixed.wav");
    await command(process.env.FFMPEG_PATH || "ffmpeg", [...args, "-filter_complex", filter.join(";"), "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", output]);
    return { ...(await normalizeAudio(await readFile(output), 255)), timeline: timeline.cues };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function mixStationId(voice: Buffer, bedId: string) {
  const dir = await mkdtemp(join(tmpdir(), "ahd-ident-"));
  try {
    const clip = await normalizeAudio(voice);
    const voicePath = join(dir, "voice.mp3"), output = join(dir, "mixed.wav");
    await writeFile(voicePath, clip.audio);
    const duration = Math.max(12, clip.duration + 3.5);
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", voicePath, "-stream_loop", "-1", "-i", await assetFile(bedId),
      "-filter_complex", `[0:a]adelay=2000:all=1,apad=whole_dur=${duration},atrim=duration=${duration},asplit=2[v][trigger];[1:a]atrim=duration=${duration},volume=0.65,afade=t=out:st=${duration - 1.5}:d=1.5[bed];[bed][trigger]sidechaincompress=threshold=0.025:ratio=5:attack=12:release=450[ducked];[v][ducked]amix=inputs=2:normalize=0[out]`,
      "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", output]);
    return normalizeAudio(await readFile(output), duration + 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
}
