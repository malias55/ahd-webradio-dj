import { prisma } from "./prisma";

export const centralAuthUrl = () => (process.env.AUTH_URL || "https://auth.doerrschuck.de").replace(/\/$/, "");
export const SESSION_COOKIES = ["__Secure-better-auth.session_token", "better-auth.session_token"];

export function authCookies(cookie: string) {
  return cookie.split(";").map(s => s.trim()).filter(s => SESSION_COOKIES.some(name => s.startsWith(`${name}=`))).join("; ");
}

export async function userForCookie(cookie: string) {
  if (process.env.SKIP_AUTH === "true" && process.env.NODE_ENV !== "production") {
    return { email: "info@autohaus-doerrschuck.de", name: "Dev User", role: "admin" };
  }
  const forwarded = authCookies(cookie);
  if (!forwarded) return null;
  try {
    // Use the same authority as AHD-DMS, including central session revocation.
    const response = await fetch(`${centralAuthUrl()}/api/auth/get-session`, {
      headers: { Cookie: forwarded }, cache: "no-store", signal: AbortSignal.timeout(5000), redirect: "error",
    });
    if (!response.ok) return null;
    const value = await response.json() as { user?: { email?: string; emailVerified?: boolean }; session?: { expiresAt?: string } } | null;
    if (!value?.user?.email || value.user.emailVerified !== true || !value.session?.expiresAt || new Date(value.session.expiresAt).getTime() <= Date.now()) return null;
    return await prisma.user.findFirst({ where: { email: { equals: value.user.email, mode: "insensitive" } }, select: { email: true, name: true, role: true } });
  } catch { return null; }
}
