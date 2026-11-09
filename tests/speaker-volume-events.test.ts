import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type ServerResponse } from 'node:http';
import { handleSpeakerVolumeEvents, streamSpeakerVolume } from '../src/lib/speaker-volume-events';

test('volume event endpoint rejects unsigned requests and non-GET methods', async t => {
  const previous = process.env.SKIP_AUTH; process.env.SKIP_AUTH = 'false';
  const server = createServer((req,res) => { void handleSpeakerVolumeEvents(req,res,'test'); });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{ server.closeAllConnections(); await new Promise<void>(resolve=>server.close(()=>resolve())); if(previous===undefined)delete process.env.SKIP_AUTH;else process.env.SKIP_AUTH=previous; });
  const address=server.address() as {port:number};
  const url=`http://127.0.0.1:${address.port}/events`;
  assert.equal((await fetch(url)).status,401);
  assert.equal((await fetch(url,{method:'POST'})).status,405);
});

test('a missing zone ends before opening an event stream',async()=>{
  let status=0,ended=false;
  const response={destroyed:false,writeHead(code:number){status=code;return this;},end(){ended=true;}};
  await streamSpeakerVolume(response as unknown as ServerResponse,'missing',async()=>null);
  assert.equal(status,404);assert.equal(ended,true);
});
