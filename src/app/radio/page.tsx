"use client";

import { FAMILY_CONTENT_VERSION } from "@/lib/radio/family";
import { useCallback, useEffect, useState } from "react";

import { AudioDetails, type Asset, time, duration, languageLabel } from "@/components/RadioAudioDetails";

type Playback = { id: string; assetId: string | null; title: string; language: string; kind: string; startedAt: string; endedAt: string | null; status: string; scheduledFor: string | null; repeated: boolean; listeners: number; error: string | null };
type Job = { key: string; status: string; attempts: number; error: string | null; updatedAt: string };
type Status = { programmeVersion: string; onAir: boolean; playing: Asset | null; preparing: boolean; nextNewsAt: string | null; error: string | null; region: string; nextPresenter: string | null; assets: Asset[]; failures: Job[]; jobs: Job[]; playbacks: Playback[] };
const labels: Record<string, string> = { starting: "Startet", playing: "Läuft", completed: "Beendet", interrupted: "Unterbrochen", failed: "Fehler", skipped: "Nicht gesendet", done: "Fertig", running: "In Arbeit", pending: "Vorgemerkt" };
const jobLabel = (key: string) => key.startsWith("repeat:") ? "Wiederholung vorbereitet" : key.startsWith("news-example:") ? "Hörbeispiel erstellen" : key.startsWith("news-main:") ? "Hauptnachrichten erstellen" : key.startsWith("news-hourly:") ? "Morgenausgabe mit Wetter und Verkehr" : key.startsWith("news:") ? "Nachrichten erstellen" : key.startsWith("music:") ? "Musiktitel erstellen" : "Klangbaustein erstellen";

