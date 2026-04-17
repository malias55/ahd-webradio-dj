"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LogOut, Menu, Moon, Radio, Sun, X } from "lucide-react";
import { useTheme } from "./ThemeProvider";
import { doSignOut } from "@/app/actions/auth";

const links = [
  { href: "/control", label: "Steuerung" },
  { href: "/admin/devices", label: "Geräte" },
  { href: "/admin/zones", label: "Zonen" },
  { href: "/docs", label: "Docs" },
];

export function TopNav({
  authEnabled,
  authenticated,
  user,
}: {
  authEnabled: boolean;
  authenticated: boolean;
  user: { name?: string; email?: string } | null;
}) {
  const pathname = usePathname();
  const { theme, toggle } = useTheme();
  const [open, setOpen] = useState(false);

  // Close the drawer on route change
  useEffect(() => { setOpen(false); }, [pathname]);

  const showLinks = authenticated;
  const initials = getInitials(user);
  const userLabel = user?.name || user?.email;

  return (
    <header className="sticky top-0 z-30 border-b border-neutral-200 bg-white/80 backdrop-blur dark:border-neutral-800 dark:bg-neutral-950/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <Radio className="h-4 w-4" aria-hidden />
          </div>
          <span className="truncate font-semibold">AHD Radio DJ</span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-1 md:flex">
          {showLinks && links.map((l) => (
            <NavLink key={l.href} href={l.href} active={isActive(pathname, l.href)}>{l.label}</NavLink>
          ))}
          <button
            onClick={toggle}
            aria-label={theme === "dark" ? "Helles Design" : "Dunkles Design"}
            className="btn-ghost ml-2 px-2"
          >
            {theme === "dark"
              ? <Sun className="h-4 w-4" aria-hidden />
              : <Moon className="h-4 w-4" aria-hidden />}
          </button>
          {authEnabled && authenticated && (
            <UserMenu user={user} initials={initials} userLabel={userLabel} />
          )}
        </nav>

        {/* Mobile: theme + burger */}
        <div className="flex items-center gap-1 md:hidden">
          <button
            onClick={toggle}
            aria-label={theme === "dark" ? "Helles Design" : "Dunkles Design"}
            className="btn-ghost px-2"
          >
            {theme === "dark"
              ? <Sun className="h-4 w-4" aria-hidden />
              : <Moon className="h-4 w-4" aria-hidden />}
          </button>
          {authEnabled && authenticated && (
            <span
              className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-700 dark:bg-brand-700/30 dark:text-brand-100"
              title={userLabel}
            >
              {initials}
            </span>
          )}
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={open ? "Menü schließen" : "Menü öffnen"}
            aria-expanded={open}
            className="btn-ghost px-2"
          >
            {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
          </button>
        </div>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div className="border-t border-neutral-200 bg-white md:hidden dark:border-neutral-800 dark:bg-neutral-950">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-3 sm:px-6">
            {showLinks && links.map((l) => (
              <NavLink key={l.href} href={l.href} active={isActive(pathname, l.href)} block>
                {l.label}
              </NavLink>
            ))}
            {authEnabled && authenticated && (
              <div className="mt-2 flex items-center justify-between gap-2 border-t border-neutral-200 pt-3 dark:border-neutral-800">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{user?.name || "—"}</div>
                  <div className="truncate text-xs text-neutral-500">{user?.email}</div>
                </div>
                <form action={doSignOut}>
                  <button type="submit" className="btn-outline">
                    <LogOut className="h-4 w-4" aria-hidden /> Abmelden
                  </button>
                </form>
              </div>
            )}
          </nav>
        </div>
      )}
    </header>
  );
}

function NavLink({
  href, active, children, block = false,
}: { href: string; active: boolean; children: React.ReactNode; block?: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
        block ? "block" : ""
      } ${
        active
          ? "bg-brand-600 text-white"
          : "text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
      }`}
    >
      {children}
    </Link>
  );
}

function UserMenu({
  user, initials, userLabel,
}: { user: { name?: string; email?: string } | null; initials: string; userLabel?: string }) {
  const [open, setOpen] = useState(false);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const onClick = () => setOpen(false);
    window.addEventListener("click", onClick);
    return () => window.removeEventListener("click", onClick);
  }, [open]);

  return (
    <div className="relative ml-1" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-neutral-200 bg-white py-1 pl-1 pr-3 text-sm transition-colors hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-600 text-[11px] font-semibold text-white">
          {initials}
        </span>
        <span className="hidden max-w-[10rem] truncate sm:inline">{userLabel}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-lg dark:border-neutral-800 dark:bg-neutral-900"
        >
          <div className="border-b border-neutral-200 px-3 py-2 dark:border-neutral-800">
            <div className="truncate text-sm font-medium">{user?.name || "—"}</div>
            <div className="truncate text-xs text-neutral-500">{user?.email}</div>
          </div>
          <form action={doSignOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-2 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-800"
            >
              <LogOut className="h-4 w-4" aria-hidden /> Abmelden
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(href + "/");
}

function getInitials(user: { name?: string; email?: string } | null) {
  const src = (user?.name || user?.email || "?").trim();
  const parts = src.split(/[\s.@]/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return (parts[0][0] + parts[1][0]).toUpperCase();
}
