#!/usr/bin/env node
// ai-team — adds the missing dashboard hooks to .claude/settings.json, without touching the rest.
//
//   node .claude/dashboard/settings.mjs [--dry-run] [--file PATH] [--events A,B,...] [--allow RULE ...]
//
// Default: all dashboard events, the PreToolUse guard (hook.sh next to this file) and
// SessionStart/UserPromptExpansion only if the /team skill exists.
// --allow (repeatable) adds a permissions.allow rule when it is missing (e.g. a read-only command the agents run).
// An event counts as already on if one of its hooks calls the same script (hook.sh / ask.mjs), with
// any path. Before writing it keeps the previous version in settings.json.bak-ai-team. Invalid
// JSON (e.g. with comments): does not write and prints the snippet to paste by hand.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// quoted: a project path with a space must reach bash as one argument
const HOOK_SH = '"$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"';
export const HOOKS = {
  SubagentStart: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
  SubagentStop: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
  // Stop: in away mode the hook waits for the end-of-turn answer (up to 3300 s)
  Stop: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH, timeout: 3600 } },
  StopFailure: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
  // SessionEnd has 1.5 s by default; its own timeout leaves time for the send to ntfy
  SessionEnd: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH, timeout: 10 } },
  PermissionRequest: { script: 'ask.mjs', hook: { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/dashboard/ask.mjs"', timeout: 3600 } },
  SessionStart: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
  UserPromptExpansion: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
  // guard of the team's subagents (guard.mjs): only the tools it judges
  PreToolUse: { script: 'hook.sh', matcher: 'Bash|Edit|Write|MultiEdit|NotebookEdit', hook: { type: 'command', command: HOOK_SH } },
};
export const DASHBOARD_EVENTS = ['SubagentStart', 'SubagentStop', 'Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest'];
export const TEAM_EVENTS = ['SessionStart', 'UserPromptExpansion'];
export const GUARD_EVENTS = ['PreToolUse'];

const ours = (entries, script) => (Array.isArray(entries) ? entries : []).flatMap((e) => (Array.isArray(e && e.hooks) ? e.hooks : []))
  .filter((h) => typeof (h && h.command) === 'string' && h.command.includes(`dashboard/${script}`));

// returns { settings, added, updated } without changing the given object; updated = our hook with a timeout below what is needed
export function mergeHooks(settings, events) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  if (!out.hooks || typeof out.hooks !== 'object' || Array.isArray(out.hooks)) out.hooks = {};
  const added = [], updated = [];
  for (const ev of events) {
    const def = HOOKS[ev]; if (!def) continue;
    const mine = ours(out.hooks[ev], def.script);
    if (mine.length) {
      if (def.hook.timeout && mine.some((h) => !(Number(h.timeout) >= def.hook.timeout))) { for (const h of mine) if (!(Number(h.timeout) >= def.hook.timeout)) h.timeout = def.hook.timeout; updated.push(ev); }
      continue;
    }
    out.hooks[ev] = [...(Array.isArray(out.hooks[ev]) ? out.hooks[ev] : []), { ...(def.matcher ? { matcher: def.matcher } : {}), hooks: [{ ...def.hook }] }];
    added.push(ev);
  }
  return { settings: out, added, updated };
}

export function snippet(events) {
  return JSON.stringify({ hooks: Object.fromEntries(events.filter((e) => HOOKS[e]).map((e) => [e, [{ ...(HOOKS[e].matcher ? { matcher: HOOKS[e].matcher } : {}), hooks: [HOOKS[e].hook] }]])) }, null, 2);
}

// returns { settings, allowed } without changing the given object; allowed = rules added to permissions.allow
export function mergeAllow(settings, rules) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  if (!out.permissions || typeof out.permissions !== 'object' || Array.isArray(out.permissions)) out.permissions = {};
  if (!Array.isArray(out.permissions.allow)) out.permissions.allow = [];
  const allowed = rules.filter((r) => !out.permissions.allow.includes(r));
  out.permissions.allow.push(...allowed);
  if (!out.permissions.allow.length) delete out.permissions.allow;
  if (!Object.keys(out.permissions).length) delete out.permissions;
  return { settings: out, allowed };
}

// updates the file; returns { added, updated, allowed, wrote, error? }
export function updateFile(file, events, { dryRun = false, allow = [] } = {}) {
  let cur = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    try { cur = raw.trim() ? JSON.parse(raw) : {}; } catch (e) { return { added: [], wrote: false, error: `invalid JSON in ${file}: ${e.message}` }; }
  }
  const hooked = mergeHooks(cur, events);
  const { added, updated } = hooked;
  const { settings, allowed } = allow.length ? mergeAllow(hooked.settings, allow) : { settings: hooked.settings, allowed: [] };
  const res = allow.length ? { added, updated, allowed } : { added, updated };
  if ((!added.length && !updated.length && !allowed.length) || dryRun) return { ...res, wrote: false };
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-ai-team`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { ...res, wrote: true };
}

function main(argv) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const claudeDir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude');
  const file = path.resolve(opt('--file') || path.join(claudeDir, 'settings.json'));
  const teamSkill = fs.existsSync(path.join(path.dirname(file), 'skills', 'team', 'SKILL.md'));
  const hookSh = fs.existsSync(path.join(path.dirname(file), 'dashboard', 'hook.sh'));
  const events = argv.includes('--events') ? (opt('--events') || '').split(',').map((s) => s.trim()).filter(Boolean) : [...DASHBOARD_EVENTS, ...(hookSh ? GUARD_EVENTS : []), ...(teamSkill ? TEAM_EVENTS : [])];
  const allow = argv.flatMap((a, i) => (a === '--allow' && argv[i + 1] ? [argv[i + 1]] : []));
  const unknown = events.filter((e) => !HOOKS[e]);
  if (unknown.length) { console.error(`unknown event: ${unknown.join(', ')} (known: ${Object.keys(HOOKS).join(', ')})`); process.exit(2); }
  const dry = argv.includes('--dry-run');
  const r = updateFile(file, events, { dryRun: dry, allow });
  if (r.error) { console.error(`${r.error}\nnot changed; add by hand under "hooks":\n${snippet(events)}`); process.exit(1); }
  const what = [r.added.length ? `added ${r.added.join(', ')}` : '', r.updated.length ? `timeout adjusted in ${r.updated.join(', ')}` : '',
    r.allowed && r.allowed.length ? `allowed ${r.allowed.join(', ')}` : ''].filter(Boolean).join('; ');
  if (!what) { console.log(`${file}: dashboard hooks${allow.length ? ' and permissions' : ''} already there (${[...events, ...allow].join(', ')})`); return; }
  console.log(dry ? `${file}: would do: ${what}` : `${file}: ${what} (previous copy in settings.json.bak-ai-team); open a new session for it to take effect`);
}

// realpath: on macOS /var is a link to /private/var (import.meta.url is already resolved)
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
