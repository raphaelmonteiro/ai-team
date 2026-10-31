// /team page test: frontmatter parser, agent listing, public conf keys
// and server routes (/api/team, /team, /agents/<name>.md).
//   node tests/team.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { parseFrontmatter, listTeam, parseConf, teamInfo, entryInfo } from '../dashboard/team.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-team-'));
const w = (f, s) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, s); };

// --- frontmatter parser ----------------------------------------------------
assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: "Does x"\nmodel: opus\n---\nbody'),
  { name: 'a', description: '"Does x"', model: 'opus' });
assert.equal(parseFrontmatter('# no frontmatter\n'), null);
assert.equal(parseFrontmatter('---\nname: a\nnot closed'), null);
assert.equal(parseFrontmatter(''), null);
assert.equal(parseFrontmatter(undefined), null);
assert.equal(parseFrontmatter('---\ndescription: line one\n  continues here\n---\n').description, 'line one continues here');
assert.equal(parseFrontmatter('\uFEFF---\nname: good\n---\n').name, 'good');

// --- empty / missing folder ------------------------------------------------
const proj = path.join(tmp, 'proj');
fs.mkdirSync(proj, { recursive: true });
assert.deepEqual(listTeam(proj), []);                 // no .claude/agents
fs.mkdirSync(path.join(proj, '.claude/agents'), { recursive: true });
assert.deepEqual(listTeam(proj), []);                 // empty folder

// --- agents ------------------------------------------------------------------
w(path.join(proj, '.claude/agents/zeta.md'), '---\nname: zeta\ndescription: Last\nmodel: sonnet\ntools: Read, Grep\n---\nbody');
w(path.join(proj, '.claude/agents/orchestrator.md'), "---\nname: orchestrator\ndescription: 'Orchestrates'\nmodel: opus\ntools: Agent(zeta), Read\n---\n");
w(path.join(proj, '.claude/agents/no-fm.md'), '# Agent without frontmatter\n');
w(path.join(proj, '.claude/agents/Uppercase.md'), '---\nname: x\n---\n');       // invalid name
w(path.join(proj, '.claude/agents/with space.md'), '---\nname: x\n---\n');       // invalid name
w(path.join(proj, '.claude/agents/notes.txt'), 'not an agent');
fs.mkdirSync(path.join(proj, '.claude/agents/folder.md'));                         // a directory is not an agent
const team = listTeam(proj);
assert.deepEqual(team.map((a) => a.id), ['orchestrator', 'no-fm', 'zeta']);        // orchestrator first, the rest alphabetical
assert.equal(team[0].description, 'Orchestrates');
assert.equal(team[0].model, 'opus');
assert.equal(team[0].tools, 'Agent(zeta), Read');
assert.equal(team[1].frontmatter, false);
assert.equal(team[1].name, 'no-fm');
assert.equal(team[1].description, '');

// --- conf: public keys only, derived gate, no secrets --------------------
assert.deepEqual(parseConf("A='1'\njunk\nb='min'\nB='it'\\''s'\n"), { A: '1', B: "it's" });
assert.deepEqual(teamInfo(proj).context, {});                                    // no conf: does not break
assert.equal(teamInfo(proj).project, 'proj');
assert.equal(teamInfo(proj).hasConf, false);
w(path.join(proj, '.claude/ai-team.conf'), [
  "PROJECT_NAME='Invoices'", "LAYOUT='monorepo'", "BACKEND_STACK='NestJS'", "BACKEND_BRANCH='v2'",
  "BACKEND_CMD_LINT='make lint'", "BACKEND_CMD_TEST='make test'", "FRONTEND_CMD_TEST=''",
  "GIT_REMOTE='https://user:secret@host/repo.git'", "TEST_PERSONAS='ana: password123'", "MAKE_TARGETS='a b'",
].join('\n'));
const info = teamInfo(proj);
assert.equal(info.project, 'Invoices');
assert.equal(info.hasConf, true);
assert.deepEqual(info.context, { PROJECT_NAME: 'Invoices', LAYOUT: 'monorepo', BACKEND_STACK: 'NestJS', BACKEND_BRANCH: 'v2', BACKEND_GATE: 'make lint; make test' });
assert.ok(!JSON.stringify(info).includes('secret') && !JSON.stringify(info).includes('password123'));

