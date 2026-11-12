// OUTPUT panel: readTail reads only what a transcript gained, keeps one round's records, and the page pairs calls
// with their results
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readTail, stepsOf, toolArg, resultText, shortPaths, RESULT_LINES, TAIL_BYTES } from '../dashboard/tail.mjs';
import { outputOptions, followRun, outputRows } from '../dashboard/shell.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-tail-'));
const f = path.join(tmp, 'agent-x.jsonl');
const T = (min) => new Date(Date.UTC(2026, 10, 12, 10, min)).toISOString();
const rec = (o) => JSON.stringify(o) + '\n';
const asst = (min, content) => rec({ type: 'assistant', timestamp: T(min), message: { role: 'assistant', content } });
const user = (min, content, extra = {}) => rec({ type: 'user', timestamp: T(min), message: { role: 'user', content }, ...extra });

// the steps of each kind of record
assert.deepEqual(stepsOf(JSON.parse(asst(1, [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: ' hello ' }, { type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm test' } }]))).map((s) => [s.k, s.text || s.arg]),
  [['text', 'hello'], ['tool', 'npm test']], 'thinking is left out');
assert.equal(toolArg('Edit', { file_path: '/p/a.ts', old_string: 'x' }), '/p/a.ts');
assert.equal(toolArg('Grep', { pattern: 'foo' }), 'foo');
{ const r = resultText(Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n') + '\n\n');
  assert.deepEqual([r.lines, r.cut, r.text.split('\n').length, r.text.split('\n').pop()], [100, 100 - RESULT_LINES, RESULT_LINES, 'line 99'], 'a result keeps its last lines'); }
assert.deepEqual(stepsOf(JSON.parse(user(2, [{ type: 'tool_result', tool_use_id: 'a', is_error: true, content: [{ type: 'text', text: 'boom' }] }]))).map((s) => [s.k, s.ok, s.text]), [['result', false, 'boom']]);
assert.deepEqual(stepsOf(JSON.parse(user(3, 'Implement 2.1'))).map((s) => s.k), ['prompt']);
assert.deepEqual(stepsOf(JSON.parse(user(3, 'summary…', { isCompactSummary: true }))).map((s) => s.k), ['note'], 'a compacted session says so');
assert.deepEqual(stepsOf(JSON.parse(user(3, 'meta', { isMeta: true }))), [], 'meta records are left out');

// incremental reads: only what the file gained; a line still being written waits for the next read
fs.writeFileSync(f, user(0, 'Implement 2.1') + asst(1, [{ type: 'tool_use', id: 'a', name: 'Bash', input: { command: 'npm test' } }]));
let r = readTail(f);
assert.deepEqual(r.steps.map((s) => s.k), ['prompt', 'tool']); assert.equal(r.offset, fs.statSync(f).size);
const half = user(2, [{ type: 'tool_result', tool_use_id: 'a', content: 'ok 12 passed' }]);
fs.appendFileSync(f, half.slice(0, 20));
const r2 = readTail(f, { after: r.offset });
assert.deepEqual([r2.steps.length, r2.offset], [0, r.offset], 'a partial line is not consumed');
fs.appendFileSync(f, half.slice(20));
const r3 = readTail(f, { after: r2.offset });
assert.deepEqual(r3.steps.map((s) => [s.k, s.text]), [['result', 'ok 12 passed']]);
assert.equal(readTail(f, { after: r3.offset }).steps.length, 0, 'nothing new');
assert.equal(readTail(f, { after: 10 ** 9 }).reset, true, 'an offset past the end (the file was replaced) starts again');
assert.deepEqual(readTail(path.join(tmp, 'gone.jsonl')), { steps: [], offset: 0, size: 0, missing: true });

// one leg of a resumed agent: only its own records
fs.appendFileSync(f, user(30, 'The coordinator sent a message while you were working: fix R1') + asst(31, [{ type: 'text', text: 'fixing R1' }]));
assert.deepEqual(readTail(f, { from: Date.parse(T(30)) }).steps.map((s) => s.text), ['The coordinator sent a message while you were working: fix R1', 'fixing R1']);
assert.ok(!readTail(f, { to: Date.parse(T(5)) }).steps.some((s) => s.text === 'fixing R1'), 'an earlier leg stops where it ended');

// a big file: the first read starts near the end, on a whole line
{ const big = path.join(tmp, 'big.jsonl'); let s = '';
  while (s.length < TAIL_BYTES * 2) s += asst(1, [{ type: 'text', text: 'x'.repeat(500) }]);
  s += asst(2, [{ type: 'text', text: 'the end' }]);
  fs.writeFileSync(big, s);
  const b = readTail(big);
  assert.equal(b.steps.at(-1).text, 'the end'); assert.ok(b.steps.every((x) => x.k === 'text'), 'no broken first line'); }

// paths read shorter
assert.deepEqual(shortPaths([{ k: 'tool', arg: 'cd /Users/me/p && cat /Users/me/notes' }, { k: 'text', text: '/Users/me/p/a.ts' }], { root: '/Users/me/p', home: '/Users/me' }).map((x) => x.arg || x.text),
  ['cd . && cat ~/notes', './a.ts']);

// the page: calls paired with their results; which round to follow
assert.deepEqual(outputRows([{ k: 'tool', id: 'a', name: 'Bash' }, { k: 'text', text: 'x' }, { k: 'result', id: 'a', ok: true }, { k: 'result', id: 'zz', ok: true }]).map((x) => [x.k, x.result ? x.result.id : null]),
  [['tool', 'a'], ['text', null], ['result', 'zz']], 'a result whose call fell before the read stays on its own');
const state = {
  running: [{ id: 'main:s1', agent: 'orchestrator', main: true, status: 'running', start: 1 }, { id: 'b2', agent: 'reviewer', change: 'c2', status: 'running', start: 5 }, { id: 'b1', agent: 'builder', change: 'c1', status: 'running', start: 3 }],
  recent: [{ id: 'v1', agent: 'validator', change: 'c3', status: 'finished', end: 9 }, { id: 'b1', agent: 'builder', change: 'c1', status: 'running' }],
  changes: [{ id: 'c1', runs: [] }, { id: 'c3', runs: [{ id: 'v0', start: 1, end: 2 }, { id: 'v1', start: 3, end: 9 }] }, { id: 'c4', runs: [] }],
};
assert.deepEqual(outputOptions(state).map((o) => o.id), ['b1', 'b2', 'main:s1', 'v1'], 'running agents first (oldest first), then the orchestrator, then the latest finished');
assert.equal(followRun(state, null), 'b1', 'nothing open: the first running agent');
assert.equal(followRun(state, { kind: 'change', id: 'c2' }), 'b2', 'the open change\'s running round');
assert.equal(followRun(state, { kind: 'change', id: 'c3' }), 'v1', 'nobody running on it: its latest round');
assert.equal(followRun(state, { kind: 'change', id: 'c4' }), 'b1', 'a change with no round: the first running agent');
assert.equal(followRun(state, { kind: 'agent', id: 'validator' }), 'v1');
assert.equal(followRun({ running: [], recent: [], changes: [] }), null);

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ tail ok');
