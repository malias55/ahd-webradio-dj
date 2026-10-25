import { generateMusic } from "../src/lib/radio/providers";
import { prepareNews } from "../src/lib/radio/news";
import { prisma } from "../src/lib/prisma";

async function main() {
  if (process.argv.includes("--music")) {
    await generateMusic();
    const tracks = await prisma.radioAsset.findMany({ where: { kind: "music" }, select: { title: true, duration: true } });
    console.log("Music pool:", tracks);
  }
  if (process.argv.includes("--news")) {
    const slot = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    await prepareNews(slot);
    const asset = await prisma.radioAsset.findUnique({ where: { key: `news:${slot.toISOString()}` }, select: { title: true, duration: true, script: true } });
    console.log("News preview:", asset);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
