import test from 'node:test';
import assert from 'node:assert/strict';
import { speakerSyncAdjustment, type ClockSample } from '../src/lib/speaker-sync';
const clock:ClockSample={listener:'a',connection:'c',mediaSeconds:20,receivedAt:0,transitSeconds:0};
test('two players half a second apart converge on the server clock without seeking',()=>{
 let a=18,b=17.5;
 for(let ms=0;ms<45000;ms+=250){
  const sample={...clock,mediaSeconds:20+ms/1000,receivedAt:ms};
  const x=speakerSyncAdjustment(sample,ms,a,2),y=speakerSyncAdjustment(sample,ms,b,2.5);
  assert.equal(x.target,null);assert.equal(y.target,null);
  a+=x.rate*.25;b+=y.rate*.25;
 }
 assert.ok(Math.abs(a-b)<0.08);
});
test('stale clocks, thin buffers and invalid time never accelerate into an underrun',()=>{
 assert.equal(speakerSyncAdjustment(clock,11000,20,2).rate,1);
 assert.equal(speakerSyncAdjustment(clock,0,17,0.1).rate,1);
 assert.equal(speakerSyncAdjustment(clock,0,NaN,2).rate,1);
 assert.equal(speakerSyncAdjustment(clock,-1,18,2).rate,1);
});
test('large proven lag offers a clock target; the caller must validate downloaded seekable range',()=>{
 assert.equal(speakerSyncAdjustment(clock,0,12,8).target,18);
 assert.equal(speakerSyncAdjustment(clock,0,18.03,2).rate,1);
 assert.ok(speakerSyncAdjustment(clock,0,18.5,2).rate<1);
});
