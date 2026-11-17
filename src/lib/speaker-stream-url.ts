export const usesContinuousSpeaker = (zone: { defaultSource: string }) => ["radio", "azuracast"].includes(zone.defaultSource);
export const speakerStreamUrl = (zoneId: string, origin: string) => `${origin}/api/zones/${encodeURIComponent(zoneId)}/speaker-stream`;
