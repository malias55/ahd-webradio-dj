import type { Server as SocketServer, Socket } from "socket.io";

type DeviceCommand =
  | { type: "play"; url: string }
  | { type: "stop" }
  | { type: "volume"; value: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "identify" }
  | { type: "announce-start"; url: string; volume: number }
  | { type: "announce-stop" };

type HubGlobal = {
  ioRef: SocketServer | null;
  socketsBySerial: Map<string, Socket>;
};

const _g = globalThis as unknown as { __ahdDeviceHub?: HubGlobal };
if (!_g.__ahdDeviceHub) {
  _g.__ahdDeviceHub = { ioRef: null, socketsBySerial: new Map() };
}
const hub = _g.__ahdDeviceHub;

export function registerHub(io: SocketServer) {
  hub.ioRef = io;
}

export function trackSocket(serial: string, socket: Socket) {
  hub.socketsBySerial.set(serial, socket);
  socket.on("disconnect", () => {
    if (hub.socketsBySerial.get(serial) === socket) hub.socketsBySerial.delete(serial);
  });
}

export function isOnline(serial: string) {
  return hub.socketsBySerial.has(serial);
}

export function onlineSerials() {
  return Array.from(hub.socketsBySerial.keys());
}

export function sendToDevice(serial: string, cmd: DeviceCommand) {
  const s = hub.socketsBySerial.get(serial);
  if (!s) return false;
  s.emit("command", cmd);
  return true;
}

export function sendToZone(zoneId: string, cmd: DeviceCommand) {
  if (!hub.ioRef) return 0;
  hub.ioRef.to(`zone:${zoneId}`).emit("command", cmd);
  const room = hub.ioRef.sockets.adapter.rooms.get(`zone:${zoneId}`);
  return room ? room.size : 0;
}

export function joinZoneRoom(socket: Socket, zoneId: string | null) {
  for (const room of socket.rooms) {
    if (room.startsWith("zone:")) socket.leave(room);
  }
  if (zoneId) socket.join(`zone:${zoneId}`);
}

export function broadcastConfig(serial: string, payload: unknown) {
  const s = hub.socketsBySerial.get(serial);
  if (s) s.emit("config", payload);
}

export type { DeviceCommand };
