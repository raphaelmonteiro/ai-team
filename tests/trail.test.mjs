// Change trail tests: stage per run, cited task, states, loops and delegations.
//   node tests/trail.test.mjs
import assert from 'node:assert/strict';
import { inferTask, flowOf } from '../dashboard/board.mjs';
import { buildTrail } from '../dashboard/stages.mjs';

// --- inferTask ---------------------------------------------------------------
const tl = [{ id: '0.1', section: 'Infra' }, { id: '1.2', section: 'Backend (API)' }];
assert.deepEqual(inferTask('Implement task 0.1', '', tl), { id: '0.1', section: 'Infra' });
assert.deepEqual(inferTask('', 'Run task 1.2 of the change', tl), { id: '1.2', section: 'Backend' }, 'parentheses leave the section name');
assert.deepEqual(inferTask('tasks 2.3 to 2.5', '', []), { id: '2.3', section: 'Frontend' }, 'range: the first; section by the digit');
assert.deepEqual(inferTask('', 'Implement section 1. Backend of tasks.md', []), { id: null, section: 'Backend' });
assert.deepEqual(inferTask('section 3', '', []), { id: null, section: 'Validation' });
assert.equal(inferTask('check database', 'Check Postgres', tl), null, 'no task nor section: empty');
assert.equal(inferTask('', '', null), null);

// --- flowOf ------------------------------------------------------------------
const f = (agent, extra = {}, ctx = {}) => flowOf({ agent, ...extra }, { mainAgent: 'orchestrator', ...ctx });
assert.equal(f('spec-writer'), 'spec');
assert.equal(f('spec-writer', { taskSection: 'Process' }), 'integration', 'spec-writer on Process/Documentation tasks');
assert.equal(f('spec-writer', { stage: 'review' }), 'spec', 'a spec-writer prompt citing review does not become review');
assert.equal(f('reviewer'), 'review');
assert.equal(f('validator'), 'validation');
assert.equal(f('builder'), 'build');
assert.equal(f('builder', { description: 'Fixes review findings' }), 'build', 'without a review before, it is not a fix');
assert.equal(f('builder', { description: 'Fixes review findings' }, { afterReview: true }), 'fix');
assert.equal(f('integrator', { description: 'task 2.1' }, { afterReview: true }), 'build', 'after the review, without a fix word');
assert.equal(f('provisioner', { stage: 'archived' }), 'integration');
assert.equal(f('orchestrator'), 'integration');
assert.equal(f('Explore'), null);
assert.equal(f('general-purpose'), null);

// --- buildTrail ---------------------------------------------------------------
const run = (flow, agent, extra = {}) => ({ flow, agent, active: false, start: 1, delegated: true, ...extra });
const view = (extra) => ({ id: 'c', status: 'in progress', archived: false, unknown: false, waiting: { text: 'waiting to run task 1.1 (Backend)' },
  tasks: { total: 4, done: 0, blocked: 0 }, taskList: [{ id: '1.1', done: false, section: 'Backend' }, { id: '3.1', done: false, section: 'Validation' }],
  review: null, reviewRounds: [], validation: null, runs: [], ...extra });
const states = (t) => t.steps.map((s) => s.state[0]).join('');

// ad-hoc
assert.equal(buildTrail({ status: 'ad-hoc', runs: [] }), null);

// ad-hoc task: trail from the runs only (no proposal/approval)
{
  const t = buildTrail({ id: 'adhoc:fix-docs', status: 'ad-hoc', runs: [run('build', 'builder'), run('build', 'integrator'),
    run('build', 'provisioner'), run('review', 'reviewer', { active: true }), run(null, 'Explore')] });
  assert.ok(t.loose);
  assert.deepEqual(t.steps.map((s) => s.key), ['build', 'review', 'fix', 'validation', 'integration']);
  assert.equal(states(t), 'dappp', 'build done, review now, the rest pending');
  assert.deepEqual(t.steps[0].agents.map((a) => a.agent), ['builder', 'integrator', 'provisioner'], 'Explore stays out');
  assert.equal(t.steps[1].agents[0].state, 'on');
  assert.equal(t.current, 'review');
  assert.deepEqual([t.next.key, t.after.key], ['validation', 'integration'], 'fix without a run is skipped');
  assert.ok(t.steps[3].queued && t.steps[3].agents.some((a) => a.agent === 'validator' && a.state === 'wait'));
  assert.equal(t.delegations, 5);
}
{
  const t = buildTrail({ id: 'adhoc:x', status: 'ad-hoc', runs: [run('build', 'builder'), run('review', 'reviewer'), run('fix', 'builder'), run('review', 'reviewer')] }, 'orchestrator');
  assert.equal(states(t), 'dddpp', 'no active run: stages with runs are done');
  assert.equal(t.steps[1].times, 2, 'repeated review');
  assert.equal(t.current, null);
  assert.equal(t.next.key, 'validation');
  assert.deepEqual(buildTrail({ id: 'adhoc:empty', status: 'ad-hoc', runs: [] }).next, { key: 'build', label: 'Build' });
}
assert.equal(buildTrail({ id: '(no change)', status: 'ad-hoc', runs: [run('build', 'provisioner')] }), null, 'no change still has no trail');

// build with active devs; validation queued
{
  const t = buildTrail(view({ runs: [run('spec', 'spec-writer'), run('build', 'builder', { active: true }), run('build', 'provisioner')] }));
  assert.equal(states(t), 'ddapppp');
  assert.equal(t.current, 'build');
  assert.deepEqual(t.steps[2].agents.map((a) => [a.agent, a.state]), [['builder', 'on'], ['provisioner', 'done']]);
  assert.equal(t.steps[2].active, true);
  assert.equal(t.next.key, 'review');
  assert.equal(t.after.key, 'validation', 'fix only comes in if the review asks for it');
  assert.deepEqual(t.steps[3].agents, [{ agent: 'reviewer', state: 'wait', runs: 0 }]);
  assert.equal(t.steps[3].queued, true);
  assert.equal(t.delegations, 3);
}

