#!/usr/bin/env node
// ai-team — access to the dashboard from outside the machine (Tailscale Serve, Cloudflare Tunnel, --host 0.0.0.0).
//
// Local request (connection from 127.0.0.1/::1, no X-Forwarded-For, Host localhost/127.0.0.1): open, as before.
// Any other (including one coming through a proxy on the same machine): only with the token, by cookie
// (after /login) or "Authorization: Bearer <token>". With no token configured, remote is refused.
//
// Token: AI_TEAM_TOKEN, otherwise ~/.config/ai-team/token (AI_TEAM_TOKEN_FILE changes the file).
//   node auth.mjs token      creates the token (if missing) and shows it
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const COOKIE = 'ai_team_session';
const MAX_AGE_S = 30 * 24 * 3600;
export const tokenFile = () => process.env.AI_TEAM_TOKEN_FILE || path.join(os.homedir(), '.config', 'ai-team', 'token');

export function loadToken() {
  if (process.env.AI_TEAM_TOKEN) return process.env.AI_TEAM_TOKEN.trim();
  try { const t = fs.readFileSync(tokenFile(), 'utf8').trim(); return t || null; } catch { return null; }
}
export function ensureToken() {
  const t = loadToken();
  if (t) return { token: t, created: false };
  const token = crypto.randomBytes(24).toString('base64url');
  fs.mkdirSync(path.dirname(tokenFile()), { recursive: true });
  fs.writeFileSync(tokenFile(), token + '\n', { mode: 0o600 });
  return { token, created: true };
}

// the cookie keeps an HMAC of the token, not the token
const sessionValue = (token) => crypto.createHmac('sha256', token).update('ai-team-session-v1').digest('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
// a malformed value (bad percent-encoding) counts as empty instead of throwing before the token check
const decode = (v) => { try { return decodeURIComponent(v); } catch { return ''; } };
const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decode(v.join('='))]));

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export function isLocal(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  return LOOPBACK.has(req.socket.remoteAddress) && !req.headers['x-forwarded-for'] && !req.headers.forwarded
    && ['localhost', '127.0.0.1', '::1'].includes(host);
}
export function authorized(req, token) {
  if (isLocal(req)) return true;
  if (!token) return false;
  const b = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (b && same(b[1].trim(), token)) return true;
  const c = cookies(req)[COOKIE];
  return !!c && same(c, sessionValue(token));
}
// behind an HTTPS proxy (Tailscale Serve, Cloudflare) the cookie goes with Secure
const isHttps = (req) => req.socket.encrypted || /^https$/i.test(String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim());

