// ai-team — dashboard server (no dependencies).
//
//   node dashboard/server.mjs [--project DIR] [--port 4321] [--host 127.0.0.1] [--claude-dir DIR] [--stale-min 15]
//   node dashboard/server.mjs --hub [FILE]         several projects, grouped by team (registry: hub.mjs)
//
// Project routes (at the root, or under /p/<id>/ in the hub):
//        /            dashboard (index.html)
//        /api/state   state as JSON (collect.mjs); `pending` = decisions waiting for an answer (ask.mjs).
//                     With clients on /events returns the last computed state (live.mjs: one computation per
//                     change); /api/answer and /api/away mark the state as changed
//        /api/answer  POST JSON { id, behavior: allow|deny, message?, answers? }: answers a decision
//        /notifications, /api/notify (GET/POST), /api/notify/test (POST)  ntfy config (notify.mjs)
//        /api/away    GET/POST { on }: away mode (ask.mjs, Stop hook)
//        /feed.mjs    pure logic of the drawer conversation (imported by index.html)
//        /team        team page, built in the browser from /api/team; the
//                     "change cycle" block comes from cycle.html (profile) or cycle-default.html
//        /api/team    agents from .claude/agents/*.md (frontmatter) + public keys of ai-team.conf
//        /changes/<id>/<file>.md  a change's .md (proposal, tasks, design, review-report, validation-report, specs/**; text/plain)
//        /agents/<name>.md  agent definition (the project's .claude/agents/<name>.md, text/plain)
//        /events      Server-Sent Events: "update" when a transcript or the
//                     project's openspec/ changes (fs.watch; fallback every 5 s)
// Access: local (127.0.0.1, no proxy) open; from outside (Tailscale Serve, tunnel, --host 0.0.0.0) only with the
// token (auth.mjs): /login sets the cookie; Bearer works too. Without a token, outside access is refused.
// Hub routes:
//        /, /t/<team>[/<project>]  tabs per team and per project (hub.html)
//        /api/hub     teams, projects and a cheap summary of each (without reading transcripts)
//        /p/<id>/...  the project routes above. Only the open project is
//                     real time: the watchers open with the first /events and close 60 s
//                     after the last client leaves.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { projectSlug, DEFAULT_STALE_MIN } from './collect.mjs';
import { parseChangePath, resolveChangeFile } from './board.mjs';
import { createProjectContext } from './live.mjs';
import { defaultHubFile, loadHub, findProject, projectSummary } from './hub.mjs';
import { teamInfo } from './team.mjs';
import { writeAnswer, getAway, setAway } from './ask.mjs';
import { loadToken, gate } from './auth.mjs';
import { publicView, updateConfig, loadConfig as loadNotify, notify, EVENTS as NOTIFY_EVENTS } from './notify.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const claudeDir = path.resolve(opt('--claude-dir', process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')));
const port = Number(opt('--port', process.env.PORT || 4321));
const host = opt('--host', '127.0.0.1');
const staleMin = Number(opt('--stale-min', process.env.AI_TEAM_STALE_MIN || DEFAULT_STALE_MIN)) || DEFAULT_STALE_MIN;
const idleMs = Number(process.env.AI_TEAM_IDLE_MS) || 60e3;   // hub: how long the project stays alive after the last client
const here = path.dirname(new URL(import.meta.url).pathname);
const hubIdx = args.indexOf('--hub');
const hubFile = hubIdx < 0 ? null : path.resolve(args[hubIdx + 1] && !args[hubIdx + 1].startsWith('--') ? args[hubIdx + 1] : defaultHubFile());

