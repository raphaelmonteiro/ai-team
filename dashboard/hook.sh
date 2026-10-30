#!/usr/bin/env bash
# ai-team — project hook. Only hands off to hook.mjs (logic and docs there); keeps this
# name because it is what the installed settings.json files call. Without node, does nothing.
# In .claude/settings.json:
#
#   "hooks": {
#     "SubagentStart":       [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}],
#     "SubagentStop":        [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}],
#     "SessionStart":        [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}],
#     "UserPromptExpansion": [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}],
#     "Stop":                [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh", "timeout": 3600}]}],
#     "StopFailure":         [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}],
#     "SessionEnd":          [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh", "timeout": 10}]}]
#   }
H="${0%/*}/hook.mjs"
if command -v node >/dev/null 2>&1 && [[ -f "$H" ]]; then exec node "$H"; fi
exit 0
