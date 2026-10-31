// Incremental transcript cache: the result with the cache (reused across
// calls) must be identical to that of a collection without cache, on the same fixture,
// including after append, rewrite and file removal.
//   node tests/cache.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug, createTranscriptCache } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-cache-'));
const project = path.join(tmp, 'proj');
const claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-21T15:00:00.000Z');
const at = (min) => new Date(now - min * 60000).toISOString();
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const line = (r) => JSON.stringify(r) + '\n';

w(path.join(project, 'openspec/changes/add-invoice/tasks.md'), '## 1. Backend\n- [ ] 1.1 route\n');
const sdir = path.join(claude, 'projects', projectSlug(project));
const sid = 'sess-c1';
const sessFile = path.join(sdir, `${sid}.jsonl`);
const subFile = (id) => path.join(sdir, sid, 'subagents', `agent-${id}.jsonl`);
const base = { cwd: project, sessionId: sid, gitBranch: 'main' };
const us = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 1000, cache_creation_input_tokens: 5 };
const asst = (id, min, blocks, model = 'claude-opus-5-5') => blocks.map((b, i) => line({ ...base, type: 'assistant', uuid: `${id}-${i}`, timestamp: at(min),
  requestId: id, message: { role: 'assistant', model, usage: us, content: [b] } })).join('');
const call = (tu, agent, min, prompt) => asst(`r-${tu}`, min, [{ type: 'text', text: 'delegating' }, { type: 'tool_use', id: tu, name: 'Agent', input: { subagent_type: agent, description: `run ${tu}`, prompt } }]);
const result = (tu, agentId, min) => line({ ...base, type: 'user', uuid: `res-${tu}`, timestamp: at(min), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: tu, content: 'ok' }] },
  toolUseResult: { agentId, totalDurationMs: 60000, usage: us } });
const prompt = (min, t) => line({ ...base, type: 'user', uuid: `p-${min}`, timestamp: at(min), message: { role: 'user', content: t } });
const subRecs = (id, min0, n) => line({ ...base, agentId: id, type: 'user', uuid: `${id}-u`, timestamp: at(min0), message: { role: 'user', content: `Implement openspec/changes/add-invoice (${id})` } })
  + Array.from({ length: n }, (_, i) => asst(`${id}-r${i}`, min0 - i - 1, [{ type: 'text', text: `step ${i} of ${id}` }, { type: 'tool_use', id: `t${i}`, name: 'Read', input: {} }], 'claude-sonnet-5-5')).join('');

w(sessFile, prompt(60, 'create the change') + call('tu1', 'builder', 59, 'Implement openspec/changes/add-invoice (a1)') + result('tu1', 'a1', 50));
w(subFile('a1'), subRecs('a1', 59, 3));
w(subFile('b2'), subRecs('b2', 40, 2));
w(path.join(sdir, 'sess-c2.jsonl'), prompt(30, 'another session') + asst('c2-1', 29, [{ type: 'text', text: 'hi' }]));

const touchAll = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) touchAll(f); fs.utimesSync(f, new Date(now - 3600e3), new Date(now - 3600e3)); } };
touchAll(tmp);

const opts = { projectDir: project, claudeDir: claude, now };
const cache = createTranscriptCache();
let step = 0;
const same = (what) => {
  const withCache = collect({ ...opts, cache });
  const fresh = collect({ ...opts, cache: createTranscriptCache() });
  assert.deepEqual(JSON.parse(JSON.stringify(withCache)), JSON.parse(JSON.stringify(fresh)), `${++step}. ${what}: with cache == without cache`);
  return withCache;
};
// only the bytes read from transcripts (.jsonl): on Node 18 readFileSync of tasks.md also goes through fs.readSync
const bytesRead = (fn) => {
  const origRead = fs.readSync, origOpen = fs.openSync, fds = new Set(); let n = 0;
  fs.openSync = (f, ...a) => { const fd = origOpen(f, ...a); if (/\.jsonl(\.1)?$/.test(String(f))) fds.add(fd); return fd; };
  fs.readSync = (fd, ...a) => { const k = origRead(fd, ...a); if (fds.has(fd)) n += k; return k; };
  try { fn(); } finally { fs.readSync = origRead; fs.openSync = origOpen; }
  return n;
};
const append = (f, s) => { fs.appendFileSync(f, s); fs.utimesSync(f, new Date(now - 1800e3), new Date(now - 1800e3 + step * 1000)); };

