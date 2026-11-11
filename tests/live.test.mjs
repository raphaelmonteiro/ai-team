// Real-time context (live.mjs) and the server state routes: one computation per change, a GET that
// returns the stored state, notice only when the state changes (ignoring generatedAt). Computations
// counted through collectFn; the collector clock is controlled by the test.
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

// fixture: orchestrator session delegating to the builder; `ended` gives the call a result
let seq = 0;
function fixture({ ended }) {
  const root = path.join(tmp, `f${++seq}`), project = path.join(root, 'proj'), claude = path.join(root, 'claude');
  const sdir = path.join(claude, 'projects', projectSlug(project)), sid = 'sess-1';
  const base = { cwd: project, sessionId: sid, gitBranch: 'main' };
  const tasks = path.join(project, 'openspec/changes/add-x/tasks.md');
  w(tasks, '## 1. Backend\n- [ ] 1.1 route\n');
  w(path.join(project, '.claude/agents/orchestrator.md'), '# orchestrator\n');
  w(path.join(project, '.claude/agents/builder.md'), '# builder\n');
  w(path.join(project, '.claude/settings.json'), '{"agent":"orchestrator"}');
  const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 };
  const main = line({ ...base, type: 'user', uuid: 'p1', timestamp: iso(T0), message: { role: 'user', content: 'make the change' } })
    + line({ ...base, type: 'assistant', uuid: 'a1', requestId: 'r1', timestamp: iso(T0 + MIN), message: { role: 'assistant', model: 'claude-opus-5-5', usage,
      content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'builder', description: 'run 1', prompt: 'Implement openspec/changes/add-x' } }] } })
    + (ended ? line({ ...base, type: 'user', uuid: 'res1', timestamp: iso(T0 + 5 * MIN), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }] },
      toolUseResult: { agentId: 'a1', totalDurationMs: 4 * MIN, usage } }) : '');
  const sub = line({ ...base, agentId: 'a1', type: 'user', uuid: 's0', timestamp: iso(T0 + MIN), message: { role: 'user', content: 'Implement openspec/changes/add-x' } })
    + line({ ...base, agentId: 'a1', type: 'assistant', uuid: 's1', requestId: 'sr1', timestamp: iso(T0 + 2 * MIN), message: { role: 'assistant', model: 'claude-sonnet-5-5', usage, content: [{ type: 'text', text: 'ok' }] } });
  const mainF = path.join(sdir, `${sid}.jsonl`), subF = path.join(sdir, sid, 'subagents', 'agent-a1.jsonl');
  w(mainF, main); w(subF, sub);
  for (const f of [mainF, subF]) fs.utimesSync(f, new Date(T0 + 2 * MIN), new Date(T0 + 2 * MIN));
  return { project, claude, tasks, grow: (n) => fs.appendFileSync(tasks, `- [ ] 1.${n} more ${n}\n`) };
}
// fake SSE client: keeps what the server writes
// `updates` counts the notices after the connection notice (which `sub` checks: one, only for the new client)
const client = () => { const c = { out: '', base: 0, write(s) { c.out += s; }, get all() { return (c.out.match(/event: update/g) || []).length; }, get updates() { return c.all - c.base; } }; return c; };
function sub(ctx, c, others = []) {
  const before = others.map((o) => o.all);
  ctx.subscribe(c);
  assert.equal(c.all, 1, 'connection notice for the new client');
  assert.deepEqual(others.map((o) => o.all), before, 'the other clients are not notified of the connection');
  c.base = 1;
}
const mkCtx = (fx, opts = {}) => {
  const stats = { calcs: 0 }, clock = { t: T0 + 3 * 3600e3, step: 0 };
  const collectFn = (o) => { stats.calcs++; clock.t += clock.step; return collect({ ...o, now: clock.t }); };
  return { stats, clock, ctx: createProjectContext({ projectDir: fx.project, claudeDir: fx.claude, staleMin: 15, pollMs: 60e3, debounceMs: 100, collectFn, ...opts }) };
};
const parsed = (ctx) => JSON.parse(ctx.snapshot());

