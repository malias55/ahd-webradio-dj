"use client";

const POLL_MS = 2000;
const STATUS_TIMEOUT_MS = 5000;

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
let state: State | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
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
      };
      el.addEventListener("error", retry);
      el.addEventListener("ended", retry);
      audioCleanup.set(key, () => {
        el.removeEventListener("error", retry);
        el.removeEventListener("ended", retry);
      });
      audioElements.set(key, el);
      void el.play().catch(e => console.warn("[speaker] play failed", src.url, e));
    }
  }

  for (const el of audioElements.values()) {
    el.volume = Math.max(0, Math.min(1, nextVol / 100));
  }
  notify();
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
  await poll(session);
}

export function stopSpeakerMode() {
  state = null;
  statusRequest?.abort();
  statusRequest = null;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  for (const key of new Set([...audioElements.keys(), ...retryTimers.keys()])) removeAudio(key);
  notify();
}

export function activeSpeakerZone() { return state?.zoneId ?? null; }
export function activeSpeakerIsLive() { return state?.live ?? false; }
export function activeSpeakerHasSource() { return (state?.sources.length ?? 0) > 0; }

export function subscribeSpeaker(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
