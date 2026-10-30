# Dashboard roadmap: session, decisions, notifications and remote access

Gathered on 10/28/26. Starting point: `origin/main` (hub, ad-hoc tasks, hook with `SessionStart`/`UserPromptExpansion`).

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
- State: implemented on branch `feat/painel-plano-sessao` (`dashboard/plan.mjs`). Also reads `TodoWrite` and unanswered `AskUserQuestion`, and undoes a call that came back with an error: in one of the projects the orchestrator has no `update_plan` ("No such tool available").

### B. Pending items answered through the dashboard
- First: an experiment in the desktop app with a `PermissionRequest` that waits 60 s, to see whether the app's dialog appears alongside and who wins.
- `hook.sh` (or a `pending.mjs` it calls): writes `.claude/ai-team/pending/<id>.json` (session, agent, tool, command or questions and options) and waits for `.claude/ai-team/answers/<id>.json` until a deadline (`AI_TEAM_ANSWER_WAIT`, short default); with no answer, it exits empty and the app asks as usual.
- `PermissionRequest` → allow once / deny (with a reason). `PreToolUse` `AskUserQuestion` → options, multi-select and free-text "Other".
- Server: `GET /api/pending`, `POST /api/answer` (writes the answer file). Dashboard: a "pending decisions" card at the top, and in the session drawer.
- A pending item disappears when answered in the app (the transcript gets the `tool_result`) or when the deadline expires.

- State: implemented on branch `feat/painel-decisoes` (`dashboard/ask.mjs`). Lab result (10/28, desktop app, Claude Code 2.1.310):
  - the app's dialog appears while the `PermissionRequest` hook waits; the first answer wins (app or hook);
  - the hook's `allow` runs the command; `updatedInput.answers` in `PermissionRequest` answers an `AskUserQuestion`;
  - through `PreToolUse` the question only appears on screen after the hook exits: do not use it for questions;
  - no `tool_use_id` in `PermissionRequest`: "answered in the app" is detected by a `tool_use` with the same name and input having a `tool_result` in the transcript.

### C. Notifications
- The server watches `pending/` (new decision) and `events.jsonl` (`SubagentStop`, `Stop`) and publishes to **ntfy** (topic with token; own server optional), with a link to the pending item or the change.
- Conf: `NOTIFY_NTFY_URL`, `NOTIFY_NTFY_TOKEN`, `NOTIFY_ON=agent_stop,decision`.
- Later, if worth it: Web Push with the dashboard as a PWA (needs HTTPS, which step D provides).

- State: implemented on branch `feat/painel-notificacoes` (`dashboard/notify.mjs`). The hooks send straight to ntfy, without depending on an open dashboard: `ask.mjs` (decision), `hook.sh` on `SubagentStop` and `Stop`. User config in `~/.config/ai-team/notify.json`; `detail: false` to send no command or text to the server. Possible next step: ntfy action buttons calling `/api/answer`, once the dashboard has login (D).

### D. Locked-down remote access
- **Tailscale Serve** (recommended): HTTPS inside the tailnet, no open port; phone with the Tailscale app. The server stays on `127.0.0.1`.
- Alternative with your own domain: Cloudflare Tunnel + Cloudflare Access (email login).
- Mandatory once B exists: the dashboard starts approving commands, so nothing public (no Funnel), a token on `POST` routes, an `Origin` check and a log of who answered what.

- State: implemented on branch `feat/painel-acesso-remoto` (`dashboard/auth.mjs`). Local is open; from outside (proxy, another Host, another interface) only with a token, through the `/login` cookie or Bearer; without a token, refused. `X-Forwarded-Host` accepted in the origin check of `POST /api/answer`. Tailscale not yet installed on this machine (10/28).

### E. Trail for ad-hoc tasks (request 5)
See the section below.

## E. Ad-hoc task trail

Today the ad-hoc drawer shows the "Now" strip and the conversation, but not the trail. Proposal: a short trail built only from the rounds, with no proposal/approval/tasks:

- Stages: Build → Review → Fix → Validation → Integration (each round's `flow`, already inferred from the prompt).
- Each stage with the avatars of who worked on it, state (done, now, queued) and number of rounds; Integration stays with the orchestrator.
- Current stage = active round; with no active round and some finished rounds, the last stage with a round is done and the next one is pending.
- Rounds outside the team (`flow` null: Explore, general-purpose) do not enter the trail.
- State: implemented on branch `feat/painel-trilha-avulsa` (`looseTrail` in `dashboard/stages.mjs`).
