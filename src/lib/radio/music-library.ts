import { isMusicTrack, musicAvailableAt, musicRotationEnabled, musicSeason, type RotationTrack } from "./music-policy";

export type MusicLibraryTrack = {
  id: string; title: string; duration: number; createdAt: string;
  rotationEnabled: boolean; inRotation: boolean; season: string;
  note: string | null; version: string | null;
};
export type MusicLibraryStatus = {
  tracks: MusicLibraryTrack[]; canManage: boolean;
  playing: { id: string; title: string; kind: string } | null;
  playNowBlockedReason: string | null;
};

const notes: Record<string, string> = {
  "44fb331f-f2e1-4d7d-9e20-e78d660a5633": "Wegen Saxofon aus der Automatik genommen.",
  "7a045efb-77cc-4a3f-8af0-0bd0c88bf99b": "Wegen trompetenähnlicher Synthesizer aus der Automatik genommen.",
  "20ddc6ec-725d-42cd-8d19-28bfa51cda5f": "Wegen saxofonähnlicher Klänge aus der Automatik genommen.",
  "549cefd0-9204-4a19-b648-a2e1f3d52ec6": "Wegen flötenähnlicher Synthesizer aus der Automatik genommen.",
  "62445bbd-2ac3-4c58-b8b3-b0f961468d1d": "Bei der Audioanalyse wurden saxofonähnliche Klänge gemeldet.",
};

export function musicLibraryTrack(asset: RotationTrack & { title: string; duration: number; createdAt: Date }, date = new Date()): MusicLibraryTrack {
  if (!isMusicTrack(asset)) throw new Error("Kein Musiktitel");
  const metadata = (asset.metadata || {}) as { sourceAssetId?: string; gentleMusicReview?: { approvedEditId?: string } };
  const original = !!metadata.gentleMusicReview?.approvedEditId;
  return {
    id: asset.id, title: asset.title, duration: asset.duration, createdAt: asset.createdAt.toISOString(),
    rotationEnabled: musicRotationEnabled(asset), inRotation: musicAvailableAt(asset, date), season: musicSeason(asset),
    note: notes[asset.id] || (original ? "Die längere Originalfassung hat ein möglicherweise unruhigeres Ende. Eine ruhigere Fassung ist ebenfalls verfügbar." : asset.kind === "music-candidate" ? "Bisher nicht für die automatische Rotation ausgewählt." : null),
    version: original ? "Originalfassung" : metadata.sourceAssetId ? "Ruhige Fassung" : null,
  };
}
