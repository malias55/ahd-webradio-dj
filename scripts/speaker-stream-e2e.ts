// Real HTTP + FFmpeg regression. No database, accounts, providers or live zones.
import { createServer, get, type ServerResponse } from 'node:http';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';
import { SpeakerStream, Mp3Frames, MP3_FRAME_MS, SPEAKER_DELAY_MS } from '../src/lib/speaker-stream';

async function main() {
  const silence = new Mp3Frames().push(readFileSync('public/audio/speaker-silence.mp3'));
  const tones = new Map<string, Buffer[]>();
  for (const [name,hz,kbps] of [['music',440,320],['news',880,128],['a',1320,128],['b',1760,128]] as const) {
    const bytes=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i',`sine=frequency=${hz}:sample_rate=44100:duration=3`,'-ac','2','-c:a','libmp3lame','-b:a',`${kbps}k`,'-reservoir','0','-id3v2_version','0','-write_xing','0','-f','mp3','pipe:1']);
    tones.set('/'+name,new Mp3Frames().push(bytes));
  }
  let selection:string[]=[],upstreamRequests=0,stall=false;
  const connections=new Set<ServerResponse>();
  const router=new SpeakerStream(async()=>selection,silence,()=>{});
  const server=createServer((req,res)=>{
    connections.add(res);res.once('close',()=>connections.delete(res));
    res.writeHead(200,{'Content-Type':'audio/mpeg'});
    if(req.url==='/speaker'){router.attach(res);return;}
    const frames=tones.get(req.url||'');if(!frames){res.end();return;}
    upstreamRequests++;let frame=0;
    const timer=setInterval(()=>{if(!stall)res.write(frames[frame++%frames.length]);},26);
    res.once('close',()=>clearInterval(timer));
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();assert.ok(address&&typeof address==='object');
  const origin=`http://127.0.0.1:${address.port}`;
  selection=[origin+'/music'];
  const chunks:Buffer[]=[];let downstreamResponses=0;
  const request=get(origin+'/speaker',res=>{downstreamResponses++;res.on('data',chunk=>chunks.push(chunk));});
  const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
  try {
    await wait(3000);selection=[origin+'/news'];
    await wait(3000);selection=[];
    await wait(2000);selection=[origin+'/a',origin+'/b'];
    await wait(5000);selection=[origin+'/music'];
    await wait(3000);stall=true;
    const before=upstreamRequests;
    await wait(14_000);stall=false;
    await wait(4000);
    assert.ok(upstreamRequests>before,'a stalled upstream is reopened without a receiver reconnect');
    assert.equal(downstreamResponses,1);
    assert.equal(router.diagnostics().clients,1);
    const output=Buffer.concat(chunks);
    const pcm=execFileSync('ffmpeg',['-v','error','-i','pipe:0','-f','f32le','-ar','8000','-ac','1','pipe:1'],{input:output,maxBuffer:16*1024*1024});
    const samples=new Float32Array(pcm.buffer,pcm.byteOffset,pcm.byteLength/4);
    // Every connection begins with the buffered backlog (silence on a new stream).
    const lead=Math.round(Math.ceil((SPEAKER_DELAY_MS+1500)/MP3_FRAME_MS)*MP3_FRAME_MS*8);
    const rms=(start:number,end:number)=>{const a=samples.subarray(lead+start*8000,lead+end*8000);return Math.sqrt(a.reduce((sum,x)=>sum+x*x,0)/a.length);};
    const energy=(start:number,hz:number)=>{
      const a=samples.subarray(lead+start*8000,lead+(start+1)*8000);let real=0,imag=0;
      for(let i=0;i<a.length;i++){const phase=2*Math.PI*hz*i/8000;real+=a[i]*Math.cos(phase);imag+=a[i]*Math.sin(phase);}
      return Math.hypot(real,imag)/a.length;
    };
    assert.ok(energy(1,440)>energy(1,880)*5,'music reaches the persistent stream');
    assert.ok(energy(4,880)>energy(4,440)*5,'news replaces music without browser polling');
    assert.ok(rms(7,8)<0.001,'planned silence is actual silence');
    assert.ok(energy(11,1320)>0.01&&energy(11,1760)>0.01,'parallel announcements are both audible');
    assert.ok(energy(32,440)>0.01,'music recovers after a long source stall');
    assert.ok(router.diagnostics().bufferedFrames<=230);
    mkdirSync('artifacts/pwa-continuous-20261117',{recursive:true});
    writeFileSync('artifacts/pwa-continuous-20261117/continuous-test.mp3',output);
    console.log(JSON.stringify({passed:true,seconds:samples.length/8000,downstreamResponses,upstreamRequests,diagnostics:router.diagnostics()}));
  } finally {
    router.close();request.destroy();for(const response of connections)response.destroy();server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
