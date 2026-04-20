import { createServer, type IncomingMessage, type ServerResponse } from "http";
import next from "next";
import { parse } from "url";
import { Server as SocketServer, type Socket } from "socket.io";
import { prisma } from "./src/lib/prisma";
import {
  registerHub,
  trackSocket,
  joinZoneRoom,
  broadcastConfig,
  sendToZone,
} from "./src/lib/deviceHub";
import {
  announceRelaysForZone,
  attachSubscriber,
  attachToRelay,
  currentMode,
  detachFromRelay,
  detachSubscriber,
  hasAnyRelay,
  hasRelay,
  pushChunk,
  startRelay,
  stopRelay,
  type RelayKind,
} from "./src/lib/broadcast";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

const DEVICE_API_KEY = process.env.DEVICE_API_KEY;
if (!DEVICE_API_KEY) {
  console.warn("[server] DEVICE_API_KEY is not set — WebSocket auth will reject all devices.");
}

if (!dev && process.env.SKIP_AUTH === "true") {
  console.error("[server] FATAL: SKIP_AUTH=true in production. Refusing to start.");
  process.exit(1);
}
if (!dev && process.env.LOGTO_COOKIE_SECRET && process.env.LOGTO_COOKIE_SECRET.length < 32) {
  console.warn("[server] LOGTO_COOKIE_SECRET is shorter than 32 chars — iron-session requires 32+.");
}

function resolveOrigin(req: IncomingMessage): string {
  if (process.env.LOGTO_BASE_URL) return process.env.LOGTO_BASE_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  const proto = (req.headers["x-forwarded-proto"] as string) || "http";
  const host = req.headers.host || `localhost:${port}`;
  return `${proto}://${host}`;
}

function isAuthenticated(req: IncomingMessage): boolean {
  if (process.env.SKIP_AUTH === "true") return true;
  const cookie = req.headers.cookie || "";
  const appId = process.env.LOGTO_APP_ID || "";
  return !!(appId && cookie.includes(`logto_${appId}=`));
}

const LIVE_RE = /^\/api\/zones\/([^/]+)\/live\/?$/;
const CURRENT_SOURCE_RE = /^\/api\/zones\/([^/]+)\/current-source\/?$/;

// ── /api/zones/:id/live — raw Node.js handler for real-time MP3 streaming ──
// Runs in server.ts context so relay state is always accessible. Uses
// res.write() directly to avoid Next.js ReadableStream buffering.
function handleLive(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const m = url.pathname.match(LIVE_RE);
  if (!m) { res.writeHead(404).end(); return; }
  const zoneId = m[1];
  const relayId = url.searchParams.get("r");

  const sink = {
    write(chunk: Buffer) {
      try { return res.write(chunk); } catch { cleanup(); return false; }
    },
    end() { try { res.end(); } catch {} },
  };

  function cleanup() {
    if (relayId) detachFromRelay(relayId, sink);
    else detachSubscriber(zoneId, sink);
  }

  let attached: { kind: RelayKind } | null;
  if (relayId) {
    if (!hasRelay(relayId)) { res.writeHead(404).end("no active broadcast"); return; }
    attached = attachToRelay(relayId, sink);
  } else {
    if (!hasAnyRelay(zoneId)) { res.writeHead(404).end("no active broadcast"); return; }
    attached = attachSubscriber(zoneId, sink);
  }
  if (!attached) { res.writeHead(404).end("no active broadcast"); return; }

  res.writeHead(200, {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-cache, no-store",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
    "X-Relay-Kind": attached.kind,
  });
  console.log(`[live] subscriber attached zone=${zoneId} relay=${relayId || "zone"} kind=${attached.kind}`);

  req.on("close", () => {
    console.log(`[live] subscriber disconnected zone=${zoneId}`);
    cleanup();
  });
}

