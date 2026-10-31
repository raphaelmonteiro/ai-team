#!/usr/bin/env bash
# ai-team — installs the Claude Code agent team in a project,
# reading the project and configuring the agents for it.
#
# Usage (remote, no clone):
#   curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --detect-only
#   curl -fsSL .../install.sh | bash -s -- --set BACKEND_BRANCH=develop --no-openspec
#
# Usage (cloned repo):
#   ./install.sh [options] [project-dir]
#
# Generic profile flow (default):
#   1. lib/detect.sh reads the project (manifests, Makefile, docker-compose, git, docs)
#   2. writes what it found to .claude/ai-team.conf (edit freely)
#   3. generates .claude/project-context.md from the conf
#   4. renders the agents from templates/agents/*.md with the conf variables
#
# Options:
#   --profile NAME     generic (default, detects and renders) | name under profiles/
#   --detect-only      only runs the detector and prints the conf; writes nothing
#   --reconfigure      ignores the existing ai-team.conf and detects again
#   --render           only re-renders agents and context from the existing conf
#   --set K=V          overrides a conf variable (repeatable; written to the conf),
#                      e.g. --set OUTPUT_LANGUAGE=pt-BR (output language of the agents; default en)
#   --agents a,b,c     installs only these agents (default: all that apply)
#   --no-agents        installs no agents
#   --no-openspec      skips openspec init (openspec-* skills and /opsx:* commands;
#                      --no-skills and --no-commands do the same)
#   --no-dashboard     skips the dashboard (.claude/dashboard: node server.mjs)
#   --hub-team TEAM    registers the project in the hub, under team TEAM (writes HUB_TEAM to the conf;
#                      without the option and with an existing hub, asks in the terminal)
#   --hub FILE         hub registry (default: $AI_TEAM_HUB or ~/.config/ai-team/hub.json)
#   --ntfy-topic T     phone notifications through ntfy on topic T (machine config, ~/.config/ai-team/notify.json;
#                      without the option and without a config, asks in the terminal; "new" generates a random topic)
#   --yes              asks nothing (uses what was detected and the options)
#   --default-agent X  every session starts as agent X ({"agent": "X"} in settings.json).
#                      Default: none; the team comes in with /team or claude --agent orchestrator
#   --no-settings      does not touch settings.json
#   --force            overwrites existing files (default: skips and warns)
#   --ref REF          repo branch/tag (default: main)
#   --dry-run          only shows what it would do
#   -h, --help
set -euo pipefail

REPO="${AI_TEAM_REPO:-raphaelmonteiro/ai-team}"
REF="main"
TARGET="."
PROFILE="generic"
AGENTS=""
DO_AGENTS=1 DO_OPENSPEC=1 DO_SETTINGS=1 DO_DASHBOARD=1
DEFAULT_AGENT=""
FORCE=0 DRY=0 DETECT_ONLY=0 RECONFIGURE=0 RENDER_ONLY=0 YES=0
HUB_TEAM_OPT="" HUB_FILE="${AI_TEAM_HUB:-}" NTFY_TOPIC=""
SETS=()

usage() { sed -n '2,/^set -euo/p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --detect-only) DETECT_ONLY=1; shift ;;
    --reconfigure) RECONFIGURE=1; shift ;;
    --render) RENDER_ONLY=1; shift ;;
    --set) SETS+=("$2"); shift 2 ;;
    --agents) AGENTS="$2"; shift 2 ;;
    --no-agents) DO_AGENTS=0; shift ;;
    --no-openspec|--no-skills|--no-commands) DO_OPENSPEC=0; shift ;;
    --no-dashboard) DO_DASHBOARD=0; shift ;;
    --hub-team) HUB_TEAM_OPT="$2"; shift 2 ;;
    --hub) HUB_FILE="$2"; shift 2 ;;
    --ntfy-topic) NTFY_TOPIC="$2"; shift 2 ;;
    --yes|-y) YES=1; shift ;;
    --default-agent) DEFAULT_AGENT="$2"; shift 2 ;;
    --no-settings) DO_SETTINGS=0; shift ;;
    --force) FORCE=1; shift ;;
    --ref) REF="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage ;;
    -*) echo "unknown option: $1" >&2; exit 1 ;;
    *) TARGET="$1"; shift ;;
  esac
