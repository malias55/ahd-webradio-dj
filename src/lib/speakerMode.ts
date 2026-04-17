"use client";

// Plays a zone's current audio source through this browser's output.
// Priority: active Durchsage > Tab-Audio > zone.streamUrl. Applies the
// zone's master volume so the slider affects all listeners consistently.

type State = {
  zoneId: string;
  url: string | null;
  live: boolean;
  volume: number; // 0-100
};

let audioEl: HTMLAudioElement | null = null;
let state: State | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

async function recover() {
  if (!state) return;
  const next = await resolveSource(state.zoneId);
  await swap(state.zoneId, next);
}

function ensureEl() {
  if (audioEl) return audioEl;
  const el = new Audio();
  el.preload = "none";
  el.crossOrigin = "anonymous";
  el.addEventListener("error", () => { recover(); });
  el.addEventListener("ended", () => { recover(); });
  audioEl = el;
  return el;
}

async function resolveSource(
  zoneId: string,
): Promise<{ url: string; live: boolean; volume: number } | null> {
  try {
    const r = await fetch(`/api/zones/${zoneId}/current-source`, { cache: "no-store" });
    if (!r.ok) return null;
    const data = (await r.json()) as { url: string | null; live: boolean; volume?: number };
    const vol = typeof data.volume === "number" ? data.volume : 80;
    if (!data.url) return null;
    return { url: data.url, live: data.live, volume: vol };
  } catch { return null; }
}

async function swap(
  zoneId: string,
  next: { url: string; live: boolean; volume: number } | null,
) {
  const el = ensureEl();
  const prevUrl = state?.url ?? null;
  const nextUrl = next?.url ?? null;
  const nextVol = next?.volume ?? state?.volume ?? 80;

  state = { zoneId, url: nextUrl, live: next?.live ?? false, volume: nextVol };

  // Apply zone volume to the local element (0..1).
  el.volume = Math.max(0, Math.min(1, nextVol / 100));

  if (prevUrl !== nextUrl) {
    if (nextUrl) {
      el.src = nextUrl;
      try { await el.play(); }
      catch (e) { console.warn("[speaker] play failed", e); }
    } else {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
  }
  notify();
}

export async function startSpeakerMode(zoneId: string) {
  if (state && state.zoneId !== zoneId) stopSpeakerMode();
  ensureEl();

  const initial = await resolveSource(zoneId);
  await swap(zoneId, initial);

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!state || state.zoneId !== zoneId) return;
    const current = await resolveSource(zoneId);
    const nextUrl = current?.url ?? null;
    const nextVol = current?.volume ?? state.volume;
    if (nextUrl !== state.url) {
      await swap(zoneId, current);
    } else {
      // URL unchanged — apply live + volume updates.
      state.live = current?.live ?? state.live;
      if (nextVol !== state.volume) {
        state.volume = nextVol;
        if (audioEl) audioEl.volume = Math.max(0, Math.min(1, nextVol / 100));
      }
      notify();
    }
  }, 2500);
}

export function stopSpeakerMode() {
  if (audioEl) {
    audioEl.pause();
    audioEl.removeAttribute("src");
    audioEl.load();
  }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  state = null;
  notify();
}

export function activeSpeakerZone() { return state?.zoneId ?? null; }
export function activeSpeakerIsLive() { return state?.live ?? false; }
export function activeSpeakerHasSource() { return !!state?.url; }

export function subscribeSpeaker(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
