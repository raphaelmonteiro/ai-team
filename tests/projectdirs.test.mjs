// Discovery of the session folders in ~/.claude/projects (findProjectDirs, via collect):
// besides the project's slug folder, any other folder whose transcript has, in the first
// record with `cwd`, the project path goes in. Characterization of the decision rule.
//   node tests/projectdirs.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { collect, projectSlug, createTranscriptCache } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-pdirs-'));
const project = path.join(tmp, 'proj');
const claude = path.join(tmp, 'claude');
const now = Date.parse('2026-10-21T15:00:00.000Z');
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const line = (r) => JSON.stringify(r) + '\n';
const projects = path.join(claude, 'projects');
const CHUNK_MAX = 16 * 1024 + 1024;   // one read block from the start (the 3rd line fits in the 1st block)

// transcript in the real format: 1st record without cwd (queue-operation), cwd only on the 3rd line
const transcript = (sid, cwd, { pad = 0 } = {}) =>
  line({ type: 'queue-operation', operation: 'enqueue', sessionId: sid, timestamp: new Date(now - 90000).toISOString() })
  + line({ type: 'summary', summary: 'x'.repeat(pad) })
  + line({ type: 'user', uuid: `${sid}-u`, sessionId: sid, cwd, timestamp: new Date(now - 60000).toISOString(), message: { role: 'user', content: `hi ${sid}` } });
const sessions = () => collect({ projectDir: project, claudeDir: claude, now, cache: createTranscriptCache() });

w(path.join(project, 'openspec/changes/add-x/tasks.md'), '## 1. Backend\n- [ ] 1.1 route\n');
w(path.join(projects, projectSlug(project), 'own.jsonl'), transcript('own', project));
assert.equal(sessions().totals.sessions, 1, 'only the slug folder');

{   // another folder with the project cwd on the 3rd line: goes in
    w(path.join(projects, 'another-path', 'alt.jsonl'), transcript('alt', project));
    const st = sessions();
    assert.equal(st.totals.sessions, 2);
}
{   // cwd with a trailing slash / redundant segments: path.resolve equalizes
    w(path.join(projects, 'another-2', 'alt2.jsonl'), transcript('alt2', project + '/./'));
    assert.equal(sessions().totals.sessions, 3);
}
{   // cwd of another project: does not go in
    w(path.join(projects, 'from-another-project', 'x.jsonl'), transcript('x', path.join(tmp, 'elsewhere')));
    assert.equal(sessions().totals.sessions, 3);
}
{   // only the first 3 .jsonl of the folder (listing order) are examined
    for (const n of ['a', 'b', 'c']) w(path.join(projects, 'four', `${n}.jsonl`), transcript(n, path.join(tmp, 'elsewhere')));
    w(path.join(projects, 'four', 'd.jsonl'), transcript('d', project));
    assert.equal(sessions().totals.sessions, 3, 'the 4th file is not examined');
}
{   // an unreadable transcript is ignored, without error
    if (typeof process.getuid === 'function' && process.getuid() === 0) console.log('  (skipped: root reads a file without permission)');
    else {
        const f = path.join(projects, 'no-permission', 'priv.jsonl');
        w(f, transcript('priv', project));
        fs.chmodSync(f, 0o000);
        try {
            const st = sessions();
            assert.equal(st.error, undefined);
            assert.equal(st.totals.sessions, 3, 'a folder whose transcript cannot be read is ignored');
        } finally { fs.chmodSync(f, 0o600); }
    }
}

