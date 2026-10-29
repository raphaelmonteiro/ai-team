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
#   --hub-team TIME    registra o projeto no hub, no time TIME (grava HUB_TEAM no conf;
#                      sem a opção e com um hub já existente, pergunta no terminal)
#   --hub ARQUIVO      registro do hub (padrão: $AI_TEAM_HUB ou ~/.config/ai-team/hub.json)
#   --ntfy-topic T     avisos no celular pelo ntfy com o tópico T (config do PC, ~/.config/ai-team/notify.json;
#                      sem a opção e sem config, pergunta no terminal; "novo" gera um tópico aleatório)
#   --yes              não pergunta nada (usa o detectado e as opções)
#   --default-agent X  toda sessão começa como o agente X ({"agent": "X"} no settings.json).
#                      Padrão: nenhum; a equipe entra com /equipe ou claude --agent tech-lead
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
    --no-skills) DO_SKILLS=0; shift ;;
    --no-commands) DO_COMMANDS=0; shift ;;
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
    -*) echo "opção desconhecida: $1" >&2; exit 1 ;;
    *) TARGET="$1"; shift ;;
  esac
done

log()  { printf '\033[1;34m▸\033[0m %s\n' "$*" >&2; }
warn() { printf '\033[1;33m!\033[0m %s\n' "$*" >&2; }
ok()   { printf '\033[1;32m✓\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# perguntas só com terminal de verdade (curl | bash: o stdin é o script, lê de /dev/tty)
can_ask() { [[ $YES -eq 0 && $DRY -eq 0 && -z "${CI:-}" ]] && { : < /dev/tty; } 2>/dev/null; }
ask() { # pergunta padrão → resposta (vazio = padrão)
  local a=""
  read -r -p "  $1${2:+ [$2]}: " a < /dev/tty || a=""
  printf '%s' "${a:-$2}"
}
hub_file() { printf '%s' "${HUB_FILE:-${XDG_CONFIG_HOME:-$HOME/.config}/ai-team/hub.json}"; }
# time e nome no hub: --hub-team manda; sem ele, pergunta só se já existe um hub
ask_hub() { # time_atual nome_atual → define HUB_TEAM e HUB_NAME
  HUB_TEAM="${HUB_TEAM_OPT:-$1}" HUB_NAME="$2"
  if [[ -z "$HUB_TEAM" && -f "$(hub_file)" ]] && can_ask; then
    log "hub em $(hub_file)"
    HUB_TEAM="$(ask 'time no hub (enter para não registrar)' '')"
    [[ -n "$HUB_TEAM" ]] && HUB_NAME="$(ask 'nome do projeto' "$HUB_NAME")"
  fi
  return 0
}

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
setvar() { printf -v "$1" '%s' "$2"; export "${1?}"; }

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
  for k in TEST_PERSONAS HUB_TEAM; do
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

  # --- 3b'. hub: time e nome do projeto --------------------------------------
  ask_hub "${HUB_TEAM:-}" "${PROJECT_NAME:-}"
  for k in HUB_TEAM PROJECT_NAME; do
    v="$([[ $k == HUB_TEAM ]] && printf '%s' "$HUB_TEAM" || printf '%s' "$HUB_NAME")"
    [[ "$v" == "${!k:-}" ]] && continue
    setvar "$k" "$v"; CONF_CHANGED=1
    case " $CONF_KEYS " in *" $k "*) ;; *) CONF_KEYS="$CONF_KEYS $k" ;; esac
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
  [[ -n "${HUB_TEAM:-}" ]] && echo "    hub       time ${HUB_TEAM} ($(hub_file))"
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

  # --- 3h. skills dos agentes (renderizadas; carregadas pelo campo skills: do agente) ---
  local committers=0
  for name in devops backend-dev frontend-dev; do
    case " $team " in *" $name "*) wanted_agent "$name" && committers=1 ;; esac
  done
  if [[ $committers -eq 1 ]]; then
    local sk
    for sk in gate-e-commit worktree; do
      log "skill $sk"
      bash "$SRC/lib/render.sh" "$SRC/templates/skills/$sk/SKILL.md" > "$WORK/$sk.md" || die "falha ao renderizar $sk"
      write_generated "$WORK/$sk.md" "$DEST/skills/$sk/SKILL.md"
    done
    # o script não passa pelo render (o marcador de gerado quebraria o bash); lê o conf em tempo de execução
    copy_file "$SRC/templates/skills/worktree/wt.sh" "$DEST/skills/worktree/wt.sh"
    [[ $DRY -eq 1 ]] || chmod +x "$DEST/skills/worktree/wt.sh"
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
if [[ "$PROFILE" == "generic" ]]; then install_generic; else ask_hub "" "$(basename "$PROJ")"; install_profile; fi
# /equipe: a sessão atual vira tech-lead (lê .claude/agents/tech-lead.md); vale para qualquer perfil.
# É um skill (o corpo volta depois da compactação) e os hooks SessionStart/UserPromptExpansion
# do hook.sh lembram o papel depois de compactar.
EQUIPE=0
if [[ $DO_AGENTS -eq 1 ]] && wanted_agent tech-lead; then
  EQUIPE=1
  log "skill /equipe"
  copy_file "$SRC/templates/skills/equipe/SKILL.md" "$DEST/skills/equipe/SKILL.md"