// ── /api/zones/:id/current-source ──
async function handleCurrentSource(req: IncomingMessage, res: ServerResponse) {
  if (!isAuthenticated(req)) {
    res.writeHead(401, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "Unauthorized" }));
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
  const m = url.pathname.match(CURRENT_SOURCE_RE);
  if (!m) { res.writeHead(404).end(); return; }
  const zoneId = m[1];

  const zone = await prisma.zone.findUnique({ where: { id: zoneId } });
  if (!zone) {
    res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not found" }));
    return;
  }

  const mode = currentMode(zoneId);
  const origin = resolveOrigin(req);
  let body: Record<string, unknown>;

  if (mode === "announce") {
    const relays = announceRelaysForZone(zoneId);
    const sources = relays.map(r => ({
      url: `${origin}/api/zones/${zoneId}/live?r=${r.relayId}`,
      relayId: r.relayId,
      kind: "announce",
    }));
    body = { zoneId, zoneName: zone.name, url: sources[0]?.url ?? null, sources, live: true, mode: "announce", volume: zone.volume };
  } else if (mode === "stream") {
    const liveUrl = `${origin}/api/zones/${zoneId}/live?m=stream`;
    body = { zoneId, zoneName: zone.name, url: liveUrl, sources: [{ url: liveUrl, kind: "stream" }], live: true, mode: "stream", volume: zone.volume };
  } else {
    body = { zoneId, zoneName: zone.name, url: zone.streamUrl || process.env.AZURACAST_STREAM_URL || null, sources: [], live: false, mode: null, volume: zone.volume };
  }

  res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-cache" }).end(JSON.stringify(body));
}

