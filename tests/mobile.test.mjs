// Tests of the phone layout (dashboard/mobile.mjs): what each screen shows from /api/state.
import assert from 'node:assert/strict';
import { topHtml, homeHtml, inboxHtml, eventsHtml, changeHtml, moreHtml, navHtml, inboxCount } from '../dashboard/mobile.mjs';

const fmt = { usd: (n) => `$${n}`, dur: () => '1m', time: () => '12:00' };
const ch = (id, extra = {}) => ({ id, title: id, tasks: { total: 0, done: 0, blocked: 0 }, activeAgents: [], runs: [], taskList: [], lastActivity: 0, rounds: 0, handoffs: 0, durationMs: 0, usd: 0, ...extra });
const trail = (cur) => ({ current: cur, steps: ['spec', 'approval', 'build', 'review'].map((k, i, a) => ({ key: k, label: k, state: i < a.indexOf(cur) ? 'done' : k === cur ? 'active' : 'pending' })) });
const state = {
  project: { name: 'app', dir: '/w/app', git: { branch: 'main', worktree: null } },
  totals: { usd: 12 },
  changes: [
    ch('add-x', { trail: trail('build'), tasks: { total: 3, done: 1, blocked: 0 }, activeAgents: [{ agent: 'builder', since: 5 }],
      taskList: [{ id: '1.1', done: true, section: 'Backend', deps: { ids: [] }, text: '1.1 a' }, { id: '1.2', done: false, section: 'Backend', deps: { ids: [] }, text: '1.2 b' }, { id: '2.1', done: false, section: 'Frontend', deps: { ids: [] }, text: '2.1 c' }],
      runs: [{ id: 'r1', agent: 'builder', active: true, start: 5, task: '1.2', taskIds: ['1.2'], model: 'sonnet' }] }),
    ch('watch-flake', { trail: trail('build'), stuck: { agent: 'builder', reason: 'usage limit', resume: '/team resume watch-flake' } }),
    ch('red', { tests: { ok: false, failed: 2 } }),
    ch('later', { tasks: { total: 4, done: 0, blocked: 0 } }),
  ],
  board: { stuck: ['watch-flake'], running: ['add-x', 'red'], blocked: [], pending: ['later'], done: ['d1'], doneOlder: [], other: ['adhoc:a', 'adhoc:b'] },
  pending: [{ id: 'p1', kind: 'permission', tool: 'Bash', summary: 'git push', agentType: 'builder', ts: 1 }, { id: 'q1', kind: 'question', questions: [{ question: 'Keep it?' }], ts: 2 }],
  running: [{ agent: 'builder', status: 'running' }],
  timeline: { since: 0, groups: [{ change: 'add-x', items: [{ ts: 10, level: 'info', text: 'started' }, { ts: 30, level: 'ok', text: 'tests green' }] }, { change: null, items: [{ ts: 20, level: 'warn', text: 'question' }] }] },
  away: { on: false },
};

assert.equal(inboxCount(state), 4, 'two decisions, one stuck, one red-test change');
assert.equal(inboxCount({ error: 'x' }), 0);

{ const t = topHtml(state, { conn: { cls: 'ok', text: '● live', cost: '$12 est.' } });
  assert.match(t, /<b class="ok">1<\/b> running/); assert.match(t, /⎇ main/); assert.match(t, /● live/); }
assert.match(topHtml(state, { conn: {}, change: state.changes[1] }), /data-m-back[\s\S]*watch-flake[\s\S]*stuck/, 'a change: back arrow, its id, stuck badge');

{ const h = homeHtml(state, { fmt });
  assert.match(h, /Needs you <b class="warn">3<\/b>/, 'decisions and stuck first');
  assert.match(h, /git push/); assert.match(h, /Keep it\?/); assert.match(h, /stuck · usage limit/);
  assert.match(h, /In progress <b>2<\/b>/); assert.match(h, /builder · <span data-since="5">/);
  assert.match(h, /class="m-dots"/, 'the stage trail as a bar');
  assert.match(h, /1 done · 2 ad-hoc · \$12 est\./, 'the long tail in one line'); }
assert.match(homeHtml({ ...state, pending: [], board: { ...state.board, stuck: [] } }, { fmt }), /Nothing waits for you/);

{ const h = inboxHtml(state);
  assert.match(h, /id="m-decslot"/, 'the decision forms are moved in, not rebuilt');
  assert.match(h, /stuck: usage limit/); assert.match(h, /data-copy="\/team resume watch-flake"/); assert.match(h, /tests ✗ 2 failed/); }

{ const h = eventsHtml(state, 15, { fmtTime: (t) => `t${t}` });
  assert.ok(h.indexOf('tests green') < h.indexOf('question') && h.indexOf('question') < h.indexOf('started'), 'newest first on a phone');
  assert.match(h, /2 new <button type="button" data-seen>/); assert.match(h, /class="m-ev seen"/); }
assert.match(eventsHtml({ ...state, timeline: null }, 0, { fmtTime: String }), /Nothing new/);

{ const c = state.changes[0];
  const h = changeHtml(state, c, { fmt });
  assert.match(h, /build · step 3 of 4/); assert.match(h, /1\/3 tasks/);
  assert.match(h, /<b>builder<\/b> · task 1\.2/);
  assert.match(h, /m-chip cur" data-m-col="doing"/, 'opens on Doing when something runs');
  assert.match(h, /kind k-back/); assert.doesNotMatch(h, />2\.1</, 'one column at a time');
  assert.match(changeHtml(state, c, { col: 'todo', fmt }), />2\.1</);
  assert.match(changeHtml(state, c, { seg: 'events', fmt }), /tests green/);
  assert.match(changeHtml(state, c, { seg: 'info', fmt }), /desktop view/); }
{ const h = changeHtml(state, state.changes[1], { fmt });
  assert.match(h, /builder failed/); assert.match(h, /Copy command/); assert.doesNotMatch(h, /data-m-seg="tasks"/, 'no tasks.md tasks: no Tasks segment'); }

{ const h = moreHtml(state, { away: true, theme: 'light', themes: ['auto', 'light'], agents: ['builder', 'reviewer'] });
  assert.match(h, /m-sw on/); assert.match(h, /<option selected>light/); assert.match(h, /dot on[\s\S]*builder/); assert.match(h, /\/w\/app/); }
assert.match(navHtml('inbox', 4), /class="cur" data-m-go="inbox" aria-current="page"[\s\S]*<span class="b">4<\/span>/);
assert.doesNotMatch(navHtml('home', 0), /class="b"/);
assert.doesNotMatch(homeHtml({ ...state, changes: [...state.changes, ch('x"><img src=y>')], board: { ...state.board, pending: ['x"><img src=y>'] } }, { fmt }), /<img/, 'ids are escaped');
console.log('✓ mobile ok');
