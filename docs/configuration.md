# Install and configure

[README](../README.md) · **Install and configure** · [How the team works](workflow.md) · [Dashboard](dashboard.md)

The installer reads your project, writes what it found to `.claude/ai-team.conf` and generates the team from that file. To change the team, change the conf and render again: the generated files are not edited by hand.

## Install

```bash
cd my-project
curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash
```

To look before it writes anything:

```bash
curl -fsSL .../install.sh | bash -s -- --detect-only   # prints what the detector understood
curl -fsSL .../install.sh | bash -s -- --dry-run       # shows what it would do
```

With the repo cloned: `./install.sh [options] [project]`, `make install TARGET=~/Sites/project`, `make detect TARGET=...`, `make render TARGET=...`.

<details>
<summary>What the installer does, step by step</summary>

1. `lib/detect.sh` reads `package.json`, `composer.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`/Gradle, `.csproj`, `mix.exs`, Makefile, docker-compose, git (current branch, default branch, nested repos) and docs (`README`, `CLAUDE.md`, `AGENTS.md`, `docs/*.md`).
2. Writes **`.claude/ai-team.conf`** with what it found (shell format, `KEY='value'`).
3. Generates **`.claude/project-context.md`** from the conf: the project sheet every agent reads first.
4. Renders the agents from `templates/agents/*.md` with the conf variables and writes them to `.claude/agents/`. It also renders the `gate-and-commit` skill (gate, commit, `tasks.md` markers, push) and the `worktree` skill (one worktree per change, integration and closing, with the `wt.sh` script), which provisioner, builder and integrator load through the `skills:` frontmatter field: each protocol lives in one place only.
5. Runs `openspec init --tools claude` in the OpenSpec home. A project that already keeps `openspec/` at the root is asked whether to keep it there (the default, and the answer with no terminal or `--yes`) or move it to `.ai-team/openspec/` (`git mv`; `--openspec-move` in a scripted install); any other project gets `.ai-team/openspec/` with no question, and the `openspec-*` skills and `/opsx:*` commands the CLI writes go to the project's `.claude/` with a note to run the CLI from `.ai-team/`. The choice is `OPENSPEC_HOME` in the conf (shown in the dashboard's Settings, never edited there). If the `openspec` CLI does not exist, it first installs the tested version with `npm i -g @fission-ai/openspec@1.14.1`; if it exists, it leaves it alone and only warns when the version differs. Then forks the `lite` schema (`spec-driven` without `design.md`, which the builder writes during the build: a change is planned in proposal → specs → tasks) and renders `openspec/config.yaml` from `templates/openspec/config.yaml`: the schema and the spec-writer's format rules per artifact (Impact map, Edge cases, negative scenarios, tasks sections 0–3), which reach the agent through `openspec instructions`. Copies the `/team` and `/onboarding` skills and the `grilling` and `/grill-me` skills (see ["Decisions"](workflow.md#decisions)); creates `settings.json` (dashboard and `/team` hooks) if it does not exist, or adds only the missing hooks to an existing one.

</details>

## Options

Pass them after `bash -s --` in the remote form, or straight to `./install.sh` from a clone.

