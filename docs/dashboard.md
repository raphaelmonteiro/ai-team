# Dashboard

Reference for the ai-team dashboard: what each part shows, the hooks, the decisions, the notifications and access from outside the machine. For how to open it and the overview, see the "Dashboard" section of the [README](../README.md).

```bash
cd my-project
node .claude/dashboard/server.mjs          # http://127.0.0.1:4321/
# or, from the cloned repo: make dashboard TARGET=~/Sites/project
```

The dashboard reads the transcripts Claude Code writes to `~/.claude/projects/<project>/` (main session and `…/subagents/agent-*.jsonl`) and the project's `openspec/`. It needs no hook and no dependency: Node 18+ and that's it. It updates itself (SSE over `fs.watch`, with fallback polling). Where `fs.watch` has no `recursive` option (Node 18 on Linux), `dashboard/live.mjs` watches each folder of the tree instead (`watchTree`: one non-recursive watcher per folder, rescanned on every event, so a new change or a session's `subagents/` folder joins as soon as it appears; bounded to depth 6 and 2000 watchers). The server computes the state once per change and stores it: with some tab connected (`/events`) and nothing changed since the computation, `GET /api/state` returns the stored state, for any number of tabs; with no tab, each `GET` recomputes. The state is changed by an `fs.watch` event, a `POST /api/answer` or `/api/away`, and the polling tick (5 s), which stays as a safety net: it covers a missed `fs.watch`, transitions that depend only on time (running → no signal after `--stale-min`) and the project's sessions in another folder of `~/.claude/projects`, which `fs.watch` does not observe. The `update` notice is only sent when the state differs from the last one sent, ignoring the `generatedAt` stamp; that is why the header's "updated HH:MM" is the time of the **last change**, not of the last check (with an agent running it changes every tick, because its duration grows). The format of `/api/state` and `/events` did not change.

## Main page

- **Effort per agent**: time worked, tokens (input, output, cache read and written), rounds, changes touched, models used. The team's main session counts as the orchestrator (or the `"agent"` in `settings.json`), with the time of active turns.
- **Team session or ad-hoc session**: with a fixed `"agent"` in `settings.json`, every session belongs to the team. Without it, a session belongs to the team when it called `/team` or `/onboarding` or delegated to an agent in `.claude/agents/`; the others are *ad-hoc sessions* (plain Claude), shown separately with count, time and tokens, outside agent effort and changes.
- **Change board**: the agents running now (change, stage inferred from the prompt, since when, last activity; "finished" does not prove success); the changes in progress, blocked and pending and the 3 latest done (the rest collapsed), with start, `x/y` tasks per section, latest review and validation, rounds, agent switches, time and tokens; and **"waiting for what"** by heuristic (rules in `dashboard/board.mjs`; shows the rule that fired and, with no rule, "undefined"). Clicking a change also lists its `.md` files, served as text at `/changes/<id>/<file>.md` (only proposal, design, tasks, review/validation-report and `specs/**`; traversal refused).
- **Active agent** on each change in progress, with model, how long it has been working and how many tokens it has cost. Tokens appear in two columns: "new" (input + output + cache written) and "cache read"; `/api/state` also carries the raw fields (`input`, `output`, `cacheRead`, `cacheCreation`) in `usage`/`tokenSplit`.
- **Click on the change**: the list of rounds, each with start, end, duration, tokens, model, who it came from and who it went to, description; click the row to see the return and the prompt. **Click on the agent**: its rounds across all changes.

Definitions: a *round* is one delegation from the orchestrator to an agent (one Agent tool call); *switches* counts how many times the change moved to an agent different from the previous one; a round's change comes from the delegation prompt (`openspec/changes/<id>` or the id it mentions). Rounds with no change appear under "Outside changes", and ad-hoc task rounds are grouped there by the slug of `Ad-hoc task: <slug>`. Tokens add up `input + output + cache_read + cache_creation` of each response, without counting blocks of the same request twice.

Agent states: running (green), no signal (amber; no activity in the transcript for more than `--stale-min`, default 15, and no end), finished (gray), failed (red), interrupted. Each agent and round shows its originating session (transcript title, else the shortened first prompt, else the short id).

### Declared state

A line in the `tasks.md` header decides the stage, the "waiting for whom" and the "next" (the heuristic stays as a fallback; the dashboard shows "declared" or "inferred" and warns if the line is invalid):

```
<!-- state: <stage> · waiting: <who> · since: <yyyy-mm-ddThh:mmZ> · note: <optional short text> -->
```

`stage`: spec, approval, build, review, fix, validation, integration, archived. `waiting`: developer, orchestrator, spec-writer, provisioner, builder, integrator, reviewer, validator, queue.

### Step list and session question

No hook: the dashboard reads, from the transcript of each team session, the step list (`update_plan` from the desktop app, or `TodoWrite` from the CLI) and the pending question (the end-of-turn one, `wrap_up`, until the next prompt; or an `AskUserQuestion` still unanswered). Open sessions with a list or question get a card below "Agents now", and the current step appears in the "stage" column of the main session. A call that came back with an error (session without the app's tools) is ignored. Logic in `dashboard/plan.mjs`; in `/api/state`, `mainRuns[].plan`, `.ask` and `.recap`. Answering through the dashboard: permissions and `AskUserQuestion` under "Decisions through the dashboard"; the end-of-turn question, only with "Away from the computer" on.

`node .claude/dashboard/collect.mjs` prints the same state in the terminal (`--json` for the full JSON).

## Hooks

The `settings.json` created by the installer points `SubagentStart`/`SubagentStop` (dashboard) and `SessionStart`/`UserPromptExpansion` (`/team`) to `.claude/dashboard/hook.sh`, which forwards to `hook.mjs` (Node 18+; without node the hooks do nothing) and writes `.claude/ai-team/events.jsonl` (outside git: see "What to version" in the README); with `--no-dashboard` only `hook.sh` and `hook.mjs` are copied. `events.jsonl` does not grow without limit: once it exceeds `AI_TEAM_EVENTS_MAX_BYTES` (default 1048576, 1 MiB; an invalid value means the default) the hook renames it to `events.jsonl.1` (replacing the previous generation) and starts a new file with the `TeamStart` events of each session (up to half the limit, the most recent); only one hook rotates at a time (lock `events.jsonl.lock`, created with `wx`) and no line is lost. A lock older than 30 s is considered abandoned (a hook that died) and taken over; accepted risk: two hooks taking over the same abandoned lock at the same instant may both rotate, and the second `rename` replaces the just-created `.1` generation (the damage is the one described below: exact start and end of old rounds fall back to the transcript). The dashboard and the post-compaction reminder read both generations; what is lost is the exact start and end of rounds older than two generations, which fall back to transcript timestamps. An old dashboard with a new hook reads only the current file (same loss, until the dashboard restarts). The `TeamStart` event (from `/team`, `/onboarding` or `claude --agent orchestrator`) tells the dashboard exactly which sessions belong to the team. With these events, the start and end of each round are exact even for background agents; without them, the dashboard uses transcript timestamps and considers a round with no recorded end active if it had activity in the last 10 minutes. If `settings.json` already existed, the installer adds only the missing ai-team hooks (see "Decisions through the dashboard").

## Decisions through the dashboard

The `PermissionRequest` hook (`node .claude/dashboard/ask.mjs`, which the installer puts in a new `settings.json`) writes each permission request and each `AskUserQuestion` to `.claude/ai-team/pending/` and waits for the answer. The dashboard shows "Decisions waiting for you" at the top: the command (or file) with **Allow once** / **Deny** (with a reason, which goes back to Claude), and the questions with their options, multi-select and free-text "Other". The app shows its own dialog at the same time and the first answer wins; once answered in the app (the transcript gets the `tool_result`), the pending item disappears. With no answer, the hook gives up after `AI_TEAM_ASK_WAIT_S` (default 280 s) and only the app remains; with **away from the computer** on, it waits `AI_TEAM_AWAY_WAIT_S` (default 3300 s, ~55 min). The hook `timeout` is 3600; a project installed with 300 is adjusted by `node .claude/dashboard/settings.mjs`. The question also appears on the session card, read-only: while the hook waits, the card points to "Decisions waiting for you"; afterwards, it says the dashboard is no longer waiting and the answer goes in the session. A background subagent has no dialog: the dashboard is the only place to approve. `AI_TEAM_ASK=0` disables it. Routes: `pending` in `/api/state` and `POST /api/answer` (`{ id, behavior: allow|deny, message?, answers? }`, JSON only and same origin). Since the dashboard approves commands, access from outside the machine requires a token (see "Access from outside the machine"). Project with an existing `settings.json`: the installer adds only the missing ai-team hooks (`dashboard/settings.mjs`, with a copy in `settings.json.bak-ai-team`; the rest of the file stays the same). To do this without reinstalling: `node .claude/dashboard/settings.mjs` (`--dry-run` shows it first). If the JSON has comments, it does not write and shows the snippet; the `PermissionRequest` one is

```json
"PermissionRequest": [{ "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/dashboard/ask.mjs\"", "timeout": 3600 }] }]
```

## Away from the computer

The app's end-of-turn question (the box with buttons) is neither a permission nor an `AskUserQuestion`: answering it means sending a message to the session, which no hook does after the turn has ended. That is why the dashboard only shows it ("answer in the session") and the phone gets "question for you" with the question and the options. To answer through the dashboard, turn on **away from the computer** in the header (`.claude/ai-team/away.json`, per project): when the turn is about to end with a question, the `Stop` hook (`timeout` 3600) holds the end of the turn and waits up to `AI_TEAM_AWAY_WAIT_S` (default 3300 s); the dashboard shows the options, a text field and **Leave it to the app**, and the answer comes back as `{"decision":"block","reason":…}`, which Claude treats as your answer (the app records it as "Stop hook feedback"). While it waits, the app shows the session running, without its buttons; with no answer, or with the mode turned off midway, the turn ends and the question appears in the app. Route: `GET/POST /api/away`.

## Phone notifications (ntfy)

With `~/.config/ai-team/notify.json`, the hooks notify through the [ntfy](https://ntfy.sh) app: new decision (permission or question, the same as in the dashboard), agent finished (`SubagentStop`, with the start of its summary), session that ended its turn and waits for you (`Stop`), turn stopped by an error (`StopFailure`: usage limit, overloaded API, login failure…) and session closed (`SessionEnd`: `/clear`, `/resume`, logout, exit; the hook has `timeout` 10 because Claude Code's default is 1.5 s). Interrupting with Esc or the stop button sends nothing: Claude Code has no hook for that (`Stop` does not run in that case). Old configs get the new events turned on (`eventsVersion`). Without the file, nothing is sent. To start:

```bash
node .claude/dashboard/notify.mjs setup      # creates the file with a random topic and explains how to subscribe on the phone
node .claude/dashboard/notify.mjs test       # sends a test notification
```

The installer handles this: if the PC has no config yet, it asks for the topic (enter skips, `new` generates one) and offers to send a test; without a terminal, use `install.sh --ntfy-topic <topic>` (on a PC already configured, it only changes the topic). It can also be configured from the dashboard's **Notifications** page (`/notifications`): topic, server, token (never shown back), events, content, dashboard address, events from that project only (or a muted project) and a test button. The config belongs to the PC (applies to all projects); the hooks that fire live in each project's `settings.json`. In the file: `ntfy.server`/`topic`/`token` (own server or ntfy.sh with a token), `on` (`decision`, `agent_stop`, `turn_stop`), `detail` (`false` sends only the title, with no command or agent text; public ntfy.sh is open to anyone who knows the topic) and `dashboardUrl` (opened when the notification is tapped). `AI_TEAM_NOTIFY=0` disables it. Sending runs in the background and never holds the hook. A new `settings.json` comes with the `Stop`, `StopFailure` and `SessionEnd` hooks; in an existing one, the installer adds the missing ones.

## Access from outside the machine

The dashboard stays on `127.0.0.1`, open to whoever is on the machine. A request that arrives through a proxy (`X-Forwarded-For`), with another `Host` or from another interface only gets in with the token: a cookie after `/login` (30 days, `HttpOnly`, `SameSite=Strict`, `Secure` behind HTTPS) or `Authorization: Bearer`. Without a token, outside access is refused. The token lives in `~/.config/ai-team/token` (or `AI_TEAM_TOKEN`); create it with `node .claude/dashboard/auth.mjs token` and restart the dashboard. To open it on the phone, the recommended path is **Tailscale Serve** (HTTPS only inside your tailnet, no open port):

```bash
node .claude/dashboard/auth.mjs token          # once per machine
node .claude/dashboard/server.mjs              # or --hub
tailscale serve --bg 4321                      # https://<machine>.<tailnet>.ts.net/ → 127.0.0.1:4321
```

On the phone, with the Tailscale app on, open the `ts.net` address, paste the token and you're done. Put that address in `dashboardUrl` in `notify.json` so the notification opens the dashboard. Do not use `tailscale funnel` (public on the internet). Alternative with your own domain: Cloudflare Tunnel + Cloudflare Access.

## Team page

This is the dashboard's "Team" tab; not to be confused with the `/team` skill, which calls the team into a session. `dashboard/team.html` builds the page in the browser from the installed project and is the second tab in the header (the "Team" link always appears). It shows: (1) the **team**, read from `<project>/.claude/agents/*.md` (frontmatter `name`, `description`, `model`, `tools`; link to `/agents/<name>.md`; green dot on agents running now; "no frontmatter" when missing); (2) **how to call the team**: fixed agent in `settings.json`, or `/team` and `claude --agent orchestrator`, with a warning when the hooks that keep the role after compaction are missing; (3) the **project context**, from `.claude/ai-team.conf`, including the hub team; (4) the **cycle of a change**, with the ad-hoc task. Updates over SSE like the dashboard. Routes: `/team` (HTML), `/api/team` (JSON `{project, agents, context, entry, hasConf}`, read-only; `entry` carries only `fixedAgent` and skill and hook booleans) and `/agents/<name>.md` (only `[a-z0-9-]+`). Without `ai-team.conf` or without agents, the page opens anyway (uses the folder name and says there are no agents).

Exposed conf keys (closed list in `dashboard/team.mjs`; `GIT_REMOTE`, `TEST_PERSONAS` and the rest are not exposed): `PROJECT_NAME`, `PROJECT_DESCRIPTION`, `LAYOUT`, `HAS_OPENSPEC`, `CI`, `HUB_TEAM`, `GIT_DEFAULT_BRANCH`, `GIT_WORK_BRANCH`, `GIT_PROTECTED_BRANCHES`, `BACKEND_`/`FRONTEND_` + `DIR`, `STACK`, `BRANCH`, `PROTECTED_BRANCH`, plus `BACKEND_GATE`/`FRONTEND_GATE` (the `*_CMD_LINT/FORMAT/TYPECHECK/TEST/BUILD` joined by `; `, as the installer does) and `DOCS_CONTEXT`, `DOCS_STANDARDS`, `DOCS_ENV`.

### Cycle per profile

The "cycle of a change" part comes from `dashboard/cycle-default.html` (generic text: spec, build per section, gate, review, validation, integration). A profile replaces only that part with `profiles/<profile>/dashboard/cycle.html`: an HTML fragment (may have `<style>` and `<script>`), which the installer copies to `.claude/dashboard/` and the server inserts in place of the page's `<!--ai-team:cycle-->` marker. Without `cycle.html`, the default applies. In projects with an old profile copy of the team page (`equipe.html`), run `install.sh --profile <profile> --force` to replace it with the generic version (the installer does not overwrite without `--force`).
