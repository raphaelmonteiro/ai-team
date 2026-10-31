// Pure logic of the change drawer conversation (no DOM): feed assembly, verdict color,
// agent filter and presence card data. Served at /feed.mjs and imported by index.html.

export const FLOW_LABEL = { spec: 'Spec', build: 'Build', review: 'Review', fix: 'Fix', validation: 'Validation', integration: 'Integration' };
const ROLE = { spec: 'spec', build: 'build', review: 'review', fix: 'fix', validation: 'validation', integration: 'integration' };

// Verdict color: 'bad' beats 'ok' (CHANGES REQUESTED / REJECTED / NOT APPROVED); null if none.
const VERDICT = /(REJECTED|CHANGES REQUESTED|NOT APPROVED|APPROVED)/gi;
export function verdictClass(text) {
  const hits = [...String(text || '').matchAll(VERDICT)].map((m) => m[1]);
  if (!hits.length) return null;
  return hits.some((h) => !/^APPROVED/i.test(h)) ? 'bad' : 'ok';
}
// Parts of the text with the class of each verdict word: [{ text, cls }]
export function verdictParts(text) {
  const s = String(text || ''), out = [];
  let last = 0;
  for (const m of s.matchAll(VERDICT)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), cls: null });
    out.push({ text: m[1], cls: /^APPROVED/i.test(m[1]) ? 'ok' : 'bad' });
    last = m.index + m[1].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), cls: null });
  return out;
}

// Agent filter: without a filter returns all.
export function filterRuns(runs, who) {
  return who ? (runs || []).filter((r) => r.agent === who) : (runs || []);
}

// Presence of a run: 'on' (running, green), 'stale' (no signal or interrupted, amber),
// 'failed' (red) or 'done' (gray). 'wait' (orange, queued) comes from the trail, not from the run.
export const presenceOf = (r) => (r.active ? 'on' : r.status === 'failed' ? 'failed' : r.status === 'no signal' || r.status === 'interrupted' ? 'stale' : 'done');

// Label of the caller and the neighborhood. Every subagent returns to the orchestrator (mainAgent);
// "before" and "after" are just who worked before/after on the same change (the orchestrator does not count).
// → { by, around } ; around = '' when there is neither a previous nor a next one.
export function routeOf(r, mainAgent = 'orchestrator') {
  const other = (x) => (x && x !== '?' && x !== mainAgent ? x : null);
  const before = other(r.from), after = other(r.to);
  const around = [before ? `before: ${before}` : '', after ? `after: ${after}` : ''].filter(Boolean).join(' · ');
  return { by: r.from || '?', around };
}

// Feed message: every field the runs table shows, plus the collapsed detail.
export function messageOf(r, mainAgent = 'orchestrator') {
  const u = r.usage || {};
  return {
    id: r.id, agent: r.agent, change: r.change || null, background: !!r.background,
    status: r.status || (r.active ? 'running' : 'finished'), silentMs: r.silentMs || 0, sessionName: r.sessionName || null, active: !!r.active, presence: presenceOf(r),
    from: r.from || '?', to: r.to || null, route: routeOf(r, mainAgent),
    start: r.start || null, end: r.active ? null : (r.end || null),
    durationMs: r.durationMs || 0, model: r.model || '?',
    fresh: (r.tokenSplit && r.tokenSplit.fresh) || 0, cached: (r.tokenSplit && r.tokenSplit.cached) || 0,
    usage: { input: u.input || 0, output: u.output || 0, cacheCreation: u.cacheCreation || 0, requests: u.requests || 0 },
    toolUses: r.toolUses || 0,
    description: r.description || '', summary: r.summary || '', summaryParts: verdictParts(r.summary), verdict: verdictClass(r.summary),
    promptPreview: r.promptPreview || '', totalTokensReported: r.totalTokensReported == null ? null : r.totalTokensReported,
    flow: r.flow || null, task: r.task || null, taskSection: r.taskSection || null,
  };
}

// Feed in chat order (oldest on top). Separators = stage (flow) when it changes; no separators with a filter.
export function buildFeed(runs, { filter = null, mainAgent = 'orchestrator' } = {}) {
  const list = filterRuns(runs, filter).slice().sort((a, b) => (a.start || 0) - (b.start || 0));
  const items = [];
  let prev;
  for (const r of list) {
    if (!filter && (prev === undefined || r.flow !== prev)) {
      items.push({ type: 'sep', flow: r.flow || null, label: FLOW_LABEL[r.flow] || 'Other runs', active: false });
    }
    prev = r.flow;
    items.push({ type: 'msg', ...messageOf(r, mainAgent) });
  }
  // the last separator holding an active run is marked ("now")
  for (let i = items.length - 1, hasActive = false; i >= 0; i--) {
    if (items[i].type === 'msg' && items[i].active) hasActive = true;
    if (items[i].type === 'sep') { items[i].active = hasActive; hasActive = false; }
  }
  return items;
}

// Presence card data of an agent in a change.
// c: change view { runs, trail }; opts: { mainAgent, mainLive }
export function cardData(c, name, opts = {}) {
  const { mainAgent = 'orchestrator', mainLive = false } = opts;
  const runs = (c.runs || []).filter((r) => r.agent === name).sort((a, b) => (a.start || 0) - (b.start || 0));
  const active = runs.filter((r) => r.active).pop();
  const last = runs[runs.length - 1] || null;
  const steps = (c.trail && c.trail.steps) || [];
  const inQueue = steps.some((s) => s.agents.some((a) => a.agent === name && a.state === 'wait'));
  const lastRun = runs[runs.length - 1] || null;
  const presence = active || (name === mainAgent && mainLive) ? 'on' : lastRun && presenceOf(lastRun) !== 'done' ? presenceOf(lastRun) : inQueue ? 'wait' : 'done';
  const sum = (k) => runs.reduce((s, r) => s + ((r.tokenSplit && r.tokenSplit[k]) || 0), 0);
  const withReturn = runs.filter((r) => r.summary).pop() || null;
  const reviewRun = [...runs].reverse().find((r) => (r.flow === 'review' || r.flow === 'validation') && verdictClass(r.summary));
  const flows = [...new Set(runs.map((r) => r.flow).filter(Boolean))];
  let role = flows.map((f) => ROLE[f]).join(' · ');
  if (name === 'you') role = 'approves and decides';
  else if (name === mainAgent) role = 'coordinates the stages';
  else if (!role) role = 'agent';
  const ref = active || last;
  return {
    name, role, model: (ref && ref.model) || null, presence,
    since: active ? active.start : null, endAt: !active && last ? last.end || null : null,
    verdict: reviewRun ? verdictClass(reviewRun.summary) : null,
    verdictText: reviewRun ? (verdictParts(reviewRun.summary).find((p) => p.cls) || {}).text || null : null,
    what: ref ? ref.description || '' : (name === 'you' ? 'approves the proposal and settles open items' : ''),
    lastReturn: withReturn ? withReturn.summary : '',
    rounds: name === mainAgent ? ((c.trail && c.trail.delegations) || 0) : runs.length,
    fresh: sum('fresh'), cached: sum('cached'),
    isMain: name === mainAgent,
    route: ref && name !== mainAgent ? routeOf(ref, mainAgent) : null,
  };
}
