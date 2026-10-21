# ai-team

Equipe de agentes do Claude Code (Tech Lead → PO → DevOps → Backend → Frontend → Code Reviewer → QA), com os skills e comandos do OpenSpec, instalável em qualquer projeto. O instalador **lê o projeto** (stack, branches, comandos, docs, infra) e **configura os agentes para ele**.

## Instalar num projeto

```bash
cd meu-projeto
curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash
```

O que acontece:

1. `lib/detect.sh` lê `package.json`, `composer.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`/Gradle, `.csproj`, `mix.exs`, Makefile, docker-compose, git (branch atual, padrão, repos aninhados) e docs (`README`, `CLAUDE.md`, `AGENTS.md`, `docs/*.md`).
2. Grava **`.claude/ai-team.conf`** com o que achou (formato shell, `CHAVE='valor'`).
3. Gera **`.claude/project-context.md`** a partir do conf: a ficha do projeto que todos os agentes leem primeiro.
4. Renderiza os agentes de `templates/agents/*.md` com as variáveis do conf e grava em `.claude/agents/`.
5. Copia skills `openspec-*` e comandos `/opsx:*`; cria `settings.json` com `{"agent": "tech-lead"}` se não existir.

Antes de gravar, veja o que o detector entendeu:

```bash
curl -fsSL .../install.sh | bash -s -- --detect-only
```

Variações:

```bash
# corrigir algo que o detector errou (grava no conf e re-renderiza)
curl -fsSL .../install.sh | bash -s -- --set BACKEND_BRANCH=develop --set FRONTEND_CMD_LINT='bun run lint:integration'

# só alguns agentes, sem skills/commands do OpenSpec
curl -fsSL .../install.sh | bash -s -- --agents tech-lead,product-owner,backend-dev --no-skills --no-commands

# noutra pasta, sobrescrevendo o que já existe, usando uma tag
curl -fsSL .../install.sh | bash -s -- --force --ref v2.0.0 ~/Sites/outro-projeto

# agentes do PLATO, exatamente como estão no repo (sem detector)
curl -fsSL .../install.sh | bash -s -- --profile plato

# ver o que seria feito
curl -fsSL .../install.sh | bash -s -- --dry-run
```

Com o repo clonado: `./install.sh [opções] [projeto]`, `make install TARGET=~/Sites/projeto`, `make detect TARGET=...`, `make render TARGET=...`.

## Ajustar depois de instalar

O detector acerta stack, comandos e branches na maioria dos projetos, mas não sabe regras de negócio nem convenções de processo. Dois lugares para completar:

- **`.claude/ai-team.conf`** — corrija o que estiver errado ou vazio (ex.: `BACKEND_CMD_LINT`, `FRONTEND_BRANCH`, `DOCS_STANDARDS`, `TEST_PERSONAS`) e rode `install.sh --render`. O gate de cada frente é derivado dos `*_CMD_*` na hora de renderizar.
- **`.claude/project-context.md`** — abaixo do marcador `<!-- ai-team:notas -->` escreva o que o detector não vê (regras de negócio, integrações externas, personas, decisões em aberto). Essa seção é preservada; a parte acima é regenerada do conf.

Arquivos gerados terminam com `<!-- ai-team:generated cksum=… -->`. Se você não os editou, um novo `--render` os atualiza sozinho; se editou, o instalador avisa e só sobrescreve com `--force`. `--reconfigure` descarta o conf e detecta tudo de novo.

Avisos comuns na primeira instalação:

- *nenhum comando de gate detectado*: preencha `BACKEND_CMD_LINT/TEST/BUILD` (ou crie scripts/alvos de Makefile com esses nomes e rode `--reconfigure`).
- *sem documento de padrões*: o code-reviewer usa `docs/padroes.md` (ou o que `DOCS_STANDARDS` apontar) como régua; sem ele, revisa pelo `design.md` e pelas convenções visíveis no código.

## O que é instalado

```
.claude/
├── ai-team.conf               o que o detector achou + seus ajustes
├── project-context.md         ficha do projeto (gerada) + suas notas
├── settings.json              {"agent": "tech-lead"}  (só se não existir)
├── agents/
│   ├── tech-lead.md           orquestra; não implementa (Opus)
│   ├── product-owner.md       cria/valida/arquiva changes do OpenSpec (Opus)
│   ├── devops.md              ambiente local, containers, OpenSpec (Sonnet)
│   ├── backend-dev.md         API a partir das specs; escreve design.md (Sonnet)   [se há backend]
│   ├── frontend-dev.md        telas e integração com a API (Sonnet)                [se há frontend]
│   ├── code-reviewer.md       revisa commits registrados; só escreve review-report.md (Opus)
│   └── qa.md                  valida cenários pela tela ou pela API; só escreve qa-report.md (Sonnet)
├── skills/openspec-*/         gerados por `openspec init` (v1.14.1)
└── commands/opsx/             /opsx:propose, apply, archive, explore, sync, update
```

