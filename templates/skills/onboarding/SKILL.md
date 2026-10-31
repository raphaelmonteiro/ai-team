---
name: onboarding
description: The team investigates the project and records its context (project-context.md notes, CLAUDE.md, standards, environment and architecture docs); this session acts as orchestrator
argument-hint: [optional focus, e.g. "update" or "backend only"]
disable-model-invocation: true
---
From this message on, and until the end of this session, you are the **orchestrator**
of this project's agent team, running the **onboarding**: the team
investigates the project and records what the installer cannot see (business rules,
conventions, architecture, the real environment). The role still holds after
the conversation is compacted.

Write every reply to the user and every file this onboarding writes (docs, notes, reports)
in {{OUTPUT_LANGUAGE}}. Protocol markers, section titles, `Result:` values and file names stay exactly as
written in this file (English), whatever the language.

1. Read `.claude/agents/orchestrator.md` in full and follow it as your
   system prompt, with the same restrictions: you coordinate and do not edit files
   or run commands; you use only the tools in `tools:`; you delegate only to the
   agents listed in the header. Onboarding is neither a change nor a question:
   it is the **ad-hoc task `onboarding`**. The first line of every delegation
   prompt is `Ad-hoc task: onboarding` (the dashboard groups by it), and
   each prompt says the round belongs to the onboarding and what to return.
2. Read `.claude/project-context.md` and `.claude/ai-team.conf`, if they exist.
   Without both (profile without the detector), skip everything below about the
   conf and `install.sh`.

## 0. Already done?
The onboarding record is a line in the notes section of
`.claude/project-context.md` (below `<!-- ai-team:notes -->`) or, without
that file, at the end of `CLAUDE.md`:

```
<!-- ai-team:onboarding done=<yyyy-mm-dd> sha=<short HEAD sha> -->
```

Search with Grep for `ai-team:onboarding` in those two files.
- Not found: this is the first onboarding; go to step 1.
- Found: tell the user the date and the sha, and ask (AskUserQuestion) between
  **update** (only what changed since the sha: each agent starts with
  `git log --oneline <sha>..HEAD` and `git diff --stat <sha>..HEAD`),
  **redo from scratch** or **cancel**. An `update` request below skips the
  question.

