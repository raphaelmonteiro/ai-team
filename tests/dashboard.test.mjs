// Dashboard collector test over synthetic transcripts in the
// Claude Code 2.1 format (one record per block with a repeated requestId, subagents in
// <session>/subagents/agent-<id>.jsonl, Agent tool result with agentId).
//   node tests/dashboard.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-dash-'));
const project = path.join(tmp, 'proj');
const claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-21T15:00:00.000Z');
const at = (min) => new Date(now - min * 60000).toISOString();
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const jsonl = (f, recs) => w(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');

// --- project with openspec ---------------------------------------------------
w(path.join(project, '.claude', 'settings.json'), '{"agent":"orchestrator"}');
w(path.join(project, 'openspec/changes/add-invoice/tasks.md'), `# tasks\n## 0. Infra\n- [x] 0.1 compose\n## 1. Backend\n- [x] 1.1 route\n- [ ] 1.2 tests\n## 2. Frontend\n- [ ] 2.1 screen\n## 3. Validation\n- [ ] 3.1 validate\n`);
w(path.join(project, 'openspec/changes/add-invoice/review-report.md'), `# Review\n## Round 1\nResult: CHANGES REQUESTED\n## Round 2\nResult: APPROVED\n`);
w(path.join(project, 'openspec/changes/fix-login/tasks.md'), `## 1. Backend\n- [ ] 1.1 fix (blocked: D-12)\n`);
w(path.join(project, 'openspec/changes/new-idea/tasks.md'), `## 1. Backend\n- [ ] 1.1 something\n`);
w(path.join(project, 'openspec/changes/archive/2026-10-01-old-change/tasks.md'), `## 1. Backend\n- [x] 1.1 done\n`);
w(path.join(project, 'openspec/changes/archive/2026-10-01-old-change/validation-report.md'), `# Validation — old-change   Result: APPROVED\n`);

// --- main session -----------------------------------------------------
const slug = projectSlug(project);
const sdir = path.join(claude, 'projects', slug);
const sid = 'sess-0001';
const base = { cwd: project, sessionId: sid, version: '2.1.306', isSidechain: false, userType: 'external' };
const asst = (uuid, min, blocks, reqId, usage) => blocks.map((b, i) => ({ ...base, type: 'assistant', uuid: `${uuid}-${i}`, timestamp: at(min),
  requestId: reqId, apiBlockIndex: i, message: { role: 'assistant', model: 'claude-opus-5-5', usage, content: [b] } }));
const usageMain = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
const promptPO = 'Create the change add-invoice in OpenSpec (openspec/changes/add-invoice): proposal, specs and tasks.';
const promptBE = 'Implement section 1. Backend of openspec/changes/add-invoice/tasks.md. Read design.md.';
const promptMisc = 'Check whether Postgres is up (unrelated to openspec/changes/add-invoice-*).';
jsonl(path.join(sdir, `${sid}.jsonl`), [
  { ...base, type: 'user', uuid: 'u1', timestamp: at(60), message: { role: 'user', content: 'create the change add-invoice' } },
  ...asst('a1', 59, [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'tu-po', name: 'Agent', input: { subagent_type: 'spec-writer', description: 'create change', prompt: promptPO } }], 'req-1', usageMain),
  { ...base, type: 'user', uuid: 'u2', timestamp: at(45), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-po', content: 'done' }] },
    toolUseResult: { agentId: 'po1', content: [{ type: 'text', text: 'done' }], totalDurationMs: 14 * 60000, totalTokens: 5000, totalToolUseCount: 7,
      usage: { input_tokens: 50, output_tokens: 900, cache_read_input_tokens: 4000, cache_creation_input_tokens: 50 } } },
  ...asst('a2', 44, [{ type: 'tool_use', id: 'tu-be', name: 'Agent', input: { subagent_type: 'builder', description: 'section 1', prompt: promptBE, run_in_background: true } }], 'req-2', usageMain),
  { ...base, type: 'user', uuid: 'u3', timestamp: at(44), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-be', content: 'Agent started in background' }] },
    toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'be1', description: 'section 1' } },
  ...asst('a3', 43, [{ type: 'tool_use', id: 'tu-misc', name: 'Agent', input: { subagent_type: 'provisioner', description: 'check database', prompt: promptMisc, model: 'haiku' } }], 'req-3', usageMain),
  { ...base, type: 'user', uuid: 'u4', timestamp: at(42), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-misc', content: 'up' }] },
    toolUseResult: { agentId: 'dv1', content: [{ type: 'text', text: 'up' }], totalDurationMs: 30000, totalTokens: 300, totalToolUseCount: 1, usage: { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 } } },
  ...asst('a4', 41, [{ type: 'text', text: 'backend in progress' }], 'req-4', usageMain),
]);

