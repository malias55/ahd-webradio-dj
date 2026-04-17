import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

type ChunkSink = { write: (c: Buffer) => boolean | void; end: () => void };

type Relay = {
  zoneId: string;
  inputMime: string;
  outputMime: string;
  ffmpeg: ChildProcessWithoutNullStreams;
  subscribers: Set<ChunkSink>;
  startedAt: number;
};

const relays = new Map<string, Relay>();
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

// Transcodes browser MediaRecorder chunks (webm/opus) into a universally
// playable MP3 stream so iOS Safari, Android, desktop browsers, and mpv on
// the Pi can all consume /api/zones/:id/live identically.
function spawnFfmpeg(zoneId: string): ChildProcessWithoutNullStreams {
  const proc = spawn(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "warning",
      "-f", "webm",                         // force input container
      "-i", "pipe:0",
      "-vn",
      "-c:a", "libmp3lame",
      "-b:a", "128k",
      "-ar", "44100",
      "-ac", "2",
      "-f", "mp3",
      "pipe:1",
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );

  proc.stderr.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.error(`[ffmpeg ${zoneId}] ${line}`);
  });
  proc.on("exit", (code) => {
    console.warn(`[ffmpeg ${zoneId}] exited code=${code}`);
  });
  return proc;
}

export function startRelay(zoneId: string, inputMime: string): Relay {
  const existing = relays.get(zoneId);
  if (existing) {
    closeAllSubscribers(existing);
    try { existing.ffmpeg.kill("SIGTERM"); } catch { /* noop */ }
    relays.delete(zoneId);
  }

  const ffmpeg = spawnFfmpeg(zoneId);
  const r: Relay = {
    zoneId,
    inputMime,
    outputMime: "audio/mpeg",
    ffmpeg,
    subscribers: new Set(),
    startedAt: Date.now(),
  };

  ffmpeg.stdout.on("data", (chunk: Buffer) => {
    for (const sub of r.subscribers) {
      try { sub.write(chunk); }
      catch { r.subscribers.delete(sub); }
    }
  });
  ffmpeg.stdout.on("end", () => closeAllSubscribers(r));
  ffmpeg.on("exit", () => closeAllSubscribers(r));

  relays.set(zoneId, r);
  return r;
}

export function stopRelay(zoneId: string) {
  const r = relays.get(zoneId);
  if (!r) return false;
  try { r.ffmpeg.stdin.end(); } catch { /* noop */ }
  try { r.ffmpeg.kill("SIGTERM"); } catch { /* noop */ }
  closeAllSubscribers(r);
  relays.delete(zoneId);
  return true;
}

export function hasRelay(zoneId: string) {
  return relays.has(zoneId);
}

export function relayOutputMime(zoneId: string) {
  return relays.get(zoneId)?.outputMime ?? "audio/mpeg";
}

// Pushes a WebM/Opus chunk from a browser broadcaster into ffmpeg's stdin.
// Returns the number of live subscribers at call time.
export function pushChunk(zoneId: string, chunk: Buffer) {
  const r = relays.get(zoneId);
  if (!r) return 0;
  try { r.ffmpeg.stdin.write(chunk); } catch (e) {
    console.error(`[relay ${zoneId}] ffmpeg stdin write failed`, e);
  }
  return r.subscribers.size;
}

export function attachSubscriber(zoneId: string, sink: ChunkSink): Relay | null {
  const r = relays.get(zoneId);
  if (!r) return null;
  r.subscribers.add(sink);
  return r;
}

export function detachSubscriber(zoneId: string, sink: ChunkSink) {
  const r = relays.get(zoneId);
  if (!r) return;
  r.subscribers.delete(sink);
}

function closeAllSubscribers(r: Relay) {
  for (const sub of r.subscribers) {
    try { sub.end(); } catch { /* noop */ }
  }
  r.subscribers.clear();
}

export function relayStats() {
  return Array.from(relays.values()).map((r) => ({
    zoneId: r.zoneId,
    inputMime: r.inputMime,
    outputMime: r.outputMime,
    subscribers: r.subscribers.size,
    startedAt: r.startedAt,
  }));
}
