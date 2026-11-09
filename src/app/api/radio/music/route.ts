import { NextResponse } from "next/server";
import { getAppUser } from "@/lib/admin";
import { prisma } from "@/lib/prisma";
import { musicLibraryPlayback } from "@/lib/radio/engine";
import { musicLibraryTrack } from "@/lib/radio/music-library";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getAppUser();
  if (!user) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
  // Separate query: no date filter or news archive limit can hide music.
  const tracks = await prisma.radioAsset.findMany({
    where: { kind: { in: ["music", "music-candidate"] } }, orderBy: [{ title: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, kind: true, duration: true, metadata: true, createdAt: true },
  });
  return NextResponse.json({ tracks: tracks.map(track => musicLibraryTrack(track)), canManage: user.role === "admin", ...musicLibraryPlayback() });
}
