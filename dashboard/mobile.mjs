// Phone layout of the main page (v3 step 5), under 760 px: a top bar, one screen at a time (Home, Inbox, Events,
// More, a change in full screen) and a bottom bar. Pure HTML builders over /api/state; index.html routes the taps.
// Less detail than the desktop on purpose: decide and check, not analyse (no diff, rounds or files here).
import { esc } from './ui.mjs';
import { eventsLog, taskBoard, problemsList, KIND_CLASSES } from './shell.mjs';

const label = (id) => (String(id).startsWith('adhoc:') ? String(id).slice(6) : String(id));
const chev = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';

// the Inbox badge counts what the Inbox lists: decisions waiting, then stuck, failing and blocked changes
export function inboxCount(state) {
  if (!state || state.error) return 0;
  return (state.pending || []).length + problemsList(state).filter((p) => p.kind !== 'silent').length;
}

export function topHtml(state, { conn, change = null }) {
  if (change) return `<div class="m-top"><button type="button" class="m-back" data-m-back aria-label="Back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg></button><span class="m-proj">${esc(label(change.id))}</span>${change.stuck ? '<span class="badge bad">stuck</span>' : ''}</div>`;
  const running = (state.running || []).filter((r) => r.status === 'running').length;
  const g = state.project.git;
  return `<div class="m-top"><span class="m-logo" aria-hidden="true">&gt;_</span><span class="m-proj">${esc(state.project.name)}</span><span class="m-conn ${conn.cls}">${conn.text}</span></div>
    <div class="m-strip"><span><b class="${running ? 'ok' : ''}">${running}</b> running</span>${g && g.branch ? `<span>⎇ ${esc(g.branch)}${g.worktree ? ' ⑂' : ''}</span>` : ''}<span>${esc(conn.cost)}</span></div>`;
}

// trail of a change as a segmented bar: done, the current stage, the rest
const bar = (c) => { const steps = (c.trail && c.trail.steps) || []; return steps.length ? `<div class="m-dots">${steps.map((s) => `<span class="${s.state === 'done' ? 'd' : s.state === 'active' ? (c.stuck ? 'x' : 'n') : ''}" title="${esc(s.label)}"></span>`).join('')}</div>` : ''; };
function dots(c) {
  const steps = (c.trail && c.trail.steps) || [];
  if (!steps.length) return '';
  const cur = steps.find((s) => s.state === 'active');
  return `${bar(c)}
    <div class="m-dotlbl"><span>${cur ? `${esc(cur.label)} · step ${steps.indexOf(cur) + 1} of ${steps.length}` : c.archived ? 'archived' : ''}</span><span>${c.tasks && c.tasks.total ? `${c.tasks.done}/${c.tasks.total} tasks` : ''}</span></div>`;
}

