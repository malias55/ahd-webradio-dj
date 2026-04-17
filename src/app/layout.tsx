import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getLogtoContext } from "@logto/next/server-actions";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TopNav } from "@/components/TopNav";
import { logtoConfig } from "./logto";

export const metadata: Metadata = {
  title: "AHD Radio DJ",
  description: "Zentrale Audiosteuerung für Autohaus Dörrschuck",
  applicationName: "AHD Radio DJ",
  appleWebApp: { capable: true, title: "AHD Radio DJ", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1c6bea",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = process.env.SKIP_AUTH !== "true";

  // Resolve auth state once at the layout so the nav can render links only when signed in.
  let authenticated = !authEnabled;
  let user: { name?: string; email?: string } | null = null;
  if (authEnabled) {
    try {
      const ctx = await getLogtoContext(logtoConfig, { fetchUserInfo: true });
      authenticated = ctx.isAuthenticated;
      const claims = ctx.claims as Record<string, unknown> | undefined;
      const info = ctx.userInfo as Record<string, unknown> | undefined;
      user = authenticated
        ? {
            name: (info?.name as string) ?? (claims?.name as string) ?? undefined,
            email: (info?.email as string) ?? (claims?.email as string) ?? undefined,
          }
        : null;
    } catch { authenticated = false; }
  } else {
    user = { name: "Dev User" };
  }

  return (
    <html lang="de" suppressHydrationWarning>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <TopNav authEnabled={authEnabled} authenticated={authenticated} user={user} />
          <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
