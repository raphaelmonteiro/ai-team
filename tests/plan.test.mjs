// Tests of the session step list and pending question (dashboard/plan.mjs).
//   node tests/plan.test.mjs
import assert from 'node:assert/strict';
import { newPlanState, feedPlan, planView } from '../dashboard/plan.mjs';

const tool = (name, input, id = name) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const prompt = { type: 'user', message: { content: 'next request' } };
const PLAN = 'mcp__ccd_turn__update_plan', WRAP = 'mcp__ccd_turn__wrap_up';
const st = (P) => planView(P).plan.items.map((x) => x.status[0]).join('');

// update_plan: items, advance, done/start
{
  const P = newPlanState();
  feedPlan(P, tool(PLAN, { advance: true }), 1);
  assert.equal(planView(P).plan, null, 'advance without a list does not create one');
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

// wrap_up: completes the in-progress step; ask until the next real prompt; recap stays
{
  const P = newPlanState();
  feedPlan(P, tool(PLAN, { items: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] }), 1);
  feedPlan(P, tool(WRAP, { recap: 'done', ask: 'Shall I commit?', actions: [{ label: 'Yes', message: 'Yes, commit' }, { action: 'create_pr' }] }), 2);
  const v = planView(P);
  assert.equal(st(P), 'cc');
  assert.equal(v.ask.kind, 'wrap_up');
  assert.equal(v.ask.questions[0].question, 'Shall I commit?');
  assert.deepEqual(v.ask.questions[0].options.map((o) => o.label), ['Yes', 'create_pr']);
  assert.equal(v.recap.text, 'done');
  feedPlan(P, result(WRAP), 3);
  assert.ok(planView(P).ask, 'the wrap_up tool_result does not answer the question');
  feedPlan(P, prompt, 4, { isRealPrompt: true });
  assert.equal(planView(P).ask, null, 'a user prompt answers');
  assert.equal(planView(P).recap.text, 'done');
  feedPlan(P, tool(WRAP, { recap: 'recap only' }), 5);
  assert.equal(planView(P).ask, null, 'wrap_up without ask leaves no question');
}

// AskUserQuestion: pending until the tool_result; beats the wrap_up question
{
  const P = newPlanState();
  feedPlan(P, tool(WRAP, { recap: 'x', ask: 'Go on?' }), 1);
  feedPlan(P, tool('AskUserQuestion', { questions: [{ question: 'Which database?', header: 'Database', multiSelect: false, options: [{ label: 'Postgres', description: 'default' }, { label: 'MySQL', description: '' }] }] }, 'q1'), 2);
  let v = planView(P);
  assert.equal(v.ask.kind, 'question');
  assert.equal(v.ask.toolUseId, 'q1');
  assert.deepEqual(v.ask.questions[0].options.map((o) => o.label), ['Postgres', 'MySQL']);
  feedPlan(P, result('q1'), 3);
  v = planView(P);
  assert.equal(v.ask.kind, 'wrap_up', 'answered, the wrap_up one comes back');
}

// a call with an error is undone (session without the app tools)
{
  const P = newPlanState();
  feedPlan(P, tool(PLAN, { items: [{ content: 'a', status: 'in_progress' }] }, 'ok1'), 1);
  feedPlan(P, result('ok1'), 2);
  feedPlan(P, tool(PLAN, { items: [{ content: 'new', status: 'pending' }] }, 'bad'), 3);
  feedPlan(P, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'bad', content: '<tool_use_error>Error: No such tool available: mcp__ccd_turn__update_plan</tool_use_error>' }] } }, 4);
  assert.equal(planView(P).plan.items[0].content, 'a');
  feedPlan(P, tool(WRAP, { recap: 'r', ask: 'x?' }, 'w'), 5);
  feedPlan(P, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'w', is_error: true, content: 'failed' }] } }, 6);
  assert.equal(planView(P).ask, null);
  assert.equal(st(P), 'i', 'wrap_up with an error does not complete the step');
}

// TodoWrite (CLI)
{
  const P = newPlanState();
  feedPlan(P, tool('TodoWrite', { todos: [{ content: 'x', status: 'completed', activeForm: 'X' }, { content: 'y', status: 'in_progress', activeForm: 'Y' }, { content: '', status: 'pending' }] }), 1);
  assert.equal(st(P), 'ci', 'empty item goes');
  assert.equal(planView(P).plan.source, 'TodoWrite');
}

console.log('✓ session plan ok');
