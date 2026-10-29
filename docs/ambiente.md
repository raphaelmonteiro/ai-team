# Ambiente (ai-team-dogfood)

## Fatos confirmados

### Requisitos
- bash 3.2+ (compatível com o macOS; `install.sh`, `lib/`, `scripts/`, `tests/`).
- Node 18+ (painel e hooks; sem dependências npm). CI testa 18 e 24 (`.github/workflows/ci.yml`).
- shellcheck (lint do gate; ver "Contornos conhecidos" sobre a instalação).
- openspec CLI 1.14.1 (`OPENSPEC_TESTED` em `install.sh`): o `install.sh` instala via npm quando falta.
- Sem banco, sem Docker, sem `.env`: não há Docker Compose neste repo.

### Alvos do Makefile (`Makefile`)
- `make test`: `tests/run.sh` (124 testes do detector, renderizador, instalador e painel).
- `make install` / `dry` / `detect` / `render`: chamam `./install.sh` (`TARGET` padrão `.`, `ARGS` extra).
- `make export PROFILE=nome`: `scripts/export.sh`.
- `make dashboard`: `node dashboard/server.mjs --project $(TARGET)`.
- `make hub HUB=arquivo`: `node dashboard/server.mjs --hub $(HUB)`.

### Painel e hub
- Porta padrão 4321; muda por `PORT` ou `--port`. Host padrão 127.0.0.1 (`--host`). Ver `dashboard/server.mjs`.
- Hub: `--hub [ARQUIVO]`; registro em `~/.config/ai-team/hub.json` (ou `$XDG_CONFIG_HOME/ai-team/hub.json`; `$AI_TEAM_HUB` ou `--hub` do instalador sobrescrevem).
- Docs do painel: `docs/painel.md`, `docs/roadmap-painel.md`.

### Variáveis de ambiente (nomes lidos em `dashboard/*.mjs` e `install.sh`)
- Painel: `PORT`, `AI_TEAM_PROJECT`, `AI_TEAM_STALE_MIN`, `AI_TEAM_IDLE_MS`, `CLAUDE_CONFIG_DIR`, `AI_TEAM_HUB`.
- Hooks/perguntas/notificação: `CLAUDE_PROJECT_DIR`, `AI_TEAM_ASK` (`0` desliga), `AI_TEAM_ASK_WAIT_S`, `AI_TEAM_AWAY_WAIT_S`, `AI_TEAM_NOTIFY` (`0` desliga), `AI_TEAM_NOTIFY_FILE`.
- Token: `AI_TEAM_TOKEN`, `AI_TEAM_TOKEN_FILE`.
- Instalador: `AI_TEAM_REPO` (origem do curl), `AI_TEAM_HUB`, `XDG_CONFIG_HOME`.
- Os testes isolam notify, token e hub (ver topo de `tests/run.sh`).

### CI (`.github/workflows/ci.yml`)
- Dispara em push na `main` e em pull request. Não roda em push na `staging`.
- Job `test`: `tests/run.sh` em ubuntu e macos, Node 18 e 24.
- Job `shellcheck` (ubuntu): `shellcheck -S warning install.sh lib/*.sh scripts/*.sh dashboard/hook.sh templates/skills/worktree/wt.sh tests/*.sh`.

### `.shellcheckrc`
- Desliga `SC2034`, `SC1090`, `SC1091` (variáveis do detector/conf lidas por nome; `source` dinâmico).

### Gate (frente backend = repo inteiro)
1. `make test` (código 0).
2. `shellcheck -S warning install.sh lib/*.sh scripts/*.sh dashboard/hook.sh templates/skills/worktree/wt.sh tests/*.sh` (código 0).
- Um por vez; branch de trabalho `staging`, protegida `main`.

### Re-renderizar a equipe
- Sempre pelo clone local: `./install.sh --yes --render [--set CHAVE=valor ...] .` (cada `--set` leva um par; repetível).
- Nunca `--reconfigure` nem `--force`; nunca o curl da `main` (atrás da `staging`, sem as skills onboarding, worktree e grilling).

## Contornos conhecidos
- A lista de arquivos do shellcheck no `ci.yml` é feita à mão: arquivo `.sh` novo precisa entrar nela, no gate e em `BACKEND_CMD_LINT` do `.claude/ai-team.conf`.
- `openspec/` e `.claude/` ficam só locais neste repo (decisão do usuário; fora do commit).
- `--render` pelo clone local, não pela `main`.
- `brew install shellcheck` falhou em 2026-10-29: Mac Intel (Tier 3 do Homebrew) sem bottle, build do fonte quebra com "could not find a working compiler" e Command Line Tools desatualizadas. Contorno usado: `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable -S warning <arquivos>`. Correção da causa: atualizar as Command Line Tools (exige sudo/Software Update).

## Achados recentes
- 2026-10-29, devops/onboarding: `brew install shellcheck` falha (build do fonte, sem compilador funcional; CLT desatualizada). Causa verificada na saída do brew. Contorno: imagem Docker do shellcheck (exit 0, sem avisos). Correção da causa necessária: sim.
