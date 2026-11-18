"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { attachSpeakerLifecycle, activeSpeakerPlaybackStatus, resumeSpeakerPlayback, subscribeSpeaker } from "@/lib/speakerMode";

export function SpeakerPlaybackLifecycle() {
  const pathname = usePathname();
  const [status, setStatus] = useState(activeSpeakerPlaybackStatus);
  useEffect(() => attachSpeakerLifecycle(window), []);
  useEffect(() => {
    const sync = () => setStatus(activeSpeakerPlaybackStatus());
    sync();
    return subscribeSpeaker(sync);
  }, []);
  if (status === "unauthorized") {
    return (
      <div className="card mb-4 flex flex-wrap items-center gap-3" role="status">
        <p className="min-w-0 flex-1 text-sm">Die Anmeldung ist abgelaufen. Der Lautsprecher spielt nach erneuter Anmeldung weiter.</p>
        <button className="btn-primary" onClick={() => window.location.reload()}>Neu anmelden</button>
      </div>
    );
  }
  if ((status !== "blocked" && status !== "paused") || pathname === "/control") return null;
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3" role="status">
      <p className="min-w-0 flex-1 text-sm">{status === "paused" ? "Die Radio-Wiedergabe ist pausiert." : "Das Radio ist ausgewählt. Der Browser benötigt noch deine Freigabe für den Ton."}</p>
      <button className="btn-primary" onClick={resumeSpeakerPlayback}>{status === "paused" ? "Wiedergabe fortsetzen" : "Ton freigeben"}</button>
    </div>
  );
}
