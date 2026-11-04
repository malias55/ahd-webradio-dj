import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startSpeakerMode, stopSpeakerMode, activeSpeakerZone, activeSpeakerHasSource, activeSpeakerPlaybackStatus, resumeSpeakerPlayback, restoreSpeakerMode, suspendSpeakerMode, attachSpeakerLifecycle } from "../src/lib/speakerMode";

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  preload = ""; crossOrigin = ""; volume = 1; src = "";
  paused = true; pauses = 0; loads = 0; seeks = 0;
  frozen = false; rejectPlay: Error | null = null;
  createdAt = now;
  buffered = { length: 1, start: () => 0, end: () => 60 };
  get currentTime() { return this.frozen ? 0 : (now - this.createdAt) / 1000; }
  set currentTime(_value: number) { this.seeks++; }
  constructor() { super(); FakeAudio.instances.push(this); }
  async play() { if (this.rejectPlay) throw this.rejectPlay; this.paused = false; }
  pause() { this.paused = true; this.pauses++; }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  load() { this.loads++; this.createdAt = now; this.frozen = false; }
}

const originals = { fetch: globalThis.fetch, Audio: globalThis.Audio, setTimeout, clearTimeout, setInterval, dateNow: Date.now };
const storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const saved = new Map<string, string>();
const timers = new Map<number, { at: number; fn: () => void }>();
let now = 0, seq = 0, calls = 0;
type Reply = (init?: RequestInit) => Promise<Response>;
let reply: Reply;
const source = (url: string | null = "/radio.mp3", volume = 80, relayId?: string) => Response.json({
  sources: url ? [{ url, relayId }] : [], url, volume, live: !!relayId,
});
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function advance(ms: number) {
  const end = now + ms;
  while (true) {
    const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
    if (!due) break;
    now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
  }
  now = end; await flush();
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => {
  now = 0; seq = 0; calls = 0; timers.clear(); FakeAudio.instances = [];
  Date.now = () => now;
  saved.clear();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  } });
  reply = async () => source();
  globalThis.Audio = FakeAudio as unknown as typeof Audio;
  globalThis.fetch = async (_url, init) => { calls++; return reply(init); };
  globalThis.setTimeout = ((fn: () => void, ms = 0) => {
    const id = ++seq; timers.set(id, { at: now + ms, fn }); return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: number) => { timers.delete(id); }) as unknown as typeof clearTimeout;
  globalThis.setInterval = (() => { throw new Error("speaker must not poll or seek with overlapping intervals"); }) as unknown as typeof setInterval;
});
afterEach(() => {
  stopSpeakerMode();
  globalThis.fetch = originals.fetch; globalThis.Audio = originals.Audio;
  globalThis.setTimeout = originals.setTimeout; globalThis.clearTimeout = originals.clearTimeout;
  globalThis.setInterval = originals.setInterval;
  Date.now = originals.dateNow;
  if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

test("continuous MP3 playback retains its jitter buffer through repeated polling", async () => {
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0];
  await advance(40_000);
  assert.equal(calls, 21);
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(audio.seeks, 0, "downloaded buffer is not a live-edge clock");
  assert.equal(audio.pauses, 0); assert.equal(audio.loads, 0);
  assert.equal(audio.preload, "auto");
});

test("HTTP, JSON and network status failures preserve a healthy audio connection", async () => {
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0];
  for (const failure of [
    async () => new Response("unavailable", { status: 503 }),
    async () => new Response("bad json"),
    async () => { throw new TypeError("network down"); },
  ]) {
    reply = failure; await advance(2000);
    assert.equal(audio.pauses, 0); assert.equal(activeSpeakerHasSource(), true);
  }
  reply = async () => source("/radio.mp3", 35);
  await advance(2000);
  assert.equal(FakeAudio.instances.length, 1); assert.equal(audio.volume, 0.35);
});

test("an explicit empty source stops playback and cancels reconnects", async () => {
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0];
  audio.dispatchEvent(new Event("error"));
  reply = async () => source(null);
  await advance(10_000);
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(activeSpeakerHasSource(), false);
});

test("ended/error reconnect only once and stop removes all delayed work", async () => {
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0];
  audio.frozen = true;
  audio.dispatchEvent(new Event("ended")); audio.dispatchEvent(new Event("error"));
  await advance(2000);
  assert.equal(FakeAudio.instances.length, 1, "reconnect retains the authorized media element");
  assert.equal(audio.loads, 1);
  audio.frozen = true; audio.dispatchEvent(new Event("error"));
  stopSpeakerMode(); await advance(10_000);
  assert.equal(FakeAudio.instances.length, 1); assert.equal(timers.size, 0);
});

test("slow status requests stay serialized and repeated start is idempotent", async () => {
  const pending = deferred<Response>();
  reply = () => pending.promise;
  const starting = startSpeakerMode("showroom");
  await startSpeakerMode("showroom"); await advance(4000);
  assert.equal(calls, 1);
  pending.resolve(source()); await starting;
  reply = async () => source();
  await advance(2000); assert.equal(calls, 2);
});

test("late responses from the same zone's previous session cannot replace current audio", async () => {
  const old = deferred<Response>(); reply = () => old.promise;
  const first = startSpeakerMode("showroom");
  stopSpeakerMode(); reply = async () => source("/new.mp3");
  await startSpeakerMode("showroom");
  old.resolve(source("/old.mp3")); await first;
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(FakeAudio.instances[0].src, "/new.mp3");
  await advance(2000); assert.equal(calls, 3, "only the current session polls");
});

