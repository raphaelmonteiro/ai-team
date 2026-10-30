// Estado declarado (linha "estado:" do tasks.md): leitura, validação e prioridade sobre a heurística.
//   node tests/declared.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseDeclaredState } from '../dashboard/board.mjs';
import { collect } from '../dashboard/collect.mjs';

// ---- parser ----
const ok = parseDeclaredState('# x\n<!-- estado: revisao · aguarda: reviewer · desde: 2026-10-24T09:30Z · nota: 2a rodada · parcial -->\n');
assert.deepEqual([ok.valid, ok.etapa, ok.aguarda, ok.sinceIso, ok.nota], [true, 'revisao', 'reviewer', '2026-10-24T09:30Z', '2a rodada · parcial']);
assert.equal(ok.since, Date.parse('2026-10-24T09:30:00Z'));
assert.equal(parseDeclaredState('<!-- estado: validacao · aguarda: fila · desde: 2026-10-24T09:30Z -->').nota, '', 'nota é opcional');
assert.equal(parseDeclaredState('# sem linha\n> Estado: rascunho'), null, 'sem a linha: null');
const bad = (h, re) => { const r = parseDeclaredState(h); assert.equal(r.valid, false, h); assert.match(r.reason, re, h); };
bad('<!-- estado: pronto · aguarda: validator · desde: 2026-10-24T09:30Z -->', /etapa "pronto"/);
bad('<!-- estado: validacao · aguarda: gerente · desde: 2026-10-24T09:30Z -->', /aguarda "gerente"/);
bad('<!-- estado: validacao · aguarda: validator · desde: 2026-13-45T09:30Z -->', /data/);
bad('<!-- estado: validacao · aguarda: validator · desde: ontem -->', /data/);
bad('<!-- estado: validacao · aguarda: validator -->', /falta o campo "desde"/);
bad('<!-- estado: validacao · aguarda: validator · desde: 2026-10-24T09:30Z · cor: azul -->', /campo desconhecido/);

// ---- coletor ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-decl-'));
const project = path.join(tmp, 'proj'), claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-24T12:00:00Z');
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const mk = (id, header, body = '## 1. Backend\n- [ ] 1.1 a\n- [ ] 1.2 b\n') => w(path.join(project, 'openspec/changes', id, 'tasks.md'), `# ${id}\n${header}\n\n${body}`);
mk('com-linha', '<!-- estado: validacao · aguarda: validator · desde: 2026-10-24T10:00Z · nota: ambiente subindo -->');
mk('linha-ruim', '<!-- estado: pronto · aguarda: validator · desde: 2026-10-24T10:00Z -->');
mk('sem-linha', '> Estado: RASCUNHO, aguardando aprovação');
mk('arquivada-decl', '<!-- estado: arquivada · aguarda: fila · desde: 2026-10-24T10:00Z -->');
mk('aprov', '<!-- estado: aprovacao · aguarda: desenvolvedor · desde: 2026-10-24T11:00Z -->');
w(path.join(claude, 'projects/x/placeholder'), '');
const st = collect({ projectDir: project, claudeDir: claude, now });
const by = (id) => st.changes.find((c) => c.id === id);

// linha válida que contradiz a heurística (tasks abertas => "executar a task 1.1"): vale a declarada
const a = by('com-linha');
assert.equal(a.waiting.source, 'declarado');
assert.equal(a.waiting.text, 'esperando validator');
assert.equal(a.waiting.since, Date.parse('2026-10-24T10:00:00Z'));
assert.equal(a.waiting.nota, 'ambiente subindo');
assert.equal(a.waiting.heuristic, 'esperando executar a task 1.1 (Backend)', 'a heurística fica registrada, mas não manda');
assert.equal(a.trail.source, 'declarado'); assert.equal(a.trail.current, 'validacao');
assert.deepEqual(a.trail.steps.map((s) => s.state), ['concluida', 'concluida', 'concluida', 'concluida', 'pendente', 'andamento', 'pendente'], 'correção sem rodada fica pendente');
assert.equal(a.trail.steps.find((s) => s.key === 'integracao').state, 'pendente', 'etapas depois da declarada ficam pendentes');
assert.equal(a.trail.next.key, 'integracao');
assert.ok(st.stages.changes.validacao.includes('com-linha'), 'contagem por etapa segue a declarada');

// linha inválida: heurística + aviso
const b = by('linha-ruim');
assert.equal(b.waiting.source, 'inferido');
assert.match(b.waiting.warning, /^estado declarado inválido: etapa "pronto"/);
assert.equal(b.trail.source, 'inferido'); assert.match(b.trail.warning, /estado declarado inválido/);
assert.equal(b.waiting.text, 'esperando executar a task 1.1 (Backend)');

// linha ausente: igual a hoje
const c = by('sem-linha');
assert.equal(c.waiting.source, 'inferido'); assert.equal(c.waiting.warning, undefined);
assert.equal(c.waiting.text, 'esperando o desenvolvedor'); assert.equal(c.trail.warning, null);
assert.equal(c.declared, null);

// aprovação declarada: a trilha só conclui o que vem antes
const d = by('aprov');
assert.equal(d.trail.current, 'aprovacao');
assert.deepEqual(d.trail.steps.map((s) => s.state).slice(0, 3), ['concluida', 'andamento', 'pendente']);
assert.equal(d.waiting.text, 'esperando desenvolvedor');
assert.ok(st.stages.changes.voce.includes('aprov'));

// arquivada declarada
const e = by('arquivada-decl');
assert.equal(e.status, 'concluída'); assert.equal(e.waiting.text, 'nada (arquivada)'); assert.equal(e.waiting.source, 'declarado');
assert.equal(e.trail.current, null); assert.ok(e.trail.steps.filter((s) => s.key !== 'correcao').every((s) => s.state === 'concluida'));
assert.ok(!Object.values(st.stages.changes).some((l) => l.includes('arquivada-decl')), 'arquivada não entra nas etapas');

console.log('✓ estado declarado ok');
