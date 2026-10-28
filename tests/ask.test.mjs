// Testes das decisões pelo painel (dashboard/ask.mjs): fila no disco, resposta, saída do hook,
// "respondida no app" pelo transcript, hook de verdade e POST /api/answer.
//   node tests/ask.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { describe, listPending, writeAnswer, hookOutput, resolvedInTranscript, pendingDir, answersDir } from '../dashboard/ask.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const hookFile = path.join(here, '..', 'dashboard', 'ask.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-ask-'));
const proj = path.join(tmp, 'proj');
fs.mkdirSync(proj);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { const v = fn(); if (v) return v; await wait(50); } return null; }

// --- describe ----------------------------------------------------------------
assert.deepEqual(describe('Bash', { command: 'rm -rf build', description: 'limpa' }), { kind: 'permission', summary: 'rm -rf build', detail: 'limpa' });
assert.equal(describe('Write', { file_path: '/a/b.txt', content: 'x'.repeat(9000) }).summary, '/a/b.txt', 'Write mostra o arquivo, não o conteúdo');
const dq = describe('AskUserQuestion', { questions: [{ question: 'Cor?', header: 'Cor', multiSelect: false, options: [{ label: 'Azul', description: 'a' }] }] });
assert.equal(dq.kind, 'question'); assert.equal(dq.questions[0].options[0].label, 'Azul');

// --- fila, resposta e saída ----------------------------------------------------
fs.mkdirSync(pendingDir(proj), { recursive: true });
const q = { id: 'abc123-q', ts: 1, pid: process.pid, tool: 'AskUserQuestion', ...dq };
fs.writeFileSync(path.join(pendingDir(proj), `${q.id}.json`), JSON.stringify({ ...q, input: { questions: [] } }));
fs.writeFileSync(path.join(pendingDir(proj), 'orfa01-x.json'), JSON.stringify({ id: 'orfa01-x', ts: 2, pid: 999999, tool: 'Bash', kind: 'permission' }));
const list = listPending(proj);
assert.deepEqual(list.map((p) => p.id), ['abc123-q'], 'hook morto: pendência some');
assert.ok(!('input' in list[0]), 'o input inteiro não vai para o painel');
assert.ok(!fs.existsSync(path.join(pendingDir(proj), 'orfa01-x.json')));

