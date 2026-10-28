#!/usr/bin/env node
// ai-team — acrescenta ao .claude/settings.json os hooks do painel que faltam, sem mexer no resto.
//
//   node .claude/dashboard/settings.mjs [--dry-run] [--file CAMINHO] [--events A,B,...]
//
// Padrão: todos os eventos do painel; SessionStart/UserPromptExpansion só se o skill /equipe existe.
// Um evento conta como já ligado se algum hook dele chama o mesmo script (hook.sh / ask.mjs), com
// qualquer caminho. Antes de gravar guarda a versão anterior em settings.json.bak-ai-team. JSON
// inválido (ex.: com comentários): não grava e mostra o trecho para colar à mão.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HOOK_SH = '$CLAUDE_PROJECT_DIR/.claude/dashboard/hook.sh';
export const HOOKS = {
  SubagentStart: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
  SubagentStop: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
  Stop: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
  PermissionRequest: { script: 'ask.mjs', hook: { type: 'command', command: 'node "$CLAUDE_PROJECT_DIR/.claude/dashboard/ask.mjs"', timeout: 300 } },
  SessionStart: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
  UserPromptExpansion: { script: 'hook.sh', hook: { type: 'command', command: HOOK_SH } },
};
export const DASHBOARD_EVENTS = ['SubagentStart', 'SubagentStop', 'Stop', 'PermissionRequest'];
export const EQUIPE_EVENTS = ['SessionStart', 'UserPromptExpansion'];

const calls = (entries, script) => (Array.isArray(entries) ? entries : []).some((e) =>
  (Array.isArray(e && e.hooks) ? e.hooks : []).some((h) => typeof (h && h.command) === 'string' && h.command.includes(`dashboard/${script}`)));

// devolve { settings, added } sem alterar o objeto recebido
export function mergeHooks(settings, events) {
  const out = JSON.parse(JSON.stringify(settings || {}));
  if (!out.hooks || typeof out.hooks !== 'object' || Array.isArray(out.hooks)) out.hooks = {};
  const added = [];
  for (const ev of events) {
    const def = HOOKS[ev]; if (!def) continue;
    if (calls(out.hooks[ev], def.script)) continue;
    out.hooks[ev] = [...(Array.isArray(out.hooks[ev]) ? out.hooks[ev] : []), { hooks: [{ ...def.hook }] }];
    added.push(ev);
  }
  return { settings: out, added };
}

export function snippet(events) {
  return JSON.stringify({ hooks: Object.fromEntries(events.filter((e) => HOOKS[e]).map((e) => [e, [{ hooks: [HOOKS[e].hook] }]])) }, null, 2);
}

// atualiza o arquivo; devolve { added, wrote, error? }
export function updateFile(file, events, { dryRun = false } = {}) {
  let cur = {};
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8');
    try { cur = raw.trim() ? JSON.parse(raw) : {}; } catch (e) { return { added: [], wrote: false, error: `JSON inválido em ${file}: ${e.message}` }; }
  }
  const { settings, added } = mergeHooks(cur, events);
  if (!added.length || dryRun) return { added, wrote: false };
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak-ai-team`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  return { added, wrote: true };
}

function main(argv) {
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const claudeDir = path.join(process.env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude');
  const file = path.resolve(opt('--file') || path.join(claudeDir, 'settings.json'));
  const equipe = fs.existsSync(path.join(path.dirname(file), 'skills', 'equipe', 'SKILL.md'));
  const events = opt('--events') ? opt('--events').split(',').map((s) => s.trim()).filter(Boolean) : [...DASHBOARD_EVENTS, ...(equipe ? EQUIPE_EVENTS : [])];
  const unknown = events.filter((e) => !HOOKS[e]);
  if (unknown.length) { console.error(`evento desconhecido: ${unknown.join(', ')} (conhecidos: ${Object.keys(HOOKS).join(', ')})`); process.exit(2); }
  const dry = argv.includes('--dry-run');
  const r = updateFile(file, events, { dryRun: dry });
  if (r.error) { console.error(`${r.error}\nnão alterado; acrescente à mão no "hooks":\n${snippet(events)}`); process.exit(1); }
  if (!r.added.length) { console.log(`${file}: hooks do painel já estão lá (${events.join(', ')})`); return; }
  console.log(dry ? `${file}: acrescentaria ${r.added.join(', ')}` : `${file}: acrescentados ${r.added.join(', ')} (cópia anterior em settings.json.bak-ai-team); abra uma sessão nova para valer`);
}

// realpath: no macOS /var é link para /private/var (o import.meta.url já vem resolvido)
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
