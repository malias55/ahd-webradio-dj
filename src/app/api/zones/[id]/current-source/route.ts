import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentMode } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Resolves what a passive listener (Lautsprecher-Modus) should play.
// Priority: active Durchsage (announce) > Tab-Audio (stream) > zone.streamUrl.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const zone = await prisma.zone.findUnique({ where: { id } });
  if (!zone) return NextResponse.json({ error: "not found" }, { status: 404 });

  const mode = currentMode(id);
  if (mode) {
    const origin = new URL(req.url).origin;
    return NextResponse.json({
      zoneId: id,
      zoneName: zone.name,
      url: `${origin}/api/zones/${id}/live?t=${Date.now()}`,
      live: true,
      mode,
    });
  }

  return NextResponse.json({
    zoneId: id,
    zoneName: zone.name,
    url: zone.streamUrl || process.env.AZURACAST_STREAM_URL || null,
    live: false,
    mode: null,
  });
}
