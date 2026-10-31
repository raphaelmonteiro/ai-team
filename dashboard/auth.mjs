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
const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

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

const page = (msg, err) => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ai-team · sign in</title>
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
        const next = /^\/(?!\/)[^\s]*$/.test(f.get('next') || '') ? f.get('next') : './';
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
