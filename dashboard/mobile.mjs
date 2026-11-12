// Phone layout of the main page (v3 step 5), under 760 px: a top bar, one screen at a time (Home, Inbox, Events,
// More, a change in full screen) and a bottom bar. Pure HTML builders over /api/state; index.html routes the taps.
// Less detail than the desktop on purpose: decide and check, not analyse (no diff, rounds or files here).
import { esc } from './ui.mjs';
import { eventsLog, taskBoard, problemsList, KIND_CLASSES, timeBoard, sessionsNow, liveRounds } from './shell.mjs';
import { NOTIFY_EVENTS } from './views.mjs';

const label = (id) => (String(id).startsWith('adhoc:') ? String(id).slice(6) : String(id));
const chev = '<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6"></path></svg>';

// the Inbox badge counts what the Inbox lists: decisions waiting, then stuck, failing and blocked changes
export function inboxCount(state) {
  if (!state || state.error) return 0;
  return (state.pending || []).length + problemsList(state).filter((p) => p.kind !== 'silent').length;
}

const backBar = (title, extra = '') => `<div class="m-top"><button type="button" class="m-back" data-m-back aria-label="Back"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m15 18-6-6 6-6"></path></svg></button><span class="m-proj m-ttl">${esc(title)}</span>${extra}</div>`;
export function topHtml(state, { conn, change = null, title = null }) {
  if (title) return backBar(title);
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

const SESS_DOT = { working: 'var(--ok)', waiting: 'var(--warn)', idle: 'var(--muted)', quiet: 'var(--line2)' };
const prog = (c) => (c.tasks && c.tasks.total ? `<span class="m-prog"><i style="width:${Math.round(100 * c.tasks.done / c.tasks.total)}%"></i></span><span class="m-r sub mono">${c.tasks.done}/${c.tasks.total}</span>` : '');
const stageOf = (c) => { const st = c.trail && c.trail.steps ? c.trail.steps.find((x) => x.state === 'active') : null; return st ? st.label.toLowerCase() : c.status || ''; };
// Home: the decisions first, answered in place (the #decisions forms move into #m-decslot), then stuck, the active
// sessions and the open changes as short rows; quiet sessions, done and ad-hoc fold into one line each
export function homeHtml(state, { fmt }) {
  const byId = new Map(state.changes.map((c) => [c.id, c]));
  const pick = (ids) => (ids || []).map((i) => byId.get(i)).filter(Boolean);
  const bd = state.board, pend = state.pending || [];
  const stuck = pick(bd.stuck).map((c) => `<button type="button" class="m-card m-line" data-m-change="${esc(c.id)}"><span class="g bad">✗</span><span class="m-main"><span class="m-id">${esc(label(c.id))}</span><span class="sub">stuck · ${esc(c.stuck ? c.stuck.reason : '')}</span></span>${chev}</button>`).join('');
  const all = sessionsNow(state), sess = all.filter((x) => x.state !== 'quiet'), quiet = all.length - sess.length;
  const nSub = all.reduce((n, x) => n + x.working, 0);
  const sessRow = (x) => `<button type="button" class="m-line" data-m-sess="${esc(x.sessionId)}"><span class="dot${x.state === 'working' ? ' pulse' : ''}" style="background:${SESS_DOT[x.state]}"></span><span class="m-main"><span class="m-id m-sans">${esc(x.name)}</span><span class="sub">${esc([x.change ? label(x.change) : '', x.stage ? String(x.stage).toLowerCase() : '', x.state === 'waiting' ? 'waiting for you' : x.working ? `${x.working} working` : ''].filter(Boolean).join(' · '))}${x.last ? ` · ${fmt.time(x.last)}` : ''}</span></span>${chev}</button>`;
  const open = [...pick(bd.running), ...pick(bd.blocked), ...pick(bd.pending)];
  const chRow = (c) => {
    const act = (c.activeAgents || [])[0], pending = (bd.pending || []).includes(c.id);
    return `<button type="button" class="m-line" data-m-change="${esc(c.id)}"><span class="dot${act ? ' pulse' : ''}" style="background:${act ? 'var(--ok)' : pending ? 'var(--warn)' : 'var(--muted)'}"></span><span class="m-main"><span class="m-id">${esc(label(c.id))}</span><span class="sub">${esc([stageOf(c), act ? act.agent : ''].filter(Boolean).join(' · '))}${c.lastActivity ? ` · ${fmt.time(c.lastActivity)}` : ''}</span></span>${prog(c)}${chev}</button>`;
  };
  const done = (bd.done || []).length + (bd.doneOlder || []).length, adhoc = (bd.other || []).length;
  return `${pend.length ? `<div class="m-sec"><span class="warn">Decisions</span> <b class="warn">${pend.length}</b></div><div id="m-decslot"></div>` : ''}
    ${stuck ? `<div class="m-sec">Stuck <b class="bad">${pick(bd.stuck).length}</b></div>${stuck}` : ''}
    ${!pend.length && !stuck ? '<div class="m-calm">✓ Nothing waits for you.</div>' : ''}
    <div class="m-sec">Sessions <b>${sess.length}</b><span class="m-r sub">${nSub ? `${nSub} subagent${nSub === 1 ? '' : 's'} working` : ''}</span></div>
    <div class="m-list">${sess.map(sessRow).join('') || '<div class="m-none">no active session</div>'}${quiet ? `<details class="m-fold"><summary class="m-line"><span class="m-main sub">${quiet} quiet session${quiet === 1 ? '' : 's'} (1 h+)</span>${chev}</summary>${all.filter((x) => x.state === 'quiet').map(sessRow).join('')}</details>` : ''}</div>
    <div class="m-sec">Changes <b>${open.length}</b></div>
    <div class="m-list">${open.map(chRow).join('') || '<div class="m-none">no change open</div>'}<div class="m-line m-dim" style="cursor:default"><span class="g">✓</span><span class="m-main sub">${done} done · ${adhoc} ad-hoc · ${fmt.usd(state.totals.usd)} est.</span></div></div>
    <p class="m-foot">Diff, rounds, files and the full tables are on the desktop view.</p>`;
}

// a session in full screen: its state, the subagents working now, the ones that finished earlier, its numbers
export function sessionHtml(s, { fmt }) {
  const kv = (rows) => `<div class="m-list">${rows.filter(Boolean).map(([k, v]) => `<div class="m-line" style="cursor:default"><span class="m-main sub">${esc(k)}</span><span class="mono m-v">${v}</span></div>`).join('')}</div>`;
  const stTxt = s.state === 'working' ? `working · ${s.working} subagent${s.working === 1 ? '' : 's'}` : s.state === 'waiting' ? 'waiting for you' : s.state === 'quiet' ? 'quiet · no activity for over 1 h' : 'idle';
  const work = s.subs.map((r) => `<div class="m-card m-sa${r.status === 'running' ? '' : ' warn'}"><div class="m-row1"><span class="m-av">${esc(String(r.agent).slice(0, 2).toUpperCase())}</span><b class="mono">${esc(r.agent)}</b>${r.stage ? `<span class="badge">${esc(String(r.stage).toLowerCase())}</span>` : ''}</div>
      ${r.description ? `<div>${esc(r.description)}</div>` : ''}<div class="m-meta">since ${fmt.time(r.since)} (<span data-since="${r.since}"></span>) · ${fmt.usd(r.usd)}${r.status !== 'running' ? ` · <span class="warn">${esc(r.status)}</span>` : ''}</div>
      ${r.change ? `<div class="m-btns"><button type="button" class="m-btn" data-m-out="${esc(r.change)}">Output</button><button type="button" class="m-btn" data-m-change="${esc(r.change)}">Open change</button></div>` : ''}</div>`).join('');
  const early = s.earlier.map((r) => `<div class="m-line" style="cursor:default"><span class="m-main"><span class="mono">${esc(r.agent)}</span><span class="sub">${esc(r.description || '')} · ${fmt.time(r.end)} · ${fmt.usd(r.usd)}</span></span></div>`);
  return `<div class="m-card"><div class="m-row1"><span class="dot${s.state === 'working' ? ' pulse' : ''}" style="background:${SESS_DOT[s.state]}"></span><span class="${s.state === 'working' ? 'ok' : s.state === 'waiting' ? 'warn' : 'sub'} mono">${esc(stTxt)}</span></div>
      ${s.question ? `<div class="m-q">${esc(s.question)}</div>` : ''}</div>
    ${kv([s.change ? ['change', `<button type="button" class="m-link" data-m-change="${esc(s.change)}">${esc(label(s.change))}</button>`] : null, s.stage ? ['stage', esc(String(s.stage).toLowerCase())] : null,
      ['started', s.start ? fmt.time(s.start) : '—'], ['last activity', s.last ? `${fmt.time(s.last)} · <span data-since="${s.last}"></span> ago` : '—']])}
    ${work ? `<div class="m-sec">Working now <b>${s.subs.length}</b></div>${work}` : ''}
    ${early.length ? `<div class="m-sec">Finished earlier <b>${early.length}</b></div><div class="m-list">${early.slice(0, 3).join('')}${early.length > 3 ? `<details class="m-fold"><summary class="m-line"><span class="m-main sub">${early.length - 3} more</span>${chev}</summary>${early.slice(3).join('')}</details>` : ''}</div>` : ''}
    ${!work && !early.length ? '<div class="m-none">No subagent working now.</div>' : ''}
    <div class="m-sec">Session</div>
    ${kv([['model', esc(s.model || '?')], s.tokenSplit ? ['fresh', fmt.tok(s.tokenSplit.fresh)] : null, s.usd != null ? ['cost', `${fmt.usd(s.usd)}${s.subsUsd ? ` <span class="sub">(+${fmt.usd(s.subsUsd)})</span>` : ''}`] : null, s.gitBranch ? ['branch', esc(s.gitBranch)] : null,
      s.plan && s.plan.current ? ['step', `${esc(s.plan.current)} (${s.plan.done}/${s.plan.total})`] : null])}
    <button type="button" class="m-big" data-copy="claude --resume ${esc(s.sessionId)}">Copy resume command</button>`;
}

// More › Notifications: the phone's version of Settings › User (notify.json through /api/notify); saved on change
export function notifyHtml(view, { away }) {
  if (!view) return '<div class="m-none">loading…</div>';
  const sw = (key, on, title, sub = '') => `<label class="m-line"><span class="m-main">${title}${sub ? `<span class="sub">${sub}</span>` : ''}</span><input type="checkbox" class="m-swi" data-m-set="${key}"${on ? ' checked' : ''}><span class="m-sw${on ? ' on' : ''}" aria-hidden="true"></span></label>`;
  const field = (key, title, value, type = 'text', ph = '') => `<label class="m-line m-field"><span class="m-main">${title}</span><input class="m-in" type="${type}" data-m-set="${key}" value="${esc(value || '')}" placeholder="${esc(ph)}" spellcheck="false" autocomplete="off"></label>`;
  const warn = view.detail && view.publicTopic ? `<div class="m-card m-prob" style="border-color:var(--warn)"><div><b class="warn">Public topic, no token.</b> Anyone who guesses it reads the commands awaiting your approval.</div><button type="button" class="m-big" data-m-act="content-off">Turn content off</button></div>` : '';
  const env = view.disabledByEnv ? '<div class="m-card m-prob"><b class="warn">AI_TEAM_NOTIFY=0</b> is set in the dashboard: nothing is sent.</div>' : '';
  return `<div class="m-list"><div class="m-line" style="cursor:default"><span class="m-main">Away from the computer<span class="sub">questions wait for you here, up to ~24 h</span></span><button type="button" class="m-sw${away ? ' on' : ''}" data-m-away aria-pressed="${away}" aria-label="Away"></button></div></div>
    ${env}<div class="m-sec">Phone (ntfy)</div>${warn}
    <div class="m-list">${field('topic', 'Topic', view.topic, 'text', 'ai-team-…')}${field('server', 'Server', view.server, 'url')}${field('token', 'Access token', '', 'password', view.hasToken ? 'saved' : 'optional')}${field('dashboardUrl', 'Dashboard address', view.dashboardUrl, 'url', 'opened when you tap')}</div>
    <button type="button" class="m-btn m-wide" data-m-act="gen-topic">New random topic</button>
    <div class="m-sec">Send</div>
    <div class="m-list">${Object.keys(NOTIFY_EVENTS).filter((k) => view.events.includes(k)).map((k) => sw(`on:${k}`, view.on.includes(k), esc(NOTIFY_EVENTS[k][0]), esc(NOTIFY_EVENTS[k][1]))).join('')}</div>
    <div class="m-list">${sw('quietAtComputer', view.quietAtComputer, 'Only when away', 'finished / waiting stay quiet at the computer')}${sw('detail', view.detail, 'Show content', 'command and agent text in the notification')}</div>
    <button type="button" class="m-big" data-m-act="test">Send a test notification</button><div class="m-foot" id="setmsg" aria-live="polite"></div>`;
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
  // the rounds open now first (newest first on a phone): a live line each, not an event
  const live = liveRounds(state).map((r) => `<div class="m-ev"><span class="t ok">now</span><span class="g ok pulse">●</span><span class="m-main"><span>${esc(r.agent)} running for <span data-since="${r.since}"></span> · last <span data-since="${r.last}"></span> ago</span>${r.change ? `<button type="button" class="m-link sub" data-m-change="${esc(r.change)}">${esc(label(r.change))}</button>` : ''}</span></div>`).join('');
  if (!rows.length) return `${live}<div class="m-none">Nothing happened in the last 24 h.</div>`;
  const markEl = `<div class="m-mark">since you left${unseen ? ` · ${unseen} new <button type="button" data-seen>mark as seen</button>` : ''}</div>`;
  return live + rows.slice().reverse().map((r, i, all) => {   // newest first on a phone: what happened last is on top
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
  const segs = [...(hasTasks ? [['tasks', 'Tasks']] : []), ...(c.runs.length ? [['output', 'Output']] : []), ['events', 'Events'], ['info', 'Info']];
  const cur = segs.some(([k]) => k === seg) ? seg : segs[0][0];
  let body = '';
  if (cur === 'tasks') {
    const c0 = col || (b.counts.doing ? 'doing' : b.counts.test ? 'test' : b.counts.todo ? 'todo' : 'done');
    const cards = b.cards.filter((k) => k.col === c0).map((k) => {
      const meta = k.col === 'doing' ? `<span class="ok">● ${esc(k.agent || '?')} · <span data-since="${k.since}"></span></span>${k.ticked ? ' · ✓ ticked' : ''}` : k.col === 'test' ? (k.bad ? `<span class="bad">tests ✗ ${k.tests && k.tests.failed ? `${k.tests.failed} failed` : 'failed'}</span>` : `<span class="warn">ended ${fmt.time(k.endedAt)} · not ticked yet</span>`)
        : k.blocked ? `<span class="warn">⊘ ${k.waits.length ? `waits for ${esc(k.waits.join(', '))}` : 'blocked'}</span>` : k.queued ? `<span class="sub">◷ next in ${esc(k.queued)}'s round</span>` : k.col === 'done' ? '✓ ticked' : '';
      return `<div class="m-card m-task ${k.col}${k.bad ? ' bad' : ''}"><div class="m-row1"><span class="kind k-${KIND_CLASSES.includes(k.kind) ? k.kind : 'other'}">${esc(k.kind)}</span><b class="mono">${esc(k.id || '·')}</b></div><div>${esc(String(k.text || '').replace(/^\d+\.\d+[a-z]?\s*[:.\-–]?\s*/i, ''))}</div>${meta ? `<div class="m-meta">${meta}</div>` : ''}</div>`;
    }).join('');
    const nowRows = b.now.map((r) => `<div class="m-card m-task doing"><div class="m-row1"><b>${esc(r.agent)}</b><span class="sub">${r.taskIds.length ? `cites ${esc(r.taskIds.join(', '))}` : 'no task cited'}</span></div><div>${esc(r.what)}</div><div class="m-meta"><span class="ok">● <span data-since="${r.since}"></span></span></div></div>`).join('');
    body = `${nowRows}<div class="m-chips">${COLS.map(([k, l, g]) => `<button type="button" class="m-chip${k === c0 ? ' cur' : ''}" data-m-col="${k}"><span>${g}</span>${l} <b>${b.counts[k]}</b></button>`).join('')}</div>${cards || '<div class="m-none">nothing here</div>'}`;
  } else if (cur === 'output') {
    // the page fills it from /api/tail (the latest steps of the change's running round, else its latest one)
    body = '<div class="olist m-olist" id="molist" data-stick="1"><div class="m-none">reading the transcript…</div></div>';
  } else if (cur === 'events') {
    const g = ((state.timeline && state.timeline.groups) || []).find((x) => x.change === c.id);
    const items = g ? g.items.slice().sort((a, b2) => b2.ts - a.ts) : [];
    body = items.length ? items.map((it) => `<div class="m-ev"><span class="t">${fmt.time(it.ts)}</span><span class="g ${esc(it.level)}">●</span><span class="m-main">${esc(it.text)}</span></div>`).join('') : '<div class="m-none">nothing since you left</div>';
  } else {
    const kv = [['stage', c.trail && c.trail.current ? c.trail.current : c.status], ['rounds', `${c.rounds} · ${c.handoffs} handoffs`], ['time', fmt.dur(c.durationMs)], ['cost', `${fmt.usd(c.usd)}${c.budget ? ` / ${fmt.usd(c.budget.limit)}` : ''}`],
      ['tests', c.tests ? (c.tests.ok ? `✓ ${c.tests.passed ?? ''} passed` : `✗ ${c.tests.failed ?? ''} failed`) : '—'], ['last activity', fmt.time(c.lastActivity)]];
    const tb = timeBoard(c), FL = { spec: 'spec', build: 'development', review: 'review', fix: 'fixes', validation: 'validation', integration: 'integration' };
    kv.push(...tb.flows.map((f) => [`time · ${FL[f.flow] || f.flow}`, fmt.dur(f.ms)]));
    const secs = Object.entries(c.sections || {}).filter(([, v]) => v.total).map(([k, v]) => `<div class="m-psec"><span>${esc(k.replace(/\s*\(.*$/, ''))}</span><span class="m-prog"><i style="width:${Math.round(100 * v.done / v.total)}%"></i></span><span class="mono">${v.done}/${v.total}</span></div>`).join('');
    const okR = (v) => /APPROVED/.test(v) && !/NOT APPROVED|CHANGES/.test(v);
    kv.push(['review', c.review ? c.review : 'none yet'], ['validation', c.validation ? c.validation : 'none yet']);
    const hist = (c.testHistory || []).length > 1 ? `<div class="m-line" style="cursor:default"><span class="m-main sub">last test runs</span><span class="m-tdots">${c.testHistory.map((x) => `<i class="${x.ok ? 'ok' : 'bad'}"></i>`).join('')}</span></div>` : '';
    const ag = (c.agents || []).map((a) => `<div class="m-line" style="cursor:default">${a.active ? '<span class="dot on"></span>' : ''}<span class="m-main"><span class="mono">${esc(a.agent)}</span><span class="sub">${a.runs} run${a.runs === 1 ? '' : 's'} · ${fmt.dur(a.durationMs)} · ${fmt.usd(a.usd)}</span></span></div>`).join('');
    const w = c.waiting && c.waiting.text !== 'undefined' && !c.archived ? `<div class="m-card" style="border-style:dashed"><b>${esc(c.waiting.text)}</b><div class="sub">${c.waiting.source === 'declared' ? 'declared in the tasks.md header' : 'inferred'}</div></div>` : '';
    body = `${secs ? `<div class="m-sec">Progress</div><div class="m-card">${secs}</div>` : ''}${w}
      <div class="m-sec">Numbers</div><div class="m-list">${kv.map(([k, v]) => `<div class="m-line" style="cursor:default"><span class="m-main sub">${esc(k)}</span><span class="mono m-v${k === 'review' && c.review ? (okR(c.review) ? ' ok' : ' warn') : ''}">${esc(v)}</span></div>`).join('')}${hist}</div>
      ${ag ? `<div class="m-sec">Agents</div><div class="m-list">${ag}</div>` : ''}<p class="m-foot">Diff, rounds and files are on the desktop view.</p>`;
  }
  return `${dots(c)}${now}<div class="m-seg" role="tablist">${segs.map(([k, l]) => `<button type="button" role="tab" class="${k === cur ? 'cur' : ''}" data-m-seg="${k}">${l}</button>`).join('')}</div>${body}`;
}

export function moreHtml(state, { away, theme, themes, agents, crt = false }) {
  const run = new Set((state.running || []).map((r) => r.agent));
  return `<div class="m-sec">Notifications</div><div class="m-list"><div class="m-line" style="cursor:default"><span class="m-main">Away from the computer<span class="sub">questions wait for you here, up to ~24 h</span></span><button type="button" class="m-sw${away ? ' on' : ''}" data-m-away aria-pressed="${away}" aria-label="Away"></button></div>
    <button type="button" class="m-line" data-m-go="notify"><span class="m-main">Notifications<span class="sub">topic, events, content, test</span></span>${chev}</button></div>
    <div class="m-sec">Team <b>${agents.length}</b></div><div class="m-list">${agents.map((a) => `<div class="m-line" style="cursor:default"><span class="dot${run.has(a) ? ' on' : ''}"></span><span class="m-main mono">${esc(a)}</span></div>`).join('') || '<div class="m-none">no agents</div>'}</div>
    <div class="m-sec">Appearance</div><div class="m-list"><label class="m-line"><span class="m-main">Theme</span><select data-m-theme>${themes.map((t) => `<option${t === theme ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <div class="m-line" style="cursor:default"><span class="m-main">CRT effects<span class="sub">old-monitor look: scanlines, glow</span></span><button type="button" class="m-sw${crt ? ' on' : ''}" data-m-crt aria-pressed="${crt}" aria-label="CRT effects"></button></div></div>
    <p class="m-foot">${esc(state.project.dir)}</p>`;
}

export function navHtml(scr, inbox) {
  const items = [['home', '⌂', 'Home'], ['inbox', '!', 'Inbox'], ['events', '≡', 'Events'], ['more', '⋯', 'More']];
  return items.map(([k, ic, l]) => `<button type="button" class="${scr === k ? 'cur' : ''}" data-m-go="${k}"${scr === k ? ' aria-current="page"' : ''}><span class="ic">${ic}</span>${l}${k === 'inbox' && inbox ? `<span class="b">${inbox}</span>` : ''}</button>`).join('');
}
