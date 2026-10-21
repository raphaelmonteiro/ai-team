#!/usr/bin/env bash
# ai-team — instala a equipe de agentes do Claude Code num projeto,
# lendo o projeto e configurando os agentes para ele.
#
# Uso (remoto, sem clonar):
#   curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash
#   curl -fsSL .../install.sh | bash -s -- --detect-only
#   curl -fsSL .../install.sh | bash -s -- --set BACKEND_BRANCH=develop --no-skills
#
# Uso (repo clonado):
#   ./install.sh [opções] [diretório-do-projeto]
#
# Fluxo do perfil genérico (padrão):
#   1. lib/detect.sh lê o projeto (manifestos, Makefile, docker-compose, git, docs)
#   2. grava .claude/ai-team.conf com o que achou (edite à vontade)
#   3. gera .claude/project-context.md a partir do conf
#   4. renderiza os agentes de templates/agents/*.md com as variáveis do conf
#
# Opções:
#   --profile NOME     generic (padrão, detecta e renderiza) | plato | outro de profiles/
#   --detect-only      só roda o detector e imprime o conf; não grava nada
#   --reconfigure      ignora o ai-team.conf existente e detecta de novo
#   --render           só re-renderiza agentes e contexto a partir do conf existente
#   --set K=V          sobrescreve uma variável do conf (repetível; grava no conf)
#   --agents a,b,c     instala só esses agentes (padrão: todos os aplicáveis)
#   --no-agents        não instala agentes
#   --no-skills        não instala skills/openspec-*
#   --no-commands      não instala commands/opsx
#   --no-dashboard     não instala o painel (.claude/dashboard: node server.mjs)
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
PROFILE="generic"
AGENTS=""
DO_AGENTS=1 DO_SKILLS=1 DO_COMMANDS=1 DO_SETTINGS=1 DO_DASHBOARD=1
DEFAULT_AGENT="tech-lead"
FORCE=0 DRY=0 DETECT_ONLY=0 RECONFIGURE=0 RENDER_ONLY=0
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
    --no-skills) DO_SKILLS=0; shift ;;
    --no-commands) DO_COMMANDS=0; shift ;;
    --no-dashboard) DO_DASHBOARD=0; shift ;;
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

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# --render só regenera os arquivos derivados do conf
[[ $RENDER_ONLY -eq 1 ]] && DO_SKILLS=0 DO_COMMANDS=0 DO_SETTINGS=0 DO_DASHBOARD=0

# ---------------------------------------------------------------------------
# 1. Localizar a fonte: diretório do repo clonado ou download do tarball
# ---------------------------------------------------------------------------
SRC=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "$(dirname "${BASH_SOURCE[0]}")/lib/detect.sh" ]]; then
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

PROJ="$(cd "$TARGET" && pwd)"
DEST="$PROJ/.claude"
CONF="$DEST/ai-team.conf"
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK" ${TMP:-}' EXIT

# ---------------------------------------------------------------------------
# 2. Cópia com proteção contra sobrescrita
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

# Arquivos gerados levam no fim um marcador com o checksum do conteúdo.
# Se o arquivo existente ainda bate com o próprio marcador, ninguém o
# editou à mão e ele pode ser atualizado sem --force.
GEN_MARK='<!-- ai-team:generated'
gen_sum() { sed "/^$GEN_MARK/d" "$1" | cksum | cut -d' ' -f1; }
gen_untouched() { # arquivo → 0 se é gerado e intocado
  local last; last="$(tail -1 "$1")"
  [[ "$last" == "$GEN_MARK"* ]] || return 1
  [[ "$last" == *"cksum=$(gen_sum "$1") "* ]]
}
write_generated() { # rendered dest
  local s="$1" d="$2"
  printf '\n' >> "$s"   # a linha em branco entra no checksum (gen_sum só remove o marcador)
  printf '%s cksum=%s — edite .claude/ai-team.conf e rode install.sh --render -->\n' "$GEN_MARK" "$(cksum < "$s" | cut -d' ' -f1)" >> "$s"
  if [[ -e "$d" && $FORCE -eq 0 ]]; then
    if cmp -s "$s" "$d"; then ok "igual   ${d#$DEST/}"; return; fi
    if ! gen_untouched "$d"; then warn "existe  ${d#$DEST/} (editado à mão; use --force para sobrescrever)"; return; fi
    if [[ $DRY -eq 1 ]]; then echo "  ~ ${d#$DEST/}"; return; fi
    cp "$s" "$d"; ok "atualizado ${d#$DEST/}"; return
  fi
  copy_file "$s" "$d"
}

wanted_agent() { # nome → 0 se deve instalar
  [[ -z "$AGENTS" ]] && return 0
  case ",${AGENTS// /}," in *",$1,"*) return 0 ;; esac
  return 1
}

