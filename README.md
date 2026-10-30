# ai-team

A team of Claude Code agents (orchestrator → spec-writer → provisioner → builder → integrator → reviewer → validator), with the OpenSpec skills and commands, installable in any project. The installer **reads the project** (stack, branches, commands, docs, infra) and **configures the agents for it**.

## Getting started

1. **Install** in the project: `curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash` (see below).
2. **Check** `.claude/ai-team.conf`: stack, branches and gate commands. Fix what the detector got wrong and run `install.sh --render`.
3. **Introduce the project to the team**: in a `claude` session, run `/onboarding`. The team investigates the code and records context, standards, environment and architecture.
4. **Ask for work**: `/team <request>`. The orchestrator decides whether it is a change, an ad-hoc task or a question, and delegates.
5. **Follow along** (optional): `node .claude/dashboard/server.mjs` opens the dashboard at http://127.0.0.1:4321/.

## Installing in a project

```bash
cd my-project
curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash
```

What happens:

1. `lib/detect.sh` reads `package.json`, `composer.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `Gemfile`, `pom.xml`/Gradle, `.csproj`, `mix.exs`, Makefile, docker-compose, git (current branch, default branch, nested repos) and docs (`README`, `CLAUDE.md`, `AGENTS.md`, `docs/*.md`).
2. Writes **`.claude/ai-team.conf`** with what it found (shell format, `KEY='value'`).
3. Generates **`.claude/project-context.md`** from the conf: the project sheet every agent reads first.
4. Renders the agents from `templates/agents/*.md` with the conf variables and writes them to `.claude/agents/`. It also renders the `gate-and-commit` skill (gate, commit, `tasks.md` markers, push) and the `worktree` skill (one worktree per change, integration and closing, with the `wt.sh` script), which provisioner, builder and integrator load through the `skills:` frontmatter field: each protocol lives in one place only.
5. Runs `openspec init --tools claude` in the project, which generates the `openspec-*` skills, the `/opsx:*` commands and the `openspec/` folder (the repo keeps no copy). If the `openspec` CLI does not exist, it first installs the tested version with `npm i -g @fission-ai/openspec@1.14.1`; if it exists, it leaves it alone and only warns when the version differs. Copies the `/team` and `/onboarding` skills and the `grilling` and `/grill-me` skills (see "Proposal critique"); creates `settings.json` (dashboard and `/team` hooks) if it does not exist, or adds only the missing hooks to an existing one.

Before writing, see what the detector understood:

```bash
curl -fsSL .../install.sh | bash -s -- --detect-only
```

Variations:

```bash
# fix something the detector got wrong (writes to the conf and re-renders)
curl -fsSL .../install.sh | bash -s -- --set BACKEND_BRANCH=develop --set FRONTEND_CMD_LINT='bun run lint:integration'

# agents reply and write change artifacts in Brazilian Portuguese (default: en)
curl -fsSL .../install.sh | bash -s -- --set OUTPUT_LANGUAGE=pt-BR

# only some agents, without openspec init
curl -fsSL .../install.sh | bash -s -- --agents orchestrator,spec-writer,builder --no-openspec

# in another folder, overwriting what already exists, using a tag
curl -fsSL .../install.sh | bash -s -- --force --ref v2.0.0 ~/Sites/other-project

# agents from a profile, exactly as they are in profiles/<name> (no detector)
curl -fsSL .../install.sh | bash -s -- --profile my-profile

# see what would be done
curl -fsSL .../install.sh | bash -s -- --dry-run

# register the project in the hub, in the "payments" team (see "Hub" below)
curl -fsSL .../install.sh | bash -s -- --hub-team payments
```

With the repo cloned: `./install.sh [options] [project]`, `make install TARGET=~/Sites/project`, `make detect TARGET=...`, `make render TARGET=...`.

## Adjusting after installing

The detector gets stack, commands and branches right in most projects, but it does not know business rules or process conventions. Two places to complete:

- **`.claude/ai-team.conf`** — fix what is wrong or empty (e.g. `BACKEND_CMD_LINT`, `FRONTEND_BRANCH`, `DOCS_STANDARDS`, `TEST_PERSONAS`) and run `install.sh --render`. The gate of each front is derived from the `*_CMD_*` keys at render time.
- **`.claude/project-context.md`** — below the `<!-- ai-team:notes -->` marker write what the detector does not see (business rules, external integrations, personas, open decisions). That section is preserved; the part above is regenerated from the conf.

**Output language.** `OUTPUT_LANGUAGE` (a BCP-47 tag, default `en`) sets the language the agents use to reply to you and to write change artifacts (proposal, specs, design, tasks, reports). Protocol markers (`<!-- state: … -->`, `Result: APPROVED`, `Ad-hoc task:`, section titles) and file names stay in English whatever the language, so the dashboard parses them the same way. Change it with `install.sh --render --set OUTPUT_LANGUAGE=pt-BR`.

Or let the team do it: **`/onboarding`** in a session (see "Onboarding" below).

Generated files end with `<!-- ai-team:generated cksum=… -->`. If you did not edit them, a new `--render` updates them on its own; if you did, the installer warns and only overwrites with `--force`. `--reconfigure` discards the conf and detects everything again.

What to version in the project:

- **Yes**: `.claude/agents/`, `.claude/skills/`, `.claude/commands/`, `.claude/ai-team.conf`, `.claude/project-context.md`, `.claude/settings.json` and `.claude/dashboard/`. Whoever clones the project gets the same team, and the `/onboarding` record applies to everyone.
- **No** (in `.gitignore`): `.claude/ai-team/` (hook log, pending decisions and "away from the computer" mode, all per machine), `.claude/settings.json.bak-ai-team` (copy made by the installer) and `.claude/settings.local.json` (personal Claude Code settings).

Common warnings on the first install:

- *no gate command detected*: fill in `BACKEND_CMD_LINT/TEST/BUILD` (or create scripts/Makefile targets with those names and run `--reconfigure`).
- *no standards document*: the reviewer uses `docs/standards.md` (or whatever `DOCS_STANDARDS` points to) as the yardstick; without it, it reviews against `design.md` and the conventions visible in the code.

## What gets installed

```
.claude/
├── ai-team.conf               what the detector found + your adjustments
├── project-context.md         project sheet (generated) + your notes
├── settings.json              dashboard and /team hooks; "agent" only with --default-agent
├── agents/
│   ├── orchestrator.md        orchestrates; does not implement (Opus)
│   ├── spec-writer.md         creates/validates/archives OpenSpec changes (Opus)
│   ├── provisioner.md         local environment, containers, OpenSpec (Sonnet)
│   ├── builder.md             API from the specs; writes design.md (Sonnet)        [if there is a backend]
│   ├── integrator.md          screens and API integration (Sonnet)                 [if there is a frontend]
│   ├── reviewer.md            reviews recorded commits; only writes review-report.md (Opus)
│   └── validator.md           validates scenarios through the UI or the API; only writes validation-report.md (Sonnet)
├── skills/
│   ├── team/                  /team: the current session starts acting as orchestrator
│   ├── onboarding/            /onboarding: the team investigates the project and records context, standards and environment
│   ├── gate-and-commit/       generated: gate/commit/push protocol of the fronts (not shown as a /command)
│   ├── worktree/              generated: SKILL.md + wt.sh (open, where, integrate, close the change's worktree)
│   ├── grilling/              round-based interview about a plan; loaded by the spec-writer (mattpocock/skills, MIT)
│   ├── grill-me/              /grill-me: runs grilling in a conversation of yours, outside the cycle
│   └── openspec-*/            generated by the `openspec init` the installer runs
├── worktrees/<id>/            worktree of each change in progress (outside git: .git/info/exclude)
├── commands/opsx/             /opsx:propose, apply, archive, explore, sync, update
├── dashboard/                 dashboard and hooks (--no-dashboard: only hook.sh and hook.mjs)
│   ├── server.mjs             dashboard and hub server; collect/board/plan/stages/feed.mjs build the state
│   ├── hook.sh, hook.mjs      hooks: agent start and end, team session, reminder after compaction
│   ├── ask.mjs                decisions through the dashboard (PermissionRequest hook and away mode)
│   ├── notify.mjs             phone notifications (ntfy)
│   ├── auth.mjs               token for access from outside the machine
│   ├── settings.mjs           adds the missing hooks to an existing settings.json
│   └── *.html                 pages: dashboard, Team, Notifications, hub
└── ai-team/                   created by the hooks, per machine (outside git)
    ├── events.jsonl           hook log
    ├── pending/               decisions waiting for an answer
    └── away.json              away-from-the-computer mode on
