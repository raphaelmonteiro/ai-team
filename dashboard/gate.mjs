// ai-team — test runs inside a round. A Bash call of the subagent counts as a test run when its command is one
// of the project's gate test commands (BACKEND_CMD_TEST / FRONTEND_CMD_TEST in ai-team.conf) or looks like one
// (make test, npm test, vitest, jest, pytest, go test, mvn test, cargo test, tests/run.sh…); its output is read
// for the verdict and the counts. The last test run of the round is what the dashboard shows.
//   { tool, ok, passed, failed, summary }   ok: true | false; passed/failed: numbers or null when the tool does not say

const GENERIC = /(?:^|[\s;&|(])(?:make\s+(?:test|check)[\w:-]*|(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|npx\s+(?:vitest|jest|mocha)\b|vitest\b|jest\b|mocha\b|pytest\b|python3?\s+-m\s+pytest\b|go\s+test\b|(?:\.\/)?mvnw?\b[^\n;&|]*\btest\b|(?:\.\/)?gradlew?\b[^\n;&|]*\btest\b|cargo\s+test\b|phpunit\b|(?:bundle\s+exec\s+)?rspec\b|dotnet\s+test\b)/;
// the project's own runner only as a command (not `cat tests/run.sh`)
const RUNNER = /(?:^|[;&|(]\s*)(?:(?:bash|sh)\s+)?(?:\.\/)?tests?\/run\.sh\b/;

// the key of a test command: the gate command it contains, else the test invocation found in it (so
// `cd api && (make test-api-unit | tail -5)` and `make test-api-unit` are the same suite); null = not a test run
export function testKey(cmd, gateCmds = []) {
  const c = String(cmd || '');
  if (!c) return null;
  const g = gateCmds.find((x) => x && c.includes(x));
  if (g) return g;
  const m = GENERIC.exec(c) || RUNNER.exec(c);
  return m ? m[0].replace(/^[\s;&|(]+/, '').trim() : null;
}
export const isTestCommand = (cmd, gateCmds = []) => testKey(cmd, gateCmds) !== null;

// the round's test state from its last run per suite: ok only when every suite is ok; counts added up
export function summarizeTests(bySuite) {
  const parts = [...bySuite.values()].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!parts.length) return null;
  const sum = (k) => (parts.some((p) => p[k] != null) ? parts.reduce((n, p) => n + (p[k] || 0), 0) : null);
  return { ok: parts.every((p) => p.ok === true), passed: sum('passed'), failed: sum('failed'), suites: parts.length,
    cmd: parts.map((p) => p.cmd).join(' · '), summary: parts.map((p) => p.summary).join(' · '), ts: Math.max(...parts.map((p) => p.ts || 0)), parts };
}

const num = (s, word) => { const m = new RegExp(`(\\d+) ${word}`).exec(s); return m ? Number(m[1]) : 0; };
const lastLine = (t) => (String(t).trim().split('\n').pop() || '').trim().slice(0, 160);

// what failed, for the dashboard: the failing test names (up to 10) and an excerpt of the output from the first
// failure (ANSI colors stripped, at most ~1500 characters). Formats: vitest/jest (FAIL, ×, ●), pytest (FAILED x::y),
// go (--- FAIL:), cargo (test x ... FAILED), maven (<<< FAILURE!), ai-team's run.sh (FAIL name).
const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
const FAIL_LINE = [
  /^\s*FAIL\s+(\S.*?)\s*$/,                                  // vitest / jest file or test, run.sh
  /^\s*[×✗✕]\s+(.+?)(?:\s+\d+(?:\.\d+)?\s*m?s)?\s*$/,        // vitest / mocha style failed test
  /^\s*●\s+(.+?)\s*$/,                                       // jest failed test
  /^FAILED\s+(\S+?)(?:\s+-\s+.*)?$/,                          // pytest short summary
  /^---\s+FAIL:\s+(\S+)/,                                     // go
  /^test\s+(\S+)\s+\.\.\.\s+FAILED/,                          // cargo
  /^\[ERROR\]\s+(\S+).*<<<\s+(?:FAILURE|ERROR)!/,             // maven
];
export function failureDetail(text) {
  const lines = String(text || '').replace(ANSI, '').split('\n');
  const names = [];
  let first = -1;
  lines.forEach((l, i) => {
    for (const re of FAIL_LINE) {
      const m = re.exec(l);
      if (m && !/^\d+ (?:of \d+ )?(?:tests? )?(?:failed|passed)/.test(m[1]) && !/^Tests?:/.test(m[1])) {   // a summary line is not a test
        if (first < 0) first = i;
        const n = m[1].replace(/\s+/g, ' ').replace(/\s+\d+(?:\.\d+)?m?s$/, '').trim();
        if (n && !names.includes(n)) names.push(n);
        break;
      }
    }
  });
  // the same test seen twice (vitest prints "× name" and "FAIL file > suite > name"): keep the full one
  const uniq = names.filter((n) => !names.some((o) => o !== n && (o.endsWith(` > ${n}`) || o.endsWith(` › ${n}`)))).slice(0, 10)
    .map((n) => (n.length > 240 ? n.slice(0, 240) + '…' : n));
  names.length = 0; names.push(...uniq);
  const from = first >= 0 ? first : Math.max(0, lines.length - 20);
  let excerpt = lines.slice(from, from + 40).join('\n').trim();
  if (excerpt.length > 1500) excerpt = excerpt.slice(0, 1500) + '\n…';
  return { failures: names, excerpt };
}

export function parseTestOutput(text, { isError = false } = {}) {
  const r = parseTestResult(text, { isError });
  return r && r.ok === false ? { ...r, ...failureDetail(text) } : r;
}
function parseTestResult(text, { isError = false } = {}) {
  const t = String(text || '');
  let m;
  // Maven / Surefire: the last "Tests run:" line is the total of the build
  const mv = [...t.matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+)(?:, Skipped: (\d+))?/g)];
  if (mv.length) {
    const l = mv[mv.length - 1], run = Number(l[1]), failed = Number(l[2]) + Number(l[3]), skipped = Number(l[4] || 0);
    return { tool: 'maven', ok: failed === 0 && !/BUILD FAILURE/.test(t), passed: run - failed - skipped, failed, summary: l[0] };
  }
  // Jest ("Tests:  1 failed, 2 passed, 3 total") and Vitest ("Tests  1 failed | 2 passed (3)")
  if ((m = /^\s*Tests:?\s{1,}(\d+[^\n]*)$/m.exec(t))) {
    const line = m[1], failed = num(line, 'failed'), passed = num(line, 'passed');
    return { tool: /\|/.test(line) || /Test Files/.test(t) ? 'vitest' : 'jest', ok: failed === 0 && passed > 0, passed, failed, summary: `Tests ${line.trim()}` };
  }
  // pytest: "=== 3 passed, 1 failed, 2 warnings in 0.52s ==="
  if ((m = /^=+ ([^\n=]*?\b\d+ (?:passed|failed|error)[^\n=]*?) in [\d.]+s[^\n]*=+\s*$/m.exec(t))) {
    const line = m[1], failed = num(line, 'failed') + num(line, 'error'), passed = num(line, 'passed');
    return { tool: 'pytest', ok: failed === 0 && passed > 0, passed, failed, summary: line.trim() };
  }
  // cargo: "test result: ok. 5 passed; 0 failed; …"
  if ((m = /test result: (ok|FAILED)\. (\d+) passed; (\d+) failed/.exec(t))) {
    return { tool: 'cargo', ok: m[1] === 'ok', passed: Number(m[2]), failed: Number(m[3]), summary: m[0] };
  }
  // go test: "ok  pkg 0.1s" / "FAIL pkg" / "--- FAIL: TestX"
  if (/^(?:ok|FAIL|---\s+FAIL:)\s/m.test(t) && /^(?:ok|FAIL)\s+\S+/m.test(t)) {
    const failed = (t.match(/^--- FAIL:/gm) || []).length, anyFail = /^FAIL\b/m.test(t);
    return { tool: 'go', ok: !anyFail, passed: null, failed: anyFail ? Math.max(failed, 1) : 0, summary: lastLine(t) };
  }
  // ai-team's own tests/run.sh: "✓ 146 tests passed" / "✗ 2 of 146 tests failed"
  if ((m = /✓ (\d+) tests? passed/.exec(t))) return { tool: 'run.sh', ok: true, passed: Number(m[1]), failed: 0, summary: m[0] };
  if ((m = /✗ (\d+) (?:of (\d+) )?tests? failed/.exec(t))) return { tool: 'run.sh', ok: false, passed: m[2] ? Number(m[2]) - Number(m[1]) : null, failed: Number(m[1]), summary: m[0] };
  // nothing recognised: a failed exit still says the run failed
  if (isError) return { tool: 'exit', ok: false, passed: null, failed: null, summary: lastLine(t) };
  return null;
}
