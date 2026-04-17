import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasRelay } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

// Resolves what a passive listener (Lautsprecher-Modus) should play for a zone.
// Preference: active browser-broadcast relay > zone.streamUrl > null.
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const zone = await prisma.zone.findUnique({ where: { id } });
  if (!zone) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (hasRelay(id)) {
    const origin = new URL(req.url).origin;
    return NextResponse.json({
      zoneId: id,
      zoneName: zone.name,
      url: `${origin}/api/zones/${id}/live`,
      live: true,
    });
  }

  return NextResponse.json({
    zoneId: id,
    zoneName: zone.name,
    url: zone.streamUrl || process.env.AZURACAST_STREAM_URL || null,
    live: false,
  });
}
