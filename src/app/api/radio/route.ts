import { familyAssetAllowed } from "@/lib/radio/family";
import { NextResponse } from "next/server";
import { isAdmin, isAuthorized } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { radioStatus } from "@/lib/radio/engine";
import { upcomingNewsSlot, publicOrigin, stationTime, stationDayBounds } from "@/lib/radio/config";
import { normalizeAudio } from "@/lib/radio/store";
import { randomUUID } from "node:crypto";
import { presenterForSlot, servicePresenter } from "@/lib/radio/providers";

export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  if (!(await isAuthorized())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const day = new URL(req.url).searchParams.get("day") || stationTime().date;
  let range;
  try { range = stationDayBounds(day); } catch { return NextResponse.json({ error: "Ungültiges Datum" }, { status: 400 }); }
  const [assets, jobs, playbacks] = await Promise.all([
    prisma.radioAsset.findMany({ where: { OR: [{ kind: { notIn: ["news", "news-main", "demo-part"] } }, { kind: { in: ["news", "news-main"] }, createdAt: { gte: range.start, lt: range.end } }] }, orderBy: { createdAt: "desc" }, take: 150,
      select: { id: true, kind: true, title: true, duration: true, slot: true, script: true, metadata: true, createdAt: true } }),
    prisma.radioJob.findMany({ where: { updatedAt: { gte: range.start, lt: range.end } }, orderBy: { updatedAt: "desc" }, take: 50, select: { key: true, status: true, error: true, attempts: true, updatedAt: true } }),
    prisma.radioPlayback.findMany({ where: { startedAt: { gte: range.start, lt: range.end } }, orderBy: { startedAt: "desc" }, take: 500 }),
  ]);
  const failures = jobs.filter(j => j.status === "failed").slice(0, 5);
  return NextResponse.json({ ...radioStatus(), day, assets: assets.filter(familyAssetAllowed), failures, jobs, playbacks, generationEnabled: false,
    configured: { elevenlabs: !!process.env.ELEVENLABS_API_KEY, edenai: !!process.env.EDENAI_API_KEY },
    region: process.env.NEWS_REGION || "Mainz und Rheinhessen", model: process.env.EDENAI_MODEL || "gpt-6-luna",
    newsRefreshHours: 24, serviceRefreshHours: 24, nextPresenter: upcomingNewsSlot() ? `${presenterForSlot(upcomingNewsSlot()!).name}${stationTime(upcomingNewsSlot()!).hour === 7 ? "" : ` · ${servicePresenter().name} für Wetter und Verkehr`}` : null });
}

export async function POST(req: Request) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const origin = req.headers.get("origin");
  if (origin && origin !== publicOrigin() && origin !== new URL(req.url).origin) return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    if (Number(req.headers.get("content-length")) > 21_000_000) return NextResponse.json({ error: "Maximal 20 MB" }, { status: 413 });
    if (await prisma.radioAsset.count({ where: { kind: "music" } }) >= 24) return NextResponse.json({ error: "Musikpool voll (24 Titel)" }, { status: 409 });
    const form = await req.formData();
    const file = form.get("audio");
    if (!(file instanceof File) || file.size > 20_000_000 || !file.size) return NextResponse.json({ error: "Audiodatei fehlt oder ist größer als 20 MB" }, { status: 400 });
    try {
      const audio = await normalizeAudio(Buffer.from(await file.arrayBuffer()));
      const title = String(form.get("title") || file.name).slice(0, 100);
      await prisma.radioAsset.create({ data: { key: `import:${randomUUID()}`, kind: "music", title, ...audio, metadata: { imported: true } } });
      return NextResponse.json({ ok: true });
    } catch { return NextResponse.json({ error: "Audiodatei konnte nicht verarbeitet werden" }, { status: 422 }); }
  }
  // Manual generation is available only through server-side maintenance scripts.
  // Removing buttons alone would leave the paid provider calls reachable.
  return NextResponse.json({ error: "Generierungen werden ausschließlich im Backend verwaltet." }, { status: 403 });
}
