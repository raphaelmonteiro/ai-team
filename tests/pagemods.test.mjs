// The page's render modules (overview.mjs, changetab.mjs, render.mjs) load on their own and draw from plain data:
// the split out of index.html keeps them free of the page's globals.
//   node tests/pagemods.test.mjs
import assert from 'node:assert/strict';
import { boardTable, chOpen, sessionsNowHtml, sessOpen, recentHtml, cardHtml, changeDetail } from '../dashboard/overview.mjs';
import { runsTable, tasksHtml, timeHtml, overviewHtml, chatHtml, stepsLine } from '../dashboard/changetab.mjs';
import { silentTxt, testsBadge, waitHtml, changeLabel } from '../dashboard/render.mjs';

const tok = { fresh: 10, cached: 20 };
const ch = (id, o = {}) => ({ id, title: id, kind: 'change', status: 'in progress', tasks: { total: 2, done: 1, blocked: 0 }, sections: { Backend: { total: 2, done: 1 } },
  activeAgents: [], runs: [], agents: [{ agent: 'builder', runs: 1, durationMs: 60e3, usd: 1, tokenSplit: tok }], taskList: [], rounds: 1, handoffs: 0, durationMs: 60e3,
  tokenSplit: tok, usd: 1, lastActivity: Date.now(), trail: { current: 'build', steps: [{ key: 'spec', label: 'Spec', state: 'done' }, { key: 'build', label: 'Build', state: 'active' }] }, ...o });

{ const h = boardTable([['In progress', [ch('add-x')], true, 'running'], ['Ad-hoc', [ch('adhoc:fix-y', { kind: 'adhoc' })], true, 'adhoc']]);
  assert.match(h, /data-change="add-x"/); assert.match(h, /data-open-change="add-x"/, 'the name links to the tab');
  assert.match(h, /ad-hoc/); assert.match(h, /class="cexp" hidden/, 'details closed');
  chOpen.add('add-x');
  assert.match(boardTable([['In progress', [ch('add-x')], true, 'running']]), /class="cexp">[\s\S]*Progress[\s\S]*Backend/, 'an open row draws its details');
  chOpen.clear(); }
assert.match(changeDetail(ch('add-x', { review: 'APPROVED' }), false), /okc">APPROVED/);
assert.match(cardHtml(ch('add-x')), /data-change="add-x"/);

{ const s = { sessionId: 's1', name: 'Theme', state: 'working', working: 1, change: 'add-x', stage: 'Build', start: 1, last: 2, subs: [{ id: 'r1', agent: 'builder', since: 1, lastActivity: 2, status: 'running', tokenSplit: tok, usd: 1 }], earlier: [], model: 'opus', tokenSplit: tok, usd: 2, subsUsd: 1 };
  const h = sessionsNowHtml([s]);
  assert.match(h, /data-sess="s1"/); assert.match(h, /● 1 working/); assert.match(h, /class="sexp" hidden/);
  sessOpen.add('s1'); assert.match(sessionsNowHtml([s]), /class="sexp">[\s\S]*builder/); sessOpen.clear(); }
assert.match(recentHtml([{ id: 'r9', agent: 'validator', change: 'add-x', status: 'failed', since: 1, end: 2, tokenSplit: tok, usd: 0.5 }]), /data-sess="run:r9"[\s\S]*warnc">failed/);

assert.match(runsTable([{ id: 'r1', agent: 'builder', status: 'no signal', silentMs: 1, usage: { input: 1, output: 1, cacheCreation: 0, requests: 1 }, toolUses: 0, tokenSplit: tok, start: 1, end: 2 }], false, 15), /limit: 15 min/, 'staleMin comes as a parameter');
assert.equal(silentTxt({ status: 'running' }, 15), '');
assert.match(tasksHtml(ch('add-x'), null), /no tasks in tasks\.md/, 'no tasks: the note');
assert.equal(typeof timeHtml, 'function'); assert.equal(typeof overviewHtml, 'function'); assert.equal(typeof chatHtml, 'function');
assert.match(stepsLine(ch('add-x')), /Build/);
assert.match(testsBadge({ ok: true, passed: 3 }), /3 passed/);
assert.match(waitHtml({ text: 'waiting for builder', rule: 'r', source: 'inferred' }), /waiting for builder/);
assert.equal(changeLabel('adhoc:x'), 'ad-hoc · x'); assert.equal(changeLabel(null), '—');
console.log('✓ page modules ok');
