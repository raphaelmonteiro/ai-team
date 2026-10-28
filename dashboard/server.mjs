// ai-team — servidor do painel (sem dependências).
//
//   node dashboard/server.mjs [--project DIR] [--port 4321] [--host 127.0.0.1] [--claude-dir DIR] [--stale-min 15]
//   node dashboard/server.mjs --hub [ARQUIVO]      vários projetos, separados por time (registro: hub.mjs)
//
// Rotas de um projeto (na raiz, ou sob /p/<id>/ no hub):
//        /            painel (index.html)
//        /api/state   estado em JSON (collect.mjs); `pending` = decisões esperando resposta (ask.mjs)
//        /api/answer  POST JSON { id, behavior: allow|deny, message?, answers? }: responde uma decisão
//        /notificacoes, /api/notify (GET/POST), /api/notify/test (POST)  config do ntfy (notify.mjs)
//        /api/away    GET/POST { on }: modo longe do computador (ask.mjs, hook Stop)
//        /feed.mjs    lógica pura da conversa do drawer (importada pelo index.html)
//        /equipe      página da equipe, montada no navegador a partir de /api/team; o trecho
//                     "ciclo de uma change" vem de cycle.html (perfil) ou cycle-default.html
//        /api/team    agentes de .claude/agents/*.md (frontmatter) + chaves públicas do ai-team.conf
//        /changes/<id>/<arquivo>.md  .md da change (proposal, tasks, design, review-report, qa-report, specs/**; text/plain)
//        /agents/<nome>.md  definição do agente (.claude/agents/<nome>.md do projeto, text/plain)
//        /events      Server-Sent Events: "update" quando um transcript ou o
//                     openspec/ do projeto muda (fs.watch; fallback a cada 5 s)
// Acesso: local (127.0.0.1, sem proxy) livre; de fora (Tailscale Serve, túnel, --host 0.0.0.0) só com o
// token (auth.mjs): /login põe o cookie; Bearer também vale. Sem token, o acesso de fora é recusado.
// Rotas do hub:
//        /, /t/<time>[/<projeto>]  abas por time e por projeto (hub.html)
//        /api/hub     times, projetos e um resumo barato de cada um (sem ler transcripts)
//        /p/<id>/...  as rotas do projeto acima. Só o projeto aberto fica em tempo
//                     real: os watchers abrem com o primeiro /events e fecham 60 s
//                     depois que o último cliente sai.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { projectSlug, DEFAULT_STALE_MIN } from './collect.mjs';
import { parseChangePath, resolveChangeFile } from './board.mjs';
import { createProjectContext } from './live.mjs';
import { defaultHubFile, loadHub, findProject, projectSummary } from './hub.mjs';
import { teamInfo } from './team.mjs';
import { writeAnswer, getAway, setAway } from './ask.mjs';
import { loadToken, gate } from './auth.mjs';
import { publicView, updateConfig, loadConfig as loadNotify, notify, EVENTS as NOTIFY_EVENTS } from './notify.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const claudeDir = path.resolve(opt('--claude-dir', process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')));
const port = Number(opt('--port', process.env.PORT || 4321));
const host = opt('--host', '127.0.0.1');
const staleMin = Number(opt('--stale-min', process.env.AI_TEAM_STALE_MIN || DEFAULT_STALE_MIN)) || DEFAULT_STALE_MIN;
const idleMs = Number(process.env.AI_TEAM_IDLE_MS) || 60e3;   // hub: quanto o projeto fica vivo depois do último cliente
const here = path.dirname(new URL(import.meta.url).pathname);
const hubIdx = args.indexOf('--hub');
const hubFile = hubIdx < 0 ? null : path.resolve(args[hubIdx + 1] && !args[hubIdx + 1].startsWith('--') ? args[hubIdx + 1] : defaultHubFile());

