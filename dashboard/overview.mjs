// The Overview tab of the main page: the changes table (short rows that expand), Sessions, finished recently and
// the change cards. Pure HTML builders over /api/state; index.html wires the clicks. chOpen / sessOpen hold what is
// expanded so it survives the page's redraws.
import { TIP_CACHE, TIP_NEW, TIP_USD, changeLabel, colorOf, fmtDate, initials, stuckHtml, testsBadge, tokCols, tokHeads, usdCol, usdHead, waitHtml } from './render.mjs';
import { esc, fmtDur, fmtTime, fmtTok, fmtUsd, hashFor, sparkSvg, testDots, trendOf } from './ui.mjs';

// ---- changes as one table grouped by status ----
export function stageOf(c) {
  if (c.archived) return ['archived', ''];
  if (c.kind === 'adhoc') return ['ad-hoc', c.activeAgents.length ? 'ok' : ''];
  const s = c.trail && c.trail.steps ? c.trail.steps.find((x) => x.state === 'active') : null;
  if (!s) return [c.status || '—', ''];
  const label = `${s.label.toLowerCase()}${s.times > 1 ? ` ×${s.times}` : ''}`;
  return [label, c.stuck ? 'bad' : c.activeAgents.length ? 'ok' : s.key === 'approval' ? 'warn' : ''];
}
// duration of the agent's last rounds (oldest → newest) and whether they are getting slower
export function roundsSpark(a) {
  if (!a.recent || a.recent.length < 3) return '';
  const tr = trendOf(a.recent), T = { slower: ['↑ slower', 'tr-up'], faster: ['↓ faster', 'tr-down'], steady: ['→ steady', 'sub'] }[tr];
  return `<div class="sub" style="display:flex;align-items:center;gap:8px;margin-top:4px">${sparkSvg(a.recent, { w: 110, h: 18, tips: a.recent.map((d, i) => `round ${i + 1} of the last ${a.recent.length}: ${fmtDur(d)}`), label: `duration of ${a.agent}'s last ${a.recent.length} rounds` })}${T ? `<span class="${T[1]}">${T[0]}</span>` : ''}</div>`;
}
// the change's last test runs as green / red blocks
export const testsHistory = (list) => testDots(list, { label: 'last test runs, oldest first', tips: (list || []).map((x) => `${x.ok ? 'passed' : 'failed'} · ${x.agent} · ${fmtTime(x.ts)}`) });
// changes table: a short line per change (state, stage, tasks, who runs, last activity); a click opens the details
// under it (progress per section, tests, review, numbers, agents) and "Open change" opens the tab. Open rows are kept.
export const chOpen = new Set();
export const okReview = (v) => /APPROVED/.test(v) && !/NOT APPROVED|CHANGES/.test(v);
export function changeDetail(c, adhoc) {
  const secs = Object.entries(c.sections || {}).filter(([, v]) => v.total).map(([k, v]) => `<div class="cdsec"><span>${esc(k.replace(/\s*\(.*$/, ''))}</span><span class="prog"><i style="width:${Math.round(100 * v.done / v.total)}%"></i></span><span class="mono">${v.done}/${v.total}</span></div>`).join('');
  const kv = [
    c.startedAt ? ['started', fmtTime(c.startedAt)] : null,
    ['rounds', `${c.rounds} · ${c.handoffs || 0} handoffs`],
    ['time', fmtDur(c.durationMs)],
    ['fresh', fmtTok(c.tokenSplit.fresh)], ['cache read', fmtTok(c.tokenSplit.cached)],
    ['cost', `${fmtUsd(c.usd)}${c.budget ? ` <span class="${c.budget.over ? 'warnc' : 'sub'}">of ${fmtUsd(c.budget.limit)} (${esc(c.budget.size)})</span>` : ''}`],
    ['tests', c.tests ? `${testsBadge(c.tests)}${c.testHistory && c.testHistory.length > 1 ? ` ${testsHistory(c.testHistory)}` : ''}` : '<span class="sub">—</span>'],
    !adhoc ? ['review', c.review ? `<span class="${okReview(c.review) ? 'okc' : 'warnc'}">${esc(c.review)}</span>` : '<span class="sub">none yet</span>'] : null,
    !adhoc ? ['validation', c.validation ? `<span class="${/APPROVED/.test(c.validation) && !/NOT APPROVED/.test(c.validation) ? 'okc' : 'badc'}">${esc(c.validation)}</span>` : '<span class="sub">none yet</span>'] : null,
  ].filter(Boolean);
  const ag = (c.agents || []).length ? `<table class="mini"><thead><tr><th>agent</th><th class="num">runs</th><th class="num">time</th><th class="num" title="${TIP_NEW}">fresh</th><th class="num">cost</th></tr></thead><tbody>${c.agents.map((a) => `<tr><td>${esc(a.agent)}${a.active ? ' <span class="okc">●</span>' : ''}</td><td class="num">${a.runs}</td><td class="num">${fmtDur(a.durationMs)}</td><td class="num">${fmtTok(a.tokenSplit.fresh)}</td><td class="num">${fmtUsd(a.usd)}</td></tr>`).join('')}</tbody></table>` : '';
  return `<div class="cdet"><div>
      ${secs ? `<div class="slbl">Progress</div><div class="cdsecs">${secs}</div>` : ''}
      ${stuckHtml(c)}${!adhoc && c.waiting && !c.archived ? waitHtml(c.waiting) : ''}
      ${ag ? `<div class="slbl" style="margin-top:12px">Agents</div>${ag}` : ''}</div>
    <div><div class="slbl">Numbers</div><div class="skv">${kv.map(([k, v]) => `<span class="k">${k}</span><span>${v}</span>`).join('')}</div>
      <div class="sacts"><button type="button" class="btn" data-change="${esc(c.id)}">Open change</button>${!adhoc && c.tasks.total ? `<button type="button" class="btn" data-change-view="tasks" data-id="${esc(c.id)}">Board</button>` : ''}<button type="button" class="btn" data-change-view="chat" data-id="${esc(c.id)}">Conversation</button></div></div></div>`;
}
export function boardTable(groups) {
  const DOT = { stuck: 'var(--bad)', blocked: 'var(--bad)', pending: 'var(--warn)', done: 'var(--line2)' };
  const ICON = { stuck: '✗', running: '●', blocked: '⊘', pending: '○', done: '✓', adhoc: '◇' };
  const row = (c, key) => {
    const live = c.activeAgents.length > 0, open = chOpen.has(c.id);
    const dot = `<span class="dot${live ? ' pulse' : ''}" style="width:7px;height:7px;background:${DOT[key] || (live ? 'var(--ok)' : 'var(--muted)')}"></span>`;
    const adhoc = c.kind === 'adhoc' || c.kind === 'no-change';
    const [stage, scls] = adhoc ? [c.kind === 'adhoc' ? 'ad-hoc' : 'no change', live ? 'ok' : ''] : stageOf(c);
    const tk = adhoc ? '<span class="sub">—</span>' : c.tasks.total ? `<span class="prog"><i style="width:${Math.round(100 * c.tasks.done / c.tasks.total)}%"></i></span>${c.tasks.done}/${c.tasks.total}` : '<span class="sub">—</span>';
    // one short line under the name, only for what needs attention
    const sub = [];
    if (c.stuck) sub.push(`<span class="badc">stuck: ${esc(c.stuck.agent)} ${c.stuck.kind === 'interrupted' ? 'interrupted' : 'failed'}</span>`);
    else if (adhoc) sub.push(esc([...new Set((c.agents || []).map((a) => a.agent))].join(', ') || '—'));
    else if (c.waiting && key !== 'done' && c.waiting.text !== 'undefined') sub.push(`waiting: ${esc(c.waiting.text)}`);
    if (c.budget && c.budget.over) sub.push(`<span class="warnc">▲ over budget</span>`);
    if (c.tasks.blocked) sub.push(`<span class="warnc">${c.tasks.blocked} blocked</span>`);
    const agents = live ? c.activeAgents.map((a) => `${esc(a.agent)} <span class="sub"><span data-since="${a.since}"></span></span>`).join(', ') : '<span class="sub">—</span>';
    const last = c.lastActivity ? `<span class="when">${fmtTime(c.lastActivity)}<span class="sub"><span data-since="${c.lastActivity}"></span> ago</span></span>` : '<span class="sub">—</span>';
    return `<tr class="crow${key === 'done' ? ' done' : ''}${open ? ' open' : ''}" data-change="${esc(c.id)}" tabindex="0" role="button" aria-expanded="${open}">
      <td>${dot}</td>
      <td><a class="cid" href="${hashFor('change', c.id)}" data-open-change="${esc(c.id)}" title="open the change">${esc(c.title || c.id)}</a>${sub.length ? `<div class="csub">${sub.join(' · ')}</div>` : ''}</td>
      <td><span class="badge ${scls}">${esc(stage)}</span></td>
      <td class="mono">${tk}</td>
      <td class="mono" style="font-size:12px">${agents}</td>
      <td>${last}</td>
      <td><span class="chev" aria-hidden="true">▸</span></td></tr>
      <tr class="cexp"${open ? '' : ' hidden'}><td></td><td colspan="6">${open ? changeDetail(c, adhoc) : ''}</td></tr>`;
  };
  const body = groups.map(([label, list, , key]) => `<tr class="grp"><td colspan="7"><span aria-hidden="true">${ICON[key] || '·'}</span> ${esc(label)} · ${list.length}</td></tr>`
    + (list.length ? list.map((c) => row(c, key)).join('') : `<tr><td></td><td colspan="6" class="sub">no change</td></tr>`)).join('');
  return `<div class="ctbl chtbl scroll"><table><thead><tr><th></th><th>change</th><th>stage</th><th>tasks</th><th>running</th><th>last activity</th><th></th></tr></thead><tbody>${body}</tbody></table></div>`;
}
// ---- Agents now (sessionsNow in shell.mjs): one line per session; open ones kept across redraws
export const sessOpen = new Set();
export const SESS_DOT = { working: 'var(--ok)', waiting: 'var(--warn)', idle: 'var(--muted)', quiet: 'var(--line2)' };
export function sessionsNowHtml(list) {
  const when = (t) => (t ? `<span class="when">${fmtTime(t)}<span class="sub"><span data-since="${t}"></span> ago</span></span>` : '<span class="sub">—</span>');
  const sub = (r, done) => {
    const st = done ? 'var(--line2)' : r.status === 'running' ? 'var(--ok)' : 'var(--warn)';
    const meta = done ? `ended ${fmtTime(r.end)} · ${esc(r.status)}` : `since ${fmtTime(r.since)} (<span data-since="${r.since}"></span>) · last activity ${fmtTime(r.lastActivity)}${r.status !== 'running' ? ` · <span class="warnc">${esc(r.status)}</span>` : ''}`;
    return `<div class="sacard${done ? ' done' : ''}"><span class="av">${esc(initials(r.agent))}<i style="background:${st}"></i></span>
      <div class="sam"><div class="sat"><b>${esc(r.agent)}</b>${r.stage ? `<span class="badge">${esc(r.stage)}</span>` : ''}${r.tests ? ` ${testsBadge(r.tests)}` : ''}</div>
        ${r.description ? `<div class="saw">${esc(r.description)}</div>` : ''}<div class="sub mono samt">${meta} · ${esc(r.model || '?')} · ${fmtTok(r.tokenSplit.fresh)} fresh · ${fmtUsd(r.usd)}</div></div>
      <div class="saa"><button type="button" class="btn" data-follow="${esc(r.id)}">Output</button><button type="button" class="btn" data-open-agent="${esc(r.agent)}">Agent</button></div></div>`;
  };
  // a finished subagent: one compact line (the Output button still opens its transcript)
  const earlier = (r) => `<div class="searl"><span class="av">${esc(initials(r.agent))}</span><b>${esc(r.agent)}</b><span class="saw">${esc(r.description || '')}</span><span class="sub mono">${fmtTime(r.end)} · ${fmtUsd(r.usd)}</span><button type="button" class="btn" data-follow="${esc(r.id)}">Output</button></div>`;
  const row = (s) => {
    const open = sessOpen.has(s.sessionId);
    const stTxt = s.state === 'working' ? `working · ${s.working} subagent${s.working === 1 ? '' : 's'}` : s.state === 'waiting' ? `waiting for you · ${esc(String(s.question).slice(0, 80))}`
      : s.state === 'quiet' ? 'quiet · no activity for over 1 h' : 'idle';
    const kids = s.working ? `<span class="okc">● ${s.working} working</span>` : s.subs.length ? `<span class="warnc">${s.subs.length} without signal</span>` : s.earlier.length ? `<span class="sub">${s.earlier.length} earlier</span>` : '<span class="sub">—</span>';
    const kv = [['id', `<code>${esc(s.sessionId)}</code>`], ['model', esc(s.model || '?')], s.tokenSplit ? ['fresh', fmtTok(s.tokenSplit.fresh)] : null, s.tokenSplit ? ['cache read', fmtTok(s.tokenSplit.cached)] : null,
      s.usd != null ? ['cost', `${fmtUsd(s.usd)}${s.subsUsd ? ` <span class="sub">(+${fmtUsd(s.subsUsd)} subagents now)</span>` : ''}`] : null, s.gitBranch ? ['branch', esc(s.gitBranch)] : null,
      s.plan && s.plan.current ? ['step', `${esc(s.plan.current)} <span class="sub">(${s.plan.done}/${s.plan.total})</span>`] : null].filter(Boolean);
    const exp = `<div class="sexp"${open ? '' : ' hidden'}><div><div class="slbl">${s.subs.length ? 'Subagents of this session' : 'Subagents'}</div>
        ${s.question ? `<div class="sask"><span class="warnc">?</span> ${esc(s.question)} <span class="sub">· answer it <a href="#decisions">above</a> or in the terminal</span></div>` : ''}
        ${s.subs.map((r) => sub(r, false)).join('')}${s.earlier.length ? `<div class="slbl" style="margin-top:12px">Finished earlier</div>${s.earlier.slice(0, 3).map(earlier).join('')}${s.earlier.length > 3 ? `<details class="smore"><summary class="sub">${s.earlier.length - 3} more</summary>${s.earlier.slice(3).map(earlier).join('')}</details>` : ''}` : ''}
        ${!s.subs.length && !s.earlier.length ? '<div class="sub">No subagent working now.</div>' : ''}</div>
      <div><div class="slbl">Session</div><div class="skv">${kv.map(([k, v]) => `<span class="k">${k}</span><span>${v}</span>`).join('')}</div>
        <div class="sacts">${s.change ? `<button type="button" class="btn" data-change="${esc(s.change)}">Open change</button>` : ''}${s.main ? `<button type="button" class="btn" data-follow="${esc(s.main.id)}">Follow in Output</button>` : ''}<button type="button" class="btn" data-copy="claude --resume ${esc(s.sessionId)}">Copy resume</button></div></div></div>`;
    return `<div class="srow scols${open ? ' open' : ''}${s.state === 'quiet' ? ' quiet' : ''}" role="button" tabindex="0" data-sess="${esc(s.sessionId)}" aria-expanded="${open}">
      <span><span class="dot${s.state === 'working' ? ' pulse' : ''}" style="width:8px;height:8px;background:${SESS_DOT[s.state]}"></span></span>
      <span class="snm"><b>${esc(s.name)}</b><span class="sub">${stTxt}</span></span>
      <span class="schg">${s.change ? `<a href="${hashFor('change', s.change)}" data-open-change="${esc(s.change)}" title="open the change">${esc(changeLabel(s.change))}</a>` : '<span class="sub">—</span>'}</span>
      <span>${s.stage ? `<span class="badge${s.state === 'waiting' ? ' warn' : s.state === 'working' ? ' ok' : ''}">${esc(String(s.stage).toLowerCase())}</span>` : '<span class="sub">—</span>'}</span>
      ${when(s.start)}${when(s.last)}<span class="mono" style="font-size:12px">${kids}</span><span class="chev" aria-hidden="true">▸</span></div>${exp}`;
  };
  return `<div class="sesslist"><div class="scols slh"><span></span><span>session</span><span>change</span><span>stage</span><span>started</span><span>last activity</span><span>subagents</span><span></span></div>${list.map(row).join('')}</div>`;
}
// rounds that ended lately, in the Sessions layout: a short line, a click for the rest (open ones kept in sessOpen)
export const END_DOT = { finished: 'var(--muted)', failed: 'var(--bad)', interrupted: 'var(--warn)', 'no signal': 'var(--warn)' };
export function recentHtml(list) {
  const row = (r) => {
    const key = `run:${r.id}`, open = sessOpen.has(key);
    const st = r.status || 'finished', bad = st !== 'finished';
    const kv = [['session', esc(r.sessionName || '—')], ['model', esc(r.model || '?')], ['fresh', fmtTok(r.tokenSplit.fresh)], ['cache read', fmtTok(r.tokenSplit.cached)], ['cost', fmtUsd(r.usd)],
      r.tests ? ['tests', testsBadge(r.tests)] : null].filter(Boolean);
    const exp = `<div class="sexp"${open ? '' : ' hidden'}><div><div class="slbl">What</div><div>${esc(r.description || '—')}</div></div>
      <div><div class="slbl">Round</div><div class="skv">${kv.map(([k, v]) => `<span class="k">${k}</span><span>${v}</span>`).join('')}</div>
        <div class="sacts"><button type="button" class="btn" data-follow="${esc(r.id)}">Output</button><button type="button" class="btn" data-open-agent="${esc(r.agent)}">Agent</button></div></div></div>`;
    return `<div class="srow rcols${open ? ' open' : ''}" role="button" tabindex="0" data-sess="${esc(key)}" aria-expanded="${open}">
      <span><span class="dot" style="width:8px;height:8px;background:${END_DOT[st] || 'var(--muted)'}"></span></span>
      <span class="snm"><b>${esc(r.agent)}</b><span class="sub${bad ? ' warnc' : ''}">${esc(st)}</span></span>
      <span class="schg">${r.change ? `<a href="${hashFor('change', r.change)}" data-open-change="${esc(r.change)}" title="open the change">${esc(changeLabel(r.change))}</a>` : '<span class="sub">—</span>'}</span>
      <span>${r.stage ? `<span class="badge">${esc(String(r.stage).toLowerCase())}</span>` : '<span class="sub">—</span>'}</span>
      <span class="when">${fmtTime(r.end)}<span class="sub"><span data-since="${r.end}"></span> ago</span></span>
      <span class="mono" style="font-size:12.5px">${fmtDur(Math.max(0, (r.end || 0) - (r.since || r.end || 0)))}</span>
      <span class="chev" aria-hidden="true">▸</span></div>${exp}`;
  };
  return `<div class="sesslist"><div class="rcols slh"><span></span><span>agent</span><span>change</span><span>stage</span><span>ended</span><span>took</span><span></span></div>${list.map(row).join('')}</div>`;
}
export function cardHtml(c) {
  const b = [];
  if (c.stuck) b.push(`<span class="badge bad">stuck</span>`);
  if (c.budget && c.budget.over) b.push(`<span class="badge warn" title="BUDGET_${c.budget.size.toUpperCase()}_USD in ai-team.conf">over budget: ${fmtUsd(c.usd)} of ${fmtUsd(c.budget.limit)}</span>`);
  if (c.tasks.total) b.push(`<span class="badge">tasks ${c.tasks.done}/${c.tasks.total}</span>`);
  if (c.tasks.blocked) b.push(`<span class="badge bad">${c.tasks.blocked} blocked</span>`);
  if (c.kind === 'adhoc') {   // no change: review and validation come back in the agents' replies, not in a file
    b.push(`<span class="badge">ad-hoc task</span>`);
    if (c.activeAgents.length) b.push(`<span class="badge ok">running: ${esc(c.activeAgents.map((a) => a.agent).join(', '))}</span>`);
  } else if (c.kind !== 'no-change') {
    b.push(c.review ? `<span class="badge ${/APPROVED/.test(c.review) && !/NOT APPROVED|CHANGES/.test(c.review) ? 'ok' : 'warn'}">review: ${esc(c.review)}</span>` : `<span class="badge">no review</span>`);
    b.push(c.validation ? `<span class="badge ${/APPROVED/.test(c.validation) && !/NOT APPROVED/.test(c.validation) ? 'ok' : 'bad'}">Validation: ${esc(c.validation)}</span>` : `<span class="badge">no validation</span>`);
  }
  if (c.tests) b.push(testsBadge(c.tests));
  if (c.archived) b.push(`<span class="badge ok">archived</span>`);
  if (c.unknown) b.push(`<span class="badge warn">no folder in openspec/</span>`);
  const secs = Object.entries(c.sections).filter(([, v]) => v.total).map(([k, v]) => `<div class="row"><span>${esc(k.replace(/\s*\(.*$/, ''))}</span><div class="bar"><i style="width:${Math.round(100 * v.done / v.total)}%"></i></div><span>${v.done}/${v.total}</span></div>`).join('');
  const w = c.waiting;
  const wait = stuckHtml(c) + waitHtml(w);
  const ag = c.agents.length ? `<table class="mini"><thead><tr><th>agent</th>${tokHeads}${usdHead}<th class="num">runs</th></tr></thead><tbody>${c.agents.map((a) => `<tr><td><span class="dot" style="background:${colorOf(a.agent)};width:8px;height:8px;margin-right:6px"></span>${esc(a.agent)}</td>${tokCols(a.tokenSplit)}${usdCol(a.usd)}<td class="num">${a.runs}</td></tr>`).join('')}</tbody></table>` : '';
  return `<div class="card${c.budget && c.budget.over ? ' over' : ''}" data-change="${esc(c.id)}" tabindex="0" role="button">
    <div class="top"><div class="id">${esc(c.title || c.id)}</div><div class="sub" title="start: ${esc(c.startSource || 'unknown')}">${c.startedAt ? 'started ' + fmtDate(c.startedAt) : ''}</div></div>
    <div class="badges">${b.join('')}</div>
    <div class="metrics"><span title="${TIP_NEW}"><b>${fmtTok(c.tokenSplit.fresh)}</b> fresh</span><span title="${TIP_CACHE}"><b>${fmtTok(c.tokenSplit.cached)}</b> cache read</span><span title="${TIP_USD}${c.unpricedModels && c.unpricedModels.length ? ` (no price for ${esc(c.unpricedModels.join(', '))})` : ''}"><b>${fmtUsd(c.usd)}</b>${c.budget ? ` <span class="sub">of ${fmtUsd(c.budget.limit)}</span>` : ''}</span><span><b>${c.rounds}</b> runs</span><span title="time of the agents on this change"><b>${fmtDur(c.durationMs)}</b></span>${c.handoffs ? `<span title="how many times the change moved to a different agent"><b>${c.handoffs}</b> handoffs</span>` : ''}<span>activity ${c.lastActivity ? fmtTime(c.lastActivity) : '—'}</span></div>
    ${secs ? `<div class="secs">${secs}</div>` : ''}${wait}${ag}
  </div>`;
}
