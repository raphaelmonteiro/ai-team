// ai-team — sessions from the dashboard (server side only): ask a question, start a session, send it a message.
//
// Ask:   `claude -p` answers one question and exits. Read-only by construction: only the reading tools exist
//        (--tools Read,Grep,Glob), no MCP server is loaded, nothing that would prompt is allowed (dontAsk) and no
//        transcript is written (--no-session-persistence). With a session it runs on a copy of it (--resume <id>
//        --fork-session): it knows what that session knows, and the session itself is neither interrupted nor
//        written to. The question and the answer are kept in .claude/ai-team/local/asks/<id>.json (per machine).
// Start: `claude --bg -- <prompt>` starts a background session in the project. Claude Code's own supervisor keeps it
//        running with no terminal; `claude attach <id>` opens it in one. It is a full session: the project's hooks
//        run, so its permission requests and questions reach "Decisions waiting for you" like any other session's.
// Send:  a message to a session that is not open anywhere else: `claude --bg --resume <session-id> -- <message>`
//        continues it in the background under the same id. An idle background session is stopped first (the CLI
//        starts a copy of a session that is still running); a busy one, or one open in a terminal or in the app, is
//        refused, since no command delivers a message to it.
// Every command runs from an argument list with no shell, the text after `--` or on stdin: it never becomes a flag or
// a command. AI_TEAM_SESSIONS=0 turns all of it off; AI_TEAM_CLAUDE names the binary when `claude` is not on the
// server's PATH (a launchd or systemd service has a short one).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';

export const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ASK_ID_RE = /^[a-z0-9]{6,40}$/;
export const MAX_PROMPT = 8000;
export const MAX_ANSWER = 20000;
export const KEEP_ASKS = 30, SHOWN_ASKS = 12, KEEP_STARTED = 50, MAX_RUNNING = 3;
export const ASK_TIMEOUT_MS = 10 * 60e3;

const localDir = (projectDir) => path.join(projectDir, '.claude', 'ai-team', 'local');
export const asksDir = (projectDir) => path.join(localDir(projectDir), 'asks');
export const startedDir = (projectDir) => path.join(localDir(projectDir), 'started');
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, JSON.stringify(o)); fs.renameSync(tmp, f); };
const records = (dir) => { let names = []; try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; } return names.map((n) => readJson(path.join(dir, n))).filter((r) => r && r.id && r.at).sort((a, b) => b.at - a.at); };
const prune = (dir, keep) => { for (const r of records(dir).slice(keep)) { try { fs.unlinkSync(path.join(dir, `${r.id}.json`)); } catch { /* next time */ } } };

// ---- the claude binary ------------------------------------------------------------------------------------------
let found = { at: 0, key: null, bin: null };
export function findClaude(env = process.env) {
  if (env.AI_TEAM_CLAUDE) { try { fs.accessSync(env.AI_TEAM_CLAUDE, fs.constants.X_OK); return env.AI_TEAM_CLAUDE; } catch { return null; } }
  const key = String(env.PATH || '');
  if (found.key === key && Date.now() - found.at < 30e3) return found.bin;
  const home = os.homedir();
  const dirs = [...key.split(path.delimiter), path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin'];
  let bin = null;
  for (const d of dirs) { if (!d) continue; const f = path.join(d, 'claude'); try { fs.accessSync(f, fs.constants.X_OK); bin = f; break; } catch { /* next folder */ } }
  found = { at: Date.now(), key, bin };
  return bin;
}
export function availability(env = process.env) {
  if (env.AI_TEAM_SESSIONS === '0') return { enabled: false, reason: 'turned off on this dashboard (AI_TEAM_SESSIONS=0)' };
  const bin = findClaude(env);
  return bin ? { enabled: true, bin } : { enabled: false, reason: 'the claude command was not found by this server: set AI_TEAM_CLAUDE=/path/to/claude and restart the dashboard' };
}

// ---- the running Claude Code sessions (~/.claude/sessions/<pid>.json), by session id -------------------------------
// kind: "bg" for a background session (started with --bg, here or in a terminal), with its job id (what `claude
// attach|stop` take); status: idle | busy | waiting, as Claude Code writes it (absent in older versions).
export function liveSessions(claudeDir) {
  const live = new Map();
  const dir = path.join(claudeDir, 'sessions');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return live; }
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!s.sessionId || !s.pid) continue;
      process.kill(s.pid, 0);            // throws if the process does not exist
      live.set(s.sessionId, { pid: s.pid, kind: s.kind === 'bg' ? 'bg' : 'interactive', jobId: typeof s.jobId === 'string' ? s.jobId : null, status: typeof s.status === 'string' ? s.status : null, cwd: s.cwd || null, name: s.name || null });
    } catch { /* orphan file or dead process */ }
  }
  return live;
}

