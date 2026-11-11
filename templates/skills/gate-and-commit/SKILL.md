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
When writing the closing gate, from the worktree: `git push -u origin change/<id>`.
The working branch only gets a push at integration (skill `worktree`).
- Never to the protected branch; never `--force` on a shared branch.
- `--force-with-lease` only on `change/<id>`, after a rebase.
- Before the first push of a new branch, check that there is no `.env` or
  secrets in the commits.

## Reviewer findings
- Blocking `R<k>` addressed to you: fix only what the finding asks, in a
  new commit, and record the gate again, with the same `FILTER`.
- "Fix before archiving": new commit, filtered gate and
  `<!-- applied: R<k> <sha> -->` in your section; there is no new round.

## Ad-hoc task
No change and no `tasks.md`: everything above applies, except the markers. Return
in the reply the shas and the gate line (`<sha> lint=0 test=0 ...`).
