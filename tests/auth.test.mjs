// Tests of access from outside the machine (dashboard/auth.mjs + server.mjs): local open; through a proxy or
// another Host only with a token (cookie from /login or Bearer); without a token, outside is refused.
//   node tests/auth.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { ensureToken, loadToken } from '../dashboard/auth.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-auth-'));
const proj = path.join(tmp, 'proj');
fs.mkdirSync(proj);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// --- token ---------------------------------------------------------------------
process.env.AI_TEAM_TOKEN_FILE = path.join(tmp, 'cfg', 'token');
delete process.env.AI_TEAM_TOKEN;
assert.equal(loadToken(), null);
const a = ensureToken();
assert.ok(a.created && a.token.length >= 30);
assert.equal((fs.statSync(process.env.AI_TEAM_TOKEN_FILE).mode & 0o777), 0o600, 'owner-only file');
assert.deepEqual(ensureToken(), { token: a.token, created: false });

// raw http: fetch does not allow changing Host
function req(port, { method = 'GET', p = '/', headers = {}, body } = {}) {
  return new Promise((res, rej) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, (x) => { let b = ''; x.on('data', (d) => { b += d; }); x.on('end', () => res({ status: x.statusCode, headers: x.headers, body: b })); });
    r.on('error', rej); if (body) r.write(body); r.end();
  });
}
async function serve(port, env) {
  const s = spawn(process.execPath, [path.join(here, '..', 'dashboard', 'server.mjs'), '--project', proj, '--claude-dir', path.join(tmp, 'claude'), '--port', String(port)],
    { env: { ...process.env, ...env }, stdio: 'ignore' });
  for (let i = 0; i < 80; i++) { try { await req(port, { p: '/favicon.ico' }); return s; } catch { await wait(100); } }
  throw new Error('server did not start');
}
const TOKEN = 'test-token-1234567890';
const remote = { host: 'mac.tail1234.ts.net', 'x-forwarded-for': '100.64.0.5', 'x-forwarded-proto': 'https', 'x-forwarded-host': 'mac.tail1234.ts.net' };

// --- with token -------------------------------------------------------------------
{
  const port = 43301, s = await serve(port, { AI_TEAM_TOKEN: TOKEN });
  assert.equal((await req(port, { p: '/api/state', headers: { host: `127.0.0.1:${port}` } })).status, 200, 'local: open');
  assert.equal((await req(port, { p: '/api/state', headers: { host: `localhost:${port}` } })).status, 200);
  assert.equal((await req(port, { p: '/api/state', headers: remote })).status, 401, 'through a proxy without login: 401');
  assert.equal((await req(port, { p: '/api/state', headers: { host: `127.0.0.1:${port}`, 'x-forwarded-for': '1.2.3.4' } })).status, 401, 'X-Forwarded-For is not local');
  assert.equal((await req(port, { p: '/api/state', headers: { host: 'evil.example' } })).status, 401, 'another Host (DNS rebinding) is not local');
  const html = await req(port, { p: '/', headers: { ...remote, accept: 'text/html' } });
  assert.equal(html.status, 303); assert.equal(html.headers.location, '/login?next=%2F');
  const lp = await req(port, { p: '/login', headers: remote });
  assert.equal(lp.status, 200); assert.match(lp.body, /type="password"/);
  const form = { 'content-type': 'application/x-www-form-urlencoded' };
  const bad = await req(port, { method: 'POST', p: '/login', headers: { ...remote, ...form }, body: 'token=wrong' });
  assert.equal(bad.status, 401); assert.equal(bad.headers['set-cookie'], undefined);
  const ok = await req(port, { method: 'POST', p: '/login', headers: { ...remote, ...form }, body: `token=${TOKEN}&next=%2Fteam` });
  assert.equal(ok.status, 303); assert.equal(ok.headers.location, '/team');
  const ck = ok.headers['set-cookie'][0];
  assert.match(ck, /HttpOnly/); assert.match(ck, /SameSite=Strict/); assert.match(ck, /Secure/, 'https through the proxy: Secure');
  assert.ok(!ck.includes(TOKEN), 'the cookie does not carry the token');
  const cookie = ck.split(';')[0];
  assert.equal((await req(port, { p: '/api/state', headers: { ...remote, cookie } })).status, 200, 'with cookie: gets in');
  assert.equal((await req(port, { p: '/api/state', headers: { ...remote, cookie: 'ai_team_session=x' } })).status, 401);
  assert.equal((await req(port, { p: '/api/state', headers: { ...remote, authorization: `Bearer ${TOKEN}` } })).status, 200, 'Bearer: gets in');
  const evil = await req(port, { method: 'POST', p: '/login', headers: { ...remote, ...form }, body: `token=${TOKEN}&next=%2F%2Fevil.example` });
  assert.equal(evil.headers.location, './', 'next to another site is ignored');
  // POST /api/answer behind the proxy: Origin = original host (X-Forwarded-Host)
  const ans = (o) => req(port, { method: 'POST', p: '/api/answer', headers: { ...remote, cookie, 'content-type': 'application/json', origin: o }, body: JSON.stringify({ id: 'notexists1', behavior: 'allow' }) });
  assert.equal((await ans('https://mac.tail1234.ts.net')).status, 409, 'proxy origin accepted (pending item does not exist: 409)');
  assert.equal((await ans('https://evil.example')).status, 403);
  s.kill();
}

// --- without token: outside refused ---------------------------------------------------
{
  fs.rmSync(process.env.AI_TEAM_TOKEN_FILE);
  const port = 43302, s = await serve(port, {});
  assert.equal((await req(port, { p: '/api/state', headers: { host: `127.0.0.1:${port}` } })).status, 200, 'local stays open');
  assert.equal((await req(port, { p: '/api/state', headers: remote })).status, 403);
  assert.equal((await req(port, { p: '/login', headers: remote })).status, 403);
  s.kill();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ outside access ok');
