// Testes da trilha da change: etapa por rodada, task citada, estados, voltas e delegações.
//   node tests/trail.test.mjs
import assert from 'node:assert/strict';
import { inferTask, flowOf } from '../dashboard/board.mjs';
import { buildTrail } from '../dashboard/stages.mjs';

// --- inferTask ---------------------------------------------------------------
const tl = [{ id: '0.1', section: 'Infra' }, { id: '1.2', section: 'Backend (API)' }];
assert.deepEqual(inferTask('Implementa task 0.1', '', tl), { id: '0.1', section: 'Infra' });
assert.deepEqual(inferTask('', 'Execute a task 1.2 da change', tl), { id: '1.2', section: 'Backend' }, 'parênteses saem do nome da seção');
assert.deepEqual(inferTask('tasks 2.3 a 2.5', '', []), { id: '2.3', section: 'Frontend' }, 'faixa: a primeira; seção pelo dígito');
assert.deepEqual(inferTask('', 'Implemente a seção 1. Backend de tasks.md', []), { id: null, section: 'Backend' });
assert.deepEqual(inferTask('seção 3', '', []), { id: null, section: 'QA' });
assert.equal(inferTask('checar banco', 'Verifique o Postgres', tl), null, 'sem task nem seção: vazio');
assert.equal(inferTask('', '', null), null);

// --- flowOf ------------------------------------------------------------------
const f = (agent, extra = {}, ctx = {}) => flowOf({ agent, ...extra }, { mainAgent: 'tech-lead', ...ctx });
assert.equal(f('product-owner'), 'proposta');
assert.equal(f('product-owner', { taskSection: 'Processo' }), 'integracao', 'PO em tasks de Processo/Documentação');
assert.equal(f('product-owner', { stage: 'revisão' }), 'proposta', 'prompt do PO que cita revisão não vira Revisão');
assert.equal(f('code-reviewer'), 'revisao');
assert.equal(f('qa'), 'qa');
assert.equal(f('backend-dev'), 'implementacao');
assert.equal(f('backend-dev', { description: 'Corrige achados da revisão' }), 'implementacao', 'sem revisão antes, não é correção');
assert.equal(f('backend-dev', { description: 'Corrige achados da revisão' }, { afterReview: true }), 'correcao');
assert.equal(f('frontend-dev', { description: 'task 2.1' }, { afterReview: true }), 'implementacao', 'depois da revisão, sem palavra de correção');
assert.equal(f('devops', { stage: 'arquivamento' }), 'integracao');
assert.equal(f('tech-lead'), 'integracao');
assert.equal(f('Explore'), null);
assert.equal(f('general-purpose'), null);

// --- buildTrail ---------------------------------------------------------------
const run = (flow, agent, extra = {}) => ({ flow, agent, active: false, start: 1, delegated: true, ...extra });
const view = (extra) => ({ id: 'c', status: 'em andamento', archived: false, unknown: false, waiting: { text: 'esperando executar a task 1.1 (Backend)' },
  tasks: { total: 4, done: 0, blocked: 0 }, taskList: [{ id: '1.1', done: false, section: 'Backend' }, { id: '3.1', done: false, section: 'QA' }],
  review: null, reviewRounds: [], qa: null, runs: [], ...extra });
const states = (t) => t.steps.map((s) => s.state[0]).join('');

// avulsa
assert.equal(buildTrail({ status: 'avulsa', runs: [] }), null);

// implementação com devs ativos; QA na fila
{
  const t = buildTrail(view({ runs: [run('proposta', 'product-owner'), run('implementacao', 'backend-dev', { active: true }), run('implementacao', 'devops')] }));
  assert.equal(states(t), 'ccapppp');
  assert.equal(t.current, 'implementacao');
  assert.deepEqual(t.steps[2].agents.map((a) => [a.agent, a.state]), [['backend-dev', 'on'], ['devops', 'done']]);
  assert.equal(t.steps[2].active, true);
  assert.equal(t.next.key, 'revisao');
  assert.equal(t.after.key, 'qa', 'correção só entra se a revisão pedir');
  assert.deepEqual(t.steps[3].agents, [{ agent: 'code-reviewer', state: 'wait', runs: 0 }]);
  assert.equal(t.steps[3].queued, true);
  assert.equal(t.delegations, 3);
}

// voltas de revisão e correção: ×N
{
  const rr = ['MUDANÇAS PEDIDAS', 'MUDANÇAS PEDIDAS', 'APROVADO'];
  const t = buildTrail(view({
    tasks: { total: 2, done: 2, blocked: 0 }, taskList: [{ id: '1.1', done: true, section: 'Backend' }, { id: '3.1', done: false, section: 'QA' }],
    review: 'APROVADO', reviewRounds: rr, waiting: { text: 'indefinido' },
    runs: [run('proposta', 'product-owner'), run('implementacao', 'backend-dev'), run('revisao', 'code-reviewer'), run('correcao', 'backend-dev'), run('revisao', 'code-reviewer'), run('correcao', 'backend-dev'), run('revisao', 'code-reviewer')],
  }));
  assert.deepEqual(t.loops, { revisao: 3, correcao: 2 });
  assert.equal(t.steps[3].times, 3);
  assert.equal(t.steps[4].times, 2);
  assert.equal(t.steps[3].loop && t.steps[4].loop, true);
  assert.equal(states(t), 'cccccpp', 'QA ainda não aprovado, sem current: por evidência');
  assert.equal(t.current, null);
  assert.equal(t.next.key, 'qa');
  assert.equal(t.steps[3].result, 'APROVADO');
  assert.equal(t.delegations, 7);
}

