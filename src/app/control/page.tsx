"use client";

import { useCallback, useEffect, useState } from "react";
import { Headphones, Megaphone, MonitorPlay, Square, Volume2 } from "lucide-react";
import type { Zone, Device } from "@/types";
import { patchZone, sendZoneCommand } from "@/lib/apiClient";
import {
  activeBroadcast,
  startBroadcast,
  stopBroadcast,
  type BroadcastMode,
  type CaptureSource,
} from "@/lib/broadcaster";
import {
  activeSpeakerZone,
  startSpeakerMode,
  stopSpeakerMode,
  subscribeSpeaker,
} from "@/lib/speakerMode";

type ZoneWithDevices = Zone & { devices: Device[] };

export default function ControlPage() {
  const [zones, setZones] = useState<ZoneWithDevices[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveState, setLiveState] = useState<{ zoneIds: string[]; mode: BroadcastMode } | null>(null);
  const [speakerZoneId, setSpeakerZoneId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await fetch("/api/zones");
      if (!r.ok) throw new Error(`zones ${r.status}`);
      setZones(await r.json());
    } catch (e) {
      console.error("[control] reload failed:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
    const t = setInterval(reload, 8000);
    return () => clearInterval(t);
  }, [reload]);

  useEffect(() => {
    const sync = () => {
      const s = activeBroadcast();
      setLiveState(s ? { zoneIds: s.zoneIds, mode: s.mode } : null);
    };
    const t = setInterval(sync, 500);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onHide = () => { stopBroadcast().catch(() => {}); stopSpeakerMode(); };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  useEffect(() => {
    const sync = () => setSpeakerZoneId(activeSpeakerZone());
    sync();
    return subscribeSpeaker(sync);
  }, []);

  const updateVolume = async (zoneId: string, v: number) => {
    await sendZoneCommand(zoneId, { type: "volume", value: v });
    await patchZone(zoneId, { volume: v });
    reload();
  };

  const doBroadcast = async (zoneId: string, source: CaptureSource, mode: BroadcastMode) => {
    try {
      await startBroadcast({ zoneIds: [zoneId], source, mode });
      setLiveState({ zoneIds: [zoneId], mode });
    } catch (e) {
      alert((e as Error).message);
    }
  };
  const endBroadcast = async () => { await stopBroadcast(); setLiveState(null); };

  const toggleSpeaker = async (zone: ZoneWithDevices) => {
    if (speakerZoneId === zone.id) { stopSpeakerMode(); return; }
    const url = zone.streamUrl;
    if (!url) { alert("Für diese Zone ist keine Stream-URL hinterlegt."); return; }
    try {
      await startSpeakerMode(zone.id, url);
    } catch (e) {
      alert(`Wiedergabe fehlgeschlagen: ${(e as Error).message}`);
    }
  };

  // "Durchsage an alle" — toggles the same mic broadcast across every zone.
  const announceAll = async () => {
    if (liveState) { await endBroadcast(); return; }
    try {
      const ids = zones.map((z) => z.id);
      if (ids.length === 0) return;
      await startBroadcast({ zoneIds: ids, source: "microphone", mode: "announce" });
      setLiveState({ zoneIds: ids, mode: "announce" });
    } catch (e) { alert((e as Error).message); }
  };

  const globalBroadcasting =
    liveState !== null &&
    liveState.mode === "announce" &&
    liveState.zoneIds.length === zones.length;

  return (
    <div className="space-y-5 sm:space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Steuerung</h1>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Lautstärke, Tab-Audio und Durchsagen pro Zone. Der native Stream läuft automatisch,
          wenn keine Live-Quelle aktiv ist. Neue Zonen werden direkt in Postgres angelegt.
        </p>
      </div>

      {liveState && (
        <div className="card flex flex-col gap-3 border-brand-500 bg-brand-50 text-brand-900 dark:bg-brand-700/10 dark:text-brand-100 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            {liveState.mode === "announce"
              ? <Megaphone className="h-5 w-5" aria-hidden />
              : <MonitorPlay className="h-5 w-5" aria-hidden />}
            <div>
              <div className="text-sm font-semibold">
                {liveState.mode === "announce" ? "Durchsage läuft" : "Tab-Audio läuft"}
              </div>
              <div className="text-xs opacity-80">
                {liveState.zoneIds.length === zones.length ? "alle Zonen" : `${liveState.zoneIds.length} Zone(n)`}
              </div>
            </div>
          </div>
          <button onClick={endBroadcast} className="btn-danger w-full sm:w-auto">
            <Square className="h-4 w-4" aria-hidden />
            {liveState.mode === "announce" ? "Durchsage beenden" : "Tab-Audio beenden"}
          </button>
        </div>
      )}

      <div className="card flex flex-wrap items-center gap-2">
        <span className="mr-1 w-full text-sm font-semibold sm:w-auto">Alle Zonen:</span>
        <button
          onClick={announceAll}
          disabled={liveState !== null && !globalBroadcasting}
          className={`btn flex-1 sm:flex-none ${
            globalBroadcasting
              ? "bg-red-700 text-white hover:bg-red-800"
              : "bg-red-600 text-white hover:bg-red-700"
          } disabled:opacity-50`}
        >
          {globalBroadcasting
            ? <Square className="h-4 w-4" aria-hidden />
            : <Megaphone className="h-4 w-4" aria-hidden />}
          {globalBroadcasting ? "Durchsage an alle beenden" : "Durchsage an alle beginnen"}
        </button>
      </div>

      {loading ? (
        <div className="card">Laden…</div>
      ) : zones.length === 0 ? (
        <div className="card text-sm text-neutral-500">
          Noch keine Zonen in der Datenbank. Lege sie direkt in Postgres an.
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {zones.map((z) => (
            <ZoneCard
              key={z.id}
              zone={z}
              liveHere={liveState?.zoneIds.includes(z.id) ?? false}
              liveMode={liveState?.mode}
              anyLive={!!liveState}
              globalAnnounce={globalBroadcasting}
              speakerActive={speakerZoneId === z.id}
              speakerElsewhere={speakerZoneId !== null && speakerZoneId !== z.id}
              onVolume={(v) => updateVolume(z.id, v)}
              onBroadcast={(src, mode) => doBroadcast(z.id, src, mode)}
              onEndBroadcast={endBroadcast}
              onToggleSpeaker={() => toggleSpeaker(z)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ZoneCard(props: {
  zone: ZoneWithDevices;
  liveHere: boolean;
  liveMode?: BroadcastMode;
  anyLive: boolean;
  globalAnnounce: boolean;
  speakerActive: boolean;
  speakerElsewhere: boolean;
  onVolume: (v: number) => void;
  onBroadcast: (src: CaptureSource, mode: BroadcastMode) => void;
  onEndBroadcast: () => void;
  onToggleSpeaker: () => void;
}) {
  const { zone, liveHere, liveMode, anyLive, globalAnnounce, speakerActive, speakerElsewhere } = props;
  const [volume, setVolume] = useState(zone.volume);
  useEffect(() => { setVolume(zone.volume); }, [zone.volume]);

  const onlineCount = zone.devices?.filter((d) => d.status === "online").length ?? 0;
  const totalCount = zone.devices?.length ?? 0;

  const tabActive = liveHere && liveMode === "stream";
  const announceActive = liveHere && liveMode === "announce";

  // Disable zone-local buttons when a global announce is running (covers every zone)
  // or when *another* zone is broadcasting.
  const disableZoneActions = anyLive && !liveHere;

  return (
    <div className={`card space-y-5 ${liveHere ? "ring-2 ring-brand-500" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold sm:text-xl">{zone.name}</h2>
          <p className="text-xs text-neutral-500">
            {onlineCount}/{totalCount} Geräte online
            {liveHere && (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-brand-600 dark:text-brand-400">
                · {announceActive ? "LIVE-Durchsage" : "LIVE Tab-Audio"}
              </span>
            )}
          </p>
        </div>
        <span className={onlineCount > 0 ? "badge-online" : "badge-offline"}>
          <span className={`dot ${onlineCount > 0 ? "bg-green-500" : "bg-red-500"}`} />
          {onlineCount > 0 ? "aktiv" : "inaktiv"}
        </span>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="inline-flex items-center gap-1.5 text-neutral-600 dark:text-neutral-400">
            <Volume2 className="h-4 w-4" aria-hidden />
            Lautstärke
          </span>
          <span className="font-mono">{volume}%</span>
        </div>
        <input
          type="range" min={0} max={100} value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          onMouseUp={(e) => props.onVolume(Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => props.onVolume(Number((e.target as HTMLInputElement).value))}
          className="w-full accent-brand-600"
          disabled={globalAnnounce}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tabActive ? (
          <button onClick={props.onEndBroadcast} className="btn-danger">
            <Square className="h-4 w-4" aria-hidden /> Tab-Audio beenden
          </button>
        ) : (
          <button
            onClick={() => props.onBroadcast("tab", "stream")}
            className="btn-primary"
            disabled={disableZoneActions}
          >
            <MonitorPlay className="h-4 w-4" aria-hidden /> Tab-Audio senden
          </button>
        )}
        {announceActive ? (
          <button onClick={props.onEndBroadcast} className="btn-danger">
            <Square className="h-4 w-4" aria-hidden /> Durchsage beenden
          </button>
        ) : (
          <button
            onClick={() => props.onBroadcast("microphone", "announce")}
            className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            disabled={disableZoneActions}
          >
            <Megaphone className="h-4 w-4" aria-hidden /> Durchsage beginnen
          </button>
        )}
      </div>

      <div>
        <button
          onClick={props.onToggleSpeaker}
          disabled={speakerElsewhere || !zone.streamUrl}
          className={speakerActive ? "btn-danger w-full" : "btn-outline w-full"}
          title={!zone.streamUrl ? "Keine Stream-URL in den Zonen-Einstellungen" : ""}
        >
          {speakerActive
            ? <Square className="h-4 w-4" aria-hidden />
            : <Headphones className="h-4 w-4" aria-hidden />}
          {speakerActive ? "Lautsprecher-Modus beenden" : "Lautsprecher-Modus starten"}
        </button>
        <p className="mt-1.5 text-xs text-neutral-500">
          Dieses Gerät spielt den Zonen-Stream lokal ab. Nur eine Zone gleichzeitig.
        </p>
      </div>

      <p className="text-xs text-neutral-500">
        Wenn kein Live-Signal aktiv ist, läuft automatisch der native Stream aus den Zonen-Einstellungen.
      </p>
    </div>
  );
}
