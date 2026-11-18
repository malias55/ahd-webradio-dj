import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendToZone, type DeviceCommand } from "@/lib/deviceHub";
import { publishZoneVolume } from "@/lib/speaker-volume-events";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json()) as DeviceCommand;

  if (body.type === "volume" && typeof body.value === "number") {
    const volume = Math.max(0, Math.min(100, Math.round(body.value)));
    await prisma.zone.update({ where: { id }, data: { volume } });
    publishZoneVolume(id, volume);
  }

  const count = sendToZone(id, body);
  return NextResponse.json({ dispatched: count });
}