export default function RadioPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [admin, setAdmin] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(() => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }));
  const reload = useCallback(async () => {
    const r = await fetch(`/api/radio?day=${encodeURIComponent(day)}`, { cache: "no-store" });
    if (!r.ok) throw new Error("Radioprogramm konnte nicht geladen werden");
    setStatus(await r.json());
  }, [day]);
  useEffect(() => {
    void reload().catch(e => setMessage(e.message));
    const timer = setInterval(() => void reload().catch(() => {}), 5000);
    return () => clearInterval(timer);
  }, [reload]);
  useEffect(() => { void fetch("/api/me").then(r => r.json()).then(v => setAdmin(v.admin)).catch(() => {}); }, []);
  const upload = async (form: HTMLFormElement) => {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/radio", { method: "POST", body: new FormData(form) });
      if (!r.ok) throw new Error((await r.json()).error);
      form.reset(); setMessage("Musiktitel hinzugefügt."); await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
  if (!status) return <div className="card">{message || "Radioprogramm laden…"}</div>;
  const music = status.assets.filter(a => a.kind === "music");
  const news = status.assets.filter(a => a.kind === "news" && !a.metadata?.supersededBy);
  const seenExamples = new Set<string>();
  const examples = status.assets.filter(a => a.kind === "demo" && a.metadata?.language && a.metadata?.backgroundMusic === false && a.metadata?.familyContentVersion === FAMILY_CONTENT_VERSION && (a.metadata?.language !== "de" || a.metadata?.programmeVersion === status.programmeVersion)).filter(a => { const key = a.metadata?.language || "mixed"; if (seenExamples.has(key)) return false; seenExamples.add(key); return true; });
  const imaging = status.assets.filter(a => a.kind === "imaging" || (a.kind === "station-id" && a.metadata?.backgroundMusic === false));
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Autohaus Radio</h1><p className="text-sm text-neutral-500">Mainz, gute Musik und ein freundlicher Start in den Tag.</p></div>
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{status.onAir ? "Auf Sendung" : "Sendepause"}</h2><span className={status.onAir ? "badge-online" : "badge-offline"}>07 Uhr Türkçe · 08–18 Uhr Musik</span></div>
      <p>{status.playing?.title || "Nächster Start: türkisches Magazin um 07:00 Uhr, Musik ab 08:00 Uhr."}</p>
      {status.nextNewsAt && <p className="text-sm">Nächste Ausgabe: {time(status.nextNewsAt)} · {status.nextPresenter}{status.preparing ? " · wird vorbereitet" : ""}</p>}
      <div className="grid gap-2 text-sm sm:grid-cols-2"><p>07 Uhr · Türkçe mit Cavit<br />08 Uhr · deutsche Nachrichten mit Elias</p><p>08 Uhr · Wetter und Verkehr mit Susanne<br />Mainz und Umgebung · A60 / A63 / A643</p></div>
      <p className="text-xs text-neutral-500">Deutsche Ortszeit. Im Testbetrieb täglich nur zwei Ausgaben: Türkisch um 07 Uhr und Deutsch um 08 Uhr, einschließlich frischem Wetter und Verkehr. Danach keine weiteren Nachrichtengenerierungen. Alle gesprochenen Beiträge ohne Musikbett, auch die türkische Ausgabe. Türkisch mit dem ausgewählten kurzen Intro nach dem gesprochenen Einstieg; keine Klänge zwischen den Meldungen oder am Schluss. Deutsche Nachrichten einschließlich Wetter und Verkehr enthalten ausschließlich Sprache und kurze Pausen. Alle Nachrichten sind auf jugendfreie Inhalte beschränkt. Nachrichten und Moderationsstimmen sind KI-generiert.</p>
      {status.error && <p className="text-sm text-amber-700 dark:text-amber-400" role="status">{status.error}</p>}
    </div>
    {examples.length > 0 && <div className="card space-y-4"><h2 className="font-semibold">Hörbeispiele</h2>{examples.map(a => <div key={a.id} className="space-y-2 border-b border-neutral-200 pb-4 dark:border-neutral-800"><h3 className="font-medium">{a.title}</h3><AudioDetails asset={a} /></div>)}</div>}
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Verlauf</h2><label className="flex items-center gap-2 text-sm">Tag <input className="input" type="date" value={day} onChange={e => { if (e.target.value) setDay(e.target.value); }} /></label></div>
      <p className="text-xs text-neutral-500">Ausstrahlung im Server-Stream. Das Protokoll bestätigt nicht die Wiedergabe an jedem Lautsprecher. Audio bleibt 14 Tage, der Verlauf 90 Tage gespeichert; Musik und Jingles bleiben erhalten.</p>
      {!status.playbacks.length && <p className="text-sm text-neutral-500">Für diesen Tag noch keine protokollierte Ausstrahlung.</p>}
      {status.playbacks.map(p => { const asset = status.assets.find(a => a.id === p.assetId); return <details key={p.id} className="border-b border-neutral-200 pb-3 dark:border-neutral-800"><summary className="cursor-pointer text-sm"><span className="font-medium">{time(p.startedAt)} · {p.title}</span><span className="ml-2 text-neutral-500">{labels[p.status] || p.status}{p.repeated ? asset?.metadata?.mainAssetId ? " · Hauptteil wiederholt, Wetter/Verkehr neu" : " · Wiederholung" : ""}</span></summary><div className="mt-3 space-y-3"><p className="text-xs text-neutral-500">{languageLabel(p.language)}{p.endedAt ? ` · Ende ${time(p.endedAt)}` : ""}{p.scheduledFor ? ` · Sendeplan ${time(p.scheduledFor)}` : ""} · {p.listeners} Stream-Verbindungen beim Start</p>{p.error && <p className="text-sm text-amber-700 dark:text-amber-400">{p.error}</p>}{asset ? <AudioDetails asset={asset} /> : <p className="text-xs text-neutral-500">{p.assetId ? `Audio-ID: ${p.assetId}` : "Keine Audiodatei ausgestrahlt."}</p>}</div></details>; })}
      <details><summary className="cursor-pointer text-sm font-medium">Erstellung und Fehler · {status.jobs.length} Vorgänge</summary><div className="mt-3 space-y-2">{status.jobs.map(j => <div key={j.key} className="text-xs"><span className="font-medium">{time(j.updatedAt)} · {jobLabel(j.key)} · {labels[j.status] || j.status}</span>{j.attempts > 1 ? ` · Versuch ${j.attempts}` : ""}{j.error && <p className="mt-1 text-amber-700 dark:text-amber-400">{j.error}</p>}</div>)}</div></details>
    </div>
    <div className="card space-y-4"><h2 className="font-semibold">Nachrichtenausgaben · {day}</h2>{!news.length && <p className="text-sm text-neutral-500">Noch keine gespeicherte Ausgabe für diesen Tag.</p>}{news.map(a => <details key={a.id}><summary className="cursor-pointer font-medium">{a.title}</summary><div className="mt-3"><AudioDetails asset={a} /></div></details>)}</div>
    {admin && <div className="card space-y-4">
      <h2 className="font-semibold">Musiktitel importieren</h2>
      <form onSubmit={e => { e.preventDefault(); void upload(e.currentTarget); }} className="space-y-2"><label className="block text-sm font-medium" htmlFor="music-file">Musiktitel importieren</label><input id="music-file" name="audio" type="file" accept="audio/*" required className="input" /><input name="title" aria-label="Musiktitel" placeholder="Titel" className="input" maxLength={100} /><button type="submit" className="btn-outline" disabled={busy}>Audio hinzufügen</button><p className="text-xs text-neutral-500">Bis 20 MB und 10 Minuten. Maximal 24 Musiktitel.</p></form>{message && <p role="status" className="text-sm">{message}</p>}
    </div>}
    <div className="card space-y-4"><h2 className="font-semibold">Musikpool · {music.length} Titel</h2>{music.map(a => <details key={a.id}><summary className="cursor-pointer text-sm font-medium">{a.title} · {duration(a.duration)}</summary><div className="mt-3"><AudioDetails asset={a} /></div></details>)}</div>
    <div className="card space-y-4"><h2 className="font-semibold">Jingles und Senderkennungen</h2>{imaging.map(a => <details key={a.id}><summary className="cursor-pointer text-sm font-medium">{a.title} · {duration(a.duration)}</summary><div className="mt-3"><AudioDetails asset={a} /></div></details>)}</div>
  </div>;
}
