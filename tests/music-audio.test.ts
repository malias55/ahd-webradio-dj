import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { command, normalizeAudio, normalizeMusic } from "../src/lib/radio/store";

test("music retains a higher bitrate while remaining compatible with the stream and speech level", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ahd-music-encoding-"));
  try {
    const source = join(directory, "source.wav");
    await command("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=4:sample_rate=48000", "-c:a", "pcm_s16le", source]);
    const input = await readFile(source);
    const music = await normalizeMusic(input, 3), speech = await normalizeAudio(input, 3);
    const levels: number[] = [];
    for (const [name, asset] of [["music", music], ["speech", speech]] as const) {
      const path = join(directory, `${name}.mp3`), pcm = join(directory, `${name}.pcm`);
      await writeFile(path, asset.audio);
      const { streams: [stream] } = JSON.parse(await command("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=sample_rate,channels,bit_rate", "-of", "json", path]));
      assert.equal(stream.sample_rate, "44100");
      assert.equal(stream.channels, 2);
      assert.ok(Number(stream.bit_rate) >= (name === "music" ? 256000 : 128000));
      assert.ok(asset.duration >= 3 && asset.duration < 3.1, "duration limit and encoder padding are preserved");
      await command("ffmpeg", ["-v", "error", "-i", path, "-f", "f32le", "-ac", "1", pcm]);
      const samples = await readFile(pcm);
      let squared = 0, peak = 0;
      for (let i = 0; i < samples.length; i += 4) {
        const value = samples.readFloatLE(i);
        squared += value * value; peak = Math.max(peak, Math.abs(value));
      }
      assert.ok(peak < 1, "normalized audio decodes without clipping");
      levels.push(20 * Math.log10(Math.sqrt(squared / (samples.length / 4))));
    }
    assert.ok(Math.abs(levels[0] - levels[1]) < 0.5, "music encoding must not introduce a level jump relative to speech");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
