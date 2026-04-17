export type ZoneCommand =
  | { type: "play"; url: string }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "volume"; value: number };

export async function sendZoneCommand(zoneId: string, cmd: ZoneCommand) {
  await fetch(`/api/zones/${zoneId}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cmd),
  });
}

export async function patchZone(zoneId: string, patch: Record<string, unknown>) {
  await fetch(`/api/zones/${zoneId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function startZoneBroadcast(zoneId: string, mime = "audio/webm") {
  const r = await fetch(`/api/zones/${zoneId}/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "start", mime }),
  });
  return r.json() as Promise<{ ok: boolean; url: string }>;
}

export async function stopZoneBroadcast(zoneId: string) {
  await fetch(`/api/zones/${zoneId}/broadcast`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "stop" }),
  });
}
