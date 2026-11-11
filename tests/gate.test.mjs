// Test runs inside a round (dashboard/gate.mjs): which commands count, what the output says, and the
// run/change fields the collector exposes (last run of the round wins; the change takes its latest round).
//   node tests/gate.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { isTestCommand, testKey, parseTestOutput, summarizeTests, failureDetail } from '../dashboard/gate.mjs';
// the verdict and counts; the failure detail of a red run has its own tests below
const core = (r) => { if (!r) return r; const { failures, excerpt, ...rest } = r; return rest; };
import { readGateCommands } from '../dashboard/conf.mjs';
import { collect, projectSlug } from '../dashboard/collect.mjs';

// --- commands ---------------------------------------------------------------------
assert.equal(isTestCommand('cd pas-api && (make test-api-unit 2>&1 | tail -15)', ['make test-api-unit']), true, 'the gate command from the conf, inside a pipeline');
assert.equal(isTestCommand('make test-api-unit'), true, 'make test* without the conf');
assert.equal(isTestCommand('pnpm vitest run src/x.test.ts'), true);
assert.equal(isTestCommand('./mvnw -q test -Dtest=RuleIT'), true);
assert.equal(isTestCommand('go test ./...'), true);
assert.equal(isTestCommand('tests/run.sh'), true);
assert.equal(isTestCommand('ls tests/ && cat tests/run.sh'), false, 'reading the tests is not running them');
assert.equal(isTestCommand('make render'), false);
assert.equal(isTestCommand('git log --oneline -3 -- tests'), false);
assert.equal(testKey('cd api && (make test-api-unit 2>&1 | tail -5)', ['make test-api-unit']), 'make test-api-unit', 'same suite, same key');
assert.equal(testKey('(make test-api-it 2>&1 | grep Tests)'), 'make test-api-it', 'without the conf: the invocation found');
assert.equal(testKey('pnpm vitest run src/x.test.ts'), 'vitest', 'the runner is the key, whatever launches it');
{
  const by = new Map([['make test-api-unit', { ok: true, passed: 369, failed: 0, summary: 'u', cmd: 'make test-api-unit', ts: 1 }], ['make test-api-it', { ok: false, passed: 353, failed: 1, summary: 'i', cmd: 'make test-api-it', ts: 2 }]]);
  const s = summarizeTests(by);
  assert.deepEqual([s.ok, s.passed, s.failed, s.suites, s.ts, s.cmd], [false, 722, 1, 2, 2, 'make test-api-unit · make test-api-it'], 'two suites: added up, ok only if both ok');
  assert.equal(summarizeTests(new Map()), null);
}

// --- output -----------------------------------------------------------------------
const mv = parseTestOutput('[INFO] Tests run: 33, Failures: 0, Errors: 0, Skipped: 0\n[INFO] Results:\n[INFO] Tests run: 369, Failures: 0, Errors: 0, Skipped: 2\n[INFO] BUILD SUCCESS');
assert.deepEqual(mv, { tool: 'maven', ok: true, passed: 367, failed: 0, summary: 'Tests run: 369, Failures: 0, Errors: 0, Skipped: 2' }, 'maven: the last total line, skipped not counted as passed');
assert.deepEqual(core(parseTestOutput('Tests run: 10, Failures: 1, Errors: 1, Skipped: 0\nBUILD FAILURE')), { tool: 'maven', ok: false, passed: 8, failed: 2, summary: 'Tests run: 10, Failures: 1, Errors: 1, Skipped: 0' });
assert.deepEqual(core(parseTestOutput(' Test Files  1 failed | 2 passed (3)\n      Tests  1 failed | 7 passed (8)\n   Start at  10:00')), { tool: 'vitest', ok: false, passed: 7, failed: 1, summary: 'Tests 1 failed | 7 passed (8)' });
assert.deepEqual(core(parseTestOutput('Test Suites: 1 passed, 1 total\nTests:       3 passed, 3 total\nSnapshots:   0 total')), { tool: 'jest', ok: true, passed: 3, failed: 0, summary: 'Tests 3 passed, 3 total' });
assert.deepEqual(core(parseTestOutput('=========== 3 passed, 1 failed, 2 warnings in 0.52s ===========')), { tool: 'pytest', ok: false, passed: 3, failed: 1, summary: '3 passed, 1 failed, 2 warnings' });
assert.deepEqual(core(parseTestOutput('test result: ok. 5 passed; 0 failed; 0 ignored')), { tool: 'cargo', ok: true, passed: 5, failed: 0, summary: 'test result: ok. 5 passed; 0 failed' });
assert.equal(parseTestOutput('ok  \tgithub.com/x/y\t0.1s\n--- FAIL: TestA\nFAIL\tgithub.com/x/z\t0.2s').ok, false, 'go: a FAIL line');
assert.equal(parseTestOutput('ok  \tgithub.com/x/y\t0.1s\nok  \tgithub.com/x/z\t0.2s').ok, true);
assert.deepEqual(core(parseTestOutput('  ok   hub (node)\n\n✓ 146 tests passed')), { tool: 'run.sh', ok: true, passed: 146, failed: 0, summary: '✓ 146 tests passed' });
assert.deepEqual(core(parseTestOutput('✗ 2 of 146 tests failed')), { tool: 'run.sh', ok: false, passed: 144, failed: 2, summary: '✗ 2 of 146 tests failed' });
assert.equal(parseTestOutput('Compiling…\nnothing to see'), null, 'unknown output: nothing recorded');
assert.deepEqual(core(parseTestOutput('make: *** [test] Error 2', { isError: true })), { tool: 'exit', ok: false, passed: null, failed: null, summary: 'make: *** [test] Error 2' }, 'unknown output with a failed exit: failed');

