// Drawer conversation tests: order, separators, fields, verdict color, filter and card.
//   node tests/feed.test.mjs
import assert from 'node:assert/strict';
import { buildFeed, messageOf, verdictClass, verdictParts, filterRuns, cardData, routeOf } from '../dashboard/feed.mjs';

// --- verdict color -----------------------------------------------------------
assert.equal(verdictClass('APPROVED; 0 blocking'), 'ok');
assert.equal(verdictClass('REJECTED: 2 blocking'), 'bad');
assert.equal(verdictClass('CHANGES REQUESTED in 3 places'), 'bad');
assert.equal(verdictClass('changes requested'), 'bad', 'lowercase');
assert.equal(verdictClass('NOT APPROVED'), 'bad', '"not approved" is not green');
assert.equal(verdictClass('first CHANGES REQUESTED, then APPROVED'), 'bad', 'red beats green');
assert.equal(verdictClass('fix applied, gate green'), null);
assert.equal(verdictClass(''), null);
assert.equal(verdictClass(null), null);
assert.deepEqual(verdictParts('Verdict: APPROVED with 2 suggestions'), [{ text: 'Verdict: ', cls: null }, { text: 'APPROVED', cls: 'ok' }, { text: ' with 2 suggestions', cls: null }]);
assert.deepEqual(verdictParts('REJECTED'), [{ text: 'REJECTED', cls: 'bad' }]);
assert.deepEqual(verdictParts('no verdict'), [{ text: 'no verdict', cls: null }]);

// --- feed ---------------------------------------------------------------------
const mk = (id, agent, flow, start, extra = {}) => ({ id, agent, flow, start, end: start + 1000, active: false, from: 'orchestrator', to: 'orchestrator', status: 'finished',
  durationMs: 1000, model: 'sonnet', description: 'does ' + id, summary: 'ok ' + id, promptPreview: 'prompt ' + id, toolUses: 3, background: false,
  usage: { input: 10, output: 5, cacheCreation: 2, requests: 4 }, tokenSplit: { fresh: 17, cached: 900 }, totalTokensReported: null, change: 'c', ...extra });
const runs = [
  mk('d', 'reviewer', 'review', 400, { summary: 'CHANGES REQUESTED' }),
  mk('a', 'spec-writer', 'spec', 100),
  mk('b', 'builder', 'build', 200),
  mk('c', 'provisioner', 'build', 300),
  mk('e', 'builder', 'fix', 500, { active: true, end: null, to: null }),
];
{
  const f = buildFeed(runs);
  assert.deepEqual(f.map((i) => (i.type === 'sep' ? '#' + i.label : i.id)), ['#Spec', 'a', '#Build', 'b', 'c', '#Review', 'd', '#Fix', 'e'], 'oldest on top; separator only when the stage changes');
  assert.equal(f.at(-2).active, true, 'separator of the stage with an active run');
  assert.equal(f[0].active, false);
  assert.equal(f.find((i) => i.id === 'd').verdict, 'bad');
  assert.equal(f.find((i) => i.id === 'a').verdict, null);
  assert.equal(runs[0].id, 'd', 'does not change the original list');
  const none = buildFeed([mk('x', 'validator', null, 1)]);
  assert.equal(none[0].label, 'Other runs', 'run without a stage');
}

// --- filter --------------------------------------------------------------------
{
  assert.equal(filterRuns(runs, null).length, 5);
  assert.deepEqual(filterRuns(runs, 'builder').map((r) => r.id), ['b', 'e']);
  assert.deepEqual(filterRuns(runs, 'you'), []);
  const f = buildFeed(runs, { filter: 'builder' });
  assert.deepEqual(f.map((i) => i.id), ['b', 'e'], 'filtered: messages only, no separators');
  assert.equal(buildFeed(runs, { filter: null }).length, 9, 'clearing the filter brings back the full feed');
}

