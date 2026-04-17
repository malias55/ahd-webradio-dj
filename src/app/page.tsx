import Link from "next/link";
import { redirect } from "next/navigation";
import { SlidersHorizontal, Cpu, Layers, BookOpen } from "lucide-react";
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

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">AHD Radio DJ</h1>
        <p className="mt-2 text-neutral-600 dark:text-neutral-400">
          Zentrale Audiosteuerung für alle Zonen.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HomeTile href="/control" icon={SlidersHorizontal} title="Steuerung" desc="Lautstärke, Tab-Audio und Durchsagen pro Zone." />
        <HomeTile href="/admin/devices" icon={Cpu} title="Geräte" desc="Raspberry Pis verwalten und Zonen zuordnen." />
        <HomeTile href="/admin/zones" icon={Layers} title="Zonen" desc="Stream, Quelle und Standard-Lautstärke je Zone." />
        <HomeTile href="/docs" icon={BookOpen} title="Docs" desc="Architektur, Pi-Anschluss und API." />
      </div>
    </div>
  );
}

function HomeTile({
  href, icon: Icon, title, desc,
}: {
  href: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  desc: string;
}) {
  return (
    <Link href={href} className="card flex flex-col gap-2 transition-colors hover:border-brand-500">
      <Icon className="h-5 w-5 text-brand-600" aria-hidden />
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{desc}</p>
    </Link>
  );
}