done

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# asks only with a real terminal (curl | bash: stdin is the script, so read from /dev/tty)
can_ask() { [[ $YES -eq 0 && $DRY -eq 0 && -z "${CI:-}" ]] && { : < /dev/tty; } 2>/dev/null; }
ask() { # question default → answer (empty = default)
  local a=""
  read -r -p "  $1${2:+ [$2]}: " a < /dev/tty || a=""
  printf '%s' "${a:-$2}"
}
hub_file() { printf '%s' "${HUB_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/ai-team/hub.json}"; }
# team and name in the hub: --hub-team wins; without it, asks only if a hub already exists
ask_hub() { # current_team current_name → sets HUB_TEAM and HUB_NAME
  HUB_TEAM="${HUB_TEAM_OPT:-$1}" HUB_NAME="$2"
  if [[ -z "$HUB_TEAM" && -f "$(hub_file)" ]] && can_ask; then
    log "hub at $(hub_file)"
    HUB_TEAM="$(ask 'team in the hub (enter to skip registering)' '')"
    [[ -n "$HUB_TEAM" ]] && HUB_NAME="$(ask 'project name' "$HUB_NAME")"
  fi
  return 0
}

# --render only regenerates the files derived from the conf
[[ $RENDER_ONLY -eq 1 ]] && DO_OPENSPEC=0 DO_SETTINGS=0 DO_DASHBOARD=0

# ---------------------------------------------------------------------------
# 1. Find the source: cloned repo directory or tarball download
# ---------------------------------------------------------------------------
SRC=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "$(dirname "${BASH_SOURCE[0]}")/lib/detect.sh" ]]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  log "using local source: $SRC"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  URL="https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz"
  log "downloading ${REPO}@${REF}"
  curl -fsSL "$URL" | tar -xz -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d | head -1)"
fi

PROJ="$(cd "$TARGET" && pwd)"
DEST="$PROJ/.claude"
CONF="$DEST/ai-team.conf"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK" ${TMP:-}' EXIT

# ---------------------------------------------------------------------------
# 2. Copy with overwrite protection
# ---------------------------------------------------------------------------
copy_file() { # src dest
  local s="$1" d="$2"
  if [[ -e "$d" && $FORCE -eq 0 ]]; then
    if cmp -s "$s" "$d"; then ok "same    ${d#$DEST/}"; else warn "exists  ${d#$DEST/} (use --force to overwrite)"; fi
    return
  fi
  if [[ $DRY -eq 1 ]]; then echo "  + ${d#$DEST/}"; return; fi
  mkdir -p "$(dirname "$d")"
  cp "$s" "$d"
  ok "copied  ${d#$DEST/}"
}

copy_tree() { # src_dir dest_dir
  local s="$1" d="$2"
  [[ -d "$s" ]] || return 0
  while IFS= read -r -d '' f; do
    copy_file "$f" "$d/${f#$s/}"
  done < <(find "$s" -type f -print0)
}

# Generated files end with a marker holding the checksum of their content.
# If the existing file still matches its own marker, nobody edited it
# by hand and it can be updated without --force.
GEN_MARK='<!-- ai-team:generated'
gen_sum() { sed "/^$GEN_MARK/d" "$1" | cksum | cut -d' ' -f1; }
gen_untouched() { # file → 0 if generated and untouched
  local last; last="$(tail -1 "$1")"
  [[ "$last" == "$GEN_MARK"* ]] || return 1
  [[ "$last" == *"cksum=$(gen_sum "$1") "* ]]
}
write_generated() { # rendered dest
  local s="$1" d="$2"
  printf '\n' >> "$s"   # the blank line is part of the checksum (gen_sum only strips the marker)
  printf '%s cksum=%s — edit .claude/ai-team.conf and run install.sh --render -->\n' "$GEN_MARK" "$(cksum < "$s" | cut -d' ' -f1)" >> "$s"
  if [[ -e "$d" && $FORCE -eq 0 ]]; then
    if cmp -s "$s" "$d"; then ok "same    ${d#$DEST/}"; return; fi
    if ! gen_untouched "$d"; then warn "exists  ${d#$DEST/} (hand-edited; use --force to overwrite)"; return; fi
    if [[ $DRY -eq 1 ]]; then echo "  ~ ${d#$DEST/}"; return; fi
    cp "$s" "$d"; ok "updated ${d#$DEST/}"; return
  fi
  copy_file "$s" "$d"
}

wanted_agent() { # name → 0 if it should be installed
  [[ -z "$AGENTS" ]] && return 0
  case ",${AGENTS// /}," in *",$1,"*) return 0 ;; esac
  return 1
}

# ---------------------------------------------------------------------------
# 3. Agents
# ---------------------------------------------------------------------------
setvar() { printf -v "$1" '%s' "$2"; export "${1?}"; }

