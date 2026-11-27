# Dashboard

[README](../README.md) · [Install and configure](configuration.md) · [How the team works](workflow.md) · **Dashboard**

A local page that shows what the team is doing and lets you answer it, from the browser or from your phone.

```bash
node .claude/ai-team/dashboard/server.mjs    # http://127.0.0.1:4321
```

It reads the transcripts Claude Code writes and the project's OpenSpec changes, needs nothing beyond Node 18+ and updates itself. `node .claude/ai-team/dashboard/collect.mjs` prints the same state in the terminal.

## What it shows

| Panel | What you see |
|---|---|
| **Change board** | The state of each change and ad-hoc task, who is working now and what it is waiting for. |
| **Decisions waiting for you** | Permission requests and the team's questions, answered from the browser or the phone. |
| **Since you left** | A timeline of what happened after your last prompt. |
| **Cost** | Tokens and an estimate at list price for every round, change, agent and session, with an optional budget per change size. |
| **Diff and documents** | What each `change/<id>` branch adds, and the proposal, tasks and reports rendered to read. |
| **Stuck changes** | A change whose last round failed or was interrupted, why, and `/team resume <id>` to continue it. |
| **Sessions** | Ask the project or a session a question, start a session in the background, message an idle one. |
| **Team** | The installed agents with their effort, the gates and the project context. |
| **Settings** | The safe conf keys (names, language, branches, docs, budgets), edited and re-rendered from the page. |

## Decisions

Every permission request and every question the team asks shows up under **Decisions waiting for you**, with what the agent wrote before asking. Answer there, on the phone or in the app: the first answer wins.

- A question from the main session waits about a day for you.
- A question from a subagent waits about 5 minutes, because the agent is stopped meanwhile. With *away from the computer* on, it waits about a day too.
- A background agent has no dialog of its own: the dashboard is the only place to approve.

**Away from the computer.** The question the app shows at the end of a turn is not something a hook can answer. Turn this mode on in the header and the dashboard holds the end of the turn, shows the options and sends your answer back.

`AI_TEAM_ASK=0` turns decisions through the dashboard off.

## Phone notifications

