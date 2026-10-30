// Estados do agente (rodando, sem sinal, terminou, falhou, interrompido) e sessão de origem.
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
        content: [{ type: 'tool_use', id: c.id, name: 'Agent', input: { subagent_type: c.agent, description: `rodada ${c.id}`, prompt: `faça ${c.id} em openspec/changes/ch` } }] } });
    if (c.result) recs.push({ ...base, type: 'user', uuid: `res-${c.id}`, timestamp: at(c.min - 1),
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: c.id, content: 'x' }] }, toolUseResult: { agentId: `ag-${c.id}`, status: c.result } });
    if (c.notify) recs.push({ ...base, type: 'user', uuid: `n-${c.id}`, timestamp: at(c.min - 1),
      message: { role: 'user', content: `<task-notification>\n<task-id>ag-${c.id}</task-id>\n<status>${c.notify}</status>\n</task-notification>` } });
    // transcript do subagente: último registro há `last` min
    const sb = { ...base, isSidechain: true };
    const sr = [
      { ...sb, type: 'user', uuid: `${c.id}-u`, timestamp: at(c.min), message: { role: 'user', content: `faça ${c.id} em openspec/changes/ch` } },
      { ...sb, type: 'assistant', uuid: `${c.id}-a`, timestamp: at(c.last), requestId: `${c.id}-r`, message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'trabalhando' }], usage: { input_tokens: 1, output_tokens: 1 } } },
    ];
    if (c.interrupt) sr.push({ ...sb, type: 'user', uuid: `${c.id}-i`, timestamp: at(c.last), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } });
    const sf = path.join(pdir, sid, 'subagents', `agent-ag-${c.id}.jsonl`);
    jsonl(sf, sr);
    // o coletor usa o mtime do arquivo como última atividade: fixa no relógio do fixture (não no relógio real)
    const m = new Date(now - c.last * 60000); fs.utimesSync(sf, m, m);
  }
  jsonl(path.join(pdir, `${sid}.jsonl`), recs);
}
const prompt = (text) => ({ type: 'user', uuid: 'u0', timestamp: at(300), message: { role: 'user', content: text } });

// sessão com título gravado; delegações em cada estado (a sessão está viva: não basta para "rodando")
session('s-titulo', [prompt('primeiro prompt qualquer'), { type: 'custom-title', customTitle: 'Pacote Workshop (M9)' }], [
  { id: 'R', agent: 'builder', min: 30, last: 2 },                             // atividade há 2 min
  { id: 'S', agent: 'integrator', min: 200, last: 40 },                        // parado há 40 min, sem resultado
  { id: 'T', agent: 'validator', min: 90, last: 70, result: 'completed' },     // terminou
  { id: 'F', agent: 'reviewer', min: 90, last: 70, notify: 'failed' },         // falhou
  { id: 'I', agent: 'provisioner', min: 60, last: 50, interrupt: true },       // interrompido
]);
// sessão sem título: primeiro prompt encurtado; outra sem nada: id curto
session('s-prompt', [prompt('Vamos a isso: Você é o spec-writer do ATLAS. Prepare o pacote de changes do bloco E2-06 com muitos detalhes')], []);
session('abcdef12-3456', [{ type: 'assistant', uuid: 'a0', timestamp: at(5), message: { role: 'assistant', content: [{ type: 'text', text: 'oi' }] } }], []);
w(path.join(claude, 'sessions', '1.json'), JSON.stringify({ pid: process.pid, sessionId: 's-titulo' }));

const st = collect({ projectDir: project, claudeDir: claude, now });
const run = (id) => st.changes.find((c) => c.id === 'ch').runs.find((r) => r.id === `ag-${id}`);
assert.equal(st.staleMin, 15);
assert.equal(run('R').status, 'rodando'); assert.equal(run('R').active, true);
assert.equal(run('S').status, 'sem sinal'); assert.equal(run('S').active, false);
assert.equal(Math.round(run('S').silentMs / 60000), 40, 'sem sinal há 40 min');
assert.equal(run('T').status, 'terminou');
assert.equal(run('F').status, 'falhou');
assert.equal(run('I').status, 'interrompido'); assert.equal(run('I').active, false);
assert.deepEqual(st.agentStates, { rodando: 1, 'sem sinal': 1, terminou: 1, falhou: 1, interrompido: 1 });

// "agora": rodando e sem sinal recente; terminou/falhou/interrompido ficam no histórico
assert.deepEqual(st.running.filter((r) => !r.main).map((r) => [r.agent, r.status]).sort(), [['builder', 'rodando'], ['integrator', 'sem sinal']]);
assert.ok(st.recent.every((r) => ['terminou', 'falhou', 'interrompido'].includes(r.status)));
assert.deepEqual(st.changes.find((c) => c.id === 'ch').staleAgents.map((a) => a.agent), ['integrator']);

// --stale-min: 60 min deixa o parado de 40 min como rodando; 1 min derruba o de 2 min
const st60 = collect({ projectDir: project, claudeDir: claude, now, staleMin: 60 });
assert.equal(st60.changes[0].runs.find((r) => r.id === 'ag-S').status, 'rodando');
const st1 = collect({ projectDir: project, claudeDir: claude, now, staleMin: 1 });
assert.equal(st1.changes[0].runs.find((r) => r.id === 'ag-R').status, 'sem sinal');

// sem sinal muito antigo (> 24 h) sai de "agora"
const stOld = collect({ projectDir: project, claudeDir: claude, now: now + 30 * 3600 * 1000 });
assert.equal(stOld.running.filter((r) => !r.main && r.status === 'sem sinal').length, 0);

// presença: verde, âmbar, cinza, vermelho
assert.deepEqual(['rodando', 'sem sinal', 'terminou', 'falhou', 'interrompido'].map((status) => presenceOf({ status, active: status === 'rodando' })), ['on', 'stale', 'done', 'failed', 'stale']);

// sessão de origem
assert.equal(run('R').sessionName, 'Pacote Workshop (M9)');
const mains = Object.fromEntries(st.mainRuns.map((r) => [r.sessionId, r.sessionName]));
assert.equal(mains['s-titulo'], 'Pacote Workshop (M9)', 'título do transcript');
assert.equal(mains['s-prompt'], 'Você é o spec-writer do ATLAS. Prepare o pacote de changes…', 'primeiro prompt encurtado');
assert.ok(mains['s-prompt'].length <= 60);
assert.equal(mains['abcdef12-3456'], 'abcdef12', 'sem título e sem prompt: id curto');
assert.equal(st.running.find((r) => r.agent === 'builder').sessionName, 'Pacote Workshop (M9)');

console.log('✓ estados do agente e sessão ok');
