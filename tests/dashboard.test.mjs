// Teste do coletor do painel sobre transcripts sintéticos no formato do
// Claude Code 2.1 (um registro por bloco com requestId repetido, subagentes em
// <sessão>/subagents/agent-<id>.jsonl, resultado do Agent tool com agentId).
//   node tests/dashboard.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-dash-'));
const project = path.join(tmp, 'proj');
const claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-21T15:00:00.000Z');
const at = (min) => new Date(now - min * 60000).toISOString();
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const jsonl = (f, recs) => w(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');

// --- projeto com openspec ---------------------------------------------------
w(path.join(project, '.claude', 'settings.json'), '{"agent":"tech-lead"}');
w(path.join(project, 'openspec/changes/add-invoice/tasks.md'), `# tasks\n## 0. Infra\n- [x] 0.1 compose\n## 1. Backend\n- [x] 1.1 rota\n- [ ] 1.2 testes\n## 2. Frontend\n- [ ] 2.1 tela\n## 3. QA\n- [ ] 3.1 validar\n`);
w(path.join(project, 'openspec/changes/add-invoice/review-report.md'), `# Revisão\n## Rodada 1\nResultado: MUDANÇAS PEDIDAS\n## Rodada 2\nResultado: APROVADO\n`);
w(path.join(project, 'openspec/changes/fix-login/tasks.md'), `## 1. Backend\n- [ ] 1.1 corrigir (bloqueada: D-12)\n`);
w(path.join(project, 'openspec/changes/new-idea/tasks.md'), `## 1. Backend\n- [ ] 1.1 algo\n`);
w(path.join(project, 'openspec/changes/archive/2026-10-01-old-change/tasks.md'), `## 1. Backend\n- [x] 1.1 feito\n`);
w(path.join(project, 'openspec/changes/archive/2026-10-01-old-change/qa-report.md'), `# QA — old-change   Resultado: APROVADO\n`);

// --- sessão principal -----------------------------------------------------
const slug = projectSlug(project);
const sdir = path.join(claude, 'projects', slug);
const sid = 'sess-0001';
const base = { cwd: project, sessionId: sid, version: '2.1.306', isSidechain: false, userType: 'external' };
const asst = (uuid, min, blocks, reqId, usage) => blocks.map((b, i) => ({ ...base, type: 'assistant', uuid: `${uuid}-${i}`, timestamp: at(min),
  requestId: reqId, apiBlockIndex: i, message: { role: 'assistant', model: 'claude-opus-5-5', usage, content: [b] } }));
const usageMain = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 };
const promptPO = 'Crie a change add-invoice no OpenSpec (openspec/changes/add-invoice): proposal, specs e tasks.';
const promptBE = 'Implemente a seção 1. Backend de openspec/changes/add-invoice/tasks.md. Leia design.md.';
const promptMisc = 'Verifique se o Postgres está no ar.';
jsonl(path.join(sdir, `${sid}.jsonl`), [
  { ...base, type: 'user', uuid: 'u1', timestamp: at(60), message: { role: 'user', content: 'crie a change add-invoice' } },
  ...asst('a1', 59, [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'tu-po', name: 'Agent', input: { subagent_type: 'product-owner', description: 'criar change', prompt: promptPO } }], 'req-1', usageMain),
  { ...base, type: 'user', uuid: 'u2', timestamp: at(45), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-po', content: 'feito' }] },
    toolUseResult: { agentId: 'po1', content: [{ type: 'text', text: 'feito' }], totalDurationMs: 14 * 60000, totalTokens: 5000, totalToolUseCount: 7,
      usage: { input_tokens: 50, output_tokens: 900, cache_read_input_tokens: 4000, cache_creation_input_tokens: 50 } } },
  ...asst('a2', 44, [{ type: 'tool_use', id: 'tu-be', name: 'Agent', input: { subagent_type: 'backend-dev', description: 'seção 1', prompt: promptBE, run_in_background: true } }], 'req-2', usageMain),
  { ...base, type: 'user', uuid: 'u3', timestamp: at(44), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-be', content: 'Agent started in background' }] },
    toolUseResult: { status: 'async_launched', description: 'seção 1' } },
  ...asst('a3', 43, [{ type: 'tool_use', id: 'tu-misc', name: 'Agent', input: { subagent_type: 'devops', description: 'checar banco', prompt: promptMisc, model: 'haiku' } }], 'req-3', usageMain),
  { ...base, type: 'user', uuid: 'u4', timestamp: at(42), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-misc', content: 'no ar' }] },
    toolUseResult: { agentId: 'dv1', content: [{ type: 'text', text: 'no ar' }], totalDurationMs: 30000, totalTokens: 300, totalToolUseCount: 1, usage: { input_tokens: 5, output_tokens: 50, cache_read_input_tokens: 200, cache_creation_input_tokens: 0 } } },
  ...asst('a4', 41, [{ type: 'text', text: 'backend em andamento' }], 'req-4', usageMain),
]);

