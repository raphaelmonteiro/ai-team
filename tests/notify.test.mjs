// Notification tests (dashboard/notify.mjs) against a fake ntfy server: config, messages,
// sending with a token, events off, notify.mjs hook, hook.sh (SubagentStop/Stop) and ask.mjs (decision).
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

// fake ntfy server
const got = [];
const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => { b += d; }); req.on('end', () => { got.push({ auth: req.headers.authorization, type: req.headers['content-type'], body: JSON.parse(b) }); res.end('{}'); }); });
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const server = `http://127.0.0.1:${srv.address().port}`;
const cfgFile = path.join(tmp, 'notify.json');
process.env.AI_TEAM_NOTIFY_FILE = cfgFile;
const writeCfg = (o) => fs.writeFileSync(cfgFile, JSON.stringify(o));
async function next(n = 1, ms = 4000) { const t = Date.now(); while (got.length < n && Date.now() - t < ms) await wait(30); return got.length >= n; }

// --- config ------------------------------------------------------------------
assert.equal(loadConfig(), null, 'no file: nothing');
writeCfg({ ntfy: { server: 'https://x/' } });
assert.equal(loadConfig(), null, 'no topic: nothing');
writeCfg({ ntfy: { topic: 't1' }, on: ['decision', 'xyz'] });
assert.deepEqual(loadConfig(), { server: 'https://ntfy.sh', topic: 't1', token: '', on: ['decision', 'turn_failed', 'session_end'], detail: true, dashboardUrl: '' }, 'old config: new events start on');
writeCfg({ ntfy: { topic: 't1' }, on: ['decision'], eventsVersion: 2 });
assert.deepEqual(loadConfig().on, ['decision'], 'config already at version 2: the list rules');
process.env.AI_TEAM_NOTIFY = '0'; assert.equal(loadConfig(), null, 'AI_TEAM_NOTIFY=0 turns it off'); delete process.env.AI_TEAM_NOTIFY;

// --- messages ---------------------------------------------------------------
const cfg = { server, topic: 'tp', token: 'tk', on: ['decision', 'agent_stop', 'turn_stop'], detail: true, dashboardUrl: 'https://dashboard.ts.net/' };
let m = buildMessage('decision', { kind: 'permission', tool: 'Bash', summary: 'git push' }, cfg, 'PAS');
assert.equal(m.title, 'PAS: permission for Bash'); assert.equal(m.message, 'git push'); assert.equal(m.priority, 4); assert.equal(m.click, 'https://dashboard.ts.net/');
m = buildMessage('decision', { kind: 'question', questions: [{ question: 'Color?', options: [{ label: 'Blue' }, { label: 'Green' }] }] }, cfg, 'PAS');
assert.equal(m.title, 'PAS: question for you'); assert.equal(m.message, 'Color? (Blue / Green)');
m = buildMessage('agent_stop', { agent_type: 'validator', last_assistant_message: 'x'.repeat(900) }, cfg, 'PAS');
assert.equal(m.title, 'PAS: validator finished'); assert.equal(m.message.length, 400, 'agent text cut');
assert.equal(buildMessage('decision', { kind: 'permission', tool: 'Bash', summary: 'secret' }, { ...cfg, detail: false }, 'PAS').message, 'open the dashboard to answer', 'detail: false hides the command');
assert.equal(buildMessage('turn_stop', {}, { ...cfg, dashboardUrl: '' }, 'PAS').click, undefined);
assert.equal(hookEvent({ hook_event_name: 'SubagentStop' }), 'agent_stop');
assert.equal(hookEvent({ hook_event_name: 'Stop' }), 'turn_stop');
assert.equal(hookEvent({ hook_event_name: 'Stop', stop_hook_active: true }), null, 'Stop repeated by another hook does not notify again');
assert.equal(hookEvent({ hook_event_name: 'StopFailure' }), 'turn_failed');
assert.equal(hookEvent({ hook_event_name: 'SessionEnd' }), 'session_end');
m = buildMessage('turn_failed', { error: 'rate_limit', error_details: '5 h limit reached', last_assistant_message: 'stopped at task 2.1' }, cfg, 'PAS');
assert.equal(m.title, 'PAS: turn stopped (usage limit)'); assert.equal(m.message, '5 h limit reached\nstopped at task 2.1'); assert.equal(m.priority, 4);
assert.equal(buildMessage('turn_failed', { error: 'new_error' }, { ...cfg, detail: false }, 'PAS').title, 'PAS: turn stopped (new_error)');
assert.equal(buildMessage('session_end', { reason: 'clear' }, cfg, 'PAS').message, 'cleared with /clear');
assert.equal(buildMessage('session_end', { reason: 'xyz' }, cfg, 'PAS').message, 'reason: xyz');

