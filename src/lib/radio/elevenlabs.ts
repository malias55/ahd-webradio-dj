type Subscription = {
  character_count?: number; character_limit?: number;
  can_extend_character_limit?: boolean; allowed_to_extend_character_limit?: boolean;
  max_credit_limit_extension?: number | "unlimited";
};

export function availableSpeechCredits(subscription: Subscription) {
  const used = subscription.character_count, limit = subscription.character_limit;
  if (!Number.isFinite(used) || !Number.isFinite(limit)) return null;
  const extension = subscription.max_credit_limit_extension;
  const overages = extension !== undefined ? extension === "unlimited" || extension > 0
    : subscription.allowed_to_extend_character_limit ?? subscription.can_extend_character_limit ?? false;
  return { remaining: Math.max(0, limit! - used!), overages };
}

// Only allowlisted error codes leave the provider boundary. Never log response
// bodies, echoed text or credentials; ElevenLabs also uses HTTP 401 for quota.
export function elevenLabsError(status: number, body: unknown) {
  const code = (body as { detail?: { status?: unknown } } | null)?.detail?.status;
  if (code === "quota_exceeded") return new Error(`ElevenLabs-Guthaben reicht für die Vertonung nicht aus (HTTP ${status}; quota_exceeded).`);
  if (code === "invalid_api_key") return new Error(`ElevenLabs: API-Schlüssel ungültig (HTTP ${status}).`);
  if (code === "missing_permissions") return new Error(`ElevenLabs: API-Schlüssel hat nicht die erforderlichen Rechte (HTTP ${status}).`);
  return new Error(`ElevenLabs HTTP ${status}`);
}

let quotaCache: { apiKey: string; checkedAt: number; credits: ReturnType<typeof availableSpeechCredits> } | undefined;
export async function assertNewsCredits() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY fehlt");
  let credits = quotaCache?.apiKey === apiKey && Date.now() - quotaCache.checkedAt < 60_000 ? quotaCache.credits : undefined;
  if (credits === undefined) {
    // Read-only preflight. Keys without subscription-read permission can still
    // synthesize speech, so an unavailable balance is not treated as zero.
    try {
      const r = await fetch("https://api.elevenlabs.io/v1/user/subscription", { headers: { "xi-api-key": apiKey }, signal: AbortSignal.timeout(10_000) });
      credits = r.ok ? availableSpeechCredits(await r.json()) : null;
    } catch { credits = null; }
    quotaCache = { apiKey, checkedAt: Date.now(), credits };
  }
  // A minimum buffer catches empty accounts before paid editorial work. It is
  // deliberately not a promise that this amount covers every voice/edition.
  if (credits && !credits.overages && credits.remaining < 1000)
    throw new Error(`ElevenLabs-Guthaben nicht ausreichend: ${credits.remaining} Credits übrig; mindestens 1000 als Mindestpuffer für neue Nachrichten erforderlich. Redaktion und Vertonung pausieren bis wieder Guthaben verfügbar ist.`);
}
