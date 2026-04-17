import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const LOGTO_COOKIE_NAME = `logto_${process.env.LOGTO_APP_ID || ""}`;
const PUBLIC_PATHS = [
  "/api/auth/",
  "/api/health",
  "/backchannel_logout",
  // Pi-consumed endpoints authenticate via DEVICE_API_KEY on the WebSocket, not the Logto cookie.
  // The live-stream URL is handed to Pis as a short-lived pointer on-zone; leaving it open to Pi LAN.
  "/api/zones/", // GET /api/zones/[id]/live is served to Pis; other mutation routes go through the auth gate below
];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (process.env.SKIP_AUTH === "true") return NextResponse.next();

  if (pathname.startsWith("/api/auth/")) return NextResponse.next();
  if (pathname === "/api/health") return NextResponse.next();
  if (pathname === "/backchannel_logout") return NextResponse.next();

  // Allow Pi device live-stream pull (GET only) without Logto; all other API calls require auth
  if (
    request.method === "GET" &&
    /^\/api\/zones\/[^/]+\/live\/?$/.test(pathname)
  ) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    const cookie = request.cookies.get(LOGTO_COOKIE_NAME);
    if (!cookie?.value) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  return NextResponse.next();
}

export const config = { matcher: ["/api/:path*"] };
// NOTE: PUBLIC_PATHS isn't used; kept for future reference.
void PUBLIC_PATHS;
