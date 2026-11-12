import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { command } from "../src/lib/radio/store";
import { bulletinKey, bulletinForSlot, mainNewsKey, prepareNews, GERMAN_HANDOVER } from "../src/lib/radio/news";
import { stationHour } from "../src/lib/radio/config";
import { BULLETIN_OPENER_KEY, GERMAN_OUTRO_KEY } from "../src/lib/radio/imaging";

test("paused service builds one complete daily recording from cached speech without weather, traffic or TTS requests", async t => {
  const restores: (() => void)[] = [];
  const mockMethod = (target: any, key: string, value: (...args: any[]) => any) => { const original = target[key]; target[key] = value; restores.push(() => { target[key] = original; }); };
  const dir = await mkdtemp(join(tmpdir(), "ahd-no-service-test-"));
  const before = process.env.NEWS_WEATHER_TRAFFIC_ENABLED;
  delete process.env.NEWS_WEATHER_TRAFFIC_ENABLED;
  try {
    const file = join(dir, "tone.mp3");
    await command("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-ar", "44100", "-ac", "2", "-y", file]);
    const audio = await readFile(file), slot = stationHour("2026-11-12", 8);
    const assets = new Map<string, any>([
      [mainNewsKey(slot), { id: "main", kind: "news-main", audio, duration: 1, slot, script: "Die Meldung aus Mainz. Einen angenehmen Tag.", metadata: { language: "de", stories: [{ text: "Eine Ausstellung in Mainz." }], timeline: [{ kind: "story", start: 0, end: 1 }] } }],
      [BULLETIN_OPENER_KEY, { id: "opener", audio, duration: 1 }],
      [GERMAN_OUTRO_KEY, { id: "outro", audio, duration: 1 }],
    ]);
    const find = ({ where }: any) => where.key ? assets.get(where.key) : [...assets.values()].find(a => a.id === where.id);
    let created = 0;
    t.mock.method(globalThis, "fetch", async () => { throw new Error("No provider or service request is allowed"); });
    mockMethod(prisma.radioAsset, "findUnique", async args => find(args) ?? null);
    mockMethod(prisma.radioAsset, "findUniqueOrThrow", async args => { const a = find(args); assert.ok(a); return a; });
    mockMethod(prisma.radioAsset, "create", async ({ data }: any) => { created++; const a = { id: "daily", ...data }; assets.set(data.key, a); return a; });
    mockMethod(prisma.radioJob, "findUnique", async () => null);
    mockMethod(prisma.radioJob, "createMany", async () => ({ count: 1 }));
    mockMethod(prisma.radioJob, "updateMany", async () => ({ count: 1 }));
    mockMethod(prisma.radioJob, "update", async () => ({} as any));
    assert.equal(await prepareNews(slot, stationHour("2026-11-12", 7)), true);
    for (let hour = 8; hour <= 20; hour++) {
      const repeated = stationHour("2026-11-12", hour);
      assert.equal(await prepareNews(repeated, stationHour("2026-11-12", 7)), true);
      assert.equal((await bulletinForSlot(repeated))?.id, "daily");
    }
    assert.equal(created, 1);
    const output = assets.get(bulletinKey(slot));
    assert.equal(output.metadata.weatherTrafficPaused, true);
    assert.equal(output.metadata.service, null);
    assert.equal(output.metadata.openerAssetId, "opener"); assert.equal(output.metadata.outroAssetId, "outro");
    assert.deepEqual(output.metadata.timeline.map((cue: any) => cue.kind), ["opener", "story", "closer"]);
    assert.doesNotMatch(output.script, /Wetter|Verkehr/);
    assert.ok(output.duration > 3 && output.audio.length > audio.length);
    // An old edition with a spoken handover cannot silently masquerade as the
    // new no-service edition, even when its key happens to match.
    output.metadata.weatherTrafficPaused = false;
    assert.equal(await bulletinForSlot(slot), null);
    const { renderGermanHourly } = await import("../src/lib/radio/news");
    await assert.rejects(renderGermanHourly(slot, { ...assets.get(mainNewsKey(slot)), script: GERMAN_HANDOVER }), /Übergabe/);
  } finally {
    restores.reverse().forEach(restore => restore());
    t.mock.restoreAll();
    if (before === undefined) delete process.env.NEWS_WEATHER_TRAFFIC_ENABLED; else process.env.NEWS_WEATHER_TRAFFIC_ENABLED = before;
    await rm(dir, { recursive: true, force: true });
  }
});
