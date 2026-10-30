#!/usr/bin/env node
// ai-team — pending decisions answered through the dashboard.
//
// As a hook (PermissionRequest in .claude/settings.json):
//   node "$CLAUDE_PROJECT_DIR/.claude/dashboard/ask.mjs"
// writes .claude/ai-team/pending/<id>.json and waits for .claude/ai-team/answers/<id>.json, which the dashboard
// writes (POST /api/answer). The app shows its own dialog at the same time: whoever answers first wins.
// The hook gives up and exits without a decision (normal app flow) when:
//   - the call got a tool_result in the transcript (answered in the app);
//   - AI_TEAM_ASK_WAIT_S passed (default 280 s) or, with away mode on, AI_TEAM_AWAY_WAIT_S
//     (default 3300 s); the hook timeout in settings.json (3600) must be larger.
// Question (AskUserQuestion): the answer goes in updatedInput.answers, key = question text.
// Command, edit etc.: allow (once) or deny (with a reason, which goes back to Claude).
// AI_TEAM_ASK=0 turns it off (exits at once, no pending item). A background subagent has no dialog:
// the dashboard is the only place to approve, and with no answer the call is denied (as without the hook).
//
// Away mode (.claude/ai-team/away.json, turned on by the dashboard): in the Stop hook, if the turn
// ends with the end-of-turn question (the app's wrap_up), the hook holds the end of the turn and waits for the
// answer from the dashboard; the answer comes back as {"decision":"block","reason":…}, and Claude goes on as
// if the user had answered. While it waits, the app shows the session running, without its buttons.
// With no answer in time, or with the mode turned off midway, the turn ends normally.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastAsk } from './plan.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9-]{5,63}$/;
export const pendingDir = (projectDir) => path.join(projectDir, '.claude', 'ai-team', 'pending');
export const answersDir = (projectDir) => path.join(projectDir, '.claude', 'ai-team', 'answers');
export const DEFAULT_WAIT_S = 280;
export const awayFile = (projectDir) => path.join(projectDir, '.claude', 'ai-team', 'away.json');
export function getAway(projectDir) { const a = readJsonSafe(awayFile(projectDir)); return a && a.on ? { on: true, since: a.since || null } : { on: false, since: null }; }
// how long the hook waits; reread on every loop, so turning away mode on or off midway takes effect at once
export const AWAY_WAIT_S = 3300;   // ~55 min; the hooks timeout in settings.json (3600) must be larger
export const waitMs = (projectDir) => (getAway(projectDir).on
  ? Number(process.env.AI_TEAM_AWAY_WAIT_S) || AWAY_WAIT_S
  : Number(process.env.AI_TEAM_ASK_WAIT_S) || DEFAULT_WAIT_S) * 1000;
export function setAway(projectDir, on) {
  const f = awayFile(projectDir);
  if (on) writeAtomic(f, JSON.stringify({ on: true, since: Date.now() })); else { try { fs.unlinkSync(f); } catch {} }
  return getAway(projectDir);
}
function readJsonSafe(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeAtomic = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));

// what the dashboard needs to show, without the whole input of big tools (Write/Edit)
export function describe(toolName, input = {}) {
  if (toolName === 'AskUserQuestion') return { kind: 'question', questions: (input.questions || []).map((q) => ({
    question: String(q.question || ''), header: String(q.header || ''), multiSelect: !!q.multiSelect,
    options: (q.options || []).map((o) => ({ label: String(o.label || ''), description: String(o.description || '') })) })) };
  const s = (x, n = 2000) => (x == null ? '' : String(x).slice(0, n));
  const summary = toolName === 'Bash' ? s(input.command)
    : input.file_path ? s(input.file_path) : input.url ? s(input.url) : input.path ? s(input.path) : s(JSON.stringify(input), 600);
  return { kind: 'permission', summary, detail: s(input.description, 300) };
}

