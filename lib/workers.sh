#!/usr/bin/env bash
# ai-team — how many test workers this machine can take, and the test command that reads it.
#
# Jest and Vitest start about one worker per core. On a machine with many cores and little memory that is more
# than it can hold: the gate runs it out of memory. The conf is versioned and shared by machines, so it never
# carries a number: the test command reads AI_TEAM_MAX_WORKERS, which each machine keeps in its own
# .claude/settings.local.json (out of git), and falls back to 4 where it is not set.
#
#   . lib/workers.sh
#   machine_max_workers                             prints the number for this machine
#   limited_test_cmd <dir> <pm> <script> <body> <cmd>    prints <cmd>, with the limit when the script takes it
#
# Compatible with bash 3.2 (macOS). AI_TEAM_CPUS and AI_TEAM_MEM_MB replace what is read from the machine (tests).

# shellcheck disable=SC2016  # expanded by the shell that runs the gate, not here
AI_TEAM_WORKERS_FLAG='--maxWorkers=${AI_TEAM_MAX_WORKERS:-4}'
# memory left for the system, the editor and the containers, and what one worker (ts-jest, jsdom) may take
AI_TEAM_RESERVED_MB=6144
AI_TEAM_WORKER_MB=2048

machine_cpus() {
  local n="${AI_TEAM_CPUS:-}"
  [[ -n "$n" ]] || n="$(nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null || true)"
  [[ "$n" =~ ^[0-9]+$ ]] && printf '%s' "$n"
  return 0
}

machine_mem_mb() { # total memory in MiB; a smaller cgroup limit (container) wins; empty when unknown
  local mb="${AI_TEAM_MEM_MB:-}" b c
  if [[ -z "$mb" ]]; then
    if [[ -r /proc/meminfo ]]; then
      mb="$(awk '/^MemTotal:/ { printf "%d", $2 / 1024; exit }' /proc/meminfo)"
      for c in /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory/memory.limit_in_bytes; do
        [[ -r "$c" ]] || continue
        b="$(cat "$c" 2>/dev/null || true)"
        # "max" and cgroup v1's huge "no limit" number are not limits (19+ digits do not fit the arithmetic either)
        [[ "$b" =~ ^[0-9]{1,18}$ && $((b / 1048576)) -gt 0 && $((b / 1048576)) -lt $mb ]] && mb=$((b / 1048576))
      done
    else
      b="$(sysctl -n hw.memsize 2>/dev/null || true)"
      [[ "$b" =~ ^[0-9]{1,18}$ ]] && mb=$((b / 1048576))
    fi
  fi
  [[ "$mb" =~ ^[0-9]+$ ]] && printf '%s' "$mb"
  return 0
}

# (memory - reserved) / per worker, from 1 to one less than the cores; 4 when the memory cannot be read
machine_max_workers() {
  local cpus mem n top
  cpus="$(machine_cpus)"; mem="$(machine_mem_mb)"
  n=4
  [[ -n "$mem" ]] && n=$(((mem - AI_TEAM_RESERVED_MB) / AI_TEAM_WORKER_MB))
  if [[ -n "$cpus" ]]; then top=$((cpus - 1)); [[ $n -gt $top ]] && n=$top; fi
  [[ $n -lt 1 ]] && n=1
  printf '%s' "$n"
}

# major version of vitest in a package: the installed one (package, then project root) or the range's first number
vitest_major() { # dir [root]
  local f v=""
  for f in "$1/node_modules/vitest/package.json" "${2:-$1}/node_modules/vitest/package.json"; do
    [[ -f "$f" ]] || continue
    v="$(sed -nE 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"([0-9]+)\..*/\1/p' "$f" | head -1)"
    [[ -n "$v" ]] && break
  done
  [[ -n "$v" ]] || v="$(sed -nE 's/.*"vitest"[[:space:]]*:[[:space:]]*"[~^>=v ]*([0-9]+).*/\1/p' "$1/package.json" 2>/dev/null | head -1)"
  printf '%s' "$v"
}

# the test command with the worker limit, or unchanged when the script does not take it:
# - only a script that is one plain Jest or Vitest call (extra arguments go to the end of the script);
# - Vitest from 3 on: before it, --maxWorkers alone fails ("minThreads and maxThreads must not conflict");
# - never when the script or the runner's config already says how many workers (or runs in band).
limited_test_cmd() { # dir pm script body cmd [root]
  local d="$1" pm="$2" s="$3" body="$4" cmd="$5" root="${6:-$1}" major
  local own='maxWorkers|max-workers|minWorkers|runInBand|run-in-band|maxForks|maxThreads|poolOptions|[Ff]ileParallelism|file-parallelism|singleFork|singleThread|VITEST_MAX_'
  local jest='(^|[[:space:]]|/bin/|/\.bin/)jest(\.js)?([[:space:]]|$)'
  local vitest='(^|[[:space:]]|/\.bin/|/vitest/)vitest(\.mjs)?([[:space:]]|$)'
  local short='[[:space:]]-(i|w)([[:space:]=]|$)'
  case "$body" in ''|*'&'*|*'|'*|*';'*|*\\*) printf '%s' "$cmd"; return 0 ;; esac
  if [[ "$body" =~ $vitest ]]; then
    major="$(vitest_major "$d" "$root")"
    [[ -n "$major" && "$major" -ge 3 ]] || { printf '%s' "$cmd"; return 0; }
  elif ! [[ "$body" =~ $jest ]]; then
    printf '%s' "$cmd"; return 0
  fi
  if [[ "$body" =~ $own || "$body" =~ $short ]] ||
     grep -qsE '"maxWorkers"[[:space:]]*:' "$d/package.json" ||   # the jest block; another script's --runInBand (Nest's test:debug) is not a limit
     grep -qsE "$own" "$d"/jest.config.* "$d"/vitest.config.* "$d"/vite.config.*; then
    printf '%s' "$cmd"; return 0
  fi
  case "$pm" in
    npm)      printf '%s -- %s' "$cmd" "$AI_TEAM_WORKERS_FLAG" ;;
    # `pnpm test --flag` is an unknown option up to pnpm 9 and `--` reaches the runner from pnpm 10 on; `pnpm run` takes it in all
    pnpm)     printf 'pnpm run %s %s' "$s" "$AI_TEAM_WORKERS_FLAG" ;;
    yarn|bun) printf '%s %s' "$cmd" "$AI_TEAM_WORKERS_FLAG" ;;
    *)        printf '%s' "$cmd" ;;
  esac
}
