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

import { presenterForSlot } from "../src/lib/radio/providers";
import { newsEditionSlot, reusableEdition } from "../src/lib/radio/news";
import { newsTimeline } from "../src/lib/radio/mix";

test("presenters alternate by Berlin hour and reset male at 08:00 every day", () => {
  for (const offset of [1, 2]) {
    for (let hour = 8; hour <= 17; hour++) {
      const date = new Date(`2026-${offset === 1 ? '10-26' : '07-15'}T${String(hour - offset).padStart(2, '0')}:00:00Z`);
      const presenter = presenterForSlot(date);
      assert.equal(presenter.gender, hour % 2 === 0 ? "male" : "female");
      assert.equal(presenter.voiceId, hour % 2 === 0 ? "1h6gHcRvQugDNZgdAo9N" : "hOBDmVrVUuqtp1I3KsIq");
    }
  }
});
test("hourly broadcasts group into fresh two-hour editions", () => {
  assert.equal(newsEditionSlot(new Date("2026-10-26T07:00:00Z")).toISOString(), "2026-10-26T07:00:00.000Z");
  assert.equal(newsEditionSlot(new Date("2026-10-26T08:00:00Z")).toISOString(), "2026-10-26T07:00:00.000Z");
  assert.equal(newsEditionSlot(new Date("2026-10-26T16:00:00Z")).toISOString(), "2026-10-26T15:00:00.000Z");
});
test("intermediate hour reuses only its own verified edition with valid sources", () => {
  const editionSlot = "2026-10-26T07:00:00.000Z";
  const source = { id: 1, title: "Mainz", url: "https://news.example", publishedAt: "2026-10-26T06:00:00Z", local: true };
  const meta = { stories: [{ text: "Eine neue Ausstellung in Mainz.", sourceIds: [1] }], sources: [source], editionSlot };
  const slot = new Date("2026-10-26T08:00:00Z");
  const content = reusableEdition(meta, slot);
  assert.equal(content?.reused, true); assert.equal(content?.editionSlot, editionSlot);
  assert.equal(reusableEdition({ ...meta, editionSlot: "2026-10-25T07:00:00Z" }, slot), null);
  assert.throws(() => reusableEdition({ ...meta, stories: [{ text: "Falsch", sourceIds: [99] }] }, slot));
});
test("radio mix places speech after the sonic logo and separates the stories", () => {
  const { cues, duration } = newsTimeline([12, 35, 40, 10]);
  assert.equal(cues.find(c => c.kind === "intro")?.start, 3.2);
  assert.equal(cues.filter(c => c.kind === "divider").length, 1);
  const speech = cues.filter(c => ["intro", "story", "outro"].includes(c.kind));
  for (let i = 1; i < speech.length; i++) assert.ok(speech[i].start > speech[i - 1].end);
  assert.equal(cues.at(-1)?.end, duration);
});
