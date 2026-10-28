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
const promptMisc = 'Verifique se o Postgres está no ar (sem relação com openspec/changes/add-invoice-*).';
jsonl(path.join(sdir, `${sid}.jsonl`), [
  { ...base, type: 'user', uuid: 'u1', timestamp: at(60), message: { role: 'user', content: 'crie a change add-invoice' } },
  ...asst('a1', 59, [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'tu-po', name: 'Agent', input: { subagent_type: 'product-owner', description: 'criar change', prompt: promptPO } }], 'req-1', usageMain),
  { ...base, type: 'user', uuid: 'u2', timestamp: at(45), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-po', content: 'feito' }] },
    toolUseResult: { agentId: 'po1', content: [{ type: 'text', text: 'feito' }], totalDurationMs: 14 * 60000, totalTokens: 5000, totalToolUseCount: 7,
      usage: { input_tokens: 50, output_tokens: 900, cache_read_input_tokens: 4000, cache_creation_input_tokens: 50 } } },
  ...asst('a2', 44, [{ type: 'tool_use', id: 'tu-be', name: 'Agent', input: { subagent_type: 'backend-dev', description: 'seção 1', prompt: promptBE, run_in_background: true } }], 'req-2', usageMain),
  { ...base, type: 'user', uuid: 'u3', timestamp: at(44), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu-be', content: 'Agent started in background' }] },
    toolUseResult: { isAsync: true, status: 'async_launched', agentId: 'be1', description: 'seção 1' } },
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
// mtimes reais são posteriores ao `now` fixo; recua-os para não parecerem "ativos" (teste dependia do relógio)
const touchAll = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) touchAll(f); fs.utimesSync(f, new Date(now - 3600e3), new Date(now - 3600e3)); } };
touchAll(tmp);
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
assert.equal(po.status, 'terminou', 'o resultado do Agent tool prova que terminou, não que deu certo');
assert.equal(po.durationMs, 14 * 60000, 'duração vem do totalDurationMs do Agent tool');
assert.equal(po.usage.requests, 6, 'blocos com o mesmo requestId contam uma vez');
assert.equal(po.usage.total, 6 * 1120 - 1120 + 111, 'soma de tokens deduplicada');
assert.equal(po.model, 'opus-5-5');
assert.equal(po.stage, 'proposta', 'etapa inferida do prompt');
// tokens por change e por agente
assert.equal(inv.tokens, po.usage.total + inv.runs[1].usage.total, 'total da change = soma das rodadas');
assert.deepEqual(inv.agents.map((a) => [a.agent, a.runs, a.tokens]).sort(), [['backend-dev', 1, inv.runs[1].usage.total], ['product-owner', 1, po.usage.total]].sort());
assert.equal(inv.runs[1].usage.total, 8 * 1120 + 111, '8 requisições de 1120 tokens mais a final, blocos repetidos contados uma vez');
assert.equal(inv.runs[1].stage, 'seção 1 (Backend)', 'etapa inferida do prompt');
// tokens novos (input + output + cache creation) separados do cache lido
{
  const be = inv.runs[1].usage;
  assert.ok(be.input > 0 && be.output > 0 && be.cacheRead > 0 && be.cacheCreation > 0, 'campos brutos separados no usage');
  assert.equal(inv.runs[1].tokenSplit.fresh, be.input + be.output + be.cacheCreation, 'novos exclui cache lido');
  assert.equal(inv.runs[1].tokenSplit.cached, be.cacheRead);
  assert.equal(inv.tokenSplit.fresh + inv.tokenSplit.cached, inv.tokens, 'novos + cache lido = total da change');
  assert.equal(inv.tokenSplit.cached, po.usage.cacheRead + be.cacheRead, 'cache lido da change = soma das rodadas');
  assert.ok(inv.tokenSplit.cached > inv.tokenSplit.fresh, 'a fixture tem cache lido dominante');
  for (const k of ['input', 'output', 'cacheRead', 'cacheCreation']) assert.equal(typeof inv.tokenSplit[k], 'number', k);
  const ag = inv.agents.find((x) => x.agent === 'backend-dev');
  assert.equal(ag.tokenSplit.fresh, inv.runs[1].tokenSplit.fresh, 'por agente na change');
  assert.equal(ag.tokenSplit.cached, be.cacheRead);
  assert.equal(inv.activeAgents[0].tokenSplit.cached, be.cacheRead, 'agentes ativos da change');
  assert.equal(st.running[0].tokenSplit.cached, be.cacheRead, 'agentes agora');
  const eff0 = st.agents.find((x) => x.agent === 'backend-dev');
  assert.equal(eff0.tokenSplit.fresh + eff0.tokenSplit.cached, eff0.tokens, 'esforço por agente');
  assert.equal(st.totals.tokenSplit.fresh + st.totals.tokenSplit.cached, st.totals.tokens, 'total geral');
}
// agentes agora e recentes
assert.deepEqual(st.running.map((r) => [r.agent, r.change]), [['backend-dev', 'add-invoice']]);
assert.equal(st.running[0].since, now - 44 * 60000);
assert.ok(st.recent.length && st.recent.every((r) => r.status !== 'rodando' && r.status !== 'concluído'));
assert.equal(st.changes.some((c) => /[-._]$/.test(c.id)), false, 'glob de pasta não vira change');
assert.equal(inv.waiting.text, 'esperando executar a task 1.2 (Backend)');
assert.equal(inv.startedAt, now - 59 * 60000, 'início = primeira execução de agente atribuída');
assert.equal(inv.startSource, 'primeira execução de agente');
assert.deepEqual(inv.files, ['tasks.md', 'review-report.md']);
assert.equal(po.totalTokensReported, 5000);

