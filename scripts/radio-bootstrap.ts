import { generateMusic } from "../src/lib/radio/providers";
import { upcomingNewsSlot } from "../src/lib/radio/config";
import { prepareNews, bulletinKey } from "../src/lib/radio/news";
import { prisma } from "../src/lib/prisma";

async function main() {
  if (process.argv.includes("--music")) {
    await generateMusic();
    const tracks = await prisma.radioAsset.findMany({ where: { kind: "music" }, select: { title: true, duration: true } });
    console.log("Music pool:", tracks);
  }
  if (process.argv.includes("--news")) {
    const slot = upcomingNewsSlot();
    if (!slot || slot.getTime() - Date.now() > 3600_000) throw new Error("Vorbereitung frühestens eine Stunde vor 07:00 oder 08:00 Uhr");
    await prepareNews(slot);
    const asset = await prisma.radioAsset.findUnique({ where: { key: bulletinKey(slot) }, select: { title: true, duration: true, script: true } });
    console.log("News preview:", asset);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
