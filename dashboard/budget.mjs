// ai-team — one phone notification when a change goes over its budget (BUDGET_SMALL_USD / BUDGET_LARGE_USD
// in ai-team.conf). Runs on every computed state of the dashboard (live.mjs onState); what was already
// notified is kept in .claude/ai-team/local/budget-notified.json ({ "<id>": <usd at the notice> }), so a change
// notifies once, even across dashboard restarts. A change that drops back under (the limit was raised) is
// forgotten and would notify again if it passed the limit later. Never throws.
import fs from 'node:fs';
import path from 'node:path';
import { notify } from './notify.mjs';

export const noticeFile = (projectDir) => path.join(projectDir, '.claude', 'ai-team', 'local', 'budget-notified.json');
const read = (f) => { try { const o = JSON.parse(fs.readFileSync(f, 'utf8')); return o && typeof o === 'object' ? o : {}; } catch { return {}; } };

// state → the ids notified now (after sending); notifyFn is injectable for tests
export async function budgetAlerts(state, projectDir, { notifyFn = notify } = {}) {
  const over = (state && Array.isArray(state.changes) ? state.changes : []).filter((c) => c.budget && c.budget.over);
  const f = noticeFile(projectDir);
  const seen = read(f);
  const sent = [];
  for (const c of over) {
    if (seen[c.id] !== undefined) continue;
    try {
      const r = await notifyFn('budget', { id: c.id, budget: c.budget, stage: c.waiting && c.waiting.text }, { projectDir });
      if (r && (r.sent || r.reason === 'event off' || r.reason === 'no config')) { seen[c.id] = c.budget.usd; sent.push(c.id); }   // off or unconfigured: do not retry every tick either
    } catch { /* the notice failing never breaks the dashboard */ }
  }
  for (const id of Object.keys(seen)) if (!over.some((c) => c.id === id) && state.changes.some((c) => c.id === id)) delete seen[id];
  if (sent.length || Object.keys(seen).length !== Object.keys(read(f)).length) {
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(seen)); } catch { /* read-only: notifies again next start */ }
  }
  return sent;
}
