import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "../src/lib/prisma";
import { command } from "../src/lib/radio/store";
import { playMusicNow, musicLibraryChanged, musicLibraryPlayback, skipMusic, stopRadio } from "../src/lib/radio/engine";

test("direct play is one-off, rejects concurrent commands and resumes the updated automatic pool", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-11-09T12:30:00Z") });
  const directory = await mkdtemp(join(tmpdir(), "ahd-music-control-test-"));
  const manualId = randomUUID(), automaticId = randomUUID();
  const source = join(directory, "test.mp3");
  await command("ffmpeg", ["-v", "error", "-nostdin", "-f", "lavfi", "-i", "sine=frequency=220:duration=12", "-c:a", "libmp3lame", "-y", source]);
  const audio = await readFile(source);
  const automatic = { id: automaticId, title: "Automatic", kind: "music", duration: 12, metadata: { rotationEnabled: true }, audio };
  const manual = { id: manualId, title: "Disabled candidate", kind: "music-candidate", duration: 12, metadata: { rotationEnabled: false }, audio };
  const state = (globalThis as any).__ahdRadio;
  Object.assign(state, { started: true, shutdown: false, selecting: false, process: null, playing: null, newsTransition: false, musicControlBusy: false, musicQueue: [], musicSinceId: 0 });
  const restore: (() => void)[] = [];
  function stub(object: any, key: string, replacement: (...args: any[]) => any) {
    const original = object[key]; object[key] = replacement; restore.push(() => { object[key] = original; });
  }
  const played: string[] = [];
  let loads = 0;
  stub(prisma.radioAsset, "findUnique", async ({ where }: any) => { loads++; return where.id === manualId ? manual : null; });
  stub(prisma.radioAsset, "findUniqueOrThrow", async ({ where }: any) => where.id === manualId ? manual : automatic);
  stub(prisma.radioAsset, "findMany", async () => [manual, automatic]);
  stub(prisma.radioPlayback, "findMany", async () => []);
  stub(prisma.radioPlayback, "create", async ({ data }: any) => { played.push(data.assetId); return { id: randomUUID() }; });
  stub(prisma.radioPlayback, "update", async () => ({}));
  stub(prisma.radioPlayback, "updateMany", async () => ({ count: 1 }));
  try {
    state.started = false;
    await musicLibraryChanged(automaticId, true);
    assert.equal(musicLibraryPlayback().playing, null, "changing the library cannot start an uninitialized radio engine");
    state.started = true;
    const first = playMusicNow(manualId);
    await assert.rejects(playMusicNow(manualId), /gewechselt/);
    assert.equal(loads, 1, "the second request cannot replace the first");
    await first;
    assert.equal(musicLibraryPlayback().playing?.id, manualId);
    assert.equal(manual.metadata.rotationEnabled, false, "one-off play never enables rotation");
    assert.equal(musicLibraryPlayback().playing?.kind, "music", "a candidate receives the music codec and history type");

    await assert.rejects(playMusicNow("missing"), /nicht gefunden/);
    assert.equal(musicLibraryPlayback().playing?.id, manualId, "a missing asset does not interrupt audio");

    // Disabling the current song fades it out, then selects the current database pool.
    await musicLibraryChanged(manualId, false);
    assert.equal(musicLibraryPlayback().playing?.id, automaticId);
    assert.ok(played.includes(manualId));
    assert.ok(played.includes(automaticId));
    assert.equal(state.musicControlBusy, false);

    await assert.rejects(skipMusic(manualId), /anderer Titel/, "a stale skip cannot affect the next track");
    await playMusicNow(manualId);
    await skipMusic(manualId);
    assert.equal(musicLibraryPlayback().playing?.id, automaticId, "skip returns to automatic music without enabling the manual track");
    assert.equal(manual.metadata.rotationEnabled, false);

    state.newsTransition = true;
    await assert.rejects(playMusicNow(manualId), /laufen Nachrichten/);
    assert.equal(musicLibraryPlayback().playing?.id, automaticId, "news priority does not kill the existing process");
  } finally {
    await stopRadio();
    await rm(directory, { recursive: true, force: true });
    for (const id of [manualId, automaticId]) await rm(join(tmpdir(), "ahd-radio-cache", `${id}.mp3`), { force: true });
    restore.reverse().forEach(reset => reset());
    t.mock.timers.reset();
  }
});
