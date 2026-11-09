import { spawn, type ChildProcess } from "node:child_process";
import type { ServerResponse } from "node:http";
import { prisma } from "../prisma";
import { isOnAir, isNewsSlot, NEWS_SCHEDULE, isMusicHours, upcomingNewsSlot, dueNewsEditions, radioEnabled, stationTime, newsLanguage } from "./config";
import { assetFile, pruneCache } from "./store";
import { presenterForSlot, editorialConfigured } from "./providers";
import { prepareNews, bulletinForSlot, isRepeatSlot, usesSlotUpdates, NEWS_REFRESH_LEAD_MS, GERMAN_NEWS_VERSION } from "./news";
import { stationIdAsset, IMAGING_VERSION } from "./imaging";
import { trackPlayback } from "./audit";
import { NEWS_PLAYBACK_CODEC } from "./playback-level";
import { isMusicTrack, musicInRotation, musicRotationEnabled, musicSeason, buildMusicQueue } from "./music-policy";
import { MUSIC_FADE_SECONDS, musicPlayBlockedReason } from "./music-controls";

const FADE_SECONDS = 3;
const NEWS_PAUSE_SECONDS = 5;
const NEWS_LEAD_MS = (FADE_SECONDS + NEWS_PAUSE_SECONDS) * 1000 + 500;
const HOUR_MS = 3_600_000;
const ENCODE_MP3 = ["-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k"];

type Item = { id: string; title: string; duration: number; kind: string; season?: string; rotationEnabled?: boolean };
type RadioState = {
  started: boolean; onAir: boolean; playing: Item | null; startedAt: number;
  listeners: Set<ServerResponse>; process: ChildProcess | null; revision: number;
  timer?: ReturnType<typeof setTimeout>; boundary?: string; lastNewsSlot?: string;
  lastNewsPreview?: string; trackFile?: string; newsTransition?: boolean; fadeInNextMusic?: boolean;
  lastPrepAt: number; preparing: boolean; error: string | null; lastMusicId?: string;
  musicQueue: Item[]; selecting: boolean; shutdown: boolean;
  musicSinceId: number;
  musicControlBusy?: boolean; musicLibraryRevision?: number;
  finishPlayback?: (status: "completed" | "interrupted" | "failed", error?: string) => Promise<void>;
};
const globalRadio = globalThis as unknown as { __ahdRadio?: RadioState };
const state = globalRadio.__ahdRadio ??= {
  started: false, onAir: false, playing: null, startedAt: 0, listeners: new Set(), process: null,
  revision: 0, lastPrepAt: 0, preparing: false, error: null, musicQueue: [], selecting: false, shutdown: false, musicSinceId: 0,
};

export function radioStatus() {
  return { programmeVersion: GERMAN_NEWS_VERSION, imagingVersion: IMAGING_VERSION, presenter: presenterForSlot(new Date()).name, newsSchedule: NEWS_SCHEDULE, newsRefreshHours: 24, serviceRefreshHours: usesSlotUpdates(new Date()) ? 1 : 24, started: state.started, onAir: isOnAir(), playing: state.playing, startedAt: state.startedAt || null,
    listeners: state.listeners.size, preparing: state.preparing, error: state.error,
    nextNewsAt: upcomingNewsSlot()?.toISOString() ?? null, timezone: "Europe/Berlin", hours: "Mo–Sa 07/20 Uhr Türkçe · täglich 08:00–18:00 Musik", newsHours: "Mo–Sa: 07/20 Uhr Türkçe · 10–17 Uhr stündlich Deutsch" };
}

export function attachRadio(res: ServerResponse) {
  state.listeners.add(res);
  res.on("close", () => state.listeners.delete(res));
}

export function hasRadioMusic() {
  return isMusicHours() && !state.newsTransition && !!state.playing && state.playing.kind !== "news";
}