// --- server -------------------------------------------------------------------
// --- how the team enters sessions (settings.json + /team skill) ----------------
assert.deepEqual(entryInfo(path.join(tmp, 'empty')), { fixedAgent: null, skill: false, compactHooks: false, timingHooks: false, looseTasks: false });
const ent = path.join(tmp, 'ent');
const hk = { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh' }] };
w(path.join(ent, '.claude/skills/team/SKILL.md'), '---\nname: team\n---\n');
w(path.join(ent, '.claude/settings.json'), JSON.stringify({ hooks: { SubagentStart: [hk], SubagentStop: [hk] } }));
assert.deepEqual(entryInfo(ent), { fixedAgent: null, skill: true, compactHooks: false, timingHooks: true, looseTasks: false }, 'old project: without the /team hooks');
w(path.join(ent, '.claude/settings.json'), JSON.stringify({ agent: 'orchestrator', hooks: { SessionStart: [hk], UserPromptExpansion: [hk] } }));
assert.deepEqual(entryInfo(ent), { fixedAgent: 'orchestrator', skill: true, compactHooks: true, timingHooks: false, looseTasks: false });
w(path.join(ent, '.claude/agents/orchestrator.md'), '## Change or ad-hoc task\nAd-hoc task: ...\n');
assert.equal(entryInfo(ent).looseTasks, true, 'orchestrator with the ad-hoc mode');
w(path.join(ent, '.claude/settings.json'), JSON.stringify({ agent: '../x' }));
assert.equal(entryInfo(ent).fixedAgent, null, 'a name outside the pattern does not go out');
w(path.join(ent, '.claude/settings.json'), '{ broken');
assert.equal(entryInfo(ent).skill, true, 'invalid settings does not break');
w(path.join(ent, '.claude/ai-team.conf'), "HUB_TEAM='Payments'\nGIT_REMOTE='https://token@x'\n");
assert.equal(teamInfo(ent).context.HUB_TEAM, 'Payments'); assert.equal(teamInfo(ent).context.GIT_REMOTE, undefined);

const port = 43000 + Math.floor(Math.random() * 1000);
const srv = spawn(process.execPath, [new URL('../dashboard/server.mjs', import.meta.url).pathname,
  '--project', proj, '--port', String(port), '--claude-dir', path.join(tmp, 'claude')], { stdio: 'ignore' });
const get = (p, method = 'GET') => new Promise((res, rej) => {
  const r = http.request({ host: '127.0.0.1', port, path: p, method }, (m) => {
    let b = ''; m.on('data', (c) => b += c); m.on('end', () => res({ status: m.statusCode, body: b }));
  });
  r.on('error', rej); r.end();
});
try {
  for (let i = 0; i < 50; i++) { try { await get('/favicon.ico'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const t = await get('/api/team');
  assert.equal(t.status, 200);
  assert.deepEqual(JSON.parse(t.body).agents.map((a) => a.id), ['orchestrator', 'no-fm', 'zeta']);
  assert.equal((await get('/team', 'HEAD')).status, 200);
  const page = await get('/team');
  assert.ok(page.body.includes("fetch('api/team'") && page.body.includes('Cycle of a change'));   // default cycle inserted
  assert.ok(!page.body.includes('<!--ai-team:cycle-->'));
  assert.equal((await get('/agents/zeta.md')).status, 200);
  assert.equal((await get('/agents/Uppercase.md')).status, 404);
  assert.equal((await get('/agents/..%2Fsettings.md')).status, 404);
} finally { srv.kill(); }

// --- cycle overridden by the profile (cycle.html next to server.mjs) ------------
// the server reads cycle.html from its own folder; the isolated copy proves the override
const dash = path.join(tmp, 'dash');
fs.cpSync(new URL('../dashboard', import.meta.url).pathname, dash, { recursive: true });
w(path.join(dash, 'cycle.html'), '<section id="my-cycle">profile cycle</section>');
const port2 = port + 1000;
const srv2 = spawn(process.execPath, [path.join(dash, 'server.mjs'), '--project', proj, '--port', String(port2), '--claude-dir', path.join(tmp, 'claude')], { stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port2}/favicon.ico`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const page = await (await fetch(`http://127.0.0.1:${port2}/team`)).text();
  assert.ok(page.includes('id="my-cycle"') && !page.includes('Cycle of a change'));
} finally { srv2.kill(); }

fs.rmSync(tmp, { recursive: true, force: true });
console.log('team page ok');
