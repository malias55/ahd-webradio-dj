"use client";

// Plays a zone's current audio source through this browser's output.
// Preference: active browser-broadcast relay → zone.streamUrl.
// Starts in "waiting" state if nothing is available; polls every few seconds
// so the local player picks up a live broadcast as soon as it starts.

type State = {
  zoneId: string;
  url: string | null;
  live: boolean;
};

let audioEl: HTMLAudioElement | null = null;
let state: State | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function notify() { for (const fn of listeners) fn(); }

function ensureEl() {
  if (audioEl) return audioEl;
  const el = new Audio();
  el.preload = "none";
  el.crossOrigin = "anonymous";
  el.addEventListener("error", () => {
    console.warn("[speaker] audio element error", el.error);
  });
  audioEl = el;
  return el;
}

async function resolveSource(zoneId: string): Promise<{ url: string; live: boolean } | null> {
  try {
    const r = await fetch(`/api/zones/${zoneId}/current-source`, { cache: "no-store" });
    if (!r.ok) return null;
    const data = (await r.json()) as { url: string | null; live: boolean };
    if (!data.url) return null;
    return { url: data.url, live: data.live };
  } catch { return null; }
}

async function swap(zoneId: string, next: { url: string; live: boolean } | null) {
  const el = ensureEl();
  const prevUrl = state?.url ?? null;
  const nextUrl = next?.url ?? null;
  state = { zoneId, url: nextUrl, live: next?.live ?? false };

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
    if (nextUrl !== state.url) await swap(zoneId, current);
    else state.live = current?.live ?? false;
  }, 3000);
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
