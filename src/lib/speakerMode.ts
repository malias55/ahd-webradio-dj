"use client";

import { SyncedSpeakerPlayer, syncedPlaybackSupported } from "./speaker-sync-player";

const POLL_MS = 2000;
const STATUS_TIMEOUT_MS = 5000;
const STALL_TIMEOUT_MS = 15_000;
const SELECTION_KEY = "ahd:speaker-zone:v1";
const TRIM_KEY = "ahd:speaker-trim-ms:v1";
const TIME_URL = "/api/speaker-time";
const RELOADED_KEY = "ahd:reloaded-for-build:v1";

export type SpeakerPlaybackStatus = "waiting" | "connecting" | "idle" | "playing" | "buffering" | "reconnecting" | "blocked" | "paused" | "unauthorized";

type Source = { url: string; relayId?: string; kind?: string };

type State = {
  zoneId: string;
  sources: Source[];
  // The zone uses the server-routed stream that every device plays in step.
  continuous: boolean;
  upstreamStatus?: "waiting" | "buffering" | "reconnecting";
  live: boolean;
  volume: number;
};
type ResolvedSource = Omit<State, "zoneId"> & { build?: string };

const audioElements = new Map<string, HTMLAudioElement>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const audioCleanup = new Map<string, () => void>();
const mediaSources = new Map<string, MediaElementAudioSourceNode>();
let gainContext: AudioContext | null = null;
let speakerGain: GainNode | null = null;
let volumeEvents: EventSource | null = null;
let pushedVolume = false, volumeRevision = 0;
let userPaused = false;
// Synchronized player for the built-in station; direct elements otherwise.
let synced: SyncedSpeakerPlayer | null = null;
let syncedSource: MediaElementAudioSourceNode | null = null;
// Set when this browser proved unable to play through MediaSource.
let syncUnavailable = false;
let snapshot = "";
const playback = new Map<string, {
  time: number; progressedAt: number; attempt: number; status: SpeakerPlaybackStatus; reconnect: () => void;
}>();
let state: State | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let watchdogTimer: ReturnType<typeof setTimeout> | null = null;
let statusRequest: AbortController | null = null;
const listeners = new Set<() => void>();

function notify() {
  const audible = [...audioElements.values()].some(el => !el.paused) || (!!synced && !synced.el.paused);
  const media = globalThis.navigator?.mediaSession;
  if (media && state) {
    try { media.playbackState = userPaused ? "paused" : audible ? "playing" : "none"; } catch { /* Unsupported media session. */ }
  }
  // Watchdogs call this every few seconds. Only wake the interface when
  // something it displays has actually changed.
  const next = JSON.stringify([state?.zoneId, state?.live, state?.volume, state?.sources.length, activeSpeakerPlaybackStatus(), audible]);
  if (next === snapshot) return;
  snapshot = next;
  for (const fn of listeners) fn();
}

// buffered.end() is downloaded audio, not a measured live timestamp. Seeking
// towards it discards the browser's jitter buffer and can repeatedly underrun.
// Let the media element play continuously, including across short network gaps.
function keyFor(src: Source): string { return JSON.stringify([src.relayId, src.url]); }

function setAudioVolume(volume: number) {
  const level = Math.max(0, Math.min(1, volume / 100));
  if (speakerGain) speakerGain.gain.value = level;
  for (const [key, el] of audioElements) el.volume = mediaSources.has(key) ? 1 : level;
  if (synced) synced.el.volume = syncedSource ? 1 : level;
}

