export const PRIMARY_NEWS_MODEL = "gpt-6.1-terra";
export const FALLBACK_NEWS_MODEL = "anthropic/claude-haiku-5-5";
export function newsModelConfig() {
  return { primary: process.env.NEWS_MODEL || PRIMARY_NEWS_MODEL, fallback: process.env.EDENAI_FALLBACK_MODEL || FALLBACK_NEWS_MODEL };
}
export function editorialConfigured() { return !!(process.env.OPENAI_API_KEY || process.env.EDENAI_API_KEY); }
export type ModelCall = { requestedModel: string; resolvedModel: string; purpose: string; inputTokens: number | null; outputTokens: number | null; costUsd: number | null;
  provider?: "openai" | "edenai"; status?: "succeeded" | "failed"; fallbackFor?: string; error?: string };
class ModelFailure extends Error {
  constructor(message: string, readonly allowFallback: boolean) { super(message); }
}

export async function editorialJson(system: string, input: unknown, review = false, calls?: ModelCall[]): Promise<unknown> {
  const config = newsModelConfig();
  const schema = review ? {
    type: "object", properties: { approved: { type: "boolean" }, reason: { type: "string" } }, required: ["approved", "reason"], additionalProperties: false,
  } : {
    type: "object", properties: { stories: { type: "array", items: { type: "object", properties: {
      text: { type: "string" }, sourceIds: { type: "array", items: { type: "integer" } },
    }, required: ["text", "sourceIds"], additionalProperties: false } } }, required: ["stories"], additionalProperties: false,
  };
  for (const provider of ["openai", "edenai"] as const) {
    const fallback = provider === "edenai", model = fallback ? config.fallback : config.primary;
    const call: ModelCall = { requestedModel: model, resolvedModel: model, purpose: review ? "review" : "author", inputTokens: null, outputTokens: null, costUsd: null, provider, status: "failed", ...(fallback ? { fallbackFor: config.primary } : {}) };
    try {
      const key = fallback ? process.env.EDENAI_API_KEY : process.env.OPENAI_API_KEY;
      if (!key) throw new ModelFailure(`${provider}: API-Schlüssel fehlt`, true);
      let r: Response;
      try {
        r = await fetch(fallback ? "https://api.edenai.run/v3/chat/completions" : "https://api.openai.com/v1/chat/completions", {
          method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model, messages: [{ role: "system", content: system }, { role: "user", content: JSON.stringify(input) }],
            response_format: { type: "json_schema", json_schema: { name: review ? "editorial_review" : "radio_news", strict: true, schema } },
            max_completion_tokens: review ? 3200 : 6000, ...(!fallback ? { reasoning_effort: "low" } : {}) }),
          signal: AbortSignal.timeout(fallback ? 45_000 : 60_000),
        });
      } catch { throw new ModelFailure(`${provider}: Verbindung oder Zeitlimit`, true); }
      if (!r.ok) {
        // Policy/refusal errors must never be routed around through another model.
        let policyBlock = false;
        try { const body = await r.json(); policyBlock = /content.?policy|safety|refusal|content.?filter/i.test(String(body.error?.code || "") + " " + String(body.error?.type || "")); } catch {}
        throw new ModelFailure(`${provider}: HTTP ${r.status}${policyBlock ? " (Inhaltsfilter)" : ""}`, !policyBlock && [401, 404, 408, 409, 429, 500, 502, 503, 504].includes(r.status));
      }
      let j: { choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[]; model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; cost?: number };
      try { j = await r.json(); } catch { throw new ModelFailure(`${provider}: ungültige Anbieterantwort`, true); }
      call.resolvedModel = j.model || model; call.inputTokens = j.usage?.prompt_tokens ?? null; call.outputTokens = j.usage?.completion_tokens ?? null; call.costUsd = j.cost ?? null;
      const message = j.choices?.[0]?.message;
      if (message?.refusal || j.choices?.[0]?.finish_reason === "content_filter") throw new ModelFailure(`${provider}: Inhaltsprüfung hat die Anfrage abgelehnt`, false);
      if (!message?.content) throw new ModelFailure(`${provider}: leere strukturierte Antwort`, true);
      let result: unknown;
      try { result = JSON.parse(message.content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); }
      catch { throw new ModelFailure(`${provider}: ungültige strukturierte Antwort`, true); }
      call.status = "succeeded"; calls?.push(call);
      return result;
    } catch (error) {
      call.error = error instanceof ModelFailure ? error.message : `${provider}: Verarbeitung fehlgeschlagen`; calls?.push(call);
      if (!fallback && error instanceof ModelFailure && error.allowFallback) { console.warn("[radio model fallback]", call.error); continue; }
      throw error;
    }
  }
  throw new Error("Kein Nachrichtenmodell verfügbar");
}
