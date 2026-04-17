import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendToZone } from "@/lib/deviceHub";
import { startRelay, stopRelay } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

function liveUrl(req: Request, zoneId: string) {
  const base =
    process.env.LOGTO_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : null) ||
    new URL(req.url).origin;
  return `${base.replace(/\/$/, "")}/api/zones/${zoneId}/live`;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action === "stop" ? "stop" : "start";
  const mode: "stream" | "announce" = body?.mode === "announce" ? "announce" : "stream";
  const mime: string = body?.mime || "audio/webm";
  const zoneIds: string[] = Array.isArray(body?.zoneIds) ? body.zoneIds : [];

  if (zoneIds.length === 0) {
    return NextResponse.json({ error: "zoneIds required" }, { status: 400 });
  }

  const zones = await prisma.zone.findMany({ where: { id: { in: zoneIds } } });
  if (zones.length !== zoneIds.length) {
    return NextResponse.json({ error: "unknown zone(s)" }, { status: 404 });
  }

  if (action === "start") {
    for (const z of zones) {
      startRelay(z.id, mime);
      const url = liveUrl(req, z.id);
      // Announcements override the current playback immediately; Pis hit the live endpoint.
      sendToZone(z.id, { type: "stop" });
      sendToZone(z.id, { type: "play", url });
      // Announce is typically loud; stream mode respects the zone volume.
      const v = mode === "announce" ? Math.max(80, z.volume) : z.volume;
      sendToZone(z.id, { type: "volume", value: v });
    }
    return NextResponse.json({ ok: true, zones: zoneIds });
  }

  // stop: close relays, restore each zone to its default stream
  for (const z of zones) {
    stopRelay(z.id);
    sendToZone(z.id, { type: "stop" });
    if (z.defaultSource !== "silent" && z.streamUrl) {
      sendToZone(z.id, { type: "play", url: z.streamUrl });
      sendToZone(z.id, { type: "volume", value: z.volume });
    }
  }
  return NextResponse.json({ ok: true });
}
