#!/usr/bin/env bash
# Testes do detector, do renderizador e do instalador sobre projetos de exemplo.
#   tests/run.sh            (ou: make test)
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S="$(mktemp -d)"; trap 'rm -rf "$S"' EXIT
"$REPO/tests/fixtures.sh" "$S/f"
F="$S/f"

fail=0 n=0
t()  { n=$((n+1)); if eval "$2"; then printf '  ok   %s\n' "$1"; else printf '  FAIL %s\n' "$1"; fail=$((fail+1)); fi; }
detect() { bash "$REPO/lib/detect.sh" "$1" > "$S/d.conf" && . "$S/d.conf"; }
inst() { bash "$REPO/install.sh" --no-skills --no-commands --no-settings "$@" > "$S/out" 2>&1; }
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
R="$(X= Y=1 bash "$REPO/lib/render.sh" "$S/t.md" 2>/dev/null)"
t "render: ramo else e unless"       '[[ $R == $'"'"'a  b\nsem X\ninline: não.\nfim {{ nao_var }} '"'"' ]]'

echo "▸ instalador"
P="$F/monorepo-nested-git"
inst "$P"
t "instala conf, contexto e 7 agentes" '[[ -f $P/.claude/ai-team.conf && -f $P/.claude/project-context.md && $(ls $P/.claude/agents | wc -l) -eq 7 ]]'
t "nenhum {{ sobra"                    '! grep -l "{{" $P/.claude/agents/*.md $P/.claude/project-context.md >/dev/null'
t "tech-lead lista a equipe"           'has "Agent(product-owner, devops, backend-dev, frontend-dev, code-reviewer, qa)" $P/.claude/agents/tech-lead.md'
t "backend-dev tem branch e gate"      'has "branch \`v2\`" $P/.claude/agents/backend-dev.md && has "make lint; make format-check" $P/.claude/agents/backend-dev.md'
t "contexto cita padroes do backend"   'has "docs/padroes.md (em \`backend/\`)" $P/.claude/project-context.md'
inst "$P"
t "segunda rodada: tudo igual"         '[[ $(grep -c "igual" "$S/out") -ge 8 ]] && ! grep -q "existe" "$S/out"'
printf '\n- Regra de negócio X.\n' >> "$P/.claude/project-context.md"
inst --render --set FRONTEND_CMD_LINT='bun run lint:integration' --set TEST_PERSONAS='ana (admin)' "$P"
t "--set grava no conf"                'has "FRONTEND_CMD_LINT='"'"'bun run lint:integration'"'"'" $P/.claude/ai-team.conf'
t "gate derivado reflete --set"        'has "bun run lint:integration; bun run typecheck" $P/.claude/agents/frontend-dev.md'
t "gerado intocado atualiza sem force" 'grep -q "atualizado agents/frontend-dev.md" "$S/out" && has "ana (admin)" $P/.claude/agents/qa.md'
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
t "fastapi: qa pela API"               'has "pela API" $P/.claude/agents/qa.md && ! has "frontend-dev" $P/.claude/agents/tech-lead.md'
t "fastapi: aviso sem padrões"         'grep -q "sem documento de padrões" "$S/out"'

P="$F/laravel-inertia"; inst "$P"
t "laravel: contexto marca mesmo pacote" 'has "backend e frontend no mesmo pacote" $P/.claude/project-context.md'

P="$F/empty"; inst "$P"
t "vazio: instala com aviso"           'grep -q "nenhum pacote reconhecido" "$S/out" && [[ -f $P/.claude/agents/tech-lead.md ]]'

P="$F/monorepo-nested-git"; rm -rf "$P/.claude"
bash "$REPO/install.sh" --profile plato --no-skills --no-commands --no-settings "$P" > "$S/out" 2>&1
t "perfil plato: cópia intocada"       'cmp -s "$REPO/profiles/plato/agents/tech-lead.md" "$P/.claude/agents/tech-lead.md" && [[ ! -f $P/.claude/ai-team.conf ]]'
bash "$REPO/install.sh" --detect-only "$P" > "$S/out" 2>/dev/null
t "--detect-only: só o conf em stdout" '[[ $(head -1 "$S/out") == PROJECT_NAME=* ]] && [[ ! -d $P/.claude/agents ]] || [[ $(head -1 "$S/out") == PROJECT_NAME=* ]]'
bash "$REPO/install.sh" --dry-run "$F/go-api" > "$S/out" 2>&1
t "--dry-run não grava"                '[[ ! -d $F/go-api/.claude ]] && grep -q "+ ai-team.conf" "$S/out"'

echo "▸ painel"
P="$F/fastapi-single"; rm -rf "$P/.claude"
bash "$REPO/install.sh" --no-skills --no-commands "$P" > "$S/out" 2>&1
t "dashboard copiado e hooks no settings novo" '[[ -x $P/.claude/dashboard/server.mjs || -f $P/.claude/dashboard/server.mjs ]] && [[ -x $P/.claude/dashboard/hook.sh ]] && grep -q SubagentStop $P/.claude/settings.json'
P2="$F/go-api"; rm -rf "$P2/.claude"
bash "$REPO/install.sh" --profile plato --no-skills --no-commands "$P2" > "$S/out" 2>&1
t "perfil plato: equipe.html no dashboard"  'cmp -s "$REPO/profiles/plato/dashboard/equipe.html" "$P2/.claude/dashboard/equipe.html"'
t "perfil generic: sem equipe.html"         '[[ ! -f $P/.claude/dashboard/equipe.html ]]'
rm -rf "$P2/.claude"
bash "$REPO/install.sh" --no-skills --no-commands --no-dashboard "$F/go-api" > "$S/out" 2>&1
t "--no-dashboard: sem painel nem hooks"    '[[ ! -d $F/go-api/.claude/dashboard ]] && ! grep -q hooks $F/go-api/.claude/settings.json'
printf '{"hook_event_name":"SubagentStop","agent_id":"abc","agent_type":"qa","session_id":"s1","agent_transcript_path":"/x"}' | CLAUDE_PROJECT_DIR="$P" bash "$REPO/dashboard/hook.sh"
t "hook.sh grava events.jsonl"             'grep -q "\"event\":\"SubagentStop\",\"agent_id\":\"abc\",\"agent_type\":\"qa\"" $P/.claude/ai-team/events.jsonl'
if command -v node >/dev/null 2>&1; then
  node "$REPO/tests/dashboard.test.mjs" > "$S/out" 2>&1
  t "coletor do painel (node)"               '[[ $? -eq 0 ]] && grep -q "coletor ok" "$S/out"'
  node "$REPO/tests/cache.test.mjs" > "$S/out" 2>&1
  t "cache incremental dos transcripts (node)" '[[ $? -eq 0 ]] && grep -q "leitura incremental ok" "$S/out"'
  node "$REPO/tests/board.test.mjs" > "$S/out" 2>&1
  t "quadro de changes (node)"               '[[ $? -eq 0 ]] && grep -q "quadro ok" "$S/out"'
  node "$REPO/tests/stages.test.mjs" > "$S/out" 2>&1
  t "etapas do fluxo /equipe (node)"         '[[ $? -eq 0 ]] && grep -q "etapas ok" "$S/out"'
else
  echo "  skip coletor do painel (sem node)"
fi

echo
if [[ $fail -eq 0 ]]; then echo "✓ $n testes passaram"; else echo "✗ $fail de $n testes falharam"; exit 1; fi
