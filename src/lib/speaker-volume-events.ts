import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "./prisma";
import { userForCookie } from "./session";

// Volume changes are pushed to browsers the moment an API route saves them.
// The routes and this handler live in differently bundled modules of the same
// process, so the subscriber list is kept on globalThis.
type Listener = (volume: number) => void;
const shared = globalThis as typeof globalThis & { __ahdVolumeListeners?: Map<string, Set<Listener>> };
const listeners = shared.__ahdVolumeListeners ??= new Map();
export function publishZoneVolume(zoneId: string, volume: number) {
  for (const listener of listeners.get(zoneId) ?? []) listener(volume);
}

// A slow check of the saved value remains as a safety net (direct database
// edits, a missed notification). It replaces one query per second per device.
const VERIFY_MS = 15_000;
export async function streamSpeakerVolume(res: ServerResponse, zoneId: string, readVolume: () => Promise<number | null>) {
  const initial = await readVolume();
  if (res.destroyed) return;
  if (initial === null) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" });
  res.flushHeaders();
  let closed = false, last = initial;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (volume: number) => {
    if (closed || volume === last) return;
    last = volume;
    res.write(`data: ${JSON.stringify({ zoneId, volume })}\n\n`);
  };
  const listener: Listener = send;
  const zoneListeners = listeners.get(zoneId) ?? new Set<Listener>();
  listeners.set(zoneId, zoneListeners);
  zoneListeners.add(listener);
  res.on("close", () => {
    closed = true;
    if (timer) clearTimeout(timer);
    zoneListeners.delete(listener);
    if (!zoneListeners.size && listeners.get(zoneId) === zoneListeners) listeners.delete(zoneId);
  });
  res.write(`data: ${JSON.stringify({ zoneId, volume: initial })}\n\n`);
  const verify = async () => {
    try {
      const volume = await readVolume();
      if (closed) return;
      if (volume === null || res.writableLength > 16384) { res.end(); return; }
      if (volume !== last) send(volume);
      else res.write(": keepalive\n\n");
    } catch {
      // Reconnect plus the browser's ordinary source polling can recover.
      if (!closed) res.end();
      return;
    }
    if (!closed && !res.writableEnded) timer = setTimeout(() => { void verify(); }, VERIFY_MS);
  };
  timer = setTimeout(() => { void verify(); }, VERIFY_MS);
}

export async function handleSpeakerVolumeEvents(req: IncomingMessage, res: ServerResponse, zoneId: string) {
  if (req.method !== "GET") { res.writeHead(405).end(); return; }
  try {
    if (!(await userForCookie(req.headers.cookie || ""))) { res.writeHead(401).end(); return; }
    await streamSpeakerVolume(res, zoneId, async () => (await prisma.zone.findUnique({ where: { id: zoneId }, select: { volume: true } }))?.volume ?? null);
  } catch {
    if (!res.headersSent && !res.destroyed) res.writeHead(503).end();
    else res.end();
  }
}
