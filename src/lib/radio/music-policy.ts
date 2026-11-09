// User preference, 2026-11-09: very gentle background music without winds or
// prominent beats. See music-quality-review-2026-11-09.json for the stricter
// rhythm review and the two drumless replacements.
// Full recordings plus contiguous one-minute sections were sent for audio
// analysis; see music-review-2026-11-09.json. Reject synthetic wind-like leads
// too, even if a model's categorical label contradicts its sound description.
// Boulevard stays excluded because its source brief explicitly requested sax.
// These are rotation defaults; an explicit choice in the music library takes
// precedence. Purchased audio and its history stay intact.
export const QUIET_MUSIC_EXCLUDED_IDS = [
  "413569f1-dbeb-4451-8bae-e7ea7df3ff26", // Daylight: user rejected the hard beat
  "fec08a42-c91b-4850-b84c-328a45d1235a", // Showroom Velvet 1: recurring kick/snare groove
  "8267380a-c242-4563-a7c7-0cb215332bec", // Panorama: repeating kick/hi-hat groove
  "f312e92e-f858-436e-b441-e82923a945db", // Café: rhythmic jazz arrangement, possible wind lead
  "44fb331f-f2e1-4d7d-9e20-e78d660a5633", // Showroom Satin · Boulevard
  "7a045efb-77cc-4a3f-8af0-0bd0c88bf99b", // Showroom Satin 1: synthetic brass lead
  "20ddc6ec-725d-42cd-8d19-28bfa51cda5f", // Velvet Floorplan 1: sax-like lead
  "549cefd0-9204-4a19-b648-a2e1f3d52ec6", // Showroom Velvet · Sunlit: flute-like synth
];

export const QUIET_MUSIC_PROMPT = "Very gentle, drumless instrumental background lounge music, comfortable beneath quiet conversation. Use natural acoustic piano or clear mellow Rhodes, soft nylon-string guitar and occasional restrained bass notes. Softness must come from gentle playing and sparse arrangement, NOT muffled tone, low-pass filtering, felt/muted piano or a wash of pads. Preserve clear natural harmonics, realistic instrument resonance and stable sustained notes in a transparent studio recording with little room reverb. NO percussion or programmed beat: no kick, snare, clap, hi-hat, shaker, brushes, rimshots, clicks, finger snaps or percussive bass pulse. No wind instruments: no trumpet, saxophone, trombone, horns, brass, flute, clarinet, reeds, breathy wind leads or synthetic brass sounds. Gentle attacks, restrained bass and spacious middle-register phrases. No brittle metallic or plastic timbres, piercing highs, solos, runs, dramatic swells or sudden changes. No lo-fi processing, vinyl crackle, distortion, pumping, tape wobble, chorus or phasing. Maintain a sparse, warm, quietly positive lounge arrangement throughout, with gentle harmonic variety and no buildup.";

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
