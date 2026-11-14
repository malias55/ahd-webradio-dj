import test from "node:test";
import assert from "node:assert/strict";
import { getAnnouncementStatus, prepareAnnouncementIntro } from "../src/lib/announcement-intro";

function audioFixture(duration = 1.8) {
  const connections: unknown[] = [];
  const events: { time: number; value: number }[] = [];
  const stream = {} as MediaStream;
  const destination = { stream };
  let startedAt = -1, stopped = false;
  const gain = {
    value: 1,
    setValueAtTime(value: number, time: number) { events.push({ value, time }); },
    cancelScheduledValues(time: number) {
      for (let i = events.length - 1; i >= 0; i--) if (events[i].time >= time) events.splice(i, 1);
    },
  };
  const gate = { gain, connect(node: unknown) { connections.push(node); } };
  const gong = {
    buffer: null, connect(node: unknown) { connections.push(node); },
    start(time: number) { startedAt = time; }, stop() { stopped = true; },
  };
  const microphone = { connect(node: unknown) { connections.push(node); } };
  const context = {
    currentTime: 10,
    async decodeAudioData() { return { duration }; },
    createMediaStreamDestination() { return destination; },
    createGain() { return gate; }, createBufferSource() { return gong; },
  };
  return {
    context, microphone, connections, destination, stream, gain, gate,
    get startedAt() { return startedAt; }, get stopped() { return stopped; },
    micAt(time: number) { return events.filter(e => e.time <= time).at(-1)?.value ?? gain.value; },
  };
}

test("gong precedes the microphone on the same output and uses decoded duration", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ArrayBuffer(4)));
  for (const duration of [1.8, 2.1]) {
    const f = audioFixture(duration);
    const intro = await prepareAnnouncementIntro(f.context as unknown as AudioContext, f.microphone as unknown as AudioNode);
    assert.equal(intro.stream, f.stream);
    assert.deepEqual(f.connections, [f.gate, f.destination, f.destination]);
    intro.start();
    assert.equal(f.micAt(10), 0);
    assert.equal(f.micAt(f.startedAt + duration - 0.001), 0);
    assert.equal(f.micAt(f.startedAt + duration), 1);
    assert.equal(intro.isPlaying(), true);
    f.context.currentTime = f.startedAt + duration;
    assert.equal(intro.isPlaying(), false);
  }
});

test("stopping during the gong cancels the sound and never reopens the microphone", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ArrayBuffer(4)));
  const f = audioFixture();
  const intro = await prepareAnnouncementIntro(f.context as unknown as AudioContext, f.microphone as unknown as AudioNode);
  intro.start();
  f.context.currentTime = 10.5;
  intro.stop();
  assert.equal(f.stopped, true);
  assert.equal(intro.isPlaying(), false);
  assert.equal(f.micAt(10.5), 0);
  assert.equal(f.micAt(30), 0);
});

test("a missing gong fails before connecting the microphone", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("missing", { status: 404 }));
  const f = audioFixture();
  await assert.rejects(prepareAnnouncementIntro(f.context as unknown as AudioContext, f.microphone as unknown as AudioNode), /Gong konnte nicht geladen/);
  assert.deepEqual(f.connections, []);
});


test("speaker cue follows the microphone gate and cannot turn green while audio is suspended", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response(new ArrayBuffer(4)));
  const f = audioFixture();
  const context = Object.assign(f.context, { state: "running" as AudioContextState });
  const intro = await prepareAnnouncementIntro(context as unknown as AudioContext, f.microphone as unknown as AudioNode);
  intro.start();
  assert.equal(Math.ceil(intro.remainingMs() / 1000), 2);
  context.currentTime = f.startedAt + 1;
  assert.equal(Math.ceil(intro.remainingMs() / 1000), 1);
  assert.equal(getAnnouncementStatus(context, intro).phase, "intro");
  assert.equal(f.micAt(context.currentTime), 0);
  context.state = "suspended";
  assert.equal(getAnnouncementStatus(context, intro).phase, "paused");
  context.state = "running";
  assert.equal(getAnnouncementStatus(context, intro).phase, "intro");
  context.currentTime = f.startedAt + 1.8;
  assert.equal(getAnnouncementStatus(context, intro).phase, "speaking");
  assert.equal(f.micAt(context.currentTime), 1);
  context.state = "suspended";
  assert.equal(getAnnouncementStatus(context, intro).phase, "paused");
});
