"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Newspaper, Square } from "lucide-react";
import type { Zone } from "@/types";
import { newsAllowedOn } from "@/lib/radio/config";
import { activeSpeakerZone, startSpeakerMode, stopSpeakerMode } from "@/lib/speakerMode";

const labels = { tr: "Türkische Nachrichten", de: "Deutsche Nachrichten" };
type Language = keyof typeof labels;

export function ZoneNewsControls({ zone, busy, onChange }: { zone: Zone; busy: boolean; onChange: () => void }) {
  const stopButton = useRef<HTMLButtonElement>(null);
  const heading = useId(), description = useId();
  const [choice, setChoice] = useState<Language | null>(null);
  const [active, setActive] = useState(zone.manualNews);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const newsDay = newsAllowedOn();
  useEffect(() => { setActive(zone.manualNews); }, [zone.manualNews]);

  async function change(stop: boolean) {
    if (pending || (stop ? !active : !choice)) return;
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
      setChoice(null);
      if (!stop) requestAnimationFrame(() => stopButton.current?.focus());
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
        <button ref={stopButton} type="button" className="btn-danger" disabled={pending} onClick={() => void change(true)}>
          <Square className="h-4 w-4" aria-hidden /> {pending ? "Wird abgebrochen …" : "Nachrichten abbrechen"}
        </button>
      </div>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2">
        {(["tr", "de"] as const).map(language => (
          <Popover.Root key={language} open={choice === language} onOpenChange={open => {
            if (pending) return;
            setError("");
            setChoice(open ? language : null);
          }}>
            <Popover.Trigger asChild>
              <button type="button" className="btn-outline" disabled={busy || pending || !newsDay}>
                <Newspaper className="h-4 w-4 shrink-0" aria-hidden /> {labels[language]} starten
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content side="bottom" align="start" sideOffset={8} collisionPadding={12} hideWhenDetached
                aria-labelledby={`${heading}-${language}`} aria-describedby={`${description}-${language}`}
                onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}
                onInteractOutside={event => { if (pending) event.preventDefault(); }}
                className="z-50 max-h-[var(--radix-popover-content-available-height)] w-[min(22rem,calc(100vw-1.5rem))] space-y-4 overflow-y-auto rounded-lg border border-neutral-200 bg-white p-4 text-neutral-900 shadow-lg outline-none dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
                <h3 id={`${heading}-${language}`} className="text-base font-semibold">Sind Sie sicher?</h3>
                <p id={`${description}-${language}`} className="text-sm">{labels[language]} in <strong>{zone.name}</strong> starten? Gespielt wird die letzte fertige Ausgabe von heute.</p>
                {error && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  <Popover.Close asChild>
                    <button type="button" className="btn-outline" disabled={pending}>Abbrechen</button>
                  </Popover.Close>
                  <button type="button" className="btn-primary" disabled={pending} onClick={() => void change(false)}>{pending ? "Wird gestartet …" : "Jetzt starten"}</button>
                </div>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        ))}
      </div>
    )}
    {error && !choice && <p className="text-sm text-red-700 dark:text-red-300" role="alert">{error}</p>}
    {!newsDay && !active && <p className="text-xs text-neutral-500">Sonntags werden keine Nachrichten gesendet.</p>}
  </div>;
}
