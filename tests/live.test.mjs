// Contexto de tempo real (live.mjs) e rotas de estado do servidor: um cálculo por mudança, GET que
// devolve o estado guardado, aviso só quando o estado muda (sem contar generatedAt). Contagem de
// cálculos por collectFn; relógio do coletor controlado pelo teste.
//   node tests/live.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { collect, projectSlug } from '../dashboard/collect.mjs';
import { createProjectContext } from '../dashboard/live.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-live-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await sleep(20); } return null; }
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const line = (r) => JSON.stringify(r) + '\n';
const T0 = Date.parse('2026-10-21T12:00:00.000Z');
const MIN = 60000;
const iso = (ms) => new Date(ms).toISOString();

// fixture: sessão do tech-lead que delega ao backend-dev; `ended` dá resultado à chamada
let seq = 0;
function fixture({ ended }) {
  const root = path.join(tmp, `f${++seq}`), project = path.join(root, 'proj'), claude = path.join(root, 'claude');
  const sdir = path.join(claude, 'projects', projectSlug(project)), sid = 'sess-1';
  const base = { cwd: project, sessionId: sid, gitBranch: 'main' };
  const tasks = path.join(project, 'openspec/changes/add-x/tasks.md');
  w(tasks, '## 1. Backend\n- [ ] 1.1 rota\n');
  w(path.join(project, '.claude/agents/tech-lead.md'), '# tech-lead\n');
  w(path.join(project, '.claude/agents/backend-dev.md'), '# backend-dev\n');
  w(path.join(project, '.claude/settings.json'), '{"agent":"tech-lead"}');
  const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 };
  const main = line({ ...base, type: 'user', uuid: 'p1', timestamp: iso(T0), message: { role: 'user', content: 'faça a change' } })
    + line({ ...base, type: 'assistant', uuid: 'a1', requestId: 'r1', timestamp: iso(T0 + MIN), message: { role: 'assistant', model: 'claude-opus-5-5', usage,
      content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'backend-dev', description: 'rodada 1', prompt: 'Implemente openspec/changes/add-x' } }] } })
    + (ended ? line({ ...base, type: 'user', uuid: 'res1', timestamp: iso(T0 + 5 * MIN), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
      toolUseResult: { agentId: 'a1', totalDurationMs: 4 * MIN, usage } }) : '');
  const sub = line({ ...base, agentId: 'a1', type: 'user', uuid: 's0', timestamp: iso(T0 + MIN), message: { role: 'user', content: 'Implemente openspec/changes/add-x' } })
    + line({ ...base, agentId: 'a1', type: 'assistant', uuid: 's1', requestId: 'sr1', timestamp: iso(T0 + 2 * MIN), message: { role: 'assistant', model: 'claude-sonnet-5-5', usage, content: [{ type: 'text', text: 'ok' }] } });
  const mainF = path.join(sdir, `${sid}.jsonl`), subF = path.join(sdir, sid, 'subagents', 'agent-a1.jsonl');
  w(mainF, main); w(subF, sub);
  for (const f of [mainF, subF]) fs.utimesSync(f, new Date(T0 + 2 * MIN), new Date(T0 + 2 * MIN));
  return { project, claude, tasks, grow: (n) => fs.appendFileSync(tasks, `- [ ] 1.${n} mais ${n}\n`) };
}
// cliente SSE falso: guarda o que o servidor escreve
const client = () => { const c = { out: '', write(s) { c.out += s; }, get updates() { return (c.out.match(/event: update/g) || []).length; } }; return c; };
const mkCtx = (fx, opts = {}) => {
  const stats = { calcs: 0 }, clock = { t: T0 + 3 * 3600e3, step: 0 };
  const collectFn = (o) => { stats.calcs++; clock.t += clock.step; return collect({ ...o, now: clock.t }); };
  return { stats, clock, ctx: createProjectContext({ projectDir: fx.project, claudeDir: fx.claude, staleMin: 15, pollMs: 60e3, debounceMs: 100, collectFn, ...opts }) };
};
const parsed = (ctx) => JSON.parse(ctx.snapshot());

