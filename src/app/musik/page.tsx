"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Headphones, Music2, Play, Search, SkipForward, Snowflake, X } from "lucide-react";
import type { MusicLibraryStatus, MusicLibraryTrack } from "@/lib/radio/music-library";
import { duration } from "@/lib/radio/format";

export default function MusicPage() {
  const [status, setStatus] = useState<MusicLibraryStatus | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "on" | "off">("all");
  const [pending, setPending] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const busy = useRef(false), generation = useRef(0), mounted = useRef(true);
  const heading = useId(), description = useId();

  const reload = useCallback(async () => {
    const current = ++generation.current;
    const response = await fetch("/api/radio/music", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 401 ? "Bitte erneut anmelden." : "Die Musikbibliothek konnte nicht geladen werden.");
    const data = await response.json() as MusicLibraryStatus;
    if (mounted.current && generation.current === current) { setStatus(data); setLoadError(""); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const refresh = () => { if (!busy.current) void reload().catch(e => { if (mounted.current) setLoadError(e.message); }); };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { mounted.current = false; generation.current++; clearInterval(timer); };
  }, [reload]);

  async function change(track: MusicLibraryTrack, action: "rotation" | "play" | "skip") {
    if (busy.current) return;
    busy.current = true; generation.current++;
    setPending(track.id); setError(""); setMessage("");
    if (action !== "rotation") setPreview(null);
    try {
      const response = await fetch(`/api/radio/music/${encodeURIComponent(track.id)}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "rotation" ? { action, enabled: !track.rotationEnabled } : { action }),
        signal: AbortSignal.timeout(30000),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Die Änderung konnte nicht gespeichert werden.");
      setConfirm(null);
      setMessage(action === "play" ? `„${track.title}“ wird jetzt im Radio abgespielt.` : action === "skip" ? `„${track.title}“ wurde übersprungen. Die Automatik läuft weiter.` : `„${track.title}“: Automatik ${track.rotationEnabled ? "ausgeschaltet" : "eingeschaltet"}.`);
      if (action === "rotation") setStatus(previous => previous ? { ...previous, tracks: previous.tracks.map(item => item.id === track.id ? { ...item, rotationEnabled: body.rotationEnabled } : item) } : previous);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Die Verbindung ist fehlgeschlagen.");
      // A lost response may still have saved the preference; reconcile with the server.
      await reload().catch(() => {});
    } finally { busy.current = false; setPending(null); }
  }

  if (!status) return <div className="card" role="status">{loadError || "Musikbibliothek laden …"}</div>;
  const active = status.tracks.filter(track => track.inRotation);
  const enabledCount = status.tracks.filter(track => track.rotationEnabled).length;
  const tracks = status.tracks.filter(track => (filter === "all" || (filter === "on" ? track.rotationEnabled : !track.rotationEnabled)) && `${track.title} ${track.version || ""}`.toLocaleLowerCase("de").includes(query.toLocaleLowerCase("de")));

  return <div className="space-y-6">
    <div className="space-y-2">
      <h1 className="text-2xl font-bold">Musikbibliothek</h1>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">Alle Musiktitel an einem Ort. Automatik ein- oder ausschalten, lokal vorhören oder einen Titel direkt im Radio starten.</p>
    </div>

    <section className="card space-y-3" aria-label="Aktuelles Radioprogramm">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-brand-50 p-2 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300"><Music2 className="h-5 w-5" aria-hidden /></div>
        <div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Im Radio</p><p className="break-words font-semibold">{status.playing?.title || (active.length ? "Gerade kein Titel auf Sendung" : "Keine Titel in der Automatik")}</p></div>
      </div>
      <p className="text-sm text-neutral-600 dark:text-neutral-400">{status.tracks.length} Titel insgesamt · {active.length} aktuell in der Automatik · {duration(active.reduce((sum, track) => sum + track.duration, 0))} Musik</p>
      {status.playNowBlockedReason && <p className="text-sm text-neutral-500 dark:text-neutral-400">{status.playNowBlockedReason}</p>}
      {!active.length && <p className="text-sm text-amber-700 dark:text-amber-300">Aktiviere mindestens einen Titel, damit die automatische Musikwiedergabe weiterlaufen kann.</p>}
    </section>

    <div className="space-y-3">
      <label className="relative block"><span className="sr-only">Musiktitel suchen</span><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" aria-hidden /><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Musiktitel suchen …" className="input pl-10" /></label>
      <div className="flex flex-wrap gap-2" aria-label="Musik filtern">
        {([['all', `Alle (${status.tracks.length})`], ['on', `Automatik an (${enabledCount})`], ['off', `Automatik aus (${status.tracks.length - enabledCount})`]] as const).map(([value, label]) => <button key={value} type="button" className={filter === value ? "btn-primary" : "btn-outline"} aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</button>)}
      </div>
      <p className="text-xs text-neutral-500 dark:text-neutral-400">Ausgeschaltete Titel bleiben erhalten. Schaltest du den laufenden Titel aus, blendet er sanft aus und die Automatik wählt den nächsten. Wintertitel laufen automatisch nur von November bis Februar.</p>
      {!status.canManage && <p className="text-sm text-neutral-500 dark:text-neutral-400">Du kannst alle Titel vorhören. Die Radiosteuerung ist für Administratoren verfügbar.</p>}
    </div>

    <div aria-live="polite">{message && <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800 dark:bg-green-950 dark:text-green-200" role="status">{message}</p>}</div>
    {(loadError || (error && !confirm)) && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200" role="alert">{loadError || error}</p>}

    <div className="space-y-3">
      {!tracks.length && <p className="card text-sm text-neutral-500 dark:text-neutral-400">{status.tracks.length ? "Keine Titel für diese Suche oder Auswahl." : "Noch keine Musiktitel vorhanden."}</p>}
      {tracks.map(track => {
        const playing = status.playing?.id === track.id;
        return <article key={track.id} aria-label={track.title + (track.version ? ` · ${track.version}` : "")} className={`card space-y-4 ${playing ? "border-brand-400 ring-1 ring-brand-400 dark:border-brand-500" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1 basis-64 space-y-2">
              <div className="flex flex-wrap items-center gap-2"><h2 className="break-words font-semibold">{track.title}</h2>{playing && <span className="badge bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200">Läuft jetzt</span>}</div>
              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
                <span>{duration(track.duration)}</span>{track.version && <span>· {track.version}</span>}
                <span className={track.inRotation ? "badge-online" : "badge bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"}>{track.inRotation ? "In der Automatik" : track.rotationEnabled ? "Saisonpause" : "Automatik aus"}</span>
                {track.season === "winter" && <span className="inline-flex items-center gap-1"><Snowflake className="h-3.5 w-3.5" aria-hidden /> Winter · Nov–Feb</span>}
              </div>
              {track.note && <p className="text-xs text-neutral-500 dark:text-neutral-400">{track.note}</p>}
            </div>
            {status.canManage && <button type="button" role="switch" aria-checked={track.rotationEnabled} aria-label={`Automatik für ${track.title}${track.version ? ` (${track.version})` : ""}`} disabled={!!pending} onClick={() => void change(track, "rotation")} className="btn-ghost gap-3 px-2">
              <span className="text-sm">Automatik {track.rotationEnabled ? "an" : "aus"}</span><span className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${track.rotationEnabled ? "bg-brand-600" : "bg-neutral-300 dark:bg-neutral-600"}`} aria-hidden><span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${track.rotationEnabled ? "translate-x-5" : "translate-x-0.5"}`} style={{ left: 0 }} /></span>
            </button>}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-outline" aria-expanded={preview === track.id} onClick={() => { setPreview(preview === track.id ? null : track.id); setError(""); }}><Headphones className="h-4 w-4" aria-hidden />{preview === track.id ? "Vorschau schließen" : "Vorhören"}</button>
            {status.canManage && playing && <button type="button" className="btn-outline" disabled={!!pending || !!status.playNowBlockedReason} onClick={() => void change(track, "skip")}><SkipForward className="h-4 w-4" aria-hidden />Überspringen</button>}
            {status.canManage && !playing && <Popover.Root open={confirm === track.id} onOpenChange={open => { if (!pending) { setConfirm(open ? track.id : null); setError(""); } }}>
              <Popover.Trigger asChild><button type="button" className="btn-primary" disabled={!!pending || !!status.playNowBlockedReason} title={status.playNowBlockedReason || undefined}><Play className="h-4 w-4" aria-hidden />Jetzt abspielen</button></Popover.Trigger>
              <Popover.Portal><Popover.Content side="bottom" align="start" sideOffset={8} collisionPadding={12} hideWhenDetached
                aria-labelledby={`${heading}-${track.id}`} aria-describedby={`${description}-${track.id}`}
                onEscapeKeyDown={event => { if (pending) event.preventDefault(); }} onInteractOutside={event => { if (pending) event.preventDefault(); }}
                className="z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(24rem,calc(100vw-1.5rem))] space-y-4 overflow-y-auto rounded-xl border border-neutral-200 bg-white p-4 text-neutral-900 shadow-xl outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
                <h3 id={`${heading}-${track.id}`} className="font-semibold">Jetzt im Radio abspielen?</h3>
                <p id={`${description}-${track.id}`} className="text-sm"><strong>{track.title}</strong>{track.version ? ` · ${track.version}` : ""} wird in allen Zonen mit Radioempfang gespielt. Die laufende Musik blendet sanft aus. Danach läuft die Automatik weiter.</p>
                {!track.rotationEnabled && <p className="text-xs text-neutral-500 dark:text-neutral-400">Dieser Titel wird einmalig gespielt. Die Automatik bleibt für ihn ausgeschaltet.</p>}
                {track.note && <p className="text-xs text-amber-700 dark:text-amber-300">{track.note}</p>}
                {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300">{error}</p>}
                <div className="flex flex-wrap justify-end gap-2"><Popover.Close asChild><button type="button" className="btn-outline" disabled={!!pending}>Abbrechen</button></Popover.Close><button type="button" className="btn-primary" disabled={!!pending || !!status.playNowBlockedReason} onClick={() => void change(track, "play")}>{pending ? "Wird eingeblendet …" : "Im Radio starten"}</button></div>
              </Popover.Content></Popover.Portal>
            </Popover.Root>}
          </div>
          {preview === track.id && <div className="space-y-2 rounded-lg bg-neutral-50 p-3 dark:bg-neutral-800"><div className="flex items-center justify-between gap-2"><p className="text-xs text-neutral-500 dark:text-neutral-400">Vorschau nur auf diesem Gerät</p><button type="button" aria-label="Vorschau schließen" className="btn-ghost px-1 py-1" onClick={() => setPreview(null)}><X className="h-4 w-4" aria-hidden /></button></div><audio key={track.id} aria-label={`Vorschau: ${track.title}`} controls autoPlay preload="none" src={`/api/radio/assets/${track.id}`} className="w-full" onError={() => setError("Die Vorschau konnte nicht geladen werden. Bitte erneut versuchen.")} /></div>}
        </article>;
      })}
    </div>
  </div>;
}
