// Maps each change's "waiting" to the flow stage of the /team page.
// Stages: you, spec, build, fix, review, validation, integration, unknown.
// (integration = all [x] and APPROVED, left to integrate into the work branch and archive.)

export const STAGES = ['you', 'spec', 'build', 'fix', 'review', 'validation', 'integration', 'unknown'];

// view: { id, status, archived, waiting: { text } | null }
// declared stage ("state:" line of tasks.md) -> /team page stage
const DECLARED_TO_STAGE = { spec: 'spec', approval: 'you', build: 'build', review: 'review', fix: 'fix', validation: 'validation', integration: 'integration', archived: null };

export function stageOf(view) {
  if (!view || view.archived || view.status === 'ad-hoc' || !view.waiting) return null;
  if (view.declared && view.declared.valid) return DECLARED_TO_STAGE[view.declared.stage] || null;
  const t = String(view.waiting.text || '');
  if (/^nothing\b/.test(t)) return null;
  if (/^waiting for the developer/.test(t)) return 'you';
  if (/^waiting for fix/.test(t)) return 'fix';
  if (/^waiting for review/.test(t)) return 'review';
  if (/^waiting (?:to run|for) task/.test(t)) {
    const sec = (/\(([^)]*)\)\s*$/.exec(t) || [])[1] || '';
    if (/^Validation\b/i.test(sec)) return 'validation';
    if (/^(?:Process|Documentation)\b/i.test(sec)) return 'spec';
    return 'build';
  }
  if (/^undefined/.test(t) && view.status === 'done') return 'integration';
  return 'unknown';
}

// views: collector changes. Returns { counts, changes: { stage: [ids] } }
export function stageCounts(views) {
  const changes = Object.fromEntries(STAGES.map((s) => [s, []]));
  for (const v of views || []) {
    const s = stageOf(v);
    if (s) changes[s].push(v.id);
  }
  return { counts: Object.fromEntries(STAGES.map((s) => [s, changes[s].length])), changes };
}

// ---------------------------------------------------------------------------
// Change trail (drawer stepper)
// ---------------------------------------------------------------------------
export const TRAIL = [
  { key: 'spec', label: 'Spec', who: 'spec-writer' },
  { key: 'approval', label: 'Approval', who: 'you' },
  { key: 'build', label: 'Build', who: 'devs' },
  { key: 'review', label: 'Review', who: 'reviewer', loop: true },
  { key: 'fix', label: 'Fix', who: 'devs', loop: true },
  { key: 'validation', label: 'Validation', who: 'validator' },
  { key: 'integration', label: 'Integration', who: 'orchestrator' },
];
// "waiting" (stageOf) -> trail stage. 'spec' = Process/Documentation tasks, at the end of the flow.
const STAGE_TO_FLOW = { you: 'approval', spec: 'integration', build: 'build', fix: 'fix', review: 'review', validation: 'validation', integration: 'integration' };
const EXPECTED = { spec: 'spec-writer', review: 'reviewer', validation: 'validator' };
const approved = (r) => /APPROVED/i.test(r || '') && !/NOT APPROVED|CHANGES/i.test(r || '');
const asksChanges = (r) => /CHANGES/i.test(r || '');

