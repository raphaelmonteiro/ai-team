#!/usr/bin/env bash
# ai-team — Claude Code status line: project · ⎇ branch (worktree) · model effort · ctx N% · cache Nm
#
#   "statusLine": { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/ai-team/dashboard/statusline.sh\"" }
#
# Reads the session JSON Claude Code sends on stdin (cwd, model, effort, context_window, prompt_cache)
# and prints one line. A segment whose data is missing is left out. Parses with jq, or node when there
# is no jq; with neither it prints only the folder name. No network; git without optional locks.
# Installed by install.sh (--statusline project|global); in global it is copied to ~/.config/ai-team/.
set -uo pipefail

input="$(cat)"
fields=""
if command -v jq >/dev/null 2>&1; then
  fields="$(printf '%s' "$input" | jq -r '[
      (.workspace.current_dir // .cwd // ""),
      (.model.display_name // ""),
      (.effort.level // ""),
      ((.context_window.used_percentage // "") | if type == "number" then (. + 0.5 | floor | tostring) else . end),
      (.prompt_cache.warm | if . == null then "" else tostring end),
      ((.prompt_cache.expires_at // "") | tostring)
    ] | join("\u001f")' 2>/dev/null)"
elif command -v node >/dev/null 2>&1; then
  fields="$(printf '%s' "$input" | node -e '
    let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j = {}; try { j = JSON.parse(s); } catch {}
      const g = (v) => (v === undefined || v === null ? "" : String(v));
      const pct = j.context_window && typeof j.context_window.used_percentage === "number" ? Math.round(j.context_window.used_percentage) : "";
      const pc = j.prompt_cache || {};
      process.stdout.write([g((j.workspace && j.workspace.current_dir) || j.cwd), g(j.model && j.model.display_name),
        g(j.effort && j.effort.level), g(pct), g(pc.warm), g(pc.expires_at)].join("\x1f"));
    });' 2>/dev/null)"
fi
IFS=$'\x1f' read -r cwd model effort ctx warm expires <<< "$fields"
cwd="${cwd:-$PWD}"

# project: the main repository's name, also from inside a linked worktree
project="$(basename "$cwd")" branch="" wt=""
if top="$(git -C "$cwd" --no-optional-locks rev-parse --show-toplevel 2>/dev/null)"; then
  common="$(git -C "$cwd" --no-optional-locks rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
  gitdir="$(git -C "$cwd" --no-optional-locks rev-parse --path-format=absolute --git-dir 2>/dev/null)"
  if [[ "$common" == */.git ]]; then project="$(basename "$(dirname "$common")")"; else project="$(basename "$top")"; fi
  branch="$(git -C "$cwd" --no-optional-locks symbolic-ref --short -q HEAD 2>/dev/null || git -C "$cwd" --no-optional-locks rev-parse --short HEAD 2>/dev/null)"
  [[ -n "$common" && "$gitdir" != "$common" ]] && wt=" (worktree)"
fi

out="$project"
[[ -n "$branch" ]] && out="$out · ⎇ $branch$wt"
[[ -n "$model" ]] && out="$out · $model${effort:+ $effort}"
[[ -n "$ctx" ]] && out="$out · ctx $ctx%"
# cache: minutes until the prompt cache expires (the next message past that rebuilds the whole context)
if [[ "$warm" == true && "$expires" =~ ^[0-9]+$ ]]; then
  left=$(( (expires - $(date +%s)) / 60 ))
  if (( left > 0 )); then out="$out · cache ${left}m"; else out="$out · cache cold"; fi
elif [[ "$warm" == false ]]; then
  out="$out · cache cold"
fi
printf '%s\n' "$out"
