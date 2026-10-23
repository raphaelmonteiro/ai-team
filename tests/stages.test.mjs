// Testes do mapeamento "esperando" -> etapa do fluxo (/equipe).
//   node tests/stages.test.mjs
import assert from 'node:assert/strict';
import { stageOf, stageCounts } from '../dashboard/stages.mjs';

const v = (text, extra = {}) => ({ id: 'c', status: 'em andamento', archived: false, waiting: { text }, ...extra });

assert.equal(stageOf(v('esperando o desenvolvedor')), 'voce');
assert.equal(stageOf(v('esperando executar a task 0.1 (Infra)')), 'devs');
assert.equal(stageOf(v('esperando executar a task 1.2 (Backend)')), 'devs');
assert.equal(stageOf(v('esperando executar a task 2.1 (Frontend)')), 'devs');
assert.equal(stageOf(v('esperando executar a task 3.2 (QA)')), 'qa');
assert.equal(stageOf(v('esperando executar a task 4.2 (Processo)')), 'po');
assert.equal(stageOf(v('esperando executar a task 5.1 (Documentação)')), 'po');
assert.equal(stageOf(v('esperando executar a task (sem número)')), 'devs');
assert.equal(stageOf(v('esperando a task 1.1, 1.2')), 'devs');
assert.equal(stageOf(v('esperando correção')), 'correcao');
assert.equal(stageOf(v('esperando revisão')), 'revisao');
assert.equal(stageOf(v('indefinido', { status: 'concluída' })), 'integra');
assert.equal(stageOf(v('indefinido')), 'indefinido');
assert.equal(stageOf(v('esperando coisa nova')), 'indefinido');
// fora do fluxo
assert.equal(stageOf(v('nada (arquivada)', { archived: true, status: 'concluída' })), null);
assert.equal(stageOf({ id: 'x', status: 'avulsa', waiting: null }), null);
assert.equal(stageOf(null), null);

const r = stageCounts([
  v('esperando executar a task 1.1 (Backend)', { id: 'a' }),
  v('esperando executar a task 0.1 (Infra)', { id: 'b' }),
  v('indefinido', { id: 'c' }),
  v('esperando o desenvolvedor', { id: 'd' }),
  { id: 'e', status: 'avulsa', waiting: null },
]);
assert.deepEqual(r.changes.devs, ['a', 'b']);
assert.equal(r.counts.devs, 2);
assert.equal(r.counts.indefinido, 1);
assert.equal(r.counts.voce, 1);
assert.equal(r.counts.qa, 0);
console.log('etapas ok');
