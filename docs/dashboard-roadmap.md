# Dashboard roadmap: session, decisions, notifications and remote access

Gathered on 10/28/26. Starting point: `origin/main` (hub, ad-hoc tasks, hook with `SessionStart`/`UserPromptExpansion`). Every step below (A to E) is on `main` since the initial commit `c272a80`; the feature branches named in the first draft were merged and deleted. Still open: ntfy action buttons calling `/api/answer` (C) and the items in `docs/tech-debt.md`. The reference of what exists is `docs/dashboard.md`.

## Requests

1. See in the dashboard the session's step list and the question it is asking.
2. Expose the dashboard on the internet, locked down, running from the local machine; be notified when an agent finishes.
3. Answer the session's decisions through the dashboard (options or free text) and have the answer reach the session.
4. A notification whenever a decision arrives.
5. The agent trail from the change drawer (as in a project with OpenSpec changes) also in pas.

Item 3 fits inside 1 and 4.

## What already exists

- **5.** The change drawer with a stage trail and conversation is on `origin/main`, the same for every project. In pas it does not appear because there are only ad-hoc tasks there and `buildTrail` (`dashboard/stages.mjs`) returns `null` for `status === 'ad-hoc'`.
- **1 (step list).** The desktop app writes the `mcp__ccd_turn__update_plan` (`items` / `advance` / `done` / `start`) and `mcp__ccd_turn__wrap_up` (`recap`, `ask`, `actions`) calls to the session transcript. `feedSession` in `collect.mjs` already walks these records.
- **1 (permission request).** It is not in the transcript while pending; only through a hook.

## Claude Code hooks that help (https://code.claude.com/docs/en/hooks)

