#!/usr/bin/env bash
# ai-team — declared state. The only writer of the `<!-- state: … -->` line in a change's tasks.md header:
# agents run this instead of editing the line by hand. It checks the stage and who it waits for against the
# lists the dashboard accepts, refuses a move the cycle does not allow (build straight to integration, say),
# stamps `since` with the real UTC clock and rewrites the line in place (one line, duplicates removed; added
# under the title when missing). The dashboard and `/team resume` read that line first.
#
# usage (from the project root or any of its worktrees):
#   .claude/ai-team/dashboard/state.sh <change-id> <stage> <who> [note...]
#   .claude/ai-team/dashboard/state.sh --force <change-id> <stage> <who> <reason...>
#   .claude/ai-team/dashboard/state.sh --show <change-id>
#   e.g. .claude/ai-team/dashboard/state.sh add-invoice review reviewer
#        .claude/ai-team/dashboard/state.sh add-invoice fix builder "R3 and R5"
#
# stage: spec approval build review fix validation integration archived
# who:   developer orchestrator spec-writer provisioner builder integrator reviewer validator queue
#
# Allowed moves (the same stage again, with another `who` or note, is always allowed):
#   any stage but archived → spec           (rethink the approach)
#   spec → approval          approval → build | archived
#   build → review           review → fix | validation | integration | build
#   fix → review | build     validation → fix | integration | build
#   integration → archived | fix
# Anything else needs --force with a reason, which goes into the note.
#
# exit: 0 written (or shown), 2 wrong call, 3 move refused, 4 tasks.md not found or not writable.
set -u
STAGES="spec approval build review fix validation integration archived"
WHO="developer orchestrator spec-writer provisioner builder integrator reviewer validator queue"
self=".claude/ai-team/dashboard/state.sh"
usage() {
  echo "usage: $self <change-id> <stage> <who> [note...]" >&2
  echo "       $self --force <change-id> <stage> <who> <reason...>" >&2
  echo "       $self --show <change-id>" >&2
  echo "stage: ${STAGES// / | }" >&2
  echo "who:   ${WHO// / | }" >&2
  exit 2
}
in_list() { case " $2 " in *" $1 "*) return 0 ;; esac; return 1; }

# every move from $1, for the messages: the same stage, spec (unless it is spec) and the table
moves_from() { local s="$1 (same)"; [[ "$1" != spec ]] && s="$s spec"; echo "$s $(allowed_from "$1")" | sed 's/ $//'; }

# next stages allowed from $1 (besides the same stage and spec)
allowed_from() {
  case "$1" in
    spec) echo "approval" ;;
    approval) echo "build archived" ;;
    build) echo "review" ;;
    review) echo "fix validation integration build" ;;
    fix) echo "review build" ;;
    validation) echo "fix integration build" ;;
    integration) echo "archived fix" ;;
    *) echo "" ;;
  esac
}

force=0 show=0
case "${1:-}" in
  --force) force=1; shift ;;
  --show) show=1; shift ;;
  -h|--help) usage ;;
esac

change="${1:-}"
[[ "$change" =~ ^[a-z0-9][a-z0-9._-]{0,99}$ && "$change" != "archive" ]] || usage
if [[ $show -eq 0 ]]; then
  [[ $# -ge 3 ]] || usage
  stage="$2" who="$3"; shift 3
  note="$*"
  in_list "$stage" "$STAGES" || { echo "state: stage \"$stage\" is not one of: $STAGES" >&2; exit 2; }
  in_list "$who" "$WHO" || { echo "state: who \"$who\" is not one of: $WHO" >&2; exit 2; }
  if [[ $force -eq 1 && -z "${note// /}" ]]; then echo "state: --force needs a reason (it goes into the note)" >&2; exit 2; fi
  # one line, nothing that closes the comment early
  note="$(printf '%s' "$note" | tr '\r\n\t' '   ' | sed -e 's/-->/->/g' -e 's/  */ /g' -e 's/^ //' -e 's/ $//')"
  note="${note:0:200}"
fi

# the main checkout: the OpenSpec artifacts live there, never in a worktree
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root=""
common="$(git -C "$here" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
[[ -n "$common" && "$(basename "$common")" == ".git" ]] && root="$(dirname "$common")"
[[ -n "$root" ]] || root="$(cd "$here/../../.." && pwd)"   # .claude/ai-team/dashboard/ → project root

# where the changes are: OPENSPEC_HOME in the conf, else the first of .ai-team/openspec, openspec that exists
home=""
conf="$root/.claude/ai-team.conf"
[[ -f "$conf" ]] && home="$(sed -n "s/^OPENSPEC_HOME=['\"]\{0,1\}\([^'\"]*\)['\"]\{0,1\}$/\1/p" "$conf" | tail -n 1)"
case "$home" in
  .ai-team) base="$root/.ai-team/openspec/changes" ;;
  .) base="$root/openspec/changes" ;;
  *) if [[ -d "$root/.ai-team/openspec" ]]; then base="$root/.ai-team/openspec/changes"
     elif [[ -d "$root/openspec" ]]; then base="$root/openspec/changes"
     else base="$root/.ai-team/openspec/changes"; fi ;;
