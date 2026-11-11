// Test the production Next build against isolated auth/DMS authorities and a
// database connection forced read-only. Never uses a real person's session.
const assert = require('node:assert/strict');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { PrismaClient } = require('@prisma/client');

const databaseUrl = new URL(process.env.PG_URL);
databaseUrl.searchParams.set('options', '-c default_transaction_read_only=on');
const pgUrl = databaseUrl.toString();
const db = new PrismaClient({ datasourceUrl: pgUrl });
const origin = 'http://127.0.0.1:3201';
const cookie = '__Secure-better-auth.session_token=isolated-radio-login-test';
const email = 'radio-login-test@dms.example.invalid';
let account = email, eligible = true, state = 'active', dmsAvailable = true;
let server, logs = '', authorityRequests = 0;
const authority = http.createServer((req, res) => {
  authorityRequests++;
  assert.equal(req.headers.cookie, cookie);
  res.setHeader('content-type', 'application/json');
  if (req.url === '/api/auth/get-session') {
    return res.end(JSON.stringify({ user: { email: account, name: 'DMS-Testbenutzer', emailVerified: true }, session: { expiresAt: new Date(Date.now() + 60_000).toISOString() } }));
  }
  if (req.url === '/api/session/status') {
    if (!dmsAvailable) return res.writeHead(503).end();
    return res.end(JSON.stringify({ authenticated: eligible, state }));
  }
  res.writeHead(404).end();
});

async function main() {
  assert.equal((await db.$queryRawUnsafe('SHOW transaction_read_only'))[0].transaction_read_only, 'on');
  assert.equal(await db.user.findFirst({ where: { email } }), null, 'new DMS identity must have no local radio record');
  const usersBefore = await db.user.count();
  await new Promise(resolve => authority.listen(3202, '127.0.0.1', resolve));
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-p', '3201', '-H', '127.0.0.1'], {
    env: { ...process.env, PG_URL: pgUrl, NODE_ENV: 'production', SKIP_AUTH: 'true', RADIO_ENABLED: 'false', RADIO_PUBLIC_URL: origin,
      AUTH_URL: 'http://127.0.0.1:3202', DMS_URL: 'http://127.0.0.1:3202', ELEVENLABS_API_KEY: '', EDENAI_API_KEY: '', OPENAI_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { logs += chunk; }); server.stderr.on('data', chunk => { logs += chunk; });
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, logs.slice(-1000));
  assert.equal((await fetch(origin + '/api/me')).status, 401, 'production must ignore SKIP_AUTH');
  assert.equal((await fetch(origin + '/control', { redirect: 'manual' })).status, 307);
  const headers = { cookie };
  const me = await fetch(origin + '/api/me', { headers });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { authorized: true, admin: false, email, name: 'DMS-Testbenutzer' });
  const control = await fetch(origin + '/control', { headers });
  assert.equal(control.status, 200); assert.match(await control.text(), /Steuerung/);
  assert.equal((await fetch(origin + '/api/zones', { headers })).status, 200);
  assert.equal((await fetch(origin + '/api/zones/unused-fixture-id', { method: 'PATCH', headers: { ...headers, Origin: origin, 'content-type': 'application/json' }, body: '{}' })).status, 403, 'new DMS users receive no radio admin rights');
  state = 'superseded';
  assert.equal((await fetch(origin + '/api/me', { headers })).status, 200, 'DMS host-only device guard does not seize or block radio');
  state = 'revoked';
  assert.equal((await fetch(origin + '/api/me', { headers })).status, 401);
  state = 'active'; eligible = false;
  assert.equal((await fetch(origin + '/api/me', { headers })).status, 401, 'deactivated or missing DMS user loses access');
  assert.equal((await fetch(origin + '/control', { headers, redirect: 'manual' })).status, 307);
  eligible = true; dmsAvailable = false;
  assert.equal((await fetch(origin + '/api/me', { headers })).status, 401, 'DMS outages fail closed');
  dmsAvailable = true; account = 'mali@autohaus-doerrschuck.de';
  const admin = await fetch(origin + '/api/me', { headers });
  assert.equal(admin.status, 200); assert.equal((await admin.json()).admin, true, 'existing radio admin preserved');
  assert.equal(await db.user.count(), usersBefore, 'no user synchronization or inserts');
  assert.equal(await db.user.findFirst({ where: { email } }), null);
  console.log(JSON.stringify({ passed: true, authorityRequests, databaseReadOnly: true, checks: ['new DMS user', 'control page', 'zones', 'no admin escalation', 'simultaneous DMS/radio', 'revocation', 'deactivation', 'DMS outage', 'existing admin', 'production bypass denied', 'no local account created'] }));
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (server) {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
  }
  authority.closeAllConnections(); authority.close();
  await db.$disconnect();
});
