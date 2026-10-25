import { generateImaging, generateStationIds } from "../src/lib/radio/imaging";
import { mixStationId } from "../src/lib/radio/mix";
import { prisma } from "../src/lib/prisma";
async function main() {
  await generateImaging();
  await generateStationIds(mixStationId);
  console.log(await prisma.radioAsset.findMany({ where: { kind: { in: ["imaging", "station-id"] } }, select: { title: true, duration: true, kind: true } }));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
