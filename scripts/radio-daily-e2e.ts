import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { prepareNews, bulletinForSlot, bulletinKey, mainNewsKey, renderBulletin, TURKISH_OPENING } from "../src/lib/radio/news";
import { trackPlayback } from "../src/lib/radio/audit";
import { servicePresenter } from "../src/lib/radio/providers";
import { command } from "../src/lib/radio/store";
import { imagingAsset, turkishDividerAsset } from "../src/lib/radio/imaging";
import { mixStationId, mixDryBulletin, insertNewsDividers } from "../src/lib/radio/mix";

async function main() {
  const dir = await mkdtemp(join(tmpdir(), "ahd-hourly-e2e-"));
  const slot = new Date(Date.UTC(1990 + randomInt(9), 0, 1 + randomInt(27), 7));
  const repeat = new Date(slot.getTime() + 86400_000), missing = new Date(repeat.getTime() + 86400_000);
  const mainKey = mainNewsKey(slot), keys = [mainKey, mainNewsKey(repeat), mainNewsKey(missing), bulletinKey(slot), bulletinKey(repeat), bulletinKey(missing)];
  const ids: string[] = [], originalFetch = globalThis.fetch;
  const originalElevenKey = process.env.ELEVENLABS_API_KEY;
  const testVoice = `e2e-turkish-${randomUUID()}`, originalTurkishVoice = process.env.ELEVENLABS_TURKISH_VOICE_ID;
  const testServiceVoice = `e2e-service-${randomUUID()}`, originalServiceVoice = process.env.ELEVENLABS_SERVICE_VOICE_ID;
  process.env.ELEVENLABS_SERVICE_VOICE_ID = testServiceVoice;
  try {
    assert.equal(await prisma.radioAsset.count({ where: { key: { in: keys } } }), 0, "choose unused test slots");
    const tonePath = join(dir, "tone.mp3");
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5:sample_rate=44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k", "-y", tonePath]);
    const tone = await readFile(tonePath);
    const blockedSlot = new Date(slot.getTime() - 3600_000), blockedKey = bulletinKey(blockedSlot);
    keys.push(blockedKey);
    process.env.ELEVENLABS_API_KEY = `e2e-quota-${randomUUID()}`;
    let quotaChecks = 0;
    globalThis.fetch = async input => {
      assert.equal(String(input), "https://api.elevenlabs.io/v1/user/subscription", "empty quota must stop before editorial, source or TTS requests"); quotaChecks++;
      return Response.json({ character_count: 121198, character_limit: 121305, max_credit_limit_extension: 0 });
    };
    await assert.rejects(prepareNews(blockedSlot), /107 Credits/);
    assert.equal(quotaChecks, 1);
    assert.match((await prisma.radioJob.findUniqueOrThrow({ where: { key: blockedKey } })).error || "", /Guthaben/);
    if (originalElevenKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalElevenKey;
    const asset = await prisma.radioAsset.create({ data: { key: mainKey, kind: "news-main", title: "Isolated hourly service test", slot, audio: tone, duration: 1.54, script: "Test Hauptnachrichten", metadata: { editionSlot: slot.toISOString(), timeline: [{ kind: "story", start: 0, end: 1.5 }] } } });
    ids.push(asset.id);
    const secondMain = await prisma.radioAsset.create({ data: { key: mainNewsKey(repeat), kind: "news-main", title: "Isolated next-day edition", slot: repeat, audio: tone, duration: 1.54, script: "Test Hauptnachrichten", metadata: { editionSlot: repeat.toISOString(), timeline: [{ kind: "story", start: 0, end: 1.5 }] } } });
    ids.push(secondMain.id);
    let ttsCalls = 0, sourceCalls = 0, now = new Date(slot.getTime() - 5 * 60_000), temperature = 12;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/v1/user/subscription")) return Response.json({ character_count: 100, character_limit: 100000, max_credit_limit_extension: 0 });
      if (url.includes("api.elevenlabs.io/v1/text-to-speech/")) {
        assert.ok(url.includes(servicePresenter().voiceId), "only the selected service presenter can be synthesized for weather/traffic");
        assert.equal(JSON.parse(String(init?.body)).language_code, "de");
        assert.equal(JSON.parse(String(init?.body)).voice_settings.speed, 1.06);
        assert.equal(JSON.parse(String(init?.body)).voice_settings.stability, 0.4);
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
    assert.equal(((original.metadata as { timeline: { kind: string }[] }).timeline).filter(c => ["divider", "opener", "closer"].includes(c.kind)).length, 1, "German news must contain only one final closing sound");
    now = new Date(repeat.getTime() - 5 * 60_000); temperature = 15;
    await prepareNews(repeat, now);
    const reused = await bulletinForSlot(repeat);
    assert.ok(reused); ids.push(reused.id);
    assert.notEqual(original.id, reused.id, "hourly bulletin gets new audio");
    const first = original.metadata as { mainAssetId: string; mainReused: boolean; service: { weather: { observation: { temperature: number } } } };
    const second = reused.metadata as typeof first;
    assert.equal(first.mainAssetId, asset.id); assert.equal(second.mainAssetId, secondMain.id);
    assert.equal(first.mainReused, false); assert.equal(second.mainReused, false);
    assert.equal(first.service.weather.observation.temperature, 12); assert.equal(second.service.weather.observation.temperature, 15);
    assert.equal(ttsCalls, 5);
    await prepareNews(repeat, now);
    assert.equal(ttsCalls, 5, "cached morning edition must not spend more TTS");
    await assert.rejects(prepareNews(new Date(repeat.getTime() + 3600_000), now), /nur um 07 Uhr/);
    assert.equal(ttsCalls, 5, "09:00 must never generate service or main news"); assert.deepEqual(Buffer.from((await prisma.radioAsset.findUniqueOrThrow({ where: { id: asset.id } })).audio), tone);
    now = new Date(missing.getTime() - 5 * 60_000);
    await prepareNews(missing, now);
    const fallback = await bulletinForSlot(missing);
    assert.ok(fallback); ids.push(fallback.id);
    assert.equal((fallback.metadata as { mainUnavailable: boolean }).mainUnavailable, true);
    assert.equal(ttsCalls, 7, "missing main part still broadcasts female service without generating a replacement main edition");
    const fallbackAudit = trackPlayback(fallback, "de", missing, 0);
    await fallbackAudit.started(); await fallbackAudit.finish("completed");
    assert.equal((await prisma.radioPlayback.findFirstOrThrow({ where: { assetId: fallback.id } })).repeated, false);
    const audit = trackPlayback(reused, "de", repeat, 2);
    await audit.started(); await audit.finish("completed");
    const row = await prisma.radioPlayback.findFirstOrThrow({ where: { assetId: reused.id } });
    assert.equal(row.repeated, false); assert.equal(row.status, "completed"); assert.equal(row.listeners, 2); assert.ok(row.endedAt);

    // Measure the actual encoded German mix: only a pure 440 Hz test voice may
    // remain inside speech intervals, including when real production jingles exist.
    const turkishFetch = globalThis.fetch;
    const trRequests: string[] = [];
    process.env.ELEVENLABS_TURKISH_VOICE_ID = testVoice;
    globalThis.fetch = async (input, init) => {
      if (String(input).includes("api.elevenlabs.io/v1/text-to-speech/")) {
        const request = JSON.parse(String(init?.body));
        assert.equal(request.language_code, "tr");
        trRequests.push(request.text);
        return new Response(tone, { headers: { "content-type": "audio/mpeg" } });
      }
      return turkishFetch(input, init);
    };
    const trSlot = new Date(slot.getTime() - 3600_000);
    const trContent = { stories: [{ text: "TRT’nin yeni yayını.", sourceIds: [1] }, { text: "Yeni kültür etkinliği.", sourceIds: [1] }, { text: "Bilim müzesinden yeni sergi.", sourceIds: [1] }], sources: [], modelCalls: [], language: "tr" as const, editionSlot: trSlot.toISOString() };
    const turkish = await renderBulletin(trSlot, trContent);
    const firstRequestCount = trRequests.length;
    await renderBulletin(trSlot, trContent);
    assert.equal(trRequests.length - firstRequestCount, 3, "static intro, outro and invocation must be cached; only stories get new TTS");
    assert.ok(trRequests.includes("TERETE’nin yeni yayını."));
    assert.ok(trRequests.some(t => t.includes("Autohaus Dörşuk")));
    assert.equal(turkish.metadata.backgroundMusic, false);
    const activeDivider = await turkishDividerAsset();
    assert.deepEqual(turkish.metadata.timeline.filter(c => ["opener", "closer", "divider"].includes(c.kind)).map(c => c.kind), activeDivider ? ["opener", "divider", "divider", "closer"] : ["opener", "closer"], "a pending replacement must use clean pauses; active signatures stay between complete stories");
    assert.equal(turkish.metadata.dividerVersion === null, !activeDivider);
    assert.ok(turkish.script.startsWith(TURKISH_OPENING));
    assert.match(turkish.script, /TERETE/);
    const speechKinds = new Set(["invocation", "intro", "story", "outro"]);
    for (const voice of turkish.metadata.timeline.filter(c => speechKinds.has(c.kind))) for (const music of turkish.metadata.timeline.filter(c => ["opener", "closer", "divider"].includes(c.kind)))
      assert.ok(voice.end <= music.start || music.end <= voice.start, "Turkish voice overlaps imaging");
    const dry = await mixDryBulletin([{ audio: tone, kind: "intro" }, { audio: tone, kind: "story" }]);
    const ident = await mixStationId(tone, (await imagingAsset("station-bed")).id);
    const germanAudio = (await prisma.radioAsset.findUniqueOrThrow({ where: { id: original.id }, select: { audio: true } })).audio;
    const historicalDivider = activeDivider || await prisma.radioAsset.findUniqueOrThrow({ where: { key: "imaging:tr-original-divider-v2" } });
    const divided = activeDivider ? { ...turkish, timeline: turkish.metadata.timeline } : await insertNewsDividers({ ...turkish, timeline: turkish.metadata.timeline }, historicalDivider);
    const probes = [{ ...dry, name: "news" }, { audio: germanAudio, timeline: (original.metadata as { timeline: { kind: string; start: number; end: number }[] }).timeline, name: "german-final" }, { ...turkish, timeline: turkish.metadata.timeline, name: "turkish" }, { ...divided, name: "turkish-with-signatures" }, { ...ident, name: "station-id", timeline: [{ kind: "intro", start: 3.3, end: 4.8 }] }];
    for (const probe of probes) {
    const dryPath = join(dir, `${probe.name}.mp3`); await writeFile(dryPath, probe.audio);
    for (const cue of probe.timeline.filter(c => ["invocation", "intro", "story", "weather", "traffic", "outro"].includes(c.kind))) {
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
    console.log("PASS daily morning editions, cached generation, no 09:00 purchases, early service deferred, missing-main fallback, journal persisted; encoded German, Turkish and station-ID speech contain no background music");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalElevenKey === undefined) delete process.env.ELEVENLABS_API_KEY;
    else process.env.ELEVENLABS_API_KEY = originalElevenKey;
    if (originalTurkishVoice === undefined) delete process.env.ELEVENLABS_TURKISH_VOICE_ID;
    else process.env.ELEVENLABS_TURKISH_VOICE_ID = originalTurkishVoice;
    if (originalServiceVoice === undefined) delete process.env.ELEVENLABS_SERVICE_VOICE_ID;
    else process.env.ELEVENLABS_SERVICE_VOICE_ID = originalServiceVoice;
    const staticFixtures = await prisma.radioAsset.findMany({ where: { OR: [{ metadata: { path: ["voiceId"], equals: testVoice } }, { metadata: { path: ["voiceId"], equals: testServiceVoice } }] }, select: { id: true, key: true } });
    ids.push(...staticFixtures.map(a => a.id)); keys.push(...staticFixtures.map(a => a.key));
    await prisma.radioPlayback.deleteMany({ where: { assetId: { in: ids } } });
    await prisma.radioJob.deleteMany({ where: { key: { in: keys } } });
    await prisma.radioAsset.deleteMany({ where: { id: { in: ids } } });
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
