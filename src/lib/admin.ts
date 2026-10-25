import { headers } from "next/headers";
import { cache } from "react";
import { userForCookie } from "./session";

export type AppUser = { email: string; name: string | null; role: string } | null;
export const getAppUser = cache(async (): Promise<AppUser> => userForCookie((await headers()).get("cookie") || ""));
export async function isAdmin() { return (await getAppUser())?.role === "admin"; }
export async function isAuthorized() { return (await getAppUser()) !== null; }
