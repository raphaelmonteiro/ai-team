// Testes das notificações (dashboard/notify.mjs) contra um servidor ntfy falso: config, mensagens,
// envio com token, eventos desligados, hook notify.mjs, hook.sh (SubagentStop/Stop) e ask.mjs (decisão).
//   node tests/notify.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { loadConfig, buildMessage, notify, hookEvent, publicView, updateConfig } from '../dashboard/notify.mjs';

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

// --- edição pelo painel: config do PC + eventos só deste projeto -----------------------
{
  fs.rmSync(cfgFile, { force: true });
  let v = publicView(proj);
  assert.equal(v.configured, false); assert.equal(v.project.on, null);
  assert.match(updateConfig(proj, { topic: 'a b', on: [] }).error, /tópico/);
  assert.match(updateConfig(proj, { topic: 'ok1', server: 'ftp://x', on: [] }).error, /servidor/);
  assert.match(updateConfig(proj, { topic: 'ok1', on: 'tudo' }).error, /lista/);
  assert.match(updateConfig(proj, { topic: 'ok1', on: [], dashboardUrl: 'javascript:alert(1)' }).error, /painel/);
  let r = updateConfig(proj, { topic: 'tp3', server: server + '/', token: 'segredo', on: ['decision', 'turn_stop', 'xyz'], detail: false, dashboardUrl: 'https://mac.ts.net/', projectOn: ['decision'] });
  assert.equal(r.ok, true);
  assert.equal(fs.statSync(cfgFile).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(r.view).includes('segredo'), 'o token nunca sai na view'); assert.equal(r.view.hasToken, true);
  assert.deepEqual(r.view.on, ['decision', 'turn_stop']); assert.deepEqual(r.view.project.on, ['decision']);
  assert.deepEqual(loadConfig(proj).on, ['decision'], 'projeto com eventos próprios');
  const other = path.join(tmp, 'outro'); fs.mkdirSync(other);
  assert.deepEqual(loadConfig(other).on, ['decision', 'turn_stop'], 'outro projeto usa os do PC');
  assert.equal(loadConfig(proj).server, server, 'barra final sai'); assert.equal(loadConfig(proj).detail, false);
  r = updateConfig(proj, { topic: 'tp3', server, on: ['agent_stop'], projectOn: [] });
  assert.equal(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).ntfy.token, 'segredo', 'token vazio no form: mantém o salvo');
  assert.deepEqual(loadConfig(proj).on, [], 'projeto mudo');
  r = updateConfig(proj, { topic: 'tp3', server, on: ['agent_stop'], projectOn: null, clearToken: true });
  assert.equal(r.view.hasToken, false); assert.equal(r.view.project.on, null);
  assert.ok(!('projects' in JSON.parse(fs.readFileSync(cfgFile, 'utf8'))), 'sem override: chave some');
}

// --- rotas do painel ---------------------------------------------------------------
{
  const port = 43295;
  const s = spawn(process.execPath, [path.join(dash, 'server.mjs'), '--project', proj, '--claude-dir', path.join(tmp, 'claude'), '--port', String(port)], { env: process.env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  let up = false; for (let i = 0; i < 80 && !up; i++) { try { await fetch(base + '/api/notify'); up = true; } catch { await wait(100); } }
  const v = await (await fetch(base + '/api/notify')).json();
  assert.equal(v.topic, 'tp3');
  assert.match(await (await fetch(base + '/notificacoes')).text(), /Neste computador/);
  const post = (p, body, h = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  assert.equal((await post('/api/notify', { topic: 'x x', on: [] })).status, 400);
  assert.equal((await post('/api/notify', { topic: 'tp4', server, on: ['decision'] }, { origin: 'https://evil.example' })).status, 403, 'outra origem não troca a config');
  assert.equal((await post('/api/notify', { topic: 'tp4', server, on: ['decision'] })).status, 200);
  got.length = 0;
  assert.equal((await post('/api/notify/test', {})).status, 200);
  assert.ok(await next(1)); assert.equal(got[0].body.topic, 'tp4', 'teste usa a config salva, mesmo com o evento desligado');
  s.kill();
}

srv.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ notificações ok');
