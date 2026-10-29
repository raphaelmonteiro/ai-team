# ai-team

Equipe de agentes do Claude Code (Tech Lead → PO → DevOps → Backend → Frontend → Code Reviewer → QA), com as skills e os comandos do OpenSpec, instalável em qualquer projeto. O instalador **lê o projeto** (stack, branches, comandos, docs, infra) e **configura os agentes para ele**.

## Primeiros passos

1. **Instale** no projeto: `curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash` (ver abaixo).
2. **Confira** o `.claude/ai-team.conf`: stack, branches e comandos de gate. Corrija o que o detector errou e rode `install.sh --render`.
3. **Apresente o projeto à equipe**: numa sessão do `claude`, rode `/onboarding`. A equipe investiga o código e grava contexto, padrões, ambiente e arquitetura.
4. **Peça trabalho**: `/equipe <pedido>`. O tech-lead decide se é change, tarefa avulsa ou pergunta e delega.
5. **Acompanhe** (opcional): `node .claude/dashboard/server.mjs` abre o painel em http://127.0.0.1:4321/.

## Instalar num projeto

```bash
cd meu-projeto
curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash
```

O que acontece:

1. `lib/detect.sh` lê `package.json`, `composer.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`/Gradle, `.csproj`, `mix.exs`, Makefile, docker-compose, git (branch atual, padrão, repos aninhados) e docs (`README`, `CLAUDE.md`, `AGENTS.md`, `docs/*.md`).
2. Grava **`.claude/ai-team.conf`** com o que achou (formato shell, `CHAVE='valor'`).
3. Gera **`.claude/project-context.md`** a partir do conf: a ficha do projeto que todos os agentes leem primeiro.
4. Renderiza os agentes de `templates/agents/*.md` com as variáveis do conf e grava em `.claude/agents/`. Também renderiza as skills `gate-e-commit` (gate, commit, marcadores do `tasks.md`, push) e `worktree` (um worktree por change, integração e fechamento, com o script `wt.sh`), que devops, backend-dev e frontend-dev carregam pelo campo `skills:` do frontmatter: cada protocolo fica num lugar só.
5. Roda `openspec init --tools claude` no projeto, que gera as skills `openspec-*`, os comandos `/opsx:*` e a pasta `openspec/` (o repo não guarda cópia). Se o CLI `openspec` não existe, instala antes a versão testada com `npm i -g @fission-ai/openspec@1.14.1`; se existe, não mexe nele e só avisa quando a versão é outra. Copia as skills `/equipe` e `/onboarding` e as skills `grilling` e `/grill-me` (ver "Crítica da proposta"); cria `settings.json` (hooks do painel e do `/equipe`) se não existir, ou acrescenta só os hooks que faltam num existente.

Antes de gravar, veja o que o detector entendeu:

```bash
curl -fsSL .../install.sh | bash -s -- --detect-only
```

Variações:

