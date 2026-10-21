# ai-team

Equipe de agentes do Claude Code (Tech Lead → PO → DevOps → Backend → Frontend → Code Reviewer → QA), com os skills e comandos do OpenSpec, instalável em qualquer projeto.

## Instalar num projeto

```bash
cd meu-projeto
curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash
```

Variações:

```bash
# só alguns agentes, sem skills/commands do OpenSpec
curl -fsSL .../install.sh | bash -s -- --agents tech-lead,product-owner,backend-dev --no-skills --no-commands

# noutra pasta, sobrescrevendo o que já existe, usando uma tag
curl -fsSL .../install.sh | bash -s -- --force --ref v1.0.0 ~/Sites/outro-projeto

# ver o que seria feito
curl -fsSL .../install.sh | bash -s -- --dry-run
```

Com o repo clonado: `./install.sh [opções] [projeto]` ou `make install TARGET=~/Sites/projeto`.

O instalador **nunca sobrescreve** arquivos existentes sem `--force` e **nunca altera** um `settings.json` já presente (as permissões em `settings.local.json` ficam fora do repo).

## O que é instalado

```
.claude/
├── settings.json              {"agent": "tech-lead"}  (só se não existir)
├── agents/
│   ├── tech-lead.md           orquestra; não implementa (Opus)
│   ├── product-owner.md       cria/valida/arquiva changes do OpenSpec (Opus)
│   ├── devops.md              ambiente local, Docker, OpenSpec (Sonnet)
│   ├── backend-dev.md         API a partir das specs; escreve design.md (Sonnet)
│   ├── frontend-dev.md        integra front existente à API (Sonnet)
│   ├── code-reviewer.md       revisa commits registrados; só escreve review-report.md (Opus)
│   └── qa.md                  valida cenários pela tela; só escreve qa-report.md (Sonnet)
├── skills/openspec-*/         gerados por `openspec init` (v1.14.1)
└── commands/opsx/             /opsx:propose, apply, archive, explore, sync, update
```

## Depois de instalar

Os agentes nasceram no projeto PLATO e carregam contexto dele (stack NestJS/Prisma e React/TanStack, branches `v2`/`integration`, caminhos como `docs/ambiente.md`, `docs/padroes.md`, comandos `make gate-record`, referências ao "Registro §2.xx"). Num projeto novo, ajuste:

1. **Stack e comandos de gate** em `backend-dev.md` / `frontend-dev.md` / `devops.md`.
2. **Branches e repositórios** (`v2`, `integration`, `main` do Lovable) em todos.
3. **Documentos de referência** (`docs/ambiente.md`, `docs/padroes.md`, `docs/resumos/...`): crie-os no projeto ou remova as referências.
4. **Personas de teste** em `qa.md`.

O fluxo (tasks.md com seções 0–3, `<!-- commits -->`, `<!-- gate -->`, `review-report.md` → `qa-report.md` → archive) é genérico e pode ficar como está.

## Manter o repo atualizado

Alterou um agente dentro de um projeto? Traga de volta:

```bash
scripts/export.sh ~/Sites/b270/plato          # agentes + skills + commands
scripts/export.sh ~/Sites/b270/plato --agents-only
git add -A && git commit -m "agents: ..." && git tag v1.x.y
```

## Requisitos

- bash, curl, tar (instalador remoto)
- rsync (`scripts/export.sh`)
- CLI `openspec` nos projetos que usarem skills/commands: `npm i -g @fission-ai/openspec && openspec init`
