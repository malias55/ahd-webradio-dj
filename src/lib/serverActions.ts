import { prisma } from "./prisma";
import { sendToDevice, joinZoneRoom } from "./deviceHub";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const io = () => (global as any).__io as import("socket.io").Server | undefined;

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
  const streamUrl =
    zone?.defaultSource === "custom_url" || zone?.defaultSource === "azuracast"
      ? zone?.streamUrl || process.env.AZURACAST_STREAM_URL || null
      : null;

  sendToDevice(serial, { type: "stop" });
  if (streamUrl) {
    sendToDevice(serial, { type: "play", url: streamUrl });
    sendToDevice(serial, { type: "volume", value: zone?.volume ?? 80 });
  }
}

export async function pushConfigForZone(zoneId: string) {
  const devices = await prisma.device.findMany({ where: { zoneId } });
  await Promise.all(devices.map((d) => pushConfigForDevice(d.serial)));
}