Projeto só de API (FastAPI, Go, NestJS sem front) não recebe `frontend-dev`, e o QA verifica pela API. Projeto com meta-framework (Next, Nuxt, Laravel + Inertia) recebe os dois devs no mesmo pacote.

O fluxo é o mesmo em qualquer projeto: `tasks.md` com seções 0–3, `<!-- commits -->` e `<!-- gate -->` por seção, `design.md` como único contrato da API, `review-report.md` → `qa-report.md` → archive, `PV-<n>` para decisões provisórias e `R<k>` para achados.

## O que o detector reconhece

| Área | Fontes |
|---|---|
| Layout | pacote único, `backend/`+`frontend/`, `apps/*`, `packages/*`, `services/*`, workspaces (pnpm/yarn/npm, turbo, nx, lerna); repos git aninhados com branch própria |
| Node | NestJS, Express, Fastify, Hono, Koa, Adonis; React, Vue, Angular, Svelte, Solid; Next, Nuxt, Remix, SvelteKit, Astro, TanStack Start; Prisma, TypeORM, Drizzle, Mongoose, Sequelize, MikroORM; Jest, Vitest, Mocha, Playwright, Cypress; pnpm/yarn/bun/npm/deno |
| PHP | Laravel, Symfony, Slim, CakePHP, CodeIgniter; PHPUnit, Pest, Pint, php-cs-fixer, PHPStan/Larastan, Psalm |
| Python | FastAPI, Django, Flask, Litestar; SQLAlchemy, SQLModel, Tortoise; pytest, ruff, black, flake8, mypy, pyright; uv/poetry/pipenv/pdm/pip |
| Go, Rust, Ruby, JVM, .NET, Elixir | Gin/Echo/Fiber/Chi, Axum/Actix/Rocket, Rails/Sinatra, Spring Boot/Quarkus/Ktor, ASP.NET, Phoenix, com os comandos padrão de cada ecossistema |
| Comandos | scripts do `package.json`/`composer.json`, alvos de Makefile (têm prioridade), ferramentas declaradas nas dependências |
| Git | branch atual e padrão por repositório; branch protegida = a padrão quando o trabalho acontece noutra |
| Docs | `CLAUDE.md`/`AGENTS.md` (contexto), `*padroes*`/`*standards*`/`CONTRIBUTING` (régua da revisão), `*ambiente*`/`*setup*` (ambiente), `*arquitetura*`/`adr*` (decisões) |
| Infra | docker-compose, Dockerfiles, Makefile da raiz, CI (GitHub Actions, GitLab, Bitbucket, CircleCI, Jenkins, pre-commit, husky), `openspec/` |

## Estrutura do repo

```
install.sh                 orquestra: detecta → conf → contexto → renderiza → copia
lib/detect.sh              detector (só lê; imprime KEY='valor')
lib/render.sh              renderizador ({{VAR}}, {{#if}}/{{#unless}}/{{else}})
templates/agents/*.md      agentes genéricos com variáveis
templates/project-context.md
profiles/plato/agents/     agentes do PLATO, intocados (--profile plato)
skills/, commands/         OpenSpec (iguais em qualquer perfil)
scripts/export.sh          traz agentes de um projeto de volta para um perfil
tests/run.sh               44 testes sobre projetos de exemplo (make test)
```

Perfis são pastas em `profiles/<nome>/agents/` copiadas sem renderizar: servem para projetos cujos agentes já foram ajustados à mão e não devem ser regenerados.

## Manter o repo atualizado

Alterou um agente **de perfil** dentro de um projeto? Traga de volta:

```bash
scripts/export.sh ~/Sites/b270/plato                 # perfil plato: agentes + skills + commands
scripts/export.sh ~/Sites/b270/plato --agents-only
scripts/export.sh ~/Sites/x --profile outro
git add -A && git commit -m "profiles/plato: ..." && git tag v2.x.y
```

Num projeto que usa o perfil `generic` os agentes são renderizados: a mudança vai no template (`templates/agents/`) ou no conf do projeto, e o export só traz skills/commands.

## Requisitos

- bash 3.2+ (macOS serve), curl, tar, awk, git (instalador remoto)
- rsync (`scripts/export.sh`)
- CLI `openspec` nos projetos que usarem skills/commands: `npm i -g @fission-ai/openspec && openspec init`
