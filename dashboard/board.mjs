// ai-team — change board rules (pure, no dependencies).
//
//   parseTasks      tasks.md → header, tasks (id, section, depends on)
//   waitingFor      "waiting for what", by heuristic, always with the rule that fired
//   splitChanges    in progress / blocked / pending / latest done
//   inferStage      stage of an agent run, from the prompt and the description
//   inferTask       task cited in the prompt ({id, section}) or null
//   flowOf          trail stage of a run (spec ... integration)
//   changeFiles     list of a change's .md files
//   resolveChangeFile  safe path (no path traversal) of a change's .md
import fs from 'node:fs';
import path from 'node:path';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const TASK_ID = /^\d+\.\d+[a-z]?$/i;
export const CHANGE_ID = /^[a-z0-9][a-z0-9._-]*$/i;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// tasks.md
// ---------------------------------------------------------------------------
// deps: { ids: ['1.2'], unknown: false }. "—" or absence = no dependency;
// any item that is not a task id (e.g. another change) marks unknown.
export function parseDeps(line) {
  const m = line.match(/<!--\s*depends on:\s*([^>]*?)\s*-->/i);
  if (!m) return { ids: [], unknown: false };
  const raw = m[1].trim();
  if (!raw || /^[—–-]+$/.test(raw)) return { ids: [], unknown: false };
  const ids = []; let unknown = false;
  for (const part of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (TASK_ID.test(part)) ids.push(part); else unknown = true;
  }
  return { ids, unknown };
}

