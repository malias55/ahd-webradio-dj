// User preference, 2026-11-09: very gentle background music without winds.
// Full recordings plus contiguous one-minute sections were sent for audio
// analysis; see music-review-2026-11-09.json. Reject synthetic wind-like leads
// too, even if a model's categorical label contradicts its sound description.
// Boulevard stays excluded because its source brief explicitly requested sax.
// This is a rotation exclusion only; purchased audio and its history stay intact.
export const QUIET_MUSIC_EXCLUDED_IDS = [
  "44fb331f-f2e1-4d7d-9e20-e78d660a5633", // Showroom Satin · Boulevard
  "7a045efb-77cc-4a3f-8af0-0bd0c88bf99b", // Showroom Satin 1: synthetic brass lead
  "20ddc6ec-725d-42cd-8d19-28bfa51cda5f", // Velvet Floorplan 1: sax-like lead
  "549cefd0-9204-4a19-b648-a2e1f3d52ec6", // Showroom Velvet · Sunlit: flute-like synth
];

export const QUIET_MUSIC_PROMPT = "Very gentle, soft, unobtrusive background music, comfortable under conversation. Use only warm piano or Rhodes, soft clean or nylon-string guitar, rounded bass, restrained pads and very light brushed percussion. No wind instruments of any kind: no trumpet, saxophone, trombone, horns, brass, flute, clarinet, reeds, breathy wind leads or synthetic brass sounds. No prominent solos, piercing high notes, sharp attacks, busy fills, loud drums, dramatic swells or sudden changes in volume. Keep the arrangement sparse, warm and easy on the ear throughout.";

export function musicInRotation(asset: { id: string; kind: string }) {
  return asset.kind === "music" && !QUIET_MUSIC_EXCLUDED_IDS.includes(asset.id);
}
