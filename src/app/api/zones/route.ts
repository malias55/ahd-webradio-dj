import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasAnyRelay, getStreamInfo } from "@/lib/broadcast";
import { getAzuracastNowPlaying } from "@/lib/azuracast";

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
      nowPlaying: z.streamUrl ? await getAzuracastNowPlaying(z.streamUrl) : null,
    })),
  );
  return NextResponse.json(hydrated);
}
