import test from "node:test";
import assert from "node:assert/strict";
import { sourcesForProgramme, turkishSourceOrder, type NewsSource } from "../src/lib/radio/news";

function source(id: number, title: string, url = `https://example.com/${id}`): NewsSource {
  return { id, title, url, summary: "", local: false, publishedAt: "2026-11-05T04:00:00Z" };
}

test("Turkish selection drops previously used articles and surfaces national election results before features", () => {
  const repeat = source(1, "Kekova Batığı Guinness Rekorlar Kitabı'nda", "https://example.com/1/?utm_source=rss");
  const feature = source(2, "Yeni bir sergi açıldı");
  const election = source(3, "ABD Kongre ara seçimlerinde Demokratlar Senato'da çoğunluğu kazandı");
  const localElection = source(4, "Köyde muhtarlık seçim sonucu açıklandı");
  assert.deepEqual(turkishSourceOrder([repeat, feature, localElection, election], ["https://example.com/1"]), [election, feature, localElection]);
});

test("German selection lets the editor consider major political news and retains programme filters", () => {
  const election = source(1, "US-Midterms: Welche Folgen hat die Kongresswahl für Präsident Trump?");
  const ev = source(2, "Rekord bei Elektroautos");
  const accident = source(3, "Unfall auf der Autobahn");
  assert.deepEqual(sourcesForProgramme([election, ev, accident], "de"), [election]);
});
