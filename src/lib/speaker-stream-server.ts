import { readFileSync } from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "./prisma";
import { userForCookie } from "./session";
import { currentMode, announceRelaysForZone } from "./broadcast";
import { nativeSource } from "./radio/config";
import { manualZoneSource } from "./radio/zone-news";
import { Mp3Frames, SpeakerStream } from "./speaker-stream";
import { usesContinuousSpeaker } from "./speaker-stream-url";

const streams = new Map<string, SpeakerStream>();
let silence: Buffer[] | undefined;

export async function handleSpeakerStream(req: IncomingMessage, res: ServerResponse, zoneId: string) {
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  try {
    if (!(await userForCookie(req.headers.cookie || ""))) { res.writeHead(401).end(); return; }
    let zone = await prisma.zone.findUnique({ where: { id: zoneId }, select: { defaultSource: true, streamUrl: true } });
    if (res.destroyed) return;
    if (!zone || !usesContinuousSpeaker(zone)) { res.writeHead(404).end(); return; }
    let stream = streams.get(zoneId);
    if (!stream) {
      silence ??= new Mp3Frames().push(readFileSync(path.join(process.cwd(), "public/audio/speaker-silence.mp3")));
      let refreshedAt = Date.now(), refreshing = false;
      const origin = `http://127.0.0.1:${process.env.PORT || 3000}`;
      stream = new SpeakerStream(async () => {
        // DB refresh must not delay live/news routing during a slow DB request.
        if (!refreshing && Date.now() - refreshedAt > 10_000) {
          refreshing = true;
          void prisma.zone.findUnique({ where: { id: zoneId }, select: { defaultSource: true, streamUrl: true } })
            .then(next => { zone = next; })
            .catch(() => { /* Keep the last known configuration. */ })
            .finally(() => { refreshedAt = Date.now(); refreshing = false; });
        }
        // Custom station URLs keep the existing browser path. Never proxy an
        // arbitrary configured URL through this server-side endpoint.
        if (!zone || !usesContinuousSpeaker(zone)) return [];
        const mode = currentMode(zoneId);
        if (mode === "announce") return announceRelaysForZone(zoneId).map(relay => `${origin}/api/zones/${encodeURIComponent(zoneId)}/live?r=${relay.relayId}`);
        if (mode === "stream") return [`${origin}/api/zones/${encodeURIComponent(zoneId)}/live?m=stream`];
        const url = manualZoneSource(zoneId, origin) ?? nativeSource(zone, origin);
        return url ? [url] : [];
      }, silence, () => { if (streams.get(zoneId) === stream) streams.delete(zoneId); });
      streams.set(zoneId, stream);
    }
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" });
    res.flushHeaders();
    const listener = new URL(req.url || "/", "http://localhost").searchParams.get("listener");
    stream.attach(res, listener && /^[a-zA-Z0-9-]{1,80}$/.test(listener) ? listener : undefined);
  } catch (error) {
    console.error("[speaker stream] start failed", error instanceof Error ? error.message : "unknown error");
    if (!res.headersSent) res.writeHead(503).end();
    else res.end();
  }
}

export function stopSpeakerStreams() {
  for (const stream of streams.values()) stream.close();
  streams.clear();
}

export function speakerStreamDiagnostics() {
  return [...streams].map(([zoneId, stream]) => ({ zoneId, ...stream.diagnostics() }));
}

export function speakerStatusForZone(zoneId: string) { return streams.get(zoneId)?.status(); }

export function speakerClockForZone(zoneId: string, listener: string) { return streams.get(zoneId)?.clock(listener); }

export function speakerDiagnosticsForZone(zoneId: string) { return streams.get(zoneId)?.diagnostics(); }
