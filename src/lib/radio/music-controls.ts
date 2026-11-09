import { isMusicHours, upcomingNewsSlot } from "./config";

export const MUSIC_FADE_SECONDS = 3;

export function musicPlayBlockedReason(state: { started: boolean; shutdown: boolean; selecting: boolean; newsTransition?: boolean; musicControlBusy?: boolean; playing: { kind: string } | null }, now = new Date()) {
  if (!state.started || state.shutdown) return "Das Radio wird gerade gestartet. Bitte kurz warten.";
  if (!isMusicHours(now)) return "Direkt im Radio abspielen ist von 08 bis 18 Uhr möglich. Vorhören geht jederzeit.";
  if (state.newsTransition || state.playing?.kind === "news") return "Gerade laufen Nachrichten. Danach kann die Musik wieder direkt gestartet werden.";
  const nextNews = upcomingNewsSlot(now);
  if (nextNews && nextNews.getTime() - now.getTime() <= (MUSIC_FADE_SECONDS * 2 + 6) * 1000) return "Die Nachrichten beginnen gleich. Bitte danach erneut versuchen.";
  if (state.selecting || state.musicControlBusy) return "Der Titel wird gerade gewechselt. Bitte kurz warten.";
  return null;
}
