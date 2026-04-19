const fs = require("fs");
const http = require("http");
const { io } = require("socket.io-client");

async function main() {
  const API = "http://localhost:3000";
  const zones = await fetch(`${API}/api/zones`).then((r) => r.json());
  const zone = zones[0];

  const bcast = io(`${API}/broadcast`, { path: "/ws", transports: ["websocket"] });
  await new Promise((r) => bcast.once("connect", r));

  bcast.emit("broadcast:start", { zoneId: zone.id, mode: "stream", mime: "audio/webm;codecs=opus" });
  await new Promise((r) => setTimeout(r, 1500));

  // Check current-source
  const src = await fetch(`${API}/api/zones/${zone.id}/current-source`).then((r) => r.json());
  console.log("current-source:", src);

  // Check /live
  const live = await fetch(src.url || `${API}/api/zones/${zone.id}/live?m=stream`);
  console.log("live status:", live.status, live.headers.get("content-type"));

  // Feed chunks AFTER listener
  const buf = fs.readFileSync("/tmp/tone.webm");
  for (let i = 0; i < buf.length; i += 2048) {
    bcast.emit("broadcast:chunk", { zoneId: zone.id, chunk: buf.subarray(i, i + 2048).buffer.slice(buf.subarray(i, i + 2048).byteOffset) });
    await new Promise((r) => setTimeout(r, 40));
  }

  bcast.emit("broadcast:stop", { zoneId: zone.id });
  bcast.close();
}
main().catch(console.error);
