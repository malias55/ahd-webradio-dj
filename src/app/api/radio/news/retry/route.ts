import { after, NextResponse } from "next/server";
import { isAdmin, isAuthorized } from "@/lib/admin";
import { publicOrigin } from "@/lib/radio/config";
import { germanNewsRetryStatus, retryGermanNews } from "@/lib/radio/news-retry";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  if (!await isAuthorized()) return NextResponse.json({ error: "Bitte erneut anmelden." }, { status: 401 });
  return NextResponse.json(await germanNewsRetryStatus());
}

export async function POST(request: Request) {
  if (!await isAdmin()) return NextResponse.json({ error: "Nur Administratoren können die Erstellung erneut starten." }, { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin() && origin !== new URL(request.url).origin) return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
  const status = await germanNewsRetryStatus();
  if (!status.canRetry) return NextResponse.json({ ...status, error: status.message }, { status: status.state === "ready" ? 200 : 409 });
  after(async () => {
    try { await retryGermanNews(); }
    catch (error) { console.error("[news retry]", error instanceof Error ? error.message : "failed"); }
  });
  return NextResponse.json({ state: "running", canRetry: false, message: "Die deutsche Ausgabe wird erstellt. Du kannst diese Seite offen lassen." }, { status: 202 });
}