const sendText = (res, req, type, body) => {
  res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', ...(type === 'text/plain' ? { 'x-content-type-options': 'nosniff' } : {}) });
  res.end(req.method === 'HEAD' ? undefined : body);
};
const notFound = (res) => { res.writeHead(404); res.end('not found'); };
// old copies of cycle.html (profile) use absolute paths; in the hub they get the project prefix
const rebase = (html, prefix) => !prefix ? html : String(html)
  .replace(/(["'`(])\/(api\/state|api\/team|events|team|feed\.mjs|agents\/|changes\/)/g, `$1${prefix}/$2`)
  .replace(/href="\/"/g, `href="${prefix}/"`);

// Team page: team.html with the cycle marker replaced by the profile's cycle.html
// (if any) or by cycle-default.html. The block goes into the HTML, so it may have <style>/<script>.
// Single project: everything next to server.mjs (the installed copy). Hub: the hub's page and default
// cycle, the profile's cycle.html coming from the project's .claude/dashboard/.
function teamHtml(projectDir, hubMode) {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  const page = read(path.join(here, 'team.html')) || '<!doctype html><title>team</title><p>team.html missing';
  const cycle = read(path.join(hubMode ? path.join(projectDir, '.claude', 'dashboard') : here, 'cycle.html'))
    ?? read(path.join(here, 'cycle-default.html')) ?? '';
  return page.replace('<!--ai-team:cycle-->', () => cycle);
}

// POST with a JSON body: JSON only, same origin only (the browser does not send cross-origin JSON without a preflight)
const sendJson = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
function postJson(req, res, handle) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'use POST' });
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'content-type must be application/json' });
  const origin = req.headers.origin;
  if (origin) {   // behind a proxy (Tailscale Serve, tunnel) the original host may come in X-Forwarded-Host
    let h = null; try { h = new URL(origin).host; } catch {}
    const hosts = [req.headers.host, ...String(req.headers['x-forwarded-host'] || '').split(',').map((x) => x.trim())].filter(Boolean);
    if (!hosts.includes(h)) return sendJson(res, 403, { error: 'origin refused' });
  }
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 65536) req.destroy(); });
  req.on('end', async () => {
    let o; try { o = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { error: 'invalid JSON' }); }
    try { const r = await handle(o); sendJson(res, r.ok ? 200 : r.code || 409, r); } catch (e) { sendJson(res, 500, { error: String(e.message || e) }); }
  });
}

// a project's routes; `sub` starts with "/"; returns false if the route is not its own
function serveProject(ctx, sub, req, res, prefix = '') {
  const projectDir = ctx.projectDir;
  if (sub === '/api/answer') { postJson(req, res, (o) => { try { return writeAnswer(projectDir, o); } finally { ctx.markDirty(); } }); return true; }
  if (sub === '/api/away') {   // away mode: the Stop hook waits for the end-of-turn answer from the dashboard
    if (req.method === 'GET' || req.method === 'HEAD') { sendJson(res, 200, getAway(projectDir)); return true; }
    postJson(req, res, (o) => { try { return { ok: true, ...setAway(projectDir, o.on === true) }; } finally { ctx.markDirty(); } }); return true;
  }
  if (sub === '/api/notify') {
    if (req.method === 'GET' || req.method === 'HEAD') { sendJson(res, 200, publicView(projectDir)); return true; }
    postJson(req, res, (o) => { const r = updateConfig(projectDir, o); return r.error ? { ...r, code: 400 } : r; }); return true;
  }
  if (sub === '/api/notify/test') {
    postJson(req, res, async () => {
      const cfg = loadNotify(projectDir);
      if (!cfg) return { error: 'no topic configured', code: 400 };
      const r = await notify('turn_stop', { last_assistant_message: 'ai-team test notification (from the dashboard).' }, { projectDir, cfg: { ...cfg, on: NOTIFY_EVENTS } });
      return r.sent ? { ok: true } : { error: `not sent: ${r.reason || r.status}`, code: 502 };
    }); return true;
  }
  if (sub === '/notifications') { sendText(res, req, 'text/html', fs.readFileSync(path.join(here, 'notifications.html'))); return true; }
  if (sub === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(ctx.snapshot()); return true;
  }
  if (sub === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    ctx.subscribe(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); ctx.unsubscribe(res); });
    return true;
  }
  if (sub === '/' || sub === '/index.html') { sendText(res, req, 'text/html', fs.readFileSync(path.join(here, 'index.html'))); return true; }
  if (sub === '/feed.mjs') { sendText(res, req, 'text/javascript', fs.readFileSync(path.join(here, 'feed.mjs'))); return true; }
  if (sub === '/api/team') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(teamInfo(projectDir))); return true;
  }
  if (sub === '/team') { sendText(res, req, 'text/html', rebase(teamHtml(projectDir, !!prefix), prefix)); return true; }
  if (sub.startsWith('/changes/')) {
    const cp = parseChangePath(sub);
    const f = cp && resolveChangeFile(projectDir, cp.id, cp.segments);
    if (!f) { notFound(res); return true; }
    sendText(res, req, 'text/plain', fs.readFileSync(f)); return true;
  }
  const am = /^\/agents\/([a-z0-9-]+)\.md$/.exec(sub);
  if (am) {
    const f = path.join(projectDir, '.claude', 'agents', `${am[1]}.md`);
    if (!fs.existsSync(f)) { notFound(res); return true; }
    sendText(res, req, 'text/plain', fs.readFileSync(f)); return true;
  }
  return false;
}

