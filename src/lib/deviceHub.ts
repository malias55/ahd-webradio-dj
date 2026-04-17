import type { Server as SocketServer, Socket } from "socket.io";

type DeviceCommand =
  | { type: "play"; url: string }
  | { type: "stop" }
  | { type: "volume"; value: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "identify" };

let ioRef: SocketServer | null = null;
const socketsBySerial = new Map<string, Socket>();

export function registerHub(io: SocketServer) {
  ioRef = io;
}

export function trackSocket(serial: string, socket: Socket) {
  socketsBySerial.set(serial, socket);
  socket.on("disconnect", () => {
    if (socketsBySerial.get(serial) === socket) socketsBySerial.delete(serial);
  });
}

export function isOnline(serial: string) {
  return socketsBySerial.has(serial);
}

export function onlineSerials() {
  return Array.from(socketsBySerial.keys());
}

export function sendToDevice(serial: string, cmd: DeviceCommand) {
  const s = socketsBySerial.get(serial);
  if (!s) return false;
  s.emit("command", cmd);
  return true;
}

export function sendToZone(zoneId: string, cmd: DeviceCommand) {
  if (!ioRef) return 0;
  ioRef.to(`zone:${zoneId}`).emit("command", cmd);
  // returns approximate count
  const room = ioRef.sockets.adapter.rooms.get(`zone:${zoneId}`);
  return room ? room.size : 0;
}

export function joinZoneRoom(socket: Socket, zoneId: string | null) {
  // leave all zone rooms first
  for (const room of socket.rooms) {
    if (room.startsWith("zone:")) socket.leave(room);
  }
  if (zoneId) socket.join(`zone:${zoneId}`);
}

export function broadcastConfig(serial: string, payload: unknown) {
  const s = socketsBySerial.get(serial);
  if (s) s.emit("config", payload);
}

export type { DeviceCommand };
