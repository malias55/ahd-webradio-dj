import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { publicOrigin } from "@/lib/radio/config";
import { MusicControlError, musicLibraryChanged, playMusicNow, skipMusic } from "@/lib/radio/engine";

type Context = { params: Promise<{ id: string }> };
const failure = (error: string, status: number) => NextResponse.json({ error }, { status });

export async function POST(request: Request, { params }: Context) {
  if (!await isAdmin()) return failure("Nur Administratoren können das Radioprogramm ändern.", 403);
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin() && origin !== new URL(request.url).origin) return failure("Origin mismatch", 403);
  const { id } = await params;
  const data = await request.json().catch(() => null);
  if (!["play", "skip"].includes(data?.action) && !(data?.action === "rotation" && typeof data.enabled === "boolean")) return failure("Ungültige Aktion.", 400);
  try {
    if (data.action === "play") return NextResponse.json({ playing: await playMusicNow(id) });
    if (data.action === "skip") { await skipMusic(id); return NextResponse.json({ skipped: id }); }
    // Update just the preference atomically; preserve generation/review metadata
    // even when another request writes to the same asset concurrently.
    const changed = await prisma.$executeRaw`UPDATE radio_assets
      SET metadata = jsonb_set(COALESCE(NULLIF(metadata, 'null'::jsonb), '{}'::jsonb), '{rotationEnabled}', ${JSON.stringify(data.enabled)}::jsonb, true)
      WHERE id = ${id} AND kind IN ('music', 'music-candidate')`;
    if (!changed) return failure("Musiktitel nicht gefunden.", 404);
    await musicLibraryChanged(id, data.enabled);
    return NextResponse.json({ id, rotationEnabled: data.enabled });
  } catch (error) {
    if (error instanceof MusicControlError) return failure(error.message, error.status);
    console.error("[music control]", error instanceof Error ? error.message : "failed");
    return failure("Die Musiksteuerung ist gerade nicht erreichbar. Bitte erneut versuchen.", 500);
  }
}
