import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { stationTime, stationHour } from '../src/lib/radio/config';
import { bulletinKey, newsEditionSlot } from '../src/lib/radio/news';
import { FAMILY_CONTENT_VERSION } from '../src/lib/radio/family';
import { command } from '../src/lib/radio/store';
const root=new PrismaClient(),schema=`ahd_radio_e2e_${randomBytes(6).toString('hex')}`;
const target=new URL(process.env.PG_URL!);target.searchParams.set('schema',schema);
const db=new PrismaClient({datasourceUrl:target.toString()});
const origin='http://127.0.0.1:3199';let server:ChildProcess|undefined,created=false;
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));
async function stop(){if(!server)return;const p=server;server=undefined;p.kill('SIGTERM');await new Promise<void>(resolve=>{p.once('close',()=>resolve());setTimeout(()=>{p.kill('SIGKILL');resolve();},4000).unref();});}

async function captureStream(ms: number) {
  const response = await fetch(origin + '/api/radio/stream');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /audio\/mpeg/);
  const reader = response.body!.getReader(), chunks: Buffer[] = [];
  const timer = setTimeout(() => { void reader.cancel(); }, ms);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return Buffer.concat(chunks);
      chunks.push(Buffer.from(value));
    }
  } finally { clearTimeout(timer); await reader.cancel().catch(() => {}); }
}

async function checkTransitions(audio: Buffer, dir: string) {
  const mp3 = join(dir, 'broadcast.mp3'), raw = join(dir, 'broadcast.pcm');
  await writeFile(mp3, audio);
  await command(process.env.FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-i', mp3, '-ac', '1', '-ar', '8000', '-f', 's16le', '-y', raw]);
  const pcm = await readFile(raw), levels: number[] = [];
  const samplesPerWindow = 400; // 50 ms
  for (let start = 0; start + 2 * samplesPerWindow <= pcm.length; start += 2 * samplesPerWindow) {
    let power = 0;
    for (let i = 0; i < samplesPerWindow; i++) power += pcm.readInt16LE(start + 2 * i) ** 2;
    levels.push(Math.sqrt(power / samplesPerWindow));
  }
  const pauses: { start: number; end: number }[] = [];
  for (let index = 0; index < levels.length; index++) {
    if (levels[index] >= 10) continue;
    const start = index;
    while (index < levels.length && levels[index] < 10) index++;
    if (index - start >= 99) pauses.push({ start, end: index });
  }
  assert.equal(pauses.length, 2, 'continuous stream has two pauses of at least five seconds, within one analysis window');
  const [before, after] = pauses;
  assert.ok(after.start - before.end >= 155 && after.start - before.end <= 165, 'complete eight-second bulletin between pauses');
  assert.ok(levels[before.start - 50] > 2 * levels[before.start - 20], 'music fades down before the bulletin');
  assert.ok(levels[after.end + 50] > 2 * levels[after.end + 20], 'music fades up after the bulletin');
  console.log('Measured pauses in the continuous MP3 stream:', pauses.map(pause => (pause.end - pause.start) / 20));
}

async function main(){
 const dir=await mkdtemp(join(tmpdir(),'ahd-daily-stream-'));
 try{
  await root.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);created=true;
  for(const table of ['users','zones','devices','radio_assets','radio_playbacks','radio_jobs'])await root.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`);
  const tone=join(dir,'voice.mp3');await command(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-nostdin','-f','lavfi','-i','sine=frequency=440:duration=8:sample_rate=44100','-ac','2','-c:a','libmp3lame','-b:a','128k','-y',tone]);const audio=await readFile(tone);
  await db.radioAsset.create({data:{key:'test-music',kind:'music',title:'Isolated test music',audio,duration:8}});
  const day=stationTime().date;
  const voiceIds=new Map<string,string>();
  for(const hour of [10,7]){
   const slot=stationHour(day,hour),language=hour===7?'tr':'de';
   const a=await db.radioAsset.create({data:{key:bulletinKey(slot),kind:'news',title:`Isolated ${language} daily news`,audio,duration:8,slot,script:'Freundliche Meldung aus Mainz.',metadata:{language,familyContentVersion:FAMILY_CONTENT_VERSION,stories:[{text:'Freundliche Meldung aus Mainz.'}],service:language==='de'?{mode:'daily-snapshot',slot:slot.toISOString(),fetchedAt:stationHour(day,9).toISOString()}:undefined}}});voiceIds.set(language,a.id);
  }
  const preload=join(dir,'clock.cjs');await writeFile(preload,`const R=Date,o=Number(process.env.AHD_E2E_CLOCK_OFFSET);function D(...a){if(new.target)return Reflect.construct(R,a.length?a:[R.now()+o],new.target);return new R(R.now()+o).toString();}Object.setPrototypeOf(D,R);D.prototype=R.prototype;D.now=()=>R.now()+o;D.parse=R.parse;D.UTC=R.UTC;global.Date=D;`);
  for(const hour of [17,20]){
   const slot=stationHour(day,hour),offset=slot.getTime()-12000-Date.now();let logs='';
   server=spawn(process.execPath,['--require',preload,'dist/server.js'],{env:{...process.env,NODE_ENV:'production',PG_URL:target.toString(),PORT:'3199',RADIO_PUBLIC_URL:origin,SKIP_AUTH:'false',AHD_E2E_CLOCK_OFFSET:String(offset),ELEVENLABS_API_KEY:'',OPENAI_API_KEY:'',EDENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
   server.stdout!.on('data',b=>{logs=(logs+b).slice(-5000);});server.stderr!.on('data',b=>{logs=(logs+b).slice(-5000);});
   let seen=false;
   const expectedTitle = hour === 17 ? 'Isolated test music' : 'Isolated tr daily news';
   for(let i=0;i<100;i++){try{const h=await fetch(origin+'/api/health').then(r=>r.json());if(h.radio?.title===expectedTitle){seen=true;break;}}catch{}await wait(250);}
   assert.ok(seen,`expected ${expectedTitle} near ${hour}:00; ${logs.slice(-700)}`);
   const captured = await captureStream(hour === 17 ? 29_000 : 1500);
   const bytes = captured.length;
   assert.ok(bytes>1000,'real FFmpeg stream must contain MP3 packets');
   if (hour === 17) await checkTransitions(captured, dir);
   const a=await db.radioPlayback.findFirstOrThrow({where:{scheduledFor:slot,kind:'news'}});
   assert.equal(a.assetId,voiceIds.get(hour===20?'tr':'de'));assert.equal(a.repeated,true);
   assert.equal(await db.radioAsset.count({where:{kind:'news'}}),2,'broadcast repeats never create another recording');assert.equal(await db.radioJob.count(),0,'streaming must not purchase or prepare speech');
   assert.equal(newsEditionSlot(slot).getTime(),stationHour(day,hour===20?7:10).getTime());
   console.log(JSON.stringify({hour,language:hour===20?'tr':'de',bytes,repeated:a.repeated,isolatedDatabase:true}));await stop();
  }
  console.log('PASS real 17:00 German and 20:00 Turkish MP3 streams, canonical daily recordings, repeat journal and zero provider calls; production data untouched');
 }finally{await stop();await db.$disconnect();if(created)await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await root.$disconnect();await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Isolated stream test failed');process.exitCode=1;});
