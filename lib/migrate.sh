#!/usr/bin/env bash
# ai-team — versions of .claude/ai-team.conf and the migrations between them.
#
# The conf carries AI_TEAM_CONF_VERSION='<n>' (a conf without it is version 1). When a key is added or renamed,
# the detector writes the new shape for a fresh install, and a migration here brings an existing conf to it
# in place, so `install.sh --render` on an old project never renders the templates with a key silently
# missing. Each migration is a function m<n> (idempotent, bash 3.2) run by migrate_conf in order.
#
#   . lib/migrate.sh; migrate_conf <conf> [--dry-run]     prints one line per change; returns 0
#   conf_version <conf>                                     prints the conf's version
#
# Versions:
#   1  before versioning (installs up to 2026-11-10)
#   2  DOCS_LESSONS (lessons file read by the devs and the reviewer); OUTPUT_LANGUAGE defaulted (older installs
#      without the key)
#   3  OPENSPEC_HOME: where OpenSpec lives, '.' (the project root) or '.ai-team'. An existing conf gets '.' when
#      the project has a root openspec/ (a reinstall never moves it) and '.ai-team' otherwise
AI_TEAM_CONF_VERSION_CURRENT=3

conf_version() { local v; v="$(sed -nE "s/^AI_TEAM_CONF_VERSION='([0-9]+)'$/\1/p" "$1" | head -1)"; printf '%s' "${v:-1}"; }

# --- helpers (each prints the change it made, nothing when there was nothing to do) --------------------------
_mig_dry=0
_conf_has() { grep -qE "^$2=" "$1"; }
conf_add_key() { # conf KEY default-value: appends KEY='value' when the key is missing
  local conf="$1" k="$2" v="$3"
  _conf_has "$conf" "$k" && return 0
  echo "  + $k='$v'"
  [[ $_mig_dry -eq 1 ]] || printf "%s='%s'\n" "$k" "${v//\'/\'\\\'\'}" >> "$conf"
}
conf_rename_key() { # conf OLD NEW: renames the key, keeping the value; a NEW already there wins
  local conf="$1" o="$2" n="$3"
  _conf_has "$conf" "$o" || return 0
  if _conf_has "$conf" "$n"; then echo "  - $o (superseded by $n)"; [[ $_mig_dry -eq 1 ]] || sed -i.bak "/^$o=/d" "$conf"; rm -f "$conf.bak"; return 0; fi
  echo "  ~ $o → $n"
  [[ $_mig_dry -eq 1 ]] || { sed -i.bak "s/^$o=/$n=/" "$conf"; rm -f "$conf.bak"; }
}
conf_set_version() { # conf n
  local conf="$1" n="$2"
  [[ $_mig_dry -eq 1 ]] && return 0
  if _conf_has "$conf" AI_TEAM_CONF_VERSION; then sed -i.bak "s/^AI_TEAM_CONF_VERSION=.*/AI_TEAM_CONF_VERSION='$n'/" "$conf"; rm -f "$conf.bak"
  else printf "AI_TEAM_CONF_VERSION='%s'\n" "$n" >> "$conf"; fi
}

# --- migrations ------------------------------------------------------------------------------------------------
m2() {
  conf_add_key "$1" DOCS_LESSONS docs/lessons.md
  conf_add_key "$1" OUTPUT_LANGUAGE en
}

m3() {
  local root; root="$(cd "$(dirname "$1")/.." && pwd)"
  conf_add_key "$1" OPENSPEC_HOME "$([[ -d "$root/openspec" ]] && echo . || echo .ai-team)"
}

# conf [--dry-run] → runs the missing migrations; prints "conf: v<a> → v<b>" and the changes; silent when current
migrate_conf() {
  local conf="$1" from to n
  _mig_dry=0; [[ "${2:-}" == --dry-run ]] && _mig_dry=1
  [[ -f "$conf" ]] || return 0
  from="$(conf_version "$conf")"; to="$AI_TEAM_CONF_VERSION_CURRENT"
  [[ "$from" -ge "$to" ]] && return 0
  echo "conf: v$from → v$to$([[ $_mig_dry -eq 1 ]] && echo ' (dry run)')"
  [[ $_mig_dry -eq 1 ]] || cp "$conf" "$conf.bak-ai-team"
  n=$((from + 1))
  while [[ $n -le $to ]]; do
    "m$n" "$conf"
    conf_set_version "$conf" "$n"
    n=$((n + 1))
  done
}
