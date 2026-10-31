# Architecture

Overview: a bash installer that detects a project's stack and generates the Claude Code agent team (agents, skills, context), plus a Node dashboard that follows the work. Conventions: `docs/standards.md`. Environment: `docs/environment.md`.

## `install.sh` flow
```
source (clone or tarball <AI_TEAM_REPO>@<ref, main by default>)   install.sh:45-46,121
   |
   v
lib/detect.sh (read-only, prints the conf)
   |
   v
.claude/ai-team.conf  --> .claude/project-context.md
   |
   v
lib/render.sh: templates/agents/*.md, templates/skills/*/SKILL.md --> .claude/
   |
   v
copy: fixed skills, wt.sh, dashboard
   |
   v
openspec init --tools claude --> hooks in settings.json --> hub --> notify
```
- `openspec init`: installs `@fission-ai/openspec@1.14.1` with `npm i -g` if missing (`install.sh:369-396`).
- Hooks: merges only the missing ones; backup `.bak-ai-team`.
- Flags and modes: header and `install.sh:60-78` (`--render`, `--reconfigure`, `--force`, `--yes`, `--set K=V`, `--dry-run`, `--detect-only`). `CI` turns the prompts off.

## Folders
- `install.sh`: orchestrates the flow.
- `lib/detect.sh`: detector (manifests, Makefile, compose, git, docs, CI).
- `lib/render.sh`: template engine.
- `templates/`: agents and skills (with `{{...}}`) and copied files.
- `scripts/`: utilities; `scripts/export.sh` exports agents back to a profile.
- `dashboard/`: dashboard and hub in Node.
- `tests/`: `run.sh`, `fixtures.sh`, `*.test.mjs`.
- `docs/`: `dashboard.md`, `dashboard-roadmap.md`, `environment.md`, `tech-debt.md`, these.
- `profiles/`: not versioned.

## Profiles (`AI_TEAM_PROFILE`)
- `generic`: detects and renders.
- Named profile: copies `profiles/<name>/agents/` without rendering; ignores `--render`, `--reconfigure` and `--set` (`install.sh:345-362`).
- `scripts/export.sh` goes the other way; `--agents-only` exists only for compatibility.
- The `plato` profile moved to another branch (commit `d6ce0b2`).

## Preservation model
- Generated with cksum: untouched is updated; edited only with `--force` (`install.sh:155-176`).
- `project-context.md`: regenerates above `<!-- ai-team:notes -->`, preserves below (`:298-309`).
- Without cksum (copied skills, dashboard): not overwritten without `--force` (`:135-145,413-425`).
- `--reconfigure` re-detects and discards conf edits (`:215-227`); `--set` writes to the conf (`:236-244`).

## Detector
- `monorepo` layout if back and front are in different folders or there are workspaces (`lib/detect.sh:454-456`).
- The protected branch is the default one when work happens on another (`:463-465,513`).
- Description: first text line of the README, cut at 240 characters (`:525-529`).

## Dashboard and hub (`dashboard/`)
- `server.mjs`: HTTP with no dependencies; port from `PORT`, `--port` or 4321.
- `live.mjs`: real-time context for one project (`fs.watch` + SSE + 5 s polling). Keeps the last computed state: one computation per change, `GET /api/state` serves the stored one while a tab is connected and nothing changed; `update` only when the state changes (ignoring `generatedAt`).
- In-process caches in `collect.mjs` (gone when the server restarts): transcripts and `events.jsonl`/`events.jsonl.1` with incremental reads (offset + check of the last bytes), per project context; and the `cwd` of the other folders in `~/.claude/projects` (`findProjectDirs`: only the start of the transcript, up to 1 MiB; per `claudeDir`, shared between hub projects; invalidated by a shrunk/replaced/removed file and by the folder's `mtime`). A warm collect with no change reads 0 bytes of `.jsonl` (tests `tests/projectdirs.test.mjs`, `cache.test.mjs`).
- `make bench` (`scripts/bench-collect.mjs`, outside `dashboard/` because the installer copies that folder): cold collect and median of 20 warm ones on a ~75 MB synthetic fixture, or on a real project (`make bench ARGS="--project P --claude-dir C"`). On demand only, outside `make test`.
- `hook.mjs` rotates `events.jsonl` once it exceeds `AI_TEAM_EVENTS_MAX_BYTES` (1 MiB): see `docs/dashboard.md`, "Hooks".
- Sources: transcripts in `~/.claude/projects/`, `openspec/` and `tasks.md` (the `<!-- state: -->` line wins; without it the `board.mjs` heuristic applies).
- `hub.mjs`: groups projects by team; registry at `~/.config/ai-team/hub.json` or `$AI_TEAM_HUB`.
- `notify.mjs`: ntfy.
- `ask.mjs`: questions and answers through the dashboard; "away from the computer" mode (`away.json`), with the Stop hook holding the turn for up to about 55 min.
- `auth.mjs`: token for remote access.
- Hooks: `hook.sh` and `hook.mjs`. Details in `docs/dashboard.md`.

## Decisions and whys
- Dashboard with no npm dependencies: installs by copying, no `npm install` in the target project (inferred, to be confirmed).
- Derived files regenerable from the conf, with cksum: allows updating without losing edits (visible in the code).
- Detection is read-only and separate from writing: enables `--detect-only` and `--dry-run`.
- OpenSpec via `openspec init`, with a pinned version: commits `fa70d87` and `21a60c4`; reason for the pinned version (to be confirmed).
- `main` is what curl installs; `staging` integrates the topics.
- `profiles/` not versioned: (reason to be confirmed).

## Pitfalls
- README description cut mid-sentence, with markdown kept. A change will handle it.
- A project with no recognized package gets `HAS_BACKEND=0`, no dev, and `templates/skills/worktree/wt.sh:39` refuses the front. In this repo it was worked around by enabling the backend front in the conf.
- An empty `BACKEND_FRAMEWORK` makes the rendered orchestrator show `()` (to be confirmed).
- A named profile ignores `--render`, `--reconfigure` and `--set`, with no apparent warning (to be confirmed).
- A new `.sh` forgotten in the CI shellcheck list passes without lint.
