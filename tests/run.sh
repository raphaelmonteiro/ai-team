#!/usr/bin/env bash
# Testes do detector, do renderizador e do instalador sobre projetos de exemplo.
#   tests/run.sh            (ou: make test)
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S="$(mktemp -d)"; trap 'rm -rf "$S"' EXIT
export AI_TEAM_NOTIFY_FILE="$S/sem-notify.json"
export AI_TEAM_TOKEN_FILE="$S/sem-token"; unset AI_TEAM_TOKEN   # nem o token de quem roda   # os hooks dos testes nunca notificam o celular de quem roda
"$REPO/tests/fixtures.sh" "$S/f"
F="$S/f"
export AI_TEAM_HUB="$S/hub.json"   # nunca toca no hub de quem roda os testes
# perfil de teste: cópia do repo com um perfil sintético (nenhum perfil é versionado aqui)
PR="$S/src"; mkdir -p "$PR"; (cd "$REPO" && tar cf - --exclude=.git .) | (cd "$PR" && tar xf -)
mkdir -p "$PR/profiles/exemplo/agents" "$PR/profiles/exemplo/dashboard"
printf -- '---\nname: tech-lead\n---\n# tech-lead do perfil exemplo\n' > "$PR/profiles/exemplo/agents/tech-lead.md"
printf '<section id="ciclo-exemplo"></section>\n' > "$PR/profiles/exemplo/dashboard/cycle.html"

fail=0 n=0
t()  { n=$((n+1)); if eval "$2"; then printf '  ok   %s\n' "$1"; else printf '  FAIL %s\n' "$1"; fail=$((fail+1)); fi; }
detect() { bash "$REPO/lib/detect.sh" "$1" > "$S/d.conf" && . "$S/d.conf"; }
inst() { bash "$REPO/install.sh" --yes --no-skills --no-commands --no-settings "$@" > "$S/out" 2>&1; }
has() { grep -qF -- "$1" "$2"; }

echo "▸ detector"
detect "$F/monorepo-nested-git"
t "monorepo: layout"                 '[[ $LAYOUT == monorepo && $BACKEND_DIR == backend && $FRONTEND_DIR == frontend ]]'
t "monorepo: stack backend"          '[[ $BACKEND_FRAMEWORK == NestJS/Express && $BACKEND_PKG_MANAGER == pnpm && $BACKEND_STACK == *Prisma*PostgreSQL* ]]'
t "monorepo: branches dos sub-repos" '[[ $BACKEND_BRANCH == v2 && $BACKEND_PROTECTED_BRANCH == main && $FRONTEND_BRANCH == integration && $FRONTEND_OWN_REPO == 1 ]]'
t "monorepo: Makefile vence script"  '[[ $BACKEND_CMD_LINT == "make lint" && $BACKEND_CMD_BUILD == "make build-app" && $BACKEND_CMD_E2E == "make test-e2e" ]]'
t "monorepo: frontend bun + scripts" '[[ $FRONTEND_PKG_MANAGER == bun && $FRONTEND_CMD_TYPECHECK == "bun run typecheck" && $FRONTEND_CMD_E2E == "bun run e2e" ]]'
t "monorepo: docs classificados"     '[[ $DOCS_CONTEXT == CLAUDE.md && $DOCS_ENV == docs/ambiente.md && $BACKEND_DOCS_STANDARDS == docs/padroes.md && $DOCS_OTHER == *plano-desenvolvimento* ]]'
t "monorepo: compose e openspec"     '[[ $DOCKER_COMPOSE_FILE == backend/docker-compose.yml && $HAS_OPENSPEC == 1 ]]'
t "monorepo: descrição do README"    '[[ $PROJECT_DESCRIPTION == Plataforma* ]]'

