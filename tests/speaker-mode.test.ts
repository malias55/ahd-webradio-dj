import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startSpeakerMode, stopSpeakerMode, activeSpeakerZone, activeSpeakerHasSource } from "../src/lib/speakerMode";

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  preload = ""; crossOrigin = ""; volume = 1; src = "";
  paused = true; pauses = 0; loads = 0; seeks = 0;
  buffered = { length: 1, start: () => 0, end: () => 60 };
  get currentTime() { return 1; }
  set currentTime(_value: number) { this.seeks++; }
  constructor() { super(); FakeAudio.instances.push(this); }
  async play() { this.paused = false; }
  pause() { this.paused = true; this.pauses++; }
  removeAttribute(name: string) { if (name === "src") this.src = ""; }
  load() { this.loads++; }
}

const originals = { fetch: globalThis.fetch, Audio: globalThis.Audio, setTimeout, clearTimeout, setInterval };
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
  audio.dispatchEvent(new Event("ended")); audio.dispatchEvent(new Event("error"));
  await advance(2000);
  assert.equal(FakeAudio.instances.length, 2);
  audio.dispatchEvent(new Event("error"));
  assert.equal(FakeAudio.instances[1].pauses, 0, "a retired element cannot remove its replacement");
  FakeAudio.instances[1].dispatchEvent(new Event("error"));
  stopSpeakerMode(); await advance(10_000);
  assert.equal(FakeAudio.instances.length, 2); assert.equal(timers.size, 0);
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
});
