// Tests of the phone layout (dashboard/mobile.mjs): what each screen shows from /api/state.
import assert from 'node:assert/strict';
import { topHtml, homeHtml, inboxHtml, eventsHtml, changeHtml, moreHtml, navHtml, inboxCount, sessionHtml, notifyHtml } from '../dashboard/mobile.mjs';
import { sessionsNow } from '../dashboard/shell.mjs';

const fmt = { usd: (n) => `$${n}`, dur: () => '1m', time: () => '12:00', tok: (n) => `${n}t` };
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
    ch('red', { tests: { ok: false, failed: 2, parts: [{ ok: false, cmd: 'npm test', failures: ['card > drags'], excerpt: 'expected 3 to be 4' }] } }),
    ch('later', { tasks: { total: 4, done: 0, blocked: 0 } }),
  ],
  board: { stuck: ['watch-flake'], running: ['add-x', 'red'], blocked: [], pending: ['later'], done: ['d1'], doneOlder: [], other: ['adhoc:a', 'adhoc:b'] },
  pending: [{ id: 'p1', kind: 'permission', tool: 'Bash', summary: 'git push', agentType: 'builder', ts: 1 }, { id: 'q1', kind: 'question', questions: [{ question: 'Keep it?' }], ts: 2 }],
  running: [{ id: 'main:s1', main: true, agent: 'orchestrator', sessionId: 's1', sessionName: 'Theme layers', change: 'add-x', stage: 'Build', since: 1, lastActivity: Date.now() - 60e3, status: 'running', usd: 3, tokenSplit: { fresh: 100, cached: 900 } },
    { id: 'r1', agent: 'builder', sessionId: 's1', change: 'add-x', stage: 'build', description: 'build 1.2', since: 5, lastActivity: Date.now(), status: 'running', usd: 1, tokenSplit: { fresh: 10, cached: 20 } },
    { id: 'main:s2', main: true, agent: 'orchestrator', sessionId: 's2', sessionName: 'Old one', since: 1, lastActivity: Date.now() - 5 * 3600e3, status: 'running', usd: 0, tokenSplit: { fresh: 0, cached: 0 } }],
  recent: [{ id: 'v1', agent: 'validator', sessionId: 's1', description: 'validate', end: 9, usd: 0.5, status: 'finished' }],
  mainRuns: [{ sessionId: 's1', model: 'opus-5-5', gitBranch: 'main' }],
  timeline: { since: 0, groups: [{ change: 'add-x', items: [{ ts: 10, level: 'info', text: 'started' }, { ts: 30, level: 'ok', text: 'tests green' }] }, { change: null, items: [{ ts: 20, level: 'warn', text: 'question' }] }] },
  away: { on: false },
};

assert.equal(inboxCount(state), 4, 'two decisions, one stuck, one red-test change');
assert.equal(inboxCount({ error: 'x' }), 0);

{ const t = topHtml(state, { conn: { cls: 'ok', text: '● live', cost: '$12 est.' } });
  assert.match(t, /<b class="ok">3<\/b> running/); assert.match(t, /⎇ main/); assert.match(t, /● live/); }
assert.match(topHtml(state, { conn: {}, change: state.changes[1] }), /data-m-back[\s\S]*watch-flake[\s\S]*stuck/, 'a change: back arrow, its id, stuck badge');

