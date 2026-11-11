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
    if (!c.nocall) recs.push({ ...base, type: 'assistant', uuid: `c-${c.id}`, timestamp: at(c.min), requestId: `r-${c.id}`,
      message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 },
        content: [{ type: 'tool_use', id: c.id, name: 'Agent', input: { subagent_type: c.agent, description: `run ${c.id}`, prompt: `do ${c.id} in openspec/changes/ch` } }] } });
    if (c.result) recs.push({ ...base, type: 'user', uuid: `res-${c.id}`, timestamp: at(c.min - 1),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, content: 'x' }] }, toolUseResult: { agentId: `ag-${c.id}`, status: c.result, ...(c.resolved ? { resolvedModel: c.resolved } : {}) } });
    // errored call (Claude Code 2.1.3xx): is_error on the block and the message as a string, no agentId, no subagent transcript
    if (c.error) { recs.push({ ...base, type: 'user', uuid: `res-${c.id}`, timestamp: at(c.min - 1),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, is_error: true, content: c.error }] }, toolUseResult: c.error }); continue; }
    if (c.nosub) continue;   // no subagent transcript (only the call and its result)
    if (c.notify) recs.push({ ...base, type: 'user', uuid: `n-${c.id}`, timestamp: at(c.min - 1),
      message: { role: 'user', content: `<task-notification>\n<task-id>ag-${c.id}</task-id>\n<status>${c.notify}</status>\n</task-notification>` } });
    // subagent transcript: last record `last` min ago
    const sb = { ...base, isSidechain: true };
    const sr = [
      { ...sb, type: 'user', uuid: `${c.id}-u`, timestamp: at(c.subMin ?? c.min), message: { role: 'user', content: c.subPrompt || `do ${c.id} in openspec/changes/ch` } },
      { ...sb, type: 'assistant', uuid: `${c.id}-a`, timestamp: at(c.last), requestId: `${c.id}-r`, message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'working' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ];
    if (c.interrupt) sr.push({ ...sb, type: 'user', uuid: `${c.id}-i`, timestamp: at(c.last), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
    const sf = path.join(pdir, sid, 'subagents', `agent-ag-${c.id}.jsonl`);
    jsonl(sf, sr);
    if (c.meta) w(sf.replace(/\.jsonl$/, '.meta.json'), JSON.stringify(c.meta));   // Claude Code 2.1.3xx writes it next to the transcript
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
  { id: 'E', agent: 'builder', min: 20, error: 'Error: The server-side auto mode classifier gave no verdict for Agent' },   // errored call
  // meta.json: the call (prompt differs, no result, a stray sub starts first) links by toolUseId; finished by the meta
  { id: 'M', agent: 'builder', min: 100, subMin: 95, last: 90, subPrompt: 'do M, some other wording of openspec/changes/ch', meta: { toolUseId: 'M', agentType: 'builder', finished: true } },
  // no visible call (compacted): type, description and model from the meta; finished by the meta although silent for 60 min
  { id: 'N', agent: 'reviewer', nocall: true, min: 98, last: 60, meta: { agentType: 'reviewer', description: 'review round 1', model: 'claude-haiku-5-5', finished: true } },
  // no subagent transcript: the model comes from the result's resolvedModel
  { id: 'P', agent: 'builder', min: 10, result: 'completed', nosub: true, resolved: 'claude-haiku-5-5' },
]);
// session without a title: shortened first prompt; another with nothing: short id
// an interruption (Esc) before the first prompt is not a prompt: it does not name the session, it is counted
session('s-prompt', [{ type: 'user', uuid: 'i0', timestamp: at(310), message: { role: 'user', content: '[Request interrupted by user]' } },
  prompt("Let's go: You are the spec-writer of ATLAS. Prepare the change package for block E2-06 with lots of detail")], []);
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
// errored call: ended at the result, failed (not 'running' until stale, then 'no signal' for a day)
const errRun = st.changes.find((c) => c.id === 'ch').runs.find((r) => r.id === 'call:E');
assert.equal(errRun.status, 'failed'); assert.equal(errRun.active, false);
assert.equal(errRun.end, Date.parse(at(19)), 'ended when the error came back');
// meta.json: link by toolUseId, end by `finished`, type/description/model without a call; resolvedModel without a transcript
assert.equal(run('M').linked, true, 'linked through the meta toolUseId, not the stray sub that started first');
assert.equal(run('M').status, 'finished'); assert.equal(run('M').end, Date.parse(at(90)), 'ended at the transcript end (meta finished)');
assert.equal(run('N').status, 'finished', 'silent for 60 min but the meta says finished');
assert.deepEqual([run('N').agent, run('N').description, run('N').model], ['reviewer', 'review round 1', 'sonnet-5-5'], 'type and description from the meta; the model seen in the transcript beats the meta one');
assert.ok(st.unlinked.includes('ag-N'));
assert.equal(run('P').model, 'haiku-5-5', 'resolvedModel of the result');
assert.deepEqual(st.agentStates, { running: 1, 'no signal': 1, finished: 4, failed: 2, interrupted: 1 });

// "now": running and recent no signal; finished/failed/interrupted stay in history
assert.deepEqual(st.running.filter((r) => !r.main).map((r) => [r.agent, r.status]).sort(), [['builder', 'running'], ['integrator', 'no signal']]);
assert.ok(st.recent.every((r) => ['finished', 'failed', 'interrupted'].includes(r.status)));
assert.ok(st.recent.some((r) => r.id === 'call:E'), 'the errored call is in history, not in "now"');
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
assert.equal(st.mainRuns.find((r) => r.sessionId === 's-prompt').interruptions, 1, 'interruptions counted');
assert.equal(st.mainRuns.find((r) => r.sessionId === 's-title').interruptions, 0);
assert.ok(mains['s-prompt'].length <= 60);
assert.equal(mains['abcdef12-3456'], 'abcdef12', 'no title and no prompt: short id');
assert.equal(st.running.find((r) => r.agent === 'builder').sessionName, 'Workshop Package (M9)');

console.log('✓ agent and session states ok');
