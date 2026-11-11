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
    const head = `<button type="button" class="tg" data-group="${g.key}" aria-expanded="${open}"><span class="chev" aria-hidden="true">▾</span><span class="${g.tone && g.items.length ? g.tone : ''}">${esc(g.label)}</span><span class="n${g.tone && g.items.length ? ` ${g.tone}` : ''}">${query ? `${list.length}/${g.items.length}` : g.items.length}</span></button>`;
    const rows = open ? list.map((it) => {
      const key = `${it.kind}:${it.id}`;
      const meta = it.since ? `<span class="meta" data-run-start="${it.since}"></span>` : it.meta ? `<span class="meta">${esc(it.meta)}</span>` : '';
      return `<button type="button" class="ti${key === cur ? ' cur' : ''}" role="treeitem" data-kind="${it.kind}" data-id="${esc(it.id)}" title="${esc(it.title || it.id)}"${key === cur ? ' aria-current="true"' : ''}><span class="g ${it.tone}" aria-hidden="true">${it.glyph}</span><span class="id">${esc(it.label)}</span>${meta}</button>`;
    }).join('') : '';
    return `<div class="tgrp" role="group">${head}${rows}${open && !list.length ? '<div class="tnone">none</div>' : ''}</div>`;
  }).join('');
}

// layout kept per browser: explorer width and visibility, folded groups
const KEY = 'ai-team:layout';
export function loadLayout(storage) {
  const def = { sideW: 280, side: true, folded: [...DEFAULT_FOLDED] };
  try {
    const o = JSON.parse(storage.getItem(KEY) || 'null');
    if (!o || typeof o !== 'object') return def;
    return { sideW: clampSide(Number(o.sideW) || def.sideW), side: o.side !== false, folded: Array.isArray(o.folded) ? o.folded.filter((k) => typeof k === 'string') : def.folded };
  } catch { return def; }
}
export function saveLayout(storage, layout) { try { storage.setItem(KEY, JSON.stringify(layout)); } catch { /* not kept */ } }
export const clampSide = (w) => Math.min(520, Math.max(200, Math.round(w)));
