// ai-team — what a change's branch adds, read-only (served at /changes/<id>/diff, shown in the drawer).
// The change's code lives on change/<id> (worktree skill): in the root repository and, for a package with
// its own git (BACKEND_DIR / FRONTEND_DIR in ai-team.conf), in that repository too. For each repository
// that has the branch: the commits since the merge base with the work branch (BACKEND_BRANCH /
// FRONTEND_BRANCH / GIT_WORK_BRANCH, else HEAD), the files with added/removed lines and the unified diff
// per file. git runs with execFile and fixed arguments (no shell); the output is capped so a big change
// does not take the page down: `maxFileLines` lines per file (then `truncated`), `maxBytes` in all.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readConf } from './conf.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/;
const DEFAULTS = { maxFileLines: 400, maxBytes: 1.5 * 1024 * 1024 };

function git(repo, args, maxBuffer = 8 * 1024 * 1024) {
  try { return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer, timeout: 15000 }); }
  catch { return null; }
}
const isRepo = (dir) => { try { return fs.statSync(path.join(dir, '.git')).isDirectory() || fs.statSync(path.join(dir, '.git')).isFile(); } catch { return false; } };
const hasBranch = (repo, br) => git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${br}`]) !== null;

// the repositories a change may touch: the root and the fronts with their own git (deduplicated)
export function changeRepos(projectDir, conf) {
  const out = [];
  const add = (rel, workBranch) => {
    const dir = path.resolve(projectDir, rel || '.');
    if (out.some((r) => r.dir === dir) || !isRepo(dir)) return;
    out.push({ rel: path.relative(projectDir, dir) || '.', dir, workBranch: workBranch || conf.GIT_WORK_BRANCH || '' });
  };
  add('.', conf.GIT_WORK_BRANCH || conf.BACKEND_BRANCH || conf.FRONTEND_BRANCH);
  if (conf.BACKEND_DIR) add(conf.BACKEND_DIR, conf.BACKEND_BRANCH);
  if (conf.FRONTEND_DIR) add(conf.FRONTEND_DIR, conf.FRONTEND_BRANCH);
  return out;
}

function repoDiff(r, branch, opts, budget, skip = new Set()) {
  const base = (r.workBranch && git(r.dir, ['merge-base', r.workBranch, branch])) || git(r.dir, ['merge-base', 'HEAD', branch]) || null;
  const range = base ? `${base.trim()}..${branch}` : branch;
  const commits = (git(r.dir, ['log', '--format=%H%x1f%s%x1f%ct', range]) || '').split('\n').filter(Boolean).map((l) => {
    const [sha, subject, ct] = l.split('\x1f'); return { sha, short: sha.slice(0, 7), subject, when: Number(ct) * 1000 || null };
  });
  const from = base ? base.trim() : null;
  const numstat = from ? (git(r.dir, ['diff', '--numstat', from, branch]) || '') : '';
  const status = from ? (git(r.dir, ['diff', '--name-status', '-M', from, branch]) || '') : '';
  const st = new Map();
  for (const l of status.split('\n').filter(Boolean)) {
    const parts = l.split('\t'); const code = parts[0][0];
    st.set(parts[parts.length - 1], { status: code, from: code === 'R' ? parts[1] : null });
  }
  const files = [];
  for (const l of numstat.split('\n').filter(Boolean)) {
    const [a, d, ...rest] = l.split('\t'); let p = rest.join('\t');
    // a rename in numstat: "old => new" or "{dir/old => dir/new}/x"
    const m = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(p) || /^(.*) => (.*)$/.exec(p);
    if (m) p = m.length === 5 ? `${m[1]}${m[3]}${m[4]}` : m[2];
    if (skip.has(p)) continue;   // a nested repository (gitlink) is diffed on its own, not as a file of the parent
    const binary = a === '-' || d === '-';
    const info = st.get(p) || { status: 'M', from: null };
    const f = { path: p, status: info.status, from: info.from, added: binary ? 0 : Number(a), removed: binary ? 0 : Number(d), binary, patch: null, truncated: false };
    if (!binary && budget.left > 0) {
      const out = git(r.dir, ['diff', '--no-color', '--no-ext-diff', from, branch, '--', p]) || '';
      const lines = out.split('\n');
      const keep = lines.length > opts.maxFileLines ? lines.slice(0, opts.maxFileLines) : lines;
      f.truncated = keep.length < lines.length;
      f.patch = keep.join('\n');
      budget.left -= Buffer.byteLength(f.patch);
      if (budget.left <= 0) { budget.exhausted = true; }
    } else if (!binary) { f.truncated = true; budget.exhausted = true; }
    files.push(f);
  }
  return { repo: r.rel, branch, workBranch: r.workBranch || null, base: from, commits, files,
    added: files.reduce((n, f) => n + f.added, 0), removed: files.reduce((n, f) => n + f.removed, 0) };
}

// → { id, repos: [...], truncated } | null when no repository has the change branch
export function changeDiff(projectDir, id, options = {}) {
  if (!ID_RE.test(String(id || ''))) return null;
  const opts = { ...DEFAULTS, ...options };
  const conf = readConf(projectDir);
  const branch = `change/${id}`;
  const budget = { left: opts.maxBytes, exhausted: false };
  const all = changeRepos(projectDir, conf);
  const nested = (r) => new Set(all.filter((o) => o.dir !== r.dir && o.dir.startsWith(r.dir + path.sep)).map((o) => path.relative(r.dir, o.dir)));
  const repos = all.filter((r) => hasBranch(r.dir, branch)).map((r) => repoDiff(r, branch, opts, budget, nested(r)));
  if (!repos.length) return null;
  return { id, branch, repos, truncated: budget.exhausted };
}
