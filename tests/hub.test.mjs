// Teste do hub: registro (hub.mjs), contexto sob demanda (live.mjs) e o
// servidor com --hub (rotas /api/hub, /p/<id>/..., tempo real só no projeto aberto).
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
  w(path.join(dir, '.claude/settings.json'), '{"agent":"tech-lead"}');
  w(path.join(dir, '.claude/agents/tech-lead.md'), '# tech-lead\n');
  w(path.join(dir, 'openspec/changes/add-x/tasks.md'), '## 1. Backend\n- [ ] 1.1 algo\n');
  w(path.join(dir, 'openspec/changes/archive/2026-10-01-old/tasks.md'), '## 1. Backend\n- [x] 1.1 feito\n');
  const rec = { type: 'user', uuid: 'u1', sessionId: 's1', cwd: dir, timestamp: new Date().toISOString(), message: { role: 'user', content: 'oi' } };
  w(path.join(claude, 'projects', projectSlug(dir), 's1.jsonl'), JSON.stringify(rec) + '\n');
  return dir;
};
const api = mkProject('checkout-api');
const web = mkProject('checkout-web');
const plato = mkProject('plato');

// --- registro -------------------------------------------------------------------
assert.equal(slugId('Pagamentos & Cobrança'), 'pagamentos-cobranca');
const file = path.join(tmp, 'cfg', 'hub.json');
let hub = loadHub(file);
assert.deepEqual(hub.teams, [], 'registro inexistente = vazio');
let r = addProject(hub, { dir: api, team: 'Pagamentos', name: 'Checkout API' });
assert.equal(r.action, 'adicionado');
assert.equal(r.team.id, 'pagamentos'); assert.equal(r.team.name, 'Pagamentos');
assert.equal(r.project.id, 'checkout-api');
addProject(hub, { dir: web, team: 'pagamentos' });
r = addProject(hub, { dir: path.join(tmp, 'outro', 'checkout-api'), team: 'plataforma' });
assert.equal(r.project.id, 'checkout-api-2', 'id único no hub inteiro');
removeProject(hub, 'checkout-api-2');
assert.equal(hub.teams.length, 1, 'time vazio sai do registro');
r = addProject(hub, { dir: api, team: 'pagamentos', name: 'API do Checkout' });
assert.equal(r.action, 'atualizado'); assert.equal(r.project.id, 'checkout-api'); assert.equal(r.project.name, 'API do Checkout');
r = addProject(hub, { dir: plato, team: 'pagamentos' });
r = addProject(hub, { dir: plato, team: 'plataforma' });
assert.equal(r.action, 'movido'); assert.equal(r.project.id, 'plato');
assert.equal(findProject(hub, 'plato').team.id, 'plataforma');
assert.deepEqual(hub.teams.find((t) => t.id === 'pagamentos').projects.map((p) => p.id), ['checkout-api', 'checkout-web']);
assert.throws(() => addProject(hub, { dir: api, team: '!!' }), /time inválido/);
assert.throws(() => addProject(hub, { dir: api, team: 'x', id: 'A B' }), /id inválido/);
saveHub(file, hub);
assert.deepEqual(loadHub(file).teams, hub.teams, 'grava e relê igual');

// edição à mão: ~, repetidos e entradas sem dir viram avisos
const manual = path.join(tmp, 'manual.json');
w(manual, JSON.stringify({ teams: [{ id: 'a', projects: [{ id: 'home', dir: '~/x' }, { id: 'home', dir: '/y' }, { id: 'sem-dir' }] }, { id: 'a' }] }));
const hm = loadHub(manual);
assert.equal(hm.teams[0].projects.length, 1);
assert.equal(hm.teams[0].projects[0].dir, path.join(os.homedir(), 'x'));
assert.equal(hm.warnings.length, 3);
w(manual, '{ quebrado');
assert.throws(() => loadHub(manual), /JSON inválido/);

