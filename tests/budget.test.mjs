// budget.mjs tests: a change over budget notifies once (the notice file), a change back under is forgotten,
// an unconfigured or switched-off notification is not retried every tick, a failing notice never throws.
//   node tests/budget.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { budgetAlerts, noticeFile } from '../dashboard/budget.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-budget-'));
const change = (id, usd, limit, extra = {}) => ({ id, usd, waiting: { text: 'waiting for reviewer' }, budget: limit ? { size: 'small', limit, usd, over: usd > limit } : null, ...extra });
const calls = [];
const notifyFn = async (event, data) => { calls.push([event, data.id, data.budget.usd, data.stage]); return { sent: true }; };

let st = { changes: [change('a', 12, 10), change('b', 3, 10), change('c', 50, 40)] };
assert.deepEqual(await budgetAlerts(st, tmp, { notifyFn }), ['a', 'c']);
assert.deepEqual(calls, [['budget', 'a', 12, 'waiting for reviewer'], ['budget', 'c', 50, 'waiting for reviewer']]);
assert.deepEqual(JSON.parse(fs.readFileSync(noticeFile(tmp), 'utf8')), { a: 12, c: 50 });
calls.length = 0;
st = { changes: [change('a', 15, 10), change('b', 3, 10), change('c', 50, 40)] };
assert.deepEqual(await budgetAlerts(st, tmp, { notifyFn }), [], 'already notified: silent even as the cost grows');
assert.equal(calls.length, 0);
// the limit was raised: "a" is back under and forgotten; over it again later, it notifies again
st = { changes: [change('a', 15, 20), change('c', 50, 40)] };
await budgetAlerts(st, tmp, { notifyFn });
assert.deepEqual(JSON.parse(fs.readFileSync(noticeFile(tmp), 'utf8')), { c: 50 });
st = { changes: [change('a', 25, 20), change('c', 50, 40)] };
assert.deepEqual(await budgetAlerts(st, tmp, { notifyFn }), ['a']);
// a change that vanished from the state keeps its record (archived changes stay in the state anyway)
await budgetAlerts({ changes: [change('c', 50, 40)] }, tmp, { notifyFn });
assert.deepEqual(JSON.parse(fs.readFileSync(noticeFile(tmp), 'utf8')), { c: 50, a: 25 });
// no config / event off: recorded as done, not retried; a throwing notice is swallowed and retried next time
const t2 = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-budget2-'));
assert.deepEqual(await budgetAlerts({ changes: [change('x', 9, 5)] }, t2, { notifyFn: async () => ({ sent: false, reason: 'no config' }) }), ['x']);
assert.deepEqual(await budgetAlerts({ changes: [change('x', 9, 5)] }, t2, { notifyFn: async () => { throw new Error('boom'); } }), []);
const t3 = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-budget3-'));
assert.deepEqual(await budgetAlerts({ changes: [change('y', 9, 5)] }, t3, { notifyFn: async () => { throw new Error('boom'); } }), [], 'failed send: nothing recorded');
assert.deepEqual(await budgetAlerts({ changes: [change('y', 9, 5)] }, t3, { notifyFn: async () => ({ sent: false, reason: 'ECONNREFUSED' }) }), [], 'send failed: not recorded, tries again');
assert.ok(!fs.existsSync(noticeFile(t3)));
assert.deepEqual(await budgetAlerts(null, t3, { notifyFn }), []); assert.deepEqual(await budgetAlerts({ changes: [] }, t3, { notifyFn }), []);
for (const d of [tmp, t2, t3]) fs.rmSync(d, { recursive: true, force: true });
console.log('✓ budget alerts ok');