// live pending items (hook still running); orphans (dead hook) leave the disk
export function listPending(projectDir) {
  const dir = pendingDir(projectDir);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    const p = readJson(path.join(dir, n));
    if (!p || !ID_RE.test(p.id || '')) continue;
    if (p.pid && !alive(p.pid)) { try { fs.unlinkSync(path.join(dir, n)); } catch {} continue; }
    const { input, ...pub } = p;
    out.push(pub);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// dashboard answer: { id, behavior: 'allow'|'deny', message?, answers? }; returns { ok } or { error }
export function writeAnswer(projectDir, body) {
  const id = String((body && body.id) || '');
  if (!ID_RE.test(id)) return { error: 'invalid id' };
  const p = readJson(path.join(pendingDir(projectDir), `${id}.json`));
  if (!p) return { error: 'pending item no longer exists (answered in the app or expired)' };
  const behavior = body.behavior === 'deny' ? 'deny' : body.behavior === 'allow' ? 'allow' : null;
  if (!behavior) return { error: 'behavior must be allow or deny' };
  const a = { id, behavior, ts: Date.now() };
  if (behavior === 'deny') a.message = String(body.message || 'Denied by the ai-team dashboard.').slice(0, 1000);
  if (p.kind === 'reply') {   // end of turn: the text becomes the user's answer
    if (behavior === 'allow') {
      const txt = String(body.reply ?? '').trim();
      if (!txt) return { error: 'empty answer' };
      a.reply = txt.slice(0, 4000);
    }
  } else if (p.kind === 'question' && behavior === 'allow') {
    const answers = {};
    for (const q of p.questions) {
      const v = body.answers && body.answers[q.question];
      const txt = Array.isArray(v) ? v.map(String).filter(Boolean).join(', ') : String(v ?? '').trim();
      if (!txt) return { error: `no answer for "${q.question}"` };
      answers[q.question] = txt.slice(0, 2000);
    }
    a.answers = answers;
  }
  writeAtomic(path.join(answersDir(projectDir), `${id}.json`), JSON.stringify(a));
  return { ok: true };
}

// dashboard answer → PermissionRequest hook output
export function hookOutput(pending, answer, input) {
  if (pending.kind === 'reply') {   // Stop hook: block = Claude goes on, with the answer as the reason
    if (answer.behavior !== 'allow') return {};
    return { decision: 'block', reason: `The user answered through the ai-team dashboard (away from the computer): "${answer.reply}". Go on as if they had answered this in the session.` };
  }
  const decision = answer.behavior === 'deny'
    ? { behavior: 'deny', message: answer.message || 'Denied by the ai-team dashboard.' }
    : { behavior: 'allow', ...(pending.kind === 'question' ? { updatedInput: { ...input, answers: answer.answers } } : {}) };
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}

// was the call already resolved in the app? (tool_use equal to the request with a tool_result after it)
export function resolvedInTranscript(file, toolName, input, sinceMs) {
  let text = '';
  try {
    const st = fs.statSync(file), fd = fs.openSync(file, 'r'), len = Math.min(st.size, 2 * 1024 * 1024);
    const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { return false; }
  const want = stable(input);
  let id = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const c = r.message && Array.isArray(r.message.content) ? r.message.content : [];
    for (const b of c) {
      if (b.type === 'tool_use' && b.name === toolName && stable(b.input || {}) === want) id = b.id;
      else if (b.type === 'tool_result' && id && b.tool_use_id === id && Date.parse(r.timestamp || 0) >= sinceMs - 2000) return true;
    }
  }
  return false;
}

// away mode: did the turn end with a question? waits for the answer from the dashboard
async function runStop(h) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || h.cwd || process.cwd();
  if (!getAway(projectDir).on || !h.transcript_path) return;
  const ask = lastAsk(h.transcript_path);
  if (!ask || ask.kind !== 'wrap_up' || !ask.questions || !ask.questions.length) return;
  const ts = Date.now(), id = `${ts.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const q = ask.questions[0];
  const pending = { id, ts, pid: process.pid, sessionId: h.session_id || null, agentId: null, agentType: null, tool: 'end of turn', kind: 'reply',
    questions: [{ question: q.question, header: '', multiSelect: false, options: q.options.map((o) => ({ label: o.label, description: o.description || '' })) }],
    summary: String(h.last_assistant_message || '').slice(0, 1500) };
  const pf = path.join(pendingDir(projectDir), `${id}.json`), af = path.join(answersDir(projectDir), `${id}.json`);
  const cleanup = () => { for (const f of [pf, af]) { try { fs.unlinkSync(f); } catch {} } };
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  writeAtomic(pf, JSON.stringify(pending));
  import('./notify.mjs').then((m) => m.notify('decision', pending, { projectDir })).catch(() => {});
  try {
    while (Date.now() - ts < waitMs(projectDir)) {
      const a = readJson(af);
      if (a && a.id === id) { const out = hookOutput(pending, a); if (out.decision) process.stdout.write(JSON.stringify(out)); else process.exitCode = 3; return; }
      if (!getAway(projectDir).on) break;   // back at the computer: the turn ends and the app shows the question
      await new Promise((r) => setTimeout(r, 300));
    }
    process.exitCode = 3;   // no answer, but the notice already went: hook.sh does not send another
  } finally { cleanup(); }
}

async function runHook() {
  const raw = fs.readFileSync(0, 'utf8');
  let h; try { h = JSON.parse(raw || '{}'); } catch { return; }
  if (process.env.AI_TEAM_ASK !== '0' && h.hook_event_name === 'Stop') return runStop(h);
  if (h.hook_event_name !== 'PermissionRequest' || !h.tool_name) return;
  if (process.env.AI_TEAM_ASK === '0') return;   // off: only the app asks
  const projectDir = process.env.CLAUDE_PROJECT_DIR || h.cwd || process.cwd();
  const ts = Date.now();
  const id = `${ts.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const input = h.tool_input || {};
  const pending = { id, ts, pid: process.pid, sessionId: h.session_id || null, agentId: h.agent_id || null, agentType: h.agent_type || null,
    tool: h.tool_name, mode: h.permission_mode || null, cwd: h.cwd || null, ...describe(h.tool_name, input), input };
  const pf = path.join(pendingDir(projectDir), `${id}.json`), af = path.join(answersDir(projectDir), `${id}.json`);
  const cleanup = () => { for (const f of [pf, af]) { try { fs.unlinkSync(f); } catch {} } };
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  writeAtomic(pf, JSON.stringify(pending));
  import('./notify.mjs').then((m) => m.notify('decision', pending, { projectDir })).catch(() => {});   // phone (ntfy), without blocking
  const transcript = h.agent_transcript_path || h.transcript_path;
  let lastCheck = 0;
  try {
    while (Date.now() - ts < waitMs(projectDir)) {
      const a = readJson(af);
      if (a && a.id === id) { process.stdout.write(JSON.stringify(hookOutput(pending, a, input))); return; }
      if (transcript && Date.now() - lastCheck > 1500) { lastCheck = Date.now(); if (resolvedInTranscript(transcript, h.tool_name, input, ts)) return; }
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally { cleanup(); }
}

// realpath: on macOS /var is a link to /private/var (import.meta.url is already resolved)
// no top-level await: with it, whoever imports this module (collect.mjs, via notify.mjs) would be stuck
// until the decision was answered, and the notification would only go out afterwards
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) runHook().catch(() => {});