write_conf() { # writes $CONF from the variables exported in CONF_KEYS
  local out="$1" k v
  {
    echo "# ai-team — project configuration (generated by install.sh on $(date +%Y-%m-%d))"
    echo "#"
    echo "# Shell format: KEY='value'. Fix what the detector got wrong or missed and run"
    echo "#   install.sh --render         to regenerate the agents and project-context.md"
    echo "#   install.sh --reconfigure    to detect everything again (loses these edits)"
    echo "# Lists are space-separated. Empty = not detected / does not apply."
    echo "# OUTPUT_LANGUAGE: language the agents write in (replies and change artifacts), e.g. en, pt-BR."
    echo "# GIT_NO_PUSH=1: the agents never push (the developer pushes), e.g. when the remote working"
    echo "#   branch is protected or a push deploys; *_PROTECTED_BRANCH is the branch that takes no commits."
    echo
    for k in $CONF_KEYS; do
      v="${!k:-}"
      printf "%s='%s'\n" "$k" "${v//\'/\'\\\'\'}"
    done
  } > "$out"
}

install_generic() {
  local detected="$WORK/detected.conf"

  # --- 3a. load or detect --------------------------------------------------
  if [[ $DETECT_ONLY -eq 1 ]]; then
    bash "$SRC/lib/detect.sh" "$PROJ"
    exit 0
  fi

  if [[ -f "$CONF" && $RECONFIGURE -eq 0 ]]; then
    log "using $CONF (use --reconfigure to detect again)"
    set -a; . "$CONF"; set +a
    CONF_KEYS="$(grep -oE '^[A-Z][A-Z0-9_]*=' "$CONF" | tr -d = | tr '\n' ' ')"
    CONF_CHANGED=0
  else
    [[ $RENDER_ONLY -eq 1 ]] && die "--render needs an existing $CONF"
    log "reading the project at $PROJ"
    bash "$SRC/lib/detect.sh" "$PROJ" > "$detected"
    set -a; . "$detected"; set +a
    CONF_KEYS="$(grep -oE '^[A-Z][A-Z0-9_]*=' "$detected" | tr -d = | tr '\n' ' ')"
    CONF_CHANGED=1
    [[ -f "$CONF" ]] && warn "existing ai-team.conf will be replaced (--reconfigure)"
  fi
  # manual keys the detector does not fill
  for k in TEST_PERSONAS HUB_TEAM; do
    case " $CONF_KEYS " in *" $k "*) ;; *) CONF_KEYS="$CONF_KEYS $k"; setvar "$k" "${!k:-}" ;; esac
  done
  # output language: en unless the conf says otherwise (an OUTPUT_LANGUAGE from the environment
  # is ignored); a conf without the key gets it written
  case " $CONF_KEYS " in *" OUTPUT_LANGUAGE "*) ;; *) setvar OUTPUT_LANGUAGE en; CONF_KEYS="OUTPUT_LANGUAGE $CONF_KEYS"; CONF_CHANGED=1 ;; esac
  [[ -n "${OUTPUT_LANGUAGE:-}" ]] || setvar OUTPUT_LANGUAGE en
  setvar AI_TEAM_PROFILE "generic"
  case " $CONF_KEYS " in *" AI_TEAM_PROFILE "*) ;; *) CONF_KEYS="AI_TEAM_PROFILE $CONF_KEYS" ;; esac

  # --- 3b. --set K=V ---------------------------------------------------------
  local s k v
  for s in "${SETS[@]+"${SETS[@]}"}"; do
    k="${s%%=*}"; v="${s#*=}"
    [[ "$k" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "invalid --set: $s (use KEY=value)"
    setvar "$k" "$v"
    case " $CONF_KEYS " in *" $k "*) ;; *) CONF_KEYS="$CONF_KEYS $k" ;; esac
    CONF_CHANGED=1
  done

  # --- 3b'. hub: team and project name ------------------------------------
  ask_hub "${HUB_TEAM:-}" "${PROJECT_NAME:-}"
  for k in HUB_TEAM PROJECT_NAME; do
    v="$([[ $k == HUB_TEAM ]] && printf '%s' "$HUB_TEAM" || printf '%s' "$HUB_NAME")"
    [[ "$v" == "${!k:-}" ]] && continue
    setvar "$k" "$v"; CONF_CHANGED=1
    case " $CONF_KEYS " in *" $k "*) ;; *) CONF_KEYS="$CONF_KEYS $k" ;; esac
  done

  # the installer's (or the user's) openspec init beats an old conf
  if [[ -d "$PROJ/openspec" && "${HAS_OPENSPEC:-0}" != 1 ]]; then
    setvar HAS_OPENSPEC 1; CONF_CHANGED=1
    case " $CONF_KEYS " in *" HAS_OPENSPEC "*) ;; *) CONF_KEYS="$CONF_KEYS HAS_OPENSPEC" ;; esac
  fi

  # --- 3c. derived (not written to the conf) --------------------------------
  local P c gate
  for P in BACKEND FRONTEND; do
    gate=""
    for c in "${P}_CMD_LINT" "${P}_CMD_FORMAT" "${P}_CMD_TYPECHECK" "${P}_CMD_TEST" "${P}_CMD_BUILD"; do
      [[ -n "${!c:-}" ]] && gate="${gate:+$gate; }${!c}"
    done
    setvar "${P}_GATE" "$gate"
  done
  local team="spec-writer provisioner"
  [[ "${HAS_BACKEND:-0}" == "1" ]] && team="$team builder"
  [[ "${HAS_FRONTEND:-0}" == "1" ]] && team="$team integrator"
  team="$team reviewer validator"
  setvar TEAM_AGENTS "$team"
  setvar TEAM_AGENTS_CSV "${team// /, }"

  # --- 3d. summary -----------------------------------------------------------
  echo
  log "project: ${PROJECT_NAME:-?} (${LAYOUT:-?})"
  [[ "${HAS_BACKEND:-0}" == "1" ]]  && echo "    backend   ${BACKEND_DIR}/  ${BACKEND_STACK}  · branch ${BACKEND_BRANCH}${BACKEND_PROTECTED_BRANCH:+ (protected: $BACKEND_PROTECTED_BRANCH)}"
  [[ "${HAS_FRONTEND:-0}" == "1" && "${SAME_DIR:-0}" != "1" ]] && echo "    frontend  ${FRONTEND_DIR}/  ${FRONTEND_STACK}  · branch ${FRONTEND_BRANCH}${FRONTEND_PROTECTED_BRANCH:+ (protected: $FRONTEND_PROTECTED_BRANCH)}"
  [[ "${HAS_BACKEND:-0}" == "1" ]]  && echo "    gate back  ${BACKEND_GATE:-(no command detected)}"
  [[ "${HAS_FRONTEND:-0}" == "1" && "${SAME_DIR:-0}" != "1" ]] && echo "    gate front ${FRONTEND_GATE:-(no command detected)}"
  echo "    docs      ${DOCS_CONTEXT:-}${DOCS_STANDARDS:+ $DOCS_STANDARDS}${BACKEND_DOCS_STANDARDS:+ $BACKEND_DIR/$BACKEND_DOCS_STANDARDS}${DOCS_ENV:+ $DOCS_ENV}${DOCS_ARCH:+ $DOCS_ARCH}"
  echo "    openspec  $([[ "${HAS_OPENSPEC:-0}" == 1 ]] && echo 'openspec/ present' || echo 'not initialized')"
  echo "    language  ${OUTPUT_LANGUAGE}"
  [[ -n "${HUB_TEAM:-}" ]] && echo "    hub       team ${HUB_TEAM} ($(hub_file))"
  [[ "${HAS_BACKEND:-0}" != "1" && "${HAS_FRONTEND:-0}" != "1" ]] && warn "no recognized package; agents come out without stack/commands (fill in the conf)"
  echo

  # --- 3e. write conf --------------------------------------------------------
  if [[ $CONF_CHANGED -eq 1 ]]; then
    write_conf "$WORK/ai-team.conf"
    if [[ $DRY -eq 1 ]]; then echo "  + ai-team.conf"; else
      mkdir -p "$DEST"; cp "$WORK/ai-team.conf" "$CONF"; ok "wrote ai-team.conf"
    fi
  fi

  # --- 3f. project-context.md (generated part + preserved notes) --------------
  # the notes marker was <!-- ai-team:notas --> before the English version: both are
  # recognized, and the merge writes the current one
  local ctx="$DEST/project-context.md" new="$WORK/project-context.md" marker='<!-- ai-team:notes -->'
  local notes_re='<!-- ai-team:not(es|as) -->'
  bash "$SRC/lib/render.sh" "$SRC/templates/project-context.md" > "$new" || die "failed to render project-context.md"
  if [[ -f "$ctx" ]] && grep -qE "$notes_re" "$ctx"; then
    { sed -E "/$notes_re/,\$d" "$new"; printf '%s\n' "$marker"; sed -En "/$notes_re/,\$p" "$ctx" | sed 1d; } > "$new.merged"
    mv "$new.merged" "$new"
    if cmp -s "$new" "$ctx"; then ok "same    project-context.md"
    elif [[ $DRY -eq 1 ]]; then echo "  ~ project-context.md (generated part updated; notes preserved)"
    else cp "$new" "$ctx"; ok "updated project-context.md (notes preserved)"; fi
  else
    copy_file "$new" "$ctx"
  fi

  # --- 3g. rendered agents ------------------------------------------------
  [[ $DO_AGENTS -eq 1 ]] || return 0
  log "agents (generic profile)"
  local t name
  for t in "$SRC"/templates/agents/*.md; do
    name="$(basename "$t" .md)"
    case " $team orchestrator " in *" $name "*) ;; *) continue ;; esac
    wanted_agent "$name" || continue
    bash "$SRC/lib/render.sh" "$t" > "$WORK/$name.md" || die "failed to render $name"
    write_generated "$WORK/$name.md" "$DEST/agents/$name.md"
  done
  if [[ -n "$AGENTS" ]]; then
    IFS=',' read -ra LIST <<< "$AGENTS"
    for a in "${LIST[@]}"; do a="${a// /}"; [[ -f "$SRC/templates/agents/$a.md" ]] || warn "agent not found: $a"; done
  fi

  # --- 3h. agent skills (rendered; loaded through the agent's skills: field) ---
  local committers=0
  for name in provisioner builder integrator; do
    case " $team " in *" $name "*) wanted_agent "$name" && committers=1 ;; esac
  done
  if [[ $committers -eq 1 ]]; then
    local sk
    for sk in gate-and-commit worktree; do
      log "skill $sk"
      bash "$SRC/lib/render.sh" "$SRC/templates/skills/$sk/SKILL.md" > "$WORK/$sk.md" || die "failed to render $sk"
      write_generated "$WORK/$sk.md" "$DEST/skills/$sk/SKILL.md"
    done
    # the script skips the render (the generated marker would break bash); it reads the conf at run time
    copy_file "$SRC/templates/skills/worktree/wt.sh" "$DEST/skills/worktree/wt.sh"
    [[ $DRY -eq 1 ]] || chmod +x "$DEST/skills/worktree/wt.sh"
  fi
}

install_profile() { # profile with ready-made files, copied without rendering
  local pdir="$SRC/profiles/$PROFILE/agents"
  [[ -d "$pdir" ]] || die "profile not found: $PROFILE (look under profiles/)"
  [[ $DETECT_ONLY -eq 1 || $RENDER_ONLY -eq 1 || $RECONFIGURE -eq 1 || ${#SETS[@]} -gt 0 ]] && \
    warn "--detect-only/--render/--reconfigure/--set only apply to the generic profile; ignored"
  [[ $DO_AGENTS -eq 1 ]] || return 0
  log "agents ($PROFILE profile)"
  local f name
  for f in "$pdir"/*.md; do
    name="$(basename "$f" .md)"
    wanted_agent "$name" || continue
    copy_file "$f" "$DEST/agents/$name.md"
  done
  if [[ -n "$AGENTS" ]]; then
    IFS=',' read -ra LIST <<< "$AGENTS"
    for a in "${LIST[@]}"; do a="${a// /}"; [[ -f "$pdir/$a.md" ]] || warn "agent not found: $a"; done
  fi
}

log "target: $DEST"
# ---------------------------------------------------------------------------
# OpenSpec — the openspec-* skills and /opsx:* commands come from the CLI itself
# (runs before the agents: the openspec/ created here turns HAS_OPENSPEC on in the conf)
# ---------------------------------------------------------------------------
OPENSPEC_TESTED="1.14.1"   # version whose skill and /opsx:* names the agents cite
OPENSPEC_PKG="@fission-ai/openspec@$OPENSPEC_TESTED"
OPENSPEC_MISSING=0
# the CLI is an ai-team dependency (the openspec-* skills call openspec at every step):
# if missing, installs the tested version in the active Node's global npm; if present, leaves it alone
openspec_cli() {
  command -v openspec >/dev/null 2>&1 && return 0
  if ! command -v npm >/dev/null 2>&1; then
    warn "CLI 'openspec' not found and no 'npm' to install it: install Node 18+ and run npm i -g $OPENSPEC_PKG"
    return 1
  fi
  log "CLI 'openspec' not found: npm i -g $OPENSPEC_PKG"
  if [[ $DRY -eq 1 ]]; then echo "  + npm i -g $OPENSPEC_PKG"; return 1; fi
  if npm i -g "$OPENSPEC_PKG" > "$WORK/npm.log" 2>&1 && hash -r && command -v openspec >/dev/null 2>&1; then
    ok "openspec $OPENSPEC_TESTED installed ($(command -v openspec))"; return 0
  fi
  tail -5 "$WORK/npm.log" >&2
  warn "could not install the 'openspec' CLI: run npm i -g $OPENSPEC_PKG (with the Node you use) and install.sh again"
  return 1
}
openspec_init() {
  [[ $DO_OPENSPEC -eq 1 && $DETECT_ONLY -eq 0 ]] || return 0
  if ! openspec_cli; then
    [[ $DRY -eq 1 ]] && { echo "  + openspec init --tools claude"; return 0; }
    OPENSPEC_MISSING=1; return 0
  fi
  local v; v="$(openspec --version 2>/dev/null || true)"
  [[ "$v" == "$OPENSPEC_TESTED" ]] || warn "openspec ${v:-?} installed; the agents were tested with $OPENSPEC_TESTED (check whether the openspec-* skills and /opsx:* commands were renamed)"
  log "openspec init (skills openspec-* e commands /opsx:*)"
  if [[ $DRY -eq 1 ]]; then echo "  + openspec init --tools claude"; return 0; fi
  openspec init --tools claude --no-animation "$PROJ" > "$WORK/openspec.log" 2>&1 \
    || { cat "$WORK/openspec.log" >&2; die "openspec init failed"; }
  ok "openspec init"
}
openspec_init

if [[ "$PROFILE" == "generic" ]]; then install_generic; else ask_hub "" "$(basename "$PROJ")"; install_profile; fi
# /team: the current session becomes the orchestrator (reads .claude/agents/orchestrator.md); any profile.
# It is a skill (its body comes back after compaction) and hook.sh's SessionStart/UserPromptExpansion
# hooks restate the role after compacting.
TEAM_SKILL=0
if [[ $DO_AGENTS -eq 1 ]] && wanted_agent orchestrator; then
  TEAM_SKILL=1
  log "skill /team"
  copy_file "$SRC/templates/skills/team/SKILL.md" "$DEST/skills/team/SKILL.md"
  # /onboarding: the team investigates the project and records the context the detector cannot see
  log "skill /onboarding"
  copy_file "$SRC/templates/skills/onboarding/SKILL.md" "$DEST/skills/onboarding/SKILL.md"
fi
# grilling (the spec-writer loads it through skills:) and /grill-me, copied unchanged from
# mattpocock/skills (MIT); how each agent uses grilling is in the agent's own text.
if [[ $DO_AGENTS -eq 1 ]] && { wanted_agent spec-writer || wanted_agent orchestrator; }; then
  log "skills grilling and /grill-me"
  for sk in grilling grill-me; do
    copy_file "$SRC/templates/skills/$sk/SKILL.md" "$DEST/skills/$sk/SKILL.md"
    copy_file "$SRC/templates/skills/$sk/LICENSE" "$DEST/skills/$sk/LICENSE"
  done
fi

# ---------------------------------------------------------------------------
# 4. dashboard — same for every profile
# ---------------------------------------------------------------------------
[[ $DO_DASHBOARD -eq 1 ]] && { log "dashboard"; copy_tree "$SRC/dashboard" "$DEST/dashboard"; [[ $DRY -eq 1 ]] || chmod +x "$DEST/dashboard/hook.sh" 2>/dev/null || true; if [[ "$PROFILE" != generic ]]; then copy_tree "$SRC/profiles/$PROFILE/dashboard" "$DEST/dashboard"; fi; }
# without the dashboard, /team still needs hook.sh (reminder after compaction)
[[ $DO_DASHBOARD -eq 0 && $TEAM_SKILL -eq 1 && $RENDER_ONLY -eq 0 ]] && { copy_file "$SRC/dashboard/hook.sh" "$DEST/dashboard/hook.sh"; copy_file "$SRC/dashboard/hook.mjs" "$DEST/dashboard/hook.mjs"; [[ $DRY -eq 1 ]] || chmod +x "$DEST/dashboard/hook.sh" 2>/dev/null || true; }
# the hooks run on node (hook.sh only hands off to hook.mjs): without node they record nothing
[[ ($DO_DASHBOARD -eq 1 || $TEAM_SKILL -eq 1) && $RENDER_ONLY -eq 0 ]] && ! command -v node >/dev/null 2>&1 && \
  warn "'node' not found: the ai-team hooks (dashboard, /team reminder after compacting) need Node 18+"

# ---------------------------------------------------------------------------
# 5. settings.json — only created when missing (never overwrites permissions)
#    With the dashboard, the new file already has the SubagentStart/Stop hooks that
#    mark each agent's start and end (optional; the dashboard works without them).
# ---------------------------------------------------------------------------
HOOK_CMD='$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh'
settings_json() { # only what was asked for: fixed agent (--default-agent), dashboard and /team hooks
  local agent="" hooks="" evs=() e list="" nl=$'\n'
  [[ -n "$DEFAULT_AGENT" ]] && agent="$(printf '  "agent": "%s"' "$DEFAULT_AGENT")"
  [[ $DO_DASHBOARD -eq 1 ]] && evs+=(SubagentStart SubagentStop StopFailure)
  [[ $TEAM_SKILL -eq 1 ]] && evs+=(SessionStart UserPromptExpansion)
  for e in "${evs[@]+"${evs[@]}"}"; do
    list="${list:+$list,$nl}$(printf '    "%s": [{ "hooks": [{ "type": "command", "command": "%s" }] }]' "$e" "$HOOK_CMD")"
  done
  # decisions answered from the dashboard (dashboard/ask.mjs); timeout above ask.mjs's wait (280 s; 3300 s in away mode)
  # Stop: in away-from-computer mode it waits for the end-of-turn reply (ask.mjs, up to 3300 s)
  [[ $DO_DASHBOARD -eq 1 ]] && list="${list:+$list,$nl}$(printf '    "Stop": [{ "hooks": [{ "type": "command", "command": "%s", "timeout": 3600 }] }]' "$HOOK_CMD")"
  # SessionEnd: 1.5 s by default in Claude Code; 10 s leaves time for the phone notification
  [[ $DO_DASHBOARD -eq 1 ]] && list="${list:+$list,$nl}$(printf '    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "%s", "timeout": 10 }] }]' "$HOOK_CMD")"
  [[ $DO_DASHBOARD -eq 1 ]] && list="${list:+$list,$nl}"'    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/dashboard/ask.mjs\"", "timeout": 3600 }] }]'
  [[ -n "$list" ]] && hooks="$(printf '  "hooks": {\n%s\n  }' "$list")"
  local sep=""; [[ -n "$agent" && -n "$hooks" ]] && sep=$',\n'
  printf '{\n%s%s%s\n}\n' "$agent" "$sep" "$hooks"
}
settings_desc() {
  local d=()
  [[ -n "$DEFAULT_AGENT" ]] && d+=("fixed agent: $DEFAULT_AGENT")
  [[ $DO_DASHBOARD -eq 1 ]] && d+=("dashboard hooks")
  [[ $TEAM_SKILL -eq 1 ]] && d+=("/team hooks")
  local IFS=';'; echo "${d[*]+"${d[*]}"}" | sed 's/;/; /g'
}
if [[ $DO_SETTINGS -eq 1 ]]; then
  if [[ -f "$DEST/settings.json" ]]; then
    log "settings.json already exists: kept; only the missing ai-team hooks are added"
    fixed="$(sed -nE 's/.*"agent"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$DEST/settings.json" | head -1)"
    [[ -n "$fixed" && -z "$DEFAULT_AGENT" ]] && \
      warn "every session starts as '$fixed' (\"agent\" key in settings.json); to choose per session (/team or claude --agent $fixed), remove the key"
    [[ -n "$DEFAULT_AGENT" && "$fixed" != "$DEFAULT_AGENT" ]] && warn "to fix the agent, add \"agent\": \"$DEFAULT_AGENT\" to settings.json"
    # missing dashboard and /team hooks: added without touching the rest (dashboard/settings.mjs)
    hook_evs=""
    [[ $DO_DASHBOARD -eq 1 ]] && hook_evs="SubagentStart,SubagentStop,Stop,StopFailure,SessionEnd,PermissionRequest"
    [[ $TEAM_SKILL -eq 1 ]] && hook_evs="${hook_evs:+$hook_evs,}SessionStart,UserPromptExpansion"
    if [[ -n "$hook_evs" ]]; then
      if command -v node >/dev/null 2>&1; then
        # shellcheck disable=SC2046  # without --dry-run, the substitution vanishes on purpose
        node "$SRC/dashboard/settings.mjs" --file "$DEST/settings.json" --events "$hook_evs" $([[ $DRY -eq 1 ]] && echo --dry-run) >&2 \
          || warn "settings.json not updated; see the snippet to paste above"
      else
        warn "settings.json: 'node' not found; check the hooks $hook_evs (see .claude/dashboard/hook.sh and ask.mjs)"
      fi
    fi
  elif [[ -z "$DEFAULT_AGENT" && $DO_DASHBOARD -eq 0 && $TEAM_SKILL -eq 0 ]]; then
    :   # nothing to write
  elif [[ $DRY -eq 1 ]]; then
    echo "  + settings.json ($(settings_desc))"
  else
    mkdir -p "$DEST"
    settings_json > "$DEST/settings.json"
    ok "settings.json ($(settings_desc))"
  fi
fi

# ---------------------------------------------------------------------------
# 5b. hub — registers (or updates) the project in the hub registry
# ---------------------------------------------------------------------------
if [[ -n "${HUB_TEAM:-}" ]]; then
  if [[ $DRY -eq 1 ]]; then echo "  + hub: ${HUB_TEAM}/${HUB_NAME:-$(basename "$PROJ")} in $(hub_file)"
  elif command -v node >/dev/null 2>&1; then
    node "$SRC/dashboard/hub.mjs" add "$PROJ" --team "$HUB_TEAM" ${HUB_NAME:+--name "$HUB_NAME"} --hub "$(hub_file)" >&2 \
      || warn "could not register in the hub ($(hub_file))"
  else
    warn "hub: 'node' not found; register later with: node dashboard/hub.mjs add \"$PROJ\" --team \"$HUB_TEAM\""
  fi
fi

# ---------------------------------------------------------------------------
# 5c. phone notifications — the config belongs to the machine (all projects), not the project
#     --ntfy-topic wins; without it and without a config, asks (enter skips, "new" generates a topic)
# ---------------------------------------------------------------------------
notify_file() { printf '%s' "${AI_TEAM_NOTIFY_FILE:-$HOME/.config/ai-team/notify.json}"; }
if [[ $DO_DASHBOARD -eq 1 && $RENDER_ONLY -eq 0 ]]; then
  ntfy_topic="${NTFY_TOPIC:-}" ntfy_asked=0
  if [[ -z "$ntfy_topic" && ! -f "$(notify_file)" ]] && can_ask && command -v node >/dev/null 2>&1; then
    log "phone notifications (ntfy app): not configured on this machine yet"
    ntfy_topic="$(ask 'ntfy topic (enter skips; "new" generates one)' '')"; ntfy_asked=1
  fi
  [[ "$ntfy_topic" == new ]] && ntfy_topic="-"
  if [[ -n "$ntfy_topic" ]]; then
    if [[ $DRY -eq 1 ]]; then echo "  + notifications: topic $ntfy_topic in $(notify_file)"
    elif command -v node >/dev/null 2>&1; then
      # shellcheck disable=SC2046
      node "$SRC/dashboard/notify.mjs" setup $([[ "$ntfy_topic" != - ]] && printf '%s' "$ntfy_topic") >&2 || warn "notifications not configured"
      if [[ $ntfy_asked -eq 1 && -f "$(notify_file)" && "$(ask 'send a test notification now? (y/N)' 'n')" =~ ^[yY] ]]; then
        node "$SRC/dashboard/notify.mjs" test >&2 || true
      fi
    else
      warn "notifications: 'node' not found; set them up later in the dashboard's Notifications tab"
    fi
  elif [[ -f "$(notify_file)" ]]; then
    ok "phone notifications: configured on this machine ($(notify_file))"
  else
    echo "  phone notifications: install.sh --ntfy-topic <topic>, or the dashboard's Notifications tab" >&2
  fi
fi

# ---------------------------------------------------------------------------
# 6. Final notes
# ---------------------------------------------------------------------------
echo
if [[ $DO_DASHBOARD -eq 1 ]]; then
  if command -v node >/dev/null 2>&1; then
    echo "  dashboard: node .claude/dashboard/server.mjs   (http://127.0.0.1:4321/)" >&2
  else
    warn "dashboard installed, but 'node' was not found (Node 18+ is needed to run .claude/dashboard/server.mjs)"
  fi
  echo "  (add .claude/ai-team/ to the project's .gitignore: it holds the hook log)" >&2
fi
if [[ $DO_AGENTS -eq 1 ]] && wanted_agent orchestrator; then
  if [[ -n "$DEFAULT_AGENT" ]]; then echo "  team: every session starts as $DEFAULT_AGENT" >&2
  else echo "  team: in a session, /team <request>; or right at startup: claude --agent orchestrator" >&2; fi
  grep -qs 'ai-team:onboarding' "$DEST/project-context.md" "$PROJ/CLAUDE.md" || \
    echo "  onboarding: run /onboarding in a session; the team investigates the project and records context, standards and environment" >&2
fi
[[ $OPENSPEC_MISSING -eq 1 ]] && warn "no 'openspec' CLI: the project has no openspec-* skills or /opsx:* commands. Run npm i -g $OPENSPEC_PKG and install.sh again"
if [[ "$PROFILE" == "generic" ]]; then
  ok "done. Check .claude/ai-team.conf (stack, branches, gate commands, docs, OUTPUT_LANGUAGE)"
  echo "  and .claude/project-context.md (add business rules below 'ai-team:notes')."
  echo "  After editing the conf: install.sh --render"
  [[ -z "${BACKEND_GATE:-}${FRONTEND_GATE:-}" ]] && warn "no gate command detected: fill in BACKEND_CMD_* / FRONTEND_CMD_* in the conf"
  [[ -z "${DOCS_STANDARDS:-}${BACKEND_DOCS_STANDARDS:-}${FRONTEND_DOCS_STANDARDS:-}" ]] && warn "no standards doc: create docs/standards.md and point DOCS_STANDARDS to it (the reviewer's yardstick)"
else
  ok "done. Agents of profile '$PROFILE' installed in $DEST/agents"
fi
# a successful run exits 0 (the [[ … ]] && warn lines above would otherwise leak their status)
exit 0
