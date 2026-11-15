// Sessions from the dashboard (dashboard/launch.mjs, compose.mjs, /api/session/*): the text and the arguments, a
// question answered by a read-only run, a session started in the background, a message that wakes one, what is
// refused, the collector's view and the routes. A fake `claude` stands in for the CLI: nothing here spends a token.
//   node tests/launch.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { checkPrompt, teamPrompt, askArgs, askInput, parseAskResult, parseBackgrounded, startedMatcher, availability, liveSessions, ask, dismiss, listAsks, start, send, stop,
  launchView, listStarted, asksDir, MAX_PROMPT, MAX_ANSWER, SESSION_RE } from '../dashboard/launch.mjs';
import { collect, projectSlug } from '../dashboard/collect.mjs';
import { composerHtml, asksHtml, targets, suggestions, quoteText } from '../dashboard/compose.mjs';
import { threadItems, threadHtml, cleanPrompt, arrived, lastReply, SHOWN } from '../dashboard/thread.mjs';
import { stepsOf } from '../dashboard/tail.mjs';
import { sessionsNow } from '../dashboard/shell.mjs';

const here = path.dirname(new URL(import.meta.url).pathname), dash = path.join(here, '..', 'dashboard');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 8000) => { for (const end = Date.now() + ms; Date.now() < end;) { const v = await fn(); if (v) return v; await sleep(40); } return null; };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-launch-'));
const proj = path.join(tmp, 'proj'), claudeDir = path.join(tmp, 'claude'), log = path.join(tmp, 'calls.jsonl');
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
fs.mkdirSync(proj, { recursive: true });

// --- the text -------------------------------------------------------------------------------------------------
assert.equal(checkPrompt('  hi\r\nthere\u0000 ').prompt, 'hi\nthere');
assert.match(checkPrompt('   ').error, /write/); assert.match(checkPrompt(3).error, /text/); assert.match(checkPrompt('x'.repeat(MAX_PROMPT + 1)).error, /at most/);
assert.equal(teamPrompt('fix the login timeout'), '/team fix the login timeout');
assert.equal(teamPrompt('/team resume add-invoice'), '/team resume add-invoice', 'already a command: left as it is');
assert.equal(teamPrompt('/onboarding'), '/onboarding');

// --- the arguments: a question is read-only by construction ----------------------------------------------------------
const SID = '0a1b2c3d-1111-4222-8333-444455556666';
assert.ok(SESSION_RE.test(SID));
{
  const fresh = askArgs({ addDirs: ['/t/dir'] }), fork = askArgs({ sessionId: SID });
  for (const a of [fresh, fork]) {
    assert.equal(a[0], '-p');
    assert.equal(a[a.indexOf('--tools') + 1], 'Read,Grep,Glob', 'only the reading tools exist');
    assert.equal(a[a.indexOf('--permission-mode') + 1], 'dontAsk');
    assert.ok(a.includes('--strict-mcp-config') && a.includes('--no-session-persistence'), 'no MCP server, no transcript left behind');
    assert.ok(!a.some((x) => /skip-permissions|bypass/i.test(x)));
  }
  assert.deepEqual(fork.slice(fork.indexOf('--resume'), fork.indexOf('--resume') + 3), ['--resume', SID, '--fork-session'], 'a copy of the session, never the session');
  assert.ok(!fresh.includes('--resume') && fresh.includes('--add-dir'));
  assert.match(askInput('why?', { sessionId: SID }), /copy of the session[\s\S]*\n\nwhy\?$/);
  assert.match(askInput('find x', { transcripts: '/t/dir' }), /JSONL transcripts in \/t\/dir/);
}
assert.deepEqual(parseAskResult(JSON.stringify({ result: 'yes', is_error: false, total_cost_usd: 0.02, modelUsage: { 'claude-x': {} } })), { ok: true, answer: 'yes', cut: false, usd: 0.02, model: 'claude-x' });
assert.equal(parseAskResult('not json'), null); assert.equal(parseAskResult('{"result":3}'), null);
assert.equal(parseAskResult(JSON.stringify({ result: 'x'.repeat(MAX_ANSWER + 5) })).cut, true);
assert.deepEqual(parseBackgrounded('backgrounded · ab00bbd7 · my session\n  claude agents   list sessions\n'), { id: 'ab00bbd7', name: 'my session', copy: false });
assert.deepEqual(parseBackgrounded('backgrounded · 468f56c6\n', 'note: session ab00bbd7 is already running in the background, so this started a copy as 468f56c6.'), { id: '468f56c6', name: null, copy: true });
assert.equal(parseBackgrounded('Workspace not trusted'), null);
{
  const is = startedMatcher([{ id: 'ab00bbd7', sessionId: null }, { id: 'ffff0000', sessionId: SID }]);
  assert.ok(is(SID) && is('ab00bbd7-6c1d-46b9-8b2f-ef1537e73f0c') && !is('99999999-6c1d-46b9-8b2f-ef1537e73f0c'));
}

