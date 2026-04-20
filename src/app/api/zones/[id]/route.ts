import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { pushConfigForZone } from "@/lib/serverActions";
import { isAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const zone = await prisma.zone.findUnique({ where: { id }, include: { devices: true } });
  if (!zone) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(zone);
}

export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await isAdmin())) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const body = await req.json();
  const { defaultSource, streamUrl, volume } = body ?? {};
  const data: Record<string, unknown> = {};
  if (typeof defaultSource === "string") data.defaultSource = defaultSource;
  if (typeof streamUrl === "string" || streamUrl === null) data.streamUrl = streamUrl;
  if (typeof volume === "number") data.volume = Math.max(0, Math.min(100, Math.round(volume)));

  const zone = await prisma.zone.update({ where: { id }, data });
  await pushConfigForZone(zone.id);
  return NextResponse.json(zone);
}
