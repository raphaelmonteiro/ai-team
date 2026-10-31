// ai-team — dashboard collector.
//
// Reads the Claude Code transcripts (~/.claude/projects/<slug>/) and the project's openspec/
// and builds the dashboard state: changes, each agent's runs
// (start, end, tokens, model, who it came from, who it went to) and effort per
// agent. Only reads files; needs no hook (the hook only refines start/end).
//
// Cost: a repeated collection with no changed file reads 0 bytes of .jsonl. The transcripts and
// events.jsonl (+ .1) are read incrementally (cache passed to collect()); the `cwd` of the other
// ~/.claude/projects folders is kept in the process (findProjectDirs). Measure: make bench.
//
//   node dashboard/collect.mjs [project] [--claude-dir DIR] [--json]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { newPlanState, feedPlan, planView, isRealPrompt } from './plan.mjs';
import { listPending, getAway } from './ask.mjs';
import { readProjectName } from './conf.mjs';
import { parseTasks, parseDeclaredState, waitingFor, splitChanges, inferStage, inferTask, flowOf, changeFiles } from './board.mjs';
import { stageCounts, buildTrail } from './stages.mjs';

export const projectSlug = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');

const STATUS_ORDER = { 'in progress': 0, blocked: 1, pending: 2, done: 3, 'ad-hoc': 4 };
const MAIN_AGENT_FALLBACK = 'orchestrator';
export const DEFAULT_STALE_MIN = 15;          // no transcript activity for longer than this = 'no signal'
const STALE_LIST_MS = 24 * 3600 * 1000;       // 'no signal' older than this leaves "now" and goes to history

// ---------------------------------------------------------------------------
// utilities
// ---------------------------------------------------------------------------
const ts = (r) => (r && r.timestamp ? Date.parse(r.timestamp) : NaN);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function contentText(message) {
  const c = message && message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
}
function contentBlocks(message, type) {
  const c = message && message.content;
  return Array.isArray(c) ? c.filter((b) => b && b.type === type) : [];
}

// sums usage of assistant records, without counting the same response twice
// (the transcript writes one record per content block with the same requestId).
// Accumulator: takes records bit by bit (incremental transcript reading).
class UsageAcc {
  constructor() {
    this.seen = new Set();
    this.u = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, requests: 0 };
    this.models = new Map();
    this.toolUses = 0;
  }
  add(r) {
    if (r.type !== 'assistant' || !r.message) return;
    this.toolUses += contentBlocks(r.message, 'tool_use').length;
    const key = r.requestId || (r.message.id ? `id:${r.message.id}` : r.uuid);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const us = r.message.usage || {}, u = this.u;
    u.input += num(us.input_tokens);
    u.output += num(us.output_tokens);
    u.cacheRead += num(us.cache_read_input_tokens);
    u.cacheCreation += num(us.cache_creation_input_tokens);
    u.requests += 1;
    const m = r.message.model || r.requestedModel;
    if (m) this.models.set(m, (this.models.get(m) || 0) + 1);
  }
  result() {   // new object on every call: the accumulator keeps growing
    const { input, output, cacheRead, cacheCreation, requests } = this.u;
    const u = { input, output, cacheRead, cacheCreation, total: input + output + cacheRead + cacheCreation, requests };
    const model = [...this.models.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || null;
    return { usage: u, model, models: [...this.models.keys()], toolUses: this.toolUses };
  }
}

// ---------------------------------------------------------------------------
// incremental transcript reading (cache per file)
// ---------------------------------------------------------------------------
// The cache (a Map, alive in the server process) keeps, per file, the state
// already parsed + the offset of the last consumed byte. Key: size+mtime.
//  - unchanged: returns the stored state;
//  - only grew (append) and the last bytes before the offset match: reads only
//    the new chunk and feeds the same state;
//  - any other change: rereads the whole file.
// Only complete lines (ending in \n) are consumed; an ending without \n that is
// already valid JSON goes in as usual, but marks the file for a full reread
// on the next append (the line may still be being written).
const TAIL_CHECK = 64;
export const createTranscriptCache = () => new Map();

function readTranscript(file, cache, { init, feed }) {
  let st;
  try { st = fs.statSync(file); } catch { cache.delete(file); return { state: init(), mtime: 0 }; }
  const prev = cache.get(file);
  if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return { state: prev.state, mtime: st.mtimeMs };
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { cache.delete(file); return { state: init(), mtime: 0 }; }
  try {
    let entry = null, from = 0;
    if (prev && !prev.openTail && st.size > prev.size && prev.offset > 0) {
      const n = Math.min(TAIL_CHECK, prev.offset);
      const head = Buffer.alloc(n);
      fs.readSync(fd, head, 0, n, prev.offset - n);
      if (head.equals(prev.tail)) { entry = prev; from = prev.offset; }
    }
    const state = entry ? entry.state : init();
    const pre = Math.min(TAIL_CHECK, from);
    const want = st.size - (from - pre);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const k = fs.readSync(fd, buf, got, want - got, from - pre + got);
      if (!k) break;
      got += k;
    }
    const data = buf.subarray(pre, got);
    const feedLine = (a, b) => {
      if (a >= b) return false;
      let rec;
      try { rec = JSON.parse(data.toString('utf8', a, b)); } catch { return false; }
      if (rec && typeof rec === 'object') feed(state, rec);
      return true;
    };
    let pos = 0, nl;
    while ((nl = data.indexOf(10, pos)) >= 0) { feedLine(pos, nl); pos = nl + 1; }
    let openTail = false;
    if (pos < data.length && feedLine(pos, data.length)) { openTail = true; pos = data.length; }
    const consumed = pre + pos;     // bytes of buf already consumed
    cache.set(file, { size: from - pre + got, mtimeMs: st.mtimeMs, offset: from - pre + consumed, openTail, state,
      tail: Buffer.from(buf.subarray(Math.max(0, consumed - TAIL_CHECK), consumed)) });
    return { state, mtime: st.mtimeMs };
  } finally { fs.closeSync(fd); }
}

