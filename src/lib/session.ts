import { prisma } from "./prisma";

export const centralAuthUrl = () => (process.env.AUTH_URL || "https://auth.doerrschuck.de").replace(/\/$/, "");
export const dmsUrl = () => (process.env.DMS_URL || "https://dms.doerrschuck.de").replace(/\/$/, "");
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
    const value = await response.json() as { user?: { email?: unknown; name?: unknown; emailVerified?: unknown }; session?: { expiresAt?: unknown } } | null;
    if (typeof value?.user?.email !== "string" || !value.user.email.trim() || value.user.emailVerified !== true) return null;
    const expiresAt = typeof value.session?.expiresAt === "string" ? Date.parse(value.session.expiresAt) : NaN;
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

    // Central SSO also admits employees of sibling apps without a DMS account.
    // Ask the DMS itself whether this session maps to an active DMS user.
    const accessResponse = await fetch(`${dmsUrl()}/api/session/status`, {
      headers: { Cookie: forwarded }, cache: "no-store", signal: AbortSignal.timeout(5000), redirect: "error",
    });
    if (!accessResponse.ok) return null;
    const access = await accessResponse.json() as { authenticated?: unknown; state?: unknown } | null;
    // "superseded" compares the DMS-only, host-scoped ahd_sid cookie. Radio has
    // its own browser sessions; it must not claim or displace the DMS session.
    // Explicit DMS revocation, inactive/missing users and failures deny access.
    if (access?.authenticated !== true || (access.state !== "active" && access.state !== "superseded")) return null;

    const email = value.user.email.trim().toLowerCase();
    const local = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" } }, select: { name: true, role: true } });
    // Local records only retain existing radio roles, never gate admission.
    return { email, name: local?.name ?? (typeof value.user.name === "string" ? value.user.name : null), role: local?.role === "admin" ? "admin" : "user" };
  } catch { return null; }
}