```

An API-only project (FastAPI, Go, NestJS with no front) gets no `integrator`, and the validator checks through the API. A project with a meta-framework (Next, Nuxt, Laravel + Inertia) gets both devs in the same package.

## One worktree per change

Each change (and each ad-hoc task) is done on the `change/<id>` branch, in a worktree under `.claude/worktrees/`. The main checkout stays on the work branch, free for you. The dev creates the worktree in the first round with `.claude/skills/worktree/wt.sh open <id> <front>` and reuses it in the following ones (finding fix, validation). A package with its own git (nested repo) gets one worktree per repo: `<id>-backend/`, `<id>-frontend/`. The OpenSpec artifacts (`tasks.md`, `design.md`, reports) stay in the main checkout, where the orchestrator and the dashboard read them.

After the review is approved (and the validation, when there is one), the orchestrator asks each dev for the integration: `wt.sh integrate` does a `merge --no-ff` into the main checkout's work branch, the dev runs the gate and pushes, and `wt.sh close` removes the worktree and the local branch. The script refuses to integrate if the main checkout is on another branch or if there is a conflict, and `close` does not remove a front that has not been integrated yet. Backend and frontend in the same repository share the worktree, which is why the change's sections run one at a time.

## Proposal critique

The spec-writer loads the `grilling` skill (copied unchanged from [mattpocock/skills](https://github.com/mattpocock/skills), commit `a496f55`, MIT license in `templates/skills/grilling/LICENSE`). After generating proposal, specs and tasks through OpenSpec, it builds the change's decision tree: what the sources answer it fixes on its own, and what only the user can decide becomes a `D-<n>` in the proposal's "Open decisions" section, with the recommended answer. As a subagent it does not wait for an answer: it hands the round back to the orchestrator, which takes it to the user and passes the answers on; the spec-writer updates the change and returns the next round, until no `D-<n>` remains open. Only then does the proposal go to approval. The adaptation to each role lives in the agents' text (`templates/agents/spec-writer.md`, "Proposal critique"; `orchestrator.md`, "Decision rounds"), not in the skill.

Outside the cycle, `/grill-me` (also copied unchanged) runs the same interview with you in a regular conversation. To update both, copy the `SKILL.md` files again from the source repo and change the commit above. Profile agents (`--profile`) receive the installed skills, but only use them if their text asks for it.

## Calling the team

A regular `claude` session is the usual Claude, for questions and quick tweaks. The team steps in when you ask:

- **`/team <request>`** in the middle of any session: the session reads `.claude/agents/orchestrator.md` and acts as orchestrator until the end, with the same restrictions (coordinates, delegates, does not edit). The role survives compaction in two ways: `/team` is a skill, whose body Claude Code re-injects after compacting, and `hook.sh` marks the session (`UserPromptExpansion`) and, on `SessionStart` with `source: compact`, returns a reminder that goes into the compacted context. It is an instruction, not a real agent: tools are not locked down as with `--agent`.
- **`claude --agent orchestrator`**: the session starts as orchestrator, with the agent's restricted tools.
- **`--default-agent orchestrator`** in the installer: writes `"agent"` to `settings.json` and every session starts as orchestrator (the previous behavior). Projects installed earlier have that key; the installer does not change an existing `settings.json` and warns. To choose per session, remove the key.

The orchestrator classifies each request before starting:

- **Change** (the default): new requirement or behavior, API contract, migration, new screen, more than one front. Follows the OpenSpec cycle below.
- **Ad-hoc task**: a targeted fix with a known cause, configuration, dependency, local refactoring. No change: it delegates straight to the front's owner with `Ad-hoc task: <slug>` on the first line of the prompt; the dev follows branch, commit and gate and returns shas and gate in the reply; if there is a commit, the reviewer reviews those shas and returns the findings in the reply, without `review-report.md`. If it grows, it becomes a change.
- **Question**: it answers by reading the code.

The flow of a change is the same in any project: `tasks.md` with sections 0–3, `<!-- commits -->` and `<!-- gate -->` per section, `design.md` as the only API contract, `review-report.md` → `validation-report.md` → archive, `PV-<n>` for provisional decisions and `R<k>` for findings.

### Onboarding

**`/onboarding [focus]`** makes the team learn the project and record what the detector does not see. The session acts as orchestrator (as with `/team`) and runs an `onboarding` ad-hoc task:

1. **Inventory**: the orchestrator reads what already exists (`CLAUDE.md`, `AGENTS.md`, `README`, `docs/`, `openspec/specs/`, the conf's `DOCS_*`).
2. **Parallel investigation, read-only**: provisioner (environment, CI and the gate: runs each `*_CMD_*` from the conf and says which one fails), builder and integrator (architecture, conventions, tests, pitfalls of the front), spec-writer (domain, glossary, business rules, integrations). Every fact comes with evidence and is marked `confirmed` or `inferred`.
3. **Confirmation**: doubts and contradictions go to the user, together with the writing plan. A file that already exists only gets additions with the user's ok.
4. **Writing, one owner per file**: the provisioner writes `docs/environment.md`, fixes wrong gate commands and the `DOCS_*` keys in the conf and runs `install.sh --render --set …` (never `--reconfigure`); the devs write `docs/standards.md` and `docs/architecture.md`; the spec-writer writes the notes section of `project-context.md` (only below `<!-- ai-team:notes -->`) and a short `CLAUDE.md` pointing to the other files, if it does not exist.
5. **Record**: the spec-writer writes `<!-- ai-team:onboarding done=<date> sha=<HEAD> -->` in the notes (with no `project-context.md`, as in a profile without the detector, at the end of `CLAUDE.md`). Commit only if the user wants, by the provisioner, on the work branch.

The record is the onboarding's memory: it is versioned with the project, survives `--render` and applies to whoever clones it. With it, running `/onboarding` again offers to **update** (only what changed since the sha), redo or cancel. Without it, `/team` offers onboarding before the first request and the installer suggests it at the end. The doc names are the ones the detector already classifies, so a future `--reconfigure` finds them.

## Dashboard: agent effort in real time

```bash
cd my-project
node .claude/dashboard/server.mjs          # http://127.0.0.1:4321/
# or, from the cloned repo: make dashboard TARGET=~/Sites/project
```

The dashboard reads the Claude Code transcripts (`~/.claude/projects/<project>/`) and the project's `openspec/`. It has no dependencies beyond Node 18+ and updates itself. What it offers:

- **Effort per agent**: time, tokens, rounds and models of each agent. Team sessions are kept apart from ad-hoc sessions (plain Claude).
- **Change board**: state of each change and ad-hoc task, who is working now and "waiting for what". Clicking a change shows its rounds with prompt and reply.
- **Decisions waiting for you**: approve or deny permission requests and answer `AskUserQuestion` from the browser. With **away from the computer** on, you can also answer the end-of-turn question.
- **Phone notifications** through [ntfy](https://ntfy.sh): new decision, agent finished, session waiting for you, error.
- **Access from outside the machine** with a token, preferably through Tailscale Serve.
- **Team tab**: the installed agents, how to call the team, the project context and the cycle of a change.

`node .claude/dashboard/collect.mjs` prints the same state in the terminal (`--json` for the full JSON). The full reference (definitions, hooks, routes, `AI_TEAM_*` variables, ntfy and token configuration) is in [`docs/dashboard.md`](docs/dashboard.md).

## Hub: several projects in one dashboard, split by team

```bash
git clone https://github.com/raphaelmonteiro/ai-team ~/ai-team && cd ~/ai-team
./install.sh --hub-team payments ~/Sites/checkout-api       # installs as usual and registers in the hub
./install.sh --hub-team payments ~/Sites/checkout-web
./install.sh --hub-team platform --profile my-profile ~/Sites/backoffice
make hub                                                    # http://127.0.0.1:4321/
```

Each project keeps its own agents, context and gate commands. The hub only reads the projects, with the clone's `collect.mjs` (the same yardstick for all). The registry lives in `~/.config/ai-team/hub.json` (or `$AI_TEAM_HUB`, or `--hub FILE` in the installer and the server):

```json
{ "teams": [ { "id": "payments", "name": "Payments",
               "projects": [ { "id": "checkout-api", "name": "Checkout API", "dir": "~/Sites/checkout-api" } ] } ] }
