#!/usr/bin/env bash
# Cria projetos de exemplo para testar o detector e o instalador.
#   tests/fixtures.sh <dir-destino>
set -euo pipefail
S="${1:?uso: tests/fixtures.sh <dir>}"
rm -rf "$S"; mkdir -p "$S"
gi() { git -C "$1" init -q -b "${2:-main}" && git -C "$1" add -A && git -C "$1" -c user.email=t@t -c user.name=t commit -qm init; }

# --- monorepo com backend e frontend em repos git próprios (backend e frontend separados)
P="$S/monorepo-nested-git"; mkdir -p "$P/backend/src" "$P/backend/test/unit" "$P/backend/docs" "$P/frontend/src" "$P/docs/resumos" "$P/openspec/changes"
printf '# Atlas\nWorkspace.\n' > "$P/CLAUDE.md"
printf '# Atlas\n\nPlataforma de planejamento com backend NestJS e frontend React.\n' > "$P/README.md"
echo "# ambiente" > "$P/docs/ambiente.md"; echo "# plano" > "$P/docs/resumos/plano-desenvolvimento-backend.md"; echo "# arq" > "$P/docs/arquitetura.md"
echo "# padroes" > "$P/backend/docs/padroes.md"; echo "# agents" > "$P/backend/AGENTS.md"
cat > "$P/backend/package.json" <<'EOF'
{
  "name": "atlas-backend",
  "description": "API do Atlas",
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "build": "nest build",
    "lint": "eslint .",
    "test": "jest",
    "test:e2e": "jest --config test/jest-e2e.json",
    "start:dev": "nest start --watch"
  },
  "dependencies": { "@nestjs/core": "^12", "@nestjs/platform-express": "^12", "@prisma/client": "^7", "pg": "^8" },
  "devDependencies": { "jest": "^30", "supertest": "^7", "typescript": "^5", "prettier": "^3", "prisma": "^7" }
}
EOF
touch "$P/backend/pnpm-lock.yaml" "$P/backend/tsconfig.json"
printf 'lint:\n\tpnpm lint\nformat-check:\n\tpnpm prettier --check .\ntest:\n\tpnpm jest\ntest-e2e:\n\tdocker/e2e.sh\nbuild-app:\n\tpnpm build\nup:\n\tdocker compose up -d\n.PHONY: lint test\n' > "$P/backend/Makefile"
echo "services: { db: { image: postgres:16 } }" > "$P/backend/docker-compose.yml"
cat > "$P/frontend/package.json" <<'EOF'
{
  "name": "atlas-frontend",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "e2e": "playwright test"
  },
  "dependencies": { "react": "^19", "@tanstack/react-start": "^1", "@tanstack/react-query": "^5", "zustand": "^5", "zod": "^3", "tailwindcss": "^4" },
  "devDependencies": { "vite": "^6", "vitest": "^3", "@playwright/test": "^1", "typescript": "^5" }
}
EOF
touch "$P/frontend/bun.lock" "$P/frontend/tsconfig.json"; echo "# fe agents" > "$P/frontend/AGENTS.md"
gi "$P/backend"; git -C "$P/backend" checkout -q -b v2
gi "$P/frontend"; git -C "$P/frontend" checkout -q -b integration
gi "$P"

# --- FastAPI, pacote único, sem frontend
P="$S/fastapi-single"; mkdir -p "$P/app" "$P/tests" "$P/.github/workflows"
cat > "$P/pyproject.toml" <<'EOF'
[project]
name = "billing-api"
description = "Serviço de cobrança"
dependencies = ["fastapi>=0.115", "sqlalchemy>=2", "asyncpg"]
[dependency-groups]
dev = ["pytest", "ruff", "mypy"]
EOF
touch "$P/uv.lock" "$P/.github/workflows/ci.yml"
printf '# billing-api\n![badge](x)\n\nServiço de cobrança em FastAPI.\n' > "$P/README.md"
gi "$P"

# --- Laravel + Inertia/React no mesmo pacote (fullstack), branch develop
P="$S/laravel-inertia"; mkdir -p "$P/app" "$P/tests" "$P/resources/js"
cat > "$P/composer.json" <<'EOF'
{
    "name": "acme/crm",
    "description": "CRM interno",
    "require": { "laravel/framework": "^12.0", "inertiajs/inertia-laravel": "^2" },
    "require-dev": { "phpunit/phpunit": "^11", "laravel/pint": "^1", "larastan/larastan": "^3" }
}
EOF
echo '{ "private": true, "scripts": { "dev": "vite", "build": "vite build", "lint": "eslint resources/js" }, "devDependencies": { "vite": "^6", "react": "^19", "@inertiajs/react": "^2", "typescript": "^5", "tailwindcss": "^4" } }' > "$P/package.json"
touch "$P/package-lock.json" "$P/tsconfig.json"
echo "services: {app: {build: .}}" > "$P/docker-compose.yml"; echo "FROM php" > "$P/Dockerfile"
gi "$P" master; git -C "$P" checkout -q -b develop

# --- Next.js (meta-framework sozinho = backend + frontend), sem git
P="$S/next-app"; mkdir -p "$P/src/app"
echo '{ "name": "@acme/site", "scripts": { "dev": "next dev", "build": "next build", "lint": "next lint", "test": "vitest" }, "dependencies": { "next": "15", "react": "19", "drizzle-orm": "^0.4", "better-sqlite3": "^11" }, "devDependencies": { "vitest": "^3", "typescript": "^5" } }' > "$P/package.json"
touch "$P/yarn.lock" "$P/tsconfig.json"

# --- Go + Makefile na raiz, sem git
P="$S/go-api"; mkdir -p "$P/internal" "$P/cmd/api"
printf 'module github.com/acme/orders\n\ngo 1.23\n\nrequire (\n\tgithub.com/go-chi/chi/v5 v5.0.0\n\tgithub.com/jackc/pgx/v5 v5.0.0\n)\n' > "$P/go.mod"
printf 'lint:\n\tgolangci-lint run\ntest:\n\tgo test ./...\nbuild:\n\tgo build ./cmd/api\n' > "$P/Makefile"
touch "$P/.golangci.yml"

# --- pnpm workspace: apps/api (Hono) + apps/web (Vue) + packages/shared
P="$S/pnpm-ws"; mkdir -p "$P/apps/api/src" "$P/apps/web/src" "$P/packages/shared"
echo '{ "name": "ws", "private": true, "workspaces": ["apps/*", "packages/*"] }' > "$P/package.json"
echo 'packages: ["apps/*"]' > "$P/pnpm-workspace.yaml"; touch "$P/pnpm-lock.yaml"
echo '{ "name": "api", "scripts": {"build":"tsc","test":"vitest run","lint":"eslint ."}, "dependencies": {"hono":"^4","drizzle-orm":"^0.4","pg":"^8"}, "devDependencies": {"vitest":"^3","typescript":"^5"} }' > "$P/apps/api/package.json"
echo '{ "name": "web", "scripts": {"build":"vite build","lint":"eslint .","typecheck":"tsc -b"}, "dependencies": {"vue":"^3","pinia":"^2"}, "devDependencies": {"vite":"^6","typescript":"^5"} }' > "$P/apps/web/package.json"
echo '{ "name": "shared" }' > "$P/packages/shared/package.json"

# --- pasta vazia (nada reconhecido)
mkdir -p "$S/empty"