// --- the fake claude -------------------------------------------------------------------------------------------
const fake = path.join(tmp, 'claude-fake');
w(fake, `#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const a = process.argv.slice(2), log = process.env.FAKE_LOG, cdir = process.env.FAKE_CLAUDE_DIR;
const note = (o) => fs.appendFileSync(log, JSON.stringify({ args: a, cwd: process.cwd(), ask: process.env.AI_TEAM_ASK, notify: process.env.AI_TEAM_NOTIFY, ...o }) + '\\n');
const pidFile = (pid, o) => { fs.mkdirSync(path.join(cdir, 'sessions'), { recursive: true }); fs.writeFileSync(path.join(cdir, 'sessions', pid + '.json'), JSON.stringify({ pid, ...o })); };
if (a[0] === '-p') {
  let input = ''; process.stdin.on('data', (d) => { input += d; }).on('end', () => {
    note({ stdin: input });
    if (/FAIL/.test(input)) { process.stderr.write('boom: the model refused\\n'); process.exit(1); }
    if (/SLOW/.test(input)) return setTimeout(() => {}, 60000);
    process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: '**fine** <b>' + input.split('\\n').pop() + '</b>', total_cost_usd: 0.0123, modelUsage: { 'claude-test-1': {} } }));
  });
} else if (a[0] === '--bg') {
  note({});
  const r = a.indexOf('--resume'), sid = r >= 0 ? a[r + 1] : 'ab00bbd7-6c1d-46b9-8b2f-ef1537e73f0c', job = sid.split('-')[0];
  if (/UNTRUSTED/.test(a[a.length - 1])) { process.stderr.write('Workspace not trusted\\n'); process.exit(1); }
  pidFile(Number(process.env.FAKE_PID), { sessionId: sid, kind: 'bg', jobId: job, status: 'busy', cwd: process.cwd(), name: 'fake-name' });
  process.stdout.write('backgrounded \\u00b7 ' + job + (r >= 0 ? '' : ' \\u00b7 fake-name') + '\\n  claude attach ' + job + '\\n');
  if (r >= 0) process.stderr.write('note: woke session ' + job + ' with its saved options.\\n');
} else if (a[0] === 'stop') {
  note({});
  for (const f of fs.readdirSync(path.join(cdir, 'sessions'))) { const o = JSON.parse(fs.readFileSync(path.join(cdir, 'sessions', f), 'utf8')); if (o.jobId === a[1]) fs.unlinkSync(path.join(cdir, 'sessions', f)); }
  process.stdout.write('stopped ' + a[1] + '\\n');
} else process.exit(2);
`);
fs.chmodSync(fake, 0o755);
const env = { ...process.env, FAKE_LOG: log, FAKE_CLAUDE_DIR: claudeDir, FAKE_PID: String(process.pid) };
const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const opts = { bin: fake, env, claudeDir, waitMs: 400 };

// --- where the binary is, and the switch -------------------------------------------------------------------------
assert.deepEqual(availability({ AI_TEAM_CLAUDE: fake }), { enabled: true, bin: fake });
assert.match(availability({ AI_TEAM_CLAUDE: path.join(tmp, 'nope') }).reason, /not found/);
assert.match(availability({ AI_TEAM_SESSIONS: '0', AI_TEAM_CLAUDE: fake }).reason, /AI_TEAM_SESSIONS=0/);
assert.equal(availability({ PATH: '/nonexistent-dir', HOME: tmp }).enabled === true || availability({ PATH: '/nonexistent-dir' }).reason !== undefined, true);

