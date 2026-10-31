// Read-only regression check against the production Next build, with an isolated
// local auth authority. No live account sessions, provider calls or DB writes.
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient();
const origin = 'http://127.0.0.1:3197', cookie = '__Secure-better-auth.session_token=archive-e2e-local-only';
let server, logs = '';
const auth = http.createServer((req, res) => {
 res.setHeader('content-type', 'application/json');
 res.end(req.headers.cookie === cookie ? JSON.stringify({ user: { email: 'mali@autohaus-doerrschuck.de', emailVerified: true }, session: { expiresAt: new Date(Date.now()+60000).toISOString() } }) : 'null');
});
async function main() {
 assert.ok(await db.user.findFirst({ where: { email: { equals: 'mali@autohaus-doerrschuck.de', mode: 'insensitive' } } }), 'existing authorized test identity required');
 assert.ok(await db.radioJob.findFirst({ where: { key: { startsWith: 'news' }, status: 'failed', updatedAt: { gte: new Date(Date.now()-48*3600_000) } } }), 'real failure fixture required to exercise the previously crashing branch');
 await new Promise(resolve => auth.listen(3198, '127.0.0.1', resolve));
 server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3197', '-H', '127.0.0.1'], { env: { ...process.env, NODE_ENV: 'production', SKIP_AUTH: 'false', AUTH_URL: 'http://127.0.0.1:3198', RADIO_PUBLIC_URL: origin, ELEVENLABS_API_KEY: '', EDENAI_API_KEY: '', OPENAI_API_KEY: '' }, stdio: ['ignore','pipe','pipe'] });
 server.stdout.on('data', b => { logs += b; }); server.stderr.on('data', b => { logs += b; });
 let ready = false;
 for (let i=0; i<80; i++) { try { if ((await fetch(origin+'/api/health')).ok) { ready=true; break; } } catch {} await new Promise(r=>setTimeout(r,250)); }
 assert.ok(ready, logs.slice(-1500));
 assert.equal((await fetch(origin+'/nachrichten', { redirect: 'manual' })).status, 307);
 const response = await fetch(origin+'/nachrichten', { headers: { cookie } }), html = await response.text();
 assert.equal(response.status, 200); assert.match(html, /Die Erstellung/); assert.match(html, /ist fehlgeschlagen/); assert.match(html, /Transkript und Quellen/);
 assert.doesNotMatch(html, /991158272|This page couldn.t load/); assert.doesNotMatch(logs, /Attempted to call time|Error:/);
 const manifest = await fetch(origin+'/manifest.json', { redirect: 'manual' }); assert.equal(manifest.status, 200); assert.equal((await manifest.json()).name, 'AHD Radio DJ');
 const sw = await fetch(origin+'/sw.js', { redirect: 'manual' }); assert.equal(sw.status, 200); assert.match(await sw.text(), /addEventListener/);
 console.log('PASS authenticated production archive including failure notice and audio history; anonymous redirect; public JSON manifest and service worker; zero provider calls or database writes');
}
main().catch(e => { console.error(e); process.exitCode=1; }).finally(async () => { server?.kill('SIGTERM'); auth.close(); await db.$disconnect(); });
