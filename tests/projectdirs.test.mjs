// Descoberta das pastas de sessão em ~/.claude/projects (findProjectDirs, via collect):
// além da pasta do slug do projeto, entra toda outra pasta cujo transcript tem, no primeiro
// registro com `cwd`, o caminho do projeto. Caracterização da regra de decisão.
//   node tests/projectdirs.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug, createTranscriptCache } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-pdirs-'));
const project = path.join(tmp, 'proj');
const claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-21T15:00:00.000Z');
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const line = (r) => JSON.stringify(r) + '\n';
const projects = path.join(claude, 'projects');
const CHUNK_MAX = 16 * 1024 + 1024;   // um bloco de leitura do começo (a 3ª linha cabe no 1º bloco)

// transcript no formato real: 1º registro sem cwd (queue-operation), cwd só na 3ª linha
const transcript = (sid, cwd, { pad = 0 } = {}) =>
  line({ type: 'queue-operation', operation: 'enqueue', sessionId: sid, timestamp: new Date(now - 90000).toISOString() })
  + line({ type: 'summary', summary: 'x'.repeat(pad) })
  + line({ type: 'user', uuid: `${sid}-u`, sessionId: sid, cwd, timestamp: new Date(now - 60000).toISOString(), message: { role: 'user', content: `oi ${sid}` } });
const sessions = () => collect({ projectDir: project, claudeDir: claude, now, cache: createTranscriptCache() });

w(path.join(project, 'openspec/changes/add-x/tasks.md'), '## 1. Backend\n- [ ] 1.1 rota\n');
w(path.join(projects, projectSlug(project), 'own.jsonl'), transcript('own', project));
assert.equal(sessions().totals.sessions, 1, 'só a pasta do slug');

{   // outra pasta com o cwd do projeto na 3ª linha: entra
    w(path.join(projects, 'outro-caminho', 'alt.jsonl'), transcript('alt', project));
    const st = sessions();
    assert.equal(st.totals.sessions, 2);
}
{   // cwd com barra final / segmentos redundantes: path.resolve iguala
    w(path.join(projects, 'outro-2', 'alt2.jsonl'), transcript('alt2', project + '/./'));
    assert.equal(sessions().totals.sessions, 3);
}
{   // cwd de outro projeto: não entra
    w(path.join(projects, 'de-outro-projeto', 'x.jsonl'), transcript('x', path.join(tmp, 'outro')));
    assert.equal(sessions().totals.sessions, 3);
}
{   // só os 3 primeiros .jsonl da pasta (ordem de listagem) são examinados
    for (const n of ['a', 'b', 'c']) w(path.join(projects, 'quatro', `${n}.jsonl`), transcript(n, path.join(tmp, 'outro')));
    w(path.join(projects, 'quatro', 'd.jsonl'), transcript('d', project));
    assert.equal(sessions().totals.sessions, 3, 'o 4º arquivo não é examinado');
}
{   // transcript ilegível é ignorado, sem erro
    if (typeof process.getuid === 'function' && process.getuid() === 0) console.log('  (pulado: root lê arquivo sem permissão)');
    else {
        const f = path.join(projects, 'sem-permissao', 'priv.jsonl');
        w(f, transcript('priv', project));
        fs.chmodSync(f, 0o000);
        try {
            const st = sessions();
            assert.equal(st.error, undefined);
            assert.equal(st.totals.sessions, 3, 'pasta cujo transcript não lê é ignorada');
        } finally { fs.chmodSync(f, 0o600); }
    }
}

