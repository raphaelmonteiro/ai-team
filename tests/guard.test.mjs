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
{   // the state line of tasks.md: only state.sh writes it; the rest of tasks.md stays free
  const T = 'openspec/changes/add-x/tasks.md';
  const L1 = '<!-- state: build · waiting: builder · since: 2026-11-13T10:00Z -->';
  const L2 = '<!-- state: review · waiting: reviewer · since: 2026-11-13T11:00Z -->';
  const disk = { '/p/.ai-team/openspec/changes/add-x/tasks.md': `# Tasks: add-x\n\n${L1}\n\n## 1. Backend\n- [ ] 1.1 a\n` };
  const readFile = (f) => { if (f in disk) return disk[f]; throw new Error('ENOENT'); };
  const call = (agent, tool, tool_input, cwd = '/p') => guard({ hook_event_name: 'PreToolUse', agent_type: agent, cwd, tool_name: tool, tool_input }, {}, { readFile });
  const isState = (r, msg) => { denied(r, msg); assert.match(r, /state\.sh <change-id> <stage> <who>/, msg); };
  for (const agent of ['builder', 'integrator', 'provisioner', 'spec-writer', 'validator']) {
    isState(call(agent, 'Edit', { file_path: T, old_string: L1, new_string: L2 }), `${agent}: Edit changes the line`);
    isState(call(agent, 'Edit', { file_path: `/abs/.ai-team/${T}`, old_string: '# Tasks: add-x\n', new_string: `# Tasks: add-x\n${L2}\n` }), `${agent}: Edit adds a line`);
    isState(call(agent, 'Edit', { file_path: T, old_string: `${L1}\n`, new_string: '' }), `${agent}: Edit removes the line`);
    isState(call(agent, 'MultiEdit', { file_path: T, edits: [{ old_string: '- [ ] 1.1', new_string: '- [x] 1.1' }, { old_string: L1, new_string: L2 }] }), `${agent}: one of the MultiEdit edits changes it`);
    allowed(call(agent, 'Edit', { file_path: T, old_string: '- [ ] 1.1 a', new_string: '- [x] 1.1 a\n  <!-- commits: abc1234 -->' }), `${agent}: ticking a task`);
    allowed(call(agent, 'Edit', { file_path: T, old_string: `${L1}\n\n## 1. Backend`, new_string: `${L1}\n\n## 1. Backend (api)` }), `${agent}: an edit around the line that keeps it`);
    allowed(call(agent, 'MultiEdit', { file_path: T, edits: [{ old_string: '- [ ] 1.1', new_string: '- [x] 1.1' }] }), `${agent}: MultiEdit away from the line`);
  }
  // Write: the header's line must stay what is on disk; a new file comes without one
  const W = '.ai-team/openspec/changes/add-x/tasks.md';
  allowed(call('spec-writer', 'Write', { file_path: W, content: `# Tasks: add-x\n\n${L1}\n\n## 1. Backend\n- [ ] 1.1 a\n- [ ] 1.2 b\n` }), 'Write that keeps the line');
  isState(call('spec-writer', 'Write', { file_path: W, content: `# Tasks: add-x\n\n${L2}\n\n## 1. Backend\n` }), 'Write that changes the line');
  isState(call('spec-writer', 'Write', { file_path: W, content: '# Tasks: add-x\n\n## 1. Backend\n' }), 'Write that drops the line');
  isState(call('spec-writer', 'Write', { file_path: '/p/.ai-team/openspec/changes/add-y/tasks.md', content: `# Tasks: add-y\n${L1}\n` }), 'a new tasks.md with a line');
  allowed(call('spec-writer', 'Write', { file_path: '/p/.ai-team/openspec/changes/add-y/tasks.md', content: '# Tasks: add-y\n\n## 1. Backend\n' }), 'a new tasks.md without one (then state.sh)');
  allowed(call('spec-writer', 'Write', { file_path: W, content: `# Tasks: add-x\n\n${L1}\n\n## 1. Backend\n<!-- state: in a section is not the header -->\n` }), 'a state comment in a section is not the header line');
  // only a change's tasks.md
  allowed(call('builder', 'Edit', { file_path: 'docs/notes.md', old_string: L1, new_string: L2 }), 'another file');
  allowed(call('builder', 'Edit', { file_path: 'openspec/changes/archive/2026-11-01-add-x/tasks.md', old_string: L1, new_string: L2 }), 'an archived change');
  denied(call('reviewer', 'Edit', { file_path: T, old_string: L1, new_string: L2 }), 'reviewer: refused anyway (files rule)');
  // the obvious way around through Bash
  for (const c of [`sed -i '' 's/state: build/state: review/' ${T}`, `sed -i.bak -e "s/<!-- state:.*-->/x/" ${W}`, `cd /p && perl -pi -e 's/state: build/state: fix/' ${T}`, `sed --in-place 's/state: a/state: b/' ${T}`])
    isState(bash('builder', c), `Bash: ${c}`);
  for (const c of [`sed -n '1,5p' ${T}`, `grep -n "state:" ${T}`, `.claude/ai-team/dashboard/state.sh add-x review reviewer`, `sed -i '' 's/1.1 a/1.1 b/' ${T}`, `sed -i '' 's/state/x/' src/state.ts`])
    allowed(bash('builder', c), `Bash: ${c}`);
}
{   // branch rule with a fake git: commits on a protected branch, pushes to one, GIT_NO_PUSH
  const fakeGit = (branch, common = '/p/.git') => (dir, args) => (args[0] === 'symbolic-ref' ? branch : args[0] === 'rev-parse' ? common : null);
  const run = (agent, command, { branch = 'staging', conf = { GIT_PROTECTED_BRANCHES: 'main' }, git } = {}) =>
    guard({ hook_event_name: 'PreToolUse', agent_type: agent, tool_name: 'Bash', cwd: '/p', tool_input: { command } }, { CLAUDE_PROJECT_DIR: '/p' }, { conf, git: git || fakeGit(branch) });
  for (const dev of ['builder', 'integrator', 'provisioner', 'spec-writer']) {
    denied(run(dev, 'git commit -m x', { branch: 'main' }), `${dev}: commit on main`);
    denied(run(dev, 'git merge change/x', { branch: 'main' }), `${dev}: merge into main`);
    allowed(run(dev, 'git commit -m x'), `${dev}: commit on the work branch`);
    denied(run(dev, 'git push origin main'), `${dev}: push to main`);
    denied(run(dev, 'git push origin HEAD:main'), `${dev}: push HEAD:main`);
    denied(run(dev, 'git push origin +change/x:refs/heads/main'), `${dev}: refspec to refs/heads/main`);
    denied(run(dev, 'git push origin', { branch: 'main' }), `${dev}: plain push while on main`);
    denied(run(dev, 'git push --all origin'), `${dev}: push --all`);
    allowed(run(dev, 'git push -u origin change/x'), `${dev}: push the change branch`);
    allowed(run(dev, 'git push origin --tags'), `${dev}: tags only`);
    denied(run(dev, 'git push -u origin change/x', { conf: { GIT_NO_PUSH: '1' } }), `${dev}: any push with GIT_NO_PUSH`);
    allowed(run(dev, 'git commit -m x', { branch: 'main', conf: {} }), `${dev}: nothing protected, nothing refused`);
  }
  for (const r of ['reviewer', 'validator']) allowed(run(r, 'git log main', { branch: 'main' }), `${r}: reads go on`);
  assert.match(run('builder', 'git commit -m x', { branch: 'main' }), /`git commit` on the protected branch `main` is prohibited/);
  assert.match(run('builder', 'git push', { conf: { GIT_NO_PUSH: '1' } }), /GIT_NO_PUSH=1/);
  // git is asked only for the subcommands that need it
  let calls = 0; const counting = (dir, args) => { calls++; return fakeGit('main')(dir, args); };
  run('builder', 'git status && git log && git add a.ts && git diff', { git: counting });
  assert.equal(calls, 0, 'no git call for reads and add');
  // the folder comes from cd and -C
  const seen = []; const where = (dir, args) => { seen.push(dir); return fakeGit('staging')(dir, args); };
  run('builder', 'cd backend && git commit -m x', { git: where });
  run('builder', 'git -C /wt/x commit -m x', { git: where });
  assert.deepEqual([...new Set(seen)], ['/p/backend', '/wt/x']);
}
{   // branch rule with real repositories: a worktree counts as its repository; a package with its own repository has its own rule
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-guard-')));
  const g = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { stdio: 'ignore' });
  const mk = (dir, branch) => { fs.mkdirSync(dir, { recursive: true }); g(dir, 'init', '-q', '-b', branch); g(dir, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'); };
  mk(root, 'main'); mk(path.join(root, 'api'), 'main');
  g(root, 'worktree', 'add', '-q', '-b', 'change/x', path.join(root, 'wt'));
  const conf = { GIT_PROTECTED_BRANCHES: 'main', BACKEND_DIR: 'api', BACKEND_OWN_REPO: '1', BACKEND_PROTECTED_BRANCH: 'release' };
  const real = (command, cwd = root) => guard({ hook_event_name: 'PreToolUse', agent_type: 'builder', tool_name: 'Bash', cwd, tool_input: { command } }, { CLAUDE_PROJECT_DIR: root }, { conf });
  denied(real('git commit -m x'), 'root repository on main');
  allowed(real('git commit -m x', path.join(root, 'wt')), 'its worktree is on change/x');
  denied(real(`git -C ${path.join(root, 'wt')} push origin main`), 'push to main from the worktree: same repository');
  allowed(real('cd api && git commit -m x'), 'the package repository protects release, not main');
  denied(real('cd api && git push origin release'), 'push to the package protected branch');
  fs.rmSync(root, { recursive: true, force: true });
}
{   // the reason names the role and its file; the output is what Claude Code expects
  const r = bash('reviewer', 'git commit -m x');
  assert.match(r, /^ai-team guard \(reviewer\): `git commit` changes a repository/);
  assert.match(r, /\.claude\/agents\/reviewer\.md\.$/);
  assert.deepEqual(JSON.parse(denyOutput(r)), { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r } });
  assert.deepEqual(Object.keys(ROLES).sort(), ['builder', 'integrator', 'provisioner', 'reviewer', 'spec-writer', 'validator']);
}

console.log('✓ guard ok');
