// Tests of a resumed subagent (dashboard/collect.mjs): the coordinator sends a new message to the same agent,
// which keeps writing to the same transcript. Each leg is its own round, and the last one can be running
// even though an earlier leg already stopped (the bug: the agent showed as finished while it worked).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect, projectSlug } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-resume-'));
try {
  const project = path.join(tmp, 'proj'), claude = path.join(tmp, 'claude');
  const now = Date.parse('2026-11-11T16:00:00.000Z');
  const at = (min) => new Date(now - min * 60000).toISOString();
  const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
  const jsonl = (f, recs) => w(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
  w(path.join(project, 'openspec/changes/add-x/tasks.md'), '## 2. Frontend\n- [x] 2.1 a\n- [x] 2.2 b\n- [ ] 2.3 c\n');
  const pdir = path.join(claude, 'projects', projectSlug(project));
  const base = { cwd: project, sessionId: 's1', isSidechain: false };
  const usage = (n) => ({ input_tokens: n, output_tokens: 1 });
  // main session: one Agent call, launched in the background
  jsonl(path.join(pdir, 's1.jsonl'), [
    { ...base, type: 'user', uuid: 'u0', timestamp: at(100), message: { role: 'user', content: '/team go' } },
    { ...base, type: 'assistant', uuid: 'a1', timestamp: at(90), requestId: 'r1', message: { role: 'assistant', model: 'claude-opus-5-5', usage: usage(1), content: [{ type: 'tool_use', id: 'T1', name: 'Agent', input: { subagent_type: 'integrator', description: 'Implement tasks 2.1–2.2', prompt: 'Implement openspec/changes/add-x tasks 2.1–2.2', run_in_background: true } }] } },
    { ...base, type: 'user', uuid: 'u1', timestamp: at(90), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'T1', content: 'launched' }] }, toolUseResult: { agentId: 'agX', status: 'async_launched' } },
  ]);
  const sb = { ...base, isSidechain: true, agentId: 'agX' };
  const say = (id, min, text, n = 10) => ({ ...sb, type: 'assistant', uuid: `as-${id}`, timestamp: at(min), requestId: `rq-${id}`, message: { role: 'assistant', model: 'claude-sonnet-5-5', usage: usage(n), content: [{ type: 'text', text }] } });
  const resume = (id, min, text) => ({ ...sb, type: 'user', uuid: `rs-${id}`, timestamp: at(min), isMeta: true, origin: { kind: 'coordinator' }, message: { role: 'user', content: `The coordinator sent a message while you were working: ${text}` } });
  const sf = path.join(pdir, 's1', 'subagents', 'agent-agX.jsonl');
  jsonl(sf, [
    { ...sb, type: 'user', uuid: 'p0', timestamp: at(90), message: { role: 'user', content: 'Implement openspec/changes/add-x tasks 2.1–2.2' } },
    say('a', 80, 'working on 2.1'), say('b', 60, 'done 2.1 and 2.2', 20),
    resume('1', 40, 'Review round 1 came back CHANGES REQUESTED: fix R1, R2.'),
    say('c', 30, 'fixed R1 and R2', 30),
    resume('2', 10, 'New task for add-x: implement 2.3 from tasks.md.'),
    say('d', 2, 'working on 2.3', 40),
  ]);
  const m = new Date(now - 2 * 60000); fs.utimesSync(sf, m, m);
  // hooks: started, stopped, started, stopped, started again (no stop yet): the last leg is running
  w(path.join(project, '.claude/ai-team/events.jsonl'), [
    ['SubagentStart', 90], ['SubagentStop', 60], ['SubagentStart', 40], ['SubagentStop', 30], ['SubagentStart', 10],
  ].map(([event, min]) => JSON.stringify({ ts: at(min), event, agent_id: 'agX', agent_type: 'integrator', session_id: 's1' })).join('\n') + '\n');

  const st = collect({ projectDir: project, claudeDir: claude, now });
  const c = st.changes.find((x) => x.id === 'add-x');
  const legs = c.runs.filter((r) => r.agent === 'integrator');
  assert.deepEqual(legs.map((r) => r.id), ['agX', 'agX~1', 'agX~2'], 'one run per leg');
  assert.deepEqual(legs.map((r) => r.status), ['finished', 'finished', 'running'], 'the last leg runs although an earlier leg stopped');
  assert.deepEqual(legs.map((r) => r.description), ['Implement tasks 2.1–2.2', 'Review round 1 came back CHANGES REQUESTED: fix R1, R2.', 'New task for add-x: implement 2.3 from tasks.md.']);
  assert.deepEqual(legs.map((r) => Math.round(r.durationMs / 60000)), [30, 10, 10], 'each leg its own time, no gap between legs counted');
  assert.deepEqual(legs.map((r) => r.usage.input), [30, 30, 40], 'each leg its own tokens');
  assert.deepEqual(legs[2].taskIds, ['2.3'], '"implement 2.3" ties the leg to its task');
  assert.ok(st.running.some((r) => r.agent === 'integrator' && r.status === 'running'), 'listed among the agents running now');
  // the same agent once stopped for good: nothing runs
  fs.appendFileSync(path.join(project, '.claude/ai-team/events.jsonl'), JSON.stringify({ ts: at(1), event: 'SubagentStop', agent_id: 'agX', agent_type: 'integrator', session_id: 's1' }) + '\n');
  const st2 = collect({ projectDir: project, claudeDir: claude, now });
  assert.deepEqual(st2.changes.find((x) => x.id === 'add-x').runs.filter((r) => r.agent === 'integrator').map((r) => r.status), ['finished', 'finished', 'finished']);
  // an agent never resumed is one run, as before
  assert.equal(collect({ projectDir: project, claudeDir: claude, now }).changes.find((x) => x.id === 'add-x').runs.length, 3);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('✓ resumed agents ok');
