// Testes da conversa do drawer: ordem, separadores, campos, cor do veredito, filtro e cartão.
//   node tests/feed.test.mjs
import assert from 'node:assert/strict';
import { buildFeed, messageOf, verdictClass, verdictParts, filterRuns, cardData, routeOf } from '../dashboard/feed.mjs';

// --- cor do veredito -----------------------------------------------------------
assert.equal(verdictClass('APROVADO; 0 bloqueantes'), 'ok');
assert.equal(verdictClass('REPROVADO: 2 bloqueantes'), 'bad');
assert.equal(verdictClass('MUDANÇAS PEDIDAS em 3 pontos'), 'bad');
assert.equal(verdictClass('mudancas pedidas'), 'bad', 'sem acento e minúsculas');
assert.equal(verdictClass('NÃO APROVADO'), 'bad', '"não aprovado" não é verde');
assert.equal(verdictClass('antes MUDANÇAS PEDIDAS, depois APROVADO'), 'bad', 'vermelho vence verde');
assert.equal(verdictClass('fix aplicado, gate verde'), null);
assert.equal(verdictClass(''), null);
assert.equal(verdictClass(null), null);
assert.deepEqual(verdictParts('Veredito: APROVADO com 2 sugestões'), [{ text: 'Veredito: ', cls: null }, { text: 'APROVADO', cls: 'ok' }, { text: ' com 2 sugestões', cls: null }]);
assert.deepEqual(verdictParts('REPROVADO'), [{ text: 'REPROVADO', cls: 'bad' }]);
assert.deepEqual(verdictParts('sem veredito'), [{ text: 'sem veredito', cls: null }]);

// --- feed ---------------------------------------------------------------------
const mk = (id, agent, flow, start, extra = {}) => ({ id, agent, flow, start, end: start + 1000, active: false, from: 'orchestrator', to: 'orchestrator', status: 'terminou',
  durationMs: 1000, model: 'sonnet', description: 'faz ' + id, summary: 'ok ' + id, promptPreview: 'prompt ' + id, toolUses: 3, background: false,
  usage: { input: 10, output: 5, cacheCreation: 2, requests: 4 }, tokenSplit: { fresh: 17, cached: 900 }, totalTokensReported: null, change: 'c', ...extra });
const runs = [
  mk('d', 'reviewer', 'review', 400, { summary: 'MUDANÇAS PEDIDAS' }),
  mk('a', 'spec-writer', 'spec', 100),
  mk('b', 'builder', 'build', 200),
  mk('c', 'provisioner', 'build', 300),
  mk('e', 'builder', 'fix', 500, { active: true, end: null, to: null }),
];
{
  const f = buildFeed(runs);
  assert.deepEqual(f.map((i) => (i.type === 'sep' ? '#' + i.label : i.id)), ['#Spec', 'a', '#Build', 'b', 'c', '#Review', 'd', '#Fix', 'e'], 'mais antiga em cima; separador só quando a etapa muda');
  assert.equal(f.at(-2).active, true, 'separador da etapa com rodada ativa');
  assert.equal(f[0].active, false);
  assert.equal(f.find((i) => i.id === 'd').verdict, 'bad');
  assert.equal(f.find((i) => i.id === 'a').verdict, null);
  assert.equal(runs[0].id, 'd', 'não altera a lista original');
  const sem = buildFeed([mk('x', 'validator', null, 1)]);
  assert.equal(sem[0].label, 'Outras rodadas', 'rodada sem etapa');
}

// --- filtro --------------------------------------------------------------------
{
  assert.equal(filterRuns(runs, null).length, 5);
  assert.deepEqual(filterRuns(runs, 'builder').map((r) => r.id), ['b', 'e']);
  assert.deepEqual(filterRuns(runs, 'voce'), []);
  const f = buildFeed(runs, { filter: 'builder' });
  assert.deepEqual(f.map((i) => i.id), ['b', 'e'], 'filtrado: só mensagens, sem separadores');
  assert.equal(buildFeed(runs, { filter: null }).length, 9, 'limpar o filtro volta ao feed completo');
}

