import { spawn, type ChildProcess } from "node:child_process";
import type { ServerResponse } from "node:http";
import { prisma } from "../prisma";
import { isOnAir, isMusicHours, upcomingNewsSlot, radioEnabled, stationTime, newsLanguage } from "./config";
import { assetFile, pruneCache } from "./store";
import { presenterForSlot } from "./providers";
import { prepareNews, bulletinForSlot, isRepeatSlot } from "./news";
import { stationIdAsset, IMAGING_VERSION } from "./imaging";
import { trackPlayback } from "./audit";

type Item = { id: string; title: string; duration: number; kind: string };
type RadioState = {
  started: boolean; onAir: boolean; playing: Item | null; startedAt: number;
  listeners: Set<ServerResponse>; process: ChildProcess | null; revision: number;
  timer?: ReturnType<typeof setTimeout>; boundary?: string; lastNewsSlot?: string;
  lastPrepAt: number; preparing: boolean; error: string | null; lastMusicId?: string;
  musicQueue: Item[]; selecting: boolean; shutdown: boolean;
  musicSinceId: number;
  finishPlayback?: (status: "completed" | "interrupted" | "failed", error?: string) => Promise<void>;
};
const globalRadio = globalThis as unknown as { __ahdRadio?: RadioState };
const state = globalRadio.__ahdRadio ??= {
  started: false, onAir: false, playing: null, startedAt: 0, listeners: new Set(), process: null,
  revision: 0, lastPrepAt: 0, preparing: false, error: null, musicQueue: [], selecting: false, shutdown: false, musicSinceId: 0,
};

export function radioStatus() {
  return { programmeVersion: "tr-repeat-audit-v1", imagingVersion: IMAGING_VERSION, presenter: presenterForSlot(new Date()).name, newsRefreshHours: 2, started: state.started, onAir: isOnAir(), playing: state.playing, startedAt: state.startedAt || null,
    listeners: state.listeners.size, preparing: state.preparing, error: state.error,
    nextNewsAt: upcomingNewsSlot()?.toISOString() ?? null, timezone: "Europe/Berlin", hours: "07:00 Türkçe · 08:00–18:00 Musik", newsHours: "07:00 Türkçe · 08:00–17:00 Deutsch" };
}

export function attachRadio(res: ServerResponse) {
  state.listeners.add(res);
  res.on("close", () => state.listeners.delete(res));
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
  void state.finishPlayback?.("interrupted");
  state.finishPlayback = undefined;
  proc?.kill("SIGKILL");
}

async function play(item: Item | null, scheduledFor?: Date) {
  stopTrack();
  const revision = state.revision;
  const file = item ? await assetFile(item.id) : null;
  if (revision !== state.revision || !isOnAir() || state.shutdown) return;
  const input = file ? ["-re", "-i", file, "-c:a", "copy"] : [
    "-re", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "10", "-c:a", "libmp3lame", "-b:a", "128k",
  ];
  const proc = spawn(/* turbopackIgnore: true */ process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", ...input,
    "-vn", "-id3v2_version", "0", "-write_xing", "0", "-flush_packets", "1", "-f", "mp3", "pipe:1"], { stdio: ["ignore", "pipe", "pipe"] });
  state.process = proc;
  state.playing = item;
  if (item?.kind === "news") state.musicSinceId = 0;
  state.startedAt = Date.now();
  const audit = item ? trackPlayback(item, item.kind === "news" && scheduledFor ? newsLanguage(scheduledFor) : item.kind === "music" || item.kind === "imaging" ? "zxx" : "de", scheduledFor, state.listeners.size) : null;
  state.finishPlayback = audit?.finish;
  proc.stdout.once("data", () => { void audit?.started().catch(report); });
  proc.stdout.on("data", publish);
  let failed = false;
  proc.stderr.on("data", () => { failed = true; });
  proc.on("error", () => { state.error = "Audiowiedergabe fehlgeschlagen; FFmpeg prüfen."; void audit?.finish("failed", state.error); });
  proc.on("close", code => {
    if (revision !== state.revision || state.shutdown) return;
    state.process = null;
    state.playing = null;
    state.finishPlayback = undefined;
    void audit?.finish(code === 0 ? "completed" : "failed", code === 0 ? undefined : `FFmpeg beendet (${code})`);
    if (code !== 0 || failed) state.error = "Audio konnte nicht vollständig abgespielt werden.";
    setTimeout(() => { void nextMusic().catch(report); }, code === 0 ? 0 : 5000);
  });
}

