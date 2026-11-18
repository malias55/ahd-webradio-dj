// Shared playout clock for browser speakers.
//
// The server numbers every MP3 frame of a zone stream and schedules frame f at
// `epoch + f * frame duration` on its own clock. Every browser measures the
// offset between its clock and the server clock, and plays frame f exactly
// `delayMs` after it was scheduled. Devices therefore agree on what is audible
// at any moment without talking to each other.
export const MP3_FRAME_SECONDS = 1152 / 44100;

export type SpeakerTimeline = { instance: string; epoch: number; firstFrame: number; delayMs: number };

export function parseSpeakerTimeline(header: string | null | undefined): SpeakerTimeline | null {
  if (!header) return null;
  const [instance, epoch, firstFrame, delayMs] = header.split(";");
  const value = { instance, epoch: Number(epoch), firstFrame: Number(firstFrame), delayMs: Number(delayMs) };
  if (!instance || !Number.isFinite(value.epoch) || !Number.isInteger(value.firstFrame) || value.firstFrame < 0) return null;
  if (!Number.isFinite(value.delayMs) || value.delayMs < 0 || value.delayMs > 60_000) return null;
  return value;
}

// Media position (seconds) that must be audible at server time `serverNow`,
// for a connection whose first frame was appended at `segmentStart`.
// A positive trim plays this device earlier, compensating a slow output.
export function playoutPosition(timeline: SpeakerTimeline, segmentStart: number, serverNow: number, trimMs = 0) {
  const frame = (serverNow - timeline.delayMs + trimMs - timeline.epoch) / (MP3_FRAME_SECONDS * 1000);
  return segmentStart + (frame - timeline.firstFrame) * MP3_FRAME_SECONDS;
}

type Sample = { offset: number; roundTrip: number; at: number };
const SAMPLE_WINDOW_MS = 60_000;

// Estimates `server clock - local clock`. The request with the shortest round
// trip has the least asymmetric delay, so it carries the best measurement.
export class ServerClock {
  private samples: Sample[] = [];
  private estimate: number | null = null;
  instance: string | null = null;

  add(instance: string, serverNow: number, sentAt: number, receivedAt: number) {
    const roundTrip = receivedAt - sentAt;
    if (!Number.isFinite(serverNow) || !Number.isFinite(roundTrip) || roundTrip < 0 || roundTrip > 5000) return;
    if (instance !== this.instance) { this.instance = instance; this.samples = []; this.estimate = null; }
    this.samples.push({ offset: serverNow - (sentAt + receivedAt) / 2, roundTrip, at: receivedAt });
    this.samples = this.samples.filter(sample => receivedAt - sample.at <= SAMPLE_WINDOW_MS).slice(-12);
    const best = this.samples.reduce((a, b) => (b.roundTrip < a.roundTrip ? b : a));
    // Move gradually between good measurements; follow a real jump at once.
    this.estimate = this.estimate === null || Math.abs(best.offset - this.estimate) > 50 ? best.offset : this.estimate + (best.offset - this.estimate) * 0.5;
  }

  get count() { return this.samples.length; }
  ready(instance: string) { return this.estimate !== null && this.instance === instance; }
  serverNow(localNow: number) { return localNow + (this.estimate ?? 0); }
  // Uncertainty of the current estimate in milliseconds.
  get precision() { return this.samples.length ? Math.min(...this.samples.map(sample => sample.roundTrip)) / 2 : null; }
}

export const SEEK_THRESHOLD_SECONDS = 0.12;
const MAX_RATE_CHANGE = 0.012;

// Small deviations are removed inaudibly by a slightly faster or slower
// playback. `correcting` adds hysteresis so the rate does not chatter.
export function correctionRate(smoothedError: number, correcting: boolean, bufferedAhead: number) {
  const magnitude = Math.abs(smoothedError);
  if (magnitude < (correcting ? 0.003 : 0.01)) return 1;
  // Never accelerate into the end of the buffer.
  if (smoothedError > 0 && bufferedAhead < 0.5) return 1;
  const change = Math.max(-MAX_RATE_CHANGE, Math.min(MAX_RATE_CHANGE, smoothedError * 0.25));
  return Math.round((1 + change) * 1000) / 1000;
}
