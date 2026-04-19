import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentMode, announceRelaysForZone } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const zone = await prisma.zone.findUnique({ where: { id } });
  if (!zone) return NextResponse.json({ error: "not found" }, { status: 404 });

  const mode = currentMode(id);
  const origin = new URL(req.url).origin;

  if (mode === "announce") {
    const relays = announceRelaysForZone(id);
    const sources = relays.map(r => ({
      url: `${origin}/api/zones/${id}/live?r=${r.relayId}`,
      relayId: r.relayId,
      kind: "announce" as const,
    }));
    return NextResponse.json({
      zoneId: id,
      zoneName: zone.name,
      url: sources[0]?.url ?? null,
      sources,
      live: true,
      mode: "announce",
      volume: zone.volume,
    });
  }

  if (mode === "stream") {
    const url = `${origin}/api/zones/${id}/live?m=stream`;
    return NextResponse.json({
      zoneId: id,
      zoneName: zone.name,
      url,
      sources: [{ url, kind: "stream" as const }],
      live: true,
      mode: "stream",
      volume: zone.volume,
    });
  }

  return NextResponse.json({
    zoneId: id,
    zoneName: zone.name,
    url: zone.streamUrl || process.env.AZURACAST_STREAM_URL || null,
    sources: [],
    live: false,
    mode: null,
    volume: zone.volume,
  });
}
