import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasAnyRelay, getStreamInfo } from "@/lib/broadcast";
import { radioStatus } from "@/lib/radio/engine";
import { isOnAir } from "@/lib/radio/config";

export const dynamic = "force-dynamic";

export async function GET() {
  const zones = await prisma.zone.findMany({
    orderBy: { name: "asc" },
    include: { devices: true },
  });
  const hydrated = await Promise.all(
    zones.map(async (z) => ({
      ...z,
      liveBroadcast: hasAnyRelay(z.id),
      streamInfo: getStreamInfo(z.id),
      nowPlaying: ["radio", "azuracast"].includes(z.defaultSource) ? { online: isOnAir() && !!radioStatus().playing, title: radioStatus().playing?.title, artist: "Autohaus Dörrschuck Radio" } : null,
    })),
  );
  return NextResponse.json(hydrated);
}