async function pushConfig(socket: Socket, serial: string) {
  const device = await prisma.device.findUnique({
    where: { serial },
    include: { zone: true },
  });
  if (!device) return;
  joinZoneRoom(socket, device.zoneId);

  const zone = device.zone;
  const streamUrl =
    zone?.defaultSource === "custom_url" || zone?.defaultSource === "azuracast"
      ? zone?.streamUrl || process.env.AZURACAST_STREAM_URL || null
      : null;

  broadcastConfig(serial, {
    zone: zone
      ? { id: zone.id, name: zone.name, defaultSource: zone.defaultSource, volume: zone.volume }
      : null,
    streamUrl,
    volume: zone?.volume ?? 80,
  });
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const pathname = req.url?.split("?")[0] || "/";

    // Handle live + current-source directly — bypasses Next.js so relay state
    // is guaranteed accessible and res.write() flushes immediately.
    if (LIVE_RE.test(pathname)) return handleLive(req, res);
    if (CURRENT_SOURCE_RE.test(pathname)) return handleCurrentSource(req, res);

    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  const io = new SocketServer(httpServer, {
    path: "/ws",
    cors: { origin: "*" },
  });

  registerHub(io);

  io.use((socket, next) => {
    const auth = socket.handshake.headers["authorization"];
    const token = typeof auth === "string" ? auth.replace(/^Bearer\s+/i, "") : "";
    const serial = socket.handshake.headers["x-device-serial"];
    const hostname = socket.handshake.headers["x-device-hostname"];

    if (!DEVICE_API_KEY || token !== DEVICE_API_KEY) {
      return next(new Error("unauthorized"));
    }
    if (!serial || typeof serial !== "string") {
      return next(new Error("missing serial"));
    }
    socket.data.serial = serial;
    socket.data.hostname = typeof hostname === "string" ? hostname : serial;
    next();
  });

  io.on("connection", async (socket) => {
    const serial: string = socket.data.serial;
    const hostname: string = socket.data.hostname;
    const ip =
      (socket.handshake.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
      socket.handshake.address;

    try {
      const existing = await prisma.device.findUnique({ where: { serial } });
      if (!existing) {
        await prisma.device.create({
          data: { serial, hostname, ip, status: "unassigned", lastSeen: new Date() },
        });
      } else {
        await prisma.device.update({
          where: { serial },
          data: {
            hostname,
            ip,
            status: existing.zoneId ? "online" : "unassigned",
            lastSeen: new Date(),
          },
        });
      }

      trackSocket(serial, socket);
      await pushConfig(socket, serial);
      io.emit("device:status", { serial, online: true });
    } catch (err) {
      console.error("[hub] connect error:", err);
      socket.disconnect(true);
      return;
    }

    socket.on("status", async (payload) => {
      await prisma.device.update({
        where: { serial },
        data: { lastSeen: new Date() },
      }).catch(() => {});
      socket.broadcast.emit("device:status", { serial, ...payload });
    });

    socket.on("heartbeat", async () => {
      await prisma.device.update({
        where: { serial },
        data: { lastSeen: new Date() },
      }).catch(() => {});
    });

    socket.on("error-report", (payload) => {
      console.error(`[device ${serial}] error:`, payload);
    });

    socket.on("disconnect", async () => {
      await prisma.device
        .update({ where: { serial }, data: { status: "offline" } })
        .catch(() => {});
      io.emit("device:status", { serial, online: false });
    });
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).__io = io;

  const broadcastNs = io.of("/broadcast");
  broadcastNs.use((socket, next) => {
    if (process.env.SKIP_AUTH === "true") return next();
    const cookie = socket.handshake.headers.cookie || "";
    const appId = process.env.LOGTO_APP_ID || "";
    if (appId && cookie.includes(`logto_${appId}=`)) return next();
    next(new Error("unauthorized"));
  });
  broadcastNs.on("connection", (socket) => {
    const owned = new Map<string, { kind: RelayKind; mime: string; relayId: string }>();

    socket.on("broadcast:start", async (payload: { zoneId: string; mode?: RelayKind; mime?: string }) => {
      if (!payload?.zoneId) return;
      const kind: RelayKind = payload.mode === "announce" ? "announce" : "stream";
      const mime = typeof payload.mime === "string" ? payload.mime : "audio/webm";

      const relayId = startRelay(payload.zoneId, kind, mime);
      owned.set(payload.zoneId, { kind, mime, relayId });
      console.log(`[broadcast] started relay=${relayId} zone=${payload.zoneId} kind=${kind}`);

      try {
        const zone = await prisma.zone.findUnique({ where: { id: payload.zoneId } });
        if (!zone) return;
        const origin = resolveOrigin(socket.request);
        const url = `${origin}/api/zones/${payload.zoneId}/live?r=${relayId}`;
        sendToZone(payload.zoneId, { type: "stop" });
        sendToZone(payload.zoneId, { type: "play", url });
        sendToZone(payload.zoneId, {
          type: "volume",
          value: kind === "announce" ? Math.max(80, zone.volume) : zone.volume,
        });
      } catch (err) { console.error("[broadcast] start failed", err); }
    });

    let chunkSeen = false;
    socket.on("broadcast:chunk", (payload: { zoneId: string; chunk: ArrayBuffer | Buffer | Uint8Array }) => {
      if (!payload?.zoneId || !payload.chunk) return;
      const rec = owned.get(payload.zoneId);
      if (!rec) return;
      const src = payload.chunk as ArrayBuffer | Buffer | Uint8Array;
      const buf =
        Buffer.isBuffer(src) ? src :
        src instanceof Uint8Array ? Buffer.from(src.buffer, src.byteOffset, src.byteLength) :
        Buffer.from(new Uint8Array(src));
      if (!chunkSeen) {
        chunkSeen = true;
        console.log(`[broadcast] first chunk zone=${payload.zoneId} relay=${rec.relayId} bytes=${buf.length}`);
      }
      pushChunk(rec.relayId, rec.kind, buf);
    });

    async function teardown(zid: string, kind: RelayKind, relayId: string) {
      stopRelay(relayId, kind);
      if (kind === "announce" && announceRelaysForZone(zid).length > 0) return;
      try {
        const zone = await prisma.zone.findUnique({ where: { id: zid } });
        if (!zone) return;
        sendToZone(zid, { type: "stop" });
        if (zone.defaultSource !== "silent" && zone.streamUrl) {
          sendToZone(zid, { type: "play", url: zone.streamUrl });
          sendToZone(zid, { type: "volume", value: zone.volume });
        }
      } catch (err) { console.error("[broadcast] restore failed", err); }
    }

    socket.on("broadcast:stop", async (payload: { zoneId: string }) => {
      if (!payload?.zoneId) return;
      const rec = owned.get(payload.zoneId);
      if (!rec) return;
      owned.delete(payload.zoneId);
      await teardown(payload.zoneId, rec.kind, rec.relayId);
    });

    socket.on("disconnect", async () => {
      for (const [zid, rec] of owned.entries()) {
        await teardown(zid, rec.kind, rec.relayId);
      }
      owned.clear();
    });
  });

  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`> AHD Radio DJ ready on 0.0.0.0:${port}`);
  });
});