// --- hub ---------------------------------------------------------------------
const hub = { mtime: -1, data: { teams: [], warnings: [] }, error: null };
const contexts = new Map();    // id → context (only projects already opened)
const summaries = new Map();   // id → { at, dir, data }
const SUMMARY_TTL = 20e3;

function readHub() {   // rereads the registry when the file changes (hub.mjs add/remove, hand edit)
  let m = 0;
  try { m = fs.statSync(hubFile).mtimeMs; } catch { m = 0; }
  if (m === hub.mtime) return hub;
  hub.mtime = m;
  try { hub.data = loadHub(hubFile); hub.error = null; } catch (e) { hub.error = e.message; }
  for (const [id, ctx] of contexts) {   // project removed or with another folder: closes the context
    const f = findProject(hub.data, id);
    if (!f || f.project.dir !== ctx.projectDir) { ctx.stop(); contexts.delete(id); }
  }
  return hub;
}
function contextOf(id) {
  const f = findProject(readHub().data, id);
  if (!f) return null;
  let ctx = contexts.get(id);
  if (!ctx) { ctx = createProjectContext({ projectDir: f.project.dir, claudeDir, staleMin, idleMs }); contexts.set(id, ctx); }
  return ctx;
}
function hubState() {
  const { data, error } = readHub();
  const now = Date.now();
  const teams = data.teams.map((t) => ({ id: t.id, name: t.name, projects: t.projects.map((p) => {
    let s = summaries.get(p.id);
    if (!s || s.dir !== p.dir || now - s.at > SUMMARY_TTL) { s = { at: now, dir: p.dir, data: projectSummary({ dir: p.dir, claudeDir, staleMin, now }) }; summaries.set(p.id, s); }
    const ctx = contexts.get(p.id);
    return { ...p, ...s.data, live: !!(ctx && ctx.live), viewers: ctx ? ctx.clients : 0 };
  }) }));
  return { generatedAt: now, hubFile, staleMin, error, warnings: data.warnings, teams };
}
if (hubFile) setInterval(() => { for (const ctx of contexts.values()) ctx.sweep(); }, 60e3).unref();

// --- single project ------------------------------------------------------------
const single = hubFile ? null : createProjectContext({
  projectDir: path.resolve(opt('--project', process.env.AI_TEAM_PROJECT || process.cwd())), claudeDir, staleMin, persistent: true,
});

const token = loadToken();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!gate(req, res, token)) return;
  if (single) { if (!serveProject(single, p, req, res)) notFound(res); return; }
  if (p === '/' || p === '/index.html' || /^\/t\/[a-z0-9-]+(\/[a-z0-9-]+)?\/?$/.test(p)) { sendText(res, req, 'text/html', fs.readFileSync(path.join(here, 'hub.html'))); return; }
  if (p === '/api/hub') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(hubState())); return;
  }
  const m = /^\/p\/([a-z0-9-]+)(\/.*)?$/.exec(p);
  if (m) {
    const ctx = contextOf(m[1]);
    if (!ctx) { notFound(res); return; }
    if (!m[2]) { res.writeHead(301, { location: `/p/${m[1]}/${url.search}` }); res.end(); return; }
    if (!serveProject(ctx, m[2], req, res, `/p/${m[1]}`)) notFound(res);
    return;
  }
  notFound(res);
});
server.listen(port, host, () => {
  const remote = token ? 'from outside only with token (/login)' : 'from outside refused (no token: node dashboard/auth.mjs token)';
  if (single) {
    console.log(`ai-team dashboard: http://${host}:${port}/`);
    console.log(`  project:     ${single.projectDir}`);
    console.log(`  transcripts: ${path.join(claudeDir, 'projects', projectSlug(single.projectDir))}`);
    console.log(`  watching:    ${single.watched.length ? single.watched.join(', ') : '(nothing yet; polling only)'}`);
    console.log(`  access:      local open; ${remote}`);
  } else {
    const { data, error } = readHub();
    console.log(`ai-team hub: http://${host}:${port}/`);
    console.log(`  registry:  ${hubFile}${fs.existsSync(hubFile) ? '' : ' (does not exist yet)'}`);
    console.log(error ? `  error: ${error}` : `  ${data.teams.length} team(s), ${data.teams.reduce((n, t) => n + t.projects.length, 0)} project(s); real time only in the open project`);
    for (const w of data.warnings) console.log(`  ! ${w}`);
    console.log(`  access:    local open; ${remote}`);
  }
});
