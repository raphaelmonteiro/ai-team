// timeline.mjs tests: what "since you left" lists (rounds, tests, decisions, guard, compaction, stuck, budget,
// declared stage, questions waiting), grouped per change, only after the moment, and the moment itself.
//   node tests/timeline.test.mjs
import assert from 'node:assert/strict';
import { timeline, leftAt } from '../dashboard/timeline.mjs';

const T = Date.parse('2026-11-11T10:00:00Z'), m = (n) => T + n * 60000;
const run = (o) => ({ id: o.id, agent: o.agent, description: o.d || '', start: o.start, end: o.end ?? null, active: !!o.active, status: o.status || (o.active ? 'running' : 'finished'), durationMs: (o.end || m(99)) - o.start, error: o.error || null, summary: o.summary || '', tests: o.tests || null });
const state = {
  changes: [
    { id: 'add-x', kind: 'change', lastActivity: m(50), runs: [
      run({ id: 'r1', agent: 'spec-writer', d: 'create change', start: m(-30), end: m(-10), summary: 'proposal ready\nmore' }),
      run({ id: 'r2', agent: 'builder', d: 'section 1', start: m(5), end: m(40), tests: { ok: false, passed: 10, failed: 2, summary: 'Tests 10 passed, 2 failed', ts: m(38) } }),
      run({ id: 'r3', agent: 'builder', d: 'fix', start: m(41), end: m(50), tests: { ok: true, passed: 12, failed: 0, summary: 'Tests 12 passed', ts: m(49) } }),
      run({ id: 'r4', agent: 'reviewer', d: 'round 1', start: m(51), active: true }),
    ], stuck: null, budget: { size: 'small', limit: 5, usd: 7.456, over: true }, waiting: { source: 'declared', stage: 'review', text: 'waiting for reviewer', since: m(51), note: '' } },
    { id: 'fix-y', kind: 'change', lastActivity: m(20), runs: [run({ id: 'r5', agent: 'integrator', start: m(10), end: m(20), status: 'failed', error: 'Error: API overloaded' })],
      stuck: { at: m(20), agent: 'integrator', kind: 'failed', reason: 'Error: API overloaded', resume: '/team resume fix-y' }, budget: null, waiting: { source: 'inferred', text: 'waiting for task 2.1' } },
    { id: '(no change)', kind: 'no-change', runs: [run({ id: 'r6', agent: 'general-purpose', start: m(2), end: m(3) })], waiting: null },
  ],
  hookEvents: [
    { ts: m(6), event: 'Guard', agent_id: 'r2', agent_type: 'builder', tool: 'Bash', reason: 'ai-team guard (builder): `git add` only by path. See x.', change: 'add-x' },
    { ts: m(30), event: 'Compact', agent_id: 'r2', agent_type: 'builder', trigger: 'auto', change: 'add-x' },
    { ts: m(45), event: 'Decision', agent_id: null, agent_type: null, kind: 'question', question: 'Approve the proposal add-x?', answer: 'Approve', via: 'phone', change: null },
    { ts: m(-5), event: 'Decision', kind: 'permission', tool: 'Bash', question: 'make deploy', answer: 'allowed', via: 'dashboard', change: null },
  ],
  pending: [{ ts: m(55), kind: 'question', tool: 'AskUserQuestion', summary: '', agentType: null }],
  mainRuns: [{ live: true, lastPromptAt: m(0) }, { live: false, lastPromptAt: m(-100) }],
};

