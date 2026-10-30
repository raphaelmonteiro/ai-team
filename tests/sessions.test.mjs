// Team session vs loose session (no fixed "agent" in settings.json) and the orchestrator's
// ad-hoc tasks ("Ad-hoc task: <slug>"), grouped by slug.
//   node tests/sessions.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-sess-'));
const project = path.join(tmp, 'proj');
const claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-21T15:00:00.000Z');
const at = (min) => new Date(now - min * 60000).toISOString();
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const jsonl = (f, recs) => w(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');

for (const a of ['orchestrator', 'builder', 'validator']) w(path.join(project, `.claude/agents/${a}.md`), `# ${a}\n`);
w(path.join(project, '.claude/settings.json'), '{"hooks": {}}');
w(path.join(project, 'openspec/changes/add-invoice/tasks.md'), '## 1. Backend\n- [ ] 1.1 route\n');

const sdir = path.join(claude, 'projects', projectSlug(project));
const usage = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
const session = (sid, recs) => jsonl(path.join(sdir, `${sid}.jsonl`), recs.map((r) => ({ cwd: project, sessionId: sid, ...r })));
const user = (uuid, min, content) => ({ type: 'user', uuid, timestamp: at(min), message: { role: 'user', content } });
const asst = (uuid, min, content) => ({ type: 'assistant', uuid, requestId: `req-${uuid}`, timestamp: at(min), message: { role: 'assistant', model: 'claude-opus-5-5', usage, content } });
const call = (uuid, min, tu, agent, prompt) => asst(uuid, min, [{ type: 'tool_use', id: tu, name: 'Agent', input: { subagent_type: agent, description: `run ${tu}`, prompt } }]);
const result = (uuid, min, tu, agentId) => ({ ...user(uuid, min, [{ type: 'tool_result', tool_use_id: tu, content: 'ok' }]),
  toolUseResult: { agentId, totalDurationMs: 60000, usage } });
const sub = (sid, agentId, min0, min1, prompt) => jsonl(path.join(sdir, sid, 'subagents', `agent-${agentId}.jsonl`), [
  { cwd: project, sessionId: sid, isSidechain: true, agentId, ...user(`${agentId}-u`, min0, prompt) },
  { cwd: project, sessionId: sid, isSidechain: true, agentId, ...asst(`${agentId}-a`, min1, [{ type: 'text', text: 'done' }]) },
]);

// 1) /team with no delegation yet: already a team session
session('s-cmd', [user('c1', 90, '<command-message>team</command-message>\n<command-name>/team</command-name>\n<command-args>what is left?</command-args>'),
  asst('c2', 89, [{ type: 'text', text: 'looking' }])]);
// 1b) /onboarding: also a team session (the session acts as orchestrator)
session('s-onb', [user('o1', 85, '<command-message>onboarding</command-message>\n<command-name>/onboarding</command-name>\n<command-args></command-args>'),
  asst('o2', 84, [{ type: 'text', text: 'inventory' }])]);
// 2) claude --agent orchestrator (no mark in the transcript): delegated to the team, so it is a team session.
//    Two runs of the same ad-hoc task; the prompt cites a change, but the mark wins.
const pBe = 'Ad-hoc task: fix-timeout\nRaise the login timeout (see openspec/changes/add-invoice for reference only).';
const pVal = 'Ad-hoc task: Fix-Timeout\nCheck the login.';
session('s-team', [user('t1', 80, 'the login is timing out'),
  call('t2', 79, 'tu-be', 'builder', pBe), result('t3', 70, 'tu-be', 'be1'),
  call('t4', 69, 'tu-val', 'validator', pVal), result('t5', 60, 'tu-val', 'val1')]);
sub('s-team', 'be1', 79, 70, pBe);
sub('s-team', 'val1', 69, 60, pVal);
// 3) plain Claude: just an Explore
session('s-loose', [user('l1', 50, 'where is the parser?'),
  call('l2', 49, 'tu-ex', 'Explore', 'find the parser'), result('l3', 45, 'tu-ex', 'ex1'), asst('l4', 44, [{ type: 'text', text: 'in src/parser' }])]);
sub('s-loose', 'ex1', 49, 45, 'find the parser');

// 4) /team recorded only by the hook (TeamStart in events.jsonl), no mark in the transcript
session('s-hook', [user('h1', 40, 'what is the state of the change?'), asst('h2', 39, [{ type: 'text', text: 'reading' }])]);
w(path.join(project, '.claude/ai-team/events.jsonl'), JSON.stringify({ ts: at(40), event: 'TeamStart', session_id: 's-hook', via: 'team' }) + '\n');

const touchAll = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) touchAll(f); fs.utimesSync(f, new Date(now - 3600e3), new Date(now - 3600e3)); } };
touchAll(tmp);

let st = collect({ projectDir: project, claudeDir: claude, now });
assert.equal(st.project.mainAgent, 'orchestrator', 'no agent in settings: orchestrator');
assert.equal(st.totals.sessions, 5);
assert.equal(st.totals.teamSessions, 4, '/team and /onboarding in the transcript, the one marked by the hook and the one that delegated to the team');
assert.deepEqual(st.mainRuns.map((r) => r.sessionId).sort(), ['s-cmd', 's-hook', 's-onb', 's-team']);
assert.ok(!st.agents.some((a) => a.agent === 'Explore'), 'a loose session subagent stays out of the effort');
assert.equal(st.looseSessions.count, 1);
assert.equal(st.looseSessions.subagentRuns, 1);
assert.equal(st.looseSessions.recent[0].sessionId, 's-loose');
assert.equal(st.looseSessions.tokenSplit.fresh, 2 * 110 + 110, 'session (2 replies) + subagent');

const task = st.changes.find((c) => c.id === 'adhoc:fix-timeout');
assert.ok(task, 'ad-hoc task grouped by slug (case-insensitive)');
assert.equal(task.kind, 'adhoc'); assert.equal(task.title, 'fix-timeout');
assert.equal(task.status, 'ad-hoc'); assert.equal(task.unknown, false); assert.equal(task.waiting, null);
assert.ok(task.trail && task.trail.loose, 'an ad-hoc task has a short trail from the runs');
assert.deepEqual(task.trail.steps.filter((s) => s.state === 'done').map((s) => s.key), ['build', 'validation']);
assert.deepEqual(task.runs.map((r) => r.agent), ['builder', 'validator']);
assert.equal(task.handoffs, 2);
assert.ok(st.board.other.includes('adhoc:fix-timeout'));
const inv = st.changes.find((c) => c.id === 'add-invoice');
assert.equal(inv.rounds, 0, 'the mark beats the change cited in the prompt');
assert.equal(inv.kind, 'change');

// fixed agent in settings.json: every session is a team session (old behavior)
w(path.join(project, '.claude/settings.json'), '{"agent": "orchestrator"}');
st = collect({ projectDir: project, claudeDir: claude, now });
assert.equal(st.totals.teamSessions, 5);
assert.equal(st.looseSessions.count, 0);
assert.ok(st.agents.some((a) => a.agent === 'Explore'));

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ team sessions and ad-hoc tasks ok');