// --- cost: only the start of the other folders' transcripts, kept across collections ---------------
// bytes read from .jsonl whose path passes `match` (the fs.readSync of tasks.md does not count)
const bytesRead = (fn, match = () => true) => {
  const origRead = fs.readSync, origOpen = fs.openSync, fds = new Set(); let n = 0;
  fs.openSync = (f, ...a) => { const fd = origOpen(f, ...a); if (String(f).endsWith('.jsonl') && match(String(f))) fds.add(fd); return fd; };
  fs.closeSync = ((close) => (fd) => { fds.delete(fd); return close(fd); })(fs.closeSync);
  fs.readSync = (fd, ...a) => { const k = origRead(fd, ...a); if (fds.has(fd)) n += k; return k; };
  try { fn(); } finally { fs.readSync = origRead; fs.openSync = origOpen; }
  return n;
};
{
  const claude2 = path.join(tmp, 'claude2'), p2 = path.join(projects, '..', '..', 'proj2');
  const pr = path.join(claude2, 'projects');
  const big = (sid, cwd) => transcript(sid, cwd) + line({ type: 'summary', summary: 'y'.repeat(1024 * 1024) });   // ~1 MB, cwd on the 3rd line
  const other = (n) => path.join(pr, `other-${n}`);
  const run = (cache = createTranscriptCache(), proj = project) => collect({ projectDir: proj, claudeDir: claude2, now, cache });
  const inOthers = (f) => !f.includes(`${path.sep}other-0${path.sep}`) && f.includes(`${path.sep}other-`);   // other-0 matches the project: read whole as a session
  w(path.join(pr, projectSlug(project), 'own.jsonl'), transcript('own', project));
  for (let n = 0; n < 3; n++) for (let k = 0; k < 3; k++) w(path.join(other(n), `s${k}.jsonl`), big(`s${n}${k}`, n === 0 ? project : path.join(tmp, 'elsewhere')));
  const total = 6 * fs.statSync(path.join(other(0), 's0.jsonl')).size;
  const cache = createTranscriptCache();
  let st;
  const first = bytesRead(() => { st = run(cache); }, inOthers);
  assert.ok(first > 0 && first < total * 0.1, `first collection reads only the start (${first} of ${total} bytes)`);
  assert.equal(st.totals.sessions, 1 + 3, 'the folder with the project cwd goes in with its 3 sessions');
  assert.equal(bytesRead(() => run(cache)), 0, 'warm collection without change: 0 bytes of .jsonl');
  assert.equal(bytesRead(() => run(createTranscriptCache()), inOthers), 0, 'another transcript cache, same process: the start is not reread');

  // append to a transcript already examined: the start is not reread and the decision holds
  fs.appendFileSync(path.join(other(0), 's1.jsonl'), line({ type: 'assistant', uuid: 'n1', sessionId: 's01', timestamp: new Date(now - 1000).toISOString(), message: { role: 'assistant', content: [{ type: 'text', text: 'more' }] } }));
  fs.appendFileSync(path.join(other(1), 's0.jsonl'), line({ type: 'user', uuid: 'n2', sessionId: 's10', cwd: path.join(tmp, 'elsewhere'), timestamp: new Date(now - 1000).toISOString(), message: { role: 'user', content: 'more' } }));
  assert.equal(bytesRead(() => { st = run(cache); }, inOthers), 0, 'append to a transcript of another folder: the start is not reread');
  assert.equal(st.totals.sessions, 4, 'the decision about the folders holds');

  // rewritten smaller and with a different cwd: reread, and the folder leaves
  for (const k of [0, 1, 2]) w(path.join(other(0), `s${k}.jsonl`), transcript(`s0${k}`, path.join(tmp, 'elsewhere')));
  const reread = bytesRead(() => { st = run(cache); }, (f) => f.includes(`${path.sep}other-`));
  assert.ok(reread > 0 && reread < 8192 * 3, `start reread (${reread} bytes)`);
  assert.equal(st.totals.sessions, 1, 'the folder no longer goes in');

  // new folder with the project cwd
  w(path.join(other(5), 'n.jsonl'), transcript('n5', project));
  assert.equal(run(cache).totals.sessions, 2, 'a new folder goes in on the next collection');
  // removed folder
  fs.rmSync(other(5), { recursive: true });
  assert.equal(run(cache).totals.sessions, 1, 'a removed folder goes away without error');
  // new file in a folder already examined
  w(path.join(other(1), 'a-new.jsonl'), transcript('new', project));   // does 'a-new' list before the s*.jsonl? only the first 3 count
  assert.equal(run(cache).error, undefined);

  // two projects in the same process (hub): each start is read once
  const claude3 = path.join(tmp, 'claude3'), pr3 = path.join(claude3, 'projects');
  const pa = path.join(tmp, 'pa'), pb = path.join(tmp, 'pb');
  for (const [pj, n] of [[pa, 'a'], [pb, 'b']]) w(path.join(pr3, projectSlug(pj), 'own.jsonl'), transcript(`own-${n}`, pj));
  for (let n = 0; n < 4; n++) w(path.join(pr3, `x-${n}`, 's.jsonl'), big(`x${n}`, path.join(tmp, 'far')));
  const both = bytesRead(() => { collect({ projectDir: pa, claudeDir: claude3, now, cache: createTranscriptCache() }); collect({ projectDir: pb, claudeDir: claude3, now, cache: createTranscriptCache() }); }, (f) => f.includes(`${path.sep}x-`));
  const one = bytesRead(() => { collect({ projectDir: pa, claudeDir: path.join(tmp, 'claude4-no-cache'), now }); }, () => true);
  assert.equal(one, 0);
  assert.ok(both > 0 && both <= 4 * CHUNK_MAX, `two projects read each start once (${both} bytes)`);

  // cwd only after the 1st MiB: the file counts as without cwd
  const claude5 = path.join(tmp, 'claude5'), pr5 = path.join(claude5, 'projects');
  w(path.join(pr5, projectSlug(project), 'own.jsonl'), transcript('own5', project));
  w(path.join(pr5, 'late', 't.jsonl'), line({ type: 'summary', summary: 'z'.repeat(1100 * 1024) }) + line({ type: 'user', uuid: 't1', sessionId: 't', cwd: project, timestamp: new Date(now - 1000).toISOString(), message: { role: 'user', content: 'late' } }));
  const lim = bytesRead(() => { st = collect({ projectDir: project, claudeDir: claude5, now, cache: createTranscriptCache() }); }, (f) => f.includes(`${path.sep}late${path.sep}`));
  assert.equal(st.totals.sessions, 1, 'cwd after 1 MiB: the folder does not go in');
  assert.ok(lim <= 1024 * 1024, `reading limited to 1 MiB (${lim})`);
  assert.equal(bytesRead(() => collect({ projectDir: project, claudeDir: claude5, now, cache: createTranscriptCache() }), (f) => f.includes(`${path.sep}late${path.sep}`)), 0, 'the "no cwd" result is kept too');
}

