"use client";

type Source = { url: string; relayId?: string; kind?: string };

type State = {
  zoneId: string;
  sources: Source[];
  live: boolean;
  volume: number;
};

const audioElements = new Map<string, HTMLAudioElement>();
let state: State | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

function keyFor(src: Source): string { return src.relayId || src.url; }

async function resolveSource(
  zoneId: string,
): Promise<{ sources: Source[]; live: boolean; volume: number } | null> {
  try {
    const r = await fetch(`/api/zones/${zoneId}/current-source`, { cache: "no-store" });
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
}

function sourcesChanged(a: Source[], b: Source[]): boolean {
  if (a.length !== b.length) return true;
  const aKeys = new Set(a.map(keyFor));
  for (const s of b) if (!aKeys.has(keyFor(s))) return true;
  return false;
}

async function applyState(
  zoneId: string,
  next: { sources: Source[]; live: boolean; volume: number } | null,
) {
  if (!state || state.zoneId !== zoneId) return;

  const nextSources = next?.sources ?? [];
  const nextVol = next?.volume ?? state.volume;

  if (sourcesChanged(state.sources, nextSources)) {
    state.sources = nextSources;
    state.live = next?.live ?? false;
    state.volume = nextVol;

    const nextKeys = new Set(nextSources.map(keyFor));
    for (const [key, el] of audioElements) {
      if (!nextKeys.has(key)) {
        el.pause();
        el.removeAttribute("src");
        el.load();
        audioElements.delete(key);
      }
    }

    for (const src of nextSources) {
      const key = keyFor(src);
      if (!audioElements.has(key)) {
        const el = new Audio();
        el.preload = "none";
        el.crossOrigin = "anonymous";
        el.volume = Math.max(0, Math.min(1, nextVol / 100));
        el.src = src.url;
        el.addEventListener("error", () => recover());
        el.addEventListener("ended", () => recover());
        audioElements.set(key, el);
        try { await el.play(); } catch (e) { console.warn("[speaker] play failed", src.url, e); }
      }
    }
  } else {
    state.live = next?.live ?? state.live;
    state.volume = nextVol;
  }

  for (const el of audioElements.values()) {
    el.volume = Math.max(0, Math.min(1, nextVol / 100));
  }
  notify();
}

async function recover() {
  if (!state) return;
  const next = await resolveSource(state.zoneId);
  await applyState(state.zoneId, next);
}

export async function startSpeakerMode(zoneId: string) {
  if (state && state.zoneId !== zoneId) stopSpeakerMode();

  state = { zoneId, sources: [], live: false, volume: 80 };

  const initial = await resolveSource(zoneId);
  await applyState(zoneId, initial);

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!state || state.zoneId !== zoneId) return;
    const current = await resolveSource(zoneId);
    await applyState(zoneId, current);
  }, 2500);
}

export function stopSpeakerMode() {
  for (const el of audioElements.values()) {
    el.pause();
    el.removeAttribute("src");
    el.load();
  }
  audioElements.clear();
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  state = null;
  notify();
}

export function activeSpeakerZone() { return state?.zoneId ?? null; }
export function activeSpeakerIsLive() { return state?.live ?? false; }
export function activeSpeakerHasSource() { return (state?.sources.length ?? 0) > 0; }

export function subscribeSpeaker(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