{   // várias abas, uma mudança: um cálculo, o mesmo estado para todos os GET
  const fx = fixture({ ended: true }), { ctx, stats, clock } = mkCtx(fx);
  clock.step = 1000;
  const cs = [client(), client(), client()];
  for (const c of cs) ctx.subscribe(c);
  const c0 = stats.calcs;
  fx.grow(2);
  assert.ok(await until(() => cs.every((c) => c.updates >= 1)), 'os três clientes recebem update');
  await sleep(350);
  assert.equal(stats.calcs - c0, 1, 'uma mudança = um cálculo');
  const gets = [ctx.snapshot(), ctx.snapshot(), ctx.snapshot()];
  assert.equal(stats.calcs - c0, 1, 'os GET não calculam de novo');
  assert.equal(new Set(gets).size, 1, 'mesmo estado (mesmo generatedAt) nos três GET');
  assert.equal(JSON.parse(gets[0]).changes.find((c) => c.id === 'add-x').tasks.total, 2, 'o estado já tem a mudança');
  assert.ok(cs.every((c) => c.updates === 1), 'um aviso por cliente');
  // POST que altera estado: marca sujo, o GET seguinte recalcula
  ctx.markDirty();
  const before = JSON.parse(gets[0]).generatedAt;
  assert.ok(parsed(ctx).generatedAt > before, 'depois de markDirty o GET recalcula');
  assert.equal(stats.calcs - c0, 2);
  ctx.snapshot();
  assert.equal(stats.calcs - c0, 2, 'e volta a servir o guardado');
  for (const c of cs) ctx.unsubscribe(c);
  ctx.stop();
}
{   // GET dentro da janela de debounce: já vê a mudança, e os clientes são avisados do mesmo jeito
  const fx = fixture({ ended: true }), { ctx, stats } = mkCtx(fx, { debounceMs: 700 });
  const cs = [client(), client()];
  for (const c of cs) ctx.subscribe(c);
  const c0 = stats.calcs;
  fx.grow(2);
  await sleep(250);
  assert.ok(cs.every((c) => c.updates === 0), 'ainda dentro do debounce');
  assert.equal(parsed(ctx).changes.find((c) => c.id === 'add-x').tasks.total, 2, 'o GET recalcula e vê a mudança');
  assert.ok(await until(() => cs.every((c) => c.updates === 1)), 'os dois clientes recebem update mesmo assim');
  assert.equal(stats.calcs - c0, 1, 'o broadcast reaproveita o cálculo do GET');
  for (const c of cs) ctx.unsubscribe(c);
  ctx.stop();
}
{   // sem cliente: não há garantia de frescor, cada GET calcula
  const fx = fixture({ ended: true }), { ctx, stats } = mkCtx(fx);
  const a = parsed(ctx);
  fx.grow(2);
  const b = parsed(ctx);
  assert.equal(a.changes.find((c) => c.id === 'add-x').tasks.total, 1);
  assert.equal(b.changes.find((c) => c.id === 'add-x').tasks.total, 2, 'o segundo GET reflete a mudança');
  assert.equal(stats.calcs, 2);
  assert.equal(ctx.live, false);
}
{   // projeto parado: ticks do polling calculam, mas não avisam (generatedAt muda, o resto não)
  const fx = fixture({ ended: true }), { ctx, stats, clock } = mkCtx(fx, { pollMs: 40 });
  clock.step = 1000;
  const c = client();
  ctx.subscribe(c);
  const c0 = stats.calcs;
  await sleep(500);
  assert.ok(stats.calcs - c0 >= 4, `o polling calculou (${stats.calcs - c0})`);
  assert.equal(c.updates, 0, 'nenhum update sem mudança');
  ctx.unsubscribe(c); ctx.stop();
}
{   // agente rodando: a duração muda a cada tick, então cada tick avisa
  const fx = fixture({ ended: false }), { ctx, clock } = mkCtx(fx, { pollMs: 40 });
  clock.t = T0 + 3 * MIN; clock.step = 1000;
  const c = client();
  ctx.subscribe(c);
  assert.ok(await until(() => c.updates >= 2), 'update a cada tick com agente rodando');
  assert.match(ctx.snapshot(), /"status":"rodando"/);
  ctx.unsubscribe(c); ctx.stop();
}
{   // transição só pelo tempo: o relógio passa de --stale-min sem arquivo mudar
  const fx = fixture({ ended: false }), { ctx, clock } = mkCtx(fx, { pollMs: 40 });
  clock.t = T0 + 2 * MIN + 14 * MIN; clock.step = 0;     // 14 min sem atividade (limite: 15)
  const c = client();
  ctx.subscribe(c);
  assert.match(ctx.snapshot(), /"status":"rodando"/);
  await sleep(250);
  assert.equal(c.updates, 0, 'tempo parado: sem aviso');
  clock.t = T0 + 2 * MIN + 16 * MIN;
  assert.ok(await until(() => c.updates === 1), 'passou do limite: update no tick seguinte');
  assert.match(ctx.snapshot(), /"status":"sem sinal"/);
  ctx.unsubscribe(c); ctx.stop();
}

