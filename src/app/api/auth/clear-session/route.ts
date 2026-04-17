import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { logtoConfig } from "@/app/logto";

export async function GET() {
  const store = await cookies();
  store.delete(`logto_${logtoConfig.appId}`);

  const origin =
    process.env.LOGTO_BASE_URL ||
    (process.env.RAILWAY_PUBLIC_DOMAIN
      ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
      : "http://localhost:3000");
  return NextResponse.redirect(new URL("/", origin));
}