```bash
# corrigir algo que o detector errou (grava no conf e re-renderiza)
curl -fsSL .../install.sh | bash -s -- --set BACKEND_BRANCH=develop --set FRONTEND_CMD_LINT='bun run lint:integration'

# só alguns agentes, sem o openspec init
curl -fsSL .../install.sh | bash -s -- --agents tech-lead,product-owner,backend-dev --no-openspec

# noutra pasta, sobrescrevendo o que já existe, usando uma tag
curl -fsSL .../install.sh | bash -s -- --force --ref v2.0.0 ~/Sites/outro-projeto

# agentes de um perfil, exatamente como estão em profiles/<nome> (sem detector)
curl -fsSL .../install.sh | bash -s -- --profile meu-perfil

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

Ou deixe a equipe fazer isso: **`/onboarding`** numa sessão (ver "Onboarding" abaixo).

Arquivos gerados terminam com `<!-- ai-team:generated cksum=… -->`. Se você não os editou, um novo `--render` os atualiza sozinho; se editou, o instalador avisa e só sobrescreve com `--force`. `--reconfigure` descarta o conf e detecta tudo de novo.

O que versionar no projeto:

- **Sim**: `.claude/agents/`, `.claude/skills/`, `.claude/commands/`, `.claude/ai-team.conf`, `.claude/project-context.md`, `.claude/settings.json` e `.claude/dashboard/`. Quem clonar o projeto recebe a mesma equipe, e o registro do `/onboarding` vale para todos.
- **Não** (no `.gitignore`): `.claude/ai-team/` (log dos hooks, decisões pendentes e o modo "longe do computador", tudo por máquina), `.claude/settings.json.bak-ai-team` (cópia feita pelo instalador) e `.claude/settings.local.json` (ajustes pessoais do Claude Code).

Avisos comuns na primeira instalação:

- *nenhum comando de gate detectado*: preencha `BACKEND_CMD_LINT/TEST/BUILD` (ou crie scripts/alvos de Makefile com esses nomes e rode `--reconfigure`).
- *sem documento de padrões*: o code-reviewer usa `docs/padroes.md` (ou o que `DOCS_STANDARDS` apontar) como régua; sem ele, revisa pelo `design.md` e pelas convenções visíveis no código.

## O que é instalado

```
.claude/
├── ai-team.conf               o que o detector achou + seus ajustes
├── project-context.md         ficha do projeto (gerada) + suas notas
├── settings.json              hooks do painel e do /equipe; "agent" só com --default-agent
├── agents/
│   ├── tech-lead.md           orquestra; não implementa (Opus)
│   ├── product-owner.md       cria/valida/arquiva changes do OpenSpec (Opus)
│   ├── devops.md              ambiente local, containers, OpenSpec (Sonnet)
│   ├── backend-dev.md         API a partir das specs; escreve design.md (Sonnet)   [se há backend]
│   ├── frontend-dev.md        telas e integração com a API (Sonnet)                [se há frontend]
│   ├── code-reviewer.md       revisa commits registrados; só escreve review-report.md (Opus)
│   └── qa.md                  valida cenários pela tela ou pela API; só escreve qa-report.md (Sonnet)
├── skills/
│   ├── equipe/                /equipe: a sessão atual passa a atuar como tech-lead
│   ├── onboarding/            /onboarding: a equipe investiga o projeto e grava contexto, padrões e ambiente
│   ├── gate-e-commit/         gerada: protocolo de gate/commit/push das frentes (não aparece como /comando)
│   ├── worktree/              gerada: SKILL.md + wt.sh (abrir, onde, integrar, fechar o worktree da change)
│   ├── grilling/              entrevista em rodadas sobre um plano; o product-owner carrega (mattpocock/skills, MIT)
│   ├── grill-me/              /grill-me: chama o grilling numa conversa sua, fora do ciclo
│   └── openspec-*/            geradas pelo `openspec init` que o instalador roda
├── worktrees/<id>/            worktree de cada change em andamento (fora do git: .git/info/exclude)
├── commands/opsx/             /opsx:propose, apply, archive, explore, sync, update
├── dashboard/                 painel e hooks (--no-dashboard: só hook.sh e hook.mjs)
│   ├── server.mjs             servidor do painel e do hub; collect/board/plan/stages/feed.mjs montam o estado
│   ├── hook.sh, hook.mjs      hooks: início e fim de agentes, sessão da equipe, lembrete depois de compactar
│   ├── ask.mjs                decisões pelo painel (hook PermissionRequest e modo longe do computador)
│   ├── notify.mjs             notificações no celular (ntfy)
│   ├── auth.mjs               token do acesso de fora da máquina
│   ├── settings.mjs           acrescenta os hooks que faltam num settings.json existente
│   └── *.html                 páginas: painel, Equipe, Notificações, hub
└── ai-team/                   criado pelos hooks, por máquina (fora do git)
    ├── events.jsonl           log dos hooks
    ├── pending/               decisões esperando resposta
    └── away.json              modo longe do computador ligado
