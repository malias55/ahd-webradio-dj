import test from "node:test";
import assert from "node:assert/strict";
import { MUSIC_GAIN_DB, NEWS_GAIN_DB, musicFilter } from "../src/lib/radio/playback-level";

test("music plays quieter than its stored level so news stands out", () => {
  assert.equal(MUSIC_GAIN_DB, -6);
  assert.ok(NEWS_GAIN_DB - MUSIC_GAIN_DB >= 12, "news sits well above the music");
  assert.equal(musicFilter(), "volume=-6dB");
  assert.equal(musicFilter("afade=t=in:d=3:curve=hsin"), "volume=-6dB,afade=t=in:d=3:curve=hsin", "fades keep the music level");
});