fi

# ---------------------------------------------------------------------------
# 4. skills e commands (OpenSpec) — iguais em qualquer perfil
# ---------------------------------------------------------------------------
[[ $DO_SKILLS -eq 1 ]]    && { log "skills";    copy_tree "$SRC/skills"    "$DEST/skills"; }
[[ $DO_COMMANDS -eq 1 ]]  && { log "commands";  copy_tree "$SRC/commands"  "$DEST/commands"; }
[[ $DO_DASHBOARD -eq 1 ]] && { log "dashboard"; copy_tree "$SRC/dashboard" "$DEST/dashboard"; [[ $DRY -eq 1 ]] || chmod +x "$DEST/dashboard/hook.sh" 2>/dev/null || true; if [[ "$PROFILE" != generic ]]; then copy_tree "$SRC/profiles/$PROFILE/dashboard" "$DEST/dashboard"; fi; }
# sem o painel, o /equipe ainda precisa do hook.sh (lembrete depois da compactação)
[[ $DO_DASHBOARD -eq 0 && $EQUIPE -eq 1 && $RENDER_ONLY -eq 0 ]] && { copy_file "$SRC/dashboard/hook.sh" "$DEST/dashboard/hook.sh"; copy_file "$SRC/dashboard/hook.mjs" "$DEST/dashboard/hook.mjs"; [[ $DRY -eq 1 ]] || chmod +x "$DEST/dashboard/hook.sh" 2>/dev/null || true; }
# os hooks rodam em node (hook.sh só repassa para o hook.mjs): sem node, não gravam nada
[[ ($DO_DASHBOARD -eq 1 || $EQUIPE -eq 1) && $RENDER_ONLY -eq 0 ]] && ! command -v node >/dev/null 2>&1 && \
  warn "'node' não encontrado: os hooks do ai-team (painel, lembrete do /equipe depois de compactar) só funcionam com Node 18+"

