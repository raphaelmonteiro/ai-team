// Cache incremental dos transcripts: o resultado com cache (reutilizado entre
// chamadas) tem de ser idêntico ao de uma coleta sem cache, na mesma fixture,
// inclusive depois de append, de reescrita e de remoção de arquivos.
//   node tests/cache.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug, createTranscriptCache } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-cache-'));
const project = path.join(tmp, 'proj');
const claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-21T15:00:00.000Z');
const at = (min) => new Date(now - min * 60000).toISOString();
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const line = (r) => JSON.stringify(r) + '\n';

w(path.join(project, 'openspec/changes/add-invoice/tasks.md'), '## 1. Backend\n- [ ] 1.1 rota\n');
const sdir = path.join(claude, 'projects', projectSlug(project));
const sid = 'sess-c1';
const sessFile = path.join(sdir, `${sid}.jsonl`);
const subFile = (id) => path.join(sdir, sid, 'subagents', `agent-${id}.jsonl`);
const base = { cwd: project, sessionId: sid, gitBranch: 'main' };
const us = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 };
const asst = (id, min, blocks, model = 'claude-opus-5-5') => blocks.map((b, i) => line({ ...base, type: 'assistant', uuid: `${id}-${i}`, timestamp: at(min),
  requestId: id, message: { role: 'assistant', model, usage: us, content: [b] } })).join('');
const call = (tu, agent, min, prompt) => asst(`r-${tu}`, min, [{ type: 'text', text: 'delegando' }, { type: 'tool_use', id: tu, name: 'Agent', input: { subagent_type: agent, description: `rodada ${tu}`, prompt } }]);
const result = (tu, agentId, min) => line({ ...base, type: 'user', uuid: `res-${tu}`, timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu, content: 'ok' }] },
  toolUseResult: { agentId, totalDurationMs: 60000, usage: us } });
const prompt = (min, t) => line({ ...base, type: 'user', uuid: `p-${min}`, timestamp: at(min), message: { role: 'user', content: t } });
const subRecs = (id, min0, n) => line({ ...base, agentId: id, type: 'user', uuid: `${id}-u`, timestamp: at(min0), message: { role: 'user', content: `Implemente openspec/changes/add-invoice (${id})` } })
  + Array.from({ length: n }, (_, i) => asst(`${id}-r${i}`, min0 - i - 1, [{ type: 'text', text: `passo ${i} de ${id}` }, { type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }], 'claude-sonnet-5-5')).join('');

w(sessFile, prompt(60, 'crie a change') + call('tu1', 'backend-dev', 59, 'Implemente openspec/changes/add-invoice (a1)') + result('tu1', 'a1', 50));
w(subFile('a1'), subRecs('a1', 59, 3));
w(subFile('b2'), subRecs('b2', 40, 2));
w(path.join(sdir, 'sess-c2.jsonl'), prompt(30, 'outra sessão') + asst('c2-1', 29, [{ type: 'text', text: 'oi' }]));

const touchAll = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) touchAll(f); fs.utimesSync(f, new Date(now - 3600e3), new Date(now - 3600e3)); } };
touchAll(tmp);

const opts = { projectDir: project, claudeDir: claude, now };
const cache = createTranscriptCache();
let step = 0;
const same = (what) => {
  const withCache = collect({ ...opts, cache });
  const fresh = collect({ ...opts, cache: createTranscriptCache() });
  assert.deepEqual(JSON.parse(JSON.stringify(withCache)), JSON.parse(JSON.stringify(fresh)), `${++step}. ${what}: com cache == sem cache`);
  return withCache;
};
// só os bytes lidos de transcripts (.jsonl): no Node 18 o readFileSync do tasks.md também passa pelo fs.readSync
const bytesRead = (fn) => {
  const origRead = fs.readSync, origOpen = fs.openSync, fds = new Set(); let n = 0;
  fs.openSync = (f, ...a) => { const fd = origOpen(f, ...a); if (String(f).endsWith('.jsonl')) fds.add(fd); return fd; };
  fs.readSync = (fd, ...a) => { const k = origRead(fd, ...a); if (fds.has(fd)) n += k; return k; };
  try { fn(); } finally { fs.readSync = origRead; fs.openSync = origOpen; }
  return n;
};
const append = (f, s) => { fs.appendFileSync(f, s); fs.utimesSync(f, new Date(now - 1800e3), new Date(now - 1800e3 + step * 1000)); };

