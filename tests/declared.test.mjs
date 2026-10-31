// Declared state ("state:" line of tasks.md): parsing, validation and priority over the heuristic.
//   node tests/declared.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseDeclaredState } from '../dashboard/board.mjs';
import { collect } from '../dashboard/collect.mjs';

// ---- parser ----
const ok = parseDeclaredState('# x\n<!-- state: review · waiting: reviewer · since: 2026-10-24T09:30Z · note: 2nd round · partial -->\n');
assert.deepEqual([ok.valid, ok.stage, ok.waiting, ok.sinceIso, ok.note], [true, 'review', 'reviewer', '2026-10-24T09:30Z', '2nd round · partial']);
assert.equal(ok.since, Date.parse('2026-10-24T09:30:00Z'));
assert.equal(parseDeclaredState('<!-- state: validation · waiting: queue · since: 2026-10-24T09:30Z -->').note, '', 'note is optional');
assert.equal(parseDeclaredState('# no line\n> State: draft'), null, 'without the line: null');
const bad = (h, re) => { const r = parseDeclaredState(h); assert.equal(r.valid, false, h); assert.match(r.reason, re, h); };
bad('<!-- state: ready · waiting: validator · since: 2026-10-24T09:30Z -->', /stage "ready"/);
bad('<!-- state: validation · waiting: manager · since: 2026-10-24T09:30Z -->', /waiting "manager"/);
bad('<!-- state: validation · waiting: validator · since: 2026-13-45T09:30Z -->', /date/);
bad('<!-- state: validation · waiting: validator · since: yesterday -->', /date/);
bad('<!-- state: validation · waiting: validator -->', /missing field "since"/);
bad('<!-- state: validation · waiting: validator · since: 2026-10-24T09:30Z · color: blue -->', /unknown field/);

// ---- collector ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-decl-'));
const project = path.join(tmp, 'proj'), claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-24T12:00:00Z');
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const mk = (id, header, body = '## 1. Backend\n- [ ] 1.1 a\n- [ ] 1.2 b\n') => w(path.join(project, 'openspec/changes', id, 'tasks.md'), `# ${id}\n${header}\n\n${body}`);
mk('with-line', '<!-- state: validation · waiting: validator · since: 2026-10-24T10:00Z · note: environment coming up -->');
mk('bad-line', '<!-- state: ready · waiting: validator · since: 2026-10-24T10:00Z -->');
mk('no-line', '> State: DRAFT, awaiting approval');
mk('archived-decl', '<!-- state: archived · waiting: queue · since: 2026-10-24T10:00Z -->');
mk('approv', '<!-- state: approval · waiting: developer · since: 2026-10-24T11:00Z -->');
w(path.join(claude, 'projects/x/placeholder'), '');
const st = collect({ projectDir: project, claudeDir: claude, now });
const by = (id) => st.changes.find((c) => c.id === id);

// valid line that contradicts the heuristic (open tasks => "run task 1.1"): the declared one wins
const a = by('with-line');
assert.equal(a.waiting.source, 'declared');
assert.equal(a.waiting.text, 'waiting for validator');
assert.equal(a.waiting.since, Date.parse('2026-10-24T10:00:00Z'));
assert.equal(a.waiting.note, 'environment coming up');
assert.equal(a.waiting.heuristic, 'waiting to run task 1.1 (Backend)', 'the heuristic is recorded, but does not rule');
assert.equal(a.trail.source, 'declared'); assert.equal(a.trail.current, 'validation');
assert.deepEqual(a.trail.steps.map((s) => s.state), ['done', 'done', 'done', 'done', 'pending', 'active', 'pending'], 'fix without a run stays pending');
assert.equal(a.trail.steps.find((s) => s.key === 'integration').state, 'pending', 'stages after the declared one stay pending');
assert.equal(a.trail.next.key, 'integration');
assert.ok(st.stages.changes.validation.includes('with-line'), 'the count per stage follows the declared one');

// invalid line: heuristic + warning
const b = by('bad-line');
assert.equal(b.waiting.source, 'inferred');
assert.match(b.waiting.warning, /^invalid declared state: stage "ready"/);
assert.equal(b.trail.source, 'inferred'); assert.match(b.trail.warning, /invalid declared state/);
assert.equal(b.waiting.text, 'waiting to run task 1.1 (Backend)');

// missing line: as before
const c = by('no-line');
assert.equal(c.waiting.source, 'inferred'); assert.equal(c.waiting.warning, undefined);
assert.equal(c.waiting.text, 'waiting for the developer'); assert.equal(c.trail.warning, null);
assert.equal(c.declared, null);

// declared approval: the trail only completes what comes before
const d = by('approv');
assert.equal(d.trail.current, 'approval');
assert.deepEqual(d.trail.steps.map((s) => s.state).slice(0, 3), ['done', 'active', 'pending']);
assert.equal(d.waiting.text, 'waiting for developer');
assert.ok(st.stages.changes.you.includes('approv'));

// declared archived
const e = by('archived-decl');
assert.equal(e.status, 'done'); assert.equal(e.waiting.text, 'nothing (archived)'); assert.equal(e.waiting.source, 'declared');
assert.equal(e.trail.current, null); assert.ok(e.trail.steps.filter((s) => s.key !== 'fix').every((s) => s.state === 'done'));
assert.ok(!Object.values(st.stages.changes).some((l) => l.includes('archived-decl')), 'archived does not enter the stages');

console.log('✓ declared state ok');