// CLI
const cli = (...a) => execFileSync(process.execPath, [path.join(import.meta.dirname, '..', 'dashboard', 'hub.mjs'), ...a, '--hub', file], { encoding: 'utf8' });
assert.match(cli('list'), /checkout-web/);
assert.equal(JSON.parse(cli('list', '--json')).teams.length, 2);

// --- resumo barato ----------------------------------------------------------------
const s = projectSummary({ dir: api, claudeDir: claude, staleMin: 15 });
assert.deepEqual(s.changes, { open: 1, archived: 1 });
assert.equal(s.agents, 1); assert.equal(s.exists, true); assert.equal(s.active, true, 'transcript recém-gravado');
// nome do painel: PROJECT_NAME do conf (aspas escapadas como o instalador grava), senão a pasta
assert.equal(readProjectName(api), 'checkout-api');
w(path.join(web, '.claude/ai-team.conf'), "AI_TEAM_PROFILE='generic'\nPROJECT_NAME='Checkout d'\\''Web'\n");
assert.equal(readProjectName(web), "Checkout d'Web");
const gone = projectSummary({ dir: path.join(tmp, 'nao-existe'), claudeDir: claude, staleMin: 15 });
assert.equal(gone.exists, false); assert.equal(gone.lastActivity, null); assert.equal(gone.active, false);

// --- contexto sob demanda ---------------------------------------------------------
{
  const ctx = createProjectContext({ projectDir: api, claudeDir: claude, staleMin: 15, idleMs: 50, dropMs: 0 });
  assert.equal(ctx.live, false, 'nada aberto antes do primeiro cliente');
  assert.equal(JSON.parse(ctx.snapshot()).project.dir, api);
  assert.equal(ctx.live, false, '/api/state sozinho não abre watchers');
  const fake = { write() {} };
  ctx.subscribe(fake);
  assert.equal(ctx.live, true); assert.equal(ctx.watched.length, 2, 'transcripts e openspec/changes (sem .claude/ai-team)');
  ctx.unsubscribe(fake);
  assert.equal(ctx.live, true, 'espera idleMs antes de fechar');
  await sleep(120);
  assert.equal(ctx.live, false, 'fechou depois que o último cliente saiu');
  ctx.sweep(Date.now() + 1);
  assert.equal(ctx.cached, false, 'cache descartado sem uso');
  const p = createProjectContext({ projectDir: api, claudeDir: claude, staleMin: 15, persistent: true, idleMs: 10 });
  assert.equal(p.live, true, 'persistente abre na partida');
  p.subscribe(fake); p.unsubscribe(fake); await sleep(40);
  assert.equal(p.live, true, 'persistente não fecha');
  p.stop();
}

// --- servidor com --hub -------------------------------------------------------------
// ciclo do perfil instalado no projeto, cópia antiga com caminhos absolutos
w(path.join(plato, '.claude/dashboard/cycle.html'), `<section id="ciclo-plato"><a href="/changes/x/tasks.md">x</a><script>fetch('/api/state');new EventSource('/events');</script></section>`);
const port = 43231;
const srv = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'dashboard', 'server.mjs'), '--hub', file, '--claude-dir', claude, '--port', String(port)],
  { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, AI_TEAM_IDLE_MS: '150' } });