detect "$F/fastapi-single"
t "fastapi: só backend"              '[[ $LAYOUT == single && $HAS_BACKEND == 1 && $HAS_FRONTEND == 0 && $BACKEND_DIR == . ]]'
t "fastapi: uv + ruff + mypy"        '[[ $BACKEND_CMD_LINT == "uv run ruff check ." && $BACKEND_CMD_TYPECHECK == "uv run mypy ." && $BACKEND_CMD_TEST == "uv run pytest" ]]'
t "fastapi: nome do pyproject"       '[[ $PROJECT_NAME == billing-api && $CI == github-actions ]]'

detect "$F/laravel-inertia"
t "laravel: fullstack mesmo dir"     '[[ $SAME_DIR == 1 && $BACKEND_FRAMEWORK == "Laravel + Inertia/React"* ]]'
t "laravel: pint, phpstan, artisan"  '[[ $BACKEND_CMD_FORMAT == "vendor/bin/pint --test" && $BACKEND_CMD_TEST == "php artisan test" && $BACKEND_CMD_LINT == "npm run lint" ]]'
t "laravel: develop protege master"  '[[ $GIT_WORK_BRANCH == develop && $BACKEND_PROTECTED_BRANCH == master ]]'

detect "$F/next-app"
t "next: meta-framework = ambos"     '[[ $HAS_BACKEND == 1 && $HAS_FRONTEND == 1 && $SAME_DIR == 1 && $BACKEND_CMD_TYPECHECK == "yarn tsc --noEmit" ]]'
t "next: nome sem escopo"            '[[ $PROJECT_NAME == site && $BACKEND_PKG_MANAGER == yarn ]]'

detect "$F/go-api"
t "go: chi + make"                   '[[ $BACKEND_FRAMEWORK == Chi && $BACKEND_CMD_TEST == "make test" && $BACKEND_SRC_DIR == internal && $HAS_MAKEFILE == 1 ]]'

detect "$F/pnpm-ws"
t "workspace: apps/api e apps/web"   '[[ $BACKEND_DIR == apps/api && $FRONTEND_DIR == apps/web && $OTHER_PKGS == packages/shared ]]'
t "workspace: herda pnpm da raiz"    '[[ $BACKEND_PKG_MANAGER == pnpm && $FRONTEND_CMD_TYPECHECK == "pnpm typecheck" ]]'

detect "$F/empty"
t "vazio: nada detectado, sem erro"  '[[ $HAS_BACKEND == 0 && $HAS_FRONTEND == 0 && $PROJECT_NAME == empty ]]'

