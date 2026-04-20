import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushConfigForDevice } from "@/lib/serverActions";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
