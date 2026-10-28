// Teste da página /equipe: parser de frontmatter, listagem dos agentes, chaves
// públicas do conf e rotas do servidor (/api/team, /equipe, /agents/<nome>.md).
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

// --- parser de frontmatter ----------------------------------------------------
assert.deepEqual(parseFrontmatter('---\nname: a\ndescription: "Faz x"\nmodel: opus\n---\ncorpo'),
  { name: 'a', description: '"Faz x"', model: 'opus' });
assert.equal(parseFrontmatter('# sem frontmatter\n'), null);
assert.equal(parseFrontmatter('---\nname: a\nsem fechamento'), null);
assert.equal(parseFrontmatter(''), null);
assert.equal(parseFrontmatter(undefined), null);
assert.equal(parseFrontmatter('---\ndescription: linha um\n  continua aqui\n---\n').description, 'linha um continua aqui');
assert.equal(parseFrontmatter('\uFEFF---\nname: bom\n---\n').name, 'bom');

// --- pasta vazia / inexistente ------------------------------------------------
const proj = path.join(tmp, 'proj');
fs.mkdirSync(proj, { recursive: true });
assert.deepEqual(listTeam(proj), []);                 // sem .claude/agents
fs.mkdirSync(path.join(proj, '.claude/agents'), { recursive: true });
assert.deepEqual(listTeam(proj), []);                 // pasta vazia

// --- agentes ------------------------------------------------------------------
w(path.join(proj, '.claude/agents/zeta.md'), '---\nname: zeta\ndescription: Último\nmodel: sonnet\ntools: Read, Grep\n---\ncorpo');
w(path.join(proj, '.claude/agents/tech-lead.md'), "---\nname: tech-lead\ndescription: 'Orquestra'\nmodel: opus\ntools: Agent(zeta), Read\n---\n");
w(path.join(proj, '.claude/agents/sem-fm.md'), '# Agente sem frontmatter\n');
w(path.join(proj, '.claude/agents/Maiuscula.md'), '---\nname: x\n---\n');       // nome inválido
w(path.join(proj, '.claude/agents/com espaco.md'), '---\nname: x\n---\n');       // nome inválido
w(path.join(proj, '.claude/agents/notas.txt'), 'não é agente');
fs.mkdirSync(path.join(proj, '.claude/agents/pasta.md'));                         // diretório não é agente
const team = listTeam(proj);
assert.deepEqual(team.map((a) => a.id), ['tech-lead', 'sem-fm', 'zeta']);        // tech-lead primeiro, resto alfabético
assert.equal(team[0].description, 'Orquestra');
assert.equal(team[0].model, 'opus');
assert.equal(team[0].tools, 'Agent(zeta), Read');
assert.equal(team[1].frontmatter, false);
assert.equal(team[1].name, 'sem-fm');
assert.equal(team[1].description, '');

// --- conf: só chaves públicas, gate derivado, sem segredos --------------------
assert.deepEqual(parseConf("A='1'\nlixo\nb='min'\nB='it'\\''s'\n"), { A: '1', B: "it's" });
assert.deepEqual(teamInfo(proj).context, {});                                    // sem conf: não quebra
assert.equal(teamInfo(proj).project, 'proj');
assert.equal(teamInfo(proj).hasConf, false);
w(path.join(proj, '.claude/ai-team.conf'), [
  "PROJECT_NAME='Faturas'", "LAYOUT='monorepo'", "BACKEND_STACK='NestJS'", "BACKEND_BRANCH='v2'",
  "BACKEND_CMD_LINT='make lint'", "BACKEND_CMD_TEST='make test'", "FRONTEND_CMD_TEST=''",
  "GIT_REMOTE='https://user:segredo@host/repo.git'", "TEST_PERSONAS='ana: senha123'", "MAKE_TARGETS='a b'",
].join('\n'));
const info = teamInfo(proj);
assert.equal(info.project, 'Faturas');
assert.equal(info.hasConf, true);
assert.deepEqual(info.context, { PROJECT_NAME: 'Faturas', LAYOUT: 'monorepo', BACKEND_STACK: 'NestJS', BACKEND_BRANCH: 'v2', BACKEND_GATE: 'make lint; make test' });
assert.ok(!JSON.stringify(info).includes('segredo') && !JSON.stringify(info).includes('senha123'));

