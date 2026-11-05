import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { command } from "../src/lib/radio/store";
import { NEWS_GAIN_DB, NEWS_PLAYBACK_CODEC } from "../src/lib/radio/playback-level";
import { attachZoneNews, startZoneNews, stopAllZoneNews } from "../src/lib/radio/zone-news";

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
function levels(audio: Buffer) {
  const result = spawnSync(ffmpeg, ["-v", "error", "-i", "pipe:0", "-ar", "44100", "-ac", "2", "-f", "f32le", "pipe:1"], { input: audio, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr.toString());
  let sum = 0, peak = 0, count = 0;
  // Ignore encoder priming and use the same stable interval in every sample.
  for (let i = 44100 * 2 * 4; i < 44100 * 2 * 4 * 2; i += 4) {
    const sample = result.stdout.readFloatLE(i);
    sum += sample ** 2; peak = Math.max(peak, Math.abs(sample)); count++;
  }
  return { rms: Math.sqrt(sum / count), peak };
}

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ahd-level-test-"));
  const server = createServer((req, res) => {
    const [zone, token] = req.url!.slice(1).split("/");
    if (!attachZoneNews(zone, token, res)) res.writeHead(404).end();
  });
  try {
    const input = join(dir, "input.mp3"), output = join(dir, "output.mp3"), hot = join(dir, "hot.mp3");
    await command(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", input]);
    const original = await readFile(input), baseline = levels(original).rms;
    await command(ffmpeg, ["-v", "error", "-i", input, ...NEWS_PLAYBACK_CODEC, output]);
    const gain = 20 * Math.log10(levels(await readFile(output)).rms / baseline);
    assert.ok(Math.abs(gain - NEWS_GAIN_DB) < 0.6, `gain after MP3 encoding: ${gain}`);
    await command(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", "aevalsrc=0.95*sin(2*PI*440*t):d=3:s=44100", ...NEWS_PLAYBACK_CODEC, hot]);
    assert.ok(levels(await readFile(hot)).peak < 0.85, "hot inputs must remain safely below clipping after MP3 encoding");
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    for (const language of ["de", "tr"] as const) {
      const zone = `test-${language}`, session = startZoneNews(zone, language, input, false, async () => {});
      assert.ok(session);
      const response = await fetch(`http://127.0.0.1:${port}/${zone}/${session.id}`);
      assert.equal(response.status, 200);
      const reader = response.body!.getReader(), chunks: Buffer[] = [];
      let bytes = 0;
      while (bytes < 40_000) {
        const { value, done } = await reader.read();
        assert.ok(!done, "manual news must deliver the complete test interval");
        chunks.push(Buffer.from(value)); bytes += value.length;
      }
      await reader.cancel();
      const manualGain = 20 * Math.log10(levels(Buffer.concat(chunks)).rms / baseline);
      assert.ok(Math.abs(manualGain - gain) < 0.15, `${language} manual output must use the same gain: ${manualGain}`);
      console.log(JSON.stringify({ language, measuredGainDb: manualGain, unchangedOriginal: original.equals(await readFile(input)) }));
      assert.deepEqual(await readFile(input), original, "replaying must never accumulate gain in the stored file");
      stopAllZoneNews();
    }
    console.log("PASS actual MP3 gain, peak limiting, both manual news languages and unchanged source audio; no database or provider calls");
  } finally {
    stopAllZoneNews(); server.closeAllConnections(); server.close();
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
