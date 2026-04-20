import { redirect } from "next/navigation";
import { getLogtoContext } from "@logto/next/server-actions";
import { logtoConfig } from "./logto";
import { LoginPage } from "@/components/LoginPage";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (process.env.SKIP_AUTH !== "true") {
    let authed = false;
    try {
      const ctx = await getLogtoContext(logtoConfig);
      authed = ctx.isAuthenticated;
    } catch (err) {
      console.error("[Auth] home check failed:", err);
      redirect("/api/auth/clear-session");
    }
    if (!authed) return <LoginPage />;
  }

  redirect("/control");
}