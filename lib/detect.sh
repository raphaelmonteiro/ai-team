#!/usr/bin/env bash
# ai-team — project detector.
#
# Reads the project (package.json, composer.json, pyproject, go.mod, Cargo.toml,
# Gemfile, Makefile, docker-compose, git, docs/…) and prints to stdout the
# .claude/ai-team.conf variables as KEY='value' (one per line).
#
#   lib/detect.sh [project-dir]
#
# Only reads the project; writes nothing. Compatible with bash 3.2 (macOS).
# BACKEND_GATE / FRONTEND_GATE do not come from here: install.sh derives the gate
# from the CMD_* at render time, so conf edits are reflected.
# OUTPUT_LANGUAGE is not detected either: install.sh defaults it to en.
set -euo pipefail

ROOT="$(cd "${1:-.}" && pwd)"

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

# "dep" appears as a key in a JSON (dependencies/devDependencies/require)
json_key() { grep -qF "\"$2\":" "$1" 2>/dev/null || grep -qE "\"$2\"[[:space:]]*:" "$1" 2>/dev/null; }
# value of a top-level string key ("name": "x")
json_str() { { grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$1" 2>/dev/null || true; } | head -1 | sed -E 's/^"[^"]*"[[:space:]]*:[[:space:]]*"([^"]*)"$/\1/'; }
# "scripts": { … } block of a package.json (works on one or several lines)
json_scripts_block() {
  awk '
    !on && index($0, "\"scripts\"") { on=1; $0 = substr($0, index($0, "\"scripts\"")) }
    on {
      n = split($0, ch, "")
      for (i = 1; i <= n; i++) {
        if (ch[i] == "{") depth++
        else if (ch[i] == "}") { depth--; if (depth == 0 && started) { printf "%s", substr($0, 1, i); print ""; exit } }
        if (depth > 0) started = 1
      }
      print
    }' "$1" 2>/dev/null
}
# script exists in package.json
json_script() { json_scripts_block "$1" | grep -qE "\"$2\"[[:space:]]*:"; }
# dependency in pyproject/requirements (name at line start or in quotes)
py_dep() { grep -qiE "(^|[\"' ])$2([\"' =<>~\[]|$)" "$1" 2>/dev/null; }
# target exists in a Makefile
make_target() { grep -qE "^$2[[:space:]]*:([^=]|$)" "$1" 2>/dev/null; }
# appends an item to a space-separated list (no duplicates)
add() { # var item
  local cur="${!1:-}"
  [[ -z "$2" ]] && return 0
  case " $cur " in *" $2 "*) return 0 ;; esac
  printf -v "$1" '%s' "${cur:+$cur }$2"
}
# appends a command to a slot (joined with " && ")
addcmd() { # var cmd
  local cur="${!1:-}"
  [[ -z "$2" ]] && return 0
  [[ -n "$cur" ]] && cur="$cur && "
  printf -v "$1" '%s' "$cur$2"
}
# path relative to the root
rel() { local p="${1#$ROOT}"; p="${p#/}"; printf '%s' "${p:-.}"; }

# ---------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------
git_info() { # dir -> G_TOP G_BRANCH G_DEFAULT G_REMOTE
  G_TOP="" G_BRANCH="" G_DEFAULT="" G_REMOTE=""
  command -v git >/dev/null 2>&1 || return 0
  G_TOP="$(git -C "$1" rev-parse --show-toplevel 2>/dev/null || true)"
  [[ -n "$G_TOP" ]] || return 0
  G_BRANCH="$(git -C "$1" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  [[ "$G_BRANCH" == "HEAD" ]] && G_BRANCH=""
  G_REMOTE="$(git -C "$1" remote get-url origin 2>/dev/null || true)"
  G_DEFAULT="$(git -C "$1" symbolic-ref -q --short refs/remotes/origin/HEAD 2>/dev/null || true)"
  G_DEFAULT="${G_DEFAULT#origin/}"
  if [[ -z "$G_DEFAULT" ]]; then
    for b in main master develop trunk; do
      if git -C "$1" show-ref -q --verify "refs/heads/$b" 2>/dev/null; then G_DEFAULT="$b"; break; fi
    done
  fi
  [[ -z "$G_DEFAULT" ]] && G_DEFAULT="$G_BRANCH"
  return 0
}

