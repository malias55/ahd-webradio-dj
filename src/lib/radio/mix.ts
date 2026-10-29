import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assetFile, command, normalizeAudio } from "./store";
import { imagingAsset } from "./imaging";

export type VoiceSegment = { audio: Buffer; kind: "intro" | "story" | "weather" | "traffic" | "outro" };
export type Cue = { kind: string; start: number; end: number };

export type DryMixOptions = { opener?: boolean; closer?: boolean };
export function dryNewsTimeline(clips: { duration: number; kind: VoiceSegment["kind"] }[], options: DryMixOptions = {}) {
  const cues: Cue[] = [];
  let cursor = 0.25;
  if (options.opener !== false) { cues.push({ kind: "opener", start: 0, end: 6 }); cursor = 6.3; }

  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    cues.push({ kind: clip.kind, start: cursor, end: cursor + clip.duration });
    cursor += clip.duration;
    if (i < clips.length - 1) {
      const next = clips[i + 1].kind;
      cursor += clip.kind === "story" && next === "story" ? 0.7 : 0.5;
    }
  }
  if (options.closer !== false) { cues.push({ kind: "closer", start: cursor + 0.3, end: cursor + 5.3 }); cursor += 5.3; }
  return { cues, duration: cursor + 0.2 };
}

// German speech and imaging occupy disjoint intervals. No bed is even loaded.
// The legacy bed mixer below is retained for compatibility; live editions in
// both languages use this dry mixer.
export async function mixDryBulletin(segments: VoiceSegment[], options: DryMixOptions = {}) {
  if (!segments.length) throw new Error("Leere Nachrichtenausgabe");
  const dir = await mkdtemp(join(tmpdir(), "ahd-dry-news-"));
  try {
    const clips = [];
    for (let i = 0; i < segments.length; i++) {
      const normalized = await normalizeAudio(segments[i].audio);
      const path = join(dir, `voice-${i}.mp3`);
      await writeFile(path, normalized.audio);
      clips.push({ path, duration: normalized.duration, kind: segments[i].kind });
    }
    const timeline = dryNewsTimeline(clips, options);
    if (timeline.duration > 260) throw new Error("Nachrichten überschreiten das Sendezeitfenster");
    const args = ["-v", "error", "-nostdin"], filters: string[] = [], stems: string[] = [];
    for (const clip of clips) args.push("-i", clip.path);
    const voiceCues = timeline.cues.filter(c => !["opener", "closer", "divider"].includes(c.kind));
    voiceCues.forEach((cue, i) => {
      filters.push(`[${i}:a]asetpts=PTS-STARTPTS,adelay=${Math.round(cue.start * 1000)}:all=1[v${i}]`);
      stems.push(`v${i}`);
    });
    let input = clips.length;
    for (const kind of ["opener", "closer"] as const) {
      const cues = timeline.cues.filter(c => c.kind === kind);
      if (!cues.length) continue;
      const asset = await imagingAsset(kind === "opener" ? "news-open" : "news-close");
      args.push("-i", await assetFile(asset.id));
      cues.forEach((cue, i) => {
        const label = `${kind}${i}`, length = cue.end - cue.start;
        filters.push(`[${input}:a]atrim=duration=${length},asetpts=PTS-STARTPTS,volume=0.65,afade=t=out:st=${length - 0.15}:d=0.15,adelay=${Math.round(cue.start * 1000)}:all=1[${label}]`);
        stems.push(label);
      });
      input++;
    }
    filters.push(`${stems.map(s => `[${s}]`).join("")}amix=inputs=${stems.length}:normalize=0,apad=whole_dur=${timeline.duration},atrim=duration=${timeline.duration},alimiter=limit=0.79:level=false:latency=true[out]`);
    const output = join(dir, "dry.wav");
    await command(process.env.FFMPEG_PATH || "ffmpeg", [...args, "-filter_complex", filters.join(";"), "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", output]);
    return { ...(await normalizeAudio(await readFile(output), 265)), timeline: timeline.cues };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function joinNewsParts(main: Uint8Array, service: Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), "ahd-news-join-"));
  try {
    const first = join(dir, "main.mp3"), second = join(dir, "service.mp3"), output = join(dir, "joined.wav");
    await writeFile(first, main); await writeFile(second, service);
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", first, "-i", second,
      "-filter_complex", "[0:a]apad=pad_dur=0.45[a];[a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", output]);
    const result = await normalizeAudio(await readFile(output), 600);
    if (result.duration > 260) throw new Error("Nachrichten mit Wetter und Verkehr überschreiten das Sendezeitfenster");
    return result;
  } finally { await rm(dir, { recursive: true, force: true }); }
}

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
    const closeStart = 3.3 + clip.duration + 0.3, duration = closeStart + 3;
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", voicePath, "-i", await assetFile(bedId),
      "-filter_complex", `[0:a]adelay=3300:all=1[v];[1:a]atrim=duration=3,asetpts=PTS-STARTPTS,volume=0.65,afade=t=out:st=2.8:d=0.2[open];[1:a]atrim=start=9:duration=3,asetpts=PTS-STARTPTS,volume=0.65,afade=t=out:st=2.8:d=0.2,adelay=${Math.round(closeStart * 1000)}:all=1[close];[v][open][close]amix=inputs=3:normalize=0,apad=whole_dur=${duration},atrim=duration=${duration}[out]`,
      "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", output]);
    return normalizeAudio(await readFile(output), duration + 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// The requested Turkish invocation is heard dry, before any music or jingle.
export async function prependInvocation(invocation: Buffer, programme: Uint8Array) {
  const dir = await mkdtemp(join(tmpdir(), "ahd-invocation-"));
  try {
    const voice = await normalizeAudio(invocation, 30);
    const intro = join(dir, "invocation.mp3"), body = join(dir, "body.mp3"), output = join(dir, "joined.wav");
    await writeFile(intro, voice.audio); await writeFile(body, programme);
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", intro, "-i", body,
      "-filter_complex", "[0:a]apad=pad_dur=0.35[a];[a][1:a]concat=n=2:v=0:a=1[out]", "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", output]);
    return { ...(await normalizeAudio(await readFile(output), 270)), offset: voice.duration + 0.35 };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

// Invocation remains the first spoken content. The approved signature occupies a
// separate interval after it; no instrumental audio is loaded under any voice.
export async function frameTurkishProgramme(invocation: { audio: Uint8Array; duration: number }, signature: { audio: Uint8Array; duration: number }, body: { audio: Uint8Array; duration: number; timeline: Cue[] }) {
  const dir = await mkdtemp(join(tmpdir(), "ahd-tr-frame-"));
  try {
    const first = join(dir, "invocation.mp3"), sound = join(dir, "signature.mp3"), speech = join(dir, "body.mp3"), output = join(dir, "framed.wav");
    await writeFile(first, invocation.audio); await writeFile(sound, signature.audio); await writeFile(speech, body.audio);
    const signatureStart = invocation.duration + 0.35, offset = signatureStart + signature.duration + 0.35;
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", first, "-i", sound, "-i", speech,
      "-filter_complex", "[0:a]apad=pad_dur=0.35[v];[1:a]apad=pad_dur=0.35[s];[v][s][2:a]concat=n=3:v=0:a=1[out]", "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", output]);
    const audio = await normalizeAudio(await readFile(output), 270);
    if (audio.duration > 260) throw new Error("Türkische Ausgabe überschreitet das Sendezeitfenster");
    return { ...audio, timeline: [{ kind: "invocation", start: 0, end: invocation.duration }, { kind: "opener", start: signatureStart, end: signatureStart + signature.duration }, ...body.timeline.map(c => ({ ...c, start: c.start + offset, end: c.end + offset }))] };
  } finally { await rm(dir, { recursive: true, force: true }); }
}
