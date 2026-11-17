"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Headphones, Megaphone, MonitorPlay, Square, Volume2 } from "lucide-react";
import type { Zone, Device } from "@/types";
import { ZoneNewsControls } from "@/components/ZoneNewsControls";
import { sendZoneCommand } from "@/lib/apiClient";
import {
  ANNOUNCE_MAX_MS,
  activeBroadcast,
  announcementStatus,
  peakLevel,
  startBroadcast,
  stopBroadcast,
  subscribeBroadcaster,
  type BroadcastMode,
  type CaptureSource,
} from "@/lib/broadcaster";
import {
  activeSpeakerPlaybackStatus,
  activeSpeakerIsLive,
  activeSpeakerZone,
  activeSpeakerVolume,
  startSpeakerMode,
  stopSpeakerMode,
  subscribeSpeaker,
  resumeSpeakerPlayback,
  type SpeakerPlaybackStatus,
} from "@/lib/speakerMode";

type ZoneWithDevices = Zone & { devices: Device[] };

export default function ControlPage() {
  const [zones, setZones] = useState<ZoneWithDevices[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveState, setLiveState] = useState<{ zoneIds: string[]; mode: BroadcastMode; startedAt: number } | null>(null);
  const startingRef = useRef(false);
  const [starting, setStarting] = useState<{ zoneIds: string[]; mode: BroadcastMode } | null>(null);
  const [speakerZoneId, setSpeakerZoneId] = useState<string | null>(null);
  const [speakerLive, setSpeakerLive] = useState(false);
  const [speakerStatus, setSpeakerStatus] = useState<SpeakerPlaybackStatus>("idle");
  const [me, setMe] = useState<{ admin: boolean; email?: string; name?: string }>({ admin: false });

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => setMe({ admin: d.admin, email: d.email, name: d.name })).catch(() => {});
  }, []);

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
      setLiveState(s ? { zoneIds: s.zoneIds, mode: s.mode, startedAt: s.startedAt } : null);
    };
    sync();
    return subscribeBroadcaster(sync);
  }, []);

  useEffect(() => {
    const onHide = () => { stopBroadcast().catch(() => {}); };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  useEffect(() => {
    const sync = () => {
      setSpeakerZoneId(activeSpeakerZone());
      setSpeakerLive(activeSpeakerIsLive());
      setSpeakerStatus(activeSpeakerPlaybackStatus());
      const zoneId = activeSpeakerZone(), volume = activeSpeakerVolume();
      if (zoneId && volume !== null) setZones(previous => previous.map(zone => zone.id === zoneId && zone.volume !== volume ? { ...zone, volume } : zone));
    };
    sync();
    return subscribeSpeaker(sync);
  }, []);

  const updateVolume = async (zoneId: string, v: number) => {
    try { await sendZoneCommand(zoneId, { type: "volume", value: v }); }
    catch (error) { alert(error instanceof Error ? error.message : "Die Lautstärke konnte nicht gespeichert werden."); }
    await reload();
  };

  const doBroadcast = async (zoneIds: string[], source: CaptureSource, mode: BroadcastMode) => {
    if (startingRef.current || !zoneIds.length) return;
    startingRef.current = true;
    setStarting({ zoneIds, mode });
    try {
      if (speakerZoneId) stopSpeakerMode();
      await startBroadcast({ zoneIds, source, mode, email: me.email, name: me.name });
    } catch (e) {
      alert((e as Error).message);
    } finally {
      startingRef.current = false;
      setStarting(null);
    }
  };
  const endBroadcast = async () => { await stopBroadcast(); };

  const toggleSpeaker = async (zone: ZoneWithDevices) => {
    if (speakerZoneId === zone.id) { stopSpeakerMode(); return; }
    // No throw — startSpeakerMode enters wait-state if no source is currently available,
    // then picks up whatever becomes live via its internal poll.
    await startSpeakerMode(zone.id);
  };

  // "Durchsage an alle" — toggles the same mic broadcast across every zone.
  const announceAll = async () => {
    if (liveState) { await endBroadcast(); return; }
    await doBroadcast(zones.map(z => z.id), "microphone", "announce");
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
          Lautstärke, Tab-Audio und Durchsagen pro Zone. Musik läuft täglich von 07:00 bis 21:00 Uhr,
          wenn keine Live-Quelle aktiv ist. Nachrichten laufen montags bis samstags um 07:00 und 21:00 Uhr auf Türkisch sowie von 08:00 bis 20:00 Uhr stündlich auf Deutsch. Hatim läuft täglich von 22:00 bis 04:00 Uhr.
        </p>
      </div>

      <div className="card flex flex-wrap items-center gap-2">
        <span className="mr-1 w-full text-sm font-semibold sm:w-auto">Alle Zonen:</span>
        <button
          onClick={announceAll}
          disabled={!!starting || (liveState !== null && !globalBroadcasting)}
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
        {starting?.mode === "announce" && starting.zoneIds.length === zones.length && <AnnouncementPreparing />}
        {globalBroadcasting && liveState && <LiveMeter startedAt={liveState.startedAt} mode={liveState.mode} />}
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
              startedAt={liveState?.startedAt}
              starting={!!starting}
              preparingHere={starting?.mode === "announce" && starting.zoneIds.includes(z.id)}
              anyLive={!!liveState}
              globalAnnounce={globalBroadcasting}
              speakerActive={speakerZoneId === z.id}
              speakerElsewhere={speakerZoneId !== null && speakerZoneId !== z.id}
              speakerLive={speakerZoneId === z.id && speakerLive}
              speakerStatus={speakerZoneId === z.id ? speakerStatus : "idle"}
              isAdmin={me.admin}
              myEmail={me.email}
              onVolume={(v) => updateVolume(z.id, v)}
              onBroadcast={(src, mode) => doBroadcast([z.id], src, mode)}
              onEndBroadcast={endBroadcast}
              onToggleSpeaker={() => toggleSpeaker(z)}
              onNewsChange={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementPreparing() {
  return (
    <div role="status" className="w-full rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
      <p className="font-semibold">Durchsage wird vorbereitet…</p>
      <p className="text-sm">Noch nicht sprechen. Nach dem Gong erscheint „Jetzt sprechen“.</p>
    </div>
  );
}

function LiveMeter({ startedAt, mode }: { startedAt: number; mode: BroadcastMode }) {
  const [level, setLevel] = useState(0);
  const [announcement, setAnnouncement] = useState(announcementStatus);
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const frame = () => {
      setLevel(peakLevel());
      setAnnouncement(announcementStatus());
      if (mode === "announce") {
        const left = Math.max(0, ANNOUNCE_MAX_MS - (Date.now() - startedAt));
        setRemaining(Math.ceil(left / 1000));
      } else {
        setRemaining(null);
      }
      raf = requestAnimationFrame(frame);
    };
    let raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [startedAt, mode]);

  const pct = Math.round(level * 100);
  const ready = announcement?.phase === "speaking";
  const introSeconds = Math.ceil((announcement?.remainingMs ?? 0) / 1000);
  return (
    <div className={`w-full space-y-2 rounded-lg border p-3 ${mode === "announce"
      ? ready
        ? "border-green-400 bg-green-50 text-green-950 dark:border-green-600 dark:bg-green-950 dark:text-green-100"
        : "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      : "border-neutral-200 dark:border-neutral-700"}`}>
      {mode === "announce" && (
        <div role="status" aria-live="polite" aria-atomic="true">
          <p className="text-lg font-bold">
            {ready ? "Jetzt sprechen – Mikrofon an" : announcement?.phase === "paused"
              ? "Audio unterbrochen – bitte neu starten"
              : `Gong läuft – noch ${introSeconds} ${introSeconds === 1 ? "Sekunde" : "Sekunden"}`}
          </p>
          <p className="text-sm">{ready ? "Deine Durchsage wird übertragen." : "Mikrofon noch aus. Bitte mit dem Sprechen warten."}</p>
        </div>
      )}
      <div className="flex items-center gap-3">
        <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
          <div
            className="h-full rounded-full bg-green-500 transition-[width] duration-75"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
        </div>
        <span className="font-mono text-xs">{remaining !== null ? `${remaining}s verbleibend` : "live"}</span>
      </div>
    </div>
  );
}

function ZoneCard(props: {
  zone: ZoneWithDevices;
  liveHere: boolean;
  liveMode?: BroadcastMode;
  startedAt?: number;
  starting: boolean;
  preparingHere?: boolean;
  anyLive: boolean;
  globalAnnounce: boolean;
  speakerActive: boolean;
  speakerElsewhere: boolean;
  speakerLive: boolean;
  speakerStatus: SpeakerPlaybackStatus;
  isAdmin: boolean;
  myEmail?: string;
  onVolume: (v: number) => void;
  onBroadcast: (src: CaptureSource, mode: BroadcastMode) => void;
  onEndBroadcast: () => void;
  onToggleSpeaker: () => void;
  onNewsChange: () => void;
}) {
  const { zone, liveHere, liveMode, anyLive, globalAnnounce, speakerActive, speakerElsewhere, speakerLive, speakerStatus, isAdmin, myEmail } = props;
  const [volume, setVolume] = useState(zone.volume);
  useEffect(() => { setVolume(zone.volume); }, [zone.volume]);
  const speakerMessage = {
    idle: "",
    waiting: "Warte auf Quelle… Sobald ein Live-Stream oder der native Stream verfügbar ist, wird er abgespielt.",
    connecting: "Verbinde mit dem Stream…",
    buffering: "Audiopuffer wird gefüllt. Bei einem Verbindungsabbruch startet die Wiedergabe automatisch neu…",
    reconnecting: "Verbindung unterbrochen. Der Stream wird automatisch neu verbunden…",
    paused: "Wiedergabe pausiert. Mit „Wiedergabe fortsetzen“ oder über den Sperrbildschirm geht es weiter.",
    blocked: "Der Browser hat die Audiowiedergabe blockiert. Bitte Ton freigeben.",
    playing: speakerLive ? "Spielt den aktiven Live-Stream dieser Zone ab." : "Spielt den nativen Stream dieser Zone ab.",
  }[speakerStatus];

  const onlineCount = zone.devices?.filter((d) => d.status === "online").length ?? 0;
  const totalCount = zone.devices?.length ?? 0;
  const nativeOnline = !!zone.nowPlaying?.online;
  const zoneActive = onlineCount > 0 || !!zone.liveBroadcast || nativeOnline;

  const tabActive = liveHere && liveMode === "stream";
  const announceActive = liveHere && liveMode === "announce";

  const si = zone.streamInfo;
  const someoneElseStreaming = si?.broadcasting && si.kind === "stream" && si.email !== myEmail;
  const canStopTab = isAdmin || (si?.email === myEmail);
  const canStartTab = isAdmin || !someoneElseStreaming;

  const disableTabAudio = props.starting || (anyLive && !tabActive) || (!canStartTab);

  return (
    <div className={`card space-y-5 ${liveHere ? "ring-2 ring-brand-500" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold sm:text-xl">{zone.name}</h2>
          <p className="text-xs text-neutral-500">
            {onlineCount}/{totalCount} Geräte online
            {(liveHere || si?.broadcasting) && (
              <span className="ml-2 inline-flex items-center gap-1 font-medium text-brand-600 dark:text-brand-400">
                · {(liveHere ? liveMode : si?.kind) === "announce" ? "LIVE-Durchsage" : "LIVE Tab-Audio"}
              </span>
            )}
          </p>
          {si?.broadcasting && si.kind === "stream" && (
            <p className="mt-1 truncate text-xs text-neutral-600 dark:text-neutral-400">
              Tab-Audio von {si.name || si.email || "Unbekannt"}
              {si.tabTitle && <span className="ml-1 text-neutral-400">— {si.tabTitle}</span>}
            </p>
          )}
          {!si?.broadcasting && zone.nowPlaying?.online && zone.nowPlaying?.title && (
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
          onKeyUp={(e) => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) props.onVolume(Number(e.currentTarget.value)); }}
          className="w-full accent-brand-600"
          disabled={globalAnnounce}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {tabActive || (someoneElseStreaming && canStopTab) ? (
          <button onClick={props.onEndBroadcast} className="btn-danger" disabled={!canStopTab}>
            <Square className="h-4 w-4" aria-hidden /> Tab-Audio beenden
          </button>
        ) : (
          <button
            onClick={() => props.onBroadcast("tab", "stream")}
            className="btn-primary"
            disabled={disableTabAudio}
          >
            <MonitorPlay className="h-4 w-4" aria-hidden />
            {someoneElseStreaming ? "Tab-Audio übernehmen" : "Tab-Audio senden"}
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
            disabled={props.starting || tabActive}
          >
            <Megaphone className="h-4 w-4" aria-hidden /> Durchsage beginnen
          </button>
        )}
      </div>

      {props.preparingHere && !liveHere && <AnnouncementPreparing />}
      {liveHere && liveMode && props.startedAt !== undefined && (
        <LiveMeter startedAt={props.startedAt} mode={liveMode} />
      )}

      <ZoneNewsControls zone={zone} busy={props.starting || liveHere || !!zone.streamInfo?.broadcasting} onChange={props.onNewsChange} />

      <div>
        <button
          onClick={props.onToggleSpeaker}
          disabled={props.starting || speakerElsewhere}
          className={speakerActive ? "btn-danger w-full" : "btn-outline w-full"}
        >
          {speakerActive
            ? <Square className="h-4 w-4" aria-hidden />
            : <Headphones className="h-4 w-4" aria-hidden />}
          {speakerActive ? "Lautsprecher-Modus beenden" : "Lautsprecher-Modus starten"}
        </button>
        {speakerActive && (speakerStatus === "blocked" || speakerStatus === "paused") && (
          <button onClick={resumeSpeakerPlayback} className="btn-primary mt-2 w-full">
            <Volume2 className="h-4 w-4" aria-hidden /> {speakerStatus === "paused" ? "Wiedergabe fortsetzen" : "Ton freigeben"}
          </button>
        )}
        <p className="mt-1.5 text-xs text-neutral-500" role="status">
          {speakerActive
            ? speakerMessage
            : "Dieses Gerät gibt den Zonen-Stream lokal wieder. Bei aktiver Tab-Audio/Durchsage wird automatisch der Live-Stream gespielt."}
        </p>
      </div>

      <p className="text-xs text-neutral-500">
        Wenn kein Live-Signal aktiv ist, läuft automatisch der native Stream aus den Zonen-Einstellungen.
      </p>
    </div>
  );
}
