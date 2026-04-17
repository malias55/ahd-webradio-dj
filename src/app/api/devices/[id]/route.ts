import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushConfigForDevice } from "@/lib/serverActions";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = await req.json();
  const { zoneId } = body ?? {};

  const device = await prisma.device.update({
    where: { id },
    data: {
      zoneId: zoneId === null ? null : typeof zoneId === "string" ? zoneId : undefined,
      status: zoneId ? "online" : "unassigned",
    },
    include: { zone: true },
  });
  await pushConfigForDevice(device.serial);
  return NextResponse.json(device);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await prisma.device.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
