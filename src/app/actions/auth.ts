"use server";
import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAppUser } from "@/lib/admin";
import { authCookies, centralAuthUrl, SESSION_COOKIES } from "@/lib/session";
import { publicOrigin } from "@/lib/radio/config";

export async function checkAuthStatus() { return { isAuthenticated: !!(await getAppUser()) }; }
export async function doSignIn() {
  redirect(`${centralAuthUrl()}/login?returnTo=${encodeURIComponent(`${publicOrigin()}/control`)}`);
}
export async function doSignOut() {
  const cookie = authCookies((await headers()).get("cookie") || "");
  if (cookie) {
    const response = await fetch(`${centralAuthUrl()}/api/auth/sign-out`, { method: "POST",
      headers: { Cookie: cookie, Origin: publicOrigin(), "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error("Abmelden nicht möglich. Bitte erneut versuchen.");
  }
  const store = await cookies();
  for (const name of SESSION_COOKIES) store.set(name, "", { domain: ".doerrschuck.de", path: "/", secure: true, httpOnly: true, sameSite: "lax", maxAge: 0 });
  redirect("/");
}
