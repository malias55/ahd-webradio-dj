import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startSpeakerMode, stopSpeakerMode, activeSpeakerVolume, activeSpeakerPlaybackStatus, resumeSpeakerPlayback } from '../src/lib/speakerMode';

class AudioWithoutVolume extends EventTarget {
  static instances: AudioWithoutVolume[] = [];
  preload=''; crossOrigin=''; src=''; currentTime=1; pauses=0; loads=0;
  get volume() { return 1; }
  set volume(_value: number) { /* Safari/iOS can ignore media-element volume. */ }
  constructor() { super(); AudioWithoutVolume.instances.push(this); }
  async play() {}
  pause() { this.pauses++; }
  load() { this.loads++; }
  removeAttribute() {}
}
class VolumeEvents {
  static instances: VolumeEvents[]=[];
  onmessage: ((event: {data:string})=>void)|null=null;
  onerror: (()=>void)|null=null;
  closed=false;
  constructor(readonly url:string) { VolumeEvents.instances.push(this); }
  send(zoneId:string,volume:unknown) { this.onmessage?.({data:JSON.stringify({zoneId,volume})}); }
  close() { this.closed=true; }
}
class GainContext {
  static instances: GainContext[]=[];
  static allowResume=true;
  state='suspended'; onstatechange: (()=>void)|null=null;
  destination={}; gain={gain:{value:1},connect:()=>{}};
  sources: {disconnects:number; connect:()=>void; disconnect:()=>void}[]=[];
  constructor() { GainContext.instances.push(this); }
  createGain() { return this.gain; }
  createMediaElementSource() {
    const source={disconnects:0,connect:()=>{},disconnect:()=>{source.disconnects++;}};
    this.sources.push(source);return source;
  }
  async resume() { if (GainContext.allowResume) { this.state='running';this.onstatechange?.(); } }
  async close() { this.state='closed'; }
}
const saved=new Map<string,PropertyDescriptor|undefined>();
let reply:()=>Promise<Response>;
const response=(volume=80,url='/radio.mp3')=>Response.json({url,volume,live:false});
async function flush() { for(let i=0;i<30;i++)await Promise.resolve(); }
beforeEach(()=>{
 AudioWithoutVolume.instances=[];VolumeEvents.instances=[];GainContext.instances=[];GainContext.allowResume=true;
 reply=async()=>response();
 for(const [name,value] of Object.entries({Audio:AudioWithoutVolume,AudioContext:GainContext,EventSource:VolumeEvents,fetch:()=>reply()})) {
  saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
 }
});
afterEach(()=>{
 stopSpeakerMode();
 for(const [name,descriptor] of saved) { if(descriptor)Object.defineProperty(globalThis,name,descriptor);else Reflect.deleteProperty(globalThis,name); }
 saved.clear();
});

test('remote volume and mute control audible gain even when media volume is ignored',async()=>{
 await startSpeakerMode('showroom');
 const audio=AudioWithoutVolume.instances[0],context=GainContext.instances[0],events=VolumeEvents.instances[0];
 assert.equal(context.gain.gain.value,.8);
 events.send('showroom',23);
 assert.equal(context.gain.gain.value,.23);assert.equal(activeSpeakerVolume(),23);
 assert.equal(audio.volume,1,'gain is applied exactly once');
 events.send('showroom',0);assert.equal(context.gain.gain.value,0,'zero really mutes');
 events.send('other-zone',90);events.send('showroom','90');
 assert.equal(context.gain.gain.value,0,'wrong-zone and invalid messages cannot change volume');
 events.send('showroom',100);assert.equal(context.gain.gain.value,1);
 assert.equal(audio.pauses,0);assert.equal(audio.loads,0);assert.equal(context.sources.length,1);
});

test('an old status response cannot undo a remote change and polling recovers after event disconnect',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 await startSpeakerMode('showroom');
 let resolve!:(r:Response)=>void;
 reply=()=>new Promise(r=>{resolve=r;});
 t.mock.timers.tick(2000);await flush();
 VolumeEvents.instances[0].send('showroom',31);
 resolve(response(80));await flush();
 assert.equal(activeSpeakerVolume(),31);assert.equal(GainContext.instances[0].gain.gain.value,.31);
 VolumeEvents.instances[0].onerror?.();reply=async()=>response(44);
 t.mock.timers.tick(2000);await flush();
 assert.equal(activeSpeakerVolume(),44);assert.equal(GainContext.instances[0].gain.gain.value,.44);
});

test('live volume survives a source change and old-zone events are ignored after switching or stopping',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});
 await startSpeakerMode('showroom');
 const oldEvents=VolumeEvents.instances[0],oldContext=GainContext.instances[0];
 oldEvents.send('showroom',35);reply=async()=>response(80,'/news.mp3');
 t.mock.timers.tick(2000);await flush();
 assert.equal(oldContext.gain.gain.value,.35);assert.equal(AudioWithoutVolume.instances[1].src,'/news.mp3');
 await startSpeakerMode('workshop');
 assert.equal(oldEvents.closed,true);assert.equal(oldContext.state,'closed');
 assert.ok(oldContext.sources.every(source=>source.disconnects===1));
 oldEvents.send('showroom',0);assert.equal(activeSpeakerVolume(),80);
 const current=VolumeEvents.instances[1];stopSpeakerMode();current.send('workshop',0);
 assert.equal(current.closed,true);assert.equal(activeSpeakerVolume(),null);
});

test('a suspended gain context requests a gesture and resumes without replacing audio',async()=>{
 GainContext.allowResume=false;
 await startSpeakerMode('showroom');assert.equal(activeSpeakerPlaybackStatus(),'blocked');
 GainContext.allowResume=true;resumeSpeakerPlayback();await flush();
 assert.notEqual(activeSpeakerPlaybackStatus(),'blocked');assert.equal(AudioWithoutVolume.instances.length,1);
});