```

- **Registry.** `--hub-team TEAM` writes `HUB_TEAM` to `ai-team.conf` and registers the project, with the name from `PROJECT_NAME`. Later `--render` runs keep the registry up to date. Without the option, if a hub already exists and there is a terminal, the installer asks for the team and the name (enter skips; `--yes` does not ask). By hand: `node dashboard/hub.mjs add <dir> --team <team> [--name N] [--id ID]`, `remove <id>`, `list`. The hub rereads the file without restarting.
- **Tabs.** `/` shows all teams. `/t/<team>` shows the team's projects and `/t/<team>/<project>` opens the project's dashboard, served at `/p/<id>/` with the same routes as the single-project dashboard.
- **Lightweight.** The overview does not read transcripts: it shows the last activity (`mtime`), the open and archived changes and the installed agents, with a 20 s cache. Only the open project is real-time: the `fs.watch` watchers open with the first client of `/p/<id>/events` and close 60 s after the last one leaves (`AI_TEAM_IDLE_MS`). A project's transcript cache is dropped after 15 min without use.
- **Team tab.** In the hub, the page and the default cycle come from the clone (the same version for all), and the profile's `cycle.html` comes from each project's `.claude/dashboard/`: `/p/<id>/team` shows the profile cycle only in projects installed with it. Old copies of `cycle.html`, with absolute paths, get the `/p/<id>` prefix when served. An old profile copy of the team page (`equipe.html`) in a project is not used by the hub.

## What the detector recognizes

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

## Repo layout

```
install.sh                 orchestrates: detect → conf → context → render → copy
lib/detect.sh              detector (read-only; prints KEY='value')
lib/render.sh              renderer ({{VAR}}, {{#if}}/{{#unless}}/{{else}})
templates/agents/*.md      generic agents with variables
templates/project-context.md
templates/skills/          /team and /onboarding (copied), gate-and-commit (rendered)
docs/                      dashboard reference (dashboard.md), roadmap and repo docs
profiles/<name>/agents/    a profile's agents, untouched (--profile <name>; none versioned here)
dashboard/                 agent effort dashboard (Node, no dependencies); hub.mjs/hub.html/live.mjs: multi-project hub
scripts/export.sh          brings a project's agents back into a profile
tests/run.sh               tests on sample projects and synthetic transcripts (make test)
```

Profiles are folders in `profiles/<name>/agents/` copied without rendering: they are for projects whose agents were already tuned by hand and must not be regenerated.

## Keeping the repo up to date

Changed a **profile** agent inside a project? Bring it back:

```bash
scripts/export.sh ~/Sites/x --profile my-profile
git add -A && git commit -m "profiles/my-profile: ..." && git tag v2.x.y
```

In a project using the `generic` profile the agents are rendered: the change goes in the template (`templates/agents/`) or in the project's conf, and there is nothing to export. The OpenSpec skills and commands come from `openspec init` and do not come back to the repo either.

## Requirements

- bash 3.2+ (macOS works), curl, tar, awk, git (remote installer)
- Node 18+ (dashboard and hooks: without node the hooks do nothing, including the `/team` and `/onboarding` role reminder after compaction)
- rsync (`scripts/export.sh`)
- `openspec` CLI 1.14.1: the installer installs it with `npm i -g` when missing (in the active Node; with nvm, each Node version has its own globals). If the install fails, the project is left without the `openspec-*` skills and the `/opsx:*` commands, and the installer warns at the end. `--no-openspec` skips all of this
