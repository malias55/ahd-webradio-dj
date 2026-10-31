import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { TURKISH_DIVIDER_KEY } from '../src/lib/radio/imaging';
import { bulletinKey, TURKISH_NEWS_VERSION } from '../src/lib/radio/news';
import { insertNewsDividers, type Cue } from '../src/lib/radio/mix';
import { familyAssetAllowed } from '../src/lib/radio/family';
import { command, withJob } from '../src/lib/radio/store';
async function divider() {
 const old = await prisma.radioAsset.findUnique({ where: { key: TURKISH_DIVIDER_KEY } }); if (old) return old;
 const originalPath=process.argv[3];
 if(!originalPath)throw new Error('New ElevenLabs audio and its generation.json provenance are required');
 const provenance=JSON.parse(await readFile(join(dirname(resolve(originalPath)),'generation.json'),'utf8'));
 if(provenance.provider!=='elevenlabs'||provenance.sourceExcerpt!==false)throw new Error('Original ElevenLabs generation required; excerpts are not accepted');
 const original=await readFile(originalPath), dir=await mkdtemp(join(tmpdir(),'ahd-tr-original-divider-'));
 try {
  const input=join(dir,'original.mp3'),pcm=join(dir,'master.pcm'),output=join(dir,'master.mp3');
  await writeFile(input,original);
  const originalDuration=Number(await command(process.env.FFPROBE_PATH || 'ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',input]));
  if(!Number.isFinite(originalDuration)||originalDuration<0.5||originalDuration>1.2)throw new Error('Generate a complete short sting lasting 0.5–1.2 seconds');
  // Master the entire original performance. No excerpting, time cuts or reuse
  // of the longer intro: preserve the generator's complete musical gesture.
  await command(process.env.FFMPEG_PATH || 'ffmpeg',['-v','error','-nostdin','-i',input,'-ar','44100','-ac','2','-f','f32le','-y',pcm]);
  const data=await readFile(pcm);let peak=0,energy=0;for(let i=0;i<data.length;i+=4){const x=data.readFloatLE(i);peak=Math.max(peak,Math.abs(x));energy+=x*x;}
  const rms=Math.sqrt(energy/(data.length/4));if(!Number.isFinite(rms)||rms<1e-5)throw new Error('Generated transition is silent');
  const gain=Math.min(10**(-24/20)/rms,10**(-12/20)/peak);
  await command(process.env.FFMPEG_PATH || 'ffmpeg',['-v','error','-nostdin','-f','f32le','-ar','44100','-ac','2','-i',pcm,'-af',`volume=${gain}`,'-c:a','libmp3lame','-b:a','128k','-y',output]);
  const duration=Number(await command(process.env.FFPROBE_PATH || 'ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',output]));
  const asset=await prisma.radioAsset.create({data:{key:TURKISH_DIVIDER_KEY,kind:'imaging',title:'Türkçe · Özgün haber geçişi',duration,audio:await readFile(output),metadata:{language:'tr',role:'divider',newGeneration:true,sourceExcerpt:false,originalFileSha256:createHash('sha256').update(original).digest('hex'),generation:provenance,targetRmsDbfs:-24,peakCeilingDbfs:-12,usage:'Original complete ElevenLabs sting between complete Turkish stories, never under voice'}}});
  console.log(JSON.stringify({divider:asset.id,duration,originalGeneration:true,sourceExcerpt:false,billedCredits:provenance.billedCredits}));return asset;
 } finally {await rm(dir,{recursive:true,force:true});}
}
async function main(){
 await mkdir(resolve('artifacts/turkish-generated-divider'),{recursive:true});
 const sound=await divider();await writeFile(resolve('artifacts/turkish-generated-divider/transition-final.mp3'),sound.audio);
 const id=process.argv[2];if(!id)return;
 const source=await prisma.radioAsset.findUniqueOrThrow({where:{id}});const m=source.metadata as {language:string;timeline:Cue[]};
 if(source.kind!=='news'||m.language!=='tr'||!source.slot||!familyAssetAllowed(source))throw new Error('Reviewed Turkish news required');
 const key=bulletinKey(source.slot);
 await withJob(key,async()=>{
  if(await prisma.radioAsset.findUnique({where:{key},select:{id:true}}))return;
  const {timeline,...audio}=await insertNewsDividers({audio:source.audio,duration:source.duration,timeline:m.timeline},sound);
  const metadata={...(source.metadata as Record<string,unknown>)};delete metadata.supersededBy;
  if(metadata.audioDesignReview){metadata.sourceAudioDesignReview=metadata.audioDesignReview;delete metadata.audioDesignReview;}
  await prisma.radioAsset.create({data:{key,kind:'news',title:source.title,slot:source.slot,script:source.script,...audio,metadata:{...metadata,programmeVersion:TURKISH_NEWS_VERSION,timeline,dividerVersion:TURKISH_DIVIDER_KEY,correctedAt:new Date().toISOString(),correction:'Eigenständig neu bei ElevenLabs erzeugter Nachrichtentrenner; Sprache und redaktionelle Quellen unverändert',remixedFrom:source.id,modelCalls:[]} as Prisma.InputJsonValue}});
 });
 const asset=await prisma.radioAsset.findUniqueOrThrow({where:{key}});
 if(asset.id!==source.id)await prisma.radioAsset.update({where:{id:source.id},data:{metadata:{...(source.metadata as object),supersededBy:asset.id}}});
 const oldExcerpts=await prisma.radioAsset.findMany({where:{kind:'news',slot:source.slot,metadata:{path:['dividerVersion'],equals:'imaging:tr-approved-divider-v1'}},select:{id:true,metadata:true}});
 for(const old of oldExcerpts)if(old.id!==asset.id)await prisma.radioAsset.update({where:{id:old.id},data:{metadata:{...(old.metadata as object),supersededBy:asset.id}}});
 const timeline=(asset.metadata as {timeline:Cue[]}).timeline, cue=timeline.find(c=>c.kind==='divider');
 await writeFile(resolve('artifacts/turkish-generated-divider/turkish-news-original-transition.mp3'),asset.audio);
 if(cue){const file=resolve('artifacts/turkish-generated-divider/turkish-news-original-transition.mp3');await command(process.env.FFMPEG_PATH || 'ffmpeg',['-v','error','-nostdin','-i',file,'-ss',String(Math.max(0,cue.start-4)),'-t','9','-c:a','libmp3lame','-b:a','128k','-y',resolve('artifacts/turkish-generated-divider/transition-in-news.mp3')]);}
 console.log(JSON.stringify({id:asset.id,duration:asset.duration,dividers:timeline.filter(c=>c.kind==='divider').length,newProviderCalls:0,scriptUnchanged:asset.script===source.script}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Turkish signature edit failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
