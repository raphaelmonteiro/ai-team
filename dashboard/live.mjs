// ai-team — contexto de tempo real de um projeto (usado pelo server.mjs).
//
// Cada projeto tem o seu cache de transcripts, os seus fs.watch e os seus
// clientes SSE. No hub os watchers só abrem quando o primeiro cliente se
// conecta e fecham `idleMs` depois que o último sai; o cache é descartado
// depois de `dropMs` sem uso (sweep). No modo de projeto único o contexto é
// `persistent`: abre na partida e não fecha.
import fs from 'node:fs';
import path from 'node:path';
import { collect, projectSlug, createTranscriptCache } from './collect.mjs';

export const watchDirs = (projectDir, claudeDir) => [
  path.join(claudeDir, 'projects', projectSlug(projectDir)),
  path.join(projectDir, 'openspec', 'changes'),
  path.join(projectDir, '.claude', 'ai-team'),
];

function openWatch(dir, cb) {
  if (!fs.existsSync(dir)) return null;
  let w = null;
  try { w = fs.watch(dir, { recursive: true }, cb); }
  catch { try { w = fs.watch(dir, cb); } catch { return null; } }
  w.on('error', () => {});
  return w;
}

export function createProjectContext({ projectDir, claudeDir, staleMin, persistent = false,
  idleMs = 60e3, dropMs = 15 * 60e3, pollMs = 5000, debounceMs = 400 } = {}) {
  const clients = new Set();
  const watchers = new Map();   // dir → FSWatcher
  let cache = null, lastJson = '', timer = null, poll = null, idle = null, lastUse = 0;

  function snapshot() {
    lastUse = Date.now();
    cache ||= createTranscriptCache();
    try { return JSON.stringify(collect({ projectDir, claudeDir, cache, staleMin })); }
    catch (e) { return JSON.stringify({ error: String(e && e.stack || e), generatedAt: Date.now() }); }
  }
  function broadcast() {
    if (!clients.size) return;
    const json = snapshot();
    if (json === lastJson) return;
    lastJson = json;
    for (const res of clients) res.write(`event: update\ndata: ${Date.now()}\n\n`);
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(broadcast, debounceMs); };
  // pastas que ainda não existiam (transcripts antes da primeira sessão) entram no próximo ciclo
  function ensureWatch() {
    for (const d of watchDirs(projectDir, claudeDir)) if (!watchers.has(d)) { const w = openWatch(d, schedule); if (w) watchers.set(d, w); }
  }
  function start() {
    clearTimeout(idle); idle = null;
    if (poll) return;
    ensureWatch();
    poll = setInterval(() => { ensureWatch(); broadcast(); }, pollMs);   // rede de segurança: fs.watch perdido
    poll.unref?.();
  }
  function stop() {
    clearTimeout(idle); idle = null; clearTimeout(timer); clearInterval(poll); poll = null;
    for (const w of watchers.values()) { try { w.close(); } catch {} }
    watchers.clear();
  }
  function subscribe(res) { clients.add(res); start(); }
  function unsubscribe(res) {
    clients.delete(res);
    if (clients.size || persistent) return;
    clearTimeout(idle); idle = setTimeout(stop, idleMs); idle.unref?.();
  }
  function sweep(now = Date.now()) {
    if (!clients.size && cache && now - lastUse > dropMs) { cache = null; lastJson = ''; }
  }
  if (persistent) start();
  return {
    projectDir, snapshot, subscribe, unsubscribe, start, stop, sweep,
    get live() { return !!poll; }, get clients() { return clients.size; },
    get watched() { return [...watchers.keys()]; }, get cached() { return !!cache; },
  };
}
