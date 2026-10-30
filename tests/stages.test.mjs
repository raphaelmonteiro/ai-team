// Tests of the "waiting" -> flow stage mapping (/team).
//   node tests/stages.test.mjs
import assert from 'node:assert/strict';
import { stageOf, stageCounts } from '../dashboard/stages.mjs';

const v = (text, extra = {}) => ({ id: 'c', status: 'in progress', archived: false, waiting: { text }, ...extra });

assert.equal(stageOf(v('waiting for the developer')), 'you');
assert.equal(stageOf(v('waiting to run task 0.1 (Infra)')), 'build');
assert.equal(stageOf(v('waiting to run task 1.2 (Backend)')), 'build');
assert.equal(stageOf(v('waiting to run task 2.1 (Frontend)')), 'build');
assert.equal(stageOf(v('waiting to run task 3.2 (Validation)')), 'validation');
assert.equal(stageOf(v('waiting to run task 4.2 (Process)')), 'spec');
assert.equal(stageOf(v('waiting to run task 5.1 (Documentation)')), 'spec');
assert.equal(stageOf(v('waiting to run task (unnumbered)')), 'build');
assert.equal(stageOf(v('waiting for task 1.1, 1.2')), 'build');
assert.equal(stageOf(v('waiting for fix')), 'fix');
assert.equal(stageOf(v('waiting for review')), 'review');
assert.equal(stageOf(v('undefined', { status: 'done' })), 'integration');
assert.equal(stageOf(v('undefined')), 'unknown');
assert.equal(stageOf(v('waiting for something new')), 'unknown');
// outside the flow
assert.equal(stageOf(v('nothing (archived)', { archived: true, status: 'done' })), null);
assert.equal(stageOf({ id: 'x', status: 'ad-hoc', waiting: null }), null);
assert.equal(stageOf(null), null);

const r = stageCounts([
  v('waiting to run task 1.1 (Backend)', { id: 'a' }),
  v('waiting to run task 0.1 (Infra)', { id: 'b' }),
  v('undefined', { id: 'c' }),
  v('waiting for the developer', { id: 'd' }),
  { id: 'e', status: 'ad-hoc', waiting: null },
]);
assert.deepEqual(r.changes.build, ['a', 'b']);
assert.equal(r.counts.build, 2);
assert.equal(r.counts.unknown, 1);
assert.equal(r.counts.you, 1);
assert.equal(r.counts.validation, 0);
console.log('stages ok');
