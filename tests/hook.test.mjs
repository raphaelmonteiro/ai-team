// hook.mjs tests (and the hook.sh hand-off): real JSON instead of sed, events with odd
// values stay valid JSON, invalid input does not break the hook and without node hook.sh does nothing.
//   node tests/hook.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runHook, REMINDER } from '../dashboard/hook.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const hookSh = path.join(here, '..', 'dashboard', 'hook.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-hook-'));
const env = { CLAUDE_PROJECT_DIR: tmp, AI_TEAM_NOTIFY_FILE: path.join(tmp, 'no-notify.json'), HOME: tmp };
const log = path.join(tmp, '.claude', 'ai-team', 'events.jsonl');
const events = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const hook = (o) => runHook(typeof o === 'string' ? o : JSON.stringify(o), { env, now: () => '2026-10-29T12:00:00.000Z' });

{   // quotes and backslashes in the value, and the same key inside another field: the old sed took the last one
  const r = hook({ hook_event_name: 'SubagentStart', session_id: 's1', agent_id: 'a"1\\x', agent_type: 'validator',
    tool_input: { session_id: 'other', agent_type: 'fake' } });
  assert.equal(r.out, '');
  assert.deepEqual(events(), [{ ts: '2026-10-29T12:00:00.000Z', event: 'SubagentStart', agent_id: 'a"1\\x', agent_type: 'validator', session_id: 's1' }]);
}
{   // line format same as the old hook.sh (collect.mjs and the compaction grep depend on it)
  hook({ hook_event_name: 'UserPromptExpansion', session_id: 's-eq', command_name: '/team' });
  assert.ok(fs.readFileSync(log, 'utf8').includes('"event":"TeamStart","session_id":"s-eq","via":"team"'));
  assert.equal(hook({ hook_event_name: 'SessionStart', session_id: 's-eq', source: 'compact' }).out, REMINDER);
  assert.equal(hook({ hook_event_name: 'SessionStart', session_id: 's-e', source: 'compact' }).out, '', 'a prefix of another session does not count');
  hook({ hook_event_name: 'UserPromptExpansion', session_id: 's-onb', command_name: 'onboarding' });
  assert.ok(fs.readFileSync(log, 'utf8').includes('"event":"TeamStart","session_id":"s-onb","via":"onboarding"'), '/onboarding marks the session too');
  assert.equal(hook({ hook_event_name: 'SessionStart', session_id: 's-onb', source: 'compact' }).out, REMINDER);
}
{   // invalid input or no known event: nothing written, nothing on the output
  const n = events().length;
  for (const raw of ['', 'not json', 'null', '[1,2]', JSON.stringify({ hook_event_name: 'Other' })]) { const r = hook(raw); assert.equal(r.out, ''); assert.ok(!r.notify); }
  assert.equal(events().length, n);
}
{   // without the ntfy config it does not notify; with it, SubagentStop/Stop in the background and SessionEnd waiting
  assert.equal(hook({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a' }).notify, null);
  fs.writeFileSync(env.AI_TEAM_NOTIFY_FILE, '{}');
  assert.equal(hook({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a' }).notify, 'bg');
  assert.equal(hook({ hook_event_name: 'Stop', session_id: 's' }).notify, 'bg');
  assert.equal(hook({ hook_event_name: 'SessionEnd', session_id: 's' }).notify, 'fg');
  assert.equal(runHook(JSON.stringify({ hook_event_name: 'Stop' }), { env: { ...env, AI_TEAM_NOTIFY: '0' } }).notify, null);
  fs.unlinkSync(env.AI_TEAM_NOTIFY_FILE);
}
{   // through hook.sh: with node it hands off; without node on PATH it exits 0 without writing
  const raw = JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's2', agent_id: 'b', agent_type: 'validator' });
  const ok = spawnSync('bash', [hookSh], { input: raw, env: { ...process.env, ...env } });
  assert.equal(ok.status, 0);
  assert.ok(events().some((e) => e.agent_id === 'b' && e.event === 'SubagentStop'));
  const n = events().length;
  const bare = spawnSync('/bin/bash', [hookSh], { input: raw, env: { ...env, PATH: '/nonexistent' } });
  assert.equal(bare.status, 0); assert.equal(bare.stdout.length, 0);
  assert.equal(events().length, n, 'without node: does not write');
}

// --- events.jsonl rotation -------------------------------------------------------------------
import { spawn } from 'node:child_process';
const hookMjs = path.join(here, '..', 'dashboard', 'hook.mjs');
const fresh = (limit) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-rot-'));
  const e = { ...env, CLAUDE_PROJECT_DIR: dir, ...(limit === undefined ? {} : { AI_TEAM_EVENTS_MAX_BYTES: String(limit) }) };
  const f = path.join(dir, '.claude', 'ai-team', 'events.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  return { dir, env: e, f, g1: f + '.1', run: (o) => runHook(JSON.stringify(o), { env: e, now: () => '2026-10-29T12:00:00.000Z' }) };
};
const tsLine = (sid) => JSON.stringify({ ts: '2026-10-29T11:00:00.000Z', event: 'TeamStart', session_id: sid, via: 'team' }) + '\n';
const subLine = (i) => JSON.stringify({ ts: '2026-10-29T11:00:00.000Z', event: 'SubagentStop', agent_id: `x${i}`, agent_type: 'validator', session_id: 'z' }) + '\n';
const lines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const padTo = (start, size) => { let t = start, i = 0; while (Buffer.byteLength(t) + Buffer.byteLength(subLine(1000 + i)) <= size) t += subLine(1000 + i++); return t; };
const startEv = { hook_event_name: 'SubagentStart', session_id: 's9', agent_id: 'new', agent_type: 'validator' };

{   // past the limit: .1 with everything, new file with only the TeamStart lines
  const t = fresh(2000);
  fs.writeFileSync(t.f, padTo(tsLine('s-a') + tsLine('s-b'), 1990));
  assert.ok(fs.statSync(t.f).size <= 1990 && fs.statSync(t.f).size > 1880);
  const before = lines(t.f);
  assert.equal(t.run(startEv).out, '');
  assert.deepEqual(lines(t.g1), [...before, { ts: '2026-10-29T12:00:00.000Z', event: 'SubagentStart', agent_id: 'new', agent_type: 'validator', session_id: 's9' }]);
  assert.deepEqual(lines(t.f), [JSON.parse(tsLine('s-a')), JSON.parse(tsLine('s-b'))], 'only the two TeamStart lines, in the same format as before');
  assert.ok(fs.readFileSync(t.f, 'utf8').includes('"event":"TeamStart","session_id":"s-a","via":"team"'));
  assert.ok(!fs.existsSync(t.f + '.lock'), 'lock released');
  // second rotation: .1 is replaced and the carried TeamStart lines stay in the new file
  fs.appendFileSync(t.f, padTo('', 1995 - fs.statSync(t.f).size));
  const second = lines(t.f);
  t.run({ ...startEv, agent_id: 'new2' });
  assert.deepEqual(lines(t.g1).slice(0, second.length), second, '.1 becomes the rotated file');
  assert.ok(lines(t.g1).some((e) => e.agent_id === 'new2'));
  assert.deepEqual(lines(t.f).map((e) => e.session_id), ['s-a', 's-b'], 'TeamStart carried again');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // below the limit: only appends, no generation created or changed
  const t = fresh(2000);
  fs.writeFileSync(t.f, tsLine('s-a'));
  t.run(startEv);
  assert.equal(lines(t.f).length, 2); assert.ok(!fs.existsSync(t.g1));
  fs.writeFileSync(t.g1, 'old\n');
  t.run(startEv);
  assert.equal(fs.readFileSync(t.g1, 'utf8'), 'old\n', '.1 untouched');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // invalid limit in the variable: the 1 MiB default applies
  for (const bad of ['abc', '0', '-5', '1.5', '']) {
    const t = fresh(bad);
    fs.writeFileSync(t.f, padTo(tsLine('s-a'), 5000));
    t.run(startEv);
    assert.ok(!fs.existsSync(t.g1), `limit "${bad}" does not rotate a 5 KB file`);
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
  const t = fresh();
  fs.writeFileSync(t.f, padTo(tsLine('s-a'), 1024 * 1024 - 50));
  t.run(startEv);
  assert.ok(fs.existsSync(t.g1), 'without the variable, rotates past 1 MiB');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // too many TeamStart lines: at most half the limit, from the most recent sessions, no repeated session_id
  const t = fresh(2000);
  let txt = ''; for (let i = 0; i < 30; i++) txt += tsLine(`sess-${String(i).padStart(2, '0')}`);
  txt += tsLine('sess-03');   // repeated: counts once, as the most recent
  fs.writeFileSync(t.f, txt);
  assert.ok(Buffer.byteLength(txt) > 2700 && Buffer.byteLength(txt) < 3200);
  t.run(startEv);
  const carried = lines(t.f), ids = carried.map((e) => e.session_id);
  assert.ok(fs.statSync(t.f).size <= 1000, `at most 1000 bytes (${fs.statSync(t.f).size})`);
  assert.equal(new Set(ids).size, ids.length, 'no repeated session_id');
  assert.equal(ids[ids.length - 1], 'sess-03', 'the most recent stays');
  assert.deepEqual(ids.slice(0, -1), ids.slice(0, -1).slice().sort(), 'chronological order');
  assert.ok(ids.includes('sess-29') && !ids.includes('sess-00'), 'most recent sessions');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // the compact reminder reads both generations; a never-marked session and a prefix do not match
  const t = fresh(2000);
  t.run({ hook_event_name: 'UserPromptExpansion', session_id: 's-eq', command_name: '/team' });
  fs.appendFileSync(t.f, padTo('', 1995 - fs.statSync(t.f).size));
  t.run(startEv);
  // the .1 generation has the TeamStart; so does the new one (carried). Remove it from the new one to prove .1 is read
  fs.writeFileSync(t.f, '');
  assert.ok(fs.readFileSync(t.g1, 'utf8').includes('"session_id":"s-eq"'));
  assert.equal(t.run({ hook_event_name: 'SessionStart', session_id: 's-eq', source: 'compact' }).out, REMINDER);
  assert.equal(t.run({ hook_event_name: 'SessionStart', session_id: 's-e', source: 'compact' }).out, '');
  assert.equal(t.run({ hook_event_name: 'SessionStart', session_id: 'never', source: 'compact' }).out, '');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // lock: recent = another hook rotating (does not rotate); abandoned (older than 30 s) is taken over
  const t = fresh(2000);
  fs.writeFileSync(t.f, padTo(tsLine('s-a'), 2100));
  fs.writeFileSync(t.f + '.lock', '');
  t.run(startEv);
  assert.ok(!fs.existsSync(t.g1), 'recent lock: does not rotate, just writes');
  assert.ok(lines(t.f).some((e) => e.agent_id === 'new'));
  const old = new Date(Date.now() - 60e3);
  fs.utimesSync(t.f + '.lock', old, old);
  t.run({ ...startEv, agent_id: 'new2' });
  assert.ok(fs.existsSync(t.g1), 'abandoned lock: rotates');
  assert.ok(!fs.existsSync(t.f + '.lock'));
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // simultaneous writes near the limit: no line is lost and only one hook rotates
  const t = fresh(4000);
  fs.writeFileSync(t.f, padTo(tsLine('s-a'), 3700));
  const prior = lines(t.f).length, N = 12;
  const procs = Array.from({ length: N }, (_, i) => new Promise((done) => {
    const c = spawn(process.execPath, [hookMjs], { env: { ...process.env, ...t.env }, stdio: ['pipe', 'ignore', 'ignore'] });
    c.on('exit', (code) => done(code));
    c.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: `par-${i}`, agent_type: 'validator' }));
  }));
  assert.deepEqual(await Promise.all(procs), Array(N).fill(0));
  const all = [...lines(t.g1), ...lines(t.f)];
  const agents = new Set(all.filter((e) => /^par-/.test(e.agent_id)).map((e) => e.agent_id));
  assert.equal(agents.size, N, 'every written event is in one of the generations');
  assert.equal(all.filter((e) => e.agent_id && !/^par-/.test(e.agent_id)).length, prior - 1, 'no earlier line lost (only one hook rotated)');
  assert.ok(!fs.existsSync(t.f + '.lock'));
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // folder without write permission: exits 0, empty output, no exception
  if (typeof process.getuid === 'function' && process.getuid() === 0) console.log('  (skipped: root writes to a folder without permission)');
  else {
    const t = fresh(2000);
    fs.chmodSync(path.dirname(t.f), 0o500);
    try {
      assert.equal(t.run({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a' }).out, '');
      const r = spawnSync(process.execPath, [hookMjs], { input: JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a' }), env: { ...process.env, ...t.env } });
      assert.equal(r.status, 0); assert.equal(r.stdout.length, 0);
      assert.ok(!fs.existsSync(t.f), 'nothing written');
      // the file already exists and passed the limit, but the folder accepts neither the lock nor the rename: writes and goes on
      fs.chmodSync(path.dirname(t.f), 0o700);
      fs.writeFileSync(t.f, padTo(tsLine('s-a'), 2100));
      fs.chmodSync(path.dirname(t.f), 0o500);
      assert.equal(t.run(startEv).out, '');
      assert.ok(!fs.existsSync(t.g1));
    } finally { fs.chmodSync(path.dirname(t.f), 0o700); }
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('node hook ok');