// --- pelo servidor: rotas de estado ---------------------------------------------------------------
{
  const fx = fixture({ ended: true });
  const here = path.dirname(new URL(import.meta.url).pathname), port = 43251, b = `http://127.0.0.1:${port}`;
  const srv = spawn(process.execPath, [path.join(here, '..', 'dashboard', 'server.mjs'), '--project', fx.project, '--claude-dir', fx.claude, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const ac = new AbortController();
  try {
    await new Promise((ok) => srv.stdout.once('data', ok));
    const state = async () => (await fetch(`${b}/api/state`)).json();
    const post = (p, body) => fetch(b + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const expected = Object.keys(collect({ projectDir: fx.project, claudeDir: fx.claude }));
    assert.deepEqual(Object.keys(await state()), expected, 'sem cliente: formato igual ao do coletor');

    const es = await fetch(`${b}/events`, { signal: ac.signal });
    assert.equal(es.status, 200);
    const reader = es.body.getReader(); let txt = '';
    (async () => { for (;;) { const { value, done } = await reader.read().catch(() => ({ done: true })); if (done) return; txt += new TextDecoder().decode(value); } })();
    await sleep(100);
    assert.deepEqual(Object.keys(await state()), expected, 'com cliente: mesmas chaves de primeiro nível');
    assert.equal((await state()).generatedAt, (await state()).generatedAt, 'estado guardado: mesmo generatedAt');

    // modo longe: o POST marca sujo e o GET seguinte já mostra (a pasta .claude/ai-team ainda não é observada)
    assert.equal((await state()).away.on, false);
    assert.equal((await post('/api/away', { on: true })).status, 200);
    assert.equal((await state()).away.on, true, 'away.on logo depois do POST');
    // decisão respondida: o hook consome a pendência; o GET seguinte não a traz de volta
    const pdir = path.join(fx.project, '.claude/ai-team/pending');
    w(path.join(pdir, 'abc123-perm.json'), JSON.stringify({ id: 'abc123-perm', ts: 1, pid: process.pid, tool: 'Bash', kind: 'permission', summary: 'ls' }));
    assert.equal((await post('/api/away', { on: false })).status, 200);
    assert.deepEqual((await state()).pending.map((p) => p.id), ['abc123-perm'], 'pendência na lista');
    assert.equal((await post('/api/answer', { id: 'abc123-perm', behavior: 'allow' })).status, 200);
    fs.rmSync(path.join(pdir, 'abc123-perm.json'));   // o hook ask.mjs apaga a pendência ao ler a resposta
    assert.deepEqual((await state()).pending, [], 'a decisão respondida não volta em pending');

    // mudança de arquivo: /events manda event: update com um número no data:
    fx.grow(2);
    assert.ok(await until(() => /event: update\ndata: \d+\n\n/.test(txt), 6000), '/events continua mandando update com número');
    assert.equal((await state()).changes.find((c) => c.id === 'add-x').tasks.total, 2);
  } finally { ac.abort(); srv.kill(); await new Promise((r) => srv.once('exit', r)); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ tempo real: um cálculo por mudança ok');