Through the [ntfy](https://ntfy.sh) app:

```bash
node .claude/ai-team/dashboard/notify.mjs setup   # creates the config with a random topic and explains how to subscribe
node .claude/ai-team/dashboard/notify.mjs test    # sends a test notification
```

You are notified of a new decision, an agent that finished, a session waiting for you, a turn stopped by an error and a session that closed. By default, "agent finished" and "session waiting" only go out with *away from the computer* on.

With the dashboard address set in **Settings**, a decision notification carries buttons: **Allow** / **Deny** for a permission, and one per option for a question with exactly two options, such as the proposal approval.

> [!IMPORTANT]
> Anyone who guesses a public ntfy.sh topic can read it. A new config sends only titles (`detail: false`). Use a token or your own server before turning on the message content or the buttons.

The config belongs to the machine (`~/.config/ai-team/notify.json`) and applies to all projects. `AI_TEAM_NOTIFY=0` turns it off.

## Access from outside the machine

The dashboard listens on `127.0.0.1`. From anywhere else it only answers with a token. The recommended path to the phone is Tailscale Serve: HTTPS inside your tailnet, with no open port.

```bash
node .claude/ai-team/dashboard/auth.mjs token          # once per machine
node .claude/ai-team/dashboard/server.mjs              # or --hub
tailscale serve --bg 4321                      # https://<machine>.<tailnet>.ts.net/ → 127.0.0.1:4321
```

On the phone, with the Tailscale app on, open the `ts.net` address and paste the token. Do not use `tailscale funnel`: it is public on the internet.

## Sessions from the dashboard

- **Ask**: a read-only question for the project or for a listed session. A session is answered by a copy of it, so it is neither interrupted nor written to.
- **New session**: starts a background session in the project, through `/team` by default. Its decisions come to the dashboard and to the phone.
- **Send message**: continues an idle background session with your message.

`AI_TEAM_SESSIONS=0` turns them off.

## Hub

Several projects in one dashboard, grouped by team. Each project keeps its own agents, context and gate commands; the hub only reads them.

```bash
git clone https://github.com/raphaelmonteiro/ai-team ~/ai-team && cd ~/ai-team
./install.sh --hub-team payments ~/Sites/checkout-api       # installs as usual and registers in the hub
./install.sh --hub-team payments ~/Sites/checkout-web
./install.sh --hub-team platform --profile my-profile ~/Sites/backoffice
make hub                                                    # http://127.0.0.1:4321/
```

- `/` shows all teams, `/t/<team>` a team's projects, and `/t/<team>/<project>` opens a project's dashboard.
- The overview is light: it reads no transcripts. Only the open project updates in real time.
- The registry lives in `~/.config/ai-team/hub.json`. By hand: `node dashboard/hub.mjs add <dir> --team <team>`, `remove <id>`, `list`.

## Running it as a service

So the phone flow does not depend on a terminal staying open.

<details>
<summary>Linux (systemd) and macOS (launchd)</summary>

**As a service (macOS, launchd)**, so the phone flow does not depend on a terminal staying open: `~/Library/LaunchAgents/eu.ai-team.dashboard.plist` with `ProgramArguments` = `[/path/to/node, /path/to/project/.claude/ai-team/dashboard/server.mjs]` (or `--hub`), `RunAtLoad` and `KeepAlive` true, `StandardOutPath`/`StandardErrorPath` to a log file, then `launchctl load ~/Library/LaunchAgents/eu.ai-team.dashboard.plist`. On Linux, a user `systemd` unit with `ExecStart=/usr/bin/node .../server.mjs`, `Restart=on-failure` and `WantedBy=default.target` (`systemctl --user enable --now ai-team-dashboard`). Give the service the same `HOME` as the user so it finds `~/.claude` and `~/.config/ai-team`.

</details>

## Environment variables

| variable | default | where |
|---|---|---|
| `PORT` | 4321 | server: listening port (`--port` wins) |
| `AI_TEAM_PROJECT` | current folder | server: the project to serve (`--project` wins) |
| `AI_TEAM_STALE_MIN` | 15 | server: minutes without transcript activity before "no signal" (`--stale-min` wins) |
| `AI_TEAM_IDLE_MS` | 60000 | hub: how long a project's live context stays after its last tab |
| `AI_TEAM_HUB` | `~/.config/ai-team/hub.json` | hub registry (`--hub FILE` wins) |
| `AI_TEAM_LOG` | `info` | server: `silent`, `info` or `debug` |
| `AI_TEAM_TOKEN` | — | token for access from outside (instead of the file) |
| `AI_TEAM_TOKEN_FILE` | `~/.config/ai-team/token` | where the token lives |
| `AI_TEAM_NOTIFY` | — | `0` turns the phone notifications off |
| `AI_TEAM_NOTIFY_FILE` | `~/.config/ai-team/notify.json` | the ntfy config |
| `AI_TEAM_ASK` | — | `0` turns the decisions through the dashboard off |
| `AI_TEAM_ASK_WAIT_S` | 280 | how long the hook waits for an answer to a subagent's call; when set, the main session's too |
| `AI_TEAM_SESSIONS` | — | `0` turns the sessions from the dashboard off (ask, start, send) |
| `AI_TEAM_CLAUDE` | `claude` on PATH | server: the Claude Code binary those sessions run |
| `AI_TEAM_AWAY_WAIT_S` | 86100 | how long it waits for a main-session call, and for any call with away mode on |
| `AI_TEAM_EVENTS_MAX_BYTES` | 1048576 | hook: size that rotates `events.jsonl` |
| `AI_TEAM_NODE` | — | hook.sh: the node binary to use (only that one) |

## Reference

Every panel, hook, route and state field is described in the [dashboard reference](dashboard-reference.md).