# ---------------------------------------------------------------------------
# 5. settings.json — só cria se não existir (nunca sobrescreve permissões)
#    Com o painel, o arquivo novo já traz os hooks SubagentStart/Stop que
#    marcam início e fim de cada agente (opcionais; o painel funciona sem eles).
# ---------------------------------------------------------------------------
HOOK_CMD='$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh'
settings_json() { # só o que foi pedido: agente fixo (--default-agent), hooks do painel e do /equipe
  local agent="" hooks="" evs=() e list="" nl=$'\n'
  [[ -n "$DEFAULT_AGENT" ]] && agent="$(printf '  "agent": "%s"' "$DEFAULT_AGENT")"
  [[ $DO_DASHBOARD -eq 1 ]] && evs+=(SubagentStart SubagentStop StopFailure)
  [[ $EQUIPE -eq 1 ]] && evs+=(SessionStart UserPromptExpansion)
  for e in "${evs[@]+"${evs[@]}"}"; do
    list="${list:+$list,$nl}$(printf '    "%s": [{ "hooks": [{ "type": "command", "command": "%s" }] }]' "$e" "$HOOK_CMD")"
  done
  # decisões respondidas pelo painel (dashboard/ask.mjs); timeout maior que a espera do ask.mjs (280 s; 3300 s no modo longe)
  # Stop: no modo longe do computador espera a resposta do fim do turno (ask.mjs, até 3300 s)
  [[ $DO_DASHBOARD -eq 1 ]] && list="${list:+$list,$nl}$(printf '    "Stop": [{ "hooks": [{ "type": "command", "command": "%s", "timeout": 3600 }] }]' "$HOOK_CMD")"
  # SessionEnd: 1,5 s por padrão no Claude Code; 10 s dão tempo para o aviso no celular
  [[ $DO_DASHBOARD -eq 1 ]] && list="${list:+$list,$nl}$(printf '    "SessionEnd": [{ "hooks": [{ "type": "command", "command": "%s", "timeout": 10 }] }]' "$HOOK_CMD")"
  [[ $DO_DASHBOARD -eq 1 ]] && list="${list:+$list,$nl}"'    "PermissionRequest": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/dashboard/ask.mjs\"", "timeout": 3600 }] }]'
  [[ -n "$list" ]] && hooks="$(printf '  "hooks": {\n%s\n  }' "$list")"
  local sep=""; [[ -n "$agent" && -n "$hooks" ]] && sep=$',\n'
  printf '{\n%s%s%s\n}\n' "$agent" "$sep" "$hooks"
}
settings_desc() {
  local d=()
  [[ -n "$DEFAULT_AGENT" ]] && d+=("agente fixo: $DEFAULT_AGENT")
  [[ $DO_DASHBOARD -eq 1 ]] && d+=("hooks do painel")
  [[ $EQUIPE -eq 1 ]] && d+=("hooks do /equipe")
  local IFS=';'; echo "${d[*]+"${d[*]}"}" | sed 's/;/; /g'
}
if [[ $DO_SETTINGS -eq 1 ]]; then
  if [[ -f "$DEST/settings.json" ]]; then
    log "settings.json já existe: mantido; só entram os hooks do ai-team que faltam"
    fixed="$(sed -nE 's/.*"agent"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/p' "$DEST/settings.json" | head -1)"
    [[ -n "$fixed" && -z "$DEFAULT_AGENT" ]] && \
      warn "toda sessão começa como '$fixed' (chave \"agent\" no settings.json); para escolher por sessão (/equipe ou claude --agent $fixed), remova a chave"
    [[ -n "$DEFAULT_AGENT" && "$fixed" != "$DEFAULT_AGENT" ]] && warn "para fixar o agente, acrescente \"agent\": \"$DEFAULT_AGENT\" ao settings.json"
    # hooks do painel e do /equipe que faltam: acrescentados sem mexer no resto (dashboard/settings.mjs)
    hook_evs=""
    [[ $DO_DASHBOARD -eq 1 ]] && hook_evs="SubagentStart,SubagentStop,Stop,StopFailure,SessionEnd,PermissionRequest"
    [[ $EQUIPE -eq 1 ]] && hook_evs="${hook_evs:+$hook_evs,}SessionStart,UserPromptExpansion"
    if [[ -n "$hook_evs" ]]; then
      if command -v node >/dev/null 2>&1; then
        # shellcheck disable=SC2046  # sem --dry-run, a substituição some de propósito
        node "$SRC/dashboard/settings.mjs" --file "$DEST/settings.json" --events "$hook_evs" $([[ $DRY -eq 1 ]] && echo --dry-run) >&2 \
          || warn "settings.json não atualizado; veja acima o trecho para colar"
      else
        warn "settings.json: 'node' não encontrado; confira os hooks $hook_evs (ver .claude/dashboard/hook.sh e ask.mjs)"
      fi
    fi
  elif [[ -z "$DEFAULT_AGENT" && $DO_DASHBOARD -eq 0 && $EQUIPE -eq 0 ]]; then
    :   # nada a gravar
  elif [[ $DRY -eq 1 ]]; then
    echo "  + settings.json ($(settings_desc))"
  else
    mkdir -p "$DEST"
    settings_json > "$DEST/settings.json"
    ok "settings.json ($(settings_desc))"
  fi
