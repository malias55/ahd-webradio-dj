"use client";

import { time, duration, languageLabel } from "@/lib/radio/format";
export { time, duration, languageLabel } from "@/lib/radio/format";

type Source = { id: number; title: string; url: string; publishedAt: string };
export type Asset = { id: string; title: string; kind: string; duration: number; slot: string | null; script: string | null; createdAt: string;
  metadata?: { programmeVersion?: string; familyContentVersion?: string; correctedAt?: string; supersededBy?: string; editionSlot?: string; presenter?: string; language?: string; authorModel?: string; reviewModel?: string; ttsModel?: string; example?: boolean; mainAssetId?: string; mainReused?: boolean; mainUnavailable?: boolean; backgroundMusic?: boolean; service?: { fetchedAt: string; weather: { available: boolean }; traffic: { available: boolean; complete: boolean }; errors: string[] }; modelCalls?: { inputTokens: number | null; outputTokens: number | null }[]; sources?: Source[] } };

export function AudioDetails({ asset }: { asset: Asset }) {
  const m = asset.metadata;
  const tokens = m?.modelCalls?.reduce((sum, call) => sum + (call.inputTokens || 0) + (call.outputTokens || 0), 0);
  return <div className="space-y-3">
    {m?.supersededBy && <p className="text-sm text-amber-700 dark:text-amber-400">Diese historische Fassung wurde korrigiert. <a href="/nachrichten" className="underline">Aktuelle Fassung unter Nachrichten öffnen</a>.</p>}
    {m?.correctedAt && <p className="text-xs text-neutral-500">Korrigierte Fassung vom {time(m.correctedAt)}. Das Ausstrahlungsprotokoll bewahrt die ursprünglich gesendete Aufnahme.</p>}
    <audio controls preload="none" src={`/api/radio/assets/${asset.id}`} className="w-full" />
    <p className="text-xs text-neutral-500">Erstellt {time(asset.createdAt)} · {duration(asset.duration)}{m?.presenter ? ` · ${m.presenter}` : ""}{m?.language ? ` · ${languageLabel(m.language)}` : ""}</p>
    <p className="break-all font-mono text-xs text-neutral-500">Audio-ID: {asset.id}</p>
    {m?.mainAssetId && <p className="text-xs text-neutral-500">Hauptnachrichten: <a href={`/api/radio/assets/${m.mainAssetId}`} className="break-all underline">{m.mainAssetId}</a>{m.editionSlot ? ` · Ausgabe ${time(m.editionSlot)}` : ""}{m.mainReused ? " · unverändert wiederverwendet" : ""}</p>}
    {m?.service && <div className="space-y-1 text-xs"><p>Wetter und Verkehr frisch abgerufen: {time(m.service.fetchedAt)} · Wetter: {m.service.weather.available ? "verfügbar" : "nicht verfügbar"} · Verkehr: {m.service.traffic.complete ? "A60 / A63 / A643, Raum Mainz" : m.service.traffic.available ? "teilweise verfügbar" : "nicht verfügbar"}</p>{m.service.errors.map(e => <p key={e} className="text-amber-700 dark:text-amber-400">{e}</p>)}</div>}
    {m?.mainUnavailable && <p className="text-xs text-amber-700 dark:text-amber-400">Hauptnachrichten nicht bereit; nur Wetter und Verkehr.</p>}
    {m?.authorModel && <p className="text-xs text-neutral-500">Autor: {m.authorModel} · Prüfung: {m.reviewModel || "—"}{tokens ? ` · ${tokens.toLocaleString("de-DE")} Tokens` : ""}</p>}
    {asset.script && <details><summary className="cursor-pointer text-sm">Transkript und Quellen</summary><p className="mt-3 whitespace-pre-line text-sm">{asset.script}</p><ul className="mt-3 space-y-1 text-xs">{m?.sources?.map(s => <li key={s.id}><a href={s.url} target="_blank" rel="noreferrer" className="underline">{s.title}</a>{s.publishedAt ? ` · ${time(s.publishedAt)}` : ""}</li>)}</ul></details>}
  </div>;
}

