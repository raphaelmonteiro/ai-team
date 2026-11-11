// Tests of the dashboard's IDE shell (dashboard/shell.mjs): explorer grouping, tree HTML and the layout kept per browser.
import assert from 'node:assert/strict';
import { explorerGroups, treeHtml, loadLayout, saveLayout, clampSide, DEFAULT_FOLDED, placeTab, afterClose } from '../dashboard/shell.mjs';

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
{ const s = mem(); assert.deepEqual(loadLayout(s), { sideW: 280, side: true, folded: DEFAULT_FOLDED });
  saveLayout(s, { sideW: 999, side: false, folded: ['agents'] }); assert.deepEqual(loadLayout(s), { sideW: 520, side: false, folded: ['agents'] }, 'width clamped on load'); }
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
console.log('✓ shell ok');