// --- ask: the record goes from running to done; the run is told to keep quiet ---------------------------------------
{
  let dones = 0;
  const r = ask(proj, { prompt: 'where does add-invoice stand?', sessionId: SID }, { ...opts, sessionName: 'chroma-7a', onDone: () => { dones++; } });
  assert.equal(r.ok, true); assert.match(r.id, /^[a-z0-9]{6,40}$/);
  assert.equal(listAsks(proj)[0].status, 'running', 'the page shows it at once');
  const done = await until(() => listAsks(proj).find((a) => a.id === r.id && a.status !== 'running'));
  assert.equal(done.status, 'done', JSON.stringify(done));
  assert.match(done.answer, /fine/); assert.equal(done.usd, 0.0123); assert.equal(done.model, 'claude-test-1'); assert.equal(done.sessionName, 'chroma-7a'); assert.ok(done.ms >= 0);
  assert.equal(dones, 1, 'the server is told to refresh the state');
  const c = calls().pop();
  assert.deepEqual(c.args.slice(0, 3), ['-p', '--permission-mode', 'dontAsk']); assert.ok(c.args.includes('--fork-session'));
  assert.equal(fs.realpathSync(c.cwd), fs.realpathSync(proj), 'runs in the project');
  assert.equal(c.ask, '0'); assert.equal(c.notify, '0', 'the helper run neither waits on the dashboard nor pages the phone');
  assert.match(c.stdin, /Question asked from the ai-team dashboard[\s\S]*where does add-invoice stand\?$/, 'the text goes on stdin, never as an argument');
  assert.ok(!c.args.some((x) => /add-invoice/.test(x)));
  // a fresh question may search the project's past sessions; a failure is reported; a bad input starts nothing
  const f = ask(proj, { prompt: 'find the session about budgets' }, { ...opts, addDirs: ['/t/past'], transcripts: '/t/past' });
  await until(() => listAsks(proj).find((a) => a.id === f.id && a.status === 'done'));
  assert.ok(calls().pop().args.join(' ').includes('--add-dir /t/past'));
  const bad = ask(proj, { prompt: 'FAIL please' }, opts);
  const failed = await until(() => listAsks(proj).find((a) => a.id === bad.id && a.status === 'failed'));
  assert.match(failed.error, /boom: the model refused/);
  const n = calls().length;
  assert.equal(ask(proj, { prompt: '' }, opts).code, 400); assert.equal(ask(proj, { prompt: 'x', sessionId: '../../etc' }, opts).code, 400);
  assert.equal(calls().length, n);
  // a run that never answers ends as failed; one that lost its process (a restart) shows as failed too
  const slow = ask(proj, { prompt: 'SLOW' }, { ...opts, timeoutMs: 150 });
  const late = await until(() => listAsks(proj).find((a) => a.id === slow.id && a.status === 'failed'));
  assert.match(late.error, /no answer after/);
  w(path.join(asksDir(proj), 'zzzzold1.json'), JSON.stringify({ id: 'zzzzold1', at: Date.now() - 3600e3, prompt: 'old', status: 'running' }));
  assert.match(listAsks(proj).find((a) => a.id === 'zzzzold1').error, /restarted/);
  // dismiss: one, then all; a bad id is refused
  assert.equal(dismiss(proj, { id: '../x' }).code, 400);
  assert.equal(dismiss(proj, { id: r.id }).ok, true); assert.ok(!listAsks(proj).some((a) => a.id === r.id));
  assert.equal(dismiss(proj, { all: true }).ok, true); assert.equal(listAsks(proj).length, 0);
}

