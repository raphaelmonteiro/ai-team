---
name: gate-and-commit
description: Gate, commit, tasks.md marker and push protocol for {{PROJECT_NAME}}. Loaded by the agents that commit code (provisioner, builder, integrator); applies to every task, finding fix and ad-hoc task.
user-invocable: false
---

# Gate, commit and push

The single protocol for the fronts that commit code. What is specific to your
role (layers, tests, contract) is in your agent; here is only the
path of a change up to the push. Where the code is edited and how the
change reaches the working branch is in the `worktree` skill: the commits
go to `change/<id>`, in the change's worktree.

## Fronts
{{#if HAS_BACKEND}}
- **Backend** (sections `0. Infra`{{#if SAME_DIR}}{{#if HAS_FRONTEND}}, `1. Backend` and `2. Frontend`, same package{{else}} and `1. Backend`{{/if}}{{else}} and `1. Backend`{{/if}}): `{{BACKEND_DIR}}/`, working
  branch `{{BACKEND_BRANCH}}`{{#if BACKEND_PROTECTED_BRANCH}}, protected `{{BACKEND_PROTECTED_BRANCH}}`{{/if}}.
  Gate: {{#if BACKEND_GATE}}`{{BACKEND_GATE}}`{{else}}no command detected (see below){{/if}}.{{#if BACKEND_CMD_E2E}}
  E2E: `{{BACKEND_CMD_E2E}}`.{{/if}}
{{/if}}
{{#if HAS_FRONTEND}}
{{#unless SAME_DIR}}
- **Frontend** (section `2. Frontend`): `{{FRONTEND_DIR}}/`, working
  branch `{{FRONTEND_BRANCH}}`{{#if FRONTEND_PROTECTED_BRANCH}}, protected `{{FRONTEND_PROTECTED_BRANCH}}`{{/if}}.
  Gate: {{#if FRONTEND_GATE}}`{{FRONTEND_GATE}}`{{else}}no command detected (see below){{/if}}.{{#if FRONTEND_CMD_E2E}}
  E2E (scripts): `{{FRONTEND_CMD_E2E}}`.{{/if}}
{{/unless}}
{{/if}}

No gate detected: use the commands in `.claude/project-context.md`; if
those are empty too, define lint/test/build with the change and record them
in `design.md` and in `.claude/ai-team.conf`.

## During the section
- The gate runs inside the change's worktree.
- Quick gate before the `[x]` of each task and each intermediate commit:
  every command with code 0.
- E2E only filtered by the change's suite or scripts, never the full one
  during development, on your own stack and never in parallel with the
  gate.
- Red check: the task stays `[ ]` and you report the failure. Do not
  turn off a rule, do not use `eslint-disable`/`noqa`/`@ts-ignore`, do not
  add `ignore` or relax a limit without recording the exception, with a
  justification, in the change's `design.md`.

## Commit
- Only the task's files, added by path (`git add <file>`);
  never `git add -A`/`.`/`-u`, never `--no-verify`.
- Do not leave a change of yours uncommitted: the reviewer reviews only the
  recorded commits.

## Declared state
The `tasks.md` header has one line `<!-- state: … -->`. Never edit it by
hand: run `.claude/ai-team/dashboard/state.sh <change-id> <stage> <who> [note]`
(from the project root or the worktree; it writes the main checkout's
`tasks.md` with the real UTC clock). Run `build <your agent name>` when you
start a section, `review reviewer` when you close it, and `integration
orchestrator` right after `wt.sh integrate`. A fix round (findings or
validation bugs) runs `fix <your agent name>` when you start and `review
reviewer` when you close it. Exit 3 means the move is not allowed from the
current stage: do not force it; report the message to the orchestrator.

## Closing the section
Run the quick gate and the change's filtered e2e and write at the end of your
`tasks.md` section:

```
<!-- commits: <sha> <sha> -->
<!-- gate: <sha> <command>=0 <command>=0 ... -->
<!-- e2e: FILTER=<the change's suite or scripts> -->
```

In `gate`, one `name=code` pair per command of the front's gate (e.g.
`lint=0 typecheck=0 test=0 build=0 e2e=0`), with the sha of the last commit.
No e2e in the section: omit the `e2e` line.

## Push
{{#if GIT_NO_PUSH}}
No push by the agents (`GIT_NO_PUSH=1` in the conf): `change/<id>` and the
working branch stay local and the developer pushes. Write the closing gate
without a push.
- Never `--force` on a shared branch; `--force-with-lease` only on
  `change/<id>`, after a rebase.
{{else}}
When writing the closing gate, from the worktree: `git push -u origin change/<id>`.
The working branch only gets a push at integration (skill `worktree`).
- Never to the protected branch; never `--force` on a shared branch.
- `--force-with-lease` only on `change/<id>`, after a rebase.
- Before the first push of a new branch, check that there is no `.env` or
  secrets in the commits.
{{/if}}

## Reviewer findings
- Blocking `R<k>` addressed to you: its `Fix:` line is the direction, not
  the whole job. Fix the defect the finding describes (call the `Reuse:` code
  when there is one), in a new commit, and record the gate again, with the
  same `FILTER`. Before the commit:
  - **Test first.** A finding about behavior gets a unit test that fails on
    the current code and passes after the fix; run it once before the fix to
    see it fail. Cover the case the finding cites and the rule behind it, not
    only the literal example. A finding with no behavior (name, file layout,
    duplication, size) needs no new test.
  - **Callers.** For each function, type or shared value you change, find
    every caller and every other path that goes through it (`grep`), and
    confirm their behavior stays the same: the tests that cover them still
    pass, and a path with no test gets one when the change can reach it.
  - **Same defect elsewhere.** The same mistake in another call site or a
    sibling rule of the same requirement: fix it in the same commit and list
    it in the reply. Anything else you notice goes in the reply, not in the
    commit.
  - **Never delete or weaken a test** that covers a spec scenario or a rule
    to make the fix pass.
  A `Fix:` you cannot apply as written, or one that would break a test,
  another caller or a scenario: do not improvise a different approach;
  return the finding with the reason so the orchestrator sends it back to
  the reviewer. The reply lists, per `R<k>`: the test that failed before,
  the callers checked and the other places fixed.
- "Fix before archiving": new commit, filtered gate and
  `<!-- applied: R<k> <sha> -->` in your section; there is no new round.

## Ad-hoc task
No change and no `tasks.md`: everything above applies, except the markers. Return
in the reply the shas and the gate line (`<sha> lint=0 test=0 ...`).
