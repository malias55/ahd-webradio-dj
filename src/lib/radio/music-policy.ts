// User preference, 2026-11-09: very gentle background music without winds.
// Boulevard explicitly requested tenor sax. The three original tracks have no
// track-specific listening review, so hold them back as well. Keep the four
// expansion tracks whose existing audio reviews describe soft keys/guitar and
// light percussion. Those reviews cover excerpts, not a full-track guarantee.
// This is a rotation exclusion only; purchased audio and its history stay intact.
export const QUIET_MUSIC_EXCLUDED_IDS = [
  "44fb331f-f2e1-4d7d-9e20-e78d660a5633", // Showroom Satin · Boulevard
  "7a045efb-77cc-4a3f-8af0-0bd0c88bf99b", // Showroom Satin 1
  "20ddc6ec-725d-42cd-8d19-28bfa51cda5f", // Velvet Floorplan 1
  "fec08a42-c91b-4850-b84c-328a45d1235a", // Showroom Velvet 1
];

export const QUIET_MUSIC_PROMPT = "Very gentle, soft, unobtrusive background music, comfortable under conversation. Use only warm piano or Rhodes, soft clean or nylon-string guitar, rounded bass, restrained pads and very light brushed percussion. No wind instruments of any kind: no trumpet, saxophone, trombone, horns, brass, flute, clarinet, reeds, breathy wind leads or synthetic brass sounds. No prominent solos, piercing high notes, sharp attacks, busy fills, loud drums, dramatic swells or sudden changes in volume. Keep the arrangement sparse, warm and easy on the ear throughout.";

export function musicInRotation(asset: { id: string; kind: string }) {
  return asset.kind === "music" && !QUIET_MUSIC_EXCLUDED_IDS.includes(asset.id);
}
