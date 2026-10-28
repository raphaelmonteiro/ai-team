// Testes da lista de etapas e da pergunta pendente da sessão (dashboard/plan.mjs).
//   node tests/plan.test.mjs
import assert from 'node:assert/strict';
import { newPlanState, feedPlan, planView } from '../dashboard/plan.mjs';

const tool = (name, input, id = name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const prompt = { type: 'user', message: { content: 'próximo pedido' } };
const PLAN = 'mcp__ccd_turn__update_plan', WRAP = 'mcp__ccd_turn__wrap_up';
const st = (P) => planView(P).plan.items.map((x) => x.status[0]).join('');

// update_plan: items, advance, done/start
{
  const P = newPlanState();
  feedPlan(P, tool(PLAN, { advance: true }), 1);
  assert.equal(planView(P).plan, null, 'advance sem lista não cria lista');
  feedPlan(P, tool(PLAN, { items: [{ content: 'a', status: 'in_progress' }, { content: 'b', status: 'pending' }, { content: 'c', status: 'pending' }], scope: 'first_task' }), 2);
  assert.equal(st(P), 'ipp');
  feedPlan(P, tool(PLAN, { advance: true }), 3);
  assert.equal(st(P), 'cip');
  assert.equal(planView(P).plan.current, 'b');
  feedPlan(P, tool(PLAN, { done: [2], start: 3 }), 4);
  assert.equal(st(P), 'cci');
  assert.deepEqual([planView(P).plan.done, planView(P).plan.total], [2, 3]);
  assert.equal(planView(P).plan.ts, 4);
}

// wrap_up: conclui a etapa em andamento; ask até o próximo prompt real; recap fica
{
  const P = newPlanState();
  feedPlan(P, tool(PLAN, { items: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] }), 1);
  feedPlan(P, tool(WRAP, { recap: 'feito', ask: 'Faço o commit?', actions: [{ label: 'Sim', message: 'Sim, commita' }, { action: 'create_pr' }] }), 2);
  const v = planView(P);
  assert.equal(st(P), 'cc');
  assert.equal(v.ask.kind, 'wrap_up');
  assert.equal(v.ask.questions[0].question, 'Faço o commit?');
  assert.deepEqual(v.ask.questions[0].options.map((o) => o.label), ['Sim', 'create_pr']);
  assert.equal(v.recap.text, 'feito');
  feedPlan(P, result(WRAP), 3);
  assert.ok(planView(P).ask, 'o tool_result do wrap_up não responde a pergunta');
  feedPlan(P, prompt, 4, { isRealPrompt: true });
  assert.equal(planView(P).ask, null, 'prompt do usuário responde');
  assert.equal(planView(P).recap.text, 'feito');
  feedPlan(P, tool(WRAP, { recap: 'só recap' }), 5);
  assert.equal(planView(P).ask, null, 'wrap_up sem ask não deixa pergunta');
}

// AskUserQuestion: pendente até o tool_result; vence a pergunta do wrap_up
{
  const P = newPlanState();
  feedPlan(P, tool(WRAP, { recap: 'x', ask: 'Segue?' }), 1);
  feedPlan(P, tool('AskUserQuestion', { questions: [{ question: 'Qual banco?', header: 'Banco', multiSelect: false, options: [{ label: 'Postgres', description: 'padrão' }, { label: 'MySQL', description: '' }] }] }, 'q1'), 2);
  let v = planView(P);
  assert.equal(v.ask.kind, 'question');
  assert.equal(v.ask.toolUseId, 'q1');
  assert.deepEqual(v.ask.questions[0].options.map((o) => o.label), ['Postgres', 'MySQL']);
  feedPlan(P, result('q1'), 3);
  v = planView(P);
  assert.equal(v.ask.kind, 'wrap_up', 'respondida, volta a do wrap_up');
}

// chamada com erro é desfeita (sessão sem as ferramentas do app)
{
  const P = newPlanState();
  feedPlan(P, tool(PLAN, { items: [{ content: 'a', status: 'in_progress' }] }, 'ok1'), 1);
  feedPlan(P, result('ok1'), 2);
  feedPlan(P, tool(PLAN, { items: [{ content: 'novo', status: 'pending' }] }, 'bad'), 3);
  feedPlan(P, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'bad', content: '<tool_use_error>Error: No such tool available: mcp__ccd_turn__update_plan</tool_use_error>' }] } }, 4);
  assert.equal(planView(P).plan.items[0].content, 'a');
  feedPlan(P, tool(WRAP, { recap: 'r', ask: 'x?' }, 'w'), 5);
  feedPlan(P, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w', is_error: true, content: 'falhou' }] } }, 6);
  assert.equal(planView(P).ask, null);
  assert.equal(st(P), 'i', 'wrap_up com erro não conclui a etapa');
}

// TodoWrite (CLI)
{
  const P = newPlanState();
  feedPlan(P, tool('TodoWrite', { todos: [{ content: 'x', status: 'completed', activeForm: 'X' }, { content: 'y', status: 'in_progress', activeForm: 'Y' }, { content: '', status: 'pending' }] }), 1);
  assert.equal(st(P), 'ci', 'item vazio sai');
  assert.equal(planView(P).plan.source, 'TodoWrite');
}

console.log('✓ plano da sessão ok');
