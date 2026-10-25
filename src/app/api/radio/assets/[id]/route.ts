import { isAuthorized } from "@/lib/admin";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAuthorized())) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const asset = await prisma.radioAsset.findUnique({ where: { id }, select: { audio: true } });
  if (!asset) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(asset.audio), { headers: { "Content-Type": "audio/mpeg", "Content-Length": String(asset.audio.length), "Cache-Control": "private, max-age=3600" } });
}