export function homeHtml(state, { fmt }) {
  const byId = new Map(state.changes.map((c) => [c.id, c]));
  const pick = (ids) => (ids || []).map((i) => byId.get(i)).filter(Boolean);
  const bd = state.board, pend = state.pending || [];
  const need = pend.map((p) => {
    const ask = p.kind === 'question' || p.kind === 'reply';
    const q = ask && p.questions && p.questions[0] ? p.questions[0].question : null;
    return `<button type="button" class="m-card m-need" data-m-go="inbox"><div class="m-row1"><span class="warn">${ask ? '?' : '⚠'}</span><b>${esc(p.agentType || 'main session')}</b><span class="sub">${ask ? 'asks' : `wants ${esc(p.tool || 'permission')}`}</span><span class="sub m-r" data-since="${p.ts}"></span></div>
      <div class="${ask ? 'm-q' : 'm-cmd'}">${esc(ask ? q || 'question' : p.summary || '')}</div><div class="m-go">Answer ${chev}</div></button>`;
  }).join('');
  const stuck = pick(bd.stuck).map((c) => `<button type="button" class="m-card m-line" data-m-change="${esc(c.id)}"><span class="g bad">✗</span><span class="m-main"><span class="m-id">${esc(label(c.id))}</span><span class="sub">stuck · ${esc(c.stuck ? c.stuck.reason : '')}</span></span>${chev}</button>`).join('');
  const run = pick(bd.running).map((c) => {
    const act = (c.activeAgents || [])[0];
    return `<button type="button" class="m-line" data-m-change="${esc(c.id)}"><span class="dot${act ? ' on pulse' : ''}"></span><span class="m-main"><span class="m-id">${esc(label(c.id))}</span><span class="sub">${act ? `${esc(act.agent)} · <span data-since="${act.since}"></span>` : esc((c.waiting && c.waiting.text) || c.status || '')}</span>${bar(c)}</span>${chev}</button>`;
  }).join('');
  const pending = pick(bd.pending).map((c) => `<button type="button" class="m-line" data-m-change="${esc(c.id)}"><span class="g">○</span><span class="m-main"><span class="m-id">${esc(label(c.id))}</span></span><span class="m-r sub">${c.tasks && c.tasks.total ? `${c.tasks.done}/${c.tasks.total}` : ''}</span>${chev}</button>`).join('');
  const done = (bd.done || []).length + (bd.doneOlder || []).length, adhoc = (bd.other || []).length;
  return `${need || stuck ? `<div class="m-sec">Needs you <b class="warn">${pend.length + pick(bd.stuck).length}</b></div>${need}${stuck}` : '<div class="m-calm">✓ Nothing waits for you.</div>'}
    <div class="m-sec">In progress <b>${pick(bd.running).length}</b></div><div class="m-list">${run || '<div class="m-none">no change in progress</div>'}</div>
    ${pending ? `<div class="m-sec">Pending <b>${pick(bd.pending).length}</b></div><div class="m-list">${pending}</div>` : ''}
    <div class="m-list m-dim"><div class="m-line" style="cursor:default"><span class="g">✓</span><span class="m-main sub">${done} done · ${adhoc} ad-hoc · ${fmt.usd(state.totals.usd)} est.</span></div></div>
    <p class="m-foot">Diff, rounds, files and the full tables are on the desktop view.</p>`;
}

export function inboxHtml(state) {
  const probs = problemsList(state).filter((p) => p.kind !== 'silent');
  const why = (p) => { if (p.kind !== 'tests') return ''; const t = (state.changes.find((c) => c.id === p.change) || {}).tests; if (!t || t.ok !== false) return '';
    const parts = (t.parts || [t]).filter((x) => x.ok === false);
    return parts.map((x) => `${x.failures && x.failures.length ? `<div class="m-fails">${x.failures.map((f) => `<div>✗ ${esc(f)}</div>`).join('')}</div>` : ''}${x.excerpt ? `<details class="m-out"><summary>output</summary><pre>${esc(x.excerpt)}</pre></details>` : ''}`).join(''); };
  const stuck = probs.map((p) => `<div class="m-card m-prob"><div class="m-row1"><span class="${p.level}">${p.kind === 'blocked' ? '⊘' : '✗'}</span><button type="button" class="m-link" data-m-change="${esc(p.change)}">${esc(label(p.change))}</button></div><div class="sub">${esc(p.kind === 'stuck' ? `stuck: ${p.text}` : p.text)}</div>${why(p)}${p.copy ? `<div class="m-cmd">${esc(p.copy)}</div><button type="button" class="m-big" data-copy="${esc(p.copy)}">Copy command</button>` : ''}</div>`).join('');
  const n = (state.pending || []).length;
  return `<div class="m-sec">Decisions <b class="${n ? 'warn' : ''}">${n}</b></div>${n ? '' : '<div class="m-none">no decision waiting</div>'}<div id="m-decslot"></div>
    <div class="m-sec">Stuck, failing, blocked <b class="${probs.length ? 'bad' : ''}">${probs.length}</b></div>${stuck || '<div class="m-none">nothing stuck or failing</div>'}`;
}