// ---- the text ---------------------------------------------------------------------------------------------------
export function checkPrompt(v) {
  if (typeof v !== 'string') return { error: 'expected text' };
  const prompt = v.replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
  if (!prompt) return { error: 'write a message' };
  if (prompt.length > MAX_PROMPT) return { error: `at most ${MAX_PROMPT} characters` };
  return { prompt };
}
// a request for the team goes through /team (the orchestrator classifies it: question, ad-hoc task, change or
// `resume <id>`); a text that already is a slash command stays as it is
export const teamPrompt = (prompt) => (prompt.startsWith('/') ? prompt : `/team ${prompt}`);
export const hasTeamSkill = (projectDir) => fs.existsSync(path.join(projectDir, '.claude', 'skills', 'team', 'SKILL.md'));

// ---- ask ----------------------------------------------------------------------------------------------------------
const ASK_NOTE = 'Question asked from the ai-team dashboard. Answer it directly and briefly, from what you already know and from the files you can read. Only the reading tools exist here: change nothing and start no work; when the answer is an action, say what you would do.';
// the note goes in the message, not in --append-system-prompt: a resumed conversation reuses its recorded system prompt
export const askInput = (prompt, { sessionId = null, transcripts = null } = {}) => `[${ASK_NOTE}${sessionId ? ' You are a copy of the session: the session itself goes on untouched and will not see this exchange.'
  : transcripts ? ` Earlier sessions of this project are JSONL transcripts in ${transcripts} : search them with Grep and never read one whole.` : ''}]\n\n${prompt}`;
export const askArgs = ({ sessionId = null, addDirs = [] } = {}) => ['-p', '--permission-mode', 'dontAsk', '--tools', 'Read,Grep,Glob', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json',
  ...(sessionId ? ['--resume', sessionId, '--fork-session'] : []), ...addDirs.flatMap((d) => ['--add-dir', d])];
// claude -p --output-format json → what the page shows
export function parseAskResult(stdout) {
  let o = null; try { o = JSON.parse(stdout); } catch { return null; }
  if (!o || typeof o !== 'object' || typeof o.result !== 'string') return null;
  const models = o.modelUsage && typeof o.modelUsage === 'object' ? Object.keys(o.modelUsage) : [];
  return { ok: !o.is_error, answer: o.result.slice(0, MAX_ANSWER), cut: o.result.length > MAX_ANSWER, usd: typeof o.total_cost_usd === 'number' ? o.total_cost_usd : null, model: models[0] || null };
}

const newId = () => `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`;
const children = new Map();   // ask id → child process (this server's own)
const tail = (s, n = 3) => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').trim().split('\n').filter(Boolean).slice(-n).join(' · ').slice(0, 400);

// the asks, newest first; one that has been "running" for longer than a run can take lost its process (the dashboard
// restarted): it shows as failed instead of spinning forever
export function listAsks(projectDir, now = Date.now(), timeoutMs = ASK_TIMEOUT_MS) {
  return records(asksDir(projectDir)).slice(0, SHOWN_ASKS).map((r) => (r.status === 'running' && now - r.at > timeoutMs + 60e3
    ? { ...r, status: 'failed', error: 'no answer: the dashboard restarted while this ran; ask again' } : r));
}