{ const h = homeHtml(state, { fmt });
  assert.ok(h.indexOf('id="m-decslot"') >= 0 && h.indexOf('id="m-decslot"') < h.indexOf('Sessions'), 'decisions first, answered in place (the forms move in)');
  assert.match(h, /Decisions<\/span> <b class="warn">2<\/b>/); assert.match(h, /Stuck <b class="bad">1<\/b>/); assert.match(h, /stuck · usage limit/);
  assert.match(h, /Sessions <b>1<\/b>/, 'the quiet session folds away'); assert.match(h, /1 subagent working/);
  assert.match(h, /data-m-sess="s1"[\s\S]*Theme layers/); assert.match(h, /1 quiet session \(1 h\+\)[\s\S]*Old one/);
  assert.match(h, /Changes <b>3<\/b>/); assert.match(h, /data-m-change="later"[^>]*><span class="dot" style="background:var\(--warn\)/, 'pending in yellow');
  assert.match(h, /class="m-prog"/, 'tasks progress on the row');
  assert.match(h, /1 done · 2 ad-hoc · \$12 est\./, 'the long tail in one line'); }
assert.match(homeHtml({ ...state, pending: [], board: { ...state.board, stuck: [] } }, { fmt }), /Nothing waits for you/);

{ const h = inboxHtml(state);
  assert.match(h, /id="m-decslot"/, 'the decision forms are moved in, not rebuilt');
  assert.match(h, /stuck: usage limit/); assert.match(h, /data-copy="\/team resume watch-flake"/); assert.match(h, /tests ✗ 2 failed/);
  assert.match(h, /✗ card &gt; drags/); assert.match(h, /expected 3 to be 4/, 'what failed, on the phone too'); }

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
  if (c.runs.length) { const o = changeHtml(state, c, { seg: 'output', fmt }); assert.match(o, /id="molist"/, 'the Output segment: a list the page fills from \/api\/tail'); assert.match(o, /data-m-seg="output"/); }
  { const info = changeHtml({ ...state }, { ...c, sections: { 'Backend': { total: 2, done: 1 } }, review: 'APPROVED', testHistory: [{ ok: false }, { ok: true }], agents: [{ agent: 'builder', runs: 2, durationMs: 1, usd: 1, active: true }] }, { seg: 'info', fmt });
    assert.match(info, /Progress[\s\S]*Backend[\s\S]*1\/2/); assert.match(info, /m-v ok">APPROVED/); assert.match(info, /m-tdots"><i class="bad"><\/i><i class="ok">/);
    assert.match(info, /Agents[\s\S]*builder[\s\S]*2 runs/); assert.match(info, /desktop view/); } }
{ const h = changeHtml(state, state.changes[1], { fmt });
  assert.match(h, /builder failed/); assert.match(h, /Copy command/); assert.doesNotMatch(h, /data-m-seg="tasks"/, 'no tasks.md tasks: no Tasks segment'); }

{ const h = moreHtml(state, { away: true, theme: 'light', themes: ['auto', 'light'], agents: ['builder', 'reviewer'] });
  assert.match(h, /m-sw on/); assert.match(h, /<option selected>light/); assert.match(h, /dot on[\s\S]*builder/); assert.match(h, /\/w\/app/); }
{ const s = sessionsNow(state).find((x) => x.sessionId === 's1'), h = sessionHtml(s, { fmt });
  assert.match(h, /working · 1 subagent/); assert.match(h, /data-m-change="add-x"/); assert.match(h, /Working now <b>1<\/b>[\s\S]*builder[\s\S]*build 1\.2/);
  assert.match(h, /data-m-out="add-x"/, 'Output follows the change'); assert.match(h, /Finished earlier <b>1<\/b>[\s\S]*validator/);
  assert.match(h, /opus-5-5/); assert.match(h, /\$3 <span class="sub">\(\+\$1\)/); assert.match(h, /data-copy="claude --resume s1"/);
  assert.match(topHtml(state, { conn: {}, title: 'Theme layers' }), /data-m-back[\s\S]*Theme layers/); }
{ const view = { topic: 'ai-team-x', server: 'https://ntfy.sh', hasToken: false, dashboardUrl: '', events: ['decision', 'agent_stop'], on: ['decision'], detail: true, publicTopic: true, quietAtComputer: false, project: { dir: '/w' } };
  const h = notifyHtml(view, { away: true });
  assert.match(h, /data-m-away aria-pressed="true"/); assert.match(h, /data-m-set="topic" value="ai-team-x"/);
  assert.match(h, /data-m-set="on:decision" checked/); assert.match(h, /data-m-set="on:agent_stop">/); assert.doesNotMatch(h, /on:turn_stop/, 'only the events the server offers');
  assert.match(h, /Public topic, no token[\s\S]*data-m-act="content-off"/); assert.match(h, /data-m-act="test"/); assert.match(h, /id="setmsg"/);
  assert.match(notifyHtml(null, { away: false }), /loading/);
  assert.match(moreHtml(state, { away: false, theme: 'auto', themes: ['auto'], agents: [] }), /data-m-go="notify"/, 'More opens the phone settings, not the old page'); }
assert.match(navHtml('inbox', 4), /class="cur" data-m-go="inbox" aria-current="page"[\s\S]*<span class="b">4<\/span>/);
assert.doesNotMatch(navHtml('home', 0), /class="b"/);
assert.doesNotMatch(homeHtml({ ...state, changes: [...state.changes, ch('x"><img src=y>')], board: { ...state.board, pending: ['x"><img src=y>'] } }, { fmt }), /<img/, 'ids are escaped');
console.log('✓ mobile ok');
