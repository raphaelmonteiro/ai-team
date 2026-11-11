// Tests of gitInfo (dashboard/collect.mjs): branch and worktree of the project folder, read from .git without running git.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitInfo } from '../dashboard/collect.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-git-'));
try {
  const main = path.join(tmp, 'repo'), wt = path.join(tmp, 'repo-v3'), loose = path.join(tmp, 'plain');
  fs.mkdirSync(path.join(main, '.git', 'worktrees', 'repo-v3'), { recursive: true });
  fs.writeFileSync(path.join(main, '.git', 'HEAD'), 'ref: refs/heads/feat/x\n');
  fs.writeFileSync(path.join(main, '.git', 'worktrees', 'repo-v3', 'HEAD'), 'ref: refs/heads/feat/dashboard-v3\n');
  fs.mkdirSync(wt); fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.join(main, '.git', 'worktrees', 'repo-v3')}\n`);
  fs.mkdirSync(loose);
  assert.deepEqual(gitInfo(main), { branch: 'feat/x', detached: null, worktree: null }, 'main checkout');
  assert.deepEqual(gitInfo(wt), { branch: 'feat/dashboard-v3', detached: null, worktree: { name: 'repo-v3', main } }, 'linked worktree: its name and the main checkout');
  fs.writeFileSync(path.join(main, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n');
  assert.deepEqual(gitInfo(main), { branch: null, detached: '0123456789ab', worktree: null }, 'detached HEAD');
  assert.equal(gitInfo(loose), null, 'no .git'); assert.equal(gitInfo(path.join(tmp, 'missing')), null);
  fs.writeFileSync(path.join(loose, '.git'), 'garbage'); assert.equal(gitInfo(loose), null, 'a .git file without gitdir');
  // a relative gitdir resolves against the folder
  const rel = path.join(tmp, 'rel'); fs.mkdirSync(rel); fs.writeFileSync(path.join(rel, '.git'), 'gitdir: ../repo/.git/worktrees/repo-v3');
  assert.equal(gitInfo(rel).worktree.main, main);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('✓ gitinfo ok');
