import { prisma } from "./prisma";
import { sendToDevice, joinZoneRoom } from "./deviceHub";
import { currentMode, announceRelaysForZone } from "./broadcast";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const io = () => (global as any).__io as import("socket.io").Server | undefined;

function resolveOrigin(): string {
  if (process.env.LOGTO_BASE_URL) return process.env.LOGTO_BASE_URL.replace(/\/$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return `http://localhost:${process.env.PORT || 3000}`;
}

export async function pushConfigForDevice(serial: string) {
  const device = await prisma.device.findUnique({
    where: { serial },
    include: { zone: true },
  });
  if (!device) return;

  const server = io();
  if (server) {
    const socket = [...server.sockets.sockets.values()].find((s) => s.data.serial === serial);
    if (socket) joinZoneRoom(socket, device.zoneId);
  }

  const zone = device.zone;
  if (!zone) {
    sendToDevice(serial, { type: "stop" });
    return;
  }

  const mode = currentMode(zone.id);
  const origin = resolveOrigin();

  sendToDevice(serial, { type: "stop" });

  if (mode === "announce") {
    const relays = announceRelaysForZone(zone.id);
    if (relays.length > 0) {
      const url = `${origin}/api/zones/${zone.id}/live?r=${relays[0].relayId}`;
      sendToDevice(serial, { type: "play", url });
      sendToDevice(serial, { type: "volume", value: Math.max(80, zone.volume) });
      return;
    }
  }
  if (mode === "stream") {
    const url = `${origin}/api/zones/${zone.id}/live?m=stream`;
    sendToDevice(serial, { type: "play", url });
    sendToDevice(serial, { type: "volume", value: zone.volume });
    return;
  }

  const streamUrl =
    zone.defaultSource === "custom_url" || zone.defaultSource === "azuracast"
      ? zone.streamUrl || process.env.AZURACAST_STREAM_URL || null
      : null;
  if (streamUrl) {
    sendToDevice(serial, { type: "play", url: streamUrl });
    sendToDevice(serial, { type: "volume", value: zone.volume });
  }
}

export async function pushConfigForZone(zoneId: string) {
  const devices = await prisma.device.findMany({ where: { zoneId } });
  await Promise.all(devices.map((d) => pushConfigForDevice(d.serial)));
}
