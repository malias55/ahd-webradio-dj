import { getLogtoContext } from "@logto/next/server-actions";
import { logtoConfig } from "@/app/logto";

const ADMIN_EMAIL = "info@autohaus-doerrschuck.de";

export async function isAdmin(): Promise<boolean> {
  if (process.env.SKIP_AUTH === "true") return true;
  try {
    const ctx = await getLogtoContext(logtoConfig, { fetchUserInfo: true });
    if (!ctx.isAuthenticated) return false;
    const info = ctx.userInfo as Record<string, unknown> | undefined;
    const claims = ctx.claims as Record<string, unknown> | undefined;
    const email = (info?.email as string) ?? (claims?.email as string);
    return email === ADMIN_EMAIL;
  } catch {
    return false;
  }
}
