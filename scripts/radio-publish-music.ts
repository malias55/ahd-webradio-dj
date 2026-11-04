import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '../src/lib/prisma';
async function main(){
 const directory='artifacts/daily-schedule-20261104/music',published=[];
 for(const path of process.argv.slice(2)){
  const review=JSON.parse(await readFile(path,'utf8'));
  if(typeof review.model!=='string'||!review.model.startsWith('gpt-audio-'))throw new Error('Audio-capable review required');
  const data=JSON.parse(String(review.review).replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
  for(const assessment of data.tracks||[]){
   const match=String(assessment.file).match(/^review-(\d+)\.mp3$/);if(!match)continue;
   const index=Number(match[1]);if(index>5)throw new Error('Unexpected candidate index');
   const key=`music:showroom-expansion-20261104:${index}`,a=await prisma.radioAsset.findUniqueOrThrow({where:{key}});
   if(!['music-candidate','music'].includes(a.kind)||a.duration<210||a.duration>245)throw new Error('Invalid four-minute music candidate');
   if(assessment.vocals!==false||assessment.suitable!==true||assessment.harshness_1_to_5>3){console.log(JSON.stringify({rejected:a.id,assessment}));continue;}
   const metadata=a.metadata as any;
   // Subscription counters can settle several purchases together. Preserve the
   // observed account delta without presenting it as a per-track provider bill.
   if(!metadata.costBasis){metadata.accountCreditDelta=Math.max(0,metadata.balanceBefore-metadata.balanceAfter);metadata.billedCredits=null;metadata.budgetReservationCredits=4000;metadata.costBasis='Individual provider cost unavailable; account-credit delta may include delayed purchases';}
   metadata.audioReview={model:review.model,scope:'Three seven-second excerpts from beginning, middle and ending, compared with the existing music reference',reviewedAt:new Date().toISOString(),humanListeningCheck:false,assessment};
   await prisma.radioAsset.update({where:{id:a.id},data:{kind:'music',metadata}});
   const generation=join(directory,`generation-${index}.json`);const old=JSON.parse(await readFile(generation,'utf8'));await writeFile(generation,JSON.stringify({...old,billedCredits:null,accountCreditDelta:metadata.accountCreditDelta,budgetReservationCredits:4000,costBasis:metadata.costBasis},null,2));
   published.push({id:a.id,title:a.title,duration:a.duration});
  }
 }
 const total=await prisma.radioAsset.aggregate({where:{kind:'music'},_count:true,_sum:{duration:true}});
 const r=await fetch('https://api.elevenlabs.io/v1/user/subscription',{headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY!}});const s=await r.json()as any;
 const first=JSON.parse(await readFile(join(directory,'generation-0.json'),'utf8')),remaining=s.character_limit-s.character_count;
 const report={published,totalTracks:total._count,totalMinutes:(total._sum.duration||0)/60,remainingNewsCredits:remaining,musicBatchObservedCreditDelta:first.balanceBefore-remaining};
 await writeFile(join(directory,'publication.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Music publication failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