function usageFromResult(us) {
  if (!us) return null;
  const u = {
    input: num(us.input_tokens), output: num(us.output_tokens),
    cacheRead: num(us.cache_read_input_tokens), cacheCreation: num(us.cache_creation_input_tokens),
  };
  u.total = u.input + u.output + u.cacheRead + u.cacheCreation;
  return u;
}
// raw tokens summed; "fresh" = input + output + cache creation, "cached" = cache read
const zeroTok = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
function addTok(t, u) { t.input += u.input; t.output += u.output; t.cacheRead += u.cacheRead; t.cacheCreation += u.cacheCreation; return t; }
const withSplit = (t) => ({ ...t, fresh: t.input + t.output + t.cacheCreation, cached: t.cacheRead });
const sumTok = (list) => withSplit(list.reduce((t, r) => addTok(t, r.usage), zeroTok()));
const shortModel = (m) => (m ? m.replace(/^claude-/, '').replace(/-\d{8}$/, '') : null);

// ---------------------------------------------------------------------------
// openspec: changes and task state
// ---------------------------------------------------------------------------
export function readChanges(projectDir) {
  const base = path.join(projectDir, 'openspec', 'changes');
  const changes = new Map();
  const add = (id, dir, archived, archiveName) => {
    const c = { id, dir: path.relative(projectDir, dir), archived, tasks: { total: 0, done: 0, blocked: 0 },
      review: null, reviewRounds: [], validation: null, sections: {}, updatedAt: null, createdAt: null, archivedOn: null, header: '', declared: null, taskList: [], files: [] };
    try { const st = fs.statSync(dir); c.updatedAt = st.mtimeMs; c.createdAt = st.birthtimeMs || null; } catch { /* ignore */ }
    const am = archiveName && archiveName.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (am) c.archivedOn = Date.parse(`${am[1]}T12:00:00`);
    c.files = changeFiles(dir);
    const tasksFile = path.join(dir, 'tasks.md');
    if (fs.existsSync(tasksFile)) {
      try { c.updatedAt = Math.max(c.updatedAt || 0, fs.statSync(tasksFile).mtimeMs); } catch { /* ignore */ }
      const text = fs.readFileSync(tasksFile, 'utf8');
      for (const m of text.matchAll(/^##\s*\d\.\s*(.+)/gm)) c.sections[m[1].replace(/\s+/g, ' ').trim()] = { total: 0, done: 0 };
      const parsed = parseTasks(text);
      c.header = parsed.header;
      c.declared = parseDeclaredState(parsed.header);
      c.taskList = parsed.tasks.map((t) => ({ id: t.id, done: t.done, section: t.section, blocked: t.blocked, deps: t.deps, text: t.text }));
      for (const t of parsed.tasks) {
        c.tasks.total++; if (t.done) c.tasks.done++;
        if (!t.done && t.blocked) c.tasks.blocked++;
        if (t.section && c.sections[t.section]) { c.sections[t.section].total++; if (t.done) c.sections[t.section].done++; }
      }
    }
    const results = (file, re) => {
      const f = path.join(dir, file);
      if (!fs.existsSync(f)) return null;
      return [...fs.readFileSync(f, 'utf8').matchAll(re)].map((m) => m[1].trim());
    };
    const lastOf = (list) => (list === null ? null : list.length ? list[list.length - 1] : 'no result');
    const revList = results('review-report.md', /Result:\s*([^\n|]+)/g);
    c.reviewRounds = revList || [];
    c.review = lastOf(revList);
    c.validation = lastOf(results('validation-report.md', /Result:\s*([^\n|]+)/g));
    changes.set(id, c);
  };
  const list = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
  for (const name of list(base)) {
    if (name === 'archive') continue;
    add(name, path.join(base, name), false);
  }
  for (const name of list(path.join(base, 'archive'))) {
    const id = name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    if (!changes.has(id)) add(id, path.join(base, 'archive', name), true, name);
    else changes.get(id).archived = true;
  }
  return changes;
}

// "Ad-hoc task: <slug>" on the first line of the prompt (orchestrator, no change) beats the rest
export const LOOSE_PREFIX = 'adhoc:';
function attributeChange(text, changeIds) {
  const t = String(text || '');
  const av = t.match(/^\s*ad-hoc task:\s*([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)/i);
  if (av) return LOOSE_PREFIX + av[1].toLowerCase();
  const m = t.match(/openspec\/changes\/(?:archive\/\d{4}-\d{2}-\d{2}-)?([a-z0-9][a-z0-9._-]*)/i);
  // 'openspec/changes/add-x-*' (glob) is not an id: ids do not end in - . _
  if (m && m[1] !== 'archive' && !/[-._]$/.test(m[1])) return m[1];
  let best = null;
  for (const id of changeIds) {
    const re = new RegExp(`(^|[^a-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9-]|$)`, 'i');
    if (re.test(t) && (!best || id.length > best.length)) best = id;
  }
  return best;
}

// ---------------------------------------------------------------------------
// optional hooks: .claude/ai-team/events.jsonl (dashboard/hook.sh)
// ---------------------------------------------------------------------------
// The hook rotates the file past the limit (events.jsonl → events.jsonl.1): reads both generations,
// incrementally (same mechanism and same cache as the transcripts), the old one first.
const newHookState = () => ({ byAgent: new Map(), teamSessions: new Set() });
function feedHook(S, e) {
  if (e.event === 'TeamStart' && e.session_id) { S.teamSessions.add(e.session_id); return; }   // /team or --agent orchestrator
  if (!e.agent_id) return;
  const cur = S.byAgent.get(e.agent_id) || {};
  const t = e.ts ? Date.parse(e.ts) : NaN;
  if (e.event === 'SubagentStart') cur.start = t;
  cur.type = cur.type || e.agent_type;
  if (e.event === 'SubagentStop') cur.stop = t;
  S.byAgent.set(e.agent_id, cur);
}
function readHookEvents(projectDir, cache) {
  const file = path.join(projectDir, '.claude', 'ai-team', 'events.jsonl');
  const read = (f) => readTranscript(f, cache, { init: newHookState, feed: feedHook }).state;
  const old = read(file + '.1'), cur = read(file);
  if (!old.byAgent.size && !old.teamSessions.size) return cur;
  // merges in generation order: same as reading both concatenated (the stored states do not change)
  const byAgent = new Map(), teamSessions = new Set([...old.teamSessions, ...cur.teamSessions]);
  for (const gen of [old, cur]) for (const [id, g] of gen.byAgent) {
    const m = byAgent.get(id) || {};
    if ('start' in g) m.start = g.start;
    if ('stop' in g) m.stop = g.stop;
    m.type = m.type || g.type;
    byAgent.set(id, m);
  }
  return { byAgent, teamSessions };
}

// ---------------------------------------------------------------------------
// Claude Code sessions
// ---------------------------------------------------------------------------
// Discovery of the ~/.claude/projects folders that hold sessions of this project opened at another path.
// The `cwd` of each transcript comes only from the start of the file (up to the 1st complete line with `cwd` or
// CWD_SCAN_MAX bytes) and is kept in the process, per claudeDir (shared between the hub's
// projects), per folder and per file:
//  - file: invalidated if it shrinks, changes inode or disappears (an append does not change the start);
//    without `cwd` because the file was still short, it is reread when it grows;
//  - folder: the list of the first 3 .jsonl is only rebuilt when the folder mtime changes (or was
//    too recent to trust); a removed folder leaves the cache.
const CWD_SCAN_MAX = 1024 * 1024, CWD_CHUNK = 16 * 1024, CWD_FILES_PER_DIR = 3, DIR_SETTLE_MS = 2000;
const cwdCaches = new Map();   // claudeDir → Map<folder, { mtimeMs, scanAt, names, files: Map<name, { size, ino, cwd, final }> }>

// first `cwd` from the start of the file; `final` = the result does not change while the file only grows
function scanCwd(file, size) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const limit = Math.min(size, CWD_SCAN_MAX);
    const chunk = Buffer.alloc(CWD_CHUNK);
    let pending = Buffer.alloc(0), pos = 0;
    const parse = (buf) => { try { const r = JSON.parse(buf.toString('utf8')); return r && typeof r.cwd === 'string' && r.cwd ? r.cwd : null; } catch { return null; } };
    while (pos < limit) {
      const k = fs.readSync(fd, chunk, 0, Math.min(CWD_CHUNK, limit - pos), pos);
      if (!k) break;
      pos += k;
      pending = Buffer.concat([pending, chunk.subarray(0, k)]);
      let nl;
      while ((nl = pending.indexOf(10)) >= 0) {
        const cwd = nl ? parse(pending.subarray(0, nl)) : null;
        if (cwd) return { cwd, final: true };
        pending = pending.subarray(nl + 1);
      }
    }
    if (pos >= size && pending.length) { const cwd = parse(pending); if (cwd) return { cwd, final: true }; }   // last line without \n
    return { cwd: null, final: size >= CWD_SCAN_MAX };
  } catch { return null; }
  finally { fs.closeSync(fd); }
}

function cwdOfFile(entries, name, file) {
  let st;
  try { st = fs.statSync(file); } catch { entries.delete(name); return null; }
  const prev = entries.get(name);
  if (prev && prev.ino === st.ino && st.size >= prev.size && (prev.cwd || prev.final || st.size === prev.size)) {
    prev.size = st.size;   // "shrank" is measured against the last size seen, not the one from the first scan
    return prev.cwd;
  }
  const r = scanCwd(file, st.size);
  if (!r) { entries.delete(name); return null; }
  entries.set(name, { size: st.size, ino: st.ino, cwd: r.cwd, final: r.final });
  return r.cwd;
}

function findProjectDirs(claudeDir, projectDir) {
  const root = path.join(claudeDir, 'projects');
  const slug = projectSlug(projectDir);
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return out; }
  if (entries.includes(slug)) out.push(path.join(root, slug));
  let dirsCache = cwdCaches.get(claudeDir);
  if (!dirsCache) { dirsCache = new Map(); cwdCaches.set(claudeDir, dirsCache); }
  const present = new Set(entries.map((n) => path.join(root, n)));
  for (const d of dirsCache.keys()) if (!present.has(d)) dirsCache.delete(d);
  const want = path.resolve(projectDir);
  // sessions opened at another path for the same project (symlink, another user)
  for (const name of entries) {
    if (name === slug) continue;
    const dir = path.join(root, name);
    let st;
    try { st = fs.statSync(dir); } catch { dirsCache.delete(dir); continue; }
    let d = dirsCache.get(dir);
    if (!d || d.mtimeMs !== st.mtimeMs || d.scanAt - d.mtimeMs < DIR_SETTLE_MS) {
      let names;
      try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).slice(0, CWD_FILES_PER_DIR); } catch { dirsCache.delete(dir); continue; }
      const files = d ? d.files : new Map();
      for (const k of [...files.keys()]) if (!names.includes(k)) files.delete(k);
      d = { mtimeMs: st.mtimeMs, scanAt: Date.now(), names, files };
      dirsCache.set(dir, d);
    }
    for (const f of d.names) {
      const cwd = cwdOfFile(d.files, f, path.join(dir, f));
      if (cwd && path.resolve(cwd) === want) { out.push(dir); break; }
    }
  }
  return out;
}

