"use client";

const POLL_MS = 2000;
const STATUS_TIMEOUT_MS = 5000;
const STALL_TIMEOUT_MS = 15_000;

export type SpeakerPlaybackStatus = "idle" | "waiting" | "connecting" | "playing" | "buffering" | "reconnecting" | "blocked";

type Source = { url: string; relayId?: string; kind?: string };

type State = {
  zoneId: string;
  sources: Source[];
  live: boolean;
  volume: number;
};

const audioElements = new Map<string, HTMLAudioElement>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const audioCleanup = new Map<string, () => void>();
const playback = new Map<string, {
  time: number; progressedAt: number; status: SpeakerPlaybackStatus; reconnect: () => void;
}>();
let state: State | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let statusRequest: AbortController | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

// buffered.end() is downloaded audio, not a measured live timestamp. Seeking
// towards it discards the browser's jitter buffer and can repeatedly underrun.
// Let the media element play continuously, including across short network gaps.
function keyFor(src: Source): string { return JSON.stringify([src.relayId, src.url]); }

async function resolveSource(
  zoneId: string,
): Promise<{ sources: Source[]; live: boolean; volume: number } | null> {
  const request = new AbortController();
  statusRequest = request;
  const timeout = setTimeout(() => request.abort(), STATUS_TIMEOUT_MS);
  try {
    const r = await fetch(`/api/zones/${encodeURIComponent(zoneId)}/current-source`, {
      cache: "no-store", signal: request.signal,
    });
    if (!r.ok) return null;
    const data = await r.json();
    const vol = typeof data.volume === "number" ? data.volume : 80;
    const sources: Source[] =
      Array.isArray(data.sources) && data.sources.length > 0
        ? data.sources
        : data.url
          ? [{ url: data.url }]
          : [];
    return { sources, live: data.live ?? false, volume: vol };
  } catch { return null; }
  finally {
    clearTimeout(timeout);
    if (statusRequest === request) statusRequest = null;
  }
}

function removeAudio(key: string) {
  const retry = retryTimers.get(key);
  if (retry) clearTimeout(retry);
  retryTimers.delete(key);
  audioCleanup.get(key)?.();
  audioCleanup.delete(key);
  playback.delete(key);
  const el = audioElements.get(key);
  audioElements.delete(key);
  if (!el) return;
  el.pause();
  el.removeAttribute("src");
  el.load();
}

function applyState(
  session: State,
  next: { sources: Source[]; live: boolean; volume: number } | null,
) {
  // A failed status request is not an explicit instruction to stop the stream.
  // Session identity also rejects late responses after stop/restart of a zone.
  if (state !== session || !next) return;
  const { sources: nextSources, volume: nextVol } = next;
  session.sources = nextSources;
  session.live = next.live;
  session.volume = nextVol;

  const nextKeys = new Set(nextSources.map(keyFor));
  for (const key of new Set([...audioElements.keys(), ...retryTimers.keys()])) {
    if (!nextKeys.has(key)) removeAudio(key);
  }

  for (const src of nextSources) {
    const key = keyFor(src);
    if (!audioElements.has(key) && !retryTimers.has(key)) {
      const el = new Audio();
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      el.volume = Math.max(0, Math.min(1, nextVol / 100));
      el.src = src.url;
      const retry = () => {
        if (state !== session || audioElements.get(key) !== el) return;
        removeAudio(key);
        retryTimers.set(key, setTimeout(() => {
          retryTimers.delete(key);
          // Reconnect only the still-selected source. Polling owns source changes.
          if (state === session) applyState(session, session);
        }, POLL_MS));
        notify();
      };
      playback.set(key, { time: 0, progressedAt: Date.now(), status: "connecting", reconnect: retry });
      const playing = () => {
        const progress = playback.get(key);
        if (!progress || audioElements.get(key) !== el) return;
        progress.status = "playing";
        notify();
      };
      const waiting = () => {
        const progress = playback.get(key);
        if (!progress || progress.status === "blocked" || audioElements.get(key) !== el) return;
        progress.status = "buffering";
        notify();
      };
      el.addEventListener("error", retry);
      el.addEventListener("ended", retry);
      el.addEventListener("playing", playing);
      el.addEventListener("waiting", waiting);
      el.addEventListener("stalled", waiting);
      el.addEventListener("pause", waiting);
      audioCleanup.set(key, () => {
        el.removeEventListener("error", retry);
        el.removeEventListener("ended", retry);
        el.removeEventListener("playing", playing);
        el.removeEventListener("waiting", waiting);
        el.removeEventListener("stalled", waiting);
        el.removeEventListener("pause", waiting);
      });
      audioElements.set(key, el);
      playAudio(key, el);
    }
  }

  for (const el of audioElements.values()) {
    el.volume = Math.max(0, Math.min(1, nextVol / 100));
  }
  notify();
}

