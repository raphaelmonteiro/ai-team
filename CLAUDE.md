# ai-team-dogfood

O ai-team (instalador bash + painel Node que monta uma equipe de agentes do Claude Code) instalado em si mesmo.

## Comandos do dia a dia
- `make test`: testes (`tests/run.sh`).
- shellcheck: lint do gate; nesta máquina só via Docker, ver `docs/ambiente.md`.
- `make dry` / `make detect`: simula a instalação / só imprime o conf detectado.
- `make render`: regenera os derivados a partir de `.claude/ai-team.conf`.
- `make dashboard`: sobe o painel deste projeto.
- `./install.sh --render --set K=V .`: grava uma chave no conf e re-renderiza (sempre pelo clone local, nunca pelo curl).

## Onde fica cada coisa
- `install.sh`: orquestra detecção, render, cópia, OpenSpec e hooks.
- `lib/`: `detect.sh` (detector, só leitura) e `render.sh` (motor de template).
- `templates/`: agentes, skills e `project-context.md` com `{{...}}`.
- `dashboard/`: painel e hub em Node, sem dependências.
- `tests/`: `run.sh`, `fixtures.sh`, `*.test.mjs`.
- `scripts/`: utilitários (`export.sh`).

## Docs (quando ler)
- `.claude/project-context.md`: antes de qualquer trabalho (contexto, glossário, decisões).
- `docs/padroes.md`: ao escrever ou revisar código.
- `docs/ambiente.md`: ao rodar gate, lint ou ambiente local.
- `docs/arquitetura.md`: ao mexer no fluxo do instalador, preservação ou detector.
- `docs/painel.md`: ao mexer no painel, hub, hooks ou notificações.
- `docs/roadmap-painel.md`: ao planejar trabalho novo no painel.

## Lembrete
`.claude/agents/` são gerados: edite `templates/` e re-renderize (`make render`).
