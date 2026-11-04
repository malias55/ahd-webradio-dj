"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { attachSpeakerLifecycle, activeSpeakerPlaybackStatus, resumeSpeakerPlayback, subscribeSpeaker } from "@/lib/speakerMode";

export function SpeakerPlaybackLifecycle() {
  const pathname = usePathname();
  const [blocked, setBlocked] = useState(false);
  useEffect(() => attachSpeakerLifecycle(window), []);
  useEffect(() => {
    const sync = () => setBlocked(activeSpeakerPlaybackStatus() === "blocked");
    sync();
    return subscribeSpeaker(sync);
  }, []);
  if (!blocked || pathname === "/control") return null;
  return (
    <div className="card mb-4 flex flex-wrap items-center gap-3" role="status">
      <p className="flex-1 text-sm">Das Radio ist ausgewählt. Der Browser benötigt noch deine Freigabe für den Ton.</p>
      <button className="btn-primary" onClick={resumeSpeakerPlayback}>Ton freigeben</button>
    </div>
  );
}
