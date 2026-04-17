"use client";

import { io, type Socket } from "socket.io-client";

export type CaptureSource = "tab" | "microphone";
export type BroadcastMode = "stream" | "announce";

export type BroadcasterState = {
  zoneIds: string[];
  source: CaptureSource;
  mode: BroadcastMode;
  stream: MediaStream;
  recorder: MediaRecorder;
  socket: Socket;
};

let active: BroadcasterState | null = null;

type StartOpts = {
  zoneIds: string[];       // one or many (batch)
  source: CaptureSource;
  mode: BroadcastMode;     // "stream" = continuous feed; "announce" = short, low-latency
};

export async function startBroadcast(opts: StartOpts): Promise<BroadcasterState> {
  if (active) await stopBroadcast();

  const { zoneIds, source, mode } = opts;
  if (!zoneIds.length) throw new Error("Keine Zone gewählt");

  const stream =
    source === "tab"
      ? await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
      : await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });

  const audioTracks = stream.getAudioTracks();
  if (audioTracks.length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error(
      source === "tab"
        ? "Kein Audio geteilt. Beim Teilen des Tabs 'Audio teilen' aktivieren."
        : "Kein Mikrofon verfügbar."
    );
  }
  stream.getVideoTracks().forEach((t) => t.stop());
  const audioOnly = new MediaStream(audioTracks);

  const mime = pickMime();
  const recorder = new MediaRecorder(audioOnly, { mimeType: mime, audioBitsPerSecond: 96_000 });

  const socket = io("/broadcast", { path: "/ws", transports: ["websocket"] });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (e) => reject(e));
  });

  // Tell the server to start a relay per target zone + switch Pis to live.
  await fetch(`/api/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", zoneIds, mode, mime }),
  });

  for (const zoneId of zoneIds) socket.emit("broadcast:start", { zoneId, mime });

  recorder.ondataavailable = async (ev) => {
    if (!ev.data || ev.data.size === 0) return;
    const buf = await ev.data.arrayBuffer();
    for (const zoneId of zoneIds) socket.emit("broadcast:chunk", { zoneId, chunk: buf });
  };

  // announce = short chunks (lower latency), stream = moderate
  recorder.start(mode === "announce" ? 120 : 250);

  active = { zoneIds, source, mode, stream: audioOnly, recorder, socket };
  return active;
}

export async function stopBroadcast() {
  if (!active) return;
  const { zoneIds, stream, recorder, socket, mode } = active;
  try { recorder.state !== "inactive" && recorder.stop(); } catch { /* noop */ }
  stream.getTracks().forEach((t) => t.stop());
  for (const zoneId of zoneIds) socket.emit("broadcast:stop", { zoneId });
  socket.close();
  await fetch(`/api/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "stop", zoneIds, mode }),
  }).catch(() => {});
  active = null;
}

export function activeBroadcast() {
  return active ? { zoneIds: [...active.zoneIds], mode: active.mode, source: active.source } : null;
}

function pickMime() {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "audio/webm";
}