const page = (msg, err) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ai-team · sign in</title><link rel="icon" type="image/png" sizes="64x64" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAALVBMVEX///8FEAgFEQkFEgoKTCYMcDgPj0gUv2ASsFgHLxgUzWcZ/4AX7ncIPSAOfkD2UVFwAAAAAXRSTlMAQObYZgAAA1NJREFUWMONl4t2rCAMRTuaRMBw//9zb0J4iAZnWKvtjDUbOHnB318fn23bnQFIR8B4ebJtn7/ncI3FPJ1lcJ6fb7+Z7+Fsg+P+gliY76imBwHKOujx3+/2oOa5fkr7krCy33mYCYrigrDaPyTmtnMoOpCvg28eDzG3jUcMXJVEZwkLezOJffY6jifBX77ZB/2chivlJ8Ub4PMy/4m2AEYI1f7ujY8rodnLL5AvZCGgkYDl+RQQmwsoi5Y5uX5RTtSvtjOYAI59ib8U62rFplFxz2VpkwgOgEvoZwPEZgDFBXhfwt9iAaAGwQBVNiNxc84aEEzqChhZoGJQKvq8A9j89wDQCKf4Bohs/ntsAQcA3gDqKu6iFRGJQuJrQIc3ABYfZqA69emMtAJkmmbiCLCzA2AfENP9vf7rPsADxNurWg/qiokQMGhGpePUx+QBarIFCt2SJ81khQw7QvIBpW6I4CK5BoJ6nQNRGiW9yRqubhiAMG03c7MjxbZQ5BfAVHg49vIV+x5agh/+FvCqn0ZBm6b7HUeNc0UUp+ccNY1PSqcDkD7b1EYPcPUGswcYsZ7fAKHFwABMxZyWkXj1J/a2BrWOgvkSwhRHbklTAcJRW1k5IKC5ILVMye+AsolSPlgLkGxnn/vTl5JmWcFhRDPY1rllSPwGsJpALaWgizf61RdAaSAJpRBJbvX5tN/fXeICVgcrKxi8fwPkkVPhiojBozqAqS4lKv6PYNF97+6rUC4nkS4aj0IZHm87gFZB5gJbpof9F8BRZoK7NZNj7gI0jIjOuz3T/iNAJg92RKhHkhKPElD4K6DGMpqOqVQnYue4vAYcNeOS6a57ypZbMmYt/GSqJaAVr1LPL6rAN4CmbvmQ+hnhxHHyn85pLqB1kF69ekSlUlOmeuAd83rnAEm/XDW5AC75uL0DdOp/8uffHBMT4PMKOOztXENZukYOE+DjHral8FZAqnKSlbOqywXg3zekv48tmNMmwBBx8y8MfQuxOS2evfmnqTf7V54OsKMxtBU84mBbXLpmgJ5rwgSI0wIcQhcxn48hkQB3+wehR6ICwtV8Sun11RdbLqh2MaOem4Isi68l9e32DL39pOFzrHL65rfr/6gevQtE7j1luv7/B+HEWHM2FGdpAAAAAElFTkSuQmCC"><link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32' fill='none' stroke='%231aff80' stroke-linecap='round' stroke-linejoin='round'%3E%3Cstyle%3E.b{fill:%2306120a}.i{stroke:%2306120a}.l{fill:%231aff80;stroke:none}%3C/style%3E%3Cdefs%3E%3Cg id='h'%3E%3Ccircle class='b' r='7.5' stroke-width='1.5'/%3E%3Cellipse class='l' cx='3.9' cy='.2' rx='.9' ry='1.25'/%3E%3Cpath d='M2.1 3.3Q4.3 6.8 6.6 2.9Q4.4 3.9 2.1 3.3z' fill='%231aff80' stroke-width='.8'/%3E%3Cpath class='b' d='M-7.6 -1.4Q-8.2 1 -7.3 2.8L-4.8 1.2Q-4.4 -.6 -3.6 -1.9z' stroke-width='1.5'/%3E%3Cpath class='b' d='M3.6 -2.8l.7 1.6l.9 -1.5l.8 1.2l.6 -1.4' stroke-width='1.3'/%3E%3Cpath class='b' d='M-7.7 -1.4C-8.2 -11 6.4 -11.4 6.8 -2.8z' stroke-width='1.9'/%3E%3Cpath d='M-.6 -9.4Q3 -8 3.6 -2.9' stroke-width='1.3'/%3E%3Ccircle class='l' cx='-.7' cy='-9.5' r='.9'/%3E%3Cpath class='b' d='M-6.6 -1.6Q-11.2 -2 -11.6 .5L-7 .4z' stroke-width='1.7'/%3E%3Cpath d='M3.6 -2.9a1.6 1.4 0 0 1 2.8 -.3' stroke-width='1.5'/%3E%3Cpath d='M-2.3 -.6C-3.3 -6.4 -2 -9.6 .2 -9.5' stroke-width='4.6'/%3E%3Cpath class='i' d='M-2.3 -.6C-3.3 -6.4 -2 -9.6 .2 -9.5' stroke-width='1.9'/%3E%3Crect class='b' x='-4.9' y='-1.2' width='4.6' height='5.6' rx='2' stroke-width='1.7'/%3E%3C/g%3E%3Cg id='m'%3E%3Crect class='b' x='-.4' y='-3.4' width='3.6' height='4.2' rx='.7' stroke-width='1.5'/%3E%3Cpath d='M-.4 -2.4h-1v1.8h1' stroke-width='1.5'/%3E%3Crect class='l' x='-.4' y='-2.4' width='3.6' height='.9'/%3E%3C/g%3E%3Cg id='s'%3E%3Crect class='b' x='-1.6' y='-.6' width='4.9' height='2.6' rx='1.2' stroke-width='1.5'/%3E%3Cpath d='M-1.3 1.4h4.3' stroke-width='1.1'/%3E%3C/g%3E%3Cg id='t'%3E%3Cpath class='b' d='M-5.4 -9.4q-1.4 -1.6 1 -2.2h5' stroke-width='1.7'/%3E%3Crect class='b' x='-4.9' y='-9.6' width='10' height='11' rx='3.6' stroke-width='1.5'/%3E%3Cpath d='M-.6 -1.4v-2.2q0 -.8 .8 -.8h3.6' stroke-width='1.5'/%3E%3C/g%3E%3C/defs%3E%3CclipPath id='c'%3E%3Crect width='32' height='32' rx='7'/%3E%3C/clipPath%3E%3Crect width='32' height='32' rx='7' fill='%2306120a' stroke='none'/%3E%3Cg clip-path='url(%23c)'%3E%3Cg transform='translate(16.4 32.3) scale(1.1)'%3E%3Cuse href='%23t'/%3E%3Cg transform='translate(1.7 -17.4)'%3E%3Cuse href='%23h'/%3E%3Cpath d='M2.7 -2q1.3 -1 2.7 -.2' stroke-width='1.5'/%3E%3C/g%3E%3Cpath d='M.7 -7.4L1.7 -3.8L5.1 -3.7' stroke-width='4.8'/%3E%3Cpath class='i' d='M.7 -7.4L1.7 -3.8L5.1 -3.7' stroke-width='1.8'/%3E%3Ccircle class='b' cx='5.1' cy='-3.7' r='1.6' stroke-width='1.5'/%3E%3Cg transform='translate(5.1 -3.7)'%3E%3Cuse href='%23m'/%3E%3C/g%3E%3C/g%3E%3C/g%3E%3C/svg%3E">
<style>:root{--bg:#f6f7f9;--card:#fff;--ink:#1c1f24;--muted:#6b7280;--line:#e5e7eb;--accent:#2563eb;--bad:#dc2626}@media (prefers-color-scheme:dark){:root{--bg:#0f1115;--card:#171a21;--ink:#e5e7eb;--muted:#9ca3af;--line:#262b36;--accent:#60a5fa}}
body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,sans-serif;padding:16px;box-sizing:border-box}
form{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:22px;width:100%;max-width:360px}h1{font-size:18px;margin:0 0 6px}p{color:var(--muted);font-size:13px;margin:0 0 14px}
input{width:100%;box-sizing:border-box;padding:9px 10px;border-radius:8px;border:1px solid var(--line);background:var(--bg);color:var(--ink);font:inherit}button{margin-top:12px;width:100%;padding:9px;border-radius:8px;border:0;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer}.err{color:var(--bad)}</style>
<form method="post" action="login"><h1>ai-team · dashboard</h1><p class="${err ? 'err' : ''}">${msg}</p><input type="password" name="token" autocomplete="current-password" placeholder="token" autofocus required><input type="hidden" name="next" value=""><button>Sign in</button></form>
<script>document.querySelector('[name=next]').value=new URLSearchParams(location.search).get('next')||''</script></html>`;

// gatekeeper: true = go on to the routes; false = already answered (login, 401, 403)
export function gate(req, res, token) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.endsWith('/login') || url.pathname === '/login') {
    if (!token) { res.writeHead(403, { 'content-type': 'text/html; charset=utf-8' }); res.end(page('Access from outside the machine is off: create a token with <code>node .claude/dashboard/auth.mjs token</code> and restart the dashboard.', true)); return false; }
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (d) => { body += d; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        const f = new URLSearchParams(body);
        // only a local path: not //host and not /\host (browsers read a backslash as a slash)
        const next = /^\/(?![\/\\])[^\s]*$/.test(f.get('next') || '') ? f.get('next') : './';
        if (!same(String(f.get('token') || '').trim(), token)) {
          setTimeout(() => { res.writeHead(401, { 'content-type': 'text/html; charset=utf-8' }); res.end(page('Wrong token.', true)); }, 600);
          return;
        }
        res.writeHead(303, { location: next, 'set-cookie': `${COOKIE}=${sessionValue(token)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Strict${isHttps(req) ? '; Secure' : ''}` });
        res.end();
      });
      return false;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(page('Access from outside this machine. Paste the dashboard token.')); return false;
  }
  if (authorized(req, token)) return true;
  const wantsHtml = req.method === 'GET' && /text\/html/.test(req.headers.accept || '');
  if (!token) { res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' }); res.end('access from outside the machine is off: no token (node .claude/dashboard/auth.mjs token)'); return false; }
  if (wantsHtml) { res.writeHead(303, { location: `/login?next=${encodeURIComponent(url.pathname + url.search)}` }); res.end(); return false; }
  res.writeHead(401, { 'content-type': 'application/json; charset=utf-8' }); res.end('{"error":"login required"}'); return false;
}

// realpath: on macOS /var is a link to /private/var (import.meta.url is already resolved)
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] !== 'token') { console.error('usage: node auth.mjs token'); process.exit(2); }
  const { token, created } = ensureToken();
  console.log(`${created ? 'created' : 'already exists'}: ${process.env.AI_TEAM_TOKEN ? 'AI_TEAM_TOKEN' : tokenFile()}\ntoken: ${token}\nrestart the dashboard for it to take effect`);
}
