import { spawn, type ChildProcessWithoutNullStreams } from "child_process";

type ChunkSink = { write: (c: Buffer) => boolean | void; end: () => void };
export type RelayKind = "stream" | "announce";

type Relay = {
  relayId: string;
  zoneId: string;
  kind: RelayKind;
  ffmpeg: ChildProcessWithoutNullStreams;
  subscribers: Set<ChunkSink>;
  startedAt: number;
};

// State lives on globalThis so Next.js API routes (which may run in an
// isolated server-components module context under dev/Turbopack) share the
// same maps as the custom server.ts that spawns ffmpeg.
type BroadcastGlobal = {
  streamRelays: Map<string, Relay>;   // key: zoneId (one stream per zone)
  announceRelays: Map<string, Relay>; // key: relayId (multiple announces per zone)
  lastAnnounceEndedAt: number;
  relaySeq: number;
};
const _g = globalThis as unknown as { __ahdBroadcast?: BroadcastGlobal };
if (!_g.__ahdBroadcast) {
  _g.__ahdBroadcast = {
    streamRelays: new Map(),
    announceRelays: new Map(),
    lastAnnounceEndedAt: 0,
    relaySeq: 0,
  };
}
const streamRelays = _g.__ahdBroadcast.streamRelays;
const announceRelays = _g.__ahdBroadcast.announceRelays;

function getLastAnnounceEndedAt(): number { return _g.__ahdBroadcast!.lastAnnounceEndedAt; }
function setLastAnnounceEndedAt(v: number) { _g.__ahdBroadcast!.lastAnnounceEndedAt = v; }
function nextRelayId(): string { return `ann_${Date.now()}_${++_g.__ahdBroadcast!.relaySeq}`; }

const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

function inputFormat(mime: string | undefined): string {
  if (!mime) return "webm";
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("aac") || m.includes("m4a")) return "mp4";
  return "webm";
}

function spawnFfmpeg(zoneId: string, kind: RelayKind, relayId: string, mime?: string): ChildProcessWithoutNullStreams {
  const fmt = inputFormat(mime);
  const tag = `${zoneId}/${kind}/${relayId}`;
  const args = [
    "-hide_banner", "-loglevel", "info",
    "-fflags", "+nobuffer+genpts+discardcorrupt",
    "-probesize", "2000000",
    "-analyzeduration", "2000000",
    "-f", fmt,
    "-i", "pipe:0",
    "-vn",
    "-c:a", "libmp3lame",
    "-b:a", "128k",
    "-ar", "44100",
    "-ac", "2",
    "-f", "mp3",
    "pipe:1",
  ];
  const proc = spawn(FFMPEG, args, { stdio: ["pipe", "pipe", "pipe"] });
  console.log(`[relay ${tag}] ffmpeg spawn -f ${fmt} mime=${mime || "<none>"}`);
  proc.stderr.on("data", (d) => {
    const line = d.toString().trim();
    if (line) console.error(`[ffmpeg ${tag}] ${line}`);
  });
  proc.stdin.on("error", (e) => {
    if ((e as NodeJS.ErrnoException).code !== "EPIPE") {
      console.error(`[ffmpeg ${tag}] stdin error`, e);
    }
  });
  proc.on("exit", (code) => {
    console.warn(`[ffmpeg ${tag}] exited code=${code}`);
  });
  return proc;
}

export function announceRelaysForZone(zoneId: string): Relay[] {
  const out: Relay[] = [];
  for (const r of announceRelays.values()) {
    if (r.zoneId === zoneId) out.push(r);
  }
  return out;
}

function closeSubscribers(r: Relay) {
  for (const sub of r.subscribers) {
    try { sub.end(); } catch { /* noop */ }
  }
  r.subscribers.clear();
}

function closeAllListenersForZone(zoneId: string) {
  for (const r of announceRelaysForZone(zoneId)) closeSubscribers(r);
  const s = streamRelays.get(zoneId);
  if (s) closeSubscribers(s);
}

// Parallel announces are allowed — no lock. Only a short cooldown after ALL
// announces for any zone end, to prevent accidental double-start.
const ANNOUNCE_COOLDOWN_MS = 2000;
export function canStartAnnounce(): { ok: true } | { ok: false; reason: string; retryInMs?: number } {
  const left = getLastAnnounceEndedAt() + ANNOUNCE_COOLDOWN_MS - Date.now();
  if (left > 0) {
    return { ok: false, reason: `Bitte ${Math.ceil(left / 1000)}s warten.`, retryInMs: left };
  }
  return { ok: true };
}

