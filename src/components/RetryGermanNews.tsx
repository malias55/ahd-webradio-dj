"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { RefreshCw } from "lucide-react";
import type { NewsRetryStatus } from "@/lib/radio/news-retry";

export function RetryGermanNews() {
  const router = useRouter(), title = useId(), description = useId();
  const [status, setStatus] = useState<NewsRetryStatus | null>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const previous = useRef<string | null>(null);
  const reload = useCallback(async () => {
    const response = await fetch("/api/radio/news/retry", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) return;
    const next = await response.json() as NewsRetryStatus;
    if (previous.current === "running" && next.state !== "running") router.refresh();
    previous.current = next.state;
    setStatus(next);
  }, [router]);
  useEffect(() => { void reload().catch(() => {}); const timer = setInterval(() => void reload().catch(() => {}), 5000); return () => clearInterval(timer); }, [reload]);

  async function retry() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/radio/news/retry", { method: "POST", signal: AbortSignal.timeout(20000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Die Erstellung konnte nicht gestartet werden.");
      previous.current = result.state; setStatus(result); setOpen(false);
    } catch (e) { setError(e instanceof Error ? e.message : "Verbindung fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  if (!status) return null;
  return <section className="card space-y-3" aria-label="Deutsche Ausgabe erstellen">
    <h2 className="font-semibold">Deutsche Ausgabe für heute</h2>
    <p className="text-sm text-neutral-600 dark:text-neutral-400" role="status">{status.message}</p>
    {status.state !== "ready" && <Popover.Root open={open} onOpenChange={value => { if (!busy) { setOpen(value); setError(""); } }}>
      <Popover.Trigger asChild><button type="button" className="btn-outline" disabled={!status.canRetry || busy}><RefreshCw className={`h-4 w-4 ${status.state === "running" ? "animate-spin" : ""}`} aria-hidden />{status.state === "running" ? "Wird erstellt …" : "Erstellung erneut versuchen"}</button></Popover.Trigger>
      <Popover.Portal><Popover.Content side="bottom" align="start" sideOffset={8} collisionPadding={12} aria-labelledby={title} aria-describedby={description}
        onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onInteractOutside={event => { if (busy) event.preventDefault(); }}
        className="z-50 w-[min(24rem,calc(100vw-1.5rem))] space-y-4 rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-lg dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
        <h3 id={title} className="font-semibold">Erstellung erneut versuchen?</h3>
        <p id={description} className="text-sm">Erstellt die fehlende deutsche Ausgabe mit aktuellem Wetter und Verkehr. Dabei können ElevenLabs-Credits verbraucht werden. Anschließend ist sie in der Zonensteuerung abspielbar.</p>
        {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2"><Popover.Close asChild><button type="button" className="btn-outline" disabled={busy}>Abbrechen</button></Popover.Close><button type="button" className="btn-primary" disabled={busy || !status.canRetry} onClick={() => void retry()}>{busy ? "Wird gestartet …" : "Jetzt erstellen"}</button></div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>}
  </section>;
}
