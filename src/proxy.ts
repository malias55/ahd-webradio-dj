import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { userForCookie } from "./lib/session";
import { publicOrigin } from "./lib/radio/config";

function isPublic(pathname: string, method: string) {
  if (pathname === "/") return true;
  if (method === "GET" && pathname === "/api/radio/stream") return true;
  if (pathname === "/api/health") return true;
  if (["GET", "HEAD"].includes(method) && ["/manifest.json", "/sw.js"].includes(pathname)) return true;
  if (method === "GET" && /^\/api\/zones\/[^/]+\/live\/?$/.test(pathname)) return true;
  return false;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.SKIP_AUTH === "true") return NextResponse.next();
  if (isPublic(pathname, request.method)) return NextResponse.next();

  const origin = request.headers.get("origin");
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && origin && origin !== publicOrigin() && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
  }

  const user = await userForCookie(request.headers.get("cookie") || "");
  if (user) return NextResponse.next();

  // Unauthenticated:
  //  - API calls → 401 JSON (so fetches don't silently redirect and break JSON parsing)
  //  - Page navigations → redirect to / (shows the login page)
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = request.nextUrl.clone();
  url.pathname = "/";
  url.search = "";
  return NextResponse.redirect(url);
}

// Match everything except Next.js internals, static files, and common assets.
export const config = {
  matcher: ["/((?!_next/static|_next/image|_next/dev|favicon\\.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt|webmanifest)).*)"],
};
