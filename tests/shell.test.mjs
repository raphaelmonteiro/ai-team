// Tests of the dashboard's IDE shell (dashboard/shell.mjs): explorer grouping, tree HTML and the layout kept per browser.
import assert from 'node:assert/strict';
import { explorerGroups, treeHtml, loadLayout, saveLayout, clampSide, clampPanel, DEFAULT_FOLDED, placeTab, afterClose, problemsList, eventsLog, kindOf, taskBoard, timeBoard, roundTime, markIntervals, markedTime } from '../dashboard/shell.mjs';

const ch = (id, extra = {}) => ({ id, title: id, tasks: { total: 0, done: 0, blocked: 0 }, activeAgents: [], lastActivity: 0, ...extra });
const state = {
  changes: [
    ch('add-invoice', { tasks: { total: 12, done: 7, blocked: 0 }, activeAgents: [{ agent: 'builder' }] }),
    ch('watch-flake', { stuck: { reason: 'usage limit', resume: '/team resume watch-flake' } }),
    ch('export-csv', { tasks: { total: 4, done: 0, blocked: 0 } }),
    ch('old-one', { archivedOn: Date.UTC(2026, 10, 8, 12) }),
    ch('adhoc:fix-typo', { title: 'Ad-hoc task: fix-typo', lastActivity: 5 }),
    ch('adhoc:bump-node', { lastActivity: 9 }),
  ],
  board: { stuck: ['watch-flake'], running: ['add-invoice'], blocked: [], pending: ['export-csv', 'gone'], done: ['old-one'], doneOlder: [], other: ['adhoc:fix-typo', 'adhoc:bump-node'] },
  pending: [
    { id: 'p1', kind: 'permission', tool: 'Bash', summary: 'git push origin main', agentType: 'builder', ts: 100 },
    { id: 'q1', kind: 'question', questions: [{ question: 'Keep the drawer?' }], ts: 200 },
  ],
  running: [{ agent: 'builder', status: 'running', since: 1000, change: 'add-invoice', stage: 'task 2.4' }, { agent: 'validator', status: 'no signal', since: 50 }],
};

const groups = explorerGroups(state);
const by = Object.fromEntries(groups.map((g) => [g.key, g]));
assert.deepEqual(groups.map((g) => g.key), ['decisions', 'stuck', 'running', 'pending', 'done', 'other', 'agents'], 'empty groups are left out, except "In progress"');
assert.deepEqual(by.decisions.items.map((i) => i.label), ['Bash: git push origin main', 'Keep the drawer?'], 'a decision reads as its command or its question');
assert.equal(by.decisions.items[0].glyph, '⚠'); assert.equal(by.decisions.items[1].glyph, '?');
assert.equal(by.stuck.items[0].title, 'watch-flake: usage limit');
assert.deepEqual([by.running.items[0].meta, by.running.items[0].tone], ['7/12', 'ok'], 'tasks as x/y; green only while an agent runs');
assert.deepEqual(by.pending.items.map((i) => i.id), ['export-csv'], 'an id the board lists but the changes do not is skipped');
assert.equal(by.done.items[0].meta, '08/11');
assert.deepEqual(by.other.items.map((i) => i.label), ['bump-node', 'fix-typo'], 'ad-hoc: newest first, without the adhoc: prefix');
assert.deepEqual(by.agents.items.map((i) => [i.id, i.tone, i.since, i.meta]), [['builder', 'ok', 1000, ''], ['validator', 'warn', null, 'no signal']]);
assert.deepEqual(explorerGroups({ error: 'boom' }), []); assert.deepEqual(explorerGroups(null), []);
{ const g = explorerGroups({ ...state, board: { stuck: [], running: [], blocked: [], pending: [], done: [], doneOlder: [], other: [] }, pending: [], running: [] });
  assert.deepEqual(g.map((x) => x.key), ['running'], 'nothing at all: only "In progress", which says none'); }