// --- collector: run and change fields -------------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-gate-'));
const project = path.join(tmp, 'proj'), claude = path.join(tmp, 'claude');
const now = Date.parse('2026-11-03T12:00:00.000Z');
const at = (min) => new Date(now - min * 60000).toISOString();
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const jsonl = (f, recs) => w(f, recs.map((r) => JSON.stringify(r)).join('\n') + '\n');
w(path.join(project, '.claude', 'ai-team.conf'), "PROJECT_NAME='gate'\nBACKEND_CMD_TEST='make test-api-unit'\nFRONTEND_CMD_TEST=''\n");
assert.deepEqual(readGateCommands(project), ['make test-api-unit']);
w(path.join(project, 'openspec/changes/ch/tasks.md'), '## 1. Backend\n- [ ] 1.1 a\n');
const pdir = path.join(claude, 'projects', projectSlug(project));
const base = { cwd: project, sessionId: 's1', isSidechain: false };
const usage = { input_tokens: 1, output_tokens: 1 };
jsonl(path.join(pdir, 's1.jsonl'), [
  { ...base, type: 'user', uuid: 'u0', timestamp: at(60), message: { role: 'user', content: 'go' } },
  { ...base, type: 'assistant', uuid: 'a1', timestamp: at(50), requestId: 'r1', message: { role: 'assistant', model: 'claude-opus-5-5', usage, content: [{ type: 'tool_use', id: 'B', name: 'Agent', input: { subagent_type: 'builder', description: 'Builder section 1', prompt: 'Implement openspec/changes/ch' } }] } },
  { ...base, type: 'user', uuid: 'u1', timestamp: at(30), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'B', content: 'done' }] }, toolUseResult: { agentId: 'ag-B', status: 'completed' } },
]);
const sb = { ...base, isSidechain: true };
const bash = (id, min, command) => ({ ...sb, type: 'assistant', uuid: `a-${id}`, timestamp: at(min), requestId: `rq-${id}`, message: { role: 'assistant', model: 'claude-sonnet-5-5', usage, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const result = (id, min, content, isError) => ({ ...sb, type: 'user', uuid: `r-${id}`, timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }] } });
const sf = path.join(pdir, 's1', 'subagents', 'agent-ag-B.jsonl');
jsonl(sf, [
  { ...sb, type: 'user', uuid: 'su', timestamp: at(50), message: { role: 'user', content: 'Implement openspec/changes/ch' } },
  bash('t1', 48, 'ls src/test && cat tests/run.sh'), result('t1', 48, 'a.java\n#!/bin/bash'),              // not a test run
  bash('t2', 45, 'cd api && (make test-api-unit 2>&1 | tail -5)'), result('t2', 44, '[INFO] Tests run: 12, Failures: 0, Errors: 0, Skipped: 0\n[INFO] BUILD SUCCESS'),
  bash('t3', 40, 'make test-api-unit'), result('t3', 39, 'Tests run: 12, Failures: 1, Errors: 0, Skipped: 0\nBUILD FAILURE', true),
  { ...sb, type: 'assistant', uuid: 'sa', timestamp: at(35), requestId: 'rq-end', message: { role: 'assistant', model: 'claude-sonnet-5-5', usage, content: [{ type: 'text', text: 'one test is red' }] } },
]);
const m = new Date(now - 35 * 60000); fs.utimesSync(sf, m, m);
const st = collect({ projectDir: project, claudeDir: claude, now });
const ch = st.changes.find((c) => c.id === 'ch'), run = ch.runs[0];
assert.equal(run.testRuns, 2, 'two test runs, the ls is not one');
assert.equal(run.tests.ok, false); assert.equal(run.tests.failed, 1); assert.equal(run.tests.passed, 11);
assert.equal(run.tests.cmd, 'make test-api-unit'); assert.equal(run.tests.ts, Date.parse(at(39)), 'the last run of the suite wins (not added to the earlier run of the same suite)');
assert.equal(run.tests.suites, 1);
assert.deepEqual(run.timeSplit, { tests: 120000, checks: 0, shell: 0, edit: 0, read: 0, other: 0 }, 'time from each tool call to its result: two 1-minute test runs, an instant ls');
assert.deepEqual([ch.tests.ok, ch.tests.agent, ch.tests.runId], [false, 'builder', 'ag-B'], 'the change carries its latest round\'s result');
assert.equal(st.recent.find((r) => r.id === 'ag-B').tests.failed, 1, 'the brief carries it too');
// second collect reuses the cached subagent state: same result
assert.deepEqual(collect({ projectDir: project, claudeDir: claude, now }).changes.find((c) => c.id === 'ch').tests, ch.tests);
// what failed: test names and an excerpt, only on a red run
{
  const vit = '\u001b[31m   × drags the name 5ms\u001b[39m\n     → expected 3 to be 4\n FAIL  src/a.test.ts > card > drags the name\nAssertionError: expected 3 to be 4\n\n Test Files  1 failed (1)\n      Tests  1 failed | 2 passed (3)';
  const r = parseTestOutput(vit);
  assert.deepEqual(r.failures, ['src/a.test.ts > card > drags the name'], 'vitest: the full name, once');
  assert.match(r.excerpt, /^× drags the name[\s\S]*expected 3 to be 4/, 'excerpt from the first failure, colors stripped');
  assert.doesNotMatch(r.excerpt, /\u001b/);
  assert.equal(parseTestOutput('      Tests  3 passed (3)').failures, undefined, 'a green run carries no detail');
  assert.deepEqual(parseTestOutput('FAIL src/x.test.js\n  ● Card › drags\n\n    expect(received).toBe(expected)\n\nTests:       1 failed, 4 passed, 5 total').failures, ['src/x.test.js', 'Card › drags'], 'jest');
  assert.deepEqual(parseTestOutput('=== short test summary info ===\nFAILED tests/test_x.py::test_sum - assert 1 == 2\n=== 1 failed, 1 passed in 0.05s ===').failures, ['tests/test_x.py::test_sum'], 'pytest');
  assert.deepEqual(parseTestOutput('--- FAIL: TestSum (0.00s)\n    x_test.go:9: got 1\nFAIL\tex/pkg\t0.01s').failures, ['TestSum', 'ex/pkg'], 'go: the test and the package, without the duration');
  assert.deepEqual(parseTestOutput('test tests::adds ... FAILED\ntest result: FAILED. 3 passed; 1 failed; 0 ignored').failures, ['tests::adds'], 'cargo');
  assert.deepEqual(parseTestOutput('  FAIL hub registry (node)\n✗ 1 of 169 tests failed').failures, ['hub registry (node)'], 'run.sh: the summary line is not a test');
  const many = parseTestOutput(Array.from({ length: 15 }, (_, i) => `--- FAIL: Test${i} (0.00s)`).join('\n') + '\nFAIL\tp\t0.1s');
  assert.equal(many.failures.length, 10, 'at most 10 names');
  assert.ok(failureDetail('x\n'.repeat(5000)).excerpt.length <= 1502, 'excerpt capped');
  const long = 'a'.repeat(300);
  assert.equal(parseTestOutput(` × ${long} 9ms\n FAIL  f.test.ts > ${long}\n      Tests  1 failed (1)`).failures.length, 1, 'long names deduped before they are cut');
  const ex = parseTestOutput('boom: no runner found', { isError: true });
  assert.deepEqual([ex.ok, ex.failures, ex.excerpt], [false, [], 'boom: no runner found'], 'an unrecognised failed run keeps its output');
}
console.log('✓ test runs in a round ok');
