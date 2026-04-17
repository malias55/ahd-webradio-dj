import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LOGTO_COOKIE_NAME = `logto_${process.env.LOGTO_APP_ID || ""}`;

// Paths that must stay public:
//  - "/"                          -> renders LoginPage when unauthenticated
//  - "/callback"                  -> OIDC redirect target
//  - "/api/auth/*"                -> session cleanup routes
//  - "/api/health"                -> Railway healthcheck
//  - "/backchannel_logout"        -> Logto server-to-server logout
//  - GET /api/zones/:id/live      -> Pi devices pull the live stream (auth via DEVICE_API_KEY on ws)
function isPublic(pathname: string, method: string) {
  if (pathname === "/") return true;
  if (pathname === "/callback") return true;
  if (pathname === "/backchannel_logout") return true;
  if (pathname === "/api/health") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  if (method === "GET" && /^\/api\/zones\/[^/]+\/live\/?$/.test(pathname)) return true;
  return false;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.SKIP_AUTH === "true") return NextResponse.next();
  if (isPublic(pathname, request.method)) return NextResponse.next();

  const cookie = request.cookies.get(LOGTO_COOKIE_NAME);
  if (cookie?.value) return NextResponse.next();

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
