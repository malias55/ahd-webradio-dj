"use client";

import { useCallback, useEffect, useState } from "react";

type Source = { id: number; title: string; url: string; publishedAt: string };
type Asset = { id: string; title: string; kind: string; duration: number; slot: string | null; script: string | null; createdAt: string;
  metadata?: { editionSlot?: string; presenter?: string; language?: string; authorModel?: string; reviewModel?: string; ttsModel?: string; example?: boolean; modelCalls?: { inputTokens: number | null; outputTokens: number | null }[]; sources?: Source[] } };
type Playback = { id: string; assetId: string | null; title: string; language: string; kind: string; startedAt: string; endedAt: string | null; status: string; scheduledFor: string | null; repeated: boolean; listeners: number; error: string | null };
type Job = { key: string; status: string; attempts: number; error: string | null; updatedAt: string };
type Status = { onAir: boolean; playing: Asset | null; preparing: boolean; nextNewsAt: string | null; error: string | null; region: string; nextPresenter: string | null; configured: { elevenlabs: boolean; edenai: boolean }; assets: Asset[]; actions: string[]; failures: Job[]; jobs: Job[]; playbacks: Playback[] };
const time = (v: string) => new Date(v).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const labels: Record<string, string> = { starting: "Startet", playing: "Läuft", completed: "Beendet", interrupted: "Unterbrochen", failed: "Fehler", skipped: "Nicht gesendet", done: "Fertig", running: "In Arbeit", pending: "Vorgemerkt" };
const languageLabel = (l?: string) => l === "tr" ? "Türkisch" : l === "de" ? "Deutsch" : "Instrumental";
const jobLabel = (key: string) => key.startsWith("repeat:") ? "Wiederholung vorbereitet" : key.startsWith("news-example:") ? "Hörbeispiel erstellen" : key.startsWith("news:") ? "Nachrichten erstellen" : key.startsWith("music:") ? "Musiktitel erstellen" : "Klangbaustein erstellen";

