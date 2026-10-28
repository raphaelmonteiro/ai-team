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
5. Copia skills `openspec-*`, comandos `/opsx:*` e o skill `/equipe`; cria `settings.json` (hooks do painel e do `/equipe`) se não existir.

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

# registrar o projeto no hub, no time "pagamentos" (ver "Hub" abaixo)
curl -fsSL .../install.sh | bash -s -- --hub-team pagamentos
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
├── settings.json              hooks do painel e do /equipe; "agent" só com --default-agent  (só se não existir)
├── agents/
│   ├── tech-lead.md           orquestra; não implementa (Opus)
│   ├── product-owner.md       cria/valida/arquiva changes do OpenSpec (Opus)
│   ├── devops.md              ambiente local, containers, OpenSpec (Sonnet)
│   ├── backend-dev.md         API a partir das specs; escreve design.md (Sonnet)   [se há backend]
│   ├── frontend-dev.md        telas e integração com a API (Sonnet)                [se há frontend]
│   ├── code-reviewer.md       revisa commits registrados; só escreve review-report.md (Opus)
│   └── qa.md                  valida cenários pela tela ou pela API; só escreve qa-report.md (Sonnet)
├── skills/openspec-*/         gerados por `openspec init` (v1.14.1)
├── skills/equipe/SKILL.md      /equipe: a sessão atual passa a atuar como tech-lead
├── commands/opsx/             /opsx:propose, apply, archive, explore, sync, update
└── dashboard/                 painel: server.mjs, collect.mjs, board.mjs, index.html, hook.sh  (--no-dashboard para pular)
```

Projeto só de API (FastAPI, Go, NestJS sem front) não recebe `frontend-dev`, e o QA verifica pela API. Projeto com meta-framework (Next, Nuxt, Laravel + Inertia) recebe os dois devs no mesmo pacote.

## Chamar a equipe

Uma sessão comum do `claude` é o Claude de sempre, para perguntas e ajustes rápidos. A equipe entra quando você pede:

- **`/equipe <pedido>`** no meio de qualquer sessão: a sessão lê `.claude/agents/tech-lead.md` e passa a atuar como tech-lead até o fim, com as mesmas restrições (coordena, delega, não edita). O papel sobrevive à compactação por dois caminhos: o `/equipe` é um skill, cujo corpo o Claude Code reinjeta depois de compactar, e o `hook.sh` marca a sessão (`UserPromptExpansion`) e, no `SessionStart` com `source: compact`, devolve um lembrete que entra no contexto compactado. É uma instrução, não um agente de verdade: as ferramentas não ficam bloqueadas como no `--agent`.
- **`claude --agent tech-lead`**: a sessão já começa como tech-lead, com as ferramentas restritas do agente.
- **`--default-agent tech-lead`** no instalador: grava `"agent"` no `settings.json` e toda sessão começa como tech-lead (o comportamento anterior). Projetos instalados antes têm essa chave; o instalador não altera um `settings.json` existente e avisa. Para escolher por sessão, remova a chave.

O tech-lead classifica cada pedido antes de começar:

- **Change** (o padrão): requisito ou comportamento novo, contrato da API, migration, tela nova, mais de uma frente. Segue o ciclo do OpenSpec abaixo.
- **Tarefa avulsa**: correção pontual com causa conhecida, configuração, dependência, refatoração local. Sem change: ele delega direto ao dono da frente com `Tarefa avulsa: <slug>` na primeira linha do prompt; o dev segue branch, commit e gate e devolve shas e gate no retorno; havendo commit, o code-reviewer revisa esses shas e devolve os achados no retorno, sem `review-report.md`. Se crescer, vira change.
- **Pergunta**: ele responde lendo o código.

O fluxo de uma change é o mesmo em qualquer projeto: `tasks.md` com seções 0–3, `<!-- commits -->` e `<!-- gate -->` por seção, `design.md` como único contrato da API, `review-report.md` → `qa-report.md` → archive, `PV-<n>` para decisões provisórias e `R<k>` para achados.

## Painel: esforço dos agentes em tempo real

```bash
cd meu-projeto
node .claude/dashboard/server.mjs          # http://127.0.0.1:4321/
# ou, do repo clonado: make dashboard TARGET=~/Sites/projeto
```

O painel lê os transcripts que o Claude Code grava em `~/.claude/projects/<projeto>/` (sessão principal e `…/subagents/agent-*.jsonl`) e o `openspec/` do projeto. Não precisa de hook nem de dependência: Node 18+ e pronto. Atualiza sozinho (SSE sobre `fs.watch`, com polling de reserva).

O que mostra:

- **Esforço por agente**: tempo trabalhado, tokens (entrada, saída, cache lido e gravado), rodadas, changes tocadas, modelos usados. A sessão principal da equipe conta como o tech-lead (ou o `"agent"` do `settings.json`), com o tempo dos turnos ativos.
- **Sessão da equipe ou avulsa**: com `"agent"` fixo no `settings.json`, toda sessão é da equipe. Sem ele, uma sessão é da equipe quando chamou `/equipe` ou delegou a um agente de `.claude/agents/`; as outras são *sessões avulsas* (Claude comum), mostradas à parte com contagem, tempo e tokens, fora do esforço dos agentes e das changes.
- **Quadro de changes**: em andamento primeiro, depois bloqueadas, pendentes e concluídas, com tasks `x/y`, resultado da última rodada de revisão e do QA, rodadas, trocas de agente, tempo e tokens.
- **Agente ativo** em cada change em andamento, com modelo, há quanto tempo trabalha e quantos tokens já custou. Tokens aparecem em duas colunas: "novos" (entrada + saída + cache gravado) e "cache lido"; o `/api/state` traz também os campos brutos (`input`, `output`, `cacheRead`, `cacheCreation`) em `usage`/`tokenSplit`.
- **Clique na change**: a lista de rodadas, cada uma com início, fim, duração, tokens, modelo, de quem veio e para quem foi, descrição; clique na linha para ver o retorno e o prompt. **Clique no agente**: as rodadas dele em todas as changes.

Definições: uma *rodada* é uma delegação do tech-lead a um agente (uma chamada do Agent tool); *trocas* conta quantas vezes a change passou para um agente diferente do anterior; a change de uma rodada vem do prompt da delegação (`openspec/changes/<id>` ou o id citado). Rodadas sem change aparecem em "Fora de changes", e as de tarefa avulsa ficam agrupadas lá pelo slug de `Tarefa avulsa: <slug>`. Tokens somam `input + output + cache_read + cache_creation` de cada resposta, sem contar duas vezes os blocos da mesma requisição.

Hooks: `settings.json` criado pelo instalador aponta `SubagentStart`/`SubagentStop` (painel) e `SessionStart`/`UserPromptExpansion` (`/equipe`) para `.claude/dashboard/hook.sh`, que grava `.claude/ai-team/events.jsonl` (adicione ao `.gitignore`); com `--no-dashboard` só o `hook.sh` é copiado. O evento `TeamStart` (do `/equipe` ou de `claude --agent tech-lead`) diz ao painel, com exatidão, quais sessões são da equipe. Com eles, início e fim de cada rodada ficam exatos mesmo em agentes de segundo plano; sem eles, o painel usa os timestamps dos transcripts e considera ativa uma rodada sem fim registrado com atividade nos últimos 10 minutos. Se o `settings.json` já existia, o instalador não o altera e mostra o trecho a acrescentar.

Perfil `plato`: o instalador também copia `profiles/plato/dashboard/equipe.html`. O servidor a serve em `/equipe` (404 se o arquivo não existir; o `generic` não a tem) e as definições dos agentes em `/agents/<nome>.md` (lidas de `<projeto>/.claude/agents/`, só `[a-z0-9-]+`); o painel mostra um link "equipe" quando a rota existe.

Quadro de changes: a página mostra os agentes rodando agora (change, etapa inferida do prompt, desde quando, última atividade; "terminou" não prova sucesso), as changes em andamento, bloqueadas e pendentes, as 3 últimas concluídas (as demais recolhidas), com início, tasks por seção, última revisão e QA, tokens por change e por agente, e **"esperando o quê"** por heurística (regras em `dashboard/board.mjs`; mostra a regra que disparou e, sem regra, "indefinido"). Clicar numa change lista os `.md` dela, servidos como texto em `/changes/<id>/<arquivo>.md` (só proposal, design, tasks, review/qa-report e `specs/**`; traversal recusado). `/equipe` é a segunda aba do mesmo cabeçalho.

**Estado declarado.** Uma linha no cabeçalho do `tasks.md` manda na etapa, no "esperando quem" e no "próximo" (a heurística fica de reserva; o painel mostra "declarado" ou "inferido" e avisa se a linha for inválida):

```
<!-- estado: <etapa> · aguarda: <quem> · desde: <aaaa-mm-ddThh:mmZ> · nota: <texto curto opcional> -->
```

`etapa`: proposta, aprovacao, implementacao, revisao, correcao, qa, integracao, arquivada. `aguarda`: desenvolvedor, tech-lead, product-owner, devops, backend-dev, frontend-dev, code-reviewer, qa, fila.

**Estados do agente.** rodando (verde), sem sinal (âmbar; sem atividade no transcript há mais de `--stale-min`, padrão 15, e sem término), terminou (cinza), falhou (vermelho), interrompido. Cada agente e rodada mostra a sessão de origem (título do transcript, senão o primeiro prompt encurtado, senão o id curto).

`node .claude/dashboard/collect.mjs` imprime o mesmo estado no terminal (`--json` para o JSON completo).

## Hub: vários projetos num painel só, separados por time

```bash
git clone https://github.com/raphaelmonteiro/ai-team ~/ai-team && cd ~/ai-team
./install.sh --hub-team pagamentos ~/Sites/checkout-api     # instala como sempre e registra no hub
./install.sh --hub-team pagamentos ~/Sites/checkout-web
./install.sh --hub-team plataforma --profile plato ~/Sites/b270/plato
make hub                                                    # http://127.0.0.1:4321/
```

Cada projeto continua com os seus agentes, contexto e comandos de gate. O hub só lê os projetos, com o `collect.mjs` do clone (a mesma régua para todos). O registro fica em `~/.config/ai-team/hub.json` (ou `$AI_TEAM_HUB`, ou `--hub ARQUIVO` no instalador e no servidor):

```json
{ "teams": [ { "id": "pagamentos", "name": "Pagamentos",
               "projects": [ { "id": "checkout-api", "name": "Checkout API", "dir": "~/Sites/checkout-api" } ] } ] }
```

- **Registro.** `--hub-team TIME` grava `HUB_TEAM` no `ai-team.conf` e registra o projeto, com o nome de `PROJECT_NAME`. Os `--render` seguintes mantêm o registro atualizado. Sem a opção, se já existe um hub e há terminal, o instalador pergunta o time e o nome (enter pula; `--yes` não pergunta). À mão: `node dashboard/hub.mjs add <dir> --team <time> [--name N] [--id ID]`, `remove <id>`, `list`. O hub relê o arquivo sem reiniciar.
- **Abas.** `/` mostra todos os times. `/t/<time>` mostra os projetos do time e `/t/<time>/<projeto>` abre o painel do projeto, servido em `/p/<id>/` com as mesmas rotas do painel de projeto único.
- **Leve.** A visão geral não lê transcripts: mostra a última atividade (`mtime`), as changes abertas e arquivadas e os agentes instalados, com cache de 20 s. Só o projeto aberto fica em tempo real: os `fs.watch` abrem com o primeiro cliente de `/p/<id>/events` e fecham 60 s depois que o último sai (`AI_TEAM_IDLE_MS`). O cache de transcripts de um projeto é descartado depois de 15 min sem uso.
- **`equipe.html`.** No hub vem do `.claude/dashboard/` do projeto. Cópias antigas, com caminhos absolutos, recebem o prefixo `/p/<id>` ao serem servidas.

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
dashboard/                 painel de esforço dos agentes (Node, sem dependências); hub.mjs/hub.html/live.mjs: hub de vários projetos
scripts/export.sh          traz agentes de um projeto de volta para um perfil
tests/run.sh               78 testes sobre projetos de exemplo e transcripts sintéticos (make test)
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
- Node 18+ (painel)
- rsync (`scripts/export.sh`)
- CLI `openspec` nos projetos que usarem skills/commands: `npm i -g @fission-ai/openspec && openspec init`
