// Agent states (running, no signal, finished, failed, interrupted) and source session.
//   node tests/agentstate.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug } from '../dashboard/collect.mjs';
import { presenceOf } from '../dashboard/feed.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-state-'));
const project = path.join(tmp, 'proj'), claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-24T12:00:00.000Z');
const at = (min) => new Date(now - min * 60000).toISOString();
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const jsonl = (f, recs) => w(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
w(path.join(project, 'openspec/changes/ch/tasks.md'), '## 1. Backend\n- [ ] 1.1 a\n');
const pdir = path.join(claude, 'projects', projectSlug(project));

function session(sid, extra, calls) {
  const base = { cwd: project, sessionId: sid, isSidechain: false };
  const recs = [...extra.map((e) => ({ ...base, ...e }))];
  for (const c of calls) {
    recs.push({ ...base, type: 'assistant', uuid: `c-${c.id}`, timestamp: at(c.min), requestId: `r-${c.id}`,
      message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'tool_use', id: c.id, name: 'Agent', input: { subagent_type: c.agent, description: `run ${c.id}`, prompt: `do ${c.id} in openspec/changes/ch` } }] } });
    if (c.result) recs.push({ ...base, type: 'user', uuid: `res-${c.id}`, timestamp: at(c.min - 1),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, content: 'x' }] }, toolUseResult: { agentId: `ag-${c.id}`, status: c.result } });
    if (c.notify) recs.push({ ...base, type: 'user', uuid: `n-${c.id}`, timestamp: at(c.min - 1),
      message: { role: 'user', content: `<task-notification>\n<task-id>ag-${c.id}</task-id>\n<status>${c.notify}</status>\n</task-notification>` } });
    // subagent transcript: last record `last` min ago
    const sb = { ...base, isSidechain: true };
    const sr = [
      { ...sb, type: 'user', uuid: `${c.id}-u`, timestamp: at(c.min), message: { role: 'user', content: `do ${c.id} in openspec/changes/ch` } },
      { ...sb, type: 'assistant', uuid: `${c.id}-a`, timestamp: at(c.last), requestId: `${c.id}-r`, message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'working' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ];
    if (c.interrupt) sr.push({ ...sb, type: 'user', uuid: `${c.id}-i`, timestamp: at(c.last), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
    const sf = path.join(pdir, sid, 'subagents', `agent-ag-${c.id}.jsonl`);
    jsonl(sf, sr);
    // the collector uses the file mtime as last activity: pin it to the fixture clock (not the real clock)
    const m = new Date(now - c.last * 60000); fs.utimesSync(sf, m, m);
  }
  jsonl(path.join(pdir, `${sid}.jsonl`), recs);
}
const prompt = (text) => ({ type: 'user', uuid: 'u0', timestamp: at(300), message: { role: 'user', content: text } });

// session with a recorded title; delegations in each state (the session is live: not enough for "running")
session('s-title', [prompt('any first prompt'), { type: 'custom-title', customTitle: 'Workshop Package (M9)' }], [
  { id: 'R', agent: 'builder', min: 30, last: 2 },                             // activity 2 min ago
  { id: 'S', agent: 'integrator', min: 200, last: 40 },                        // stopped 40 min ago, no result
  { id: 'T', agent: 'validator', min: 90, last: 70, result: 'completed' },     // finished
  { id: 'F', agent: 'reviewer', min: 90, last: 70, notify: 'failed' },         // failed
  { id: 'I', agent: 'provisioner', min: 60, last: 50, interrupt: true },       // interrupted
]);
// session without a title: shortened first prompt; another with nothing: short id
session('s-prompt', [prompt("Let's go: You are the spec-writer of ATLAS. Prepare the change package for block E2-06 with lots of detail")], []);
session('abcdef12-3456', [{ type: 'assistant', uuid: 'a0', timestamp: at(5), message: { role: 'assistant', content: [{ type: 'text', text: 'hi' }] } }], []);
w(path.join(claude, 'sessions', '1.json'), JSON.stringify({ pid: process.pid, sessionId: 's-title' }));

const st = collect({ projectDir: project, claudeDir: claude, now });
const run = (id) => st.changes.find((c) => c.id === 'ch').runs.find((r) => r.id === `ag-${id}`);
assert.equal(st.staleMin, 15);
assert.equal(run('R').status, 'running'); assert.equal(run('R').active, true);
assert.equal(run('S').status, 'no signal'); assert.equal(run('S').active, false);
assert.equal(Math.round(run('S').silentMs / 60000), 40, 'no signal for 40 min');
assert.equal(run('T').status, 'finished');
assert.equal(run('F').status, 'failed');
assert.equal(run('I').status, 'interrupted'); assert.equal(run('I').active, false);
assert.deepEqual(st.agentStates, { running: 1, 'no signal': 1, finished: 1, failed: 1, interrupted: 1 });

// "now": running and recent no signal; finished/failed/interrupted stay in history
assert.deepEqual(st.running.filter((r) => !r.main).map((r) => [r.agent, r.status]).sort(), [['builder', 'running'], ['integrator', 'no signal']]);
assert.ok(st.recent.every((r) => ['finished', 'failed', 'interrupted'].includes(r.status)));
assert.deepEqual(st.changes.find((c) => c.id === 'ch').staleAgents.map((a) => a.agent), ['integrator']);

// --stale-min: 60 min leaves the one stopped for 40 min as running; 1 min drops the 2-min one
const st60 = collect({ projectDir: project, claudeDir: claude, now, staleMin: 60 });
assert.equal(st60.changes[0].runs.find((r) => r.id === 'ag-S').status, 'running');
const st1 = collect({ projectDir: project, claudeDir: claude, now, staleMin: 1 });
assert.equal(st1.changes[0].runs.find((r) => r.id === 'ag-R').status, 'no signal');

// very old no signal (> 24 h) leaves "now"
const stOld = collect({ projectDir: project, claudeDir: claude, now: now + 30 * 3600 * 1000 });
assert.equal(stOld.running.filter((r) => !r.main && r.status === 'no signal').length, 0);

// presence: green, amber, gray, red
assert.deepEqual(['running', 'no signal', 'finished', 'failed', 'interrupted'].map((status) => presenceOf({ status, active: status === 'running' })), ['on', 'stale', 'done', 'failed', 'stale']);

// source session
assert.equal(run('R').sessionName, 'Workshop Package (M9)');
const mains = Object.fromEntries(st.mainRuns.map((r) => [r.sessionId, r.sessionName]));
assert.equal(mains['s-title'], 'Workshop Package (M9)', 'transcript title');
assert.equal(mains['s-prompt'], 'You are the spec-writer of ATLAS. Prepare the change…', 'shortened first prompt');
assert.ok(mains['s-prompt'].length <= 60);
assert.equal(mains['abcdef12-3456'], 'abcdef12', 'no title and no prompt: short id');
assert.equal(st.running.find((r) => r.agent === 'builder').sessionName, 'Workshop Package (M9)');

console.log('✓ agent and session states ok');
