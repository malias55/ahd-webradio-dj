import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { stationTime, stationHour } from '../src/lib/radio/config';
import { bulletinKey, newsEditionSlot, usesSlotUpdates, isBulletinRepeat } from '../src/lib/radio/news';
import { HATIM_ID, HATIM_CHAPTERS, prepareHatimChapter } from '../src/lib/radio/hatim';
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
  const migration = spawnSync('npx', ['prisma', 'db', 'push', '--skip-generate'], { env: { ...process.env, PG_URL: target.toString() }, stdio: 'pipe' });
  assert.equal(migration.status, 0, 'current schema must deploy cleanly to isolated database');
  const tone=join(dir,'voice.mp3');await command(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-nostdin','-f','lavfi','-i','sine=frequency=440:duration=8:sample_rate=44100','-ac','2','-c:a','libmp3lame','-b:a','128k','-y',tone]);const audio=await readFile(tone);
  await db.radioAsset.create({data:{key:'test-music',kind:'music',title:'Isolated test music',audio,duration:8}});
  const day=process.env.AHD_E2E_STATION_DAY || stationTime().date;
  const updated=usesSlotUpdates(stationHour(day,17));
  const voiceIds=new Map<string,string>();
  for(const hour of [8,7]){
   const language=hour===7?'tr':'de';
   const slot=stationHour(day,updated ? (language==='tr'?21:20) : hour);
   const snapshot={slot:slot.toISOString(),fetchedAt:new Date(slot.getTime()-60_000).toISOString()};
   const service=language==='de' ? (updated ? snapshot : {mode:'daily-snapshot',slot:slot.toISOString(),fetchedAt:stationHour(day,9).toISOString()}) : undefined;
   const a=await db.radioAsset.create({data:{key:bulletinKey(slot),kind:'news',title:`Isolated ${language} daily news`,audio,duration:8,slot,script:'Freundliche Meldung aus Mainz.',metadata:{language,weatherTrafficPaused:language==='de',familyContentVersion:FAMILY_CONTENT_VERSION,stories:[{text:'Freundliche Meldung aus Mainz.'}],service,market:updated&&language==='tr'?snapshot:undefined}}});voiceIds.set(language,a.id);
  }
  const preload=join(dir,'clock.cjs');await writeFile(preload,`const R=Date,o=Number(process.env.AHD_E2E_CLOCK_OFFSET);function D(...a){if(new.target)return Reflect.construct(R,a.length?a:[R.now()+o],new.target);return new R(R.now()+o).toString();}Object.setPrototypeOf(D,R);D.prototype=R.prototype;D.now=()=>R.now()+o;D.parse=R.parse;D.UTC=R.UTC;global.Date=D;`);
  for(const hour of process.env.AHD_E2E_NIGHT_ONLY ? [] : [20,21]){
   const slot=stationHour(day,hour),offset=slot.getTime()-12000-Date.now();let logs='';
   server=spawn(process.execPath,['--require',preload,'dist/server.js'],{env:{...process.env,NODE_ENV:'production',PG_URL:target.toString(),PORT:'3199',RADIO_PUBLIC_URL:origin,SKIP_AUTH:'false',AHD_E2E_CLOCK_OFFSET:String(offset),ELEVENLABS_API_KEY:'',OPENAI_API_KEY:'',EDENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
   server.stdout!.on('data',b=>{logs=(logs+b).slice(-5000);});server.stderr!.on('data',b=>{logs=(logs+b).slice(-5000);});
   let seen=false;
   const expectedTitle = hour === 20 ? 'Isolated test music' : 'Isolated tr daily news';
   for(let i=0;i<100;i++){try{const h=await fetch(origin+'/api/health').then(r=>r.json());if(h.radio?.title===expectedTitle){seen=true;break;}}catch{}await wait(250);}
   assert.ok(seen,`expected ${expectedTitle} near ${hour}:00; ${logs.slice(-700)}`);
   const captured = await captureStream(hour === 20 ? 29_000 : 1500);
   const bytes = captured.length;
   assert.ok(bytes>1000,'real FFmpeg stream must contain MP3 packets');
   if (hour === 20) await checkTransitions(captured, dir);
   const a=await db.radioPlayback.findFirstOrThrow({where:{scheduledFor:slot,kind:'news'}});
   assert.equal(a.assetId,voiceIds.get(hour===21?'tr':'de'));assert.equal(a.repeated,isBulletinRepeat(slot));
   assert.equal(await db.radioAsset.count({where:{kind:'news'}}),2,'broadcast repeats never create another recording');assert.equal(await db.radioJob.count(),0,'streaming must not purchase or prepare speech');
   assert.equal(newsEditionSlot(slot).getTime(),stationHour(day,hour===21?7:8).getTime());
   console.log(JSON.stringify({hour,language:hour===21?'tr':'de',bytes,repeated:a.repeated,isolatedDatabase:true}));await stop();
  }
  // Run the real server across 22:00 and 04:00 with persistent verse progress.
  await prepareHatimChapter(1);
  let nightLogs = '';
  const bootNight = async (at: Date) => {
    nightLogs = '';
    server=spawn(process.execPath,['--require',preload,'dist/server.js'],{env:{...process.env,NODE_ENV:'production',PG_URL:target.toString(),PORT:'3199',RADIO_PUBLIC_URL:origin,SKIP_AUTH:'false',AHD_E2E_CLOCK_OFFSET:String(at.getTime()-Date.now()),ELEVENLABS_API_KEY:'',OPENAI_API_KEY:'',EDENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
    server.stdout!.on('data',b=>{nightLogs=(nightLogs+b).slice(-4000);});server.stderr!.on('data',b=>{nightLogs=(nightLogs+b).slice(-4000);});
    for(let i=0;i<100;i++){try{const h=await fetch(origin+'/api/health').then(r=>r.json());if(h.radio?.title?.startsWith('Hatim')) return;}catch{}await wait(200);}
    assert.fail('Hatim did not start: '+nightLogs.slice(-500));
  };
  await bootNight(new Date(stationHour(day,22).getTime()-2000));
  const nightAudio = await captureStream(1500);
  assert.ok(nightAudio.length > 1000);
  await stop();
  let progress = await db.hatimProgress.findUniqueOrThrow({where:{id:HATIM_ID}});
  assert.equal(progress.surah,1); assert.ok(progress.offsetSeconds > 0);
  console.log(JSON.stringify({nightStart:'22:00',bytes:nightAudio.length,persistedOffset:progress.offsetSeconds}));
  const nextDay = stationTime(new Date(stationHour(day,22).getTime()+8*3600000)).date;
  await db.hatimProgress.update({where:{id:HATIM_ID},data:{surah:1,offsetSeconds:17,completedLoops:0}});
  const beforeCutoff = new Date(stationHour(nextDay,4).getTime()-20000);
  await bootNight(beforeCutoff);
  const ending = await captureStream(24000); // stream closes itself at 04:00
  const offAir = await fetch(origin+'/api/health').then(r=>r.json());
  assert.equal(offAir.radio.onAir,false);
  assert.equal((await fetch(origin+'/api/radio/stream')).status,503);
  await stop();
  progress = await db.hatimProgress.findUniqueOrThrow({where:{id:HATIM_ID}});
  assert.ok(HATIM_CHAPTERS[0].verses.some(([, , end]) => Math.abs(progress.offsetSeconds-end)<0.05),'04:00 checkpoint must be a completed verse boundary; actual offset '+progress.offsetSeconds);
  assert.ok(progress.offsetSeconds > 17, 'at least one verse was completed before cutoff');
  assert.equal(progress.surah,1);
  const savedOffset=progress.offsetSeconds;
  await bootNight(stationHour(nextDay,22));
  assert.ok((await captureStream(1500)).length>1000); await stop();
  progress=await db.hatimProgress.findUniqueOrThrow({where:{id:HATIM_ID}});
  assert.ok(progress.offsetSeconds>=savedOffset && progress.offsetSeconds<savedOffset+5,'next night resumes the next verse rather than starting over');
  assert.equal(await db.radioJob.count(),0,'Hatim never calls paid generation');
  console.log(JSON.stringify({nightEnd:'04:00',bytes:ending.length,completedVerseOffset:savedOffset,resumedOffset:progress.offsetSeconds,zeroProviderCalls:true}));
  console.log(process.env.AHD_E2E_NIGHT_ONLY ? 'PASS real Hatim stream: 22:00 start, 04:00 verse boundary, next-night resume, zero paid provider calls' : 'PASS real 20:00 German and 21:00 Turkish streams plus Hatim 22:00–04:00, persistent verse progress, matching journal, zero paid provider calls; production data untouched');
 }finally{await stop();await db.$disconnect();if(created)await root.$executeRawUnsafe(`DROP SCHEMA "${schema}" CASCADE`);await root.$disconnect();await rm(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Isolated stream test failed');process.exitCode=1;});
