const assert = require('node:assert/strict');
const http = require('node:http');
const {spawn,spawnSync} = require('node:child_process');
const {readFileSync,mkdtempSync,rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const {PrismaClient} = require('@prisma/client');
const {io} = require('socket.io-client');
const db = new PrismaClient();
const port = 3195, authPort = 3196, origin = `http://127.0.0.1:${port}`;
const cookie = '__Secure-better-auth.session_token=e2e-only';
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let zone,server,broadcaster,device;
const dir=mkdtempSync(join(tmpdir(),'ahd-e2e-'));
const auth=http.createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 res.end(req.headers.cookie===cookie?JSON.stringify({user:{email:'mali@autohaus-doerrschuck.de',emailVerified:true},session:{expiresAt:new Date(Date.now()+60000).toISOString()}}):'null');
});
async function receive(url,milliseconds=2000){
 const r=await fetch(url);assert.equal(r.status,200);assert.equal(r.headers.get('content-type'),'audio/mpeg');
 const reader=r.body.getReader();let bytes=0;
 const timer=setTimeout(()=>reader.cancel(),milliseconds);
 try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;}}finally{clearTimeout(timer);await reader.cancel().catch(()=>{});}
 assert.ok(bytes>1000,`expected audio bytes, received ${bytes}`);return bytes;
}
async function connect(namespace,opts={}){
 const s=io(`${origin}${namespace}`,{path:'/ws',transports:['websocket'],reconnection:false,forceNew:true,...opts});
 await new Promise((resolve,reject)=>{s.once('connect',resolve);s.once('connect_error',reject)});return s;
}
async function main(){
 await new Promise(r=>auth.listen(authPort,'127.0.0.1',r));
 zone=await db.zone.create({data:{name:`Radio E2E ${Date.now()}`,defaultSource:'radio',volume:35}});
 server=spawn(process.execPath,['dist/server.js'],{env:{...process.env,NODE_ENV:'production',PORT:String(port),RADIO_PUBLIC_URL:origin,AUTH_URL:`http://127.0.0.1:${authPort}`,ELEVENLABS_API_KEY:'',EDENAI_API_KEY:''},stdio:['ignore','pipe','pipe']});
 let logs='';server.stdout.on('data',b=>{logs+=b});server.stderr.on('data',b=>{logs+=b});
 for(let i=0;i<60;i++){try{if((await fetch(`${origin}/api/health`)).ok)break;}catch{}await sleep(300);if(i===59)throw new Error('server failed: '+logs.slice(-2000));}
 assert.equal((await fetch(`${origin}/api/zones`)).status,401,'anonymous zones must be protected');
 assert.equal((await fetch(`${origin}/api/radio`,{headers:{cookie:'logto_any=forged'}})).status,401);
 assert.equal((await fetch(`${origin}/api/radio`,{headers:{cookie:'__Secure-better-auth.session_token=forged'}})).status,401);
 assert.equal((await fetch(`${origin}/api/radio`,{method:'POST',headers:{cookie,Origin:'https://untrusted.invalid','Content-Type':'application/json'},body:JSON.stringify({action:'music'})})).status,403);
 assert.equal((await fetch(`${origin}/api/radio`,{method:'POST',headers:{cookie,Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({action:'music'})})).status,409);
 const radio=await fetch(`${origin}/api/radio`,{headers:{cookie}}).then(r=>r.json());assert.ok(radio.assets.filter(a=>a.kind==='music').length>=3);
 const source=await fetch(`${origin}/api/zones/${zone.id}/current-source`,{headers:{cookie}}).then(r=>r.json());assert.equal(source.url,`${origin}/api/radio/stream`);
 console.log('PASS central SSO, forged-cookie rejection, source resolution, saved music');
 console.log('Radio stream bytes:',await receive(`${origin}/api/radio/stream`));
 broadcaster=await connect('/broadcast',{extraHeaders:{Cookie:cookie}});
 const commands=[];
 const serial=`E2E-${Date.now()}`;
 device=await connect('',{extraHeaders:{Authorization:`Bearer ${process.env.DEVICE_API_KEY}`,'X-Device-Serial':serial,'X-Device-Hostname':'test-only'}});
 for(let i=0;i<30;i++){if(await db.device.findUnique({where:{serial}}))break;await sleep(100);}
 await db.device.update({where:{serial},data:{zoneId:zone.id}});
 // Reconnect once to join the assigned zone via the real configuration flow.
 device.close();await sleep(200);
 device=await connect('',{extraHeaders:{Authorization:`Bearer ${process.env.DEVICE_API_KEY}`,'X-Device-Serial':serial,'X-Device-Hostname':'test-only'}});
 device.on('command',c=>commands.push(c));
 await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('Pi config timeout')),10000);device.once('config',()=>{clearTimeout(t);resolve()})});
 const tone=join(dir,'tone.webm');
 assert.equal(spawnSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:duration=6','-c:a','libopus','-y',tone]).status,0);
 broadcaster.emit('broadcast:start',{zoneId:zone.id,mode:'announce',mime:'audio/webm;codecs=opus'});
 for(let i=0;i<100&&!commands.some(c=>c.type==='announce-start');i++)await sleep(100);
 const start=commands.find(c=>c.type==='announce-start');assert.ok(start,'Pi receives announcement overlay');
 const announcement=receive(start.url,2500);
 const musicDuring=receive(`${origin}/api/radio/stream`,2500);
 const bytes=readFileSync(tone);
 for(let i=0;i<bytes.length;i+=2048){broadcaster.emit('broadcast:chunk',{zoneId:zone.id,chunk:bytes.subarray(i,i+2048)});await sleep(50);}
 console.log('Announcement and background bytes:',await Promise.all([announcement,musicDuring]));
 broadcaster.emit('broadcast:stop',{zoneId:zone.id});for(let i=0;i<100&&!commands.some(c=>c.type==='announce-stop');i++)await sleep(100);
 assert.ok(commands.some(c=>c.type==='announce-stop'),'Pi unducks after announcement');
 const restored=await fetch(`${origin}/api/zones/${zone.id}/current-source`,{headers:{cookie}}).then(r=>r.json());assert.equal(restored.url,`${origin}/api/radio/stream`);
 console.log('PASS real FFmpeg announcement, concurrent music, Pi overlay commands and return to radio');
 await db.device.deleteMany({where:{serial}});
}
main().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{
 broadcaster?.close();device?.close();server?.kill('SIGTERM');auth.close();
 if(zone){await db.device.deleteMany({where:{hostname:'test-only'}});await db.zone.delete({where:{id:zone.id}});}
 await db.$disconnect();rmSync(dir,{recursive:true,force:true});
});
