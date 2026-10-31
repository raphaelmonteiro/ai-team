# Environment (ai-team-dogfood)

## Confirmed facts

### Requirements
- bash 3.2+ (macOS compatible; `install.sh`, `lib/`, `scripts/`, `tests/`).
- Node 18+ (dashboard and hooks; no npm dependencies). CI tests 18 and 24 (`.github/workflows/ci.yml`).
- shellcheck 0.11.0 native at `/usr/local/bin/shellcheck` (gate lint; official arm64 binary from koalaman/shellcheck's GitHub).
- openspec CLI 1.14.1 (`OPENSPEC_TESTED` in `install.sh`): `install.sh` installs it via npm when missing.
- No database, no Docker, no `.env`: there is no Docker Compose in this repo.

### Makefile targets (`Makefile`)
- `make test`: `tests/run.sh` (124 tests for detector, renderer, installer and dashboard).
- `make install` / `dry` / `detect` / `render`: call `./install.sh` (`TARGET` defaults to `.`, extra `ARGS`).
- `make export PROFILE=name`: `scripts/export.sh`.
- `make dashboard`: `node dashboard/server.mjs --project $(TARGET)`.
- `make hub HUB=file`: `node dashboard/server.mjs --hub $(HUB)`.

### Dashboard and hub
- Default port 4321; change with `PORT` or `--port`. Default host 127.0.0.1 (`--host`). See `dashboard/server.mjs`.
- Hub: `--hub [FILE]`; registry at `~/.config/ai-team/hub.json` (or `$XDG_CONFIG_HOME/ai-team/hub.json`; `$AI_TEAM_HUB` or the installer's `--hub` override it).
- Dashboard docs: `docs/dashboard.md`, `docs/dashboard-roadmap.md`.

### Environment variables (names read in `dashboard/*.mjs` and `install.sh`)
- Dashboard: `PORT`, `AI_TEAM_PROJECT`, `AI_TEAM_STALE_MIN`, `AI_TEAM_IDLE_MS`, `CLAUDE_CONFIG_DIR`, `AI_TEAM_HUB`.
- Hooks/questions/notifications: `CLAUDE_PROJECT_DIR`, `AI_TEAM_ASK` (`0` disables), `AI_TEAM_ASK_WAIT_S`, `AI_TEAM_AWAY_WAIT_S`, `AI_TEAM_NOTIFY` (`0` disables), `AI_TEAM_NOTIFY_FILE`.
- Token: `AI_TEAM_TOKEN`, `AI_TEAM_TOKEN_FILE`.
- Installer: `AI_TEAM_REPO` (curl source), `AI_TEAM_HUB`, `XDG_CONFIG_HOME`.
- Tests isolate notify, token and hub (see the top of `tests/run.sh`).

### CI (`.github/workflows/ci.yml`)
- Triggers on push to `main` and on pull requests. Does not run on push to `staging`.
- Job `test`: `tests/run.sh` on ubuntu and macos, Node 18 and 24.
- Job `shellcheck` (ubuntu): `shellcheck -S warning install.sh lib/*.sh scripts/*.sh dashboard/hook.sh templates/skills/worktree/wt.sh tests/*.sh`.

### `.shellcheckrc`
- Disables `SC2034`, `SC1090`, `SC1091` (detector/conf variables read by name; dynamic `source`).

### Gate (backend front = whole repo)
1. `make test` (exit 0).
2. `shellcheck -S warning install.sh lib/*.sh scripts/*.sh dashboard/hook.sh templates/skills/worktree/wt.sh tests/*.sh` (exit 0).
- One at a time; work branch `staging`, protected `main`.

### Re-rendering the team
- Always from the local clone: `./install.sh --yes --render [--set KEY=value ...] .` (each `--set` takes one pair; repeatable).
- Never `--reconfigure` or `--force`; never curl here (the clone is the source; `main` only takes what `staging` already integrated).

## Known workarounds
- The shellcheck file list in `ci.yml` is maintained by hand: a new `.sh` file must be added there, to the gate and to `BACKEND_CMD_LINT` in `.claude/ai-team.conf`.
- `openspec/` and `.claude/` stay local-only in this repo (user decision; not committed).
- `--render` from the local clone, not from `main`.
- `brew install shellcheck` failed on 2026-10-29: the machine is Apple Silicon (arm64, verified with `file` and `uname -m`); the hypothesis of an Intel (x86_64) Homebrew via Rosetta was reported by the user, not verified by command; building from source breaks with "could not find a working compiler". It is not an Intel Mac. Solved by installing the official arm64 binary in `/usr/local/bin`. Optional alternative: `docker run --rm -v "$PWD:/mnt" -w /mnt koalaman/shellcheck:stable -S warning <files>`.

## Recent findings
- 2026-10-29, provisioner/onboarding: `brew install shellcheck` fails (source build, no working compiler; outdated CLT). Cause verified in brew's output. Workaround: shellcheck Docker image (exit 0, no warnings). Root-cause fix needed: yes. (Superseded by the next finding: the "Intel Mac/CLT" diagnosis was wrong.)
- 2026-10-29, provisioner/shellcheck-nativo: shellcheck 0.11.0 installed natively (official arm64 binary at `/usr/local/bin/shellcheck`, confirmed with `file`: Mach-O arm64; `uname -m` = arm64). Diagnosis corrected: the machine is Apple Silicon, not an Intel Mac (verified). Intel Homebrew via Rosetta as the cause of the `brew install` failure: reported by the user, not verified by command. Root-cause fix needed: no.
