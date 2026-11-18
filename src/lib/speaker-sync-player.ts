"use client";

import { MP3_FRAME_SECONDS, SEEK_THRESHOLD_SECONDS, ServerClock, correctionRate, parseSpeakerTimeline, playoutPosition, type SpeakerTimeline } from "./speaker-sync";

// Synchronized speaker playback.
//
// The zone stream is fetched by script and appended to a MediaSource, so this
// player owns the audio buffer instead of the browser's opaque progressive
// download logic. It knows which server frame sits at which media position and
// keeps the element on the shared playout clock: a seek for large deviations
// (start, reconnect, underrun), a barely different playback rate for drift.
//
// Everything is self-healing. A lost or silent connection is reopened
// indefinitely, a media pipeline that stops is rebuilt on the same element,
// and none of it requires a new user gesture.

export type SyncedStatus = "connecting" | "buffering" | "playing" | "reconnecting" | "blocked" | "unauthorized";

type Op = { kind: "segment"; timeline: SpeakerTimeline | null } | { kind: "append"; data: Uint8Array } | { kind: "remove"; end: number };
type SourceCtor = { new(): MediaSource; isTypeSupported(type: string): boolean };

const MIME = "audio/mpeg";
const TICK_MS = 250;
const STREAM_SILENT_MS = 6000;
const SEGMENT_GAP_SECONDS = 1;
const MIN_SEEK_INTERVAL_MS = 1500;
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;

function sourceCtor(): SourceCtor | undefined {
  const scope = globalThis as unknown as { ManagedMediaSource?: SourceCtor; MediaSource?: SourceCtor };
  return scope.ManagedMediaSource ?? scope.MediaSource;
}

export function syncedPlaybackSupported() {
  try {
    const Source = sourceCtor();
    return !!Source && Source.isTypeSupported(MIME) && typeof ReadableStream !== "undefined" && typeof AbortController !== "undefined";
  } catch { return false; }
}

export class SyncedSpeakerPlayer {
  readonly el: HTMLAudioElement;
  private stopped = false;
  private userPaused = false;
  private blocked = false;
  private unauthorized = false;
  private generation = 0;
  private media?: MediaSource;
  private buffer?: SourceBuffer;
  private objectUrl?: string;
  private ops: Op[] = [];
  private queuedBytes = 0;
  private request?: AbortController;
  private connected = false;
  private everConnected = false;
  private retryTimer?: ReturnType<typeof setTimeout>;
  private retryDelay = 500;
  private timeline: SpeakerTimeline | null = null;
  private segmentStart = 0;
  private appendedEnd = 0;
  private readonly clock = new ServerClock();
  private sampling = false;
  private nextClockAt = 0;
  private tickTimer?: ReturnType<typeof setTimeout>;
  private rebuildTimer?: ReturnType<typeof setTimeout>;
  private startedAt = performance.now();
  private lastChunkAt = 0;
  private lastTime = 0;
  private lastProgressAt = -Infinity;
  private everPlayed = false;
  private lastPlayAttemptAt = -Infinity;
  private playAttempt = 0;
  private lastSeekAt = -Infinity;
  private seekSettledAt = Infinity;
  private seekLead = 0.08;
  private calibrateSeek = false;
  private consecutiveSeeks = 0;
  private steadySince = 0;
  private smoothedError = 0;
  private correcting = false;
  private lastErrorMs: number | null = null;
  private lastTrimAt = 0;
  private lastRebuildAt = -Infinity;
  private pipelineOpenedAt = 0;
  private failedRebuilds = 0;
  private reported: SyncedStatus = "connecting";
  private counters = { connections: 0, seeks: 0, rebuilds: 0, underruns: 0 };
  private readonly cleanup: (() => void)[] = [];

  constructor(
    private readonly streamUrl: string,
    private readonly timeUrl: string,
    private readonly onChange: () => void,
    private trimMs = 0,
    el?: HTMLAudioElement,
  ) {
    this.el = el ?? new Audio();
    this.el.preload = "auto";
    // A plain resample is inaudible at these rates; pitch-preserving time
    // stretching is what makes small rate corrections sound like a stutter.
    const pitch = this.el as unknown as Record<string, boolean>;
    for (const key of ["preservesPitch", "mozPreservesPitch", "webkitPreservesPitch"]) { try { pitch[key] = false; } catch { /* Unsupported. */ } }
    const listen = (event: string, fn: () => void) => { this.el.addEventListener(event, fn); this.cleanup.push(() => this.el.removeEventListener(event, fn)); };
    listen("error", () => this.scheduleRebuild());
    listen("seeked", () => { this.seekSettledAt = performance.now(); });
    listen("waiting", () => { if (this.everPlayed) this.counters.underruns++; this.report(); });
    for (const event of ["playing", "pause", "stalled"]) listen(event, () => this.report());
  }