# ---------------------------------------------------------------------------
# detection of one package (directory with a manifest)
# ---------------------------------------------------------------------------
is_pkg() {
  local d="$1"
  [[ -f "$d/package.json" || -f "$d/composer.json" || -f "$d/pyproject.toml" || \
     -f "$d/requirements.txt" || -f "$d/go.mod" || -f "$d/Cargo.toml" || -f "$d/Gemfile" || \
     -f "$d/pom.xml" || -f "$d/build.gradle" || -f "$d/build.gradle.kts" || -f "$d/mix.exs" ]] && return 0
  ls "$d"/*.csproj "$d"/*.sln >/dev/null 2>&1
}

detect_pkg() { # dir -> P_*
  local d="$1" f run="" back="" front="" lang="" pm="" orm="" db="" test="" ts=0
  P_LANG="" P_FRAMEWORK="" P_ROLE="" P_PM="" P_STACK="" P_TEST="" P_SRC="" P_TESTDIR=""
  P_CMD_LINT="" P_CMD_FORMAT="" P_CMD_TYPECHECK="" P_CMD_TEST="" P_CMD_E2E="" P_CMD_BUILD="" P_CMD_DEV=""
  P_DOCS="" P_NAME="" P_DESC=""

  # ---- PHP ----------------------------------------------------------------
  if [[ -f "$d/composer.json" ]]; then
    f="$d/composer.json"; lang="php"
    P_NAME="$(json_str "$f" name)"; P_DESC="$(json_str "$f" description)"
    json_key "$f" "laravel/framework" && back="Laravel"
    json_key "$f" "symfony/framework-bundle" && back="Symfony"
    json_key "$f" "slim/slim" && back="Slim"
    json_key "$f" "laminas/laminas-mvc" && back="Laminas"
    json_key "$f" "cakephp/cakephp" && back="CakePHP"
    json_key "$f" "codeigniter4/framework" && back="CodeIgniter"
    json_key "$f" "doctrine/orm" && orm="Doctrine"
    [[ "$back" == "Laravel" ]] && orm="Eloquent"
    if json_key "$f" "pestphp/pest"; then test="Pest"; P_CMD_TEST="vendor/bin/pest"
    elif json_key "$f" "phpunit/phpunit"; then test="PHPUnit"; P_CMD_TEST="vendor/bin/phpunit"; fi
    [[ "$back" == "Laravel" ]] && P_CMD_TEST="php artisan test"
    json_key "$f" "laravel/pint" && P_CMD_FORMAT="vendor/bin/pint --test"
    json_key "$f" "friendsofphp/php-cs-fixer" && P_CMD_FORMAT="vendor/bin/php-cs-fixer fix --dry-run --diff"
    json_key "$f" "squizlabs/php_codesniffer" && P_CMD_LINT="vendor/bin/phpcs"
    { json_key "$f" "phpstan/phpstan" || json_key "$f" "larastan/larastan" || json_key "$f" "nunomaduro/larastan"; } && P_CMD_TYPECHECK="vendor/bin/phpstan analyse"
    json_key "$f" "vimeo/psalm" && P_CMD_TYPECHECK="vendor/bin/psalm"
    pm="composer"
  fi

  # ---- Python -------------------------------------------------------------
  if [[ -f "$d/pyproject.toml" || -f "$d/requirements.txt" || -f "$d/Pipfile" ]]; then
    lang="python"
    local deps=""
    [[ -f "$d/pyproject.toml" ]] && deps="$deps $d/pyproject.toml"
    [[ -f "$d/requirements.txt" ]] && deps="$deps $d/requirements.txt"
    [[ -f "$d/requirements-dev.txt" ]] && deps="$deps $d/requirements-dev.txt"
    [[ -f "$d/Pipfile" ]] && deps="$deps $d/Pipfile"
    [[ -f "$d/pyproject.toml" && -z "$P_NAME" ]] && P_NAME="$(sed -nE 's/^name[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/p' "$d/pyproject.toml" | head -1)"
    [[ -f "$d/pyproject.toml" && -z "$P_DESC" ]] && P_DESC="$(sed -nE 's/^description[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/p' "$d/pyproject.toml" | head -1)"
    if [[ -f "$d/uv.lock" ]]; then pm="uv"; run="uv run "
    elif [[ -f "$d/poetry.lock" ]] || grep -q '\[tool.poetry\]' "$d/pyproject.toml" 2>/dev/null; then pm="poetry"; run="poetry run "
    elif [[ -f "$d/Pipfile" ]]; then pm="pipenv"; run="pipenv run "
    elif [[ -f "$d/pdm.lock" ]]; then pm="pdm"; run="pdm run "
    else pm="pip"; fi
    local pd
    for pd in $deps; do
      py_dep "$pd" fastapi && back="FastAPI"
      py_dep "$pd" django && back="Django"
      py_dep "$pd" flask && back="Flask"
      py_dep "$pd" litestar && back="Litestar"
      py_dep "$pd" starlette && [[ -z "$back" ]] && back="Starlette"
      py_dep "$pd" sqlalchemy && orm="SQLAlchemy"
      py_dep "$pd" tortoise-orm && orm="Tortoise"
      py_dep "$pd" sqlmodel && orm="SQLModel"
      py_dep "$pd" psycopg && db="PostgreSQL"
      py_dep "$pd" asyncpg && db="PostgreSQL"
      py_dep "$pd" pymysql && db="MySQL"
      py_dep "$pd" pymongo && db="MongoDB"
      py_dep "$pd" pytest && { test="pytest"; P_CMD_TEST="${run}pytest"; }
      py_dep "$pd" ruff && { P_CMD_LINT="${run}ruff check ."; P_CMD_FORMAT="${run}ruff format --check ."; }
      py_dep "$pd" flake8 && [[ -z "$P_CMD_LINT" ]] && P_CMD_LINT="${run}flake8"
      py_dep "$pd" black && P_CMD_FORMAT="${run}black --check ."
      py_dep "$pd" mypy && P_CMD_TYPECHECK="${run}mypy ."
      py_dep "$pd" pyright && P_CMD_TYPECHECK="${run}pyright"
    done
    [[ "$back" == "Django" && -z "$orm" ]] && orm="Django ORM"
    [[ -z "$P_CMD_TEST" && -n "$back" ]] && P_CMD_TEST="${run}pytest"
    [[ "$back" == "Django" ]] && P_CMD_DEV="${run}python manage.py runserver"
  fi

  # ---- Go -----------------------------------------------------------------
  if [[ -f "$d/go.mod" ]]; then
    f="$d/go.mod"; lang="go"; pm="go modules"
    [[ -z "$P_NAME" ]] && P_NAME="$(sed -nE 's#^module[[:space:]]+.*/([^/]+)$#\1#p; s#^module[[:space:]]+([^/]+)$#\1#p' "$f" | head -1)"
    grep -q 'gin-gonic/gin' "$f" && back="Gin"
    grep -q 'labstack/echo' "$f" && back="Echo"
    grep -q 'gofiber/fiber' "$f" && back="Fiber"
    grep -q 'go-chi/chi' "$f" && back="Chi"
    grep -q 'gorilla/mux' "$f" && back="Gorilla"
    [[ -z "$back" ]] && back="Go (net/http)"
    grep -q 'gorm.io/gorm' "$f" && orm="GORM"
    grep -q 'ent/ent' "$f" && orm="Ent"
    grep -q 'sqlc' "$f" && orm="sqlc"
    grep -q 'jackc/pgx' "$f" && db="PostgreSQL"
    grep -q 'lib/pq' "$f" && db="PostgreSQL"
    grep -q 'go-sql-driver/mysql' "$f" && db="MySQL"
    test="go test"; P_CMD_TEST="go test ./..."; P_CMD_BUILD="go build ./..."; P_CMD_LINT="go vet ./..."
    [[ -f "$d/.golangci.yml" || -f "$d/.golangci.yaml" || -f "$d/.golangci.toml" ]] && P_CMD_LINT="golangci-lint run"
    P_CMD_FORMAT="test -z \"\$(gofmt -l .)\""
  fi

  # ---- Rust ---------------------------------------------------------------
  if [[ -f "$d/Cargo.toml" ]]; then
    f="$d/Cargo.toml"; lang="rust"; pm="cargo"
    [[ -z "$P_NAME" ]] && P_NAME="$(sed -nE 's/^name[[:space:]]*=[[:space:]]*"([^"]*)".*/\1/p' "$f" | head -1)"
    grep -qE '^axum' "$f" && back="Axum"
    grep -qE '^actix-web' "$f" && back="Actix Web"
    grep -qE '^rocket' "$f" && back="Rocket"
    grep -qE '^warp' "$f" && back="Warp"
    grep -qE '^(sqlx|diesel|sea-orm)' "$f" && orm="$(grep -oE '^(sqlx|diesel|sea-orm)' "$f" | head -1)"
    test="cargo test"; P_CMD_TEST="cargo test"; P_CMD_BUILD="cargo build"
    P_CMD_LINT="cargo clippy -- -D warnings"; P_CMD_FORMAT="cargo fmt --check"
  fi

  # ---- Ruby ---------------------------------------------------------------
  if [[ -f "$d/Gemfile" ]]; then
    f="$d/Gemfile"; lang="ruby"; pm="bundler"; run="bundle exec "
    grep -qE "gem ['\"]rails['\"]" "$f" && { back="Rails"; orm="ActiveRecord"; }
    grep -qE "gem ['\"]sinatra['\"]" "$f" && back="Sinatra"
    grep -qE "gem ['\"]hanami['\"]" "$f" && back="Hanami"
    grep -qE "gem ['\"]pg['\"]" "$f" && db="PostgreSQL"
    grep -qE "gem ['\"]mysql2['\"]" "$f" && db="MySQL"
    if grep -qE "gem ['\"]rspec" "$f"; then test="RSpec"; P_CMD_TEST="${run}rspec"
    elif [[ "$back" == "Rails" ]]; then test="Minitest"; P_CMD_TEST="${run}rails test"; fi
    grep -qE "gem ['\"]rubocop" "$f" && P_CMD_LINT="${run}rubocop"
    grep -qE "gem ['\"]sorbet" "$f" && P_CMD_TYPECHECK="${run}srb tc"
  fi

  # ---- JVM ----------------------------------------------------------------
  if [[ -f "$d/pom.xml" ]]; then
    lang="java"; pm="maven"
    grep -q 'spring-boot' "$d/pom.xml" && back="Spring Boot"
    grep -q 'quarkus' "$d/pom.xml" && back="Quarkus"
    grep -q 'kotlin' "$d/pom.xml" && lang="kotlin"
    test="JUnit"; P_CMD_TEST="mvn -q test"; P_CMD_BUILD="mvn -q -DskipTests package"
  elif [[ -f "$d/build.gradle" || -f "$d/build.gradle.kts" ]]; then
    lang="java"; pm="gradle"
    [[ -f "$d/build.gradle.kts" ]] && lang="kotlin"
    cat "$d"/build.gradle* 2>/dev/null | grep -q 'spring-boot' && back="Spring Boot"
    cat "$d"/build.gradle* 2>/dev/null | grep -q 'ktor' && back="Ktor"
    local gw="./gradlew"; [[ -x "$d/gradlew" ]] || gw="gradle"
    test="JUnit"; P_CMD_TEST="$gw test"; P_CMD_BUILD="$gw build -x test"
  fi

  # ---- .NET ---------------------------------------------------------------
  if ls "$d"/*.csproj "$d"/*.sln >/dev/null 2>&1; then
    lang="csharp"; pm="dotnet"; back="${back:-ASP.NET}"
    test="xUnit/NUnit"; P_CMD_TEST="dotnet test"; P_CMD_BUILD="dotnet build"
    P_CMD_FORMAT="dotnet format --verify-no-changes"
  fi

  # ---- Elixir -------------------------------------------------------------
  if [[ -f "$d/mix.exs" ]]; then
    lang="elixir"; pm="mix"
    grep -q ':phoenix' "$d/mix.exs" && back="Phoenix"
    grep -q ':ecto' "$d/mix.exs" && orm="Ecto"
    test="ExUnit"; P_CMD_TEST="mix test"; P_CMD_FORMAT="mix format --check-formatted"
    grep -q ':credo' "$d/mix.exs" && P_CMD_LINT="mix credo"
    grep -q ':dialyxir' "$d/mix.exs" && P_CMD_TYPECHECK="mix dialyzer"
  fi

  # ---- Node ---------------------------------------------------------------
  if [[ -f "$d/package.json" ]]; then
    f="$d/package.json"
    [[ -z "$P_NAME" ]] && P_NAME="$(json_str "$f" name)"
    [[ -z "$P_DESC" ]] && P_DESC="$(json_str "$f" description)"
    local npm="" nrun="" nexec="" ld
    for ld in "$d" "$ROOT"; do   # the package's lockfile or, in a workspace, the root's
      if [[ -f "$ld/pnpm-lock.yaml" ]]; then npm="pnpm"
      elif [[ -f "$ld/bun.lockb" || -f "$ld/bun.lock" ]]; then npm="bun"
      elif [[ -f "$ld/yarn.lock" ]]; then npm="yarn"
      elif [[ -f "$ld/deno.lock" || -f "$ld/deno.json" ]]; then npm="deno"
      elif [[ -f "$ld/package-lock.json" ]]; then npm="npm"; fi
      [[ -n "$npm" ]] && break
    done
    local pmf; pmf="$(json_str "$f" packageManager)"
    [[ -z "$pmf" && -f "$ROOT/package.json" ]] && pmf="$(json_str "$ROOT/package.json" packageManager)"
    case "$pmf" in pnpm@*) npm="pnpm" ;; yarn@*) npm="yarn" ;; bun@*) npm="bun" ;; npm@*) npm="npm" ;; esac
    [[ -z "$npm" ]] && npm="npm"
    case "$npm" in
      pnpm) nrun="pnpm "; nexec="pnpm exec" ;;
      yarn) nrun="yarn "; nexec="yarn" ;;
      bun)  nrun="bun run "; nexec="bunx" ;;
      deno) nrun="deno task "; nexec="deno run -A npm:" ;;
      *)    nrun="npm run "; nexec="npx" ;;
    esac
    [[ -z "$lang" ]] && lang="javascript"
    { [[ -f "$d/tsconfig.json" ]] || json_key "$f" typescript; } && { ts=1; [[ "$lang" == "javascript" ]] && lang="typescript"; }
    [[ -z "$pm" || "$lang" == "typescript" || "$lang" == "javascript" ]] && pm="$npm"
    # backend
    json_key "$f" "@nestjs/core" && back="NestJS"
    json_key "$f" "@adonisjs/core" && back="AdonisJS"
    json_key "$f" "hono" && [[ -z "$back" ]] && back="Hono"
    json_key "$f" "fastify" && [[ -z "$back" ]] && back="Fastify"
    json_key "$f" "koa" && [[ -z "$back" ]] && back="Koa"
    json_key "$f" "express" && [[ -z "$back" ]] && back="Express"
    json_key "$f" "@hapi/hapi" && [[ -z "$back" ]] && back="hapi"
    [[ "$back" == "NestJS" ]] && json_key "$f" "@nestjs/platform-fastify" && back="NestJS/Fastify"
    [[ "$back" == "NestJS" ]] && json_key "$f" "@nestjs/platform-express" && back="NestJS/Express"
    # frontend / meta-frameworks
    json_key "$f" "next" && front="Next.js"
    json_key "$f" "nuxt" && front="Nuxt"
    json_key "$f" "@remix-run/react" && front="Remix"
    json_key "$f" "@sveltejs/kit" && front="SvelteKit"
    json_key "$f" "astro" && front="Astro"
    json_key "$f" "@tanstack/react-start" && front="TanStack Start"
    json_key "$f" "@tanstack/start" && front="TanStack Start"
    if [[ -z "$front" ]]; then
      json_key "$f" "@angular/core" && front="Angular"
      json_key "$f" "vue" && front="Vue"
      json_key "$f" "svelte" && front="Svelte"
      json_key "$f" "solid-js" && front="Solid"
      json_key "$f" "react" && front="React"
      json_key "$f" "@inertiajs/react" && front="Inertia/React"
      json_key "$f" "@inertiajs/vue3" && front="Inertia/Vue"
    fi
    local extras=""
    json_key "$f" "vite" && extras="$extras Vite"
    json_key "$f" "@tanstack/react-query" && extras="$extras TanStack Query"
    json_key "$f" "@tanstack/react-router" && extras="$extras TanStack Router"
    json_key "$f" "zustand" && extras="$extras Zustand"
    json_key "$f" "@reduxjs/toolkit" && extras="$extras Redux Toolkit"
    json_key "$f" "pinia" && extras="$extras Pinia"
    json_key "$f" "tailwindcss" && extras="$extras Tailwind"
    json_key "$f" "zod" && extras="$extras Zod"
    [[ -n "$front" && -n "$extras" ]] && front="$front (${extras# })"
    # orm / db
    json_key "$f" "prisma" && orm="Prisma"
    json_key "$f" "@prisma/client" && orm="Prisma"
    json_key "$f" "typeorm" && orm="TypeORM"
    json_key "$f" "drizzle-orm" && orm="Drizzle"
    json_key "$f" "mongoose" && orm="Mongoose"
    json_key "$f" "sequelize" && orm="Sequelize"
    json_key "$f" "@mikro-orm/core" && orm="MikroORM"
    json_key "$f" "knex" && [[ -z "$orm" ]] && orm="Knex"
    json_key "$f" "pg" && db="PostgreSQL"
    json_key "$f" "mysql2" && db="MySQL"
    json_key "$f" "mongodb" && db="MongoDB"
    { json_key "$f" "better-sqlite3" || json_key "$f" "sqlite3"; } && db="SQLite"
    { json_key "$f" "ioredis" || json_key "$f" "redis"; } && db="${db:+$db + }Redis"
    # tests
    json_key "$f" "vitest" && test="Vitest"
    json_key "$f" "jest" && test="Jest"
    json_key "$f" "mocha" && test="Mocha"
    json_key "$f" "supertest" && test="${test:+$test + }Supertest"
    json_key "$f" "@playwright/test" && test="${test:+$test + }Playwright"
    json_key "$f" "cypress" && test="${test:+$test + }Cypress"
    # scripts → commands (the package Makefile wins; see below)
    local s
    # shellcheck disable=SC2043  # one-item list, same shape as the others
    for s in lint; do json_script "$f" "$s" && addcmd P_CMD_LINT "${nrun}$s"; done
    for s in format:check prettier:check format-check check-format; do json_script "$f" "$s" && { addcmd P_CMD_FORMAT "${nrun}$s"; break; }; done
    [[ -z "$P_CMD_FORMAT" ]] && json_key "$f" "prettier" && addcmd P_CMD_FORMAT "$nexec prettier --check ."
    for s in typecheck type-check tsc check-types types; do json_script "$f" "$s" && { addcmd P_CMD_TYPECHECK "${nrun}$s"; break; }; done
    [[ -z "$P_CMD_TYPECHECK" && $ts -eq 1 ]] && addcmd P_CMD_TYPECHECK "$nexec tsc --noEmit"
    for s in test:unit test; do json_script "$f" "$s" && { addcmd P_CMD_TEST "${nrun}$s"; break; }; done
    for s in test:e2e e2e test:integration; do json_script "$f" "$s" && { addcmd P_CMD_E2E "${nrun}$s"; break; }; done
    json_script "$f" build && addcmd P_CMD_BUILD "${nrun}build"
    for s in dev start:dev serve start; do json_script "$f" "$s" && { P_CMD_DEV="${nrun}$s"; break; }; done
    json_key "$f" "@biomejs/biome" && [[ -z "$P_CMD_LINT" ]] && addcmd P_CMD_LINT "$nexec biome check ."
  fi

  # ---- package Makefile: a known target wins over the script ---------------
  if [[ -f "$d/Makefile" ]]; then
    local mf="$d/Makefile" t
    # shellcheck disable=SC2043
    for t in lint; do make_target "$mf" "$t" && P_CMD_LINT="make $t"; done
    for t in format-check fmt-check check-format format; do make_target "$mf" "$t" && { P_CMD_FORMAT="make $t"; break; }; done
    for t in typecheck type-check types; do make_target "$mf" "$t" && { P_CMD_TYPECHECK="make $t"; break; }; done
    for t in test-unit test; do make_target "$mf" "$t" && { P_CMD_TEST="make $t"; break; }; done
    for t in test-e2e e2e test-integration; do make_target "$mf" "$t" && { P_CMD_E2E="make $t"; break; }; done
    for t in build-app build; do make_target "$mf" "$t" && { P_CMD_BUILD="make $t"; break; }; done
    for t in dev up run serve; do make_target "$mf" "$t" && { P_CMD_DEV="make $t"; break; }; done
  fi

  # ---- role ----------------------------------------------------------------
  if [[ -n "$back" && -n "$front" ]]; then P_ROLE="fullstack"
  elif [[ -n "$back" ]]; then P_ROLE="backend"
  elif [[ -n "$front" ]]; then P_ROLE="frontend"
  elif [[ -n "$lang" ]]; then P_ROLE="app"
  fi
  case "$(lower "$(basename "$d")")" in
    backend|api|server|service*) [[ "$P_ROLE" == "app" ]] && P_ROLE="backend" ;;
    frontend|web|client|app|ui|site) [[ "$P_ROLE" == "app" ]] && P_ROLE="frontend" ;;
  esac
  P_LANG="$lang"; P_PM="$pm"; P_TEST="$test"
  P_FRAMEWORK="${back:-}${back:+${front:+ + }}${front:-}"
  P_STACK="$P_FRAMEWORK"
  [[ -n "$orm" ]] && P_STACK="$P_STACK, $orm"
  [[ -n "$db" ]] && P_STACK="$P_STACK, $db"
  [[ -n "$lang" ]] && P_STACK="$P_STACK, $lang"
  [[ -n "$test" ]] && P_STACK="$P_STACK, $test"
  [[ -n "$pm" ]] && P_STACK="$P_STACK, $pm"
  P_STACK="${P_STACK#, }"

  # ---- folders -------------------------------------------------------------
  local sd
  for sd in src app lib internal cmd; do [[ -d "$d/$sd" ]] && { P_SRC="$sd"; break; }; done
  for sd in test tests spec __tests__ e2e; do [[ -d "$d/$sd" ]] && add P_TESTDIR "$sd"; done

  # ---- package docs ----------------------------------------------------------
  local df
  P_DOCS_CONTEXT="" P_DOCS_STANDARDS="" P_DOCS_ENV="" P_DOCS_ARCH="" P_DOCS_OTHER=""
  for df in README.md CLAUDE.md AGENTS.md CONTRIBUTING.md; do [[ -f "$d/$df" ]] && { add P_DOCS "$df"; classify_doc P_DOCS "$df"; }; done
  if [[ -d "$d/docs" && "$d" != "$ROOT" ]]; then
    while IFS= read -r df; do add P_DOCS "${df#$d/}"; classify_doc P_DOCS "${df#$d/}"; done < <(find "$d/docs" -maxdepth 1 -name '*.md' 2>/dev/null | sort | head -20)
  fi
}

# classifies a doc by name: PREFIX_CONTEXT | _STANDARDS | _ENV | _ARCH | _OTHER
# (English names and the pt-BR ones older projects use: standards/padroes, environment/ambiente,
# architecture/arquitetura, …)
classify_doc() { # PREFIX relative-path
  local P="$1" f="$2" n; n="$(lower "$(basename "$f")")"
  case "$n" in
    claude.md|agents.md|.cursorrules|copilot-instructions.md) add "${P}_CONTEXT" "$f" ;;
    readme.md) add "${P}_OTHER" "$f" ;;
    *padroes*|*padrões*|*standard*|*convention*|*convencoes*|*convenções*|*style*|*guideline*|contributing.md|*boas-praticas*) add "${P}_STANDARDS" "$f" ;;
    *ambiente*|*environment*|*setup*|*getting-started*|development.md|*instalac*|*install*|*local-dev*|*modo-*) add "${P}_ENV" "$f" ;;
    *arquitetura*|*architecture*|adr*|*decis*) add "${P}_ARCH" "$f" ;;
    *) add "${P}_OTHER" "$f" ;;
  esac
}

# ---------------------------------------------------------------------------
# 1. candidate packages
# ---------------------------------------------------------------------------
PKGS=""
is_pkg "$ROOT" && add PKGS "$ROOT"
for sub in "$ROOT"/* "$ROOT"/apps/* "$ROOT"/packages/* "$ROOT"/services/*; do
  [[ -d "$sub" ]] || continue
  case "$(basename "$sub")" in node_modules|vendor|dist|build|.git|.claude|openspec|docs|target|__pycache__|coverage|tmp) continue ;; esac
  is_pkg "$sub" && add PKGS "$sub"
done

# the root is just a "workspace" (monorepo) when it has workspaces or only sub-packages
ROOT_IS_WS=0
if [[ -f "$ROOT/package.json" ]] && json_key "$ROOT/package.json" workspaces; then ROOT_IS_WS=1; fi
[[ -f "$ROOT/pnpm-workspace.yaml" || -f "$ROOT/lerna.json" || -f "$ROOT/nx.json" || -f "$ROOT/turbo.json" ]] && ROOT_IS_WS=1

BACKEND_DIR="" FRONTEND_DIR="" OTHER_PKGS="" PROJECT_NAME="" PROJECT_DESCRIPTION=""
ROOT_ROLE=""
for p in $PKGS; do
  detect_pkg "$p"
  r="$(rel "$p")"
  [[ "$p" == "$ROOT" ]] && { ROOT_ROLE="$P_ROLE"; PROJECT_NAME="${PROJECT_NAME:-$P_NAME}"; PROJECT_DESCRIPTION="${PROJECT_DESCRIPTION:-$P_DESC}"; }
  [[ "$p" == "$ROOT" && $ROOT_IS_WS -eq 1 && -z "$P_FRAMEWORK" ]] && continue
  case "$P_ROLE" in
    backend)   [[ -z "$BACKEND_DIR" ]] && BACKEND_DIR="$r" || add OTHER_PKGS "$r" ;;
    frontend)  [[ -z "$FRONTEND_DIR" ]] && FRONTEND_DIR="$r" || add OTHER_PKGS "$r" ;;
    fullstack) [[ -z "$BACKEND_DIR" ]] && BACKEND_DIR="$r"; [[ -z "$FRONTEND_DIR" ]] && FRONTEND_DIR="$r" ;;
    app)       [[ -z "$BACKEND_DIR" ]] && BACKEND_DIR="$r" || add OTHER_PKGS "$r" ;;
  esac
done
# a root "app" package without a framework must not mask a real backend/
if [[ -n "$BACKEND_DIR" && "$BACKEND_DIR" == "." && "$ROOT_ROLE" == "app" ]]; then
  for p in $OTHER_PKGS; do
    detect_pkg "$ROOT/$p"
    if [[ "$P_ROLE" == "backend" ]]; then
      OTHER_PKGS="${OTHER_PKGS/$p/.}"; BACKEND_DIR="$p"; break
    fi
  done
fi

# a meta-framework alone (Next, Nuxt, Remix…) serves backend and frontend
if [[ -z "$BACKEND_DIR" && -n "$FRONTEND_DIR" ]]; then
  detect_pkg "$ROOT/$FRONTEND_DIR"
  case "$P_FRAMEWORK" in Next.js*|Nuxt*|Remix*|SvelteKit*|Astro*|"TanStack Start"*) BACKEND_DIR="$FRONTEND_DIR" ;; esac
fi

LAYOUT="single"
[[ -n "$BACKEND_DIR" && -n "$FRONTEND_DIR" && "$BACKEND_DIR" != "$FRONTEND_DIR" ]] && LAYOUT="monorepo"
[[ $ROOT_IS_WS -eq 1 ]] && LAYOUT="monorepo"

# ---------------------------------------------------------------------------
# 2. root git
# ---------------------------------------------------------------------------
git_info "$ROOT"
ROOT_TOP="$G_TOP"
GIT_DEFAULT_BRANCH="$G_DEFAULT"; GIT_WORK_BRANCH="${G_BRANCH:-$G_DEFAULT}"; GIT_REMOTE="$G_REMOTE"
GIT_PROTECTED_BRANCHES=""
[[ -n "$GIT_DEFAULT_BRANCH" && "$GIT_WORK_BRANCH" != "$GIT_DEFAULT_BRANCH" ]] && GIT_PROTECTED_BRANCHES="$GIT_DEFAULT_BRANCH"

# ---------------------------------------------------------------------------
# 3. variables per front (backend / frontend)
# ---------------------------------------------------------------------------
emit_side() { # PREFIX dir
  local P="$1" d="$2" abs
  if [[ -z "$d" ]]; then
    printf -v "HAS_$P" '%s' 0
    printf -v "${P}_DIR" '%s' ""
    return 0
  fi
  abs="$ROOT/$d"; [[ "$d" == "." ]] && abs="$ROOT"
  detect_pkg "$abs"
  printf -v "HAS_$P" '%s' 1
  printf -v "${P}_DIR" '%s' "$d"
  printf -v "${P}_LANG" '%s' "$P_LANG"
  printf -v "${P}_FRAMEWORK" '%s' "$P_FRAMEWORK"
  printf -v "${P}_STACK" '%s' "$P_STACK"
  printf -v "${P}_PKG_MANAGER" '%s' "$P_PM"
  printf -v "${P}_TEST_RUNNER" '%s' "$P_TEST"
  printf -v "${P}_SRC_DIR" '%s' "$P_SRC"
  printf -v "${P}_TEST_DIR" '%s' "$P_TESTDIR"
  printf -v "${P}_CMD_LINT" '%s' "$P_CMD_LINT"
  printf -v "${P}_CMD_FORMAT" '%s' "$P_CMD_FORMAT"
  printf -v "${P}_CMD_TYPECHECK" '%s' "$P_CMD_TYPECHECK"
  printf -v "${P}_CMD_TEST" '%s' "$P_CMD_TEST"
  printf -v "${P}_CMD_E2E" '%s' "$P_CMD_E2E"
  printf -v "${P}_CMD_BUILD" '%s' "$P_CMD_BUILD"
  printf -v "${P}_CMD_DEV" '%s' "$P_CMD_DEV"
  printf -v "${P}_DOCS" '%s' "$P_DOCS"
  printf -v "${P}_DOCS_CONTEXT" '%s' "$P_DOCS_CONTEXT"
  printf -v "${P}_DOCS_STANDARDS" '%s' "$P_DOCS_STANDARDS"
  printf -v "${P}_DOCS_ENV" '%s' "$P_DOCS_ENV"
  printf -v "${P}_DOCS_ARCH" '%s' "$P_DOCS_ARCH"
  # does the package have its own git?
  git_info "$abs"
  local wb db
  if [[ -n "$G_TOP" && "$G_TOP" != "$ROOT_TOP" ]]; then
    printf -v "${P}_OWN_REPO" '%s' 1
    wb="${G_BRANCH:-$G_DEFAULT}"; db="$G_DEFAULT"
  else
    printf -v "${P}_OWN_REPO" '%s' 0
    wb="$GIT_WORK_BRANCH"; db="$GIT_DEFAULT_BRANCH"
  fi
  printf -v "${P}_BRANCH" '%s' "$wb"
  printf -v "${P}_DEFAULT_BRANCH" '%s' "$db"
  # protected branch: the repo default, when work happens on another one
  if [[ -n "$db" && "$wb" != "$db" ]]; then printf -v "${P}_PROTECTED_BRANCH" '%s' "$db"
  else printf -v "${P}_PROTECTED_BRANCH" '%s' ""; fi
}
emit_side BACKEND "$BACKEND_DIR"
emit_side FRONTEND "$FRONTEND_DIR"
SAME_DIR=0; [[ -n "$BACKEND_DIR" && "$BACKEND_DIR" == "$FRONTEND_DIR" ]] && SAME_DIR=1

# ---------------------------------------------------------------------------
# 4. name and description
# ---------------------------------------------------------------------------
[[ -z "$PROJECT_NAME" ]] && PROJECT_NAME="$(basename "$ROOT")"
PROJECT_NAME="${PROJECT_NAME##*/}"   # "@org/name" → "name"
if [[ -z "$PROJECT_DESCRIPTION" && -f "$ROOT/README.md" ]]; then
  PROJECT_DESCRIPTION="$(awk '
    /^#/ { seen=1; next }
    seen && NF && $0 !~ /^[\[!<`|>-]/ && $0 !~ /^[[:space:]]*$/ { print; exit }
  ' "$ROOT/README.md" | cut -c1-240)"
fi

# ---------------------------------------------------------------------------
# 5. root docs
# ---------------------------------------------------------------------------
DOCS_CONTEXT="" DOCS_STANDARDS="" DOCS_ENV="" DOCS_ARCH="" DOCS_OTHER="" DOCS_README=""
[[ -f "$ROOT/README.md" ]] && DOCS_README="README.md"
for f in CLAUDE.md AGENTS.md CONTRIBUTING.md ARCHITECTURE.md DEVELOPMENT.md; do
  [[ -f "$ROOT/$f" ]] && classify_doc DOCS "$f"
done
[[ -f "$ROOT/.github/copilot-instructions.md" ]] && classify_doc DOCS ".github/copilot-instructions.md"
for dd in docs doc documentation; do
  [[ -d "$ROOT/$dd" ]] || continue
  while IFS= read -r f; do classify_doc DOCS "${f#$ROOT/}"; done < <(find "$ROOT/$dd" -maxdepth 2 -name '*.md' -not -path '*/node_modules/*' 2>/dev/null | sort | head -40)
done
# caps "other" so the context does not bloat
DOCS_OTHER="$(printf '%s\n' $DOCS_OTHER | head -15 | tr '\n' ' ')"; DOCS_OTHER="${DOCS_OTHER% }"

# ---------------------------------------------------------------------------
# 6. infra
# ---------------------------------------------------------------------------
DOCKER_COMPOSE_FILE="" DOCKERFILES="" HAS_MAKEFILE=0 MAKE_TARGETS="" CI="" HAS_DOCKER=0
for c in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
  [[ -f "$ROOT/$c" ]] && { DOCKER_COMPOSE_FILE="$c"; break; }
done
for d in "$BACKEND_DIR" "$FRONTEND_DIR"; do
  [[ -n "$d" && "$d" != "." && -z "$DOCKER_COMPOSE_FILE" ]] || continue
  for c in docker-compose.yml docker-compose.yaml compose.yml compose.yaml; do
    [[ -f "$ROOT/$d/$c" ]] && { DOCKER_COMPOSE_FILE="$d/$c"; break 2; }
  done
done
while IFS= read -r f; do add DOCKERFILES "${f#$ROOT/}"; done < <(find "$ROOT" -maxdepth 3 -name 'Dockerfile*' -not -path '*/node_modules/*' -not -path '*/vendor/*' 2>/dev/null | sort | head -10)
[[ -n "$DOCKER_COMPOSE_FILE" || -n "$DOCKERFILES" ]] && HAS_DOCKER=1
if [[ -f "$ROOT/Makefile" ]]; then
  HAS_MAKEFILE=1
  MAKE_TARGETS="$(grep -oE '^[a-zA-Z0-9_-]+[[:space:]]*:([^=]|$)' "$ROOT/Makefile" | sed -E 's/[[:space:]]*:.*//' | grep -vE '^\.' | sort -u | head -30 | tr '\n' ' ')"
  MAKE_TARGETS="${MAKE_TARGETS% }"
fi
[[ -d "$ROOT/.github/workflows" ]] && add CI "github-actions"
[[ -f "$ROOT/.gitlab-ci.yml" ]] && add CI "gitlab-ci"
[[ -f "$ROOT/bitbucket-pipelines.yml" ]] && add CI "bitbucket"
[[ -d "$ROOT/.circleci" ]] && add CI "circleci"
[[ -f "$ROOT/Jenkinsfile" ]] && add CI "jenkins"
[[ -f "$ROOT/.pre-commit-config.yaml" ]] && add CI "pre-commit"
[[ -d "$ROOT/.husky" ]] && add CI "husky"

# ---------------------------------------------------------------------------
# 7. OpenSpec
# ---------------------------------------------------------------------------
HAS_OPENSPEC=0 OPENSPEC_CLI=0
[[ -d "$ROOT/openspec" ]] && HAS_OPENSPEC=1
command -v openspec >/dev/null 2>&1 && OPENSPEC_CLI=1

# ---------------------------------------------------------------------------
# 8. output
# ---------------------------------------------------------------------------
q() { # KEY  → KEY='value' (single quotes escaped)
  local v="${!1:-}"
  printf "%s='%s'\n" "$1" "${v//\'/\'\\\'\'}"
}
for k in \
  PROJECT_NAME PROJECT_DESCRIPTION LAYOUT SAME_DIR OTHER_PKGS \
  GIT_DEFAULT_BRANCH GIT_WORK_BRANCH GIT_PROTECTED_BRANCHES GIT_REMOTE \
  HAS_BACKEND BACKEND_DIR BACKEND_LANG BACKEND_FRAMEWORK BACKEND_STACK BACKEND_PKG_MANAGER \
  BACKEND_TEST_RUNNER BACKEND_SRC_DIR BACKEND_TEST_DIR BACKEND_OWN_REPO BACKEND_BRANCH BACKEND_DEFAULT_BRANCH BACKEND_PROTECTED_BRANCH \
  BACKEND_CMD_LINT BACKEND_CMD_FORMAT BACKEND_CMD_TYPECHECK BACKEND_CMD_TEST BACKEND_CMD_E2E BACKEND_CMD_BUILD BACKEND_CMD_DEV \
  BACKEND_DOCS BACKEND_DOCS_CONTEXT BACKEND_DOCS_STANDARDS BACKEND_DOCS_ENV BACKEND_DOCS_ARCH \
  HAS_FRONTEND FRONTEND_DIR FRONTEND_LANG FRONTEND_FRAMEWORK FRONTEND_STACK FRONTEND_PKG_MANAGER \
  FRONTEND_TEST_RUNNER FRONTEND_SRC_DIR FRONTEND_TEST_DIR FRONTEND_OWN_REPO FRONTEND_BRANCH FRONTEND_DEFAULT_BRANCH FRONTEND_PROTECTED_BRANCH \
  FRONTEND_CMD_LINT FRONTEND_CMD_FORMAT FRONTEND_CMD_TYPECHECK FRONTEND_CMD_TEST FRONTEND_CMD_E2E FRONTEND_CMD_BUILD FRONTEND_CMD_DEV \
  FRONTEND_DOCS FRONTEND_DOCS_CONTEXT FRONTEND_DOCS_STANDARDS FRONTEND_DOCS_ENV FRONTEND_DOCS_ARCH \
  DOCS_README DOCS_CONTEXT DOCS_STANDARDS DOCS_ENV DOCS_ARCH DOCS_OTHER \
  HAS_DOCKER DOCKER_COMPOSE_FILE DOCKERFILES HAS_MAKEFILE MAKE_TARGETS CI \
  HAS_OPENSPEC OPENSPEC_CLI
do q "$k"; done
