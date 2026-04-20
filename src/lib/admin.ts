import { getLogtoContext } from "@logto/next/server-actions";
import { logtoConfig } from "@/app/logto";
import { prisma } from "./prisma";

export type AppUser = { email: string; name: string | null; role: string } | null;

async function resolveEmail(): Promise<string | null> {
  if (process.env.SKIP_AUTH === "true") return "info@autohaus-doerrschuck.de";
  try {
    const ctx = await getLogtoContext(logtoConfig, { fetchUserInfo: true });
    if (!ctx.isAuthenticated) return null;
    const info = ctx.userInfo as Record<string, unknown> | undefined;
    const claims = ctx.claims as Record<string, unknown> | undefined;
    return (info?.email as string) ?? (claims?.email as string) ?? null;
  } catch {
    return null;
  }
}

export async function getAppUser(): Promise<AppUser> {
  const email = await resolveEmail();
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email } });
  return user;
}

export async function isAdmin(): Promise<boolean> {
  const user = await getAppUser();
  return user?.role === "admin";
}

export async function isAuthorized(): Promise<boolean> {
  const user = await getAppUser();
  return user !== null;
}
