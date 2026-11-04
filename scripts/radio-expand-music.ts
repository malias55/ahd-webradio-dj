import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { prisma } from '../src/lib/prisma';
import { command, normalizeAudio } from '../src/lib/radio/store';
import { elevenLabsError } from '../src/lib/radio/elevenlabs';
const directory=resolve('artifacts/daily-schedule-20261104/music');
const briefs=[
 ['Showroom Velvet · Daylight','Warm Rhodes piano, rounded bass, soft electronic groove, clean acoustic guitar details, 92 BPM.'],
 ['Velvet Floorplan · Panorama','Gentle felt piano, warm upright bass, brushed drums and airy restrained pads, 82 BPM.'],
 ['Showroom Satin · Boulevard','Mellow clean jazz guitar, warm electric piano, understated drums and very sparse rounded tenor sax answers, 96 BPM.'],
 ['Showroom Velvet · Sunlit','Warm Rhodes, gentle bossa-influenced rhythm, acoustic guitar, rounded bass and soft shaker, 90 BPM.'],
 ['Velvet Floorplan · Café','Soft felt piano and clean guitar in a light acoustic jazz trio with brushed drums, friendly and airy, 86 BPM.'],
 ['Showroom Satin · Easy Drive','Smooth clean guitar, warm electric piano, tasteful bass groove, soft drums and subtle jazz harmonies, 98 BPM.'],
];
async function balance(){
 const r=await fetch('https://api.elevenlabs.io/v1/user/subscription',{headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY!},signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error('Music budget cannot be verified');const d=await r.json()as any;
 if(!Number.isFinite(d.character_limit)||!Number.isFinite(d.character_count))throw new Error('Music budget unavailable');
 return Math.max(0,d.character_limit-d.character_count);
}
async function main(){
 await mkdir(directory,{recursive:true});
 const previous=await prisma.radioAsset.findMany({where:{key:{startsWith:'music:showroom-expansion-20261104:'}},select:{metadata:true}});
 let spent=previous.reduce((sum,a)=>sum+Number((a.metadata as any)?.budgetReservationCredits||(a.metadata as any)?.billedCredits||4000),0),estimated=Math.max(4000,...previous.map(a=>Number((a.metadata as any)?.billedCredits||0)));
 for(const[index,[title,style]]of briefs.entries()){
  const key=`music:showroom-expansion-20261104:${index}`;
  let asset=await prisma.radioAsset.findUnique({where:{key}});
  if(!asset){
   const rawPath=join(directory,`raw-${index}.mp3`),metaPath=join(directory,`generation-${index}.json`);
   let raw:Buffer,metadata:any;
   let saved:Buffer|undefined;try{saved=await readFile(rawPath);}catch{}
   if(saved){raw=saved;try{metadata=JSON.parse(await readFile(metaPath,'utf8'));}catch{throw new Error('Purchased raw audio exists without provenance; recover its record before retrying, never repurchase automatically');}spent+=metadata.budgetReservationCredits||metadata.billedCredits||estimated;}else{
    const before=await balance();
    if(before<80000+estimated||spent+estimated>20000){console.log(JSON.stringify({budgetStop:true,remaining:before,reservedForNews:80000,spent}));break;}
    if(await prisma.radioAsset.count({where:{kind:{in:['music','music-candidate']}}})>=24)break;
    const prompt=`Original complete four-minute instrumental lounge track for a welcoming car showroom. Closely related to refined lounge jazz, ambient jazz and smooth jazz. ${style} Positive, sunny, polished, unobtrusive, comfortable and quietly confident. Small tasteful changes in harmony, voicing and instrumentation throughout four minutes, a gentle middle variation, natural musical development and a clean relaxed ending. Consistent background listening volume. No singing, no spoken words, no vocal chops, no dramatic drops, no aggressive drums, no melancholy, no loud peaks or virtuoso solos.`;
    const model=process.env.ELEVENLABS_MUSIC_MODEL||'music_v2';
    const r=await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128',{method:'POST',headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY!,'Content-Type':'application/json'},body:JSON.stringify({prompt,music_length_ms:240000,model_id:model,force_instrumental:true}),signal:AbortSignal.timeout(360000)});
    if(!r.ok){let error:unknown;try{error=await r.json();}catch{}throw elevenLabsError(r.status,error);}
    if(!r.headers.get('content-type')?.includes('audio/'))throw new Error('Music provider returned no audio');
    raw=Buffer.from(await r.arrayBuffer());await writeFile(rawPath,raw);
    const after=await balance(),headerCost=Number(r.headers.get('character-cost'));
    const accountCreditDelta=Math.max(0,before-after),billedCredits=headerCost>0?headerCost:null;
    const budgetReservationCredits=Math.max(4000,billedCredits??accountCreditDelta);
    metadata={prompt,model,billedCredits,accountCreditDelta,budgetReservationCredits,costBasis:billedCredits!==null?'provider-response-header':'individual-cost-unknown; account counter may settle several purchases together',balanceBefore:before,balanceAfter:after,generatedAt:new Date().toISOString(),requestedSeconds:240,generated:true,forceInstrumental:true};
    await writeFile(metaPath,JSON.stringify(metadata,null,2));spent+=budgetReservationCredits;estimated=Math.max(4000,budgetReservationCredits);
   }
   const dir=await mkdtemp(join(tmpdir(),'ahd-music-expansion-'));
   try{
    const input=join(dir,'original.mp3');await writeFile(input,raw);
    const length=Number(await command(process.env.FFPROBE_PATH||'ffprobe',['-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',input]));
    if(length<210||length>245)throw new Error('Generated music did not meet the requested four-minute duration');
    const audio=await normalizeAudio(raw,250);
    asset=await prisma.radioAsset.create({data:{key,kind:'music-candidate',title,...audio,metadata}});
   }finally{await rm(dir,{recursive:true,force:true});}
  }
  const full=join(directory,`track-${index}.mp3`);await writeFile(full,asset.audio);
  const middle=Math.floor(asset.duration/2),last=Math.max(0,asset.duration-12);
  await command(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-nostdin','-i',full,'-filter_complex',`[0:a]asplit=3[a][b][c];[a]atrim=start=5:duration=7,asetpts=PTS-STARTPTS[x];[b]atrim=start=${middle}:duration=7,asetpts=PTS-STARTPTS[y];[c]atrim=start=${last}:duration=7,asetpts=PTS-STARTPTS[z];[x][y][z]concat=n=3:v=0:a=1[out]`,'-map','[out]','-c:a','libmp3lame','-b:a','128k','-y',join(directory,`review-${index}.mp3`)]);
  console.log(JSON.stringify({id:asset.id,title:asset.title,duration:asset.duration,kind:asset.kind,billedCredits:(asset.metadata as any)?.billedCredits}));
 }
 console.log(JSON.stringify({spent,reservedForNews:80000}));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Music expansion failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
