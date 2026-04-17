import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentMode } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Resolves what a passive listener should play. URL is stable per mode — no
// cache-busting parameter — so Lautsprecher-Modus doesn't thrash a reconnect
// on every poll. URL changes only when the actual output mode changes.
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
      url: `${origin}/api/zones/${id}/live?m=${mode}`,
      live: true,
      mode,
      volume: zone.volume,
    });
  }

  return NextResponse.json({
    zoneId: id,
    zoneName: zone.name,
    url: zone.streamUrl || process.env.AZURACAST_STREAM_URL || null,
    live: false,
    mode: null,
    volume: zone.volume,
  });
}