// starts the run and returns at once: { ok, id }; the record changes to done | failed when the process ends
export function ask(projectDir, input, { bin, env = process.env, timeoutMs = ASK_TIMEOUT_MS, addDirs = [], transcripts = null, sessionName = null, onDone = () => {} } = {}) {
  const c = checkPrompt(input && input.prompt); if (c.error) return { error: c.error, code: 400 };
  const sessionId = (input && input.sessionId) || null;
  if (sessionId && !SESSION_RE.test(sessionId)) return { error: 'invalid session id', code: 400 };
  if (records(asksDir(projectDir)).filter((r) => r.status === 'running' && children.has(r.id)).length >= MAX_RUNNING) return { error: 'three questions are already running: wait for an answer', code: 409 };
  const id = newId(), file = path.join(asksDir(projectDir), `${id}.json`), t0 = Date.now();
  const rec = { id, at: t0, prompt: c.prompt, sessionId, sessionName: sessionName ? String(sessionName).slice(0, 120) : null, status: 'running' };
  writeJson(file, rec); prune(asksDir(projectDir), KEEP_ASKS);
  const finish = (patch) => {
    children.delete(id);
    if (!fs.existsSync(file)) return;   // dismissed while it ran
    try { writeJson(file, { ...rec, ...patch, ms: Date.now() - t0 }); } catch { /* read-only project: the page keeps "running" until it times out */ }
    onDone();
  };
  let child;
  // the helper run must not page the phone nor wait on the dashboard: the project's hooks see these two switches
  try { child = spawn(bin, askArgs({ sessionId, addDirs: sessionId ? [] : addDirs }), { cwd: projectDir, env: { ...env, AI_TEAM_ASK: '0', AI_TEAM_NOTIFY: '0' }, stdio: ['pipe', 'pipe', 'pipe'] }); }
  catch (e) { finish({ status: 'failed', error: `could not run claude: ${e.message}` }); return { ok: true, id }; }
  children.set(id, child);
  let out = '', err = '', timedOut = false, done = false;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs); timer.unref?.();
  child.stdout.on('data', (d) => { if (out.length < 8e6) out += d; });
  child.stderr.on('data', (d) => { if (err.length < 1e5) err += d; });
  const end = (patch) => { if (done) return; done = true; clearTimeout(timer); finish(patch); };
  child.on('error', (e) => end({ status: 'failed', error: `could not run claude: ${e.message}` }));
  child.on('close', (code) => {
    const r = parseAskResult(out);
    if (timedOut) return end({ status: 'failed', error: `no answer after ${Math.round(timeoutMs / 60e3)} min` });
    if (!r) return end({ status: 'failed', error: tail(err) || tail(out) || `claude exited with code ${code}` });
    end(r.ok ? { status: 'done', answer: r.answer, cut: r.cut, usd: r.usd, model: r.model } : { status: 'failed', error: r.answer.slice(0, 600) || 'claude reported an error', usd: r.usd });
  });
  child.stdin.on('error', () => { /* the process died before reading: `close` reports it */ });
  child.stdin.end(askInput(c.prompt, { sessionId, transcripts: sessionId ? null : transcripts }));
  return { ok: true, id };
}

// removes one answer (or all of them); a question still running is stopped
export function dismiss(projectDir, input) {
  const ids = input && input.all === true ? records(asksDir(projectDir)).map((r) => r.id) : [input && input.id];
  if (!ids.every((id) => typeof id === 'string' && ASK_ID_RE.test(id))) return { error: 'invalid id', code: 400 };
  for (const id of ids) {
    try { fs.unlinkSync(path.join(asksDir(projectDir), `${id}.json`)); } catch { /* already gone */ }
    const ch = children.get(id); if (ch) { children.delete(id); try { ch.kill('SIGTERM'); } catch { /* already over */ } }
  }
  return { ok: true, removed: ids.length };
}

