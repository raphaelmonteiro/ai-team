#!/usr/bin/env bash
# ai-team — hook do projeto. Só repassa para o hook.mjs (lógica e documentação lá); fica com este
# nome porque é o que os settings.json instalados chamam. Sem node, não faz nada.
# Em .claude/settings.json:
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
