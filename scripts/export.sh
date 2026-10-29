#!/usr/bin/env bash
# Copia os agentes de perfil de um projeto DE VOLTA para profiles/<NOME>/agents,
# para versionar alterações feitas no dia a dia.
#
#   scripts/export.sh /caminho/do/projeto --profile NOME
#
# Num projeto que usa o perfil generic os agentes são renderizados a partir de
# templates/: edite o template, não exporte o arquivo renderizado. As skills e os
# commands do OpenSpec vêm do openspec init e não voltam para o repo.
set -euo pipefail

PROJ="${1:?uso: scripts/export.sh <projeto> --profile NOME}"; shift
PROFILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --agents-only) shift ;;   # aceito por compatibilidade: o export só traz agentes
    *) echo "opção desconhecida: $1" >&2; exit 1 ;;
  esac
done
SRC="$(cd "$PROJ" && pwd)/.claude"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

[[ -d "$SRC" ]] || { echo "não existe: $SRC" >&2; exit 1; }
if [[ -f "$SRC/ai-team.conf" ]] && grep -q "AI_TEAM_PROFILE='generic'" "$SRC/ai-team.conf"; then
  echo "! $PROJ usa o perfil generic: os agentes são renderizados de templates/agents." >&2
  echo "  Edite os templates no repo; nada a exportar." >&2
  exit 0
fi
[[ -n $PROFILE ]] || { echo "export exige --profile NOME" >&2; exit 1; }

sync() { # src_subdir dest_subdir
  [[ -d "$SRC/$1" ]] || return 0
  mkdir -p "$REPO/$2"
  rsync -a --itemize-changes --exclude '*.local.*' "$SRC/$1/" "$REPO/$2/" | sed 's/^/  /'
}

echo "▸ agents → profiles/$PROFILE/agents"; sync agents "profiles/$PROFILE/agents"
echo
git -C "$REPO" status --short
