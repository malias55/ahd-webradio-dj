import test from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../src/lib/prisma";
import { dailyNewsPlan, dueNewsEditions, isMusicHours, isNewsSlot, isOnAir, newsAllowedOn, stationHour, upcomingNewsSlot } from "../src/lib/radio/config";
import { editorialContent, prepareNews } from "../src/lib/radio/news";
import { germanNewsRetryStatus, retryGermanNews } from "../src/lib/radio/news-retry";

test("Sundays have no generation, news slots or Turkish-only stream windows", async () => {
  for (const day of ["2026-03-29", "2026-10-25", "2026-11-15"]) {
    for (let hour = 0; hour < 24; hour++) {
      if (day === "2026-03-29" && hour === 2) continue;
      const date = stationHour(day, hour);
      assert.equal(newsAllowedOn(date), false);
      assert.equal(isNewsSlot(date), false);
      assert.deepEqual(dailyNewsPlan(date), []);
      assert.deepEqual(dueNewsEditions(date), []);
      assert.equal(isOnAir(date), hour >= 8 && hour < 18, "normal Sunday music hours remain intact");
      assert.equal(isMusicHours(date), hour >= 8 && hour < 18);
    }
    await assert.rejects(prepareNews(stationHour(day, 10)), /Sonntags/);
    await assert.rejects(editorialContent(stationHour(day, 10)), /Sonntags/);
    assert.equal((await germanNewsRetryStatus(stationHour(day, 10))).state, "paused");
    assert.equal((await retryGermanNews(stationHour(day, 10))).canRetry, false);
  }
});

test("next news crosses Sunday and DST using Berlin calendar dates", () => {
  assert.equal(upcomingNewsSlot(new Date("2026-03-28T20:01:00Z"))?.toISOString(), "2026-03-30T05:00:00.000Z");
  assert.equal(upcomingNewsSlot(new Date("2026-10-24T20:01:00Z"))?.toISOString(), "2026-10-26T06:00:00.000Z");
  assert.equal(upcomingNewsSlot(new Date("2026-11-14T19:00:00Z"))?.toISOString(), "2026-11-14T19:00:00.000Z");
  assert.equal(upcomingNewsSlot(new Date("2026-11-14T19:00:01Z"))?.toISOString(), "2026-11-16T06:00:00.000Z");
  assert.equal(newsAllowedOn(new Date("2026-11-14T22:59:59Z")), true);
  assert.equal(newsAllowedOn(new Date("2026-11-14T23:00:00Z")), false);
});

test("invalid source IDs get one correction and still require independent review", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-09T08:05:00Z") });
  const originalFetch = globalThis.fetch, originalFind = prisma.radioAsset.findMany;
  const keys = ["NEWS_FEED_URLS", "OPENAI_API_KEY", "NEWS_MODEL", "EDENAI_API_KEY"];
  const before = keys.map(key => process.env[key]);
  Object.assign(process.env, { NEWS_FEED_URLS: "https://news.example/rss", OPENAI_API_KEY: "test", NEWS_MODEL: "gpt-6.1-terra", EDENAI_API_KEY: "" });
  (prisma.radioAsset as any).findMany = async () => [];
  let drafts = 0, reviews = 0, alwaysInvalid = false;
  globalThis.fetch = async (url, init) => {
    if (String(url) === "https://news.example/rss") return new Response(`<rss><channel>${[1, 2, 3, 4].map(id => `<item><title>${id === 2 ? "Rekord bei Elektroautos" : `Neue Ausstellung in Mainz ${id}`}</title><description>Eine Ausstellung in Mainz zeigt Gemälde.</description><link>https://news.example/${id}</link><pubDate>Mon, 09 Nov 2026 07:00:00 GMT</pubDate></item>`).join("")}</channel></rss>`);
    assert.equal(String(url), "https://api.openai.com/v1/chat/completions");
    const body = JSON.parse(String(init?.body)), context = JSON.parse(body.messages[1].content);
    let answer;
    if (body.response_format.json_schema.name === "editorial_review") { reviews++; answer = { approved: true, reason: "Geprüft" }; }
    else {
      drafts++;
      const schema = body.response_format.json_schema.schema.properties.stories;
      assert.equal(schema.minItems, 1, "no artificial minimum forces invented stories");
      assert.deepEqual(schema.items.properties.sourceIds.items.enum, [1, 3, 4], "real source IDs are not renumbered after filtering");
      assert.equal(schema.items.properties.sourceIds.minItems, 1);
      if (drafts === 2) assert.match(context.correction, /Quellen-IDs|sourceIds/);
      answer = { stories: [{ text: "Eine neue Ausstellung in Mainz zeigt Gemälde.", sourceIds: [alwaysInvalid || drafts === 1 ? 999 : 1] }] };
    }
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }], model: "gpt-6.1-terra" });
  };
  try {
    const content = await editorialContent(new Date("2026-11-09T09:00:00Z"));
    assert.equal(drafts, 2); assert.equal(reviews, 1);
    assert.deepEqual(content.stories[0].sourceIds, [1]);
    assert.equal(content.sources[0].id, 1);
    alwaysInvalid = true;
    await assert.rejects(editorialContent(new Date("2026-11-09T09:00:00Z")), /Redaktionelle Prüfung/);
    assert.equal(drafts, 4, "invalid sources stop after two bounded correction attempts");
    assert.equal(reviews, 1, "invalid drafts never reach publication or speech synthesis");
  } finally {
    globalThis.fetch = originalFetch;
    (prisma.radioAsset as any).findMany = originalFind;
    keys.forEach((key, index) => { if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index]; });
    t.mock.timers.reset();
  }
});

test("ready editions are not regenerated and expired retry leases stay bounded", async () => {
  const originalAssets = prisma.radioAsset.findMany, originalJobs = prisma.radioJob.findMany;
  const now = new Date("2026-11-09T12:00:00Z");
  try {
    (prisma.radioAsset as any).findMany = async () => [{ id: "ready", kind: "news", script: "Nachrichten aus Mainz.", metadata: { language: "de" } }];
    assert.equal((await retryGermanNews(now)).state, "ready", "returns before jobs or paid generation are accessed");
    (prisma.radioAsset as any).findMany = async () => [];
    (prisma.radioJob as any).findMany = async () => [{ key: "news-recovery:daily-repeat-v10:de:2026-11-09", status: "failed", attempts: 3, leaseUntil: new Date(now.getTime() - 1) }];
    assert.equal((await germanNewsRetryStatus(now)).canRetry, false);
    (prisma.radioJob as any).findMany = async () => [{ key: "news-main:daily-repeat-v10:2026-11-09T09:00:00.000Z", status: "running", attempts: 1, leaseUntil: new Date(now.getTime() + 60000) }];
    assert.equal((await germanNewsRetryStatus(now)).state, "running");
    (prisma.radioJob as any).findMany = async () => [];
    assert.equal((await germanNewsRetryStatus(now)).canRetry, true);
  } finally {
    (prisma.radioAsset as any).findMany = originalAssets;
    (prisma.radioJob as any).findMany = originalJobs;
  }
});