  start() {
    if (this.stopped) return;
    this.openPipeline();
    this.tick();
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.generation++;
    for (const timer of [this.tickTimer, this.retryTimer, this.rebuildTimer]) if (timer) clearTimeout(timer);
    this.tickTimer = this.retryTimer = this.rebuildTimer = undefined;
    this.closeConnection();
    for (const fn of this.cleanup) fn();
    this.ops = [];
    try { this.el.pause(); this.el.removeAttribute("src"); this.el.load(); } catch { /* Element already released. */ }
    if (this.objectUrl) { try { URL.revokeObjectURL(this.objectUrl); } catch { /* Ignored. */ } }
    this.objectUrl = undefined; this.media = undefined; this.buffer = undefined;
  }

  pause() {
    if (this.stopped) return;
    this.userPaused = true;
    // A paused speaker must not keep downloading the programme.
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
    this.closeConnection();
    try { this.el.pause(); } catch { /* Ignored. */ }
    this.report();
  }

  // Called from a user gesture (button, lock screen) and from recovery events.
  resume() {
    if (this.stopped) return;
    this.userPaused = false;
    this.blocked = false;
    // Time spent waiting for the user says nothing about this browser's ability to play.
    this.startedAt = performance.now();
    this.recover();
    this.play();
    this.report();
  }

  // Timers may have been frozen in the background. Check everything now.
  recover() {
    if (this.stopped || this.userPaused) return;
    const now = performance.now();
    if (!this.media || this.media.readyState === "closed" || this.el.error) { this.rebuild(); return; }
    if (this.connected && now - this.lastChunkAt > STREAM_SILENT_MS) this.closeConnection();
    if (!this.request && !this.blocked) this.reconnect(0);
    this.nextClockAt = 0;
    if (this.el.paused && !this.blocked) this.play();
  }

  setTrim(trimMs: number) { this.trimMs = trimMs; }

  status(): SyncedStatus {
    if (this.unauthorized) return "unauthorized";
    if (this.blocked) return "blocked";
    const now = performance.now();
    // The remaining buffer may still be audible, but nothing new arrives.
    if (!this.connected && this.everConnected && now - this.lastChunkAt > 2500) return "reconnecting";
    if (!this.el.paused && now - this.lastProgressAt < 1500) return "playing";
    if (!this.connected) return this.everConnected || this.counters.connections > 1 ? "reconnecting" : "connecting";
    return this.everPlayed ? "buffering" : "connecting";
  }

  // The media pipeline of this browser cannot play the stream at all.
  unusable() {
    if (this.blocked || this.unauthorized || this.userPaused || this.everPlayed) return false;
    return this.failedRebuilds >= 3 || (this.everConnected && this.appendedEnd > 1 && performance.now() - this.startedAt > 25_000);
  }

  diagnostics() {
    return {
      status: this.status(), synchronized: !!this.timeline && this.clock.ready(this.timeline.instance),
      errorMs: this.lastErrorMs, clockPrecisionMs: this.clock.precision, rate: this.el.playbackRate,
      bufferedAhead: this.bufferedAhead(this.el.currentTime), seekLeadMs: Math.round(this.seekLead * 1000),
      audibleServerTime: this.audibleServerTime(), ...this.counters,
    };
  }

  // Server time of the audio that is audible right now; equal on all devices
  // when they are synchronized. Used by diagnostics and tests.
  audibleServerTime() {
    if (!this.timeline) return null;
    const frame = this.timeline.firstFrame + (this.el.currentTime - this.segmentStart) / MP3_FRAME_SECONDS;
    return this.timeline.epoch + frame * MP3_FRAME_SECONDS * 1000 + this.timeline.delayMs - this.trimMs;
  }

  private report() {
    const status = this.status();
    if (status === this.reported) return;
    this.reported = status;
    this.onChange();
  }