let st = same('initial collection');
assert.equal(st.totals.runs, 2);
assert.equal(cache.size, 4, '2 sessions + 2 subagents in the cache');

// 2nd call without changes: nothing is reread
assert.equal(bytesRead(() => collect({ ...opts, cache })), 0, 'an unchanged file reuses the result: 0 bytes read');
same('no change');

// append to a subagent and to the session: reads only the new chunk
const sizeBefore = fs.statSync(subFile('a1')).size + fs.statSync(sessFile).size;
const extra = asst('a1-new', 5, [{ type: 'text', text: 'extra step' }], 'claude-sonnet-5-5');
const extraSess = call('tu2', 'validator', 20, 'Validate openspec/changes/add-invoice') + result('tu2', 'b2', 10);
append(subFile('a1'), extra);
append(sessFile, extraSess);
{
  const n = bytesRead(() => collect({ ...opts, cache }));
  assert.ok(n < sizeBefore / 2 && n >= extra.length + extraSess.length, `append reads only the new chunk (${n} bytes of ${sizeBefore})`);
}
st = same('after append');
assert.equal(st.totals.runs, 2);
assert.ok(st.changes.some((c) => c.runs.some((r) => r.agent === 'validator' && r.linked)), 'the new call links to the existing subagent');
assert.match(st.changes.flatMap((c) => c.runs).map((r) => r.summary).join('|'), /extra step/);

// partial line being written: ignored; completed later, it goes in
const partial = asst('a1-partial', 4, [{ type: 'text', text: 'partial line' }], 'claude-sonnet-5-5').trimEnd();
append(subFile('a1'), partial.slice(0, 40));
same('partial line at the end');
append(subFile('a1'), partial.slice(40) + '\n');
st = same('partial line completed');
assert.match(st.changes.flatMap((c) => c.runs).map((r) => r.summary).join('|'), /partial line/);

// ending without \n that is already valid JSON: goes in; and the next append rereads safely
append(subFile('a1'), asst('a1-nonl', 3, [{ type: 'text', text: 'no newline' }]).trimEnd());
same('valid ending without newline');
append(subFile('a1'), '\n' + asst('a1-after', 2, [{ type: 'text', text: 'after the newline' }]));
st = same('append after an ending without newline');
assert.match(st.changes.flatMap((c) => c.runs).map((r) => r.summary).join('|'), /after the newline/);

// rewrite that is not an append (same size or different prefix): reparses everything
const orig = fs.readFileSync(subFile('b2'), 'utf8');
w(subFile('b2'), orig.replace(/step 0 of b2/g, 'step X of b2'));
fs.utimesSync(subFile('b2'), new Date(now - 1700e3), new Date(now - 1700e3));
same('rewrite with the same size');
w(subFile('b2'), subRecs('b2', 40, 5));
fs.utimesSync(subFile('b2'), new Date(now - 1600e3), new Date(now - 1600e3));
same('larger rewrite with a different prefix');

// removal: subagent and session leave the cache and the result
fs.rmSync(subFile('b2'));
st = same('subagent removed');
assert.ok(![...cache.keys()].includes(subFile('b2')), 'removed leaves the cache');
fs.rmSync(path.join(sdir, 'sess-c2.jsonl'));
st = same('session removed');
assert.ok(![...cache.keys()].some((k) => k.endsWith('sess-c2.jsonl')), 'removed session leaves the cache');
assert.equal(st.totals.sessions, 1);

// a new file is read and goes in
w(path.join(sdir, 'sess-c3.jsonl'), prompt(5, 'new') + asst('c3-1', 4, [{ type: 'text', text: 'new session' }]));
st = same('new session');
assert.equal(st.totals.sessions, 2);

