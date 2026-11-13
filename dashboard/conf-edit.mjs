// ai-team — editing .claude/ai-team.conf from the dashboard (Settings › This project). Server side only.
//
// Which keys: the safe ones (names, language, branches, docs paths, budgets, personas, hub team), each with its own
// check. The gate commands (*_CMD_*) are run by the agents, so they never change from a browser; the detected keys
// (HAS_*, LAYOUT) and the conf version are not edited at all.
// How: the clone's install.sh does the work, as `install.sh --render --set K=V` would from a terminal: --dry-run for
// the preview (which derived files would change, which are hand-edited and kept), then the real run. It runs with
// execFile (an argument list, no shell: a value never becomes a command) and asynchronously. Before writing, the conf
// goes to .claude/ai-team/conf-history/ (the last 10; that folder stays out of git), and undo puts the newest back.
// Where: only where the clone is next to the dashboard (the hub, or a server started from the clone); an installed
// copy (.claude/dashboard) has no install.sh and says so.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const installerPath = () => path.join(here, '..', 'install.sh');
export const canEdit = () => fs.existsSync(installerPath()) && fs.existsSync(path.join(here, '..', 'lib', 'render.sh'));

const BRANCH_RE = /^(?!\/|.*(?:\/\/|\.\.|@\{|\.lock$|\/$|\.$))[A-Za-z0-9._/-]{1,100}$/;   // git check-ref-format, the usual cases
const line = (max) => (v) => (/[\r\n\t]/.test(v) ? 'one line, no tabs' : v.length > max ? `at most ${max} characters` : null);
const branch = (v) => (v === '' || BRANCH_RE.test(v) ? null : 'not a valid branch name');
const branches = (v) => (v.split(/\s+/).filter(Boolean).every((b) => BRANCH_RE.test(b)) ? null : 'branch names separated by spaces');
const docPath = (v) => v.split(/\s+/).filter(Boolean).every((p) => !p.startsWith('/') && !p.split('/').includes('..') && /^[\w./-]+$/.test(p)) ? null : 'paths inside the project (relative, no ..), separated by spaces';
const usd = (v) => (v === '' || (/^\d+(\.\d{1,2})?$/.test(v) && Number(v) > 0) ? null : 'an amount in USD (e.g. 15 or 7.50), or empty');

// key → { label, group, check(value) → error | null }
export const EDITABLE = {
  PROJECT_NAME: { label: 'Project name', group: 'Project', check: (v) => (v.trim() ? line(80)(v) : 'required') },
  PROJECT_DESCRIPTION: { label: 'Description', group: 'Project', check: line(300) },
  OUTPUT_LANGUAGE: { label: 'Output language', group: 'Project', check: (v) => (/^[a-z]{2,3}(-[A-Z]{2})?$/.test(v) ? null : 'a language tag such as en or pt-BR') },
  HUB_TEAM: { label: 'Hub team', group: 'Project', check: (v) => (v === '' || /^[a-z0-9][a-z0-9-]{0,40}$/.test(v) ? null : 'lowercase letters, digits and dashes') },
  TEST_PERSONAS: { label: 'Test personas', group: 'Project', check: line(300) },
  GIT_DEFAULT_BRANCH: { label: 'Default branch', group: 'Branches', check: branch },
  GIT_WORK_BRANCH: { label: 'Work branch', group: 'Branches', check: branch },
  GIT_PROTECTED_BRANCHES: { label: 'Protected branches', group: 'Branches', check: branches },
  BACKEND_BRANCH: { label: 'Backend branch', group: 'Branches', check: branch },
  BACKEND_DEFAULT_BRANCH: { label: 'Backend default branch', group: 'Branches', check: branch },
  BACKEND_PROTECTED_BRANCH: { label: 'Backend protected branch', group: 'Branches', check: branch },
  FRONTEND_BRANCH: { label: 'Frontend branch', group: 'Branches', check: branch },
  FRONTEND_DEFAULT_BRANCH: { label: 'Frontend default branch', group: 'Branches', check: branch },
  FRONTEND_PROTECTED_BRANCH: { label: 'Frontend protected branch', group: 'Branches', check: branch },
  DOCS_CONTEXT: { label: 'Context docs', group: 'Docs', check: docPath },
  DOCS_STANDARDS: { label: 'Standards docs', group: 'Docs', check: docPath },
  DOCS_ENV: { label: 'Environment docs', group: 'Docs', check: docPath },
  DOCS_ARCH: { label: 'Architecture docs', group: 'Docs', check: docPath },
  DOCS_LESSONS: { label: 'Lessons file', group: 'Docs', check: docPath },
  BUDGET_SMALL_USD: { label: 'Budget, small change (USD)', group: 'Budgets', check: usd },
  BUDGET_LARGE_USD: { label: 'Budget, large change (USD)', group: 'Budgets', check: usd },
};

// { KEY: value } from the page → { changes } (only editable keys, strings, checked) or { errors: { KEY: message } }
export function checkChanges(input) {
  const errors = {}, changes = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { errors: { _: 'expected { KEY: value }' } };
  const keys = Object.keys(input);
  if (!keys.length) return { errors: { _: 'nothing to change' } };
  if (keys.length > 20) return { errors: { _: 'too many keys at once' } };
  for (const k of keys) {
    const def = EDITABLE[k];
    if (!def) { errors[k] = /_CMD_/.test(k) ? 'gate commands are run by the agents: change them from a terminal (copy --set)' : 'not editable here'; continue; }
    if (typeof input[k] !== 'string') { errors[k] = 'expected text'; continue; }
    const v = input[k].trim();
    if (v.includes("'")) { errors[k] = 'no single quotes'; continue; }   // the conf is KEY='value'
    const e = def.check(v); if (e) errors[k] = e; else changes[k] = v;
  }
  return Object.keys(errors).length ? { errors } : { changes };
}

// what the page shows: the editable keys with their value in the conf (empty when absent) and whether it can save
export function confView(conf) {
  return {
    canEdit: canEdit(),
    reason: canEdit() ? null : 'This dashboard is an installed copy (no install.sh next to it): open the project through the hub to edit, or use the copied --set command.',
    keys: Object.entries(EDITABLE).map(([key, d]) => ({ key, label: d.label, group: d.group, value: conf[key] ?? '' })),
    // shown, never edited: it says where the files are, so changing it means moving them (install.sh --openspec-move)
    openspecHome: conf.OPENSPEC_HOME || '',
  };
}

const strip = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');   // the installer's colors
// the installer's report → the files it would change / changed / kept because they were edited by hand
export function parseRender(out) {
  const changed = new Set(), handEdited = [];
  for (const l of strip(out).split('\n')) {
    let m;
    if ((m = /^\s*~ (\S+)/.exec(l))) changed.add(m[1]);
    else if ((m = /^\s*\+ (ai-team\.conf)\b/.exec(l))) changed.add(m[1]);
    else if ((m = /updated (\S+)/.exec(l)) && /^\s*✓/.test(l)) changed.add(m[1]);
    else if ((m = /wrote (ai-team\.conf)/.exec(l))) changed.add(m[1]);
    else if ((m = /exists\s+(\S+) \(hand-edited/.exec(l))) handEdited.push(m[1]);
  }
  return { changed: [...changed], handEdited };
}

function runInstaller(projectDir, args, { timeout = 120e3, env = {} } = {}) {
  return new Promise((resolve) => {
    execFile('bash', [installerPath(), '--render', '--yes', ...args, projectDir], { timeout, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...env } },
      (err, stdout, stderr) => resolve({ ok: !err, code: err ? err.code : 0, out: `${stdout}${stderr}` }));
  });
}
const setArgs = (changes) => Object.entries(changes).flatMap(([k, v]) => ['--set', `${k}=${v}`]);

const busy = new Set();   // one write per project at a time
const historyDir = (projectDir) => path.join(projectDir, '.claude', 'ai-team', 'conf-history');
const confFile = (projectDir) => path.join(projectDir, '.claude', 'ai-team.conf');
const KEEP = 10;

// the derived files a change would rewrite, without writing anything
export async function previewChanges(projectDir, input, opts = {}) {
  if (!canEdit()) return { error: confView({}).reason, code: 409 };
  const c = checkChanges(input); if (c.errors) return { errors: c.errors, code: 400 };
  const r = await runInstaller(projectDir, ['--dry-run', ...setArgs(c.changes)], opts);
  if (!r.ok) return { error: `install.sh --dry-run failed: ${strip(r.out).trim().split('\n').slice(-3).join(' · ')}`, code: 500 };
  const p = parseRender(r.out);
  // the dry run does not list project-context.md, which the render rewrites from the conf too (its notes are kept)
  const changed = [...new Set([...p.changed, 'project-context.md'])];
  return { ok: true, changes: c.changes, changed, handEdited: p.handEdited };
}

// writes: backup, render with --set, report; { ok, changed, handEdited, backup } or { error }
export async function applyChanges(projectDir, input, opts = {}) {
  if (!canEdit()) return { error: confView({}).reason, code: 409 };
  const c = checkChanges(input); if (c.errors) return { errors: c.errors, code: 400 };
  if (busy.has(projectDir)) return { error: 'another change is being saved', code: 409 };
  busy.add(projectDir);
  try {
    const backup = keepCopy(projectDir);
    const r = await runInstaller(projectDir, setArgs(c.changes), opts);
    if (!r.ok) {   // the conf as it was before
      if (backup) { try { fs.copyFileSync(backup, confFile(projectDir)); } catch { /* keep the error below */ } }
      return { error: `install.sh --render failed: ${strip(r.out).trim().split('\n').slice(-3).join(' · ')}`, code: 500 };
    }
    return { ok: true, changes: c.changes, ...parseRender(r.out), backup: backup ? path.basename(backup) : null };
  } finally { busy.delete(projectDir); }
}

// undo: the newest backup goes back and the derived files are rendered from it; that backup is used up
export async function undoLast(projectDir, opts = {}) {
  if (!canEdit()) return { error: confView({}).reason, code: 409 };
  const last = history(projectDir)[0];
  if (!last) return { error: 'no earlier version to go back to', code: 409 };
  if (busy.has(projectDir)) return { error: 'another change is being saved', code: 409 };
  busy.add(projectDir);
  try {
    const file = path.join(historyDir(projectDir), last.name);
    fs.copyFileSync(file, confFile(projectDir));
    const r = await runInstaller(projectDir, [], opts);
    if (!r.ok) return { error: `install.sh --render failed: ${strip(r.out).trim().split('\n').slice(-3).join(' · ')}`, code: 500 };
    fs.unlinkSync(file);
    return { ok: true, restored: last.name, ...parseRender(r.out) };
  } finally { busy.delete(projectDir); }
}

// the backups, newest first: [{ name, at }]
export function history(projectDir) {
  let names = [];
  try { names = fs.readdirSync(historyDir(projectDir)).filter((n) => /^\d+\.conf$/.test(n)); } catch { return []; }
  return names.map((name) => ({ name, at: Number(name.slice(0, -5)) })).sort((a, b) => b.at - a.at);
}
function keepCopy(projectDir) {
  if (!fs.existsSync(confFile(projectDir))) return null;
  fs.mkdirSync(historyDir(projectDir), { recursive: true });
  let at = Date.now(); while (fs.existsSync(path.join(historyDir(projectDir), `${at}.conf`))) at++;
  const f = path.join(historyDir(projectDir), `${at}.conf`);
  fs.copyFileSync(confFile(projectDir), f);
  for (const old of history(projectDir).slice(KEEP)) { try { fs.unlinkSync(path.join(historyDir(projectDir), old.name)); } catch { /* next time */ } }
  return f;
}
