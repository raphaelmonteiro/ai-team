// Change board tests: the "waiting" heuristic, the split into
// in progress/pending/done (top 3), inferred stage and openspec reading.
//   node tests/board.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseTasks, waitingFor, splitChanges, inferStage, changeFiles, resolveChangeFile, parseChangePath } from '../dashboard/board.mjs';
import { collect } from '../dashboard/collect.mjs';
const wait = (tasksMd, extra = {}) => {
  const p = parseTasks(tasksMd);
  return waitingFor({ archived: false, header: p.header, taskList: p.tasks, review: null, validation: null, ...extra });
};

// --- "waiting for what" ----------------------------------------------------------
{
  const head = (h) => `# Tasks: x\n\n${h}\n\n## 1. Backend (builder)\n\n- [ ] 1.1 something\n`;
  for (const h of ['> **PROPOSAL revised, awaiting approval from the developer.**', '> DRAFT — awaiting reading', '> awaiting approval', '> DRAFT, not in force yet', '> proposal awaiting reading by the backend first', 'State: DRAFT, not in force yet', '> **State:** proposal awaiting reading by the backend first', '> **awaiting reading**']) {
    const w = wait(head(h));
    assert.equal(w.text, 'waiting for the developer', h);
    assert.match(w.rule, /header/);
  }
  assert.notEqual(wait(head('> **APPROVED by the developer on 2026-10-20.**')).text, 'waiting for the developer', 'APPROVED does not fire');
  // approved, with "drafts" in the descriptive text
  const synthetic = `# T\n\n> **Approved by the developer on 2026-10-23.**\n\n> Decision: this change only creates drafts, with status draft|sent; the reading is awaiting approval.\n\n## 1. Backend\n- [ ] 1.1 a\n`;
  assert.notEqual(wait(synthetic).text, 'waiting for the developer', 'approved + drafts in the scope');
  // without approval, "drafts" in the description does not count; only the state line
  assert.notEqual(wait(head('> Scope: only creates session drafts.')).text, 'waiting for the developer');
  // descriptive text mid-sentence does not count, nor a line starting with another word
  assert.notEqual(wait(head('> Scope: the reading is awaiting a decision; only creates drafts.')).text, 'waiting for the developer');
  assert.notEqual(wait(head('> Decision: this change creates drafts.')).text, 'waiting for the developer');
  // "awaiting" outside the header (in the tasks) does not fire
  assert.notEqual(wait(`# T\n\n## 1. Backend\n- [ ] 1.1 x <!-- done: awaiting approval -->\n`).text, 'waiting for the developer');

  // review with CHANGES REQUESTED in the last round
  const allDone = `## 1. Backend\n- [x] 1.1 a\n- [x] 1.2 b\n`;
  let w = wait(allDone, { review: 'CHANGES REQUESTED' });
  assert.equal(w.text, 'waiting for fix');
  assert.match(w.rule, /CHANGES REQUESTED/);
  // the header beats the review (rule order)
  assert.equal(wait(`> awaiting approval\n\n${allDone}`, { review: 'CHANGES REQUESTED' }).text, 'waiting for the developer');

  // all [x], no review
  w = wait(allDone);
  assert.equal(w.text, 'waiting for review');
  // all [x] with an approved review: the heuristic does not know what is left
  w = wait(allDone, { review: 'APPROVED' });
  assert.equal(w.text, 'undefined');
  assert.match(w.rule, /validation or archiving/);
  assert.equal(wait(allDone, { review: 'maybe' }).text, 'undefined', 'result not recognized');
  assert.equal(wait(allDone, { review: 'NOT APPROVED' }).text, 'undefined', 'NOT APPROVED is not an approval');

  // dependencies
  const deps = `## 0. Infra (provisioner)\n- [ ] 0.1 fixtures <!-- depends on: 1.2 -->\n## 1. Backend (builder)\n- [x] 1.1 a <!-- depends on: — -->\n- [ ] 1.2 b <!-- depends on: 1.1 -->\n- [ ] 1.3 c <!-- depends on: 1.2 -->\n`;
  w = wait(deps);
  assert.equal(w.text, 'waiting to run task 1.2 (Backend)', 'the unblocked one beats 0.1, which comes first in the file but depends on 1.2');
  assert.match(w.rule, /dependencies/);
  const stuck = `## 1. Backend\n- [ ] 1.2 b <!-- depends on: 1.1 -->\n- [ ] 1.1 a <!-- depends on: 1.2 -->\n`;
  w = wait(stuck);
  assert.equal(w.text, 'waiting for task 1.1');
  assert.match(w.rule, /no \[ \] task is unblocked/);
  const multi = `## 1. Backend\n- [ ] 1.1 a <!-- depends on: 1.2, 1.3 -->\n- [ ] 1.2 b <!-- depends on: 1.3 -->\n- [ ] 1.3 c <!-- depends on: 1.1 -->\n`;
  assert.equal(wait(multi).text, 'waiting for task 1.2, 1.3');

  // undefined: dependency that is not a task of this change, missing id, blocked, no tasks
  w = wait(`## 1. Backend\n- [ ] 1.1 a <!-- depends on: add-other-change -->\n`);
  assert.equal(w.text, 'undefined'); assert.match(w.rule, /not a task of this change/);
  assert.equal(wait(`## 1. Backend\n- [ ] 1.1 a <!-- depends on: 9.9 -->\n`).text, 'undefined', 'id that does not exist');
  w = wait(`## 1. Backend\n- [ ] 1.1 a (blocked: D-12)\n`);
  assert.equal(w.text, 'undefined'); assert.match(w.rule, /blocked/);
  assert.equal(wait('# text only\n').text, 'undefined');
  assert.equal(waitingFor({ archived: true, taskList: [], header: '', review: null }).text, 'nothing (archived)');
}

