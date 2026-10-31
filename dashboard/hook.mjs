#!/usr/bin/env node
// ai-team — project hook (called by hook.sh). Writes events to .claude/ai-team/events.jsonl:
//   SubagentStart/SubagentStop  start and end of each subagent (exact times in the dashboard;
//                               without them the dashboard uses the transcript timestamps)
//   UserPromptExpansion /team or /onboarding and SessionStart with agent_type=orchestrator
//                               mark the session as a team session (TeamStart event)
//   SessionStart source=compact in a session marked by /team or /onboarding: writes the role
//                               reminder to stdout, which goes into the compacted context
//   SubagentStop and Stop       phone notification (notify.mjs, ntfy), in the background,
//                               only if ~/.config/ai-team/notify.json exists
//   Stop with away mode on (.claude/ai-team/away.json): ask.mjs waits for the end-of-turn answer
//                               from the dashboard and returns {"decision":"block"} (the Stop timeout must be 3600)
//   StopFailure and SessionEnd  same, but waiting for the send (on SessionEnd Claude Code is
//                               exiting and a background process may not finish)
// events.jsonl rotates past AI_TEAM_EVENTS_MAX_BYTES (default 1 MiB): it becomes events.jsonl.1 (the previous
// generation is replaced) and the new file starts with the TeamStart lines (one per session, up to half the limit).
// Never fails the hook: any error exits with 0 and no output.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REMINDER = `ai-team reminder: in this session you are the team's orchestrator (called with /team or /onboarding).
Reread \`.claude/agents/orchestrator.md\` now and follow it as your system prompt:
coordinate and delegate to the team's agents, do not edit files or run commands that
change the repository. Do not restart the request: continue from where the conversation
summary stopped (changes and ad-hoc tasks in progress, background agents, what is waiting
on the user).
`;

const str = (v) => (typeof v === 'string' ? v : '');

const DEFAULT_MAX_BYTES = 1024 * 1024, LOCK_STALE_MS = 30e3;
const maxBytes = (env) => { const n = Number(env.AI_TEAM_EVENTS_MAX_BYTES); return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_BYTES; };

// TeamStart lines of `text`: the last line of each session_id, newest first, up to `budget` bytes
// (returned in chronological order)
function teamStarts(text, budget) {
  const last = new Map();
  for (const l of text.split('\n')) {
    if (!l.includes('"event":"TeamStart"')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o && o.event === 'TeamStart' && typeof o.session_id === 'string' && o.session_id) { last.delete(o.session_id); last.set(o.session_id, l); }
  }
  const keep = []; let used = 0;
  for (const l of [...last.values()].reverse()) {
    const n = Buffer.byteLength(l) + 1;
    if (used + n > budget) break;
    keep.push(l); used += n;
  }
  return keep.reverse().map((l) => l + '\n').join('');
}

// Rotates the log if it passed the limit. Exclusive lock next to the file (wx): whoever does not get it just writes.
// A lock older than LOCK_STALE_MS is abandoned and taken over (unlink + wx). Accepted risk (design.md PV-3): two
// hooks taking over the same lock at the same instant may both rotate and lose the freshly created .1 generation.
// The rename is atomic and the new file only gets appends, so no line is lost; whoever already had
// the file open writes to the .1 generation, which the dashboard also reads. Never throws.
function rotate(log, limit) {
  const lock = log + '.lock';
  try {
    if (fs.statSync(log).size <= limit) return;
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (e) {
      if (!e || e.code !== 'EEXIST') return;
      try { if (Date.now() - fs.statSync(lock).mtimeMs <= LOCK_STALE_MS) return; fs.unlinkSync(lock); fd = fs.openSync(lock, 'wx'); } catch { return; }
    }
    try {
      if (fs.statSync(log).size <= limit) return;   // another hook rotated between the check and the lock
      fs.renameSync(log, log + '.1');
      const carried = teamStarts(fs.readFileSync(log + '.1', 'utf8'), Math.floor(limit / 2));
      if (carried) fs.appendFileSync(log, carried);
    } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch {} }
  } catch { /* no write access or the file vanished: the hook does not fail */ }
}