export function eventsHtml(state, seenAt, { fmtTime }) {
  const tl = state.timeline;
  const { rows, unseen, mark } = eventsLog(tl, seenAt);
  if (!rows.length) return '<div class="m-none">Nothing new since you left.</div>';
  const markEl = `<div class="m-mark">since you left${unseen ? ` · ${unseen} new <button type="button" data-seen>mark as seen</button>` : ''}</div>`;
  return rows.slice().reverse().map((r, i, all) => {   // newest first on a phone: what happened last is on top
    const idx = all.length - 1 - i;
    return `<div class="m-ev${r.seen ? ' seen' : ''}"><span class="t">${fmtTime(r.ts)}</span><span class="g ${esc(r.level)}">●</span><span class="m-main"><span>${esc(r.text)}</span>${r.change ? `<button type="button" class="m-link sub" data-m-change="${esc(r.change)}">${esc(label(r.change))}</button>` : '<span class="sub">outside changes</span>'}</span></div>${idx === mark ? markEl : ''}`;
  }).join('') + (mark < 0 ? markEl : '');
}

const COLS = [['doing', 'Doing', '●'], ['test', 'Test', '◐'], ['todo', 'To do', '○'], ['done', 'Done', '✓']];
export function changeHtml(state, c, { seg = 'tasks', col = null, fmt }) {
  const act = c.runs.filter((r) => r.active);
  const now = c.stuck
    ? `<div class="m-card m-prob" style="border-color:var(--bad)"><div><b class="bad">✗ ${esc(c.stuck.agent || 'round')} failed</b> <span class="sub">${esc(c.stuck.reason)}</span></div><div class="m-cmd">${esc(c.stuck.resume)}</div><button type="button" class="m-big" data-copy="${esc(c.stuck.resume)}">Copy command</button></div>`
    : act.length ? act.map((r) => `<div class="m-card m-now"><span class="m-av">${esc(String(r.agent).slice(0, 2).toUpperCase())}</span><div class="m-main"><span><b>${esc(r.agent)}</b>${r.task ? ` · task ${esc(r.task)}` : ''}</span><span class="sub"><span class="dot on pulse"></span><span data-since="${r.start}"></span> · ${esc(r.model || '?')}</span></div></div>`).join('')
    : `<div class="m-card m-now"><div class="m-main"><span>No agent running.</span><span class="sub">${esc((c.waiting && c.waiting.text) || '')}</span></div></div>`;
  const b = taskBoard(c), hasTasks = b.total > 0;
  const segs = [...(hasTasks ? [['tasks', 'Tasks']] : []), ['events', 'Events'], ['info', 'Info']];
  const cur = segs.some(([k]) => k === seg) ? seg : segs[0][0];
  let body = '';
  if (cur === 'tasks') {
    const c0 = col || (b.counts.doing ? 'doing' : b.counts.test ? 'test' : b.counts.todo ? 'todo' : 'done');
    const cards = b.cards.filter((k) => k.col === c0).map((k) => {
      const meta = k.col === 'doing' ? `<span class="ok">● ${esc(k.agent || '?')} · <span data-since="${k.since}"></span></span>` : k.col === 'test' ? (k.bad ? `<span class="bad">tests ✗ ${k.tests && k.tests.failed ? `${k.tests.failed} failed` : 'failed'}</span>` : `<span class="warn">ended ${fmt.time(k.endedAt)} · not ticked yet</span>`)
        : k.blocked ? `<span class="warn">⊘ ${k.waits.length ? `waits for ${esc(k.waits.join(', '))}` : 'blocked'}</span>` : k.col === 'done' ? '✓ ticked' : '';
      return `<div class="m-card m-task ${k.col}${k.bad ? ' bad' : ''}"><div class="m-row1"><span class="kind k-${KIND_CLASSES.includes(k.kind) ? k.kind : 'other'}">${esc(k.kind)}</span><b class="mono">${esc(k.id || '·')}</b></div><div>${esc(String(k.text || '').replace(/^\d+\.\d+[a-z]?\s*[:.\-–]?\s*/i, ''))}</div>${meta ? `<div class="m-meta">${meta}</div>` : ''}</div>`;
    }).join('');
    const nowRows = b.now.map((r) => `<div class="m-card m-task doing"><div class="m-row1"><b>${esc(r.agent)}</b><span class="sub">${r.taskIds.length ? `tasks ${esc(r.taskIds.join(', '))}` : 'no task cited'}</span></div><div>${esc(r.what)}</div><div class="m-meta"><span class="ok">● <span data-since="${r.since}"></span></span></div></div>`).join('');
    body = `${nowRows}<div class="m-chips">${COLS.map(([k, l, g]) => `<button type="button" class="m-chip${k === c0 ? ' cur' : ''}" data-m-col="${k}"><span>${g}</span>${l} <b>${b.counts[k]}</b></button>`).join('')}</div>${cards || '<div class="m-none">nothing here</div>'}`;
  } else if (cur === 'events') {
    const g = ((state.timeline && state.timeline.groups) || []).find((x) => x.change === c.id);
    const items = g ? g.items.slice().sort((a, b2) => b2.ts - a.ts) : [];
    body = items.length ? items.map((it) => `<div class="m-ev"><span class="t">${fmt.time(it.ts)}</span><span class="g ${esc(it.level)}">●</span><span class="m-main">${esc(it.text)}</span></div>`).join('') : '<div class="m-none">nothing since you left</div>';
  } else {
    const kv = [['stage', c.trail && c.trail.current ? c.trail.current : c.status], ['rounds', `${c.rounds} · ${c.handoffs} handoffs`], ['time', fmt.dur(c.durationMs)], ['cost', `${fmt.usd(c.usd)}${c.budget ? ` / ${fmt.usd(c.budget.limit)}` : ''}`],
      ['tests', c.tests ? (c.tests.ok ? `✓ ${c.tests.passed ?? ''} passed` : `✗ ${c.tests.failed ?? ''} failed`) : '—'], ['last activity', fmt.time(c.lastActivity)]];
    body = `<div class="m-list">${kv.map(([k, v]) => `<div class="m-line" style="cursor:default"><span class="m-main sub">${esc(k)}</span><span class="mono">${esc(v)}</span></div>`).join('')}</div><p class="m-foot">Diff, rounds and files are on the desktop view.</p>`;
  }
  return `${dots(c)}${now}<div class="m-seg" role="tablist">${segs.map(([k, l]) => `<button type="button" role="tab" class="${k === cur ? 'cur' : ''}" data-m-seg="${k}">${l}</button>`).join('')}</div>${body}`;
}

