// Mix the gong and microphone into one stream so every zone hears the same intro.
export async function prepareAnnouncementIntro(context: AudioContext, microphone: AudioNode) {
  const response = await fetch("/audio/announcement-chime.wav");
  if (!response.ok) throw new Error("Der Durchsage-Gong konnte nicht geladen werden. Bitte erneut versuchen.");
  const buffer = await context.decodeAudioData(await response.arrayBuffer());
  const destination = context.createMediaStreamDestination();
  const gate = context.createGain();
  gate.gain.value = 0;
  microphone.connect(gate);
  gate.connect(destination);
  const gong = context.createBufferSource();
  gong.buffer = buffer;
  gong.connect(destination);
  let endsAt = Infinity;
  let stopped = false;

  return {
    stream: destination.stream,
    start() {
      const startsAt = context.currentTime + 0.05;
      endsAt = startsAt + buffer.duration;
      gate.gain.setValueAtTime(0, context.currentTime);
      gate.gain.setValueAtTime(1, endsAt);
      gong.start(startsAt);
    },
    remainingMs() { return stopped ? 0 : Math.max(0, (endsAt - context.currentTime) * 1000); },
    isPlaying() { return !stopped && context.currentTime < endsAt; },
    stop() {
      stopped = true;
      gate.gain.cancelScheduledValues(context.currentTime);
      gate.gain.setValueAtTime(0, context.currentTime);
      try { gong.stop(); } catch { /* Already stopped or not started. */ }
    },
  };
}

// Read the audio clock, not wall time: a suspended context must never show "speak".
export function getAnnouncementStatus(context: Pick<AudioContext, "state">, intro?: { remainingMs(): number }) {
  if (context.state !== "running") return { phase: "paused" as const, remainingMs: 0 };
  const remainingMs = intro?.remainingMs() ?? 0;
  return { phase: remainingMs > 0 ? "intro" as const : "speaking" as const, remainingMs };
}