let st = same('coleta inicial');
assert.equal(st.totals.runs, 2);
assert.equal(cache.size, 4, '2 sessões + 2 subagentes no cache');

// 2ª chamada sem mudança: nada é relido
assert.equal(bytesRead(() => collect({ ...opts, cache })), 0, 'arquivo inalterado reaproveita o resultado: 0 bytes lidos');
same('sem mudança');

// append em subagente e na sessão: lê só o trecho novo
const sizeBefore = fs.statSync(subFile('a1')).size + fs.statSync(sessFile).size;
const extra = asst('a1-novo', 5, [{ type: 'text', text: 'passo extra' }], 'claude-sonnet-5-5');
const extraSess = call('tu2', 'qa', 20, 'Valide openspec/changes/add-invoice') + result('tu2', 'b2', 10);
append(subFile('a1'), extra);
append(sessFile, extraSess);
{
  const n = bytesRead(() => collect({ ...opts, cache }));
  assert.ok(n < sizeBefore / 2 && n >= extra.length + extraSess.length, `append lê só o trecho novo (${n} bytes de ${sizeBefore})`);
}
st = same('depois de append');
assert.equal(st.totals.runs, 2);
assert.ok(st.changes.some((c) => c.runs.some((r) => r.agent === 'qa' && r.linked)), 'a chamada nova liga ao subagente existente');
assert.match(st.changes.flatMap((c) => c.runs).map((r) => r.summary).join('|'), /passo extra/);

// linha parcial em escrita: ignorada; completada depois, entra
const partial = asst('a1-parcial', 4, [{ type: 'text', text: 'linha parcial' }], 'claude-sonnet-5-5').trimEnd();
append(subFile('a1'), partial.slice(0, 40));
same('linha parcial no fim');
append(subFile('a1'), partial.slice(40) + '\n');
st = same('linha parcial completada');
assert.match(st.changes.flatMap((c) => c.runs).map((r) => r.summary).join('|'), /linha parcial/);

// final sem \n que já é JSON válido: entra; e o próximo append relê com segurança
append(subFile('a1'), asst('a1-semnl', 3, [{ type: 'text', text: 'sem quebra' }]).trimEnd());
same('final válido sem quebra de linha');
append(subFile('a1'), '\n' + asst('a1-depois', 2, [{ type: 'text', text: 'depois da quebra' }]));
st = same('append depois de final sem quebra');
assert.match(st.changes.flatMap((c) => c.runs).map((r) => r.summary).join('|'), /depois da quebra/);

// reescrita que não é append (mesmo tamanho ou prefixo diferente): reanalisa tudo
const orig = fs.readFileSync(subFile('b2'), 'utf8');
w(subFile('b2'), orig.replace(/passo 0 de b2/g, 'passo X de b2'));
fs.utimesSync(subFile('b2'), new Date(now - 1700e3), new Date(now - 1700e3));
same('reescrita com o mesmo tamanho');
w(subFile('b2'), subRecs('b2', 40, 5));
fs.utimesSync(subFile('b2'), new Date(now - 1600e3), new Date(now - 1600e3));
same('reescrita maior com prefixo diferente');

// remoção: subagente e sessão saem do cache e do resultado
fs.rmSync(subFile('b2'));
st = same('subagente removido');
assert.ok(![...cache.keys()].includes(subFile('b2')), 'removido sai do cache');
fs.rmSync(path.join(sdir, 'sess-c2.jsonl'));
st = same('sessão removida');
assert.ok(![...cache.keys()].some((k) => k.endsWith('sess-c2.jsonl')), 'sessão removida sai do cache');
assert.equal(st.totals.sessions, 1);

// arquivo novo é lido e entra
w(path.join(sdir, 'sess-c3.jsonl'), prompt(5, 'nova') + asst('c3-1', 4, [{ type: 'text', text: 'nova sessão' }]));
st = same('sessão nova');
assert.equal(st.totals.sessions, 2);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ cache: leitura incremental ok');