// running Claude Code sessions (~/.claude/sessions/<pid>.json), by sessionId
function liveSessions(claudeDir) {
  const live = new Set();
  const dir = path.join(claudeDir, 'sessions');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return live; }
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!s.sessionId || !s.pid) continue;
      process.kill(s.pid, 0);            // throws if the process does not exist
      live.add(s.sessionId);
    } catch { /* orphan file or dead process */ }
  }
  return live;
}

export { readProjectName } from './conf.mjs';

// fixed agent from settings.json ("agent"): every session starts as it. Without the key, each
// session chooses (/team, claude --agent orchestrator) and the dashboard decides per session.
function readFixedAgent(projectDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'));
    if (typeof s.agent === 'string' && s.agent) return s.agent;
  } catch { /* ignore */ }
  return null;
}
function readTeamAgents(projectDir) {
  try { return new Set(fs.readdirSync(path.join(projectDir, '.claude', 'agents')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3))); }
  catch { return new Set(); }
}
// /team or /onboarding recorded in the transcript as <command-name>/team</command-name>
const TEAM_CMD_RE = /<command-name>\/?(?:team|onboarding)<\/command-name>/;

const newSessionState = (sessionId) => ({ sessionId, planState: newPlanState(), count: 0, calls: new Map(), results: new Map(), notifications: new Map(),
  turns: [], turn: null, usage: new UsageAcc(), first: null, last: null, title: null, firstPrompt: null, teamCmd: false });