// --- start: through /team when the project has the skill; the record ties the job to its session --------------------
{
  const plain = await start(proj, { prompt: 'what is left?' }, opts);
  assert.equal(plain.ok, true, JSON.stringify(plain)); assert.equal(plain.id, 'ab00bbd7'); assert.equal(plain.name, 'fake-name');
  assert.equal(plain.sessionId, 'ab00bbd7-6c1d-46b9-8b2f-ef1537e73f0c', 'read from the job\'s pid file');
  assert.deepEqual(calls().pop().args, ['--bg', '--', 'what is left?'], 'no /team skill in the project: the text as it is, after --');
  w(path.join(proj, '.claude/skills/team/SKILL.md'), '# team\n');
  await start(proj, { prompt: '--dangerous looking text' }, opts);
  assert.deepEqual(calls().pop().args, ['--bg', '--', '/team --dangerous looking text']);
  await start(proj, { prompt: 'just claude', team: false }, opts);
  assert.deepEqual(calls().pop().args, ['--bg', '--', 'just claude']);
  assert.equal(listStarted(proj).length, 1, 'one record per job id');
  const no = await start(proj, { prompt: 'UNTRUSTED' }, opts);
  assert.equal(no.code, 502); assert.match(no.error, /Workspace not trusted/);
  assert.equal((await start(proj, { prompt: ' ' }, opts)).code, 400);
  const v = launchView(proj, { env: { AI_TEAM_CLAUDE: fake } });
  assert.equal(v.enabled, true); assert.equal(v.team, true); assert.equal(v.started[0].id, 'ab00bbd7'); assert.ok(!('prompt' in v.started[0]), 'the state carries no prompt text of a started session');
}

// --- the running sessions, and who takes a message ---------------------------------------------------------------------
const pidOf = (o) => w(path.join(claudeDir, 'sessions', `${o.pid}.json`), JSON.stringify(o));
{
  const BG = 'ab00bbd7-6c1d-46b9-8b2f-ef1537e73f0c', OPEN = '11111111-2222-4333-8444-555566667777', CLOSED = '99999999-2222-4333-8444-555566667777';
  pidOf({ pid: process.pid, sessionId: BG, kind: 'bg', jobId: 'ab00bbd7', status: 'busy' });
  pidOf({ pid: process.ppid, sessionId: OPEN, kind: 'interactive', status: 'idle' });
  pidOf({ pid: 2 ** 22 + 12345, sessionId: CLOSED, kind: 'bg', jobId: '99999999', status: 'idle' });   // no such process
  const live = liveSessions(claudeDir);
  assert.deepEqual([live.get(BG).kind, live.get(BG).jobId, live.get(BG).status], ['bg', 'ab00bbd7', 'busy']);
  assert.equal(live.get(OPEN).kind, 'interactive'); assert.ok(!live.has(CLOSED), 'a dead process is not a live session');
  let n = calls().length;
  assert.match((await send(proj, { sessionId: OPEN, prompt: 'go on' }, opts)).error, /open in a terminal or in the app/);
  assert.match((await send(proj, { sessionId: BG, prompt: 'go on' }, opts)).error, /is working/);
  assert.equal((await send(proj, { sessionId: 'x', prompt: 'go on' }, opts)).code, 400);
  assert.match((await stop(proj, { sessionId: OPEN }, opts)).error, /only a background session/);
  assert.match((await stop(proj, { sessionId: CLOSED }, opts)).error, /not running/);
  assert.equal(calls().length, n, 'nothing ran for a refused message');
  // idle in the background: stopped first, then continued under the same id
  pidOf({ pid: process.pid, sessionId: BG, kind: 'bg', jobId: 'ab00bbd7', status: 'idle' });
  const s = await send(proj, { sessionId: BG, prompt: 'now the tests' }, opts);
  assert.equal(s.ok, true, JSON.stringify(s)); assert.equal(s.copy, false); assert.equal(s.sessionId, BG);
  assert.deepEqual(calls().slice(-2).map((c) => c.args), [['stop', 'ab00bbd7'], ['--bg', '--resume', BG, '--', 'now the tests']]);
  // closed: woken directly
  n = calls().length;
  const k = await send(proj, { sessionId: CLOSED, prompt: 'start the approved change' }, opts);
  assert.equal(k.ok, true); assert.deepEqual(calls().slice(n).map((c) => c.args), [['--bg', '--resume', CLOSED, '--', 'start the approved change']]);
  assert.ok(listStarted(proj).some((x) => x.sessionId === CLOSED && x.resumed === CLOSED));
  // stop a background session
  pidOf({ pid: process.pid, sessionId: BG, kind: 'bg', jobId: 'ab00bbd7', status: 'idle' });
  assert.deepEqual(await stop(proj, { sessionId: BG }, opts), { ok: true, id: 'ab00bbd7' });
  assert.deepEqual(calls().pop().args, ['stop', 'ab00bbd7']);
}

