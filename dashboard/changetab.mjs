// A change's tab on the main page: its Overview (now, stages, tasks, properties, artifacts), the tasks kanban,
// the time board, the conversation and the rounds table. Pure HTML builders; index.html wires the clicks.
import { FLOW_VERB, TIP_CACHE, TIP_NEW, avatar, changeLabel, fileUrl, initials, liveDur, sessLine, silentTxt, stCls, stuckHtml, taskLabel, testFailHtml, testsBadge, tokHeads, usdCol, usdHead, waitHtml } from './render.mjs';
import { KIND_CLASSES, TIME_KINDS, roundTime, taskBoard, timeBoard } from './shell.mjs';
import { esc, fmtDur, fmtTime, fmtTok, fmtUsd, typing } from './ui.mjs';

export function runsTable(runs, showChange, staleMin) {
  if (!runs.length) return '<p class="note">no runs.</p>';
  return `<div class="scroll"><table><thead><tr><th>agent</th>${showChange ? '<th>change</th>' : ''}<th>from → to</th><th>start</th><th>end</th><th class="num">duration</th>${tokHeads}${usdHead}<th>model</th><th>what</th></tr></thead><tbody>${runs.map((r, i) => `
    <tr class="run" data-i="${i}" tabindex="0" aria-expanded="false"><td><span class="st ${stCls(r.status)}" title="${esc(r.status)}"></span>${esc(r.agent)}${r.background ? ' <span class="sub" title="background">bg</span>' : ''}${silentTxt(r, staleMin)}</td>
      ${showChange ? `<td>${esc(changeLabel(r.change))}</td>` : ''}
      <td class="flow"><b>${esc(r.from || '?')}</b> → <b>${r.to ? esc(r.to) : (r.active ? '…' : '?')}</b></td>
      <td>${fmtTime(r.start)}</td><td>${r.active ? '<em>running</em>' : fmtTime(r.end)}</td>
      <td class="num" data-run-start="${r.active ? r.start : ''}">${r.active ? '' : fmtDur(liveDur(r))}</td>
      <td class="num" title="${TIP_NEW} (input ${fmtTok(r.usage.input)} · output ${fmtTok(r.usage.output)} · cache written ${fmtTok(r.usage.cacheCreation)}) · ${r.usage.requests} calls · ${r.toolUses} tools">${fmtTok(r.tokenSplit.fresh)}</td><td class="num" title="${TIP_CACHE}">${fmtTok(r.tokenSplit.cached)}</td>${usdCol(r.usd)}
      <td>${esc(r.model || '?')}</td><td>${esc(r.description || '')}${r.tests ? ' ' + testsBadge(r.tests) : ''}${sessLine(r)}</td></tr>
    <tr class="detail" hidden><td colspan="${showChange ? 10 : 9}">${esc(r.summary ? 'reply: ' + r.summary : '')}${r.summary && r.promptPreview ? '\n\n' : ''}${esc(r.promptPreview ? 'prompt: ' + r.promptPreview : '')}\n\ntokens: input ${fmtTok(r.usage.input)} · output ${fmtTok(r.usage.output)} · cache written ${fmtTok(r.usage.cacheCreation)} · cache read ${fmtTok(r.usage.cacheRead)} · ${r.usage.requests} calls · ${r.toolUses} tools${r.totalTokensReported != null ? ` · reported by the Agent tool: ${fmtTok(r.totalTokensReported)}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
}
// ---- conversation: feed messages (the assembly logic is in /feed.mjs) ----
export function chatHtml(items, showChange) {
  if (!items.length) return '<p class="note">no runs.</p>';
  return items.map((m) => {
    if (m.type === 'sep') return `<div class="sep${m.active ? ' on' : ''}">${esc(m.label)}${m.active ? ' · now' : ''}</div>`;
    const u = m.usage;
    const tip = `${TIP_NEW} (input ${fmtTok(u.input)} · output ${fmtTok(u.output)} · cache written ${fmtTok(u.cacheCreation)}) · ${u.requests} calls`;
    const stTag = m.status === 'failed' ? '<span class="tag bad">failed</span>' : m.status === 'no signal' ? `<span class="tag warn" title="no activity in the transcript and no recorded end">no signal for ${fmtDur(m.silentMs)}</span>` : m.status === 'interrupted' ? '<span class="tag warn">interrupted</span>' : '';
    const route = `called by <b>${esc(m.route.by)}</b>`;
    const around = m.route.around ? `<div class="around">${esc(m.route.around)}</div>` : '';
    const when = m.active ? `${fmtTime(m.start)} → <em>running</em>` : `${fmtTime(m.start)} → ${fmtTime(m.end)}`;
    const quote = m.summary ? `<div class="r">${m.summaryParts.map((p) => p.cls ? `<span class="${p.cls}">${esc(p.text)}</span>` : esc(p.text)).join('')}</div>` : '';
    const det = [m.promptPreview ? 'prompt: ' + m.promptPreview : '', m.totalTokensReported != null ? 'tokens reported by the Agent tool: ' + fmtTok(m.totalTokensReported) : ''].filter(Boolean).join('\n\n');
    return `<div class="msg${m.active ? ' on' : ''}" data-hc="${esc(m.agent)}">${avatar(m.agent, m.presence, { filter: false })}<div class="b">
      <div class="h"><b>${esc(m.agent)}</b>${m.background ? '<span class="tag" title="background">bg</span>' : ''}${stTag}${showChange ? `<span class="tag">${esc(m.change || '—')}</span>` : ''}<span class="route">${route}</span><span class="t">${when}</span></div>
      ${around}${m.sessionName ? `<div class="sess">session: ${esc(m.sessionName)}</div>` : ''}
      <div class="c">${esc(m.description || '(no description)')}${m.active ? '<span class="typing" title="working"><i></i><i></i><i></i></span>' : ''}</div>
      ${quote}
      <div class="chips"><span>${esc(m.model)}</span><span class="num"${m.active ? ` data-run-start="${m.start}"` : ''}>${m.active ? '' : fmtDur(m.durationMs)}</span><span title="${tip}"><b>${fmtTok(m.fresh)}</b> fresh</span><span title="${TIP_CACHE}"><b>${fmtTok(m.cached)}</b> cache read</span><span><b>${m.toolUses}</b> tool${m.toolUses === 1 ? '' : 's'}</span>${m.tests ? testsBadge(m.tests, 'tag') : ''}</div>${m.tests && m.tests.ok === false ? `<details class="tfx"><summary>what failed</summary>${testFailHtml(m.tests, { head: false })}</details>` : ''}
      ${det ? `<details><summary>show prompt</summary><pre>${esc(det)}</pre></details>` : ''}</div></div>`;
  }).join('');
}
export function nowStrip(c) {
  const t = c.trail, act = c.runs.filter((r) => r.active);
  const stale = c.runs.filter((r) => r.status === 'no signal' && r.delegated && r.silentMs < 24 * 3600 * 1000);
  const nx = t ? `<div class="next">${t.next ? `next: <b>${esc(t.next.label)}</b>` : ''}${t.after ? `<br>then: ${esc(t.after.label.toLowerCase())}` : ''}</div>` : '';
  const staleRows = stale.slice(0, 3).map((r) => `<div class="now">${avatar(r.agent, 'stale', { large: true, filter: false })}<div class="txt">
      <div><b>${esc(r.agent)}</b> no signal for <span data-silent="${Date.now() - r.silentMs}"></span></div>
      <div class="sub">last activity ${fmtTime(Date.now() - r.silentMs)} · started ${fmtTime(r.start)} · ${esc(r.model || '?')} · called by ${esc(r.from || '?')}</div>${sessLine(r)}</div></div>`).join('');
  if (!act.length) {
    return `<div class="now"><div class="txt"><div>No agent running now.</div>${stuckHtml(c)}${waitHtml(c.waiting)}</div>${nx}</div>${staleRows}`;
  }
  return act.slice(0, 3).map((r, i) => {
    const verb = FLOW_VERB[r.flow] || 'working';
    const tk = taskLabel(r);
    return `<div class="now">${avatar(r.agent, 'on', { large: true, filter: false })}<div class="txt">
      <div><b>${esc(r.agent)}</b> is ${verb}${tk ? ` <b>${esc(tk)}</b>` : ''}</div>
      <div class="sub">for <span data-since="${r.start}"></span> · ${esc(r.model || '?')} · ${fmtTok(r.tokenSplit.fresh)} fresh tokens · called by ${esc(r.from || '?')}</div>${sessLine(r)}</div>${i === 0 ? nx : ''}</div>`;
  }).join('') + (act.length > 3 ? `<p class="note">+${act.length - 3} agents running.</p>` : '') + staleRows;
}
export function stepMeta(s) {
  // an agent running on a stage the tasks.md header does not declare (a validator called while the header still
  // says review): the stage is being worked on all the same
  if (s.active && s.state !== 'active') return '● running';
  if (s.state === 'active') return s.active ? '● now' : s.key === 'approval' ? '● waiting for you' : s.key === 'integration' ? '● left to integrate' : '● in progress';
  if (s.key === 'approval') return s.state === 'done' ? 'approved' : '—';
  if (s.result && s.state === 'done') return esc(s.result);
  if (s.state === 'done') return s.rounds ? `${s.rounds} run${s.rounds > 1 ? 's' : ''}` : 'done';
  return s.queued ? 'queued' : '—';
}
export function trailHtml(c, filter, mainAgent, mainLive) {
  const t = c.trail; if (!t) return '';
  if (t.unknown) {
    const names = [...new Set(c.runs.map((r) => r.agent))];
    return `<div class="unk"><span>no folder in <b>.ai-team/openspec/</b>: unknown stage</span>${names.length ? `<span class="avs">${names.map((n) => avatar(n, c.runs.some((r) => r.agent === n && r.active) ? 'on' : 'done', { sel: filter === n })).join('')}</span>` : ''}</div>
      <div class="maestro">${avatar(mainAgent, mainLive ? 'on' : 'done', { sel: filter === mainAgent })}<span>${esc(mainAgent)} coordinates the stages: ${t.delegations} delegation${t.delegations === 1 ? '' : 's'} in this change.</span></div>`;
  }
  // a stage the change did not have (skipped: e.g. validation on a backend-only change) is not drawn
  const shown = t.steps.filter((s) => s.state !== 'skipped');
  const steps = shown.map((s, i) => {
    const sub = s.key === 'build' && s.tasks && s.tasks.total ? `devs · ${s.tasks.done} of ${s.tasks.total} tasks` : s.who;
    const who = s.key === 'integration' ? mainAgent : sub;
    const avs = s.agents.map((a) => avatar(a.agent, a.agent === mainAgent && a.state === 'wait' && mainLive ? 'on' : a.state, { sel: filter === a.agent })).join('');
    return `<div class="step s-${s.state}${s.loop ? ' loop' : ''}${s.active && s.state !== 'active' ? ' s-running' : ''}"><div class="sdot">${s.state === 'done' ? '✓' : i + 1}</div>
      <div><div class="lbl">${esc(s.label)}${s.times ? `<span class="times">×${s.times}</span>` : ''}</div><div class="who">${esc(who)}</div></div>
      <div class="avs">${avs}</div><div class="meta">${stepMeta(s)}</div></div>`;
  }).join('');
  const n = t.delegations;
  const srcLine = `<p class="src${t.source === 'declared' ? ' decl' : ''}" style="margin:4px 0 8px">stage ${t.source === 'declared' ? 'declared' : t.source === 'running' ? 'from the running agent' : 'inferred'}: ${esc(t.rule || '—')}${t.warning ? `<span class="warnline">${esc(t.warning)}</span>` : ''}</p>`;
  return `${srcLine}<div class="steps" style="--n:${shown.length}">${steps}</div>
    <div class="maestro">${avatar(mainAgent, mainLive ? 'on' : 'done', { sel: filter === mainAgent })}<span>${esc(mainAgent)} coordinates every stage: ${n} delegation${n === 1 ? '' : 's'} in this ${t.loose ? 'ad-hoc task (no proposal nor approval; stages taken from the runs)' : 'change'}. Dashed border: a stage that may repeat (review → fix → review).</span></div>`;
}
// ---- tasks kanban of a change (sub-tab Tasks): one board, a colored kind badge per task, rules in shell.mjs taskBoard
export const COL_HEAD = { todo: ['○', 'To do', 'not ticked and no running round cites it'], doing: ['●', 'Doing', 'a running round cites the task'], test: ['◐', 'Test', 'the last round on it ended but it is not ticked yet, or its tests came back red'], done: ['✓', 'Done', 'ticked in tasks.md'] };
// review findings: a badge on a task (open ones: blocking in red, the others in amber) and a row per finding
export const FSTATUS = { open: 'open', applied: 'fixed', verified: 'verified', backlog: 'backlog', archived: 'closed' };
export function findingsBadge(k) {
  const o = k.findings ? k.findings.open : [];
  if (!o.length) return '';
  const blk = o.filter((f) => /blocking/.test(f.severity));
  return ` <span class="fbadge${blk.length ? ' blk' : ''}" title="${esc(o.map((f) => `${f.id} ${f.severity}: ${f.file}${f.line ? `:${f.line}` : ''}`).join('\n'))}">${blk.length ? `${esc(blk.map((f) => f.id).join(' · '))} blocking` : esc(o.map((f) => f.id).join(' · '))}${blk.length && o.length > blk.length ? ` +${o.length - blk.length}` : ''}</span>`;
}
export function findingRow(f) {
  const sev = /blocking/.test(f.severity) ? 'blk' : /backlog/.test(f.severity) ? 'bl' : 'fba';
  return `<div class="fr ${f.status}"><div class="frh"><b>${esc(f.id)}</b><span class="fsev ${sev}">${esc(f.severity)}</span><span class="fst ${f.status}">${esc(FSTATUS[f.status] || f.status)}</span><code>${esc(f.file)}${f.line ? `:${esc(f.line)}` : ''}</code><span class="sub">${esc(f.category)} · round ${f.round}${f.taskSource === 'commit' ? ' · task from the commit' : ''}</span></div>${f.problem ? `<div class="frp">${esc(f.problem)}</div>` : ''}${f.fix ? `<div class="frf"><b>Fix</b> ${esc(f.fix)}</div>` : ''}</div>`;
}
export function tasksHtml(c, taskSel = null) {
  const b = taskBoard(c);
  if (!b.total) return '<p class="note">This change has no tasks in tasks.md.</p>';
  const sel = taskSel ? b.cards.find((x) => x.key === taskSel) : null;
  const pct = (n) => `${(100 * n / b.total).toFixed(1)}%`;
  const card = (k) => {
    const meta = k.col === 'doing' ? `<span class="ok">● ${esc(k.agent || '?')} ${esc(FLOW_VERB[k.flow] || 'working')} · <span data-since="${k.since}"></span></span>${k.ticked ? ' · ✓ ticked' : ''}`
      : k.col === 'test' ? (k.bad ? `<span class="bad">tests ✗ ${k.tests && k.tests.failed ? `${k.tests.failed} failed` : 'failed'}${k.agent ? ` · ${esc(k.agent)}` : ''}</span>` : `<span class="warn">ended ${fmtTime(k.endedAt)} · not ticked yet</span>`)
      : k.col === 'todo' && k.blocked ? `<span class="warn">⊘ ${k.waits.length ? `waits for ${esc(k.waits.join(', '))}` : 'blocked'}</span>`
      : k.col === 'todo' && k.queued ? `<span class="sub" title="cited by the running round, not started yet (the agent marks each task it starts)">◷ next in ${esc(k.queued)}'s round</span>`
      : k.col === 'done' ? '✓ ticked' : '';
    const kc = KIND_CLASSES.includes(k.kind) ? k.kind : 'other';
    const fb = findingsBadge(k);
    return `<button type="button" class="kc ${k.col}${k.bad ? ' bad' : ''}${sel && sel.key === k.key ? ' sel' : ''}" data-task="${esc(k.key)}" aria-pressed="${!!(sel && sel.key === k.key)}"><div class="top"><span class="kind k-${kc}" title="${esc(k.section)}">${esc(k.kind)}</span><span class="tid">${esc(k.id || '·')}</span>${k.agent && k.col !== 'done' ? `<span class="kav" title="${esc(k.agent)}">${esc(initials(k.agent))}</span>` : ''}</div>${k.time.measured != null ? `<div class="ktime measured" title="measured from the agents' task marks (task.sh)${k.time.measuredFlows ? `: ${esc(Object.entries(k.time.measuredFlows).map(([f, ms]) => `${FLOW_LABEL[f] || f} ${fmtDur(ms)}`).join(' · '))}` : ''}">⏱ ${fmtDur(k.time.measured)}</div>`
      : k.time.own || k.time.shared ? `<div class="ktime" title="no task marks: own = rounds that cite only this task · shared = rounds that cite it with other tasks (shown whole)">⏱ ${k.time.own ? fmtDur(k.time.own) : ''}${k.time.own && k.time.shared ? ' + ' : ''}${k.time.shared ? `${fmtDur(k.time.shared)} shared` : ''}</div>` : ''}<div class="x" title="${esc(k.text || '')}">${esc(String(k.text || '').replace(/^\d+\.\d+[a-z]?\s*[:.\-–]?\s*/i, ''))}</div>${meta || fb ? `<div class="meta">${meta}${fb}</div>` : ''}</button>`;
  };
  const cols = ['todo', 'doing', 'test', 'done'].map((col) => {
    const [g, label, rule] = COL_HEAD[col], list = b.cards.filter((x) => x.col === col);
    return `<div class="kcol"><div class="kh" title="${esc(rule)}"><span class="g ${col}">${g}</span>${label}<span class="n">${list.length}</span></div>${list.length ? list.map(card).join('') : '<div class="kempty"></div>'}</div>`;
  }).join('');
  let det = '';
  if (sel) {
    const rs = c.runs.filter((r) => sel.runIds.includes(r.id)).sort((a, b) => (a.start || 0) - (b.start || 0));
    const res = (r) => r.active ? '<span class="ok">running</span>' : r.tests ? testsBadge(r.tests) : `<span class="sub">${esc(r.status || 'finished')}</span>`;
    const split = (r) => { const t = roundTime(r); return TIME_KINDS.filter(([k2]) => t[k2] >= 30000).map(([k2, l]) => `${l} ${fmtDur(t[k2])}`).join(' · '); };
    const fl = sel.findings.all.length ? `<div class="kf"><div class="kfh">Review findings</div>${sel.findings.all.map(findingRow).join('')}</div>` : '';
    det = `<div class="kdet"><div class="h"><span class="kind k-${KIND_CLASSES.includes(sel.kind) ? sel.kind : 'other'}">${esc(sel.kind)}</span><b>${esc(sel.id || '·')}</b><span>${esc(sel.text || '')}</span><button type="button" data-task="${esc(sel.key)}">close</button></div>
      ${fl}${rs.length ? `<div class="rows">${rs.map((r) => { const n = [...new Set((r.taskIds || []).concat(r.task ? [r.task] : []))].length; return `<div class="r"><span class="sub">${fmtTime(r.start)}</span><b>${esc(r.agent)}</b><span class="d">${esc(r.description || '')}</span><span class="mono">${fmtDur(r.durationMs)}</span>${n > 1 ? `<span class="sub">shared with ${n - 1} task${n > 2 ? 's' : ''}</span>` : ''}${res(r)}</div><div class="r rs"><span class="sub">${esc(split(r))}</span></div>`; }).join('')}</div>` : '<p class="note" style="margin:8px 14px">No round cites this task yet.</p>'}</div>`;
  }
  const sum = `${b.counts.done} done · ${b.counts.test} test · ${b.counts.doing} doing · ${b.counts.todo} to do`;
  const now = b.now.length ? `<div class="know"><span class="kh2">Now on this change</span>${b.now.map((r) => `<div class="kn"><span class="dot pulse" style="background:var(--ok)"></span><b>${esc(r.agent)}</b><span class="sub">${esc(FLOW_VERB[r.flow] || 'working')}</span><span class="w" title="${esc(r.what)}">${esc(r.what)}</span><span class="sub">${r.taskIds.length ? `cites ${esc(r.taskIds.join(', '))}, not in tasks.md` : 'no task cited'}</span><span class="sub mono" data-since="${r.since}"></span></div>`).join('')}</div>` : '';
  return `<div class="kbar"><span class="kprog" title="${sum}"><i style="width:${pct(b.counts.done)};background:var(--muted)"></i><i style="width:${pct(b.counts.test)};background:var(--warn)"></i><i style="width:${pct(b.counts.doing)};background:var(--ok)"></i></span><span class="sub">${sum}</span><span class="sub" style="margin-left:auto">click a card for the rounds on it</span></div>
    ${now}<div class="kboard">${cols}</div>${det}
    <p class="legend">To do: not ticked, no running round on it (⊘ = blocked or waiting for a dependency) · Doing: a running round cites it, ticked or not (a review or validation of a ticked task is work on it; a range like 2.1–2.7 counts for each task) · Test: the last round on it ended but it is not ticked yet, or its tests are red · Done: ticked in tasks.md. The badge is the task's section in tasks.md.</p>`;
}
// ---- time of a change (sub-tab Time): by stage, what the minutes went to inside each, and by task
export const FLOW_LABEL = { spec: 'spec', build: 'development', review: 'review', fix: 'fixes', validation: 'validation', integration: 'integration', other: 'other' };
export function timeHtml(c) {
  const t = timeBoard(c);
  if (!t.total) return '<p class="note">No round with a duration in this change yet.</p>';
  const pct = (ms, of) => (of ? Math.round(100 * ms / of) : 0);
  const bar = `<div class="tbar">${t.flows.map((f, i) => `<i class="tf${i % 6}" style="width:${(100 * f.ms / t.total).toFixed(2)}%" title="${esc(FLOW_LABEL[f.flow] || f.flow)} · ${fmtDur(f.ms)}"></i>`).join('')}</div>
    <div class="tleg">${t.flows.map((f, i) => `<span><i class="tf${i % 6}"></i>${esc(FLOW_LABEL[f.flow] || f.flow)} <b>${fmtDur(f.ms)}</b> <span class="sub">${pct(f.ms, t.total)}%</span></span>`).join('')}</div>`;
  const cols = TIME_KINDS.map(([, l]) => `<th class="num">${esc(l)}</th>`).join('');
  const rows = t.flows.map((f) => `<tr><td><b>${esc(FLOW_LABEL[f.flow] || f.flow)}</b> <span class="sub">${f.rounds} round${f.rounds === 1 ? '' : 's'}</span></td><td class="num mono">${fmtDur(f.ms)}</td>${TIME_KINDS.map(([k]) => `<td class="num mono${f.split[k] < 60000 ? ' sub' : ''}">${f.split[k] >= 60000 ? fmtDur(f.split[k]) : f.split[k] ? '<1m' : '—'}</td>`).join('')}</tr>`).join('');
  const tasks = t.tasks.length ? `<h2>By task<span class="sub" style="text-transform:none;letter-spacing:0;font-weight:400">measured = from the agents' task marks · without marks: own = rounds that cite only this task, shared = rounds that cite it with others, shown whole</span></h2>
    <div class="ctbl scroll"><table><thead><tr><th>task</th><th class="num">measured</th><th class="num">own</th><th class="num">shared</th><th class="num">rounds</th></tr></thead><tbody>${t.tasks.map((x) => `<tr><td><span class="kind k-${KIND_CLASSES.includes(x.kind) ? x.kind : 'other'}">${esc(x.kind)}</span> <span class="mono">${esc(x.id)}</span></td><td class="num mono"${x.measuredFlows ? ` title="${esc(Object.entries(x.measuredFlows).map(([f, ms]) => `${FLOW_LABEL[f] || f} ${fmtDur(ms)}`).join(' · '))}"` : ''}>${x.measured != null ? `<b>${fmtDur(x.measured)}</b>` : '—'}</td><td class="num mono">${x.own ? fmtDur(x.own) : '—'}</td><td class="num mono">${x.shared ? `${fmtDur(x.shared)} <span class="sub">(${x.sharedRounds})</span>` : '—'}</td><td class="num mono">${x.rounds || '—'}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="timetab"><p class="note">${fmtDur(t.total)} of agent rounds in this change.</p>${bar}
    <div class="ctbl scroll" style="margin-top:12px"><table><thead><tr><th>stage</th><th class="num">time</th>${cols}</tr></thead><tbody>${rows}</tbody></table></div>
    ${tasks}
    <p class="legend">Measured from each tool call to its result: tests (a gate test command), lint · types · build (the gate's other steps), other shell, editing, reading, other tools; model is the rest of the round (thinking and writing). Parallel tool calls can overlap, so the kinds may add up to slightly more than the round.</p></div>`;
}
// ---- change Overview (the default sub-tab): the stages on one line on every sub-tab; Now, the full trail and the
// tasks on the left; the change's properties on the right
export const STEP_G = { done: '✓', active: '●', pending: '○' };
export function stepsLine(c) {
  const steps = (c.trail && c.trail.steps) || [];
  if (!steps.length) return '';
  return `<div class="sline">${steps.map((s2, i) => {
    const running = s2.active && s2.state !== 'active';
    const cls = running ? 'now' : s2.state === 'done' ? 'done' : s2.state === 'active' ? (c.stuck ? 'stuck' : 'now') : '';
    const g = running ? '●' : s2.state === 'active' && c.stuck ? '✗' : STEP_G[s2.state] || '○';
    const extra = s2.key === 'build' && s2.tasks && s2.tasks.total ? ` ${s2.tasks.done}/${s2.tasks.total}` : s2.rounds > 1 ? ` ×${s2.rounds}` : '';
    return `${i ? '<span class="sl-link"></span>' : ''}<span class="sl ${cls}" title="${esc(stepMeta(s2).replace(/<[^>]+>/g, ''))}"><span class="g">${g}</span>${esc(s2.label)}<span class="sub">${esc(extra)}</span></span>`;
  }).join('')}</div>`;
}
// the change's files (OpenSpec artifacts: proposal, design, tasks, specs; and the team's review and validation
// reports), in reading order; a click opens the file rendered in the tab
export const ART_ORDER = ['proposal.md', 'design.md', 'tasks.md', 'review-report.md', 'validation-report.md'];
export function artifactsHtml(c) {
  const files = (c.files || []).slice().sort((a, b) => { const ia = ART_ORDER.indexOf(a), ib = ART_ORDER.indexOf(b); return (ia < 0 ? 50 : ia) - (ib < 0 ? 50 : ib) || a.localeCompare(b); });
  const where = c.dir ? `${c.dir}/` : `.ai-team/openspec/changes/${c.id}/`;
  const body = files.length ? `<div class="ov-files">${files.map((f) => `<a href="${fileUrl(c.id, f)}" data-file="${esc(f)}"><span class="g">▤</span><span class="f">${esc(f)}</span></a>`).join('')}</div>`
    : `<p class="note">${c.kind === 'adhoc' ? 'ad-hoc task: no files; review and validation come back in the reply of each run.' : 'no .md files.'}</p>`;
  return `<div class="ov-h" style="margin-top:18px">Artifacts<span class="sub" style="text-transform:none;letter-spacing:0;font-weight:400" title="${esc(where)}">${esc(where)}</span></div>${body}`;
}
export function overviewHtml(c, filter, main, mainLive) {
  const b = taskBoard(c);
  const COLG = { todo: '○', doing: '●', test: '◐', done: '✓' };
  const tasks = b.total ? `<section class="ov-sec"><div class="ov-h">Tasks <b>${b.counts.done}/${b.total}</b><button type="button" class="lnk" data-view-go="tasks">open the board</button></div>
    <div class="ov-tasks">${b.cards.map((k) => {
      const kc = KIND_CLASSES.includes(k.kind) ? k.kind : 'other';
      const who = k.col === 'doing' ? `<span class="ok">● ${esc(k.agent || '?')}</span>` : k.blocked ? `<span class="warn">⊘ ${k.waits.length ? esc(k.waits.join(', ')) : 'blocked'}</span>` : k.col === 'test' && k.bad ? '<span class="bad">tests ✗</span>' : k.time.measured != null ? `<span class="sub">⏱ ${fmtDur(k.time.measured)}</span>` : '';
      return `<div class="ov-t ${k.col}"><span class="g">${COLG[k.col]}</span><span class="kind k-${kc}">${esc(k.kind)}</span><span class="tid">${esc(k.id || '·')}</span><span class="x" title="${esc(k.text || '')}">${esc(String(k.text || '').replace(/^\d+\.\d+[a-z]?\s*[:.\-–]?\s*/i, ''))}</span>${findingsBadge(k)}${who}</div>`;
    }).join('')}</div></section>` : '';
  const cur = c.trail && (c.trail.steps || []).find((s2) => s2.state === 'active');
  const w = c.waiting;
  const props = [
    ['stage', cur ? `${cur.label}${c.trail.source === 'declared' ? ' (declared)' : c.trail.source === 'running' ? ` (running · header says ${c.trail.staleHeader})` : ' (inferred)'}` : c.archived ? 'archived' : (c.status || '—')],
    ['waiting for', c.trail && c.trail.runningAgent ? `${c.trail.runningAgent} (running)` : w && w.text ? w.text.replace(/^waiting for /, '') : '—'],
    ['started', c.startedAt ? fmtTime(c.startedAt) : '—'],
    ['last activity', c.lastActivity ? fmtTime(c.lastActivity) : '—'],
    ['rounds', `${c.rounds} · ${c.handoffs} handoffs`],
    ['time', fmtDur(c.durationMs)],
    ['fresh', fmtTok(c.tokenSplit.fresh)],
    ['cache read', fmtTok(c.tokenSplit.cached)],
    ['cost', `${fmtUsd(c.usd)}${c.budget ? ` of ${fmtUsd(c.budget.limit)} (${c.budget.size})` : ''}`, c.budget && c.budget.over ? 'warnc' : ''],
    ['tests', c.tests ? testsBadge(c.tests) : '—', 'html'],
    ...((c.findings || []).length ? [['findings', (() => { const F = c.findings, o = F.filter((f) => f.status === 'open'), b = o.filter((f) => /blocking/.test(f.severity)); return `${o.length ? `<span class="${b.length ? 'bad' : 'warnc'}">${o.length} open${b.length ? ` (${b.length} blocking)` : ''}</span> · ` : ''}${F.length - o.length} closed`; })(), 'html']] : []),
    ...(c.size ? [['size', c.size]] : []),
    ...(c.archived && c.archivedOn ? [['archived', fmtTime(c.archivedOn)]] : []),
  ];
  const kv = props.map(([k2, v, f]) => `<div class="k">${esc(k2)}</div><div class="v${f && f !== 'html' ? ` ${f}` : ''}">${f === 'html' ? v : esc(v)}</div>`).join('');
  return `<div class="ov"><div class="ov-main"><section class="ov-sec"><div class="ov-h">Now</div>${nowStrip(c)}</section>
      <section class="ov-sec"><div class="ov-h">Stages</div>${trailHtml(c, filter, main, mainLive)}</section>${tasks}${(() => {
        const loose = (c.findings || []).filter((f) => !f.task || !(c.taskList || []).some((t) => t.id === f.task)), open = loose.filter((f) => f.status === 'open');
        return loose.length ? `<details class="older ov-loose" id="ovloose-${esc(c.id)}"${open.length ? ' open' : ''}><summary>Review findings without a task: ${loose.length}${open.length ? ` (${open.length} open)` : ''}</summary>${loose.map(findingRow).join('')}</details>` : '';
      })()}</div>
    <aside class="ov-side"><div class="ov-h">Properties</div><div class="ov-kv">${kv}</div>${artifactsHtml(c)}
      <p class="note">One run = one delegation from ${esc(main)} to an agent; click an avatar in the stages to see only its rounds in the conversation.</p></aside></div>`;
}