// --- sending ---------------------------------------------------------------------
let r = await notify('agent_stop', { agent_type: 'builder', last_assistant_message: 'done' }, { projectDir: proj, cfg });
assert.equal(r.sent, true);
assert.equal(got[0].auth, 'Bearer tk'); assert.equal(got[0].type, 'application/json');
assert.deepEqual(got[0].body, { topic: 'tp', title: 'PAS: builder finished', message: 'done', tags: ['white_check_mark'], priority: 3, click: 'https://dashboard.ts.net/' });
r = await notify('turn_stop', {}, { projectDir: proj, cfg: { ...cfg, on: ['decision'] } });
assert.deepEqual([r.sent, r.reason], [false, 'event off']); assert.equal(got.length, 1);
r = await notify('turn_stop', {}, { projectDir: proj, cfg: { ...cfg, server: 'http://127.0.0.1:1' }, timeoutMs: 500 });
assert.equal(r.sent, false, 'server down: does not throw');

// --- real hooks -------------------------------------------------------------
writeCfg({ ntfy: { server, topic: 'tp2' } });
const run = (cmd, argv, stdin, env = {}) => new Promise((res) => {
  const p = spawn(cmd, argv, { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, ...env } });
  p.stdin.end(stdin); p.on('close', (code) => res(code));
});
got.length = 0;
assert.equal(await run(process.execPath, [path.join(dash, 'notify.mjs'), 'hook'], JSON.stringify({ hook_event_name: 'Stop', last_assistant_message: 'ready' })), 0);
assert.ok(await next(1)); assert.equal(got[0].body.title, 'PAS: session waiting for you'); assert.equal(got[0].body.topic, 'tp2');

got.length = 0;
await run('bash', [path.join(dash, 'hook.sh')], JSON.stringify({ hook_event_name: 'SubagentStop', agent_id: 'a1', agent_type: 'validator', session_id: 's', last_assistant_message: 'validation ok' }));
assert.ok(await next(1), 'hook.sh notifies the SubagentStop in the background');
assert.equal(got[0].body.title, 'PAS: validator finished'); assert.equal(got[0].body.message, 'validation ok');
assert.ok(fs.readFileSync(path.join(proj, '.claude', 'ai-team', 'events.jsonl'), 'utf8').includes('"agent_id":"a1"'), 'and still writes the event');
got.length = 0;
await run('bash', [path.join(dash, 'hook.sh')], JSON.stringify({ hook_event_name: 'SubagentStart', agent_id: 'a2', agent_type: 'validator', session_id: 's' }));
await run('bash', [path.join(dash, 'hook.sh')], JSON.stringify({ hook_event_name: 'Stop', session_id: 's' }), { AI_TEAM_NOTIFY: '0' });
await wait(800);
assert.equal(got.length, 0, 'SubagentStart does not notify; AI_TEAM_NOTIFY=0 turns it off in hook.sh');
got.length = 0;   // SessionEnd and StopFailure: hook.sh only exits after the send
await run('bash', [path.join(dash, 'hook.sh')], JSON.stringify({ hook_event_name: 'SessionEnd', session_id: 's', reason: 'prompt_input_exit' }));
assert.equal(got.length, 1, 'SessionEnd: sent before the hook exits'); assert.equal(got[0].body.message, 'you left the session');
await run('bash', [path.join(dash, 'hook.sh')], JSON.stringify({ hook_event_name: 'StopFailure', session_id: 's', error: 'overloaded' }));
assert.equal(got.length, 2); assert.equal(got[1].body.title, 'PAS: turn stopped (API overloaded)');