// --- parseTasks -------------------------------------------------------------------
{
  const p = parseTasks(`# T\n> head\n\n## 0. Infra (provisioner)\n- [x] 0.1 a <!-- depends on: — -->\n* [ ] 0.2b b <!-- depends on: 0.1, 1.1 -->\n- [ ] unnumbered\n`);
  assert.equal(p.header.includes('> head'), true);
  assert.deepEqual(p.tasks.map((t) => [t.id, t.done, t.section]), [['0.1', true, 'Infra (provisioner)'], ['0.2b', false, 'Infra (provisioner)'], [null, false, 'Infra (provisioner)']]);
  assert.deepEqual(p.tasks[1].deps, { ids: ['0.1', '1.1'], unknown: false });
  assert.deepEqual(p.tasks[0].deps, { ids: [], unknown: false });
}

// --- split ------------------------------------------------------------------------
{
  const mk = (id, status, t) => ({ id, status, lastActivity: t, completedAt: t });
  const list = [mk('a', 'done', 5), mk('b', 'in progress', 1), mk('c', 'pending', 2), mk('d', 'done', 9), mk('e', 'done', 7),
    mk('f', 'done', 1), mk('g', 'blocked', 3), mk('h', 'in progress', 4), mk('i', 'done', 8), mk('(no change)', 'ad-hoc', 0)];
  const s = splitChanges(list);
  assert.deepEqual(s.running.map((c) => c.id), ['h', 'b']);
  assert.deepEqual(s.pending.map((c) => c.id), ['c']);
  assert.deepEqual(s.blocked.map((c) => c.id), ['g']);
  assert.deepEqual(s.done.map((c) => c.id), ['d', 'i', 'e'], 'latest 3 done, most recent first');
  assert.deepEqual(s.doneOlder.map((c) => c.id), ['a', 'f']);
  assert.equal(s.other.length, 1);
  assert.equal(splitChanges([mk('x', 'done', 1)]).doneOlder.length, 0);
}

// --- inferred stage ----------------------------------------------------------------------
assert.equal(inferStage('builder', 'section 1', 'Implement section 1. Backend of openspec/changes/x/tasks.md'), 'section 1 (Backend)');
assert.equal(inferStage('provisioner', '', 'Do task 0.3 and then 0.4'), 'task 0.3');
assert.equal(inferStage('reviewer', 'round 2', 'Review the commits'), 'review');
assert.equal(inferStage('validator', '', 'Validate'), 'validation');
assert.equal(inferStage('spec-writer', 'archive change', 'Archive the change'), 'archived');
assert.equal(inferStage('spec-writer', 'create proposal', 'Write the proposal'), 'spec');
assert.equal(inferStage('general-purpose', 'search', 'Find a file'), null, 'no clue: null, no guess');

