import { prisma } from '../src/lib/prisma';
import { dueNewsEditions } from '../src/lib/radio/config';
import { prepareNews, bulletinKey } from '../src/lib/radio/news';
async function main(){
 const plans=dueNewsEditions().sort((a,b)=>a.language==='de'?-1:b.language==='de'?1:0);
 let failed=false;
 for(const plan of plans){
  try {
  console.log(JSON.stringify({preparing:plan.language,edition:plan.firstBroadcast.toISOString(),startedAt:new Date().toISOString()}));
  await prepareNews(plan.firstBroadcast);
  const a=await prisma.radioAsset.findUnique({where:{key:bulletinKey(plan.firstBroadcast)},select:{id:true,title:true,duration:true,slot:true,metadata:true}});
  console.log(JSON.stringify(a?{ready:a.id,title:a.title,duration:a.duration,slot:a.slot,language:plan.language}:{language:plan.language,status:'Preparation already claimed by the running service'}));
  } catch(error) {failed=true;console.error(JSON.stringify({language:plan.language,error:error instanceof Error?error.message:'Preparation failed'}));}
 }
 if(failed)process.exitCode=1;
}
main().catch(e=>{console.error(e instanceof Error?e.message:'Preparation failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
