import { createServer } from "http";
import next from "next";
import { parse } from "url";
import { Server as SocketServer, type Socket } from "socket.io";
import { prisma } from "./src/lib/prisma";
import {
  registerHub,
  trackSocket,
  joinZoneRoom,
  broadcastConfig,
} from "./src/lib/deviceHub";
import { pushChunk, startRelay, stopRelay, type RelayKind } from "./src/lib/broadcast";
import { sendToZone } from "./src/lib/deviceHub";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT || 3000);
const app = next({ dev });
const handle = app.getRequestHandler();

const DEVICE_API_KEY = process.env.DEVICE_API_KEY;
if (!DEVICE_API_KEY) {
  console.warn("[server] DEVICE_API_KEY is not set — WebSocket auth will reject all devices.");
}

// Production safety: hard-fail if SKIP_AUTH is enabled in prod.
if (!dev && process.env.SKIP_AUTH === "true") {
  console.error("[server] FATAL: SKIP_AUTH=true in production. Refusing to start.");
  process.exit(1);
}
if (!dev && process.env.LOGTO_COOKIE_SECRET && process.env.LOGTO_COOKIE_SECRET.length < 32) {
  console.warn("[server] LOGTO_COOKIE_SECRET is shorter than 32 chars — iron-session requires 32+.");
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

  // expose hub to API routes via global (Next.js server runs in same process)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).__io = io;

  // Browser broadcast namespace — uploads MediaRecorder chunks per zone.
  // Auth: Logto cookie presence (skipped when SKIP_AUTH=true).
  const broadcastNs = io.of("/broadcast");
  broadcastNs.use((socket, next) => {
    if (process.env.SKIP_AUTH === "true") return next();
    const cookie = socket.handshake.headers.cookie || "";
    const appId = process.env.LOGTO_APP_ID || "";
    if (appId && cookie.includes(`logto_${appId}=`)) return next();
    next(new Error("unauthorized"));
  });
  broadcastNs.on("connection", (socket) => {
    const activeZones = new Map<string, RelayKind>();
    // Relay lifecycle is owned by /api/broadcast (POST). This handler only
    // records the socket's zone + mode so subsequent broadcast:chunk events
    // know where to route their bytes. Avoids a race where a duplicate
    // startRelay call from the socket killed the ffmpeg process just spawned
    // by the REST call.
    socket.on("broadcast:start", (payload: { zoneId: string; mode?: RelayKind }) => {
      if (!payload?.zoneId) return;
      const mode: RelayKind = payload.mode === "announce" ? "announce" : "stream";
      activeZones.set(payload.zoneId, mode);
    });
    socket.on("broadcast:chunk", (payload: { zoneId: string; chunk: ArrayBuffer | Buffer | Uint8Array }) => {
      if (!payload?.zoneId || !payload.chunk) return;
      const kind = activeZones.get(payload.zoneId);
      if (!kind) return;
      const src = payload.chunk as ArrayBuffer | Buffer | Uint8Array;
      const buf =
        Buffer.isBuffer(src) ? src :
        src instanceof Uint8Array ? Buffer.from(src.buffer, src.byteOffset, src.byteLength) :
        Buffer.from(new Uint8Array(src));
      pushChunk(payload.zoneId, kind, buf);
    });
    socket.on("broadcast:stop", (payload: { zoneId: string }) => {
      if (!payload?.zoneId) return;
      const kind = activeZones.get(payload.zoneId);
      if (kind) stopRelay(payload.zoneId, kind);
      activeZones.delete(payload.zoneId);
    });
    // If the broadcasting browser tab closes without a clean stop,
    // close the relay and snap each Pi back to its zone's native stream.
    socket.on("disconnect", async () => {
      for (const [zid, kind] of activeZones.entries()) {
        stopRelay(zid, kind);
        try {
          const zone = await prisma.zone.findUnique({ where: { id: zid } });
          if (!zone) continue;
          sendToZone(zid, { type: "stop" });
          if (zone.defaultSource !== "silent" && zone.streamUrl) {
            sendToZone(zid, { type: "play", url: zone.streamUrl });
            sendToZone(zid, { type: "volume", value: zone.volume });
          }
        } catch (err) { console.error("[broadcast] restore failed", err); }
      }
      activeZones.clear();
    });
  });

  // Bind to 0.0.0.0 so the container's external network (Railway, Docker) can reach us.
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`> AHD Radio DJ ready on 0.0.0.0:${port}`);
    console.log(`> WebSocket path: /ws`);
  });
});