// --- subagents -------------------------------------------------------------
const sub = (agentId, agent, min0, min1, prompt, model, n, blocked) => {
  const recs = [{ ...base, isSidechain: true, agentId, type: 'user', uuid: `${agentId}-u`, timestamp: at(min0), message: { role: 'user', content: prompt } }];
  for (let i = 0; i < n; i++) {
    const m = min0 - ((min0 - min1) * (i + 1)) / n;
    recs.push(...[{ type: 'text', text: `step ${i}` }, { type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }].map((b, j) => ({ ...base, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-a${i}-${j}`,
      timestamp: at(m), requestId: `${agentId}-r${i}`, message: { role: 'assistant', model, content: [b], usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 } } })));
  }
  recs.push({ ...base, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-end`, timestamp: at(min1), requestId: `${agentId}-rf`, message: { role: 'assistant', model, content: [{ type: 'text', text: blocked ? 'task blocked' : 'final result' }], usage: { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } });
  jsonl(path.join(sdir, sid, 'subagents', `agent-${agentId}.jsonl`), recs);
};
sub('po1', 'spec-writer', 59, 45, promptPO, 'claude-opus-5-5', 5);            // finished: 5 req + final = 6 requests
sub('be1', 'builder', 44, 1, promptBE, 'claude-sonnet-5-5', 8);               // active (last record 1 min ago), linked by prompt
sub('dv1', 'provisioner', 43, 42, promptMisc, 'claude-haiku-5-5', 1);         // no change
sub('val9', 'validator', 200, 190, 'Validate the scenarios of openspec/changes/old-change', 'claude-sonnet-5-5', 2); // no visible call

// --- collection -------------------------------------------------------------------
// real mtimes are later than the fixed `now`; set them back so they do not look "active" (the test depended on the clock)
const touchAll = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) touchAll(f); fs.utimesSync(f, new Date(now - 3600e3), new Date(now - 3600e3)); } };
touchAll(tmp);
const st = collect({ projectDir: project, claudeDir: claude, now });
const by = Object.fromEntries(st.changes.map((c) => [c.id, c]));

assert.equal(st.project.mainAgent, 'orchestrator');
assert.deepEqual(st.changes.map((c) => c.id), ['add-invoice', 'fix-login', 'new-idea', 'old-change', '(no change)'], 'order: in progress, blocked, pending, done');
assert.equal(by['add-invoice'].status, 'in progress');
assert.equal(by['fix-login'].status, 'blocked');
assert.equal(by['new-idea'].status, 'pending');
assert.equal(by['old-change'].status, 'done');
assert.equal(by['old-change'].validation, 'APPROVED');
assert.equal(by['add-invoice'].review, 'APPROVED', 'last Result of the review-report');
assert.deepEqual(by['add-invoice'].tasks, { total: 5, done: 2, blocked: 0 });

const inv = by['add-invoice'];
assert.equal(inv.rounds, 2);
assert.deepEqual(inv.runs.map((r) => r.agent), ['spec-writer', 'builder']);
assert.equal(inv.handoffs, 2, 'orchestrator→po, po→backend');
assert.deepEqual(inv.runs.map((r) => [r.from, r.to]), [['orchestrator', 'builder'], ['spec-writer', null]]);
assert.deepEqual(inv.activeAgents.map((a) => a.agent), ['builder']);

const po = inv.runs[0];
assert.equal(po.status, 'finished', 'the Agent tool result proves it ended, not that it succeeded');
assert.equal(po.durationMs, 14 * 60000, 'duration comes from the Agent tool totalDurationMs');
assert.equal(po.usage.requests, 6, 'blocks with the same requestId count once');
assert.equal(po.usage.total, 6 * 1120 - 1120 + 111, 'deduplicated token sum');
assert.equal(po.model, 'opus-5-5');
assert.equal(po.stage, 'spec', 'stage inferred from the prompt');
// tokens per change and per agent
assert.equal(inv.tokens, po.usage.total + inv.runs[1].usage.total, 'change total = sum of the runs');
assert.deepEqual(inv.agents.map((a) => [a.agent, a.runs, a.tokens]).sort(), [['builder', 1, inv.runs[1].usage.total], ['spec-writer', 1, po.usage.total]].sort());
assert.equal(inv.runs[1].usage.total, 8 * 1120 + 111, '8 requests of 1120 tokens plus the final one, repeated blocks counted once');
assert.equal(inv.runs[1].stage, 'section 1 (Backend)', 'stage inferred from the prompt');
// fresh tokens (input + output + cache creation) separate from cache read
{
  const be = inv.runs[1].usage;
  assert.ok(be.input > 0 && be.output > 0 && be.cacheRead > 0 && be.cacheCreation > 0, 'raw fields separate in usage');
  assert.equal(inv.runs[1].tokenSplit.fresh, be.input + be.output + be.cacheCreation, 'fresh excludes cache read');
  assert.equal(inv.runs[1].tokenSplit.cached, be.cacheRead);
  assert.equal(inv.tokenSplit.fresh + inv.tokenSplit.cached, inv.tokens, 'fresh + cache read = change total');
  assert.equal(inv.tokenSplit.cached, po.usage.cacheRead + be.cacheRead, 'change cache read = sum of the runs');
  assert.ok(inv.tokenSplit.cached > inv.tokenSplit.fresh, 'the fixture has dominant cache read');
  for (const k of ['input', 'output', 'cacheRead', 'cacheCreation']) assert.equal(typeof inv.tokenSplit[k], 'number', k);
  const ag = inv.agents.find((x) => x.agent === 'builder');
  assert.equal(ag.tokenSplit.fresh, inv.runs[1].tokenSplit.fresh, 'per agent in the change');
  assert.equal(ag.tokenSplit.cached, be.cacheRead);
  assert.equal(inv.activeAgents[0].tokenSplit.cached, be.cacheRead, 'active agents of the change');
  assert.equal(st.running[0].tokenSplit.cached, be.cacheRead, 'agents now');
  const eff0 = st.agents.find((x) => x.agent === 'builder');
  assert.equal(eff0.tokenSplit.fresh + eff0.tokenSplit.cached, eff0.tokens, 'effort per agent');
  assert.equal(st.totals.tokenSplit.fresh + st.totals.tokenSplit.cached, st.totals.tokens, 'grand total');
}
// agents now and recent
assert.deepEqual(st.running.map((r) => [r.agent, r.change]), [['builder', 'add-invoice']]);
assert.equal(st.running[0].since, now - 44 * 60000);
assert.ok(st.recent.length && st.recent.every((r) => r.status !== 'running' && r.status !== 'done'));
assert.equal(st.changes.some((c) => /[-._]$/.test(c.id)), false, 'a folder glob does not become a change');
assert.equal(inv.waiting.text, 'waiting to run task 1.2 (Backend)');
assert.equal(inv.startedAt, now - 59 * 60000, 'start = first attributed agent run');
assert.equal(inv.startSource, 'first agent run');
assert.deepEqual(inv.files, ['tasks.md', 'review-report.md']);
assert.equal(po.totalTokensReported, 5000);

const be = inv.runs[1];
assert.equal(be.active, true);
assert.equal(be.status, 'running');
assert.equal(be.background, true);
assert.equal(be.linked, true, 'linked by the agentId of the async launch');
assert.equal(be.end, null, 'async_launched with agentId is not an end');
assert.equal(be.id, 'be1');
assert.equal(be.durationMs, 44 * 60000, 'active: now − start');
assert.equal(be.model, 'sonnet-5-5');

const misc = by['(no change)'];
assert.equal(misc.status, 'ad-hoc');
assert.equal(misc.runs.length, 1);
assert.equal(misc.runs[0].model, 'haiku', 'the Agent tool model beats the transcript one');

// trail stage and task per run; trail per change
assert.deepEqual(inv.runs.map((r) => r.flow), ['spec', 'build']);
assert.deepEqual([inv.runs[1].task, inv.runs[1].taskSection], [null, 'Backend'], 'only "section 1 (Backend)": no task id');
assert.equal(inv.runs[0].task, null);
assert.equal(misc.trail, null, 'ad-hoc runs have no trail');
{
  const t = inv.trail;
  assert.deepEqual(t.steps.map((x) => x.key), ['spec', 'approval', 'build', 'review', 'fix', 'validation', 'integration']);
  assert.deepEqual(t.steps.map((x) => x.state), ['done', 'done', 'active', 'done', 'done', 'pending', 'pending']);
  assert.equal(t.current, 'build', 'the active run rules');
  assert.deepEqual([t.rounds, t.delegations], [2, 2]);
  assert.deepEqual(t.loops, { review: 2, fix: 1 }, 'review-report with 2 rounds, 1 CHANGES REQUESTED');
  assert.equal(t.steps[3].times, 2);
  assert.equal(t.steps[4].times, null, 'only one loop: no ×N');
  assert.deepEqual(t.steps[2].agents, [{ agent: 'builder', state: 'on', runs: 1 }]);
  assert.deepEqual(t.steps[2].tasks, { done: 2, total: 5 });
  assert.equal(t.next.key, 'validation');
  assert.equal(t.after.key, 'integration');
  assert.deepEqual(t.steps[5].agents, [{ agent: 'validator', state: 'wait', runs: 0 }], 'the next stage shows who comes in, queued');
}
assert.deepEqual(by['new-idea'].trail.steps.map((x) => x.state), ['done', 'done', 'active', 'pending', 'pending', 'pending', 'pending'], 'no agent: stage from the "waiting"');
assert.equal(by['new-idea'].trail.current, 'build');
assert.equal(by['old-change'].trail.steps.every((x) => x.state === 'done' || x.key === 'fix'), true, 'archived: all done');
assert.equal(by['old-change'].trail.steps[4].state, 'pending', 'archived without a fix');
assert.equal(by['old-change'].runs[0].flow, null, 'an unknown agent does not enter the trail');

const old = by['old-change'];
assert.equal(old.runs.length, 1, 'a subagent without a visible call still shows up');
assert.equal(old.runs[0].agent, 'unknown', 'without a call or hook there is no way to know the type');
assert.deepEqual(st.unlinked, ['val9']);

const eff = Object.fromEntries(st.agents.map((a) => [a.agent, a]));
assert.ok(eff['orchestrator'], 'the main session counts as orchestrator');
assert.equal(eff['orchestrator'].tokens, 4 * 1110, 'deduplicated main session usage');
assert.equal(eff['builder'].active, true);
assert.equal(eff['spec-writer'].runs, 1);
assert.ok(eff['builder'].durationMs > eff['provisioner'].durationMs);
assert.equal(st.totals.active, 1);

// the optional hook refines the end
w(path.join(project, '.claude/ai-team/events.jsonl'), JSON.stringify({ ts: at(2), event: 'SubagentStop', agent_id: 'be1', agent_type: 'builder' }) + '\n');
const st2 = collect({ projectDir: project, claudeDir: claude, now });
const be2 = st2.changes.find((c) => c.id === 'add-invoice').runs[1];
assert.equal(be2.active, false, 'SubagentStop ends the run');
assert.equal(be2.end, now - 2 * 60000);
assert.equal(st2.changes.find((c) => c.id === 'add-invoice').status, 'in progress', 'half-done tasks stay in progress');

// live session: a delegation without a result stays active even with an old transcript
fs.rmSync(path.join(project, '.claude/ai-team'), { recursive: true, force: true });
const later = now + 60 * 60000;
const st4a = collect({ projectDir: project, claudeDir: claude, now: later });
assert.equal(st4a.changes.find((c) => c.id === 'add-invoice').runs[1].active, false, 'without a live session, 61 min without writing = ended');
w(path.join(claude, 'sessions', '1.json'), JSON.stringify({ pid: process.pid, sessionId: sid }));
w(path.join(claude, 'sessions', '2.json'), JSON.stringify({ pid: 999999, sessionId: 'dead' }));
const st4b = collect({ projectDir: project, claudeDir: claude, now: later });
const r4b = st4b.changes.find((c) => c.id === 'add-invoice').runs[1];
assert.equal(r4b.active, false, 'a live session is not enough: no transcript activity for 60 min = no signal');
assert.equal(r4b.status, 'no signal');
assert.ok(r4b.silentMs >= 59 * 60000, 'no signal for X');
assert.equal(st4b.changes.find((c) => c.id === 'old-change').runs[0].active, false, 'a subagent without a call follows the window');
assert.equal(st4b.mainRuns[0].live, true);

// project without transcripts
const st3 = collect({ projectDir: path.join(tmp, 'none'), claudeDir: claude, now });
assert.equal(st3.changes.length, 0);
assert.equal(st3.agents.length, 0);

// --- /team and /agents/<name>.md routes --------------------------------------
{
  const { spawn } = await import('node:child_process');
  const dash = path.join(tmp, 'dash'); fs.mkdirSync(dash);
  const srv = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'dashboard');
  // installed copy: everything from dashboard/ (except the profile cycle.html, which the override test adds later)
  for (const f of fs.readdirSync(srv)) if (/\.(mjs|html|sh)$/.test(f) && f !== 'cycle.html') fs.copyFileSync(path.join(srv, f), path.join(dash, f));
  w(path.join(project, '.claude/agents/orchestrator.md'), '# orchestrator\n');
  const run = async (port, fn) => {
    const p = spawn(process.execPath, [path.join(dash, 'server.mjs'), '--project', project, '--claude-dir', claude, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await new Promise((ok) => p.stdout.once('data', ok));
      await fn(`http://127.0.0.1:${port}`);
    } finally { p.kill(); await new Promise((r) => p.once('exit', r)); }
  };
  w(path.join(project, 'openspec/changes/add-invoice/specs/invoice/spec.md'), '# spec invoice\n');
  w(path.join(tmp, 'outside.md'), 'secret');
  fs.symlinkSync(path.join(tmp, 'outside.md'), path.join(project, 'openspec/changes/add-invoice/leak.md'));
  await run(43211, async (b) => {
    const t = await fetch(`${b}/changes/add-invoice/tasks.md`);
    assert.equal(t.status, 200);
    assert.match(t.headers.get('content-type'), /^text\/plain; charset=utf-8/);
    assert.match(await t.text(), /## 1\. Backend/);
    assert.equal((await fetch(`${b}/changes/add-invoice/specs/invoice/spec.md`)).status, 200);
    assert.equal((await fetch(`${b}/changes/old-change/tasks.md`)).status, 200, 'archived change');
    for (const bad of ['..%2F..%2F.claude%2Fsettings.json', '%2e%2e/%2e%2e/.claude/settings.json', '..%5C..%5Ctasks.md', 'tasks.md%00', 'leak.md', 'notes.txt', '.md', 'specs/..%2F..%2Ftasks.md', 'specs/%2e%2e/tasks.md.bak'])
      assert.equal((await fetch(`${b}/changes/add-invoice/${bad}`)).status, 404, `refuses ${bad}`);
    for (const bad of ['..%2Fadd-invoice/tasks.md', '..%2F..%2F/tasks.md', 'archive/tasks.md', 'does-not-exist/tasks.md'])
      assert.equal((await fetch(`${b}/changes/${bad}`)).status, 404, `refuses id ${bad}`);
    assert.equal((await fetch(`${b}/changes/add-invoice`)).status, 404);
    const state = await (await fetch(`${b}/api/state`)).json();
    assert.ok(state.changes.find((c) => c.id === 'add-invoice').files.includes('specs/invoice/spec.md'));
    assert.equal((await fetch(`${b}/team`)).status, 200, '/team exists in any profile');
    const a = await fetch(`${b}/agents/orchestrator.md`);
    assert.equal(a.status, 200);
    assert.match(a.headers.get('content-type'), /^text\/plain; charset=utf-8/);
    assert.match(await a.text(), /# orchestrator/);
    assert.equal((await fetch(`${b}/agents/does-not-exist.md`)).status, 404);
    for (const bad of ['..%2F..%2Fsettings.json', '%2e%2e/x', 'Spec_Writer', 'a.b']) assert.equal((await fetch(`${b}/agents/${bad}.md`)).status, 404, `refuses ${bad}`);
    assert.equal((await fetch(`${b}/agents/..%2F..%2Fsettings.json`)).status, 404);
  });
  fs.writeFileSync(path.join(dash, 'cycle.html'), '<h1>profile cycle</h1>');
  await run(43212, async (b) => {
    const r = await fetch(`${b}/team`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<h1>profile cycle<\/h1>/);
    assert.equal((await fetch(`${b}/team`, { method: 'HEAD' })).status, 200);
  });
}

if (process.env.KEEP_FIXTURE) console.log(`fixture kept: --project ${project} --claude-dir ${claude}`);
else fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ dashboard: collector ok');
