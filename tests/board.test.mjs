// Testes do quadro de changes: heurística do "esperando", separação em
// andamento/pendentes/concluídas (top 3), etapa inferida e leitura do openspec.
//   node tests/board.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseTasks, waitingFor, splitChanges, inferStage, changeFiles, resolveChangeFile, parseChangePath } from '../dashboard/board.mjs';
import { collect } from '../dashboard/collect.mjs';

const wait = (tasksMd, extra = {}) => {
  const p = parseTasks(tasksMd);
  return waitingFor({ archived: false, header: p.header, taskList: p.tasks, review: null, qa: null, ...extra });
};

// --- "esperando o quê" ----------------------------------------------------------
{
  const head = (h) => `# Tasks: x\n\n${h}\n\n## 1. Backend (backend-dev)\n\n- [ ] 1.1 algo\n`;
  for (const h of ['> **PROPOSTA revisada, aguardando aprovação do desenvolvedor.**', '> RASCUNHO, ainda não vigente', '> proposta aguarda leitura prévia do backend']) {
    const w = wait(head(h));
    assert.equal(w.text, 'esperando o desenvolvedor', h);
    assert.match(w.rule, /cabeçalho/);
  }
  assert.notEqual(wait(head('> **APROVADA pelo desenvolvedor em 20/10/2026.**')).text, 'esperando o desenvolvedor', 'APROVADA não dispara');
  // menção a "aguarda" fora do cabeçalho (nas tasks) não dispara
  assert.notEqual(wait(`# T\n\n## 1. Backend\n- [ ] 1.1 x <!-- feito: aguarda aprovação -->\n`).text, 'esperando o desenvolvedor');

  // revisão com MUDANÇAS PEDIDAS na última rodada
  const allDone = `## 1. Backend\n- [x] 1.1 a\n- [x] 1.2 b\n`;
  let w = wait(allDone, { review: 'MUDANÇAS PEDIDAS' });
  assert.equal(w.text, 'esperando correção');
  assert.match(w.rule, /MUDANÇAS PEDIDAS/);
  // header vence a revisão (ordem das regras)
  assert.equal(wait(`> aguardando aprovação\n\n${allDone}`, { review: 'MUDANÇAS PEDIDAS' }).text, 'esperando o desenvolvedor');

  // tudo [x], sem revisão
  w = wait(allDone);
  assert.equal(w.text, 'esperando revisão');
  // tudo [x] com revisão aprovada: a heurística não sabe o que falta
  w = wait(allDone, { review: 'APROVADO' });
  assert.equal(w.text, 'indefinido');
  assert.match(w.rule, /QA ou arquivamento/);
  assert.equal(wait(allDone, { review: 'talvez' }).text, 'indefinido', 'resultado não reconhecido');

  // dependências
  const deps = `## 0. Infra (devops)\n- [ ] 0.1 fixtures <!-- depende de: 1.2 -->\n## 1. Backend (backend-dev)\n- [x] 1.1 a <!-- depende de: — -->\n- [ ] 1.2 b <!-- depende de: 1.1 -->\n- [ ] 1.3 c <!-- depende de: 1.2 -->\n`;
  w = wait(deps);
  assert.equal(w.text, 'esperando executar a task 1.2 (Backend)', 'a liberada vence a 0.1, que vem antes no arquivo mas depende da 1.2');
  assert.match(w.rule, /dependências/);
  const stuck = `## 1. Backend\n- [ ] 1.2 b <!-- depende de: 1.1 -->\n- [ ] 1.1 a <!-- depende de: 1.2 -->\n`;
  w = wait(stuck);
  assert.equal(w.text, 'esperando a task 1.1');
  assert.match(w.rule, /nenhuma task \[ \] está liberada/);
  const multi = `## 1. Backend\n- [ ] 1.1 a <!-- depende de: 1.2, 1.3 -->\n- [ ] 1.2 b <!-- depende de: 1.3 -->\n- [ ] 1.3 c <!-- depende de: 1.1 -->\n`;
  assert.equal(wait(multi).text, 'esperando a task 1.2, 1.3');

  // indefinido: dependência que não é task desta change, id inexistente, bloqueada, sem tasks
  w = wait(`## 1. Backend\n- [ ] 1.1 a <!-- depende de: add-outra-change -->\n`);
  assert.equal(w.text, 'indefinido'); assert.match(w.rule, /não é task desta change/);
  assert.equal(wait(`## 1. Backend\n- [ ] 1.1 a <!-- depende de: 9.9 -->\n`).text, 'indefinido', 'id que não existe');
  w = wait(`## 1. Backend\n- [ ] 1.1 a (bloqueada: D-12)\n`);
  assert.equal(w.text, 'indefinido'); assert.match(w.rule, /bloqueada/);
  assert.equal(wait('# só texto\n').text, 'indefinido');
  assert.equal(waitingFor({ archived: true, taskList: [], header: '', review: null }).text, 'nada (arquivada)');
}