const sendText = (res, req, type, body) => {
  res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store', ...(type === 'text/plain' ? { 'x-content-type-options': 'nosniff' } : {}) });
  res.end(req.method === 'HEAD' ? undefined : body);
};
const notFound = (res) => { res.writeHead(404); res.end('não encontrado'); };
// cópias antigas de cycle.html (perfil) usam caminhos absolutos; no hub eles ganham o prefixo do projeto
const rebase = (html, prefix) => !prefix ? html : String(html)
  .replace(/(["'`(])\/(api\/state|api\/team|events|equipe|feed\.mjs|agents\/|changes\/)/g, `$1${prefix}/$2`)
  .replace(/href="\/"/g, `href="${prefix}/"`);

// Página da equipe: equipe.html com o marcador do ciclo trocado pelo cycle.html do perfil
// (se existir) ou pelo cycle-default.html. O trecho entra no HTML, então pode ter <style>/<script>.
// Projeto único: tudo ao lado do server.mjs (a cópia instalada). Hub: página e ciclo padrão do
// hub, cycle.html do perfil vindo do .claude/dashboard/ do projeto.
function equipeHtml(projectDir, hubMode) {
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  const page = read(path.join(here, 'equipe.html')) || '<!doctype html><title>equipe</title><p>equipe.html ausente';
  const cycle = read(path.join(hubMode ? path.join(projectDir, '.claude', 'dashboard') : here, 'cycle.html'))
    ?? read(path.join(here, 'cycle-default.html')) ?? '';
  return page.replace('<!--ai-team:cycle-->', () => cycle);
}

// POST com corpo JSON: só JSON, só da mesma origem (o navegador não manda JSON entre origens sem preflight)
const sendJson = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(o)); };
function postJson(req, res, handle) {
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'use POST' });
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return sendJson(res, 415, { error: 'content-type deve ser application/json' });
  const origin = req.headers.origin;
  if (origin) {   // atrás de proxy (Tailscale Serve, túnel) o host original pode vir em X-Forwarded-Host
    let h = null; try { h = new URL(origin).host; } catch {}
    const hosts = [req.headers.host, ...String(req.headers['x-forwarded-host'] || '').split(',').map((x) => x.trim())].filter(Boolean);
    if (!hosts.includes(h)) return sendJson(res, 403, { error: 'origem recusada' });
  }
  let body = '';
  req.on('data', (d) => { body += d; if (body.length > 65536) req.destroy(); });
  req.on('end', async () => {
    let o; try { o = JSON.parse(body || '{}'); } catch { return sendJson(res, 400, { error: 'JSON inválido' }); }
    try { const r = await handle(o); sendJson(res, r.ok ? 200 : r.code || 409, r); } catch (e) { sendJson(res, 500, { error: String(e.message || e) }); }
  });
}

// rotas de um projeto; `sub` começa com "/"; devolve false se a rota não é dele
function serveProject(ctx, sub, req, res, prefix = '') {
  const projectDir = ctx.projectDir;
  if (sub === '/api/answer') { postJson(req, res, (o) => writeAnswer(projectDir, o)); return true; }
  if (sub === '/api/away') {   // modo longe do computador: o hook Stop espera a resposta do fim do turno pelo painel
    if (req.method === 'GET' || req.method === 'HEAD') { sendJson(res, 200, getAway(projectDir)); return true; }
    postJson(req, res, (o) => ({ ok: true, ...setAway(projectDir, o.on === true) })); return true;
  }
  if (sub === '/api/notify') {
    if (req.method === 'GET' || req.method === 'HEAD') { sendJson(res, 200, publicView(projectDir)); return true; }
    postJson(req, res, (o) => { const r = updateConfig(projectDir, o); return r.error ? { ...r, code: 400 } : r; }); return true;
  }
  if (sub === '/api/notify/test') {
    postJson(req, res, async () => {
      const cfg = loadNotify(projectDir);
      if (!cfg) return { error: 'sem tópico configurado', code: 400 };
      const r = await notify('turn_stop', { last_assistant_message: 'Notificação de teste do ai-team (pelo painel).' }, { projectDir, cfg: { ...cfg, on: NOTIFY_EVENTS } });
      return r.sent ? { ok: true } : { error: `não enviado: ${r.reason || r.status}`, code: 502 };
    }); return true;
  }
  if (sub === '/notificacoes') { sendText(res, req, 'text/html', fs.readFileSync(path.join(here, 'notificacoes.html'))); return true; }
  if (sub === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(ctx.snapshot()); return true;
  }
  if (sub === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    ctx.subscribe(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); ctx.unsubscribe(res); });
    return true;
  }
  if (sub === '/' || sub === '/index.html') { sendText(res, req, 'text/html', fs.readFileSync(path.join(here, 'index.html'))); return true; }
  if (sub === '/feed.mjs') { sendText(res, req, 'text/javascript', fs.readFileSync(path.join(here, 'feed.mjs'))); return true; }
  if (sub === '/api/team') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(teamInfo(projectDir))); return true;
  }
  if (sub === '/equipe') { sendText(res, req, 'text/html', rebase(equipeHtml(projectDir, !!prefix), prefix)); return true; }
  if (sub.startsWith('/changes/')) {
    const cp = parseChangePath(sub);
    const f = cp && resolveChangeFile(projectDir, cp.id, cp.segments);
    if (!f) { notFound(res); return true; }
    sendText(res, req, 'text/plain', fs.readFileSync(f)); return true;
  }
  const am = /^\/agents\/([a-z0-9-]+)\.md$/.exec(sub);
  if (am) {
    const f = path.join(projectDir, '.claude', 'agents', `${am[1]}.md`);
    if (!fs.existsSync(f)) { notFound(res); return true; }
    sendText(res, req, 'text/plain', fs.readFileSync(f)); return true;
  }
  return false;
}

