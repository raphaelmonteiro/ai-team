// Duração de agentes em segundo plano: o resultado imediato (async_launched) não indica o fim;
// vale o transcript do subagente, o SubagentStop ou a notificação. totalDurationMs só se coerente.
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
w(path.join(project, '.claude/settings.json'), '{"agent":"tech-lead"}');
w(path.join(project, 'openspec/changes/bg-change/tasks.md'), '## 1. Backend\n- [ ] 1.1 a\n');
const sid = 'sess-bg', sdir = path.join(claude, 'projects', projectSlug(project));
const base = { cwd: project, sessionId: sid, isSidechain: false };
const call = (id, min, agent, extra, tag) => ({ ...base, type: 'assistant', uuid: `c-${id}`, timestamp: at(min), requestId: `r-${id}`,
  message: { role: 'assistant', model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: 'tool_use', id, name: 'Agent', input: { subagent_type: agent, description: `rodada ${id}`, prompt: `faça ${id} em openspec/changes/bg-change`, ...extra } }] } });
const result = (id, min, tur) => ({ ...base, type: 'user', uuid: `res-${id}`, timestamp: at(min),
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'x' }] }, toolUseResult: tur });
const notify = (agentId, min) => ({ ...base, type: 'user', uuid: `n-${agentId}`, timestamp: at(min),
  message: { role: 'user', content: `<task-notification>\n<task-id>${agentId}</task-id>\n<status>completed</status>\n</task-notification>` } });
const sub = (agentId, min0, min1, prompt) => jsonl(path.join(sdir, sid, 'subagents', `agent-${agentId}.jsonl`), [
  { ...base, isSidechain: true, type: 'user', uuid: `${agentId}-u`, timestamp: at(min0), message: { role: 'user', content: prompt } },
  { ...base, isSidechain: true, type: 'assistant', uuid: `${agentId}-a`, timestamp: at((min0 + min1) / 2), requestId: `${agentId}-r1`, message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'meio' }], usage: { input_tokens: 1, output_tokens: 1 } } },
  { ...base, isSidechain: true, type: 'assistant', uuid: `${agentId}-z`, timestamp: at(min1), requestId: `${agentId}-r2`, message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'fim' }], usage: { input_tokens: 1, output_tokens: 1 } } },
]);
const bgp = (id) => `faça ${id} em openspec/changes/bg-change`;
const launched = (agentId, extra = {}) => ({ isAsync: true, status: 'async_launched', agentId, ...extra });

jsonl(path.join(sdir, `${sid}.jsonl`), [
  { ...base, type: 'user', uuid: 'u0', timestamp: at(100), message: { role: 'user', content: 'vai' } },
  // A: segundo plano concluído; o lançamento devolve duração absurda (2 s) e o agente trabalhou 30 min; notificação ao fim
  call('A', 90, 'backend-dev', { run_in_background: true }), result('A', 90, launched('bgA', { totalDurationMs: 2000 })),
  notify('bgA', 59),
  // B: segundo plano concluído, com SubagentStop no events.jsonl (vale sobre o transcript)
  call('B', 80, 'product-owner', { run_in_background: true }), result('B', 80, launched('bgB')),
  // C: segundo plano ainda ativo (transcript recente, sem notificação)
  call('C', 20, 'devops', { run_in_background: true }), result('C', 20, launched('bgC')),
  // D: em primeiro plano, totalDurationMs incoerente com os timestamps (2 s contra 10 min)
  call('D', 50, 'qa'), result('D', 40, { agentId: 'fgD', totalDurationMs: 2000 }),
  // E: em primeiro plano, totalDurationMs coerente: vale o informado
  call('E', 35, 'code-reviewer'), result('E', 25, { agentId: 'fgE', totalDurationMs: 10 * MIN - 3000 }),
]);
sub('bgA', 90, 60, bgp('A'));
sub('bgB', 80, 70, bgp('B'));
sub('bgC', 20, 1, bgp('C'));
sub('fgD', 50, 40, bgp('D'));
sub('fgE', 35, 25, bgp('E'));
w(path.join(project, '.claude/ai-team/events.jsonl'), JSON.stringify({ ts: at(68), event: 'SubagentStop', agent_id: 'bgB', agent_type: 'product-owner' }) + '\n');
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
  assert.equal(a.end, now - 60 * MIN, 'fim = último registro do transcript, não o lançamento');
  assert.equal(a.durationMs, 30 * MIN, 'a duração de 2 s do lançamento é descartada');
  assert.equal(by.bgB.end, now - 68 * MIN, 'SubagentStop vale quando existe');
  assert.equal(by.bgB.durationMs, 12 * MIN);
  const c = by.bgC;
  assert.equal(c.active, true);
  assert.equal(c.end, null, 'ativo: fim vazio');
  assert.equal(c.durationMs, 20 * MIN, 'ativo: agora − início');
  assert.equal(by.fgD.durationMs, 10 * MIN, 'totalDurationMs incoerente é descartado');
  assert.equal(by.fgE.durationMs, 10 * MIN - 3000, 'totalDurationMs coerente é mantido');
  assert.equal(ch.durationMs, 30 * MIN + 12 * MIN + 20 * MIN + 10 * MIN + (10 * MIN - 3000), 'soma da change usa as durações corrigidas');
  console.log('✓ async: duração de segundo plano ok');
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