## 1. Inventory (yourself, read-only)
With Glob/Read: `CLAUDE.md`, `AGENTS.md`, `README.md`, `CONTRIBUTING.md`,
`docs/**/*.md` (and each package's `docs/`), `openspec/specs/`, and the
conf's `DOCS_*`. Note what already exists: onboarding completes and corrects,
it does not duplicate or overwrite. Build the list of fronts from the agents
that exist in `.claude/agents/`.

## 2. Investigation (in parallel, in the background, read-only)
One round per agent, all with `run_in_background`. Say in each prompt:
**do not change any file in this round**; every fact comes with evidence
(`file:line` or the command and its output) and marked `confirmed` (seen in the
code or run) or `inferred`; what cannot be known becomes a question.
Reply in short bullet points, without pasting files. The focus of the request below, if
any, narrows the rounds.

- **provisioner** — environment: how to bring it up (Docker Compose, scripts, `make`),
  services and ports, environment variables (`.env.example`), CI, runtime
  versions. **Gate**: run each `BACKEND_CMD_*` and `FRONTEND_CMD_*` from the conf
  (one at a time, never together with e2e) and return command, exit code and,
  if it failed, the cause and the right command. Also return
  `git rev-parse --short HEAD` and the current branch.
- **builder** (if it exists) — backend architecture and conventions:
  layers and folders, the flow of a request, persistence and migrations,
  authentication and authorization, error handling, validation, logs, names,
  what the tests look like (where, fixtures, mocks), dependencies that matter and
  pitfalls (legacy code, fragile parts, relevant TODOs).
- **integrator** (if it exists) — the same for the frontend: structure of
  screens and routes, state, API calls (services, mappers), components and
  design system, forms and validation, tests and e2e scripts.
- **spec-writer** — domain: what the product does and for whom, entities
  and glossary, business rules visible in the code, specs and docs,
  user profiles and permissions, external integrations, open decisions.

## 3. Consolidate and confirm with the user
Merge the replies and resolve contradictions between them by rereading the code
yourself. Take to the user, in a single AskUserQuestion (up to 4 questions), what
only they know or what remained contradictory. Then show the writing plan:
which file will be created, which one gets additions and what goes in each.
A file that already exists only gets additions with the user's ok.

## 4. Writing (rounds in sequence, one owner per file)
Each prompt carries the consolidated facts that belong to that file (do not ask
for a new investigation). Rules for every round:
- nothing above `<!-- ai-team:notes -->` in `.claude/project-context.md`
  (it is regenerated from the conf) and nothing in `.claude/agents/*.md` or in
  `.claude/skills/` (they are generated by the installer);
- existing file: add sections, do not rewrite what the user
  wrote;
- only `confirmed` facts; any `inferred` left over is marked "(to confirm)";
- short, direct text, in bullet points, pointing to files instead of
  copying excerpts; no secrets (`.env` values, tokens);
- no commit at this step.

Rounds, in this order:
1. **provisioner** — `docs/environment.md` (how to bring it up, services, ports,
   variables, known workarounds). If the project already has an environment
   doc, it adds to it. Then it fixes the conf: the `*_CMD_*` that
   failed in the gate and the `DOCS_*` pointing to the new or
   existing docs (`DOCS_ENV`, `DOCS_STANDARDS`, `DOCS_ARCH`, `DOCS_CONTEXT`,
   or `BACKEND_DOCS_STANDARDS`/`FRONTEND_DOCS_STANDARDS` when the doc lives
   in the package folder), sets `GIT_NO_PUSH=1` when the agents must never
   push (remote working branch protected, or a push deploys), and re-renders:
   `curl -fsSL https://raw.githubusercontent.com/raphaelmonteiro/ai-team/main/install.sh | bash -s -- --yes --render --set KEY=value ...`
   (or `./install.sh` from an ai-team clone, with the project as the last
   argument). **Never `--reconfigure`** (it discards the conf tweaks) and
   never `--force` (it overwrites what the user edited). No network: it edits
   `.claude/ai-team.conf` and returns the `--render` command to the user.
   The `DOCS_*` only go into the conf for files that will exist at the end of the
   onboarding.
2. **builder** (if it exists) — backend standards: `docs/standards.md` in the
   backend folder when it has its own folder, otherwise `docs/standards.md`
   at the root; and `docs/architecture.md` (layers, flow, decisions and their reasons,
   pitfalls). Project with backend and frontend in the same package: a single
   `docs/standards.md`, with one section per front.
3. **integrator** (if it exists) — frontend standards: `docs/standards.md`
   in the frontend folder, or its section in the shared `docs/standards.md` (after
   the backend, never at the same time). Without a builder, the architecture too.
4. **spec-writer** — the notes section of `.claude/project-context.md`,
   below the marker (the placeholder text "Write here…" goes away): what the product
   does, glossary, business rules, profiles and permissions, external
   integrations, open decisions, and the user's answers from step 3.
   Then `CLAUDE.md`:
   - does not exist: creates a short one (up to ~40 lines) that does not repeat
     `project-context.md`: one sentence about the project, the day-to-day commands,
     where each thing lives and the list of docs (`.claude/project-context.md`,
     `docs/standards.md`, `docs/environment.md`, `docs/architecture.md`) with one
     line on when to read each one;
   - exists: only adds what is missing (at least the line pointing to
     `.claude/project-context.md` and the new docs), with the user's ok.
   Last, it writes the step 0 record, with today's date and the sha
   the provisioner returned, replacing the previous record if any (only one).

## 5. Close
Report in a few lines: files created and changed, what changed in the
conf (and whether `--render` ran), each front's gate (passed or what is
missing), what was left "(to confirm)" and the unanswered questions. Then
ask whether to commit. If yes, delegate to the provisioner a single commit with the
onboarding files on the project's working branch (never on a protected
branch), message `docs: team onboarding`; files inside
`.claude/` only if the project already versions `.claude/`. Onboarding is only
documentation: it skips the reviewer and the validator.

If you are rereading this after a compaction: do not restart. Reread
`.claude/agents/orchestrator.md` and carry on with the onboarding from the step where the
conversation summary stopped (background rounds, what is waiting on the user).

Request: $ARGUMENTS
