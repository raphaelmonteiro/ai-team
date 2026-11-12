# Dashboard v3: the dashboard as an IDE

Plan of 11/11/26. Branch `feat/dashboard-v3`, worktree `~/Sites/ai-team-v3`, cut from `feat/dashboard-terminal-theme` at `1763306` (v2, approved and in use). Design reference: the v3 boards in the design canvas (IDE layout, Settings, Mobile).

## Ground rules

- The v2 stays untouched. Nothing here is installed into a real project until the cutover step: no `./install.sh` from this worktree against `chroma-x` or any other project, and no `make render` that writes outside the worktree.
- The worktree's dashboard runs on its own port, read-only against real projects: `node dashboard/server.mjs --hub --port 4397`. The installed v2 keeps its own port, so both can be compared side by side.
- Every step ends with `make test` green, a browser check (dark, light, hub frame, 1290 and 900 px) and a commit. Each step leaves a working dashboard: no step depends on a later one to be usable.
- Same constraints as today: no npm dependency, no build step, no outside requests, every color comes from a token, every action works from the keyboard.
- Data first: v3 changes the layout, not the data. A step that needs new data from the server says so and keeps the server change small and tested.

## What moves where

| v2 | v3 desktop | v3 phone |
|---|---|---|
| Header + status line | Status bar at the bottom | Top bar + one-line strip |
| Overview page (long scroll) | Pinned "Overview" tab, without the parts that moved | Home |
| Changes table / cards | Explorer tree (and still the table in Overview) | Home lists |
| Drawer | Editor tabs | Change in full screen |
| Decisions section | PROBLEMS panel | Inbox |
| "Since you left" card | EVENTS panel | Events |
| Team page | Team tab | More |
| Notifications page | Settings tab | More (essentials) |

## Steps

### 1. Shell (desktop)

**Done.** The frame without changing behavior: activity bar, explorer, editor area and status bar as one CSS grid in `index.html`. The current page content goes into the editor as the pinned Overview tab, so everything that works today keeps working. The bottom panel frame moved to step 3, where it gets its content (an empty panel in between helps nobody).

- Explorer built from `state.board`: Decisions, Stuck, In progress, Pending, Done, Ad-hoc, Agents. Folders fold; Done and Ad-hoc start folded. One 24 px line per item, ids truncate with the full id in the tooltip. The board filter moves to the top of the explorer (`/`).
- Status bar: the segments of today's status line plus the ⚠/✗ counts.
- Resizable explorer, its size, visibility and folded folders kept per browser. `⌘B` hides the explorer.
- Inside the hub frame the status bar stays at the bottom; the hub's own header is unchanged.
- Frontend modules: `index.html` already has 1,000+ lines. New code goes into `shell.mjs` (explorer and layout so far; tabs and panel join it or get their own module when they grow). **Server change:** today `server.mjs` serves only `feed.mjs` and `ui.mjs` by name (both in project and hub mode); it gets an allowlist of the page modules instead of a wildcard.
- Tests: the allowlist (served, and anything else under `dashboard/` still refused), the explorer grouping as a pure function in `ui.test.mjs` (or a new `shell.test.mjs`), and the existing "no outside request" checks extended to the new modules.

### 2. Tabs instead of the drawer

**Done**, with a preview tab (single click in the explorer, replaced by the next one; double click keeps it) and the agent tab without the live tail. ⌘1…9 and ⌘W belong to the browser, so the keys are Alt+1…9 and Alt+W.

- Opening a change or an agent (explorer, Overview table, palette, `J`/`K` + Enter) opens a tab; an open tab is focused instead of duplicated. `⌘1…9` switch, `⌘W` closes, open tabs kept per browser.
- Deep links keep their form (`#change=<id>`, `#agent=<id>`) and open the tab; old links keep working.
- The change tab keeps the stage trail on one line and gets sub-tabs: Overview (Now, Tasks, Properties), Rounds (today's table), Conversation (today's chat view), Files (tree + today's file viewer), Diff (today's diff).
- **Data check:** `collect.mjs` already builds `taskList` per change for `buildTrail`; if `/api/state` does not carry it, expose it (ids, text, done, owner) so the Tasks list does not parse `tasks.md` in the browser.
- The drawer became the tab view itself (same render code, inside the editor), so there was no separate fallback to remove.

### 3. Bottom panel

**Done.** Problems also lists blocked tasks and agents without a signal; Events keeps the seen rows, dimmed, above the marker.