// --- parseTasks -------------------------------------------------------------------
{
  const p = parseTasks(`# T\n> cab\n\n## 0. Infra (devops)\n- [x] 0.1 a <!-- depende de: — -->\n* [ ] 0.2b b <!-- depende de: 0.1, 1.1 -->\n- [ ] sem número\n`);
  assert.equal(p.header.includes('> cab'), true);
  assert.deepEqual(p.tasks.map((t) => [t.id, t.done, t.section]), [['0.1', true, 'Infra (devops)'], ['0.2b', false, 'Infra (devops)'], [null, false, 'Infra (devops)']]);
  assert.deepEqual(p.tasks[1].deps, { ids: ['0.1', '1.1'], unknown: false });
  assert.deepEqual(p.tasks[0].deps, { ids: [], unknown: false });
}

// --- separação ------------------------------------------------------------------------
{
  const mk = (id, status, t) => ({ id, status, lastActivity: t, completedAt: t });
  const list = [mk('a', 'concluída', 5), mk('b', 'em andamento', 1), mk('c', 'pendente', 2), mk('d', 'concluída', 9), mk('e', 'concluída', 7),
    mk('f', 'concluída', 1), mk('g', 'bloqueada', 3), mk('h', 'em andamento', 4), mk('i', 'concluída', 8), mk('(sem change)', 'avulsa', 0)];
  const s = splitChanges(list);
  assert.deepEqual(s.running.map((c) => c.id), ['h', 'b']);
  assert.deepEqual(s.pending.map((c) => c.id), ['c']);
  assert.deepEqual(s.blocked.map((c) => c.id), ['g']);
  assert.deepEqual(s.done.map((c) => c.id), ['d', 'i', 'e'], '3 últimas concluídas, mais recentes primeiro');
  assert.deepEqual(s.doneOlder.map((c) => c.id), ['a', 'f']);
  assert.equal(s.other.length, 1);
  assert.equal(splitChanges([mk('x', 'concluída', 1)]).doneOlder.length, 0);
}

// --- etapa inferida ----------------------------------------------------------------------
assert.equal(inferStage('backend-dev', 'seção 1', 'Implemente a seção 1. Backend de openspec/changes/x/tasks.md'), 'seção 1 (Backend)');
assert.equal(inferStage('devops', '', 'Faça a task 0.3 e a 0.4'), 'task 0.3');
assert.equal(inferStage('code-reviewer', 'rodada 2', 'Revise os commits'), 'revisão');
assert.equal(inferStage('qa', '', 'Valide'), 'QA');
assert.equal(inferStage('product-owner', 'arquivar change', 'Arquive a change'), 'arquivamento');
assert.equal(inferStage('product-owner', 'criar proposta', 'Escreva a proposta'), 'proposta');
assert.equal(inferStage('general-purpose', 'pesquisar', 'Procure um arquivo'), null, 'sem pista: null, não palpite');