// --- nenhum campo da tabela de rodadas se perde ----------------------------------
{
  const m = messageOf(mk('z', 'validator', 'validation', 5, { background: true, status: 'falhou', totalTokensReported: 1234 }));
  const tabela = {            // coluna/detalhe da runsTable -> campo da mensagem
    agente: 'agent', 'status (bolinha)': 'status', segundo_plano: 'background', change: 'change', de: 'from', para: 'to',
    inicio: 'start', fim: 'end', duracao: 'durationMs', novos: 'fresh', 'cache lido': 'cached', 'entrada/saída/cache gravado/chamadas': 'usage',
    ferramentas: 'toolUses', modelo: 'model', 'o quê': 'description', retorno: 'summary', prompt: 'promptPreview', 'tokens reportados': 'totalTokensReported',
  };
  for (const [col, key] of Object.entries(tabela)) assert.ok(key in m, `campo da tabela "${col}" ausente na mensagem (${key})`);
  assert.equal(m.background, true); assert.equal(m.status, 'falhou'); assert.equal(m.totalTokensReported, 1234);
  assert.deepEqual(m.usage, { input: 10, output: 5, cacheCreation: 2, requests: 4 });
  assert.equal(m.fresh, 17); assert.equal(m.cached, 900); assert.equal(m.toolUses, 3); assert.equal(m.model, 'sonnet');
  const ativa = messageOf(mk('y', 'validator', 'validation', 5, { active: true, end: 99, to: null }));
  assert.equal(ativa.end, null, 'rodada ativa não tem fim'); assert.equal(ativa.to, null); assert.equal(ativa.presence, 'on');
}

// --- cartão ----------------------------------------------------------------------
{
  const c = { runs, trail: { delegations: 5, steps: [{ agents: [{ agent: 'validator', state: 'wait', runs: 0 }, { agent: 'voce', state: 'done', runs: 0 }] }] } };
  const be = cardData(c, 'builder');
  assert.equal(be.presence, 'on'); assert.equal(be.since, 500); assert.equal(be.rounds, 2); assert.equal(be.fresh, 34); assert.equal(be.cached, 1800);
  assert.equal(be.role, 'build · fix'); assert.equal(be.what, 'faz e'); assert.equal(be.lastReturn, 'ok e');
  const cr = cardData(c, 'reviewer');
  assert.equal(cr.presence, 'done'); assert.equal(cr.endAt, 1400); assert.equal(cr.verdict, 'bad'); assert.equal(cr.verdictText, 'MUDANÇAS PEDIDAS');
  assert.equal(cardData(c, 'validator').presence, 'wait', 'na fila');
  assert.equal(cardData(c, 'voce').presence, 'done');
  const tl = cardData(c, 'orchestrator', { mainLive: true });
  assert.equal(tl.presence, 'on'); assert.equal(tl.rounds, 5); assert.equal(tl.isMain, true);
}
// --- rótulo "chamado por" e vizinhança ----------------------------------------------
{
  const r = (from, to) => ({ from, to });
  assert.deepEqual(routeOf(r('orchestrator', 'spec-writer')), { by: 'orchestrator', around: 'depois: spec-writer' }, 'o agente nunca "devolve" ao seguinte');
  assert.deepEqual(routeOf(r('validator', 'provisioner')), { by: 'validator', around: 'antes: validator · depois: provisioner' });
  assert.deepEqual(routeOf(r('orchestrator', 'orchestrator')), { by: 'orchestrator', around: '' }, 'sem anterior nem seguinte: sem linha secundária');
  assert.deepEqual(routeOf(r('orchestrator', null)), { by: 'orchestrator', around: '' }, 'ativa sem seguinte');
  assert.equal(routeOf(r('builder', null)).around, 'antes: builder');
  assert.equal(routeOf(r('x', 'y'), 'x').around, 'depois: y', 'orquestrador configurável');
  const m = messageOf({ ...mk('q', 'validator', 'validation', 5), from: 'reviewer', to: 'orchestrator' });
  assert.deepEqual(m.route, { by: 'reviewer', around: 'antes: reviewer' });
  const card = cardData({ runs: [{ ...mk('q', 'validator', 'validation', 5), from: 'orchestrator', to: 'provisioner' }], trail: { steps: [] } }, 'validator');
  assert.deepEqual(card.route, { by: 'orchestrator', around: 'depois: provisioner' });
}
console.log('✓ conversa ok');