echo "▸ renderizador"
cat > "$S/t.md" <<'EOF'
a {{X}} b
{{#if X}}
só com X
{{else}}
sem X
{{/if}}
inline: {{#if X}}sim{{/if}}{{#unless X}}não{{/unless}}.
{{#if X}}abre inline
e fecha depois{{/if}}
{{#if Y}}
{{#if X}}aninhado{{/if}}
{{/if}}
fim {{ nao_var }} {{/if}}
EOF
R="$(X=1 Y=1 bash "$REPO/lib/render.sh" "$S/t.md" 2>"$S/err")"
t "render: substituição e blocos"    '[[ $R == $'"'"'a 1 b\nsó com X\ninline: sim.\nabre inline\ne fecha depois\naninhado\nfim {{ nao_var }} '"'"' ]]'
t "render: {{/if}} solto avisa"      'grep -q "fora de bloco" "$S/err"'
R="$(X='' Y=1 bash "$REPO/lib/render.sh" "$S/t.md" 2>/dev/null)"
t "render: ramo else e unless"       '[[ $R == $'"'"'a  b\nsem X\ninline: não.\nfim {{ nao_var }} '"'"' ]]'

echo "▸ instalador"
P="$F/monorepo-nested-git"
inst "$P"
t "instala conf, contexto e 7 agentes" '[[ -f $P/.claude/ai-team.conf && -f $P/.claude/project-context.md && $(ls $P/.claude/agents | wc -l) -eq 7 ]]'
t "nenhum {{ sobra"                    '! grep -l "{{" $P/.claude/agents/*.md $P/.claude/project-context.md >/dev/null'
t "tech-lead lista a equipe"           'has "Agent(product-owner, devops, backend-dev, frontend-dev, code-reviewer, qa)" $P/.claude/agents/tech-lead.md'
t "backend-dev tem branch"             'has "a partir de \`v2\`" $P/.claude/agents/backend-dev.md'
t "skill gate-e-commit renderizada"    'has "make lint; make format-check" $P/.claude/skills/gate-e-commit/SKILL.md && has "\`integration\`" $P/.claude/skills/gate-e-commit/SKILL.md'
t "skill sem {{ e com marcador"        '! grep -q "{{" $P/.claude/skills/gate-e-commit/SKILL.md && has "ai-team:generated" $P/.claude/skills/gate-e-commit/SKILL.md'
t "devs carregam a skill"              'grep -l "^skills: gate-e-commit" $P/.claude/agents/*.md | wc -l | grep -q 3'
t "contexto cita padroes do backend"   'has "docs/padroes.md (em \`backend/\`)" $P/.claude/project-context.md'
inst "$P"
t "segunda rodada: tudo igual"         '[[ $(grep -c "igual" "$S/out") -ge 8 ]] && ! grep -q "existe" "$S/out"'
printf '\n- Regra de negócio X.\n' >> "$P/.claude/project-context.md"
inst --render --set FRONTEND_CMD_LINT='bun run lint:integration' --set TEST_PERSONAS='ana (admin)' "$P"
t "--set grava no conf"                'has "FRONTEND_CMD_LINT='"'"'bun run lint:integration'"'"'" $P/.claude/ai-team.conf'
t "gate derivado reflete --set"        'has "bun run lint:integration; bun run typecheck" $P/.claude/skills/gate-e-commit/SKILL.md'
t "gerado intocado atualiza sem force" 'grep -q "atualizado skills/gate-e-commit/SKILL.md" "$S/out" && has "ana (admin)" $P/.claude/agents/qa.md'
t "notas do contexto preservadas"      'has "Regra de negócio X." $P/.claude/project-context.md && has "ana (admin)" $P/.claude/project-context.md'
echo "minha regra" >> "$P/.claude/agents/qa.md"
inst --render --set TEST_PERSONAS='bia' "$P"
t "editado à mão não é sobrescrito"    'grep -q "existe  agents/qa.md (editado à mão" "$S/out" && has "minha regra" $P/.claude/agents/qa.md'
inst --render --force "$P"
t "--force sobrescreve"                '! has "minha regra" $P/.claude/agents/qa.md'
inst --reconfigure "$P"
t "--reconfigure volta ao detectado"   '! has "lint:integration" $P/.claude/ai-team.conf'

P="$F/fastapi-single"; inst "$P"
t "fastapi: sem frontend-dev"          '[[ ! -f $P/.claude/agents/frontend-dev.md && -f $P/.claude/agents/backend-dev.md ]]'
t "fastapi: skill sem frente frontend" '! has "Frontend" $P/.claude/skills/gate-e-commit/SKILL.md'
t "fastapi: qa pela API"               'has "pela API" $P/.claude/agents/qa.md && ! has "frontend-dev" $P/.claude/agents/tech-lead.md'
t "fastapi: aviso sem padrões"         'grep -q "sem documento de padrões" "$S/out"'

P="$F/laravel-inertia"; inst "$P"
t "laravel: contexto marca mesmo pacote" 'has "backend e frontend no mesmo pacote" $P/.claude/project-context.md'
t "laravel: skill cobre as 3 seções"   'has "\`2. Frontend\`, mesmo pacote" $P/.claude/skills/gate-e-commit/SKILL.md'

P="$F/empty"; inst "$P"
t "vazio: instala com aviso"           'grep -q "nenhum pacote reconhecido" "$S/out" && [[ -f $P/.claude/agents/tech-lead.md ]]'

P="$F/monorepo-nested-git"; rm -rf "$P/.claude"
bash "$PR/install.sh" --profile exemplo --no-skills --no-commands --no-settings "$P" > "$S/out" 2>&1
t "perfil exemplo: cópia intocada"       'cmp -s "$PR/profiles/exemplo/agents/tech-lead.md" "$P/.claude/agents/tech-lead.md" && [[ ! -f $P/.claude/ai-team.conf ]]'
bash "$REPO/install.sh" --detect-only "$P" > "$S/out" 2>/dev/null
t "--detect-only: só o conf em stdout" '[[ $(head -1 "$S/out") == PROJECT_NAME=* ]] && [[ ! -d $P/.claude/agents ]] || [[ $(head -1 "$S/out") == PROJECT_NAME=* ]]'
bash "$REPO/install.sh" --dry-run "$F/go-api" > "$S/out" 2>&1
t "--dry-run não grava"                '[[ ! -d $F/go-api/.claude ]] && grep -q "+ ai-team.conf" "$S/out"'

echo "▸ worktree"
# o merge do integrar precisa de identidade git; o runner Linux da CI não tem nenhuma
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
gc() { git -C "$1" -c user.name=t -c user.email=t@t "${@:2}"; }
P="$(cd "$F/monorepo-nested-git" && pwd -P)"; rm -rf "$P/.claude"; inst "$P"; W="$P/.claude/skills/worktree/wt.sh"
t "skill worktree e wt.sh instalados"  '[[ -x $W ]] && has "wt.sh abrir <id> <frente>" $P/.claude/skills/worktree/SKILL.md && ! grep -q "{{" $P/.claude/skills/worktree/SKILL.md'
t "devs carregam as duas skills"       'grep -l "^skills: gate-e-commit, worktree" $P/.claude/agents/*.md | wc -l | grep -q 3'
B="$("$W" abrir login backend 2>/dev/null)"; FR="$("$W" abrir login frontend 2>/dev/null)"
t "aninhado: um worktree por repo"     '[[ $B == $P/.claude/worktrees/login-backend && $FR == $P/.claude/worktrees/login-frontend ]] && [[ $(git -C "$B" branch --show-current) == change/login ]]'
t "abrir de novo reusa"                '[[ $("$W" abrir login backend 2>/dev/null) == "$B" ]]'
t "branch nasce da de trabalho"        '[[ $(git -C "$B" rev-parse HEAD) == $(git -C "$P/backend" rev-parse v2) ]]'
echo x > "$B/novo.txt"; gc "$B" add novo.txt; gc "$B" commit -qm feat
"$W" fechar login 2>"$S/err"
t "fechar mantém o não integrado"      '[[ -d $B ]] && grep -q "ainda não foi integrada" "$S/err"'
t "integrar faz merge --no-ff"         '"$W" integrar login backend >/dev/null 2>&1 && [[ -f $P/backend/novo.txt && $(git -C "$P/backend" rev-list --parents -1 HEAD | wc -w) -eq 3 ]]'
gc "$P/backend" checkout -q main
t "integrar recusa fora da branch"     '! "$W" integrar login backend 2>"$S/err" && grep -q "não em .v2." "$S/err"'
gc "$P/backend" checkout -q v2
"$W" fechar login 2>/dev/null
t "fechar remove worktrees e branches" '[[ ! -d $P/.claude/worktrees ]] && ! git -C "$P/backend" show-ref -q --verify refs/heads/change/login'
P="$(cd "$F/laravel-inertia" && pwd -P)"; rm -rf "$P/.claude"; inst "$P"; W="$P/.claude/skills/worktree/wt.sh"
B="$("$W" abrir conta backend 2>/dev/null)"
t "raiz única: frentes no mesmo worktree" '[[ $B == $P/.claude/worktrees/conta && $("$W" abrir conta frontend 2>/dev/null) == "$B" ]]'
t "worktrees fora do git da raiz"      'grep -qxF ".claude/worktrees/" "$P/.git/info/exclude" && ! git -C "$P" status --porcelain | grep -q worktrees'
echo wt > "$B/c.txt"; gc "$B" add c.txt; gc "$B" commit -qm wt
echo main > "$P/c.txt"; gc "$P" add c.txt; gc "$P" commit -qm main; H="$(git -C "$P" rev-parse HEAD)"
t "conflito: aborta e diz conflito"    '! "$W" integrar conta backend 2>"$S/err" && grep -q "^wt: conflito" "$S/err" && [[ $(git -C "$P" rev-parse HEAD) == "$H" && -z $(git -C "$P" status --porcelain -uno) ]]'
"$W" fechar conta 2>/dev/null
t "id inválido recusado"               '! "$W" abrir "../x" backend 2>/dev/null'

echo "▸ hub"
if command -v node >/dev/null 2>&1; then
  P="$F/fastapi-single"; rm -rf "$P/.claude"
  inst --hub-team Pagamentos "$P"
  t "--hub-team grava HUB_TEAM no conf"      'has "HUB_TEAM='"'"'Pagamentos'"'"'" $P/.claude/ai-team.conf'
  t "--hub-team registra no hub"             'grep -q "adicionado pagamentos/billing-api" "$S/out" && has "\"dir\": \"$P\"" "$AI_TEAM_HUB"'
  inst --render "$P"
  t "--render mantém o registro do conf"     'grep -q "atualizado pagamentos/billing-api" "$S/out"'
  inst --render --set PROJECT_NAME='Billing API' "$P"
  t "nome do conf vai para o hub"            'has "\"name\": \"Billing API\"" "$AI_TEAM_HUB"'
  bash "$PR/install.sh" --profile exemplo --yes --no-skills --no-commands --no-settings --hub-team plataforma "$F/go-api" > "$S/out" 2>&1
  t "perfil exemplo também registra"           'grep -q "adicionado plataforma/go-api" "$S/out"'
  bash "$REPO/install.sh" --dry-run --hub-team x "$F/next-app" > "$S/out" 2>&1
  t "--dry-run só mostra o registro"         'grep -q "+ hub: x/" "$S/out" && ! has next-app "$AI_TEAM_HUB"'
  rm -rf "$F/go-api/.claude" "$P/.claude"
else
  echo "  skip hub (sem node)"
fi

echo "▸ painel"
P="$F/fastapi-single"; rm -rf "$P/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands "$P" > "$S/out" 2>&1
t "dashboard copiado e hooks no settings novo" '[[ -x $P/.claude/dashboard/server.mjs || -f $P/.claude/dashboard/server.mjs ]] && [[ -x $P/.claude/dashboard/hook.sh ]] && grep -q SubagentStop $P/.claude/settings.json'
t "settings novo sem agente fixo"            '! grep -q "\"agent\"" $P/.claude/settings.json'
t "/equipe instalado como skill"             'has ".claude/agents/tech-lead.md" $P/.claude/skills/equipe/SKILL.md && has "disable-model-invocation: true" $P/.claude/skills/equipe/SKILL.md && grep -q "/equipe <pedido>" "$S/out"'
t "/onboarding instalado e sugerido"         'has "ai-team:onboarding" $P/.claude/skills/onboarding/SKILL.md && has "disable-model-invocation: true" $P/.claude/skills/onboarding/SKILL.md && grep -q "rode /onboarding" "$S/out"'
printf '\n<!-- ai-team:onboarding feito=2026-10-29 sha=abc1234 -->\n' >> $P/.claude/project-context.md
bash "$REPO/install.sh" --yes --no-skills --no-commands "$P" > "$S/out" 2>&1
t "onboarding feito: não sugere de novo"    '! grep -q "rode /onboarding" "$S/out" && has "sha=abc1234" $P/.claude/project-context.md'
t "hooks do /equipe no settings novo"        'has "\"SessionStart\"" $P/.claude/settings.json && has "\"UserPromptExpansion\"" $P/.claude/settings.json'
rm -rf "$P/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands --default-agent tech-lead "$P" > "$S/out" 2>&1
t "--default-agent fixa o agente"            'has "\"agent\": \"tech-lead\"," $P/.claude/settings.json && has "SubagentStop" $P/.claude/settings.json'
bash "$REPO/install.sh" --yes --no-skills --no-commands "$P" > "$S/out" 2>&1
t "settings antigo com agent: avisa"        'grep -q "remova a chave" "$S/out"'
rm -rf "$P/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands --agents backend-dev,qa "$P" > "$S/out" 2>&1
t "sem tech-lead, sem /equipe"               '[[ ! -f $P/.claude/skills/equipe/SKILL.md && ! -f $P/.claude/skills/onboarding/SKILL.md ]] && ! has UserPromptExpansion $P/.claude/settings.json'
t "tarefa avulsa nos templates"              'grep -q "Tarefa avulsa: <slug>" $P/.claude/agents/backend-dev.md && grep -q "Tarefa avulsa" $P/.claude/agents/qa.md'
rm -rf "$P/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands "$P" > "$S/out" 2>&1
P2="$F/go-api"; rm -rf "$P2/.claude"
bash "$PR/install.sh" --yes --profile exemplo --no-skills --no-commands "$P2" > "$S/out" 2>&1
t "perfil exemplo: só o ciclo sobrescrito"    'cmp -s "$PR/profiles/exemplo/dashboard/cycle.html" "$P2/.claude/dashboard/cycle.html" && cmp -s "$REPO/dashboard/equipe.html" "$P2/.claude/dashboard/equipe.html"'
t "perfil generic: equipe genérica, sem cycle.html" 'cmp -s "$REPO/dashboard/equipe.html" "$P/.claude/dashboard/equipe.html" && [[ -f $P/.claude/dashboard/cycle-default.html && ! -f $P/.claude/dashboard/cycle.html ]]'
rm -rf "$P2/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands --no-dashboard "$F/go-api" > "$S/out" 2>&1
t "--no-dashboard: só o hook do /equipe"    '[[ -x $F/go-api/.claude/dashboard/hook.sh && ! -f $F/go-api/.claude/dashboard/server.mjs ]] && ! has SubagentStop $F/go-api/.claude/settings.json && has UserPromptExpansion $F/go-api/.claude/settings.json'
printf '{"agent":"tech-lead","hooks":{"SubagentStop":[]}}' > $F/go-api/.claude/settings.json
bash "$REPO/install.sh" --yes --no-skills --no-commands --no-dashboard "$F/go-api" > "$S/out" 2>&1
t "settings antigo sem hooks do /equipe: acrescenta" 'has UserPromptExpansion $F/go-api/.claude/settings.json && has SessionStart $F/go-api/.claude/settings.json && has "\"agent\": \"tech-lead\"" $F/go-api/.claude/settings.json && ! has PermissionRequest $F/go-api/.claude/settings.json && [[ -f $F/go-api/.claude/settings.json.bak-ai-team ]]'
printf '{"hook_event_name":"SubagentStop","agent_id":"abc","agent_type":"qa","session_id":"s1","agent_transcript_path":"/x"}' | CLAUDE_PROJECT_DIR="$P" bash "$REPO/dashboard/hook.sh"
t "hook.sh grava events.jsonl"             'grep -q "\"event\":\"SubagentStop\",\"agent_id\":\"abc\",\"agent_type\":\"qa\"" $P/.claude/ai-team/events.jsonl'
hk() { printf '%s' "$1" | CLAUDE_PROJECT_DIR="$P" bash "$REPO/dashboard/hook.sh"; }
hk '{"hook_event_name":"UserPromptExpansion","session_id":"s-eq","command_name":"equipe","command_args":"x","prompt":"/equipe x"}' > "$S/hk"
hk '{"hook_event_name":"UserPromptExpansion","session_id":"s-other","command_name":"opsx:apply","prompt":"/opsx:apply"}' >> "$S/hk"
hk '{"hook_event_name":"UserPromptExpansion","session_id":"s-onb","command_name":"onboarding","prompt":"/onboarding"}' >> "$S/hk"
t "hook: /equipe marca a sessão, sem saída" '[[ ! -s $S/hk ]] && has "\"event\":\"TeamStart\",\"session_id\":\"s-eq\",\"via\":\"equipe\"" $P/.claude/ai-team/events.jsonl && has "\"session_id\":\"s-onb\",\"via\":\"onboarding\"" $P/.claude/ai-team/events.jsonl && ! has s-other $P/.claude/ai-team/events.jsonl'
hk '{"hook_event_name":"SessionStart","session_id":"s-eq","source":"compact"}' > "$S/hk"
t "hook: compactação relembra o tech-lead"  'grep -q "você é o tech-lead" "$S/hk" && grep -q "Não recomece o pedido" "$S/hk"'
hk '{"hook_event_name":"SessionStart","session_id":"s-other","source":"compact"}' > "$S/hk"
hk '{"hook_event_name":"SessionStart","session_id":"s-eq","source":"startup"}' >> "$S/hk"
t "hook: sessão comum ou início: silêncio"  '[[ ! -s $S/hk ]]'
hk '{"hook_event_name":"SessionStart","session_id":"s-ag","source":"startup","agent_type":"tech-lead"}' > "$S/hk"
hk '{"hook_event_name":"SessionStart","session_id":"s-ag","source":"compact","agent_type":"tech-lead"}' >> "$S/hk"
t "hook: --agent tech-lead marca, sem lembrete" '[[ ! -s $S/hk ]] && has "\"session_id\":\"s-ag\",\"via\":\"agent\"" $P/.claude/ai-team/events.jsonl'
if command -v node >/dev/null 2>&1; then
  NF="$S/notify-inst.json"
  AI_TEAM_NOTIFY_FILE="$NF" bash "$REPO/install.sh" --yes --no-skills --no-commands "$F/go-api" > "$S/out" 2>&1
  t "notificações: sem config e --yes, só a dica" '[[ ! -f $NF ]] && grep -q -- "--ntfy-topic" "$S/out"'
  AI_TEAM_NOTIFY_FILE="$NF" bash "$REPO/install.sh" --yes --no-skills --no-commands --ntfy-topic ai-team-teste1 "$F/go-api" > "$S/out" 2>&1
  t "notificações: --ntfy-topic cria a config do PC" 'has "\"topic\": \"ai-team-teste1\"" $NF && [[ $(stat -c %a $NF 2>/dev/null || stat -f %Lp $NF) == 600 ]]'
  sed -i.bak 's/"detail": true/"detail": false/' "$NF"
  AI_TEAM_NOTIFY_FILE="$NF" bash "$REPO/install.sh" --yes --no-skills --no-commands --ntfy-topic ai-team-teste2 "$F/go-api" > "$S/out" 2>&1
  t "notificações: outro --ntfy-topic troca só o tópico" 'has "\"topic\": \"ai-team-teste2\"" $NF && has "\"detail\": false" $NF'
  AI_TEAM_NOTIFY_FILE="$NF" bash "$REPO/install.sh" --yes --no-skills --no-commands "$F/go-api" > "$S/out" 2>&1
  t "notificações: config existente, só confirma" 'grep -q "configuradas neste PC" "$S/out" && has ai-team-teste2 $NF'
  node "$REPO/tests/dashboard.test.mjs" > "$S/out" 2>&1
  t "coletor do painel (node)"               '[[ $? -eq 0 ]] && grep -q "coletor ok" "$S/out"'
  node "$REPO/tests/cache.test.mjs" > "$S/out" 2>&1
  t "cache incremental dos transcripts (node)" '[[ $? -eq 0 ]] && grep -q "leitura incremental ok" "$S/out"'
  node "$REPO/tests/board.test.mjs" > "$S/out" 2>&1
  t "quadro de changes (node)"               '[[ $? -eq 0 ]] && grep -q "quadro ok" "$S/out"'
  node "$REPO/tests/stages.test.mjs" > "$S/out" 2>&1
  t "etapas do fluxo /equipe (node)"         '[[ $? -eq 0 ]] && grep -q "etapas ok" "$S/out"'
  node "$REPO/tests/trail.test.mjs" > "$S/out" 2>&1
  t "trilha da change (node)"                '[[ $? -eq 0 ]] && grep -q "trilha ok" "$S/out"'
  node "$REPO/tests/plan.test.mjs" > "$S/out" 2>&1
  t "plano e pergunta da sessão (node)"      '[[ $? -eq 0 ]] && grep -q "plano da sessão ok" "$S/out"'
  node "$REPO/tests/ask.test.mjs" > "$S/out" 2>&1
  t "decisões pelo painel (node)"            '[[ $? -eq 0 ]] && grep -q "decisões pelo painel ok" "$S/out"'
  node "$REPO/tests/notify.test.mjs" > "$S/out" 2>&1
  t "notificações no celular (node)"         '[[ $? -eq 0 ]] && grep -q "notificações ok" "$S/out"'
  node "$REPO/tests/auth.test.mjs" > "$S/out" 2>&1
  t "acesso de fora com token (node)"        '[[ $? -eq 0 ]] && grep -q "acesso de fora ok" "$S/out"'
  node "$REPO/tests/hook.test.mjs" > "$S/out" 2>&1
  t "hook em node (node)"                    '[[ $? -eq 0 ]] && grep -q "hook em node ok" "$S/out"'
  node "$REPO/tests/settings.test.mjs" > "$S/out" 2>&1
  t "hooks que faltam no settings.json (node)" '[[ $? -eq 0 ]] && grep -q "settings do projeto ok" "$S/out"'
  node "$REPO/tests/reply.test.mjs" > "$S/out" 2>&1
  t "fim do turno e modo longe (node)"       '[[ $? -eq 0 ]] && grep -q "fim do turno e modo longe ok" "$S/out"'
  node "$REPO/tests/feed.test.mjs" > "$S/out" 2>&1
  t "conversa do drawer (node)"              '[[ $? -eq 0 ]] && grep -q "conversa ok" "$S/out"'
  node "$REPO/tests/async.test.mjs" > "$S/out" 2>&1
  t "duração de agentes em segundo plano (node)" '[[ $? -eq 0 ]] && grep -q "duração de segundo plano ok" "$S/out"'
  node "$REPO/tests/declared.test.mjs" > "$S/out" 2>&1
  t "estado declarado do tasks.md (node)"    '[[ $? -eq 0 ]] && grep -q "estado declarado ok" "$S/out"'
  node "$REPO/tests/agentstate.test.mjs" > "$S/out" 2>&1
  t "estados do agente e sessão (node)"      '[[ $? -eq 0 ]] && grep -q "estados do agente e sessão ok" "$S/out"'
  node "$REPO/tests/team.test.mjs" > "$S/out" 2>&1
  t "página /equipe e /api/team (node)"      '[[ $? -eq 0 ]] && grep -q "equipe ok" "$S/out"'
  node "$REPO/tests/sessions.test.mjs" > "$S/out" 2>&1
  t "sessões da equipe e tarefas avulsas (node)" '[[ $? -eq 0 ]] && grep -q "sessões da equipe e tarefas avulsas ok" "$S/out"'
  node "$REPO/tests/hub.test.mjs" > "$S/out" 2>&1
  t "hub: registro e tempo real sob demanda (node)" '[[ $? -eq 0 ]] && grep -q "hub: registro e tempo real sob demanda ok" "$S/out"'
else
  echo "  skip coletor do painel (sem node)"
fi

echo
if [[ $fail -eq 0 ]]; then echo "✓ $n testes passaram"; else echo "✗ $fail de $n testes falharam"; exit 1; fi
