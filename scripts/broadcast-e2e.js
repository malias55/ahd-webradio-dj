// End-to-end broadcast test.
// Simulates: a broadcaster opening /broadcast, pushing a real webm/opus file
// as 250 ms chunks, and a listener consuming /api/zones/:id/live; expects
// MP3 bytes to arrive within a few seconds.

const fs = require("fs");
const http = require("http");
const { io } = require("socket.io-client");

const API = "http://localhost:3000";
const WEBM = "/tmp/tone.webm";

async function main() {
  const zones = await fetch(`${API}/api/zones`).then((r) => r.json());
  const zone = zones[0];
  if (!zone) throw new Error("no zone seeded");
  console.log(`testing against zone=${zone.id} (${zone.name})`);

  // Connect broadcaster
  const bcast = io(`${API}/broadcast`, { path: "/ws", transports: ["websocket"] });
  await new Promise((resolve, reject) => {
    bcast.once("connect", resolve);
    bcast.once("connect_error", reject);
  });
  console.log("[broadcaster] connected");

  // Pre-check
  const pre = await fetch(`${API}/api/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", zoneIds: [zone.id], mode: "stream" }),
  });
  console.log(`[broadcaster] POST precheck ${pre.status}`);

  // Tell server socket to spawn relay
  bcast.emit("broadcast:start", { zoneId: zone.id, mode: "stream", mime: "audio/webm;codecs=opus" });
  // Give the server a moment to spawn ffmpeg.
  await new Promise((r) => setTimeout(r, 500));

  // Start listener in parallel
  let mp3Bytes = 0;
  const listenerPromise = new Promise((resolve) => {
    const req = http.get(`${API}/api/zones/${zone.id}/live?m=stream`, (res) => {
      console.log(`[listener] HTTP ${res.statusCode} ct=${res.headers["content-type"]}`);
      res.on("data", (c) => { mp3Bytes += c.length; });
      setTimeout(() => { res.destroy(); resolve(mp3Bytes); }, 5000);
    });
    req.on("error", (e) => { console.error("[listener]", e.message); resolve(0); });
  });

  // Stream the webm file as 250ms chunks
  const buf = fs.readFileSync(WEBM);
  const chunkSize = 2048;
  let sent = 0;
  for (let i = 0; i < buf.length; i += chunkSize) {
    const slice = buf.subarray(i, Math.min(buf.length, i + chunkSize));
    const ab = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
    bcast.emit("broadcast:chunk", { zoneId: zone.id, chunk: ab });
    sent += slice.byteLength;
    await new Promise((r) => setTimeout(r, 40));
  }
  console.log(`[broadcaster] sent ${sent} bytes`);

  const received = await listenerPromise;

  bcast.emit("broadcast:stop", { zoneId: zone.id });
  bcast.close();

  console.log(`[listener] received ${received} MP3 bytes`);
  console.log(received > 0 ? "PASS" : "FAIL");
  process.exit(received > 0 ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