function AudioDetails({ asset }: { asset: Asset }) {
  const m = asset.metadata;
  const tokens = m?.modelCalls?.reduce((sum, call) => sum + (call.inputTokens || 0) + (call.outputTokens || 0), 0);
  return <div className="space-y-3">
    <audio controls preload="none" src={`/api/radio/assets/${asset.id}`} className="w-full" />
    <p className="text-xs text-neutral-500">Erstellt {time(asset.createdAt)} · {duration(asset.duration)}{m?.presenter ? ` · ${m.presenter}` : ""}{m?.language ? ` · ${languageLabel(m.language)}` : ""}</p>
    <p className="break-all font-mono text-xs text-neutral-500">Audio-ID: {asset.id}</p>
    {m?.authorModel && <p className="text-xs text-neutral-500">Autor: {m.authorModel} · Prüfung: {m.reviewModel || "—"}{tokens ? ` · ${tokens.toLocaleString("de-DE")} Tokens` : ""}</p>}
    {asset.script && <details><summary className="cursor-pointer text-sm">Transkript und Quellen</summary><p className="mt-3 whitespace-pre-line text-sm">{asset.script}</p><ul className="mt-3 space-y-1 text-xs">{m?.sources?.map(s => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.title}</a>{s.publishedAt ? ` · ${time(s.publishedAt)}` : ""}</li>)}</ul></details>}
  </div>;
}

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
  const generate = async (action: string) => {
    setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/radio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await r.json();
      if (!r.ok) throw new Error(result.error);
      setMessage("Vorbereitung gestartet."); await reload();
    } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); }
  };
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
  const news = status.assets.filter(a => a.kind === "news");
  const seenExamples = new Set<string>();
  const examples = status.assets.filter(a => a.kind === "demo").filter(a => { const key = a.metadata?.language || "mixed"; if (seenExamples.has(key)) return false; seenExamples.add(key); return true; });
  const imaging = status.assets.filter(a => ["imaging", "station-id"].includes(a.kind));
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Autohaus Radio</h1><p className="text-sm text-neutral-500">Mainz, gute Musik und ein freundlicher Start in den Tag.</p></div>
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{status.onAir ? "Auf Sendung" : "Sendepause"}</h2><span className={status.onAir ? "badge-online" : "badge-offline"}>07 Uhr Türkçe · 08–18 Uhr Musik</span></div>
      <p>{status.playing?.title || "Nächster Start: türkisches Magazin um 07:00 Uhr, Musik ab 08:00 Uhr."}</p>
      {status.nextNewsAt && <p className="text-sm">Nächste Ausgabe: {time(status.nextNewsAt)} · {status.nextPresenter}{status.preparing ? " · wird vorbereitet" : ""}</p>}
      <div className="grid gap-2 text-sm sm:grid-cols-2"><p>07 Uhr · Türkçe mit Cavit<br />08/09 Uhr · Elias<br />10/11 Uhr · Jane</p><p>12/13 Uhr · Elias<br />14/15 Uhr · Jane<br />16/17 Uhr · Elias</p></div>
      <p className="text-xs text-neutral-500">Deutsche Ortszeit. Jede deutsche Ausgabe wird in der Folgestunde unverändert wiederholt. Nachrichten und Moderationsstimmen sind KI-generiert.</p>
      {status.error && <p className="text-sm text-amber-700 dark:text-amber-400" role="status">{status.error}</p>}
    </div>
    <div className="card space-y-4"><h2 className="font-semibold">Hörbeispiele</h2>{examples.map(a => <div key={a.id} className="space-y-2 border-b border-neutral-200 pb-4 dark:border-neutral-800"><h3 className="font-medium">{a.title}</h3><AudioDetails asset={a} /></div>)}</div>
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-semibold">Verlauf</h2><label className="flex items-center gap-2 text-sm">Tag <input className="input" type="date" value={day} onChange={e => { if (e.target.value) setDay(e.target.value); }} /></label></div>
      <p className="text-xs text-neutral-500">Ausstrahlung im Server-Stream. Das Protokoll bestätigt nicht die Wiedergabe an jedem Lautsprecher. Audio bleibt 14 Tage, der Verlauf 90 Tage gespeichert; Musik und Jingles bleiben erhalten.</p>
      {!status.playbacks.length && <p className="text-sm text-neutral-500">Für diesen Tag noch keine protokollierte Ausstrahlung.</p>}
      {status.playbacks.map(p => { const asset = status.assets.find(a => a.id === p.assetId); return <details key={p.id} className="border-b border-neutral-200 pb-3 dark:border-neutral-800"><summary className="cursor-pointer text-sm"><span className="font-medium">{time(p.startedAt)} · {p.title}</span><span className="ml-2 text-neutral-500">{labels[p.status] || p.status}{p.repeated ? " · Wiederholung" : ""}</span></summary><div className="mt-3 space-y-3"><p className="text-xs text-neutral-500">{languageLabel(p.language)}{p.endedAt ? ` · Ende ${time(p.endedAt)}` : ""}{p.scheduledFor ? ` · Sendeplan ${time(p.scheduledFor)}` : ""} · {p.listeners} Stream-Verbindungen beim Start</p>{p.error && <p className="text-sm text-amber-700 dark:text-amber-400">{p.error}</p>}{asset ? <AudioDetails asset={asset} /> : <p className="text-xs text-neutral-500">{p.assetId ? `Audio-ID: ${p.assetId}` : "Keine Audiodatei ausgestrahlt."}</p>}</div></details>; })}
      <details><summary className="cursor-pointer text-sm font-medium">Erstellung und Fehler · {status.jobs.length} Vorgänge</summary><div className="mt-3 space-y-2">{status.jobs.map(j => <div key={j.key} className="text-xs"><span className="font-medium">{time(j.updatedAt)} · {jobLabel(j.key)} · {labels[j.status] || j.status}</span>{j.attempts > 1 ? ` · Versuch ${j.attempts}` : ""}{j.error && <p className="mt-1 text-amber-700 dark:text-amber-400">{j.error}</p>}</div>)}</div></details>
    </div>
    <div className="card space-y-4"><h2 className="font-semibold">Nachrichtenausgaben · {day}</h2>{!news.length && <p className="text-sm text-neutral-500">Noch keine gespeicherte Ausgabe für diesen Tag.</p>}{news.map(a => <details key={a.id}><summary className="cursor-pointer font-medium">{a.title}</summary><div className="mt-3"><AudioDetails asset={a} /></div></details>)}</div>
    {admin && <div className="card space-y-4">
      <h2 className="font-semibold">Programm vorbereiten</h2><p className="text-sm">ElevenLabs: {status.configured.elevenlabs ? "verbunden" : "API-Schlüssel fehlt"} · Eden AI: {status.configured.edenai ? "verbunden" : "API-Schlüssel fehlt"}</p>
      <div className="flex flex-wrap gap-2"><button className="btn-primary" disabled={busy || status.actions.includes("music") || !status.configured.elevenlabs || music.length >= 24} onClick={() => generate("music")}>{status.actions.includes("music") ? "Musik wird erstellt…" : "3 Musiktitel generieren (kostenpflichtig)"}</button><button className="btn-outline" disabled={busy || status.actions.includes("news") || status.preparing || !status.configured.elevenlabs || !status.configured.edenai} onClick={() => generate("news")}>Nächste Ausgabe vorbereiten</button></div>
      <p className="text-xs text-neutral-500">Wiederholungen verwenden dieselbe Audiodatei ohne neue Text- oder Sprachgenerierung. Originalausgaben werden zehn Minuten vor dem Sendetermin vorbereitet.</p>
      <form onSubmit={e => { e.preventDefault(); void upload(e.currentTarget); }} className="space-y-2"><label className="block text-sm font-medium" htmlFor="music-file">Musiktitel importieren</label><input id="music-file" name="audio" type="file" accept="audio/*" required className="input" /><input name="title" aria-label="Musiktitel" placeholder="Titel" className="input" maxLength={100} /><button type="submit" className="btn-outline" disabled={busy}>Audio hinzufügen</button><p className="text-xs text-neutral-500">Bis 20 MB und 10 Minuten. Maximal 24 Musiktitel.</p></form>{message && <p role="status" className="text-sm">{message}</p>}
    </div>}
    <div className="card space-y-4"><h2 className="font-semibold">Musikpool · {music.length} Titel</h2>{music.map(a => <details key={a.id}><summary className="cursor-pointer text-sm font-medium">{a.title} · {duration(a.duration)}</summary><div className="mt-3"><AudioDetails asset={a} /></div></details>)}</div>
    <div className="card space-y-4"><h2 className="font-semibold">Jingles und Senderkennungen</h2>{imaging.map(a => <details key={a.id}><summary className="cursor-pointer text-sm font-medium">{a.title} · {duration(a.duration)}</summary><div className="mt-3"><AudioDetails asset={a} /></div></details>)}</div>
  </div>;
}