// --- custo: só o começo dos transcripts de outras pastas, guardado entre coletas ---------------
// bytes lidos de .jsonl cujo caminho passa em `match` (o fs.readSync do tasks.md não conta)
const bytesRead = (fn, match = () => true) => {
  const origRead = fs.readSync, origOpen = fs.openSync, fds = new Set(); let n = 0;
  fs.openSync = (f, ...a) => { const fd = origOpen(f, ...a); if (String(f).endsWith('.jsonl') && match(String(f))) fds.add(fd); return fd; };
  fs.closeSync = ((close) => (fd) => { fds.delete(fd); return close(fd); })(fs.closeSync);
  fs.readSync = (fd, ...a) => { const k = origRead(fd, ...a); if (fds.has(fd)) n += k; return k; };
  try { fn(); } finally { fs.readSync = origRead; fs.openSync = origOpen; }
  return n;
};
{
  const claude2 = path.join(tmp, 'claude2'), p2 = path.join(projects, '..', '..', 'proj2');
  const pr = path.join(claude2, 'projects');
  const big = (sid, cwd) => transcript(sid, cwd) + line({ type: 'summary', summary: 'y'.repeat(1024 * 1024) });   // ~1 MB, cwd na 3ª linha
  const other = (n) => path.join(pr, `outra-${n}`);
  const run = (cache = createTranscriptCache(), proj = project) => collect({ projectDir: proj, claudeDir: claude2, now, cache });
  const inOthers = (f) => !f.includes(`${path.sep}outra-0${path.sep}`) && f.includes(`${path.sep}outra-`);   // outra-0 casa com o projeto: lida inteira como sessão
  w(path.join(pr, projectSlug(project), 'own.jsonl'), transcript('own', project));
  for (let n = 0; n < 3; n++) for (let k = 0; k < 3; k++) w(path.join(other(n), `s${k}.jsonl`), big(`s${n}${k}`, n === 0 ? project : path.join(tmp, 'outro')));
  const total = 6 * fs.statSync(path.join(other(0), 's0.jsonl')).size;
  const cache = createTranscriptCache();
  let st;
  const first = bytesRead(() => { st = run(cache); }, inOthers);
  assert.ok(first > 0 && first < total * 0.1, `primeira coleta lê só o começo (${first} de ${total} bytes)`);
  assert.equal(st.totals.sessions, 1 + 3, 'a pasta com cwd do projeto entra com as 3 sessões');
  assert.equal(bytesRead(() => run(cache)), 0, 'coleta quente sem mudança: 0 bytes de .jsonl');
  assert.equal(bytesRead(() => run(createTranscriptCache()), inOthers), 0, 'outro cache de transcripts, mesmo processo: o começo não é relido');

  // append num transcript já examinado: o começo não é relido e a decisão se mantém
  fs.appendFileSync(path.join(other(0), 's1.jsonl'), line({ type: 'assistant', uuid: 'n1', sessionId: 's01', timestamp: new Date(now - 1000).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'mais' }] } }));
  fs.appendFileSync(path.join(other(1), 's0.jsonl'), line({ type: 'user', uuid: 'n2', sessionId: 's10', cwd: path.join(tmp, 'outro'), timestamp: new Date(now - 1000).toISOString(), message: { role: 'user', content: 'mais' } }));
  assert.equal(bytesRead(() => { st = run(cache); }, inOthers), 0, 'append em transcript de outra pasta: o começo não é relido');
  assert.equal(st.totals.sessions, 4, 'a decisão sobre as pastas se mantém');

  // reescrito menor e com cwd diferente: relido, e a pasta sai
  for (const k of [0, 1, 2]) w(path.join(other(0), `s${k}.jsonl`), transcript(`s0${k}`, path.join(tmp, 'outro')));
  const reread = bytesRead(() => { st = run(cache); }, (f) => f.includes(`${path.sep}outra-`));
  assert.ok(reread > 0 && reread < 8192 * 3, `começo relido (${reread} bytes)`);
  assert.equal(st.totals.sessions, 1, 'pasta deixa de entrar');

  // pasta nova com cwd do projeto
  w(path.join(other(5), 'n.jsonl'), transcript('n5', project));
  assert.equal(run(cache).totals.sessions, 2, 'pasta nova entra na coleta seguinte');
  // pasta removida
  fs.rmSync(other(5), { recursive: true });
  assert.equal(run(cache).totals.sessions, 1, 'pasta removida some sem erro');
  // arquivo novo numa pasta já examinada
  w(path.join(other(1), 'a-novo.jsonl'), transcript('novo', project));   // 'a-novo' lista antes dos s*.jsonl? só os 3 primeiros contam
  assert.equal(run(cache).error, undefined);

  // dois projetos no mesmo processo (hub): cada começo é lido uma vez
  const claude3 = path.join(tmp, 'claude3'), pr3 = path.join(claude3, 'projects');
  const pa = path.join(tmp, 'pa'), pb = path.join(tmp, 'pb');
  for (const [pj, n] of [[pa, 'a'], [pb, 'b']]) w(path.join(pr3, projectSlug(pj), 'own.jsonl'), transcript(`own-${n}`, pj));
  for (let n = 0; n < 4; n++) w(path.join(pr3, `x-${n}`, 's.jsonl'), big(`x${n}`, path.join(tmp, 'longe')));
  const both = bytesRead(() => { collect({ projectDir: pa, claudeDir: claude3, now, cache: createTranscriptCache() }); collect({ projectDir: pb, claudeDir: claude3, now, cache: createTranscriptCache() }); }, (f) => f.includes(`${path.sep}x-`));
  const one = bytesRead(() => { collect({ projectDir: pa, claudeDir: path.join(tmp, 'claude4-sem-cache'), now }); }, () => true);
  assert.equal(one, 0);
  assert.ok(both > 0 && both <= 4 * CHUNK_MAX, `dois projetos leem cada começo uma vez (${both} bytes)`);

  // cwd só depois do 1º MiB: o arquivo conta como sem cwd
  const claude5 = path.join(tmp, 'claude5'), pr5 = path.join(claude5, 'projects');
  w(path.join(pr5, projectSlug(project), 'own.jsonl'), transcript('own5', project));
  w(path.join(pr5, 'tarde', 't.jsonl'), line({ type: 'summary', summary: 'z'.repeat(1100 * 1024) }) + line({ type: 'user', uuid: 't1', sessionId: 't', cwd: project, timestamp: new Date(now - 1000).toISOString(), message: { role: 'user', content: 'tarde' } }));
  const lim = bytesRead(() => { st = collect({ projectDir: project, claudeDir: claude5, now, cache: createTranscriptCache() }); }, (f) => f.includes(`${path.sep}tarde${path.sep}`));
  assert.equal(st.totals.sessions, 1, 'cwd depois de 1 MiB: a pasta não entra');
  assert.ok(lim <= 1024 * 1024, `leitura limitada a 1 MiB (${lim})`);
  assert.equal(bytesRead(() => collect({ projectDir: project, claudeDir: claude5, now, cache: createTranscriptCache() }), (f) => f.includes(`${path.sep}tarde${path.sep}`)), 0, 'o resultado "sem cwd" também fica guardado');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ descoberta de pastas de sessão ok');
