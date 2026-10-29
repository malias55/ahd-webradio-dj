import test from "node:test";
import assert from "node:assert/strict";
import { editorialJson, PRIMARY_NEWS_MODEL, FALLBACK_NEWS_MODEL, type ModelCall } from "../src/lib/radio/models";

const response = (value: unknown, model = PRIMARY_NEWS_MODEL) => Response.json({ model, choices: [{ message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 10, completion_tokens: 8 } });
async function isolated(work: () => Promise<void>) {
  const fetch = globalThis.fetch;
  const keys = ["OPENAI_API_KEY", "EDENAI_API_KEY", "NEWS_MODEL", "EDENAI_FALLBACK_MODEL", "EDENAI_MODEL", "EDENAI_REVIEW_MODEL"];
  const before = new Map(keys.map(k => [k, process.env[k]]));
  Object.assign(process.env, { OPENAI_API_KEY: "test", EDENAI_API_KEY: "test", NEWS_MODEL: PRIMARY_NEWS_MODEL, EDENAI_FALLBACK_MODEL: FALLBACK_NEWS_MODEL, EDENAI_MODEL: "gpt-6-luna", EDENAI_REVIEW_MODEL: FALLBACK_NEWS_MODEL });
  try { await work(); } finally { globalThis.fetch = fetch; for (const [k, v] of before) if (v === undefined) delete process.env[k]; else process.env[k] = v; }
}
test("Terra handles both author and review; old Eden role settings cannot select Haiku", async () => isolated(async () => {
  const calls: ModelCall[] = [], requests: { url: string; model: string }[] = [];
  globalThis.fetch = async (url, init) => { const body = JSON.parse(String(init?.body)); requests.push({ url: String(url), model: body.model }); assert.equal(body.reasoning_effort, "low"); return response({ approved: true, reason: "Test" }); };
  await editorialJson("test", {}, false, calls); await editorialJson("test", {}, true, calls);
  assert.deepEqual(requests.map(r => r.model), [PRIMARY_NEWS_MODEL, PRIMARY_NEWS_MODEL]); assert.ok(requests.every(r => r.url.startsWith("https://api.openai.com/")));
  assert.deepEqual(calls.map(c => c.purpose), ["author", "review"]); assert.ok(calls.every(c => c.status === "succeeded"));
}));
test("a technical Terra outage invokes Eden Haiku once and journals both attempts", async () => isolated(async () => {
  const calls: ModelCall[] = [], models: string[] = [];
  globalThis.fetch = async (url, init) => { const body = JSON.parse(String(init?.body)); models.push(body.model); if (String(url).includes("api.openai.com")) return Response.json({ error: { type: "server_error" } }, { status: 503 }); assert.equal(body.reasoning_effort, undefined); return response({ approved: true }, FALLBACK_NEWS_MODEL); };
  assert.deepEqual(await editorialJson("test", {}, true, calls), { approved: true });
  assert.deepEqual(models, [PRIMARY_NEWS_MODEL, FALLBACK_NEWS_MODEL]); assert.deepEqual(calls.map(c => c.status), ["failed", "succeeded"]); assert.equal(calls[1].fallbackFor, PRIMARY_NEWS_MODEL);
}));
test("an editorial rejection never switches to the fallback reviewer", async () => isolated(async () => {
  let count = 0; globalThis.fetch = async () => { count++; return response({ approved: false, reason: "Quelle belegt die Aussage nicht" }); };
  assert.deepEqual(await editorialJson("test", {}, true), { approved: false, reason: "Quelle belegt die Aussage nicht" }); assert.equal(count, 1);
}));
test("provider safety refusals and content filters are not routed around", async () => isolated(async () => {
  for (const r of [Response.json({ choices: [{ message: { refusal: "Refused" } }] }), Response.json({ error: { code: "content_policy_violation" } }, { status: 400 })]) {
    let count = 0; globalThis.fetch = async () => { count++; return r; };
    await assert.rejects(editorialJson("test", {}, true)); assert.equal(count, 1);
  }
}));
test("fallback failure stops after two provider attempts", async () => isolated(async () => {
  const calls: ModelCall[] = []; let count = 0; globalThis.fetch = async () => { count++; throw new TypeError("network unavailable"); };
  await assert.rejects(editorialJson("test", {}, false, calls)); assert.equal(count, 2); assert.deepEqual(calls.map(c => c.status), ["failed", "failed"]);
}));
