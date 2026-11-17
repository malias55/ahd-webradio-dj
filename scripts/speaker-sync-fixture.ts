// Local-only browser fixture: two real players, shared clock, fault controls.
import { createServer, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';
import { SpeakerStream, Mp3Frames } from '../src/lib/speaker-stream';
const compile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const player=compile('src/lib/speakerMode.ts'),sync=compile('src/lib/speaker-sync.ts');
const frames=new Mp3Frames().push(execFileSync('ffmpeg',['-v','error','-f','lavfi','-i','sine=frequency=440:sample_rate=44100:duration=10','-ac','2','-c:a','libmp3lame','-b:a','320k','-id3v2_version','0','-write_xing','0','-f','mp3','pipe:1']));
const silence=new Mp3Frames().push(readFileSync('public/audio/speaker-silence.mp3'));
let phase='music', stallUntil=0,requests=0;
const responses=new Set<ServerResponse>();
const stream=new SpeakerStream(async()=>[phase],silence,()=>{},(_urls,data)=>{
 let i=0;const timer=setInterval(()=>{if(Date.now()>stallUntil)data(frames[i++%frames.length]);},26.122);
 return()=>clearInterval(timer);
});
const server=createServer((req,res)=>{
 const url=new URL(req.url||'/','http://localhost');
 if(url.pathname.startsWith('/player-')){res.writeHead(200,{'Content-Type':'text/javascript'}).end(player);return;}
 if(url.pathname==='/speaker-sync'){res.writeHead(200,{'Content-Type':'text/javascript'}).end(sync);return;}
 if(url.pathname.endsWith('/volume-events')){res.writeHead(204).end();return;}
 if(url.pathname.endsWith('/current-source')){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({speakerUrl:'/api/zones/test/speaker-stream',speakerClock:stream.clock(url.searchParams.get('listener')||''),speakerStatus:stream.status(),volume:15}));return;}
 if(url.pathname.endsWith('/speaker-stream')){
  requests++;responses.add(res);res.once('close',()=>responses.delete(res));res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'no-store'});res.flushHeaders();stream.attach(res,url.searchParams.get('listener')||undefined);return;
 }
 if(url.pathname==='/fault'&&req.method==='POST'){
  if(url.searchParams.get('kind')==='network')for(const client of responses)client.destroy();
  if(url.searchParams.get('kind')==='upstream')stallUntil=Date.now()+14000;
  if(url.searchParams.get('kind')==='news')phase=phase==='music'?'news':'music';
  res.end('ok');return;
 }
 if(url.pathname==='/stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({requests,...stream.diagnostics()}));return;}
 res.setHeader('Content-Type','text/html');res.end(`<!doctype html><meta charset="utf-8"><title>Speaker synchronization regression</title>
 <h1>Zwei echte Lautsprecher-Player</h1><button id="start">Beide Player starten</button>
 <button id="lag">Player B 500 ms verzögern</button><button id="drop">Verbindung unterbrechen</button>
 <button id="stall">Quelle 14 Sekunden anhalten</button><button id="news">Nachrichtenwechsel</button><button id="hide">Pagehide simulieren</button><button id="stop">Beide stoppen</button><pre id="metrics">Bereit</pre>
 <script type="module">
 const audios=[];const NativeAudio=window.Audio;
 window.Audio=function(){const el=new NativeAudio();audios.push(el);return el;};
 const a=await import('/player-a.js'),b=await import('/player-b.js');a.attachSpeakerLifecycle(window);b.attachSpeakerLifecycle(window);
 document.querySelector('#start').onclick=()=>{a.resumeSpeakerPlayback();b.resumeSpeakerPlayback();return Promise.all([a.startSpeakerMode('test'),b.startSpeakerMode('test')]);};
 document.querySelector('#lag').onclick=()=>{const el=audios[1];el.pause();setTimeout(()=>el.play(),500);};
 const fault=kind=>fetch('/fault?kind='+kind,{method:'POST'});
 document.querySelector('#drop').onclick=()=>fault('network');document.querySelector('#stall').onclick=()=>fault('upstream');document.querySelector('#news').onclick=()=>fault('news');
 document.querySelector('#hide').onclick=()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true}));
 document.querySelector('#stop').onclick=()=>{a.stopSpeakerMode();b.stopSpeakerMode();};
 const history=[];
 setInterval(async()=>{
  const values=await Promise.all(audios.map(async(el)=>{
   if(!el.src)return {paused:el.paused};
   const listener=new URL(el.src).searchParams.get('listener');
   const started=performance.now();const state=await(await fetch('/api/zones/test/current-source?listener='+listener)).json();
   return {time:el.currentTime,delay:state.speakerClock?state.speakerClock.mediaSeconds+(performance.now()-started)/2000-el.currentTime:null,rate:el.playbackRate,paused:el.paused,ready:el.readyState,error:el.error?.message};
  }));
  const difference=values.length===2&&values.every(v=>v.delay!==null)?Math.abs(values[0].delay-values[1].delay):null;
  const row={at:Math.round(performance.now()/1000),players:values,difference,stats:await(await fetch('/stats')).json()};history.push(row);if(history.length>10)history.shift();document.querySelector('#metrics').textContent=JSON.stringify(history,null,2);
 },1000);
 </script>`);
});
server.listen(3186,'127.0.0.1',()=>console.log('http://127.0.0.1:3186'));
function stop(){stream.close();server.closeAllConnections();server.close();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
