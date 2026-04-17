import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

type ChunkSink = { write: (c: Buffer) => boolean | void; end: () => void };
export type RelayKind = "stream" | "announce";

type Relay = {
  zoneId: string;
  kind: RelayKind;
  ffmpeg: ChildProcessWithoutNullStreams;
  subscribers: Set<ChunkSink>;
  startedAt: number;
};

const streamRelays = new Map<string, Relay>();
const announceRelays = new Map<string, Relay>();

const ANNOUNCE_COOLDOWN_MS = 5000;
let lastAnnounceEndedAt = 0;

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function spawnFfmpeg(zoneId: string, kind: RelayKind): ChildProcessWithoutNullStreams {
  // No -f on input: let ffmpeg autodetect. Browsers emit WebM/Opus (Chrome,
  // Firefox, Android) or MP4/AAC (iOS Safari) from MediaRecorder; ffmpeg
  // sniffs both fine as long as the first chunk carries the container header.
  const proc = spawn(
    FFMPEG,
    [
      "-hide_banner", "-loglevel", "warning",
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
    if (line) console.error(`[ffmpeg ${zoneId}/${kind}] ${line}`);
  });
  proc.on("exit", (code) => {
    console.warn(`[ffmpeg ${zoneId}/${kind}] exited code=${code}`);
  });
  return proc;
}

function mapFor(kind: RelayKind) {
  return kind === "announce" ? announceRelays : streamRelays;
}

function closeSubscribers(r: Relay) {
  for (const sub of r.subscribers) {
    try { sub.end(); } catch { /* noop */ }
  }
  r.subscribers.clear();
}

// When the effective output mode changes, force every current listener to
// reconnect so they pick up the new relay cleanly (MP3 frame continuity).
function closeAllListenersForZone(zoneId: string) {
  const a = announceRelays.get(zoneId);
  const s = streamRelays.get(zoneId);
  if (a) closeSubscribers(a);
  if (s) closeSubscribers(s);
}

export function canStartAnnounce(): { ok: true } | { ok: false; reason: string; retryInMs?: number } {
  if (announceRelays.size > 0) {
    return { ok: false, reason: "Eine Durchsage läuft bereits." };
  }
  const left = lastAnnounceEndedAt + ANNOUNCE_COOLDOWN_MS - Date.now();
  if (left > 0) {
    return { ok: false, reason: `Bitte ${Math.ceil(left / 1000)}s bis zur nächsten Durchsage warten.`, retryInMs: left };
  }
  return { ok: true };
}

export function startRelay(zoneId: string, kind: RelayKind): Relay {
  const map = mapFor(kind);
  const existing = map.get(zoneId);
  if (existing) {
    closeSubscribers(existing);
    try { existing.ffmpeg.stdin.end(); existing.ffmpeg.kill("SIGTERM"); } catch { /* noop */ }
    map.delete(zoneId);
  }

  const ffmpeg = spawnFfmpeg(zoneId, kind);
  const r: Relay = {
    zoneId, kind, ffmpeg,
    subscribers: new Set(),
    startedAt: Date.now(),
  };

  let loggedFirstOut = false;
  ffmpeg.stdout.on("data", (chunk: Buffer) => {
    if (!loggedFirstOut) {
      loggedFirstOut = true;
      console.log(`[relay ${zoneId}/${kind}] first MP3 bytes: ${chunk.length}`);
    }
    for (const sub of r.subscribers) {
      try { sub.write(chunk); } catch { r.subscribers.delete(sub); }
    }
  });
  ffmpeg.stdout.on("end", () => closeSubscribers(r));

  map.set(zoneId, r);
  // An announce becoming active promotes to top priority — force listeners to reconnect.
  if (kind === "announce") closeAllListenersForZone(zoneId);
  return r;
}

export function stopRelay(zoneId: string, kind: RelayKind) {
  const map = mapFor(kind);
  const r = map.get(zoneId);
  if (!r) return false;
  try { r.ffmpeg.stdin.end(); r.ffmpeg.kill("SIGTERM"); } catch { /* noop */ }
  closeSubscribers(r);
  map.delete(zoneId);
  if (kind === "announce") {
    lastAnnounceEndedAt = Date.now();
    // Announce ending demotes back to stream (or native) — force re-subscribe.
    closeAllListenersForZone(zoneId);
  }
  return true;
}

export function stopAllRelaysForZone(zoneId: string) {
  stopRelay(zoneId, "announce");
  stopRelay(zoneId, "stream");
}

const firstChunkLogged = new WeakSet<object>();
export function pushChunk(zoneId: string, kind: RelayKind, chunk: Buffer) {
  const r = mapFor(kind).get(zoneId);
  if (!r) return 0;
  if (!firstChunkLogged.has(r)) {
    firstChunkLogged.add(r);
    console.log(`[relay ${zoneId}/${kind}] first input chunk: ${chunk.length} B`);
  }
  try { r.ffmpeg.stdin.write(chunk); } catch { /* noop */ }
  return r.subscribers.size;
}

export function currentMode(zoneId: string): RelayKind | null {
  if (announceRelays.has(zoneId)) return "announce";
  if (streamRelays.has(zoneId)) return "stream";
  return null;
}

export function hasAnyRelay(zoneId: string) {
  return currentMode(zoneId) !== null;
}

export function attachSubscriber(zoneId: string, sink: ChunkSink): { kind: RelayKind } | null {
  const kind = currentMode(zoneId);
  if (!kind) return null;
  const r = mapFor(kind).get(zoneId)!;
  r.subscribers.add(sink);
  return { kind };
}

export function detachSubscriber(zoneId: string, sink: ChunkSink) {
  for (const map of [announceRelays, streamRelays]) {
    const r = map.get(zoneId);
    if (!r) continue;
    r.subscribers.delete(sink);
  }
}

export function relayStats() {
  const out: { zoneId: string; kind: RelayKind; subscribers: number; startedAt: number }[] = [];
  for (const r of announceRelays.values()) out.push({ zoneId: r.zoneId, kind: "announce", subscribers: r.subscribers.size, startedAt: r.startedAt });
  for (const r of streamRelays.values()) out.push({ zoneId: r.zoneId, kind: "stream", subscribers: r.subscribers.size, startedAt: r.startedAt });
  return out;
}