// tree HTML
const html = treeHtml(groups, { folded: new Set(DEFAULT_FOLDED), cur: 'change:add-invoice' });
assert.match(html, /data-group="done" aria-expanded="false"/, 'Done starts folded');
assert.doesNotMatch(html, /data-id="old-one"/, 'a folded group hides its rows');
assert.match(html, /class="ti cur"[^>]*data-id="add-invoice"[^>]*aria-current="true"/, 'the open change is marked');
assert.match(html, /data-run-start="1000"/, 'running agents carry their start for the clock');
assert.match(html, /data-run-start="100"/, 'decisions carry their age');
assert.doesNotMatch(treeHtml(groups, { q: '<x>' }), /<x>/, 'nothing matches: no rows');
{ const f = treeHtml(groups, { folded: new Set(['done', 'other']), q: 'old' });
  assert.match(f, /data-id="old-one"/, 'filtering opens folded groups'); assert.match(f, /1\/1/); assert.doesNotMatch(f, /data-id="add-invoice"/); }
{ const evil = explorerGroups({ ...state, changes: [ch('x"><img src=y>')], board: { ...state.board, running: ['x"><img src=y>'] }, pending: [], running: [] });
  assert.doesNotMatch(treeHtml(evil), /<img/, 'ids are escaped'); }

// layout per browser
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
{ const s = mem(); assert.deepEqual(loadLayout(s), { sideW: 280, side: true, folded: DEFAULT_FOLDED, panel: true, panelTab: 'problems', panelH: 240 });
  saveLayout(s, { sideW: 999, side: false, folded: ['agents'], panel: false, panelTab: 'nope', panelH: 5 });
  assert.deepEqual(loadLayout(s), { sideW: 520, side: false, folded: ['agents'], panel: false, panelTab: 'problems', panelH: 96 }, 'sizes clamped, unknown panel tab dropped'); }
{ const s = mem(); s.setItem('ai-team:layout', '{broken'); assert.equal(loadLayout(s).sideW, 280, 'a broken value falls back to the default'); }
{ const throwing = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(loadLayout(throwing).side, true); saveLayout(throwing, { sideW: 300 }); }
assert.equal(clampSide(10), 200); assert.equal(clampSide(333.4), 333);
// editor tabs
{ const mk = (preview) => (kind, id) => ({ kind, id, preview });
  const L = [];
  assert.deepEqual(placeTab(L, 'change', 'a', true, mk(true)), { index: 0, replaced: null });
  const r = placeTab(L, 'change', 'b', true, mk(true));
  assert.equal(r.index, 0); assert.equal(r.replaced.id, 'a'); assert.deepEqual(L.map((t) => t.id), ['b'], 'a new preview replaces the preview');
  placeTab(L, 'change', 'b', false, mk(false)); assert.equal(L[0].preview, false, 'opening it for good pins it');
  placeTab(L, 'agent', 'builder', true, mk(true)); placeTab(L, 'change', 'c', true, mk(true));
  assert.deepEqual(L.map((t) => `${t.kind}:${t.id}`), ['change:b', 'change:c'], 'a pinned tab is never replaced');
  assert.deepEqual(placeTab(L, 'change', 'c', true, mk(true)), { index: 1, replaced: null }, 'an open tab is focused, not duplicated');
  assert.equal(L[1].preview, true, '…and a preview open stays a preview');
  placeTab(L, 'change', 'd', false, mk(false)); assert.deepEqual(L.map((t) => t.id), ['b', 'c', 'd'], 'pinned opens append'); }
