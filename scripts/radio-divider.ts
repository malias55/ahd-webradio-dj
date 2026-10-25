import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { prisma } from "../src/lib/prisma";
import { generateGermanDivider, GERMAN_DIVIDER_KEY } from "../src/lib/radio/imaging";
async function main() {
  await generateGermanDivider();
  const asset = await prisma.radioAsset.findUniqueOrThrow({ where: { key: GERMAN_DIVIDER_KEY } });
  const path = resolve("artifacts/nachrichtentrenner-neu.mp3");
  await writeFile(path, asset.audio);
  console.log({ id: asset.id, duration: asset.duration, audio: path });
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
