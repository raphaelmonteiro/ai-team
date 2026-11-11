// Tests of the task marks: dashboard/task.sh (any agent says when it starts, pauses and finishes a task) and the
// collector reading them from .claude/ai-team/events.jsonl into each change (taskMarks).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { collect } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-task-'));
try {
  const project = path.join(tmp, 'proj'), claude = path.join(tmp, 'claude');
  const dash = path.join(project, '.claude', 'dashboard');
  fs.mkdirSync(dash, { recursive: true }); fs.mkdirSync(path.join(claude, 'projects'), { recursive: true });
  fs.copyFileSync(new URL('../dashboard/task.sh', import.meta.url), path.join(dash, 'task.sh'));
  fs.chmodSync(path.join(dash, 'task.sh'), 0o755);
  fs.mkdirSync(path.join(project, 'openspec/changes/add-x'), { recursive: true });
  fs.writeFileSync(path.join(project, 'openspec/changes/add-x/tasks.md'), '## 2. Frontend\n- [ ] 2.1 a\n- [ ] 2.2 b\n');
  const run = (...args) => spawnSync('bash', ['.claude/dashboard/task.sh', ...args], { cwd: project, encoding: 'utf8' });
  const log = path.join(project, '.claude', 'ai-team', 'events.jsonl');
  const lines = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);

  let r = run('start', 'add-x', '2.1', 'integrator');
  assert.equal(r.status, 0); assert.match(r.stdout, /task start: add-x 2\.1 \(integrator\)/);
  run('start', 'add-x', '2.1,2.2', 'reviewer');
  run('done', 'add-x', '2.1', 'integrator');
  const l = lines();
  assert.equal(l.length, 3);
  assert.deepEqual({ ...l[1], ts: 'x' }, { ts: 'x', event: 'Task', action: 'start', change: 'add-x', tasks: ['2.1', '2.2'], agent: 'reviewer' });
  assert.match(l[0].ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);

  // a slip never stops the round: usage on stderr, exit 0, nothing written
  for (const bad of [['oops', 'add-x', '2.1', 'a'], ['start', 'a"b', '2.1', 'a'], ['start', 'add-x', '2.1;rm', 'a'], ['start', 'add-x', '2.1', 'a b'], ['start', 'add-x', '2.1']]) {
    r = run(...bad);
    assert.equal(r.status, 0, `exit 0 for ${bad.join(' ')}`); assert.match(r.stderr, /usage/);
  }
  assert.equal(lines().length, 3, 'nothing written for a wrong call');
  // from another folder (a worktree): the script finds the log next to itself
  r = spawnSync('bash', [path.join(dash, 'task.sh'), 'pause', 'add-x', '2.2', 'reviewer'], { cwd: tmp, encoding: 'utf8' });
  assert.equal(r.status, 0); assert.equal(lines().length, 4);

  // the collector reads them into the change, with malformed lines and other changes left out
  fs.appendFileSync(log, '{"ts":"2026-11-11T10:00:00Z","event":"Task","action":"start","change":"other","tasks":["1.1"],"agent":"builder"}\n{"event":"Task","action":"start"}\nnot json\n');
  const st = collect({ projectDir: project, claudeDir: claude });
  const c = st.changes.find((x) => x.id === 'add-x');
  assert.deepEqual(c.taskMarks.map((m) => [m.action, m.tasks.join(','), m.agent]), [['start', '2.1', 'integrator'], ['start', '2.1,2.2', 'reviewer'], ['done', '2.1', 'integrator'], ['pause', '2.2', 'reviewer']]);
  assert.ok(c.taskMarks.every((m) => Number.isFinite(m.ts)));
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('✓ task marks ok');
