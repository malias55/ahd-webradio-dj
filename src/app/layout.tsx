import type { Metadata, Viewport } from "next";
import "./globals.css";
import { getAppUser } from "@/lib/admin";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TopNav } from "@/components/TopNav";
import { RegisterSW } from "@/components/RegisterSW";

export const metadata: Metadata = {
  title: "AHD Radio DJ",
  description: "Zentrale Audiosteuerung für Autohaus Dörrschuck",
  applicationName: "AHD Radio DJ",
  manifest: "/manifest.json",
  appleWebApp: { capable: true, title: "AHD Radio DJ", statusBarStyle: "black-translucent" },
  icons: [
    { url: "/favicon.svg", type: "image/svg+xml" },
    { url: "/favicon.png", sizes: "32x32", type: "image/png" },
    { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    { rel: "apple-touch-icon", url: "/icon-192.png" },
  ],
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1c6bea",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = process.env.SKIP_AUTH !== "true";

  const appUser = await getAppUser();
  const authenticated = !!appUser;
  const user = appUser ? { name: appUser.name ?? undefined, email: appUser.email } : null;

  return (
    <html lang="de" suppressHydrationWarning>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <RegisterSW />
        <ThemeProvider>
          <TopNav authEnabled={authEnabled} authenticated={authenticated} user={user} />
          <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