// session title: what Claude Code writes in the transcript (custom-title, ai-title, summary)
function feedSession(S, r) {
  S.count++;
  if (r.type === 'custom-title' && r.customTitle) S.title = norm(r.customTitle);
  else if (r.type === 'ai-title' && r.aiTitle && !S.title) S.title = norm(r.aiTitle);
  else if (r.type === 'summary' && r.summary && !S.title) S.title = norm(r.summary);
  const t = ts(r);
  if (t && !S.first) S.first = r;
  if (t) S.last = r;
  S.usage.add(r);
  feedPlan(S.planState, r, t, { isRealPrompt: isRealPrompt(r) });
  if (r.type === 'assistant' && r.message) {
    for (const b of contentBlocks(r.message, 'tool_use')) {
      if (b.name === 'Agent' || b.name === 'Task') {
        S.calls.set(b.id, { toolUseId: b.id, ts: t, input: b.input || {}, sessionId: S.sessionId });
      }
    }
    if (S.turn) S.turn.end = Math.max(S.turn.end, t);
  }
  if (r.type === 'user' && r.message) {
    for (const b of contentBlocks(r.message, 'tool_result')) {
      if (S.calls.has(b.tool_use_id)) {
        const res = r.toolUseResult && typeof r.toolUseResult === 'object' ? r.toolUseResult : {};
        S.results.set(b.tool_use_id, { ts: t, agentId: res.agentId || null, totalDurationMs: res.totalDurationMs,
          totalTokens: res.totalTokens, launched: res.isAsync === true || res.status === 'async_launched', usage: usageFromResult(res.usage), status: res.status || null,
          background: !res.agentId && /background|async/i.test(JSON.stringify(res).slice(0, 2000)) });
      }
    }
    const text = contentText(r.message);
    if (!S.teamCmd && TEAM_CMD_RE.test(text)) S.teamCmd = true;
    if (text.includes('<task-notification>')) {
      const id = text.match(/<task-id>([^<]+)<\/task-id>/);
      const st = text.match(/<status>([^<]+)<\/status>/);
      if (id) S.notifications.set(id[1].trim(), { ts: t, status: st ? st[1].trim() : null });
    }
    if (isRealPrompt(r)) {
      if (!S.firstPrompt) S.firstPrompt = text;
      if (S.turn && S.turn.end > S.turn.start) S.turns.push(S.turn);
      S.turn = { start: t, end: t, prompt: text.slice(0, 200) };
    }
  }
}

