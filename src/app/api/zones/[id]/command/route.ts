import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendToZone, type DeviceCommand } from "@/lib/deviceHub";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json()) as DeviceCommand;

  if (body.type === "volume" && typeof body.value === "number") {
    await prisma.zone.update({
      where: { id },
      data: { volume: Math.max(0, Math.min(100, Math.round(body.value))) },
    });
  }

  const count = sendToZone(id, body);
  return NextResponse.json({ dispatched: count });
}