// --- the collector: a session from the dashboard counts as the team's; the state carries the launch view ------------
{
  const p2 = path.join(tmp, 'p2'), BG = 'ab00bbd7-6c1d-46b9-8b2f-ef1537e73f0c', LOOSE = '77777777-2222-4333-8444-555566667777';
  w(path.join(p2, '.claude/agents/orchestrator.md'), '# o\n'); w(path.join(p2, '.claude/agents/builder.md'), '# b\n');
  const sdir = path.join(claudeDir, 'projects', projectSlug(p2)), ts = new Date(Date.now() - 60e3).toISOString();
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  const sess = (sid) => w(path.join(sdir, `${sid}.jsonl`), [{ type: 'user', uuid: `${sid}-u`, timestamp: ts, cwd: p2, sessionId: sid, message: { role: 'user', content: 'small fix please' } },
    { type: 'assistant', uuid: `${sid}-a`, requestId: `r-${sid}`, timestamp: ts, cwd: p2, sessionId: sid, message: { role: 'assistant', model: 'claude-opus-5-5', usage, content: [{ type: 'text', text: 'done' }] } }].map((r) => JSON.stringify(r)).join('\n') + '\n');
  sess(BG); sess(LOOSE);
  pidOf({ pid: process.pid, sessionId: BG, kind: 'bg', jobId: 'ab00bbd7', status: 'idle' });
  let st = collect({ projectDir: p2, claudeDir });
  assert.equal(st.mainRuns.length, 0, 'a plain session nobody started from the dashboard stays outside the team');
  assert.deepEqual(st.launch.asks, []); assert.deepEqual(st.launch.started, []);
  w(path.join(p2, '.claude/ai-team/local/started/ab00bbd7.json'), JSON.stringify({ id: 'ab00bbd7', sessionId: null, name: 'n', at: Date.now(), prompt: 'small fix please', team: false }));
  st = collect({ projectDir: p2, claudeDir });
  assert.deepEqual(st.mainRuns.map((m) => [m.sessionId, m.bg, m.proc, m.dash]), [[BG, 'ab00bbd7', 'idle', true]], 'listed with its job id and what its process says');
  const [row] = sessionsNow(st);
  assert.equal(row.sessionId, BG); assert.equal(row.bg, 'ab00bbd7'); assert.equal(row.canSend, true);
  const tg = targets(st, sessionsNow(st));
  assert.deepEqual(tg.map((t) => [t.sessionId, t.canSend, t.busy]), [[BG, true, false]]);
  pidOf({ pid: process.pid, sessionId: BG, kind: 'bg', jobId: 'ab00bbd7', status: 'busy' });
  assert.equal(sessionsNow(collect({ projectDir: p2, claudeDir }))[0].canSend, false, 'no message while it works');
}