assert.equal(afterClose(0, 0), -1); assert.equal(afterClose(2, 0), 0); assert.equal(afterClose(2, 2), 1);
// PROBLEMS
{ const st = { ...state, changes: [...state.changes, ch('red', { tests: { ok: false, failed: 3, agent: 'integrator' }, tasks: { total: 4, done: 1, blocked: 2 } }), ch('gone-red', { archived: true, tests: { ok: false } })],
    board: { ...state.board, running: [...state.board.running, 'red'] } };
  const p = problemsList(st);
  assert.deepEqual(p.map((x) => `${x.level}:${x.kind}:${x.change || x.agent}`), ['bad:stuck:watch-flake', 'bad:tests:red', 'warn:blocked:red', 'warn:silent:validator'], 'worst first; archived changes left out');
  assert.equal(p[0].copy, '/team resume watch-flake'); assert.equal(p[1].text, 'tests ✗ 3 failed (integrator)'); assert.equal(p[2].text, '2 tasks blocked');
  assert.deepEqual(problemsList({ error: 'x' }), []); }
// EVENTS
{ const tl = { since: 10, groups: [{ change: 'a', items: [{ ts: 30, level: 'ok', text: 'tests green', kind: 'tests' }, { ts: 12, level: 'info', text: 'started' }] }, { change: null, items: [{ ts: 20, level: 'warn', text: 'question' }] }] };
  const e = eventsLog(tl, 0);
  assert.deepEqual(e.rows.map((r) => r.ts), [12, 20, 30], 'oldest first, all groups in one log');
  assert.deepEqual([e.unseen, e.mark], [3, 0]); assert.equal(e.rows[1].change, null);
  const s2 = eventsLog(tl, 20); assert.deepEqual([s2.unseen, s2.mark, s2.rows.map((r) => r.seen)], [1, 2, [true, true, false]], 'marked as seen: the marker moves');
  assert.deepEqual(eventsLog(tl, 99), { rows: eventsLog(tl, 99).rows, unseen: 0, mark: -1 });
  assert.deepEqual(eventsLog(null), { rows: [], unseen: 0, mark: -1 }); }
assert.equal(clampPanel(10), 96); assert.equal(clampPanel(9999), 640);
// tasks kanban
assert.deepEqual(['Backend', '2. Frontend (integrator)', 'Infra', 'Investigation', 'Validation', 'QA', 'Docs', 'Mobile app', '', null].map(kindOf),
  ['back', 'front', 'infra', 'invest', 'test', 'test', 'docs', 'mobile', 'task', 'task'], 'the badge comes from the section heading');
{ const c = {
    taskList: [
      { id: '1.1', done: true, section: 'Backend', deps: { ids: [] }, text: '1.1 endpoint' },
      { id: '1.2', done: false, section: 'Backend', deps: { ids: [] }, text: '1.2 filters' },
      { id: '2.1', done: false, section: 'Frontend', deps: { ids: [] }, text: '2.1 button' },
      { id: '2.2', done: false, section: 'Frontend', deps: { ids: [] }, text: '2.2 errors' },
      { id: '2.3', done: false, section: 'Frontend', deps: { ids: ['2.2'] }, text: '2.3 e2e' },
      { id: '2.4', done: false, section: 'Frontend', blocked: true, deps: { ids: [] }, text: '2.4 blocked' },
      { id: null, done: false, section: 'Investigation', deps: { ids: [] }, text: 'measure size' },
    ],
    runs: [
      { id: 'r1', agent: 'builder', start: 1, end: 5, taskIds: ['1.1', '1.2'], tests: { ok: true } },
      { id: 'r2', agent: 'integrator', start: 6, end: 9, taskIds: ['2.2'], tests: { ok: false, failed: 3 } },
      { id: 'r3', agent: 'integrator', start: 10, active: true, task: '2.1', taskIds: [] },
    ] };
  const b = taskBoard(c), col = Object.fromEntries(b.cards.map((x) => [x.key, x]));
  assert.deepEqual(b.counts, { todo: 3, doing: 1, test: 2, done: 1 });
  assert.equal(col['1.1'].col, 'done', 'ticked wins over everything');
  assert.deepEqual([col['1.2'].col, col['1.2'].bad, col['1.2'].endedAt], ['test', false, 5], 'its round ended, not ticked yet');
  assert.deepEqual([col['2.2'].col, col['2.2'].bad, col['2.2'].tests.failed], ['test', true, 3], 'red tests on its last round');
  assert.deepEqual([col['2.1'].col, col['2.1'].agent, col['2.1'].since], ['doing', 'integrator', 10], 'the run\'s single task counts as well');
  assert.deepEqual([col['2.3'].col, col['2.3'].blocked, col['2.3'].waits], ['todo', true, ['2.2']], 'waits for an undone dependency');
  assert.deepEqual([col['2.4'].blocked, col['#7'].kind, col['#7'].col], [true, 'invest', 'todo'], 'blocked in tasks.md; a task without id still shows');
  assert.deepEqual(b.now, [], 'every running round is on an open card');
  assert.deepEqual(taskBoard({}), { cards: [], counts: { todo: 0, doing: 0, test: 0, done: 0 }, total: 0, now: [] }); }
