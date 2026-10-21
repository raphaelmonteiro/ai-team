#!/usr/bin/env bash
# ai-team — hook opcional do painel. Registra início e fim de cada subagente em
# .claude/ai-team/events.jsonl, para o painel marcar os tempos com precisão
# (sem o hook ele usa os timestamps dos transcripts, que bastam na maioria
# dos casos). Em .claude/settings.json:
#
#   "hooks": {
#     "SubagentStart": [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}],
#     "SubagentStop":  [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}]
#   }
set -u
IN="$(cat)"
DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/ai-team"
mkdir -p "$DIR"
# extrai campos simples do JSON sem depender de jq
field() { printf '%s' "$IN" | sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" | head -1; }
printf '{"ts":"%s","event":"%s","agent_id":"%s","agent_type":"%s","session_id":"%s"}\n' \
  "$(date -u +%Y-%m-%dT%H:%M:%S.000Z)" "$(field hook_event_name)" "$(field agent_id)" "$(field agent_type)" "$(field session_id)" \
  >> "$DIR/events.jsonl"
exit 0