// --- the page: composer and answers ------------------------------------------------------------------------------
{
  const view = { enabled: true, team: true, asks: [] }, tg = [{ sessionId: SID, name: 'chroma <7a>', state: 'idle', change: 'add-invoice', bg: 'ab00bbd7', busy: false, canSend: true }];
  const st = { board: { stuck: ['fix-a'], pending: ['add-b'], running: ['busy-c', 'adhoc:x'], blocked: [] }, changes: [{ id: 'fix-a', activeAgents: [] }, { id: 'add-b', activeAgents: [] }, { id: 'busy-c', activeAgents: [{ agent: 'builder' }] }, { id: 'adhoc:x', activeAgents: [] }] };
  const a = composerHtml({ mode: 'ask', sid: SID, text: 'a <draft>' }, view, tg, st);
  assert.match(a, /data-launch-form="ask"/); assert.match(a, new RegExp(`<option value="${SID}" selected>chroma &lt;7a&gt; · add-invoice</option>`)); assert.match(a, /a &lt;draft&gt;<\/textarea>/);
  assert.match(a, /a copy of the session answers/); assert.match(composerHtml({ mode: 'ask', sid: null }, view, tg, st), /a fresh run that reads the project/);
  const s = composerHtml({ mode: 'start' }, view, tg, st);
  assert.match(s, /name="team" checked/); assert.match(s, /data-launch-fill="\/team resume fix-a"/); assert.match(s, /\/team resume add-b/);
  assert.ok(!/resume busy-c|resume adhoc/.test(s), 'a change with an agent on it, or an ad-hoc task, is not offered');
  assert.ok(!/name="team"/.test(composerHtml({ mode: 'start' }, { ...view, team: false }, tg, st)), 'no /team skill: no switch');
  const sn = composerHtml({ mode: 'send', sid: SID }, view, tg, st);
  assert.match(sn, /to <b>chroma &lt;7a&gt;<\/b>/); assert.match(sn, /data-launch-mode="send">Send<\/button><button[^>]*data-launch-mode="ask">Ask<\/button><button[^>]*data-launch-mode="start"/, 'a background session: Send, Ask and Start');
  assert.match(sn, /data-thread/, 'a session as the target: its conversation sits above the box'); assert.doesNotMatch(sn, /<button type="submit"[^>]* disabled/);
  assert.doesNotMatch(composerHtml({ mode: 'ask', sid: null }, view, tg, st), /data-thread/, 'the project has no conversation');
  const plain = [{ ...tg[0], bg: null, canSend: false }];
  const pn = composerHtml({ mode: 'send', sid: SID }, view, plain, st);
  assert.match(pn, /data-launch-form="ask"/, 'nothing delivers a message to a session open in a terminal or the app: it is asked'); assert.doesNotMatch(pn, /data-launch-mode="send"/); assert.match(pn, /data-thread/);
  const busy = composerHtml({ mode: 'send', sid: SID }, view, [{ ...tg[0], busy: true, canSend: false }], st);
  assert.match(busy, /<button type="submit"[^>]* disabled/); assert.match(busy, /the session is answering: you can send when it is done/);
  const pin = composerHtml({ mode: 'ask', sid: SID, pinned: true }, view, tg, st);
  assert.doesNotMatch(pin, /data-launch-close/, "a session's own screen has no close button"); assert.doesNotMatch(pin, /data-launch-mode="start"|<select/, 'and talks to that session only'); assert.match(pin, /to <b>chroma &lt;7a&gt;<\/b>/);
  const off = composerHtml({ mode: 'ask' }, { enabled: false, reason: 'turned <off>', asks: [] }, [], st);
  assert.match(off, /<textarea[^>]* disabled/); assert.match(off, /turned &lt;off&gt;/);
  assert.deepEqual(suggestions(st, 'start', null).map((x) => x[1]), ['/team resume fix-a', '/team resume add-b']);
  const html = asksHtml([{ id: 'a1', at: 1, prompt: 'why <b>this</b>?\nmore', sessionId: SID, sessionName: 'chroma <7a>', status: 'done', answer: '**because** <script>x</script>\n\n- one', usd: 0.5, ms: 1200, model: 'm' },
    { id: 'a2', at: 2, prompt: 'q', sessionId: null, status: 'running' }, { id: 'a3', at: 3, prompt: 'q', sessionId: null, status: 'failed', error: 'boom <x>' }]);
  assert.match(html, /why &lt;b&gt;this&lt;\/b&gt;\?/); assert.ok(!html.includes('<script>'), 'the answer is escaped before it is rendered');
  assert.match(html, /<b>because<\/b>/); assert.match(html, /<li>one<\/li>/); assert.match(html, /to chroma &lt;7a&gt;/);
  assert.match(html, /asking the project…/); assert.match(html, /boom &lt;x&gt;/); assert.match(html, /data-ask-dismiss="a1"/);
  assert.equal(quoteText('  line one\nline two ', 'proposal.md (change add-b)'), 'About this passage of proposal.md (change add-b):\n> line one\n> line two\n\n');
  assert.equal(quoteText('   '), '');
}