// review and fix loops: ×N
{
  const rr = ['CHANGES REQUESTED', 'CHANGES REQUESTED', 'APPROVED'];
  const t = buildTrail(view({
    tasks: { total: 2, done: 2, blocked: 0 }, taskList: [{ id: '1.1', done: true, section: 'Backend' }, { id: '3.1', done: false, section: 'Validation' }],
    review: 'APPROVED', reviewRounds: rr, waiting: { text: 'undefined' },
    runs: [run('spec', 'spec-writer'), run('build', 'builder'), run('review', 'reviewer'), run('fix', 'builder'), run('review', 'reviewer'), run('fix', 'builder'), run('review', 'reviewer')],
  }));
  assert.deepEqual(t.loops, { review: 3, fix: 2 });
  assert.equal(t.steps[3].times, 3);
  assert.equal(t.steps[4].times, 2);
  assert.equal(t.steps[3].loop && t.steps[4].loop, true);
  assert.equal(states(t), 'dddddpp', 'validation not approved yet, no current: by evidence');
  assert.equal(t.current, null);
  assert.equal(t.next.key, 'validation');
  assert.equal(t.steps[3].result, 'APPROVED');
  assert.equal(t.delegations, 7);
}

// review asked for changes: fix in progress (no active run)
{
  const t = buildTrail(view({
    tasks: { total: 2, done: 2, blocked: 0 }, taskList: [{ id: '1.1', done: true, section: 'Backend' }],
    review: 'CHANGES REQUESTED', reviewRounds: ['CHANGES REQUESTED'], waiting: { text: 'waiting for fix' },
    runs: [run('build', 'builder'), run('review', 'reviewer')],
  }));
  assert.equal(t.current, 'fix');
  assert.equal(states(t), 'ddddapp');
  assert.equal(t.steps[3].state, 'done');
  assert.equal(t.steps[3].times, null, 'one loop: no ×N');
  assert.equal(t.next.key, 'validation');
}

// waiting for the developer (approval) and no tasks (proposal)
{
  const t = buildTrail(view({ waiting: { text: 'waiting for the developer' }, runs: [run('spec', 'spec-writer')] }));
  assert.equal(states(t), 'dappppp');
  assert.deepEqual(t.steps[1].agents, [{ agent: 'you', state: 'wait', runs: 0 }]);
  assert.equal(t.next.key, 'build');
  const p = buildTrail(view({ tasks: { total: 0, done: 0, blocked: 0 }, taskList: [], waiting: { text: 'undefined' }, runs: [] }));
  assert.equal(p.current, 'spec');
  assert.equal(states(p), 'apppppp');
}

// validation and integration
{
  const t = buildTrail(view({
    tasks: { total: 2, done: 2, blocked: 0 }, taskList: [{ id: '1.1', done: true, section: 'Backend' }, { id: '3.1', done: true, section: 'Validation' }],
    review: 'APPROVED', reviewRounds: ['APPROVED'], validation: 'APPROVED', waiting: { text: 'undefined' }, status: 'done',
    runs: [run('build', 'builder'), run('review', 'reviewer'), run('validation', 'validator')],
  }));
  assert.equal(t.current, 'integration', 'tasks [x] + approved, not archived: left to integrate');
  assert.equal(states(t), 'ddddpda', 'no fix happened: pending');
  assert.deepEqual(t.steps[6].agents, [{ agent: 'orchestrator', state: 'wait', runs: 0 }]);
  assert.equal(t.next, null);
}

// archived
{
  const t = buildTrail(view({ archived: true, status: 'done', waiting: { text: 'nothing (archived)' }, review: 'APPROVED', reviewRounds: ['APPROVED'], validation: 'APPROVED',
    runs: [run('spec', 'spec-writer'), run('build', 'builder'), run('review', 'reviewer'), run('validation', 'validator')] }), 'orchestrator');
  assert.equal(states(t), 'ddddpdd');
  assert.equal(t.current, null);
  assert.equal(t.next, null);
  assert.deepEqual(t.steps[6].agents, [{ agent: 'orchestrator', state: 'done', runs: 0 }]);
}

// no folder in openspec/ (change only cited in the runs): unknown stage, whole trail pending
{
  const base = { id: 'connect-x', status: 'done', archived: false, unknown: true, waiting: { text: 'undefined' }, tasks: { total: 0, done: 0, blocked: 0 }, taskList: [], review: null, reviewRounds: [], validation: null };
  const t = buildTrail({ ...base, runs: [run('spec', 'spec-writer'), run('build', 'builder'), run('integration', 'orchestrator')] });
  assert.equal(t.unknown, true);
  assert.equal(t.current, null);
  assert.equal(t.steps.every((s) => s.state === 'pending'), true, 'finished runs do not become "Integration done"');
  assert.equal(t.steps.every((s) => s.agents.length === 0), true);
  assert.equal(t.next, null);
  const a = buildTrail({ ...base, status: 'in progress', runs: [run('review', 'reviewer', { active: true })] });
  assert.equal(a.steps.every((s) => s.state === 'pending'), true, 'even with an active run the trail stays pending');
  const n = buildTrail({ ...base, runs: [] });
  assert.equal(n.steps.every((s) => s.state === 'pending'), true, 'no runs: all pending, no error');
}
console.log('✓ trail ok');