// session name: transcript title > shortened first prompt > short id
export function sessionName(S) {
  if (S.title) return S.title.slice(0, 80);
  const p = norm(String(S.firstPrompt || '').replace(/<[^>]+>/g, ' ')).replace(/^(vamos a isso:|vamos nessa:|let's go:)\s*/i, '');
  if (!p) return String(S.sessionId || '').slice(0, 8);
  if (p.length <= 60) return p;
  const cut = p.slice(0, 59), sp = cut.lastIndexOf(' ');
  return (sp > 30 ? cut.slice(0, sp) : cut).trimEnd() + '…';   // cuts at a whole word
}

function parseSession(file, now, cache) {
  const { state: S, mtime } = readTranscript(file, cache, { init: () => newSessionState(path.basename(file, '.jsonl')), feed: feedSession });
  const turns = S.turns.slice();
  if (S.turn && S.turn.end > S.turn.start) turns.push({ ...S.turn });
  const main = S.usage.result();
  return {
    sessionId: S.sessionId, file, count: S.count, calls: S.calls, results: S.results, notifications: S.notifications, turns,
    main: { ...main, workMs: turns.reduce((a, x) => a + (x.end - x.start), 0), start: ts(S.first), end: ts(S.last), mtime },
    teamCmd: S.teamCmd, ...planView(S.planState), name: sessionName(S), cwd: (S.first && S.first.cwd) || null, gitBranch: (S.last && S.last.gitBranch) || null, now,
  };
}

const newSubState = () => ({ prompt: null, usage: new UsageAcc(), first: null, last: null, summary: '', agentName: null, interrupted: false });
function feedSub(S, r) {
  if (S.prompt === null && r.type === 'user' && r.message) S.prompt = contentText(r.message);
  const t = ts(r);
  if (t && !S.first) S.first = r;
  if (t) S.last = r;
  S.usage.add(r);
  if (r.type === 'user' && /\[Request interrupted by user/.test(contentText(r.message) + JSON.stringify((r.message && r.message.content) || '').slice(0, 400))) S.interrupted = true;
  else if (r.type === 'assistant') S.interrupted = false;
  if (r.type === 'assistant') { const tx = contentText(r.message); if (tx) S.summary = tx.slice(0, 600); }
  if (!S.agentName && r.agentName) S.agentName = r.agentName;
}

function parseSubagent(file, cache) {
  const { state: S, mtime } = readTranscript(file, cache, { init: newSubState, feed: feedSub });
  const agentId = path.basename(file, '.jsonl').replace(/^agent-/, '');
  return {
    agentId, file, prompt: S.prompt || '', ...S.usage.result(), start: ts(S.first), end: ts(S.last), mtime,
    summary: S.summary, agentName: S.agentName || null, interrupted: S.interrupted,
  };
}

// ---------------------------------------------------------------------------
// collection
// ---------------------------------------------------------------------------
export function collect({ projectDir = process.cwd(), claudeDir = path.join(os.homedir(), '.claude'),
  now = Date.now(), staleMin = DEFAULT_STALE_MIN, activeWindowMs = staleMin * 60 * 1000, mainAgent = null, cache = createTranscriptCache() } = {}) {
  projectDir = path.resolve(projectDir);
  const changes = readChanges(projectDir);
  const changeIds = [...changes.keys()];
  const { byAgent: hooks, teamSessions: marked } = readHookEvents(projectDir, cache);
  const live = liveSessions(claudeDir);
  const fixedAgent = readFixedAgent(projectDir);
  const mainName = mainAgent || fixedAgent || MAIN_AGENT_FALLBACK;
  const team = readTeamAgents(projectDir); team.delete(mainName);   // agents the orchestrator calls
  const looseRuns = [];
  const runs = [];
  const sessions = [];
  const unlinked = [];
  const touched = new Set();
  const dirs = findProjectDirs(claudeDir, projectDir);

  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      touched.add(path.join(dir, f));
      const s = parseSession(path.join(dir, f), now, cache);
      if (!s.count) continue;
      s.live = live.has(s.sessionId);
      // team session: fixed agent in settings, marked by the hook (/team, --agent orchestrator),
      // /team in the transcript, or delegated to a team agent;
      // the rest is a loose session (plain Claude), outside the team effort
      // (without .claude/agents/ there is no way to tell: everything counts as team, as before)
      s.team = !!(fixedAgent || mainAgent) || !team.size || marked.has(s.sessionId) || s.teamCmd || [...s.calls.values()].some((c) => team.has(c.input.subagent_type));
      sessions.push(s);
      // this session's subagent transcripts
      const subDir = path.join(dir, s.sessionId, 'subagents');
      let subs = [];
      try { subs = fs.readdirSync(subDir).filter((x) => x.startsWith('agent-') && x.endsWith('.jsonl')).map((x) => { touched.add(path.join(subDir, x)); return parseSubagent(path.join(subDir, x), cache); }); } catch { /* no subagents */ }
      const byAgentId = new Map(subs.map((x) => [x.agentId, x]));
      const usedSubs = new Set();
      const callList = [...s.calls.values()].sort((a, b) => a.ts - b.ts);
      // 1) link by the result's agentId; 2) by prompt; 3) by order
      for (const call of callList) {
        const res = s.results.get(call.toolUseId);
        let sub = res && res.agentId ? byAgentId.get(res.agentId) : null;
        if (!sub) {
          const p = norm(call.input.prompt);
          sub = subs.find((x) => !usedSubs.has(x.agentId) && p && norm(x.prompt) === p) || null;
        }
        if (!sub) {
          sub = subs.filter((x) => !usedSubs.has(x.agentId) && x.start >= call.ts - 5000).sort((a, b) => a.start - b.start)[0] || null;
        }
        if (sub) usedSubs.add(sub.agentId);
        (s.team ? runs : looseRuns).push(buildRun({ call, res, sub, session: s, hooks, changeIds, now, activeWindowMs }));
      }
      for (const sub of subs) {
        if (usedSubs.has(sub.agentId)) continue;
        // subagent without a visible call (main session truncated/compacted)
        const run = buildRun({ call: null, res: null, sub, session: s, hooks, changeIds, now, activeWindowMs });
        if (!s.team && !team.has(run.agent)) { looseRuns.push(run); continue; }
        runs.push(run);
        unlinked.push(run.id);
      }
    }
  }

  // a removed file leaves the cache (only inside the scanned folders)
  for (const k of [...cache.keys()]) if (!touched.has(k) && dirs.some((d) => k.startsWith(d + path.sep))) cache.delete(k);

  // main team session = effort of the orchestrator agent, outside the changes
  const teamSessions = sessions.filter((s) => s.team);
  const mainRuns = teamSessions.map((s) => ({
    id: `main:${s.sessionId}`, sessionId: s.sessionId, agent: mainName, main: true,
    change: null, description: `session ${s.sessionId.slice(0, 8)}`, model: shortModel(s.main.model), models: s.main.models.map(shortModel),
    start: s.main.start, end: s.main.end, durationMs: s.main.workMs, usage: s.main.usage, tokenSplit: withSplit(addTok(zeroTok(), s.main.usage)), toolUses: s.main.toolUses,
    sessionName: s.name, status: (s.live || now - s.main.mtime < activeWindowMs) ? 'running' : 'finished',
    active: s.live || now - s.main.mtime < activeWindowMs, turns: s.turns.length, gitBranch: s.gitBranch, live: s.live,
    plan: s.plan, ask: s.ask, recap: s.recap,
  }));

  // per change: order, from/to, handoffs, active agent
  const byChange = new Map();
  for (const r of runs) {
    const key = r.change || '(no change)';
    if (!byChange.has(key)) byChange.set(key, []);
    byChange.get(key).push(r);
  }
  const changeViews = [];
  const allIds = new Set([...changeIds, ...byChange.keys()]);
  for (const id of allIds) {
    const loose = id.startsWith(LOOSE_PREFIX);
    const c = changes.get(id) || { id, dir: null, archived: false, tasks: { total: 0, done: 0, blocked: 0 }, review: null, reviewRounds: [], validation: null, sections: {}, updatedAt: null, createdAt: null, archivedOn: null, header: '', declared: null, taskList: [], files: [], unknown: !loose };
    const list = (byChange.get(id) || []).sort((a, b) => a.start - b.start);
    let prev = mainName;
    let handoffs = 0;
    for (const r of list) {
      r.from = prev;
      if (r.agent !== prev) handoffs++;
      prev = r.agent;
    }
    let reviewed = false;
    for (const r of list) {     // trail stage and cited task, in chronological order
      const tk = inferTask(r.description, r.promptPreview, c.taskList);
      r.task = tk ? tk.id : null; r.taskSection = tk ? tk.section : null;
      r.flow = flowOf(r, { mainAgent: mainName, afterReview: reviewed });
      if (r.flow === 'review') reviewed = true;
    }
    for (let i = 0; i < list.length; i++) list[i].to = i + 1 < list.length ? list[i + 1].agent : (list[i].active ? null : mainName);
    const agents = {};
    for (const r of list) {
      const a = agents[r.agent] || (agents[r.agent] = { agent: r.agent, runs: 0, durationMs: 0, tokens: 0, raw: zeroTok(), models: new Set(), active: false });
      a.runs++; a.durationMs += r.durationMs; a.tokens += r.usage.total; addTok(a.raw, r.usage); if (r.model) a.models.add(r.model); if (r.active) a.active = true;
    }
    const active = list.filter((r) => r.active);
    const lastActivity = Math.max(c.updatedAt || 0, ...list.map((r) => r.end || r.start || 0));
    let status;
    if (loose) status = 'ad-hoc';
    else if (active.length) status = 'in progress';
    else if (id === '(no change)') status = 'ad-hoc';
    else if (c.archived) status = 'done';
    else if (c.tasks.blocked > 0) status = 'blocked';
    else if (c.tasks.total > 0 && c.tasks.done === c.tasks.total && /APPROVED/i.test(c.review || '') && !/NOT APPROVED|CHANGES/i.test(c.review || '')) status = 'done';
    else if (c.tasks.done > 0 || list.length > 0) status = 'in progress';
    else status = 'pending';
    const firstStart = list.map((r) => r.start).filter((x) => Number.isFinite(x)).sort((a, b) => a - b)[0];
    const startedAt = firstStart || c.createdAt || c.archivedOn || null;
    const startSource = firstStart ? 'first agent run' : (c.createdAt ? 'folder creation' : (c.archivedOn ? 'archive date' : null));
    const lastRun = Math.max(0, ...list.map((r) => r.end || r.start || 0));
    const completedAt = c.archived ? Math.max(c.archivedOn || 0, lastRun) : lastActivity;
    const dec = c.declared && c.declared.valid && !c.archived ? c.declared : null;
    let waiting = status === 'ad-hoc' ? null : c.unknown ? { text: 'undefined', rule: 'the change cited in the runs has no folder in openspec/changes' } : waitingFor({ archived: c.archived, header: c.header, taskList: c.taskList, review: c.review, validation: c.validation });
    if (waiting) {
      waiting = { ...waiting, source: 'inferred' };
      if (c.declared && !c.declared.valid && !c.archived) waiting.warning = `invalid declared state: ${c.declared.reason}`;
      if (dec) waiting = dec.stage === 'archived'
        ? { text: 'nothing (archived)', rule: '"state:" line in the tasks.md header', source: 'declared', stage: dec.stage, since: dec.since, note: dec.note }
        : { text: `waiting for ${dec.waiting}`, rule: '"state:" line in the tasks.md header', source: 'declared', stage: dec.stage, waiting: dec.waiting, since: dec.since, note: dec.note, heuristic: waiting.text };
    }
    const declaredArch = !!(dec && dec.stage === 'archived');
    if (declaredArch && status !== 'ad-hoc') status = 'done';
    const trail = buildTrail({ id, status, archived: c.archived, declared: c.declared, unknown: !!c.unknown, waiting, tasks: c.tasks, taskList: c.taskList,
      review: c.review, reviewRounds: c.reviewRounds || [], validation: c.validation, runs: list }, mainName);
    changeViews.push({
      id, kind: loose ? 'adhoc' : id === '(no change)' ? 'no-change' : 'change', title: loose ? id.slice(LOOSE_PREFIX.length) : id,
      status, trail, declared: c.declared, archived: c.archived, unknown: !!c.unknown, tasks: c.tasks, sections: c.sections, review: c.review, validation: c.validation,
      files: c.files, startedAt, startSource, completedAt, waiting,
      lastActivity, runs: list, handoffs, rounds: list.length,
      durationMs: list.reduce((a, r) => a + r.durationMs, 0), tokens: list.reduce((a, r) => a + r.usage.total, 0), tokenSplit: sumTok(list),
      staleAgents: list.filter(isStaleListed).map((r) => ({ agent: r.agent, runId: r.id, since: r.start, silentMs: r.silentMs })),
      activeAgents: active.map((r) => ({ agent: r.agent, runId: r.id, model: r.model, since: r.start, tokens: r.usage.total, tokenSplit: withSplit(addTok(zeroTok(), r.usage)), durationMs: r.durationMs })),
      agents: Object.values(agents).map(({ raw, ...a }) => ({ ...a, tokenSplit: withSplit(raw), models: [...a.models] })).sort((x, y) => y.durationMs - x.durationMs),
    });
  }
  changeViews.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (b.lastActivity - a.lastActivity));
  const board = splitChanges(changeViews);
  const brief = (r) => ({ id: r.id, agent: r.agent, change: r.change, stage: r.stage || null, description: r.description, model: r.model,
    since: r.start, lastActivity: r.lastActivity || r.end || r.start, end: r.end, status: r.status || (r.active ? 'running' : 'finished'),
    silentMs: r.silentMs || 0, sessionId: r.sessionId, sessionName: r.sessionName,
    tokens: r.usage.total, tokenSplit: withSplit(addTok(zeroTok(), r.usage)), main: !!r.main });
  const running = [...runs.filter((r) => r.active || isStaleListed(r)), ...mainRuns.filter((r) => r.active && r.live)]
    .sort((a, b) => (a.start || 0) - (b.start || 0)).map(brief);
  const recent = runs.filter((r) => !r.active && !isStaleListed(r)).sort((a, b) => (b.end || 0) - (a.end || 0)).slice(0, 8).map(brief);

  // effort per agent (all changes + main session)
  const effort = {};
  for (const r of [...runs, ...mainRuns]) {
    const a = effort[r.agent] || (effort[r.agent] = { agent: r.agent, runs: 0, durationMs: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, models: new Set(), changes: new Set(), active: false });
    a.runs++; a.durationMs += r.durationMs; a.tokens += r.usage.total; a.input += r.usage.input; a.output += r.usage.output;
    a.cacheRead += r.usage.cacheRead; a.cacheCreation += r.usage.cacheCreation;
    if (r.model) a.models.add(r.model); if (r.change) a.changes.add(r.change); if (r.active) a.active = true;
  }
  const agents = Object.values(effort).map((a) => ({ ...a, tokenSplit: withSplit({ input: a.input, output: a.output, cacheRead: a.cacheRead, cacheCreation: a.cacheCreation }), models: [...a.models], changes: a.changes.size })).sort((x, y) => y.durationMs - x.durationMs);

  return {
    generatedAt: now, project: { dir: projectDir, name: readProjectName(projectDir), mainAgent: mainName, claudeDir },
    totals: {
      changes: changeViews.length, active: changeViews.filter((c) => c.status === 'in progress').length,
      runs: runs.length, tokens: agents.reduce((a, x) => a + x.tokens, 0), tokenSplit: withSplit(agents.reduce((t, x) => addTok(t, x), zeroTok())), durationMs: agents.reduce((a, x) => a + x.durationMs, 0),
      sessions: sessions.length, teamSessions: teamSessions.length,
    },
    looseSessions: looseSummary(sessions.filter((s) => !s.team), looseRuns, now, activeWindowMs),
    staleMin, agentStates: countStates(runs),
    changes: changeViews, agents, mainRuns, unlinked, pending: listPending(projectDir), away: getAway(projectDir),
    running, recent,
    stages: stageCounts(changeViews),
    board: { running: board.running.map((c) => c.id), blocked: board.blocked.map((c) => c.id), pending: board.pending.map((c) => c.id),
      done: board.done.map((c) => c.id), doneOlder: board.doneOlder.map((c) => c.id), other: board.other.map((c) => c.id) },
  };
}

