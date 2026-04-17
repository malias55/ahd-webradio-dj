// AzuraCast "Now Playing" resolver.
// Given a stream URL like https://host/listen/<stationId>/radio.mp3,
// queries /api/nowplaying_static/<stationId>.json which is the public,
// CDN-cacheable endpoint AzuraCast recommends for lightweight polling.

export type NowPlaying = {
  online: boolean;
  title?: string;
  artist?: string;
  art?: string;
  elapsed?: number;
  duration?: number;
};

const CACHE_TTL_MS = 15_000;
const cache = new Map<string, { at: number; data: NowPlaying }>();

export async function getAzuracastNowPlaying(streamUrl: string): Promise<NowPlaying | null> {
  try {
    const u = new URL(streamUrl);
    const m = u.pathname.match(/^\/listen\/([^/]+)\//);
    if (!m) return null;
    const stationId = m[1];
    const apiUrl = `${u.origin}/api/nowplaying_static/${stationId}.json`;

    const cached = cache.get(apiUrl);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;

    const r = await fetch(apiUrl, { cache: "no-store", signal: AbortSignal.timeout(2500) });
    if (!r.ok) {
      const data: NowPlaying = { online: false };
      cache.set(apiUrl, { at: Date.now(), data });
      return data;
    }
    const j = (await r.json()) as {
      is_online?: boolean;
      now_playing?: {
        song?: { title?: string; artist?: string; art?: string };
        elapsed?: number;
        duration?: number;
      };
    };
    const song = j.now_playing?.song;
    const data: NowPlaying = {
      online: Boolean(j.is_online),
      title: song?.title,
      artist: song?.artist,
      art: song?.art,
      elapsed: j.now_playing?.elapsed,
      duration: j.now_playing?.duration,
    };
    cache.set(apiUrl, { at: Date.now(), data });
    return data;
  } catch {
    return null;
  }
}
