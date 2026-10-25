import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { prisma } from "../src/lib/prisma";
import { prepareNews, bulletinForSlot, bulletinKey } from "../src/lib/radio/news";
import { trackPlayback } from "../src/lib/radio/audit";
async function main() {
  const slot = new Date(Date.UTC(1990 + randomInt(9), 0, 1 + randomInt(27), 7));
  const repeat = new Date(slot.getTime() + 3600_000), key = bulletinKey(slot);
  assert.equal(await prisma.radioAsset.count({ where: { key } }), 0, "choose an unused test slot");
  const asset = await prisma.radioAsset.create({ data: { key, kind: "news", title: "Isolated repeat test", slot, audio: Buffer.from("fixture"), duration: 1, script: "Test" } });
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new Error("Repeat must never call any AI API"); };
    await prepareNews(repeat);
    const original = await bulletinForSlot(slot), reused = await bulletinForSlot(repeat);
    assert.equal(original?.id, asset.id); assert.equal(reused?.id, asset.id);
    assert.equal(await prisma.radioAsset.count({ where: { key } }), 1);
    const audit = trackPlayback(asset, "de", repeat, 2);
    await audit.started(); await audit.finish("completed");
    const row = await prisma.radioPlayback.findFirstOrThrow({ where: { assetId: asset.id } });
    assert.equal(row.repeated, true); assert.equal(row.status, "completed"); assert.equal(row.listeners, 2); assert.ok(row.endedAt);
    console.log("PASS exact audio UUID reused, no model/TTS calls, playback start/end and repeat journal persisted");
  } finally {
    globalThis.fetch = originalFetch;
    await prisma.radioPlayback.deleteMany({ where: { assetId: asset.id } });
    await prisma.radioJob.deleteMany({ where: { key: `repeat:${repeat.toISOString()}` } });
    await prisma.radioAsset.delete({ where: { id: asset.id } });
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