// --- the conversation of a session ---------------------------------------------------------------------------------
{
  // what a /team start looks like in the transcript, and what the tail reads from it
  const cmd = { type: 'user', timestamp: '2026-11-14T03:16:00Z', message: { role: 'user', content: '<command-message>team</command-message>\n<command-name>/team</command-name>\n<command-args>which agents are there?</command-args>' } };
  assert.equal(cleanPrompt(stepsOf(cmd)[0].text), '/team which agents are there?', 'the command as it was typed, not its tags');
  assert.equal(cleanPrompt('<system-reminder>x</system-reminder>'), null); assert.equal(cleanPrompt('<task-notification>x'), null); assert.equal(cleanPrompt('  '), null);
  assert.equal(cleanPrompt('plain <b>text</b>'), 'plain <b>text</b>');
  assert.deepEqual(stepsOf({ ...cmd, isMeta: true }), [], 'the skill text the command loads is not a prompt');

  const steps = [{ k: 'prompt', t: 1, text: '/team which agents?' }, { k: 'tool', t: 2, id: 'a', name: 'Bash', arg: 'ls' }, { k: 'result', t: 3, id: 'a', ok: true, text: 'x', lines: 1, cut: 0 }, { k: 'tool', t: 4, id: 'b', name: 'Read', arg: 'f' },
    { k: 'text', t: 5, text: 'Seven agents.\n\n| a | b |\n|---|---|\n| 1 | 2 |' }, { k: 'prompt', t: 6, text: 'did you do it?' }, { k: 'text', t: 7, text: 'Yes, <script>x</script> **done**' },
    { k: 'prompt', t: 8, text: '<system-reminder>noise</system-reminder>' }, { k: 'text', t: 9, text: '[Request interrupted by user]' }];
  const items = threadItems(steps);
  assert.deepEqual(items.map((i) => [i.k, i.n || i.text.slice(0, 12)]), [['you', '/team which '], ['work', 2], ['ai', 'Seven agents'], ['you', 'did you do i'], ['ai', 'Yes, <script'], ['note', 'interrupted']], 'calls fold into a count, harness records and results are left out');
  assert.equal(lastReply(items.slice(0, 5)).text.slice(0, 3), 'Yes'); assert.equal(lastReply(items.slice(0, 4)), null, 'asked, not answered yet');
  const html = threadHtml({ steps, name: 'my <s>', err: '', working: false });
  assert.match(html, /class="th you"[\s\S]*\/team which agents\?/); assert.match(html, /▸ 2 tool calls/); assert.match(html, /<b>my &lt;s&gt;<\/b>/);
  assert.match(html, /<table>/, 'the reply is rendered as Markdown'); assert.ok(!html.includes('<script>'), 'and escaped first');
  assert.doesNotMatch(html, /th wait/);
  assert.match(threadHtml({ steps, name: 'x', working: true, since: 5 }), /th wait[\s\S]*x is answering…[\s\S]*data-since="5"/);
  const many = Array.from({ length: SHOWN + 3 }, (_, i) => ({ k: 'text', t: i + 1, text: `reply ${i}` }));
  const some = threadHtml({ steps: many, name: 'x' });
  assert.match(some, /data-thread-more>3 earlier</); assert.ok(!some.includes('reply 2<') && some.includes('reply 3<') && some.includes(`reply ${SHOWN + 2}<`), 'the last ones, the rest behind a button');
  assert.ok(!threadHtml({ steps: many, name: 'x', all: true }).includes('data-thread-more') && threadHtml({ steps: many, name: 'x', all: true }).includes('reply 0<'));
  assert.match(threadHtml({ steps: [], name: 'x', local: { text: 'hi <b>' } }), /th you pend[\s\S]*sending…[\s\S]*hi &lt;b&gt;/, 'a message just sent shows at once');
  assert.ok(!threadHtml({ steps, name: 'x', local: { text: 'did you do it?', arrived: true } }).includes('pend'), 'until the transcript has it');
  assert.match(threadHtml({ steps: [], name: 'x', err: 'starting…' }), /starting…/); assert.match(threadHtml({ steps: [], name: 'x' }), /reading the conversation…/);

  // is the message in the transcript yet
  const local = { text: 'did you do it?' };
  assert.equal(arrived(local, [{ k: 'text', t: 1, text: 'x' }, { k: 'tool', t: 2 }]), false, 'only the session talking: not yet');
  assert.equal(arrived(local, [{ k: 'prompt', t: 3, text: 'did you do it?' }]), true, 'a read that continues: any new prompt is it');
  assert.equal(arrived(local, [{ k: 'prompt', t: 3, text: '<system-reminder>x</system-reminder>' }]), false, 'a harness record is not it');
  assert.equal(arrived(local, [{ k: 'prompt', t: 1, text: 'an older one' }], true), false, 'a first read holds old prompts: it has to be this one');
  assert.equal(arrived({ text: 'which agents?' }, [{ k: 'prompt', t: 1, text: '/team which agents?' }], true), true, 'the /team the server added does not matter');
  assert.equal(arrived({ text: 'x'.repeat(900) }, [{ k: 'prompt', t: 1, text: 'x'.repeat(600) }], true), true, 'the tail clips long prompts');
  assert.equal(arrived(null, [{ k: 'prompt', t: 1, text: 'x' }]), false);
}