function playAudio(key: string, el: HTMLAudioElement) {
  void el.play().catch(error => {
    const progress = playback.get(key);
    if (audioElements.get(key) !== el || !progress) return;
    if (error?.name === "NotAllowedError") {
      // Retrying in a timer cannot grant user activation. Keep the element so
      // the visible resume button can call play() directly from a user gesture.
      progress.status = "blocked";
      notify();
    } else progress.reconnect();
  });
}

function watchPlayback(session: State) {
  if (state !== session) return;
  for (const [key, el] of audioElements) {
    const progress = playback.get(key);
    if (!progress || progress.status === "blocked") continue;
    if (el.currentTime > progress.time + 0.01) {
      progress.time = el.currentTime;
      progress.progressedAt = Date.now();
      progress.status = "playing";
    } else if (Date.now() - progress.progressedAt >= STALL_TIMEOUT_MS) {
      // An HTTP connection can stay open without producing media errors. Only
      // reconnect after actual playback stops; a growing buffer is healthy.
      progress.reconnect();
    }
  }
  notify();
  watchdogTimer = setTimeout(() => { watchdogTimer = null; watchPlayback(session); }, POLL_MS);
}

async function poll(session: State) {
  const next = await resolveSource(session.zoneId);
  if (state !== session) return;
  applyState(session, next);
  // Schedule after completion so a slow request cannot overtake a newer one.
  pollTimer = setTimeout(() => { pollTimer = null; void poll(session); }, POLL_MS);
}

export async function startSpeakerMode(zoneId: string) {
  if (state?.zoneId === zoneId) return;
  stopSpeakerMode();
  const session: State = { zoneId, sources: [], live: false, volume: 80 };
  state = session;
  notify();
  watchPlayback(session);
  await poll(session);
}

export function stopSpeakerMode() {
  state = null;
  statusRequest?.abort();
  statusRequest = null;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  for (const key of new Set([...audioElements.keys(), ...retryTimers.keys()])) removeAudio(key);
  notify();
}

export function activeSpeakerZone() { return state?.zoneId ?? null; }
export function activeSpeakerIsLive() { return state?.live ?? false; }
export function activeSpeakerHasSource() { return (state?.sources.length ?? 0) > 0; }
export function activeSpeakerPlaybackStatus(): SpeakerPlaybackStatus {
  if (!state) return "idle";
  if (!state.sources.length) return "waiting";
  const statuses = [...playback.values()].map(p => p.status);
  if (statuses.includes("blocked")) return "blocked";
  if (statuses.includes("playing")) return "playing";
  if (retryTimers.size) return "reconnecting";
  if (statuses.includes("buffering")) return "buffering";
  return "connecting";
}

export function resumeSpeakerPlayback() {
  for (const [key, el] of audioElements) {
    const progress = playback.get(key);
    if (!progress || progress.status !== "blocked") continue;
    progress.status = "connecting";
    progress.progressedAt = Date.now();
    playAudio(key, el);
  }
  notify();
}

export function subscribeSpeaker(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