// --- hub ---------------------------------------------------------------------
const hub = { mtime: -1, data: { teams: [], warnings: [] }, error: null };
const contexts = new Map();    // id → contexto (só os projetos já abertos)
const summaries = new Map();   // id → { at, dir, data }
const SUMMARY_TTL = 20e3;

function readHub() {   // relê o registro quando o arquivo muda (hub.mjs add/remove, edição à mão)
  let m = 0;
  try { m = fs.statSync(hubFile).mtimeMs; } catch { m = 0; }
  if (m === hub.mtime) return hub;
  hub.mtime = m;
  try { hub.data = loadHub(hubFile); hub.error = null; } catch (e) { hub.error = e.message; }
  for (const [id, ctx] of contexts) {   // projeto removido ou com outra pasta: fecha o contexto
    const f = findProject(hub.data, id);
    if (!f || f.project.dir !== ctx.projectDir) { ctx.stop(); contexts.delete(id); }
  }
  return hub;
}
function contextOf(id) {
  const f = findProject(readHub().data, id);
  if (!f) return null;
  let ctx = contexts.get(id);
  if (!ctx) { ctx = createProjectContext({ projectDir: f.project.dir, claudeDir, staleMin, idleMs }); contexts.set(id, ctx); }
  return ctx;
}
function hubState() {
  const { data, error } = readHub();
  const now = Date.now();
  const teams = data.teams.map((t) => ({ id: t.id, name: t.name, projects: t.projects.map((p) => {
    let s = summaries.get(p.id);
    if (!s || s.dir !== p.dir || now - s.at > SUMMARY_TTL) { s = { at: now, dir: p.dir, data: projectSummary({ dir: p.dir, claudeDir, staleMin, now }) }; summaries.set(p.id, s); }
    const ctx = contexts.get(p.id);
    return { ...p, ...s.data, live: !!(ctx && ctx.live), viewers: ctx ? ctx.clients : 0 };
  }) }));
  return { generatedAt: now, hubFile, staleMin, error, warnings: data.warnings, teams };
}
if (hubFile) setInterval(() => { for (const ctx of contexts.values()) ctx.sweep(); }, 60e3).unref();

// --- projeto único -------------------------------------------------------------
const single = hubFile ? null : createProjectContext({
  projectDir: path.resolve(opt('--project', process.env.AI_TEAM_PROJECT || process.cwd())), claudeDir, staleMin, persistent: true,
});

const token = loadToken();
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;
  if (p === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (!gate(req, res, token)) return;
  if (single) { if (!serveProject(single, p, req, res)) notFound(res); return; }
  if (p === '/' || p === '/index.html' || /^\/t\/[a-z0-9-]+(\/[a-z0-9-]+)?\/?$/.test(p)) { sendText(res, req, 'text/html', fs.readFileSync(path.join(here, 'hub.html'))); return; }
  if (p === '/api/hub') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(hubState())); return;
  }
  const m = /^\/p\/([a-z0-9-]+)(\/.*)?$/.exec(p);
  if (m) {
    const ctx = contextOf(m[1]);
    if (!ctx) { notFound(res); return; }
    if (!m[2]) { res.writeHead(301, { location: `/p/${m[1]}/${url.search}` }); res.end(); return; }
    if (!serveProject(ctx, m[2], req, res, `/p/${m[1]}`)) notFound(res);
    return;
  }
  notFound(res);
});
server.listen(port, host, () => {
  const remote = token ? 'de fora só com token (/login)' : 'de fora recusado (sem token: node dashboard/auth.mjs token)';
  if (single) {
    console.log(`ai-team painel: http://${host}:${port}/`);
    console.log(`  projeto:   ${single.projectDir}`);
    console.log(`  transcripts: ${path.join(claudeDir, 'projects', projectSlug(single.projectDir))}`);
    console.log(`  observando: ${single.watched.length ? single.watched.join(', ') : '(nada ainda; só polling)'}`);
    console.log(`  acesso:    local livre; ${remote}`);
  } else {
    const { data, error } = readHub();
    console.log(`ai-team hub: http://${host}:${port}/`);
    console.log(`  registro:  ${hubFile}${fs.existsSync(hubFile) ? '' : ' (ainda não existe)'}`);
    console.log(error ? `  erro: ${error}` : `  ${data.teams.length} time(s), ${data.teams.reduce((n, t) => n + t.projects.length, 0)} projeto(s); tempo real só no projeto aberto`);
    for (const w of data.warnings) console.log(`  ! ${w}`);
    console.log(`  acesso:    local livre; ${remote}`);
  }
});
