// ai-team — contexto de tempo real de um projeto (usado pelo server.mjs).
//
// Cada projeto tem o seu cache de transcripts, os seus fs.watch e os seus
// clientes SSE. No hub os watchers só abrem quando o primeiro cliente se
// conecta e fecham `idleMs` depois que o último sai; o cache é descartado
// depois de `dropMs` sem uso (sweep). No modo de projeto único o contexto é
// `persistent`: abre na partida e não fecha.
//
// Um cálculo por mudança: o contexto guarda o último estado calculado (`stored`). Com clientes SSE e
// nada mudado desde o cálculo, o GET /api/state devolve o estado guardado em vez de recalcular; evento
// de fs.watch, POST que altera estado (markDirty) e entrada do primeiro cliente marcam o estado como
// "sujo". O aviso `update` só sai quando o estado difere do último avisado, sem contar `generatedAt`
// (o "atualizado" do painel é a hora da última mudança); o tick do polling sempre recalcula, porque
// há mudanças que dependem só do tempo (rodando → sem sinal) ou de pastas que o fs.watch não vê.
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
  idleMs = 60e3, dropMs = 15 * 60e3, pollMs = 5000, debounceMs = 400, collectFn = collect } = {}) {
  const clients = new Set();
  const watchers = new Map();   // dir → FSWatcher
  let cache = null, timer = null, poll = null, idle = null, lastUse = 0;
  let stored = null, lastSig = '', dirty = true;   // estado guardado, último estado avisado, mudança desde o cálculo

  // JSON sem o carimbo de hora: é o que se compara para decidir o aviso
  const signature = (json) => json.replace(/^\{"generatedAt":\d+/, '{').replace(/,"generatedAt":\d+\}$/, '}');
  function compute() {
    cache ||= createTranscriptCache();
    let json;
    try { json = JSON.stringify(collectFn({ projectDir, claudeDir, cache, staleMin })); }
    catch (e) { json = JSON.stringify({ error: String(e && e.stack || e), generatedAt: Date.now() }); }
    stored = { json, sig: signature(json) };
    dirty = false;
    return stored;
  }
  function snapshot() {
    lastUse = Date.now();
    if (clients.size && !dirty && stored) return stored.json;   // sem cliente não há garantia de frescor: recalcula
    return compute().json;
  }
  function broadcast(force = false) {
    if (!clients.size) return;
    lastUse = Date.now();
    if (force || dirty || !stored) compute();   // um GET que já recalculou depois da mudança é reaproveitado
    if (stored.sig === lastSig) return;
    lastSig = stored.sig;
    for (const res of clients) res.write(`event: update\ndata: ${Date.now()}\n\n`);
  }
  const markDirty = () => { dirty = true; };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => broadcast(), debounceMs); };
  const onChange = () => { markDirty(); schedule(); };
  // pastas que ainda não existiam (transcripts antes da primeira sessão) entram no próximo ciclo
  function ensureWatch() {
    for (const d of watchDirs(projectDir, claudeDir)) if (!watchers.has(d)) { const w = openWatch(d, onChange); if (w) watchers.set(d, w); }
  }
  function start() {
    clearTimeout(idle); idle = null;
    if (poll) return;
    markDirty();   // os watchers estavam fechados: o estado guardado pode ser antigo
    ensureWatch();
    poll = setInterval(() => { ensureWatch(); broadcast(true); }, pollMs);   // rede de segurança: fs.watch perdido
    poll.unref?.();
  }
  function stop() {
    clearTimeout(idle); idle = null; clearTimeout(timer); clearInterval(poll); poll = null;
    markDirty();
    for (const w of watchers.values()) { try { w.close(); } catch {} }
    watchers.clear();
  }
  function subscribe(res) {
    const first = !clients.size;
    clients.add(res); start();
    if (first) { markDirty(); lastSig = compute().sig; }   // o estado de partida não vira aviso no 1º tick
  }
  function unsubscribe(res) {
    clients.delete(res);
    if (clients.size || persistent) return;
    clearTimeout(idle); idle = setTimeout(stop, idleMs); idle.unref?.();
  }
  function sweep(now = Date.now()) {
    if (!clients.size && cache && now - lastUse > dropMs) { cache = null; stored = null; lastSig = ''; dirty = true; }
  }
  if (persistent) start();
  return {
    projectDir, snapshot, markDirty, subscribe, unsubscribe, start, stop, sweep,
    get live() { return !!poll; }, get clients() { return clients.size; },
    get watched() { return [...watchers.keys()]; }, get cached() { return !!cache; },
  };
}
