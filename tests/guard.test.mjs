// guard.mjs tests: what each team role is refused in PreToolUse, and what is not.
//   node tests/guard.test.mjs
import assert from 'node:assert/strict';
import { guard, denyOutput, ROLES } from '../dashboard/guard.mjs';

const bash = (agent, command) => guard({ hook_event_name: 'PreToolUse', agent_type: agent, tool_name: 'Bash', tool_input: { command } }, {});
const file = (agent, tool, file_path) => guard({ hook_event_name: 'PreToolUse', agent_type: agent, tool_name: tool, tool_input: { file_path } }, {});
const denied = (r, msg) => assert.ok(r && r.startsWith('ai-team guard ('), msg + ` (got ${JSON.stringify(r)})`);
const allowed = (r, msg) => assert.equal(r, null, msg);

{   // devs: add by path, hooks on, no discards; everything else goes on
  for (const dev of ['builder', 'integrator', 'provisioner']) {
    denied(bash(dev, 'git add -A'), `${dev}: git add -A`);
    denied(bash(dev, 'git add --all && git commit -m x'), `${dev}: --all in a chain`);
    denied(bash(dev, 'cd backend && git add .'), `${dev}: git add . after cd`);
    denied(bash(dev, 'git add -u'), `${dev}: git add -u`);
    denied(bash(dev, 'git -C /tmp/wt add -A'), `${dev}: -C before the subcommand`);
    denied(bash(dev, 'git commit -m "x" --no-verify'), `${dev}: --no-verify`);
    denied(bash(dev, 'git stash'), `${dev}: stash`);
    denied(bash(dev, 'git stash pop'), `${dev}: stash pop`);
    denied(bash(dev, 'git reset --hard HEAD~1'), `${dev}: reset --hard`);
    denied(bash(dev, 'git restore src/a.ts'), `${dev}: restore`);
    denied(bash(dev, 'git checkout -- src/a.ts'), `${dev}: checkout --`);
    denied(bash(dev, 'git checkout .'), `${dev}: checkout .`);
    denied(bash(dev, 'git clean -fd'), `${dev}: clean`);
    denied(bash(dev, 'git push --force origin change/x'), `${dev}: forced push`);
    denied(bash(dev, 'git push -f'), `${dev}: push -f`);
    denied(bash(dev, 'git push --force-with-lease=main'), `${dev}: force-with-lease`);
    denied(bash(dev, 'docker compose down -v'), `${dev}: compose down -v`);
    denied(bash(dev, 'docker-compose -f infra/compose.yml down --volumes'), `${dev}: compose down --volumes`);
    denied(bash(dev, 'docker volume prune -f'), `${dev}: volume prune`);
    denied(bash(dev, 'find / -name "*.env"'), `${dev}: find /`);
    allowed(bash(dev, 'git add src/a.ts src/b.ts'), `${dev}: add by path`);
    allowed(bash(dev, 'git add ./src/a.ts'), `${dev}: ./ path is not .`);
    allowed(bash(dev, 'git add -p src/a.ts'), `${dev}: add -p by path`);
    allowed(bash(dev, 'git commit -m "feat: x"'), `${dev}: commit`);
    allowed(bash(dev, 'git push -u origin change/x'), `${dev}: plain push`);
    allowed(bash(dev, 'git reset HEAD src/a.ts'), `${dev}: soft reset of the index`);
    allowed(bash(dev, 'git checkout -b change/x'), `${dev}: checkout -b`);
    allowed(bash(dev, 'git checkout change/x'), `${dev}: checkout branch`);
    allowed(bash(dev, 'docker compose down'), `${dev}: compose down without -v`);
    allowed(bash(dev, 'docker compose up -d && docker compose logs -f api | head'), `${dev}: compose up`);
    allowed(bash(dev, 'find . -name "*.ts" | xargs grep -l x'), `${dev}: find in the project`);
    allowed(bash(dev, 'find ./src -name "*.ts"'), `${dev}: find ./src`);
    allowed(bash(dev, 'make test'), `${dev}: gate`);
    allowed(bash(dev, 'git log --oneline -5 | cat'), `${dev}: log in a pipe`);
    allowed(bash(dev, 'echo "git add -A is forbidden"'), `${dev}: the words inside echo are not a git call`);
  }
}
{   // spec-writer: commit rules and env, but no discard rules (it never holds code)
  denied(bash('spec-writer', 'git add -A'), 'spec-writer: add -A');
  denied(bash('spec-writer', 'git commit --no-verify -m x'), 'spec-writer: --no-verify');
  denied(bash('spec-writer', 'docker compose down -v'), 'spec-writer: env');
  allowed(bash('spec-writer', 'git stash'), 'spec-writer: stash is not in its rules');
  allowed(bash('spec-writer', 'openspec validate add-x --strict'), 'spec-writer: openspec');
}
{   // reviewer and validator: read-only git, reports only
  for (const ro of ['reviewer', 'validator']) {
    for (const c of ['git commit -m x', 'git add a', 'git switch main', 'git checkout -b x', 'git stash', 'git reset --hard', 'git restore a', 'git clean -fd',
      'git branch -d x', 'git branch -D x', 'git merge x', 'git rebase main', 'git push', 'git pull', 'git rm a', 'git mv a b', 'git cherry-pick abc', 'git tag v1', 'git worktree add ../x',
      'cd .claude/worktrees/x && git commit -am fix', 'git -C /tmp/wt push origin x']) denied(bash(ro, c), `${ro}: ${c}`);
    for (const c of ['git show --stat abc', 'git show abc:src/a.ts', 'git log --oneline main..change/x', 'git diff abc~1 abc -- src/a.ts', 'git status --short', 'git cat-file -e abc',
      'git branch --show-current', 'git branch -a', 'git branch', 'git stash list', 'git worktree list', 'git show -U0 abc -- a.ts | head -50', 'git rev-parse HEAD',
      'wc -c openspec/changes/x/review-report.md', 'curl -s http://localhost:8080/api/x', 'make test', 'docker compose logs api']) allowed(bash(ro, c), `${ro}: ${c}`);
    denied(bash(ro, 'docker compose down -v'), `${ro}: env rules too`);
  }
  for (const tool of ['Write', 'Edit', 'MultiEdit']) {
    allowed(file('reviewer', tool, 'openspec/changes/add-x/review-report.md'), `reviewer: ${tool} on its report`);
    allowed(file('reviewer', tool, '/Users/me/proj/openspec/changes/add-x/review-report.md'), `reviewer: ${tool} absolute path`);
    denied(file('reviewer', tool, 'openspec/changes/add-x/validation-report.md'), `reviewer: ${tool} on the validator's report`);
    denied(file('reviewer', tool, 'openspec/changes/add-x/tasks.md'), `reviewer: ${tool} on tasks.md`);
    denied(file('reviewer', tool, 'src/a.ts'), `reviewer: ${tool} on code`);
    denied(file('reviewer', tool, 'review-report.md'), `reviewer: ${tool} on a report outside openspec/changes`);
    denied(file('reviewer', tool, 'openspec/changes/add-x/sub/review-report.md'), `reviewer: ${tool} nested folder`);
    denied(file('reviewer', tool, 'openspec/changes/archive/2026-add-x/../add-y/review-report.md'), `reviewer: ${tool} dot-dot path`);
    allowed(file('validator', tool, 'openspec/changes/add-x/validation-report.md'), `validator: ${tool} on its report`);
    allowed(file('validator', tool, 'openspec/changes/add-x/tasks.md'), `validator: ${tool} marks section 3 and the state line in tasks.md`);
    denied(file('validator', tool, 'openspec/changes/add-x/review-report.md'), `validator: ${tool} on the reviewer's report`);
    denied(file('validator', tool, 'openspec/changes/add-x/design.md'), `validator: ${tool} on design.md`);
  }
  denied(guard({ hook_event_name: 'PreToolUse', agent_type: 'reviewer', tool_name: 'NotebookEdit', tool_input: { notebook_path: 'a.ipynb' } }, {}), 'reviewer: NotebookEdit');
  allowed(guard({ hook_event_name: 'PreToolUse', agent_type: 'reviewer', tool_name: 'Edit', tool_input: {} }, {}), 'no path: nothing to judge');
  allowed(file('builder', 'Edit', 'src/a.ts'), 'devs write code');
  allowed(file('builder', 'Write', 'openspec/changes/add-x/design.md'), 'builder writes design.md');
}
{   // outside the team or outside PreToolUse: never a word
  allowed(guard({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'git add -A' } }, {}), 'main session (no agent_type)');
  allowed(guard({ hook_event_name: 'PreToolUse', agent_type: 'orchestrator', tool_name: 'Bash', tool_input: { command: 'git add -A' } }, {}), 'orchestrator has no rules');
  allowed(guard({ hook_event_name: 'PreToolUse', agent_type: 'Explore', tool_name: 'Bash', tool_input: { command: 'git add -A' } }, {}), 'a built-in agent');
  allowed(guard({ hook_event_name: 'PreToolUse', agent_type: 'my-agent', tool_name: 'Bash', tool_input: { command: 'git add -A' } }, {}), "the user's own agent");
  allowed(guard({ hook_event_name: 'PostToolUse', agent_type: 'builder', tool_name: 'Bash', tool_input: { command: 'git add -A' } }, {}), 'another event');
  allowed(guard({ hook_event_name: 'PreToolUse', agent_type: 'builder', tool_name: 'Bash', tool_input: { command: 'git add -A' } }, { AI_TEAM_GUARD: '0' }), 'AI_TEAM_GUARD=0');
  allowed(guard({ hook_event_name: 'PreToolUse', agent_type: 'builder', tool_name: 'Bash', tool_input: 'git add -A' }, {}), 'odd tool_input');
  allowed(guard({ hook_event_name: 'PreToolUse', agent_type: 'builder', tool_name: 'Bash' }, {}), 'no tool_input');
  allowed(guard(null, {}), 'null');
  allowed(guard({ hook_event_name: 'PreToolUse', agent_type: 'builder', tool_name: 'Read', tool_input: { file_path: 'x' } }, {}), 'Read is never judged');
}
{   // the reason names the role and its file; the output is what Claude Code expects
  const r = bash('reviewer', 'git commit -m x');
  assert.match(r, /^ai-team guard \(reviewer\): `git commit` changes a repository/);
  assert.match(r, /\.claude\/agents\/reviewer\.md\.$/);
  assert.deepEqual(JSON.parse(denyOutput(r)), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r } });
  assert.deepEqual(Object.keys(ROLES).sort(), ['builder', 'integrator', 'provisioner', 'reviewer', 'spec-writer', 'validator']);
}

console.log('✓ guard ok');
