// Testes do settings.mjs: acrescenta só os hooks do painel que faltam, preserva o resto,
// não duplica, cópia de segurança, JSON inválido e o install.sh sobre um settings.json antigo.
//   node tests/settings.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { mergeHooks, updateFile, DASHBOARD_EVENTS, EQUIPE_EVENTS } from '../dashboard/settings.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-settings-'));
const ALL = [...DASHBOARD_EVENTS, ...EQUIPE_EVENTS];

// settings como o do pas: agente fixo, permissões, hooks antigos e um hook do próprio usuário
const old = {
  agent: 'orchestrator',
  permissions: { allow: ['Bash(make test)'] },
  hooks: {
    SubagentStart: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh' }] }],
    SubagentStop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh' }] }],
    Stop: [{ hooks: [{ type: 'command', command: 'say pronto' }] }],
  },
};
{
  const { settings, added } = mergeHooks(old, ALL);
  assert.deepEqual(added, ['Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest', 'SessionStart', 'UserPromptExpansion']);
  assert.equal(settings.hooks.SessionEnd[0].hooks[0].timeout, 10, 'SessionEnd com tempo para o envio');
  assert.equal(settings.agent, 'orchestrator'); assert.deepEqual(settings.permissions, old.permissions, 'resto intacto');
  assert.equal(settings.hooks.SubagentStart.length, 1, 'já ligado: não duplica');
  assert.deepEqual(settings.hooks.Stop.map((e) => e.hooks[0].command), ['say pronto', '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh'], 'hook do usuário fica, o nosso entra depois');
  assert.equal(settings.hooks.PermissionRequest[0].hooks[0].timeout, 3600);
  assert.equal(old.hooks.Stop.length, 1, 'não altera o objeto recebido');
  assert.deepEqual(mergeHooks(settings, ALL).added, [], 'segunda vez: nada');
  assert.equal(settings.hooks.Stop[1].hooks[0].timeout, 3600, 'Stop com tempo para o modo longe');
  // Stop do ai-team sem timeout (instalação antiga): ganha o timeout, sem duplicar
  const up = mergeHooks({ hooks: { Stop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh' }] }] } }, ['Stop']);
  assert.deepEqual([up.added, up.updated], [[], ['Stop']]);
  assert.equal(up.settings.hooks.Stop.length, 1); assert.equal(up.settings.hooks.Stop[0].hooks[0].timeout, 3600);
  assert.deepEqual(mergeHooks(up.settings, ['Stop']).updated, [], 'já com timeout: nada');
  assert.deepEqual(mergeHooks({ hooks: { PermissionRequest: [{ hooks: [{ type: 'command', command: 'node /abs/path/.claude/dashboard/ask.mjs' }] }] } }, ['PermissionRequest']).added, [], 'caminho absoluto também conta');
  assert.deepEqual(mergeHooks({}, ['Stop']).settings, { hooks: { Stop: [{ hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh', timeout: 3600 }] }] } });
}

// arquivo: cópia de segurança, dry-run, JSON inválido
{
  const f = path.join(tmp, 'a', 'settings.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(old));
  assert.deepEqual(updateFile(f, DASHBOARD_EVENTS, { dryRun: true }), { added: ['Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest'], updated: [], wrote: false });
  assert.equal(fs.readFileSync(f, 'utf8'), JSON.stringify(old), 'dry-run não grava');
  assert.deepEqual(updateFile(f, DASHBOARD_EVENTS), { added: ['Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest'], updated: [], wrote: true });
  assert.equal(fs.readFileSync(`${f}.bak-ai-team`, 'utf8'), JSON.stringify(old), 'cópia da versão anterior');
  assert.ok(JSON.parse(fs.readFileSync(f, 'utf8')).hooks.PermissionRequest);
  assert.deepEqual(updateFile(f, DASHBOARD_EVENTS), { added: [], updated: [], wrote: false });
  const bad = path.join(tmp, 'b.json');
  fs.writeFileSync(bad, '{ // comentário\n "hooks": {} }');
  const r = updateFile(bad, DASHBOARD_EVENTS);
  assert.match(r.error, /JSON inválido/); assert.equal(fs.readFileSync(bad, 'utf8'), '{ // comentário\n "hooks": {} }');
}

// install.sh --force sobre um projeto com settings.json antigo (o caso do pas)
{
  const proj = path.join(tmp, 'pas');
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ name: 'pas', scripts: { test: 'echo' } }));
  fs.writeFileSync(path.join(proj, '.claude', 'settings.json'), JSON.stringify(old));
  execFileSync('bash', [path.join(here, '..', 'install.sh'), '--yes', '--force', proj], { stdio: 'pipe' });
  const s = JSON.parse(fs.readFileSync(path.join(proj, '.claude', 'settings.json'), 'utf8'));
  assert.ok(s.hooks.PermissionRequest && s.hooks.SessionStart, 'instalador acrescenta os hooks que faltam');
  assert.equal(s.agent, 'orchestrator'); assert.deepEqual(s.permissions, old.permissions);
  assert.ok(fs.existsSync(path.join(proj, '.claude', 'dashboard', 'settings.mjs')), 'comando avulso instalado');
  // comando avulso: nada a fazer na segunda vez
  const out = execFileSync(process.execPath, [path.join(proj, '.claude', 'dashboard', 'settings.mjs')], { env: { ...process.env, CLAUDE_PROJECT_DIR: proj } }).toString();
  assert.match(out, /já estão lá/);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ settings do projeto ok');
