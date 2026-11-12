import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { HatimPlayer, HATIM_CHAPTERS, hatimSegment, nextHatimCursor, type HatimCursor } from "../src/lib/radio/hatim";
import { hatimWindowEnd, isHatimHours, stationHour } from "../src/lib/radio/config";

const chapters = [1, 2].map(surah => ({ surah, name: "Test", verses: [[1, 0, 10], [2, 10, 25], [3, 25, 40]] }));
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
function fixture(initial: HatimCursor = { surah: 1, offsetSeconds: 17, completedLoops: 0 }) {
  let now = stationHour("2026-11-12", 22), saved = { ...initial };
  const processes: (EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdio: PassThrough[]; kill: () => boolean; args: string[] })[] = [];
  const errors: unknown[] = [], chunks: Buffer[] = [];
  const deps = {
    chapters, now: () => now, load: async () => ({ ...saved }), save: async (cursor: HatimCursor) => { saved = { ...cursor }; },
    prepare: async () => ({ file: "fixture.mp3", duration: 41 }),
    publish: (chunk: Buffer) => chunks.push(chunk), status: () => {}, error: (error: unknown) => errors.push(error),
    spawn: (args: string[]) => {
      const proc = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdio: [new PassThrough(), new PassThrough(), new PassThrough(), new PassThrough()], args, kill: () => { proc.emit("close", null); return true; } });
      processes.push(proc); return proc as unknown as ChildProcess;
    },
  };
  return { deps, processes, errors, chunks, get saved() { return saved; }, setNow(date: Date) { now = date; } };
}

test("complete Quran manifest preserves all 114 chapters and 6236 ordered verses", () => {
  assert.equal(HATIM_CHAPTERS.length, 114);
  let count = 0;
  for (const [index, chapter] of HATIM_CHAPTERS.entries()) {
    assert.equal(chapter.surah, index + 1);
    let expected = 1, end = 0;
    for (const [ayah, start, finish] of chapter.verses) {
      if (ayah > 0) { assert.equal(ayah, expected++); count++; }
      assert.ok(start >= end - 0.2 && finish > start && Number.isFinite(finish)); end = finish;
    }
  }
  assert.equal(count, 6236);
  assert.deepEqual(nextHatimCursor({ surah: 114, offsetSeconds: 50, completedLoops: 2 }), { surah: 1, offsetSeconds: 0, completedLoops: 3 });
});

test("night programme crosses midnight and both DST transitions and stays on Sundays", () => {
  for (const [day, hours] of [["2026-11-12", 6], ["2026-03-28", 5], ["2026-10-24", 7]] as const) {
    const start = stationHour(day, 22), end = hatimWindowEnd(start)!;
    assert.equal((end.getTime() - start.getTime()) / 3600_000, hours);
    assert.equal(isHatimHours(new Date(start.getTime() - 1)), false);
    assert.equal(isHatimHours(new Date(end.getTime() - 1)), true);
    assert.equal(isHatimHours(end), false);
    assert.equal(hatimWindowEnd(new Date(end.getTime() - 1))?.getTime(), end.getTime());
  }
});

test("resume repeats the unfinished verse and cutoff never selects half a verse", () => {
  const chapter = chapters[0];
  assert.deepEqual(hatimSegment(chapter, 17, 41, 20), { start: 10, end: 25, windowComplete: true, chapterComplete: false });
  assert.equal(hatimSegment(chapter, 25, 41, 30)?.start, 25, "completed verse is not repeated");
  assert.deepEqual(hatimSegment(chapter, 17, 41, 10), { start: 10, end: 10, windowComplete: true, chapterComplete: false });
  assert.equal(hatimSegment(chapter, 0, 41, 43)?.chapterComplete, true);
  assert.equal(hatimSegment(chapter, 41, 41, 100), null);
});

test("progress comes from encoded audio; shutdown and restart resume the unfinished verse", async () => {
  const f = fixture(), player = new HatimPlayer(f.deps);
  await player.tick();
  assert.equal(f.processes[0].args[f.processes[0].args.indexOf("-ss") + 1], "10");
  f.processes[0].stdio[3].write("out_time_us=9000000\n");
  await player.stop();
  assert.equal(f.saved.offsetSeconds, 19);
  f.processes[0].stdout.write(Buffer.from("late audio"));
  assert.equal(f.chunks.length, 0, "stopped processes cannot publish stale audio");
  const restarted = new HatimPlayer(f.deps); await restarted.tick();
  assert.equal(f.processes[1].args[f.processes[1].args.indexOf("-ss") + 1], "10");
  f.processes[1].emit("close", 0); await settle();
  assert.deepEqual(f.saved, { surah: 2, offsetSeconds: 0, completedLoops: 0 });
  await restarted.tick(); f.processes[2].emit("close", 0); await settle();
  assert.deepEqual(f.saved, { surah: 1, offsetSeconds: 0, completedLoops: 1 });
  await restarted.stop();
});

test("night cutoff pads silence and resumes at the next verse the following night", async () => {
  const f = fixture(), player = new HatimPlayer(f.deps);
  f.setNow(new Date("2026-11-13T02:59:40Z")); // 03:59:40 Berlin
  await player.tick();
  assert.ok(f.processes[0].args.includes("atrim=duration=15,apad"));
  f.processes[0].stdio[3].write("out_time_us=20000000\n");
  f.processes[0].emit("close", 0); await settle();
  assert.equal(f.saved.offsetSeconds, 25, "silent padding does not advance the Quran");
  await player.tick(); assert.equal(f.processes.length, 1);
  f.setNow(stationHour("2026-11-13", 4)); await player.tick(); assert.equal(f.processes.length, 1);
  f.setNow(stationHour("2026-11-13", 22)); await player.tick();
  assert.equal(f.processes[1].args[f.processes[1].args.indexOf("-ss") + 1], "25");
  await player.stop();
});

test("decoder failure keeps progress and retries without skipping the unfinished verse", async () => {
  const f = fixture(), player = new HatimPlayer(f.deps); await player.tick();
  f.processes[0].stdio[3].write("out_time_us=7000000\n");
  f.processes[0].emit("close", 1); await settle();
  assert.equal(f.saved.surah, 1); assert.equal(f.saved.offsetSeconds, 17); assert.equal(f.errors.length, 1);
  await player.tick(); assert.equal(f.processes.length, 1);
  f.setNow(new Date(stationHour("2026-11-12", 22).getTime() + 11000)); await player.tick();
  assert.equal(f.processes[1].args[f.processes[1].args.indexOf("-ss") + 1], "10"); await player.stop();
});

test("a late download cannot start playback after shutdown or after 04:00", async () => {
  for (const shutdown of [true, false]) {
    const f = fixture(); let release!: (value: { file: string; duration: number }) => void;
    f.deps.prepare = () => new Promise(resolve => { release = resolve; });
    const player = new HatimPlayer(f.deps), pending = player.tick(); await settle();
    if (shutdown) await player.stop(); else f.setNow(stationHour("2026-11-13", 4));
    release({ file: "fixture.mp3", duration: 41 }); await pending;
    assert.equal(f.processes.length, 0); await player.stop();
  }
});