// v: change view { id, status, archived, unknown, waiting, tasks, taskList, review, reviewRounds, validation, runs }
// runs: { flow, agent, active, start, delegated }. Returns null for ad-hoc runs.
export function buildTrail(v, mainAgent = 'orchestrator') {
  if (v && v.status === 'ad-hoc' && String(v.id || '').startsWith('adhoc:')) return looseTrail(v, mainAgent);
  if (!v || v.status === 'ad-hoc') return null;
  const runs = v.runs || [];
  const of = (k) => runs.filter((r) => r.flow === k);
  const rounds = v.reviewRounds || [];
  const needsFix = asksChanges(v.review);
  const loops = {
    review: Math.max(rounds.length, of('review').length),
    fix: Math.max(rounds.filter(asksChanges).length, of('fix').length),
  };
  const hasDir = !v.unknown;
  const actNow = runs.some((r) => r.active && r.flow);
  const declared = v.declared && v.declared.valid ? v.declared : null;
  const arch = !!v.archived || !!(declared && declared.stage === 'archived');
  const meta = {
    source: declared ? 'declared' : 'inferred', rule: declared ? '"state:" line in the tasks.md header' : actNow ? 'an agent is running in this stage' : (v.waiting && v.waiting.rule) || null,
    since: declared ? declared.since : null, note: declared ? declared.note : '', waiting: declared ? declared.waiting : null,
    warning: v.declared && !v.declared.valid ? `invalid declared state: ${v.declared.reason}` : null,
  };
  // no folder in openspec/ means no known stage: whole trail pending (the UI shows the warning and the "waiting")
  if (v.unknown) {
    return { ...meta, unknown: true, current: null, next: null, after: null, rounds: runs.length, loops,
      steps: TRAIL.map((s) => ({ ...s, state: 'pending', rounds: 0, times: null, result: null, active: false, queued: false, agents: [] })),
      delegations: runs.filter((r) => r.delegated).length };
  }
  const tasks = v.tasks || { total: 0, done: 0 };
  const list = v.taskList || [];

  // current stage: the active run wins; otherwise the "waiting"
  const act = runs.filter((r) => r.active && r.flow).sort((a, b) => (b.start || 0) - (a.start || 0))[0];
  let current = arch ? null : declared ? declared.stage : act ? act.flow : (STAGE_TO_FLOW[stageOf(v)] || null);
  if (!current && !arch && hasDir && tasks.total === 0) current = 'spec';
  const cIdx = TRAIL.findIndex((s) => s.key === current);

  // evidence of a finished stage
  const core = list.filter((t) => !/^Validation\b/i.test(t.section || '') && !/^(Process|Documentation)/i.test(t.section || ''));
  const implDone = core.length ? core.every((t) => t.done) : (tasks.total > 0 && tasks.done === tasks.total);
  const finished = (k) => !hasDir && of(k).length > 0 && !of(k).some((r) => r.active);
  const ev = {
    spec: tasks.total > 0 || of('spec').length > 0 || finished('spec'),
    build: implDone || finished('build'),
    review: !!v.review || finished('review'),
    fix: (loops.fix > 0 && !needsFix) || finished('fix'),
    validation: approved(v.validation) || finished('validation'),
    integration: false,
  };
  if (arch) for (const k of Object.keys(ev)) ev[k] = k !== 'fix' || loops.fix > 0;
  ev.approval = arch || ev.build || ev.review || ev.validation || tasks.done > 0 || runs.some((r) => ['build', 'review', 'fix', 'validation'].includes(r.flow));
  ev.integration = arch || finished('integration');

  const steps = TRAIL.map((s, i) => {
    let state;
    if (s.key === current) state = 'active';
    else if (cIdx >= 0 && i < cIdx) state = (s.key === 'fix' && loops.fix === 0) ? 'pending' : 'done';
    else state = !declared || arch ? (ev[s.key] ? 'done' : 'pending') : 'pending';
    return { ...s, state, rounds: of(s.key).length, times: s.loop && loops[s.key] > 1 ? loops[s.key] : null,
      result: s.key === 'review' ? v.review || null : s.key === 'validation' ? v.validation || null : null,
      active: of(s.key).some((r) => r.active), queued: false, agents: [] };
  });
  const skipFix = (s) => s.key === 'fix' && loops.fix === 0 && !needsFix;
  const open = steps.filter((s, i) => s.state !== 'done' && s.key !== current && !skipFix(s) && (cIdx < 0 || i > cIdx));
  const [next, after] = open;
  for (const s of steps) {
    const by = new Map();
    for (const r of of(s.key)) {
      const a = by.get(r.agent) || { agent: r.agent, state: 'done', runs: 0 };
      a.runs++; if (r.active) a.state = 'on'; by.set(r.agent, a);
    }
    s.agents = [...by.values()];
    if (s.key === 'approval' && s.state !== 'pending') s.agents = [{ agent: 'you', state: s.state === 'done' ? 'done' : 'wait', runs: 0 }];
    if (s.key === 'integration' && s.state !== 'pending') s.agents = [{ agent: mainAgent, state: s.state === 'done' ? 'done' : 'wait', runs: 0 }];
    if (s.state === 'pending' && next && next.key === s.key) {
      s.queued = true;
      const who = EXPECTED[s.key];
      if (who && !s.agents.some((a) => a.agent === who)) s.agents.push({ agent: who, state: 'wait', runs: 0 });
    }
    if (s.key === 'build') s.tasks = { done: tasks.done, total: tasks.total };
  }
  const ref = (s) => (s ? { key: s.key, label: s.label } : null);
  return { ...meta, steps, current, next: ref(next), after: ref(after), rounds: runs.length, loops,
    delegations: runs.filter((r) => r.delegated).length };
}

// Ad-hoc task ("Ad-hoc task: <slug>"): no proposal, approval or tasks.md; the trail comes only from the
// runs. Stage with an active run = now; with runs and none active = done; fix without a
// run is skipped in "next"; integration stays with the main agent.
const LOOSE_TRAIL = TRAIL.filter((s) => !['spec', 'approval'].includes(s.key));
function looseTrail(v, mainAgent) {
  const runs = v.runs || [];
  const of = (k) => runs.filter((r) => r.flow === k);   // flow null = outside the team (Explore etc.)
  const act = runs.filter((r) => r.active && r.flow).sort((a, b) => (b.start || 0) - (a.start || 0))[0];
  const current = act ? act.flow : null;
  const loops = { review: of('review').length, fix: of('fix').length };
  const steps = LOOSE_TRAIL.map((s) => {
    const rs = of(s.key), active = rs.some((r) => r.active);
    const by = new Map();
    for (const r of rs) {
      const a = by.get(r.agent) || { agent: r.agent, state: 'done', runs: 0 };
      a.runs++; if (r.active) a.state = 'on'; by.set(r.agent, a);
    }
    return { ...s, state: s.key === current ? 'active' : rs.length ? 'done' : 'pending', rounds: rs.length,
      times: s.loop && loops[s.key] > 1 ? loops[s.key] : null, result: null, active, queued: false, agents: [...by.values()] };
  });
  const last = steps.reduce((m, s, i) => (s.state !== 'pending' ? i : m), -1);
  const [next, after] = steps.filter((s, i) => i > last && s.state === 'pending' && !(s.key === 'fix' && loops.fix === 0));
  if (next) {
    next.queued = true;
    const who = next.key === 'integration' ? mainAgent : EXPECTED[next.key];
    if (who && !next.agents.some((a) => a.agent === who)) next.agents.push({ agent: who, state: 'wait', runs: 0 });
  }
  const integ = steps.find((s) => s.key === 'integration');
  if (integ.state !== 'pending' && !integ.agents.some((a) => a.agent === mainAgent)) integ.agents.push({ agent: mainAgent, state: 'done', runs: 0 });
  const ref = (s) => (s ? { key: s.key, label: s.label } : null);
  return { source: 'inferred', rule: act ? 'an agent is running in this stage' : 'ad-hoc task: stages taken from the runs',
    since: null, note: '', waiting: null, warning: null, loose: true,
    steps, current, next: ref(next), after: ref(after), rounds: runs.length, loops, delegations: runs.filter((r) => r.delegated).length };
}
