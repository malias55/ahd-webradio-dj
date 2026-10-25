import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { prepareNews, bulletinForSlot, bulletinKey, mainNewsKey } from "../src/lib/radio/news";
import { trackPlayback } from "../src/lib/radio/audit";
import { servicePresenter } from "../src/lib/radio/providers";
import { command } from "../src/lib/radio/store";
import { imagingAsset } from "../src/lib/radio/imaging";
import { mixStationId, mixDryBulletin } from "../src/lib/radio/mix";

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ahd-hourly-e2e-"));
  const slot = new Date(Date.UTC(1990 + randomInt(9), 0, 1 + randomInt(27), 7));
  const repeat = new Date(slot.getTime() + 3600_000), missing = new Date(repeat.getTime() + 86400_000);
  const mainKey = mainNewsKey(slot), keys = [mainKey, bulletinKey(slot), bulletinKey(repeat), bulletinKey(missing)];
  const ids: string[] = [], originalFetch = globalThis.fetch;
  try {
    assert.equal(await prisma.radioAsset.count({ where: { key: { in: keys } } }), 0, "choose unused test slots");
    const tonePath = join(dir, "tone.mp3");
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5:sample_rate=44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", "-y", tonePath]);
    const tone = await readFile(tonePath);
    const asset = await prisma.radioAsset.create({ data: { key: mainKey, kind: "news-main", title: "Isolated hourly service test", slot, audio: tone, duration: 1.54, script: "Test Hauptnachrichten", metadata: { editionSlot: slot.toISOString(), timeline: [{ kind: "story", start: 0, end: 1.5 }] } } });
    ids.push(asset.id);
    let ttsCalls = 0, sourceCalls = 0, now = new Date(slot.getTime() - 5 * 60_000), temperature = 12;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("api.elevenlabs.io/v1/text-to-speech/")) {
        assert.ok(url.includes(servicePresenter().voiceId), "only Jane can be synthesized for hourly service");
        assert.equal(JSON.parse(String(init?.body)).language_code, "de");
        ttsCalls++;
        return new Response(tone, { headers: { "content-type": "audio/mpeg" } });
      }
      sourceCalls++;
      if (url.includes("/current_weather?")) return Response.json({ weather: { source_id: 1, timestamp: now.toISOString(), temperature, wind_speed_10: 10, icon: "cloudy" }, sources: [{ id: 1, distance: 2000, station_name: "Mainz" }] });
      if (url.includes("api.brightsky.dev/weather?")) return Response.json({ weather: [], sources: [] });
      if (url.includes("verkehr.autobahn.de")) return Response.json(url.endsWith("/warning") ? { warning: [] } : { closure: [] });
      throw new Error(`Main editorial or male TTS must not be called: ${new URL(url).hostname}`);
    };
    await prepareNews(slot, new Date(slot.getTime() - 30 * 60_000));
    assert.equal(ttsCalls, 0); assert.equal(sourceCalls, 0, "early preparation must not collect stale service data");
    await prepareNews(slot, now);
    const original = await bulletinForSlot(slot);
    assert.ok(original); ids.push(original.id);
    now = new Date(repeat.getTime() - 5 * 60_000); temperature = 15;
    await prepareNews(repeat, now);
    const reused = await bulletinForSlot(repeat);
    assert.ok(reused); ids.push(reused.id);
    assert.notEqual(original.id, reused.id, "hourly bulletin gets new audio");
    const first = original.metadata as { mainAssetId: string; mainReused: boolean; service: { weather: { observation: { temperature: number } } } };
    const second = reused.metadata as typeof first;
    assert.equal(first.mainAssetId, asset.id); assert.equal(second.mainAssetId, asset.id);
    assert.equal(first.mainReused, false); assert.equal(second.mainReused, true);
    assert.equal(first.service.weather.observation.temperature, 12); assert.equal(second.service.weather.observation.temperature, 15);
    assert.equal(ttsCalls, 6); assert.deepEqual(Buffer.from((await prisma.radioAsset.findUniqueOrThrow({ where: { id: asset.id } })).audio), tone);
    now = new Date(missing.getTime() - 5 * 60_000);
    await prepareNews(missing, now);
    const fallback = await bulletinForSlot(missing);
    assert.ok(fallback); ids.push(fallback.id);
    assert.equal((fallback.metadata as { mainUnavailable: boolean }).mainUnavailable, true);
    assert.equal(ttsCalls, 9, "missing main part still broadcasts female service without generating a replacement main edition");
    const fallbackAudit = trackPlayback(fallback, "de", missing, 0);
    await fallbackAudit.started(); await fallbackAudit.finish("completed");
    assert.equal((await prisma.radioPlayback.findFirstOrThrow({ where: { assetId: fallback.id } })).repeated, false);
    const audit = trackPlayback(reused, "de", repeat, 2);
    await audit.started(); await audit.finish("completed");
    const row = await prisma.radioPlayback.findFirstOrThrow({ where: { assetId: reused.id } });
    assert.equal(row.repeated, true); assert.equal(row.status, "completed"); assert.equal(row.listeners, 2); assert.ok(row.endedAt);

    // Measure the actual encoded German mix: only a pure 440 Hz test voice may
    // remain inside speech intervals, including when real production jingles exist.
    const dry = await mixDryBulletin([{ audio: tone, kind: "intro" }, { audio: tone, kind: "story" }]);
    const ident = await mixStationId(tone, (await imagingAsset("station-bed")).id);
    const probes = [{ ...dry, name: "news" }, { ...ident, name: "station-id", timeline: [{ kind: "intro", start: 3.3, end: 4.8 }] }];
    for (const probe of probes) {
    const dryPath = join(dir, `${probe.name}.mp3`); await writeFile(dryPath, probe.audio);
    for (const cue of probe.timeline.filter(c => c.kind === "intro" || c.kind === "story")) {
      const pcmPath = join(dir, `${cue.kind}.pcm`);
      await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-i", dryPath, "-ss", String(cue.start + 0.4), "-t", "0.5", "-ac", "1", "-ar", "16000", "-f", "f32le", "-y", pcmPath]);
      const pcm = await readFile(pcmPath), samples = Array.from({ length: pcm.length / 4 }, (_, i) => pcm.readFloatLE(i * 4));
      const n = samples.length;
      const sin = samples.reduce((sum, x, i) => sum + x * Math.sin(2 * Math.PI * 440 * i / 16000), 0) * 2 / n;
      const cos = samples.reduce((sum, x, i) => sum + x * Math.cos(2 * Math.PI * 440 * i / 16000), 0) * 2 / n;
      const energy = samples.reduce((sum, x) => sum + x * x, 0);
      const residual = samples.reduce((sum, x, i) => sum + (x - sin * Math.sin(2 * Math.PI * 440 * i / 16000) - cos * Math.cos(2 * Math.PI * 440 * i / 16000)) ** 2, 0);
      assert.ok(Math.sqrt(residual / energy) < 0.03, `music/effects leaked into ${cue.kind}: ${Math.sqrt(residual / energy)}`);
    }
    }
    console.log("PASS original male main audio UUID preserved; two fresh hourly service audios; only female TTS, zero editorial calls; early generation deferred; missing-main fallback; journal persisted; encoded news and station-ID speech have no background music");
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.radioPlayback.deleteMany({ where: { assetId: { in: ids } } });
    await prisma.radioJob.deleteMany({ where: { key: { in: keys } } });
    await prisma.radioAsset.deleteMany({ where: { id: { in: ids } } });
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
