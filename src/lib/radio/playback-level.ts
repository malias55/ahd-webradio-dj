// Speech needs a small listening-level lift relative to the continuous music.
// Apply it once, at broadcast output, so existing and future bulletins behave
// alike without changing saved audio or compounding gain on repeated editions.
export const NEWS_GAIN_DB = 3;
export const NEWS_PLAYBACK_CODEC = [
  "-af", `volume=${NEWS_GAIN_DB}dB,alimiter=limit=0.794328:level=false:latency=true`,
  "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k",
];