// hook events.jsonl (and the events.jsonl.1 generation): same incremental reading
{
  const evDir = path.join(project, '.claude', 'ai-team'), ev = path.join(evDir, 'events.jsonl');
  const evLine = (o) => JSON.stringify({ ts: at(o.min), ...o.e }) + '\n';
  const start = (id, min) => evLine({ min, e: { event: 'SubagentStart', agent_id: id, agent_type: 'builder', session_id: sid } });
  const stop = (id, min) => evLine({ min, e: { event: 'SubagentStop', agent_id: id, agent_type: 'builder', session_id: sid } });
  const runOf = (st, id) => st.changes.flatMap((c) => c.runs).find((r) => r.id === id);
  const filler = Array.from({ length: 300 }, (_, i) => start(`f${i}`, 100 + (i % 5)) + stop(`f${i}`, 99)).join('');
  w(subFile('e5'), subRecs('e5', 30, 2));
  fs.utimesSync(subFile('e5'), new Date(now - 3600e3), new Date(now - 3600e3));
  same('new subagent, no events');

  w(ev, filler + start('e5', 80));
  fs.utimesSync(ev, new Date(now - 3600e3), new Date(now - 3600e3));
  st = same('new events.jsonl');
  assert.equal(runOf(st, 'e5').start, now - 80 * 60000, 'exact start comes from the hook');
  assert.equal(bytesRead(() => collect({ ...opts, cache })), 0, 'unchanged events.jsonl: 0 bytes read');

  // hook append: only the new chunk
  const stopE5 = stop('e5', 70), size0 = fs.statSync(ev).size;
  append(ev, stopE5);
  { const n = bytesRead(() => collect({ ...opts, cache })); assert.ok(n >= stopE5.length && n < size0 / 10, `reads only the new chunk (${n} of ${size0} bytes)`); }
  st = same('SubagentStop appended');
  assert.equal(runOf(st, 'e5').end, now - 70 * 60000, 'exact end comes from the hook');

  // partial line: ignored; completed, it goes in
  const t2 = stop('e5', 65);
  append(ev, t2.slice(0, 30));
  st = same('partial line in events.jsonl');
  assert.equal(runOf(st, 'e5').end, now - 70 * 60000);
  append(ev, t2.slice(30));
  st = same('partial line completed');
  assert.equal(runOf(st, 'e5').end, now - 65 * 60000);

  // rotation by the hook: the file becomes .1 and a new one starts (with a carried TeamStart)
  fs.renameSync(ev, ev + '.1');
  fs.utimesSync(ev + '.1', new Date(now - 3000e3), new Date(now - 3000e3));
  w(ev, evLine({ min: 90, e: { event: 'TeamStart', session_id: 'sess-c2', via: 'team' } }) + start('a1', 50));
  fs.utimesSync(ev, new Date(now - 2000e3), new Date(now - 2000e3));
  st = same('rotated file');
  assert.equal(runOf(st, 'e5').start, now - 80 * 60000, 'the exact start from the .1 generation holds');
  assert.equal(runOf(st, 'e5').end, now - 65 * 60000);
  assert.equal(bytesRead(() => collect({ ...opts, cache })), 0, 'after the rotation is read: 0 bytes');
  append(ev, stop('a1', 45));
  same('new event after the rotation');

  // truncated by hand and deleted: same as a collection without cache
  fs.writeFileSync(ev, '');
  fs.utimesSync(ev, new Date(now - 1000e3), new Date(now - 1000e3));
  same('events.jsonl truncated');
  fs.rmSync(ev);
  same('events.jsonl deleted');
  fs.rmSync(ev + '.1');
  st = same('no generation at all');
  assert.ok(![...cache.keys()].some((k) => k.includes('events.jsonl')), 'deleted event files leave the cache');
  assert.equal(runOf(st, 'e5').start === null || runOf(st, 'e5').start > now - 80 * 60000, true, 'no events: transcript timestamps');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ cache: incremental reading ok');
