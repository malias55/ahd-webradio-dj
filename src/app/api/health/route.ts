import { NextResponse } from "next/server";
import { radioStatus } from "@/lib/radio/engine";

export const dynamic = "force-dynamic";

export async function GET() {
  const radio = radioStatus();
  return NextResponse.json({ ok: true, ts: new Date().toISOString(), radio: {
    imagingVersion: radio.imagingVersion, presenter: radio.presenter, schedulerStarted: radio.started, onAir: radio.onAir, title: radio.playing?.title ?? null,
  } });
}
