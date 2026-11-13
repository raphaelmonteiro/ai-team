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
OpenSpec home (root or .ai-team/) --> openspec init there --> lite schema --> <home>/openspec/config.yaml --> hooks in settings.json --> hub --> notify
```
- `openspec init`: installs `@fission-ai/openspec@1.14.1` with `npm i -g` if missing (`install.sh:369-396`).
- Lite schema (`design.md` is written by the builder during the build; on a large change with frontend tasks the spec-writer leaves a contract draft in it, see README "Proposal critique"): `openspec schema fork spec-driven lite` with the `design` artifact removed (awk) and `openspec schema validate lite`; on failure the folder is removed and the config stays on `spec-driven`. An existing fork is kept (snapshot of the CLI's schema).
- **Footprint in the project.** The team keeps its files out of the project's own tree: `.ai-team/` (versioned: `docs/` with the docs the team creates: lessons, tech-debt, and the onboarding's standards, environment and architecture when the project has none; and `openspec/` unless the team already keeps OpenSpec at the root) `.ai-team/local/` (per machine, ignored: the validator's evidence), and `.claude/` (agents, skills, commands, settings, and `ai-team/`: `dashboard/` versioned, `local/` per machine and ignored, with the hook log, pending decisions and away mode). Claude Code protects the whole `.claude/` folder (every Write/Edit asks, allow rules do not pre-approve it; only `.claude/worktrees/` is exempt), so whatever the agents write lives in `.ai-team/`; `.claude/ai-team/` is written only by the installer, the hooks and `task.sh` (`state.sh` writes only the state line of a change's `tasks.md`, outside `.claude/`). `migrate_claude_layout` moves an older `.claude/dashboard/` and the per-machine files that sat right in `.claude/ai-team/` (evidence goes to `.ai-team/local/evidence/`), rewrites the hook paths in `settings.json` and narrows the `.gitignore` line to `.claude/ai-team/local/`. The onboarding writes a missing `CLAUDE.md` as `.claude/CLAUDE.md`.
- **OpenSpec home (`OPENSPEC_HOME`, conf v3).** Only two homes: `.` (the team's own `openspec/` at the project root) or `.ai-team` (default). `openspec_home_decide` runs before `openspec init`: the conf's value wins; without it, a root `openspec/` is the team's, and the installer asks in the terminal whether to keep it or move it (`git mv` when tracked); with no terminal or `--yes` it stays, and `--openspec-move` moves it in a scripted install. A new project gets `.ai-team`, with no question. An `openspec/` inside a package is not used (it would sit in the package's repo next to its worktrees): a warning, and `.ai-team`. `--set OPENSPEC_HOME` is refused, since the key says where the files are. The CLI finds its root only from the folder that holds `openspec/`, so with `.ai-team` the init runs there, `openspec_relocate` moves the skills and commands it writes to the project's `.claude/` with a note to run the CLI from `.ai-team/`, and the agents run `cd .ai-team && openspec …` (`OPENSPEC_IN_AITEAM`); paths in the templates come from `OPENSPEC_DIR`. The m3 migration gives an existing conf `.` when the project has a root `openspec/`, so a reinstall never moves it. The dashboard reads the key (`changesBase` in `board.mjs`, shown read-only in Settings) and, without it, the first layout that exists.
- `.ai-team/openspec/config.yaml`: rendered from `templates/openspec/config.yaml` (schema, `context`, `rules` per artifact) with a `# ai-team:generated` marker; replaces the stock file `openspec init` writes; also on `--render`.
- Hooks: merges only the missing ones; backup `.bak-ai-team`.
- Conf version: `lib/migrate.sh` holds `AI_TEAM_CONF_VERSION_CURRENT` and one `m<n>` per version; the detector writes the current version, `install.sh` migrates an existing conf before loading it (`--render` and full install; `--dry-run` only prints), `--check` reports what is behind without writing. `dashboard/version.mjs` repeats the number as `CONF_VERSION` so the installed dashboard can warn when it is older than the conf (a test keeps the two equal).
- Flags and modes: header and `install.sh:60-78` (`--render`, `--reconfigure`, `--force`, `--yes`, `--set K=V`, `--dry-run`, `--detect-only`). `CI` turns the prompts off.