- `PermissionRequest`: stdin with `tool_name`, `tool_input`, `permission_suggestions`. Responds with `hookSpecificOutput.decision.behavior` = `allow` (with `updatedInput`, `updatedPermissions`) or `deny` (with `message`, `interrupt`). Empty output = normal flow. Runs in subagents. With a `canUseTool` host (the desktop app's case) it runs alongside, and whoever decides first wins. **Undocumented:** whether the dialog appears while the hook waits. Test before building.
- `PreToolUse` on `AskUserQuestion`: `permissionDecision: "allow"` + `updatedInput` with the original `questions` and `answers` `{ "<question text>": "<answer>" }`. `allow` alone without `answers` is not enough.
- `Notification`: `notification_type` (`permission_prompt`, `idle_prompt`, `elicitation_dialog`, `agent_needs_input`, `agent_completed`…), `message`, `title`. Side effect only; `permission_prompt` arrives ~6 s after the dialog.
- `SubagentStop`: `agent_id`, `agent_type`, `agent_transcript_path`, `last_assistant_message`. `Stop`: `last_assistant_message`.
- Sending a message to a running local session: only through Remote Control. The question in the app's next-step box (`wrap_up`) is not an `AskUserQuestion`; the dashboard shows it but does not answer it.

## Steps

### A. Session step list and question (read-only)
- `feedSession`: keep the last `update_plan` with `items` and apply `advance`/`done`/`start` on top; keep the last `wrap_up` (`recap`, `ask`, `actions`), cleared on the next real prompt.
- `/api/state`: `plan` and `ask` per session. Dashboard: on the main session row and in the drawer, the list with the current step and the pending question.
- Tests with a transcript fixture containing both calls.
- State: on `main` (`dashboard/plan.mjs`). Also reads `TodoWrite` and unanswered `AskUserQuestion`, and undoes a call that came back with an error: in one of the projects the orchestrator has no `update_plan` ("No such tool available").

### B. Pending items answered through the dashboard
- First: an experiment in the desktop app with a `PermissionRequest` that waits 60 s, to see whether the app's dialog appears alongside and who wins.
- `hook.sh` (or a `pending.mjs` it calls): writes `.claude/ai-team/pending/<id>.json` (session, agent, tool, command or questions and options) and waits for `.claude/ai-team/answers/<id>.json` until a deadline (`AI_TEAM_ANSWER_WAIT`, short default); with no answer, it exits empty and the app asks as usual.
- `PermissionRequest` → allow once / deny (with a reason). `PreToolUse` `AskUserQuestion` → options, multi-select and free-text "Other".
- Server: `GET /api/pending`, `POST /api/answer` (writes the answer file). Dashboard: a "pending decisions" card at the top, and in the session drawer.
- A pending item disappears when answered in the app (the transcript gets the `tool_result`) or when the deadline expires.

- State: on `main` (`dashboard/ask.mjs`). Lab result (10/28, desktop app, Claude Code 2.1.310):
  - the app's dialog appears while the `PermissionRequest` hook waits; the first answer wins (app or hook);
  - the hook's `allow` runs the command; `updatedInput.answers` in `PermissionRequest` answers an `AskUserQuestion`;
  - through `PreToolUse` the question only appears on screen after the hook exits: do not use it for questions;
  - no `tool_use_id` in `PermissionRequest`: "answered in the app" is detected by a `tool_use` with the same name and input having a `tool_result` in the transcript.

### C. Notifications
- The server watches `pending/` (new decision) and `events.jsonl` (`SubagentStop`, `Stop`) and publishes to **ntfy** (topic with token; own server optional), with a link to the pending item or the change.
- Conf: `NOTIFY_NTFY_URL`, `NOTIFY_NTFY_TOKEN`, `NOTIFY_ON=agent_stop,decision`.
- Later, if worth it: Web Push with the dashboard as a PWA (needs HTTPS, which step D provides).

- State: on `main` (`dashboard/notify.mjs`). The hooks send straight to ntfy, without depending on an open dashboard: `ask.mjs` (decision), `hook.sh` on `SubagentStop` and `Stop`. User config in `~/.config/ai-team/notify.json`; `detail: false` to send no command or text to the server. Possible next step: ntfy action buttons calling `/api/answer`, once the dashboard has login (D).

### D. Locked-down remote access
- **Tailscale Serve** (recommended): HTTPS inside the tailnet, no open port; phone with the Tailscale app. The server stays on `127.0.0.1`.
- Alternative with your own domain: Cloudflare Tunnel + Cloudflare Access (email login).
- Mandatory once B exists: the dashboard starts approving commands, so nothing public (no Funnel), a token on `POST` routes, an `Origin` check and a log of who answered what.

- State: on `main` (`dashboard/auth.mjs`). Local is open; from outside (proxy, another Host, another interface) only with a token, through the `/login` cookie or Bearer; without a token, refused. `X-Forwarded-Host` accepted in the origin check of `POST /api/answer`. Tailscale was not installed on the authoring machine on 10/28; the recipe in `docs/dashboard.md` is the reference.

### E. Trail for ad-hoc tasks (request 5)
See the section below.

## E. Ad-hoc task trail

Today the ad-hoc drawer shows the "Now" strip and the conversation, but not the trail. Proposal: a short trail built only from the rounds, with no proposal/approval/tasks:

- Stages: Build → Review → Fix → Validation → Integration (each round's `flow`, already inferred from the prompt).
- Each stage with the avatars of who worked on it, state (done, now, queued) and number of rounds; Integration stays with the orchestrator.
- Current stage = active round; with no active round and some finished rounds, the last stage with a round is done and the next one is pending.
- Rounds outside the team (`flow` null: Explore, general-purpose) do not enter the trail.
- State: on `main` (`looseTrail` in `dashboard/stages.mjs`).

# Next round: close the cycle, enforce the rules, recover from failures

Gathered on 11/10/26 from a brainstorm in three angles (daily workflow, pipeline quality, product and distribution). Starting point: `main` at `5c77aee`, with A to E above done. Guiding idea: the differentiator is the governed change cycle (proposal, `D-<n>` decisions, gate, review and validation trail), not the detector or the dashboard; everything below reinforces that cycle. Not everything here is dashboard work: items 1, 4 and 5 touch `templates/`.

## Order

1. **Prohibitions enforced by a hook, reviewer with `Edit`.** `PreToolUse` on `Bash` in `dashboard/hook.mjs`, reading `agent_type` and denying from a small table (reviewer: any mutating git; devs: `git add -A`, `--no-verify`, `stash`, `reset --hard`, `compose down -v`, `pkill`). Universal ones also in `permissions.deny` through `settings.mjs --deny`. With that in place the reviewer gets `Edit` restricted to `openspec/changes/*/review-report.md` and the `shasum` append dance in `templates/agents/reviewer.md` goes away. Effort M + S.
   - State: done on 11/10/26 (`dashboard/guard.mjs`, called by `hook.mjs` on `PreToolUse`; `docs/dashboard.md`, "Agent guard"). `permissions.deny` was not used: it would bind the user's own session and the `/team` orchestrator too, while the hook sees `agent_type` and judges only the six roles.
2. **Approval as a pending item, ntfy action buttons.** The orchestrator asks for proposal approval with `AskUserQuestion` (approve / changes / abort), so `ask.mjs` catches it without away mode; the ntfy notification carries action buttons that call `/api/answer` (item C above, still open). Removes the longest human stall. Effort S + M.
   - State: done on 11/10/26. Orchestrator asks with `Approve` / `Changes` (`templates/agents/orchestrator.md`); buttons in `notify.mjs` (`decisionActions`) with a one-time secret per pending item (`ask.mjs`) accepted by `POST /api/answer` without login (`server.mjs`, `docs/dashboard.md` "Buttons"). Scope narrowed on purpose: answer buttons only for a permission or a two-option question, always with "Open"; the dashboard stays the place for anything richer.
3. **`stuck` status and `/team resume <id>`.** `board.mjs` marks a change whose last round failed or was interrupted with nothing running, with the exact reason (`is_error` text, expired permission). The card offers the resume prompt; a new branch in `templates/skills/team/SKILL.md` reads the `<!-- state -->` of `tasks.md` and continues from there. Effort M.
   - State: done on 11/10/26. `stuck` status and reason in `collect.mjs` (`stuck` on the change view, `error` on the run view), group in `board.mjs` and `index.html` with a copy button; `resume <id>` in `templates/skills/team/SKILL.md` and "Resuming a change" in the orchestrator. Found on the way: the declared state line was documented but no template wrote it, and the orchestrator has no editing tool; so the agents that edit `tasks.md` write it (spec-writer, devs through `gate-and-commit`, validator), as the orchestrator's "Declared state" rule says. The guard now lets the validator write `tasks.md` (it already marked section 3 there).
4. **Lessons and fix-ready findings.** `docs/lessons.md` (conf `DOCS_LESSONS`), append-only `L-<n>`: at archive the spec-writer promotes a finding category that repeated across two changes; devs read it before coding, the reviewer cites it. Findings `R<k>` gain required `Fix:` (one imperative line) and `Reuse:` (helper path:line) fields, and the dev applies `Fix:` literally. Effort S + S.
   - State: done on 11/10/26. `Fix:`/`Reuse:` in the reviewer's report format and rules, "apply literally" in `gate-and-commit`; `DOCS_LESSONS` in the detector, `project-context.md`, devs' pre-read, reviewer yardstick and the spec-writer's archive step (promotion rule: same category and same kind of mistake in an archived change's report). Promotion is the spec-writer's judgement, not checked by a test.
5. **Role survives compaction in subagents.** An "After compaction" block in each agent (reread the agent file, `wt.sh where <id>`, reread the `tasks.md` section) and a `PreCompact` hook writing change id and worktree to `.claude/ai-team/<sid>.ctx`. Effort M.
   - State: done on 11/10/26, without the `.ctx` file: a `PreCompact` hook in each agent's frontmatter (`hook.sh compact <role>`) steers the compaction summary to keep role, change, section, worktree, commits, gate, open items and next step (`compactInstructions` in `hook.mjs`, `Compact` event), and each agent has an "After compaction" section. Chosen over `SessionStart source=compact` in subagents, which the docs do not confirm. Not exercised on a real long round yet.
6. **Diff in the drawer.** `GET /changes/<id>/diff` (read-only `git diff <work-branch>...change/<id>`, per file) and a third drawer view with collapsible files; proposal `.md` rendered as HTML with anchors per `D-<n>`. Effort M + S.
   - State: done on 11/10/26. `dashboard/diff.mjs` (`changeDiff`: repositories from the conf, merge base with the work branch, commits, numstat, patch per file, caps) behind `GET /changes/<id>/diff`; `mdToHtml` in `ui.mjs` with anchors on the protocol ids; the drawer opens the `.md` files in place with a "raw" link and has a "diff" segment. Checked in the browser on a demo repository (two commits, modified and added files).
7. **Cost in money.** A price table per model id (overridable in the conf) in `collect.mjs`; `usd` on cards and in the effort grid; a soft budget per change size that colours the card and notifies. Effort S.
   - State: done on 11/10/26. `dashboard/price.mjs` (table from the official pricing page, `PRICE_<MODEL>` overrides, `costOf`), `usd` on runs, changes, agents, sessions and totals, `pricing` in the state; `budget` per change from `Size:` in the spec-writer prompt and `BUDGET_*_USD`; one ntfy `budget` notice per change (`dashboard/budget.mjs`, called from `live.mjs` on every computed state). An estimate at list price, said so in the page.
8b. **Contract-first on large changes** (from the pipeline brainstorm, done on 11/11/26): the lite schema cost backend/frontend parallelism and early contract critique on large two-front changes; now the spec-writer drafts `## API contract (draft)` in `design.md` for those, the builder confirms or amends (`PV-<n>`), the orchestrator runs both fronts at once and relays amendments. Small and backend-only changes keep the lite flow. Templates only.
8. **"Since you left" strip.** Compact timeline from `events.jsonl`, `answers/` and test runs since the last `Stop` answered, grouped per change, with a "seen" cookie. Effort M.
   - State: done on 11/11/26. `dashboard/timeline.mjs` (pure, from the state), `timeline` and `leftAt` in the state, `hookEvents` (Guard / Compact / Decision) read from `events.jsonl`, `ask.mjs` logs a `Decision` event when an answer is consumed (with `via`), strip on the main page with "mark as seen" in `localStorage` (not a cookie: nothing to send to the server). Stage transitions have no history: only the current declared stage with its `since`.

# Dashboard v3: the dashboard as an IDE (11–12/11/26)

Done, in this order: activity bar, explorer, editor tabs instead of the drawer and status bar; the bottom panel (Problems, Events, Output with the live transcript tail); the tasks kanban; Team and Settings as tabs; the phone layout; neutral agent avatars. Then, after use: Sessions instead of "Agents now", short change rows that expand, ad-hoc in the same table, decisions at the top of the Overview, finished rounds in the Sessions layout, agent effort in the Team tab, sparklines (hub cost per day, test history, round-time trend), away mode waiting up to 24 h with expired questions kept visible, the old cycle block and pages removed (`/notifications` redirects to Settings), and the phone with the same changes (decisions on Home, a session screen, change Info, More › Notifications). `docs/dashboard.md` describes it.

Rules that held and stay:

- No npm dependency, no build step, no outside requests; every color from a token; every action from the keyboard.
- Each step ends with `make test` green, a browser check (dark and light, hub frame, wide and narrow) and its own commit; nothing reaches a real project before the developer approves the merge and the reinstall.
- Data first: layout work does not change the data; a step that needs new server data keeps that change small and tested.

Open:

- A check on a real phone through the Tailscale address (only emulated so far).
- Code organization: `index.html` held more than 2,000 lines of page code. First cut done (12/11/26): the render code moved to `overview.mjs`, `changetab.mjs` and `render.mjs` (the page script went from about 1,540 to 1,120 lines). Still in `index.html`: the wiring of decisions, panel (Problems, Events, Output), Settings and phone, which share the page's state; they move once that state lives in one place (below).
- The Events tab of the bottom panel does not work as expected: review it (what it lists, the "since you left" marker, mark as seen).
- One keymap: done (12/11/26), `keys.mjs` with `matchKey`, the `?` list built from it and a clash test.
- The hub frame: one status bar and one palette when a project page runs inside the hub.
- The page state that must survive a redraw (folded groups, open tabs and rows, panel scroll, typed text) kept in one place instead of per feature.
- Writing `ai-team.conf` from Settings: today the keys are read-only with a `--set` command to copy; it needs its own decision (which keys, auth, re-render of the derived files, backup).
- `live.test.mjs` "the GET recomputes" is timing-sensitive (about 1 in 13 runs under load).

## When someone else installs it

- Versioned conf (`AI_TEAM_CONF_VERSION`) with `lib/migrate.sh`; layered settings: team facts in the repo conf, personal keys (ntfy, token) in `~/.config/ai-team/`.
  - State: done on 11/11/26. `lib/migrate.sh` (v2: `DOCS_LESSONS`, `OUTPUT_LANGUAGE`), the detector writes the version, `install.sh` migrates before loading and gained `--check`; the dashboard warns when its copy and the conf disagree on the version. Layered settings were already in place (notify, token, hub per machine): documented as a table in the README.
- Generic work-item skill with Jira / GitHub Issues / Linear adapters.
- A PR per change with the trail in one updated comment via `gh`; the dashboard reads PR state back.
- Later, if the above lands: package as a Claude Code plugin and shrink `install.sh` to detection plus conf and context render.

## Not building

- Real-time interruption of a running subagent (no hook for it; "redirect on the next round" is the honest ceiling).
- Web Push / PWA (ntfy covers it).
- A shared multi-tenant hub before a second user exists.
- A replay harness for archived changes (noisy signal; review metrics in the dashboard first).
- Cloud mode for the reviewer: candidate for removal from `templates/agents/reviewer.md`.