  private openPipeline() {
    const Source = sourceCtor();
    if (!Source || this.stopped) return;
    const generation = ++this.generation;
    this.pipelineOpenedAt = performance.now();
    this.closeConnection();
    this.ops = []; this.queuedBytes = 0;
    this.buffer = undefined; this.timeline = null; this.segmentStart = 0; this.appendedEnd = 0;
    this.smoothedError = 0; this.correcting = false; this.seekSettledAt = Infinity; this.lastSeekAt = -Infinity;
    const media = new Source();
    this.media = media;
    const previous = this.objectUrl;
    this.objectUrl = URL.createObjectURL(media);
    // ManagedMediaSource (iOS) requires remote playback to be disabled.
    try { (this.el as unknown as { disableRemotePlayback: boolean }).disableRemotePlayback = true; } catch { /* Unsupported. */ }
    this.el.src = this.objectUrl;
    if (previous) { try { URL.revokeObjectURL(previous); } catch { /* Ignored. */ } }
    media.addEventListener("sourceopen", () => {
      if (generation !== this.generation || this.stopped || this.buffer) return;
      try {
        const buffer = media.addSourceBuffer(MIME);
        try { buffer.mode = "sequence"; } catch { /* Already implied for MPEG audio. */ }
        buffer.addEventListener("updateend", () => { if (generation === this.generation) this.pump(); });
        buffer.addEventListener("error", () => { if (generation === this.generation) this.scheduleRebuild(); });
        this.buffer = buffer;
        if (!this.userPaused && !this.blocked) this.reconnect(0);
      } catch { this.failedRebuilds++; this.scheduleRebuild(); }
    });
    if (!this.userPaused) this.play();
  }

  private scheduleRebuild() {
    if (this.stopped || this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => { this.rebuildTimer = undefined; this.rebuild(); }, 1000);
  }

  private rebuild() {
    if (this.stopped) return;
    if (!this.everPlayed) this.failedRebuilds++;
    this.counters.rebuilds++;
    this.lastRebuildAt = performance.now();
    this.openPipeline();
    this.report();
  }