// ---- start and send ---------------------------------------------------------------------------------------------
export const startArgs = ({ prompt }) => ['--bg', '--', prompt];
export const sendArgs = ({ sessionId, prompt }) => ['--bg', '--resume', sessionId, '--', prompt];
// "backgrounded · ab00bbd7 · name" on stdout; on stderr, "… so this started a copy as 468f56c6" when the CLI did not
// continue the session itself
export function parseBackgrounded(stdout, stderr = '') {
  const m = /backgrounded\s+\S\s+([0-9a-z]{6,16})(?:\s+\S\s+([^\n]+))?/.exec(String(stdout));
  if (!m) return null;
  return { id: m[1], name: m[2] ? m[2].trim() : null, copy: /started a copy as/.test(String(stderr)) };
}
const run = (bin, args, { cwd, env, timeout = 60e3 }) => new Promise((resolve) => {
  execFile(bin, args, { cwd, env, timeout, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, stdout: String(stdout || ''), stderr: String(stderr || '') }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

export const listStarted = (projectDir) => records(startedDir(projectDir)).slice(0, KEEP_STARTED);
// was this session started (or woken) from the dashboard? by its id, or by the job id, which is the id's first block
export function startedMatcher(started) {
  const full = new Set(started.map((s) => s.sessionId).filter(Boolean)), short = new Set(started.filter((s) => !s.sessionId).map((s) => s.id));
  return (sessionId) => full.has(sessionId) || short.has(String(sessionId).split('-')[0]);
}
function remember(projectDir, rec) {
  try { writeJson(path.join(startedDir(projectDir), `${rec.id}.json`), rec); prune(startedDir(projectDir), KEEP_STARTED); } catch { /* read-only project: the session runs anyway */ }
}
// the session id of a job the supervisor has just started (its pid file appears a moment later)
async function sessionOfJob(claudeDir, jobId, waitMs = 3000) {
  for (const until = Date.now() + waitMs; ;) {
    for (const [sid, p] of liveSessions(claudeDir)) if (p.jobId === jobId) return sid;
    if (Date.now() >= until) return null;
    await sleep(150);
  }
}

const busy = new Set();   // one start or send per project at a time
async function exclusive(projectDir, fn) {
  if (busy.has(projectDir)) return { error: 'another session is being started: try again in a moment', code: 409 };
  busy.add(projectDir);
  try { return await fn(); } finally { busy.delete(projectDir); }
}

// a new background session with this request; { ok, id, sessionId, name } (id = what `claude attach` takes)
export function start(projectDir, input, { bin, env = process.env, claudeDir = path.join(os.homedir(), '.claude'), waitMs = 3000 } = {}) {
  const c = checkPrompt(input && input.prompt); if (c.error) return { error: c.error, code: 400 };
  const team = !(input && input.team === false) && hasTeamSkill(projectDir);
  const prompt = team ? teamPrompt(c.prompt) : c.prompt;
  return exclusive(projectDir, async () => {
    const r = await run(bin, startArgs({ prompt }), { cwd: projectDir, env });
    const b = r.ok ? parseBackgrounded(r.stdout, r.stderr) : null;
    if (!b) return { error: `claude --bg did not start the session: ${tail(r.stderr) || tail(r.stdout) || `exit ${r.code}`}`, code: 502 };
    const sessionId = await sessionOfJob(claudeDir, b.id, waitMs);
    const rec = { id: b.id, sessionId, name: b.name, at: Date.now(), prompt: prompt.slice(0, 400), team };
    remember(projectDir, rec);
    return { ok: true, ...rec };
  });
}

// a message to a session nobody has open: continues it in the background; { ok, id, copy }
export function send(projectDir, input, { bin, env = process.env, claudeDir = path.join(os.homedir(), '.claude'), waitMs = 3000 } = {}) {
  const c = checkPrompt(input && input.prompt); if (c.error) return { error: c.error, code: 400 };
  const sessionId = input && input.sessionId;
  if (!SESSION_RE.test(String(sessionId || ''))) return { error: 'invalid session id', code: 400 };
  return exclusive(projectDir, async () => {
    const p = liveSessions(claudeDir).get(sessionId) || null;
    if (p && p.kind !== 'bg') return { error: 'this session is open in a terminal or in the app: write to it there (a question can be asked from here)', code: 409 };
    if (p && p.status && p.status !== 'idle') return { error: `the session is ${p.status === 'busy' ? 'working' : 'waiting for an answer'}: a message can go in when its turn ends`, code: 409 };
    if (p) {   // idle in the background: the CLI would start a copy of a session that is still running
      if (!p.jobId) return { error: 'this background session has no job id: open it with claude attach', code: 409 };
      const s = await run(bin, ['stop', p.jobId], { cwd: projectDir, env });
      if (!s.ok) return { error: `could not stop the idle session first: ${tail(s.stderr) || tail(s.stdout)}`, code: 502 };
      for (const until = Date.now() + waitMs; alive(p.pid) && Date.now() < until;) await sleep(100);
    }
    const r = await run(bin, sendArgs({ sessionId, prompt: c.prompt }), { cwd: projectDir, env });
    const b = r.ok ? parseBackgrounded(r.stdout, r.stderr) : null;
    if (!b) return { error: `claude --bg --resume did not continue the session: ${tail(r.stderr) || tail(r.stdout) || `exit ${r.code}`}`, code: 502 };
    // a copy has a session id of its own, which the job's pid file tells
    const sid = b.copy ? await sessionOfJob(claudeDir, b.id, waitMs) : sessionId;
    remember(projectDir, { id: b.id, sessionId: sid, name: b.name, at: Date.now(), prompt: c.prompt.slice(0, 400), team: false, resumed: sessionId });
    return { ok: true, id: b.id, sessionId: sid, copy: b.copy };
  });
}

// stops a background session (its conversation is kept: a message from here, or claude attach, wakes it)
export async function stop(projectDir, input, { bin, env = process.env, claudeDir = path.join(os.homedir(), '.claude') } = {}) {
  const sessionId = input && input.sessionId;
  if (!SESSION_RE.test(String(sessionId || ''))) return { error: 'invalid session id', code: 400 };
  const p = liveSessions(claudeDir).get(sessionId) || null;
  if (!p) return { error: 'this session is not running', code: 409 };
  if (p.kind !== 'bg' || !p.jobId) return { error: 'only a background session is stopped from here', code: 409 };
  const s = await run(bin, ['stop', p.jobId], { cwd: projectDir, env });
  return s.ok ? { ok: true, id: p.jobId } : { error: `claude stop failed: ${tail(s.stderr) || tail(s.stdout)}`, code: 502 };
}

// what /api/state carries (collect.mjs): cheap, files only
export function launchView(projectDir, { env = process.env, now = Date.now() } = {}) {
  const a = availability(env);
  return { enabled: a.enabled, reason: a.enabled ? null : a.reason, team: hasTeamSkill(projectDir), asks: listAsks(projectDir, now), started: listStarted(projectDir).map(({ id, sessionId, name, at }) => ({ id, sessionId, name, at })) };
}
