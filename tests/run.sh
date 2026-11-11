#!/usr/bin/env bash
# Tests for the detector, the renderer and the installer on sample projects.
#   tests/run.sh            (or: make test)
set -uo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
S="$(mktemp -d)"; trap 'rm -rf "$S"' EXIT
export AI_TEAM_NOTIFY_FILE="$S/no-notify.json"   # the test hooks never notify the runner's phone
export AI_TEAM_TOKEN_FILE="$S/no-token"; unset AI_TEAM_TOKEN   # nor use the runner's token
unset OUTPUT_LANGUAGE   # a value from the runner's shell must not leak into the conf
"$REPO/tests/fixtures.sh" "$S/f"
F="$S/f"
export AI_TEAM_HUB="$S/hub.json"   # never touches the runner's hub
# install.sh installs the openspec CLI with npm when missing: in the tests, no real npm runs
mkdir -p "$S/guard"; export NPM_FAKE_LOG="$S/npm.log"
printf '#!/usr/bin/env bash\necho "$*" >> "$NPM_FAKE_LOG"; exit 1\n' > "$S/guard/npm"; chmod +x "$S/guard/npm"
export PATH="$S/guard:$PATH"
# test profile: a copy of the repo with a synthetic profile (no profile is versioned here)
PR="$S/src"; mkdir -p "$PR"; (cd "$REPO" && tar cf - --exclude=.git .) | (cd "$PR" && tar xf -)
mkdir -p "$PR/profiles/example/agents" "$PR/profiles/example/dashboard"
printf -- '---\nname: orchestrator\n---\n# orchestrator of the example profile\n' > "$PR/profiles/example/agents/orchestrator.md"
printf '<section id="cycle-example"></section>\n' > "$PR/profiles/example/dashboard/cycle.html"

fail=0 n=0
t()  { n=$((n+1)); if eval "$2"; then printf '  ok   %s\n' "$1"; else printf '  FAIL %s\n' "$1"; fail=$((fail+1)); fi; }
detect() { bash "$REPO/lib/detect.sh" "$1" > "$S/d.conf" && . "$S/d.conf"; }
inst() { bash "$REPO/install.sh" --yes --no-skills --no-commands --no-settings "$@" > "$S/out" 2>&1; }
has() { grep -qF -- "$1" "$2"; }
# node test file: passes only with exit code 0 AND its final "ok" line (a crash after the line, or a wrong exit, fails)
# on failure, the tail of its output goes to the log (otherwise CI shows only the test name)
nt() {
  local file="$1" name="$2" okline="$3" rc f0=$fail; node "$REPO/tests/$file.test.mjs" > "$S/out" 2>&1; rc=$?
  t "$name" '[[ $rc -eq 0 ]] && has "$okline" "$S/out"'
  (( fail > f0 )) && tail -n 30 "$S/out" | sed 's/^/       | /'
  return 0
}

echo "▸ detector"
detect "$F/monorepo-nested-git"
t "monorepo: layout"                 '[[ $LAYOUT == monorepo && $BACKEND_DIR == backend && $FRONTEND_DIR == frontend ]]'
t "monorepo: backend stack"          '[[ $BACKEND_FRAMEWORK == NestJS/Express && $BACKEND_PKG_MANAGER == pnpm && $BACKEND_STACK == *Prisma*PostgreSQL* ]]'
t "monorepo: sub-repo branches"      '[[ $BACKEND_BRANCH == v2 && $BACKEND_PROTECTED_BRANCH == main && $FRONTEND_BRANCH == integration && $FRONTEND_OWN_REPO == 1 ]]'
t "monorepo: Makefile beats script"  '[[ $BACKEND_CMD_LINT == "make lint" && $BACKEND_CMD_BUILD == "make build-app" && $BACKEND_CMD_E2E == "make test-e2e" ]]'
t "monorepo: frontend bun + scripts" '[[ $FRONTEND_PKG_MANAGER == bun && $FRONTEND_CMD_TYPECHECK == "bun run typecheck" && $FRONTEND_CMD_E2E == "bun run e2e" ]]'
t "monorepo: pt-BR docs classified"  '[[ $DOCS_CONTEXT == CLAUDE.md && $DOCS_ENV == docs/ambiente.md && $DOCS_ARCH == docs/arquitetura.md && $BACKEND_DOCS_STANDARDS == docs/padroes.md && $DOCS_OTHER == *plano-desenvolvimento* ]]'
t "monorepo: compose and openspec"   '[[ $DOCKER_COMPOSE_FILE == backend/docker-compose.yml && $HAS_OPENSPEC == 1 ]]'
t "monorepo: description from README" '[[ $PROJECT_DESCRIPTION == Planning* ]]'

detect "$F/fastapi-single"
t "fastapi: backend only"            '[[ $LAYOUT == single && $HAS_BACKEND == 1 && $HAS_FRONTEND == 0 && $BACKEND_DIR == . ]]'
t "fastapi: uv + ruff + mypy"        '[[ $BACKEND_CMD_LINT == "uv run ruff check ." && $BACKEND_CMD_TYPECHECK == "uv run mypy ." && $BACKEND_CMD_TEST == "uv run pytest" ]]'
t "fastapi: name from pyproject"     '[[ $PROJECT_NAME == billing-api && $CI == github-actions ]]'

detect "$F/laravel-inertia"
t "laravel: fullstack same dir"      '[[ $SAME_DIR == 1 && $BACKEND_FRAMEWORK == "Laravel + Inertia/React"* ]]'
t "laravel: pint, phpstan, artisan"  '[[ $BACKEND_CMD_FORMAT == "vendor/bin/pint --test" && $BACKEND_CMD_TEST == "php artisan test" && $BACKEND_CMD_LINT == "npm run lint" ]]'
t "laravel: develop protects master" '[[ $GIT_WORK_BRANCH == develop && $BACKEND_PROTECTED_BRANCH == master ]]'

