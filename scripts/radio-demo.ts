import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { presenterForHour, servicePresenter, speech } from "../src/lib/radio/providers";
import { generateImaging, generateStationIds, imagingAsset, stationIdKey } from "../src/lib/radio/imaging";
import { mixBulletin, mixStationId } from "../src/lib/radio/mix";
import { assetFile, command, normalizeAudio } from "../src/lib/radio/store";

async function main() {
  await generateImaging();
  await generateStationIds(mixStationId);
  const male = presenterForHour(8), female = servicePresenter();
  for (const p of [male, female]) await prisma.radioAsset.updateMany({ where: { kind: "station-id", metadata: { path: ["voiceId"], equals: p.voiceId } }, data: { title: `Senderkennung · ${p.name}` } });
  const key = `demo:imaging-v1:${male.voiceId}:${female.voiceId}`;
  const destination = resolve("artifacts/ahd-radio-hoerbeispiel.mp3");
  await mkdir(resolve("artifacts"), { recursive: true });
  const existing = await prisma.radioAsset.findUnique({ where: { key } });
  if (existing) { await writeFile(destination, existing.audio); console.log({ path: destination, duration: existing.duration }); return; }
  const original = await prisma.radioAsset.findFirstOrThrow({ where: { kind: "news", script: { not: null } }, orderBy: { createdAt: "desc" } });
  const paragraphs = original.script!.split("\n\n");
  if (paragraphs.length < 7) throw new Error("Für dieses Hörbeispiel fehlt die bereits geprüfte Fünf-Themen-Ausgabe.");
  const lines = [
    { text: `Hallo aus Mainz. Ich bin ${male.name}, Ihr KI-Nachrichtenassistent bei Autohaus Dörrschuck Radio. So klingt unser neues Radiomagazin: eine KI-generierte Auswahl freundlicher Meldungen, eingebettet in gute Musik.`, presenter: male, kind: "intro" as const },
    { text: paragraphs[1], presenter: male, kind: "story" as const },
    { text: paragraphs[2], presenter: male, kind: "story" as const },
    { text: `Und ich bin ${female.name}, Ihre KI-Nachrichtenassistentin. Zur nächsten Stunde übernehme ich das Mikrofon. Hier im Hörbeispiel geht es schon jetzt mit Kultur weiter. ${paragraphs[4]}`, presenter: female, kind: "story" as const },
    { text: paragraphs[5], presenter: female, kind: "story" as const },
    { text: "Das war ein Hörbeispiel unseres KI-generierten Radiomagazins. Die Nachrichtenquellen finden Sie im Radio-Dashboard. Wir wünschen Ihnen einen entspannten Tag im Autohaus Dörrschuck. Und jetzt: zurück zur Musik.", presenter: female, kind: "outro" as const },
  ];
  const segments = [];
  for (const line of lines) segments.push({ audio: await speech(line.text, line.presenter.voiceId), kind: line.kind });
  const bulletin = await mixBulletin(segments);
  const dir = await mkdtemp(join(tmpdir(), "ahd-demo-"));
  try {
    const bulletinPath = join(dir, "bulletin.mp3"); await writeFile(bulletinPath, bulletin.audio);
    const music = await prisma.radioAsset.findFirstOrThrow({ where: { kind: "music", title: { startsWith: "Showroom Velvet" } }, select: { id: true } });
    const ident = await prisma.radioAsset.findUniqueOrThrow({ where: { key: stationIdKey(new Date("2026-10-26T08:00:00Z")) }, select: { id: true } });
    const sweep = await imagingAsset("sweep");
    const musicPath = await assetFile(music.id), output = join(dir, "demo.wav");
    const filter = "[0:a]atrim=duration=14,asetpts=PTS-STARTPTS[mi];[1:a]volume=0.3,adelay=12500:all=1[sw];[mi][sw]amix=inputs=2:duration=first:normalize=0[intro];[intro][2:a]acrossfade=d=0.65:c1=tri:c2=tri[a];[a][3:a]acrossfade=d=0.45:c1=tri:c2=tri[b];[4:a]atrim=start=50:duration=18,asetpts=PTS-STARTPTS,afade=t=out:st=15:d=3[mo];[b][mo]acrossfade=d=0.7:c1=tri:c2=tri[out]";
    await command(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-nostdin", "-i", musicPath, "-i", await assetFile(sweep.id), "-i", bulletinPath, "-i", await assetFile(ident.id), "-i", musicPath, "-filter_complex", filter, "-map", "[out]", "-ar", "44100", "-ac", "2", "-y", output]);
    const audio = await normalizeAudio(await readFile(output));
    await prisma.radioAsset.create({ data: { key, kind: "demo", title: "Hörbeispiel · Elias & Jane · Musik, Jingles und Magazin", ...audio, script: lines.map(l => `${l.presenter.name}: ${l.text}`).join("\n\n"), metadata: { example: true, aiGenerated: true, originalBulletinId: original.id, voices: [male.voiceId, female.voiceId], timeline: bulletin.timeline } } });
    await writeFile(destination, audio.audio);
    console.log({ path: destination, duration: audio.duration, bulletinDuration: bulletin.duration, voices: [male, female] });
  } finally { await rm(dir, { recursive: true, force: true }); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
