# ai-team-dogfood

ai-team (a bash installer plus a Node dashboard that sets up a team of Claude Code agents) installed on itself.

## Everyday commands
- `make test`: tests (`tests/run.sh`).
- shellcheck: gate lint (native, 0.11.0); see `docs/environment.md`.
- `make dry` / `make detect`: simulate the install / only print the detected conf.
- `make render`: regenerate the derived files from `.claude/ai-team.conf`.
- `make dashboard`: start this project's dashboard.
- `./install.sh --render --set K=V .`: write a key to the conf and re-render (always from the local clone, never through curl).

## Where things live
- `install.sh`: orchestrates detection, render, copy, OpenSpec and hooks.
- `lib/`: `detect.sh` (detector, read-only) and `render.sh` (template engine).
- `templates/`: agents, skills and `project-context.md` with `{{...}}`.
- `dashboard/`: dashboard and hub in Node, no dependencies.
- `tests/`: `run.sh`, `fixtures.sh`, `*.test.mjs`.
- `scripts/`: utilities (`export.sh`).

## Docs (when to read)
- `.claude/project-context.md`: before any work (context, glossary, decisions).
- `docs/standards.md`: when writing or reviewing code.
- `docs/environment.md`: when running the gate, lint or the local environment.
- `docs/architecture.md`: when touching the installer flow, preservation or the detector.
- `docs/dashboard.md`: when touching the dashboard, hub, hooks or notifications.
- `docs/dashboard-roadmap.md`: when planning new dashboard work.
- `docs/tech-debt.md`: when handling backlog findings (`DT-<n>`).

## Reminder
`.claude/agents/` is generated: edit `templates/` and re-render (`make render`).
