import test from "node:test";
import assert from "node:assert/strict";
import { isOnAir, upcomingNewsSlot, nativeSource, stationTime, isMusicHours, isNewsSlot, newsLanguage, stationDayBounds } from "../src/lib/radio/config";
import { parseFeed, validateStories, articleText, germanTopicAllowed, sourcesForProgramme } from "../src/lib/radio/news";
import { authCookies, userForCookie } from "../src/lib/session";
import { availableSpeechCredits, elevenLabsError, assertNewsCredits } from "../src/lib/radio/elevenlabs";
import { germanBrandingAllowed } from "../src/lib/radio/presentation";
import { GERMAN_NEWS_INTRO, GERMAN_SERVICE_OUTRO, TURKISH_INTRO } from "../src/lib/radio/news";

test("ElevenLabs quota is distinct from authentication errors and never leaks response data", () => {
  assert.match(elevenLabsError(401, { detail: { status: "quota_exceeded", message: "SECRET echoed request" } }).message, /Guthaben.*quota_exceeded/);
  assert.doesNotMatch(elevenLabsError(401, { detail: { status: "quota_exceeded", message: "SECRET" } }).message, /SECRET/);
  assert.match(elevenLabsError(401, { detail: { status: "invalid_api_key" } }).message, /Schlüssel ungültig/);
  assert.equal(elevenLabsError(500, { detail: { message: "SECRET" } }).message, "ElevenLabs HTTP 500");
  assert.equal(availableSpeechCredits({}), null, "unknown balance is not zero");
  assert.deepEqual(availableSpeechCredits({ character_count: 121198, character_limit: 121305, can_extend_character_limit: false }), { remaining: 107, overages: false });
  assert.deepEqual(availableSpeechCredits({ character_count: 100, character_limit: 50, can_extend_character_limit: true, max_credit_limit_extension: 0 }), { remaining: 0, overages: false }, "entitlement alone does not enable paid overages");
});

