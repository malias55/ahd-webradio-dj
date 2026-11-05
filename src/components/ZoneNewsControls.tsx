"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Newspaper, Square } from "lucide-react";
import type { Zone } from "@/types";
import { activeSpeakerZone, startSpeakerMode, stopSpeakerMode } from "@/lib/speakerMode";

const labels = { tr: "Türkische Nachrichten", de: "Deutsche Nachrichten" };
type Language = keyof typeof labels;

export function ZoneNewsControls({ zone, busy, onChange }: { zone: Zone; busy: boolean; onChange: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId(), description = useId();
  const [choice, setChoice] = useState<Language>("tr");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [active, setActive] = useState(zone.manualNews);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { setActive(zone.manualNews); }, [zone.manualNews]);

  function confirm(language: Language) {
    setError("");
    setChoice(language);
    setDialogOpen(true);
    dialog.current?.showModal();
  }

  async function change(stop: boolean) {
    if (pending || (stop && !active)) return;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/zones/${encodeURIComponent(zone.id)}/news`, {
        method: stop ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(stop ? { id: active?.id } : { language: choice }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Die Wiedergabe konnte nicht geändert werden.");
      }
      setActive(stop ? null : await response.json());
      dialog.current?.close();
      if (activeSpeakerZone() === zone.id) {
        stopSpeakerMode();
        void startSpeakerMode(zone.id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Die Verbindung ist fehlgeschlagen.");
    } finally {
      setPending(false);
      onChange();
    }
  }

  return <div className="space-y-2">
    {active ? (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium" role="status">{labels[active.language]} laufen</p>
        <button type="button" className="btn-danger" disabled={pending} onClick={() => void change(true)}>
          <Square className="h-4 w-4" aria-hidden /> {pending ? "Wird abgebrochen …" : "Nachrichten abbrechen"}
        </button>
      </div>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2">
        {(["tr", "de"] as const).map(language => <button type="button" key={language} className="btn-outline" disabled={busy || pending} onClick={() => confirm(language)}>
          <Newspaper className="h-4 w-4 shrink-0" aria-hidden /> {labels[language]} starten
        </button>)}
      </div>
    )}
    {error && !dialogOpen && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
    <dialog ref={dialog} aria-labelledby={heading} aria-describedby={description}
      onClose={() => setDialogOpen(false)}
      onCancel={event => { if (pending) event.preventDefault(); }}
      className="card m-auto w-[min(92vw,28rem)] text-inherit backdrop:bg-black/50">
      <div className="space-y-4">
        <h3 id={heading} className="text-lg font-semibold">Sind Sie sicher?</h3>
        <p id={description} className="text-sm">{labels[choice]} in <strong>{zone.name}</strong> starten? Gespielt wird die letzte fertige Ausgabe von heute.</p>
        {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn-outline" autoFocus disabled={pending} onClick={() => { setError(""); dialog.current?.close(); }}>Abbrechen</button>
          <button type="button" className="btn-primary" disabled={pending} onClick={() => void change(false)}>{pending ? "Wird gestartet …" : "Jetzt starten"}</button>
        </div>
      </div>
    </dialog>
  </div>;
}
