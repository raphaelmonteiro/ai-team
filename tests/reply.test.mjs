// Testes da pergunta do fim do turno: lastAsk no transcript, aviso com a pergunta e o modo longe do
// computador (hook Stop espera a resposta pelo painel e devolve decision: block).
//   node tests/reply.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { lastAsk } from '../dashboard/plan.mjs';
import { buildMessage } from '../dashboard/notify.mjs';
import { listPending, writeAnswer, getAway, setAway, hookOutput } from '../dashboard/ask.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const dash = path.join(here, '..', 'dashboard');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-reply-'));
const proj = path.join(tmp, 'proj');
fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
fs.writeFileSync(path.join(proj, '.claude', 'ai-team.conf'), "PROJECT_NAME='PAS'\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 4000) { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await wait(50); } return null; }

const rec = (o) => JSON.stringify({ timestamp: new Date().toISOString(), ...o });
const wrap = (ask) => rec({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w' + Math.random(), name: 'mcp__ccd_turn__wrap_up', input: { recap: 'r', ask, actions: [{ label: 'Aprovar e rodar', message: 'Aprovo, pode rodar a auditoria.' }, { label: 'Incluir correções', message: 'Inclui as correções.' }] } }] } });
const prompt = (t) => rec({ type: 'user', message: { content: t } });
const tr = path.join(tmp, 't.jsonl');

// --- lastAsk ---------------------------------------------------------------------
fs.writeFileSync(tr, [prompt('faz a change'), wrap('Aprova a change?')].join('\n') + '\n');
let a = lastAsk(tr);
assert.equal(a.kind, 'wrap_up'); assert.equal(a.questions[0].question, 'Aprova a change?');
assert.deepEqual(a.questions[0].options.map((o) => [o.label, o.description]), [['Aprovar e rodar', 'Aprovo, pode rodar a auditoria.'], ['Incluir correções', 'Inclui as correções.']]);
fs.appendFileSync(tr, prompt('aprovado') + '\n');
assert.equal(lastAsk(tr), null, 'respondida com um prompt: some');
assert.equal(lastAsk(path.join(tmp, 'nada.jsonl')), null);

// --- aviso com a pergunta ---------------------------------------------------------
const cfg = { on: ['turn_stop'], detail: true, dashboardUrl: '' };
let m = buildMessage('turn_stop', { last_assistant_message: 'x', ask: { kind: 'wrap_up', questions: [{ question: 'Aprova?', options: [{ label: 'Sim' }, { label: 'Não' }] }] } }, cfg, 'PAS');
assert.equal(m.title, 'PAS: pergunta para você'); assert.equal(m.message, 'Aprova?\nSim / Não'); assert.equal(m.priority, 4);
assert.equal(buildMessage('turn_stop', { last_assistant_message: 'feito' }, cfg, 'PAS').title, 'PAS: sessão esperando você', 'sem pergunta: o de sempre');
assert.equal(buildMessage('decision', { kind: 'reply', questions: [{ question: 'Aprova?', options: [{ label: 'Sim' }] }] }, cfg, 'PAS').title, 'PAS: pergunta para você');

// --- saída do hook Stop --------------------------------------------------------------
assert.deepEqual(hookOutput({ kind: 'reply' }, { behavior: 'deny' }), {}, 'deixar para o app: sem decisão');
assert.equal(hookOutput({ kind: 'reply' }, { behavior: 'allow', reply: 'Aprovo.' }).decision, 'block');
assert.match(hookOutput({ kind: 'reply' }, { behavior: 'allow', reply: 'Aprovo.' }).reason, /"Aprovo\."/);

// --- modo longe: hook de verdade ------------------------------------------------------
assert.deepEqual(getAway(proj), { on: false, since: null });
fs.writeFileSync(tr, [prompt('faz a change'), wrap('Aprova a change para o provisioner rodar a auditoria?')].join('\n') + '\n');
const stopIn = JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', transcript_path: tr, last_assistant_message: 'A change está criada.' });
function run(file, stdin, env = {}, viaBash = false) {
  const p = spawn(viaBash ? 'bash' : process.execPath, [file], { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, AI_TEAM_NOTIFY_FILE: path.join(tmp, 'sem.json'), ...env } });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  p.stdin.end(stdin);
  return { proc: p, done: new Promise((r) => p.on('close', (code) => r({ code, out }))) };
}
{
  const r = await run(path.join(dash, 'ask.mjs'), stopIn).done;
  assert.deepEqual([r.code, r.out], [0, ''], 'modo desligado: sai na hora');
  assert.equal(listPending(proj).length, 0);
}
setAway(proj, true);
assert.equal(getAway(proj).on, true);
{
  const h = run(path.join(dash, 'ask.mjs'), stopIn);
  const p = await until(() => listPending(proj)[0]);
  assert.ok(p, 'modo longe: pendência do fim do turno');
  assert.equal(p.kind, 'reply'); assert.equal(p.summary, 'A change está criada.');
  assert.equal(p.questions[0].options[0].description, 'Aprovo, pode rodar a auditoria.');
  assert.match(writeAnswer(proj, { id: p.id, behavior: 'allow', reply: '  ' }).error, /vazia/);
  assert.deepEqual(writeAnswer(proj, { id: p.id, behavior: 'allow', reply: 'Aprovo, pode rodar a auditoria.' }), { ok: true });
  const r = await h.done;
  const out = JSON.parse(r.out);
  assert.equal(out.decision, 'block'); assert.match(out.reason, /Aprovo, pode rodar a auditoria/);
  assert.equal(listPending(proj).length, 0);
}
{   // deixar para o app: sai sem decisão, código 3 (o aviso já foi)
  const h = run(path.join(dash, 'ask.mjs'), stopIn);
  const p = await until(() => listPending(proj)[0]);
  writeAnswer(proj, { id: p.id, behavior: 'deny' });
  const r = await h.done;
  assert.deepEqual([r.code, r.out], [3, '']);
}
{   // desligar o modo no meio: o turno termina
  const h = run(path.join(dash, 'ask.mjs'), stopIn);
  assert.ok(await until(() => listPending(proj)[0]));
  setAway(proj, false);
  const r = await h.done;
  assert.deepEqual([r.code, r.out], [3, '']);
  assert.equal(listPending(proj).length, 0);
  setAway(proj, true);
}
{   // turno sem pergunta: nada a esperar
  const t2 = path.join(tmp, 't2.jsonl');
  fs.writeFileSync(t2, [prompt('oi'), rec({ type: 'assistant', message: { content: [{ type: 'text', text: 'feito' }] } })].join('\n') + '\n');
  const r = await run(path.join(dash, 'ask.mjs'), JSON.stringify({ hook_event_name: 'Stop', transcript_path: t2 })).done;
  assert.deepEqual([r.code, r.out], [0, '']);
}
{   // pelo hook.sh: a saída do ask.mjs vira a saída do hook Stop
  const h = run(path.join(dash, 'hook.sh'), stopIn, {}, true);
  const p = await until(() => listPending(proj)[0]);
  writeAnswer(proj, { id: p.id, behavior: 'allow', reply: 'Inclui as correções.' });
  const r = await h.done;
  assert.equal(JSON.parse(r.out).decision, 'block');
}

// --- /api/away --------------------------------------------------------------------------
{
  setAway(proj, false);
  const port = 43305;
  const s = spawn(process.execPath, [path.join(dash, 'server.mjs'), '--project', proj, '--claude-dir', path.join(tmp, 'claude'), '--port', String(port)], { stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  assert.ok(await until(async () => { try { return (await fetch(base + '/api/away')).ok; } catch { return false; } }));
  assert.equal((await (await fetch(base + '/api/away')).json()).on, false);
  const post = (body, h = {}) => fetch(base + '/api/away', { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  assert.equal((await post({ on: true }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await (await post({ on: true })).json()).on, true);
  assert.equal(getAway(proj).on, true);
  assert.equal((await (await fetch(base + '/api/state')).json()).away.on, true, '/api/state traz o modo');
  assert.equal((await (await post({ on: false })).json()).on, false);
  s.kill();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ fim do turno e modo longe ok');
