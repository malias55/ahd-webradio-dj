// Real audio in two isolated browser sessions. Uses an isolated HTTP fixture,
// the production SSE implementation and no database/provider/live-station calls.
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const {execFileSync}=require('node:child_process'),ts=require('typescript');
const {chromium}=require('playwright');
const {streamSpeakerVolume,publishZoneVolume}=require('../dist/src/lib/speaker-volume-events');
const player=ts.transpileModule(fs.readFileSync('src/lib/speakerMode.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const audio=execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=30','-c:a','libmp3lame','-b:a','128k','-f','mp3','pipe:1']);
let volume=80,reads=0,statusFails=false,browser;
const server=http.createServer((req,res)=>{
 if(req.url==='/speaker-sync'||req.url==='/speaker-sync-player')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(ts.transpileModule(fs.readFileSync('src/lib'+req.url+'.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText);
 if(req.url==='/player.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(player);
 if(req.url==='/api/zones/test/volume-events'){void streamSpeakerVolume(res,'test',async()=>{reads++;return volume});return;}
 if(req.url==='/api/zones/test/current-source'){
  if(statusFails)return res.writeHead(503).end();
  // A stale HTTP volume must never undo the latest live update.
  return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({url:'/audio.mp3',volume:80}));
 }
 if(req.url==='/volume'&&req.method==='POST'){let body='';req.on('data',b=>body+=b);req.on('end',()=>{volume=JSON.parse(body).volume;publishZoneVolume('test',volume);res.end('ok')});return;}
 if(req.url==='/audio.mp3')return res.writeHead(200,{'Content-Type':'audio/mpeg'}).end(audio);
 res.writeHead(200,{'Content-Type':'text/html'}).end(`<!doctype html><button id="start">Start</button><script type="module">
 const NativeAudio=window.Audio,NativeContext=window.AudioContext;window.metrics={elements:0,loads:0,pauses:0};
 window.Audio=function(){const el=new NativeAudio();window.audio=el;window.metrics.elements++;if(location.search==='?ignore-volume')Object.defineProperty(el,'volume',{get:()=>1,set:()=>{}});const load=el.load.bind(el);el.load=()=>{window.metrics.loads++;load()};el.addEventListener('pause',()=>window.metrics.pauses++);return el};
 const createElement=document.createElement.bind(document);document.createElement=function(name,...args){const el=createElement(name,...args);if(name==='audio'&&location.search==='?ignore-volume')Object.defineProperty(el,'volume',{get:()=>1,set:()=>{}});return el};
 window.AudioContext=class extends NativeContext{createGain(){const node=super.createGain();window.gain=node;window.analyser=this.createAnalyser();node.connect(window.analyser);return node}};
 window.rms=()=>{const samples=new Float32Array(window.analyser.fftSize);window.analyser.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((s,v)=>s+v*v,0)/samples.length)};
 window.player=await import('/player.js');document.querySelector('#start').onclick=()=>window.player.startSpeakerMode('test');</script>`);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});
 for(const ignoreVolume of [false,true]){
  volume=80;statusFails=false;
  const receiverContext=await browser.newContext(),senderContext=await browser.newContext();
  const receiver=await receiverContext.newPage(),sender=await senderContext.newPage();
  await receiver.goto(url+(ignoreVolume?'/?ignore-volume':'/'));await receiver.waitForFunction(()=>window.player);await receiver.click('#start');
  await receiver.waitForFunction(()=>window.audio?.currentTime>0.5&&(!window.gain||window.rms()>0));
  assert.equal(await receiver.evaluate(()=>!!window.gain),ignoreVolume,'Web Audio is only used when native volume is unavailable');
  const baseline=await receiver.evaluate(()=>window.gain?window.rms():window.audio.volume);await sender.goto(url);
  statusFails=true;const started=Date.now();
  await sender.evaluate(()=>fetch('/volume',{method:'POST',body:JSON.stringify({volume:25})}));
  await receiver.waitForFunction(()=>(window.gain?window.gain.gain.value:window.audio.volume)===.25&&window.player.activeSpeakerVolume()===25);
  const latency=Date.now()-started;await receiver.waitForTimeout(120);
  const quiet=await receiver.evaluate(()=>window.gain?window.rms():window.audio.volume);assert.ok(Math.abs(quiet/baseline-.25/.8)<.03,'output level follows the remote setting');
  await sender.evaluate(()=>fetch('/volume',{method:'POST',body:JSON.stringify({volume:0})}));
  await receiver.waitForFunction(()=>(window.gain?window.gain.gain.value:window.audio.volume)===0);await receiver.waitForTimeout(100);assert.equal(await receiver.evaluate(()=>window.gain?window.rms():window.audio.volume),0);
  statusFails=false;await receiver.waitForTimeout(2200);assert.equal(await receiver.evaluate(()=>window.gain?window.gain.gain.value:window.audio.volume),0,'stale status does not unmute');
  await sender.evaluate(()=>fetch('/volume',{method:'POST',body:JSON.stringify({volume:100})}));
  await receiver.waitForFunction(()=>(window.gain?window.gain.gain.value:window.audio.volume)===1);await receiver.waitForTimeout(100);
  assert.ok((await receiver.evaluate(()=>window.gain?window.rms():window.audio.volume))>baseline,'remote unmute restores the audible level');
  const metrics=await receiver.evaluate(()=>window.metrics);assert.deepEqual(metrics,{elements:1,loads:0,pauses:0});
  await receiver.evaluate(()=>window.player.stopSpeakerMode());const stoppedReads=reads;await receiver.waitForTimeout(1200);assert.equal(reads,stoppedReads,'stop closes the server subscription');
  console.log(JSON.stringify({passed:true,ignoreMediaElementVolume:ignoreVolume,remoteUpdateMs:latency,measuredOutputRatio:quiet/baseline,metrics}));
  await receiverContext.close();await senderContext.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await browser?.close();server.closeAllConnections();server.close()});
