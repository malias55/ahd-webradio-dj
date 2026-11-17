import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Mp3Frames, SpeakerStream, type SourceOpener } from '../src/lib/speaker-stream';
import { usesContinuousSpeaker, speakerStreamUrl } from '../src/lib/speaker-stream-url';

const silenceBytes = readFileSync('public/audio/speaker-silence.mp3');
const silence = new Mp3Frames().push(silenceBytes);
const framesFor = (marker: number, count = 20) => Buffer.concat(Array.from({length:count},()=>{
  const frame=Buffer.from(silence[0]); frame[frame.length-1]=marker;return frame;
}));
class Sink extends EventEmitter {
  destroyed=false; blocked=false; ended=0; chunks:Buffer[]=[];
  write(chunk:Buffer){this.chunks.push(chunk);return !this.blocked;}
  end(){this.ended++;this.destroyed=true;this.emit('close');}
}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
function harness(t: TestContext) {
  t.mock.timers.enable({apis:['setTimeout','Date']});
  t.mock.method(performance,'now',()=>Date.now());
  let selection:string[]|null=['http://127.0.0.1/music'];
  const inputs:{urls:string[]; data:(b:Buffer)=>void; end:()=>void; stopped:boolean}[]=[];
  const open:SourceOpener=(urls,data,end)=>{const input={urls,data,end,stopped:false};inputs.push(input);return()=>{input.stopped=true;};};
  let idle=0;
  const stream=new SpeakerStream(async()=>selection,silence,()=>{idle++;},open);
  t.after(()=>stream.close());
  const sink=new Sink();stream.attach(sink);
  return {stream,sink,inputs,set:(value:string[]|null)=>{selection=value;},get idle(){return idle;},async advance(ms:number){await flush();for(let elapsed=0;elapsed<ms;elapsed+=25){t.mock.timers.tick(Math.min(25,ms-elapsed));await flush();}}};
}

test('MP3 frames survive arbitrarily split chunks and ID3 metadata without changing audio bytes',()=>{
  assert.ok(silence.length>8);
  const expected=Buffer.concat(silence);
  const tag=Buffer.concat([Buffer.from([73,68,51,4,0,0,0,0,0,5]),Buffer.from('hello')]);
  const parser=new Mp3Frames(),result:Buffer[]=[];
  for(const byte of Buffer.concat([tag,silenceBytes]))result.push(...parser.push(Buffer.from([byte])));
  assert.deepEqual(Buffer.concat(result),expected);
  assert.throws(()=>new Mp3Frames().push(Buffer.alloc(1024*1024+1)),/limit/);
});

test('music, news, silence and live changes keep one downstream connection and discard obsolete input',async t=>{
  const h=harness(t);await h.advance(1);
  const original=h.inputs[0];original.data(framesFor(1));await h.advance(250);
  assert.ok(h.sink.chunks.some(frame=>frame.at(-1)===1));
  h.set(['http://127.0.0.1/news']);await h.advance(275);
  assert.equal(original.stopped,true);assert.equal(h.inputs.length,2);assert.equal(h.stream.status(),'buffering');
  original.data(framesFor(99));h.inputs[1].data(framesFor(2));await h.advance(300);
  assert.ok(h.sink.chunks.some(frame=>frame.at(-1)===2));
  assert.ok(!h.sink.chunks.some(frame=>frame.at(-1)===99));
  h.set([]);await h.advance(500);assert.equal(h.inputs[1].stopped,true);assert.equal(h.stream.status(),'waiting');
  assert.ok(h.sink.chunks.at(-1)!.equals(silence[(h.sink.chunks.length-1)%silence.length]) || silence.some(frame=>frame.equals(h.sink.chunks.at(-1)!)));
  h.set(['http://127.0.0.1/live?a','http://127.0.0.1/live?b']);await h.advance(275);
  assert.equal(h.inputs.at(-1)!.urls.length,2,'parallel announcements are passed to the mixer');
  assert.equal(h.sink.ended,0);
});

test('upstream errors and source lookup failures recover without ending the receiver stream',async t=>{
  const h=harness(t);await h.advance(1);h.inputs[0].data(framesFor(1));
  h.set(null);await h.advance(300);assert.equal(h.inputs[0].stopped,false);
  h.inputs[0].end();assert.equal(h.stream.status(),'reconnecting');const before=h.sink.chunks.length;
  await h.advance(1600);assert.ok(h.inputs.length>=2);assert.equal(h.sink.ended,0);
  assert.ok(h.sink.chunks.length>before,'valid silence keeps flowing during failure');
  h.inputs.at(-1)!.data(framesFor(3));await h.advance(350);
  assert.ok(h.sink.chunks.some(frame=>frame.at(-1)===3));
});

test('a wedged upstream, slow receiver and overproducing input stay bounded',async t=>{
  const h=harness(t);await h.advance(1);
  h.inputs[0].data(framesFor(1,1000));assert.equal(h.stream.diagnostics().bufferedFrames,230);
  const slow=new Sink();slow.blocked=true;h.stream.attach(slow);
  await h.advance(60_000);
  assert.equal(slow.chunks.length,1,'no writes pile up behind a blocked socket');
  assert.ok(h.sink.chunks.length>2000,'other clients keep receiving frames');
  assert.ok(h.inputs.length>1,'an open upstream without frames is restarted');
  assert.ok(h.stream.diagnostics().bufferedFrames<=230);
  slow.blocked=false;slow.emit('drain');await h.advance(50);assert.ok(slow.chunks.length>1);
});

test('last listener cleanup stops upstreams and timers; quick reconnect reuses the zone stream',async t=>{
  const h=harness(t);await h.advance(1);h.sink.end();await h.advance(2000);
  const next=new Sink();h.stream.attach(next);await h.advance(4000);
  assert.equal(h.idle,0);assert.equal(h.stream.diagnostics().closed,false);
  next.end();await h.advance(5100);
  assert.equal(h.idle,1);assert.equal(h.stream.diagnostics().closed,true);
  assert.ok(h.inputs.every(input=>input.stopped));
  const count=h.inputs.length;await h.advance(20_000);assert.equal(h.inputs.length,count);
});

test('continuous routing is limited to built-in stations and escapes zone ids',()=>{
  assert.equal(usesContinuousSpeaker({defaultSource:'radio'}),true);
  assert.equal(usesContinuousSpeaker({defaultSource:'azuracast'}),true);
  assert.equal(usesContinuousSpeaker({defaultSource:'custom_url'}),false);
  assert.equal(speakerStreamUrl('a/b','https://radio.test'),'https://radio.test/api/zones/a%2Fb/speaker-stream');
});