```

Projeto só de API (FastAPI, Go, NestJS sem front) não recebe `frontend-dev`, e o QA verifica pela API. Projeto com meta-framework (Next, Nuxt, Laravel + Inertia) recebe os dois devs no mesmo pacote.

## Worktree por change

Cada change (e cada tarefa avulsa) é feita na branch `change/<id>`, num worktree em `.claude/worktrees/`. O checkout principal continua na branch de trabalho, livre para você. O dev cria o worktree na primeira rodada com `.claude/skills/worktree/wt.sh abrir <id> <frente>` e o reaproveita nas seguintes (correção de achado, QA). Pacote com git próprio (repo aninhado) ganha um worktree por repo: `<id>-backend/`, `<id>-frontend/`. Os artefatos do OpenSpec (`tasks.md`, `design.md`, relatórios) ficam no checkout principal, onde o tech-lead e o painel leem.

Depois da revisão aprovada (e do QA, quando houver), o tech-lead pede a cada dev a integração: `wt.sh integrar` faz `merge --no-ff` na branch de trabalho do checkout principal, o dev roda o gate e faz o push, e `wt.sh fechar` remove o worktree e a branch local. O script recusa integrar se o checkout principal estiver noutra branch ou se houver conflito, e o `fechar` não remove frente que ainda não foi integrada. Backend e frontend no mesmo repositório compartilham o worktree, e por isso as seções da change rodam uma de cada vez.

## Crítica da proposta

O product-owner carrega a skill `grilling` (copiada sem alterar de [mattpocock/skills](https://github.com/mattpocock/skills), commit `a496f55`, licença MIT em `templates/skills/grilling/LICENSE`). Depois de gerar proposal, specs e tasks pelo OpenSpec, ele monta a árvore de decisões da change: o que as fontes respondem ele corrige sozinho, e o que só o usuário decide vira `D-<n>` na seção "Decisões em aberto" da proposal, com a resposta recomendada. Como subagente ele não espera resposta: devolve a rodada ao tech-lead, que a leva ao usuário e repassa as respostas; o PO atualiza a change e devolve a próxima rodada, até não restar `D-<n>` aberta. Só então a proposta vai para aprovação. A adaptação ao papel de cada um está no texto dos agentes (`templates/agents/product-owner.md`, "Crítica da proposta"; `tech-lead.md`, "Rodadas de decisão"), não na skill.

Fora do ciclo, `/grill-me` (também copiado sem alterar) roda a mesma entrevista com você numa conversa comum. Para atualizar as duas, copie de novo os `SKILL.md` do repo de origem e troque o commit acima. Agentes de perfil (`--profile`) recebem as skills instaladas, mas só usam se o texto deles pedir.

## Chamar a equipe

Uma sessão comum do `claude` é o Claude de sempre, para perguntas e ajustes rápidos. A equipe entra quando você pede:

- **`/equipe <pedido>`** no meio de qualquer sessão: a sessão lê `.claude/agents/tech-lead.md` e passa a atuar como tech-lead até o fim, com as mesmas restrições (coordena, delega, não edita). O papel sobrevive à compactação por dois caminhos: o `/equipe` é uma skill, cujo corpo o Claude Code reinjeta depois de compactar, e o `hook.sh` marca a sessão (`UserPromptExpansion`) e, no `SessionStart` com `source: compact`, devolve um lembrete que entra no contexto compactado. É uma instrução, não um agente de verdade: as ferramentas não ficam bloqueadas como no `--agent`.
- **`claude --agent tech-lead`**: a sessão já começa como tech-lead, com as ferramentas restritas do agente.
- **`--default-agent tech-lead`** no instalador: grava `"agent"` no `settings.json` e toda sessão começa como tech-lead (o comportamento anterior). Projetos instalados antes têm essa chave; o instalador não altera um `settings.json` existente e avisa. Para escolher por sessão, remova a chave.

O tech-lead classifica cada pedido antes de começar:

- **Change** (o padrão): requisito ou comportamento novo, contrato da API, migration, tela nova, mais de uma frente. Segue o ciclo do OpenSpec abaixo.
- **Tarefa avulsa**: correção pontual com causa conhecida, configuração, dependência, refatoração local. Sem change: ele delega direto ao dono da frente com `Tarefa avulsa: <slug>` na primeira linha do prompt; o dev segue branch, commit e gate e devolve shas e gate no retorno; havendo commit, o code-reviewer revisa esses shas e devolve os achados no retorno, sem `review-report.md`. Se crescer, vira change.
- **Pergunta**: ele responde lendo o código.

O fluxo de uma change é o mesmo em qualquer projeto: `tasks.md` com seções 0–3, `<!-- commits -->` e `<!-- gate -->` por seção, `design.md` como único contrato da API, `review-report.md` → `qa-report.md` → archive, `PV-<n>` para decisões provisórias e `R<k>` para achados.

### Onboarding

**`/onboarding [foco]`** faz a equipe conhecer o projeto e gravar o que o detector não vê. A sessão atua como tech-lead (como no `/equipe`) e conduz uma tarefa avulsa `onboarding`:

1. **Inventário**: o tech-lead lê o que já existe (`CLAUDE.md`, `AGENTS.md`, `README`, `docs/`, `openspec/specs/`, `DOCS_*` do conf).
2. **Investigação em paralelo, só leitura**: devops (ambiente, CI e o gate: roda cada `*_CMD_*` do conf e diz qual falha), backend-dev e frontend-dev (arquitetura, convenções, testes, armadilhas da frente), product-owner (domínio, glossário, regras de negócio, integrações). Todo fato vem com evidência e marcado `confirmado` ou `inferido`.
3. **Confirmação**: as dúvidas e contradições vão ao usuário, junto com o plano de escrita. Arquivo que já existe só ganha acréscimo com o ok dele.
4. **Escrita, um dono por arquivo**: devops escreve `docs/ambiente.md`, corrige no conf os comandos de gate errados e os `DOCS_*` e roda `install.sh --render --set …` (nunca `--reconfigure`); os devs escrevem `docs/padroes.md` e `docs/arquitetura.md`; o product-owner escreve a seção de notas do `project-context.md` (só abaixo de `<!-- ai-team:notas -->`) e um `CLAUDE.md` curto que aponta para os outros arquivos, se ele não existir.
5. **Registro**: o PO grava nas notas `<!-- ai-team:onboarding feito=<data> sha=<HEAD> -->` (sem `project-context.md`, como num perfil sem detector, no fim do `CLAUDE.md`). Commit só se o usuário quiser, pelo devops, na branch de trabalho.

O registro é a memória do onboarding: fica versionado com o projeto, sobrevive ao `--render` e vale para quem clonar. Com ele, `/onboarding` de novo oferece **atualizar** (só o que mudou desde o sha), refazer ou cancelar. Sem ele, o `/equipe` oferece o onboarding antes do primeiro pedido e o instalador o sugere no fim. Os nomes dos docs são os que o detector já classifica, então um `--reconfigure` futuro os acha.

## Painel: esforço dos agentes em tempo real

```bash
cd meu-projeto
node .claude/dashboard/server.mjs          # http://127.0.0.1:4321/
# ou, do repo clonado: make dashboard TARGET=~/Sites/projeto
```

O painel lê os transcripts do Claude Code (`~/.claude/projects/<projeto>/`) e o `openspec/` do projeto. Não tem dependências além do Node 18+ e se atualiza sozinho. O que ele oferece:

- **Esforço por agente**: tempo, tokens, rodadas e modelos de cada agente. As sessões da equipe ficam separadas das sessões avulsas (Claude comum).
- **Quadro de changes**: estado de cada change e tarefa avulsa, quem está trabalhando agora e "esperando o quê". Ao clicar numa change, aparecem as rodadas com prompt e retorno.
- **Decisões esperando você**: aprovar ou negar pedidos de permissão e responder `AskUserQuestion` pelo navegador. Com **longe do computador** ligado, dá para responder também a pergunta do fim do turno.
- **Notificações no celular** pelo [ntfy](https://ntfy.sh): decisão nova, agente que terminou, sessão esperando você, erro.
- **Acesso de fora da máquina** com token, de preferência pelo Tailscale Serve.
- **Aba Equipe**: os agentes instalados, como chamar a equipe, o contexto do projeto e o ciclo de uma change.

`node .claude/dashboard/collect.mjs` imprime o mesmo estado no terminal (`--json` para o JSON completo). A referência completa (definições, hooks, rotas, variáveis `AI_TEAM_*`, configuração do ntfy e do token) está em [`docs/painel.md`](docs/painel.md).

## Hub: vários projetos num painel só, separados por time

```bash
git clone https://github.com/raphaelmonteiro/ai-team ~/ai-team && cd ~/ai-team
./install.sh --hub-team pagamentos ~/Sites/checkout-api     # instala como sempre e registra no hub
./install.sh --hub-team pagamentos ~/Sites/checkout-web
./install.sh --hub-team plataforma --profile meu-perfil ~/Sites/backoffice
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
- **Aba Equipe.** No hub, a página e o ciclo padrão vêm do clone (a mesma versão para todos), e o `cycle.html` do perfil vem do `.claude/dashboard/` de cada projeto: `/p/<id>/equipe` mostra o ciclo do perfil só nos projetos instalados com ele. Cópias antigas de `cycle.html`, com caminhos absolutos, recebem o prefixo `/p/<id>` ao serem servidas. Um `equipe.html` antigo de perfil num projeto não é usado pelo hub.

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
templates/skills/          /equipe e /onboarding (copiados), gate-e-commit (renderizado)
docs/                      referência do painel (painel.md) e roadmap
profiles/<nome>/agents/    agentes de um perfil, intocados (--profile <nome>; nenhum versionado aqui)
dashboard/                 painel de esforço dos agentes (Node, sem dependências); hub.mjs/hub.html/live.mjs: hub de vários projetos
scripts/export.sh          traz agentes de um projeto de volta para um perfil
tests/run.sh               testes sobre projetos de exemplo e transcripts sintéticos (make test)
```

Perfis são pastas em `profiles/<nome>/agents/` copiadas sem renderizar: servem para projetos cujos agentes já foram ajustados à mão e não devem ser regenerados.

## Manter o repo atualizado

Alterou um agente **de perfil** dentro de um projeto? Traga de volta:

```bash
scripts/export.sh ~/Sites/x --profile meu-perfil
git add -A && git commit -m "profiles/meu-perfil: ..." && git tag v2.x.y
```

Num projeto que usa o perfil `generic` os agentes são renderizados: a mudança vai no template (`templates/agents/`) ou no conf do projeto, e não há o que exportar. As skills e os commands do OpenSpec vêm do `openspec init` e também não voltam para o repo.

## Requisitos

- bash 3.2+ (macOS serve), curl, tar, awk, git (instalador remoto)
- Node 18+ (painel e hooks: sem node, os hooks não fazem nada, inclusive o lembrete do papel do `/equipe` e do `/onboarding` depois de compactar)
- rsync (`scripts/export.sh`)
- CLI `openspec` 1.14.1: o instalador instala com `npm i -g` quando falta (no Node ativo; com nvm, cada versão do Node tem os seus globais). Se a instalação falhar, o projeto fica sem as skills `openspec-*` e os `/opsx:*`, e o instalador avisa no fim. `--no-openspec` pula tudo isso