// raw: the hook JSON, as it came on stdin (passed intact to notify.mjs and ask.mjs)
export function runHook(raw, { env = process.env, now = () => new Date().toISOString() } = {}) {
  let h; try { h = JSON.parse(raw || '{}'); } catch { return { out: '' }; }
  if (!h || typeof h !== 'object') return { out: '' };
  const dir = path.join(env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'ai-team');
  const log = path.join(dir, 'events.jsonl');
  const ev = str(h.hook_event_name), sid = str(h.session_id);
  const logline = (o) => {
    try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(log, JSON.stringify(o) + '\n'); } catch { return; }   // no write access: go on without writing
    rotate(log, maxBytes(env));
  };
  const team = (via) => logline({ ts: now(), event: 'TeamStart', session_id: sid, via });
  const notifyFile = env.AI_TEAM_NOTIFY_FILE || path.join(env.HOME || '', '.config', 'ai-team', 'notify.json');
  const canNotify = () => env.AI_TEAM_NOTIFY !== '0' && fs.existsSync(notifyFile) && fs.existsSync(path.join(here, 'notify.mjs'));
  const result = { out: '', notify: null };   // notify: 'bg' (does not hold the hook) | 'fg' (waits for the send; notify.mjs gives up after 5 s)

  switch (ev) {
    case 'SubagentStart': case 'SubagentStop':
      logline({ ts: now(), event: ev, agent_id: str(h.agent_id), agent_type: str(h.agent_type), session_id: sid });
      if (ev === 'SubagentStop' && canNotify()) result.notify = 'bg';
      break;
    case 'Stop': {
      // away mode (dashboard): with a question at the end of the turn, ask.mjs holds the turn until the answer
      // from the dashboard and already sends the decision notice; without a question (or without the mode), just the usual notice
      const ask = path.join(here, 'ask.mjs');
      if (fs.existsSync(path.join(dir, 'away.json')) && fs.existsSync(ask)) {
        const r = spawnSync(process.execPath, [ask], { input: raw, env, stdio: ['pipe', 'pipe', 'ignore'] });
        const out = r.stdout ? r.stdout.toString() : '';
        if (out) return { out };
        if (r.status === 3) return { out: '' };   // asked through the dashboard and nobody answered: the notice already went out
      }
      if (canNotify()) result.notify = 'bg';
      break;
    }
    case 'StopFailure': case 'SessionEnd':
      if (canNotify()) result.notify = 'fg';
      break;
    case 'UserPromptExpansion':
      { const cmd = str(h.command_name).replace(/^\//, ''); if (cmd === 'team' || cmd === 'onboarding') team(cmd); }
      break;
    case 'SessionStart':
      if (str(h.agent_type)) {
        // --agent: the agent prompt is the system prompt and survives compaction; just mark
        if (h.source === 'startup' && h.agent_type === 'orchestrator') team('agent');
      } else if (h.source === 'compact' && sid) {
        const needle = `"event":"TeamStart","session_id":${JSON.stringify(sid)}`;   // both generations, and only them
        for (const f of [log, log + '.1']) {
          let text = ''; try { text = fs.readFileSync(f, 'utf8'); } catch {}
          if (text.includes(needle)) { result.out = REMINDER; break; }
        }
      }
      break;
  }
  return result;
}

function sendNotify(raw, mode, env) {
  const args = [path.join(here, 'notify.mjs'), 'hook'];
  if (mode === 'fg') { spawnSync(process.execPath, args, { input: raw, env, stdio: ['pipe', 'ignore', 'ignore'] }); return Promise.resolve(); }
  const child = spawn(process.execPath, args, { env, detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  child.on('error', () => {});
  child.unref();
  return new Promise((done) => { child.stdin.on('error', done); child.stdin.end(raw, done); });
}

// realpath: on macOS /var is a link to /private/var (import.meta.url is already resolved)
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let raw = ''; try { raw = fs.readFileSync(0, 'utf8'); } catch {}
  let r = { out: '' };
  try { r = runHook(raw); } catch {}
  if (r.out) process.stdout.write(r.out);
  if (r.notify) await sendNotify(raw, r.notify, process.env).catch(() => {});
  process.exitCode = 0;
}
