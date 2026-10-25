import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateNewsExample } from "../src/lib/radio/news";
import { prisma } from "../src/lib/prisma";
async function main() {
  await mkdir(resolve("artifacts"), { recursive: true });
  for (const language of ["tr", "de"] as const) {
    try {
      const asset = await generateNewsExample(language);
      const base = resolve("artifacts", language === "tr" ? "haberler-turkiye-tr" : "nachrichten-mainz-de");
      await writeFile(`${base}.mp3`, asset.audio); await writeFile(`${base}.txt`, asset.script || "");
      await writeFile(`${base}.json`, JSON.stringify({ id: asset.id, title: asset.title, createdAt: asset.createdAt, duration: asset.duration, metadata: asset.metadata }, null, 2));
      console.log({ language, id: asset.id, duration: asset.duration, audio: `${base}.mp3`, transcript: `${base}.txt` });
    } catch (e) { console.error(language, e instanceof Error ? e.message : "failed"); process.exitCode = 1; }
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
