// Lógica pura da conversa do drawer da change (sem DOM): montagem do feed, cor do veredito,
// filtro por agente e dados do cartão de presença. Servido em /feed.mjs e importado pelo index.html.

export const FLOW_LABEL = { proposta: 'Proposta', implementacao: 'Implementação', revisao: 'Revisão', correcao: 'Correção', qa: 'QA', integracao: 'Integração' };
const ROLE = { proposta: 'proposta', implementacao: 'implementação', revisao: 'revisão', correcao: 'correção', qa: 'QA', integracao: 'integração' };

// Cor do veredito: 'bad' vence 'ok' (MUDANÇAS PEDIDAS / REPROVADO / NÃO APROVADO); null se não houver.
const VERDICT = /(REPROVAD[OA]|MUDAN[ÇC]AS PEDIDAS|N[ÃA]O APROVAD[OA]|APROVAD[OA])/gi;
export function verdictClass(text) {
  const hits = [...String(text || '').matchAll(VERDICT)].map((m) => m[1]);
  if (!hits.length) return null;
  return hits.some((h) => !/^APROVAD/i.test(h)) ? 'bad' : 'ok';
}
// Partes do texto com a classe de cada palavra de veredito: [{ text, cls }]
export function verdictParts(text) {
  const s = String(text || ''), out = [];
  let last = 0;
  for (const m of s.matchAll(VERDICT)) {
    if (m.index > last) out.push({ text: s.slice(last, m.index), cls: null });
    out.push({ text: m[1], cls: /^APROVAD/i.test(m[1]) ? 'ok' : 'bad' });
    last = m.index + m[1].length;
  }
  if (last < s.length) out.push({ text: s.slice(last), cls: null });
  return out;
}

// Filtro por agente: sem filtro devolve todas.
export function filterRuns(runs, who) {
  return who ? (runs || []).filter((r) => r.agent === who) : (runs || []);
}

// Presença de uma rodada: 'on' (ativa) ou 'done'.
export const presenceOf = (r) => (r.active ? 'on' : 'done');

// Mensagem do feed: todos os campos que a tabela de rodadas mostra, mais o detalhe recolhido.
export function messageOf(r) {
  const u = r.usage || {};
  return {
    id: r.id, agent: r.agent, change: r.change || null, background: !!r.background,
    status: r.status || (r.active ? 'ativo' : 'terminou'), active: !!r.active, presence: presenceOf(r),
    from: r.from || '?', to: r.to || null,
    start: r.start || null, end: r.active ? null : (r.end || null),
    durationMs: r.durationMs || 0, model: r.model || '?',
    fresh: (r.tokenSplit && r.tokenSplit.fresh) || 0, cached: (r.tokenSplit && r.tokenSplit.cached) || 0,
    usage: { input: u.input || 0, output: u.output || 0, cacheCreation: u.cacheCreation || 0, requests: u.requests || 0 },
    toolUses: r.toolUses || 0,
    description: r.description || '', summary: r.summary || '', summaryParts: verdictParts(r.summary), verdict: verdictClass(r.summary),
    promptPreview: r.promptPreview || '', totalTokensReported: r.totalTokensReported == null ? null : r.totalTokensReported,
    flow: r.flow || null, task: r.task || null, taskSection: r.taskSection || null,
  };
}

// Feed em ordem de chat (mais antiga em cima). Separadores = etapa (flow) quando muda; sem separadores com filtro.
export function buildFeed(runs, { filter = null } = {}) {
  const list = filterRuns(runs, filter).slice().sort((a, b) => (a.start || 0) - (b.start || 0));
  const items = [];
  let prev;
  for (const r of list) {
    if (!filter && (prev === undefined || r.flow !== prev)) {
      items.push({ type: 'sep', flow: r.flow || null, label: FLOW_LABEL[r.flow] || 'Outras rodadas', active: false });
    }
    prev = r.flow;
    items.push({ type: 'msg', ...messageOf(r) });
  }
  // a última separação que contém rodada ativa fica marcada ("agora")
  for (let i = items.length - 1, hasActive = false; i >= 0; i--) {
    if (items[i].type === 'msg' && items[i].active) hasActive = true;
    if (items[i].type === 'sep') { items[i].active = hasActive; hasActive = false; }
  }
  return items;
}

// Dados do cartão de presença de um agente numa change.
// c: visão da change { runs, trail }; opts: { mainAgent, mainLive }
export function cardData(c, name, opts = {}) {
  const { mainAgent = 'tech-lead', mainLive = false } = opts;
  const runs = (c.runs || []).filter((r) => r.agent === name).sort((a, b) => (a.start || 0) - (b.start || 0));
  const active = runs.filter((r) => r.active).pop();
  const last = runs[runs.length - 1] || null;
  const steps = (c.trail && c.trail.steps) || [];
  const inQueue = steps.some((s) => s.agents.some((a) => a.agent === name && a.state === 'wait'));
  const presence = active || (name === mainAgent && mainLive) ? 'on' : inQueue ? 'wait' : 'done';
  const sum = (k) => runs.reduce((s, r) => s + ((r.tokenSplit && r.tokenSplit[k]) || 0), 0);
  const withReturn = runs.filter((r) => r.summary).pop() || null;
  const reviewRun = [...runs].reverse().find((r) => (r.flow === 'revisao' || r.flow === 'qa') && verdictClass(r.summary));
  const flows = [...new Set(runs.map((r) => r.flow).filter(Boolean))];
  let role = flows.map((f) => ROLE[f]).join(' · ');
  if (name === 'voce') role = 'aprova e decide';
  else if (name === mainAgent) role = 'coordena as etapas';
  else if (!role) role = 'agente';
  const ref = active || last;
  return {
    name, role, model: (ref && ref.model) || null, presence,
    since: active ? active.start : null, endAt: !active && last ? last.end || null : null,
    verdict: reviewRun ? verdictClass(reviewRun.summary) : null,
    verdictText: reviewRun ? (verdictParts(reviewRun.summary).find((p) => p.cls) || {}).text || null : null,
    what: ref ? ref.description || '' : (name === 'voce' ? 'aprova a proposta e decide pendências' : ''),
    lastReturn: withReturn ? withReturn.summary : '',
    rounds: name === mainAgent ? ((c.trail && c.trail.delegations) || 0) : runs.length,
    fresh: sum('fresh'), cached: sum('cached'),
    isMain: name === mainAgent,
  };
}