// --- collection over a sample openspec ---------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-board-'));
try {
  const proj = path.join(tmp, 'proj');
  const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
  const ch = (id, tasks, extra = {}) => { w(path.join(proj, 'openspec/changes', id, 'tasks.md'), tasks); for (const [f, s] of Object.entries(extra)) w(path.join(proj, 'openspec/changes', id, f), s); };
  ch('draft', `# T\n\n> DRAFT\n\n## 1. Backend\n- [ ] 1.1 a\n`);
  ch('to-fix', `## 1. Backend\n- [x] 1.1 a\n`, { 'review-report.md': '## Round 1\nResult: CHANGES REQUESTED\n' });
  ch('to-review', `## 1. Backend\n- [x] 1.1 a\n- [x] 1.2 b\n`);
  ch('middle', `## 1. Backend\n- [x] 1.1 a\n- [ ] 1.2 b <!-- depends on: 1.1 -->\n`);
  ch('stuck', `## 1. Backend\n- [ ] 1.1 a (blocked: D-1)\n`);
  ch('ready', `## 1. Backend\n- [x] 1.1 a\n- [x] 1.2 b\n`, { 'review-report.md': 'Result: APPROVED\n', 'validation-report.md': 'Result: APPROVED\n', 'design.md': 'd', 'specs/a/spec.md': 's', 'notes.txt': 'n' });
  for (const [d, id] of [['2026-10-01', 'old-1'], ['2026-10-05', 'old-2'], ['2026-10-03', 'old-3'], ['2026-10-09', 'old-4'], ['2026-10-07', 'old-5']]) {
    w(path.join(proj, 'openspec/changes/archive', `${d}-${id}`, 'tasks.md'), `## 1. Backend\n- [x] 1.1 a\n`);
  }
  const st = collect({ projectDir: proj, claudeDir: path.join(tmp, 'no-claude') });
  const by = Object.fromEntries(st.changes.map((c) => [c.id, c]));
  assert.equal(by['draft'].waiting.text, 'waiting for the developer');
  assert.equal(by['to-fix'].waiting.text, 'waiting for fix');
  assert.equal(by['to-review'].waiting.text, 'waiting for review');
  assert.equal(by['middle'].waiting.text, 'waiting to run task 1.2 (Backend)');
  assert.equal(by['stuck'].waiting.text, 'undefined');
  assert.equal(by['stuck'].status, 'blocked');
  assert.equal(by['ready'].status, 'done', 'tasks [x] + review APPROVED');
  assert.equal(by['to-review'].status, 'in progress', 'tasks [x] without a review is not done yet');
  assert.equal(by['draft'].status, 'pending');
  assert.deepEqual(st.board.pending, ['draft']);
  assert.deepEqual(st.board.running.sort(), ['middle', 'to-fix', 'to-review']);
  assert.deepEqual(st.board.done, ['ready', 'old-4', 'old-5'], 'top 3: the just-finished one and the newest archived');
  assert.deepEqual(st.board.doneOlder, ['old-2', 'old-3', 'old-1'], 'the others, collapsed');
  assert.ok(by['old-1'].archived && by['old-1'].waiting.text === 'nothing (archived)');
  // start: without an agent run, it comes from the folder (or the archive)
  assert.equal(by['middle'].startSource, 'folder creation');
  assert.ok(by['middle'].startedAt > 0);
  assert.equal(by['old-2'].startedAt != null, true);
  // .md files: fixed order, specs/**, .md only
  assert.deepEqual(by['ready'].files, ['design.md', 'tasks.md', 'review-report.md', 'validation-report.md', 'specs/a/spec.md']);
  assert.deepEqual(changeFiles(path.join(proj, 'openspec/changes/ready')), by['ready'].files);

  // sections
  assert.deepEqual(by['middle'].sections, { Backend: { total: 2, done: 1 } });

  // resolveChangeFile
  const ok = (id, segs) => resolveChangeFile(proj, id, segs);
  assert.ok(ok('ready', ['tasks.md']));
  assert.ok(ok('ready', ['specs', 'a', 'spec.md']));
  assert.ok(ok('old-2', ['tasks.md']), 'archived change');
  for (const [id, segs] of [['ready', ['..', '..', 'x.md']], ['ready', ['notes.txt']], ['ready', ['a/b.md']], ['ready', ['..%2Ftasks.md']],
    ['ready', ['.md']], ['ready', ['.hidden.md']], ['..', ['tasks.md']], ['archive', ['old-2', 'tasks.md']], ['ready', ['specs', '..', 'tasks.md']],
    ['ready', ['other', 'x.md']], ['does-not-exist', ['tasks.md']], ['ready', []], ['ready', ['tasks.md\0']], ['ready/../middle', ['tasks.md']]]) {
    assert.equal(ok(id, segs), null, `refuses ${id} ${JSON.stringify(segs)}`);
  }
  w(path.join(tmp, 'secret.md'), 'secret');
  fs.symlinkSync(path.join(tmp, 'secret.md'), path.join(proj, 'openspec/changes/ready/leak.md'));
  assert.equal(ok('ready', ['leak.md']), null, 'symlink that leaves the change folder');

  // parseChangePath
  assert.deepEqual(parseChangePath('/changes/ready/specs/a/spec.md'), { id: 'ready', segments: ['specs', 'a', 'spec.md'] });
  assert.equal(parseChangePath('/changes/ready/%E0%A4%A'), null, 'invalid percent-encoding');
  assert.equal(parseChangePath('/changes/ready'), null);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log('✓ board: board ok');
