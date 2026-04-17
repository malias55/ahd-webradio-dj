import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { onlineSerials } from "@/lib/deviceHub";

export const dynamic = "force-dynamic";

export async function GET() {
  const devices = await prisma.device.findMany({
    orderBy: { createdAt: "desc" },
    include: { zone: true },
  });
  const online = new Set(onlineSerials());
  const hydrated = devices.map((d) => ({
    ...d,
    online: online.has(d.serial),
  }));
  return NextResponse.json(hydrated);
}