fi

# ---------------------------------------------------------------------------
# 5b. hub — registra (ou atualiza) o projeto no registro do hub
# ---------------------------------------------------------------------------
if [[ -n "${HUB_TEAM:-}" ]]; then
  if [[ $DRY -eq 1 ]]; then echo "  + hub: ${HUB_TEAM}/${HUB_NAME:-$(basename "$PROJ")} em $(hub_file)"
  elif command -v node >/dev/null 2>&1; then
    node "$SRC/dashboard/hub.mjs" add "$PROJ" --team "$HUB_TEAM" ${HUB_NAME:+--name "$HUB_NAME"} --hub "$(hub_file)" >&2 \
      || warn "não foi possível registrar no hub ($(hub_file))"
  else
    warn "hub: 'node' não encontrado; registre depois com: node dashboard/hub.mjs add \"$PROJ\" --team \"$HUB_TEAM\""
  fi
fi

# ---------------------------------------------------------------------------
# 6. Avisos finais
# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# 5c. notificações no celular — a config é do PC (vale para todos os projetos), não do projeto
#     --ntfy-topic manda; sem ele e sem config, pergunta (enter pula, "novo" gera um tópico)
# ---------------------------------------------------------------------------
notify_file() { printf '%s' "${AI_TEAM_NOTIFY_FILE:-$HOME/.config/ai-team/notify.json}"; }
if [[ $DO_DASHBOARD -eq 1 && $RENDER_ONLY -eq 0 ]]; then
  ntfy_topic="${NTFY_TOPIC:-}" ntfy_asked=0
  if [[ -z "$ntfy_topic" && ! -f "$(notify_file)" ]] && can_ask && command -v node >/dev/null 2>&1; then
    log "avisos no celular (app ntfy): ainda não configurados neste PC"
    ntfy_topic="$(ask 'tópico do ntfy (enter pula; "novo" gera um)' '')"; ntfy_asked=1
  fi
  [[ "$ntfy_topic" == novo ]] && ntfy_topic="-"
  if [[ -n "$ntfy_topic" ]]; then
    if [[ $DRY -eq 1 ]]; then echo "  + notificações: tópico $ntfy_topic em $(notify_file)"
    elif command -v node >/dev/null 2>&1; then
      # shellcheck disable=SC2046
      node "$SRC/dashboard/notify.mjs" setup $([[ "$ntfy_topic" != - ]] && printf '%s' "$ntfy_topic") >&2 || warn "notificações não configuradas"
      if [[ $ntfy_asked -eq 1 && -f "$(notify_file)" && "$(ask 'mandar uma notificação de teste agora? (s/N)' 'n')" =~ ^[sSyY] ]]; then
        node "$SRC/dashboard/notify.mjs" test >&2 || true
      fi
    else
      warn "notificações: 'node' não encontrado; configure depois na aba Notificações do painel"
    fi
  elif [[ -f "$(notify_file)" ]]; then
    ok "notificações no celular: configuradas neste PC ($(notify_file))"
  else
    echo "  notificações no celular: install.sh --ntfy-topic <tópico>, ou a aba Notificações do painel" >&2
  fi
fi

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
if [[ $DO_AGENTS -eq 1 ]] && wanted_agent tech-lead; then
  if [[ -n "$DEFAULT_AGENT" ]]; then echo "  equipe: toda sessão começa como $DEFAULT_AGENT" >&2
  else echo "  equipe: numa sessão, /equipe <pedido>; ou já na entrada: claude --agent tech-lead" >&2; fi
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
