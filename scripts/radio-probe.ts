import { germanVoice, edenJson } from "../src/lib/radio/providers";
import { collectSources } from "../src/lib/radio/news";

async function main() {
  const voiceId = await germanVoice();
  console.log("German voice:", voiceId);
  const sources = await collectSources();
  console.log("Fresh sources:", sources.length, "local:", sources.filter(s => s.local).length);
  const r = await fetch("https://api.edenai.run/v3/models", { headers: { Authorization: `Bearer ${process.env.EDENAI_API_KEY}` } });
  if (r.ok) {
    const models = JSON.stringify(await r.json());
    console.log("Requested models in catalogue:", { terra: models.includes("gpt-6.1-terra"), haiku: models.includes("haiku-5-5") });
  } else console.log("Model catalogue status:", r.status);
  const sample = await edenJson('Antworte ausschließlich als JSON {"approved":true,"reason":"API-Test"}.', { test: true }, true);
  console.log("Eden response:", sample);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
