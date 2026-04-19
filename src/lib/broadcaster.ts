"use client";

import { io, type Socket } from "socket.io-client";

export type CaptureSource = "tab" | "microphone";
export type BroadcastMode = "stream" | "announce";

// Durchsage is capped at 60s server-side + client-side.
export const ANNOUNCE_MAX_MS = 60_000;

export type BroadcasterState = {
  zoneIds: string[];
  source: CaptureSource;
  mode: BroadcastMode;
  stream: MediaStream;
  recorder: MediaRecorder;
  socket: Socket;
  analyser: AnalyserNode;
  audioCtx: AudioContext;
  startedAt: number;
};

let active: BroadcasterState | null = null;
const stateListeners = new Set<() => void>();
function notify() { for (const fn of stateListeners) fn(); }

export function subscribeBroadcaster(fn: () => void) {
  stateListeners.add(fn);
  return () => { stateListeners.delete(fn); };
}

export function activeBroadcast() {
  return active
    ? { zoneIds: [...active.zoneIds], mode: active.mode, source: active.source, startedAt: active.startedAt }
    : null;
}

// Returns 0..1 peak level of the current mic/tab capture, for a VU meter.
// Re-reads the analyser on each call; 0 if no active broadcast.
export function peakLevel() {
  if (!active) return 0;
  const { analyser } = active;
  const data = new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    const v = Math.abs(data[i] - 128) / 128;
    if (v > peak) peak = v;
  }
  return peak;
}

type StartOpts = {
  zoneIds: string[];
  source: CaptureSource;
  mode: BroadcastMode;
};

export async function startBroadcast(opts: StartOpts): Promise<BroadcasterState> {
  if (active) await stopBroadcast();
  const { zoneIds, source, mode } = opts;
  if (!zoneIds.length) throw new Error("Keine Zone gewählt");

  const stream =
    source === "tab"
      ? await navigator.mediaDevices.getDisplayMedia({
          audio: { suppressLocalAudioPlayback: true } as MediaTrackConstraints,
          video: true,
        })
      : await navigator.mediaDevices.getUserMedia({ audio: true });

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(
      source === "tab"
        ? "Kein Audio geteilt. Beim Teilen des Tabs 'Audio teilen' aktivieren."
        : "Kein Mikrofon verfügbar.",
    );
  }
  stream.getVideoTracks().forEach((t) => t.stop());
  const audioOnly = new MediaStream(audioTracks);

  for (const t of audioTracks) {
    t.addEventListener("ended", () => { stopBroadcast().catch(() => {}); });
  }

  const mime = pickMime();
  const bps = source === "tab" ? 256_000 : 96_000;
  const recorder = new MediaRecorder(
    audioOnly,
    mime ? { mimeType: mime, audioBitsPerSecond: bps } : { audioBitsPerSecond: bps },
  );

  // Analyser for the VU meter — separate tap on the same stream.
  const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const src = audioCtx.createMediaStreamSource(audioOnly);
  const analyser = audioCtx.createAnalyser();
  analyser.fftSize = 1024;
  src.connect(analyser);

  const socket = io("/broadcast", { path: "/ws", transports: ["websocket"] });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });

  // Pre-check (announce lock). Relay itself is spawned by the socket handler.
  const resp = await fetch(`/api/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", zoneIds, mode }),
  });
  if (!resp.ok) {
    socket.close();
    audioCtx.close().catch(() => {});
    stream.getTracks().forEach((t) => t.stop());
    const { error } = (await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))) as { error?: string };
    throw new Error(error || `HTTP ${resp.status}`);
  }

  for (const zoneId of zoneIds) socket.emit("broadcast:start", { zoneId, mode, mime });

  recorder.ondataavailable = async (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    const buf = await ev.data.arrayBuffer();
    for (const zoneId of zoneIds) socket.emit("broadcast:chunk", { zoneId, chunk: buf });
  };
  recorder.start(100);

  active = { zoneIds, source, mode, stream: audioOnly, recorder, socket, analyser, audioCtx, startedAt: Date.now() };

  // 60s cap for Durchsage
  if (mode === "announce") {
    setTimeout(() => { if (active && active.mode === "announce") stopBroadcast().catch(() => {}); }, ANNOUNCE_MAX_MS);
  }

  notify();
  return active;
}

export async function stopBroadcast() {
  if (!active) return;
  const { zoneIds, stream, recorder, socket, audioCtx, mode } = active;
  try { recorder.state !== "inactive" && recorder.stop(); } catch { /* noop */ }
  stream.getTracks().forEach((t) => t.stop());
  try { await audioCtx.close(); } catch { /* noop */ }
  for (const zoneId of zoneIds) socket.emit("broadcast:stop", { zoneId });
  socket.close();
  active = null;
  // POST is best-effort; socket disconnect already tears down server-side relay
  fetch(`/api/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "stop", zoneIds, mode }),
  }).catch(() => {});
  notify();
}

function pickMime() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}
