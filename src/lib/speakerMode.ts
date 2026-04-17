"use client";

// Plays a zone's native stream URL through this browser's audio output.
// Only one zone can be active at a time.

let audioEl: HTMLAudioElement | null = null;
let activeZoneId: string | null = null;
const listeners = new Set<() => void>();

function ensureEl() {
  if (audioEl) return audioEl;
  const el = new Audio();
  el.preload = "none";
  el.crossOrigin = "anonymous";
  el.addEventListener("ended", () => { activeZoneId = null; notify(); });
  el.addEventListener("error", () => { activeZoneId = null; notify(); });
  audioEl = el;
  return el;
}

function notify() { for (const fn of listeners) fn(); }

export async function startSpeakerMode(zoneId: string, url: string) {
  const el = ensureEl();
  if (activeZoneId && activeZoneId !== zoneId) stopSpeakerMode();
  el.src = url;
  el.volume = 1;
  await el.play();
  activeZoneId = zoneId;
  notify();
}

export function stopSpeakerMode() {
  if (!audioEl) return;
  audioEl.pause();
  audioEl.removeAttribute("src");
  audioEl.load();
  activeZoneId = null;
  notify();
}

export function activeSpeakerZone() { return activeZoneId; }

export function subscribeSpeaker(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
