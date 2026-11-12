// A running server and newer code on disk (a merge or a reinstall while it runs): the page modules follow the
// imports on disk, so a module added later is served without a restart, and /api/health says the code changed.
//   node tests/codecheck.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const here = path.dirname(new URL(import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-code-'));
const dash = path.join(tmp, 'dashboard'), proj = path.join(tmp, 'proj');
fs.cpSync(path.join(here, '..', 'dashboard'), dash, { recursive: true });
fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 43271, b = `http://127.0.0.1:${port}`;
const old = new Date(Date.now() - 60e3);
for (const f of fs.readdirSync(dash)) fs.utimesSync(path.join(dash, f), old, old);   // the copy predates the server
const srv = spawn(process.execPath, [path.join(dash, 'server.mjs'), '--project', proj, '--claude-dir', path.join(tmp, 'claude'), '--port', String(port)],
  { stdio: 'ignore', env: { ...process.env, AI_TEAM_CODE_CHECK_MS: '0', AI_TEAM_NOTIFY: '0' } });
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`${b}/api/health`); break; } catch { await sleep(100); } }
  const health = async () => (await (await fetch(`${b}/api/health`)).json());
  assert.equal((await health()).codeChanged, false, 'fresh start: nothing changed');
  for (const m of ['ui.mjs', 'overview.mjs', 'keys.mjs', 'uistate.mjs']) assert.equal((await fetch(`${b}/${m}`)).status, 200, `${m}: imported by the page`);
  for (const m of ['server.mjs', 'collect.mjs', 'notify.mjs', 'later.mjs']) assert.equal((await fetch(`${b}/${m}`)).status, 404, `${m}: not a page module`);
  // a merge adds a module the page imports, while the server runs
  await sleep(1100);
  fs.writeFileSync(path.join(dash, 'later.mjs'), 'export const later = 1;\n');
  const page = fs.readFileSync(path.join(dash, 'index.html'), 'utf8');
  fs.writeFileSync(path.join(dash, 'index.html'), page.replace("import { matchKey, helpRows } from './keys.mjs';", "import { matchKey, helpRows } from './keys.mjs';\nimport { later } from './later.mjs';"));
  assert.equal((await fetch(`${b}/later.mjs`)).status, 200, 'a module added after the start is served without a restart');
  assert.equal((await health()).codeChanged, true, 'and the health says the code on disk is newer');
} finally { srv.kill(); fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('✓ code check ok');