// a running round no open card shows (review and fix rounds rarely cite a task): listed as "now", not hidden
{ const c = { taskList: [{ id: '2.1', done: true, section: 'Frontend', deps: { ids: [] }, text: '2.1 a' }, { id: '2.2', done: false, section: 'Frontend', deps: { ids: [] }, text: '2.2 b' }],
    runs: [{ id: 'r1', agent: 'reviewer', flow: 'review', active: true, start: 7, description: 'Review round 4 (R10-R14)', taskIds: [] },
      { id: 'r2', agent: 'reviewer', flow: 'review', active: true, start: 9, description: 'Review task 2.1', taskIds: ['2.1'] }] };
  const b = taskBoard(c);
  assert.deepEqual(b.now.map((r) => [r.agent, r.what, r.taskIds]), [['reviewer', 'Review round 4 (R10-R14)', []]], 'only rounds no card shows');
  assert.deepEqual([b.cards[0].col, b.cards[0].ticked, b.cards[0].agent, b.cards[0].flow], ['doing', true, 'reviewer', 'review'], 'a ticked task someone works on is in Doing, marked ticked');
  assert.equal(b.cards[1].col, 'todo'); }
// time: where a round's minutes went, by stage and by task (shared rounds shown whole, never split)
{ const M = 60000;
  assert.deepEqual(roundTime({ durationMs: 10 * M, timeSplit: { tests: 3 * M, shell: M } }), { tests: 3 * M, checks: 0, shell: M, edit: 0, read: 0, other: 0, model: 6 * M }, 'the model is the rest of the round');
  assert.equal(roundTime({ durationMs: M, timeSplit: { tests: 2 * M } }).model, 0, 'overlapping calls never make the model negative');
  assert.equal(roundTime({ durationMs: 5 * M }).model, 5 * M, 'an old round without the split: all model');
  const c = { taskList: [{ id: '1.1', section: 'Backend' }, { id: '1.2', section: 'Backend' }, { id: '2.1', section: 'Frontend' }, { id: null, section: 'x' }],
    runs: [{ flow: 'build', durationMs: 60 * M, taskIds: ['1.1', '1.2'], timeSplit: { tests: 10 * M } },
      { flow: 'build', durationMs: 20 * M, task: '2.1', taskIds: [] },
      { flow: 'review', durationMs: 15 * M, taskIds: [] },
      { flow: 'fix', durationMs: 5 * M, taskIds: ['1.2'], timeSplit: { checks: M } },
      { flow: 'spec', durationMs: 0, taskIds: [] }] };
  const t = timeBoard(c);
  assert.equal(t.total, 100 * M);
  assert.deepEqual(t.flows.map((f) => [f.flow, f.ms, f.rounds]), [['build', 80 * M, 2], ['review', 15 * M, 1], ['fix', 5 * M, 1]], 'stage order; rounds without a duration left out');
  assert.equal(t.flows[0].split.tests, 10 * M); assert.equal(t.flows[0].split.model, 70 * M); assert.equal(t.flows[2].split.checks, M);
  assert.deepEqual(t.tasks.map((x) => [x.id, x.kind, x.own, x.shared, x.sharedRounds, x.rounds]),
    [['1.1', 'back', 0, 60 * M, 1, 1], ['1.2', 'back', 5 * M, 60 * M, 1, 2], ['2.1', 'front', 20 * M, 0, 0, 1]], 'own vs shared; a task without id has no row');
  const b = taskBoard({ ...c, taskList: c.taskList.map((x) => ({ ...x, done: false, deps: { ids: [] }, text: x.id || '' })) });
  assert.deepEqual(b.cards[1].time, { own: 5 * M, shared: 60 * M, measured: null, measuredFlows: null }, 'the card carries its time (no marks: nothing measured)');
  assert.deepEqual(timeBoard({}), { total: 0, flows: [], tasks: [] }); }