test("empty speech balance stops preparation before any paid provider request", async () => {
  const fetchBefore = globalThis.fetch, keyBefore = process.env.ELEVENLABS_API_KEY;
  process.env.ELEVENLABS_API_KEY = "isolated-quota-test";
  let requests = 0;
  globalThis.fetch = async input => {
    assert.equal(String(input), "https://api.elevenlabs.io/v1/user/subscription"); requests++;
    return Response.json({ character_count: 121198, character_limit: 121305, max_credit_limit_extension: 0 });
  };
  try { await assert.rejects(assertNewsCredits(), /107 Credits/); await assert.rejects(assertNewsCredits(), /107 Credits/); assert.equal(requests, 1); }
  finally { globalThis.fetch = fetchBefore; if (keyBefore === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = keyBefore; }
});

test("German openings and closings are unbranded; Turkish brand remains", () => {
  assert.ok(germanBrandingAllowed(GERMAN_NEWS_INTRO)); assert.ok(germanBrandingAllowed(GERMAN_SERVICE_OUTRO));
  assert.match(GERMAN_NEWS_INTRO, /KI-Nachrichtenassistent/);
  for (const text of ["Autohaus Dörrschuck Radio", "bei Doerrschuck", "Dörşuk", "AHD Radio"]) assert.equal(germanBrandingAllowed(text), false);
  assert.match(TURKISH_INTRO, /Autohaus Dörşuk/);
});

test("Berlin opening hours and morning-only news in winter", () => {
  assert.equal(isOnAir(new Date("2026-10-26T06:59:59Z")), false);
  assert.equal(isOnAir(new Date("2026-10-26T07:00:00Z")), true);
  assert.equal(isOnAir(new Date("2026-10-26T16:59:59Z")), true);
  assert.equal(isOnAir(new Date("2026-10-26T17:00:00Z")), false);
  assert.equal(upcomingNewsSlot(new Date("2026-10-26T15:59:59Z"))?.toISOString(), "2026-10-27T06:00:00.000Z");
  assert.equal(upcomingNewsSlot(new Date("2026-10-26T16:00:01Z"))?.toISOString(), "2026-10-27T06:00:00.000Z");
});
test("summer time and both DST transition days", () => {
  assert.equal(isOnAir(new Date("2026-07-15T06:00:00Z")), true);
  assert.equal(isOnAir(new Date("2026-07-15T16:00:00Z")), false);
  assert.equal(upcomingNewsSlot(new Date("2026-03-28T17:01:00Z"))?.toISOString(), "2026-03-29T05:00:00.000Z");
  assert.equal(upcomingNewsSlot(new Date("2026-10-24T16:01:00Z"))?.toISOString(), "2026-10-25T06:00:00.000Z");
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
test("German curation excludes electric-mobility promotion without excluding ordinary car or local topics", () => {
  for (const text of ["Elektroautos mit neuem Reichweitenrekord", "Mehr E‑Autos in Mainz", "Erfolge der E-Mobilität", "Neue Elektro-Mobilität", "Ladesäulen und Ladeinfrastruktur wachsen", "Batteriespeicher lädt 1.000 Elektrofahrzeuge", "Elektrische Autos erreichen Rekordabsatz", "Beliebte Stromer im Aufwind", "Neue BEVs und Wallboxen"])
    assert.equal(germanTopicAllowed(text), false, text);
  for (const text of ["Oldtimer-Ausstellung in Mainz", "Handwerk und Fahrzeugpflege", "Ausflugsziele in Rheinhessen", "Neue Technik zur Stromerzeugung", "Verkehr auf der A60", "Ein Theater bekommt neue Beleuchtung"])
    assert.equal(germanTopicAllowed(text), true, text);
});
test("German source selection checks full articles and leaves the Turkish programme unchanged", () => {
  const base = { summary: "Aktuelles aus Mainz", url: "https://www.swr.de/test", publishedAt: "2026-10-25T12:00:00Z", local: true };
  const sources = [
    { ...base, id: 1, title: "Neue Anlage in Mainz", articleText: "Die Anlage könnte 1.000 Elektroautos laden." },
    { ...base, id: 2, title: "Neue Ausstellung in Mainz", articleText: "Ein lokaler Künstler zeigt seine Arbeiten." },
    { ...base, id: 3, title: "Neue Schnellladestationen", articleText: "Es gibt zusätzliche Ladepunkte." },
  ];
  assert.deepEqual(sourcesForProgramme(sources, "de").map(s => s.id), [2]);
  assert.deepEqual(sourcesForProgramme(sources, "tr").map(s => s.id), [1, 2, 3]);
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

import { presenterForSlot, servicePresenter } from "../src/lib/radio/providers";
import { newsEditionSlot, bulletinKey, mainNewsKey, isRepeatSlot, TURKISH_OPENING } from "../src/lib/radio/news";
import { newsTimeline, dryNewsTimeline } from "../src/lib/radio/mix";

test("German main news always uses Elias, weather and traffic use Susanne", () => {
  for (const offset of [1, 2]) {
    for (let hour = 8; hour <= 17; hour++) {
      const date = new Date(`2026-${offset === 1 ? '10-26' : '07-15'}T${String(hour - offset).padStart(2, '0')}:00:00Z`);
      const presenter = presenterForSlot(date);
      assert.equal(presenter.gender, "male");
      assert.equal(presenter.voiceId, "1h6gHcRvQugDNZgdAo9N");
      assert.equal(servicePresenter().voiceId, "mjTSjCqHhkhULvdsy68o");
    }
  }
});
test("hourly broadcasts group into fresh two-hour editions", () => {
  assert.equal(newsEditionSlot(new Date("2026-10-26T07:00:00Z")).toISOString(), "2026-10-26T07:00:00.000Z");
  assert.equal(newsEditionSlot(new Date("2026-10-26T08:00:00Z")).toISOString(), "2026-10-26T07:00:00.000Z");
  assert.equal(newsEditionSlot(new Date("2026-10-26T16:00:00Z")).toISOString(), "2026-10-26T15:00:00.000Z");
});
test("main audio key repeats, hourly service bulletin key always changes", () => {
  for (let hour = 8; hour <= 16; hour += 2) {
    const original = new Date(`2026-10-26T${String(hour - 1).padStart(2, '0')}:00:00Z`);
    const repeat = new Date(original.getTime() + 3600_000);
    assert.equal(mainNewsKey(original), mainNewsKey(repeat));
    assert.notEqual(bulletinKey(original), bulletinKey(repeat));
    assert.equal(isRepeatSlot(original), false); assert.equal(isRepeatSlot(repeat), true);
  }
});
test("07:00 Turkish slot is separate and has no music rotation", () => {
  const seven = new Date("2026-10-26T06:00:00Z");
  assert.equal(newsLanguage(seven), "tr"); assert.equal(isOnAir(seven), true); assert.equal(isMusicHours(seven), false);
  assert.equal(presenterForSlot(seven).voiceId, "Q2IX97JeHBY3vNGzgM5s");
  assert.equal(newsEditionSlot(seven).toISOString(), seven.toISOString());
  assert.equal(isRepeatSlot(seven), false);
  assert.equal(isOnAir(new Date("2026-10-26T06:05:00Z")), false);
  assert.equal(TURKISH_OPENING, "Rahmân ve Rahîm olan Allah'ın adıyla. ");
});
test("journal day filters use Berlin midnight even across DST", () => {
  const winter = stationDayBounds("2026-10-26");
  assert.equal(winter.start.toISOString(), "2026-10-25T23:00:00.000Z");
  const spring = stationDayBounds("2026-03-29"), autumn = stationDayBounds("2026-10-25");
  assert.equal(spring.end.getTime() - spring.start.getTime(), 23 * 3600_000);
  assert.equal(autumn.end.getTime() - autumn.start.getTime(), 25 * 3600_000);
  assert.throws(() => stationDayBounds("2026-02-30"));
});
test("radio mix places speech after the sonic logo and separates the stories", () => {
  const { cues, duration } = newsTimeline([12, 35, 40, 10]);
  assert.equal(cues.find(c => c.kind === "intro")?.start, 3.2);
  assert.equal(cues.filter(c => c.kind === "divider").length, 1);
  const speech = cues.filter(c => ["intro", "story", "outro"].includes(c.kind));
  for (let i = 1; i < speech.length; i++) assert.ok(speech[i].start > speech[i - 1].end);
  assert.equal(cues.at(-1)?.end, duration);
});

import { weatherReport, trafficEvents, trafficReport, serviceFreshForSlot, collectHourlyService } from "../src/lib/radio/service";

test("German dry mix never overlaps any speech with any music or effect", () => {
  const clips = [{ kind: "intro" as const, duration: 12 }, { kind: "story" as const, duration: 35 }, { kind: "story" as const, duration: 30 }, { kind: "outro" as const, duration: 10 }];
  for (const options of [{}, { closer: false }, { opener: false, closer: false }]) {
    const timeline = dryNewsTimeline(clips, options);
    const speech = timeline.cues.filter(c => !["opener", "closer", "divider"].includes(c.kind));
    const music = timeline.cues.filter(c => ["opener", "closer", "divider"].includes(c.kind));
    for (const voice of speech) for (const sound of music) assert.ok(voice.end <= sound.start || sound.end <= voice.start, `${voice.kind} overlaps ${sound.kind}`);
    for (let i = 1; i < timeline.cues.length; i++) assert.ok(timeline.cues[i].start >= timeline.cues[i - 1].end);
    assert.ok(timeline.duration >= timeline.cues.at(-1)!.end);
  }
});
test("German stories and weather/traffic boundaries use pauses without transition sounds", () => {
  const main = [{ kind: "intro" as const, duration: 10 }, { kind: "story" as const, duration: 30 }, { kind: "story" as const, duration: 30 }, { kind: "outro" as const, duration: 8 }];
  assert.equal(dryNewsTimeline(main).cues.filter(c => c.kind === "divider").length, 0);
  const full = dryNewsTimeline([...main, { kind: "weather", duration: 25 }, { kind: "traffic", duration: 30 }, { kind: "outro", duration: 10 }]);
  const dividers = full.cues.filter(c => c.kind === "divider");
  assert.equal(dividers.length, 0);
  for (const cue of dividers) assert.ok(cue.end - cue.start <= 0.801);
});
const serviceSlot = new Date("2026-10-26T07:00:00Z"), serviceNow = new Date("2026-10-26T06:55:00Z");
const currentWeather = { weather: { source_id: 1, timestamp: "2026-10-26T06:50:00Z", temperature: 12.4, icon: "cloudy", wind_speed_10: 10 }, sources: [{ id: 1, distance: 4000, station_name: "Mainz" }] };
test("weather only reads fresh local measurements and distinguishes forecasts", () => {
  const forecast = { weather: [7, 8, 9, 10].map(hour => ({ timestamp: `2026-10-26T${String(hour).padStart(2, '0')}:00:00Z`, source_id: 2, temperature: 13, precipitation_probability: 10 })), sources: [{ id: 2, observation_type: "forecast", distance: 2100 }] };
  const good = weatherReport(currentWeather, forecast, serviceNow, serviceSlot);
  assert.equal(good.available, true); assert.match(good.text, /12 Grad/); assert.match(good.text, /drei Stunden/); assert.match(good.text, /10 Prozent/);
  assert.equal(weatherReport(currentWeather, null, new Date("2026-10-26T09:00:00Z"), serviceSlot).available, false);
  assert.equal(weatherReport({ ...currentWeather, sources: [{ id: 1, distance: 90000 }] }, null, serviceNow, serviceSlot).available, false);
  assert.equal(weatherReport({ ...currentWeather, weather: { ...currentWeather.weather, temperature: null } }, null, serviceNow, serviceSlot).available, false);
  assert.equal(weatherReport({ ...currentWeather, weather: { ...currentWeather.weather, timestamp: "2026-10-27T00:00:00Z" } }, null, serviceNow, serviceSlot).available, false);
  assert.equal(weatherReport(null, forecast, serviceNow, serviceSlot).available, false);
});
test("traffic excludes future, finished and geographically unrelated closures", () => {
  const event = { identifier: "local", coordinate: { lat: 49.98, long: 8.25 }, subtitle: "AS Mainz", startTimestamp: "2026-10-25T00:00:00+02:00", future: false, display_type: "CLOSURE_ENTRY_EXIT", description: ["Ende: 27.10.26 um 06:00 Uhr", "Abfahrt von der A60: AS Mainz"] };
  const values = [event, { ...event, identifier: "future", future: true }, { ...event, identifier: "startFuture", startTimestamp: "2026-10-27T00:00:00Z" }, { ...event, identifier: "ended", description: ["Ende: 26.10.26 um 07:00 Uhr", "(Ende der Gesamtmaßnahme: 01.12.26)"] }, { ...event, identifier: "faraway", coordinate: { lat: 50.8, long: 8.25 } }];
  const events = trafficEvents({ closure: values }, "A60", "closure", serviceSlot);
  assert.equal(events.length, 1); assert.equal(events[0].id, "local"); assert.match(events[0].detail, /Abfahrt an der Anschlussstelle Mainz ist gesperrt/);
  assert.throws(() => trafficEvents({}, "A60", "closure", serviceSlot));
});
test("partial or failed traffic feeds never imply clear roads", () => {
  const partial = trafficReport([], 2, serviceNow), failed = trafficReport([], 0, serviceNow), complete = trafficReport([], 6, serviceNow);
  assert.equal(partial.complete, false); assert.match(partial.text, /teilweise/); assert.doesNotMatch(partial.text, /störungsfrei|freie Fahrt/);
  assert.equal(failed.available, false); assert.match(failed.text, /nicht abrufbar/);
  assert.equal(complete.complete, true); assert.match(complete.text, /innerstädtische Verkehr.*nicht erfasst/);
});
test("hourly service must belong to the exact slot and be fetched within ten minutes", () => {
  const m = (date: string, slot = serviceSlot.toISOString()) => ({ service: { fetchedAt: date, slot } });
  assert.equal(serviceFreshForSlot(m(serviceNow.toISOString()), serviceSlot), true);
  assert.equal(serviceFreshForSlot(m("2026-10-26T06:49:59Z"), serviceSlot), false);
  assert.equal(serviceFreshForSlot(m("2026-10-26T07:01:00Z"), serviceSlot), false);
  assert.equal(serviceFreshForSlot(m(serviceNow.toISOString(), "2026-10-26T08:00:00Z"), serviceSlot), false);
  assert.equal(serviceFreshForSlot({}, serviceSlot), false);
});
test("source outages produce an explicit hourly fallback without model calls", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("unavailable"); };
  try {
    const service = await collectHourlyService(serviceSlot, serviceNow);
    assert.equal(service.weather.available, false); assert.equal(service.traffic.available, false);
    assert.match(service.weather.text, /nicht verfügbar/); assert.match(service.traffic.text, /nicht abrufbar/);
    assert.equal(service.errors.length, 7); assert.equal(service.sources.length, 0);
  } finally { globalThis.fetch = original; }
});


test("daily test schedule has exactly 07 Turkish and 08 German, no hourly purchases", () => {
  for (const [day, offset] of [["2026-10-29", 1], ["2026-07-15", 2]] as const) {
    const slots = [];
    for (let hour = 0; hour < 24; hour++) {
      const date = new Date(`${day}T${String(hour).padStart(2, "0")}:00:00Z`);
      if (isNewsSlot(date)) slots.push(stationTime(date).hour);
    }
    assert.deepEqual(slots, [7, 8]);
    const eight = new Date(`${day}T${String(8 - offset).padStart(2, "0")}:00:00Z`);
    assert.equal(upcomingNewsSlot(eight)?.getTime(), eight.getTime());
    assert.equal(stationTime(upcomingNewsSlot(new Date(eight.getTime() + 1))!).hour, 7);
    assert.equal(isNewsSlot(new Date(eight.getTime() + 1)), false);
    assert.equal(isNewsSlot(new Date(eight.getTime() + 60_000)), false);
  }
});

import { audioResponse } from "../src/lib/radio/audio-range";
test("archived audio supports bounded byte ranges and rejects invalid seeks", async () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 4]);
  for (const [range, expected, contentRange] of [["bytes=1-3", [1, 2, 3], "bytes 1-3/5"], ["bytes=3-", [3, 4], "bytes 3-4/5"], ["bytes=-2", [3, 4], "bytes 3-4/5"], ["bytes=3-99", [3, 4], "bytes 3-4/5"]] as const) {
    const r = audioResponse(bytes, range);
    assert.equal(r.status, 206); assert.equal(r.headers.get("content-range"), contentRange);
    assert.deepEqual([...new Uint8Array(await r.arrayBuffer())], expected);
  }
  for (const range of ["bytes=9-", "bytes=4-2", "bytes=-0", "bytes=", "bytes=0-1,3-4"]) assert.equal(audioResponse(bytes, range).status, 416);
  assert.equal(audioResponse(bytes, null).status, 200);
});

