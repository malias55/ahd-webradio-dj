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
      assert.ok(Number(stream.bit_rate) >= (name === "music" ? 320000 : 128000));
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

test("music gain remains constant across quiet and loud passages and preserves peak headroom", async () => {
  const directory = await mkdtemp(join(tmpdir(), "ahd-music-dynamics-"));
  try {
    const source = join(directory, "dynamic.wav"), encoded = join(directory, "music.mp3");
    // The alternating levels make a dynamic normalizer's pumping measurable.
    await command("ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
      "aevalsrc=0.8*sin(2*PI*440*t)*if(lt(mod(t\\,12)\\,6)\\,0.1\\,1):s=48000:d=36", "-c:a", "pcm_s24le", source]);
    const music = await normalizeMusic(await readFile(source));
    await writeFile(encoded, music.audio);
    const decoded: Buffer[] = [];
    for (const [index, path] of [source, encoded].entries()) {
      const pcm = join(directory, `decoded-${index}.pcm`);
      await command("ffmpeg", ["-v", "error", "-i", path, "-ar", "44100", "-ac", "1", "-f", "f32le", pcm]);
      decoded.push(await readFile(pcm));
    }
    const rms = (buffer: Buffer, second: number) => {
      let sum = 0;
      for (let i = second * 44100; i < (second + 1) * 44100; i++) sum += buffer.readFloatLE(i * 4) ** 2;
      return Math.sqrt(sum / 44100);
    };
    const gains = [2, 8, 14, 20, 26, 32].map(second => 20 * Math.log10(rms(decoded[1], second) / rms(decoded[0], second)));
    assert.ok(Math.max(...gains) - Math.min(...gains) < 0.15, `gain varies across passages: ${gains}`);
    let peak = 0;
    for (let i = 0; i < decoded[1].length; i += 4) peak = Math.max(peak, Math.abs(decoded[1].readFloatLE(i)));
    assert.ok(20 * Math.log10(peak) <= -2, "peaks retain headroom after MP3 encoding");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
