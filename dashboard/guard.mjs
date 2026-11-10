// ai-team — PreToolUse guard for the team's subagents (called by hook.mjs).
// The agent files say what each role may not do; this turns the part that is a command
// or a file path into a refusal, so a compacted or confused agent cannot do it anyway.
// Only inside a subagent (`agent_type` in the hook input) and only for the team's roles:
// the user's session, the orchestrator and any other agent are untouched. AI_TEAM_GUARD=0 turns it off.
//
//   rule        who                              what is refused
//   readonly    reviewer, validator              any git subcommand that changes a repository or working tree
//   commit      builder, integrator, provisioner, spec-writer
//                                                `git add -A|--all|-u|.` and `--no-verify` (gate-and-commit: add by path, hooks on)
//   discard     builder, integrator, provisioner `git stash|restore|clean`, `reset --hard`, `checkout -- <path>`/`checkout .`, forced push
//   env         every team role                  `compose down -v|--volumes`, `docker volume rm|prune`, `find /`
//   files       reviewer, validator              Write/Edit/MultiEdit/NotebookEdit outside the role's files in openspec/changes/<id>/
//                                                (reviewer: review-report.md; validator: validation-report.md and tasks.md)
//
// A command is looked at piece by piece (split on && || ; | and newlines), so `cd x && git add -A`
// is refused and `git log | head` is not. It is a safety net, not a security boundary: an
// agent that wraps the command in `sh -c` or a script gets past it, as it would past the prose.
const ENV_RULES = [
  [/\b(?:docker[ -]compose|podman[ -]compose)\b.*\bdown\b.*(?:\s-v\b|\s--volumes\b)/, 'compose down -v removes the volumes of the main stack'],
  [/\bdocker\s+volume\s+(?:rm|prune)\b/, 'removing docker volumes'],
  [/(?:^|\s)find\s+\/(?:\s|$)/, '`find /`: search only in project folders'],
];
const MUTATING_GIT = new Set(['add', 'am', 'apply', 'branch', 'checkout', 'cherry-pick', 'clean', 'commit', 'merge', 'mv', 'pull', 'push',
  'rebase', 'reset', 'restore', 'revert', 'rm', 'stash', 'switch', 'tag', 'worktree']);
const READ_GIT_BRANCH = /^(?:\s+(?:-a|-r|--all|--list|-v|-vv|--show-current|--contains\s+\S+|--merged|--no-merged)?)*\s*$/;

export const ROLES = {
  builder: { rules: ['env', 'commit', 'discard'] },
  integrator: { rules: ['env', 'commit', 'discard'] },
  provisioner: { rules: ['env', 'commit', 'discard'] },
  'spec-writer': { rules: ['env', 'commit'] },
  reviewer: { rules: ['env', 'readonly'], files: ['review-report.md'] },
  validator: { rules: ['env', 'readonly'], files: ['validation-report.md', 'tasks.md'] },
};
const FILE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

const str = (v) => (typeof v === 'string' ? v : '');
const pieces = (cmd) => cmd.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);

// `git [-C dir] [-c k=v] [--opt] <sub> <rest>` → { sub, rest } or null
function gitCall(piece) {
  const m = /(?:^|\s)git(?:\s+(?:-C|-c|--git-dir|--work-tree)\s+\S+|\s+-{1,2}[\w=./:-]+)*\s+([a-z-]+)(.*)$/.exec(piece);
  return m ? { sub: m[1], rest: m[2] } : null;
}

function checkCommand(role, cmd) {
  for (const piece of pieces(cmd)) {
    if (role.rules.includes('env')) for (const [re, why] of ENV_RULES) if (re.test(piece)) return why;
    const g = gitCall(piece);
    if (!g) continue;
    const { sub, rest } = g;
    if (role.rules.includes('readonly') && MUTATING_GIT.has(sub) && !(sub === 'branch' && READ_GIT_BRANCH.test(rest)) && !(sub === 'stash' && /^\s+(?:list|show)\b/.test(rest)) && !(sub === 'worktree' && /^\s+list\b/.test(rest)))
      return `\`git ${sub}\` changes a repository or working tree; this role only reads (git show, log, diff, status, cat-file)`;
    if (role.rules.includes('commit')) {
      if (sub === 'add' && /(?:^|\s)(?:-A|--all|-u|--update|\.)(?:\s|$)/.test(rest)) return '`git add` only by path (`git add <file>`), never -A, --all, -u or .';
      if (/(?:^|\s)--no-verify\b/.test(rest)) return '`--no-verify` skips the hooks; run the gate and let them run';
    }
    if (role.rules.includes('discard')) {
      if (sub === 'stash' || sub === 'restore' || sub === 'clean') return `\`git ${sub}\` discards work; prohibited for this role`;
      if (sub === 'reset' && /(?:^|\s)--hard\b/.test(rest)) return '`git reset --hard` discards work; prohibited for this role';
      if (sub === 'checkout' && /(?:^|\s)(?:--|\.)(?:\s|$)/.test(rest)) return '`git checkout -- <path>` discards work; prohibited for this role';
      if (sub === 'push' && /(?:^|\s)(?:-f|--force|--force-with-lease(?:=\S+)?)(?:\s|$)/.test(rest)) return 'forced push is prohibited for this role';
    }
  }
  return null;
}

function checkFile(role, tool, input) {
  const file = str(input && (input.file_path || input.notebook_path)).replace(/\\/g, '/');
  if (!file) return null;
  const ok = role.files.some((f) => new RegExp(`(?:^|/)openspec/changes/[^/]+/${f.replace('.', '\\.')}$`).test(file));
  return ok ? null : `${tool} outside openspec/changes/<id>/${role.files.join('|')}: this role writes only ${role.files.length > 1 ? 'those files' : 'its report'}`;
}

// hook input (PreToolUse) → refusal reason, or null when the call may go on
export function guard(h, env = process.env) {
  if (env.AI_TEAM_GUARD === '0') return null;
  if (!h || typeof h !== 'object' || h.hook_event_name !== 'PreToolUse') return null;
  const role = ROLES[str(h.agent_type)];
  if (!role) return null;
  const tool = str(h.tool_name), input = h.tool_input && typeof h.tool_input === 'object' ? h.tool_input : {};
  let why = null;
  if (tool === 'Bash') why = checkCommand(role, str(input.command));
  else if (role.files && FILE_TOOLS.has(tool)) why = checkFile(role, tool, input);
  return why ? `ai-team guard (${h.agent_type}): ${why}. See .claude/agents/${h.agent_type}.md.` : null;
}

export const denyOutput = (reason) => JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
