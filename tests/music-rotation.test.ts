import test from "node:test";
import assert from "node:assert/strict";
import { buildMusicQueue, musicAvailableAt, QUIET_MUSIC_EXCLUDED_IDS } from "../src/lib/radio/music-policy";

const winter = new Date("2026-11-09T12:00:00Z");
const tracks = Array.from({ length: 8 }, (_, i) => ({ id: String(i), kind: "music", metadata: { season: i === 7 ? "winter" : "all" } }));
const seededRandom = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

test("a complete rotation contains every eligible track exactly once", () => {
  const pool = [...tracks, { ...tracks[0] }, { ...tracks[0], id: QUIET_MUSIC_EXCLUDED_IDS[0] }, { ...tracks[0], id: "unreviewed", kind: "music-candidate" }];
  const queue = buildMusicQueue(pool, [], winter, seededRandom(1));
  assert.deepEqual(queue.map(track => track.id).sort(), tracks.map(track => track.id).sort());
  assert.equal(pool.length, 11, "input is not mutated");
});

test("round boundaries and restored playback history keep at least four other tracks between repeats", () => {
  for (let seed = 1; seed <= 100; seed++) {
    const history: string[] = [], random = seededRandom(seed);
    for (let round = 0; round < 20; round++) {
      // A fresh queue is also how a process restart resumes from database history.
      for (const track of buildMusicQueue(tracks, history.slice(0, 24), winter, random)) {
        assert.ok(!history.slice(0, 4).includes(track.id), `${seed}: ${track.id} repeated too soon`);
        history.unshift(track.id);
      }
    }
  }
});

test("seasonal music follows November through February in Berlin, including queued tracks", () => {
  const seasonal = tracks[7];
  assert.equal(musicAvailableAt(seasonal, new Date("2026-10-31T22:59:59Z")), false);
  assert.equal(musicAvailableAt(seasonal, new Date("2026-10-31T23:00:00Z")), true);
  assert.equal(musicAvailableAt(seasonal, new Date("2027-02-28T22:59:59Z")), true);
  assert.equal(musicAvailableAt(seasonal, new Date("2027-02-28T23:00:00Z")), false);
  assert.equal(buildMusicQueue(tracks, [], new Date("2027-07-01T12:00:00Z")).length, 7);
  assert.equal(musicAvailableAt({ id: "queued", kind: "music", season: "winter" }, new Date("2027-07-01T12:00:00Z")), false);
});

test("small pools remain playable and stale history never revives excluded music", () => {
  assert.deepEqual(buildMusicQueue([], [], winter), []);
  assert.equal(buildMusicQueue([tracks[0]], ["0"], winter)[0].id, "0");
  const queue = buildMusicQueue(tracks.slice(0, 2), ["0", QUIET_MUSIC_EXCLUDED_IDS[0], "deleted"], winter, () => 0);
  assert.deepEqual(queue.map(track => track.id), ["1", "0"]);
});

test("the winter accent is spaced from recently played seasonal music", () => {
  const queue = buildMusicQueue(tracks, ["7", "0", "1", "2"], winter, () => 0.9999);
  assert.ok(queue.findIndex(track => track.id === "7") >= 4);
});