detect "$F/next-app"
t "next: meta-framework = both"      '[[ $HAS_BACKEND == 1 && $HAS_FRONTEND == 1 && $SAME_DIR == 1 && $BACKEND_CMD_TYPECHECK == "yarn tsc --noEmit" ]]'
t "next: name without scope"         '[[ $PROJECT_NAME == site && $BACKEND_PKG_MANAGER == yarn ]]'

detect "$F/go-api"
t "go: chi + make"                   '[[ $BACKEND_FRAMEWORK == Chi && $BACKEND_CMD_TEST == "make test" && $BACKEND_SRC_DIR == internal && $HAS_MAKEFILE == 1 ]]'
t "go: English docs classified"      '[[ $DOCS_STANDARDS == docs/standards.md && $DOCS_ENV == docs/environment.md && $DOCS_ARCH == docs/architecture.md ]]'
t "go: lessons file defaults"        '[[ $DOCS_LESSONS == docs/lessons.md && $DOCS_OTHER != *lessons* ]]'

detect "$F/pnpm-ws"
t "workspace: apps/api and apps/web" '[[ $BACKEND_DIR == apps/api && $FRONTEND_DIR == apps/web && $OTHER_PKGS == packages/shared ]]'
t "workspace: inherits root pnpm"    '[[ $BACKEND_PKG_MANAGER == pnpm && $FRONTEND_CMD_TYPECHECK == "pnpm typecheck" ]]'

detect "$F/empty"
t "empty: nothing detected, no error" '[[ $HAS_BACKEND == 0 && $HAS_FRONTEND == 0 && $PROJECT_NAME == empty ]]'