## Folders
- `install.sh`: orchestrates the flow.
- `lib/detect.sh`: detector (manifests, Makefile, compose, git, docs, CI).
- `lib/render.sh`: template engine.
- `templates/`: agents and skills (with `{{...}}`) and copied files.
- `scripts/`: utilities; `scripts/export.sh` exports agents back to a profile; `scripts/mascot.mjs` draws the mascot: the walking live mark (an inline `<symbol>`, `--symbol`, pasted into `index.html` and `hub.html`) and the favicon (`--favicon-url`, pasted into the pages' `<head>`).
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
- Generated with cksum (HTML comment in Markdown, `#` comment in `.ai-team/openspec/config.yaml`): untouched is updated; edited only with `--force` (`install.sh:155-176`).
- The `/team` and `/onboarding` skills are copied as they are (not rendered) but get the same marker, so an untouched copy follows the source and an edited one is kept. A copy from before the marker counts as untouched when its cksum matches a published version (`SKILL_SUMS_TEAM` / `SKILL_SUMS_ONBOARDING` in `install.sh`; a test fails until the current version's cksum is appended). The installer also keeps its backups (`.claude/ai-team.conf.bak-ai-team`, `.claude/settings.json.bak-ai-team`) out of git through `.gitignore`.
- `project-context.md`: regenerates above `<!-- ai-team:notes -->`, preserves below (`:298-309`).
- Without cksum (copied skills, dashboard): not overwritten without `--force` (`:135-145,413-425`).
- `--reconfigure` re-detects and discards conf edits (`:215-227`); `--set` writes to the conf (`:236-244`).

## Detector
- `monorepo` layout if back and front are in different folders or there are workspaces (`lib/detect.sh:454-456`).
- The protected branch is the default one when work happens on another (`:463-465,513`).
- Description: first text line of the README, cut at 240 characters (`:525-529`).
- `DOCS_LESSONS` defaults to `.ai-team/docs/lessons.md` (the file may not exist yet); a `lessons.md`/`licoes.md` in the root docs or in `.ai-team/docs/` sets it and never lands in `DOCS_OTHER`.

## Dashboard and hub (`dashboard/`)
- `server.mjs`: HTTP with no dependencies; port from `PORT`, `--port` or 4321.
- `live.mjs`: real-time context for one project (`fs.watch` + SSE + 5 s polling). Keeps the last computed state: one computation per change, `GET /api/state` serves the stored one while a tab is connected and nothing changed; `update` only when the state changes (ignoring `generatedAt`).
- In-process caches in `collect.mjs` (gone when the server restarts): transcripts and `events.jsonl`/`events.jsonl.1` with incremental reads (offset + check of the last bytes), per project context; and the `cwd` of the other folders in `~/.claude/projects` (`findProjectDirs`: only the start of the transcript, up to 1 MiB; per `claudeDir`, shared between hub projects; invalidated by a shrunk/replaced/removed file and by the folder's `mtime`). A warm collect with no change reads 0 bytes of `.jsonl` (tests `tests/projectdirs.test.mjs`, `cache.test.mjs`).
- `make bench` (`scripts/bench-collect.mjs`, outside `dashboard/` because the installer copies that folder): cold collect and median of 20 warm ones on a ~75 MB synthetic fixture, or on a real project (`make bench ARGS="--project P --claude-dir C"`). On demand only, outside `make test`.
- `hook.mjs` rotates `events.jsonl` once it exceeds `AI_TEAM_EVENTS_MAX_BYTES` (1 MiB): see `docs/dashboard.md`, "Hooks".
- Sources: transcripts in `~/.claude/projects/`, `.ai-team/openspec/` and `tasks.md` (the `<!-- state: -->` line wins; without it the `board.mjs` heuristic applies).
- `hub.mjs`: groups projects by team; registry at `~/.config/ai-team/hub.json` or `$AI_TEAM_HUB`.
- `notify.mjs`: ntfy.
- `ask.mjs`: questions and answers through the dashboard; "away from the computer" mode (`away.json`), with the Stop and PermissionRequest hooks waiting for up to about 24 h; a question whose wait ran out stays listed read-only (`expired`).
- `auth.mjs`: token for remote access.
- Hooks: `hook.sh` and `hook.mjs`; `guard.mjs` is the `PreToolUse` guard of the team's subagents. Details in `docs/dashboard.md`.

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
