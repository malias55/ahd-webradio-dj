import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "./prisma";
import { userForCookie } from "./session";

// The server watches the saved value, so changes from either API route reach
// browsers even when a hidden tab's own status timers are throttled.
export async function streamSpeakerVolume(res: ServerResponse, zoneId: string, readVolume: () => Promise<number | null>) {
  const initial = await readVolume();
  if (res.destroyed) return;
  if (initial === null) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-store, no-transform", "X-Accel-Buffering": "no", Connection: "keep-alive" });
  res.flushHeaders();
  let closed = false, last = initial, ticks = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const send = (volume: number) => res.write(`data: ${JSON.stringify({ zoneId, volume })}\n\n`);
  res.on("close", () => { closed = true; if (timer) clearTimeout(timer); });
  send(initial);
  const poll = async () => {
    try {
      const volume = await readVolume();
      if (closed) return;
      if (volume === null || res.writableLength > 16384) { res.end(); return; }
      if (volume !== last) { send(volume); last = volume; }
      else if (++ticks % 10 === 0) res.write(": keepalive\n\n");
    } catch {
      // Reconnect plus the browser's ordinary source polling can recover.
      if (!closed) res.end();
      return;
    }
    if (!closed && !res.writableEnded) timer = setTimeout(() => { void poll(); }, 1000);
  };
  timer = setTimeout(() => { void poll(); }, 1000);
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