  private play() {
    if (this.stopped || this.userPaused) return;
    this.lastPlayAttemptAt = performance.now();
    const attempt = ++this.playAttempt;
    let result: Promise<void> | undefined;
    try { result = this.el.play(); } catch { return; }
    void result?.then(() => {
      if (attempt === this.playAttempt && this.blocked) { this.blocked = false; this.recover(); this.report(); }
    }).catch(error => {
      if (this.stopped || attempt !== this.playAttempt) return;
      // Only a user gesture can lift this; the visible button calls resume().
      if (error?.name === "NotAllowedError") {
        this.blocked = true;
        if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = undefined; }
        this.closeConnection();
        this.report();
      }
    });
  }

  private closeConnection() {
    const request = this.request;
    this.request = undefined;
    this.connected = false;
    try { request?.abort(); } catch { /* Ignored. */ }
  }

  private reconnect(delay = this.retryDelay) {
    if (this.stopped || this.retryTimer || this.request) return;
    this.retryTimer = setTimeout(() => { this.retryTimer = undefined; void this.connect(); }, delay);
    if (delay) this.retryDelay = Math.min(5000, this.retryDelay * 2);
    this.report();
  }

  private async connect() {
    if (this.stopped || this.request || this.userPaused || this.blocked) return;
    if (!this.buffer || this.media?.readyState !== "open") return;
    const generation = this.generation;
    const request = new AbortController();
    this.request = request;
    this.counters.connections++;
    const timeout = setTimeout(() => request.abort(), 10_000);
    try {
      const response = await fetch(this.streamUrl, { cache: "no-store", credentials: "same-origin", signal: request.signal });
      clearTimeout(timeout);
      this.unauthorized = response.status === 401 || response.status === 403;
      if (!response.ok || !response.body) throw new Error("Stream unavailable");
      const timeline = parseSpeakerTimeline(response.headers.get("x-speaker-timeline"));
      const reader = response.body.getReader();
      if (generation !== this.generation || this.request !== request) { void reader.cancel().catch(() => {}); return; }
      // Each connection starts its own range of the media timeline, separate
      // from audio that is still playing out of the previous connection.
      this.ops.push({ kind: "segment", timeline });
      this.connected = true; this.everConnected = true;
      this.lastChunkAt = performance.now();
      if (timeline && !this.clock.ready(timeline.instance)) this.nextClockAt = 0;
      this.report();
      for (;;) {
        const { done, value } = await reader.read();
        if (generation !== this.generation || this.request !== request) { void reader.cancel().catch(() => {}); return; }
        if (done) break;
        if (!value?.byteLength) continue;
        this.lastChunkAt = performance.now();
        this.retryDelay = 500;
        this.ops.push({ kind: "append", data: value });
        this.queuedBytes += value.byteLength;
        // The page was frozen or the buffer is stuck: start over cleanly.
        if (this.queuedBytes > MAX_QUEUED_BYTES) { this.scheduleRebuild(); return; }
        this.pump();
      }
    } catch { /* Reconnect below. */ }
    clearTimeout(timeout);
    if (this.request !== request || generation !== this.generation) return;
    this.request = undefined;
    this.connected = false;
    this.reconnect(this.unauthorized ? 5000 : undefined);
    this.report();
  }

  // SourceBuffer operations must run strictly one after another.
  private pump() {
    const buffer = this.buffer, media = this.media;
    if (!buffer || !media || media.readyState !== "open" || buffer.updating) return;
    try {
      const ranges = buffer.buffered;
      if (ranges.length) this.appendedEnd = Math.max(this.appendedEnd, ranges.end(ranges.length - 1));
    } catch { /* Buffer was removed. */ }
    while (this.ops.length && !buffer.updating) {
      const op = this.ops[0];
      try {
        if (op.kind === "segment") {
          this.ops.shift();
          const start = this.appendedEnd > 0 ? this.appendedEnd + SEGMENT_GAP_SECONDS : 0;
          buffer.abort();
          buffer.timestampOffset = start;
          this.segmentStart = start; this.timeline = op.timeline;
          this.appendedEnd = start;
          this.smoothedError = 0; this.correcting = false;
        } else if (op.kind === "remove") {
          this.ops.shift();
          buffer.remove(0, op.end);
        } else {
          // Append everything that arrived meanwhile in one operation.
          let count = 1, bytes = op.data.byteLength;
          while (count < this.ops.length && this.ops[count].kind === "append") bytes += (this.ops[count++] as { data: Uint8Array }).data.byteLength;
          let data = op.data;
          if (count > 1) {
            data = new Uint8Array(bytes);
            let offset = 0;
            for (let i = 0; i < count; i++) { const part = (this.ops[i] as { data: Uint8Array }).data; data.set(part, offset); offset += part.byteLength; }
          }
          buffer.appendBuffer(data as BufferSource);
          this.ops.splice(0, count);
          this.queuedBytes -= bytes;
        }
      } catch (error) {
        if ((error as { name?: string })?.name === "QuotaExceededError" && this.ops[0]?.kind === "append") {
          const end = this.el.currentTime - 2;
          if (end > 0) { this.ops.unshift({ kind: "remove", end }); continue; }
        }
        this.scheduleRebuild();
        return;
      }
    }
  }

  private bufferedAhead(time: number) {
    try {
      const ranges = this.el.buffered;
      for (let i = 0; i < ranges.length; i++) if (ranges.start(i) <= time + 0.05 && ranges.end(i) >= time) return ranges.end(i) - time;
    } catch { /* No media attached. */ }
    return 0;
  }

  // Start of the buffered audio that belongs to the current connection.
  private segmentRangeStart() {
    try {
      const ranges = this.el.buffered;
      for (let i = ranges.length - 1; i >= 0; i--) if (ranges.end(i) > this.segmentStart) return Math.max(this.segmentStart, ranges.start(i));
    } catch { /* No media attached. */ }
    return this.segmentStart;
  }

  private seek(target: number, now: number, calibrate: boolean) {
    this.counters.seeks++;
    this.consecutiveSeeks++;
    this.lastSeekAt = now;
    this.seekSettledAt = Infinity;
    this.calibrateSeek = calibrate;
    this.smoothedError = 0; this.correcting = false;
    this.setRate(1);
    try { this.el.currentTime = target; } catch { /* Retried on the next tick. */ }
  }

  private setRate(rate: number) {
    if (Math.abs(this.el.playbackRate - rate) >= 0.0005) { try { this.el.playbackRate = rate; } catch { /* Unsupported rate. */ } }
  }

  private synchronize(now: number) {
    const el = this.el;
    if (el.seeking || el.readyState < 1) return;
    const end = this.appendedEnd, start = this.segmentRangeStart();
    if (end - start < 0.3) return;
    const current = el.currentTime;
    const inSegment = current >= start - 0.05 && current <= end + 0.05;
    const synchronized = !!this.timeline && this.clock.ready(this.timeline.instance);
    if (!synchronized) {
      // Without a clock reference: play this connection with a full buffer.
      this.lastErrorMs = null;
      const delay = (this.timeline?.delayMs ?? 3000) / 1000;
      if ((!inSegment || end - current > delay + 4) && now - this.lastSeekAt > MIN_SEEK_INTERVAL_MS) this.seek(Math.max(start, end - delay), now, false);
      this.setRate(1);
      return;
    }
    const desired = playoutPosition(this.timeline!, this.segmentStart, this.clock.serverNow(now), this.trimMs);
    const error = desired - current;
    // Let a finished seek settle before measuring against it.
    const settled = now - this.seekSettledAt;
    if (now - this.lastSeekAt < 4000 && !(settled >= 500)) return;
    this.lastErrorMs = Math.round(error * 1000);
    if (this.calibrateSeek && inSegment) {
      // Learn how long this device needs to resume after a seek.
      this.calibrateSeek = false;
      this.seekLead = Math.max(0, Math.min(0.6, this.seekLead + error * 0.7));
    }
    if (!inSegment || Math.abs(error) > SEEK_THRESHOLD_SECONDS) {
      this.steadySince = 0;
      // Never seek to where no audio has arrived yet.
      const target = Math.max(start, Math.min(desired + this.seekLead, end - 0.25));
      const useful = !inSegment || Math.abs(target - current) > SEEK_THRESHOLD_SECONDS / 2;
      // Repeated seeks that do not converge back off instead of stuttering.
      const interval = MIN_SEEK_INTERVAL_MS * 2 ** Math.min(4, Math.max(0, this.consecutiveSeeks - 2));
      if (useful && now - this.lastSeekAt > interval) { this.seek(target, now, Math.abs(target - desired - this.seekLead) < 0.01); return; }
    } else if (!this.steadySince) this.steadySince = now;
    else if (now - this.steadySince > 10_000) this.consecutiveSeeks = 0;
    this.smoothedError = this.smoothedError === 0 ? error : this.smoothedError * 0.7 + error * 0.3;
    const rate = correctionRate(this.smoothedError, this.correcting, this.bufferedAhead(current));
    this.correcting = rate !== 1;
    this.setRate(rate);
  }

  private async sampleClock() {
    if (this.sampling) return;
    this.sampling = true;
    const request = new AbortController();
    const timeout = setTimeout(() => request.abort(), 4000);
    try {
      const sent = performance.now();
      const response = await fetch(this.timeUrl, { cache: "no-store", signal: request.signal });
      const received = performance.now();
      const value = await response.json() as { instance?: unknown; now?: unknown };
      if (response.ok && typeof value.instance === "string" && typeof value.now === "number") this.clock.add(value.instance, value.now, sent, received);
    } catch { /* Measured again shortly. */ }
    clearTimeout(timeout);
    this.sampling = false;
    // A quick series first, then enough to follow clock drift.
    this.nextClockAt = performance.now() + (this.clock.count < 5 ? 250 : this.clock.count < 9 ? 3000 : 10_000);
  }

  private trim(now: number) {
    if (now - this.lastTrimAt < 10_000 || !this.buffer || this.ops.length) return;
    this.lastTrimAt = now;
    try {
      const ranges = this.buffer.buffered;
      if (!ranges.length) return;
      // Keep a little history for backward corrections, but never unbounded
      // audio when the element is held paused by the system.
      const end = Math.max(this.el.currentTime - 10, this.appendedEnd - 30);
      if (end - ranges.start(0) > 10) { this.ops.push({ kind: "remove", end }); this.pump(); }
    } catch { /* Buffer was removed. */ }
  }

  private tick() {
    if (this.stopped) return;
    const now = performance.now(), el = this.el;
    if (el.currentTime !== this.lastTime) {
      if (!el.paused && el.currentTime > this.lastTime) { this.lastProgressAt = now; this.everPlayed = true; this.failedRebuilds = 0; }
      this.lastTime = el.currentTime;
    }
    if (!this.userPaused && !this.blocked) {
      // An open connection that delivers nothing is replaced.
      if (this.connected && now - this.lastChunkAt > STREAM_SILENT_MS) { this.closeConnection(); this.reconnect(0); }
      else if (!this.request && !this.retryTimer && this.buffer && this.media?.readyState === "open") this.reconnect(0);
      if (now >= this.nextClockAt) void this.sampleClock();
      // The media source closed, or never opened: build a new one.
      if (this.media && this.media.readyState !== "open" && now - this.pipelineOpenedAt > (this.buffer ? 3000 : 6000)) this.scheduleRebuild();
      // The system paused the element (audio focus, device change): resume.
      if (el.paused) { if (now - this.lastPlayAttemptAt > 3000) this.play(); }
      else {
        this.synchronize(now);
        // Audio is available but the element does not advance.
        if (this.bufferedAhead(el.currentTime) > 1 && now - Math.max(this.lastProgressAt, this.lastSeekAt, this.startedAt) > 8000 && now - this.lastRebuildAt > 15_000) this.rebuild();
      }
      this.trim(now);
    }
    this.report();
    this.tickTimer = setTimeout(() => this.tick(), TICK_MS);
  }
}