// sessions without the team: only count, time and tokens (session + its subagents), so they do not vanish
function looseSummary(list, looseRuns, now, activeWindowMs) {
  const tok = sumTok([...list.map((s) => ({ usage: s.main.usage })), ...looseRuns]);
  return {
    count: list.length, durationMs: list.reduce((a, s) => a + s.main.workMs, 0), tokenSplit: tok, subagentRuns: looseRuns.length,
    active: list.filter((s) => s.live || now - s.main.mtime < activeWindowMs).length,
    recent: list.slice().sort((a, b) => (b.main.end || 0) - (a.main.end || 0)).slice(0, 5)
      .map((s) => ({ sessionId: s.sessionId, name: s.name, start: s.main.start, end: s.main.end, durationMs: s.main.workMs, live: s.live })),
  };
}

// 'no signal' of a recent delegation (up to 24 h) stays in "now"; the rest goes to history
const isStaleListed = (r) => r.status === 'no signal' && r.delegated && r.silentMs < STALE_LIST_MS;
function countStates(runs) {
  const out = { running: 0, 'no signal': 0, finished: 0, failed: 0, interrupted: 0 };
  for (const r of runs) out[r.status] = (out[r.status] || 0) + 1;
  return out;
}

function buildRun({ call, res, sub, session, hooks, changeIds, now, activeWindowMs }) {
  const input = call ? call.input : {};
  const agentId = (sub && sub.agentId) || (res && res.agentId) || (call && `call:${call.toolUseId}`);
  const hook = hooks.get(agentId) || {};
  const agent = input.subagent_type || hook.type || (sub && sub.agentName) || (call ? 'general-purpose' : 'unknown');
  const prompt = input.prompt || (sub && sub.prompt) || '';
  const notif = session.notifications.get(agentId);
  const start = [call && call.ts, hook.start, sub && sub.start].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)[0] || null;
  // a background agent's result already carries the agentId at launch (async_launched): it is not the end
  const resDone = !!(res && res.agentId && !res.launched);
  const ended = resDone || notif || Number.isFinite(hook.stop);
  // background: the call's immediate result does not mark the end; the real end is in the
  // SubagentStop (if any), otherwise in the subagent transcript's last record, otherwise in the notification
  const bg = !!input.run_in_background || !!(res && res.launched);
  const subEnd = sub && Number.isFinite(sub.end) ? sub.end : null;
  const lastSeen = Math.max(sub ? sub.mtime : 0, subEnd || 0, start || 0);
  // running = transcript activity within the window (--stale-min); no end and no activity = no signal
  const interrupted = !!(sub && sub.interrupted) && !ended;
  const active = !ended && !interrupted && (now - lastSeen) < activeWindowMs;
  let end = null;
  if (ended) {
    if (bg) end = (Number.isFinite(hook.stop) ? hook.stop : null) || subEnd || (notif && notif.ts) || null;
    else end = (resDone && res.ts) || (notif && notif.ts) || (Number.isFinite(hook.stop) ? hook.stop : null);
  }
  if (!end && !active) end = subEnd || lastSeen || start;
  // totalDurationMs only counts if positive and consistent with the known timestamps
  const total = res && num(res.totalDurationMs) > 0 ? res.totalDurationMs : 0;
  const span = Math.max(0, (end || 0) - (start || 0));
  const coherent = total > 0 && (!span || Math.abs(total - span) <= Math.max(5000, span * 0.25));
  const durationMs = active ? Math.max(0, now - (start || now)) : (coherent ? total : span);
  const usage = (sub && sub.usage.requests > 0) ? sub.usage : (res && res.usage) || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, requests: 0 };
  const model = shortModel(input.model === 'inherit' ? null : input.model) || shortModel(sub && sub.model) || null;
  // the stop event only proves it ended, not that it succeeded
  let status = active ? 'running' : interrupted ? 'interrupted' : (ended ? 'finished' : 'no signal');
  const failedRe = /fail|error|erro/i, killedRe = /kill|stop|cancel|interrupt/i;
  if ((notif && notif.status && failedRe.test(notif.status)) || (res && res.status && failedRe.test(res.status))) status = 'failed';
  else if (notif && notif.status && killedRe.test(notif.status)) status = 'interrupted';
  return {
    id: agentId, sessionId: session.sessionId, sessionName: session.name, silentMs: active || ended ? 0 : Math.max(0, now - lastSeen), agent, change: attributeChange(prompt, changeIds),
    description: input.description || (sub && sub.summary ? sub.summary.split('\n')[0].slice(0, 120) : ''),
    background: !!input.run_in_background, model, models: sub ? sub.models.map(shortModel) : [],
    stage: inferStage(agent, input.description, prompt), lastActivity: lastSeen || end || start,
    start, end, durationMs, active, status, usage, tokenSplit: withSplit(addTok(zeroTok(), usage)), toolUses: sub ? sub.toolUses : 0,
    totalTokensReported: res ? res.totalTokens : null, summary: sub ? sub.summary : '',
    promptPreview: prompt.slice(0, 400), linked: !!(sub && call), delegated: !!call,
  };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const projectDir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--claude-dir') || process.cwd();
  const state = collect({ projectDir, claudeDir: opt('--claude-dir', undefined), staleMin: Number(opt('--stale-min', DEFAULT_STALE_MIN)) });
  if (args.includes('--json')) { console.log(JSON.stringify(state, null, 2)); }
  else {
    const fmt = (ms) => `${Math.round(ms / 60000)}min`;
    console.log(`${state.project.name}: ${state.totals.changes} changes, ${state.totals.runs} runs, ${state.totals.tokens} tokens, ${fmt(state.totals.durationMs)}`);
    for (const c of state.changes) console.log(`  [${c.status}] ${c.id}  tasks ${c.tasks.done}/${c.tasks.total}  runs ${c.rounds}  handoffs ${c.handoffs}  ${fmt(c.durationMs)}  ${c.tokens} tok  active: ${c.activeAgents.map((a) => a.agent).join(', ') || '-'}`);
    console.log('effort per agent:');
    for (const a of state.agents) console.log(`  ${a.agent.padEnd(16)} ${String(a.runs).padStart(3)} runs  ${fmt(a.durationMs).padStart(8)}  ${String(a.tokens).padStart(9)} tok  ${a.models.join(',')}`);
    if (state.unlinked.length) console.log(`(${state.unlinked.length} runs without a visible call in the main session)`);
  }
}
