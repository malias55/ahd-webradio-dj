// User preference, 2026-11-09: very gentle background music without winds.
// Full recordings plus contiguous one-minute sections were sent for audio
// analysis; see music-review-2026-11-09.json. Reject synthetic wind-like leads
// too, even if a model's categorical label contradicts its sound description.
// Boulevard stays excluded because its source brief explicitly requested sax.
// These are rotation defaults; an explicit choice in the music library takes
// precedence. Purchased audio and its history stay intact.
export const QUIET_MUSIC_EXCLUDED_IDS = [
  "44fb331f-f2e1-4d7d-9e20-e78d660a5633", // Showroom Satin · Boulevard
  "7a045efb-77cc-4a3f-8af0-0bd0c88bf99b", // Showroom Satin 1: synthetic brass lead
  "20ddc6ec-725d-42cd-8d19-28bfa51cda5f", // Velvet Floorplan 1: sax-like lead
  "549cefd0-9204-4a19-b648-a2e1f3d52ec6", // Showroom Velvet · Sunlit: flute-like synth
];

export const QUIET_MUSIC_PROMPT = "Very gentle, soft, unobtrusive background music, comfortable under conversation. Use only warm piano or Rhodes, soft clean or nylon-string guitar, rounded bass, restrained pads and very light brushed percussion. No wind instruments of any kind: no trumpet, saxophone, trombone, horns, brass, flute, clarinet, reeds, breathy wind leads or synthetic brass sounds. No prominent solos, piercing high notes, sharp attacks, busy fills, loud drums, dramatic swells or sudden changes in volume. Keep the arrangement sparse, warm and easy on the ear throughout.";

export type RotationTrack = { id: string; kind: string; season?: string; rotationEnabled?: boolean; metadata?: unknown };

export function isMusicTrack(asset: { kind: string }) {
  return asset.kind === "music" || asset.kind === "music-candidate";
}

export function musicRotationEnabled(asset: RotationTrack) {
  if (!isMusicTrack(asset)) return false;
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata as { rotationEnabled?: unknown } : null;
  const override = asset.rotationEnabled ?? metadata?.rotationEnabled;
  if (typeof override === "boolean") return override;
  return asset.kind === "music" && !QUIET_MUSIC_EXCLUDED_IDS.includes(asset.id);
}

export function musicSeason(asset: Pick<RotationTrack, "season" | "metadata">) {
  const metadata = asset.metadata && typeof asset.metadata === "object" ? asset.metadata as { season?: unknown } : null;
  return asset.season === "winter" || metadata?.season === "winter" ? "winter" : "all";
}

export function musicAvailableAt(asset: RotationTrack, date: Date) {
  if (!musicRotationEnabled(asset)) return false;
  if (musicSeason(asset) !== "winter") return true;
  const month = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", month: "numeric" }).format(date));
  return [11, 12, 1, 2].includes(month);
}

export function musicInRotation(asset: RotationTrack) {
  return musicAvailableAt(asset, new Date());
}

// Each pool plays once before a new round. The last half of the pool stays out
// of the next choices across round boundaries and restarts. History is newest
// first and comes from actual server playbacks, not just an in-memory shuffle.
export function buildMusicQueue<T extends RotationTrack>(tracks: T[], recentIds: string[], date = new Date(), random = Math.random): T[] {
  const remaining = [...new Map(tracks.filter(track => musicAvailableAt(track, date)).map(track => [track.id, track])).values()];
  const activeIds = new Set(remaining.map(track => track.id));
  const winterIds = new Set(remaining.filter(track => musicSeason(track) === "winter").map(track => track.id));
  const history = recentIds.filter(id => activeIds.has(id));
  const cooldown = Math.floor(remaining.length / 2);
  const queue: T[] = [];
  while (remaining.length) {
    const recent = new Set(history.slice(0, cooldown));
    const eligible = remaining.filter(track => !recent.has(track.id));
    let choices = eligible.length ? eligible : remaining;
    // Seasonal pieces are occasional accents, with at least two ordinary
    // pieces between them whenever the remaining pool permits it.
    const spaced = choices.filter(track => !winterIds.has(track.id) || !history.slice(0, 2).some(id => winterIds.has(id)));
    if (spaced.length) choices = spaced;
    const track = choices[Math.min(choices.length - 1, Math.max(0, Math.floor(random() * choices.length)))];
    queue.push(track);
    history.unshift(track.id);
    remaining.splice(remaining.findIndex(item => item.id === track.id), 1);
  }
  return queue;
}