// --- coleta sobre um openspec de exemplo ---------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-board-'));
try {
  const proj = path.join(tmp, 'proj');
  const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
  const ch = (id, tasks, extra = {}) => { w(path.join(proj, 'openspec/changes', id, 'tasks.md'), tasks); for (const [f, s] of Object.entries(extra)) w(path.join(proj, 'openspec/changes', id, f), s); };
  ch('rascunho', `# T\n\n> RASCUNHO\n\n## 1. Backend\n- [ ] 1.1 a\n`);
  ch('corrigir', `## 1. Backend\n- [x] 1.1 a\n`, { 'review-report.md': '## Rodada 1\nResultado: MUDANÇAS PEDIDAS\n' });
  ch('revisar', `## 1. Backend\n- [x] 1.1 a\n- [x] 1.2 b\n`);
  ch('meio', `## 1. Backend\n- [x] 1.1 a\n- [ ] 1.2 b <!-- depende de: 1.1 -->\n`);
  ch('travada', `## 1. Backend\n- [ ] 1.1 a (bloqueada: D-1)\n`);
  ch('pronta', `## 1. Backend\n- [x] 1.1 a\n- [x] 1.2 b\n`, { 'review-report.md': 'Resultado: APROVADO\n', 'qa-report.md': 'Resultado: APROVADO\n', 'design.md': 'd', 'specs/a/spec.md': 's', 'notas.txt': 'n' });
  for (const [d, id] of [['2026-10-01', 'velha-1'], ['2026-10-05', 'velha-2'], ['2026-10-03', 'velha-3'], ['2026-10-09', 'velha-4'], ['2026-10-07', 'velha-5']]) {
    w(path.join(proj, 'openspec/changes/archive', `${d}-${id}`, 'tasks.md'), `## 1. Backend\n- [x] 1.1 a\n`);
  }
  const st = collect({ projectDir: proj, claudeDir: path.join(tmp, 'sem-claude') });
  const by = Object.fromEntries(st.changes.map((c) => [c.id, c]));
  assert.equal(by['rascunho'].waiting.text, 'esperando o desenvolvedor');
  assert.equal(by['corrigir'].waiting.text, 'esperando correção');
  assert.equal(by['revisar'].waiting.text, 'esperando revisão');
  assert.equal(by['meio'].waiting.text, 'esperando executar a task 1.2 (Backend)');
  assert.equal(by['travada'].waiting.text, 'indefinido');
  assert.equal(by['travada'].status, 'bloqueada');
  assert.equal(by['pronta'].status, 'concluída', 'tasks [x] + revisão APROVADO');
  assert.equal(by['revisar'].status, 'em andamento', 'tasks [x] sem revisão ainda não é concluída');
  assert.equal(by['rascunho'].status, 'pendente');
  assert.deepEqual(st.board.pending, ['rascunho']);
  assert.deepEqual(st.board.running.sort(), ['corrigir', 'meio', 'revisar']);
  assert.deepEqual(st.board.done, ['pronta', 'velha-4', 'velha-5'], 'top 3: a recém-concluída e as de archive mais novo');
  assert.deepEqual(st.board.doneOlder, ['velha-2', 'velha-3', 'velha-1'], 'as demais, recolhidas');
  assert.ok(by['velha-1'].archived && by['velha-1'].waiting.text === 'nada (arquivada)');
  // início: sem execução de agente, vem da pasta (ou do archive)
  assert.equal(by['meio'].startSource, 'criação da pasta');
  assert.ok(by['meio'].startedAt > 0);
  assert.equal(by['velha-2'].startedAt != null, true);
  // arquivos .md: ordem fixa, specs/**, só .md
  assert.deepEqual(by['pronta'].files, ['design.md', 'tasks.md', 'review-report.md', 'qa-report.md', 'specs/a/spec.md']);
  assert.deepEqual(changeFiles(path.join(proj, 'openspec/changes/pronta')), by['pronta'].files);

  // seções
  assert.deepEqual(by['meio'].sections, { Backend: { total: 2, done: 1 } });

  // resolveChangeFile
  const ok = (id, segs) => resolveChangeFile(proj, id, segs);
  assert.ok(ok('pronta', ['tasks.md']));
  assert.ok(ok('pronta', ['specs', 'a', 'spec.md']));
  assert.ok(ok('velha-2', ['tasks.md']), 'change arquivada');
  for (const [id, segs] of [['pronta', ['..', '..', 'x.md']], ['pronta', ['notas.txt']], ['pronta', ['a/b.md']], ['pronta', ['..%2Ftasks.md']],
    ['pronta', ['.md']], ['pronta', ['.hidden.md']], ['..', ['tasks.md']], ['archive', ['velha-2', 'tasks.md']], ['pronta', ['specs', '..', 'tasks.md']],
    ['pronta', ['other', 'x.md']], ['nao-existe', ['tasks.md']], ['pronta', []], ['pronta', ['tasks.md\0']], ['pronta/../meio', ['tasks.md']]]) {
    assert.equal(ok(id, segs), null, `recusa ${id} ${JSON.stringify(segs)}`);
  }
  w(path.join(tmp, 'segredo.md'), 'segredo');
  fs.symlinkSync(path.join(tmp, 'segredo.md'), path.join(proj, 'openspec/changes/pronta/leak.md'));
  assert.equal(ok('pronta', ['leak.md']), null, 'symlink que sai da pasta da change');

  // parseChangePath
  assert.deepEqual(parseChangePath('/changes/pronta/specs/a/spec.md'), { id: 'pronta', segments: ['specs', 'a', 'spec.md'] });
  assert.equal(parseChangePath('/changes/pronta/%E0%A4%A'), null, 'percent-encoding inválido');
  assert.equal(parseChangePath('/changes/pronta'), null);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log('✓ board: quadro ok');
