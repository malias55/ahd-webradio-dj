import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import { bulletinKey, renderBulletin, type EditorialContent, type Story, TURKISH_OPENING } from "../src/lib/radio/news";
import { stationDayBounds, stationTime } from "../src/lib/radio/config";

// Correct today's actual Turkish edition using its approved stories and sources.
// No editorial model calls and no fabricated playback entry for an archive repair.
async function main() {
  const day = stationTime().date, bounds = stationDayBounds(day);
  const slot = new Date(bounds.start.getTime() + 7 * 3600_000);
  const key = bulletinKey(slot);
  let corrected = await prisma.radioAsset.findUnique({ where: { key } });
  if (!corrected) {
    const source = await prisma.radioAsset.findFirstOrThrow({ where: { kind: "news", slot }, orderBy: { createdAt: "desc" } });
    const m = source.metadata as { stories?: Story[]; sources?: EditorialContent["sources"]; modelCalls?: EditorialContent["modelCalls"] };
    if (!m.stories?.length || !m.sources?.length) throw new Error("No approved Turkish stories available for reuse");
    const content: EditorialContent = { stories: m.stories, sources: m.sources, editionSlot: slot.toISOString(), language: "tr", modelCalls: [] };
    const rendered = await renderBulletin(slot, content);
    corrected = await prisma.radioAsset.create({ data: { key, kind: "news", slot, title: "Türkçe Sabah Bülteni · 7:00 Uhr · Cavit", ...rendered,
      metadata: { ...rendered.metadata, remixedFrom: source.id, correctedAt: new Date().toISOString(), correction: "Turkish pronunciation and dry speech", originalModelCalls: m.modelCalls || [] } } });
  }
  if (!corrected.script?.startsWith(TURKISH_OPENING) || (corrected.metadata as { backgroundMusic?: boolean }).backgroundMusic !== false) throw new Error("Invalid corrected edition");
  const originalId = (corrected.metadata as { remixedFrom?: string }).remixedFrom;
  if (originalId) {
    const original = await prisma.radioAsset.findUniqueOrThrow({ where: { id: originalId }, select: { metadata: true } });
    await prisma.radioAsset.update({ where: { id: originalId }, data: { metadata: { ...(original.metadata as object), supersededBy: corrected.id } } });
  }
  const germanSlot = new Date(bounds.start.getTime() + 8 * 3600_000);
  const german = await prisma.radioAsset.findUniqueOrThrow({ where: { key: bulletinKey(germanSlot) }, select: { id: true, title: true, duration: true, metadata: true } });
  await mkdir(resolve("artifacts"), { recursive: true });
  const path = resolve("artifacts", "haberler-turkiye-tr-release.mp3");
  await writeFile(path, corrected.audio);
  await writeFile(path.replace(/mp3$/, "txt"), corrected.script || "");
  console.log(JSON.stringify({ day, turkish: { id: corrected.id, duration: corrected.duration, path, opening: TURKISH_OPENING, modelCalls: 0 }, german: { id: german.id, title: german.title, duration: german.duration, reusedExistingEdition: true } }, null, 2));
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Release correction failed"); process.exitCode = 1; }).finally(() => prisma.$disconnect());
