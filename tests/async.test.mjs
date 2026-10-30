// Duration of background agents: the immediate result (async_launched) does not mark the end;
// the subagent transcript, the SubagentStop or the notification counts. totalDurationMs only if consistent.
//   node tests/async.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-async-'));
const project = path.join(tmp, 'proj'), claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-24T12:00:00.000Z');
const at = (min) => new Date(now - min * 60000).toISOString();
const MIN = 60000;
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const jsonl = (f, recs) => w(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
w(path.join(project, '.claude/settings.json'), '{"agent":"orchestrator"}');
w(path.join(project, 'openspec/changes/bg-change/tasks.md'), '## 1. Backend\n- [ ] 1.1 a\n');
const sid = 'sess-bg', sdir = path.join(claude, 'projects', projectSlug(project));
const base = { cwd: project, sessionId: sid, isSidechain: false };
const call = (id, min, agent, extra, tag) => ({ ...base, type: 'assistant', uuid: `c-${id}`, timestamp: at(min), requestId: `r-${id}`,
  message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: agent, description: `run ${id}`, prompt: `do ${id} in openspec/changes/bg-change`, ...extra } }] } });
const result = (id, min, tur) => ({ ...base, type: 'user', uuid: `res-${id}`, timestamp: at(min),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] }, toolUseResult: tur });
const notify = (agentId, min) => ({ ...base, type: 'user', uuid: `n-${agentId}`, timestamp: at(min),
  message: { role: 'user', content: `<task-notification>\n<task-id>${agentId}</task-id>\n<status>completed</status>\n</task-notification>` } });
const sub = (agentId, min0, min1, prompt) => jsonl(path.join(sdir, sid, 'subagents', `agent-${agentId}.jsonl`), [
  { ...base, isSidechain: true, type: 'user', uuid: `${agentId}-u`, timestamp: at(min0), message: { role: 'user', content: prompt } },
  { ...base, isSidechain: true, type: 'assistant', uuid: `${agentId}-a`, timestamp: at((min0 + min1) / 2), requestId: `${agentId}-r1`, message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'middle' }], usage: { input_tokens: 1, output_tokens: 1 } } },
  { ...base, isSidechain: true, type: 'assistant', uuid: `${agentId}-z`, timestamp: at(min1), requestId: `${agentId}-r2`, message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'end' }], usage: { input_tokens: 1, output_tokens: 1 } } },
]);
const bgp = (id) => `do ${id} in openspec/changes/bg-change`;
const launched = (agentId, extra = {}) => ({ isAsync: true, status: 'async_launched', agentId, ...extra });

jsonl(path.join(sdir, `${sid}.jsonl`), [
  { ...base, type: 'user', uuid: 'u0', timestamp: at(100), message: { role: 'user', content: 'go' } },
  // A: background, finished; the launch returns an absurd duration (2 s) and the agent worked 30 min; notification at the end
  call('A', 90, 'builder', { run_in_background: true }), result('A', 90, launched('bgA', { totalDurationMs: 2000 })),
  notify('bgA', 59),
  // B: background, finished, with SubagentStop in events.jsonl (wins over the transcript)
  call('B', 80, 'spec-writer', { run_in_background: true }), result('B', 80, launched('bgB')),
  // C: background, still active (recent transcript, no notification)
  call('C', 20, 'provisioner', { run_in_background: true }), result('C', 20, launched('bgC')),
  // D: foreground, totalDurationMs inconsistent with the timestamps (2 s against 10 min)
  call('D', 50, 'validator'), result('D', 40, { agentId: 'fgD', totalDurationMs: 2000 }),
  // E: foreground, consistent totalDurationMs: the reported one counts
  call('E', 35, 'reviewer'), result('E', 25, { agentId: 'fgE', totalDurationMs: 10 * MIN - 3000 }),
]);
sub('bgA', 90, 60, bgp('A'));
sub('bgB', 80, 70, bgp('B'));
sub('bgC', 20, 1, bgp('C'));
sub('fgD', 50, 40, bgp('D'));
sub('fgE', 35, 25, bgp('E'));
w(path.join(project, '.claude/ai-team/events.jsonl'), JSON.stringify({ ts: at(68), event: 'SubagentStop', agent_id: 'bgB', agent_type: 'spec-writer' }) + '\n');
const touchAll = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) touchAll(f); fs.utimesSync(f, new Date(now - 3600e3), new Date(now - 3600e3)); } };
touchAll(tmp);
const touchRecent = (f) => fs.utimesSync(f, new Date(now - MIN), new Date(now - MIN));
touchRecent(path.join(sdir, sid, 'subagents', 'agent-bgC.jsonl'));

try {
  const st = collect({ projectDir: project, claudeDir: claude, now });
  const ch = st.changes.find((c) => c.id === 'bg-change');
  const by = Object.fromEntries(ch.runs.map((r) => [r.id, r]));
  const a = by.bgA;
  assert.equal(a.background, true);
  assert.equal(a.active, false);
  assert.equal(a.start, now - 90 * MIN);
  assert.equal(a.end, now - 60 * MIN, 'end = last transcript record, not the launch');
  assert.equal(a.durationMs, 30 * MIN, 'the 2 s launch duration is discarded');
  assert.equal(by.bgB.end, now - 68 * MIN, 'SubagentStop counts when present');
  assert.equal(by.bgB.durationMs, 12 * MIN);
  const c = by.bgC;
  assert.equal(c.active, true);
  assert.equal(c.end, null, 'active: empty end');
  assert.equal(c.durationMs, 20 * MIN, 'active: now − start');
  assert.equal(by.fgD.durationMs, 10 * MIN, 'inconsistent totalDurationMs is discarded');
  assert.equal(by.fgE.durationMs, 10 * MIN - 3000, 'consistent totalDurationMs is kept');
  assert.equal(ch.durationMs, 30 * MIN + 12 * MIN + 20 * MIN + 10 * MIN + (10 * MIN - 3000), 'the change sum uses the corrected durations');
  console.log('✓ async: background duration ok');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
