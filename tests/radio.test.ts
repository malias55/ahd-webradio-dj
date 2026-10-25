import test from "node:test";
import assert from "node:assert/strict";
import { isOnAir, upcomingNewsSlot, nativeSource, stationTime } from "../src/lib/radio/config";
import { parseFeed, validateStories, articleText } from "../src/lib/radio/news";
import { authCookies, userForCookie } from "../src/lib/session";

test("Berlin opening hours and last bulletin in winter", () => {
  assert.equal(isOnAir(new Date("2026-10-26T06:59:59Z")), false);
  assert.equal(isOnAir(new Date("2026-10-26T07:00:00Z")), true);
  assert.equal(isOnAir(new Date("2026-10-26T16:59:59Z")), true);
  assert.equal(isOnAir(new Date("2026-10-26T17:00:00Z")), false);
  assert.equal(upcomingNewsSlot(new Date("2026-10-26T15:59:59Z"))?.toISOString(), "2026-10-26T16:00:00.000Z");
  assert.equal(upcomingNewsSlot(new Date("2026-10-26T16:00:01Z"))?.toISOString(), "2026-10-27T07:00:00.000Z");
});
test("summer time and both DST transition days", () => {
  assert.equal(isOnAir(new Date("2026-07-15T06:00:00Z")), true);
  assert.equal(isOnAir(new Date("2026-07-15T16:00:00Z")), false);
  assert.equal(upcomingNewsSlot(new Date("2026-03-28T17:01:00Z"))?.toISOString(), "2026-03-29T06:00:00.000Z");
  assert.equal(upcomingNewsSlot(new Date("2026-10-24T16:01:00Z"))?.toISOString(), "2026-10-25T07:00:00.000Z");
  assert.equal(stationTime(new Date("2026-10-25T07:00:00Z")).hour, 8);
});
test("legacy zones never contact the retired stream; silent zones stay silent", () => {
  const zone = { defaultSource: "azuracast", streamUrl: "https://retired.invalid/radio.mp3" };
  assert.equal(nativeSource(zone, "https://radio.doerrschuck.de", new Date("2026-10-26T08:00:00Z")), "https://radio.doerrschuck.de/api/radio/stream");
  assert.equal(nativeSource(zone, "https://radio.doerrschuck.de", new Date("2026-10-26T18:00:00Z")), null);
  assert.equal(nativeSource({ ...zone, defaultSource: "silent" }), null);
});
test("reject stale, future, undated and insecure feed items", () => {
  const item = (date: string, url = "https://news.example/story") => `<item><title>Hallo</title><description><![CDATA[<p>Ein guter Tag.</p>]]></description><link>${url}</link><pubDate>${date}</pubDate></item>`;
  const xml = `<rss><channel>${item("2026-10-25T09:00:00Z")}${item("2026-10-20T09:00:00Z")}${item("2026-10-26T09:00:00Z")}${item("")}${item("2026-10-25T09:00:00Z", "http://bad.example")}</channel></rss>`;
  const result = parseFeed(xml, true, new Date("2026-10-25T10:00:00Z"));
  assert.equal(result.length, 1); assert.equal(result[0].summary, "Ein guter Tag.");
});
test("bulletins need valid source IDs and bounded reuse", () => {
  const sources = [{ id: 1, title: "Test", summary: "Quelle", url: "https://news.example", local: true, publishedAt: new Date().toISOString() }];
  assert.throws(() => validateStories({ stories: [{ text: "Hallo", sourceIds: [99] }] }, sources));
  assert.throws(() => validateStories({ stories: [{ text: "Hallo", sourceIds: [] }] }, sources));
  assert.throws(() => validateStories({ stories: [{ text: "Wort ".repeat(101), sourceIds: [1] }] }, sources));
  assert.equal(validateStories({ stories: [{ text: "Neue Ausstellung in Mainz.", sourceIds: [1] }] }, sources).length, 1);
});
test("cookie presence alone never grants central access", async () => {
  assert.equal(authCookies("irrelevant=secret; logto_old=fake"), "");
  assert.equal(await userForCookie("logto_old=fake"), null);
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response("null", { headers: { "content-type": "application/json" } });
  try { assert.equal(await userForCookie("__Secure-better-auth.session_token=forged"), null); }
  finally { globalThis.fetch = original; }
});

test("article extraction excludes players, scripts and unrelated content", () => {
  const html = '<article><div itemprop="articleBody"><p>In Mainz eröffnet eine Ausstellung.</p><figure><p>Unrelated video</p></figure><script>ignore()</script><p>Der Eintritt ist frei.</p></div></article>';
  assert.equal(articleText(html), 'In Mainz eröffnet eine Ausstellung. Der Eintritt ist frei.');
});
