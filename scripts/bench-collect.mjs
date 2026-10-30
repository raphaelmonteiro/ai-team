#!/usr/bin/env node
// Measures the cost of the dashboard's collect(): one cold collection (new process, empty cache) and
// the median of N hot collections (same process, nothing changed). On demand only (make bench); not in make test.
//
//   node scripts/bench-collect.mjs                       fixed-size synthetic fixture
//   node scripts/bench-collect.mjs --project P --claude-dir C    real project (read-only; writes nothing to P or C)
//   --runs N     hot collections (default 20)
//
// The fixture (20 folders of other projects with 3 transcripts of ~1.2 MB each, the project with 3
// transcripts of ~1.2 MB and an events.jsonl of ~1 MiB, ~75 MB) is created in a temp dir removed at the end.
// It lives in scripts/ and not in dashboard/: the installer copies all of dashboard/ into projects.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collect, projectSlug, createTranscriptCache } from '../dashboard/collect.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const runs = Math.max(1, Number(opt('--runs', 20)) || 20);

const line = (r) => JSON.stringify(r) + '\n';
const TRANSCRIPT_BYTES = 1.2 * 1024 * 1024, EVENTS_BYTES = 1024 * 1024;
const OTHER_FOLDERS = 20, PER_FOLDER = 3;

// transcript in the real format: queue-operation without cwd, summary, and cwd only on the 3rd record; the
// rest is conversation (assistant with usage) up to the size
function transcript(sid, cwd, t0) {
  const ts = (i) => new Date(t0 + i * 1000).toISOString();
  let out = line({ type: 'queue-operation', operation: 'enqueue', sessionId: sid, timestamp: ts(0) })
    + line({ type: 'summary', summary: `session ${sid}`, leafUuid: `${sid}-leaf` })
    + line({ type: 'user', uuid: `${sid}-u0`, sessionId: sid, cwd, timestamp: ts(1), message: { role: 'user', content: `task of session ${sid}` } });
  const text = 'x'.repeat(900);
  let i = 0;
  while (out.length < TRANSCRIPT_BYTES) {
    i++;
    out += line({ type: 'assistant', uuid: `${sid}-a${i}`, sessionId: sid, cwd, timestamp: ts(i + 1), requestId: `${sid}-r${i}`,
      message: { id: `${sid}-m${i}`, role: 'assistant', model: 'claude-opus-5-5',
        usage: { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 },
        content: [{ type: 'text', text }] } });
  }
  return out;
}

function eventsFile(t0) {
  let out = '', i = 0;
  while (out.length < EVENTS_BYTES) {
    i++;
    const ts = new Date(t0 + i * 1000).toISOString();
    out += JSON.stringify({ ts, event: i % 2 ? 'SubagentStart' : 'SubagentStop', agent_id: `ag-${Math.ceil(i / 2)}`, agent_type: 'builder', session_id: 'bench-own-0' }) + '\n';
  }
  return out;
}

function buildFixture(root) {
  const project = path.join(root, 'proj'), claudeDir = path.join(root, 'claude');
  const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
  const t0 = Date.now() - 3 * 3600e3;
  w(path.join(project, 'openspec/changes/add-x/tasks.md'), '## 1. Backend\n- [ ] 1.1 route\n- [x] 1.2 model\n');
  w(path.join(project, '.claude/ai-team/events.jsonl'), eventsFile(t0));
  for (let k = 0; k < PER_FOLDER; k++) w(path.join(claudeDir, 'projects', projectSlug(project), `bench-own-${k}.jsonl`), transcript(`bench-own-${k}`, project, t0));
  for (let n = 0; n < OTHER_FOLDERS; n++) {
    // the last folder holds sessions of this project opened from another path
    const cwd = n === OTHER_FOLDERS - 1 ? project : path.join(root, `other-${n}`);
    for (let k = 0; k < PER_FOLDER; k++) w(path.join(claudeDir, 'projects', `-bench-other-${n}`, `bench-${n}-${k}.jsonl`), transcript(`bench-${n}-${k}`, cwd, t0));
  }
  return { project, claudeDir };
}

const ms = (f) => { const t = process.hrtime.bigint(); f(); return Number(process.hrtime.bigint() - t) / 1e6; };
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

let root = null, projectDir = opt('--project', null), claudeDir = opt('--claude-dir', null);
const synthetic = !projectDir && !claudeDir;
try {
  if (synthetic) {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-bench-'));
    ({ project: projectDir, claudeDir } = buildFixture(root));
  } else {
    projectDir = path.resolve(projectDir || process.cwd());
    claudeDir = path.resolve(claudeDir || path.join(os.homedir(), '.claude'));
  }
  const cache = createTranscriptCache();
  const run = () => { const st = collect({ projectDir, claudeDir, cache }); if (st.error) throw new Error(st.error); return st; };
  let st;
  const cold = ms(() => { st = run(); });
  const hot = [];
  for (let i = 0; i < runs; i++) hot.push(ms(run));
  const projectsRoot = path.join(claudeDir, 'projects');
  const folders = (() => { try { return fs.readdirSync(projectsRoot).length; } catch { return 0; } })();
  console.log(`${synthetic ? 'synthetic fixture' : projectDir}: ${folders} folders in projects/, ${st.totals.sessions} project sessions, ${st.totals.runs} runs`);
  console.log(`machine: ${os.hostname()} · ${os.cpus()[0] ? os.cpus()[0].model : '?'} · ${os.platform()}/${os.arch()} · node ${process.version}`);
  console.log(`cold collect: ${cold.toFixed(1)} ms`);
  console.log(`hot collect:  ${median(hot).toFixed(1)} ms (median of ${runs}; min ${Math.min(...hot).toFixed(1)}, max ${Math.max(...hot).toFixed(1)})`);
} finally {
  if (root) fs.rmSync(root, { recursive: true, force: true });
}