{
  const tl = timeline(state, m(0), { now: m(60) });
  assert.equal(tl.since, m(0)); assert.equal(tl.truncated, 0);
  assert.deepEqual(tl.groups.map((g) => g.change), [null, 'add-x', 'fix-y'], 'most recent activity first (the question waiting now is the latest); no-change runs and session-level events outside changes');
  const ax = tl.groups[1].items;
  assert.deepEqual(ax.map((i) => i.kind), ['round_start', 'guard', 'compact', 'tests', 'round_end', 'round_start', 'tests', 'budget', 'round_end', 'round_start', 'stage'], 'chronological (same minute: by kind)');
  assert.equal(ax[0].text, 'builder started: section 1');
  assert.match(ax[1].text, /^guard refused Bash to builder: `git add` only by path/); assert.equal(ax[1].level, 'warn');
  assert.equal(ax[2].text, 'builder compacted its context (auto)');
  assert.equal(ax[3].text, 'tests red: 10 passed, 2 failed (Tests 10 passed, 2 failed)'); assert.equal(ax[3].level, 'bad');
  assert.equal(ax[4].text, 'builder finished after 35min 00s');
  assert.equal(ax[6].text, 'tests green: 12 passed (Tests 12 passed)'); assert.equal(ax[6].level, 'ok');
  assert.equal(ax[7].text, 'over budget: $7.46 of $5 (small)');
  assert.equal(ax[9].text, 'reviewer started: round 1', 'a running round only has its start');
  assert.equal(ax[10].text, 'stage review, waiting for reviewer');
  const out = tl.groups[0].items;
  assert.deepEqual(out.map((i) => i.kind), ['round_start', 'round_end', 'decision', 'waiting']);
  assert.equal(out[2].text, 'you answered from the phone: "Approve the proposal add-x?" → Approve'); assert.equal(out[2].level, 'ok');
  assert.equal(out[3].text, 'question waiting for you'); assert.equal(out[3].level, 'warn');
  const fy = tl.groups[2].items;
  assert.deepEqual(fy.map((i) => [i.kind, i.level]), [['round_start', 'info'], ['round_failed', 'bad'], ['stuck', 'bad']]);
  assert.equal(fy[1].text, 'integrator failed after 10min 00s: Error: API overloaded');
  assert.equal(fy[2].text, 'stuck: Error: API overloaded · /team resume fix-y');
  assert.ok(!tl.groups.flatMap((g) => g.items).some((i) => i.ts <= m(0)), 'nothing from before the moment (the spec-writer round, the earlier decision)');
}
{   // a later moment keeps only what is after it; a limit cuts the oldest
  const tl = timeline(state, m(48), { now: m(60) });
  assert.deepEqual(tl.groups.flatMap((g) => g.items).map((i) => i.kind).sort(), ['budget', 'round_end', 'round_start', 'stage', 'tests', 'waiting'].sort());
  const lim = timeline(state, m(0), { now: m(60), limit: 3 });
  assert.equal(lim.count, 3); assert.ok(lim.truncated > 0);
  assert.deepEqual(timeline({ changes: [], hookEvents: [], pending: [] }, 0).groups, []);
  assert.deepEqual(timeline(null, 0).groups, []);
}
{   // task marks (task.sh) in the log; a time ahead of now (a wrong "since:" in a tasks.md header) is left out
  const st = { changes: [{ id: 'add-x', kind: 'change', runs: [], waiting: { source: 'declared', stage: 'validation', text: 'waiting for validator', since: m(300) },
    taskMarks: [{ ts: m(10), action: 'start', change: 'add-x', tasks: ['2.1'], agent: 'builder' }, { ts: m(20), action: 'done', change: 'add-x', tasks: ['2.1', '2.2'], agent: 'builder' },
      { ts: m(25), action: 'bogus', change: 'add-x', tasks: ['2.3'] }, { ts: m(-5), action: 'start', change: 'add-x', tasks: ['1.1'], agent: 'builder' }] }],
    hookEvents: [{ ts: m(26), event: 'SubagentStart', agent_type: 'x' }], pending: [] };
  const tl = timeline(st, m(0), { now: m(60) });
  assert.deepEqual(tl.groups[0].items.map((i) => [i.kind, i.text, i.level]), [['task', 'builder started task 2.1', 'info'], ['task', 'builder finished tasks 2.1, 2.2', 'ok']], 'task marks after the moment, no unknown action, no other hook event, no future stage');
  assert.equal(timeline(st, m(0), { now: m(300) }).groups[0].items.length, 3, 'once that time comes, it is listed');
}
{   // the moment you left: the live team session's last prompt wins over an old session's
  assert.equal(leftAt(state), m(0));
  assert.equal(leftAt({ mainRuns: [{ live: false, lastPromptAt: m(-100) }, { live: false, lastPromptAt: m(-50) }] }), m(-50), 'no live session: the latest');
  assert.equal(leftAt({ mainRuns: [] }), null); assert.equal(leftAt({}), null);
}
console.log('✓ timeline ok');
