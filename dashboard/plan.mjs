// Lista de etapas e pergunta pendente de uma sessão, lidas do transcript (sem hook).
//   mcp__ccd_turn__update_plan  lista do app desktop: { items } troca a lista; { advance } conclui a
//                               etapa em andamento e começa a próxima; { done: [n], start: n } (1-based)
//   mcp__ccd_turn__wrap_up      fim do turno: conclui a etapa em andamento; { recap, ask, actions }
//   TodoWrite                   lista do CLI: { todos: [{ content, status, activeForm }] }
//   AskUserQuestion             pergunta com opções; pendente até o tool_result
// A pergunta do wrap_up vale até o próximo prompt real do usuário. Chamada que volta com erro
// (ex.: "No such tool available" numa sessão sem as ferramentas do app) é desfeita.

const PLAN_TOOL = /(^|__)update_plan$/;
const WRAP_TOOL = /(^|__)wrap_up$/;
const STATUS = new Set(['pending', 'in_progress', 'completed']);

import fs from 'node:fs';

// prompt de verdade do usuário (não tool_result, nem notificação de tarefa, nem lembrete do sistema)
const textOf = (m) => { const c = m && m.content; return typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n') : ''; };
export function isRealPrompt(rec) {
  if (rec.type !== 'user' || rec.isMeta) return false;
  const c = rec.message && rec.message.content;
  if (typeof c === 'string') return !c.startsWith('<task-notification>') && !c.startsWith('<system-reminder>');
  if (!Array.isArray(c)) return false;
  if (c.some((b) => b.type === 'tool_result')) return false;
  const t = textOf(rec.message);
  return t.length > 0 && !t.startsWith('<task-notification>');
}

export const newPlanState = () => ({ plan: null, ask: null, recap: null, questions: new Map(), undo: new Map() });
const snap = (P) => ({ plan: P.plan && { ...P.plan, items: P.plan.items.map((x) => ({ ...x })) }, ask: P.ask, recap: P.recap });
const isError = (b) => b.is_error === true || /^\s*<tool_use_error>/.test(typeof b.content === 'string' ? b.content : JSON.stringify(b.content || ''));

const items = (list) => (Array.isArray(list) ? list : [])
  .map((x) => ({ content: String((x && (x.content || x.subject)) || '').slice(0, 200), status: STATUS.has(x && x.status) ? x.status : 'pending' }))
  .filter((x) => x.content);

function applyPlan(P, input, t) {
  if (Array.isArray(input.items)) { P.plan = { items: items(input.items), ts: t, source: 'update_plan' }; return; }
  if (!P.plan) return;
  const L = P.plan.items;
  if (input.advance) {
    const i = L.findIndex((x) => x.status === 'in_progress');
    if (i >= 0) L[i].status = 'completed';
    const n = L.findIndex((x, k) => k > i && x.status === 'pending');
    if (n >= 0) L[n].status = 'in_progress';
  }
  for (const d of Array.isArray(input.done) ? input.done : []) if (L[d - 1]) L[d - 1].status = 'completed';
  if (Number.isInteger(input.start) && L[input.start - 1]) {
    for (const x of L) if (x.status === 'in_progress') x.status = 'completed';
    L[input.start - 1].status = 'in_progress';
  }
  P.plan.ts = t;
}

// rec: registro do transcript já parseado; t: timestamp (ms) do registro
export function feedPlan(P, rec, t, { isRealPrompt = false } = {}) {
  const c = rec && rec.message && rec.message.content;
  if (rec.type === 'assistant' && Array.isArray(c)) {
    for (const b of c) {
      if (!b || b.type !== 'tool_use') continue;
      const input = b.input || {};
      if (PLAN_TOOL.test(b.name) || WRAP_TOOL.test(b.name) || b.name === 'TodoWrite') {
        P.undo.set(b.id, snap(P));
        if (P.undo.size > 20) P.undo.delete(P.undo.keys().next().value);
      }
      if (PLAN_TOOL.test(b.name)) applyPlan(P, input, t);
      else if (b.name === 'TodoWrite' && Array.isArray(input.todos)) P.plan = { items: items(input.todos), ts: t, source: 'TodoWrite' };
      else if (WRAP_TOOL.test(b.name)) {
        if (P.plan) for (const x of P.plan.items) if (x.status === 'in_progress') x.status = 'completed';
        P.recap = input.recap ? { text: String(input.recap).slice(0, 600), ts: t } : P.recap;
        P.ask = input.ask ? { kind: 'wrap_up', ts: t, questions: [{ question: String(input.ask).slice(0, 300),
          options: (Array.isArray(input.actions) ? input.actions : []).map((a) => ({ label: String((a && (a.label || a.action)) || ''), description: String((a && a.message) || '') })).filter((o) => o.label) }] } : null;
      } else if (b.name === 'AskUserQuestion' && Array.isArray(input.questions)) {
        P.questions.set(b.id, { kind: 'question', ts: t, toolUseId: b.id, questions: input.questions.map((q) => ({
          question: String(q.question || ''), header: q.header || '', multiSelect: !!q.multiSelect,
          options: (q.options || []).map((o) => ({ label: String(o.label || ''), description: String(o.description || '') })) })) });
      }
    }
  }
  if (rec.type === 'user' && Array.isArray(c)) for (const b of c) {
    if (!b || b.type !== 'tool_result') continue;
    P.questions.delete(b.tool_use_id);
    const u = P.undo.get(b.tool_use_id);
    if (u) { P.undo.delete(b.tool_use_id); if (isError(b)) Object.assign(P, u); }
  }
  if (isRealPrompt) { P.ask = null; P.questions.clear(); }
}

// o que vai para o /api/state: pergunta com opções vence a do wrap_up
export function planView(P) {
  const q = [...P.questions.values()].pop() || null;
  const plan = P.plan && P.plan.items.length ? { ...P.plan, items: P.plan.items.map((x) => ({ ...x })),
    done: P.plan.items.filter((x) => x.status === 'completed').length, total: P.plan.items.length,
    current: (P.plan.items.find((x) => x.status === 'in_progress') || {}).content || null } : null;
  return { plan, ask: q || P.ask, recap: P.recap };
}

// pergunta pendente no fim do transcript (usada pelos hooks Stop: notificação e modo longe)
export function lastAsk(file, maxBytes = 2 * 1024 * 1024) {
  let text = '';
  try {
    const st = fs.statSync(file), len = Math.min(st.size, maxBytes), fd = fs.openSync(file, 'r'), buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd); text = buf.toString('utf8');
  } catch { return null; }
  const P = newPlanState();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    feedPlan(P, r, Date.parse(r.timestamp || 0) || 0, { isRealPrompt: isRealPrompt(r) });
  }
  return planView(P).ask;
}
