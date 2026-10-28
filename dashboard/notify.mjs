#!/usr/bin/env node
// ai-team — notificações no celular pelo ntfy (https://ntfy.sh, ou um servidor próprio).
//
// Config do usuário (vale para todos os projetos): ~/.config/ai-team/notify.json
//   { "ntfy": { "server": "https://ntfy.sh", "topic": "ai-team-<aleatório>", "token": "" },
//     "on": ["decision", "agent_stop", "turn_stop"],   eventos que notificam
//     "detail": true,                                  false: só título, sem comando nem texto do agente
//     "dashboardUrl": "",                              link ao tocar na notificação (ex.: o endereço do Tailscale)
//     "projects": { "<pasta>": { "on": [...] } } }      eventos só daquele projeto (vazio = projeto mudo)
// A config é do PC; os hooks que disparam ficam em cada projeto (.claude/settings.json).
// O painel edita tudo isso na página /notificacoes (publicView/updateConfig).
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

const readRaw = () => { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return null; } };
const projectKey = (dir) => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };

export function loadConfig(projectDir = null) {
  if (process.env.AI_TEAM_NOTIFY === '0') return null;
  const c = readRaw();
  const n = c && c.ntfy;
  if (!n || !n.topic) return null;
  const ov = projectDir && c.projects && c.projects[projectKey(projectDir)];
  return { server: String(n.server || 'https://ntfy.sh').replace(/\/+$/, ''), topic: String(n.topic), token: n.token ? String(n.token) : '',
    on: (ov && Array.isArray(ov.on) ? ov.on : Array.isArray(c.on) ? c.on : EVENTS).filter((e) => EVENTS.includes(e)), detail: c.detail !== false, dashboardUrl: c.dashboardUrl ? String(c.dashboardUrl) : '' };
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
export async function notify(event, data, { projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd(), cfg = loadConfig(projectDir), timeoutMs = 5000 } = {}) {
  if (!cfg || !cfg.on.includes(event)) return { sent: false, reason: cfg ? 'evento desligado' : 'sem config' };
  const msg = { topic: cfg.topic, ...buildMessage(event, data || {}, cfg, readProjectName(projectDir)) };
  try {
    const r = await fetch(cfg.server, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) }, body: JSON.stringify(msg) });
    return { sent: r.ok, status: r.status };
  } catch (e) { return { sent: false, reason: String(e.message || e) }; }
}

// --- edição pelo painel ------------------------------------------------------------------
// o que a página mostra: o token nunca sai, só se existe
export function publicView(projectDir) {
  const c = readRaw() || {}, n = c.ntfy || {};
  const ov = c.projects && c.projects[projectKey(projectDir)];
  return { file: configFile(), configured: !!n.topic, disabledByEnv: process.env.AI_TEAM_NOTIFY === '0', events: EVENTS,
    server: n.server || 'https://ntfy.sh', topic: n.topic || '', hasToken: !!n.token,
    on: Array.isArray(c.on) ? c.on.filter((e) => EVENTS.includes(e)) : EVENTS, detail: c.detail !== false, dashboardUrl: c.dashboardUrl || '',
    project: { dir: projectKey(projectDir), on: ov && Array.isArray(ov.on) ? ov.on.filter((e) => EVENTS.includes(e)) : null } };
}

// body: { server, topic, token?, clearToken?, on, detail, dashboardUrl, projectOn: null | [eventos] }
export function updateConfig(projectDir, body) {
  const b = body || {};
  const server = String(b.server || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(server)) return { error: 'servidor deve ser http(s)://…' };
  const topic = String(b.topic || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) return { error: 'tópico: letras, números, - e _ (até 64)' };
  const evs = (x) => (Array.isArray(x) ? [...new Set(x.filter((e) => EVENTS.includes(e)))] : null);
  const on = evs(b.on); if (!on) return { error: 'on deve ser uma lista de eventos' };
  const dashboardUrl = String(b.dashboardUrl || '').trim();
  if (dashboardUrl && !/^https?:\/\/\S+$/.test(dashboardUrl)) return { error: 'endereço do painel deve ser http(s)://…' };
  const c = readRaw() || {};
  const token = b.clearToken ? '' : typeof b.token === 'string' && b.token.trim() ? b.token.trim() : (c.ntfy && c.ntfy.token) || '';
  const out = { ...c, ntfy: { server, topic, token }, on, detail: b.detail !== false, dashboardUrl };
  const key = projectKey(projectDir), projects = { ...(c.projects || {}) };
  if (b.projectOn === null || b.projectOn === undefined) delete projects[key];
  else { const po = evs(b.projectOn); if (!po) return { error: 'projectOn deve ser null ou uma lista' }; projects[key] = { on: po }; }
  if (Object.keys(projects).length) out.projects = projects; else delete out.projects;
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(configFile(), 0o600); } catch {}
  return { ok: true, view: publicView(projectDir) };
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
    if (fs.existsSync(f)) {   // já existe: só troca o tópico, se veio um diferente; o resto fica
      const c = readRaw();
      if (!c) { console.error(`${f} não é JSON válido; corrija ou apague`); process.exitCode = 1; return; }
      if (argv[1] && (!c.ntfy || c.ntfy.topic !== argv[1])) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(argv[1])) { console.error('tópico: letras, números, - e _ (até 64)'); process.exitCode = 2; return; }
        c.ntfy = { server: 'https://ntfy.sh', token: '', ...(c.ntfy || {}), topic: argv[1] };
        fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
        console.log(`tópico trocado para ${argv[1]} em ${f}`);
      } else console.log(`já configurado em ${f} (tópico ${c.ntfy && c.ntfy.topic})`);
      return;
    }
    if (argv[1] && !/^[A-Za-z0-9_-]{1,64}$/.test(argv[1])) { console.error('tópico: letras, números, - e _ (até 64)'); process.exitCode = 2; return; }
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

// realpath: no macOS /var é link para /private/var (o import.meta.url já vem resolvido)
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
