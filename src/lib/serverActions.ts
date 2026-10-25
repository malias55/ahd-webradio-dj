import { nativeSource, publicOrigin } from "./radio/config";
import { prisma } from "./prisma";
import { sendToDevice, joinZoneRoom } from "./deviceHub";
import { currentMode, announceRelaysForZone } from "./broadcast";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const io = () => (global as any).__io as import("socket.io").Server | undefined;

const resolveOrigin = publicOrigin;

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

  const streamUrl = nativeSource(zone);
  if (streamUrl) {
    sendToDevice(serial, { type: "play", url: streamUrl });
    sendToDevice(serial, { type: "volume", value: zone.volume });
  }
}

export async function pushConfigForZone(zoneId: string) {
  const devices = await prisma.device.findMany({ where: { zoneId } });
  await Promise.all(devices.map((d) => pushConfigForDevice(d.serial)));
}