esac
file="$base/$change/tasks.md"
rel="${file#"$root"/}"
[[ -f "$file" ]] || { echo "state: $rel not found (create the change's tasks.md first)" >&2; exit 4; }

# current line: the first `<!-- state: … -->` before the first `## ` section
current="$(awk '/^## /{exit} /<!--[[:space:]]*state[[:space:]]*:/{print; exit}' "$file")"
cur_stage=""
if [[ -n "$current" ]]; then
  cur_stage="$(printf '%s' "$current" | sed -n 's/.*<!--[[:space:]]*state[[:space:]]*:[[:space:]]*\([a-z-]*\).*/\1/p')"
  in_list "$cur_stage" "$STAGES" || cur_stage=""   # an invalid line is repaired by any move
fi

if [[ $show -eq 1 ]]; then
  if [[ -n "$current" ]]; then echo "$current"; else echo "state: $rel has no state line"; fi
  if [[ "$cur_stage" == "archived" ]]; then echo "next: none (archived)"
  elif [[ -n "$cur_stage" ]]; then echo "next: $(moves_from "$cur_stage")"; fi
  exit 0
fi

if [[ -n "$cur_stage" && "$stage" != "$cur_stage" && $force -eq 0 ]]; then
  ok=0
  if [[ "$cur_stage" != "archived" && "$stage" == "spec" ]]; then ok=1
  elif in_list "$stage" "$(allowed_from "$cur_stage")"; then ok=1; fi
  if [[ $ok -eq 0 ]]; then
    if [[ "$cur_stage" == "archived" ]]; then
      echo "state: $change is archived; nothing moves it (use --force with a reason if this is really wanted)" >&2
    else
      echo "state: $change is in \"$cur_stage\"; \"$stage\" is not a move from there." >&2
      echo "       allowed: $(moves_from "$cur_stage")" >&2
      echo "       if the cycle really needs it: $self --force $change $stage $who <reason>" >&2
    fi
    exit 3
  fi
fi

since="$(date -u +%Y-%m-%dT%H:%MZ)"
line="<!-- state: $stage · waiting: $who · since: $since"
[[ -n "$note" ]] && line="$line · note: $note"
line="$line -->"

[[ -w "$file" ]] || { echo "state: $rel is not writable" >&2; exit 4; }
tmp="$(mktemp "$file.XXXXXX")" || { echo "state: cannot write next to $rel" >&2; exit 4; }
# replace the first state line of the header, drop any other there; no line: add it under the `# ` title
# (or on top when there is none)
STATE_LINE="$line" awk '
  BEGIN { line = ENVIRON["STATE_LINE"]; n = 0; has = 0; header = 1 }
  { rows[++n] = $0 }
  END {
    # does the header have a state line?
    for (i = 1; i <= n; i++) { if (rows[i] ~ /^## /) break; if (rows[i] ~ /<!--[[:space:]]*state[[:space:]]*:/) { has = 1; break } }
    title = 0
    if (!has) for (i = 1; i <= n; i++) { if (rows[i] ~ /^## /) break; if (rows[i] ~ /^# /) { title = i; break } }
    if (!has && title == 0) print line
    done = 0; header = 1
    for (i = 1; i <= n; i++) {
      if (rows[i] ~ /^## /) header = 0
      if (header && rows[i] ~ /<!--[[:space:]]*state[[:space:]]*:/) { if (!done) { print line; done = 1 } ; continue }
      print rows[i]
      if (i == title) { print ""; print line }
    }
  }
' "$file" > "$tmp" && cat "$tmp" > "$file" || { rm -f "$tmp"; echo "state: could not rewrite $rel" >&2; exit 4; }
rm -f "$tmp"   # copied over (not moved) so tasks.md keeps its permissions

from="${cur_stage:-none}"
echo "state: $change $from → $stage (waiting: $who, since $since)${note:+ · note: $note}"