function prepareVolumeControl() {
  // Android/Chrome supports native volume. Keep its media element on the native
  // playback path, including lock-screen audio focus and background playback.
  // Only browsers that ignore element volume (notably iOS) need a GainNode.
  if (typeof document === "undefined") return;
  try {
    const probe = document.createElement("audio");
    probe.volume = 0.5;
    if (probe.volume === 0.5) return;
  } catch { return; }
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

async function resolveSource(zoneId: string): Promise<ResolvedSource | null> {
  const request = new AbortController();
  statusRequest = request;
  const timeout = setTimeout(() => request.abort(), STATUS_TIMEOUT_MS);
  try {
    const r = await fetch(`/api/zones/${encodeURIComponent(zoneId)}/current-source`, { cache: "no-store", signal: request.signal });
    if (!r.ok) return null;
    const data = await r.json();
    const vol = typeof data.volume === "number" ? data.volume : 80;
    const continuous = typeof data.speakerUrl === "string" && !!data.speakerUrl;
    // Always this page's own origin: the session cookie is not sent to any
    // other host name the server may know itself by.
    const sources: Source[] =
      continuous
        ? [{ url: `/api/zones/${encodeURIComponent(zoneId)}/speaker-stream` }]
        : Array.isArray(data.sources) && data.sources.length > 0
        ? data.sources
        : data.url
          ? [{ url: data.url }]
          : [];
    return { sources, continuous, upstreamStatus: ["waiting", "buffering", "reconnecting"].includes(data.speakerStatus) ? data.speakerStatus : undefined, live: data.live ?? false, volume: vol, build: typeof data.build === "string" ? data.build : undefined };
  } catch { return null; }
  finally {
    clearTimeout(timeout);
    if (statusRequest === request) statusRequest = null;
  }
}

type AudioBinding = { el: HTMLAudioElement; source?: MediaElementAudioSourceNode };

function removeAudio(key: string, retain = false): AudioBinding | undefined {
  const retry = retryTimers.get(key);
  if (retry) clearTimeout(retry);
  retryTimers.delete(key);
  audioCleanup.get(key)?.();
  audioCleanup.delete(key);
  const source = mediaSources.get(key);
  if (!retain) source?.disconnect();
  mediaSources.delete(key);
  playback.delete(key);
  const el = audioElements.get(key);
  audioElements.delete(key);
  if (!el) return;
  if (retain) return { el, source };
  el.pause();
  el.removeAttribute("src");
  el.load();
}

function releaseSynced() {
  synced?.stop();
  synced = null;
  syncedSource?.disconnect();
  syncedSource = null;
}

function applyState(session: State, next: ResolvedSource | null) {
  // A failed status request is not an explicit instruction to stop the stream.
  // Session identity also rejects late responses after stop/restart of a zone.
  if (state !== session || !next) return;
  const { volume: nextVol } = next;
  session.sources = next.sources;
  session.continuous = next.continuous;
  session.upstreamStatus = next.upstreamStatus;
  session.live = next.live;
  session.volume = nextVol;

  if (synced?.unusable()) {
    // This browser cannot play the stream through MediaSource. Continue with
    // a plain audio element: still continuous, only without the shared clock.
    syncUnavailable = true;
    releaseSynced();
  }
  const useSynced = next.continuous && next.sources.length === 1 && !syncUnavailable && syncedPlaybackSupported();
  if (!useSynced) releaseSynced();
  else if (!synced) {
    const player = new SyncedSpeakerPlayer(next.sources[0].url, TIME_URL, notify, speakerTrimMs());
    synced = player;
    if (gainContext && speakerGain) {
      try { syncedSource = gainContext.createMediaElementSource(player.el); syncedSource.connect(speakerGain); } catch { syncedSource = null; }
    }
    if (userPaused) player.pause();
    player.start();
  }
  const nextSources = useSynced ? [] : next.sources;

  const nextKeys = new Set(nextSources.map(keyFor));
  const missing = [...nextKeys].filter(key => !audioElements.has(key)).length;
  const reusable: AudioBinding[] = [];
  for (const key of new Set([...audioElements.keys(), ...retryTimers.keys()])) {
    if (!nextKeys.has(key)) {
      // Keep the already-authorized element when switching music/news/live.
      // Creating a new player in a locked PWA can lose background playback.
      const binding = removeAudio(key, reusable.length < missing);
      if (binding) reusable.push(binding);
    }
  }

  for (const src of nextSources) {
    const key = keyFor(src);
    if (!audioElements.has(key) && !retryTimers.has(key)) {
      const retained = reusable.shift();
      const el = retained?.el ?? new Audio();
      el.preload = "auto";
      el.crossOrigin = "anonymous";
      el.volume = Math.max(0, Math.min(1, nextVol / 100));
      el.src = src.url;
      if (retained?.source) mediaSources.set(key, retained.source);
      else if (gainContext && speakerGain) {
        try {
          const source = gainContext.createMediaElementSource(el);
          source.connect(speakerGain);
          mediaSources.set(key, source);
          el.volume = 1;
        } catch { /* Retain media-element volume on unsupported browsers. */ }
      }
      const retry = () => {
        if (userPaused || state !== session || audioElements.get(key) !== el || retryTimers.has(key)) return;
        const progress = playback.get(key);
        if (!progress) return;
        progress.status = "reconnecting";
        retryTimers.set(key, setTimeout(() => {
          retryTimers.delete(key);
          if (userPaused || state !== session || audioElements.get(key) !== el) return;
          // Keep the already-authorized media element across server restarts.
          // Invalidate the previous play promise before load() can abort it.
          progress.attempt++;
          progress.time = 0;
          progress.progressedAt = Date.now();
          progress.status = "connecting";
          el.src = src.url;
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
        progress.time = el.currentTime;
        progress.progressedAt = Date.now();
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
      const timeupdate = () => {
        const progress = playback.get(key);
        if (!progress || audioElements.get(key) !== el || el.paused || el.currentTime <= progress.time + 0.01) return;
        progress.time = el.currentTime;
        progress.progressedAt = Date.now();
        progress.status = "playing";
        const timer = retryTimers.get(key);
        if (timer) clearTimeout(timer);
        retryTimers.delete(key);
      };
      el.addEventListener("timeupdate", timeupdate);
      el.addEventListener("playing", playing);
      el.addEventListener("waiting", waiting);
      el.addEventListener("stalled", waiting);
      el.addEventListener("pause", waiting);
      audioCleanup.set(key, () => {
        el.removeEventListener("error", retry);
        el.removeEventListener("ended", retry);
        el.removeEventListener("timeupdate", timeupdate);
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
  reloadForNewBuild(session, next.build);
}

// A deployment replaces the server, not the code of pages already open. A
// speaker therefore reloads itself once per new build; the remembered zone
// resumes on the new page. Not during an announcement or a pause.
function reloadForNewBuild(session: State, build: string | undefined) {
  // Inlined into the page at build time; absent in development and tests. An
  // update check must never break playback where no `process` exists at all.
  let pageBuild: string | undefined;
  try { pageBuild = process.env.NODE_ENV === "production" ? process.env.NEXT_PUBLIC_AHD_BUILD : undefined; } catch { return; }
  if (!pageBuild || !build || build === pageBuild || userPaused || session.live) return;
  try {
    // Never reload in a loop if the reloaded page still reports another build.
    if (sessionStorage.getItem(RELOADED_KEY) === build) return;
    // Without the remembered zone the new page would not resume playback.
    if (sessionStorage.getItem(SELECTION_KEY) !== session.zoneId) return;
    sessionStorage.setItem(RELOADED_KEY, build);
  } catch { return; }
  globalThis.location?.reload();
}

function playAudio(key: string, el: HTMLAudioElement) {
  const current = playback.get(key);
  if (!current || userPaused) return;
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
    if (!progress || userPaused || progress.status === "blocked") continue;
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
  const session: State = { zoneId, sources: [], continuous: false, live: false, volume: 80 };
  state = session;
  userPaused = false;
  setupMediaSession();
  prepareVolumeControl();
  watchVolume(session);
  notify();
  watchPlayback(session);
  await poll(session);
}

// Checks the zone's source now instead of at the next poll, without touching
// the running player. The server-routed stream switches to news on the same
// connection; a direct source is swapped on the already-authorized element.
export function refreshSpeakerMode() {
  const session = state;
  // While a status request is under way, its answer is at most moments away.
  if (!session || !pollTimer) return;
  clearTimeout(pollTimer); pollTimer = null;
  void poll(session);
}

export function stopSpeakerMode() {
  try { sessionStorage.removeItem(SELECTION_KEY); } catch { /* Playback still stops without storage. */ }
  suspendSpeakerMode();
}

export function suspendSpeakerMode() {
  state = null;
  userPaused = false;
  clearMediaSession();
  volumeEvents?.close(); volumeEvents = null;
  pushedVolume = false; volumeRevision++;
  statusRequest?.abort();
  statusRequest = null;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
  for (const key of new Set([...audioElements.keys(), ...retryTimers.keys()])) removeAudio(key);
  releaseSynced();
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

// Timers and requests can be frozen while Android backgrounds a PWA. Recover
// on lifecycle/network events as well, without interrupting healthy playback.
function recoverSpeakerPlayback() {
  if (!state) { void restoreSpeakerMode(); return; }
  if (userPaused) return;
  if (gainContext && gainContext.state !== "running") void gainContext.resume().catch(notify);
  synced?.recover();
  for (const [key, el] of audioElements) {
    const progress = playback.get(key);
    if (!progress) continue;
    if (el.paused && progress.status !== "blocked") {
      progress.progressedAt = Date.now();
      playAudio(key, el);
    } else if (progress.status !== "blocked" && Date.now() - progress.progressedAt >= STALL_TIMEOUT_MS && el.currentTime <= progress.time + 0.01) {
      progress.reconnect();
    }
  }
  // Abort a frozen request; its finally path resumes serialized polling.
  if (statusRequest) statusRequest.abort();
  else {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    void poll(state);
  }
  notify();
}

// Owned by the app layout so route changes do not disable the player lifecycle.
export function attachSpeakerLifecycle(
  target: Pick<Window, "addEventListener" | "removeEventListener">,
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> | undefined = typeof document === "undefined" ? undefined : document,
) {
  const visible = () => { if (doc?.visibilityState === "visible") recoverSpeakerPlayback(); };
  // Mobile pagehide can accompany a suspended/background document. Explicitly
  // tearing down audio here turned a lifecycle transition into an outage.
  // Navigation destroys its resources naturally; pageshow checks recovery.
  target.addEventListener("pageshow", recoverSpeakerPlayback);
  target.addEventListener("online", recoverSpeakerPlayback);
  doc?.addEventListener("visibilitychange", visible);
  doc?.addEventListener("resume", recoverSpeakerPlayback);
  void restoreSpeakerMode();
  return () => {
    target.removeEventListener("pageshow", recoverSpeakerPlayback);
    target.removeEventListener("online", recoverSpeakerPlayback);
    doc?.removeEventListener("visibilitychange", visible);
    doc?.removeEventListener("resume", recoverSpeakerPlayback);
    suspendSpeakerMode();
  };
}

function pauseSpeakerPlayback() {
  if (!state) return;
  userPaused = true;
  for (const timer of retryTimers.values()) clearTimeout(timer);
  retryTimers.clear();
  for (const el of audioElements.values()) el.pause();
  synced?.pause();
  notify();
}

function setupMediaSession() {
  const media = globalThis.navigator?.mediaSession;
  if (!media) return;
  try {
    if (typeof MediaMetadata !== "undefined") media.metadata = new MediaMetadata({ title: "AHD Radio DJ", artist: "Zonen-Lautsprecher", artwork: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }] });
    media.setActionHandler("play", resumeSpeakerPlayback);
    media.setActionHandler("pause", pauseSpeakerPlayback);
    media.setActionHandler("stop", stopSpeakerMode);
  } catch { /* Playback works without lock-screen controls. */ }
}

function clearMediaSession() {
  const media = globalThis.navigator?.mediaSession;
  if (!media) return;
  for (const action of ["play", "pause", "stop"] as const) {
    try { media.setActionHandler(action, null); } catch { /* Unsupported action. */ }
  }
  try { media.playbackState = "none"; media.metadata = null; } catch { /* Unsupported media session. */ }
}

export function activeSpeakerZone() { return state?.zoneId ?? null; }
export function activeSpeakerIsLive() { return state?.live ?? false; }
export function activeSpeakerVolume() { return state?.volume ?? null; }
export function activeSpeakerHasSource() { return (state?.sources.length ?? 0) > 0; }
export function activeSpeakerPlaybackStatus(): SpeakerPlaybackStatus {
  if (!state) return "idle";
  if (userPaused) return "paused";
  if (!state.sources.length) return "waiting";
  if (gainContext?.state === "suspended") return "blocked";
  if (synced) {
    const status = synced.status();
    // The connection also carries silence; the server says what it routes.
    return status === "playing" && state.upstreamStatus ? state.upstreamStatus : status;
  }
  const statuses = [...playback.values()].map(p => p.status);
  if (statuses.includes("blocked")) return "blocked";
  if (retryTimers.size) return "reconnecting";
  if (state.upstreamStatus) return state.upstreamStatus;
  if (statuses.includes("playing")) return "playing";
  if (statuses.includes("buffering")) return "buffering";
  return "connecting";
}

export function resumeSpeakerPlayback() {
  const wasPaused = userPaused;
  userPaused = false;
  if (gainContext) void gainContext.resume().catch(notify);
  synced?.resume();
  for (const [key, el] of audioElements) {
    const progress = playback.get(key);
    if (!progress || (!el.paused && progress.status !== "blocked")) continue;
    const wasBlocked = progress.status === "blocked";
    progress.status = "connecting";
    progress.progressedAt = Date.now();
    // Rejoin live audio instead of replaying what was buffered before.
    if (wasPaused || wasBlocked) { progress.attempt++; progress.time = 0; el.src = JSON.parse(key)[1]; el.load(); }
    playAudio(key, el);
  }
  notify();
}

// Per-device correction for outputs with a delay the browser cannot measure
// (Bluetooth, TVs). Positive values play this device earlier.
export function speakerTrimMs() {
  try {
    const value = Number(localStorage.getItem(TRIM_KEY));
    return Number.isFinite(value) ? Math.max(-1000, Math.min(1000, Math.round(value))) : 0;
  } catch { return 0; }
}

export function setSpeakerTrimMs(value: number) {
  const trim = Math.max(-1000, Math.min(1000, Math.round(value)));
  try { localStorage.setItem(TRIM_KEY, String(trim)); } catch { /* Applies until reload. */ }
  synced?.setTrim(trim);
}

export function activeSpeakerSync() { return synced?.diagnostics() ?? null; }
// Lets support read the synchronization state in the browser console.
if (typeof window !== "undefined") (window as unknown as { __ahdSpeakerSync?: typeof activeSpeakerSync }).__ahdSpeakerSync = activeSpeakerSync;

export function subscribeSpeaker(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