# ---------------------------------------------------------------------------
# 3. Agentes
# ---------------------------------------------------------------------------
setvar() { printf -v "$1" '%s' "$2"; export "$1"; }

write_conf() { # grava $CONF a partir das variáveis exportadas em CONF_KEYS
  local out="$1" k v
  {
    echo "# ai-team — configuração do projeto (gerada por install.sh em $(date +%Y-%m-%d))"
    echo "#"
    echo "# Formato shell: CHAVE='valor'. Edite o que o detector errou ou não viu e rode"
    echo "#   install.sh --render         para regenerar agentes e project-context.md"
    echo "#   install.sh --reconfigure    para detectar tudo de novo (perde estas edições)"
    echo "# Listas são separadas por espaço. Vazio = não detectado / não se aplica."
    echo
    for k in $CONF_KEYS; do
      v="${!k:-}"
      printf "%s='%s'\n" "$k" "${v//\'/\'\\\'\'}"
    done
  } > "$out"
}

install_generic() {
  local detected="$WORK/detected.conf"

  # --- 3a. carregar ou detectar ---------------------------------------------
  if [[ $DETECT_ONLY -eq 1 ]]; then
    bash "$SRC/lib/detect.sh" "$PROJ"
    exit 0
  fi

  if [[ -f "$CONF" && $RECONFIGURE -eq 0 ]]; then
    log "usando $CONF (use --reconfigure para detectar de novo)"
    set -a; . "$CONF"; set +a
    CONF_KEYS="$(grep -oE '^[A-Z][A-Z0-9_]*=' "$CONF" | tr -d = | tr '\n' ' ')"
    CONF_CHANGED=0
  else
    [[ $RENDER_ONLY -eq 1 ]] && die "--render precisa de um $CONF existente"
    log "lendo o projeto em $PROJ"
    bash "$SRC/lib/detect.sh" "$PROJ" > "$detected"
    set -a; . "$detected"; set +a
    CONF_KEYS="$(grep -oE '^[A-Z][A-Z0-9_]*=' "$detected" | tr -d = | tr '\n' ' ')"
    CONF_CHANGED=1
    [[ -f "$CONF" ]] && warn "ai-team.conf existente será substituído (--reconfigure)"
  fi
  # chaves de ajuste manual que o detector não preenche
  for k in TEST_PERSONAS; do
    case " $CONF_KEYS " in *" $k "*) ;; *) CONF_KEYS="$CONF_KEYS $k"; setvar "$k" "${!k:-}" ;; esac
  done
  setvar AI_TEAM_PROFILE "generic"
  case " $CONF_KEYS " in *" AI_TEAM_PROFILE "*) ;; *) CONF_KEYS="AI_TEAM_PROFILE $CONF_KEYS" ;; esac

  # --- 3b. --set K=V ---------------------------------------------------------
  local s k v
  for s in "${SETS[@]+"${SETS[@]}"}"; do
    k="${s%%=*}"; v="${s#*=}"
    [[ "$k" =~ ^[A-Z][A-Z0-9_]*$ ]] || die "--set inválido: $s (use CHAVE=valor)"
    setvar "$k" "$v"
    case " $CONF_KEYS " in *" $k "*) ;; *) CONF_KEYS="$CONF_KEYS $k" ;; esac
    CONF_CHANGED=1
  done

  # --- 3c. derivadas (não vão para o conf) -----------------------------------
  local P c gate
  for P in BACKEND FRONTEND; do
    gate=""
    for c in "${P}_CMD_LINT" "${P}_CMD_FORMAT" "${P}_CMD_TYPECHECK" "${P}_CMD_TEST" "${P}_CMD_BUILD"; do
      [[ -n "${!c:-}" ]] && gate="${gate:+$gate; }${!c}"
    done
    setvar "${P}_GATE" "$gate"
  done
  local team="product-owner devops"
  [[ "${HAS_BACKEND:-0}" == "1" ]] && team="$team backend-dev"
  [[ "${HAS_FRONTEND:-0}" == "1" ]] && team="$team frontend-dev"
  team="$team code-reviewer qa"
  setvar TEAM_AGENTS "$team"
  setvar TEAM_AGENTS_CSV "${team// /, }"

  # --- 3d. resumo ------------------------------------------------------------
  echo
  log "projeto: ${PROJECT_NAME:-?} (${LAYOUT:-?})"
  [[ "${HAS_BACKEND:-0}" == "1" ]]  && echo "    backend   ${BACKEND_DIR}/  ${BACKEND_STACK}  · branch ${BACKEND_BRANCH}${BACKEND_PROTECTED_BRANCH:+ (protegida: $BACKEND_PROTECTED_BRANCH)}"
  [[ "${HAS_FRONTEND:-0}" == "1" && "${SAME_DIR:-0}" != "1" ]] && echo "    frontend  ${FRONTEND_DIR}/  ${FRONTEND_STACK}  · branch ${FRONTEND_BRANCH}${FRONTEND_PROTECTED_BRANCH:+ (protegida: $FRONTEND_PROTECTED_BRANCH)}"
  [[ "${HAS_BACKEND:-0}" == "1" ]]  && echo "    gate back  ${BACKEND_GATE:-(nenhum comando detectado)}"
  [[ "${HAS_FRONTEND:-0}" == "1" && "${SAME_DIR:-0}" != "1" ]] && echo "    gate front ${FRONTEND_GATE:-(nenhum comando detectado)}"
  echo "    docs      ${DOCS_CONTEXT:-}${DOCS_STANDARDS:+ $DOCS_STANDARDS}${BACKEND_DOCS_STANDARDS:+ $BACKEND_DIR/$BACKEND_DOCS_STANDARDS}${DOCS_ENV:+ $DOCS_ENV}${DOCS_ARCH:+ $DOCS_ARCH}"
  echo "    openspec  $([[ "${HAS_OPENSPEC:-0}" == 1 ]] && echo 'openspec/ presente' || echo 'não inicializado')"
  [[ "${HAS_BACKEND:-0}" != "1" && "${HAS_FRONTEND:-0}" != "1" ]] && warn "nenhum pacote reconhecido; agentes saem sem stack/comandos (preencha o conf)"
  echo

  # --- 3e. gravar conf -------------------------------------------------------
  if [[ $CONF_CHANGED -eq 1 ]]; then
    write_conf "$WORK/ai-team.conf"
    if [[ $DRY -eq 1 ]]; then echo "  + ai-team.conf"; else
      mkdir -p "$DEST"; cp "$WORK/ai-team.conf" "$CONF"; ok "gravado ai-team.conf"
    fi
  fi

  # --- 3f. project-context.md (parte gerada + notas preservadas) -------------
  local ctx="$DEST/project-context.md" new="$WORK/project-context.md" marker='<!-- ai-team:notas -->'
  bash "$SRC/lib/render.sh" "$SRC/templates/project-context.md" > "$new" || die "falha ao renderizar project-context.md"
  if [[ -f "$ctx" ]] && grep -qF "$marker" "$ctx"; then
    { sed "/$marker/,\$d" "$new"; sed -n "/$marker/,\$p" "$ctx"; } > "$new.merged"
    mv "$new.merged" "$new"
    if cmp -s "$new" "$ctx"; then ok "igual   project-context.md"
    elif [[ $DRY -eq 1 ]]; then echo "  ~ project-context.md (parte gerada atualizada; notas preservadas)"
    else cp "$new" "$ctx"; ok "atualizado project-context.md (notas preservadas)"; fi
  else
    copy_file "$new" "$ctx"
  fi

  # --- 3g. agentes renderizados ---------------------------------------------
  [[ $DO_AGENTS -eq 1 ]] || return 0
  log "agentes (perfil generic)"
  local t name
  for t in "$SRC"/templates/agents/*.md; do
    name="$(basename "$t" .md)"
    case " $team tech-lead " in *" $name "*) ;; *) continue ;; esac
    wanted_agent "$name" || continue
    bash "$SRC/lib/render.sh" "$t" > "$WORK/$name.md" || die "falha ao renderizar $name"
    write_generated "$WORK/$name.md" "$DEST/agents/$name.md"
  done
  if [[ -n "$AGENTS" ]]; then
    IFS=',' read -ra LIST <<< "$AGENTS"
    for a in "${LIST[@]}"; do a="${a// /}"; [[ -f "$SRC/templates/agents/$a.md" ]] || warn "agente não encontrado: $a"; done
  fi
}

install_profile() { # perfil com arquivos prontos, copiados sem renderizar
  local pdir="$SRC/profiles/$PROFILE/agents"
  [[ -d "$pdir" ]] || die "perfil não encontrado: $PROFILE (procure em profiles/)"
  [[ $DETECT_ONLY -eq 1 || $RENDER_ONLY -eq 1 || $RECONFIGURE -eq 1 || ${#SETS[@]} -gt 0 ]] && \
    warn "--detect-only/--render/--reconfigure/--set só valem no perfil generic; ignorados"
  [[ $DO_AGENTS -eq 1 ]] || return 0
  log "agentes (perfil $PROFILE)"
  local f name
  for f in "$pdir"/*.md; do
    name="$(basename "$f" .md)"
    wanted_agent "$name" || continue
    copy_file "$f" "$DEST/agents/$name.md"
  done
  if [[ -n "$AGENTS" ]]; then
    IFS=',' read -ra LIST <<< "$AGENTS"
    for a in "${LIST[@]}"; do a="${a// /}"; [[ -f "$pdir/$a.md" ]] || warn "agente não encontrado: $a"; done
  fi
}

log "destino: $DEST"
if [[ "$PROFILE" == "generic" ]]; then install_generic; else install_profile; fi

# ---------------------------------------------------------------------------
# 4. skills e commands (OpenSpec) — iguais em qualquer perfil
# ---------------------------------------------------------------------------
[[ $DO_SKILLS -eq 1 ]]    && { log "skills";    copy_tree "$SRC/skills"    "$DEST/skills"; }
[[ $DO_COMMANDS -eq 1 ]]  && { log "commands";  copy_tree "$SRC/commands"  "$DEST/commands"; }
[[ $DO_DASHBOARD -eq 1 ]] && { log "dashboard"; copy_tree "$SRC/dashboard" "$DEST/dashboard"; [[ $DRY -eq 1 ]] || chmod +x "$DEST/dashboard/hook.sh" 2>/dev/null || true; }

# ---------------------------------------------------------------------------
# 5. settings.json — só cria se não existir (nunca sobrescreve permissões)
#    Com o painel, o arquivo novo já traz os hooks SubagentStart/Stop que
#    marcam início e fim de cada agente (opcionais; o painel funciona sem eles).
# ---------------------------------------------------------------------------
HOOK_CMD='$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh'
settings_json() {
  if [[ $DO_DASHBOARD -eq 1 ]]; then
    printf '{\n  "agent": "%s",\n  "hooks": {\n    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "%s" }] }],\n    "SubagentStop": [{ "hooks": [{ "type": "command", "command": "%s" }] }]\n  }\n}\n' "$DEFAULT_AGENT" "$HOOK_CMD" "$HOOK_CMD"
  else
    printf '{\n  "agent": "%s"\n}\n' "$DEFAULT_AGENT"
  fi
}
if [[ $DO_SETTINGS -eq 1 ]]; then
  if [[ -f "$DEST/settings.json" ]]; then
    warn "settings.json já existe; não alterado (agente padrão sugerido: $DEFAULT_AGENT)"
    [[ $DO_DASHBOARD -eq 1 ]] && ! grep -q "dashboard/hook.sh" "$DEST/settings.json" && \
      warn "para tempos exatos no painel, acrescente os hooks SubagentStart/SubagentStop (ver .claude/dashboard/hook.sh)"
  elif [[ $DRY -eq 1 ]]; then
    echo "  + settings.json {\"agent\": \"$DEFAULT_AGENT\"$([[ $DO_DASHBOARD -eq 1 ]] && echo ', hooks do painel')}"
  else
    mkdir -p "$DEST"
    settings_json > "$DEST/settings.json"
    ok "settings.json (agente padrão: $DEFAULT_AGENT$([[ $DO_DASHBOARD -eq 1 ]] && echo '; hooks do painel'))"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Avisos finais
# ---------------------------------------------------------------------------
echo
if [[ $DO_SKILLS -eq 1 || $DO_COMMANDS -eq 1 ]] && ! command -v openspec >/dev/null 2>&1; then
  warn "CLI 'openspec' não encontrado; skills/commands opsx precisam dele: npm i -g @fission-ai/openspec && openspec init"
fi
if [[ $DO_DASHBOARD -eq 1 ]]; then
  if command -v node >/dev/null 2>&1; then
    echo "  painel: node .claude/dashboard/server.mjs   (http://127.0.0.1:4321/)" >&2
  else
    warn "painel instalado, mas 'node' não foi encontrado (precisa de Node 18+ para rodar .claude/dashboard/server.mjs)"
  fi
  echo "  (adicione .claude/ai-team/ ao .gitignore do projeto: é o log dos hooks)" >&2
fi
if [[ "$PROFILE" == "generic" ]]; then
  ok "pronto. Confira .claude/ai-team.conf (stack, branches, comandos de gate, docs)"
  echo "  e .claude/project-context.md (acrescente regras de negócio abaixo de 'ai-team:notas')."
  echo "  Depois de editar o conf: install.sh --render"
  [[ -z "${BACKEND_GATE:-}${FRONTEND_GATE:-}" ]] && warn "nenhum comando de gate detectado: preencha BACKEND_CMD_* / FRONTEND_CMD_* no conf"
  [[ -z "${DOCS_STANDARDS:-}${BACKEND_DOCS_STANDARDS:-}${FRONTEND_DOCS_STANDARDS:-}" ]] && warn "sem documento de padrões: crie docs/padroes.md e aponte em DOCS_STANDARDS (régua do code-reviewer)"
else
  ok "pronto. Agentes do perfil '$PROFILE' instalados em $DEST/agents"
fi
