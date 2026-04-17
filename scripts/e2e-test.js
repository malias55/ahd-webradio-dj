// Smoke test: simulate two Pis + a browser broadcaster + a Pi live-stream consumer.
const { io } = require("socket.io-client");

const API = "http://localhost:3000";
const KEY = "ahd-2024-s3cr3t";

function simPi(serial, hostname) {
  const s = io(API, {
    path: "/ws",
    transports: ["websocket"],
    extraHeaders: {
      Authorization: `Bearer ${KEY}`,
      "X-Device-Serial": serial,
      "X-Device-Hostname": hostname,
    },
  });
  s.on("connect",     () => console.log(`[pi:${hostname}] connected`));
  s.on("command",     (c) => console.log(`[pi:${hostname}] cmd`, c));
  s.on("connect_error", (e) => console.error(`[pi:${hostname}] err`, e.message));
  return s;
}

async function main() {
  const zones = await fetch(`${API}/api/zones`).then((r) => r.json());
  const verkauf = zones.find((z) => z.name === "Verkauf");
  if (!verkauf) throw new Error("Zone Verkauf fehlt");
  console.log(`zone=${verkauf.id}`);

  const pi1 = simPi("DEMO-CPU-VK-01", "pi-verkauf-1");
  const pi2 = simPi("DEMO-CPU-VK-02", "pi-verkauf-2");
  await new Promise((r) => setTimeout(r, 500));

  const browser = io(`${API}/broadcast`, { path: "/ws", transports: ["websocket"] });
  await new Promise((resolve, reject) => {
    browser.once("connect", resolve);
    browser.once("connect_error", reject);
  });
  console.log("[browser] connected to /broadcast");

  console.log("[test] POST /api/broadcast start...");
  const startResp = await fetch(`${API}/api/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", zoneIds: [verkauf.id], mode: "stream", mime: "audio/webm" }),
  });
  console.log("[test] broadcast start:", startResp.status, await startResp.json());

  browser.emit("broadcast:start", { zoneId: verkauf.id, mime: "audio/webm" });

  // Start consumer
  const consumerPromise = (async () => {
    console.log("[consumer] fetching live endpoint...");
    const r = await fetch(`${API}/api/zones/${verkauf.id}/live`);
    console.log(`[consumer] HTTP ${r.status} ct=${r.headers.get("content-type")}`);
    const reader = r.body.getReader();
    let total = 0;
    const start = Date.now();
    while (Date.now() - start < 3000) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      console.log(`[consumer] +${value.byteLength} B (total ${total})`);
    }
    reader.cancel();
    console.log(`[consumer] total ${total} B`);
    return total;
  })();

  // emit chunks after tiny delay so consumer is attached
  await new Promise((r) => setTimeout(r, 200));
  for (let i = 0; i < 10; i++) {
    const chunk = Buffer.from(`fake-chunk-${i}-`.padEnd(1024, "x"));
    browser.emit("broadcast:chunk", { zoneId: verkauf.id, chunk: chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) });
    await new Promise((r) => setTimeout(r, 150));
  }

  const total = await consumerPromise;

  browser.emit("broadcast:stop", { zoneId: verkauf.id });
  await fetch(`${API}/api/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "stop", zoneIds: [verkauf.id], mode: "stream" }),
  });

  pi1.close(); pi2.close(); browser.close();
  console.log(total > 0 ? "PASS" : "FAIL (0 bytes relayed)");
  process.exit(total > 0 ? 0 : 2);
}

main().catch((e) => { console.error(e); process.exit(1); });
