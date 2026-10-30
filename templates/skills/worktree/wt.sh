#!/usr/bin/env bash
# ai-team — one worktree per change (or ad-hoc task).
#
#   wt.sh open <id> <front>        creates or reuses the change/<id> branch and the worktree;
#                                  prints the front's folder inside the worktree
#   wt.sh where <id>               the change's worktrees, one per line: <folder> <branch>
#   wt.sh integrate <id> <front>   merge --no-ff of change/<id> into the work branch,
#                                  in the main checkout; prints the merge sha
#   wt.sh close <id>               removes the worktrees and deletes the change branches
#                                  already integrated; the others stay
#
# <front>: backend (sections 0 and 1) or frontend (section 2). Reads .claude/ai-team.conf.
# Worktrees live in .claude/worktrees/: <id>/ for the root repository and
# <id>-<folder>/ for a package with its own git.
set -euo pipefail

PROJ="$(cd "$(dirname "$0")/../../.." && pwd -P)"
CONF="$PROJ/.claude/ai-team.conf"
WT="$PROJ/.claude/worktrees"
die() { echo "wt: $*" >&2; exit 1; }
[[ -f "$CONF" ]] || die "$CONF not found"
# shellcheck disable=SC1090
. "$CONF"

CMD="${1:-}"; ID="${2:-}"; FRONT="${3:-}"
[[ "$ID" =~ ^[a-z0-9][a-z0-9._-]*$ ]] || die "usage: wt.sh open|where|integrate|close <id> [backend|frontend] (id in kebab-case)"
BR="change/$ID"

root_is_repo() { [[ "$(git -C "$PROJ" rev-parse --show-toplevel 2>/dev/null)" == "$PROJ" ]]; }

front() { # sets REPO (main checkout), WORK (work branch), ROOT (worktree) and CODE (front's folder)
  local P has dir own br
  case "$1" in
    backend|infra) P=BACKEND ;;
    frontend)      P=FRONTEND ;;
    *) die "invalid front: '$1' (backend or frontend)" ;;
  esac
  has="HAS_$P"; dir="${P}_DIR"; own="${P}_OWN_REPO"; br="${P}_BRANCH"
  [[ "${!has:-0}" == 1 ]] || die "the project has no $1"
  local d="${!dir:-.}"
  if [[ "${!own:-0}" == 1 ]]; then
    REPO="$PROJ/$d"; ROOT="$WT/$ID-$(basename "$d")"; CODE="$ROOT"
  else
    root_is_repo || die "$PROJ is not the root of a git repository"
    REPO="$PROJ"; ROOT="$WT/$ID"
    if [[ "$d" == . ]]; then CODE="$ROOT"; else CODE="$ROOT/$d"; fi
  fi
  WORK="${!br:-}"
  [[ -n "$WORK" ]] || WORK="$(git -C "$REPO" branch --show-current)"
  [[ -n "$WORK" ]] || die "unknown work branch for $1 (fill in ${P}_BRANCH in the conf)"
}

repos() { # repositories where a change can have a worktree
  root_is_repo && echo "$PROJ"
  local P own dir
  for P in BACKEND FRONTEND; do
    own="${P}_OWN_REPO"; dir="${P}_DIR"
    [[ "${!own:-0}" == 1 ]] && echo "$PROJ/${!dir}"
  done
  return 0
}

worktree_of() { # repo → folder of the worktree holding the change branch (empty if none)
  git -C "$1" worktree list --porcelain | awk -v b="branch refs/heads/$BR" '/^worktree /{p=substr($0,10)} $0==b{print p}'
}

ignore_worktrees() { # keeps .claude/worktrees/ out of the root git, without touching .gitignore
  root_is_repo || return 0
  local ex; ex="$(git -C "$PROJ" rev-parse --git-path info/exclude)"
  [[ "$ex" = /* ]] || ex="$PROJ/$ex"
  grep -qxF '.claude/worktrees/' "$ex" 2>/dev/null || { mkdir -p "$(dirname "$ex")"; echo '.claude/worktrees/' >> "$ex"; }
}

case "$CMD" in
  open)
    front "$FRONT"
    have="$(worktree_of "$REPO")"
    if [[ -z "$have" ]]; then
      ignore_worktrees
      mkdir -p "$WT"
      if git -C "$REPO" show-ref --verify --quiet "refs/heads/$BR"; then
        git -C "$REPO" worktree add -q "$ROOT" "$BR"
      else
        git -C "$REPO" worktree add -q -b "$BR" "$ROOT" "$WORK"
      fi
      # .env and friends are not versioned: the worktree starts with a copy from the main checkout
      for f in .env .env.local .env.development.local .env.test.local; do
        [[ -f "$REPO/$f" && ! -e "$ROOT/$f" ]] && cp "$REPO/$f" "$ROOT/$f"
      done
      echo "wt: created $BR from $WORK; install the dependencies before the first gate" >&2
    elif [[ "$have" != "$ROOT" ]]; then
      ROOT="$have"; [[ "$CODE" == "$WT/$ID"* ]] && CODE="$have${CODE#"$WT/$ID"}"
    fi
    echo "$CODE"
    ;;
  where)
    while read -r r; do
      w="$(worktree_of "$r")"; [[ -n "$w" ]] && echo "$w $BR"
    done < <(repos)
    ;;
  integrate)
    front "$FRONT"
    git -C "$REPO" show-ref --verify --quiet "refs/heads/$BR" || die "branch $BR does not exist in $REPO"
    cur="$(git -C "$REPO" branch --show-current)"
    [[ "$cur" == "$WORK" ]] || die "the main checkout of $REPO is on '$cur', not on '$WORK'; nothing integrated (hand back to the orchestrator)"
    if ! out="$(git -C "$REPO" merge -q --no-ff --no-edit -m "Merge $BR" "$BR" 2>&1)"; then
      git -C "$REPO" merge --abort 2>/dev/null || true
      echo "$out" >&2
      if grep -q CONFLICT <<< "$out"; then why="conflict"; else why="the merge failed (git output above)"; fi
      die "$why integrating $BR into $WORK; nothing was integrated (hand back to the orchestrator)"
    fi
    git -C "$REPO" rev-parse --short HEAD
    ;;
  close)
    while read -r r; do
      w="$(worktree_of "$r")"
      if git -C "$r" show-ref --verify --quiet "refs/heads/$BR" && ! git -C "$r" merge-base --is-ancestor "$BR" HEAD; then
        echo "wt: $BR in $r is not integrated yet; worktree and branch kept" >&2
        continue
      fi
      if [[ -n "$w" ]]; then
        [[ -z "$(git -C "$w" status --porcelain)" ]] || die "$w has uncommitted changes; not removed"
        git -C "$r" worktree remove "$w"
        echo "wt: removed $w" >&2
      fi
      if git -C "$r" show-ref --verify --quiet "refs/heads/$BR"; then
        git -C "$r" branch -q -d "$BR" && echo "wt: deleted $BR in $r" >&2
      fi
    done < <(repos)
    rmdir "$WT" 2>/dev/null || true
    ;;
  *) die "unknown command: '$CMD' (open, where, integrate, close)" ;;
esac