const be = inv.runs[1];
assert.equal(be.active, true);
assert.equal(be.status, 'rodando');
assert.equal(be.background, true);
assert.equal(be.linked, true, 'ligado pelo agentId do lançamento assíncrono');
assert.equal(be.end, null, 'async_launched com agentId não é término');
assert.equal(be.id, 'be1');
assert.equal(be.durationMs, 44 * 60000, 'ativo: agora − início');
assert.equal(be.model, 'sonnet-5-5');

const misc = by['(sem change)'];
assert.equal(misc.status, 'avulsa');
assert.equal(misc.runs.length, 1);
assert.equal(misc.runs[0].model, 'haiku', 'model do Agent tool vence o do transcript');

// etapa da trilha e task por rodada; trilha por change
assert.deepEqual(inv.runs.map((r) => r.flow), ['proposta', 'implementacao']);
assert.deepEqual([inv.runs[1].task, inv.runs[1].taskSection], [null, 'Backend'], 'só "seção 1 (Backend)": sem id de task');
assert.equal(inv.runs[0].task, null);
assert.equal(misc.trail, null, 'rodadas avulsas não têm trilha');
{
  const t = inv.trail;
  assert.deepEqual(t.steps.map((x) => x.key), ['proposta', 'aprovacao', 'implementacao', 'revisao', 'correcao', 'qa', 'integracao']);
  assert.deepEqual(t.steps.map((x) => x.state), ['concluida', 'concluida', 'andamento', 'concluida', 'concluida', 'pendente', 'pendente']);
  assert.equal(t.current, 'implementacao', 'rodada ativa manda');
  assert.deepEqual([t.rounds, t.delegations], [2, 2]);
  assert.deepEqual(t.loops, { revisao: 2, correcao: 1 }, 'review-report com 2 rodadas, 1 MUDANÇAS PEDIDAS');
  assert.equal(t.steps[3].times, 2);
  assert.equal(t.steps[4].times, null, 'uma volta só: sem ×N');
  assert.deepEqual(t.steps[2].agents, [{ agent: 'backend-dev', state: 'on', runs: 1 }]);
  assert.deepEqual(t.steps[2].tasks, { done: 2, total: 5 });
  assert.equal(t.next.key, 'qa');
  assert.equal(t.after.key, 'integracao');
  assert.deepEqual(t.steps[5].agents, [{ agent: 'qa', state: 'wait', runs: 0 }], 'próxima etapa mostra quem entra, na fila');
}
assert.deepEqual(by['new-idea'].trail.steps.map((x) => x.state), ['concluida', 'concluida', 'andamento', 'pendente', 'pendente', 'pendente', 'pendente'], 'sem agente: etapa pelo "esperando"');
assert.equal(by['new-idea'].trail.current, 'implementacao');
assert.equal(by['old-change'].trail.steps.every((x) => x.state === 'concluida' || x.key === 'correcao'), true, 'arquivada: tudo concluído');
assert.equal(by['old-change'].trail.steps[4].state, 'pendente', 'arquivada sem correção');
assert.equal(by['old-change'].runs[0].flow, null, 'agente desconhecido não entra na trilha');

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
const r4b = st4b.changes.find((c) => c.id === 'add-invoice').runs[1];
assert.equal(r4b.active, false, 'sessão viva não basta: sem atividade no transcript há 60 min = sem sinal');
assert.equal(r4b.status, 'sem sinal');
assert.ok(r4b.silentMs >= 59 * 60000, 'sem sinal há X');
assert.equal(st4b.changes.find((c) => c.id === 'old-change').runs[0].active, false, 'subagente sem chamada segue a janela');
assert.equal(st4b.mainRuns[0].live, true);

