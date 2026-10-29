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

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ descoberta de pastas de sessão ok');