// --- subagentes -------------------------------------------------------------
const sub = (agentId, agent, min0, min1, prompt, model, n, blocked) => {
  const recs = [{ ...base, isSidechain: true, agentId, type: 'user', uuid: `${agentId}-u`, timestamp: at(min0), message: { role: 'user', content: prompt } }];
  for (let i = 0; i < n; i++) {
    const m = min0 - ((min0 - min1) * (i + 1)) / n;
    recs.push(...[{ type: 'text', text: `passo ${i}` }, { type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }].map((b, j) => ({ ...base, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-a${i}-${j}`,
      timestamp: at(m), requestId: `${agentId}-r${i}`, message: { role: 'assistant', model, content: [b], usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 10 } } })));
  }
  recs.push({ ...base, isSidechain: true, agentId, type: 'assistant', uuid: `${agentId}-fim`, timestamp: at(min1), requestId: `${agentId}-rf`, message: { role: 'assistant', model, content: [{ type: 'text', text: blocked ? 'task bloqueada' : 'resultado final' }], usage: { input_tokens: 1, output_tokens: 10, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } });
  jsonl(path.join(sdir, sid, 'subagents', `agent-${agentId}.jsonl`), recs);
};
sub('po1', 'product-owner', 59, 45, promptPO, 'claude-opus-5-5', 5);          // concluído: 5 req + final = 6 requests
sub('be1', 'backend-dev', 44, 1, promptBE, 'claude-sonnet-5-5', 8);           // ativo (último registro há 1 min), ligado por prompt
sub('dv1', 'devops', 43, 42, promptMisc, 'claude-haiku-5-5', 1);              // sem change
sub('qa9', 'qa', 200, 190, 'Valide os cenários de openspec/changes/old-change', 'claude-sonnet-5-5', 2); // sem chamada visível

// --- coleta -------------------------------------------------------------------
const st = collect({ projectDir: project, claudeDir: claude, now });
const by = Object.fromEntries(st.changes.map((c) => [c.id, c]));

assert.equal(st.project.mainAgent, 'tech-lead');
assert.deepEqual(st.changes.map((c) => c.id), ['add-invoice', 'fix-login', 'new-idea', 'old-change', '(sem change)'], 'ordem: andamento, bloqueada, pendente, concluídas');
assert.equal(by['add-invoice'].status, 'em andamento');
assert.equal(by['fix-login'].status, 'bloqueada');
assert.equal(by['new-idea'].status, 'pendente');
assert.equal(by['old-change'].status, 'concluída');
assert.equal(by['old-change'].qa, 'APROVADO');
assert.equal(by['add-invoice'].review, 'APROVADO', 'último Resultado do review-report');
assert.deepEqual(by['add-invoice'].tasks, { total: 5, done: 2, blocked: 0 });

const inv = by['add-invoice'];
assert.equal(inv.rounds, 2);
assert.deepEqual(inv.runs.map((r) => r.agent), ['product-owner', 'backend-dev']);
assert.equal(inv.handoffs, 2, 'tech-lead→po, po→backend');
assert.deepEqual(inv.runs.map((r) => [r.from, r.to]), [['tech-lead', 'backend-dev'], ['product-owner', null]]);
assert.deepEqual(inv.activeAgents.map((a) => a.agent), ['backend-dev']);

const po = inv.runs[0];
assert.equal(po.status, 'concluído');
assert.equal(po.durationMs, 14 * 60000, 'duração vem do totalDurationMs do Agent tool');
assert.equal(po.usage.requests, 6, 'blocos com o mesmo requestId contam uma vez');
assert.equal(po.usage.total, 6 * 1120 - 1120 + 111, 'soma de tokens deduplicada');
assert.equal(po.model, 'opus-5-5');
assert.equal(po.totalTokensReported, 5000);

const be = inv.runs[1];
assert.equal(be.active, true);
assert.equal(be.status, 'ativo');
assert.equal(be.background, true);
assert.equal(be.linked, true, 'ligado pelo prompt, sem agentId no resultado');
assert.equal(be.id, 'be1');
assert.equal(be.durationMs, 44 * 60000, 'ativo: agora − início');
assert.equal(be.model, 'sonnet-5-5');

const misc = by['(sem change)'];
assert.equal(misc.status, 'avulsa');
assert.equal(misc.runs.length, 1);
assert.equal(misc.runs[0].model, 'haiku', 'model do Agent tool vence o do transcript');

const old = by['old-change'];
assert.equal(old.runs.length, 1, 'subagente sem chamada visível ainda aparece');
assert.equal(old.runs[0].agent, 'desconhecido', 'sem chamada nem hook não dá para saber o tipo');
assert.deepEqual(st.unlinked, ['qa9']);

const eff = Object.fromEntries(st.agents.map((a) => [a.agent, a]));
assert.ok(eff['tech-lead'], 'sessão principal conta como tech-lead');
assert.equal(eff['tech-lead'].tokens, 4 * 1110, 'usage da sessão principal deduplicada');
assert.equal(eff['backend-dev'].active, true);
assert.equal(eff['product-owner'].runs, 1);
assert.ok(eff['backend-dev'].durationMs > eff['devops'].durationMs);
assert.equal(st.totals.active, 1);

// hook opcional refina o fim
w(path.join(project, '.claude/ai-team/events.jsonl'), JSON.stringify({ ts: at(2), event: 'SubagentStop', agent_id: 'be1', agent_type: 'backend-dev' }) + '\n');
const st2 = collect({ projectDir: project, claudeDir: claude, now });
const be2 = st2.changes.find((c) => c.id === 'add-invoice').runs[1];
assert.equal(be2.active, false, 'SubagentStop encerra a rodada');
assert.equal(be2.end, now - 2 * 60000);
assert.equal(st2.changes.find((c) => c.id === 'add-invoice').status, 'em andamento', 'tasks pela metade continua em andamento');

// sessão viva: delegação sem resultado continua ativa mesmo com transcript antigo
fs.rmSync(path.join(project, '.claude/ai-team'), { recursive: true, force: true });
const later = now + 60 * 60000;
const st4a = collect({ projectDir: project, claudeDir: claude, now: later });
assert.equal(st4a.changes.find((c) => c.id === 'add-invoice').runs[1].active, false, 'sem sessão viva, 61 min sem escrever = encerrado');
w(path.join(claude, 'sessions', '1.json'), JSON.stringify({ pid: process.pid, sessionId: sid }));
w(path.join(claude, 'sessions', '2.json'), JSON.stringify({ pid: 999999, sessionId: 'morta' }));
const st4b = collect({ projectDir: project, claudeDir: claude, now: later });
assert.equal(st4b.changes.find((c) => c.id === 'add-invoice').runs[1].active, true, 'sessão viva + sem resultado = ativo');
assert.equal(st4b.changes.find((c) => c.id === 'old-change').runs[0].active, false, 'subagente sem chamada segue a janela');
assert.equal(st4b.mainRuns[0].live, true);

// projeto sem transcripts
const st3 = collect({ projectDir: path.join(tmp, 'nada'), claudeDir: claude, now });
assert.equal(st3.changes.length, 0);
assert.equal(st3.agents.length, 0);

if (process.env.KEEP_FIXTURE) console.log(`fixture mantida: --project ${project} --claude-dir ${claude}`);
else fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ dashboard: coletor ok');
