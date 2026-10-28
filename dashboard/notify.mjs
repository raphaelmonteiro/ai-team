#!/usr/bin/env node
// ai-team — notificações no celular pelo ntfy (https://ntfy.sh, ou um servidor próprio).
//
// Config do usuário (vale para todos os projetos): ~/.config/ai-team/notify.json
//   { "ntfy": { "server": "https://ntfy.sh", "topic": "ai-team-<aleatório>", "token": "" },
//     "on": ["decision", "agent_stop", "turn_stop"],   eventos que notificam
//     "detail": true,                                  false: só título, sem comando nem texto do agente
//     "dashboardUrl": "" }                             link ao tocar na notificação (ex.: o endereço do Tailscale)
// AI_TEAM_NOTIFY_FILE troca o arquivo; AI_TEAM_NOTIFY=0 desliga. Sem arquivo: nada é enviado.
//
//   node notify.mjs setup [tópico]   cria o arquivo (tópico aleatório se não vier) e mostra como assinar
//   node notify.mjs test             manda uma notificação de teste
//   node notify.mjs hook             lê o JSON de um hook (SubagentStop, Stop) no stdin e notifica
// Eventos: decision (ask.mjs, ao abrir uma pendência), agent_stop (SubagentStop: um agente terminou),
// turn_stop (Stop: a sessão principal terminou o turno e espera você).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readProjectName } from './collect.mjs';

export const EVENTS = ['decision', 'agent_stop', 'turn_stop'];
export const configFile = () => process.env.AI_TEAM_NOTIFY_FILE || path.join(os.homedir(), '.config', 'ai-team', 'notify.json');

export function loadConfig() {
  if (process.env.AI_TEAM_NOTIFY === '0') return null;
  let c; try { c = JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return null; }
  const n = c && c.ntfy;
  if (!n || !n.topic) return null;
  return { server: String(n.server || 'https://ntfy.sh').replace(/\/+$/, ''), topic: String(n.topic), token: n.token ? String(n.token) : '',
    on: Array.isArray(c.on) ? c.on.filter((e) => EVENTS.includes(e)) : EVENTS, detail: c.detail !== false, dashboardUrl: c.dashboardUrl ? String(c.dashboardUrl) : '' };
}

const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

// evento → mensagem do ntfy (JSON publish: https://docs.ntfy.sh/publish/#publish-as-json)
export function buildMessage(event, data, cfg, project) {
  const click = cfg.dashboardUrl || undefined;
  if (event === 'decision') {
    const q = data.kind === 'question';
    const body = !cfg.detail ? 'abra o painel para responder'
      : q ? (data.questions || []).map((x) => `${x.question} (${(x.options || []).map((o) => o.label).join(' / ')})`).join('\n')
      : cut(data.summary, 300);
    return { title: `${project}: ${q ? 'pergunta para você' : `permissão para ${data.tool}`}`, message: body || '—', tags: [q ? 'question' : 'warning'], priority: 4, click };
  }
  if (event === 'agent_stop') {
    return { title: `${project}: ${data.agent_type || 'agente'} terminou`, message: cfg.detail ? cut(data.last_assistant_message, 400) || 'sem resumo' : 'abra o painel', tags: ['white_check_mark'], priority: 3, click };
  }
  if (event === 'turn_stop') {
    return { title: `${project}: sessão esperando você`, message: cfg.detail ? cut(data.last_assistant_message, 400) || 'turno terminou' : 'turno terminou', tags: ['hourglass'], priority: 3, click };
  }
  return { title: `${project}: ${event}`, message: cut(data.message, 400) || '—', tags: [], priority: 3, click };
}

// envia se o evento está ligado; nunca lança (notificação não pode quebrar o hook)
export async function notify(event, data, { projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd(), cfg = loadConfig(), timeoutMs = 5000 } = {}) {
  if (!cfg || !cfg.on.includes(event)) return { sent: false, reason: cfg ? 'evento desligado' : 'sem config' };
  const msg = { topic: cfg.topic, ...buildMessage(event, data || {}, cfg, readProjectName(projectDir)) };
  try {
    const r = await fetch(cfg.server, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) }, body: JSON.stringify(msg) });
    return { sent: r.ok, status: r.status };
  } catch (e) { return { sent: false, reason: String(e.message || e) }; }
}

// stdin de hook → evento
export function hookEvent(h) {
  if (!h) return null;
  if (h.hook_event_name === 'SubagentStop') return 'agent_stop';
  if (h.hook_event_name === 'Stop' && !h.stop_hook_active) return 'turn_stop';
  return null;
}

async function main(argv) {
  const cmd = argv[0];
  if (cmd === 'hook') {
    let h; try { h = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; }
    const ev = hookEvent(h);
    if (ev) await notify(ev, h);
    return;
  }
  if (cmd === 'setup') {
    const f = configFile();
    if (fs.existsSync(f)) { console.log(`já existe: ${f}\n${fs.readFileSync(f, 'utf8')}`); return; }
    const topic = argv[1] || `ai-team-${crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ ntfy: { server: 'https://ntfy.sh', topic, token: '' }, on: EVENTS, detail: true, dashboardUrl: '' }, null, 2) + '\n', { mode: 0o600 });
    console.log(`criado: ${f}\ntópico: ${topic}\nno celular: app ntfy → "+" → assine "${topic}" (servidor ntfy.sh)\ndepois: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} test`);
    return;
  }
  if (cmd === 'test') {
    const cfg = loadConfig();
    if (!cfg) { console.error(`sem config em ${configFile()} (rode: node notify.mjs setup)`); process.exitCode = 1; return; }
    const r = await notify('turn_stop', { last_assistant_message: 'Notificação de teste do ai-team.' }, { cfg: { ...cfg, on: EVENTS } });
    console.log(r.sent ? `enviado para ${cfg.server}/${cfg.topic}` : `falhou: ${r.reason || r.status}`);
    if (!r.sent) process.exitCode = 1;
    return;
  }
  console.error('uso: node notify.mjs setup [tópico] | test | hook');
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