echo "▸ renderer"
cat > "$S/t.md" <<'EOF'
a {{X}} b
{{#if X}}
only with X
{{else}}
without X
{{/if}}
inline: {{#if X}}yes{{/if}}{{#unless X}}no{{/unless}}.
{{#if X}}opens inline
and closes later{{/if}}
{{#if Y}}
{{#if X}}nested{{/if}}
{{/if}}
end {{ not_var }} {{/if}}
EOF
R="$(X=1 Y=1 bash "$REPO/lib/render.sh" "$S/t.md" 2>"$S/err")"
t "render: substitution and blocks"  '[[ $R == $'"'"'a 1 b\nonly with X\ninline: yes.\nopens inline\nand closes later\nnested\nend {{ not_var }} '"'"' ]]'
t "render: stray {{/if}} warns"      'grep -q "outside a block" "$S/err"'
R="$(X='' Y=1 bash "$REPO/lib/render.sh" "$S/t.md" 2>/dev/null)"
t "render: else branch and unless"   '[[ $R == $'"'"'a  b\nwithout X\ninline: no.\nend {{ not_var }} '"'"' ]]'
printf -- '- a{{#if Y}} y{{/if}}{{#if X}} x{{/if}}\n- b\n' > "$S/t2.md"
R="$(X='' Y=1 bash "$REPO/lib/render.sh" "$S/t2.md")"
t "render: false block after an inline one keeps the newline" '[[ $R == $'"'"'- a y\n- b'"'"' ]]'

echo "▸ installer"
P="$F/monorepo-nested-git"
inst "$P"; rc=$?
t "installs conf, context and 7 agents" '[[ -f $P/.claude/ai-team.conf && -f $P/.claude/project-context.md && $(ls $P/.claude/agents | wc -l) -eq 7 ]]'
t "successful run exits 0 (standards doc present)" '[[ $rc -eq 0 ]]'
t "OUTPUT_LANGUAGE defaults to en"            'has "OUTPUT_LANGUAGE='"'"'en'"'"'" $P/.claude/ai-team.conf && grep -q "language  en" "$S/out"'
t "no {{ left over"                    '! grep -l "{{" $P/.claude/agents/*.md $P/.claude/project-context.md >/dev/null'
t "orchestrator lists the team"        'has "Agent(spec-writer, provisioner, builder, integrator, reviewer, validator)" $P/.claude/agents/orchestrator.md'
t "builder has the branch"             'has "from \`v2\`" $P/.claude/agents/builder.md'
t "gate-and-commit skill rendered"     'has "make lint; make format-check" $P/.claude/skills/gate-and-commit/SKILL.md && has "\`integration\`" $P/.claude/skills/gate-and-commit/SKILL.md'
t "skill without {{ and with marker"   '! grep -q "{{" $P/.claude/skills/gate-and-commit/SKILL.md && has "ai-team:generated" $P/.claude/skills/gate-and-commit/SKILL.md'
t "devs load the skill"                'grep -l "^skills: gate-and-commit" $P/.claude/agents/*.md | wc -l | grep -q 3'
t "grilling and /grill-me unchanged"   'cmp -s $REPO/templates/skills/grilling/SKILL.md $P/.claude/skills/grilling/SKILL.md && cmp -s $REPO/templates/skills/grill-me/SKILL.md $P/.claude/skills/grill-me/SKILL.md && has "MIT License" $P/.claude/skills/grilling/LICENSE && has "MIT License" $P/.claude/skills/grill-me/LICENSE'
t "spec-writer loads grilling"         'has "skills: grilling" $P/.claude/agents/spec-writer.md && has "## Proposal critique" $P/.claude/agents/spec-writer.md'
t "orchestrator runs the rounds"       'has "**Decision rounds:**" $P/.claude/agents/orchestrator.md && has "skill \`grilling\`" $P/.claude/agents/orchestrator.md'
t "context cites backend standards"    'has "docs/padroes.md (in \`backend/\`)" $P/.claude/project-context.md'
t "context and agents cite the lessons file" 'has "docs/lessons.md" $P/.claude/project-context.md && has "docs/lessons.md" $P/.claude/agents/builder.md && has "lesson L-<n>" $P/.claude/agents/reviewer.md && has "L-<n>" $P/.claude/agents/spec-writer.md'
t "agents keep their role across compaction" 'has "compact builder 2>/dev/null" $P/.claude/agents/builder.md && has "compact reviewer" $P/.claude/agents/reviewer.md && has "## After compaction" $P/.claude/agents/spec-writer.md && ! has "PreCompact" $P/.claude/agents/orchestrator.md && head -14 $P/.claude/agents/builder.md | grep -q "^hooks:"'
t "large change with frontend: contract draft" 'has "## API contract (draft)" $P/.claude/agents/spec-writer.md && has "contract: draft by spec-writer" $P/.claude/agents/builder.md && has "contract: draft by spec-writer" $P/.claude/agents/integrator.md && has "leaves it as a draft" $P/.claude/agents/orchestrator.md'
t "findings carry Fix and Reuse"       'has "  Fix: <one imperative" $P/.claude/agents/reviewer.md && has "  Reuse: <path:line" $P/.claude/agents/reviewer.md && has "apply its \`Fix:\` line literally" $P/.claude/skills/gate-and-commit/SKILL.md'
inst "$P"
t "second run: all the same"           '[[ $(grep -c "same" "$S/out") -ge 8 ]] && ! grep -q "exists" "$S/out"'
printf '\n- Business rule X.\n' >> "$P/.claude/project-context.md"
inst --render --set FRONTEND_CMD_LINT='bun run lint:integration' --set TEST_PERSONAS='ana (admin)' --set OUTPUT_LANGUAGE=pt-BR "$P"
t "--set writes to the conf"           'has "FRONTEND_CMD_LINT='"'"'bun run lint:integration'"'"'" $P/.claude/ai-team.conf'
t "--set OUTPUT_LANGUAGE=pt-BR"               'has "OUTPUT_LANGUAGE='"'"'pt-BR'"'"'" $P/.claude/ai-team.conf && grep -q "language  pt-BR" "$S/out"'
t "derived gate reflects --set"        'has "bun run lint:integration; bun run typecheck" $P/.claude/skills/gate-and-commit/SKILL.md'
t "untouched generated file updates without force" 'grep -q "updated skills/gate-and-commit/SKILL.md" "$S/out" && has "ana (admin)" $P/.claude/agents/validator.md'
t "context notes preserved"            'has "Business rule X." $P/.claude/project-context.md && has "ana (admin)" $P/.claude/project-context.md'
# a context from before the English version: the old notes marker is recognized and replaced
sed -i.bak 's/<!-- ai-team:notes -->/<!-- ai-team:notas -->/' "$P/.claude/project-context.md"
inst --render "$P"
t "old notes marker: notes kept, marker renamed" 'has "Business rule X." $P/.claude/project-context.md && has "<!-- ai-team:notes -->" $P/.claude/project-context.md && ! has "<!-- ai-team:notas -->" $P/.claude/project-context.md'
echo "my rule" >> "$P/.claude/agents/validator.md"
inst --render --set TEST_PERSONAS='bia' "$P"
t "hand-edited file is not overwritten" 'grep -q "exists  agents/validator.md (hand-edited" "$S/out" && has "my rule" $P/.claude/agents/validator.md'
# an older conf (no version, no DOCS_LESSONS): --render migrates it first, with a copy; a second run is silent
sed -i.old '/^AI_TEAM_CONF_VERSION=/d; /^DOCS_LESSONS=/d' "$P/.claude/ai-team.conf"; rm -f "$P/.claude/ai-team.conf.old"
inst --render --dry-run "$P"
t "old conf: --dry-run only announces the migration" 'grep -q "conf: v1 → v2 (dry run)" "$S/out" && ! has AI_TEAM_CONF_VERSION $P/.claude/ai-team.conf'
inst --render "$P"
t "old conf: --render migrates it to v2" 'grep -q "conf: v1 → v2" "$S/out" && grep -q "+ DOCS_LESSONS=" "$S/out" && has "AI_TEAM_CONF_VERSION='"'"'2'"'"'" $P/.claude/ai-team.conf && has "DOCS_LESSONS='"'"'docs/lessons.md'"'"'" $P/.claude/ai-team.conf && [[ -f $P/.claude/ai-team.conf.bak-ai-team ]]'
t "old conf: the agents render with the new key" 'has "docs/lessons.md" $P/.claude/agents/builder.md'
inst --render "$P"
t "current conf: no migration message"   '! grep -q "conf: v" "$S/out"'
bash "$REPO/install.sh" --check "$P" > "$S/out" 2>&1; rc=$?
t "--check: up to date exits 0"          '[[ $rc -eq 0 ]] && grep -q "conf v2: current" "$S/out" && grep -q "up to date" "$S/out"'
sed -i.old '/^AI_TEAM_CONF_VERSION=/d' "$P/.claude/ai-team.conf"; rm -f "$P/.claude/ai-team.conf.old"
echo "hand edit" >> "$P/.claude/agents/validator.md"
bash "$REPO/install.sh" --check "$P" > "$S/out" 2>&1; rc=$?
t "--check: old conf exits 1 and names the hand-edited file" '[[ $rc -eq 1 ]] && grep -q "conf: v1, current v2" "$S/out" && grep -q "hand-edited.*agents/validator.md" "$S/out" && has "OUTPUT_LANGUAGE" $P/.claude/ai-team.conf && ! has AI_TEAM_CONF_VERSION $P/.claude/ai-team.conf'
inst --render "$P"
t "migrate.sh and version.mjs agree on the conf version" '[[ $(sed -nE "s/^AI_TEAM_CONF_VERSION_CURRENT=([0-9]+)$/\1/p" "$REPO/lib/migrate.sh") == $(sed -nE "s/^export const CONF_VERSION = ([0-9]+);/\1/p" "$REPO/dashboard/version.mjs") ]]'
inst --render --force "$P"
t "--force overwrites"                 '! has "my rule" $P/.claude/agents/validator.md'
inst --reconfigure "$P"
t "--reconfigure goes back to detected" '! has "lint:integration" $P/.claude/ai-team.conf && has "OUTPUT_LANGUAGE='"'"'en'"'"'" $P/.claude/ai-team.conf'

P="$F/fastapi-single"; inst "$P"
t "fastapi: no integrator"             '[[ ! -f $P/.claude/agents/integrator.md && -f $P/.claude/agents/builder.md ]]'
t "fastapi: skill without frontend front" '! has "Frontend" $P/.claude/skills/gate-and-commit/SKILL.md'
t "fastapi: validator through the API" 'has "through the API" $P/.claude/agents/validator.md && ! has "integrator" $P/.claude/agents/orchestrator.md'
t "fastapi: no contract draft without a frontend" '! has "API contract (draft)" $P/.claude/agents/spec-writer.md && has "Without a draft, write the" $P/.claude/agents/builder.md'
t "fastapi: no-standards warning"      'grep -q "no standards doc: create docs/standards.md" "$S/out"'

P="$F/laravel-inertia"; inst "$P"
t "laravel: context marks same package" 'has "backend and frontend in the same package" $P/.claude/project-context.md'
t "laravel: skill covers the 3 sections" 'has "\`2. Frontend\`, same package" $P/.claude/skills/gate-and-commit/SKILL.md'

P="$F/empty"; inst "$P"
t "empty: installs with a warning"     'grep -q "no recognized package" "$S/out" && [[ -f $P/.claude/agents/orchestrator.md ]]'

P="$F/monorepo-nested-git"; rm -rf "$P/.claude"
bash "$PR/install.sh" --profile example --no-skills --no-commands --no-settings "$P" > "$S/out" 2>&1
t "example profile: untouched copy"    'cmp -s "$PR/profiles/example/agents/orchestrator.md" "$P/.claude/agents/orchestrator.md" && [[ ! -f $P/.claude/ai-team.conf ]]'
bash "$REPO/install.sh" --detect-only "$P" > "$S/out" 2>/dev/null
t "--detect-only: only the conf on stdout" '[[ $(head -1 "$S/out") == PROJECT_NAME=* ]] && [[ ! -d $P/.claude/agents ]] || [[ $(head -1 "$S/out") == PROJECT_NAME=* ]]'
bash "$REPO/install.sh" --dry-run "$F/go-api" > "$S/out" 2>&1
t "--dry-run writes nothing"           '[[ ! -d $F/go-api/.claude ]] && grep -q "+ ai-team.conf" "$S/out"'

echo "▸ worktree"
# the integrate merge needs a git identity; the CI Linux runner has none
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
gc() { git -C "$1" -c user.name=t -c user.email=t@t "${@:2}"; }
P="$(cd "$F/monorepo-nested-git" && pwd -P)"; rm -rf "$P/.claude"; inst "$P"; W="$P/.claude/skills/worktree/wt.sh"
t "worktree skill and wt.sh installed" '[[ -x $W ]] && has "wt.sh open <id> <front>" $P/.claude/skills/worktree/SKILL.md && ! grep -q "{{" $P/.claude/skills/worktree/SKILL.md'
t "devs load both skills"              'grep -l "^skills: gate-and-commit, worktree" $P/.claude/agents/*.md | wc -l | grep -q 3'
B="$("$W" open login backend 2>/dev/null)"; FR="$("$W" open login frontend 2>/dev/null)"
t "nested: one worktree per repo"      '[[ $B == $P/.claude/worktrees/login-backend && $FR == $P/.claude/worktrees/login-frontend ]] && [[ $(git -C "$B" branch --show-current) == change/login ]]'
t "open again reuses"                  '[[ $("$W" open login backend 2>/dev/null) == "$B" ]]'
t "branch starts from the work branch" '[[ $(git -C "$B" rev-parse HEAD) == $(git -C "$P/backend" rev-parse v2) ]]'
t "where lists the worktrees"          'wl="$("$W" where login)" && grep -qxF "$B change/login" <<<"$wl" && grep -qxF "$FR change/login" <<<"$wl"'
echo x > "$B/new.txt"; gc "$B" add new.txt; gc "$B" commit -qm feat
"$W" close login 2>"$S/err"
t "close keeps what is not integrated" '[[ -d $B ]] && grep -q "is not integrated yet" "$S/err"'
t "integrate does merge --no-ff"       '"$W" integrate login backend >/dev/null 2>&1 && [[ -f $P/backend/new.txt && $(git -C "$P/backend" rev-list --parents -1 HEAD | wc -w) -eq 3 ]]'
gc "$P/backend" checkout -q main
t "integrate refuses off the work branch" '! "$W" integrate login backend 2>"$S/err" && grep -q "not on .v2." "$S/err"'
gc "$P/backend" checkout -q v2
"$W" close login 2>/dev/null
t "close removes worktrees and branches" '[[ ! -d $P/.claude/worktrees ]] && ! git -C "$P/backend" show-ref -q --verify refs/heads/change/login'
P="$(cd "$F/laravel-inertia" && pwd -P)"; rm -rf "$P/.claude"; inst "$P"; W="$P/.claude/skills/worktree/wt.sh"
B="$("$W" open account backend 2>/dev/null)"
t "single root: fronts share the worktree" '[[ $B == $P/.claude/worktrees/account && $("$W" open account frontend 2>/dev/null) == "$B" ]]'
t "worktrees out of the root git"      'grep -qxF ".claude/worktrees/" "$P/.git/info/exclude" && ! git -C "$P" status --porcelain | grep -q worktrees'
echo wt > "$B/c.txt"; gc "$B" add c.txt; gc "$B" commit -qm wt
echo main > "$P/c.txt"; gc "$P" add c.txt; gc "$P" commit -qm main; H="$(git -C "$P" rev-parse HEAD)"
t "conflict: aborts and says conflict" '! "$W" integrate account backend 2>"$S/err" && grep -q "^wt: conflict" "$S/err" && [[ $(git -C "$P" rev-parse HEAD) == "$H" && -z $(git -C "$P" status --porcelain -uno) ]]'
"$W" close account 2>/dev/null
t "invalid id refused"                 '! "$W" open "../x" backend 2>/dev/null'

echo "▸ openspec"
# fake CLI: logs the call and creates what openspec init would
OB="$S/osbin"; mkdir -p "$OB"
cat > "$OB/openspec" <<'EOF'
#!/usr/bin/env bash
[[ $1 == --version ]] && { echo "${OPENSPEC_FAKE_VERSION:-1.14.1}"; exit 0; }
echo "$*" >> "$OPENSPEC_FAKE_LOG"
if [[ "$1 $2" == "schema fork" ]]; then   # spec-driven's shape: tasks requires specs and design
  mkdir -p "openspec/schemas/$4/templates"; touch "openspec/schemas/$4/templates/design.md"
  printf 'name: %s\ndescription: Default\nartifacts:\n  - id: proposal\n    requires: []\n  - id: design\n    instruction: |\n      How.\n    requires:\n      - proposal\n  - id: tasks\n    requires:\n      - specs\n      - design\n\napply:\n  requires: [ tasks ]\n' "$4" > "openspec/schemas/$4/schema.yaml"
  exit 0
fi
[[ "$1 $2" == "schema validate" ]] && exit "${OPENSPEC_FAKE_SCHEMA_RC:-0}"
d="${!#}"; mkdir -p "$d/openspec/changes" "$d/.claude/skills/openspec-propose" "$d/.claude/commands/opsx"
echo fake > "$d/.claude/skills/openspec-propose/SKILL.md"
[[ -f "$d/openspec/config.yaml" ]] || printf 'schema: spec-driven\n\n# Project context (optional)\n' > "$d/openspec/config.yaml"
EOF
chmod +x "$OB/openspec"
P="$S/os-go"; cp -R "$F/go-api" "$P"; P="$(cd "$P" && pwd -P)"; export OPENSPEC_FAKE_LOG="$S/os.log"
PATH="$OB:$PATH" bash "$REPO/install.sh" --yes --no-settings --no-dashboard "$P" > "$S/out" 2>&1
t "runs openspec init in the project"  'grep -qxF "init --tools claude --no-animation $P" "$OPENSPEC_FAKE_LOG" && [[ -f $P/.claude/skills/openspec-propose/SKILL.md ]]'
t "created openspec/ turns HAS_OPENSPEC on" 'has "HAS_OPENSPEC='"'"'1'"'"'" $P/.claude/ai-team.conf && has "Specs and tasks live in" $P/.claude/agents/orchestrator.md'
t "tested version: no warning"         '! grep -q "were tested with" "$S/out"'
t "CLI present: npm not called"        '[[ ! -s $NPM_FAKE_LOG ]]'
L="$P/openspec/schemas/lite"
t "lite schema: forked without design"  'grep -qxF "schema fork spec-driven lite" "$OPENSPEC_FAKE_LOG" && has "  - id: tasks" $L/schema.yaml && ! has "id: design" $L/schema.yaml && ! grep -qx "      - design" $L/schema.yaml && has "      - specs" $L/schema.yaml && has "apply:" $L/schema.yaml && [[ ! -f $L/templates/design.md ]]'
t "config.yaml replaces the stock one"  'has "schema: lite" $P/openspec/config.yaml && has "## 0. Infra" $P/openspec/config.yaml && ! has "{{" $P/openspec/config.yaml && grep -q "^# ai-team:generated cksum=" $P/openspec/config.yaml'
t "config.yaml: section 3 through the API" 'has "through the API" $P/openspec/config.yaml && has "Write every artifact in en." $P/openspec/config.yaml'
t "config.yaml: no contract draft without a frontend" '! has "contract draft" $P/openspec/config.yaml && has "the builder writes the API contract there during the build." $P/openspec/config.yaml'
t "spec-writer: Sonnet, sizes and rules" 'has "model: sonnet" $P/.claude/agents/spec-writer.md && has "Size: small" $P/.claude/agents/spec-writer.md && has "openspec/config.yaml" $P/.claude/agents/spec-writer.md && has "model: \"opus\"" $P/.claude/agents/orchestrator.md'
OPENSPEC_FAKE_VERSION=9.9.9 PATH="$OB:$PATH" bash "$REPO/install.sh" --yes --no-settings --no-dashboard "$P" > "$S/out" 2>&1
t "other version: warns"               'grep -q "openspec 9.9.9 installed; the agents were tested with 1.14.1" "$S/out"'
t "second run: lite and config.yaml kept" 'grep -q "same    openspec/schemas/lite" "$S/out" && grep -q "same    openspec/config.yaml" "$S/out" && [[ $(grep -c "schema fork" "$OPENSPEC_FAKE_LOG") -eq 1 ]]'
echo "my rule" >> "$P/openspec/config.yaml"
PATH="$OB:$PATH" bash "$REPO/install.sh" --render "$P" > "$S/out" 2>&1
t "hand-edited config.yaml is kept"    'grep -q "exists  openspec/config.yaml (hand-edited" "$S/out" && has "my rule" $P/openspec/config.yaml'
PATH="$OB:$PATH" bash "$REPO/install.sh" --render --force "$P" > "$S/out" 2>&1
: > "$OPENSPEC_FAKE_LOG"
PATH="$OB:$PATH" bash "$REPO/install.sh" --yes --no-settings --no-dashboard --no-openspec "$P" > "$S/out" 2>&1
PATH="$OB:$PATH" bash "$REPO/install.sh" --yes --no-settings --no-dashboard --no-skills "$P" > "$S/out" 2>&1
PATH="$OB:$PATH" bash "$REPO/install.sh" --render "$P" > "$S/out" 2>&1
PATH="$OB:$PATH" bash "$REPO/install.sh" --detect-only "$P" > "$S/out" 2>&1
t "--no-openspec, --render and --detect-only do not run it" '[[ ! -s $OPENSPEC_FAKE_LOG ]]'
P="$S/os-nolite"; cp -R "$F/go-api" "$P"; P="$(cd "$P" && pwd -P)"
OPENSPEC_FAKE_SCHEMA_RC=1 PATH="$OB:$PATH" bash "$REPO/install.sh" --yes --no-settings --no-dashboard "$P" > "$S/out" 2>&1; rc=$?
t "invalid lite schema: warns, stays on spec-driven" '[[ $rc -eq 0 && ! -d $P/openspec/schemas/lite ]] && grep -q "could not create the OpenSpec lite schema" "$S/out" && has "schema: spec-driven" $P/openspec/config.yaml && has "## 0. Infra" $P/openspec/config.yaml'
# without the CLI: the (fake) npm installs the tested version in a bin already on PATH
NB="$S/npmbin"; NI="$S/npm-installs"; mkdir -p "$NB" "$NI"
printf '#!/usr/bin/env bash\necho "$*" >> "$NPM_FAKE_LOG"; cp "%s" "%s"\n' "$OB/openspec" "$NB/openspec" > "$NI/npm"
chmod +x "$NI/npm"; : > "$NPM_FAKE_LOG"; : > "$OPENSPEC_FAKE_LOG"
P="$S/os-npm"; cp -R "$F/go-api" "$P"; P="$(cd "$P" && pwd -P)"
PATH="$NI:$NB:/usr/bin:/bin" bash "$REPO/install.sh" --yes --no-settings --no-dashboard "$P" > "$S/out" 2>&1
t "no CLI: installs with npm and runs init" 'grep -qxF "i -g @fission-ai/openspec@1.14.1" "$NPM_FAKE_LOG" && grep -q "openspec 1.14.1 installed" "$S/out" && grep -qxF "init --tools claude --no-animation $P" "$OPENSPEC_FAKE_LOG"'
rm -f "$NB/openspec"; : > "$NPM_FAKE_LOG"
PATH="$NI:$NB:/usr/bin:/bin" bash "$REPO/install.sh" --yes --dry-run --no-settings --no-dashboard "$P" > "$S/out" 2>&1
t "--dry-run only shows npm"           'grep -qF "+ npm i -g @fission-ai/openspec@1.14.1" "$S/out" && [[ ! -s $NPM_FAKE_LOG ]]'
P="$S/os-fails"; cp -R "$F/go-api" "$P"
PATH="$S/guard:/usr/bin:/bin" bash "$REPO/install.sh" --yes --no-settings --no-dashboard "$P" > "$S/out" 2>&1; rc=$?
t "npm fails: warns at the end and installs the rest" '[[ $rc -eq 0 ]] && grep -q "could not install the .openspec. CLI" "$S/out" && tail -5 "$S/out" | grep -q "no .openspec. CLI" && [[ -f $P/.claude/agents/orchestrator.md && ! -d $P/.claude/skills/openspec-propose ]]'
P="$S/os-none"; cp -R "$F/go-api" "$P"
PATH="/usr/bin:/bin" bash "$REPO/install.sh" --yes --no-settings --no-dashboard "$P" > "$S/out" 2>&1; rc=$?
t "no npm: warns and installs the rest" '[[ $rc -eq 0 ]] && grep -q "no .npm. to install it" "$S/out" && [[ -f $P/.claude/agents/orchestrator.md && ! -d $P/.claude/skills/openspec-propose ]]'
unset OPENSPEC_FAKE_LOG

echo "▸ hub"
if command -v node >/dev/null 2>&1; then
  P="$F/fastapi-single"; rm -rf "$P/.claude"
  inst --hub-team Payments "$P"
  t "--hub-team writes HUB_TEAM to the conf" 'has "HUB_TEAM='"'"'Payments'"'"'" $P/.claude/ai-team.conf'
  t "--hub-team registers in the hub"        'grep -q "added payments/billing-api" "$S/out" && has "\"dir\": \"$P\"" "$AI_TEAM_HUB"'
  inst --render "$P"
  t "--render keeps the conf registration"   'grep -q "updated payments/billing-api" "$S/out"'
  inst --render --set PROJECT_NAME='Billing API' "$P"
  t "conf name goes to the hub"              'has "\"name\": \"Billing API\"" "$AI_TEAM_HUB"'
  bash "$PR/install.sh" --profile example --yes --no-skills --no-commands --no-settings --hub-team platform "$F/go-api" > "$S/out" 2>&1
  t "example profile also registers"         'grep -q "added platform/go-api" "$S/out"'
  bash "$REPO/install.sh" --dry-run --hub-team x "$F/next-app" > "$S/out" 2>&1
  t "--dry-run only shows the registration"  'grep -q "+ hub: x/" "$S/out" && ! has next-app "$AI_TEAM_HUB"'
  rm -rf "$F/go-api/.claude" "$P/.claude"
else
  echo "  skip hub (no node)"
fi

echo "▸ dashboard"
P="$F/fastapi-single"; rm -rf "$P/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands "$P" > "$S/out" 2>&1
t "dashboard copied and hooks in the new settings" '[[ -x $P/.claude/dashboard/server.mjs || -f $P/.claude/dashboard/server.mjs ]] && [[ -x $P/.claude/dashboard/hook.sh ]] && grep -q SubagentStop $P/.claude/settings.json'
t "agent guard in the new settings"           'python3 -m json.tool $P/.claude/settings.json >/dev/null && has "\"PreToolUse\"" $P/.claude/settings.json && has "Bash|Edit|Write|MultiEdit|NotebookEdit" $P/.claude/settings.json && [[ -f $P/.claude/dashboard/guard.mjs ]]'
t "new settings without a fixed agent"       '! grep -q "\"agent\"" $P/.claude/settings.json'
t "/team installed as a skill"               'has ".claude/agents/orchestrator.md" $P/.claude/skills/team/SKILL.md && has "disable-model-invocation: true" $P/.claude/skills/team/SKILL.md && grep -q "/team <request>" "$S/out"'
t "/onboarding installed and suggested"      'has "ai-team:onboarding" $P/.claude/skills/onboarding/SKILL.md && has "disable-model-invocation: true" $P/.claude/skills/onboarding/SKILL.md && grep -q "run /onboarding" "$S/out"'
printf '\n<!-- ai-team:onboarding done=2026-10-29 sha=abc1234 -->\n' >> $P/.claude/project-context.md
bash "$REPO/install.sh" --yes --no-skills --no-commands "$P" > "$S/out" 2>&1
t "onboarding done: not suggested again"     '! grep -q "run /onboarding" "$S/out" && has "sha=abc1234" $P/.claude/project-context.md'
t "/team hooks in the new settings"          'has "\"SessionStart\"" $P/.claude/settings.json && has "\"UserPromptExpansion\"" $P/.claude/settings.json'
rm -rf "$P/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands --default-agent orchestrator "$P" > "$S/out" 2>&1
t "--default-agent fixes the agent"          'has "\"agent\": \"orchestrator\"," $P/.claude/settings.json && has "SubagentStop" $P/.claude/settings.json'
bash "$REPO/install.sh" --yes --no-skills --no-commands "$P" > "$S/out" 2>&1
t "old settings with agent: warns"           'grep -q "remove the key" "$S/out"'
rm -rf "$P/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands --agents builder,validator "$P" > "$S/out" 2>&1
t "no orchestrator, no /team"                '[[ ! -f $P/.claude/skills/team/SKILL.md && ! -f $P/.claude/skills/onboarding/SKILL.md ]] && ! has UserPromptExpansion $P/.claude/settings.json'
t "no spec-writer nor orchestrator, no grilling" '[[ ! -e $P/.claude/skills/grilling && ! -e $P/.claude/skills/grill-me ]]'
t "ad-hoc task in the templates"             'grep -q "Ad-hoc task: <slug>" $P/.claude/agents/builder.md && grep -q "Ad-hoc task" $P/.claude/agents/validator.md'
rm -rf "$P/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands "$P" > "$S/out" 2>&1
P2="$F/go-api"; rm -rf "$P2/.claude"
bash "$PR/install.sh" --yes --profile example --no-skills --no-commands "$P2" > "$S/out" 2>&1
t "example profile: only the cycle overridden" 'cmp -s "$PR/profiles/example/dashboard/cycle.html" "$P2/.claude/dashboard/cycle.html" && cmp -s "$REPO/dashboard/team.html" "$P2/.claude/dashboard/team.html"'
t "generic profile: generic team, no cycle.html" 'cmp -s "$REPO/dashboard/team.html" "$P/.claude/dashboard/team.html" && [[ -f $P/.claude/dashboard/cycle-default.html && ! -f $P/.claude/dashboard/cycle.html ]]'
rm -rf "$P2/.claude"
bash "$REPO/install.sh" --yes --no-skills --no-commands --no-dashboard "$F/go-api" > "$S/out" 2>&1
t "--no-dashboard: only the /team hook"      '[[ -x $F/go-api/.claude/dashboard/hook.sh && ! -f $F/go-api/.claude/dashboard/server.mjs ]] && ! has SubagentStop $F/go-api/.claude/settings.json && has UserPromptExpansion $F/go-api/.claude/settings.json'
t "--no-dashboard: the guard still goes"      '[[ -f $F/go-api/.claude/dashboard/guard.mjs ]] && has "\"PreToolUse\"" $F/go-api/.claude/settings.json'
printf '{"agent":"orchestrator","hooks":{"SubagentStop":[]}}' > $F/go-api/.claude/settings.json
bash "$REPO/install.sh" --yes --no-skills --no-commands --no-dashboard "$F/go-api" > "$S/out" 2>&1
t "old settings without /team hooks: adds them" 'has UserPromptExpansion $F/go-api/.claude/settings.json && has SessionStart $F/go-api/.claude/settings.json && has "\"agent\": \"orchestrator\"" $F/go-api/.claude/settings.json && ! has PermissionRequest $F/go-api/.claude/settings.json && has PreToolUse $F/go-api/.claude/settings.json && [[ -f $F/go-api/.claude/settings.json.bak-ai-team ]]'
printf '{"hook_event_name":"SubagentStop","agent_id":"abc","agent_type":"validator","session_id":"s1","agent_transcript_path":"/x"}' | CLAUDE_PROJECT_DIR="$P" bash "$REPO/dashboard/hook.sh"
t "hook.sh writes events.jsonl"            'grep -q "\"event\":\"SubagentStop\",\"agent_id\":\"abc\",\"agent_type\":\"validator\"" $P/.claude/ai-team/events.jsonl'
if git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1; then
  # an empty list (git ls-files failure) fails: it does not turn into a silent pass
  t "directly executed scripts have the +x bit in the git index" 'm=$(git -C "$REPO" ls-files -s -- dashboard/hook.sh templates/skills/worktree/wt.sh "scripts/*.sh" install.sh tests/run.sh) && [[ -n $m ]] && ! grep -v "^100755" <<<"$m"'
else
  echo "  skip +x bit of the scripts (no .git)"
fi
hk() { printf '%s' "$1" | CLAUDE_PROJECT_DIR="$P" bash "$REPO/dashboard/hook.sh"; }
hk '{"hook_event_name":"UserPromptExpansion","session_id":"s-eq","command_name":"team","command_args":"x","prompt":"/team x"}' > "$S/hk"
hk '{"hook_event_name":"UserPromptExpansion","session_id":"s-other","command_name":"opsx:apply","prompt":"/opsx:apply"}' >> "$S/hk"
hk '{"hook_event_name":"UserPromptExpansion","session_id":"s-onb","command_name":"onboarding","prompt":"/onboarding"}' >> "$S/hk"
t "hook: /team marks the session, no output" '[[ ! -s $S/hk ]] && has "\"event\":\"TeamStart\",\"session_id\":\"s-eq\",\"via\":\"team\"" $P/.claude/ai-team/events.jsonl && has "\"session_id\":\"s-onb\",\"via\":\"onboarding\"" $P/.claude/ai-team/events.jsonl && ! has s-other $P/.claude/ai-team/events.jsonl'
hk '{"hook_event_name":"SessionStart","session_id":"s-eq","source":"compact"}' > "$S/hk"
t "hook: compaction restates the orchestrator" 'grep -q "you are the team.s orchestrator" "$S/hk" && grep -q "Do not restart the request" "$S/hk"'
hk '{"hook_event_name":"SessionStart","session_id":"s-other","source":"compact"}' > "$S/hk"
hk '{"hook_event_name":"SessionStart","session_id":"s-eq","source":"startup"}' >> "$S/hk"
t "hook: plain session or startup: silence" '[[ ! -s $S/hk ]]'
hk '{"hook_event_name":"SessionStart","session_id":"s-ag","source":"startup","agent_type":"orchestrator"}' > "$S/hk"
hk '{"hook_event_name":"SessionStart","session_id":"s-ag","source":"compact","agent_type":"orchestrator"}' >> "$S/hk"
t "hook: --agent orchestrator marks, no reminder" '[[ ! -s $S/hk ]] && has "\"session_id\":\"s-ag\",\"via\":\"agent\"" $P/.claude/ai-team/events.jsonl'
if command -v node >/dev/null 2>&1; then
  NF="$S/notify-inst.json"
  AI_TEAM_NOTIFY_FILE="$NF" bash "$REPO/install.sh" --yes --no-skills --no-commands "$F/go-api" > "$S/out" 2>&1
  t "notifications: no config and --yes, only the hint" '[[ ! -f $NF ]] && grep -q -- "--ntfy-topic" "$S/out"'
  AI_TEAM_NOTIFY_FILE="$NF" bash "$REPO/install.sh" --yes --no-skills --no-commands --ntfy-topic ai-team-test1 "$F/go-api" > "$S/out" 2>&1
  t "notifications: --ntfy-topic creates the machine config" 'has "\"topic\": \"ai-team-test1\"" $NF && [[ $(stat -c %a $NF 2>/dev/null || stat -f %Lp $NF) == 600 ]]'
  sed -i.bak 's/"detail": true/"detail": false/' "$NF"
  AI_TEAM_NOTIFY_FILE="$NF" bash "$REPO/install.sh" --yes --no-skills --no-commands --ntfy-topic ai-team-test2 "$F/go-api" > "$S/out" 2>&1
  t "notifications: another --ntfy-topic only swaps the topic" 'has "\"topic\": \"ai-team-test2\"" $NF && has "\"detail\": false" $NF'
  AI_TEAM_NOTIFY_FILE="$NF" bash "$REPO/install.sh" --yes --no-skills --no-commands "$F/go-api" > "$S/out" 2>&1
  t "notifications: existing config, only confirms" 'grep -q "configured on this machine" "$S/out" && has ai-team-test2 $NF'
  nt dashboard "dashboard collector (node)" "collector ok"
  nt cache "incremental transcript cache (node)" "incremental reading ok"
  nt board "change board (node)" "board ok"
  nt stages "/team flow stages (node)" "stages ok"
  nt trail "change trail (node)" "trail ok"
  nt plan "session plan and question (node)" "session plan ok"
  nt ask "decisions from the dashboard (node)" "dashboard decisions ok"
  nt notify "phone notifications (node)" "notifications ok"
  nt auth "remote access with token (node)" "outside access ok"
  nt hook "hook in node (node)" "node hook ok"
  nt guard "agent guard in PreToolUse (node)" "guard ok"
  nt diff "change diff from the branch (node)" "change diff ok"
  nt md "markdown of the change artifacts (node)" "markdown ok"
  nt ui "dashboard page helpers and themes (node)" "ui helpers ok"
  nt shell "dashboard explorer and layout (node)" "shell ok"
  nt price "cost at list price (node)" "prices ok"
  nt budget "budget notice once per change (node)" "budget alerts ok"
  nt timeline "since you left (node)" "timeline ok"
  nt settings "missing hooks in settings.json (node)" "project settings ok"
  nt reply "end of turn and away mode (node)" "end of turn and away mode ok"
  nt feed "drawer conversation (node)" "conversation ok"
  nt async "background agent duration (node)" "background duration ok"
  nt declared "declared state of tasks.md (node)" "declared state ok"
  nt agentstate "agent and session states (node)" "agent and session states ok"
  nt gate "test runs in a round (node)" "test runs in a round ok"
  nt team "/team page and /api/team (node)" "team page ok"
  nt sessions "team sessions and ad-hoc tasks (node)" "team sessions and ad-hoc tasks ok"
  nt hub "hub: registry and on-demand live updates (node)" "hub: registry and on-demand real time ok"
  nt projectdirs "session folder discovery (node)" "session folder discovery ok"
  nt live "live: one computation per change (node)" "one computation per change ok"
else
  echo "  skip dashboard collector (no node)"
fi

echo
if [[ $fail -eq 0 ]]; then echo "✓ $n tests passed"; else echo "✗ $fail of $n tests failed"; exit 1; fi
