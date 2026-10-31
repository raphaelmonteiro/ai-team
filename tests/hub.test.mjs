// Hub test: registry (hub.mjs), on-demand context (live.mjs) and the
// server with --hub (routes /api/hub, /p/<id>/..., real time only in the open project).
//   node tests/hub.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { projectSlug, readProjectName } from '../dashboard/collect.mjs';
import { loadHub, saveHub, addProject, removeProject, findProject, projectSummary, slugId } from '../dashboard/hub.mjs';
import { createProjectContext } from '../dashboard/live.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-hub-'));
const claude = path.join(tmp, 'claude');
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mkProject = (name) => {
  const dir = path.join(tmp, name);
  w(path.join(dir, '.claude/settings.json'), '{"agent":"orchestrator"}');
  w(path.join(dir, '.claude/agents/orchestrator.md'), '# orchestrator\n');
  w(path.join(dir, 'openspec/changes/add-x/tasks.md'), '## 1. Backend\n- [ ] 1.1 something\n');
  w(path.join(dir, 'openspec/changes/archive/2026-10-01-old/tasks.md'), '## 1. Backend\n- [x] 1.1 done\n');
  const rec = { type: 'user', uuid: 'u1', sessionId: 's1', cwd: dir, timestamp: new Date().toISOString(), message: { role: 'user', content: 'hi' } };
  w(path.join(claude, 'projects', projectSlug(dir), 's1.jsonl'), JSON.stringify(rec) + '\n');
  return dir;
};
const api = mkProject('checkout-api');
const web = mkProject('checkout-web');
const atlas = mkProject('atlas');

// --- registry -------------------------------------------------------------------
assert.equal(slugId('Payments & Cobrança'), 'payments-cobranca');
const file = path.join(tmp, 'cfg', 'hub.json');
let hub = loadHub(file);
assert.deepEqual(hub.teams, [], 'missing registry = empty');
let r = addProject(hub, { dir: api, team: 'Payments', name: 'Checkout API' });
assert.equal(r.action, 'added');
assert.equal(r.team.id, 'payments'); assert.equal(r.team.name, 'Payments');
assert.equal(r.project.id, 'checkout-api');
addProject(hub, { dir: web, team: 'payments' });
r = addProject(hub, { dir: path.join(tmp, 'other', 'checkout-api'), team: 'platform' });
assert.equal(r.project.id, 'checkout-api-2', 'unique id across the whole hub');
removeProject(hub, 'checkout-api-2');
assert.equal(hub.teams.length, 1, 'an empty team leaves the registry');
r = addProject(hub, { dir: api, team: 'payments', name: 'Checkout API v2' });
assert.equal(r.action, 'updated'); assert.equal(r.project.id, 'checkout-api'); assert.equal(r.project.name, 'Checkout API v2');
r = addProject(hub, { dir: atlas, team: 'payments' });
r = addProject(hub, { dir: atlas, team: 'platform' });
assert.equal(r.action, 'moved'); assert.equal(r.project.id, 'atlas');
assert.equal(findProject(hub, 'atlas').team.id, 'platform');
assert.deepEqual(hub.teams.find((t) => t.id === 'payments').projects.map((p) => p.id), ['checkout-api', 'checkout-web']);
assert.throws(() => addProject(hub, { dir: api, team: '!!' }), /invalid team/);
assert.throws(() => addProject(hub, { dir: api, team: 'x', id: 'A B' }), /invalid id/);
saveHub(file, hub);
assert.deepEqual(loadHub(file).teams, hub.teams, 'writes and rereads the same');

// hand edit: ~, repeats and entries without dir become warnings
const manual = path.join(tmp, 'manual.json');
w(manual, JSON.stringify({ teams: [{ id: 'a', projects: [{ id: 'home', dir: '~/x' }, { id: 'home', dir: '/y' }, { id: 'no-dir' }] }, { id: 'a' }] }));
const hm = loadHub(manual);
assert.equal(hm.teams[0].projects.length, 1);
assert.equal(hm.teams[0].projects[0].dir, path.join(os.homedir(), 'x'));
assert.equal(hm.warnings.length, 3);
w(manual, '{ broken');
assert.throws(() => loadHub(manual), /invalid JSON/);

