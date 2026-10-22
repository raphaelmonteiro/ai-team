// ai-team — servidor do painel (sem dependências).
//
//   node dashboard/server.mjs [--project DIR] [--port 4321] [--host 127.0.0.1] [--claude-dir DIR]
//
// Rotas: /            painel (index.html)
//        /api/state   estado em JSON (collect.mjs)
//        /equipe      página da equipe (equipe.html, só se existir; perfil plato)
//        /agents/<nome>.md  definição do agente (.claude/agents/<nome>.md do projeto, text/plain)
//        /events      Server-Sent Events: "update" quando um transcript ou o
//                     openspec/ do projeto muda (fs.watch; fallback a cada 5 s)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { collect, projectSlug } from './collect.mjs';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const projectDir = path.resolve(opt('--project', process.env.AI_TEAM_PROJECT || process.cwd()));
const claudeDir = path.resolve(opt('--claude-dir', process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude')));
const port = Number(opt('--port', process.env.PORT || 4321));
const host = opt('--host', '127.0.0.1');
const here = path.dirname(new URL(import.meta.url).pathname);

const clients = new Set();
let lastJson = '';
let timer = null;

function snapshot() {
  try { return JSON.stringify(collect({ projectDir, claudeDir })); }
  catch (e) { return JSON.stringify({ error: String(e && e.stack || e), generatedAt: Date.now() }); }
}
function broadcast(force = false) {
  const json = snapshot();
  if (!force && json === lastJson) return;
  lastJson = json;
  for (const res of clients) res.write(`event: update\ndata: ${Date.now()}\n\n`);
}
function schedule() { clearTimeout(timer); timer = setTimeout(() => broadcast(), 400); }

function watch(dir) {
  if (!fs.existsSync(dir)) return false;
  try { fs.watch(dir, { recursive: true }, schedule); return true; }
  catch { try { fs.watch(dir, schedule); return true; } catch { return false; } }
}
const watched = [
  path.join(claudeDir, 'projects', projectSlug(projectDir)),
  path.join(projectDir, 'openspec', 'changes'),
  path.join(projectDir, '.claude', 'ai-team'),
].filter(watch);
setInterval(() => broadcast(), 5000).unref();   // rede de segurança: arquivos novos, fs.watch perdido

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(snapshot()); return;
  }
  if (url.pathname === '/events') {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); clients.delete(res); });
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(path.join(here, 'index.html'))); return;
  }
  if (url.pathname === '/equipe') {
    const f = path.join(here, 'equipe.html');
    if (!fs.existsSync(f)) { res.writeHead(404); res.end('não encontrado'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(f)); return;
  }
  const am = /^\/agents\/([a-z0-9-]+)\.md$/.exec(url.pathname);
  if (am) {
    const f = path.join(projectDir, '.claude', 'agents', `${am[1]}.md`);
    if (!fs.existsSync(f)) { res.writeHead(404); res.end('não encontrado'); return; }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
    res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(f)); return;
  }
  if (url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(404); res.end('não encontrado');
});
server.listen(port, host, () => {
  console.log(`ai-team painel: http://${host}:${port}/`);
  console.log(`  projeto:   ${projectDir}`);
  console.log(`  transcripts: ${path.join(claudeDir, 'projects', projectSlug(projectDir))}`);
  console.log(`  observando: ${watched.length ? watched.join(', ') : '(nada ainda; só polling)'}`);
});