// --- no field of the runs table is lost ----------------------------------
{
  const m = messageOf(mk('z', 'validator', 'validation', 5, { background: true, status: 'failed', totalTokensReported: 1234 }));
  const table = {            // runsTable column/detail -> message field
    agent: 'agent', 'status (dot)': 'status', background: 'background', change: 'change', from: 'from', to: 'to',
    start: 'start', end: 'end', duration: 'durationMs', fresh: 'fresh', 'cache read': 'cached', 'input/output/cache written/calls': 'usage',
    tools: 'toolUses', model: 'model', what: 'description', reply: 'summary', prompt: 'promptPreview', 'reported tokens': 'totalTokensReported',
  };
  for (const [col, key] of Object.entries(table)) assert.ok(key in m, `table field "${col}" missing from the message (${key})`);
  assert.equal(m.background, true); assert.equal(m.status, 'failed'); assert.equal(m.totalTokensReported, 1234);
  assert.deepEqual(m.usage, { input: 10, output: 5, cacheCreation: 2, requests: 4 });
  assert.equal(m.fresh, 17); assert.equal(m.cached, 900); assert.equal(m.toolUses, 3); assert.equal(m.model, 'sonnet');
  const active = messageOf(mk('y', 'validator', 'validation', 5, { active: true, end: 99, to: null }));
  assert.equal(active.end, null, 'an active run has no end'); assert.equal(active.to, null); assert.equal(active.presence, 'on');
}

// --- card ----------------------------------------------------------------------
{
  const c = { runs, trail: { delegations: 5, steps: [{ agents: [{ agent: 'validator', state: 'wait', runs: 0 }, { agent: 'you', state: 'done', runs: 0 }] }] } };
  const be = cardData(c, 'builder');
  assert.equal(be.presence, 'on'); assert.equal(be.since, 500); assert.equal(be.rounds, 2); assert.equal(be.fresh, 34); assert.equal(be.cached, 1800);
  assert.equal(be.role, 'build · fix'); assert.equal(be.what, 'does e'); assert.equal(be.lastReturn, 'ok e');
  const cr = cardData(c, 'reviewer');
  assert.equal(cr.presence, 'done'); assert.equal(cr.endAt, 1400); assert.equal(cr.verdict, 'bad'); assert.equal(cr.verdictText, 'CHANGES REQUESTED');
  assert.equal(cardData(c, 'validator').presence, 'wait', 'queued');
  assert.equal(cardData(c, 'you').presence, 'done');
  const tl = cardData(c, 'orchestrator', { mainLive: true });
  assert.equal(tl.presence, 'on'); assert.equal(tl.rounds, 5); assert.equal(tl.isMain, true);
}
// --- "called by" label and neighborhood ----------------------------------------------
{
  const r = (from, to) => ({ from, to });
  assert.deepEqual(routeOf(r('orchestrator', 'spec-writer')), { by: 'orchestrator', around: 'after: spec-writer' }, 'the agent never "returns" to the next one');
  assert.deepEqual(routeOf(r('validator', 'provisioner')), { by: 'validator', around: 'before: validator · after: provisioner' });
  assert.deepEqual(routeOf(r('orchestrator', 'orchestrator')), { by: 'orchestrator', around: '' }, 'neither previous nor next: no secondary line');
  assert.deepEqual(routeOf(r('orchestrator', null)), { by: 'orchestrator', around: '' }, 'active without a next one');
  assert.equal(routeOf(r('builder', null)).around, 'before: builder');
  assert.equal(routeOf(r('x', 'y'), 'x').around, 'after: y', 'configurable orchestrator');
  const m = messageOf({ ...mk('q', 'validator', 'validation', 5), from: 'reviewer', to: 'orchestrator' });
  assert.deepEqual(m.route, { by: 'reviewer', around: 'before: reviewer' });
  const card = cardData({ runs: [{ ...mk('q', 'validator', 'validation', 5), from: 'orchestrator', to: 'provisioner' }], trail: { steps: [] } }, 'validator');
  assert.deepEqual(card.route, { by: 'orchestrator', around: 'after: provisioner' });
}
console.log('✓ conversation ok');
