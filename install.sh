#!/usr/bin/env bash
# ai-team — instala os agentes, skills e comandos do Claude Code num projeto.
#
# Uso (remoto, sem clonar):
#   curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --agents tech-lead,product-owner --no-skills
#
# Uso (repo clonado):
#   ./install.sh [opções] [diretório-do-projeto]
#
# Opções:
#   --agents a,b,c     instala só esses agentes (padrão: todos)
#   --no-agents        não instala agentes
#   --no-skills        não instala skills/openspec-*
#   --no-commands      não instala commands/opsx
#   --default-agent X  grava .claude/settings.json com {"agent": "X"} (padrão: tech-lead)
#   --no-settings      não toca em settings.json
#   --force            sobrescreve arquivos existentes (padrão: pula e avisa)
#   --ref REF          branch/tag do repo (padrão: main)
#   --dry-run          só mostra o que faria
#   -h, --help
set -euo pipefail

REPO="${AI_TEAM_REPO:-raphaelmonteiro/ai-team}"
REF="main"
TARGET="."
AGENTS=""
DO_AGENTS=1 DO_SKILLS=1 DO_COMMANDS=1 DO_SETTINGS=1
DEFAULT_AGENT="tech-lead"
FORCE=0 DRY=0

usage() { sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --agents) AGENTS="$2"; shift 2 ;;
    --no-agents) DO_AGENTS=0; shift ;;
    --no-skills) DO_SKILLS=0; shift ;;
    --no-commands) DO_COMMANDS=0; shift ;;
    --default-agent) DEFAULT_AGENT="$2"; shift 2 ;;
    --no-settings) DO_SETTINGS=0; shift ;;
    --force) FORCE=1; shift ;;
    --ref) REF="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage ;;
    -*) echo "opção desconhecida: $1" >&2; exit 1 ;;
    *) TARGET="$1"; shift ;;
  esac
done

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*"; }

# ---------------------------------------------------------------------------
# 1. Localizar a fonte: diretório do repo clonado ou download do tarball
# ---------------------------------------------------------------------------
SRC=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "$(dirname "${BASH_SOURCE[0]}")/agents/tech-lead.md" ]]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  log "usando fonte local: $SRC"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  URL="https://github.com/${REPO}/archive/refs/heads/${REF}.tar.gz"
  log "baixando ${REPO}@${REF}"
  curl -fsSL "$URL" | tar -xz -C "$TMP"
  SRC="$(find "$TMP" -maxdepth 1 -mindepth 1 -type d | head -1)"
fi

DEST="$(cd "$TARGET" && pwd)/.claude"
log "destino: $DEST"

# ---------------------------------------------------------------------------
# 2. Copiar com proteção contra sobrescrita
# ---------------------------------------------------------------------------
copy_file() { # src dest
  local s="$1" d="$2"
  if [[ -e "$d" && $FORCE -eq 0 ]]; then
    if cmp -s "$s" "$d"; then ok "igual   ${d#$DEST/}"; else warn "existe  ${d#$DEST/} (use --force para sobrescrever)"; fi
    return
  fi
  if [[ $DRY -eq 1 ]]; then echo "  + ${d#$DEST/}"; return; fi
  mkdir -p "$(dirname "$d")"
  cp "$s" "$d"
  ok "copiado ${d#$DEST/}"
}

copy_tree() { # src_dir dest_dir
  local s="$1" d="$2"
  [[ -d "$s" ]] || return 0
  while IFS= read -r -d '' f; do
    copy_file "$f" "$d/${f#$s/}"
  done < <(find "$s" -type f -print0)
}

if [[ $DO_AGENTS -eq 1 ]]; then
  log "agentes"
  if [[ -n "$AGENTS" ]]; then
    IFS=',' read -ra LIST <<< "$AGENTS"
    for a in "${LIST[@]}"; do
      a="${a// /}"
      if [[ -f "$SRC/agents/$a.md" ]]; then
        copy_file "$SRC/agents/$a.md" "$DEST/agents/$a.md"
      else
        warn "agente não encontrado: $a"
      fi
    done
  else
    copy_tree "$SRC/agents" "$DEST/agents"
  fi
fi

[[ $DO_SKILLS -eq 1 ]]   && { log "skills";   copy_tree "$SRC/skills"   "$DEST/skills"; }
[[ $DO_COMMANDS -eq 1 ]] && { log "commands"; copy_tree "$SRC/commands" "$DEST/commands"; }

# ---------------------------------------------------------------------------
# 3. settings.json — só cria se não existir (nunca sobrescreve permissões)
# ---------------------------------------------------------------------------
if [[ $DO_SETTINGS -eq 1 ]]; then
  if [[ -f "$DEST/settings.json" ]]; then
    warn "settings.json já existe; não alterado (agente padrão sugerido: $DEFAULT_AGENT)"
  elif [[ $DRY -eq 1 ]]; then
    echo "  + settings.json {\"agent\": \"$DEFAULT_AGENT\"}"
  else
    mkdir -p "$DEST"
    printf '{\n  "agent": "%s"\n}\n' "$DEFAULT_AGENT" > "$DEST/settings.json"
    ok "settings.json (agente padrão: $DEFAULT_AGENT)"
  fi
fi

# ---------------------------------------------------------------------------
# 4. Avisos finais
# ---------------------------------------------------------------------------
if [[ $DO_SKILLS -eq 1 || $DO_COMMANDS -eq 1 ]] && ! command -v openspec >/dev/null 2>&1; then
  warn "CLI 'openspec' não encontrado; skills/commands opsx precisam dele: npm i -g @fission-ai/openspec && openspec init"
fi

echo
ok "pronto. Edite os agentes em $DEST/agents para o contexto deste projeto"
echo "  (stack, branches, caminhos de docs e comandos de gate são do PLATO por padrão)."
