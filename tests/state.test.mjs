// Tests of dashboard/state.sh, the only writer of the declared state line in a change's tasks.md header:
// valid values, allowed moves, --force, the real clock, in-place rewrite, the line the dashboard parses, and
// a call from a worktree that still writes the main checkout's tasks.md.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseDeclaredState } from '../dashboard/board.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-state-'));
const git = (cwd, ...args) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' });
try {
  const project = path.join(tmp, 'proj');
  const dash = path.join(project, '.claude', 'ai-team', 'dashboard');
  fs.mkdirSync(dash, { recursive: true });
  fs.copyFileSync(new URL('../dashboard/state.sh', import.meta.url), path.join(dash, 'state.sh'));
  fs.chmodSync(path.join(dash, 'state.sh'), 0o755);
  fs.writeFileSync(path.join(project, '.claude', 'ai-team.conf'), "PROJECT_NAME='p'\nOPENSPEC_HOME='.ai-team'\n");
  const chg = path.join(project, '.ai-team/openspec/changes/add-x');
  fs.mkdirSync(chg, { recursive: true });
  const tasks = path.join(chg, 'tasks.md');
  const body = '## 1. Backend\n- [ ] 1.1 a\n<!-- state: not the header -->\n';
  fs.writeFileSync(tasks, `# Tasks: add-x\n\n<!-- state: build · waiting: builder · since: 2026-11-13T12:00Z -->\n<!-- depends on: y -->\n\n${body}`);
  fs.chmodSync(tasks, 0o644);
  const run = (...args) => spawnSync('bash', ['.claude/ai-team/dashboard/state.sh', ...args], { cwd: project, encoding: 'utf8' });
  const header = () => fs.readFileSync(tasks, 'utf8').split(/^## /m)[0];
  const declared = () => parseDeclaredState(header());

  // a move the cycle does not allow is refused and nothing changes
  const before = fs.readFileSync(tasks, 'utf8');
  let r = run('add-x', 'integration', 'builder');
  assert.equal(r.status, 3); assert.match(r.stderr, /"build"; "integration" is not a move/); assert.match(r.stderr, /allowed: build \(same\) spec review/);
  assert.equal(fs.readFileSync(tasks, 'utf8'), before);

  // an allowed move: rewritten in place, real clock, the rest of the file untouched
  const t0 = Date.now();
  r = run('add-x', 'review', 'reviewer');
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /add-x build → review \(waiting: reviewer/);
  let d = declared();
  assert.equal(d.valid, true); assert.equal(d.stage, 'review'); assert.equal(d.waiting, 'reviewer');
  assert.ok(Math.abs(d.since - t0) < 120_000, 'since is now, not a made-up round time');
  assert.ok(fs.readFileSync(tasks, 'utf8').endsWith(body), 'sections untouched, a state comment in the body left alone');
  assert.match(header(), /^# Tasks: add-x\n\n<!-- state: review [^\n]*-->\n<!-- depends on: y -->\n\n$/);
  assert.equal(fs.statSync(tasks).mode & 0o777, 0o644, 'permissions kept');

  // a note: one line, cannot close the comment early; the dashboard reads it
  r = run('add-x', 'fix', 'builder', 'R3 · R5', '-->', 'line\nbreak');
  assert.equal(r.status, 0, r.stderr);
  d = declared();
  assert.equal(d.valid, true); assert.equal(d.stage, 'fix'); assert.equal(d.note, 'R3 · R5 -> line break');
  assert.equal((header().match(/<!-- state:/g) || []).length, 1);

  // same stage again (another who) and back to spec are always allowed
  assert.equal(run('add-x', 'fix', 'integrator').status, 0);
  assert.equal(run('add-x', 'spec', 'spec-writer').status, 0);
  assert.equal(declared().stage, 'spec');

  // --force needs a reason, which becomes the note
  assert.equal(run('--force', 'add-x', 'integration', 'builder').status, 2);
  r = run('--force', 'add-x', 'integration', 'builder', 'merged', 'by', 'hand');
  assert.equal(r.status, 0, r.stderr); assert.equal(declared().stage, 'integration'); assert.equal(declared().note, 'merged by hand');
  assert.equal(run('add-x', 'archived', 'queue').status, 0);
  r = run('add-x', 'spec', 'spec-writer');
  assert.equal(r.status, 3); assert.match(r.stderr, /archived/);

  // --show prints the line and the moves
  r = run('--show', 'add-x');
  assert.equal(r.status, 0); assert.match(r.stdout, /<!-- state: archived · waiting: queue/); assert.match(r.stdout, /next: none/);

  // wrong calls: usage, exit 2, nothing written
  const kept = fs.readFileSync(tasks, 'utf8');
  for (const bad of [['add-x', 'reviewing', 'reviewer'], ['add-x', 'review', 'bob'], ['a"b', 'review', 'reviewer'], ['archive', 'spec', 'queue'], ['add-x', 'review'], []]) {
    r = run(...bad);
    assert.equal(r.status, 2, `exit 2 for ${bad.join(' ')}`); assert.ok(r.stderr.length > 0);
  }
  assert.equal(fs.readFileSync(tasks, 'utf8'), kept);
  r = run('nope', 'spec', 'spec-writer');
  assert.equal(r.status, 4); assert.match(r.stderr, /\.ai-team\/openspec\/changes\/nope\/tasks\.md not found/);

  // an invalid line is repaired by any move; a missing line goes under the title; duplicates are dropped
  fs.writeFileSync(tasks, '# Tasks: add-x\n<!-- state: reviewing · waiting: bob -->\n<!-- state: build · waiting: builder · since: 2026-11-13T12:00Z -->\n## 1. Backend\n');
  assert.equal(run('add-x', 'approval', 'developer').status, 0);
  assert.equal((header().match(/<!-- state:/g) || []).length, 1); assert.equal(declared().stage, 'approval');
  fs.writeFileSync(tasks, '# Tasks: add-x\n\n## 1. Backend\n');
  assert.equal(run('add-x', 'spec', 'spec-writer').status, 0);
  assert.match(fs.readFileSync(tasks, 'utf8'), /^# Tasks: add-x\n\n<!-- state: spec · waiting: spec-writer · since: [^\n]+ -->\n\n## 1\. Backend\n$/);
  fs.writeFileSync(tasks, '- [ ] 1.1 a\n');
  assert.equal(run('add-x', 'spec', 'spec-writer').status, 0);
  assert.match(fs.readFileSync(tasks, 'utf8'), /^<!-- state: spec [^\n]+-->\n- \[ \] 1\.1 a\n$/);

  // from a worktree's own copy of the script: it writes the main checkout's tasks.md (artifacts live there)
  fs.writeFileSync(path.join(project, '.gitignore'), '.ai-team/\n.claude/worktrees/\n');
  git(project, 'init', '-q', '.'); git(project, 'add', '.claude', '.gitignore'); git(project, 'commit', '-q', '-m', 'init');
  const wt = path.join(project, '.claude', 'worktrees', 'add-x');
  const w = git(project, 'worktree', 'add', '-q', wt, '-b', 'change/add-x');
  assert.equal(w.status, 0, w.stderr);
  r = spawnSync('bash', ['.claude/ai-team/dashboard/state.sh', 'add-x', 'approval', 'developer'], { cwd: wt, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); assert.equal(declared().stage, 'approval');
  assert.ok(!fs.existsSync(path.join(wt, '.ai-team')), 'nothing written inside the worktree');

  // OpenSpec at the root (OPENSPEC_HOME='.')
  fs.writeFileSync(path.join(project, '.claude', 'ai-team.conf'), "OPENSPEC_HOME='.'\n");
  fs.mkdirSync(path.join(project, 'openspec/changes/add-y'), { recursive: true });
  fs.writeFileSync(path.join(project, 'openspec/changes/add-y/tasks.md'), '# Tasks: add-y\n');
  assert.equal(run('add-y', 'spec', 'spec-writer').status, 0);
  assert.match(fs.readFileSync(path.join(project, 'openspec/changes/add-y/tasks.md'), 'utf8'), /<!-- state: spec/);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('✓ state line ok');