// revisão pediu mudanças: correção em andamento (sem rodada ativa)
{
  const t = buildTrail(view({
    tasks: { total: 2, done: 2, blocked: 0 }, taskList: [{ id: '1.1', done: true, section: 'Backend' }],
    review: 'MUDANÇAS PEDIDAS', reviewRounds: ['MUDANÇAS PEDIDAS'], waiting: { text: 'esperando correção' },
    runs: [run('implementacao', 'backend-dev'), run('revisao', 'code-reviewer')],
  }));
  assert.equal(t.current, 'correcao');
  assert.equal(states(t), 'ccccapp');
  assert.equal(t.steps[3].state, 'concluida');
  assert.equal(t.steps[3].times, null, 'uma volta: sem ×N');
  assert.equal(t.next.key, 'qa');
}

// aguardando o desenvolvedor (aprovação) e sem tasks (proposta)
{
  const t = buildTrail(view({ waiting: { text: 'esperando o desenvolvedor' }, runs: [run('proposta', 'product-owner')] }));
  assert.equal(states(t), 'cappppp');
  assert.deepEqual(t.steps[1].agents, [{ agent: 'voce', state: 'wait', runs: 0 }]);
  assert.equal(t.next.key, 'implementacao');
  const p = buildTrail(view({ tasks: { total: 0, done: 0, blocked: 0 }, taskList: [], waiting: { text: 'indefinido' }, runs: [] }));
  assert.equal(p.current, 'proposta');
  assert.equal(states(p), 'apppppp');
}

// QA e integração
{
  const t = buildTrail(view({
    tasks: { total: 2, done: 2, blocked: 0 }, taskList: [{ id: '1.1', done: true, section: 'Backend' }, { id: '3.1', done: true, section: 'QA' }],
    review: 'APROVADO', reviewRounds: ['APROVADO'], qa: 'APROVADO', waiting: { text: 'indefinido' }, status: 'concluída',
    runs: [run('implementacao', 'backend-dev'), run('revisao', 'code-reviewer'), run('qa', 'qa')],
  }));
  assert.equal(t.current, 'integracao', 'tasks [x] + aprovado, não arquivada: falta integrar');
  assert.equal(states(t), 'ccccpca', 'correção não ocorreu: pendente');
  assert.deepEqual(t.steps[6].agents, [{ agent: 'tech-lead', state: 'wait', runs: 0 }]);
  assert.equal(t.next, null);
}

// arquivada
{
  const t = buildTrail(view({ archived: true, status: 'concluída', waiting: { text: 'nada (arquivada)' }, review: 'APROVADO', reviewRounds: ['APROVADO'], qa: 'APROVADO',
    runs: [run('proposta', 'product-owner'), run('implementacao', 'backend-dev'), run('revisao', 'code-reviewer'), run('qa', 'qa')] }), 'tech-lead');
  assert.equal(states(t), 'ccccpcc');
  assert.equal(t.current, null);
  assert.equal(t.next, null);
  assert.deepEqual(t.steps[6].agents, [{ agent: 'tech-lead', state: 'done', runs: 0 }]);
}

// sem pasta em openspec/ (change só citada nas rodadas): etapa desconhecida, trilha toda pendente
{
  const base = { id: 'connect-x', status: 'concluída', archived: false, unknown: true, waiting: { text: 'indefinido' }, tasks: { total: 0, done: 0, blocked: 0 }, taskList: [], review: null, reviewRounds: [], qa: null };
  const t = buildTrail({ ...base, runs: [run('proposta', 'product-owner'), run('implementacao', 'backend-dev'), run('integracao', 'tech-lead')] });
  assert.equal(t.unknown, true);
  assert.equal(t.current, null);
  assert.equal(t.steps.every((s) => s.state === 'pendente'), true, 'rodadas terminadas não viram "Integração concluída"');
  assert.equal(t.steps.every((s) => s.agents.length === 0), true);
  assert.equal(t.next, null);
  const a = buildTrail({ ...base, status: 'em andamento', runs: [run('revisao', 'code-reviewer', { active: true })] });
  assert.equal(a.steps.every((s) => s.state === 'pendente'), true, 'mesmo com rodada ativa a trilha segue pendente');
  const n = buildTrail({ ...base, runs: [] });
  assert.equal(n.steps.every((s) => s.state === 'pendente'), true, 'sem rodadas: tudo pendente, sem erro');
}
console.log('✓ trilha ok');
