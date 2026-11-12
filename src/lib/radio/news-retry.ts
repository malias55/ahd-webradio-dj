import { prisma } from "../prisma";
import { dailyNewsPlan, newsAllowedOn, stationDayBounds, stationTime, weatherTrafficEnabled } from "./config";
import { assertNewsCredits } from "./elevenlabs";
import { familyAssetAllowed } from "./family";
import { GERMAN_NEWS_VERSION, mainNewsKey, prepareNews, renderGermanHourly } from "./news";
import { collectHourlyService } from "./service";
import { withJob } from "./store";

export type NewsRetryStatus = { state: "ready" | "running" | "available" | "paused" | "waiting" | "ended"; canRetry: boolean; message: string; assetId?: string };
const recoveryKey = (now: Date) => `news-recovery:${GERMAN_NEWS_VERSION}:de:${stationTime(now).date}`;

export async function germanNewsRetryStatus(now = new Date()): Promise<NewsRetryStatus> {
  if (!newsAllowedOn(now)) return { state: "paused", canRetry: false, message: "Sonntags werden keine Nachrichten erstellt oder gesendet." };
  const day = stationDayBounds(stationTime(now).date);
  const assets = await prisma.radioAsset.findMany({ where: { kind: "news", slot: { gte: day.start, lt: day.end }, metadata: { path: ["language"], equals: "de" } }, orderBy: { createdAt: "desc" }, select: { id: true, kind: true, metadata: true, script: true } });
  const ready = assets.find(asset => familyAssetAllowed(asset) && (weatherTrafficEnabled() || (asset.metadata as { weatherTrafficPaused?: boolean } | null)?.weatherTrafficPaused === true));
  if (ready) return { state: "ready", canRetry: false, message: "Die deutsche Ausgabe für heute ist bereit und kann in der Zonensteuerung gestartet werden.", assetId: ready.id };
  const plan = dailyNewsPlan(now).find(item => item.language === "de")!;
  if (now < plan.generateAt) return { state: "waiting", canRetry: false, message: "Die deutschen Nachrichten werden ab 07:00 Uhr vorbereitet." };
  if (now >= plan.lastBroadcast) return { state: "ended", canRetry: false, message: "Die heutige Nachrichtenzeit ist beendet. Neue deutsche Ausgaben entstehen am nächsten Sendetag ab 07:00 Uhr." };
  const jobs = await prisma.radioJob.findMany({ where: { key: { in: [recoveryKey(now), mainNewsKey(plan.firstBroadcast)] } } });
  if (jobs.some(job => job.status === "running" && job.leaseUntil && job.leaseUntil > now)) return { state: "running", canRetry: false, message: "Die deutsche Ausgabe wird gerade erstellt. Das kann einige Minuten dauern." };
  const retry = jobs.find(job => job.key === recoveryKey(now));
  if (retry?.status === "failed" && retry.leaseUntil && retry.leaseUntil > now) return { state: "available", canRetry: false, message: "Der letzte Versuch ist fehlgeschlagen. Ein neuer Versuch ist in Kürze möglich." };
  if (retry && retry.attempts >= 3) return { state: "available", canRetry: false, message: "Drei erneute Versuche sind fehlgeschlagen. Bitte die angezeigte Ursache prüfen, bevor weitere Credits verbraucht werden." };
  return { state: "available", canRetry: true, message: "Für heute fehlt noch eine fertige deutsche Ausgabe. Du kannst die Erstellung erneut versuchen." };
}

export async function retryGermanNews(now = new Date()) {
  const status = await germanNewsRetryStatus(now);
  if (!status.canRetry) return status;
  const plan = dailyNewsPlan(now).find(item => item.language === "de")!;
  const date = stationTime(now).date, key = recoveryKey(now);
  await withJob(key, async () => {
    await assertNewsCredits();
    // Only failed dependencies are released. Active leases and completed paid
    // audio remain intact; the normal job claim still serializes the scheduler.
    await prisma.radioJob.updateMany({ where: { status: "failed", OR: [
      { key: mainNewsKey(plan.firstBroadcast) },
      { key: { startsWith: `news-voice:${date}:` } },
    ] }, data: { status: "pending", attempts: 0, leaseUntil: null } });
    await prepareNews(plan.firstBroadcast);
    // The daily edition without service is already complete and ready for all
    // scheduled slots as well as manual playback. Do not assemble it twice.
    if (!weatherTrafficEnabled()) return;
    const main = await prisma.radioAsset.findUnique({ where: { key: mainNewsKey(plan.firstBroadcast) } });
    if (!main) throw new Error("Der Hauptteil ist noch nicht bereit. Bitte den Erstellungsstatus prüfen.");
    const slot = new Date();
    if (!newsAllowedOn(slot) || stationTime(slot).date !== date || slot >= plan.lastBroadcast) throw new Error("Das heutige Erstellungsfenster ist inzwischen beendet.");
    // Provide a real current edition for manual playback immediately. Scheduled
    // slots keep their own keys and refresh service data again near airtime.
    const service = weatherTrafficEnabled() ? await collectHourlyService(slot, slot) : undefined;
    const rendered = await renderGermanHourly(slot, main, false, slot, service);
    await prisma.radioAsset.create({ data: { key, kind: "news", title: "Nachrichten · Elias & Susanne · Neu erstellt", slot, ...rendered, metadata: { ...rendered.metadata, manualRecovery: true } } });
  });
  return germanNewsRetryStatus();
}