export function parseTasks(text) {
  const lines = String(text || '').split('\n');
  const headerLines = [];
  const tasks = [];
  let section = null, seenSection = false;
  for (const line of lines) {
    const h = line.match(/^##\s*(\d)\.\s*(.+)/);
    if (h) { section = norm(h[2]); seenSection = true; continue; }
    if (/^##\s/.test(line)) seenSection = true;
    if (!seenSection) headerLines.push(line);
    const t = line.match(/^\s*[-*]\s*\[( |x|X)\]\s*(?:(\d+\.\d+[a-z]?)\b)?/);
    if (!t) continue;
    tasks.push({ id: t[2] || null, done: t[1] !== ' ', section, blocked: /\bblocked\b/i.test(line), deps: parseDeps(line),
      text: norm(line.replace(/<!--.*?-->/g, '').replace(/^\s*[-*]\s*\[.\]\s*/, '')).slice(0, 140) });
  }
  return { header: headerLines.join('\n'), tasks };
}

// ---------------------------------------------------------------------------
// "waiting for what"
// ---------------------------------------------------------------------------
const HEADER_WAIT = /awaiting\s+(?:the\s+|your\s+)?approval|DRAFT|awaiting\s+(?:the\s+)?reading/i;

const HEADER_APPROVED = /approved\s+(by the developer|by delegation)/i;

// Only state lines count. With an approval line, nothing counts. Without it, any quote
// line ("> ") of the header whose start (after ">", spaces and "*") is a state word
// (draft, awaiting, State:; a leading "proposal" is accepted) counts, as does a bare
// "State:" line or a bold quote. Descriptive text mid-sentence ("... only creates
// drafts ...") does not count.
const STATE_START = /^(?:proposal\s+)?(?:draft|awaiting|state\s*:)/i;
function headerStateLines(header) {
  if (!header) return '';
  const lines = header.split('\n');
  if (lines.some((l) => HEADER_APPROVED.test(l))) return '';
  return lines.filter((l) => {
    if (/^\s*State:/i.test(l)) return true;
    const q = l.match(/^\s*>\s*(.*)$/);
    if (!q) return false;
    return /^\s*>\s*\*\*/.test(l) || STATE_START.test(q[1].replace(/^[\s*]+/, ''));
  }).join('\n');
}

// change: { archived, header, taskList, review, validation }
// → { text, rule }   (text 'undefined' when no rule decides)
export function waitingFor(change) {
  const tasks = change.taskList || [];
  const review = change.review || null;
  if (change.archived) return { text: 'nothing (archived)', rule: 'the change is in openspec/changes/archive' };
  const stateText = headerStateLines(change.header);
  if (stateText && HEADER_WAIT.test(stateText)) {
    const m = stateText.match(HEADER_WAIT);
    return { text: 'waiting for the developer', rule: `the tasks.md header says "${norm(m[0])}"` };
  }
  if (review && /CHANGES REQUESTED/i.test(review)) {
    return { text: 'waiting for fix', rule: 'the last round of review-report.md is CHANGES REQUESTED' };
  }
  if (!tasks.length) return { text: 'undefined', rule: 'no tasks.md or no tasks with a checkbox' };
  const open = tasks.filter((t) => !t.done);
  if (!open.length) {
    if (!review) return { text: 'waiting for review', rule: 'all tasks are [x] and there is no review-report.md' };
    if (/APPROVED/i.test(review) && !/NOT APPROVED|CHANGES/i.test(review)) {
      return { text: 'undefined', rule: 'tasks [x] and review APPROVED; tasks.md does not say whether validation or archiving is left' };
    }
    return { text: 'undefined', rule: `tasks [x], but the review result ("${review}") is not recognized` };
  }
  const doneIds = new Set(tasks.filter((t) => t.done && t.id).map((t) => t.id));
  const known = new Set(tasks.filter((t) => t.id).map((t) => t.id));
  const unmet = (t) => t.deps.ids.filter((d) => !doneIds.has(d));
  // 1st open task with its dependencies met (and no unreadable dependency)
  const ready = open.find((t) => !t.deps.unknown && !unmet(t).length && t.deps.ids.every((d) => known.has(d)));
  if (ready) {
    if (ready.blocked) return { text: 'undefined', rule: `task ${ready.id || '?'} is marked as blocked in tasks.md` };
    return { text: `waiting to run task ${ready.id || '(unnumbered)'}${ready.section ? ` (${ready.section.replace(/\s*\(.*$/, '')})` : ''}`,
      rule: 'first [ ] task whose dependencies ("depends on") are all [x]' };
  }
  const first = open[0];
  if (first.deps.unknown || first.deps.ids.some((d) => !known.has(d))) {
    return { text: 'undefined', rule: `the "depends on" of task ${first.id || '?'} cites something that is not a task of this change` };
  }
  const u = unmet(first);
  return { text: `waiting for task ${u.join(', ')}`, rule: `no [ ] task is unblocked; ${first.id || '?'} depends on ${u.join(', ')}, not [x] yet` };
}

// ---------------------------------------------------------------------------
// board split
// ---------------------------------------------------------------------------
// changes: collector views ({status, completedAt|lastActivity, id}).
export function splitChanges(changes, recentCount = 3) {
  const when = (c) => c.completedAt || c.lastActivity || 0;
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  const doneAll = changes.filter((c) => c.status === 'done').sort((a, b) => (when(b) - when(a)) || byId(a, b));
  const order = (a, b) => ((b.lastActivity || 0) - (a.lastActivity || 0)) || byId(a, b);
  return {
    stuck: changes.filter((c) => c.status === 'stuck').sort(order),
    running: changes.filter((c) => c.status === 'in progress').sort(order),
    blocked: changes.filter((c) => c.status === 'blocked').sort(order),
    pending: changes.filter((c) => c.status === 'pending').sort(order),
    done: doneAll.slice(0, recentCount),
    doneOlder: doneAll.slice(recentCount),
    other: changes.filter((c) => c.status === 'ad-hoc'),
    removed: changes.filter((c) => c.status === 'removed').sort(order),
  };
}

// ---------------------------------------------------------------------------
// stage of a run (prompt/description); null when nothing decides
// ---------------------------------------------------------------------------
// the description first (it wins), then the prompt: orchestrators front-load context, and the task
// cited often comes after the first few hundred characters
const PROMPT_SCAN = 4000;
export function inferStage(agent, description, prompt) {
  const t = `${description || ''}\n${String(prompt || '').slice(0, PROMPT_SCAN)}`;
  let m = t.match(/\btasks?\s+(\d+\.\d+[a-z]?(?:\s*(?:to|–|-|and)\s*\d+\.\d+[a-z]?)?)/i);
  if (m) return `task ${norm(m[1])}`;
  const secs = [...t.matchAll(/\bsection\s+(\d)\b\.?[ \t]*(Infra|Backend|Frontend|Validation)?/gi)];
  if (secs.length) { const q = secs.find((x) => x[2]) || secs[0]; return `section ${q[1]}${q[2] ? ` (${q[2]})` : ''}`; }
  if (agent === 'reviewer' || /\breview\b|\bR\d+\b.*\breview/i.test(t)) return 'review';
  if (agent === 'validator') return 'validation';
  if (/\barchiv(?:e|ing)\b/i.test(t)) return 'archived';
  if (/\bproposal\b|\bcreate the change\b/i.test(t)) return 'spec';
  if (/\bgate\b/i.test(t)) return 'gate';
  return null;
}


// ---------------------------------------------------------------------------
// task cited in a run: { id, section } or null. Only "section N" => id null.
// ---------------------------------------------------------------------------
const SECTION_BY_DIGIT = { 0: 'Infra', 1: 'Backend', 2: 'Frontend', 3: 'Validation' };
const baseSection = (s) => (s ? norm(String(s).replace(/\s*\(.*$/, '')) : null);
export function inferTask(description, prompt, taskList = []) {
  const t = `${description || ''}\n${String(prompt || '').slice(0, PROMPT_SCAN)}`;
  const m = t.match(/\btasks?\s+(\d+\.\d+[a-z]?)/i);
  if (m) {
    const id = m[1];
    const hit = (taskList || []).find((x) => x.id && x.id.toLowerCase() === id.toLowerCase());
    return { id, section: baseSection(hit && hit.section) || SECTION_BY_DIGIT[id.split('.')[0]] || null };
  }
  const secs = [...t.matchAll(/\bsection\s+(\d)\b\.?[ \t]*(Infra|Backend|Frontend|Validation)?/gi)];
  if (secs.length) {
    const q = secs.find((x) => x[2]) || secs[0];
    return { id: null, section: q[2] || SECTION_BY_DIGIT[q[1]] || null };
  }
  return null;
}

// every task a run cites: "task 2.3", "tasks 2.1–2.7" (a range counts for each task in it, in tasks.md
// order), "tasks 1.1, 1.2 and 1.4". Only ids that tasks.md knows, unless tasks.md is empty or unread.
const TID = String.raw`\d+\.\d+[a-z]?`;
const CITE = new RegExp(String.raw`\btasks?\s+(${TID}(?:\s*(?:[-–—]|to|,|and|e|&|\/)\s*${TID})*)`, 'gi');
export function citedTasks(description, prompt, taskList = []) {
  const t = `${description || ''}\n${String(prompt || '').slice(0, PROMPT_SCAN)}`;
  const known = (taskList || []).map((x) => x.id).filter(Boolean);
  const idx = new Map(known.map((id, i) => [id.toLowerCase(), i]));
  const out = [];
  const add = (id) => { const k = id.toLowerCase(); if ((!known.length || idx.has(k)) && !out.some((x) => x.toLowerCase() === k)) out.push(known.length ? known[idx.get(k)] : id); };
  for (const m of t.matchAll(CITE)) {
    const parts = m[1].split(/\s*(,|and|e|&|\/)\s*/i).filter((x) => x && !/^(,|and|e|&|\/)$/i.test(x));
    for (const part of parts) {
      const r = part.match(new RegExp(String.raw`^(${TID})\s*(?:[-–—]|to)\s*(${TID})$`, 'i'));
      if (!r) { add(part.trim()); continue; }
      const [a, b] = [r[1], r[2]];
      if (idx.has(a.toLowerCase()) && idx.has(b.toLowerCase())) { const i = idx.get(a.toLowerCase()), j = idx.get(b.toLowerCase()); for (let k = Math.min(i, j); k <= Math.max(i, j); k++) add(known[k]); }
      else {   // tasks.md not read: numeric range inside one section (2.1–2.4)
        const [ma, na] = a.split('.'), [mb, nb] = b.split('.');
        if (ma === mb && /^\d+$/.test(na) && /^\d+$/.test(nb) && Number(nb) - Number(na) < 50) for (let k = Number(na); k <= Number(nb); k++) add(`${ma}.${k}`); else { add(a); add(b); }
      }
    }
  }
  // "implement 2.8", "fix **2.3**", "validate 3.1": a verb before a bare id, only for ids tasks.md knows
  if (known.length) for (const m of t.matchAll(new RegExp(String.raw`\b(?:implement|fix|validate|review|redo|finish)\s+(?:\*\*)?(${TID})\b`, 'gi'))) add(m[1]);
  // "Validate free-drag round 4 (2.9)", "(2.8, 2.9)", "(2.1–2.3)": ids in parentheses, only ids tasks.md knows
  if (known.length) for (const m of t.matchAll(new RegExp(String.raw`\((${TID}(?:\s*(?:[-–—]|,|and|e|&|\/)\s*${TID})*)\)`, 'gi'))) {
    for (const part of m[1].split(/\s*(?:,|and|e|&|\/)\s*/i)) {
      const r = part.match(new RegExp(String.raw`^(${TID})\s*[-–—]\s*(${TID})$`));
      if (r && idx.has(r[1].toLowerCase()) && idx.has(r[2].toLowerCase())) { const i = idx.get(r[1].toLowerCase()), j = idx.get(r[2].toLowerCase()); for (let k = Math.min(i, j); k <= Math.max(i, j); k++) add(known[k]); }
      else add(part.trim());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// trail stage of a run: spec | build | review | fix | validation | integration | null
// run: { agent, stage, description, promptPreview, taskSection }; ctx: { mainAgent, afterReview }
// ---------------------------------------------------------------------------
const NOT_TEAM = new Set(['general-purpose', 'Explore', 'Plan', 'statusline-setup', 'claude-code-guide', 'unknown']);
// "fix" as a word: not fixtures, not a change id or branch like fix-brand-x / pas-fix-its, not a path
const FIX_WORDS = /\bfix(?:es|ed|ing)?\b|changes? requested|\bblocking\b|\bfindings?\b/i;
const fixText = (s) => String(s || '').replace(/`[^`]*`/g, ' ').replace(/\S*\/\S*/g, ' ').replace(/\S*-fix\S*|\S*fix-\S*/gi, ' ');
export function flowOf(run, ctx = {}) {
  const a = run.agent;
  if (a === 'reviewer') return 'review';
  if (a === 'validator') return 'validation';
  if (run.stage === 'archived') return 'integration';
  if (a === 'orchestrator' || (ctx.mainAgent && a === ctx.mainAgent)) return 'integration';
  if (a === 'spec-writer') return /^(Process|Documentation)/i.test(run.taskSection || '') ? 'integration' : 'spec';
  if (NOT_TEAM.has(a)) return null;
  if (ctx.afterReview && FIX_WORDS.test(fixText(`${run.description || ''}\n${String(run.promptPreview || '').slice(0, 400)}`))) return 'fix';
  return 'build';
}

// ---------------------------------------------------------------------------
// a change's .md files
// ---------------------------------------------------------------------------
const FIRST = ['proposal.md', 'design.md', 'tasks.md', 'review-report.md', 'validation-report.md'];

export function changeFiles(dir) {
  const out = [];
  let top = [];
  try { top = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of top) if (e.isFile() && e.name.endsWith('.md')) out.push(e.name);
  out.sort((a, b) => {
    const ia = FIRST.indexOf(a), ib = FIRST.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1);
  });
  const walk = (rel, depth) => {
    if (depth > 6) return;
    let es = [];
    try { es = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    es.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of es) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r, depth + 1);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(r);
    }
  };
  walk('specs', 0);
  return out;
}

// change folder: openspec/changes/<id> or the latest in archive/<date>-<id>
export function changeDir(projectDir, id) {
  if (!CHANGE_ID.test(id) || id === 'archive') return null;
  const base = path.join(projectDir, 'openspec', 'changes');
  const live = path.join(base, id);
  try { if (fs.statSync(live).isDirectory()) return live; } catch { /* try the archive */ }
  try {
    const names = fs.readdirSync(path.join(base, 'archive')).filter((n) => n.replace(/^\d{4}-\d{2}-\d{2}-/, '') === id && /^\d{4}-/.test(n)).sort();
    if (names.length) return path.join(base, 'archive', names[names.length - 1]);
  } catch { /* no archive */ }
  return null;
}

// segments already decoded (['specs','x','spec.md']). Returns the real path
// of the file or null. Rejects traversal, separators, leading dots, non-.md,
// symlinks that leave the change folder and anything that is not a regular file.
export function resolveChangeFile(projectDir, id, segments) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 8) return null;
  for (const s of segments) if (typeof s !== 'string' || !SEGMENT.test(s) || s === '..') return null;
  if (!segments[segments.length - 1].endsWith('.md')) return null;
  const dir = changeDir(projectDir, id);
  if (!dir) return null;
  if (segments.length > 1 && segments[0] !== 'specs') return null;
  const file = path.join(dir, ...segments);
  try {
    const realDir = fs.realpathSync(dir), real = fs.realpathSync(file);
    if (!real.startsWith(realDir + path.sep) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

// '/changes/<id>/<file...>' → { id, segments } or null (invalid percent-encoding included)
export function parseChangePath(pathname) {
  const m = /^\/changes\/([^/]+)\/(.+)$/.exec(pathname);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]);
    const segments = m[2].split('/').map((s) => decodeURIComponent(s));
    return { id, segments };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// declared state (tasks.md header line)
// ---------------------------------------------------------------------------
//   <!-- state: <stage> · waiting: <who> · since: <yyyy-mm-ddThh:mmZ> · note: <optional text> -->
export const DECLARED_STAGES = ['spec', 'approval', 'build', 'review', 'fix', 'validation', 'integration', 'archived'];
export const DECLARED_WHO = ['developer', 'orchestrator', 'spec-writer', 'provisioner', 'builder', 'integrator', 'reviewer', 'validator', 'queue'];
const DECLARED_LINE = /<!--\s*state\s*:([\s\S]*?)-->/i;

// header: header text (before the first section). → null (no line) | { valid:true, stage, waiting, since, note }
// | { valid:false, reason }
export function parseDeclaredState(header) {
  const m = DECLARED_LINE.exec(String(header || ''));
  if (!m) return null;
  const bad = (reason) => ({ valid: false, reason });
  let body = 'state:' + m[1];
  let note = null;
  const nm = /\s+·\s+note\s*:([\s\S]*)$/i.exec(body);     // the note is the last field and may contain " · "
  if (nm) { note = nm[1].trim(); body = body.slice(0, nm.index); }
  const parts = body.trim().split(/\s+·\s+/);
  const kv = {};
  for (const p of parts) {
    const i = p.indexOf(':');
    const k = i < 0 ? '' : p.slice(0, i).trim().toLowerCase();
    if (!k) return bad(`fragment without "key:" ("${norm(p).slice(0, 30)}")`);
    if (k in kv) return bad(`field "${k}" repeated`);
    kv[k] = p.slice(i + 1).trim();
  }
  if (note !== null) kv.note = note;
  for (const k of Object.keys(kv)) if (!['state', 'waiting', 'since', 'note'].includes(k)) return bad(`unknown field "${k}"`);
  for (const k of ['state', 'waiting', 'since']) if (!kv[k]) return bad(`missing field "${k}"`);
  if (!DECLARED_STAGES.includes(kv.state)) return bad(`stage "${kv.state}" not in the list`);
  if (!DECLARED_WHO.includes(kv.waiting)) return bad(`waiting "${kv.waiting}" not in the list`);
  const dm = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})Z$/.exec(kv.since);
  const since = dm ? Date.parse(kv.since.replace('Z', ':00Z')) : NaN;
  if (!Number.isFinite(since) || new Date(since).toISOString().slice(0, 16) + 'Z' !== kv.since) return bad(`date "${kv.since}" invalid (use yyyy-mm-ddThh:mmZ)`);
  return { valid: true, stage: kv.state, waiting: kv.waiting, since, sinceIso: kv.since, note: kv.note || '' };
}

// ---------------------------------------------------------------------------
// review findings (review-report.md) with their task and status
// ---------------------------------------------------------------------------
// A finding line: "- R<k> · <file>:<line> · category: … · severity: … · owner: … · commit <sha>[ · task <id>]",
// then the problem and "Fix: …". Its task: the one the reviewer wrote; else the task whose own
// `<!-- commits: … -->` marker (right under the task line) lists the commit. Its status: applied (an
// `<!-- applied: R<k> … -->` marker in tasks.md or the report), verified (a later round "verification of R<k>"
// came back APPROVED), backlog (its severity), else open; an archived change has none open.
const FINDING = /^-\s+(R\d+)\s+·\s+(.+?)(?::(\d+(?:\s*[-–]\s*\d+)?))?\s+·\s+category:\s*([^·]+?)\s+·\s+severity:\s*([^·]+?)\s+·\s+owner:\s*([^·]+?)\s+·\s+commit\s+([0-9a-f]{6,40})(?:\s+·\s+task\s+([0-9]+\.[0-9]+[a-z]?|—|-))?\s*$/i;
export function commitTasks(tasksText) {
  const map = new Map();
  let task = null, gap = false;
  for (const line of String(tasksText || '').split('\n')) {
    const t = /^\s*[-*]\s*\[[ xX]\]\s*(\d+\.\d+[a-z]?)\b/.exec(line);
    if (t) { task = t[1]; gap = false; continue; }
    if (/^\s*$/.test(line)) { gap = true; continue; }
    if (/^#/.test(line)) { task = null; continue; }
    const c = /<!--\s*commits:\s*([^>]*?)-->/.exec(line);
    if (c && task && !gap) for (const sha of c[1].split(/\s+/).filter((x) => /^[0-9a-f]{6,40}$/i.test(x))) if (!map.has(sha)) map.set(sha, task);
  }
  return map;
}
export function appliedIds(...texts) {
  const out = new Set();
  for (const tx of texts) for (const m of String(tx || '').matchAll(/<!--\s*applied:\s*([^>]*?)-->/g)) for (const id of m[1].match(/\bR\d+\b/g) || []) out.add(id);
  return out;
}
export function parseFindings(reportText, { tasksText = '', archived = false } = {}) {
  const lines = String(reportText || '').split('\n');
  const byCommit = commitTasks(tasksText), applied = appliedIds(tasksText, reportText);
  const findings = [], verified = new Set();
  let round = 0, verifies = [], cur = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /^##\s+Round\s+(\d+)(?:\s*\(([^)]*)\))?/i.exec(line);
    if (h) { round = Number(h[1]); verifies = /verification/i.test(h[2] || '') ? (h[2].match(/\bR\d+\b/g) || []) : []; cur = null; continue; }
    const res = /^Result:\s*(.+)$/.exec(line);
    if (res && verifies.length && /APPROVED/i.test(res[1])) for (const id of verifies) verified.add(id);
    const f = FINDING.exec(line.trim());
    if (f) {
      const cited = f[8] && /^\d/.test(f[8]) ? f[8] : null, viaCommit = !cited ? byCommit.get(f[7]) || [...byCommit.keys()].filter((k) => k.startsWith(f[7]) || f[7].startsWith(k)).map((k) => byCommit.get(k))[0] || null : null;
      cur = { id: f[1], round, file: f[2].trim(), line: f[3] ? f[3].replace(/\s+/g, '') : null, category: f[4].trim(), severity: f[5].trim().toLowerCase(), owner: f[6].trim(), commit: f[7],
        task: cited || viaCommit, taskSource: cited ? 'cited' : viaCommit ? 'commit' : null, problem: '', fix: '' };
      findings.push(cur); continue;
    }
    if (cur && /^\s{2,}\S/.test(line)) {
      const tx = line.trim();
      if (/^Fix:/i.test(tx)) cur.fix = tx.replace(/^Fix:\s*/i, '').slice(0, 400);
      else if (!/^Reuse:/i.test(tx) && !cur.problem) cur.problem = tx.slice(0, 400);
    } else if (cur && line.trim() && !/^\s/.test(line)) cur = null;
  }
  for (const f of findings) f.status = applied.has(f.id) ? 'applied' : verified.has(f.id) ? 'verified' : /backlog/.test(f.severity) ? 'backlog' : archived ? 'archived' : 'open';
  return findings;
}
