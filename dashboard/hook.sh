#!/usr/bin/env bash
# ai-team — project hook. Only hands off to hook.mjs (logic and docs there); keeps this
# name because it is what the installed settings.json files call.
# Node: AI_TEAM_NODE (if set, only that binary), then `node` on PATH, then the usual places the
# desktop app's PATH misses (nvm, volta, fnm, Homebrew, /usr/local). Without node it writes
# .claude/ai-team/hook-no-node (the dashboard shows the warning) and exits 0; once node is found
# again, the marker goes away.
# In .claude/settings.json:
#
#   "hooks": {
#     "SubagentStart":       [{"hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh\""}]}],
#     "SubagentStop":        [{"hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh\""}]}],
#     "SessionStart":        [{"hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh\""}]}],
#     "UserPromptExpansion": [{"hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh\""}]}],
#     "Stop":                [{"hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh\"", "timeout": 3600}]}],
#     "StopFailure":         [{"hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh\""}]}],
#     "SessionEnd":          [{"hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh\"", "timeout": 10}]}],
#     "PreToolUse":          [{"matcher": "Bash|Edit|Write|MultiEdit|NotebookEdit", "hooks": [{"type": "command", "command": "\"$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh\""}]}]
#   }
# Each team agent also calls it from its own frontmatter (hooks: PreCompact) as `hook.sh compact <role>`:
# the arguments reach hook.mjs.
H="${0%/*}/hook.mjs"
[[ -f "$H" ]] || exit 0
MARK="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/ai-team/hook-no-node"
# the app's PATH may lack even rm and mkdir; the marker records the PATH as it came
SEEN="$PATH"; PATH="$PATH:/usr/bin:/bin"

find_node() {
  if [[ -n "${AI_TEAM_NODE:-}" ]]; then [[ -x "$AI_TEAM_NODE" ]] && printf '%s' "$AI_TEAM_NODE"; return; fi
  if command -v node >/dev/null 2>&1; then printf '%s' node; return; fi
  local c
  for c in "$HOME"/.nvm/versions/node/*/bin/node "$HOME"/.volta/bin/node "$HOME"/.local/share/fnm/aliases/default/bin/node \
           /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [[ -x "$c" ]] && { printf '%s' "$c"; return; }
  done
}
NODE="$(find_node)"
if [[ -n "$NODE" ]]; then
  [[ -e "$MARK" ]] && rm -f "$MARK" 2>/dev/null
  exec "$NODE" "$H" "$@"
fi
# no node anywhere: leave a marker for the dashboard (never fails the hook)
{ mkdir -p "${MARK%/*}" && printf '{"since":"%s","path":"%s"}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SEEN//\"/\\\"}" > "$MARK"; } 2>/dev/null
exit 0
