// diff.mjs tests: a change branch in the root repository and in a nested package, commits since the merge
// base, files with counts, patch per file, binary and truncation, and nothing for a change with no branch.
//   node tests/diff.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { changeDiff, changeRepos } from '../dashboard/diff.mjs';
import { readConf } from '../dashboard/conf.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-diff-'));
const proj = path.join(tmp, 'proj');
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
const init = (dir, work) => { fs.mkdirSync(dir, { recursive: true }); git(dir, 'init', '-q', '-b', work); };

// root repository on `develop`, a nested frontend package with its own git on `main`
init(proj, 'develop');
w(path.join(proj, 'README.md'), 'hello\n'); w(path.join(proj, 'src', 'a.js'), 'const a = 1;\nconst b = 2;\n');
// the conf is committed on develop: a checkout of the work branch must not make it vanish
w(path.join(proj, '.claude', 'ai-team.conf'), "PROJECT_NAME='demo'\nGIT_WORK_BRANCH='develop'\nBACKEND_DIR='.'\nBACKEND_BRANCH='develop'\nFRONTEND_DIR='web'\nFRONTEND_BRANCH='main'\nODD='it'\\''s'\n");
git(proj, 'add', '.'); git(proj, 'commit', '-q', '-m', 'init');
const web = path.join(proj, 'web');
init(web, 'main');
w(path.join(web, 'app.js'), 'x\n'); git(web, 'add', '.'); git(web, 'commit', '-q', '-m', 'init web');

assert.deepEqual(readConf(proj), { PROJECT_NAME: 'demo', GIT_WORK_BRANCH: 'develop', BACKEND_DIR: '.', BACKEND_BRANCH: 'develop', FRONTEND_DIR: 'web', FRONTEND_BRANCH: 'main', ODD: "it's" }, 'conf read, shell quoting undone');
assert.deepEqual(changeRepos(proj, readConf(proj)).map((r) => [r.rel, r.workBranch]), [['.', 'develop'], ['web', 'main']], 'root once, nested package once');

assert.equal(changeDiff(proj, 'add-x'), null, 'no branch anywhere: nothing');
assert.equal(changeDiff(proj, '../x'), null, 'odd id');

// the change: two commits in the root (a modified file, a new file, a binary), one in web; develop moves on meanwhile
git(proj, 'checkout', '-q', '-b', 'change/add-x');
w(path.join(proj, 'src', 'a.js'), 'const a = 1;\nconst b = 3;\nconst c = 4;\n'); w(path.join(proj, 'src', 'new.js'), 'export const n = 1;\n');
git(proj, 'add', '.'); git(proj, 'commit', '-q', '-m', 'feat: a and new');
fs.writeFileSync(path.join(proj, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
git(proj, 'add', '.'); git(proj, 'commit', '-q', '-m', 'chore: logo');
git(proj, 'checkout', '-q', 'develop');
w(path.join(proj, 'README.md'), 'hello\nmore on develop\n'); git(proj, 'add', '.'); git(proj, 'commit', '-q', '-m', 'docs on develop');
git(web, 'checkout', '-q', '-b', 'change/add-x');
w(path.join(web, 'app.js'), 'x\ny\n'); git(web, 'add', '.'); git(web, 'commit', '-q', '-m', 'web: y');
git(web, 'checkout', '-q', 'main');

{
  const d = changeDiff(proj, 'add-x');
  assert.equal(d.branch, 'change/add-x'); assert.equal(d.truncated, false);
  assert.deepEqual(d.repos.map((r) => r.repo), ['.', 'web']);
  const root = d.repos[0];
  assert.equal(root.workBranch, 'develop');
  assert.deepEqual(root.commits.map((c) => c.subject), ['chore: logo', 'feat: a and new'], 'only the branch commits, newest first; develop\'s later commit is not there');
  assert.ok(root.commits.every((c) => /^[0-9a-f]{40}$/.test(c.sha) && c.short.length === 7 && c.when > 0));
  assert.deepEqual(root.files.map((f) => [f.path, f.status, f.added, f.removed, f.binary]), [['logo.png', 'A', 0, 0, true], ['src/a.js', 'M', 2, 1, false], ['src/new.js', 'A', 1, 0, false]]);
  assert.equal(root.added, 3); assert.equal(root.removed, 1);
  const a = root.files.find((f) => f.path === 'src/a.js');
  assert.match(a.patch, /^diff --git a\/src\/a\.js b\/src\/a\.js/); assert.match(a.patch, /\n-const b = 2;\n\+const b = 3;\n\+const c = 4;/);
  assert.equal(root.files.find((f) => f.path === 'logo.png').patch, null, 'binary: no patch');
  assert.ok(!root.files.some((f) => f.path === 'README.md'), 'what develop changed after the fork is not part of the change');
  const web1 = d.repos[1];
  assert.equal(web1.workBranch, 'main'); assert.deepEqual(web1.commits.map((c) => c.subject), ['web: y']);
  assert.deepEqual(web1.files.map((f) => [f.path, f.added]), [['app.js', 1]]);
}
{   // caps: lines per file, bytes in all
  const d = changeDiff(proj, 'add-x', { maxFileLines: 3 });
  const a = d.repos[0].files.find((f) => f.path === 'src/a.js');
  assert.equal(a.patch.split('\n').length, 3); assert.equal(a.truncated, true);
  const e = changeDiff(proj, 'add-x', { maxBytes: 10 });
  assert.equal(e.truncated, true);
  assert.ok(e.repos[0].files.some((f) => f.patch !== null) && e.repos.flat().some((r) => r.files.some((f) => f.truncated)), 'the first file gets its patch, the budget then runs out');
}
{   // the branch only in the nested package; a rename is reported with its new path
  git(web, 'checkout', '-q', '-b', 'change/web-only'); git(web, 'mv', 'app.js', 'main.js'); git(web, 'commit', '-q', '-m', 'rename');
  git(web, 'checkout', '-q', 'main');
  const d = changeDiff(proj, 'web-only');
  assert.deepEqual(d.repos.map((r) => r.repo), ['web']);
  assert.deepEqual(d.repos[0].files.map((f) => [f.path, f.status, f.from]), [['main.js', 'R', 'app.js']]);
}
{   // no conf at all: the root repository with HEAD as the base
  fs.unlinkSync(path.join(proj, '.claude', 'ai-team.conf'));
  const d = changeDiff(proj, 'add-x');
  assert.deepEqual(d.repos.map((r) => r.repo), ['.'], 'without the conf the nested package is unknown');
  assert.equal(d.repos[0].workBranch, null); assert.equal(d.repos[0].commits.length, 2);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ change diff ok');
