"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Moon, Sun, LogOut, Radio } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { doSignOut } from "@/app/actions/auth";

const links = [
  { href: "/control", label: "Steuerung" },
  { href: "/admin/devices", label: "Geräte" },
  { href: "/admin/zones", label: "Zonen" },
  { href: "/docs", label: "Docs" },
];

export function TopNav({ authEnabled }: { authEnabled: boolean }) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Radio className="h-4 w-4" aria-hidden />
          </div>
          <span className="font-semibold">AHD Radio DJ</span>
        </Link>
        <nav className="flex items-center gap-1">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-brand-600 text-white"
                    : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
          <button
            onClick={toggle}
            aria-label={theme === "dark" ? "Helles Design" : "Dunkles Design"}
            className="btn-ghost ml-2 px-2"
          >
            {theme === "dark"
              ? <Sun className="h-4 w-4" aria-hidden />
              : <Moon className="h-4 w-4" aria-hidden />}
          </button>
          {authEnabled && (
            <form action={doSignOut} className="ml-1">
              <button type="submit" className="btn-ghost px-2 text-sm" aria-label="Abmelden">
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
