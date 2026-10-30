// End-of-turn question tests: lastAsk in the transcript, notice with the question and away
// mode (the Stop hook waits for the answer from the dashboard and returns decision: block).
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
const wrap = (ask) => rec({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'w' + Math.random(), name: 'mcp__ccd_turn__wrap_up', input: { recap: 'r', ask, actions: [{ label: 'Approve and run', message: 'Approved, go ahead and run the audit.' }, { label: 'Include fixes', message: 'Include the fixes.' }] } }] } });
const prompt = (t) => rec({ type: 'user', message: { content: t } });
const tr = path.join(tmp, 't.jsonl');

// --- lastAsk ---------------------------------------------------------------------
fs.writeFileSync(tr, [prompt('make the change'), wrap('Approve the change?')].join('\n') + '\n');
let a = lastAsk(tr);
assert.equal(a.kind, 'wrap_up'); assert.equal(a.questions[0].question, 'Approve the change?');
assert.deepEqual(a.questions[0].options.map((o) => [o.label, o.description]), [['Approve and run', 'Approved, go ahead and run the audit.'], ['Include fixes', 'Include the fixes.']]);
fs.appendFileSync(tr, prompt('approved') + '\n');
assert.equal(lastAsk(tr), null, 'answered with a prompt: gone');
assert.equal(lastAsk(path.join(tmp, 'none.jsonl')), null);

// --- notice with the question ---------------------------------------------------------
const cfg = { on: ['turn_stop'], detail: true, dashboardUrl: '' };
let m = buildMessage('turn_stop', { last_assistant_message: 'x', ask: { kind: 'wrap_up', questions: [{ question: 'Approve?', options: [{ label: 'Yes' }, { label: 'No' }] }] } }, cfg, 'PAS');
assert.equal(m.title, 'PAS: question for you'); assert.equal(m.message, 'Approve?\nYes / No'); assert.equal(m.priority, 4);
assert.equal(buildMessage('turn_stop', { last_assistant_message: 'done' }, cfg, 'PAS').title, 'PAS: session waiting for you', 'no question: the usual one');
assert.equal(buildMessage('decision', { kind: 'reply', questions: [{ question: 'Approve?', options: [{ label: 'Yes' }] }] }, cfg, 'PAS').title, 'PAS: question for you');

// --- Stop hook output --------------------------------------------------------------
assert.deepEqual(hookOutput({ kind: 'reply' }, { behavior: 'deny' }), {}, 'leave it to the app: no decision');
assert.equal(hookOutput({ kind: 'reply' }, { behavior: 'allow', reply: 'Approved.' }).decision, 'block');
assert.match(hookOutput({ kind: 'reply' }, { behavior: 'allow', reply: 'Approved.' }).reason, /"Approved\."/);

// --- away mode: real hook ------------------------------------------------------
assert.deepEqual(getAway(proj), { on: false, since: null });
fs.writeFileSync(tr, [prompt('make the change'), wrap('Approve the change so the provisioner runs the audit?')].join('\n') + '\n');
const stopIn = JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', transcript_path: tr, last_assistant_message: 'The change is created.' });
function run(file, stdin, env = {}, viaBash = false) {
  const p = spawn(viaBash ? 'bash' : process.execPath, [file], { env: { ...process.env, CLAUDE_PROJECT_DIR: proj, AI_TEAM_NOTIFY_FILE: path.join(tmp, 'none.json'), ...env } });
  let out = ''; p.stdout.on('data', (d) => { out += d; });
  p.stdin.end(stdin);
  return { proc: p, done: new Promise((r) => p.on('close', (code) => r({ code, out }))) };
}
{
  const r = await run(path.join(dash, 'ask.mjs'), stopIn).done;
  assert.deepEqual([r.code, r.out], [0, ''], 'mode off: exits at once');
  assert.equal(listPending(proj).length, 0);
}
setAway(proj, true);
assert.equal(getAway(proj).on, true);
{
  const h = run(path.join(dash, 'ask.mjs'), stopIn);
  const p = await until(() => listPending(proj)[0]);
  assert.ok(p, 'away mode: end-of-turn pending item');
  assert.equal(p.kind, 'reply'); assert.equal(p.summary, 'The change is created.');
  assert.equal(p.questions[0].options[0].description, 'Approved, go ahead and run the audit.');
  assert.match(writeAnswer(proj, { id: p.id, behavior: 'allow', reply: '  ' }).error, /empty/);
  assert.deepEqual(writeAnswer(proj, { id: p.id, behavior: 'allow', reply: 'Approved, go ahead and run the audit.' }), { ok: true });
  const r = await h.done;
  const out = JSON.parse(r.out);
  assert.equal(out.decision, 'block'); assert.match(out.reason, /Approved, go ahead and run the audit/);
  assert.equal(listPending(proj).length, 0);
}
{   // leave it to the app: exits without a decision, code 3 (the notice already went)
  const h = run(path.join(dash, 'ask.mjs'), stopIn);
  const p = await until(() => listPending(proj)[0]);
  writeAnswer(proj, { id: p.id, behavior: 'deny' });
  const r = await h.done;
  assert.deepEqual([r.code, r.out], [3, '']);
}
{   // turning the mode off midway: the turn ends
  const h = run(path.join(dash, 'ask.mjs'), stopIn);
  assert.ok(await until(() => listPending(proj)[0]));
  setAway(proj, false);
  const r = await h.done;
  assert.deepEqual([r.code, r.out], [3, '']);
  assert.equal(listPending(proj).length, 0);
  setAway(proj, true);
}
{   // turn without a question: nothing to wait for
  const t2 = path.join(tmp, 't2.jsonl');
  fs.writeFileSync(t2, [prompt('hi'), rec({ type: 'assistant', message: { content: [{ type: 'text', text: 'done' }] } })].join('\n') + '\n');
  const r = await run(path.join(dash, 'ask.mjs'), JSON.stringify({ hook_event_name: 'Stop', transcript_path: t2 })).done;
  assert.deepEqual([r.code, r.out], [0, '']);
}
{   // through hook.sh: the ask.mjs output becomes the Stop hook output
  const h = run(path.join(dash, 'hook.sh'), stopIn, {}, true);
  const p = await until(() => listPending(proj)[0]);
  writeAnswer(proj, { id: p.id, behavior: 'allow', reply: 'Include the fixes.' });
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
  assert.equal((await (await fetch(base + '/api/state')).json()).away.on, true, '/api/state carries the mode');
  assert.equal((await (await post({ on: false })).json()).on, false);
  s.kill();
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ end of turn and away mode ok');