export function startRelay(zoneId: string, kind: RelayKind, mime?: string): string {
  if (kind === "stream") {
    const existing = streamRelays.get(zoneId);
    if (existing) {
      closeSubscribers(existing);
      try { existing.ffmpeg.stdin.end(); existing.ffmpeg.kill("SIGTERM"); } catch { /* noop */ }
      streamRelays.delete(zoneId);
    }
    const relayId = zoneId;
    const ffmpeg = spawnFfmpeg(zoneId, kind, relayId, mime);
    const r: Relay = { relayId, zoneId, kind, ffmpeg, subscribers: new Set(), startedAt: Date.now() };
    let loggedFirstOut = false;
    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      if (!loggedFirstOut) { loggedFirstOut = true; console.log(`[relay ${zoneId}/stream] first MP3 bytes: ${chunk.length}`); }
      for (const sub of r.subscribers) { try { sub.write(chunk); } catch { r.subscribers.delete(sub); } }
    });
    ffmpeg.stdout.on("end", () => closeSubscribers(r));
    streamRelays.set(zoneId, r);
    return relayId;
  }

  // Announce: each broadcaster gets its own relay — parallel announces supported
  const relayId = nextRelayId();
  const ffmpeg = spawnFfmpeg(zoneId, kind, relayId, mime);
  const r: Relay = { relayId, zoneId, kind, ffmpeg, subscribers: new Set(), startedAt: Date.now() };
  let loggedFirstOut = false;
  ffmpeg.stdout.on("data", (chunk: Buffer) => {
    if (!loggedFirstOut) { loggedFirstOut = true; console.log(`[relay ${zoneId}/announce/${relayId}] first MP3 bytes: ${chunk.length}`); }
    for (const sub of r.subscribers) { try { sub.write(chunk); } catch { r.subscribers.delete(sub); } }
  });
  ffmpeg.stdout.on("end", () => closeSubscribers(r));
  announceRelays.set(relayId, r);
  closeAllListenersForZone(zoneId);
  console.log(`[relay] announce started relayId=${relayId} zone=${zoneId} total=${announceRelaysForZone(zoneId).length}`);
  return relayId;
}

export function stopRelay(relayId: string, kind: RelayKind) {
  if (kind === "stream") {
    const r = streamRelays.get(relayId);
    if (!r) return false;
    try { r.ffmpeg.stdin.end(); r.ffmpeg.kill("SIGTERM"); } catch { /* noop */ }
    closeSubscribers(r);
    streamRelays.delete(relayId);
    return true;
  }
  const r = announceRelays.get(relayId);
  if (!r) return false;
  const zoneId = r.zoneId;
  try { r.ffmpeg.stdin.end(); r.ffmpeg.kill("SIGTERM"); } catch { /* noop */ }
  closeSubscribers(r);
  announceRelays.delete(relayId);
  console.log(`[relay] announce stopped relayId=${relayId} zone=${zoneId} remaining=${announceRelaysForZone(zoneId).length}`);
  if (announceRelaysForZone(zoneId).length === 0) {
    setLastAnnounceEndedAt(Date.now());
  }
  closeAllListenersForZone(zoneId);
  return true;
}

export function stopAllRelaysForZone(zoneId: string) {
  for (const r of announceRelaysForZone(zoneId)) stopRelay(r.relayId, "announce");
  stopRelay(zoneId, "stream");
}

const firstChunkLogged = new WeakSet<object>();
export function pushChunk(relayId: string, kind: RelayKind, chunk: Buffer) {
  const map = kind === "stream" ? streamRelays : announceRelays;
  const r = map.get(relayId);
  if (!r) return 0;
  if (!firstChunkLogged.has(r)) {
    firstChunkLogged.add(r);
    console.log(`[relay ${r.zoneId}/${kind}/${relayId}] first input chunk: ${chunk.length} B`);
  }
  try { r.ffmpeg.stdin.write(chunk); } catch { /* noop */ }
  return r.subscribers.size;
}

export function currentMode(zoneId: string): RelayKind | null {
  if (announceRelaysForZone(zoneId).length > 0) return "announce";
  if (streamRelays.has(zoneId)) return "stream";
  return null;
}

export function hasAnyRelay(zoneId: string) {
  return currentMode(zoneId) !== null;
}

export function hasRelay(relayId: string): boolean {
  return announceRelays.has(relayId) || streamRelays.has(relayId);
}

export function attachToRelay(relayId: string, sink: ChunkSink): { kind: RelayKind } | null {
  const r = announceRelays.get(relayId) || streamRelays.get(relayId);
  if (!r) return null;
  r.subscribers.add(sink);
  return { kind: r.kind };
}

export function attachSubscriber(zoneId: string, sink: ChunkSink): { kind: RelayKind } | null {
  const announces = announceRelaysForZone(zoneId);
  if (announces.length > 0) {
    for (const r of announces) r.subscribers.add(sink);
    return { kind: "announce" };
  }
  const stream = streamRelays.get(zoneId);
  if (stream) { stream.subscribers.add(sink); return { kind: "stream" }; }
  return null;
}

export function detachSubscriber(zoneId: string, sink: ChunkSink) {
  for (const r of announceRelaysForZone(zoneId)) r.subscribers.delete(sink);
  const s = streamRelays.get(zoneId);
  if (s) s.subscribers.delete(sink);
}

export function detachFromRelay(relayId: string, sink: ChunkSink) {
  const r = announceRelays.get(relayId) || streamRelays.get(relayId);
  if (r) r.subscribers.delete(sink);
}

export function relayStats() {
  const out: { relayId: string; zoneId: string; kind: RelayKind; subscribers: number; startedAt: number }[] = [];
  for (const r of announceRelays.values()) out.push({ relayId: r.relayId, zoneId: r.zoneId, kind: "announce", subscribers: r.subscribers.size, startedAt: r.startedAt });
  for (const r of streamRelays.values()) out.push({ relayId: r.relayId, zoneId: r.zoneId, kind: "stream", subscribers: r.subscribers.size, startedAt: r.startedAt });
  return out;
}
