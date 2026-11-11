// Change trail tests: stage per run, cited task, states, loops and delegations.
//   node tests/trail.test.mjs
import assert from 'node:assert/strict';
import { inferTask, citedTasks, flowOf } from '../dashboard/board.mjs';
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
assert.equal(f('builder', { description: 'Implement task 1.3', promptPreview: 'Run tests/fixtures.sh for openspec/changes/fix-brand-condition' }, { afterReview: true }), 'build', 'fixtures, a path and a change id are not "fix"');
assert.equal(f('builder', { description: 'branch pas-consumer-fix-its' }, { afterReview: true }), 'build', 'a branch name is not "fix"');
assert.equal(f('builder', { promptPreview: 'Address the review findings: fix R1 and R2' }, { afterReview: true }), 'fix');
assert.equal(f('builder', { description: 'Fixing the blocking finding' }, { afterReview: true }), 'fix');
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

// backend-only change: review approved, no validation report and no validator run, left to integrate: Validation is
// skipped (the orchestrator does not call the validator when "3. Validation" has no tasks), Integration stays active
{
  const t = buildTrail(view({ status: 'done', waiting: { text: 'undefined' }, tasks: { total: 2, done: 2, blocked: 0 }, taskList: [{ id: '1.1', done: true, section: 'Backend' }, { id: '1.2', done: true, section: 'Backend' }],
    review: 'APPROVED', reviewRounds: ['APPROVED'], runs: [run('spec', 'spec-writer'), run('build', 'builder'), run('review', 'reviewer')] }));
  assert.equal(states(t), 'ddddpsa', 'validation skipped, not done; integration active (nothing pushed yet)');
  assert.equal(t.steps[5].state, 'skipped'); assert.deepEqual(t.steps[5].agents, []);
  assert.equal(t.current, 'integration'); assert.equal(t.next, null);
}

// a finished run is evidence of its stage (review without a report); build is tasks only, integration the archive only
{
  const t = buildTrail(view({ waiting: { text: 'undefined' }, tasks: { total: 2, done: 2, blocked: 0 }, taskList: [{ id: '1.1', done: true, section: 'Backend' }, { id: '3.1', done: true, section: 'Validation' }],
    runs: [run('spec', 'spec-writer'), run('build', 'builder'), run('review', 'reviewer'), run('integration', 'orchestrator')] }));
  assert.equal(states(t), 'ddddppp', 'review done by the finished run; integration not done by a run');
  assert.equal(t.next.key, 'validation');
  const b = buildTrail(view({ waiting: { text: 'undefined' }, tasks: { total: 2, done: 0, blocked: 0 }, runs: [run('build', 'builder')] }));
  assert.equal(states(b), 'ddppppp', 'a finished builder run is not build evidence');
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
// a stale header: the validator runs while tasks.md still declares review (nobody wrote `validation` when it
// started). The running stage wins when it is later; the header is kept as a warning.
{ const decl = (stage, waiting) => ({ valid: true, stage, waiting, since: 1, note: '' });
  const t = buildTrail(view({ declared: decl('review', 'reviewer'), runs: [run('build', 'builder'), run('review', 'reviewer'), run('validation', 'validator', { active: true })] }));
  assert.equal(t.current, 'validation', 'the running validator wins over the review header');
  assert.equal(t.steps.find((x) => x.key === 'review').state, 'done', 'review is no longer "in progress"');
  assert.equal(t.steps.find((x) => x.key === 'validation').state, 'active');
  assert.deepEqual([t.source, t.staleHeader, t.runningAgent], ['running', 'review', 'validator']);
  assert.match(t.warning, /tasks\.md header still says review · waiting: reviewer/);
  // an earlier stage running does not move the declared one back
  const back = buildTrail(view({ declared: decl('validation', 'validator'), runs: [run('build', 'builder'), run('review', 'reviewer'), run('fix', 'builder', { active: true })] }));
  assert.equal(back.current, 'validation'); assert.equal(back.source, 'declared'); assert.equal(back.staleHeader, undefined);
  // spec or integration runs never override (other roles touch them)
  assert.equal(buildTrail(view({ declared: decl('review', 'reviewer'), runs: [run('integration', 'spec-writer', { active: true })] })).current, 'review');
  // the header and the running agent agree: nothing to warn about
  const ok = buildTrail(view({ declared: decl('validation', 'validator'), runs: [run('validation', 'validator', { active: true })] }));
  assert.deepEqual([ok.current, ok.source, ok.warning], ['validation', 'declared', null]); }

// every task a run cites (tasks kanban): ranges in tasks.md order, lists, unknown ids dropped
{ const L = ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '3.1'].map((id) => ({ id }));
  assert.deepEqual(citedTasks('Implement free-drag tasks 2.1–2.7', '', L), ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7'], 'a range counts for each task in it');
  assert.deepEqual(citedTasks('Fix task 2.3', '', L), ['2.3']);
  assert.deepEqual(citedTasks('tasks 2.2, 2.4 and 2.6', '', L), ['2.2', '2.4', '2.6']);
  assert.deepEqual(citedTasks('tasks 2.1-2.3 e 3.1', '', L), ['2.1', '2.2', '2.3', '3.1'], 'Portuguese "e", ascii dash');
  assert.deepEqual(citedTasks('Review', 'Implement task 2.5 to 2.6 now', L), ['2.5', '2.6'], 'the prompt counts too, and "to"');
  assert.deepEqual(citedTasks('task 9.9', '', L), [], 'an id tasks.md does not know is dropped');
  assert.deepEqual(citedTasks('tasks 1.1–1.3', '', []), ['1.1', '1.2', '1.3'], 'tasks.md not read: numeric range');
  assert.deepEqual(citedTasks('tasks 2.1–2.3 then task 2.2 again', '', L), ['2.1', '2.2', '2.3'], 'no duplicates');
  assert.deepEqual(citedTasks('no task here', '', L), []);
  assert.deepEqual(citedTasks('Task 2.1A', '', [{ id: '2.1a' }]), ['2.1a'], 'case of the letter follows tasks.md');
  assert.deepEqual(citedTasks('New task for add-x: implement 2.5 from tasks.md', '', L), ['2.5'], 'a verb before a known id (a resumed agent\'s message)');
  assert.deepEqual(citedTasks('implement **2.6** now', '', L), ['2.6']);
  assert.deepEqual(citedTasks('implement 9.1 API', '', L), [], 'an id tasks.md does not know');
  assert.deepEqual(citedTasks('implement 2.5', '', []), [], 'no tasks.md: a bare verb + number is not trusted');
  assert.deepEqual(citedTasks('Validate free-drag round 4 (2.6)', '', L), ['2.6'], 'an id in parentheses');
  assert.deepEqual(citedTasks('Review (2.5, 2.6)', '', L), ['2.5', '2.6']);
  assert.deepEqual(citedTasks('Fix (2.5–2.7)', '', L), ['2.5', '2.6', '2.7'], 'a range in parentheses');
  assert.deepEqual(citedTasks('Record (D-16) and (v2.1)', '', L), [], 'decisions and versions are not tasks');
  assert.deepEqual(citedTasks('Validate (2.6)', '', []), [], 'no tasks.md: parentheses are not trusted'); }
console.log('✓ trail ok');
