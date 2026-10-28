#!/usr/bin/env bash
# ai-team — hook do projeto. Grava eventos em .claude/ai-team/events.jsonl:
#   SubagentStart/SubagentStop  início e fim de cada subagente (tempos exatos no painel;
#                               sem eles o painel usa os timestamps dos transcripts)
#   UserPromptExpansion /equipe e SessionStart com agent_type=tech-lead
#                               marcam a sessão como da equipe (evento TeamStart)
#   SessionStart source=compact numa sessão marcada pelo /equipe: escreve no stdout
#                               o lembrete do papel, que entra no contexto compactado
# Em .claude/settings.json:
#
#   "hooks": {
#     "SubagentStart":       [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}],
#     "SubagentStop":        [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}],
#     "SessionStart":        [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}],
#     "UserPromptExpansion": [{"hooks": [{"type": "command", "command": "$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh"}]}]
#   }
set -u
IN="$(cat)"
DIR="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/ai-team"
LOG="$DIR/events.jsonl"
# extrai campos simples do JSON sem depender de jq
field() { printf '%s' "$IN" | sed -nE "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/p" | head -1; }
EV="$(field hook_event_name)" SID="$(field session_id)"
now() { date -u +%Y-%m-%dT%H:%M:%S.000Z; }
logline() { mkdir -p "$DIR" && printf '%s\n' "$1" >> "$LOG"; }
team() { # via → TeamStart desta sessão
  logline "$(printf '{"ts":"%s","event":"TeamStart","session_id":"%s","via":"%s"}' "$(now)" "$SID" "$1")"
}
case "$EV" in
  SubagentStart|SubagentStop)
    logline "$(printf '{"ts":"%s","event":"%s","agent_id":"%s","agent_type":"%s","session_id":"%s"}' \
      "$(now)" "$EV" "$(field agent_id)" "$(field agent_type)" "$SID")" ;;
  UserPromptExpansion)
    cmd="$(field command_name)"; cmd="${cmd#/}"
    [[ "$cmd" == equipe ]] && team equipe ;;
  SessionStart)
    at="$(field agent_type)"
    if [[ -n "$at" ]]; then
      # --agent: o prompt do agente é o de sistema e sobrevive à compactação; só marca
      [[ "$(field source)" == startup && "$at" == tech-lead ]] && team agent
    elif [[ "$(field source)" == compact && -n "$SID" && -f "$LOG" ]] && \
         grep -q "\"event\":\"TeamStart\",\"session_id\":\"$SID\"" "$LOG"; then
      cat <<'EOF'
Lembrete do ai-team: nesta sessão você é o tech-lead da equipe (chamado com /equipe).
Releia agora `.claude/agents/tech-lead.md` e siga-o como o seu prompt de sistema:
coordene e delegue aos agentes da equipe, não edite arquivos nem rode comandos que
alterem o repositório. Não recomece o pedido: continue de onde o resumo da conversa
parou (changes e tarefas avulsas em andamento, agentes em segundo plano, o que espera
o usuário).
EOF
    fi ;;
esac
exit 0
