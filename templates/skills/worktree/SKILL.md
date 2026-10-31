---
name: worktree
description: One worktree per change in {{PROJECT_NAME}}: where the change's code is edited, where the OpenSpec artifacts live, how to integrate into the working branch and close. Loaded by the agents that commit code (provisioner, builder, integrator).
user-invocable: false
---

# Change worktree

Every change has the branch `change/<id>` and its own worktree in
`.claude/worktrees/`. The main checkout stays on the working branch,
free for the user and for integration. An ad-hoc task follows the same
path, with the slug in place of the id.

Script: `.claude/skills/worktree/wt.sh` (run it from the project root).

## Open, in every round
```
.claude/skills/worktree/wt.sh open <id> <front>
```
`<front>` is `backend` (sections `0. Infra` and `1. Backend`) or `frontend`
(section `2. Frontend`). The script creates the branch from the front's
working branch the first time and afterwards just returns the same worktree.
It prints the front's folder inside the worktree: that is where you work on
what, in the main checkout, would be {{#if HAS_BACKEND}}`{{BACKEND_DIR}}/`{{/if}}{{#if HAS_FRONTEND}}{{#unless SAME_DIR}} or `{{FRONTEND_DIR}}/`{{/unless}}{{/if}}.

- Code: read, edit and commit **only in the worktree**. Read/Edit/Write with the
  absolute path the script printed; in Bash, `cd <folder> && ...` in
  every command, including the gate.
- New worktree: the script copies `.env*` from the main checkout; install the
  stack's dependencies before the first gate.
- Never switch branches inside the worktree or work in another
  change's worktree.

## Artifacts stay in the main checkout
`openspec/changes/<id>/` (`tasks.md`, `design.md`, reports) and
`.claude/project-context.md` are read and written **in the main
checkout**, never in the copy that exists inside the worktree: that is where the
orchestrator and the dashboard read them. Do not commit `openspec/` on `change/<id>`.

## Environment
The main stack's database and services can be used. Whatever runs the
change's code (dev server, worker, e2e) comes up from the worktree; if another change is
running, use your own port{{#if HAS_DOCKER}} and, for the change's containers,
`COMPOSE_PROJECT_NAME={{PROJECT_NAME}}-<id>`{{/if}}. When returning, shut down what
you brought up.

## Integrate, only when the orchestrator says so
After an approved review (and validation, when there is one), the orchestrator asks each
dev to integrate their front:

1. `.claude/skills/worktree/wt.sh integrate <id> <front>`: `merge --no-ff`
   of `change/<id>` into the working branch, in the main checkout; prints
   the merge sha. If the main checkout is not on the working branch
   or there is a conflict, the script does not integrate: return the message to the orchestrator.
2. Run the gate in the main checkout. Red: do not push, do not undo
   the merge; return the output to the orchestrator.
3. Green: {{#if GIT_NO_PUSH}}nothing to push; the developer pushes the working branch{{else}}`git push origin <working branch>`{{/if}}.
4. `.claude/skills/worktree/wt.sh close <id>`: removes the worktrees and
   deletes the change's local branches already integrated; the fronts not yet
   integrated stay.

Return the merge sha and the gate line.

## Prohibited
`git worktree remove --force`, deleting a `.claude/worktrees/` folder by hand,
`git worktree prune` with another change's worktree, integrating without the
orchestrator's request.
