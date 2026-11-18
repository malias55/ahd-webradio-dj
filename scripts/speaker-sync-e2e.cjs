// Real-browser regression for synchronized speaker playback.
// Two separate browser contexts play the real SpeakerStream through the real
// player. One of them has a bursty, delayed network. The test measures how far
// the audible position of each device is from the server's playout clock, then
// injects faults: dropped connections, a stalled source, a server restart.
// Synthetic audio only: no database, accounts, providers or live programme.
// Run after `npm run build`: node scripts/speaker-sync-e2e.cjs
const { createServer } = require("node:http");
const { readFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const assert = require("node:assert/strict");
const ts = require("typescript");
const { chromium } = require("playwright");
const { SpeakerStream, Mp3Frames, speakerTime } = require("../dist/src/lib/speaker-stream");

const compile = file => ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const frames = new Mp3Frames().push(execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=10", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "0", "-write_xing", "0", "-f", "mp3", "pipe:1"]));
const silence = new Mp3Frames().push(readFileSync("public/audio/speaker-silence.mp3"));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let stallUntil = 0, downUntil = 0, streamRequests = 0;
const responses = new Set();
let stream;
function zoneStream() {
  return stream ??= new SpeakerStream(async () => ["synthetic"], silence, () => { stream = undefined; }, (_urls, data) => {
    let index = 0;
    const started = performance.now();
    // Paced like FFmpeg -re: by timestamp, with the timer jitter of a real process.
    const timer = setInterval(() => {
      const due = Math.floor((performance.now() - started) / (1152 / 44.1));
      if (Date.now() < stallUntil) { index = due; return; }
      while (index < due) data(frames[index++ % frames.length]);
    }, 20);
    return () => clearInterval(timer);
  });
}

const server = createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  const slow = (req.headers.cookie || "").includes("slow=1");
  if (Date.now() < downUntil && url.pathname.startsWith("/api/")) { res.writeHead(503).end("restarting"); return; }
  if (url.pathname.startsWith("/m/")) { res.writeHead(200, { "Content-Type": "text/javascript" }).end(compile(`src/lib/${url.pathname.slice(3)}.ts`)); return; }
  if (url.pathname === "/api/speaker-time") {
    const reply = (body = JSON.stringify(speakerTime())) => res.writeHead(200, { "Content-Type": "application/json" }).end(body);
    // The slow device has 40 ms of latency each way plus random jitter. The
    // server reads its clock between the two legs of the journey.
    if (slow) setTimeout(() => { const body = JSON.stringify(speakerTime()); setTimeout(() => reply(body), 40 + Math.random() * 30); }, 40 + Math.random() * 30); else reply();
    return;
  }
  if (url.pathname.endsWith("/volume-events")) { res.writeHead(204).end(); return; }
  if (url.pathname.endsWith("/current-source")) {
    res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ speakerUrl: "https://other-host.invalid/speaker-stream", speakerStatus: stream?.status(), volume: 15 }));
    return;
  }
  if (url.pathname.endsWith("/speaker-stream")) {
    streamRequests++; responses.add(res); res.once("close", () => responses.delete(res));
    const head = timeline => {
      res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Speaker-Timeline": [timeline.instance, timeline.epoch.toFixed(3), timeline.firstFrame, timeline.delayMs].join(";") });
      res.flushHeaders();
    };
    if (!slow) { zoneStream().attach(res, head); return; }
    // Bursty mobile network: audio is held back and released every 600 ms.
    let held = [];
    const timer = setInterval(() => { if (held.length) { res.write(Buffer.concat(held)); held = []; } }, 600);
    res.once("close", () => clearInterval(timer));
    zoneStream().attach({
      get destroyed() { return res.destroyed; },
      write(chunk) { held.push(chunk); return true; },
      end: () => res.end(), destroy: () => res.destroy(),
      once: (event, listener) => res.once(event, listener),
    }, head);
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html" }).end(`<!doctype html><meta charset="utf-8"><title>Speaker synchronization</title>
    <button id="start">Start</button><button id="resume">Ton freigeben</button>
    <script type="module">
      window.events = { waiting: 0, seeking: 0, error: 0 };
      const NativeAudio = window.Audio;
      window.Audio = function() {
        const el = new NativeAudio(); window.testAudio = el;
        for (const name of Object.keys(window.events)) el.addEventListener(name, () => window.events[name]++);
        return el;
      };
      const speaker = await import("/m/speakerMode"); window.speaker = speaker;
      speaker.attachSpeakerLifecycle(window);
      document.querySelector("#start").onclick = () => speaker.startSpeakerMode("test");
      document.querySelector("#resume").onclick = () => speaker.resumeSpeakerPlayback();
      window.ready = true;
    </script>`);
});

// Distance between what the device plays and what the server clock demands,
// measured against this machine's wall clock rather than the player's own estimate.
const deviation = page => page.evaluate(origin => {
  const sync = window.speaker.activeSpeakerSync();
  if (!sync || sync.audibleServerTime === null) return null;
  return sync.audibleServerTime - (performance.timeOrigin + performance.now() - origin);
}, performance.timeOrigin);

async function measure(pages, seconds) {
  const rows = [];
  for (let end = Date.now() + seconds * 1000; Date.now() < end; await wait(200)) {
    const values = await Promise.all(pages.map(deviation));
    if (values.every(value => value !== null)) rows.push(values);
  }
  assert.ok(rows.length > seconds * 3, "players report a synchronized position");
  const worst = pages.map((_, i) => Math.max(...rows.map(row => Math.abs(row[i]))));
  const mean = pages.map((_, i) => rows.reduce((sum, row) => sum + row[i], 0) / rows.length);
  const apart = Math.max(...rows.map(row => Math.max(...row) - Math.min(...row)));
  return { worst: worst.map(Math.round), mean: mean.map(Math.round), apart: Math.round(apart) };
}
const state = page => page.evaluate(() => {
  const w = window;
  return { status: w.speaker.activeSpeakerPlaybackStatus(), ...w.speaker.activeSpeakerSync(), ...w.events, time: w.testAudio?.currentTime };
});
const playing = (page, timeout = 20_000) => page.waitForFunction(() => {
  const w = window;
  const sync = w.speaker.activeSpeakerSync();
  return w.speaker.activeSpeakerPlaybackStatus() === "playing" && !!sync?.synchronized && sync.errorMs !== null && Math.abs(sync.errorMs) < 60;
}, null, { timeout });

async function main() {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ["--autoplay-policy=document-user-activation-required"] });
  const pages = [];
  try {
    for (const slow of [false, true]) {
      const context = await browser.newContext();
      if (slow) await context.addCookies([{ name: "slow", value: "1", url: origin }]);
      const page = await context.newPage();
      await page.goto(origin);
      await page.waitForFunction(() => window.ready);
      pages.push(page);
    }
    const [a, b] = pages;
    await a.click("#start");
    await wait(4000);
    // The second device joins later and must land on the same position.
    await b.click("#start");
    await Promise.all(pages.map(page => playing(page)));
    await wait(3000);
    const before = await Promise.all(pages.map(state));
    const steady = await measure(pages, 20);
    const after = await Promise.all(pages.map(state));
    console.log(JSON.stringify({ phase: "steady", ...steady, seeks: after.map((s, i) => Number(s.seeks) - Number(before[i].seeks)), underruns: after.map((s, i) => Number(s.waiting) - Number(before[i].waiting)), rate: after.map(s => s.rate) }));
    assert.ok(steady.apart <= 40, `devices stay within 40 ms of each other (${steady.apart} ms)`);
    assert.ok(steady.worst.every(value => value <= 40), "each device follows the server clock");
    after.forEach((s, i) => {
      assert.equal(Number(s.seeks) - Number(before[i].seeks), 0, "steady playback never seeks");
      assert.equal(Number(s.waiting) - Number(before[i].waiting), 0, "steady playback never underruns");
      assert.equal(s.error, 0);
    });
    assert.equal(streamRequests, 2, "one connection per device");

    // A dropped connection reconnects and returns to the same position.
    for (const response of [...responses]) response.destroy();
    await wait(1500);
    await Promise.all(pages.map(page => playing(page)));
    await wait(2500);
    const dropped = await measure(pages, 6);
    console.log(JSON.stringify({ phase: "connection-drop", ...dropped, streamRequests }));
    assert.ok(dropped.apart <= 40 && dropped.worst.every(value => value <= 40), "devices resynchronize after a network drop");

    // A stalled source is bridged by the server with silence; devices keep playing in step.
    stallUntil = Date.now() + 5000;
    const stalled = await measure(pages, 9);
    console.log(JSON.stringify({ phase: "source-stall", ...stalled, diagnostics: stream?.diagnostics() }));
    assert.ok(stalled.apart <= 40, "a source stall does not separate the devices");
    assert.ok((await Promise.all(pages.map(state))).every(s => s.status === "playing" || s.status === "buffering"));

    // A deployment: every request fails for a while and the timeline restarts.
    downUntil = Date.now() + 8000;
    stream?.close(); stream = undefined;
    for (const response of [...responses]) response.destroy();
    await wait(4500);
    const during = await Promise.all(pages.map(state));
    assert.ok(during.every(s => s.status === "reconnecting"), `an outage is reported honestly (${during.map(s => s.status)})`);
    await wait(4000);
    await Promise.all(pages.map(page => playing(page, 25_000)));
    await wait(2500);
    const restarted = await measure(pages, 6);
    const final = await Promise.all(pages.map(state));
    console.log(JSON.stringify({ phase: "server-restart", ...restarted, rebuilds: final.map(s => s.rebuilds), connections: final.map(s => s.connections) }));
    assert.ok(restarted.apart <= 40 && restarted.worst.every(value => value <= 40), "devices resynchronize after a deployment");
    assert.ok(final.every(s => s.error === 0), "the media element never failed");

    const requestsBeforePause = streamRequests;
    await a.evaluate(() => { window.testAudio.pause(); });
    // A pause the user did not request (audio focus loss) resumes by itself.
    await a.waitForFunction(() => !window.testAudio.paused, null, { timeout: 15_000 });
    await wait(1500);
    await playing(a, 15_000);
    await wait(2500);
    const resumed = await measure(pages, 4);
    console.log(JSON.stringify({ phase: "system-pause", ...resumed, newRequests: streamRequests - requestsBeforePause }));
    assert.ok(resumed.apart <= 40, "a device paused by the system rejoins in step");

    // After a reload the browser may demand a gesture. The remembered zone is
    // restored, the block is shown, and one tap rejoins the shared position.
    await a.reload();
    await a.waitForFunction(() => window.ready);
    await a.waitForFunction(() => ["blocked", "playing"].includes(window.speaker.activeSpeakerPlaybackStatus()), null, { timeout: 15_000 });
    const restored = (await state(a)).status;
    if (restored === "blocked") await a.click("#resume");
    await playing(a, 20_000);
    await wait(2500);
    const reloaded = await measure(pages, 4);
    console.log(JSON.stringify({ phase: "page-reload", ...reloaded, gestureRequired: restored === "blocked" }));
    assert.ok(reloaded.apart <= 40, "a reloaded device rejoins in step");

    await a.evaluate(() => window.speaker.stopSpeakerMode());
    const requestsAfterStop = streamRequests;
    await wait(3000);
    assert.equal(streamRequests, requestsAfterStop, "stop ends all reconnect work");
    assert.equal(responses.size, 1, "stop closes the stream connection");
    console.log(JSON.stringify({ result: "PASS" }));
  } catch (error) {
    console.error(error);
    for (const page of pages) console.error(await state(page).catch(() => "page unavailable"));
    console.error(stream?.diagnostics());
    process.exitCode = 1;
  } finally {
    await browser.close(); stream?.close(); server.closeAllConnections(); server.close();
  }
}
void main();