import { speechText } from "../src/lib/radio/pronunciation";
test("Turkish TTS reads TRT as TERETE and the dealership as Dörşuk", () => {
  assert.equal(speechText("Autohaus Dörrschuck: TRT’nin TRT Dinle, TRT Belgesel ve TRT 2 yayınları.", "tr"), "Autohaus Dörşuk: TERETE’nin TERETE Dinle, TERETE Belgesel ve TERETE 2 yayınları.");
  assert.equal(speechText("TRT2, T.R.T. ve T R T", "tr"), "TERETE 2, TERETE ve TERETE");
  assert.equal(speechText("TRTSpor, XTRT, TRTnin", "tr"), "TRTSpor, XTRT, TRTnin");
  assert.equal(speechText("Autohaus Dörrschuck und TRT", "de"), "Autohaus Dörrschuck und TRT");
});

import { familyContentAllowed, familyAssetAllowed, FAMILY_CONTENT_POLICY } from "../src/lib/radio/family";
import { warningDetail } from "../src/lib/radio/service";
import { NEWS_POLICY } from "../src/lib/radio/news";
test("family policy rejects explicit adult topics in German and Turkish before speech and playback", () => {
  for (const text of ["Ein Erotikfilm", "Empfehlung: Horrorfilm ab 18+", "FSK 16: neuer Splatterfilm", "Werbung für Glücksspiel", "Erfolg mit Cannabis", "Cinsel içerik", "Çıplak görüntüler", "Uyuşturucu reklamı", "Kumar oyunu", "İşkence sahneleri", "Ein Song mit Fuck you", "Siktir git"])
    assert.equal(familyContentAllowed(text), false, text);
  for (const text of ["Eine Ausstellung für Familien in Mainz", "Kuss Quartett spielt Kammermusik", "Die DNA von Vögeln wurde untersucht", "Yeni kütüphaneler ve dinozor fosilleri", "Auf der A60 ist die Auffahrt gesperrt."])
    assert.equal(familyContentAllowed(text), true, text);
  assert.ok(NEWS_POLICY.includes(FAMILY_CONTENT_POLICY));
  assert.equal(familyAssetAllowed({ kind: "news", script: "Eine Ausstellung", metadata: { sources: [{ title: "Erotikfilm mit FSK 18" }] } }), false);
});
test("traffic keeps operational warnings and reported delays without upsetting incident detail", () => {
  const detail = warningDetail("Mainz Richtung Wiesbaden", ["Unfall mit grausamen Verletzungsdetails", "Im Stillstand", "Reisezeitverlust: 11 Minuten"]);
  assert.match(detail, /Verkehr steht/); assert.match(detail, /11 Minuten/); assert.doesNotMatch(detail, /Unfall|Verletzungsdetails/);
  assert.match(warningDetail("Mainz", ["Gegenstände auf der Fahrbahn"]), /Hindernisse/);
  assert.match(warningDetail("Mainz", ["Gefahr durch Glatteis"]), /Glätte/);
  assert.match(warningDetail("Mainz", ["Falschfahrer, stockender Verkehr"]), /Falschfahrer/);
});