test("a status timeout keeps audio playing and polling recovers", async () => {
  await startSpeakerMode("showroom");
  reply = init => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
  });
  await advance(7000);
  assert.equal(calls, 2); assert.equal(FakeAudio.instances[0].pauses, 0);
  reply = async () => source(); await advance(2000);
  assert.equal(calls, 3); assert.equal(FakeAudio.instances.length, 1);
});

test("a changed URL replaces a relay even if its relay ID stays the same", async () => {
  reply = async () => source("/first.mp3", 80, "relay");
  await startSpeakerMode("showroom");
  reply = async () => source("/second.mp3", 80, "relay");
  await advance(2000);
  assert.equal(FakeAudio.instances.length, 2);
  assert.equal(FakeAudio.instances[0].pauses, 1);
  assert.equal(FakeAudio.instances[1].src, "/second.mp3");
  assert.equal(activeSpeakerZone(), "showroom");
  FakeAudio.instances[0].dispatchEvent(new Event("error"));
  assert.equal(FakeAudio.instances[1].pauses, 0, "a retired element cannot remove its replacement");
});

test("an open connection with no media progress reconnects without error or ended events", async () => {
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0]; audio.frozen = true;
  await advance(14_000);
  assert.equal(FakeAudio.instances.length, 1, "short buffering gaps retain the existing player");
  await advance(2000);
  assert.equal(activeSpeakerPlaybackStatus(), "reconnecting");
  await advance(2000);
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(audio.loads, 1);
  await advance(2000);
  assert.equal(activeSpeakerPlaybackStatus(), "playing");
  stopSpeakerMode(); await advance(30_000);
  assert.equal(timers.size, 0, "stopped playback cannot be resurrected by the watchdog");
});

test("brief buffering during a server update preserves audio and resumes without a reconnect", async () => {
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0];
  await advance(4000); audio.frozen = true;
  audio.dispatchEvent(new Event("waiting"));
  assert.equal(activeSpeakerPlaybackStatus(), "buffering");
  reply = async () => new Response("restarting", { status: 503 });
  await advance(8000);
  assert.equal(audio.pauses, 0);
  audio.frozen = false; reply = async () => source();
  await advance(4000);
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(activeSpeakerPlaybackStatus(), "playing");
});

test("autoplay refusal is visible, does not retry in a loop and can be resumed by a user gesture", async () => {
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0];
  audio.frozen = true;
  audio.dispatchEvent(new Event("ended"));
  // Refuse the next play attempt as a browser can do after a deployment.
  const nativePlay = FakeAudio.prototype.play;
  FakeAudio.prototype.play = async function () { throw new DOMException("gesture required", "NotAllowedError"); };
  try {
    await advance(2000);
    assert.equal(activeSpeakerPlaybackStatus(), "blocked");
    await advance(40_000);
    assert.equal(FakeAudio.instances.length, 1, "timers cannot bypass browser autoplay policy");
  } finally { FakeAudio.prototype.play = nativePlay; }
  resumeSpeakerPlayback(); await flush(); await advance(2000);
  assert.equal(activeSpeakerPlaybackStatus(), "playing");
  assert.equal(FakeAudio.instances.length, 1);
});

test("page exit remembers the selected zone, while an explicit stop prevents restoration", async () => {
  const page = new EventTarget();
  const detach = attachSpeakerLifecycle(page as unknown as Window);
  await startSpeakerMode("showroom");
  assert.equal(saved.get("ahd:speaker-zone:v1"), "showroom");
  page.dispatchEvent(new Event("pagehide"));
  assert.equal(activeSpeakerZone(), null);
  assert.equal(timers.size, 0);
  assert.equal(saved.get("ahd:speaker-zone:v1"), "showroom");
  page.dispatchEvent(new Event("pageshow")); await flush();
  assert.equal(activeSpeakerZone(), "showroom");
  assert.equal(FakeAudio.instances.length, 2);
  stopSpeakerMode();
  page.dispatchEvent(new Event("pageshow")); await restoreSpeakerMode();
  assert.equal(activeSpeakerZone(), null);
  assert.equal(saved.size, 0);
  detach();
});

test("restoration stays idempotent during a slow source request", async () => {
  await startSpeakerMode("showroom"); suspendSpeakerMode();
  const pending = deferred<Response>(); reply = () => pending.promise;
  const restoring = restoreSpeakerMode();
  await restoreSpeakerMode();
  assert.equal(calls, 2);
  pending.resolve(source()); await restoring;
  assert.equal(FakeAudio.instances.length, 2);
});

test("unavailable session storage does not prevent starting or stopping playback", async () => {
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, get: () => { throw new Error("storage disabled"); } });
  await startSpeakerMode("showroom");
  assert.equal(activeSpeakerZone(), "showroom");
  stopSpeakerMode(); await restoreSpeakerMode();
  assert.equal(activeSpeakerZone(), null);
});

test("a late rejection from the previous play attempt cannot restart a recovered element", async () => {
  const nativePlay = FakeAudio.prototype.play;
  let reject!: (error: Error) => void;
  FakeAudio.prototype.play = () => new Promise<void>((_resolve, r) => { reject = r; });
  try { await startSpeakerMode("showroom"); } finally { FakeAudio.prototype.play = nativePlay; }
  const audio = FakeAudio.instances[0]; audio.frozen = true;
  audio.dispatchEvent(new Event("ended")); await advance(2000);
  reject(new DOMException("previous request aborted by load", "AbortError")); await flush();
  await advance(4000);
  assert.equal(audio.loads, 1);
  assert.equal(activeSpeakerPlaybackStatus(), "playing");
});
