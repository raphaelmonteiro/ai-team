// Questions answered in a team session's terminal reach the events log (collect.mjs reads AskUserQuestion's result
// from the transcript); one the dashboard or the phone already logged is not listed twice. Also the open rounds the events log shows as a live line (shell.mjs liveRounds).
//   node tests/answers.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug } from '../dashboard/collect.mjs';
import { liveRounds } from '../dashboard/shell.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-ans-'));
const project = path.join(tmp, 'proj'), claude = path.join(tmp, 'claude');
const now = Date.parse('2026-11-12T17:00:00.000Z'), at = (min) => new Date(now - min * 60000).toISOString();
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
for (const a of ['orchestrator', 'builder']) w(path.join(project, `.claude/agents/${a}.md`), `# ${a}\n`);
w(path.join(project, '.claude/settings.json'), '{"agent": "orchestrator"}');
const sdir = path.join(claude, 'projects', projectSlug(project));
const usage = { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const rec = (sid, o) => JSON.stringify({ cwd: project, sessionId: sid, ...o });
const ask = (sid, uuid, min, tu, questions) => rec(sid, { type: 'assistant', uuid, requestId: `r-${uuid}`, timestamp: at(min), message: { role: 'assistant', model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id: tu, name: 'AskUserQuestion', input: { questions: questions.map((q) => ({ question: q, header: 'h', options: [] })) } }] } });
const answer = (sid, uuid, min, tu, answers) => rec(sid, { type: 'user', uuid, timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu, content: 'Your questions have been answered' }] }, toolUseResult: { questions: [], answers } });
w(path.join(sdir, 's-team.jsonl'), [
  rec('s-team', { type: 'user', uuid: 'u0', timestamp: at(60), message: { role: 'user', content: '/team go' } }),
  ask('s-team', 'a1', 50, 'q1', ['Test now?']), answer('s-team', 'u1', 48, 'q1', { 'Test now?': 'Later' }),
  ask('s-team', 'a2', 30, 'q2', ['D-106: which cards?', 'D-109: what changes?']), answer('s-team', 'u2', 29, 'q2', { 'D-106: which cards?': 'One per model', 'D-109: what changes?': 'Shape' }),
  ask('s-team', 'a3', 20, 'q3', ['Approve the proposal?']), answer('s-team', 'u3', 20, 'q3', { 'Approve the proposal?': 'Approve' }),
].join('\n') + '\n');
// the third one was answered from the dashboard: ask.mjs logged it
w(path.join(project, '.claude/ai-team/events.jsonl'), JSON.stringify({ ts: at(20), event: 'Decision', kind: 'question', tool: 'AskUserQuestion', question: 'Approve the proposal?', answer: 'Approve', via: 'dashboard' }) + '\n');
const st = collect({ projectDir: project, claudeDir: claude, now });
const items = st.timeline.groups.flatMap((g) => g.items).filter((i) => i.kind === 'decision').map((i) => i.text);
assert.deepEqual(items, [
  'you answered in the session: "Test now?" → Later',
  'you answered in the session: "D-106: which cards? (+1 more)" → One per model · Shape',
  'you answered from the dashboard: "Approve the proposal?" → Approve',
], 'terminal answers listed, the dashboard one once');

assert.deepEqual(liveRounds({ running: [{ id: 'main:s', main: true, status: 'running', since: 1 }, { id: 'r2', agent: 'builder', status: 'running', since: 5, lastActivity: 9, change: 'add-x', description: 'build' },
  { id: 'r3', agent: 'validator', status: 'no signal', since: 2 }, { id: 'r1', agent: 'reviewer', status: 'running', since: 3 }] }).map((r) => [r.agent, r.since, r.last, r.change]),
  [['reviewer', 3, 3, null], ['builder', 5, 9, 'add-x']], 'rounds running now (no session, no silent one), oldest first');
assert.deepEqual(liveRounds(null), []);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ answers ok');
