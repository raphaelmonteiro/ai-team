// IDE shell of the dashboard (index.html): the explorer tree and the layout kept per browser.
// Pure functions over the /api/state answer, so the grouping is tested without a browser.
import { esc, matchScore } from './ui.mjs';

// one group per state, in the order a developer reads them; folded by default: the long tail
export const GROUPS = [
  { key: 'decisions', label: 'Decisions', tone: 'warn' },
  { key: 'stuck', label: 'Stuck', tone: 'bad' },
  { key: 'running', label: 'In progress', tone: '' },
  { key: 'blocked', label: 'Blocked', tone: 'warn' },
  { key: 'pending', label: 'Pending', tone: '' },
  { key: 'done', label: 'Done', tone: '' },
  { key: 'other', label: 'Ad-hoc', tone: '' },
  { key: 'agents', label: 'Agents', tone: '' },
];
export const DEFAULT_FOLDED = ['done', 'other'];

const shortDate = (t) => { if (!t) return ''; const d = new Date(t); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
const label = (c) => (c.id.startsWith('adhoc:') ? c.id.slice(6) : (c.title || c.id));

// state → [{ key, label, tone, items: [{ kind, id, label, glyph, tone, meta, since, title }] }]
// kind: 'change' and 'agent' open in the editor; 'decision' points at a decision card
export function explorerGroups(state) {
  if (!state || state.error || !state.board) return [];
  const byId = new Map(state.changes.map((c) => [c.id, c]));
  const pick = (ids) => (ids || []).map((i) => byId.get(i)).filter(Boolean);
  const bd = state.board;
  const tasks = (c) => (c.tasks && c.tasks.total ? `${c.tasks.done}/${c.tasks.total}` : '');
  const change = (c, glyph, tone, meta) => ({ kind: 'change', id: c.id, label: label(c), glyph, tone, meta, title: c.id });
  const items = {
    decisions: (state.pending || []).map((p) => {
      const q = p.questions && p.questions[0] && p.questions[0].question;
      const ask = p.kind === 'question' || p.kind === 'reply';
      const text = ask ? q || 'question' : `${p.tool || 'permission'}${p.summary ? `: ${p.summary}` : ''}`;
      return { kind: 'decision', id: p.id, label: text, glyph: ask ? '?' : '⚠', tone: 'warn', since: p.ts,
        title: `${p.agentType || 'main session'} · ${text}` };
    }),
    stuck: pick(bd.stuck).map((c) => ({ ...change(c, '✗', 'bad', ''), title: `${c.id}: ${c.stuck ? c.stuck.reason : 'stuck'}` })),
    running: pick(bd.running).map((c) => change(c, '●', c.activeAgents && c.activeAgents.length ? 'ok' : '', tasks(c))),
    blocked: pick(bd.blocked).map((c) => change(c, '⊘', 'warn', tasks(c))),
    pending: pick(bd.pending).map((c) => change(c, '○', '', tasks(c))),
    done: pick([...(bd.done || []), ...(bd.doneOlder || [])]).map((c) => change(c, '✓', '', shortDate(c.archivedOn || c.lastActivity))),
    other: pick(bd.other).sort((a, b) => (b.lastActivity || 0) - (a.lastActivity || 0)).map((c) => change(c, '·', '', shortDate(c.lastActivity))),
    agents: (state.running || []).map((r) => ({ kind: 'agent', id: r.agent, label: r.main ? `${r.agent} (main)` : r.agent,
      glyph: '●', tone: r.status === 'running' ? 'ok' : 'warn', since: r.status === 'running' ? r.since : null,
      meta: r.status === 'running' ? '' : 'no signal', title: [r.change, r.stage].filter(Boolean).join(' · ') })),
  };
  return GROUPS.map((g) => ({ ...g, items: items[g.key] })).filter((g) => g.items.length || g.key === 'running');
}

// groups → tree HTML; folded: Set of group keys; cur: 'change:<id>' | 'agent:<id>'; q: filter text
export function treeHtml(groups, { folded = new Set(), cur = '', q = '' } = {}) {
  const query = q.trim();
  return groups.map((g) => {
    const list = query ? g.items.filter((it) => matchScore(query, it.label) >= 0 || matchScore(query, it.id) >= 0) : g.items;
    if (query && !list.length) return '';
    const open = query ? true : !folded.has(g.key);
    const head = `<button type="button" class="tg" role="treeitem" aria-level="1" data-group="${g.key}" aria-expanded="${open}"><span class="chev" aria-hidden="true">▾</span><span class="${g.tone && g.items.length ? g.tone : ''}">${esc(g.label)}</span><span class="n${g.tone && g.items.length ? ` ${g.tone}` : ''}">${query ? `${list.length}/${g.items.length}` : g.items.length}</span></button>`;
    const rows = open ? list.map((it) => {
      const key = `${it.kind}:${it.id}`;
      const meta = it.since ? `<span class="meta" data-run-start="${it.since}"></span>` : it.meta ? `<span class="meta">${esc(it.meta)}</span>` : '';
      return `<button type="button" class="ti${key === cur ? ' cur' : ''}" role="treeitem" aria-level="2" data-kind="${it.kind}" data-id="${esc(it.id)}" title="${esc(it.title || it.id)}"${key === cur ? ' aria-current="true"' : ''}><span class="g ${it.tone}" aria-hidden="true">${it.glyph}</span><span class="id">${esc(it.label)}</span>${meta}</button>`;
    }).join('') : '';
    return `<div class="tgrp" role="group">${head}${rows}${open && !list.length ? '<div class="tnone">none</div>' : ''}</div>`;
  }).join('');
}

// layout kept per browser: explorer width and visibility, folded groups
const KEY = 'ai-team:layout';
export const PANEL_TABS = ['problems', 'events', 'output'];
export function loadLayout(storage) {
  const def = { sideW: 280, side: true, folded: [...DEFAULT_FOLDED], panel: true, panelTab: 'problems', panelH: 240 };
  try {
    const o = JSON.parse(storage.getItem(KEY) || 'null');
    if (!o || typeof o !== 'object') return def;
    return { sideW: clampSide(Number(o.sideW) || def.sideW), side: o.side !== false, folded: Array.isArray(o.folded) ? o.folded.filter((k) => typeof k === 'string') : def.folded,
      panel: o.panel !== false, panelTab: PANEL_TABS.includes(o.panelTab) ? o.panelTab : def.panelTab, panelH: clampPanel(Number(o.panelH) || def.panelH) };
  } catch { return def; }
}
export function saveLayout(storage, layout) { try { storage.setItem(KEY, JSON.stringify(layout)); } catch { /* not kept */ } }
export const clampSide = (w) => Math.min(520, Math.max(200, Math.round(w)));
export const clampPanel = (h) => Math.min(640, Math.max(96, Math.round(h)));

// editor tabs. Opening an open tab focuses it (and pins it unless opened as a preview); a new preview takes
// the place of the current preview tab, if any, instead of adding one. Mutates `list`.
export function placeTab(list, kind, id, preview, make) {
  const i = list.findIndex((t) => t.kind === kind && t.id === id);
  if (i >= 0) { if (!preview) list[i].preview = false; return { index: i, replaced: null }; }
  const t = make(kind, id), p = preview ? list.findIndex((x) => x.preview) : -1;
  if (p >= 0) { const replaced = list[p]; list[p] = t; return { index: p, replaced }; }
  list.push(t); return { index: list.length - 1, replaced: null };
}
// after closing the open tab at `i` (the list already without it): its right neighbour, else the left one, else Overview (-1)
export const afterClose = (len, i) => (len ? Math.min(i, len - 1) : -1);

// PROBLEMS besides the decisions: what is blocked or failing, worst first. Each item opens its change or agent.
export function problemsList(state) {
  if (!state || state.error || !state.board) return [];
  const byId = new Map(state.changes.map((c) => [c.id, c]));
  const out = [];
  for (const id of state.board.stuck || []) {
    const c = byId.get(id); if (!c) continue;
    out.push({ level: 'bad', kind: 'stuck', change: c.id, text: c.stuck ? c.stuck.reason : 'stuck', copy: c.stuck ? c.stuck.resume : `/team resume ${c.id}` });
  }
  for (const c of state.changes) {
    if (c.archived || c.kind === 'no-change') continue;
    if (c.tests && c.tests.ok === false) out.push({ level: 'bad', kind: 'tests', change: c.id, text: `tests ✗ ${c.tests.failed ? `${c.tests.failed} failed` : 'failed'}${c.tests.agent ? ` (${c.tests.agent})` : ''}` });
    if (c.tasks && c.tasks.blocked) out.push({ level: 'warn', kind: 'blocked', change: c.id, text: `${c.tasks.blocked} task${c.tasks.blocked === 1 ? '' : 's'} blocked` });
  }
  for (const r of state.running || []) if (r.status !== 'running' && !r.main) out.push({ level: 'warn', kind: 'silent', agent: r.agent, change: r.change || null, text: `${r.agent} without a signal${r.change ? ` in ${r.change}` : ''}` });
  return out;
}

// EVENTS: the "since you left" timeline as one log, oldest first (newest at the bottom, like a terminal).
// Rows at or before `seenAt` are already seen; `mark` is the index of the first unseen row (-1: none).
export function eventsLog(tl, seenAt = 0) {
  if (!tl || !Array.isArray(tl.groups)) return { rows: [], unseen: 0, mark: -1 };
  const rows = tl.groups.flatMap((g) => g.items.map((it) => ({ ts: it.ts, level: it.level || 'info', kind: it.kind, text: it.text, change: g.change || null })))
    .sort((a, b) => a.ts - b.ts)
    .map((r) => ({ ...r, seen: r.ts <= seenAt }));
  const mark = rows.findIndex((r) => !r.seen);
  return { rows, unseen: mark < 0 ? 0 : rows.length - mark, mark };
}

// ---- tasks kanban of a change. The kind badge comes from the task's tasks.md section ("1. Backend" → back);
// it has its own color, apart from the state colors.
const KINDS = { backend: 'back', back: 'back', api: 'back', frontend: 'front', front: 'front', ui: 'front', infra: 'infra', infrastructure: 'infra', setup: 'infra',
  investigation: 'invest', research: 'invest', spike: 'invest', discovery: 'invest', test: 'test', tests: 'test', testing: 'test', qa: 'test', validation: 'test',
  docs: 'docs', documentation: 'docs', process: 'docs', review: 'review' };
export const KIND_CLASSES = ['back', 'front', 'infra', 'invest', 'test', 'docs', 'review'];
export function kindOf(section) {
  const w = String(section || '').replace(/^[\d.\s]+/, '').trim().toLowerCase().split(/[^a-z]+/).filter(Boolean)[0] || '';
  return KINDS[w] || w.slice(0, 6) || 'task';
}
// ---- time: where a round's minutes went (tool calls by kind, measured from each call to its result) and the
// model's own time (the rest of the round). Per task: rounds that cite only this task are its own time; a round
// that cites several tasks is shown whole as shared (no invented split).
export const TIME_KINDS = [['tests', 'tests'], ['checks', 'lint · types · build'], ['shell', 'other shell'], ['edit', 'editing'], ['read', 'reading'], ['other', 'other tools'], ['model', 'model']];
export function roundTime(r) {
  const t = r.timeSplit || {}, d = r.durationMs || 0;
  const out = Object.fromEntries(TIME_KINDS.map(([k]) => [k, k === 'model' ? 0 : Math.max(0, t[k] || 0)]));
  out.model = Math.max(0, d - TIME_KINDS.reduce((n, [k]) => n + (k === 'model' ? 0 : out[k]), 0));
  return out;
}
const roundTasks = (r) => [...new Set((r.taskIds || []).concat(r.task ? [r.task] : []))];
const FLOW_ORDER = ['spec', 'build', 'review', 'fix', 'validation', 'integration'];
// change → { total, flows: [{ flow, ms, rounds, split }], tasks: [{ id, own, shared, sharedRounds, rounds }] }
export function timeBoard(change) {
  const runs = ((change && change.runs) || []).filter((r) => r.durationMs);
  const flows = new Map();
  for (const r of runs) {
    const f = r.flow || 'other', e = flows.get(f) || { flow: f, ms: 0, rounds: 0, split: Object.fromEntries(TIME_KINDS.map(([k]) => [k, 0])) };
    e.ms += r.durationMs; e.rounds++;
    const rt = roundTime(r); for (const [k] of TIME_KINDS) e.split[k] += rt[k];
    flows.set(f, e);
  }
  const order = (f) => { const i = FLOW_ORDER.indexOf(f); return i < 0 ? 99 : i; };
  const tasks = ((change && change.taskList) || []).filter((t) => t.id).map((t) => {
    const rs = runs.filter((r) => roundTasks(r).includes(t.id));
    const own = rs.filter((r) => roundTasks(r).length === 1), shared = rs.filter((r) => roundTasks(r).length > 1);
    return { id: t.id, kind: kindOf(t.section), own: own.reduce((n, r) => n + r.durationMs, 0), shared: shared.reduce((n, r) => n + r.durationMs, 0), sharedRounds: shared.length, rounds: rs.length };
  });
  return { total: runs.reduce((n, r) => n + r.durationMs, 0), flows: [...flows.values()].sort((a, b) => order(a.flow) - order(b.flow)), tasks };
}

// change → { cards, counts } with each task in one column:
//   doing = a running round cites it, ticked or not (a review or a validation of a ticked task is work on it)
//   done  = ticked in tasks.md and nobody on it
//   test  = the last round on it ended but it is not ticked yet, or that round's tests are red (bad: true)
//   todo  = the rest; blocked when tasks.md says so or a dependency is not done
export const TASK_COLS = ['todo', 'doing', 'test', 'done'];
export function taskBoard(change) {
  const list = (change && change.taskList) || [];
  const runs = (change && change.runs) || [];
  const doneIds = new Set(list.filter((t) => t.done && t.id).map((t) => t.id));
  const cards = list.map((t, i) => {
    const key = t.id || `#${i + 1}`;
    const rs = t.id ? runs.filter((r) => (r.taskIds || []).includes(t.id) || r.task === t.id) : [];
    const last = rs.filter((r) => !r.active).sort((a, b) => (a.end || a.start || 0) - (b.end || b.start || 0)).pop() || null;
    const live = rs.find((r) => r.active) || null;
    const deps = (t.deps && t.deps.ids) || [];
    const waits = deps.filter((d) => !doneIds.has(d));
    let col = 'todo';
    if (live) col = 'doing'; else if (t.done) col = 'done'; else if (last) col = 'test';
    const bad = col === 'test' && !!(last && last.tests && last.tests.ok === false);
    return { key, id: t.id, text: t.text, section: t.section || '', kind: kindOf(t.section), col, bad, ticked: !!t.done, flow: live ? live.flow || null : null,
      blocked: col === 'todo' && (!!t.blocked || waits.length > 0), waits,
      agent: (live || last || {}).agent || null, since: live ? live.start : null, endedAt: last ? last.end || last.start : null,
      tests: last && last.tests ? last.tests : null, runIds: rs.map((r) => r.id),
      time: { own: rs.filter((r) => roundTasks(r).length === 1).reduce((n, r) => n + (r.durationMs || 0), 0), shared: rs.filter((r) => roundTasks(r).length > 1).reduce((n, r) => n + (r.durationMs || 0), 0) } };
  });
  const counts = Object.fromEntries(TASK_COLS.map((c) => [c, cards.filter((x) => x.col === c).length]));
  // running rounds no card shows: they cite no task of tasks.md (most review and fix rounds did). Without this,
  // an agent can work for hours on the change while the board looks idle.
  const known = new Set(cards.filter((x) => x.id).map((x) => x.id));
  const now = runs.filter((r) => r.active && !(r.taskIds || []).concat(r.task ? [r.task] : []).some((id) => known.has(id)))
    .map((r) => ({ agent: r.agent, flow: r.flow || null, since: r.start, what: r.description || '', taskIds: r.taskIds || [] }));
  return { cards, counts, total: cards.length, now };
}
