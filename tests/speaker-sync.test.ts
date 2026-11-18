import test from 'node:test';
import assert from 'node:assert/strict';
import { MP3_FRAME_SECONDS, ServerClock, correctionRate, parseSpeakerTimeline, playoutPosition, SEEK_THRESHOLD_SECONDS } from '../src/lib/speaker-sync';

test('the timeline header is parsed strictly',()=>{
 assert.deepEqual(parseSpeakerTimeline('abc;1234.500;172;3000'),{instance:'abc',epoch:1234.5,firstFrame:172,delayMs:3000});
 for(const bad of [null,'',';1;2;3','abc;x;2;3','abc;1;2.5;3','abc;1;-2;3','abc;1;2;-1','abc;1;2;999999'])assert.equal(parseSpeakerTimeline(bad),null);
});

test('devices that connected at different times derive the same audible frame',()=>{
 const frameMs=MP3_FRAME_SECONDS*1000,epoch=5000,serverNow=epoch+1000*frameMs+3000;
 // Device A received frames from 800, device B (after a reconnect, appended at 40 s) from 950.
 const a=playoutPosition({instance:'i',epoch,firstFrame:800,delayMs:3000},0,serverNow);
 const b=playoutPosition({instance:'i',epoch,firstFrame:950,delayMs:3000},40,serverNow);
 assert.ok(Math.abs(a-200*MP3_FRAME_SECONDS)<1e-9,'frame 1000 is audible on A');
 assert.ok(Math.abs(b-(40+50*MP3_FRAME_SECONDS))<1e-9,'frame 1000 is audible on B');
 const earlier=playoutPosition({instance:'i',epoch,firstFrame:800,delayMs:3000},0,serverNow,120);
 assert.ok(Math.abs(earlier-a-0.12)<1e-9,'a positive trim plays the device earlier');
});

test('the clock follows the least delayed measurement and forgets a previous server process',()=>{
 const clock=new ServerClock();
 assert.equal(clock.ready('one'),false);
 // True offset 10 000 ms. A congested request (300 ms, very asymmetric) is far off.
 clock.add('one',10_000+1000+290,1000,1300);
 assert.ok(clock.ready('one'));
 clock.add('one',10_000+2000+10,2000,2020);
 clock.add('one',10_000+3000+10,3000,3020);
 clock.add('one',10_000+4000+280,4000,4300);
 assert.ok(Math.abs(clock.serverNow(5000)-15_000)<25,'bad measurements do not pull the estimate away');
 assert.equal(clock.precision,10);
 clock.add('one',NaN,1,2);clock.add('one',5,10,9);
 assert.equal(clock.count,4,'invalid measurements are ignored');
 clock.add('two',77+6000,6000,6000);
 assert.equal(clock.ready('one'),false);assert.equal(clock.serverNow(6000),6077);
});

test('drift is corrected gently, with hysteresis, and never into an empty buffer',()=>{
 assert.equal(correctionRate(0.005,false,3),1,'small deviations are left alone');
 assert.ok(correctionRate(0.02,false,3)>1&&correctionRate(-0.02,false,3)<1);
 assert.ok(correctionRate(0.005,true,3)>1,'an active correction continues until the deviation is gone');
 assert.equal(correctionRate(0.002,true,3),1);
 assert.equal(correctionRate(0.05,false,0.2),1,'no acceleration with a thin buffer');
 for(const error of [-1,-SEEK_THRESHOLD_SECONDS,SEEK_THRESHOLD_SECONDS,1])assert.ok(Math.abs(correctionRate(error,false,3)-1)<0.0121,'the rate change stays inaudible');
 // Two devices 100 ms apart converge without any seek.
 let a=0.05,b=-0.05,ca=false,cb=false;
 for(let t=0;t<120;t++){const ra=correctionRate(a,ca,3),rb=correctionRate(b,cb,3);ca=ra!==1;cb=rb!==1;a-=(ra-1)*0.25;b-=(rb-1)*0.25;}
 assert.ok(Math.abs(a-b)<0.01);
});