// CLI
const cli = (...a) => execFileSync(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dashboard', 'hub.mjs'), ...a, '--hub', file], { encoding: 'utf8' });
assert.match(cli('list'), /checkout-web/);
assert.equal(JSON.parse(cli('list', '--json')).teams.length, 2);

// --- cheap summary ----------------------------------------------------------------
const s = projectSummary({ dir: api, claudeDir: claude, staleMin: 15 });
assert.deepEqual(s.changes, { open: 1, archived: 1 });
assert.equal(s.agents, 1); assert.equal(s.exists, true); assert.equal(s.active, true, 'freshly written transcript');
// dashboard name: PROJECT_NAME from the conf (quotes escaped as the installer writes them), otherwise the folder
assert.equal(readProjectName(api), 'checkout-api');
w(path.join(web, '.claude/ai-team.conf'), "AI_TEAM_PROFILE='generic'\nPROJECT_NAME='Checkout d'\\''Web'\n");
assert.equal(readProjectName(web), "Checkout d'Web");
const gone = projectSummary({ dir: path.join(tmp, 'does-not-exist'), claudeDir: claude, staleMin: 15 });
assert.equal(gone.exists, false); assert.equal(gone.lastActivity, null); assert.equal(gone.active, false);

// --- on-demand context ---------------------------------------------------------
{
  const ctx = createProjectContext({ projectDir: api, claudeDir: claude, staleMin: 15, idleMs: 50, dropMs: 0 });
  assert.equal(ctx.live, false, 'nothing open before the first client');
  assert.equal(JSON.parse(ctx.snapshot()).project.dir, api);
  assert.equal(ctx.live, false, '/api/state alone does not open watchers');
  const fake = { write() {} };
  ctx.subscribe(fake);
  assert.equal(ctx.live, true); assert.equal(ctx.watched.length, 2, 'transcripts and openspec/changes (no .claude/ai-team)');
  ctx.unsubscribe(fake);
  assert.equal(ctx.live, true, 'waits idleMs before closing');
  await sleep(120);
  assert.equal(ctx.live, false, 'closed after the last client left');
  ctx.sweep(Date.now() + 1);
  assert.equal(ctx.cached, false, 'cache dropped when unused');
  const p = createProjectContext({ projectDir: api, claudeDir: claude, staleMin: 15, persistent: true, idleMs: 10 });
  assert.equal(p.live, true, 'persistent opens at startup');
  p.subscribe(fake); p.unsubscribe(fake); await sleep(40);
  assert.equal(p.live, true, 'persistent does not close');
  p.stop();
}

// --- server with --hub -------------------------------------------------------------
// profile cycle installed in the project, old copy with absolute paths
w(path.join(atlas, '.claude/dashboard/cycle.html'), `<section id="atlas-cycle"><a href="/changes/x/tasks.md">x</a><script>fetch('/api/state');new EventSource('/events');</script></section>`);
const port = 43231;
const srv = spawn(process.execPath, [path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dashboard', 'server.mjs'), '--hub', file, '--claude-dir', claude, '--port', String(port)],
  { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, AI_TEAM_IDLE_MS: '150' } });
try {
  await new Promise((ok) => srv.stdout.once('data', ok));
  const b = `http://127.0.0.1:${port}`;
  const hubState = async () => (await fetch(`${b}/api/hub`)).json();
  const proj = (st, id) => st.teams.flatMap((t) => t.projects).find((p) => p.id === id);

  let st = await hubState();
  assert.deepEqual(st.teams.map((t) => t.id), ['payments', 'platform']);
  assert.equal(proj(st, 'checkout-api').name, 'Checkout API v2');
  assert.equal(proj(st, 'checkout-api').changes.open, 1);
  assert.ok(st.teams.flatMap((t) => t.projects).every((p) => !p.live), 'no project in real time without a client');

  for (const u of ['/', '/t/payments', '/t/payments/checkout-web']) {
    const res = await fetch(b + u);
    assert.equal(res.status, 200, u); assert.match(await res.text(), /ai-team · hub/);
  }
  const redir = await fetch(`${b}/p/checkout-api`, { redirect: 'manual' });
  assert.equal(redir.status, 301); assert.equal(redir.headers.get('location'), '/p/checkout-api/');
  assert.match(await (await fetch(`${b}/p/checkout-api/`)).text(), /ai-team · dashboard/);
  assert.equal((await fetch(`${b}/p/checkout-api/feed.mjs`)).status, 200);
  const state = await (await fetch(`${b}/p/checkout-web/api/state`)).json();
  assert.equal(state.project.dir, web);
  assert.equal((await fetch(`${b}/p/checkout-api/changes/add-x/tasks.md`)).status, 200);
  assert.equal((await fetch(`${b}/p/checkout-api/agents/orchestrator.md`)).status, 200);
  assert.equal((await fetch(`${b}/p/checkout-api/changes/..%2F..%2F.claude%2Fsettings.json`)).status, 404);
  for (const bad of ['/p/does-not-exist/', '/p/does-not-exist/api/state', '/p/..%2Fx/', '/api/state', '/events', '/t/A/b'])
    assert.equal((await fetch(b + bad)).status, 404, `refuses ${bad}`);

  // team: hub page; default cycle, or the profile cycle.html installed in the project
  const teamApi = await (await fetch(`${b}/p/checkout-api/team`)).text();
  assert.match(teamApi, /Cycle of a change/); assert.match(teamApi, /fetch\('api\/team'/);
  assert.equal(JSON.parse(await (await fetch(`${b}/p/checkout-api/api/team`)).text()).agents[0].id, 'orchestrator');
  const eq = await (await fetch(`${b}/p/atlas/team`)).text();
  assert.match(eq, /id="atlas-cycle"/); assert.doesNotMatch(eq, /Cycle of a change/);
  assert.match(eq, /href="\/p\/atlas\/changes\/x\/tasks.md"/); assert.match(eq, /fetch\('\/p\/atlas\/api\/state'\)/); assert.match(eq, /EventSource\('\/p\/atlas\/events'\)/);

  // real time only in the open project
  const ac = new AbortController();
  const es = await fetch(`${b}/p/checkout-api/events`, { signal: ac.signal });
  assert.equal(es.status, 200);
  await sleep(50);
  st = await hubState();
  assert.equal(proj(st, 'checkout-api').live, true); assert.equal(proj(st, 'checkout-api').viewers, 1);
  assert.equal(proj(st, 'checkout-web').live, false, 'only the open one watches');
  // update arrives when the project changes
  const reader = es.body.getReader();
  const got = (async () => { let txt = ''; for (;;) { const { value, done } = await reader.read(); if (done) return txt; txt += new TextDecoder().decode(value); if (txt.includes('event: update')) return txt; } })();
  await sleep(100);
  w(path.join(api, 'openspec/changes/add-y/tasks.md'), '## 1. Backend\n- [ ] 1.1 new\n');
  assert.match(await Promise.race([got, sleep(4000).then(() => 'timeout')]), /event: update/, 'SSE announces the change');
  ac.abort();
  await sleep(400);
  st = await hubState();
  assert.equal(proj(st, 'checkout-api').live, false, 'closes after the client leaves');

  // registry reread without restarting
  await sleep(20);
  const extra = mkProject('billing');
  cli('add', extra, '--team', 'Finance', '--name', 'Billing');
  st = await hubState();
  assert.equal(proj(st, 'billing').name, 'Billing');
  assert.equal((await fetch(`${b}/p/billing/api/state`)).status, 200);
  cli('remove', 'billing');
  assert.equal((await fetch(`${b}/p/billing/api/state`)).status, 404, 'removed from the registry');
} finally { srv.kill(); await new Promise((r) => srv.once('exit', r)); }

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ hub: registry and on-demand real time ok');
