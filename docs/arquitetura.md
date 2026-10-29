# Arquitetura

Visão geral: instalador em bash que detecta a stack de um projeto e gera a equipe de agentes do Claude Code (agentes, skills, contexto), mais um painel em Node que acompanha o trabalho. Convenções: `docs/padroes.md`. Ambiente: `docs/ambiente.md`.

## Fluxo do `install.sh`
```
fonte (clone ou tarball <AI_TEAM_REPO>@<ref, main por padrão>)   install.sh:45-46,121
   |
   v
lib/detect.sh (só leitura, imprime o conf)
   |
   v
.claude/ai-team.conf  --> .claude/project-context.md
   |
   v
lib/render.sh: templates/agents/*.md, templates/skills/*/SKILL.md --> .claude/
   |
   v
cópia: skills fixas, wt.sh, painel
   |
   v
openspec init --tools claude --> hooks no settings.json --> hub --> notify
```
- `openspec init`: instala `@fission-ai/openspec@1.14.1` com `npm i -g` se faltar (`install.sh:369-396`).
- Hooks: merge só dos que faltam; backup `.bak-ai-team`.
- Flags e modos: cabeçalho e `install.sh:60-78` (`--render`, `--reconfigure`, `--force`, `--yes`, `--set K=V`, `--dry-run`, `--detect-only`). `CI` desliga as perguntas.

## Pastas
- `install.sh`: orquestra o fluxo.
- `lib/detect.sh`: detector (manifestos, Makefile, compose, git, docs, CI).
- `lib/render.sh`: motor de template.
- `templates/`: agentes e skills (com `{{...}}`) e arquivos copiados.
- `scripts/`: utilitários; `scripts/export.sh` exporta agentes de volta a um perfil.
- `dashboard/`: painel e hub em Node.
- `tests/`: `run.sh`, `fixtures.sh`, `*.test.mjs`.
- `docs/`: `painel.md`, `roadmap-painel.md`, `ambiente.md`, estes.
- `profiles/`: não versionado.

## Perfis (`AI_TEAM_PROFILE`)
- `generic`: detecta e renderiza.
- Perfil nomeado: copia `profiles/<nome>/agents/` sem renderizar; ignora `--render`, `--reconfigure` e `--set` (`install.sh:345-362`).
- `scripts/export.sh` faz o caminho inverso; `--agents-only` existe só por compatibilidade.
- O perfil `plato` foi para outra branch (commit `d6ce0b2`).

## Modelo de preservação
- Gerado com cksum: intocado é atualizado; editado só com `--force` (`install.sh:155-176`).
- `project-context.md`: regenera acima de `<!-- ai-team:notas -->`, preserva abaixo (`:298-309`).
- Sem cksum (skills copiadas, painel): não sobrescreve sem `--force` (`:135-145,413-425`).
- `--reconfigure` redetecta e descarta as edições do conf (`:215-227`); `--set` grava no conf (`:236-244`).

## Detector
- Layout `monorepo` se há back e front em pastas diferentes ou workspaces (`lib/detect.sh:454-456`).
- Branch protegida é a padrão quando o trabalho acontece noutra (`:463-465,513`).
- Descrição: 1ª linha de texto do README, cortada em 240 caracteres (`:525-529`).

## Painel e hub (`dashboard/`)
- `server.mjs`: HTTP sem dependências; porta por `PORT`, `--port` ou 4321.
- Fontes: transcripts em `~/.claude/projects/`, `openspec/` e `tasks.md` (a linha `<!-- estado: -->` manda; sem ela vale a heurística de `board.mjs`).
- `hub.mjs`: agrega projetos por time; registro em `~/.config/ai-team/hub.json` ou `$AI_TEAM_HUB`.
- `notify.mjs`: ntfy.
- `ask.mjs`: perguntas e respostas pelo painel; modo "longe do computador" (`away.json`), com o hook Stop segurando o turno até cerca de 55 min.
- `auth.mjs`: token para acesso remoto.
- Hooks: `hook.sh` e `hook.mjs`. Detalhes em `docs/painel.md`.

## Decisões e porquês
- Painel sem dependências npm: instala por cópia, sem `npm install` no projeto alvo (inferido, a confirmar).
- Derivados regeneráveis a partir do conf, com cksum: permite atualizar sem perder edições (visível no código).
- Detecção só leitura e separada da gravação: permite `--detect-only` e `--dry-run`.
- OpenSpec via `openspec init`, com versão fixa: commits `fa70d87` e `21a60c4`; motivo da versão fixa (a confirmar).
- `main` é o que o curl instala; `staging` integra os temas.
- `profiles/` fora do versionamento: (a confirmar o motivo).

## Armadilhas
- Descrição do README cortada no meio, com markdown preservado. Uma change vai tratar.
- Projeto sem pacote reconhecido fica com `HAS_BACKEND=0`, sem dev, e o `templates/skills/worktree/wt.sh:39` recusa a frente. Neste repo foi contornado ligando a frente backend no conf.
- `BACKEND_FRAMEWORK` vazio faz o tech-lead renderizado mostrar `()` (a confirmar).
- Perfil nomeado ignora `--render`, `--reconfigure` e `--set`, sem aviso aparente (a confirmar).
- `.sh` novo esquecido na lista do shellcheck do CI passa sem lint.