function publish(chunk: Buffer) {
  for (const res of state.listeners) {
    // A slow listener must reconnect instead of accumulating seconds of old programme.
    if (res.destroyed || res.writableLength > 32 * 1024) { res.destroy(); state.listeners.delete(res); continue; }
    res.write(chunk);
  }
}

function stopTrack() {
  state.revision++;
  const proc = state.process;
  state.process = null;
  state.playing = null;
  state.trackFile = undefined;
  void state.finishPlayback?.("interrupted");
  state.finishPlayback = undefined;
  proc?.kill("SIGKILL");
}

function silenceInput(seconds: number) {
  return ["-re", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", String(seconds), ...ENCODE_MP3];
}

type PlayOptions = { scheduledFor?: Date; transition?: boolean; input?: string[] };

async function play(item: Item | null, options: PlayOptions = {}) {
  const { scheduledFor, transition } = options;
  stopTrack();
  const revision = state.revision;
  const file = item ? await assetFile(item.id) : null;
  if (revision !== state.revision || !isOnAir() || state.shutdown) return;
  const fadeIn = item?.kind === "music" && state.fadeInNextMusic;
  const codec = item?.kind === "news" ? NEWS_PLAYBACK_CODEC
    : fadeIn ? ["-af", `afade=t=in:d=${FADE_SECONDS}:curve=hsin`, ...ENCODE_MP3] : ["-c:a", "copy"];
  const input = options.input ?? (file ? ["-re", "-i", file, ...codec] : silenceInput(10));
  const proc = spawn(/* turbopackIgnore: true */ process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", ...input,
    "-vn", "-id3v2_version", "0", "-write_xing", "0", "-flush_packets", "1", "-f", "mp3", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
  state.process = proc;
  state.playing = item;
  state.trackFile = file ?? undefined;
  if (item?.kind === "news") state.musicSinceId = 0;
  state.startedAt = Date.now();
  const audit = item ? trackPlayback(item, item.kind === "news" && scheduledFor ? newsLanguage(scheduledFor) : item.kind === "music" || item.kind === "imaging" ? "zxx" : "de", scheduledFor, state.listeners.size) : null;
  state.finishPlayback = audit?.finish;
  proc.stdout.once("data", () => {
    if (revision !== state.revision) return;
    state.startedAt = Date.now();
    if (fadeIn) state.fadeInNextMusic = false;
    void audit?.started().catch(report);
  });
  proc.stdout.on("data", chunk => { if (revision === state.revision) publish(chunk); });
  let failed = false;
  proc.stderr.on("data", () => { failed = true; });
  proc.on("error", () => { state.error = "Audiowiedergabe fehlgeschlagen; FFmpeg prüfen."; void audit?.finish("failed", state.error); });
  const done = new Promise<boolean>(resolve => proc.once("close", code => {
    if (revision !== state.revision || state.shutdown) { resolve(false); return; }
    state.process = null;
    state.playing = null;
    state.trackFile = undefined;
    state.finishPlayback = undefined;
    void audit?.finish(code === 0 ? "completed" : "failed", code === 0 ? undefined : `FFmpeg beendet (${code})`);
    if (code !== 0 || failed) state.error = "Audio konnte nicht vollständig abgespielt werden.";
    if (!transition) setTimeout(() => { void nextMusic().catch(report); }, code === 0 ? 0 : 5000);
    resolve(true);
  }));
  return { done };
}

function report(error: unknown) {
  state.error = error instanceof Error ? error.message : "Radiofehler";
  console.error("[radio]", state.error);
}

async function nextMusic() {
  if (!state.started || state.selecting || state.process || state.newsTransition || state.musicControlBusy || !isMusicHours() || state.shutdown) return;
  state.selecting = true;
  const revision = state.revision;
  const libraryRevision = state.musicLibraryRevision || 0;
  try {
    if ((state.musicSinceId || 0) >= 3) {
      const ident = await stationIdAsset(new Date());
      if (revision !== state.revision || state.process) return;
      if (ident) { state.musicSinceId = 0; await play(ident); return; }
    }
    state.musicQueue = state.musicQueue.filter(musicInRotation);
    if (!state.musicQueue.length) {
      const [tracks, recent] = await Promise.all([
        prisma.radioAsset.findMany({ where: { kind: { in: ["music", "music-candidate"] } }, select: { id: true, title: true, duration: true, kind: true, metadata: true } }),
        prisma.radioPlayback.findMany({ where: { kind: "music", assetId: { not: null }, status: { in: ["playing", "completed", "interrupted"] } }, orderBy: { startedAt: "desc" }, take: 24, select: { assetId: true } }),
      ]);
      const history = recent.flatMap(item => item.assetId ? [item.assetId] : []);
      if (state.lastMusicId && history[0] !== state.lastMusicId) history.unshift(state.lastMusicId);
      if (libraryRevision !== (state.musicLibraryRevision || 0)) return;
      state.musicQueue = buildMusicQueue(tracks.map(({ metadata, ...track }) => ({ ...track, season: musicSeason({ metadata }), rotationEnabled: musicRotationEnabled({ ...track, metadata }) })), history);
    }
    if (revision !== state.revision || libraryRevision !== (state.musicLibraryRevision || 0) || state.process || state.newsTransition || state.musicControlBusy) return;
    const item = state.musicQueue.shift() ?? null;
    if (item) { state.lastMusicId = item.id; state.musicSinceId = (state.musicSinceId || 0) + 1; }
    // Candidates can be explicitly enabled by an administrator. Treat their
    // transmission as music without changing the archived source classification.
    await play(item ? { ...item, kind: "music" } : null);
  } finally { state.selecting = false; }
}

export class MusicControlError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

export function musicLibraryPlayback() {
  return { playing: state.playing ? { id: state.playing.id, title: state.playing.title, kind: state.playing.kind } : null, playNowBlockedReason: musicPlayBlockedReason(state) };
}

async function fadeCurrentMusic() {
  if (!state.process) return true;
  const file = state.trackFile;
  if (!file || !state.playing) { stopTrack(); return true; }
  const offset = Math.max(0, (Date.now() - state.startedAt) / 1000);
  const duration = Math.min(MUSIC_FADE_SECONDS, state.playing.duration - offset);
  if (duration <= 0) { stopTrack(); return true; }
  return playTransitionStage(null, { input: ["-re", "-ss", String(offset), "-i", file, "-t", String(duration),
    "-af", `afade=t=out:st=0:d=${duration}:curve=hsin`, ...ENCODE_MP3] });
}

export async function playMusicNow(id: string) {
  const blocked = musicPlayBlockedReason(state);
  if (blocked) throw new MusicControlError(blocked);
  state.musicControlBusy = true;
  try {
    const asset = await prisma.radioAsset.findUnique({ where: { id }, select: { id: true, title: true, duration: true, kind: true } });
    if (!asset || !isMusicTrack(asset)) throw new MusicControlError("Musiktitel nicht gefunden.", 404);
    // Load before interrupting the current song. A failed read must leave it on air.
    await assetFile(asset.id);
    let reason = musicPlayBlockedReason({ ...state, musicControlBusy: false });
    if (reason) throw new MusicControlError(reason);
    if (!await fadeCurrentMusic()) throw new MusicControlError("Das Programm hat inzwischen gewechselt. Bitte erneut versuchen.");
    reason = musicPlayBlockedReason({ ...state, musicControlBusy: false });
    if (reason) throw new MusicControlError(reason);
    state.musicQueue = [];
    state.fadeInNextMusic = true;
    const started = await play({ ...asset, kind: "music" });
    if (!started) throw new MusicControlError("Das Programm hat inzwischen gewechselt. Bitte erneut versuchen.");
    state.lastMusicId = asset.id;
    state.musicSinceId = (state.musicSinceId || 0) + 1;
    return { id: asset.id, title: asset.title };
  } finally {
    state.musicControlBusy = false;
    if (!state.process && !state.newsTransition) void nextMusic().catch(report);
  }
}

export async function musicLibraryChanged(id: string, enabled: boolean) {
  state.musicLibraryRevision = (state.musicLibraryRevision || 0) + 1;
  state.musicQueue = [];
  // Disabling the song currently on air also skips it gently. News and other
  // manual operations retain priority; a queued selection sees the new revision.
  if (!enabled && state.playing?.id === id && !state.newsTransition && !state.musicControlBusy && !state.selecting) {
    state.musicControlBusy = true;
    try { if (await fadeCurrentMusic()) state.fadeInNextMusic = true; }
    finally { state.musicControlBusy = false; }
  }
  if (enabled && !state.playing && !state.newsTransition && !state.musicControlBusy && !state.selecting) stopTrack();
  await nextMusic();
}

export async function skipMusic(id: string) {
  const blocked = musicPlayBlockedReason(state);
  if (blocked) throw new MusicControlError(blocked);
  if (state.playing?.id !== id) throw new MusicControlError("Inzwischen läuft ein anderer Titel. Die Ansicht wurde aktualisiert.");
  state.musicControlBusy = true;
  try {
    if (!await fadeCurrentMusic()) throw new MusicControlError("Das Programm hat inzwischen gewechselt.");
    state.musicQueue = state.musicQueue.filter(item => item.id !== id);
    state.fadeInNextMusic = true;
  } finally { state.musicControlBusy = false; }
  await nextMusic();
}

async function playTransitionStage(item: Item | null, options: Omit<PlayOptions, "transition">) {
  const stage = await play(item, { ...options, transition: true });
  return stage?.done ?? false;
}

async function playNews(news: Item, slot: Date) {
  state.newsTransition = true;
  try {
    if (isMusicHours()) {
      const file = state.trackFile;
      if (file && state.playing) {
        // Continue from the current position for the audible part of the fade.
        const offset = Math.max(0, (Date.now() - state.startedAt) / 1000);
        const duration = Math.min(FADE_SECONDS, state.playing.duration - offset);
        if (duration > 0) {
          const input = ["-re", "-ss", String(offset), "-i", file, "-t", String(duration),
            "-af", `afade=t=out:st=0:d=${duration}:curve=hsin`, ...ENCODE_MP3];
          if (!await playTransitionStage(null, { input })) return;
        }
      }
      const pause = Math.max(NEWS_PAUSE_SECONDS, (slot.getTime() - Date.now()) / 1000);
      if (!await playTransitionStage(null, { input: silenceInput(pause) })) return;
    }
    if (!await playTransitionStage(news, { scheduledFor: slot })) return;
    if (!await playTransitionStage(null, { input: silenceInput(NEWS_PAUSE_SECONDS) })) return;
    state.fadeInNextMusic = isMusicHours();
  } finally {
    state.newsTransition = false;
  }
  await nextMusic();
}

async function tick(onBoundary: () => Promise<void>) {
  const now = new Date();
  const active = isOnAir(now);
  if (active !== state.onAir || !state.boundary) {
    state.onAir = active;
    state.boundary = `${stationTime(now).date}:${active}`;
    if (!active) {
      stopTrack();
      state.fadeInNextMusic = false;
      for (const res of state.listeners) res.end();
      state.listeners.clear();
    }
    await onBoundary();
  }
  // Exact slot identity: never replay an old bulletin after a restart or at 18:00.
  const lead = isMusicHours(now) ? NEWS_LEAD_MS : 0;
  const hour = new Date(Math.floor((now.getTime() + lead) / HOUR_MS) * HOUR_MS);
  const slotKey = hour.toISOString();
  const early = now < hour;
  if (active && !state.newsTransition && isNewsSlot(hour) && now.getTime() - hour.getTime() < 1500 &&
      state.lastNewsSlot !== slotKey && (!early || state.lastNewsPreview !== slotKey)) {
    if (early) state.lastNewsPreview = slotKey;
    else state.lastNewsSlot = slotKey;
    const alreadyPlayed = await prisma.radioPlayback.findFirst({ where: { kind: "news", scheduledFor: hour, status: { in: ["starting", "playing", "completed", "interrupted"] } }, select: { id: true } });
    if (alreadyPlayed) { state.lastNewsSlot = slotKey; return; }
    const news = await bulletinForSlot(hour);
    if (news && isOnAir() && Date.now() - hour.getTime() < 5000) {
      state.lastNewsSlot = slotKey;
      void playNews(news, hour).catch(report);
    } else if (!early) {
      state.error = "Zur vollen Stunde keine geprüfte Nachrichtenausgabe bereit.";
      await prisma.radioPlayback.create({ data: { title: "Nachrichtenausgabe nicht gesendet", language: newsLanguage(hour), kind: "news", status: "skipped", scheduledFor: hour,
        repeated: !usesSlotUpdates(hour) && isRepeatSlot(hour), endedAt: new Date(), listeners: state.listeners.size, error: state.error } });
    }
  }
  if (active && !state.process) await nextMusic();

  const due = dueNewsEditions(now).map(edition => edition.firstBroadcast);
  const upcoming = new Date(Math.ceil(now.getTime() / HOUR_MS) * HOUR_MS);
  if (upcoming.getTime() - now.getTime() <= NEWS_REFRESH_LEAD_MS && isNewsSlot(upcoming) && usesSlotUpdates(upcoming) &&
      !due.some(slot => slot.getTime() === upcoming.getTime())) due.unshift(upcoming);
  if (radioEnabled() && due.length && !state.preparing && Date.now() - state.lastPrepAt > 60_000 && process.env.ELEVENLABS_API_KEY && editorialConfigured()) {
    state.lastPrepAt = Date.now();
    state.preparing = true;
    void (async () => {
      for (const slot of due) {
        if (await bulletinForSlot(slot)) continue;
        try { await prepareNews(slot); state.error = null; } catch (error) { report(error); }
      }
    })().catch(report).finally(() => { state.preparing = false; });
  }
}

export function startRadio(onBoundary: () => Promise<void>) {
  if (state.started) return;
  state.started = true;
  state.shutdown = false;
  // Align checks to wall-clock quarters of a second; no accumulating interval drift.
  const loop = async () => {
    try { await tick(onBoundary); } catch (error) { report(error); }
    if (!state.shutdown) state.timer = setTimeout(loop, 250 - Date.now() % 250);
  };
  const cleanup = async () => {
    // Keep fortnightly news audio and a compact 90-day transmission journal.
    const cutoff = new Date(Date.now() - 14 * 86400_000), logCutoff = new Date(Date.now() - 90 * 86400_000);
    await prisma.radioAsset.deleteMany({ where: { kind: { in: ["news", "news-main", "news-draft", "news-service", "news-voice"] }, createdAt: { lt: cutoff } } });
    await pruneCache();
    await prisma.radioJob.deleteMany({ where: { updatedAt: { lt: logCutoff }, status: { not: "running" } } });
    await prisma.radioPlayback.deleteMany({ where: { startedAt: { lt: logCutoff } } });
  };
  void prisma.radioPlayback.updateMany({ where: { status: { in: ["playing", "starting"] }, endedAt: null }, data: { status: "interrupted", endedAt: new Date(), error: "Service wurde neu gestartet" } }).catch(report).finally(() => { void loop(); });
  void cleanup().catch(report);
  const retention = setInterval(() => void cleanup().catch(report), 86400_000);
  retention.unref();
}

export async function stopRadio() {
  state.shutdown = true;
  if (state.timer) clearTimeout(state.timer);
  const finishing = state.finishPlayback?.("interrupted");
  stopTrack();
  for (const res of state.listeners) res.end();
  state.listeners.clear();
  await finishing;
}
