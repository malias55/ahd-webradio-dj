"use client";

const POLL_MS = 2000;
const STATUS_TIMEOUT_MS = 5000;
const STALL_TIMEOUT_MS = 15_000;
const SELECTION_KEY = "ahd:speaker-zone:v1";

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
const mediaSources = new Map<string, MediaElementAudioSourceNode>();
let gainContext: AudioContext | null = null;
let speakerGain: GainNode | null = null;
let volumeEvents: EventSource | null = null;
let pushedVolume = false, volumeRevision = 0;
const playback = new Map<string, {
  time: number; progressedAt: number; attempt: number; status: SpeakerPlaybackStatus; reconnect: () => void;
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

function setAudioVolume(volume: number) {
  const level = Math.max(0, Math.min(1, volume / 100));
  if (speakerGain) speakerGain.gain.value = level;
  for (const [key, el] of audioElements) el.volume = mediaSources.has(key) ? 1 : level;
}

function prepareVolumeControl() {
  const Context = globalThis.AudioContext || (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Context) return;
  try {
    gainContext = new Context();
    speakerGain = gainContext.createGain();
    speakerGain.gain.value = (state?.volume ?? 80) / 100;
    speakerGain.connect(gainContext.destination);
    gainContext.onstatechange = notify;
    // Start inside the click gesture, before fetching a source. iOS does not
    // support programmatic media-element volume; GainNode controls it instead.
    void gainContext.resume().catch(notify);
  } catch { speakerGain = null; if (gainContext) void gainContext.close().catch(() => {}); gainContext = null; }
}

function watchVolume(session: State) {
  if (typeof EventSource === "undefined") return;
  try {
    const events = new EventSource(`/api/zones/${encodeURIComponent(session.zoneId)}/volume-events`);
    volumeEvents = events;
    events.onmessage = event => {
      if (state !== session || volumeEvents !== events) return;
      try {
        const value = JSON.parse(event.data) as { zoneId?: unknown; volume?: unknown };
        if (value.zoneId !== session.zoneId || typeof value.volume !== "number" || !Number.isFinite(value.volume)) return;
        session.volume = Math.max(0, Math.min(100, value.volume));
        pushedVolume = true; volumeRevision++;
        setAudioVolume(session.volume);
        notify();
      } catch { /* A malformed message must not change the playing volume. */ }
    };
    events.onerror = () => { if (state === session && volumeEvents === events) pushedVolume = false; };
  } catch { /* Source polling remains available when EventSource is unavailable. */ }
}

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
  mediaSources.get(key)?.disconnect();
  mediaSources.delete(key);
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
      if (gainContext && speakerGain) {
        try {
          const source = gainContext.createMediaElementSource(el);
          source.connect(speakerGain);
          mediaSources.set(key, source);
          el.volume = 1;
        } catch { /* Retain media-element volume on unsupported browsers. */ }
      }
      const retry = () => {
        if (state !== session || audioElements.get(key) !== el || retryTimers.has(key)) return;
        const progress = playback.get(key);
        if (!progress) return;
        progress.status = "reconnecting";
        retryTimers.set(key, setTimeout(() => {
          retryTimers.delete(key);
          if (state !== session || audioElements.get(key) !== el) return;
          // Keep the already-authorized media element across server restarts.
          // Invalidate the previous play promise before load() can abort it.
          progress.attempt++;
          progress.time = 0;
          progress.progressedAt = Date.now();
          progress.status = "connecting";
          el.load();
          playAudio(key, el);
          notify();
        }, POLL_MS));
        notify();
      };
      playback.set(key, { time: 0, progressedAt: Date.now(), attempt: 0, status: "connecting", reconnect: retry });
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

  setAudioVolume(nextVol);
  notify();
}

function playAudio(key: string, el: HTMLAudioElement) {
  const current = playback.get(key);
  if (!current) return;
  const attempt = ++current.attempt;
  void el.play().catch(error => {
    const progress = playback.get(key);
    if (audioElements.get(key) !== el || !progress || progress.attempt !== attempt) return;
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
      const retry = retryTimers.get(key);
      if (retry) { clearTimeout(retry); retryTimers.delete(key); }
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
  const revision = volumeRevision;
  const next = await resolveSource(session.zoneId);
  if (state !== session) return;
  // An older HTTP response cannot overwrite a volume just received live.
  if (next && (pushedVolume || volumeRevision !== revision)) next.volume = session.volume;
  applyState(session, next);
  // Schedule after completion so a slow request cannot overtake a newer one.
  pollTimer = setTimeout(() => { pollTimer = null; void poll(session); }, POLL_MS);
}

export async function startSpeakerMode(zoneId: string) {
  if (state?.zoneId === zoneId) return;
  suspendSpeakerMode();
  try { sessionStorage.setItem(SELECTION_KEY, zoneId); } catch { /* Storage can be disabled. */ }
  const session: State = { zoneId, sources: [], live: false, volume: 80 };
  state = session;
  prepareVolumeControl();
  watchVolume(session);
  notify();
  watchPlayback(session);
  await poll(session);
}

export function stopSpeakerMode() {
  try { sessionStorage.removeItem(SELECTION_KEY); } catch { /* Playback still stops without storage. */ }
  suspendSpeakerMode();
}

export function suspendSpeakerMode() {
  state = null;
  volumeEvents?.close(); volumeEvents = null;
  pushedVolume = false; volumeRevision++;
  statusRequest?.abort();
  statusRequest = null;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  for (const key of new Set([...audioElements.keys(), ...retryTimers.keys()])) removeAudio(key);
  const context = gainContext;
  gainContext = null; speakerGain = null;
  if (context) { context.onstatechange = null; void context.close().catch(() => {}); }
  notify();
}

export async function restoreSpeakerMode() {
  if (state) return;
  try {
    const zoneId = sessionStorage.getItem(SELECTION_KEY);
    if (zoneId && zoneId.length <= 256) await startSpeakerMode(zoneId);
  } catch { /* No remembered playback when storage is unavailable. */ }
}

// Owned by the app layout so route changes do not disable the player lifecycle.
// Page exit releases resources but preserves intent; explicit Stop clears it.
export function attachSpeakerLifecycle(target: Pick<Window, "addEventListener" | "removeEventListener">) {
  const restore = () => { void restoreSpeakerMode(); };
  target.addEventListener("pagehide", suspendSpeakerMode);
  target.addEventListener("pageshow", restore);
  restore();
  return () => {
    target.removeEventListener("pagehide", suspendSpeakerMode);
    target.removeEventListener("pageshow", restore);
    suspendSpeakerMode();
  };
}

export function activeSpeakerZone() { return state?.zoneId ?? null; }
export function activeSpeakerIsLive() { return state?.live ?? false; }
export function activeSpeakerVolume() { return state?.volume ?? null; }
export function activeSpeakerHasSource() { return (state?.sources.length ?? 0) > 0; }
export function activeSpeakerPlaybackStatus(): SpeakerPlaybackStatus {
  if (!state) return "idle";
  if (!state.sources.length) return "waiting";
  if (gainContext?.state === "suspended") return "blocked";
  const statuses = [...playback.values()].map(p => p.status);
  if (statuses.includes("blocked")) return "blocked";
  if (retryTimers.size) return "reconnecting";
  if (statuses.includes("playing")) return "playing";
  if (statuses.includes("buffering")) return "buffering";
  return "connecting";
}

export function resumeSpeakerPlayback() {
  if (gainContext) void gainContext.resume().catch(notify);
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