{   // several tabs, one change: one computation, the same state for every GET
  const fx = fixture({ ended: true }), { ctx, stats, clock } = mkCtx(fx);
  clock.step = 1000;
  const cs = [client(), client(), client()];
  cs.forEach((c, i) => sub(ctx, c, cs.slice(0, i)));
  const c0 = stats.calcs;
  fx.grow(2);
  assert.ok(await until(() => cs.every((c) => c.updates >= 1)), 'the three clients get an update');
  await sleep(350);
  assert.equal(stats.calcs - c0, 1, 'one change = one computation');
  const gets = [ctx.snapshot(), ctx.snapshot(), ctx.snapshot()];
  assert.equal(stats.calcs - c0, 1, 'the GETs do not compute again');
  assert.equal(new Set(gets).size, 1, 'same state (same generatedAt) in the three GETs');
  assert.equal(JSON.parse(gets[0]).changes.find((c) => c.id === 'add-x').tasks.total, 2, 'the state already has the change');
  assert.ok(cs.every((c) => c.updates === 1), 'one notice per client');
  // a POST that changes state: marks dirty, the next GET recomputes
  ctx.markDirty();
  const before = JSON.parse(gets[0]).generatedAt;
  assert.ok(parsed(ctx).generatedAt > before, 'after markDirty the GET recomputes');
  assert.equal(stats.calcs - c0, 2);
  ctx.snapshot();
  assert.equal(stats.calcs - c0, 2, 'and goes back to serving the stored one');
  for (const c of cs) ctx.unsubscribe(c);
  ctx.stop();
}
{   // GET inside the debounce window: already sees the change, and the clients are notified all the same
  const fx = fixture({ ended: true }), { ctx, stats } = mkCtx(fx, { debounceMs: 700 });
  const cs = [client(), client()];
  cs.forEach((c, i) => sub(ctx, c, cs.slice(0, i)));
  const c0 = stats.calcs;
  fx.grow(2);
  await sleep(250);
  assert.ok(cs.every((c) => c.updates === 0), 'still inside the debounce');
  assert.equal(parsed(ctx).changes.find((c) => c.id === 'add-x').tasks.total, 2, 'the GET recomputes and sees the change');
  assert.ok(await until(() => cs.every((c) => c.updates === 1)), 'both clients get an update anyway');
  assert.equal(stats.calcs - c0, 1, 'the broadcast reuses the GET computation');
  for (const c of cs) ctx.unsubscribe(c);
  ctx.stop();
}
{   // without clients: no freshness guarantee, every GET computes
  const fx = fixture({ ended: true }), { ctx, stats } = mkCtx(fx);
  const a = parsed(ctx);
  fx.grow(2);
  const b = parsed(ctx);
  assert.equal(a.changes.find((c) => c.id === 'add-x').tasks.total, 1);
  assert.equal(b.changes.find((c) => c.id === 'add-x').tasks.total, 2, 'the second GET reflects the change');
  assert.equal(stats.calcs, 2);
  assert.equal(ctx.live, false);
}
{   // idle project: polling ticks compute, but do not notify (generatedAt changes, nothing else)
  const fx = fixture({ ended: true }), { ctx, stats, clock } = mkCtx(fx, { pollMs: 40 });
  clock.step = 1000;
  const c = client();
  sub(ctx, c);
  const c0 = stats.calcs;
  await sleep(500);
  assert.ok(stats.calcs - c0 >= 4, `the polling computed (${stats.calcs - c0})`);
  assert.equal(c.updates, 0, 'no update without a change');
  ctx.unsubscribe(c); ctx.stop();
}
{   // agent running: the duration changes on every tick, so every tick notifies
  const fx = fixture({ ended: false }), { ctx, clock } = mkCtx(fx, { pollMs: 40 });
  clock.t = T0 + 3 * MIN; clock.step = 1000;
  const c = client();
  sub(ctx, c);
  assert.ok(await until(() => c.updates >= 2), 'update on every tick with an agent running');
  assert.match(ctx.snapshot(), /"status":"running"/);
  ctx.unsubscribe(c); ctx.stop();
}
{   // transition by time only: the clock passes --stale-min without any file changing
  const fx = fixture({ ended: false }), { ctx, clock } = mkCtx(fx, { pollMs: 40 });
  clock.t = T0 + 2 * MIN + 14 * MIN; clock.step = 0;     // 14 min without activity (limit: 15)
  const c = client();
  sub(ctx, c);
  assert.match(ctx.snapshot(), /"status":"running"/);
  await sleep(250);
  assert.equal(c.updates, 0, 'time stopped: no notice');
  clock.t = T0 + 2 * MIN + 16 * MIN;
  assert.ok(await until(() => c.updates === 1), 'past the limit: update on the next tick');
  assert.match(ctx.snapshot(), /"status":"no signal"/);
  ctx.unsubscribe(c); ctx.stop();
}

