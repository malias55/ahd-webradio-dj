import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startSpeakerMode, stopSpeakerMode, refreshSpeakerMode, activeSpeakerZone, activeSpeakerHasSource, activeSpeakerPlaybackStatus, resumeSpeakerPlayback, restoreSpeakerMode, suspendSpeakerMode, attachSpeakerLifecycle } from "../src/lib/speakerMode";

class FakeAudio extends EventTarget {
  static instances: FakeAudio[] = [];
  preload = ""; crossOrigin = ""; volume = 1; src = "";
  paused = true; pauses = 0; loads = 0; seeks = 0; playbackRate = 1; seeking = false;
  seekable = { length: 1, start: () => 0, end: () => 60 };
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

test("a changed URL reuses the authorized player even if its relay ID stays the same", async () => {
  reply = async () => source("/first.mp3", 80, "relay");
  await startSpeakerMode("showroom");
  reply = async () => source("/second.mp3", 80, "relay");
  await advance(2000);
  assert.equal(FakeAudio.instances.length, 1);
  assert.equal(FakeAudio.instances[0].pauses, 0);
  assert.equal(FakeAudio.instances[0].src, "/second.mp3");
  assert.equal(activeSpeakerZone(), "showroom");

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

test("pagehide preserves mobile playback, while an explicit stop prevents restoration", async () => {
  const page = new EventTarget();
  const detach = attachSpeakerLifecycle(page as unknown as Window);
  await startSpeakerMode("showroom");
  assert.equal(saved.get("ahd:speaker-zone:v1"), "showroom");
  page.dispatchEvent(new Event("pagehide"));
  assert.equal(activeSpeakerZone(), "showroom");
  assert.equal(FakeAudio.instances[0].pauses, 0);
  assert.equal(saved.get("ahd:speaker-zone:v1"), "showroom");
  page.dispatchEvent(new Event("pageshow")); await flush();
  assert.equal(activeSpeakerZone(), "showroom");
  assert.equal(FakeAudio.instances.length, 1);
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


test("visibility/online/resume recover paused playback without replacing it or seeking", async () => {
  const page = new EventTarget();
  const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
  const detach = attachSpeakerLifecycle(page as unknown as Window, doc);
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0];
  doc.visibilityState = "hidden"; doc.dispatchEvent(new Event("visibilitychange"));
  assert.equal(audio.pauses, 0, "locking the screen must never stop the player");
  // Model suspended JavaScript: no timers execute while the clock advances.
  audio.paused = true; now += 60_000;
  doc.visibilityState = "visible"; doc.dispatchEvent(new Event("visibilitychange")); await flush();
  assert.equal(audio.paused, false);
  assert.equal(audio.loads, 0); assert.equal(audio.seeks, 0);
  audio.paused = true; page.dispatchEvent(new Event("online")); await flush();
  assert.equal(audio.paused, false);
  audio.paused = true; doc.dispatchEvent(new Event("resume")); await flush();
  assert.equal(audio.paused, false); assert.equal(FakeAudio.instances.length, 1);
  stopSpeakerMode(); doc.dispatchEvent(new Event("resume")); await flush();
  assert.equal(activeSpeakerZone(), null);
  detach();
});

test("media-session pause is respected across news changes and resumes from lock-screen play", async t => {
  const handlers = new Map<string, (()=>void) | null>();
  const media = { playbackState: "none", metadata: null, setActionHandler: (name:string, fn:(()=>void)|null) => handlers.set(name,fn) };
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis,"navigator",{configurable:true,value:{mediaSession:media}});
  try {
    await startSpeakerMode("showroom");
    const audio = FakeAudio.instances[0];
    audio.dispatchEvent(new Event("playing"));assert.equal(media.playbackState,"playing");
    handlers.get("pause")!();
    assert.equal(activeSpeakerPlaybackStatus(),"paused");assert.equal(media.playbackState,"paused");
    reply=async()=>source("/news.mp3");await advance(30_000);
    assert.equal(audio.paused,true);assert.equal(audio.src,"/news.mp3");assert.equal(audio.loads,0);
    handlers.get("play")!();await flush();assert.equal(audio.paused,false);
    assert.equal(audio.loads,1,"explicit resume rejoins live audio instead of replaying an old buffer");
    handlers.get("stop")!();await advance(5000);
    assert.equal(activeSpeakerZone(),null);assert.equal(media.playbackState,"none");
    assert.equal(handlers.get("play"),null);assert.equal(timers.size,0);
  } finally {
    stopSpeakerMode();
    if(descriptor)Object.defineProperty(globalThis,"navigator",descriptor);else Reflect.deleteProperty(globalThis,"navigator");
  }
});


test("a continuous zone stream never changes the browser source for news, live audio or scheduled silence", async () => {
  const speakerUrl = "/api/zones/showroom/speaker-stream";
  reply = async () => Response.json({url:"/music.mp3",speakerUrl,volume:70});
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0];
  const connectionUrl = audio.src;
  assert.equal(connectionUrl, speakerUrl);
  for (const url of ["/news.mp3", "/live?r=1", null, "/music.mp3"]) {
    reply = async () => Response.json({url,speakerUrl,sources:url?[{url}]:[],live:url?.includes("live"),volume:70});
    await advance(4000);
    assert.equal(audio.src,connectionUrl);
    assert.equal(FakeAudio.instances.length,1);
    assert.equal(audio.pauses,0);assert.equal(audio.loads,0);
  }
});


test("a silent but connected zone reports upstream failure instead of pretending the programme is playing", async () => {
  const speakerUrl = "/api/zones/showroom/speaker-stream";
  reply = async () => Response.json({speakerUrl, speakerStatus: "buffering", volume: 70});
  await startSpeakerMode("showroom");await advance(4000);
  assert.equal(activeSpeakerPlaybackStatus(),"buffering");
  reply = async () => Response.json({speakerUrl, speakerStatus: "waiting", volume: 70});await advance(4000);
  assert.equal(activeSpeakerPlaybackStatus(),"waiting");
  reply = async () => Response.json({speakerUrl, speakerStatus: "playing", volume: 70});await advance(4000);
  assert.equal(activeSpeakerPlaybackStatus(),"playing");
  assert.equal(FakeAudio.instances.length,1);assert.equal(FakeAudio.instances[0].loads,0);
});


test("the built-in station uses the synchronized player on this page's own origin and falls back when it cannot play", async () => {
  class FakeBuffer extends EventTarget { updating = false; mode = ""; timestampOffset = 0; buffered = { length: 0 }; abort() {} remove() {} appendBuffer() {} }
  class FakeMediaSource extends EventTarget {
    static isTypeSupported = (type: string) => type === "audio/mpeg";
    readyState = "open";
    addSourceBuffer() { return new FakeBuffer(); }
  }
  const scope = globalThis as unknown as { MediaSource?: unknown };
  const createObjectURL = URL.createObjectURL, revokeObjectURL = URL.revokeObjectURL;
  let media: FakeMediaSource | undefined;
  URL.createObjectURL = ((source: FakeMediaSource) => { media = source; return "blob:speaker"; }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = () => {};
  scope.MediaSource = FakeMediaSource;
  const urls: string[] = [];
  const statusFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    urls.push(url);
    if (url === "/api/speaker-time") return Response.json({ instance: "one", now: now });
    if (url.endsWith("/speaker-stream")) return new Response("unavailable", { status: 503 });
    return statusFetch(url, init);
  }) as typeof fetch;
  try {
    // The server may know itself by another host name; the cookie belongs to this origin.
    reply = async () => Response.json({ speakerUrl: "https://internal.example/api/zones/showroom/speaker-stream", volume: 40 });
    await startSpeakerMode("showroom");
    const audio = FakeAudio.instances[0];
    audio.frozen = true; // No audio arrives, so the media clock cannot advance.
    assert.equal(audio.src, "blob:speaker"); assert.equal(audio.volume, 0.4);
    media!.dispatchEvent(new Event("sourceopen"));
    await advance(3000);
    assert.ok(urls.includes("/api/zones/showroom/speaker-stream"));
    assert.ok(urls.includes("/api/speaker-time"));
    assert.ok(!urls.some(url => url.includes("internal.example")));
    assert.equal(activeSpeakerPlaybackStatus(), "reconnecting", "an unreachable stream is never reported as playing");
    assert.equal(FakeAudio.instances.length, 1);
    stopSpeakerMode(); await advance(30_000);
    assert.equal(timers.size, 0, "stop ends every timer of the synchronized player");
    // A browser whose media pipeline keeps failing continues with a plain element.
    await startSpeakerMode("showroom");
    FakeAudio.instances.at(-1)!.frozen = true;
    for (let i = 0; i < 6; i++) { FakeAudio.instances.at(-1)!.dispatchEvent(new Event("error")); await advance(2500); }
    const fallback = FakeAudio.instances.at(-1)!;
    assert.equal(fallback.src, "/api/zones/showroom/speaker-stream");
    assert.equal(activeSpeakerPlaybackStatus(), "playing");
  } finally {
    stopSpeakerMode();
    globalThis.fetch = statusFetch; URL.createObjectURL = createObjectURL; URL.revokeObjectURL = revokeObjectURL;
    Reflect.deleteProperty(scope, "MediaSource");
  }
});

test("starting news on the speaking device switches the source on the running player", async () => {
  await startSpeakerMode("showroom");
  const audio = FakeAudio.instances[0];
  assert.equal(audio.src, "/radio.mp3"); assert.equal(audio.paused, false);
  reply = async () => source("/news.mp3");
  const before = calls;
  refreshSpeakerMode(); await flush();
  assert.equal(calls, before + 1, "the source is checked at once, not at the next poll");
  assert.equal(FakeAudio.instances.length, 1, "no new audio element");
  assert.equal(audio.src, "/news.mp3");
  assert.equal(audio.paused, false);
  assert.equal(activeSpeakerZone(), "showroom");
  await advance(2000); assert.equal(calls, before + 2, "polling continues on one schedule");
});

test("a speaker reloads once onto a newly deployed build and never in a loop", async () => {
  const env = { mode: process.env.NODE_ENV, build: process.env.NEXT_PUBLIC_AHD_BUILD };
  let reloads = 0;
  Object.defineProperty(globalThis, "location", { configurable: true, value: { reload: () => { reloads++; } } });
  Object.assign(process.env, { NODE_ENV: "production", NEXT_PUBLIC_AHD_BUILD: "build-a" });
  try {
    let build = "build-a", live = false;
    reply = async () => Response.json({ sources: [{ url: "/radio.mp3" }], url: "/radio.mp3", volume: 80, live, build });
    await startSpeakerMode("showroom");
    await advance(4000);
    assert.equal(reloads, 0, "same build: no reload");

    build = "build-b"; live = true;
    await advance(2000);
    assert.equal(reloads, 0, "an announcement is never cut by an update");

    live = false;
    await advance(2000);
    assert.equal(reloads, 1, "new build: reload once");
    await advance(10_000);
    assert.equal(reloads, 1, "the same new build never triggers another reload");
  } finally {
    (process.env as Record<string, string | undefined>).NODE_ENV = env.mode;
    if (env.build === undefined) delete process.env.NEXT_PUBLIC_AHD_BUILD; else process.env.NEXT_PUBLIC_AHD_BUILD = env.build;
    Reflect.deleteProperty(globalThis, "location");
  }
});