function report(error: unknown) {
  state.error = error instanceof Error ? error.message : "Radiofehler";
  console.error("[radio]", state.error);
}

async function nextMusic() {
  if (state.selecting || state.process || !isMusicHours() || state.shutdown) return;
  state.selecting = true;
  const revision = state.revision;
  try {
    if ((state.musicSinceId || 0) >= 3) {
      const ident = await stationIdAsset(new Date());
      if (revision !== state.revision || state.process) return;
      if (ident) { state.musicSinceId = 0; await play(ident); return; }
    }
    if (!state.musicQueue.length) {
      const tracks = await prisma.radioAsset.findMany({ where: { kind: "music" }, select: { id: true, title: true, duration: true, kind: true } });
      // Fisher–Yates shuffle; avoid repeating the last song at a pool boundary.
      for (let i = tracks.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [tracks[i], tracks[j]] = [tracks[j], tracks[i]]; }
      if (tracks.length > 1 && tracks[0].id === state.lastMusicId) [tracks[0], tracks[1]] = [tracks[1], tracks[0]];
      state.musicQueue = tracks;
    }
    if (revision !== state.revision || state.process) return;
    const item = state.musicQueue.shift() ?? null;
    if (item) { state.lastMusicId = item.id; state.musicSinceId = (state.musicSinceId || 0) + 1; }
    await play(item);
  } finally { state.selecting = false; }
}

async function tick(onBoundary: () => Promise<void>) {
  const now = new Date();
  const active = isOnAir(now);
  if (active !== state.onAir || !state.boundary) {
    state.onAir = active;
    state.boundary = `${stationTime(now).date}:${active}`;
    if (!active) {
      stopTrack();
      for (const res of state.listeners) res.end();
      state.listeners.clear();
    }
    await onBoundary();
  }
  // Exact slot identity: never replay an old bulletin after a restart or at 18:00.
  const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  if (active && now.getTime() - hour.getTime() < 1500 && state.lastNewsSlot !== hour.toISOString()) {
    state.lastNewsSlot = hour.toISOString();
    const news = await bulletinForSlot(hour);
    if (news && isOnAir() && Date.now() - hour.getTime() < 5000) await play(news, hour);
    else {
      state.error = "Zur vollen Stunde keine geprüfte Nachrichtenausgabe bereit.";
      await prisma.radioPlayback.create({ data: { title: "Nachrichtenausgabe nicht gesendet", language: newsLanguage(hour), kind: "news", status: "skipped", scheduledFor: hour,
        repeated: isRepeatSlot(hour), endedAt: new Date(), listeners: state.listeners.size, error: state.error } });
    }
  }
  if (active && !state.process) await nextMusic();

  const next = upcomingNewsSlot(now);
  if (radioEnabled() && next && next.getTime() - now.getTime() <= 10 * 60_000 && !state.preparing && Date.now() - state.lastPrepAt > 60_000 && process.env.ELEVENLABS_API_KEY && process.env.EDENAI_API_KEY) {
    state.lastPrepAt = Date.now();
    state.preparing = true;
    void prepareNews(next).catch(report).finally(() => { state.preparing = false; });
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
    await prisma.radioAsset.deleteMany({ where: { kind: "news", createdAt: { lt: cutoff } } });
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
