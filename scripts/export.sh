#!/usr/bin/env bash
# Copia os agentes/skills/commands de um projeto DE VOLTA para este repo,
# para versionar alterações feitas no dia a dia.
#
#   scripts/export.sh /caminho/do/projeto [--agents-only]
set -euo pipefail

PROJ="${1:?uso: scripts/export.sh <projeto> [--agents-only]}"
ONLY="${2:-}"
SRC="$(cd "$PROJ" && pwd)/.claude"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

[[ -d "$SRC" ]] || { echo "não existe: $SRC" >&2; exit 1; }

sync() { # subdir
  [[ -d "$SRC/$1" ]] || return 0
  mkdir -p "$REPO/$1"
  rsync -a --itemize-changes --exclude '*.local.*' "$SRC/$1/" "$REPO/$1/" | sed 's/^/  /'
}

echo "▸ agents";   sync agents
if [[ "$ONLY" != "--agents-only" ]]; then
  echo "▸ skills";   sync skills
  echo "▸ commands"; sync commands
fi
echo
git -C "$REPO" status --short
