import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isAuthorized } from "@/lib/admin";
import { currentMode } from "@/lib/broadcast";
import { pushConfigForZone } from "@/lib/serverActions";
import { stationDayBounds, stationTime, newsAllowedOn } from "@/lib/radio/config";
import { familyAssetAllowed } from "@/lib/radio/family";
import { assetFile } from "@/lib/radio/store";
import { startZoneNews, stopZoneNews } from "@/lib/radio/zone-news";

type Context = { params: Promise<{ id: string }> };
const failure = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request, { params }: Context) {
  if (!(await isAuthorized())) return failure("Bitte erneut anmelden.", 401);
  if (!newsAllowedOn()) return failure("Sonntags werden keine Nachrichten gesendet.", 409);
  const { id } = await params;
  const data = await request.json().catch(() => null);
  if (data?.language !== "tr" && data?.language !== "de") return failure("Ungültige Sprache.", 400);
  const zone = await prisma.zone.findUnique({ where: { id }, select: { defaultSource: true } });
  if (!zone) return failure("Zone nicht gefunden.", 404);
  if (currentMode(id)) return failure("In dieser Zone läuft gerade eine Live-Quelle.", 409);
  const now = new Date(), day = stationDayBounds(stationTime(now).date);
  const editions = await prisma.radioAsset.findMany({
    where: { kind: "news", slot: { gte: day.start, lt: day.end }, metadata: { path: ["language"], equals: data.language } },
    orderBy: [{ slot: "desc" }, { createdAt: "desc" }],
    select: { id: true, kind: true, script: true, metadata: true },
  });
  const edition = editions.find(familyAssetAllowed);
  if (!edition) return failure("Für heute liegt noch keine Ausgabe in dieser Sprache vor.", 404);
  const session = startZoneNews(id, data.language, await assetFile(edition.id), ["radio", "azuracast"].includes(zone.defaultSource), () => pushConfigForZone(id));
  if (!session) return failure("In dieser Zone läuft bereits eine Wiedergabe.", 409);
  return NextResponse.json(session, { status: 201 });
}

export async function DELETE(request: Request, { params }: Context) {
  if (!(await isAuthorized())) return failure("Bitte erneut anmelden.", 401);
  const { id } = await params;
  const data = await request.json().catch(() => null);
  if (typeof data?.id !== "string") return failure("Ungültige Wiedergabe.", 400);
  if (!stopZoneNews(id, data.id)) return failure("Die Wiedergabe wurde bereits beendet.", 409);
  return new Response(null, { status: 204 });
}