import { naturalRadioText } from "../src/lib/radio/presentation";
test("radio speech drops measurement times and internal panel comments but keeps event times", () => {
  assert.equal(naturalRadioText("Ihr Wetter! Stand 07 Uhr 30. Aktuell 4 Grad. Alle Quellen finden Sie im Radio-Dashboard. Gute Fahrt!"), "Ihr Wetter! Aktuell 4 Grad. Gute Fahrt!");
  assert.equal(naturalRadioText("Verkehr. Abrufstand 08:15 Uhr. Die Auffahrt bleibt bis 18 Uhr gesperrt. Quelle ist die Autobahn GmbH."), "Verkehr. Die Auffahrt bleibt bis 18 Uhr gesperrt.");
  assert.equal(naturalRadioText("Bültenimizin sonuna geldik. Haber kaynaklarına radyo panelimizden ulaşabilirsiniz. Güzel bir gün dileriz."), "Bültenimizin sonuna geldik. Güzel bir gün dileriz.");
  const weather = weatherReport(currentWeather, null, serviceNow, serviceSlot), traffic = trafficReport([], 6, serviceNow);
  assert.doesNotMatch(weather.text + traffic.text, /Messstand|Abrufstand|Stand \d|Dashboard|Bright Sky|Quelle ist/);
  assert.equal(weather.observedAt, new Date(currentWeather.weather.timestamp).toISOString());
});

import { newsOutroTimeline } from "../src/lib/radio/mix";
test("energetic closers begin after all speech, keep a clean gap and cannot be doubled", () => {
  const programme = { duration: 10.2, timeline: [{ kind: "story", start: 0, end: 6 }, { kind: "outro", start: 6.5, end: 10 }] };
  const result = newsOutroTimeline(programme, 3);
  assert.ok(result.start >= 10.22); assert.equal(result.timeline.at(-1)?.kind, "closer");
  for (const voice of programme.timeline) assert.ok(voice.end < result.start);
  assert.throws(() => newsOutroTimeline({ duration: result.duration, timeline: result.timeline }, 3));
  assert.throws(() => newsOutroTimeline(programme, Number.NaN));
  assert.throws(() => newsOutroTimeline({ duration: 2, timeline: programme.timeline }, 3));
});
