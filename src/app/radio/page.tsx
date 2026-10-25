"use client";

import { useCallback, useEffect, useState } from "react";

type Asset = { id: string; title: string; kind: string; duration: number; slot: string | null; script: string | null; metadata?: { editionSlot?: string; reusedEdition?: boolean; presenter?: string; sources?: { id: number; title: string; url: string; publishedAt: string }[] } };
type Status = { onAir: boolean; started: boolean; playing: Asset | null; preparing: boolean; nextNewsAt: string | null; error: string | null; region: string; nextPresenter: string | null; configured: { elevenlabs: boolean; edenai: boolean }; assets: Asset[]; actions: string[]; failures: { key: string; error: string }[] };

const time = (v: string) => new Date(v).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export default function RadioPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [admin, setAdmin] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => {
    const r = await fetch("/api/radio", { cache: "no-store" });
    if (!r.ok) throw new Error("Radioprogramm konnte nicht geladen werden");
    setStatus(await r.json());
  }, []);
  useEffect(() => {
    void reload().catch(e => setMessage(e.message));
    void fetch("/api/me").then(r => r.json()).then(v => setAdmin(v.admin)).catch(() => {});
    const timer = setInterval(() => void reload().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [reload]);
  const generate = async (action: string) => {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/radio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setMessage("Generierung gestartet. Das kann einige Minuten dauern.");
      await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  const upload = async (form: HTMLFormElement) => {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/radio", { method: "POST", body: new FormData(form) });
      if (!r.ok) throw new Error((await r.json()).error);
      form.reset(); setMessage("Musiktitel wurde hinzugefügt."); await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  if (!status) return <div className="card">{message || "Radioprogramm laden…"}</div>;
  const music = status.assets.filter(a => a.kind === "music");
  const news = status.assets.filter(a => a.kind === "news");
  const imaging = status.assets.filter(a => ["imaging", "station-id", "demo"].includes(a.kind));
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Autohaus Radio</h1><p className="text-sm text-neutral-500">Entspannte Musik und ein freundlicher Blick auf {status.region} und die Welt.</p></div>
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{status.onAir ? "Auf Sendung" : "Sendepause"}</h2><span className={status.onAir ? "badge-online" : "badge-offline"}>{status.onAir ? "08–18 Uhr" : "Ab 08 Uhr"}</span></div>
      <p>{status.playing?.title || (status.onAir ? "Warten auf Musiktitel" : "Das Programm startet um 08:00 Uhr.")}</p>
      <p className="text-sm text-neutral-500">Täglich 08:00–18:00 Uhr · Deutsche Ortszeit · KI-Nachrichten um 08:00 bis 17:00 Uhr zur vollen Stunde.</p>
      {status.nextNewsAt && <p className="text-sm">Nächste Ausgabe: {time(status.nextNewsAt)} · {status.nextPresenter}{status.preparing ? " · wird vorbereitet" : ""}</p>}
      <p className="text-sm text-neutral-500">08 Uhr beginnt Elias, danach stündlich Jane und Elias im Wechsel. Neue Themenauswahl um 08, 10, 12, 14 und 16 Uhr. Senderkennungen zwischen den Musiktiteln.</p>
      <p className="text-xs text-neutral-500">Nachrichten und Moderationsstimme sind KI-generiert. Wir wählen positive und neutrale Meldungen aus aktuellen Quellen aus. Bei fehlenden oder ungeprüften Meldungen läuft Musik weiter. Durchsagen bleiben unter „Steuerung“ verfügbar.</p>
      {status.error && <p className="text-sm text-amber-700 dark:text-amber-400" role="status">{status.error}</p>}
    </div>
    {admin && <div className="card space-y-4">
      <h2 className="font-semibold">Programm vorbereiten</h2>
      <p className="text-sm">ElevenLabs: {status.configured.elevenlabs ? "verbunden" : "API-Schlüssel fehlt"} · Eden AI: {status.configured.edenai ? "verbunden" : "API-Schlüssel fehlt"}</p>
      <div className="flex flex-wrap gap-2">
        <button className="btn-primary" disabled={busy || status.actions.includes("music") || !status.configured.elevenlabs || music.length >= 24} onClick={() => generate("music")}>{status.actions.includes("music") ? "Musik wird erstellt…" : "3 Musiktitel generieren (kostenpflichtig)"}</button>
        <button className="btn-outline" disabled={busy || status.actions.includes("news") || status.preparing || !status.configured.elevenlabs || !status.configured.edenai} onClick={() => generate("news")}>Nächste Nachrichtenausgabe vorbereiten</button>
      </div>
      <p className="text-xs text-neutral-500">Je drei Titel à ca. 3 Minuten, maximal 24 Titel. Gespeicherte Musik rotiert dauerhaft ohne neue Generierungskosten. Neue Themenauswahl alle zwei Stunden. Dazwischen liest die andere Stimme dieselbe geprüfte Auswahl mit neuem Stundenintro. Vorbereitung jeweils zehn Minuten vor der Stunde.</p>
      <form onSubmit={e => { e.preventDefault(); void upload(e.currentTarget); }} className="space-y-2">
        <label className="block text-sm font-medium" htmlFor="music-file">Eigene ElevenLabs-Titel importieren</label>
        <input id="music-file" name="audio" type="file" accept="audio/*" required className="input" />
        <input name="title" aria-label="Musiktitel" placeholder="Titel, z. B. Showroom Velvet" className="input" maxLength={100} />
        <button type="submit" className="btn-outline" disabled={busy}>Audio hinzufügen</button>
        <p className="text-xs text-neutral-500">Bis 20 MB und 10 Minuten. Lautstärke und Audioformat werden angeglichen.</p>
      </form>
      {message && <p role="status" className="text-sm">{message}</p>}
      {status.failures.map(f => <p key={f.key} className="text-xs text-amber-700 dark:text-amber-400">{f.error}</p>)}
    </div>}
    <div className="card space-y-4"><h2 className="font-semibold">Musikpool · {music.length} Titel</h2>
      {!music.length && <p className="text-sm text-neutral-500">Noch keine Titel. Importiere die ausgewählten Tracks oder generiere einen ersten Musikpool.</p>}
      {music.map(a => <div key={a.id} className="space-y-2"><p className="text-sm font-medium">{a.title} · {duration(a.duration)}</p><audio controls preload="none" src={`/api/radio/assets/${a.id}`} className="w-full" /></div>)}
    </div>
    <div className="card space-y-4"><h2 className="font-semibold">Radioklang und Hörbeispiel</h2>
      {imaging.map(a => <div key={a.id} className="space-y-2"><p className="text-sm font-medium">{a.title} · {duration(a.duration)}</p><audio controls preload="none" src={`/api/radio/assets/${a.id}`} className="w-full" /></div>)}
    </div>
    <div className="card space-y-4"><h2 className="font-semibold">Nachrichtenausgaben und Quellen</h2>
      {!news.length && <p className="text-sm text-neutral-500">Noch keine Ausgabe vorbereitet.</p>}
      {news.map(a => <details key={a.id} className="border-b border-neutral-200 pb-3 dark:border-neutral-800"><summary className="cursor-pointer text-sm font-medium">{a.slot ? time(a.slot) : a.title} · {duration(a.duration)}</summary><div className="mt-3 space-y-3"><audio controls preload="none" src={`/api/radio/assets/${a.id}`} className="w-full" /><p className="text-xs text-neutral-500">{a.metadata?.presenter}{a.metadata?.reusedEdition && a.metadata.editionSlot ? ` · Themenauswahl von ${time(a.metadata.editionSlot)}` : ""}</p><p className="whitespace-pre-line text-sm">{a.script}</p><ul className="space-y-1 text-xs">{a.metadata?.sources?.map(s => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.title}</a> · {time(s.publishedAt)}</li>)}</ul></div></details>)}
    </div>
  </div>;
}