| Option | What it does |
|---|---|
| `--set K=V` | Overrides a conf key and writes it to the conf. Repeatable. |
| `--render` | Only regenerates agents and context from the existing conf. |
| `--reconfigure` | Discards the conf and detects everything again. |
| `--check` | Writes nothing: says what is behind this source and which generated files were hand-edited. Exits 1 when something is behind. |
| `--detect-only` | Runs the detector and prints the conf. Writes nothing. |
| `--dry-run` | Shows what it would do. |
| `--force` | Overwrites existing files. The default is to skip and warn. |
| `--yes` | Asks nothing: uses what was detected and the options. |
| `--agents a,b,c` | Installs only these agents. `--no-agents` installs none. |
| `--default-agent X` | Every session starts as agent X. Default: none. |
| `--profile NAME` | Copies the agents under `profiles/NAME` as they are, with no detector. |
| `--no-openspec` | Skips `openspec init` (the `openspec-*` skills and `/opsx:*` commands). |
| `--openspec-move` | Moves a root `openspec/` to `.ai-team/openspec/`. |
| `--no-dashboard` | Skips the dashboard. |
| `--no-settings` | Does not touch `settings.json`. |
| `--hub-team TEAM` | Registers the project in the [hub](dashboard.md#hub), under that team. `--hub FILE` names the registry. |
| `--ntfy-topic T` | Turns on [phone notifications](dashboard.md#phone-notifications) on topic T. |
| `--statusline project\|global\|no` | The optional [status line](#status-line-and-code-mode). |
| `--code-mode global\|no` | Claude Code's experimental [Code Mode](#status-line-and-code-mode). |
| `--max-workers N\|auto\|no` | [Test workers](#test-workers) on this machine. |
| `--ref REF` | Branch or tag of this repo to install from. Default: `main`. |

<details>
<summary>Examples</summary>

```bash
# fix something the detector got wrong (writes to the conf and re-renders)
curl -fsSL .../install.sh | bash -s -- --set BACKEND_BRANCH=develop --set FRONTEND_CMD_LINT='bun run lint:integration'

# agents reply and write change artifacts in Brazilian Portuguese (default: en)
curl -fsSL .../install.sh | bash -s -- --set OUTPUT_LANGUAGE=pt-BR

# the agents integrate on the local working branch and never push (the developer pushes)
curl -fsSL .../install.sh | bash -s -- --render --set GIT_NO_PUSH=1

# only some agents, without openspec init
curl -fsSL .../install.sh | bash -s -- --agents orchestrator,spec-writer,builder --no-openspec

# in another folder, overwriting what already exists, using a tag
curl -fsSL .../install.sh | bash -s -- --force --ref v2.0.0 ~/Sites/other-project

# agents from a profile, exactly as they are in profiles/<name> (no detector)
curl -fsSL .../install.sh | bash -s -- --profile my-profile

# see what would be done
curl -fsSL .../install.sh | bash -s -- --dry-run

# register the project in the hub, in the "payments" team (see "Hub" in docs/dashboard.md)
curl -fsSL .../install.sh | bash -s -- --hub-team payments
```

</details>

## The conf

`.claude/ai-team.conf` is a shell file (`KEY='value'`) with everything the detector found. Fix what is wrong or empty, by hand or with `--set`, and render:

```bash
curl -fsSL .../install.sh | bash -s -- --render --set OUTPUT_LANGUAGE=pt-BR
```

| Key | What it sets |
|---|---|
| `OUTPUT_LANGUAGE` | The language the agents reply and write in. A BCP-47 tag, default `en`. |
| `BACKEND_BRANCH`, `FRONTEND_BRANCH` | The working branch of each front: commits and integration. |
| `*_PROTECTED_BRANCH` | A branch that takes no commits. |
| `GIT_NO_PUSH` | `1`: the agents integrate on the local working branch and you push. |
| `*_CMD_LINT`, `*_CMD_TEST`, `*_CMD_BUILD` | The gate of each front: what has to pass before code is integrated. |
| `DOCS_STANDARDS` | The standards document the reviewer uses as its yardstick. |
| `DOCS_LESSONS` | The lessons file. Default: `.ai-team/docs/lessons.md`. |
| `BUDGET_SMALL_USD`, `BUDGET_LARGE_USD` | An optional budget per change size, shown in the dashboard. |
| `PRICE_<MODEL>` | Overrides the list price used in the cost estimate. |

The rest of the keys are in the file itself. `OPENSPEC_HOME` is set by the installer and is not changed with `--set`.

<details>
<summary>Branches and push</summary>

**Git keys.** `*_BRANCH` is the working branch (commits and integration); `*_PROTECTED_BRANCH` is the branch that takes no commits (the detector fills it when they differ). When the agents must never push (remote working branch protected, or a push deploys), set `GIT_NO_PUSH=1`: the agents integrate on the local working branch and the developer pushes.

</details>

<details>
<summary>Output language</summary>

**Output language.** `OUTPUT_LANGUAGE` (a BCP-47 tag, default `en`) sets the language the agents use to reply to you and to write change artifacts (proposal, specs, design, tasks, reports). Protocol markers (`<!-- state: … -->`, `Result: APPROVED`, `Ad-hoc task:`, section titles) and file names stay in English whatever the language, so the dashboard parses them the same way. Change it with `install.sh --render --set OUTPUT_LANGUAGE=pt-BR`.

</details>

### What the detector cannot see

The detector gets the stack, the commands and the branches right in most projects, but it does not know business rules or process conventions. Two ways to fill them in:

- Run [`/onboarding`](workflow.md#onboarding) and the team investigates the project and writes it down.
- Write it yourself in `.claude/project-context.md`, below the `<!-- ai-team:notes -->` marker. That part is preserved; the part above is regenerated from the conf.

## What gets installed

```
.claude/
├── ai-team.conf           what the detector found, plus your adjustments
├── project-context.md     the project sheet every agent reads first
├── agents/                the team, one Markdown file per agent
├── skills/                /team, /onboarding, /dream, /grill-me and the protocols the agents load
├── commands/opsx/         the OpenSpec commands
├── settings.json          the hooks of the dashboard and of /team
└── ai-team/dashboard/     the dashboard and the hooks
.ai-team/
├── openspec/              specs, changes and reports
└── docs/                  what the team writes: lessons, tech debt
```

An API-only project (FastAPI, Go, NestJS with no front) gets no `integrator`, and the validator checks through the API. A project with a meta-framework (Next, Nuxt, Laravel + Inertia) gets both devs in the same package.

The team stays out of the project's own tree: besides `.claude/`, it writes only to `.ai-team/` at the root (one hidden folder), never to the root or to the packages' folders; a team that already keeps `openspec/` at the root keeps it there unless it chooses to move it. Docs the project already has are read and completed where they are.

<details>
<summary>The full tree</summary>

```
.claude/
├── ai-team.conf               what the detector found + your adjustments
├── project-context.md         project sheet (generated) + your notes
├── settings.json              dashboard and /team hooks; "agent" only with --default-agent
├── agents/
│   ├── orchestrator.md        orchestrates; does not implement (Opus, medium)
│   ├── spec-writer.md         creates/validates/archives OpenSpec changes (Sonnet; Opus on large changes; xhigh)
│   ├── provisioner.md         local environment, containers, OpenSpec (Sonnet, medium)
│   ├── builder.md             API from the specs; writes design.md (Sonnet, high)  [if there is a backend]
│   ├── integrator.md          screens and API integration (Sonnet, high)           [if there is a frontend]
│   ├── reviewer.md            reviews recorded commits; only writes review-report.md (Opus, high)
│   └── validator.md           validates scenarios through the UI or the API; only writes validation-report.md (Sonnet, medium)
├── skills/
│   ├── team/                  /team: the current session starts acting as orchestrator
│   ├── onboarding/            /onboarding: the team investigates the project and records context, standards and environment
│   ├── dream/                 /dream: consolidates the lessons and the environment doc into a diff you approve
│   ├── gate-and-commit/       generated: gate/commit/push protocol of the fronts (not shown as a /command)
│   ├── worktree/              generated: SKILL.md + wt.sh (open, where, integrate, close the change's worktree)
│   ├── grilling/              round-based interview about a plan; loaded by the spec-writer (mattpocock/skills, MIT)
│   ├── grill-me/              /grill-me: runs grilling in a conversation of yours, outside the cycle
│   └── openspec-*/            generated by the `openspec init` the installer runs
├── rules/ai-team-lessons*.md  generated from the lessons file; they load when an agent opens that front's code
├── worktrees/<id>/            worktree of each change in progress (outside git: .git/info/exclude)
├── commands/opsx/             /opsx:propose, apply, archive, explore, sync, update
└── ai-team/
    ├── dashboard/             dashboard and hooks (--no-dashboard: only hook.sh and hook.mjs)
    │   ├── server.mjs         dashboard and hub server; collect/board/plan/stages/feed.mjs build the state
    │   ├── hook.sh, hook.mjs  hooks: agent start and end, team session, reminder after compaction (session and subagents)
    │   ├── guard.mjs          PreToolUse: refuses what each team role may not do (git discards, add -A, writes outside its report)
    │   ├── ask.mjs            decisions through the dashboard (PermissionRequest hook and away mode)
    │   ├── notify.mjs         phone notifications (ntfy)
    │   ├── launch.mjs         sessions from the dashboard: a read-only question, a background session, a message to one
    │   ├── thread.mjs         the conversation of a session in the page (what it was asked, what it answered)
    │   ├── auth.mjs           token for access from outside the machine
    │   ├── settings.mjs       adds the missing hooks to an existing settings.json (also statusLine / env)
    │   ├── statusline.sh      the optional status line (--statusline)
    │   └── *.html             pages: dashboard, Team, Notifications, hub
    └── local/                 created by the hooks, per machine (outside git)
        ├── events.jsonl       hook log
        ├── pending/           decisions waiting for an answer
        └── away.json          away-from-the-computer mode on
.ai-team/
├── openspec/                  specs, changes and reports (a project that already keeps openspec/ at the root keeps it there)
├── docs/                      what the team writes: lessons, tech debt, and the onboarding's docs when the project has none
└── local/                     per machine (outside git): the validator's evidence and the /dream staging
```

</details>

### What to commit

- **Yes**: `.claude/agents/`, `.claude/skills/`, `.claude/commands/`, `.claude/ai-team.conf`, `.claude/project-context.md`, `.claude/settings.json`, `.claude/ai-team/dashboard/` and `.ai-team/` (the docs the team writes and, unless the team keeps OpenSpec at the root, specs, changes and reports). Whoever clones the project gets the same team, and the `/onboarding` record applies to everyone.
- **No** (in `.gitignore`): `.claude/ai-team/local/` (hook log, pending decisions and "away from the computer" mode) and `.ai-team/local/` (the validator's screenshots), all per machine, `.claude/settings.json.bak-ai-team` (copy made by the installer) and `.claude/settings.local.json` (personal Claude Code settings).

### Shared or per machine

| Where | What | Who sees it |
|---|---|---|
| `.claude/ai-team.conf`, `project-context.md`, `agents/`, `skills/`, `settings.json`, `dashboard/` (in git) | stack, branches, gate commands, docs, output language, prices and budgets, the rendered team | everyone who clones the project |
| `~/.config/ai-team/notify.json` | ntfy topic, token and which events reach your phone | this machine |
| `~/.config/ai-team/token` | the dashboard's token for access from outside the machine | this machine |
| `~/.config/ai-team/hub.json` | the projects and teams of your hub | this machine |
| `~/.config/ai-team/statusline.sh`, `~/.claude/settings.json` | the status line and Code Mode, when you choose global (`--statusline global`, `--code-mode global`) | this machine |
| `.claude/settings.local.json` (ignored by git) | `AI_TEAM_MAX_WORKERS`: how many test workers this machine takes | this checkout |
| `.claude/ai-team/local/` (ignored by git) | hook log, pending decisions, away mode, budget notices | this checkout |

## Updating

```bash
./install.sh --check ~/Sites/project     # from a clone: says what is behind, writes nothing
./install.sh --render ~/Sites/project    # conf, agents and context
./install.sh ~/Sites/project             # the dashboard and the hooks too
```

Generated files end with `<!-- ai-team:generated cksum=… -->`. If you did not edit them, a new `--render` updates them on its own; if you did, the installer warns and only overwrites with `--force`. `--reconfigure` discards the conf and detects everything again.

<details>
<summary>How an update works</summary>

**Updating an installed project.** `./install.sh --check <project>` (from the clone; writes nothing) says whether the installed dashboard and the conf are behind this source and which generated files were hand-edited, and exits 1 when something is behind, so it fits a CI job or a cron. Then `install.sh --render` (conf, agents and context) or a full `install.sh` (dashboard and hooks too). The conf carries `AI_TEAM_CONF_VERSION`: when a key is added or renamed, `lib/migrate.sh` brings an older conf to the current shape before rendering (a copy stays in `ai-team.conf.bak-ai-team`), so a template never renders with a key silently missing. The dashboard warns on its page when its copy is older than the conf, or the conf older than it.

</details>

## Machine settings

### Test workers

Jest and Vitest start about one worker per core, which a machine with many cores and little memory cannot hold. The installer limits them: the detected test command gets `--maxWorkers=${AI_TEAM_MAX_WORKERS:-4}` and the number for this machine goes to `.claude/settings.local.json`, out of git. Change it there or with `--max-workers N|auto|no`.

<details>
<summary>How the number is computed, and what is left alone</summary>

**Test workers.** Jest and Vitest start about one worker per core, which a machine with many cores and little memory cannot hold (28 cores and 15 GB: the gate ran it out of memory). The detector adds `--maxWorkers=${AI_TEAM_MAX_WORKERS:-4}` to the test command, and the installer writes the machine's number to `.claude/settings.local.json`, never to the conf, which other machines share. The number is (memory in GB − 6) ÷ 2, from 1 to one less than the cores, computed once and then kept; change it there or with `--max-workers N|auto|no`. Where it is not set, the gate uses 4. Left alone: a script that is not one plain Jest or Vitest call, Vitest before 3 (the flag fails there), Makefile targets, and a project whose script or runner config already sets its workers. On a conf from before this, `install.sh` and `--render` print the `--set` that adds the limit and change nothing. Run the gate outside Claude Code and it uses 4, unless `AI_TEAM_MAX_WORKERS` is in your shell.

</details>

### Status line and Code Mode

Two optional Claude Code settings. The installer asks about each one once; `--yes` asks nothing.

- **Status line** (`--statusline project|global|no`): a line under the prompt with the project, the branch (and whether it is a worktree), model and effort, context used and the minutes left on the prompt cache, e.g. `myapp · ⎇ feat/login (worktree) · Opus 5.5 medium · ctx 34% · cache 42m`. `project` writes it to `.claude/settings.json` (everyone who works on the project; it wins over a personal one there), `global` to your `~/.claude/settings.json` with the script in `~/.config/ai-team/`. A `statusLine` already in the target file is kept. Script: `dashboard/statusline.sh` (jq, or node).
- **Code Mode** (`--code-mode global|no`): Claude Code's experimental mode where Claude writes JavaScript that makes several tool calls in one step (each still goes through permissions and hooks). Claude Code ignores `CLAUDE_CODE_EXPERIMENTAL_CODE_MODE` in project settings, so it only goes in `~/.claude/settings.json` and applies to all your projects; `0` there turns it off and the installer does not ask again.

## Supported stacks

| Area | Sources |
|---|---|
| Layout | single package, `backend/`+`frontend/`, `apps/*`, `packages/*`, `services/*`, workspaces (pnpm/yarn/npm, turbo, nx, lerna); nested git repos with their own branch |
| Node | NestJS, Express, Fastify, Hono, Koa, Adonis; React, Vue, Angular, Svelte, Solid; Next, Nuxt, Remix, SvelteKit, Astro, TanStack Start; Prisma, TypeORM, Drizzle, Mongoose, Sequelize, MikroORM; Jest, Vitest, Mocha, Playwright, Cypress; pnpm/yarn/bun/npm/deno |
| PHP | Laravel, Symfony, Slim, CakePHP, CodeIgniter; PHPUnit, Pest, Pint, php-cs-fixer, PHPStan/Larastan, Psalm |
| Python | FastAPI, Django, Flask, Litestar; SQLAlchemy, SQLModel, Tortoise; pytest, ruff, black, flake8, mypy, pyright; uv/poetry/pipenv/pdm/pip |
| Go, Rust, Ruby, JVM, .NET, Elixir | Gin/Echo/Fiber/Chi, Axum/Actix/Rocket, Rails/Sinatra, Spring Boot/Quarkus/Ktor, ASP.NET, Phoenix, with each ecosystem's standard commands |
| Commands | `package.json`/`composer.json` scripts, Makefile targets (take priority), tools declared in the dependencies |
| Git | current and default branch per repository; protected branch = the default one when work happens on another |
| Docs | `CLAUDE.md`/`AGENTS.md` (context), `*standards*`/`*padroes*`/`CONTRIBUTING` (review yardstick), `*environment*`/`*ambiente*`/`*setup*` (environment), `*architecture*`/`*arquitetura*`/`adr*` (decisions) |
| Infra | docker-compose, Dockerfiles, root Makefile, CI (GitHub Actions, GitLab, Bitbucket, CircleCI, Jenkins, pre-commit, husky), `openspec/` |

## Requirements

- bash 3.2+ (macOS works), curl, tar, awk, git (remote installer)
- Node 18+ (dashboard and hooks; `hook.sh` also looks for node in nvm, volta, fnm, Homebrew and `/usr/local`, or uses `AI_TEAM_NODE`. Without node the hooks do nothing, including the `/team` and `/onboarding` role reminder after compaction, and the dashboard shows a warning)
- rsync (`scripts/export.sh`)
- `openspec` CLI 1.14.1: the installer installs it with `npm i -g` when missing (in the active Node; with nvm, each Node version has its own globals). If the install fails, the project is left without the `openspec-*` skills and the `/opsx:*` commands, and the installer warns at the end. `--no-openspec` skips all of this

## Troubleshooting

Common warnings on the first install:

- *no gate command detected*: fill in `BACKEND_CMD_LINT/TEST/BUILD` (or create scripts/Makefile targets with those names and run `--reconfigure`).
- *no standards document*: the reviewer uses `docs/standards.md` (or whatever `DOCS_STANDARDS` points to) as the yardstick; without it, it reviews against `design.md` and the conventions visible in the code.