try {
  await new Promise((ok) => srv.stdout.once('data', ok));
  const b = `http://127.0.0.1:${port}`;
  const hubState = async () => (await fetch(`${b}/api/hub`)).json();
  const proj = (st, id) => st.teams.flatMap((t) => t.projects).find((p) => p.id === id);

  let st = await hubState();
  assert.deepEqual(st.teams.map((t) => t.id), ['pagamentos', 'plataforma']);
  assert.equal(proj(st, 'checkout-api').name, 'API do Checkout');
  assert.equal(proj(st, 'checkout-api').changes.open, 1);
  assert.ok(st.teams.flatMap((t) => t.projects).every((p) => !p.live), 'nenhum projeto em tempo real sem cliente');

  for (const u of ['/', '/t/pagamentos', '/t/pagamentos/checkout-web']) {
    const res = await fetch(b + u);
    assert.equal(res.status, 200, u); assert.match(await res.text(), /ai-team · hub/);
  }
  const redir = await fetch(`${b}/p/checkout-api`, { redirect: 'manual' });
  assert.equal(redir.status, 301); assert.equal(redir.headers.get('location'), '/p/checkout-api/');
  assert.match(await (await fetch(`${b}/p/checkout-api/`)).text(), /ai-team · painel/);
  assert.equal((await fetch(`${b}/p/checkout-api/feed.mjs`)).status, 200);
  const state = await (await fetch(`${b}/p/checkout-web/api/state`)).json();
  assert.equal(state.project.dir, web);
  assert.equal((await fetch(`${b}/p/checkout-api/changes/add-x/tasks.md`)).status, 200);
  assert.equal((await fetch(`${b}/p/checkout-api/agents/tech-lead.md`)).status, 200);
  assert.equal((await fetch(`${b}/p/checkout-api/changes/..%2F..%2F.claude%2Fsettings.json`)).status, 404);
  for (const bad of ['/p/nao-existe/', '/p/nao-existe/api/state', '/p/..%2Fx/', '/api/state', '/events', '/t/A/b'])
    assert.equal((await fetch(b + bad)).status, 404, `recusa ${bad}`);

  // equipe: página do hub; ciclo padrão, ou o cycle.html do perfil instalado no projeto
  const eqApi = await (await fetch(`${b}/p/checkout-api/equipe`)).text();
  assert.match(eqApi, /Ciclo de uma change/); assert.match(eqApi, /fetch\('api\/team'/);
  assert.equal(JSON.parse(await (await fetch(`${b}/p/checkout-api/api/team`)).text()).agents[0].id, 'tech-lead');
  const eq = await (await fetch(`${b}/p/plato/equipe`)).text();
  assert.match(eq, /id="ciclo-plato"/); assert.doesNotMatch(eq, /Ciclo de uma change/);
  assert.match(eq, /href="\/p\/plato\/changes\/x\/tasks.md"/); assert.match(eq, /fetch\('\/p\/plato\/api\/state'\)/); assert.match(eq, /EventSource\('\/p\/plato\/events'\)/);

  // tempo real só no projeto aberto
  const ac = new AbortController();
  const es = await fetch(`${b}/p/checkout-api/events`, { signal: ac.signal });
  assert.equal(es.status, 200);
  await sleep(50);
  st = await hubState();
  assert.equal(proj(st, 'checkout-api').live, true); assert.equal(proj(st, 'checkout-api').viewers, 1);
  assert.equal(proj(st, 'checkout-web').live, false, 'só o aberto observa');
  // update chega quando o projeto muda
  const reader = es.body.getReader();
  const got = (async () => { let txt = ''; for (;;) { const { value, done } = await reader.read(); if (done) return txt; txt += new TextDecoder().decode(value); if (txt.includes('event: update')) return txt; } })();
  await sleep(100);
  w(path.join(api, 'openspec/changes/add-y/tasks.md'), '## 1. Backend\n- [ ] 1.1 novo\n');
  assert.match(await Promise.race([got, sleep(4000).then(() => 'timeout')]), /event: update/, 'SSE avisa a mudança');
  ac.abort();
  await sleep(400);
  st = await hubState();
  assert.equal(proj(st, 'checkout-api').live, false, 'fecha depois que o cliente sai');

  // registro relido sem reiniciar
  await sleep(20);
  const extra = mkProject('billing');
  cli('add', extra, '--team', 'Financeiro', '--name', 'Billing');
  st = await hubState();
  assert.equal(proj(st, 'billing').name, 'Billing');
  assert.equal((await fetch(`${b}/p/billing/api/state`)).status, 200);
  cli('remove', 'billing');
  assert.equal((await fetch(`${b}/p/billing/api/state`)).status, 404, 'removido do registro');
} finally { srv.kill(); await new Promise((r) => srv.once('exit', r)); }

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ hub: registro e tempo real sob demanda ok');
