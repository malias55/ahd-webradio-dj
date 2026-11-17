// A shared server frame clock, not buffered.end(), defines the programme time.
export type SpeakerClock = { listener: string; connection: string; mediaSeconds: number };
export type ClockSample = SpeakerClock & { receivedAt: number; transitSeconds: number };
export const SPEAKER_TARGET_DELAY = 2;

export function speakerSyncAdjustment(sample: ClockSample, now: number, currentTime: number, headroom: number) {
  const age = (now - sample.receivedAt) / 1000;
  if (age < 0 || age > 10 || !Number.isFinite(currentTime)) return { rate: 1, target: null };
  const target = sample.mediaSeconds + sample.transitSeconds + age - SPEAKER_TARGET_DELAY;
  if (target < 0) return { rate: 1, target: null };
  const error = target - currentTime;
  // Preserve pitch and the network jitter buffer. A stale clock must never
  // leave a background player running indefinitely at a different speed.
  const rate = Math.abs(error) < 0.04 ? 1
    : error > 0 && headroom < 0.5 ? 1
    : 1 + Math.max(-0.04, Math.min(0.04, error * 0.08));
  return { rate, target: Math.abs(error) > 1 ? target : null };
}
