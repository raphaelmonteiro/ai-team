#!/usr/bin/env bash
# Copies a project's profile agents BACK to profiles/<NAME>/agents,
# to version the changes made day to day.
#
#   scripts/export.sh /path/to/project --profile NAME
#
# In a project on the generic profile the agents are rendered from templates/:
# edit the template, do not export the rendered file. The OpenSpec skills and
# commands come from openspec init and do not go back to the repo.
set -euo pipefail

PROJ="${1:?usage: scripts/export.sh <project> --profile NAME}"; shift
PROFILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --agents-only) shift ;;   # accepted for compatibility: export only brings agents
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done
SRC="$(cd "$PROJ" && pwd)/.claude"
REPO="$(cd "$(dirname "$0")/.." && pwd)"

[[ -d "$SRC" ]] || { echo "does not exist: $SRC" >&2; exit 1; }
if [[ -f "$SRC/ai-team.conf" ]] && grep -q "AI_TEAM_PROFILE='generic'" "$SRC/ai-team.conf"; then
  echo "! $PROJ uses the generic profile: the agents are rendered from templates/agents." >&2
  echo "  Edit the templates in the repo; nothing to export." >&2
  exit 0
fi
[[ -n $PROFILE ]] || { echo "export needs --profile NAME" >&2; exit 1; }

sync() { # src_subdir dest_subdir
  [[ -d "$SRC/$1" ]] || return 0
  mkdir -p "$REPO/$2"
  rsync -a --itemize-changes --exclude '*.local.*' "$SRC/$1/" "$REPO/$2/" | sed 's/^/  /'
}

echo "▸ agents → profiles/$PROFILE/agents"; sync agents "profiles/$PROFILE/agents"
echo
git -C "$REPO" status --short
