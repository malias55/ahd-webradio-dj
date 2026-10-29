import { familyAssetAllowed } from "@/lib/radio/family";
import { isAuthorized } from "@/lib/admin";
import { audioResponse } from "@/lib/radio/audio-range";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const asset = await prisma.radioAsset.findUnique({ where: { id }, select: { audio: true, script: true, kind: true, metadata: true } });
  if (!asset) return new Response("Not found", { status: 404 });
  if (!familyAssetAllowed(asset)) return new Response("Diese Ausgabe entspricht nicht den aktuellen Inhaltsregeln.", { status: 410 });
  return audioResponse(asset.audio, req.headers.get("range"));
}
