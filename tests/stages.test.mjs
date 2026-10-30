// Testes do mapeamento "esperando" -> etapa do fluxo (/equipe).
//   node tests/stages.test.mjs
import assert from 'node:assert/strict';
import { stageOf, stageCounts } from '../dashboard/stages.mjs';

const v = (text, extra = {}) => ({ id: 'c', status: 'em andamento', archived: false, waiting: { text }, ...extra });

assert.equal(stageOf(v('esperando o desenvolvedor')), 'you');
assert.equal(stageOf(v('esperando executar a task 0.1 (Infra)')), 'build');
assert.equal(stageOf(v('esperando executar a task 1.2 (Backend)')), 'build');
assert.equal(stageOf(v('esperando executar a task 2.1 (Frontend)')), 'build');
assert.equal(stageOf(v('esperando executar a task 3.2 (Validação)')), 'validation');
assert.equal(stageOf(v('esperando executar a task 4.2 (Processo)')), 'spec');
assert.equal(stageOf(v('esperando executar a task 5.1 (Documentação)')), 'spec');
assert.equal(stageOf(v('esperando executar a task (sem número)')), 'build');
assert.equal(stageOf(v('esperando a task 1.1, 1.2')), 'build');
assert.equal(stageOf(v('esperando correção')), 'fix');
assert.equal(stageOf(v('esperando revisão')), 'review');
assert.equal(stageOf(v('indefinido', { status: 'concluída' })), 'integration');
assert.equal(stageOf(v('indefinido')), 'unknown');
assert.equal(stageOf(v('esperando coisa nova')), 'unknown');
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
assert.deepEqual(r.changes.build, ['a', 'b']);
assert.equal(r.counts.build, 2);
assert.equal(r.counts.unknown, 1);
assert.equal(r.counts.you, 1);
assert.equal(r.counts.validation, 0);
console.log('etapas ok');
