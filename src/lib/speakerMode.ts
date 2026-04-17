"use client";

// Plays a zone's current audio source through this browser's output.
// Preference: active browser-broadcast relay → zone.streamUrl.
// Polls the resolver every few seconds so the player follows live/off transitions.

type State = {
  zoneId: string;
  url: string;
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
    // Leave state intact so the UI still shows the zone; the next poll may recover.
    console.warn("[speaker] audio element error", el.error);
  });
  audioEl = el;
  return el;
}

async function resolveSource(zoneId: string): Promise<{ url: string; live: boolean } | null> {
  const r = await fetch(`/api/zones/${zoneId}/current-source`, { cache: "no-store" });
  if (!r.ok) return null;
  const data = (await r.json()) as { url: string | null; live: boolean };
  if (!data.url) return null;
  return { url: data.url, live: data.live };
}

async function swap(zoneId: string, next: { url: string; live: boolean }) {
  const el = ensureEl();
  const changed = !state || state.url !== next.url;
  state = { zoneId, url: next.url, live: next.live };
  if (changed) {
    el.src = next.url;
    try { await el.play(); }
    catch (e) { console.warn("[speaker] play failed", e); }
  }
  notify();
}

export async function startSpeakerMode(zoneId: string) {
  if (state && state.zoneId !== zoneId) stopSpeakerMode();

  const initial = await resolveSource(zoneId);
  if (!initial) {
    throw new Error("Keine aktive Quelle — weder Live-Stream noch Zonen-URL erreichbar.");
  }
  await swap(zoneId, initial);

  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    if (!state || state.zoneId !== zoneId) return;
    try {
      const current = await resolveSource(zoneId);
      if (current && current.url !== state.url) await swap(zoneId, current);
    } catch { /* ignore poll error */ }
  }, 4000);
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

export function subscribeSpeaker(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