// --- R1: "shrank" is measured against the last size seen ----------------------------------------
{
  const claude6 = path.join(tmp, 'claude6'), pr = path.join(claude6, 'projects'), f = path.join(pr, 'rewritten', 'r.jsonl');
  w(path.join(pr, projectSlug(project), 'own.jsonl'), transcript('own6', project));
  w(f, transcript('r', project));
  const n = () => collect({ projectDir: project, claudeDir: claude6, now }).totals.sessions;
  assert.equal(n(), 2, 'the folder goes in through the project cwd');
  fs.appendFileSync(f, line({ type: 'summary', summary: 'a'.repeat(5000) }));   // grows (cwd reused)
  assert.equal(n(), 2);
  const grown = fs.statSync(f).size;
  fs.writeFileSync(f, transcript('r', path.join(tmp, 'elsewhere'), { pad: 1500 }));   // same inode, smaller than the last size, larger than at the 1st scan
  const small = fs.statSync(f).size;
  assert.ok(small < grown && small > fs.statSync(path.join(pr, projectSlug(project), 'own.jsonl')).size);
  assert.equal(n(), 1, 'rewritten smaller with another cwd: the folder no longer goes in');
}
// --- R3: the folder listing is only rebuilt when its mtime changes ------------------------------------
{
  const claude7 = path.join(tmp, 'claude7'), pr = path.join(claude7, 'projects'), dir = path.join(pr, 'listing');
  w(path.join(pr, projectSlug(project), 'own.jsonl'), transcript('own7', project));
  w(path.join(dir, 'a.jsonl'), transcript('a', path.join(tmp, 'elsewhere')));
  const base = Math.floor((Date.now() - 3600e3) / 1000) * 1000;   // pinned once: past(0) always returns the same mtime
  const past = (sec) => { const d = new Date(base + sec * 1000); fs.utimesSync(dir, d, d); };
  const n = () => collect({ projectDir: project, claudeDir: claude7, now }).totals.sessions;
  const readdirs = (fn) => {
    const orig = fs.readdirSync; let c = 0;
    fs.readdirSync = (d, ...a) => { if (String(d) === dir) c++; return orig(d, ...a); };
    try { fn(); } finally { fs.readdirSync = orig; }
    return c;
  };
  past(0);
  assert.equal(n(), 1);
  assert.equal(readdirs(n), 0, 'folder with an old, unchanged mtime: the listing is not reread');
  // new file without the mtime changing (restored): the stored listing holds
  w(path.join(dir, 'b.jsonl'), transcript('b', project));
  past(0);
  assert.equal(n(), 1, 'same mtime: the stored decision holds');
  // mtime changed: the listing is rebuilt and the new .jsonl enters the decision
  past(10);
  assert.equal(n(), 3, 'new mtime: the listing is rebuilt and the new file counts');
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ session folder discovery ok');