assert.match(writeAnswer(proj, { id: '../x', behavior: 'allow' }).error, /id inválido/);
assert.match(writeAnswer(proj, { id: 'naoexiste1', behavior: 'allow' }).error, /não existe/);
assert.match(writeAnswer(proj, { id: q.id, behavior: 'talvez' }).error, /allow ou deny/);
assert.match(writeAnswer(proj, { id: q.id, behavior: 'allow', answers: {} }).error, /sem resposta/);
assert.deepEqual(writeAnswer(proj, { id: q.id, behavior: 'allow', answers: { 'Cor?': ['Azul', 'Outra'] } }), { ok: true });
const ans = JSON.parse(fs.readFileSync(path.join(answersDir(proj), `${q.id}.json`), 'utf8'));
assert.deepEqual(ans.answers, { 'Cor?': 'Azul, Outra' }, 'multisseleção vira texto separado por vírgula');
const input = { questions: [{ question: 'Cor?' }] };
assert.deepEqual(hookOutput(q, ans, input), { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow', updatedInput: { ...input, answers: { 'Cor?': 'Azul, Outra' } } } } });
assert.deepEqual(hookOutput({ kind: 'permission' }, { behavior: 'allow' }, {}).hookSpecificOutput.decision, { behavior: 'allow' }, 'permissão: sem updatedInput');
assert.deepEqual(hookOutput({ kind: 'permission' }, { behavior: 'deny', message: 'não' }, {}).hookSpecificOutput.decision, { behavior: 'deny', message: 'não' });

// --- respondida no app: tool_use igual + tool_result depois ----------------------
const tr = path.join(tmp, 't.jsonl');
const use = (id, cmd, t) => JSON.stringify({ type: 'assistant', timestamp: new Date(t).toISOString(), message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { description: 'd', command: cmd } }] } });
const res = (id, t) => JSON.stringify({ type: 'user', timestamp: new Date(t).toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
const T0 = Date.parse('2026-10-28T12:00:00Z');
fs.writeFileSync(tr, [use('u1', 'ls', T0 - 60e3), res('u1', T0 - 59e3), use('u2', 'ls', T0)].join('\n') + '\n');
assert.equal(resolvedInTranscript(tr, 'Bash', { command: 'ls', description: 'd' }, T0), false, 'o ls anterior já respondido não conta');
fs.appendFileSync(tr, res('u2', T0 + 3000) + '\n');
assert.equal(resolvedInTranscript(tr, 'Bash', { command: 'ls', description: 'd' }, T0), true, 'chaves em outra ordem, mesmo input');
assert.equal(resolvedInTranscript(tr, 'Bash', { command: 'pwd' }, T0), false);
assert.equal(resolvedInTranscript(path.join(tmp, 'nada.jsonl'), 'Bash', {}, T0), false);

// --- hook de verdade --------------------------------------------------------------
function runHook(stdin, env = {}) {
  const p = spawn(process.execPath, [hookFile], { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ...env } });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  p.stdin.end(JSON.stringify(stdin));
  return { proc: p, done: new Promise((r) => p.on('close', (code) => r({ code, out }))) };
}
for (const d of [pendingDir(proj), answersDir(proj)]) for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
{
  const h = runHook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'make deploy' }, session_id: 's1' });
  const p = await until(() => listPending(proj)[0]);
  assert.ok(p, 'hook grava a pendência');
  assert.equal(p.summary, 'make deploy'); assert.equal(p.sessionId, 's1');
  assert.deepEqual(writeAnswer(proj, { id: p.id, behavior: 'allow' }), { ok: true });
  const r = await h.done;
  assert.equal(r.code, 0);
  assert.deepEqual(JSON.parse(r.out).hookSpecificOutput.decision, { behavior: 'allow' });
  assert.equal(listPending(proj).length, 0, 'respondida: pendência sai');
  assert.equal(fs.readdirSync(answersDir(proj)).filter((f) => f.endsWith('.json')).length, 0, 'resposta consumida');
}
{
  const t = path.join(tmp, 'app.jsonl');
  fs.writeFileSync(t, use('a1', 'npm publish', Date.now()) + '\n');
  const h = runHook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'npm publish', description: 'd' }, transcript_path: t });
  assert.ok(await until(() => listPending(proj)[0]));
  fs.appendFileSync(t, res('a1', Date.now()) + '\n');
  const r = await h.done;
  assert.equal(r.out, '', 'respondida no app: sai sem decisão');
  assert.equal(listPending(proj).length, 0);
}
{
  const r = await runHook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'x' } }, { AI_TEAM_ASK_WAIT_S: '0.3' }).done;
  assert.equal(r.out, '', 'prazo vencido: sem decisão'); assert.equal(listPending(proj).length, 0);
  const off = await runHook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'x' } }, { AI_TEAM_ASK: '0' }).done;
  assert.equal(off.out, ''); assert.equal(listPending(proj).length, 0);
  const other = await runHook({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: {} }).done;
  assert.equal(other.out, '', 'outro evento: ignora');
}
{   // SIGTERM (timeout do hook no Claude Code): limpa a pendência
  const h = runHook({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'y' } });
  assert.ok(await until(() => listPending(proj)[0]));
  h.proc.kill('SIGTERM'); await h.done;
  assert.equal(fs.readdirSync(pendingDir(proj)).length, 0);
}

// --- POST /api/answer -------------------------------------------------------------
{
  const port = 43290;
  const srv = spawn(process.execPath, [path.join(here, '..', 'dashboard', 'server.mjs'), '--project', proj, '--claude-dir', path.join(tmp, 'claude'), '--port', String(port)], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  let up = false; for (let i = 0; i < 60 && !up; i++) { try { await fetch(base + '/api/state'); up = true; } catch { await wait(100); } }
  const h = runHook({ hook_event_name: 'PermissionRequest', tool_name: 'AskUserQuestion', tool_input: { questions: [{ question: 'Banco?', header: 'b', options: [{ label: 'Postgres', description: '' }], multiSelect: false }] } });
  let pend = null; for (let i = 0; i < 60 && !pend; i++) { const s = await (await fetch(base + '/api/state')).json(); pend = (s.pending || [])[0]; if (!pend) await wait(100); }
  assert.ok(pend, '/api/state traz a pendência'); assert.equal(pend.kind, 'question');
  const post = (body, headers = {}) => fetch(base + '/api/answer', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ id: pend.id, behavior: 'allow', answers: { 'Banco?': 'Postgres' } }, { origin: 'https://evil.example' })).status, 403, 'outra origem: recusa');
  assert.equal((await fetch(base + '/api/answer', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await fetch(base + '/api/answer')).status, 405);
  const ok = await post({ id: pend.id, behavior: 'allow', answers: { 'Banco?': 'Postgres' } }, { origin: base });
  assert.equal(ok.status, 200);
  const r = await h.done;
  assert.deepEqual(JSON.parse(r.out).hookSpecificOutput.decision.updatedInput.answers, { 'Banco?': 'Postgres' });
  assert.equal((await post({ id: pend.id, behavior: 'allow' })).status, 409, 'já respondida');
  srv.kill();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ decisões pelo painel ok');