export function moreHtml(state, { away, theme, themes, agents }) {
  const run = new Set((state.running || []).map((r) => r.agent));
  return `<div class="m-sec">Notifications</div><div class="m-list"><div class="m-line" style="cursor:default"><span class="m-main">Away from the computer<span class="sub">questions wait for you here, up to ~55 min</span></span><button type="button" class="m-sw${away ? ' on' : ''}" data-m-away aria-pressed="${away}" aria-label="Away"></button></div>
    <button type="button" class="m-line" data-m-settings><span class="m-main">Notification settings<span class="sub">topic, events, content</span></span>${chev}</button></div>
    <div class="m-sec">Team <b>${agents.length}</b></div><div class="m-list">${agents.map((a) => `<div class="m-line" style="cursor:default"><span class="dot${run.has(a) ? ' on' : ''}"></span><span class="m-main mono">${esc(a)}</span></div>`).join('') || '<div class="m-none">no agents</div>'}</div>
    <div class="m-sec">Appearance</div><div class="m-list"><label class="m-line"><span class="m-main">Theme</span><select data-m-theme>${themes.map((t) => `<option${t === theme ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label></div>
    <p class="m-foot">${esc(state.project.dir)}</p>`;
}

export function navHtml(scr, inbox) {
  const items = [['home', '⌂', 'Home'], ['inbox', '!', 'Inbox'], ['events', '≡', 'Events'], ['more', '⋯', 'More']];
  return items.map(([k, ic, l]) => `<button type="button" class="${scr === k ? 'cur' : ''}" data-m-go="${k}"${scr === k ? ' aria-current="page"' : ''}><span class="ic">${ic}</span>${l}${k === 'inbox' && inbox ? `<span class="b">${inbox}</span>` : ''}</button>`).join('');
}