// task marks (task.sh): start / pause / done per agent; a start of another task closes the previous one
{ const M = 60000, T0 = 1_000_000_000_000;
  const mk = (min, action, tasks, agent = 'integrator') => ({ ts: T0 + min * M, action, change: 'c', tasks, agent });
  const c = {
    runs: [{ agent: 'integrator', flow: 'build', start: T0, end: T0 + 100 * M, active: false },
      { agent: 'reviewer', flow: 'review', start: T0 + 110 * M, active: true },
      { agent: 'integrator', flow: 'fix', start: T0 + 200 * M, end: T0 + 230 * M, active: false }],
    taskMarks: [
      mk(0, 'start', ['2.1']), mk(15, 'start', ['2.2']),            // moved on without a done: 2.1 closes at 15
      mk(20, 'done', ['2.2']), mk(20, 'start', ['2.3']),
      mk(30, 'pause', ['2.3']), mk(40, 'start', ['2.3']),           // paused and back
      mk(50, 'done', ['2.3']), mk(60, 'start', ['2.4']),            // still open when the round ends at 100
      mk(110, 'start', ['2.1', '2.2'], 'reviewer'),                 // a review of two tasks, still running
      mk(205, 'start', ['2.3']),                                    // a fix round: open until its end at 230
      mk(300, 'start', ['9.9'], 'ghost'),                           // no round around it: left out
    ] };
  const iv = markIntervals(c, T0 + 130 * M);
  const by = (task) => iv.filter((x) => x.task === task).map((x) => [x.agent, (x.from - T0) / M, (x.to - T0) / M, x.open, x.flow]);
  assert.deepEqual(by('2.1'), [['integrator', 0, 15, false, 'build'], ['reviewer', 110, 130, true, 'review']]);
  assert.deepEqual(by('2.3'), [['integrator', 20, 30, false, 'build'], ['integrator', 40, 50, false, 'build'], ['integrator', 205, 230, false, 'fix']], 'pause and back; a later fix round');
  assert.deepEqual(by('2.4'), [['integrator', 60, 100, false, 'build']], 'closed at the end of its round');
  assert.deepEqual(by('9.9'), [], 'a stray mark is not counted forever');
  const t = markedTime(c, T0 + 130 * M);
  assert.equal(t.get('2.3').ms, 45 * M); assert.deepEqual(t.get('2.3').flows, { build: 20 * M, fix: 25 * M });
  assert.deepEqual(t.get('2.2').open, { agent: 'reviewer', since: T0 + 110 * M, flow: 'review' }, 'open while the round runs');
  // the board: an open mark puts the task in Doing even when no round cites it; the measured time wins on the card
  const b = taskBoard({ ...c, taskList: ['2.1', '2.2', '2.3', '2.4'].map((id) => ({ id, done: id !== '2.4', section: 'Frontend', deps: { ids: [] }, text: id })) }, T0 + 130 * M);
  assert.deepEqual(b.cards.map((x) => x.col), ['doing', 'doing', 'done', 'test'], '2.1 and 2.2 under review now; 2.4 left unticked after its round');
  assert.equal(b.cards[2].time.measured, 45 * M);
  assert.equal(timeBoard(c, T0 + 130 * M).tasks.length, 0, 'no taskList: no task rows'); }
console.log('✓ shell ok');
