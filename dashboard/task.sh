#!/usr/bin/env bash
# ai-team — task marks. Any agent (of any AI tool) that works on a task of tasks.md says when it starts,
# pauses and finishes it; the dashboard measures each task's time from these marks (and, when the same
# agent starts another task, closes the previous one there). Local only: one line in
# .claude/ai-team/local/events.jsonl, never in git.
#
# usage (from the project root):
#   .claude/ai-team/dashboard/task.sh start|pause|done <change-id> <task-id>[,<task-id>...] <agent>
#   e.g. .claude/ai-team/dashboard/task.sh start add-invoice 2.3 integrator
#        .claude/ai-team/dashboard/task.sh start add-invoice 2.1,2.2,2.3 reviewer   (several at once: a review)
#
# It never fails the caller: wrong arguments print the usage on stderr and exit 0, so a slip never stops a round.
set -u
usage() { echo "usage: .claude/ai-team/dashboard/task.sh start|pause|done <change-id> <task-id>[,<task-id>...] <agent>" >&2; exit 0; }
[[ $# -eq 4 ]] || usage
action="$1" change="$2" tasks="$3" agent="$4"
[[ "$action" =~ ^(start|pause|done)$ ]] || usage
[[ "$change" =~ ^[a-z0-9][a-z0-9._-]{0,99}$ ]] || usage
[[ "$tasks" =~ ^[0-9]+\.[0-9]+[a-z]?(,[0-9]+\.[0-9]+[a-z]?){0,49}$ ]] || usage
[[ "$agent" =~ ^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$ ]] || usage

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dir="$here/../local"   # .claude/ai-team/local/, next to this copy in .claude/ai-team/dashboard/
mkdir -p "$dir" 2>/dev/null || exit 0
ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
list="\"${tasks//,/\",\"}\""
printf '{"ts":"%s","event":"Task","action":"%s","change":"%s","tasks":[%s],"agent":"%s"}\n' "$ts" "$action" "$change" "$list" "$agent" >> "$dir/events.jsonl" 2>/dev/null || exit 0
echo "task $action: $change $tasks ($agent)"
