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
  activeSpeakerHasSource,
  activeSpeakerIsLive,
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
  const [speakerLive, setSpeakerLive] = useState(false);
  const [speakerHasSource, setSpeakerHasSource] = useState(false);

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
    const sync = () => {
      setSpeakerZoneId(activeSpeakerZone());
      setSpeakerLive(activeSpeakerIsLive());
      setSpeakerHasSource(activeSpeakerHasSource());
    };
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
    // No throw — startSpeakerMode enters wait-state if no source is currently available,
    // then picks up whatever becomes live via its internal poll.
    await startSpeakerMode(zone.id);
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
              speakerLive={speakerZoneId === z.id && speakerLive}
              speakerWaiting={speakerZoneId === z.id && !speakerHasSource}
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
  speakerLive: boolean;
  speakerWaiting: boolean;
  onVolume: (v: number) => void;
  onBroadcast: (src: CaptureSource, mode: BroadcastMode) => void;
  onEndBroadcast: () => void;
  onToggleSpeaker: () => void;
}) {
  const { zone, liveHere, liveMode, anyLive, globalAnnounce, speakerActive, speakerElsewhere, speakerLive, speakerWaiting } = props;
  const [volume, setVolume] = useState(zone.volume);
  useEffect(() => { setVolume(zone.volume); }, [zone.volume]);

  const onlineCount = zone.devices?.filter((d) => d.status === "online").length ?? 0;
  const totalCount = zone.devices?.length ?? 0;
  // "aktiv" means the zone has audio in motion: live browser-broadcast OR
  // Pi online OR AzuraCast native stream is reachable.
  const nativeOnline = !!zone.nowPlaying?.online;
  const zoneActive = onlineCount > 0 || !!zone.liveBroadcast || nativeOnline;

  const tabActive = liveHere && liveMode === "stream";
  const announceActive = liveHere && liveMode === "announce";

  // Disable zone-local buttons when a global announce is running (covers every zone)
  // or when *another* zone is broadcasting.
  const disableZoneActions = anyLive && !liveHere;

  return (
    <div className={`card space-y-5 ${liveHere ? "ring-2 ring-brand-500" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold sm:text-xl">{zone.name}</h2>
          <p className="text-xs text-neutral-500">
            {onlineCount}/{totalCount} Geräte online
            {liveHere && (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-brand-600 dark:text-brand-400">
                · {announceActive ? "LIVE-Durchsage" : "LIVE Tab-Audio"}
              </span>
            )}
          </p>
          {zone.nowPlaying?.online && zone.nowPlaying?.title && !liveHere && (
            <p className="mt-1 truncate text-xs text-neutral-600 dark:text-neutral-400">
              ♪ {zone.nowPlaying.artist ? `${zone.nowPlaying.artist} – ` : ""}{zone.nowPlaying.title}
            </p>
          )}
        </div>
        <span className={zoneActive ? "badge-online" : "badge-offline"}>
          <span className={`dot ${zoneActive ? "bg-green-500" : "bg-red-500"}`} />
          {zone.liveBroadcast ? "live" : zoneActive ? "aktiv" : "inaktiv"}
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
          disabled={speakerElsewhere}
          className={speakerActive ? "btn-danger w-full" : "btn-outline w-full"}
        >
          {speakerActive
            ? <Square className="h-4 w-4" aria-hidden />
            : <Headphones className="h-4 w-4" aria-hidden />}
          {speakerActive ? "Lautsprecher-Modus beenden" : "Lautsprecher-Modus starten"}
        </button>
        <p className="mt-1.5 text-xs text-neutral-500">
          {speakerActive
            ? (speakerWaiting
                ? "Warte auf Quelle… Sobald ein Live-Stream oder der native Stream verfügbar ist, wird er abgespielt."
                : speakerLive
                  ? "Spielt den aktiven Live-Stream dieser Zone ab."
                  : "Spielt den nativen Stream dieser Zone ab.")
            : "Dieses Gerät gibt den Zonen-Stream lokal wieder. Bei aktiver Tab-Audio/Durchsage wird automatisch der Live-Stream gespielt."}
        </p>
      </div>

      <p className="text-xs text-neutral-500">
        Wenn kein Live-Signal aktiv ist, läuft automatisch der native Stream aus den Zonen-Einstellungen.
      </p>
    </div>
  );
}
