import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { hasRelay } from "@/lib/broadcast";

export const dynamic = "force-dynamic";

// GET only. Zone create/delete is disabled on purpose — managed directly in Postgres.
export async function GET() {
  const zones = await prisma.zone.findMany({
    orderBy: { name: "asc" },
    include: { devices: true },
  });
  const hydrated = zones.map((z) => ({ ...z, liveBroadcast: hasRelay(z.id) }));
  return NextResponse.json(hydrated);
}
