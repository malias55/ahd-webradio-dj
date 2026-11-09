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
let statusCalls = 0, audioConnections = 0, browser, page, hungConnection = 0;
let deploymentUntil = 0;
const audioResponses = new Set();
const server = http.createServer((req, res) => {
  // This fixture exercises the HTTP fallback. Dedicated volume tests cover SSE.
  if (req.url?.endsWith("/volume-events")) { res.writeHead(204).end(); return; }
  if (req.url === "/player.js") {
    res.writeHead(200, { "Content-Type": "text/javascript" }).end(player); return;
  }
  if (req.url === "/api/zones/test/current-source") {
    statusCalls++;
    if (Date.now() < deploymentUntil) { res.writeHead(503).end("server restarting"); return; }
    if (statusCalls === 3) { res.writeHead(503).end("temporary status outage"); return; }
    if (statusCalls === 4) { res.writeHead(200).end("invalid status JSON"); return; }
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({
      url: "/audio.mp3", sources: [{ url: "/audio.mp3" }], live: false, volume: 50,
    })); return;
  }
  if (req.url === "/audio.mp3") {
    audioConnections++;
    if (Date.now() < deploymentUntil) { res.writeHead(503).end("server restarting"); return; }
    const connection = audioConnections;
    audioResponses.add(res);
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
    // Four seconds of headroom followed by real-time 128-kbit/s MP3 delivery.
    let offset = 64_000;
    res.write(audio.subarray(0, offset));
    const started = performance.now();
    const timer = setInterval(() => {
      // Keep the HTTP response open but send no more bytes: browsers need not
      // emit error/ended for this real-world silent failure.
      if (connection === hungConnection) return;
      const end = Math.min(audio.length, 64_000 + Math.floor((performance.now() - started) * 16));
      res.write(audio.subarray(offset, end)); offset = end;
      if (offset >= audio.length) { clearInterval(timer); res.end(); }
    }, 100);
    res.on("close", () => { clearInterval(timer); audioResponses.delete(res); }); return;
  }
  res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><title>Speaker playback regression</title>
    <button onclick="window.speaker.resumeSpeakerPlayback()">Ton freigeben</button>
    <script type="module">
      window.metrics = { elements: 0, loads: 0, seeks: 0, pauses: 0, errors: 0 };
      const NativeAudio = window.Audio;
      window.Audio = function() {
        const el = new NativeAudio(); window.metrics.elements++; window.testAudio = el;
        const load = el.load.bind(el);
        el.load = function() { window.metrics.loads++; return load(); };
        for (const [event, key] of [["seeking", "seeks"], ["pause", "pauses"], ["error", "errors"]]) {
          el.addEventListener(event, () => window.metrics[key]++);
        }
        return el;
      };
      const speaker = await import('/player.js'); window.speaker = speaker;
      speaker.attachSpeakerLifecycle(window);
      if (!sessionStorage.getItem('fixture-initialized')) {
        sessionStorage.setItem('fixture-initialized', 'true');
        await speaker.startSpeakerMode('test');
      }
      window.started = true;
    </script>`);
});

(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--autoplay-policy=document-user-activation-required"] });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.started && window.speaker.activeSpeakerPlaybackStatus() === "blocked", null, { timeout: 10_000 });
  await page.getByRole("button", { name: "Ton freigeben" }).click();
  console.log(JSON.stringify({ phase: "autoplay-unlock", result: "PASS" }));
  await page.waitForFunction(() => window.started && window.testAudio?.currentTime >= 16, null, { timeout: 30_000 });
  const metrics = await page.evaluate(() => ({ ...window.metrics, playedSeconds: window.testAudio.currentTime }));
  assert.equal(metrics.elements, 1); assert.equal(metrics.seeks, 0); assert.equal(metrics.pauses, 0);
  assert.equal(metrics.errors, 0); assert.equal(audioConnections, 1); assert.ok(statusCalls >= 5);
  console.log(JSON.stringify({ phase: "continuous-playback", result: "PASS", ...metrics, audioConnections, statusCalls }));

  hungConnection = audioConnections;
  await page.waitForFunction(() => window.metrics.loads >= 1 && window.testAudio.currentTime >= 3, null, { timeout: 40_000 });
  assert.equal(await page.evaluate(() => window.metrics.elements), 1, "reconnect retains the authorized element");
  assert.equal(audioConnections, 2, "stalled open response reconnects exactly once");
  assert.equal(await page.evaluate(() => window.speaker.activeSpeakerPlaybackStatus()), "playing");
  console.log(JSON.stringify({ phase: "silent-open-connection", result: "PASS", audioConnections }));

  deploymentUntil = Date.now() + 3000;
  const beforeRestart = await page.evaluate(() => ({ loads: window.metrics.loads, time: window.testAudio.currentTime }));
  for (const res of audioResponses) res.destroy();
  // Chrome can reconnect the media element itself. Native recovery or load()
  // must play beyond the original four-second buffer without replacing it.
  await page.waitForFunction(previous => window.metrics.loads > previous.loads
    ? window.testAudio.currentTime >= 4
    : window.testAudio.currentTime >= previous.time + 6, beforeRestart, { timeout: 40_000 });
  assert.ok(audioConnections >= 3, "playback resumes using a new HTTP connection");
  assert.equal(await page.evaluate(() => window.speaker.activeSpeakerPlaybackStatus()), "playing");
  assert.equal(await page.evaluate(() => window.metrics.elements), 1);
  console.log(JSON.stringify({ phase: "server-restart", result: "PASS", audioConnections, statusCalls }));

  await page.reload();
  await page.waitForFunction(() => window.started && window.speaker.activeSpeakerZone() === 'test' &&
    ['playing', 'blocked'].includes(window.speaker.activeSpeakerPlaybackStatus()), null, { timeout: 15_000 });
  const restoredStatus = await page.evaluate(() => window.speaker.activeSpeakerPlaybackStatus());
  if (restoredStatus === 'blocked') await page.getByRole('button', { name: 'Ton freigeben' }).click();
  await page.waitForFunction(() => window.testAudio.currentTime >= 3, null, { timeout: 15_000 });
  console.log(JSON.stringify({ phase: "page-reload", result: "PASS", rememberedZone: 'test', autoplayBlocked: restoredStatus === 'blocked' }));

  await page.evaluate(() => window.speaker.stopSpeakerMode());
  const stoppedConnections = audioConnections;
  await page.reload();
  await page.waitForFunction(() => window.started);
  await new Promise(resolve => setTimeout(resolve, 2500));
  assert.equal(audioConnections, stoppedConnections, "stop cancels all reconnect work");
  assert.equal(await page.evaluate(() => window.speaker.activeSpeakerZone()), null, "explicit stop survives reload");

  await browser.close();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.started && window.testAudio?.currentTime >= 2);
  await page.reload();
  await page.waitForFunction(() => window.started && window.speaker.activeSpeakerZone() === 'test' && window.testAudio?.currentTime >= 2);
  await page.evaluate(() => window.speaker.stopSpeakerMode());
  console.log(JSON.stringify({ phase: "page-reload-autoplay-permitted", result: "PASS", clicks: 0 }));
  console.log(JSON.stringify({ result: "PASS", healthyPlayback: metrics, audioConnections, statusCalls,
    checked: ["autoplay-unlock", "buffer-retention", "status-failures", "silent-open-connection", "same-element-reconnect", "server-restart", "page-reload", "page-reload-autoplay-permitted", "explicit-stop"] }));
})().catch(async error => {
  console.error(error);
  if (page) console.error(await page.evaluate(() => ({ ...window.metrics,
    status: window.speaker?.activeSpeakerPlaybackStatus(), time: window.testAudio?.currentTime,
    readyState: window.testAudio?.readyState, networkState: window.testAudio?.networkState,
    paused: window.testAudio?.paused, error: window.testAudio?.error?.message,
  })), { audioConnections, statusCalls });
  process.exitCode = 1;
}).finally(async () => {
  await browser?.close(); server.closeAllConnections(); server.close();
});