// projeto sem transcripts
const st3 = collect({ projectDir: path.join(tmp, 'nada'), claudeDir: claude, now });
assert.equal(st3.changes.length, 0);
assert.equal(st3.agents.length, 0);

// --- rotas /equipe e /agents/<nome>.md --------------------------------------
{
  const { spawn } = await import('node:child_process');
  const dash = path.join(tmp, 'dash'); fs.mkdirSync(dash);
  const srv = path.join(import.meta.dirname, '..', 'dashboard');
  for (const f of ['server.mjs', 'collect.mjs', 'board.mjs', 'stages.mjs', 'plan.mjs', 'ask.mjs', 'live.mjs', 'hub.mjs', 'team.mjs', 'index.html', 'equipe.html', 'cycle-default.html']) fs.copyFileSync(path.join(srv, f), path.join(dash, f));
  w(path.join(project, '.claude/agents/tech-lead.md'), '# tech-lead\n');
  const run = async (port, fn) => {
    const p = spawn(process.execPath, [path.join(dash, 'server.mjs'), '--project', project, '--claude-dir', claude, '--port', String(port)], { stdio: ['ignore', 'pipe', 'inherit'] });
    try {
      await new Promise((ok) => p.stdout.once('data', ok));
      await fn(`http://127.0.0.1:${port}`);
    } finally { p.kill(); await new Promise((r) => p.once('exit', r)); }
  };
  w(path.join(project, 'openspec/changes/add-invoice/specs/invoice/spec.md'), '# spec invoice\n');
  w(path.join(tmp, 'fora.md'), 'segredo');
  fs.symlinkSync(path.join(tmp, 'fora.md'), path.join(project, 'openspec/changes/add-invoice/leak.md'));
  await run(43211, async (b) => {
    const t = await fetch(`${b}/changes/add-invoice/tasks.md`);
    assert.equal(t.status, 200);
    assert.match(t.headers.get('content-type'), /^text\/plain; charset=utf-8/);
    assert.match(await t.text(), /## 1\. Backend/);
    assert.equal((await fetch(`${b}/changes/add-invoice/specs/invoice/spec.md`)).status, 200);
    assert.equal((await fetch(`${b}/changes/old-change/tasks.md`)).status, 200, 'change arquivada');
    for (const bad of ['..%2F..%2F.claude%2Fsettings.json', '%2e%2e/%2e%2e/.claude/settings.json', '..%5C..%5Ctasks.md', 'tasks.md%00', 'leak.md', 'notas.txt', '.md', 'specs/..%2F..%2Ftasks.md', 'specs/%2e%2e/tasks.md.bak'])
      assert.equal((await fetch(`${b}/changes/add-invoice/${bad}`)).status, 404, `recusa ${bad}`);
    for (const bad of ['..%2Fadd-invoice/tasks.md', '..%2F..%2F/tasks.md', 'archive/tasks.md', 'nao-existe/tasks.md'])
      assert.equal((await fetch(`${b}/changes/${bad}`)).status, 404, `recusa id ${bad}`);
    assert.equal((await fetch(`${b}/changes/add-invoice`)).status, 404);
    const state = await (await fetch(`${b}/api/state`)).json();
    assert.ok(state.changes.find((c) => c.id === 'add-invoice').files.includes('specs/invoice/spec.md'));
    assert.equal((await fetch(`${b}/equipe`)).status, 200, '/equipe existe em qualquer perfil');
    const a = await fetch(`${b}/agents/tech-lead.md`);
    assert.equal(a.status, 200);
    assert.match(a.headers.get('content-type'), /^text\/plain; charset=utf-8/);
    assert.match(await a.text(), /# tech-lead/);
    assert.equal((await fetch(`${b}/agents/nao-existe.md`)).status, 404);
    for (const bad of ['..%2F..%2Fsettings.json', '%2e%2e/x', 'Tech_Lead', 'a.b']) assert.equal((await fetch(`${b}/agents/${bad}.md`)).status, 404, `recusa ${bad}`);
    assert.equal((await fetch(`${b}/agents/..%2F..%2Fsettings.json`)).status, 404);
  });
  fs.writeFileSync(path.join(dash, 'cycle.html'), '<h1>ciclo do perfil</h1>');
  await run(43212, async (b) => {
    const r = await fetch(`${b}/equipe`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /<h1>ciclo do perfil<\/h1>/);
    assert.equal((await fetch(`${b}/equipe`, { method: 'HEAD' })).status, 200);
  });
}

if (process.env.KEEP_FIXTURE) console.log(`fixture mantida: --project ${project} --claude-dir ${claude}`);
else fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ dashboard: coletor ok');
