import { handleSignIn } from "@logto/next/server-actions";
import { NextRequest, NextResponse } from "next/server";
import { logtoConfig } from "../logto";

function publicUrl(path: string): string {
  const base = logtoConfig.baseUrl.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function GET(request: NextRequest) {
  try {
    await handleSignIn(logtoConfig, request.nextUrl.searchParams);
  } catch (error) {
    console.error("[Auth callback] handleSignIn failed:", error);
    return NextResponse.redirect(publicUrl("/api/auth/clear-session"));
  }
  return NextResponse.redirect(publicUrl("/"));
}