// --- the routes ---------------------------------------------------------------------------------------------------
{
  const serve = async (extraEnv) => {
    const port = 20000 + Math.floor(Math.random() * 20000);
    const srv = spawn(process.execPath, [path.join(dash, 'server.mjs'), '--project', proj, '--claude-dir', claudeDir, '--port', String(port)], { env: { ...env, AI_TEAM_CLAUDE: fake, AI_TEAM_LOG: 'silent', ...extraEnv }, stdio: 'ignore' });
    const b = `http://127.0.0.1:${port}`;
    assert.ok(await until(async () => { try { return (await fetch(`${b}/api/health`)).ok; } catch { return false; } }), 'the server answers');
    const post = (p, body, headers = {}) => fetch(`${b}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { srv, b, post };
  };
  const { srv, b, post } = await serve({});
  try {
    assert.equal((await fetch(`${b}/compose.mjs`)).status, 200, 'the page module is served'); assert.equal((await fetch(`${b}/launch.mjs`)).status, 404, 'the server module is not');
    let r = await post('/api/session/ask', { prompt: 'which changes are open?' }); let o = await r.json();
    assert.equal(r.status, 200, JSON.stringify(o)); assert.equal(o.ok, true);
    const answered = await until(async () => { const st = await (await fetch(`${b}/api/state`)).json(); return st.launch.asks.find((a) => a.id === o.id && a.status === 'done'); });
    assert.match(answered.answer, /fine/, 'the answer reaches /api/state');
    assert.equal((await post('/api/session/dismiss', { id: o.id })).status, 200);
    assert.equal((await post('/api/session/ask', { prompt: '' })).status, 400);
    assert.equal((await post('/api/session/ask', { prompt: 'x', sessionId: SID })).status, 404, 'a session this dashboard does not list');
    assert.equal((await post('/api/session/send', { prompt: 'x', sessionId: SID })).status, 404);
    assert.equal((await post('/api/session/nope', { prompt: 'x' })).status, 404);
    assert.equal((await fetch(`${b}/api/session/start`)).status, 405, 'POST only');
    assert.equal((await fetch(`${b}/api/session/start`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{"prompt":"x"}' })).status, 415, 'JSON only: no cross-site form');
    assert.equal((await post('/api/session/start', { prompt: 'x' }, { origin: 'https://evil.example' })).status, 403, 'same origin only');
    const n = calls().length;
    r = await post('/api/session/start', { prompt: 'resume add-b' }); o = await r.json();
    assert.equal(r.status, 200, JSON.stringify(o)); assert.equal(o.id, 'ab00bbd7');
    assert.deepEqual(calls().slice(n).map((c) => c.args), [['--bg', '--', '/team resume add-b']]);
    // from outside the machine (a proxy header) and no token configured: refused before anything runs
    assert.ok([401, 403].includes((await post('/api/session/start', { prompt: 'x' }, { 'x-forwarded-for': '10.0.0.9' })).status));
    assert.equal(calls().length, n + 1);
  } finally { srv.kill(); }
  const off = await serve({ AI_TEAM_SESSIONS: '0' });
  try {
    const r = await off.post('/api/session/start', { prompt: 'x' });
    assert.equal(r.status, 409); assert.match((await r.json()).error, /AI_TEAM_SESSIONS=0/);
    assert.equal((await (await fetch(`${off.b}/api/state`)).json()).launch.enabled, false);
  } finally { off.srv.kill(); }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('launch ok');
