import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { ServerResponse } from "node:http";
import { currentMode } from "../broadcast";
import { isOnAir, RADIO_STREAM_PATH } from "./config";
import { attachRadio, hasRadioMusic } from "./engine";

type Language = "tr" | "de";
type Session = {
  token: string;
  language: Language;
  phase: "news" | "returning" | "radio";
  clients: Set<ServerResponse>;
  process?: ChildProcess;
  timer?: ReturnType<typeof setTimeout>;
  returnToRadio: boolean;
  onChange: () => Promise<void>;
};

const shared = globalThis as typeof globalThis & { __ahdZoneNews?: Map<string, Session> };
const sessions = shared.__ahdZoneNews ??= new Map<string, Session>();
const mp3 = ["-ar", "44100", "-ac", "2", "-c:a", "libmp3lame", "-b:a", "128k"];
const silence = ["-re", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "5", ...mp3];

export function manualNewsStatus(zoneId: string) {
  const session = sessions.get(zoneId);
  return session?.phase === "news" ? { language: session.language, id: session.token } : null;
}

export function manualZoneSource(zoneId: string, origin: string) {
  const session = sessions.get(zoneId);
  if (!session || (session.phase === "radio" && !isOnAir())) return null;
  return `${origin}/api/zones/${encodeURIComponent(zoneId)}/news-stream/${session.token}`;
}

function notify(session: Session) {
  void session.onChange().catch(error => console.error("[zone news] source update failed", error));
}

function dispose(session: Session, discard: boolean) {
  if (session.timer) clearTimeout(session.timer);
  session.process?.kill("SIGKILL");
  for (const res of session.clients) {
    if (discard) res.destroy();
    else res.end();
  }
  session.clients.clear();
}

function pipe(zoneId: string, session: Session, input: string[], next: () => void) {
  const proc = spawn(/* turbopackIgnore: true */ process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-nostdin", ...input, "-vn", "-id3v2_version", "0", "-write_xing", "0", "-flush_packets", "1", "-f", "mp3", "pipe:1",
  ], { stdio: ["ignore", "pipe", "ignore"] });
  session.process = proc;
  proc.on("error", error => console.error("[zone news] FFmpeg failed", error.message));
  proc.stdout.on("data", chunk => {
    if (sessions.get(zoneId) !== session) return;
    for (const res of session.clients) {
      if (res.destroyed || res.writableLength > 32 * 1024) { res.destroy(); session.clients.delete(res); }
      else res.write(chunk);
    }
  });
  proc.once("close", () => {
    if (sessions.get(zoneId) !== session || session.process !== proc) return;
    session.process = undefined;
    next();
  });
}

function returnToSource(zoneId: string, session: Session) {
  if (session.returnToRadio && isOnAir()) {
    session.phase = "returning";
    // If the shared station is airing its own bulletin, keep this zone quiet
    // until music is available. Otherwise Abort could switch straight back to news.
    if (!hasRadioMusic()) {
      pipe(zoneId, session, silence, () => { session.timer = setTimeout(() => returnToSource(zoneId, session), 250); });
      return;
    }
    const source = `http://127.0.0.1:${process.env.PORT || 3000}${RADIO_STREAM_PATH}`;
    pipe(zoneId, session, ["-rw_timeout", "7000000", "-probesize", "8192", "-analyzeduration", "0", "-i", source,
      "-t", "3", "-af", "afade=t=in:d=3:curve=hsin", ...mp3], () => {
      session.phase = "radio";
      for (const res of session.clients) attachRadio(res);
    });
  } else {
    sessions.delete(zoneId);
    dispose(session, false);
    notify(session);
  }
}

export function startZoneNews(zoneId: string, language: Language, file: string, returnToRadio: boolean, onChange: Session["onChange"]) {
  if (currentMode(zoneId) || manualNewsStatus(zoneId)) return null;
  const previous = sessions.get(zoneId);
  const session: Session = { token: randomUUID(), language, phase: "news", clients: new Set(), returnToRadio, onChange };
  sessions.set(zoneId, session);
  if (previous) dispose(previous, true);
  // Allow the browser and assigned devices to connect before the first note.
  session.timer = setTimeout(() => {
    pipe(zoneId, session, ["-re", "-i", file, "-c:a", "copy"], () => {
      session.phase = "returning";
      pipe(zoneId, session, silence, () => returnToSource(zoneId, session));
    });
  }, 2500);
  notify(session);
  return manualNewsStatus(zoneId);
}

export function stopZoneNews(zoneId: string, token: string) {
  const previous = sessions.get(zoneId);
  if (!previous || previous.phase !== "news" || previous.token !== token) return false;
  const resume: Session = { token: randomUUID(), language: previous.language, phase: "returning", clients: new Set(), returnToRadio: previous.returnToRadio, onChange: previous.onChange };
  sessions.set(zoneId, resume);
  dispose(previous, true);
  if (resume.returnToRadio && isOnAir()) {
    // Wait briefly for new connections so they receive the beginning of the fade.
    resume.timer = setTimeout(() => returnToSource(zoneId, resume), 2300);
    notify(resume);
  } else returnToSource(zoneId, resume);
  return true;
}

export function attachZoneNews(zoneId: string, token: string, res: ServerResponse) {
  const session = sessions.get(zoneId);
  if (!session || session.token !== token || (session.phase === "radio" && !isOnAir())) return false;
  res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Accel-Buffering": "no" });
  res.flushHeaders();
  session.clients.add(res);
  res.once("close", () => session.clients.delete(res));
  if (session.phase === "radio") attachRadio(res);
  return true;
}

export function stopAllZoneNews() {
  for (const session of sessions.values()) dispose(session, true);
  sessions.clear();
}
