// ai-team — the events log (the Events tab): what happened after a moment, as a list of events per change, derived
// from the state the collector already builds (runs, their test runs, the hook events Guard / Compact / Decision,
// task marks, stuck changes, budgets, declared stages, the questions waiting now). Pure: no I/O. The collector asks
// for at least the last 24 h (more when you left earlier); "since you left" is a marker the page puts in it.
//
// item: { ts, change: <id> | null, kind, level: info | ok | warn | bad, text, agent?, runId? }
// kinds: round_start, round_end, round_failed, round_interrupted, tests, decision, guard, compact, task, stuck,
//        budget, stage, waiting
const fmtDur = (ms) => { const s = Math.round((ms || 0) / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}h ${String(m % 60).padStart(2, '0')}min` : m ? `${m}min ${String(s % 60).padStart(2, '0')}s` : `${s}s`; };

// state: the collector's state; since: ms timestamp (items strictly after it); now: for "running since"
export function timeline(state, since, { now = Date.now(), limit = 200 } = {}) {
  const items = [];
  // a time ahead of now (e.g. a "since:" an agent wrote in the tasks.md header with the wrong clock) is left out:
  // it would sit at the end of the log for hours
  const push = (it) => { if (Number.isFinite(it.ts) && it.ts > since && it.ts <= now + 5 * 60e3) items.push(it); };
  const changes = Array.isArray(state && state.changes) ? state.changes : [];
  for (const c of changes) {
    const change = c.kind === 'no-change' ? null : c.id;
    for (const r of c.runs || []) {
      const who = r.agent || '?';
      push({ ts: r.start, change, kind: 'round_start', level: 'info', agent: who, runId: r.id, text: `${who} started${r.description ? `: ${r.description}` : ''}` });
      if (r.active) continue;
      if (r.status === 'failed') push({ ts: r.end || r.start, change, kind: 'round_failed', level: 'bad', agent: who, runId: r.id, text: `${who} failed after ${fmtDur(r.durationMs)}${r.error ? `: ${String(r.error).slice(0, 160)}` : ''}` });
      else if (r.status === 'interrupted') push({ ts: r.end || r.start, change, kind: 'round_interrupted', level: 'warn', agent: who, runId: r.id, text: `${who} interrupted after ${fmtDur(r.durationMs)}` });
      else if (r.end) push({ ts: r.end, change, kind: 'round_end', level: 'info', agent: who, runId: r.id, text: `${who} finished after ${fmtDur(r.durationMs)}${r.summary ? `: ${String(r.summary).split('\n')[0].slice(0, 140)}` : ''}` });
      const t = r.tests;
      if (t && (t.ts || r.end)) push({ ts: t.ts || r.end, change, kind: 'tests', level: t.ok ? 'ok' : 'bad', agent: who, runId: r.id,
        text: `tests ${t.ok ? 'green' : 'red'}${t.passed != null ? `: ${t.passed} passed` : ''}${t.failed ? `, ${t.failed} failed` : ''}${t.summary ? ` (${String(t.summary).slice(0, 100)})` : ''}` });
    }
    // task marks (task.sh): who started, paused or finished which tasks
    for (const tm of c.taskMarks || []) {
      const verb = { start: 'started', pause: 'paused', done: 'finished' }[tm.action], ts = (tm.tasks || []);
      if (verb && ts.length) push({ ts: tm.ts, change, kind: 'task', level: tm.action === 'done' ? 'ok' : 'info', agent: tm.agent || null, text: `${tm.agent || 'an agent'} ${verb} task${ts.length > 1 ? 's' : ''} ${ts.join(', ')}` });
    }
    if (c.stuck && c.stuck.at) push({ ts: c.stuck.at, change, kind: 'stuck', level: 'bad', agent: c.stuck.agent, text: `stuck: ${c.stuck.reason} · ${c.stuck.resume}` });
    if (c.budget && c.budget.over) push({ ts: c.lastActivity || 0, change, kind: 'budget', level: 'warn', text: `over budget: $${c.budget.usd.toFixed(2)} of $${c.budget.limit} (${c.budget.size})` });
    const w = c.waiting;
    if (w && w.source === 'declared' && w.since && w.stage) push({ ts: w.since, change, kind: 'stage', level: 'info', text: `stage ${w.stage}, ${w.text}${w.note ? ` · ${w.note}` : ''}` });
  }
  for (const e of (state && state.hookEvents) || []) {
    const change = e.change || null, who = e.agent_type || null;
    if (e.event === 'Guard') push({ ts: e.ts, change, kind: 'guard', level: 'warn', agent: who, text: `guard refused ${e.tool || 'a call'} to ${who || '?'}: ${String(e.reason || '').replace(/^ai-team guard \([^)]*\): /, '').slice(0, 160)}` });
    else if (e.event === 'Compact') push({ ts: e.ts, change, kind: 'compact', level: 'info', agent: who, text: `${who || 'a subagent'} compacted its context (${e.trigger || 'auto'})` });
    else if (e.event === 'Decision') push({ ts: e.ts, change, kind: 'decision', level: e.answer && /^denied/.test(e.answer) ? 'warn' : 'ok', agent: who,
      text: `you answered from the ${e.via || 'dashboard'}: ${e.question ? `"${String(e.question).slice(0, 80)}" → ` : ''}${String(e.answer || '').slice(0, 120)}` });
  }
  for (const p of (state && state.pending) || []) {
    push({ ts: p.ts, change: null, kind: 'waiting', level: 'warn', agent: p.agentType || null, text: `${p.kind === 'permission' ? `permission for ${p.tool}` : 'question'} waiting for you${p.summary ? `: ${String(p.summary).slice(0, 100)}` : ''}` });
  }
  items.sort((a, b) => a.ts - b.ts || a.kind.localeCompare(b.kind));
  const cut = items.length > limit ? items.slice(items.length - limit) : items;
  const groups = [];
  for (const it of cut) {
    let g = groups.find((x) => x.change === it.change);
    if (!g) { g = { change: it.change, items: [] }; groups.push(g); }
    g.items.push(it);
  }
  groups.sort((a, b) => (b.items[b.items.length - 1].ts) - (a.items[a.items.length - 1].ts));
  return { since, count: cut.length, truncated: items.length - cut.length, groups };
}

// the moment "you left": the last real prompt of a live team session, else of any team session, else null
export function leftAt(state) {
  const main = (state && state.mainRuns) || [];
  const live = main.filter((r) => r.live && r.lastPromptAt), all = main.filter((r) => r.lastPromptAt);
  const pick = (live.length ? live : all);
  return pick.length ? Math.max(...pick.map((r) => r.lastPromptAt)) : null;
}
