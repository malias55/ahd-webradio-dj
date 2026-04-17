import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canStartAnnounce, type RelayKind } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

// Fast-fail validation + announce-lock pre-check. The actual relay lifecycle
// (spawn ffmpeg, send Pi play commands, clean up on disconnect) lives in the
// /broadcast WebSocket namespace so that a tab refresh deterministically
// releases every zone the broadcaster owned.
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = body?.action === "stop" ? "stop" : "start";
  const mode: RelayKind = body?.mode === "announce" ? "announce" : "stream";
  const zoneIds: string[] = Array.isArray(body?.zoneIds) ? body.zoneIds : [];

  if (zoneIds.length === 0) {
    return NextResponse.json({ error: "zoneIds required" }, { status: 400 });
  }

  const count = await prisma.zone.count({ where: { id: { in: zoneIds } } });
  if (count !== zoneIds.length) {
    return NextResponse.json({ error: "unknown zone(s)" }, { status: 404 });
  }

  if (action === "start" && mode === "announce") {
    const gate = canStartAnnounce();
    if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 409 });
  }

  return NextResponse.json({ ok: true, zones: zoneIds, mode });
}
