// Shared formatting must stay outside any "use client" module: server-rendered
// status notices and client audio controls both call these functions.
export const time = (v: string) => new Date(v).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
export const duration = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
export const languageLabel = (l?: string) => l === "tr" ? "Türkisch" : l === "de" ? "Deutsch" : "Instrumental";