// --- servidor -------------------------------------------------------------------
// --- como a equipe entra nas sessões (settings.json + skill /equipe) ----------------
assert.deepEqual(entryInfo(path.join(tmp, 'vazio')), { fixedAgent: null, skill: false, compactHooks: false, timingHooks: false, looseTasks: false });
const ent = path.join(tmp, 'ent');
const hk = { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh' }] };
w(path.join(ent, '.claude/skills/equipe/SKILL.md'), '---\nname: equipe\n---\n');
w(path.join(ent, '.claude/settings.json'), JSON.stringify({ hooks: { SubagentStart: [hk], SubagentStop: [hk] } }));
assert.deepEqual(entryInfo(ent), { fixedAgent: null, skill: true, compactHooks: false, timingHooks: true, looseTasks: false }, 'projeto antigo: sem hooks do /equipe');
w(path.join(ent, '.claude/settings.json'), JSON.stringify({ agent: 'tech-lead', hooks: { SessionStart: [hk], UserPromptExpansion: [hk] } }));
assert.deepEqual(entryInfo(ent), { fixedAgent: 'tech-lead', skill: true, compactHooks: true, timingHooks: false, looseTasks: false });
w(path.join(ent, '.claude/agents/tech-lead.md'), '## Change ou tarefa avulsa\nTarefa avulsa: ...\n');
assert.equal(entryInfo(ent).looseTasks, true, 'tech-lead com o modo avulso');
w(path.join(ent, '.claude/settings.json'), JSON.stringify({ agent: '../x' }));
assert.equal(entryInfo(ent).fixedAgent, null, 'nome fora do padrão não sai');
w(path.join(ent, '.claude/settings.json'), '{ quebrado');
assert.equal(entryInfo(ent).skill, true, 'settings inválido não quebra');
w(path.join(ent, '.claude/ai-team.conf'), "HUB_TEAM='Pagamentos'\nGIT_REMOTE='https://token@x'\n");
assert.equal(teamInfo(ent).context.HUB_TEAM, 'Pagamentos'); assert.equal(teamInfo(ent).context.GIT_REMOTE, undefined);

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
  assert.deepEqual(JSON.parse(t.body).agents.map((a) => a.id), ['tech-lead', 'sem-fm', 'zeta']);
  assert.equal((await get('/equipe', 'HEAD')).status, 200);
  const page = await get('/equipe');
  assert.ok(page.body.includes("fetch('api/team'") && page.body.includes('Ciclo de uma change'));   // ciclo padrão inserido
  assert.ok(!page.body.includes('<!--ai-team:cycle-->'));
  assert.equal((await get('/agents/zeta.md')).status, 200);
  assert.equal((await get('/agents/Maiuscula.md')).status, 404);
  assert.equal((await get('/agents/..%2Fsettings.md')).status, 404);
} finally { srv.kill(); }

// --- ciclo sobrescrito pelo perfil (cycle.html ao lado do server.mjs) ------------
// o servidor lê cycle.html do próprio diretório; a cópia isolada prova a sobrescrita
const dash = path.join(tmp, 'dash');
fs.cpSync(new URL('../dashboard', import.meta.url).pathname, dash, { recursive: true });
w(path.join(dash, 'cycle.html'), '<section id="meu-ciclo">ciclo do perfil</section>');
const port2 = port + 1000;
const srv2 = spawn(process.execPath, [path.join(dash, 'server.mjs'), '--project', proj, '--port', String(port2), '--claude-dir', path.join(tmp, 'claude')], { stdio: 'ignore' });
try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port2}/favicon.ico`); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }
  const page = await (await fetch(`http://127.0.0.1:${port2}/equipe`)).text();
  assert.ok(page.includes('id="meu-ciclo"') && !page.includes('Ciclo de uma change'));
} finally { srv2.kill(); }

fs.rmSync(tmp, { recursive: true, force: true });
console.log('equipe ok');
