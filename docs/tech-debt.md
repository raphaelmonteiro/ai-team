# Tech debt

"backlog" severity findings from reviews, one `DT-<n>` item per module.
Sequential numbering, never reused. A resolved item stays in place,
marked with the date and sha of the fix.

## Environment documentation (`docs/environment.md`)

### DT-1: editing rule for environment findings
- **Location:** `docs/environment.md:55`, commit `3f95e17`.
- **Origin:** review of ad-hoc task `shellcheck-nativo`, finding R2, 2026-10-29.
- **Problem:** the commit edited an old finding in the "Recent findings" section,
  adding "(Superseded by the next finding...)". The agent template
  says "A new environment finding goes only at the end of 'Recent findings'"
  (`templates/agents/integrator.md:80`), but does not say whether old entries
  may be edited.
- **Pending decision:** define whether "Recent findings" is append-only
  (a superseded finding gets a new entry that references it) or whether annotating
  the old entry is allowed. Then write the rule down in
  `docs/standards.md`, and in the template if needed.
- **Severity:** backlog.
- **Suggested owner:** provisioner.
- **State:** open.

## Dashboard (`dashboard/ask.mjs`)

### DT-2: an already answered pending item stays in `pending`
- **Location:** `dashboard/ask.mjs:62` (`listPending`).
- **Origin:** provisional decision PV-1 of change `painel-custo-collect`, kept by the spec-writer, 2026-10-29.
- **Problem:** `listPending` lists the pending item even when
  `answers/<id>.json` already exists; it only disappears when the `ask.mjs` hook reads the answer (every
  300 ms) and deletes both files. A `GET /api/state` in that window, or
  with the hook alive but stuck, shows the decision again and allows answering
  it again (the second answer replaces the first).
- **Proposal:** `listPending` should skip a pending item that already has an answer, or
  mark it as "answered". Changes the `pending` contract of `/api/state`.
- **Severity:** backlog.
- **Suggested owner:** builder.
- **State:** open.

## Dashboard tests (`tests/`)

### DT-3: `bytesRead` in `projectdirs.test.mjs` does not restore `closeSync`
- **Location:** `tests/projectdirs.test.mjs:65-73`, commit `862231f`.
- **Origin:** review of change `painel-custo-collect`, finding R4 (round 1), 2026-10-29.
- **Problem:** the helper repeats the one in `tests/cache.test.mjs:53-58` and also
  swaps `fs.closeSync` without restoring it in `finally`. Each call wraps the
  previous one and the monkeypatch stays active for the rest of the file.
- **Proposal:** restore `closeSync` in `finally`, like `openSync` and
  `readSync`. The duplication between the two files waits until there is a
  test helper shared by the `.test.mjs` files.
- **Severity:** backlog.
- **Suggested owner:** builder.
- **State:** open.

### DT-4: `live.test.mjs` counts computations with real timers
- **Location:** `tests/live.test.mjs:63,86,110,130`, commit `c40e187`.
- **Origin:** review of change `painel-custo-collect`, finding R5 (round 1), 2026-10-29.
- **Problem:** the collector's clock is injected, but the count assertions
  depend on real `sleep`s (350, 250 and 500 ms against a 700 ms debounce and
  40 ms polling). On macOS `fs.watch` may deliver two events for the same
  write more than `debounceMs` (100 ms) apart, which gives two computations
  and a false red in the gate. Goes against the rule "invariant tests in the gate
  are deterministic, no time".
- **Proposal:** fire the `broadcast` through a context hook, or put
  `debounceMs` and `pollMs` under the test's control, instead of waiting for the timer.
- **Severity:** backlog.
- **Suggested owner:** builder.
- **State:** open.

## Dashboard (`dashboard/live.mjs`)

### DT-5: `fs.watch` on `.claude/ai-team/` only opens on the next tick
- **Location:** `dashboard/live.mjs` (opening the watchers).
- **Origin:** limitation in the `validation-report.md` of change `painel-custo-collect` (pre-existing), 2026-10-29.
- **Problem:** if `.claude/ai-team/` does not exist when the server starts, the
  `fs.watch` on that folder only opens on the next polling tick (5 s). A
  pending item created in that interval only appears on the tick.
- **Proposal:** watch the parent until the folder exists, or create it at startup.
- **Severity:** backlog.
- **Suggested owner:** builder.
- **State:** open.

## Dashboard (`dashboard/hook.sh`)

### DT-6: `dashboard/hook.sh` with mode 100644 in git (resolved on 2026-10-29, a6d9dce)
- **Location:** `dashboard/hook.sh` (mode `100644` in the index).
- **Origin:** limitation in the `validation-report.md` of change `painel-custo-collect` (pre-existing), 2026-10-29.
- **Problem:** running it directly gives `Permission denied`. The installed `settings.json`
  files depend on the installer's `chmod`, and the tests use `bash hook.sh`.
- **Proposal:** `git update-index --chmod=+x dashboard/hook.sh` and a test that
  checks the execute bit.
- **Severity:** backlog.
- **Suggested owner:** provisioner.
- **State:** resolved on 2026-10-29 (commit a6d9dce).
