// Testes das notificações (dashboard/notify.mjs) contra um servidor ntfy falso: config, mensagens,
// envio com token, eventos desligados, hook notify.mjs, hook.sh (SubagentStop/Stop) e ask.mjs (decisão).
//   node tests/notify.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { loadConfig, buildMessage, notify, hookEvent } from '../dashboard/notify.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const dash = path.join(here, '..', 'dashboard');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-notify-'));
const proj = path.join(tmp, 'proj');
fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
fs.writeFileSync(path.join(proj, '.claude', 'ai-team.conf'), "PROJECT_NAME='PAS'\n");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// servidor ntfy falso
const got = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { got.push({ auth: req.headers.authorization, type: req.headers['content-type'], body: JSON.parse(b) }); res.end('{}'); }); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const server = `http://127.0.0.1:${srv.address().port}`;
const cfgFile = path.join(tmp, 'notify.json');
process.env.AI_TEAM_NOTIFY_FILE = cfgFile;
const writeCfg = (o) => fs.writeFileSync(cfgFile, JSON.stringify(o));
async function next(n = 1, ms = 4000) { const t = Date.now(); while (got.length < n && Date.now() - t < ms) await wait(30); return got.length >= n; }

// --- config ------------------------------------------------------------------
assert.equal(loadConfig(), null, 'sem arquivo: nada');
writeCfg({ ntfy: { server: 'https://x/' } });
assert.equal(loadConfig(), null, 'sem tópico: nada');
writeCfg({ ntfy: { topic: 't1' }, on: ['decision', 'xyz'] });
assert.deepEqual(loadConfig(), { server: 'https://ntfy.sh', topic: 't1', token: '', on: ['decision'], detail: true, dashboardUrl: '' });
process.env.AI_TEAM_NOTIFY = '0'; assert.equal(loadConfig(), null, 'AI_TEAM_NOTIFY=0 desliga'); delete process.env.AI_TEAM_NOTIFY;

// --- mensagens ---------------------------------------------------------------
const cfg = { server, topic: 'tp', token: 'tk', on: ['decision', 'agent_stop', 'turn_stop'], detail: true, dashboardUrl: 'https://painel.ts.net/' };
let m = buildMessage('decision', { kind: 'permission', tool: 'Bash', summary: 'git push' }, cfg, 'PAS');
assert.equal(m.title, 'PAS: permissão para Bash'); assert.equal(m.message, 'git push'); assert.equal(m.priority, 4); assert.equal(m.click, 'https://painel.ts.net/');
m = buildMessage('decision', { kind: 'question', questions: [{ question: 'Cor?', options: [{ label: 'Azul' }, { label: 'Verde' }] }] }, cfg, 'PAS');
assert.equal(m.title, 'PAS: pergunta para você'); assert.equal(m.message, 'Cor? (Azul / Verde)');
m = buildMessage('agent_stop', { agent_type: 'qa', last_assistant_message: 'x'.repeat(900) }, cfg, 'PAS');
assert.equal(m.title, 'PAS: qa terminou'); assert.equal(m.message.length, 400, 'texto do agente cortado');
assert.equal(buildMessage('decision', { kind: 'permission', tool: 'Bash', summary: 'segredo' }, { ...cfg, detail: false }, 'PAS').message, 'abra o painel para responder', 'detail: false esconde o comando');
assert.equal(buildMessage('turn_stop', {}, { ...cfg, dashboardUrl: '' }, 'PAS').click, undefined);
assert.equal(hookEvent({ hook_event_name: 'SubagentStop' }), 'agent_stop');
assert.equal(hookEvent({ hook_event_name: 'Stop' }), 'turn_stop');
assert.equal(hookEvent({ hook_event_name: 'Stop', stop_hook_active: true }), null, 'Stop repetido por outro hook não notifica de novo');

// --- envio ---------------------------------------------------------------------
let r = await notify('agent_stop', { agent_type: 'backend-dev', last_assistant_message: 'feito' }, { projectDir: proj, cfg });
assert.equal(r.sent, true);
assert.equal(got[0].auth, 'Bearer tk'); assert.equal(got[0].type, 'application/json');
assert.deepEqual(got[0].body, { topic: 'tp', title: 'PAS: backend-dev terminou', message: 'feito', tags: ['white_check_mark'], priority: 3, click: 'https://painel.ts.net/' });
r = await notify('turn_stop', {}, { projectDir: proj, cfg: { ...cfg, on: ['decision'] } });
assert.deepEqual([r.sent, r.reason], [false, 'evento desligado']); assert.equal(got.length, 1);
r = await notify('turn_stop', {}, { projectDir: proj, cfg: { ...cfg, server: 'http://127.0.0.1:1' }, timeoutMs: 500 });
assert.equal(r.sent, false, 'servidor fora: não lança');

// --- hooks de verdade -------------------------------------------------------------
writeCfg({ ntfy: { server, topic: 'tp2' } });
const run = (cmd, argv, stdin, env = {}) => new Promise((res) => {
  const p = spawn(cmd, argv, { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ...env } });
  p.stdin.end(stdin); p.on('close', (code) => res(code));
});
got.length = 0;
assert.equal(await run(process.execPath, [path.join(dash, 'notify.mjs'), 'hook'], JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'pronto' })), 0);
assert.ok(await next(1)); assert.equal(got[0].body.title, 'PAS: sessão esperando você'); assert.equal(got[0].body.topic, 'tp2');

got.length = 0;
await run('bash', [path.join(dash, 'hook.sh')], JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'qa', session_id: 's', last_assistant_message: 'QA ok' }));
assert.ok(await next(1), 'hook.sh notifica o SubagentStop em segundo plano');
assert.equal(got[0].body.title, 'PAS: qa terminou'); assert.equal(got[0].body.message, 'QA ok');
assert.ok(fs.readFileSync(path.join(proj, '.claude', 'ai-team', 'events.jsonl'), 'utf8').includes('"agent_id":"a1"'), 'e continua gravando o evento');
got.length = 0;
await run('bash', [path.join(dash, 'hook.sh')], JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'qa', session_id: 's' }));
await run('bash', [path.join(dash, 'hook.sh')], JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }), { AI_TEAM_NOTIFY: '0' });
await wait(800);
assert.equal(got.length, 0, 'SubagentStart não notifica; AI_TEAM_NOTIFY=0 desliga no hook.sh');

got.length = 0;   // ask.mjs: decisão nova notifica
const ask = spawn(process.execPath, [path.join(dash, 'ask.mjs')], { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, AI_TEAM_ASK_WAIT_S: '3' } });
ask.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'make deploy' } }));
assert.ok(await next(1));
assert.equal(got[0].body.title, 'PAS: permissão para Bash'); assert.equal(got[0].body.message, 'make deploy');
ask.kill('SIGTERM');

srv.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ notificações ok');
