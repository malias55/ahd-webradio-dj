// Isolated real-browser regression: synthetic audio and failing status requests.
// No account sessions, database access, providers or live station changes.
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const ts = require("typescript");
const { chromium } = require("playwright");

const player = ts.transpileModule(fs.readFileSync("src/lib/speakerMode.ts", "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const audio = execFileSync(process.env.FFMPEG_PATH || "ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100",
  "-t", "45", "-c:a", "libmp3lame", "-b:a", "128k", "-id3v2_version", "0", "-write_xing", "0", "-f", "mp3", "pipe:1",
]);
let statusCalls = 0, audioConnections = 0, browser;
const server = http.createServer((req, res) => {
  if (req.url === "/player.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" }).end(player); return;
  }
  if (req.url === "/api/zones/test/current-source") {
    statusCalls++;
    if (statusCalls === 3) { res.writeHead(503).end("temporary status outage"); return; }
    if (statusCalls === 4) { res.writeHead(200).end("invalid status JSON"); return; }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      url: "/audio.mp3", sources: [{ url: "/audio.mp3" }], live: false, volume: 50,
    })); return;
  }
  if (req.url === "/audio.mp3") {
    audioConnections++;
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
    // Four seconds of headroom followed by real-time 128-kbit/s MP3 delivery.
    let offset = 64_000;
    res.write(audio.subarray(0, offset));
    const started = performance.now();
    const timer = setInterval(() => {
      const end = Math.min(audio.length, 64_000 + Math.floor((performance.now() - started) * 16));
      res.write(audio.subarray(offset, end)); offset = end;
      if (offset >= audio.length) { clearInterval(timer); res.end(); }
    }, 100);
    res.on("close", () => clearInterval(timer)); return;
  }
  res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>Speaker playback regression</title>
    <script type="module">
      window.metrics = { elements: 0, seeks: 0, pauses: 0, errors: 0 };
      const NativeAudio = window.Audio;
      window.Audio = function() {
        const el = new NativeAudio(); window.metrics.elements++; window.testAudio = el;
        for (const [event, key] of [["seeking", "seeks"], ["pause", "pauses"], ["error", "errors"]]) {
          el.addEventListener(event, () => window.metrics[key]++);
        }
        return el;
      };
      const speaker = await import('/player.js'); window.speaker = speaker;
      await speaker.startSpeakerMode('test'); window.started = true;
    </script>`);
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=no-user-gesture-required"] });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.started && window.testAudio?.currentTime >= 16, null, { timeout: 30_000 });
  const metrics = await page.evaluate(() => ({ ...window.metrics, playedSeconds: window.testAudio.currentTime }));
  assert.equal(metrics.elements, 1); assert.equal(metrics.seeks, 0); assert.equal(metrics.pauses, 0);
  assert.equal(metrics.errors, 0); assert.equal(audioConnections, 1); assert.ok(statusCalls >= 5);
  await page.evaluate(() => window.speaker.stopSpeakerMode());
  console.log(JSON.stringify({ result: "PASS", ...metrics, audioConnections, statusCalls, simulatedStatusFailures: 2 }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  await browser?.close(); server.closeAllConnections(); server.close();
});
