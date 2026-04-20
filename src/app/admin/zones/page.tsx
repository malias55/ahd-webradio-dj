"use client";

import { useCallback, useEffect, useState } from "react";
import { Save } from "lucide-react";
import type { Zone } from "@/types";

export default function ZonesPage() {
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setAdmin(d.admin)).catch(() => {});
  }, []);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/zones");
      if (!r.ok) throw new Error(`zones ${r.status}`);
      setZones(await r.json());
    } catch (e) {
      console.error("[zones] reload failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const update = async (id: string, patch: Partial<Zone>) => {
    await fetch(`/api/zones/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    reload();
  };

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Zonen</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Hier werden Stream-URL, Quelle und Standard-Lautstärke pro Zone gepflegt. Neue Zonen werden direkt in Postgres angelegt.
        </p>
      </div>

      {loading ? (
        <div className="card">Laden…</div>
      ) : zones.length === 0 ? (
        <div className="card text-sm text-neutral-500">
          Noch keine Zonen in der Datenbank.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {zones.map((z) => (
            <ZoneCard key={z.id} zone={z} admin={admin} onUpdate={update} />
          ))}
        </div>
      )}
    </div>
  );
}

function ZoneCard({
  zone, admin, onUpdate,
}: {
  zone: Zone;
  admin: boolean;
  onUpdate: (id: string, patch: Partial<Zone>) => void;
}) {
  const [streamUrl, setStreamUrl] = useState(zone.streamUrl ?? "");
  const deviceCount = zone.devices?.length ?? 0;

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{zone.name}</h2>
          <p className="text-xs text-neutral-500">{deviceCount} Geräte zugeordnet</p>
        </div>
      </div>

      <label className="block">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Standard-Quelle</span>
        <select
          className="input mt-1"
          value={zone.defaultSource}
          disabled={!admin}
          onChange={(e) => onUpdate(zone.id, { defaultSource: e.target.value })}
        >
          <option value="azuracast">AzuraCast (Stream)</option>
          <option value="custom_url">Benutzerdefinierte URL</option>
          <option value="silent">Stumm</option>
        </select>
      </label>

      <label className="block">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Stream-URL</span>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row">
          <input
            className="input flex-1"
            value={streamUrl}
            disabled={zone.defaultSource !== "custom_url" || !admin}
            onChange={(e) => setStreamUrl(e.target.value)}
            placeholder="https://..."
          />
          {admin && zone.defaultSource === "custom_url" && (
            <button
              className="btn-outline"
              onClick={() => onUpdate(zone.id, { streamUrl: streamUrl || null })}
            >
              <Save className="h-4 w-4" aria-hidden /> Speichern
            </button>
          )}
        </div>
        {zone.defaultSource === "azuracast" && (
          <p className="mt-1 text-xs text-neutral-400">AzuraCast-URL wird vom Server vorgegeben und kann nicht ge��ndert werden.</p>
        )}
      </label>

      <label className="block">
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
          Standard-Lautstärke: {zone.volume}%
        </span>
        <input
          type="range"
          min={0}
          max={100}
          defaultValue={zone.volume}
          disabled={!admin}
          className="mt-2 w-full accent-brand-600"
          onMouseUp={(e) => admin && onUpdate(zone.id, { volume: Number((e.target as HTMLInputElement).value) })}
          onTouchEnd={(e) => admin && onUpdate(zone.id, { volume: Number((e.target as HTMLInputElement).value) })}
        />
      </label>
    </div>
  );
}
