"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, Trash2, Volume2 } from "lucide-react";
import type { Device, Zone } from "@/types";

export default function DevicesPage() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const [dRes, zRes] = await Promise.all([fetch("/api/devices"), fetch("/api/zones")]);
      if (!dRes.ok || !zRes.ok) throw new Error(`devices ${dRes.status}, zones ${zRes.status}`);
      setDevices(await dRes.json());
      setZones(await zRes.json());
    } catch (e) {
      console.error("[devices] reload failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 5000);
    return () => clearInterval(t);
  }, [reload]);

  const assign = async (id: string, zoneId: string | null) => {
    await fetch(`/api/devices/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ zoneId }),
    });
    reload();
  };

  const identify = async (id: string) => {
    await fetch(`/api/devices/${id}/identify`, { method: "POST" });
  };

  const removeDevice = async (id: string) => {
    if (!confirm("Gerät aus der Datenbank entfernen?")) return;
    await fetch(`/api/devices/${id}`, { method: "DELETE" });
    reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Geräte</h1>
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            {devices.length} insgesamt · {devices.filter((d) => d.online).length} online
          </p>
        </div>
        <button onClick={reload} className="btn-outline w-full sm:w-auto">
          <RefreshCw className="h-4 w-4" aria-hidden /> Aktualisieren
        </button>
      </div>

      {loading ? (
        <div className="card">Laden…</div>
      ) : devices.length === 0 ? (
        <div className="card text-sm text-neutral-500">
          Noch keine Geräte verbunden. Ein Pi erscheint hier automatisch, sobald er sich verbindet.
        </div>
      ) : (
        <>
          {/* Mobile: card list */}
          <div className="grid gap-3 md:hidden">
            {devices.map((d) => (
              <DeviceCard key={d.id} d={d} zones={zones} onAssign={assign} onIdentify={identify} onRemove={removeDevice} />
            ))}
          </div>

          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-2xl border border-neutral-200 md:block dark:border-neutral-800">
            <table className="min-w-full divide-y divide-neutral-200 dark:divide-neutral-800">
              <thead className="bg-neutral-50 dark:bg-neutral-900">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-neutral-500">
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Hostname</th>
                  <th className="px-4 py-3">Serial</th>
                  <th className="px-4 py-3">IP</th>
                  <th className="px-4 py-3">Zone</th>
                  <th className="px-4 py-3 text-right">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200 bg-white dark:divide-neutral-800 dark:bg-neutral-950">
                {devices.map((d) => (
                  <tr key={d.id} className="text-sm">
                    <td className="px-4 py-3"><StatusBadge d={d} /></td>
                    <td className="px-4 py-3 font-medium">{d.hostname}</td>
                    <td className="px-4 py-3 font-mono text-xs text-neutral-500">{d.serial}</td>
                    <td className="px-4 py-3 text-neutral-500">{d.ip || "—"}</td>
                    <td className="px-4 py-3">
                      <ZoneSelect value={d.zoneId} zones={zones} onChange={(v) => assign(d.id, v)} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button onClick={() => identify(d.id)} disabled={!d.online} className="btn-outline">
                          <Volume2 className="h-4 w-4" aria-hidden /> Identifizieren
                        </button>
                        <button
                          onClick={() => removeDevice(d.id)}
                          className="btn-ghost text-red-600 hover:text-red-700 dark:text-red-400"
                          aria-label="Gerät entfernen"
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function DeviceCard({
  d, zones, onAssign, onIdentify, onRemove,
}: {
  d: Device;
  zones: Zone[];
  onAssign: (id: string, zoneId: string | null) => void;
  onIdentify: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="card space-y-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="font-semibold">{d.hostname}</div>
          <div className="mt-0.5 font-mono text-xs text-neutral-500">{d.serial}</div>
          <div className="text-xs text-neutral-500">IP: {d.ip || "—"}</div>
        </div>
        <StatusBadge d={d} />
      </div>
      <ZoneSelect value={d.zoneId} zones={zones} onChange={(v) => onAssign(d.id, v)} />
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => onIdentify(d.id)} disabled={!d.online} className="btn-outline">
          <Volume2 className="h-4 w-4" aria-hidden /> Identifizieren
        </button>
        <button
          onClick={() => onRemove(d.id)}
          className="btn-ghost text-red-600 hover:text-red-700 dark:text-red-400"
        >
          <Trash2 className="h-4 w-4" aria-hidden /> Entfernen
        </button>
      </div>
    </div>
  );
}

function StatusBadge({ d }: { d: Device }) {
  if (d.online) return <span className="badge-online"><span className="dot bg-green-500" /> online</span>;
  if (d.zoneId) return <span className="badge-offline"><span className="dot bg-red-500" /> offline</span>;
  return <span className="badge-unassigned"><span className="dot bg-yellow-500" /> neu</span>;
}

function ZoneSelect({
  value, zones, onChange,
}: { value: string | null; zones: Zone[]; onChange: (v: string | null) => void }) {
  return (
    <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
      <option value="">— keine —</option>
      {zones.map((z) => (<option key={z.id} value={z.id}>{z.name}</option>))}
    </select>
  );
}
