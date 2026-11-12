// Shared HTML helpers of the main page (index.html, overview.mjs, changetab.mjs): token and cost cells, test badges,
// the waiting and stuck boxes, avatars. Pure: data in, HTML out.
import { esc, fmtTime, fmtTok, fmtUsd } from './ui.mjs';

// agents are not colored by name (v3): color only means a state; an agent is its initials in mono
export const colorOf = () => 'var(--line2)';
export const TIP_NEW = 'fresh: input + output + cache written (cache creation); does not include cache read';
export const TIP_CACHE = 'cache read: tokens read from the prompt cache (cache read), reused on every call; usually much larger than the fresh ones';
export const TIP_USD = 'estimated cost at the API list price of each model (input, output, cache read and cache written); not a bill: plans, batch discounts and a subscription make the real figure differ';
export const usdCol = (u) => `<td class="num" title="${TIP_USD}">${fmtUsd(u)}</td>`;
export const tokCols = (t) => `<td class="num" title="${TIP_NEW}">${fmtTok(t.fresh)}</td><td class="num" title="${TIP_CACHE}">${fmtTok(t.cached)}</td>`;
export const tokHeads = `<th class="num" title="${TIP_NEW}">fresh</th><th class="num" title="${TIP_CACHE}">cache read</th>`;
export const usdHead = `<th class="num" title="${TIP_USD}">cost</th>`;
// last test run of a round or of a change (gate.mjs): verdict and counts, the command and its summary in the tooltip
export function testsBadge(x, cls = 'badge') {
  if (!x) return '';
  const ok = x.ok === true;
  const n = ok ? (x.passed != null ? `${x.passed} passed` : 'passed') : (x.failed ? `${x.failed} failed` : 'failed');
  const fails = ok ? [] : (x.parts || [x]).flatMap((p) => p.failures || []);
  const lines = (x.parts || [x]).map((p) => `${p.cmd || ''} → ${p.summary || ''}`).join('\n') + (fails.length ? `\nfailed: ${fails.slice(0, 5).join(' · ')}${fails.length > 5 ? ' …' : ''}` : '');
  return `<span class="${cls} ${ok ? 'ok' : 'bad'}" title="${esc(lines)}${x.agent ? ` (${esc(x.agent)})` : ''}">tests ${ok ? '✓' : '✗'} ${n}</span>`;
}
// what a red test run says: who ran it and when, the command, the failing tests and the start of the output
export function testFailHtml(x, { head = true } = {}) {
  if (!x || x.ok !== false) return '';
  const parts = (x.parts || [x]).filter((p) => p.ok === false);
  const body = parts.map((p) => `<div class="tfp"><code class="tcmd">$ ${esc(p.cmd || '?')}</code> <span class="sub">${esc(p.summary || '')}</span>
    ${p.failures && p.failures.length ? `<ul class="tfn">${p.failures.map((f) => `<li>✗ ${esc(f)}</li>`).join('')}</ul>` : '<p class="note">no test names in the output (the run failed before or the format is not recognised)</p>'}
    ${p.excerpt ? `<details class="tfx"${parts.length === 1 ? ' open' : ''}><summary>output</summary><pre>${esc(p.excerpt)}</pre></details>` : ''}</div>`).join('');
  return `<div class="tfail">${head ? `<div class="tfh"><b>✗ tests failed</b> <span class="sub">${esc(x.summary || '')}${x.agent ? ` · ${esc(x.agent)}` : ''}${x.ts ? ` · ${fmtTime(x.ts)}` : ''}</span>${x.agent ? `<button type="button" class="lnk" data-filter="${esc(x.agent)}">show the round</button>` : ''}</div>` : ''}${body}</div>`;
}
export const changeLabel = (id) => !id ? '—' : id.startsWith('adhoc:') ? `ad-hoc · ${id.slice(6)}` : id;
export function fmtDate(t) { return new Date(t).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', year: '2-digit' }); }
export const liveDur = (r) => r.active && r.start ? Date.now() - r.start : r.durationMs;
export const stCls = (st) => (st === 'no signal' || st === 'interrupted' ? 'stale' : esc(st));
export const sessLine = (r) => (r && r.sessionName ? `<div class="sess" title="${esc(r.sessionId || '')}">session: ${esc(r.sessionName)}</div>` : '');
export const silentTxt = (r, staleMin) => (r.status === 'no signal' ? ` <span class="sub" title="no activity in the transcript and no recorded end (limit: ${staleMin} min)">no signal for <span data-silent="${Date.now() - (r.silentMs || 0)}"></span></span>` : '');
// "waiting for <who> for X" + note + source (declared or inferred, with the rule)
export function waitHtml(w, extra = '') {
  if (!w) return '';
  const decl = w.source === 'declared';
  const since = decl && w.since ? ` <span class="sub">for <span data-since="${w.since}"></span></span>` : '';
  const note = decl && w.note ? `<span class="rule">${esc(w.note)}</span>` : '';
  const src = decl ? `<span class="src decl">declared: ${esc(w.rule)}</span>` : `<span class="src">inferred: ${esc(w.rule)}</span>`;
  return `<div class="wait${w.text === 'undefined' ? ' undef' : ''}"><b>${esc(w.text)}</b>${since}${note}<span class="rule">${src}</span>${w.warning ? `<span class="warnline">${esc(w.warning)}</span>` : ''}${extra}</div>`;
}
// stuck: why the cycle stopped and the prompt that resumes it in a /team session
export function stuckHtml(c) {   // the reason, the agent's last words before it stopped, and how to resume
  const s = c.stuck;
  if (!s) return '';
  const last = (c.runs.find((r) => r.id === s.runId) || {}).summary || '';
  return `<div class="stuckbox"><b>stuck</b>: ${esc(s.agent)} ${s.kind === 'interrupted' ? 'interrupted' : 'failed'}${s.at ? ` at ${fmtTime(s.at)}` : ''}, nobody running since<span class="why">${esc(s.reason)}</span>resume in a session: <code>${esc(s.resume)}</code><button type="button" data-copy="${esc(s.resume)}">copy</button>${last ? `<details class="tfx"><summary>last words of ${esc(s.agent)}</summary><pre>${esc(last)}</pre></details>` : ''}</div>`;
}
// ---- change flow: "Now" strip + stage trail ----
export const FLOW_VERB = { spec: 'drafting the proposal', build: 'implementing', review: 'reviewing', fix: 'fixing', validation: 'validating', integration: 'integrating' };
export const initials = (n) => { if (n === 'you') return 'ME'; const p = String(n).split(/[-_ ]+/).filter(Boolean); return (p.length > 1 ? p[0][0] + p[1][0] : String(n).slice(0, 2)).toUpperCase(); };
export const colorFor = (n) => (n === 'you' ? 'var(--warnbg)' : 'var(--soft)');
export const taskLabel = (r) => (r.task ? `task ${r.task}${r.taskSection ? ` (${r.taskSection})` : ''}` : r.taskSection ? `section ${r.taskSection}` : '');
export function avatar(name, st, { sel = false, large = false, filter = true } = {}) {
  const pres = ['on', 'wait', 'stale', 'failed'].includes(st) ? st : '';
  return `<span class="av${large ? ' lg' : ''}${sel ? ' sel' : ''}" style="background:${colorFor(name)}${st === 'wait' ? ';opacity:.6' : ''}" data-hc="${esc(name)}" ${filter ? `data-filter="${esc(name)}" tabindex="0" role="button" title="show only ${esc(name)}"` : 'tabindex="0"'}>${initials(name)}<i class="${pres}"></i></span>`;
}
// --- a change's .md rendered in the drawer, and its diff ----------------------------------
export const fileUrl = (id, f) => `changes/${encodeURIComponent(id)}/${f.split('/').map(encodeURIComponent).join('/')}`;
