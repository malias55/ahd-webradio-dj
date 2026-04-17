"use server";

import { getLogtoContext, signIn, signOut } from "@logto/next/server-actions";
import { logtoConfig } from "../logto";

export async function checkAuthStatus(): Promise<{ isAuthenticated: boolean }> {
  if (process.env.SKIP_AUTH === "true") return { isAuthenticated: true };
  try {
    const { isAuthenticated } = await getLogtoContext(logtoConfig);
    return { isAuthenticated };
  } catch (error) {
    console.error("[Auth Check] Error:", error);
    return { isAuthenticated: false };
  }
}

export async function doSignIn() {
  "use server";
  await signIn(logtoConfig);
}

export async function doSignOut() {
  "use server";
  await signOut(logtoConfig);
}
