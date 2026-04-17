import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TopNav } from "@/components/TopNav";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const authEnabled = process.env.SKIP_AUTH !== "true";
  return (
    <html lang="de" suppressHydrationWarning>
      <body className="min-h-screen antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <TopNav authEnabled={authEnabled} />
          <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
