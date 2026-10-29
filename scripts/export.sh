#!/usr/bin/env bash
# Copia os agentes/skills/commands de um projeto DE VOLTA para este repo,
# para versionar alterações feitas no dia a dia.
#
#   scripts/export.sh /caminho/do/projeto [--profile NOME] [--agents-only]
#
# Agentes vão para profiles/<NOME>/agents (--profile obrigatório para eles). Num projeto que
# usa o perfil generic os agentes são renderizados a partir de templates/:
# edite o template, não exporte o arquivo renderizado.
set -euo pipefail

PROJ="${1:?uso: scripts/export.sh <projeto> [--profile NOME] [--agents-only]}"; shift
PROFILE="" ONLY=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --agents-only) ONLY=1; shift ;;
    *) echo "opção desconhecida: $1" >&2; exit 1 ;;
  esac
done
SRC="$(cd "$PROJ" && pwd)/.claude"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

[[ -d "$SRC" ]] || { echo "não existe: $SRC" >&2; exit 1; }
if [[ -f "$SRC/ai-team.conf" ]] && grep -q "AI_TEAM_PROFILE='generic'" "$SRC/ai-team.conf"; then
  echo "! $PROJ usa o perfil generic: os agentes são renderizados de templates/agents." >&2
  echo "  Edite os templates no repo; export dos agentes ignorado." >&2
  EXPORT_AGENTS=0
else
  EXPORT_AGENTS=1
fi
if [[ $EXPORT_AGENTS -eq 1 && -z $PROFILE && $ONLY -eq 1 ]]; then echo "--agents-only exige --profile NOME" >&2; exit 1; fi
[[ -n $PROFILE ]] || { [[ $EXPORT_AGENTS -eq 1 ]] && echo "! sem --profile: export dos agentes ignorado." >&2; EXPORT_AGENTS=0; }

sync() { # src_subdir dest_subdir
  [[ -d "$SRC/$1" ]] || return 0
  mkdir -p "$REPO/$2"
  rsync -a --itemize-changes --exclude '*.local.*' "$SRC/$1/" "$REPO/$2/" | sed 's/^/  /'
}

if [[ $EXPORT_AGENTS -eq 1 ]]; then echo "▸ agents → profiles/$PROFILE/agents"; sync agents "profiles/$PROFILE/agents"; fi
if [[ $ONLY -eq 0 ]]; then
  echo "▸ skills";   sync skills skills
  echo "▸ commands"; sync commands commands
fi
echo
git -C "$REPO" status --short
