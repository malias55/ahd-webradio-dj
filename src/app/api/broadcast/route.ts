import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendToZone } from "@/lib/deviceHub";
import { canStartAnnounce, startRelay, stopRelay, type RelayKind } from "@/lib/broadcast";

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
  const mode: RelayKind = body?.mode === "announce" ? "announce" : "stream";
  const zoneIds: string[] = Array.isArray(body?.zoneIds) ? body.zoneIds : [];

  if (zoneIds.length === 0) {
    return NextResponse.json({ error: "zoneIds required" }, { status: 400 });
  }

  const zones = await prisma.zone.findMany({ where: { id: { in: zoneIds } } });
  if (zones.length !== zoneIds.length) {
    return NextResponse.json({ error: "unknown zone(s)" }, { status: 404 });
  }

  if (action === "start") {
    // Global announce lock + cooldown — only one Durchsage at a time.
    if (mode === "announce") {
      const gate = canStartAnnounce();
      if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 409 });
    }

    for (const z of zones) {
      startRelay(z.id, mode);
      const url = liveUrl(req, z.id);
      sendToZone(z.id, { type: "play", url });
      const v = mode === "announce" ? Math.max(80, z.volume) : z.volume;
      sendToZone(z.id, { type: "volume", value: v });
    }
    return NextResponse.json({ ok: true, zones: zoneIds, mode });
  }

  // stop: only tear down the relay for the matching mode.
  // Durchsage ending must NOT end an ongoing Tab-Audio; it only demotes.
  for (const z of zones) {
    stopRelay(z.id, mode);
    // Announce ended → restore Pi playback: Tab-Audio (if still active) or native stream.
    // Stream ended → restore Pi playback: native stream.
    sendToZone(z.id, { type: "stop" });
    if (z.defaultSource !== "silent" && z.streamUrl) {
      // Pi plays the live relay again if still active, otherwise native.
      // The live endpoint 404s without an active relay so we prefer native here.
      sendToZone(z.id, { type: "play", url: z.streamUrl });
      sendToZone(z.id, { type: "volume", value: z.volume });
    }
  }
  return NextResponse.json({ ok: true });
}