got.length = 0;   // ask.mjs: a new decision notifies
// the hook waits 60 s: the notification must arrive while the decision is open, not when it closes
const ask = spawn(process.execPath, [path.join(dash, 'ask.mjs')], { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, AI_TEAM_ASK_WAIT_S: '60' } });
ask.stdin.end(JSON.stringify({ hook_event_name: 'PermissionRequest', tool_name: 'Bash', tool_input: { command: 'make deploy' } }));
assert.ok(await next(1, 3000), 'the decision notifies at once, with the hook still waiting');
assert.equal(ask.exitCode, null, 'the hook is still waiting for the answer');
assert.equal(got[0].body.title, 'PAS: permission for Bash'); assert.equal(got[0].body.message, 'make deploy');
ask.kill('SIGTERM');

// --- editing through the dashboard: PC config + events for this project only -----------------------
{
  fs.rmSync(cfgFile, { force: true });
  let v = publicView(proj);
  assert.equal(v.configured, false); assert.equal(v.project.on, null);
  assert.match(updateConfig(proj, { topic: 'a b', on: [] }).error, /topic/);
  assert.match(updateConfig(proj, { topic: 'ok1', server: 'ftp://x', on: [] }).error, /server/);
  assert.match(updateConfig(proj, { topic: 'ok1', on: 'all' }).error, /list/);
  assert.match(updateConfig(proj, { topic: 'ok1', on: [], dashboardUrl: 'javascript:alert(1)' }).error, /dashboard/);
  let r = updateConfig(proj, { topic: 'tp3', server: server + '/', token: 'secret', on: ['decision', 'turn_stop', 'xyz'], detail: false, dashboardUrl: 'https://mac.ts.net/', projectOn: ['decision'] });
  assert.equal(r.ok, true);
  assert.equal(fs.statSync(cfgFile).mode & 0o777, 0o600);
  assert.ok(!JSON.stringify(r.view).includes('secret'), 'the token never goes out in the view'); assert.equal(r.view.hasToken, true);
  assert.deepEqual(r.view.on, ['decision', 'turn_stop']); assert.deepEqual(r.view.project.on, ['decision']);
  assert.deepEqual(loadConfig(proj).on, ['decision'], 'project with its own events');
  const other = path.join(tmp, 'other'); fs.mkdirSync(other);
  assert.deepEqual(loadConfig(other).on, ['decision', 'turn_stop'], 'another project uses the PC ones');
  assert.equal(loadConfig(proj).server, server, 'trailing slash goes'); assert.equal(loadConfig(proj).detail, false);
  r = updateConfig(proj, { topic: 'tp3', server, on: ['agent_stop'], projectOn: [] });
  assert.equal(JSON.parse(fs.readFileSync(cfgFile, 'utf8')).ntfy.token, 'secret', 'empty token in the form: keeps the saved one');
  assert.deepEqual(loadConfig(proj).on, [], 'muted project');
  r = updateConfig(proj, { topic: 'tp3', server, on: ['agent_stop'], projectOn: null, clearToken: true });
  assert.equal(r.view.hasToken, false); assert.equal(r.view.project.on, null);
  assert.ok(!('projects' in JSON.parse(fs.readFileSync(cfgFile, 'utf8'))), 'no override: the key goes');
}

// --- dashboard routes ---------------------------------------------------------------
{
  const port = 43295;
  const s = spawn(process.execPath, [path.join(dash, 'server.mjs'), '--project', proj, '--claude-dir', path.join(tmp, 'claude'), '--port', String(port)], { env: process.env, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  let up = false; for (let i = 0; i < 80 && !up; i++) { try { await fetch(base + '/api/notify'); up = true; } catch { await wait(100); } }
  const v = await (await fetch(base + '/api/notify')).json();
  assert.equal(v.topic, 'tp3');
  assert.match(await (await fetch(base + '/notifications')).text(), /On this computer/);
  const post = (p, body, h = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(body) });
  assert.equal((await post('/api/notify', { topic: 'x x', on: [] })).status, 400);
  assert.equal((await post('/api/notify', { topic: 'tp4', server, on: ['decision'] }, { origin: 'https://evil.example' })).status, 403, 'another origin does not change the config');
  assert.equal((await post('/api/notify', { topic: 'tp4', server, on: ['decision'] })).status, 200);
  got.length = 0;
  assert.equal((await post('/api/notify/test', {})).status, 200);
  assert.ok(await next(1)); assert.equal(got[0].body.topic, 'tp4', 'the test uses the saved config, even with the event off');
  s.kill();
}

srv.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ notifications ok');
