import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendToDevice } from "@/lib/deviceHub";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device) return NextResponse.json({ error: "not found" }, { status: 404 });
  const ok = sendToDevice(device.serial, { type: "identify" });
  return NextResponse.json({ sent: ok });
}
