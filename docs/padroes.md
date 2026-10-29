# Padrões

Convenções do repo. Ambiente, comandos de gate e fatos de máquina: ver `docs/ambiente.md`. Estrutura e decisões: ver `docs/arquitetura.md`.

## Shell (`install.sh`, `lib/`, `scripts/`, `dashboard/hook.sh`)
- `#!/usr/bin/env bash` e `set -euo pipefail`.
- Cada arquivo começa com um cabeçalho de uso (comentário).
- Mensagens e comentários em pt-BR.
- Log com `log`, `warn`, `ok` e `die` (cor ANSI, em stderr): `install.sh:85-87`.
- Variáveis de controle em MAIÚSCULAS (`DO_*`); locais em minúsculas.
- Compatível com o bash 3.2 do macOS: sem `mapfile`, `declare -A` nem `${v,,}`. Os testes passam no 3.2.57 e o CI roda em ubuntu e macos. Como regra explícita, é inferida (a confirmar).
- `.shellcheckrc` desliga SC2034, SC1090 e SC1091 (variáveis e `source` dinâmicos).
- `.sh` novo precisa entrar na lista do shellcheck em `.github/workflows/ci.yml` (manual).

## Node no painel (`dashboard/`)
- Módulos ESM `.mjs`, servidor HTTP sem dependências npm (`dashboard/server.mjs`).
- Sem build: o que está em `dashboard/` é o que roda (páginas `.html` servidas como estão; a confirmar).
- Hooks do Claude Code: `dashboard/hook.sh` e `dashboard/hook.mjs`.
- Detalhes de uso: `docs/painel.md`.
- Não adicionar dependência npm sem uma change que peça.

## Templates (`templates/`)
- Sintaxe do `lib/render.sh` (motor awk): `{{VAR}}`, `{{#if}}`, `{{#unless}}`, `{{else}}`. As variáveis vêm do ambiente (o conf carregado).
- Gerados (agentes, skills renderizadas, `project-context.md`) terminam com `<!-- ai-team:generated cksum=N -->`.
  - Edite o **template** ou o `.claude/ai-team.conf` e rode `install.sh --render`; não edite o gerado.
  - Gerado editado à mão só é sobrescrito com `--force`.
- `project-context.md`: acima de `<!-- ai-team:notas -->` é regenerado; abaixo é preservado (`install.sh:298-309`).
- Skills copiadas (equipe, onboarding, grilling, grill-me) e o painel não têm cksum e não são sobrescritos sem `--force`.
- `templates/skills/worktree/wt.sh` é copiado sem render.

## Testes
- `tests/run.sh` (detector, render, instalador): sem framework. Escreva `t "descrição" 'condição'` (`tests/run.sh:23`); a condição é string avaliada com `eval`. Helpers: `detect`, `inst`, `has`.
- Roda sob `set -uo pipefail`, sem `-e`: falha de um teste não aborta os seguintes.
- Fixtures geradas por `tests/fixtures.sh`; não versione projetos de exemplo.
- Isole em diretórios temporários: hub, token e notify. Use um npm falso para não instalar o OpenSpec de verdade.
- Painel: `tests/*.test.mjs`, um por módulo.
- Rodar tudo: `make test` (hoje 124 testes). Não há filtro por seção no `tests/run.sh`.
- Mudou comportamento: teste novo ou ajustado no mesmo commit.

## Commits e branches
- Conventional Commits em pt-BR com escopo: `feat(install)`, `fix(painel)`, `refactor`, `chore`, `docs`.
- Branches de tema: `feat/*`, `fix/*`, `chore/*`, `docs/*`, `refactor/*`.
- Fluxo: tema, `staging`, PR para `main`. A `main` é a versão que o curl instala.
- O CI roda em push na `main` e em PR, não em push na `staging`.

## Checklist de PR
- [ ] `make test` verde.
- [ ] shellcheck sem avisos (comando em `docs/ambiente.md`).
- [ ] `.sh` novo na lista do shellcheck em `.github/workflows/ci.yml`.
- [ ] README e `docs/` atualizados quando o comportamento muda.
- [ ] Derivados regenerados (`--render`) se mexeu em template, sem editar o gerado à mão.