{   // a client connecting to an idle project: only it gets an update, and its GET does not recompute
  const fx = fixture({ ended: true }), { ctx, stats } = mkCtx(fx);
  const a = client(), b = client(), c = client();
  sub(ctx, a); sub(ctx, b, [a]);
  const c0 = stats.calcs;
  sub(ctx, c, [a, b]);
  assert.equal(stats.calcs, c0, 'connecting the 3rd client does not compute');
  ctx.snapshot();
  assert.equal(stats.calcs, c0, 'the next GET reuses the stored state');
  assert.deepEqual([a.updates, b.updates, c.updates], [0, 0, 0]);
  for (const x of [a, b, c]) ctx.unsubscribe(x);
  ctx.stop();
}
{   // reconnection: the only client drops, a decision enters pending, it comes back and is notified
  const fx = fixture({ ended: true }), { ctx } = mkCtx(fx, { idleMs: 60e3 });
  const a = client();
  sub(ctx, a);
  assert.deepEqual(parsed(ctx).pending, []);
  ctx.unsubscribe(a);
  w(path.join(fx.project, '.claude/ai-team/pending/abc123-perm.json'), JSON.stringify({ id: 'abc123-perm', ts: 1, pid: process.pid, tool: 'Bash', kind: 'permission', summary: 'ls' }));
  const b = client();
  sub(ctx, b);   // reconnects before its own next GET
  assert.equal(b.all, 1, 'update on reconnect');
  assert.deepEqual(parsed(ctx).pending.map((p) => p.id), ['abc123-perm'], 'the next GET carries the decision');
  ctx.unsubscribe(b); ctx.stop();
}

// --- through the server: state routes ---------------------------------------------------------------
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
    assert.deepEqual(Object.keys(await state()), expected, 'without clients: same format as the collector');

    const es = await fetch(`${b}/events`, { signal: ac.signal });
    assert.equal(es.status, 200);
    const reader = es.body.getReader(); let txt = '';
    (async () => { for (;;) { const { value, done } = await reader.read().catch(() => ({ done: true })); if (done) return; txt += new TextDecoder().decode(value); } })();
    await sleep(100);
    assert.match(txt, /event: update\ndata: \d+\n\n/, 'connection notice');
    txt = '';
    assert.deepEqual(Object.keys(await state()), expected, 'with a client: same top-level keys');
    assert.equal((await state()).generatedAt, (await state()).generatedAt, 'stored state: same generatedAt');

    // away mode: the POST marks dirty and the next GET already shows it (the .claude/ai-team folder is not watched yet)
    assert.equal((await state()).away.on, false);
    assert.equal((await post('/api/away', { on: true })).status, 200);
    assert.equal((await state()).away.on, true, 'away.on right after the POST');
    // answered decision: the hook consumes the pending item; the next GET does not bring it back
    const pdir = path.join(fx.project, '.claude/ai-team/pending');
    w(path.join(pdir, 'abc123-perm.json'), JSON.stringify({ id: 'abc123-perm', ts: 1, pid: process.pid, tool: 'Bash', kind: 'permission', summary: 'ls' }));
    assert.equal((await post('/api/away', { on: false })).status, 200);
    assert.deepEqual((await state()).pending.map((p) => p.id), ['abc123-perm'], 'pending item in the list');
    assert.equal((await post('/api/answer', { id: 'abc123-perm', behavior: 'allow' })).status, 200);
    fs.rmSync(path.join(pdir, 'abc123-perm.json'));   // the ask.mjs hook deletes the pending item when it reads the answer
    assert.deepEqual((await state()).pending, [], 'the answered decision does not come back in pending');

    // file change: /events sends event: update with a number in data:
    fx.grow(2);
    assert.ok(await until(() => /event: update\ndata: \d+\n\n/.test(txt), 6000), '/events keeps sending update with a number');
    assert.equal((await state()).changes.find((c) => c.id === 'add-x').tasks.total, 2);
  } finally { ac.abort(); srv.kill(); await new Promise((r) => srv.once('exit', r)); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ live: one computation per change ok');
