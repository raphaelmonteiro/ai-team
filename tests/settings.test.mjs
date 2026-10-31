// settings.mjs tests: adds only the missing dashboard hooks, keeps the rest,
// does not duplicate, backup copy, invalid JSON and install.sh over an old settings.json.
//   node tests/settings.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeHooks, updateFile, DASHBOARD_EVENTS, TEAM_EVENTS } from '../dashboard/settings.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-settings-'));
const ALL = [...DASHBOARD_EVENTS, ...TEAM_EVENTS];

// settings like a real project's: fixed agent, permissions, old hooks and a hook of the user's own
const old = {
  agent: 'orchestrator',
  permissions: { allow: ['Bash(make test)'] },
  hooks: {
    SubagentStart: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh' }] }],
    SubagentStop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }],
  },
};
{
  const { settings, added } = mergeHooks(old, ALL);
  assert.deepEqual(added, ['Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest', 'SessionStart', 'UserPromptExpansion']);
  assert.equal(settings.hooks.SessionEnd[0].hooks[0].timeout, 10, 'SessionEnd with time for the send');
  assert.equal(settings.agent, 'orchestrator'); assert.deepEqual(settings.permissions, old.permissions, 'the rest intact');
  assert.equal(settings.hooks.SubagentStart.length, 1, 'already on: does not duplicate');
  assert.deepEqual(settings.hooks.Stop.map((e) => e.hooks[0].command), ['say done', '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh'], 'the user hook stays, ours goes after it');
  assert.equal(settings.hooks.PermissionRequest[0].hooks[0].timeout, 3600);
  assert.equal(old.hooks.Stop.length, 1, 'does not change the given object');
  assert.deepEqual(mergeHooks(settings, ALL).added, [], 'second time: nothing');
  assert.equal(settings.hooks.Stop[1].hooks[0].timeout, 3600, 'Stop with time for away mode');
  // ai-team Stop without a timeout (old install): gets the timeout, without duplicating
  const up = mergeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh' }] }] } }, ['Stop']);
  assert.deepEqual([up.added, up.updated], [[], ['Stop']]);
  assert.equal(up.settings.hooks.Stop.length, 1); assert.equal(up.settings.hooks.Stop[0].hooks[0].timeout, 3600);
  assert.deepEqual(mergeHooks(up.settings, ['Stop']).updated, [], 'already with a timeout: nothing');
  assert.deepEqual(mergeHooks({ hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'node /abs/path/.claude/dashboard/ask.mjs' }] }] } }, ['PermissionRequest']).added, [], 'an absolute path counts too');
  assert.deepEqual(mergeHooks({}, ['Stop']).settings, { hooks: { Stop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh', timeout: 3600 }] }] } });
}

// file: backup copy, dry-run, invalid JSON
{
  const f = path.join(tmp, 'a', 'settings.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(old));
  assert.deepEqual(updateFile(f, DASHBOARD_EVENTS, { dryRun: true }), { added: ['Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest'], updated: [], wrote: false });
  assert.equal(fs.readFileSync(f, 'utf8'), JSON.stringify(old), 'dry-run does not write');
  assert.deepEqual(updateFile(f, DASHBOARD_EVENTS), { added: ['Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest'], updated: [], wrote: true });
  assert.equal(fs.readFileSync(`${f}.bak-ai-team`, 'utf8'), JSON.stringify(old), 'copy of the previous version');
  assert.ok(JSON.parse(fs.readFileSync(f, 'utf8')).hooks.PermissionRequest);
  assert.deepEqual(updateFile(f, DASHBOARD_EVENTS), { added: [], updated: [], wrote: false });
  const bad = path.join(tmp, 'b.json');
  fs.writeFileSync(bad, '{ // comment\n "hooks": {} }');
  const r = updateFile(bad, DASHBOARD_EVENTS);
  assert.match(r.error, /invalid JSON/); assert.equal(fs.readFileSync(bad, 'utf8'), '{ // comment\n "hooks": {} }');
}

// install.sh --force over a project with an old settings.json
{
  const proj = path.join(tmp, 'pas');
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'pas', scripts: { test: 'echo' } }));
  fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), JSON.stringify(old));
  execFileSync('bash', [path.join(here, '..', 'install.sh'), '--yes', '--force', proj], { stdio: 'pipe' });
  const s = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.json'), 'utf8'));
  assert.ok(s.hooks.PermissionRequest && s.hooks.SessionStart, 'the installer adds the missing hooks');
  assert.equal(s.agent, 'orchestrator'); assert.deepEqual(s.permissions, old.permissions);
  assert.ok(fs.existsSync(path.join(proj, '.claude', 'dashboard', 'settings.mjs')), 'standalone command installed');
  // standalone command: nothing to do the second time
  const out = execFileSync(process.execPath, [path.join(proj, '.claude', 'dashboard', 'settings.mjs')], { env: { ...process.env, CLAUDE_PROJECT_DIR: proj } }).toString();
  assert.match(out, /already there/);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ project settings ok');