- The panel frame: resizable, height kept per browser, ``⌃` `` toggles it.
- PROBLEMS: the decision cards (permissions, questions), stuck changes with the copyable `/team resume`, and red tests. `A`/`D` on the focused permission work as today; the forms keep their behavior (Enter, Ctrl/Cmd+Enter, typed text survives the re-render).
- EVENTS: the "since you left" timeline (`timeline.mjs`) as a log with a "since you left" marker and "mark as seen". Height is the panel's, not the content's.
- OUTPUT: the live tail of one round (`/api/tail`, see `docs/dashboard.md`).
- A new decision opens the panel on PROBLEMS and keeps the badge on the activity bar until answered.
- Overview drops the Decisions and "Since you left" blocks once the panel shows them.

### 3b. Tasks kanban

**Done.** Sub-tab Tasks in the change tab: To do / Doing / Test / Done from tasks.md and the rounds, one board, a colored kind badge per task (from its section). The server sends `taskList` per change and `taskIds` per run (`citedTasks`, ranges expanded). The phone version (one column at a time) goes with step 5.

### 4. Team and Settings as tabs

**Done.** Both are tabs (`views.mjs`); Settings saves the User scope and the per-project events through the existing `/api/notify`; the `ai-team.conf` keys stay read-only with the `--set` command to copy. The old `/team` and `/notifications` pages keep working unchanged for now; redirecting or removing them is left to step 6.

- Team tab: the agent table (name, owns, model, tools, running now, runs, time, cost), the gates as copyable code blocks with the `PATH` prefix shown once, and the cycle of a change behind a `?`.
- Settings tab in the VS Code style: search, **User** scope (`~/.config/ai-team/notify.json`, written through today's API) and **This project** scope. The ntfy security warning is pinned at the top with its one-click fix. "Open notify.json" shows the raw file.
- **This project is read-only in this step.** Writing `ai-team.conf` from the browser is a new write path into the repo and needs its own decision (auth, which keys, re-render). Until then each key shows the `./install.sh --render --set K=V .` command to copy.
- `/team` and `/notifications` keep answering and open the matching tab, so bookmarks and the ntfy link keep working.

### 5. Phone

**Done** (`mobile.mjs`), including the tasks kanban one column at a time. Home lists the decisions and links to the Inbox to answer them there (one place for the forms) instead of Allow / Deny on Home. Checked in a 390 px emulated phone; a check on a real phone through the Tailscale address is still to do.

A separate shell under 760 px, built from the same state; the desktop layout is not squeezed.

- Bottom bar: Home, Inbox (badge), Events, More. Home starts with "Needs you", then In progress, then one line for the rest.
- Change in full screen with back; the trail becomes a segmented bar; Tasks / Events / Info. No diff, rounds or files.
- Inbox answers permissions and questions with 44 px buttons; stuck shows the resume command to copy.
- `#inbox` deep link, and the ntfy notification opens it when the dashboard address is set.
- Check on a real phone through the Tailscale address, not only in a narrow desktop window (headless Chrome stops at 500 px).

### 6. Finish and cutover

**Done except the cutover**: agents are no longer colored by name (neutral avatars, the corner dot carries the state); ARIA links between tabs and their panels and tree levels in the explorer; the four themes checked on the new pieces; `docs/dashboard.md` updated for the new layout. Open: what to do with the old `/team` and `/notifications` pages, the check on a real phone, and the merge and reinstall, which wait for the developer's approval.

- Agents lose their per-name colors (initials in mono, color only for state).
- Themes (default, dracula, hacker, light), CRT and `prefers-reduced-motion` across the new pieces; ARIA roles for tree, tablist and tabpanel; focus stays sane when tabs open and close.
- `docs/dashboard.md` rewritten for the new layout; this plan is then removed or folded into `docs/dashboard-roadmap.md`.
- Cutover only with the developer's approval: merge `feat/dashboard-v3`, then re-install into the projects. Until then v2 is what runs.

## Later (needs the server)

- OUTPUT live tail: a route that streams the running agent's tool calls (`/api/tail`), over the existing SSE channel.
- Effort sparklines per agent.
- Editing `ai-team.conf` keys from Settings (see step 4).

## Risks

- **Size of `index.html`.** Mitigated by the new modules and by keeping the drawer until step 2 ends.
- **Keyboard conflicts** between explorer, tabs, panel and the decision shortcuts. One keymap in `ui.mjs`, tested as a pure function, and the `?` list generated from it.
- **Hub frame**: two status bars or two palettes. Checked at the end of every step with the hub on.
- **Re-render**: the page is rebuilt on every update; folded folders, open tabs, panel scroll and typed text must survive it, as the drawer state does today.
