// ai-team — real-time context of a project (used by server.mjs).
//
// Each project has its own transcript cache, its own fs.watch and its own
// SSE clients. In the hub the watchers only open when the first client
// connects and close `idleMs` after the last one leaves; the cache is dropped
// after `dropMs` unused (sweep). In single-project mode the context is
// `persistent`: opens at startup and never closes.
//
// One computation per change: the context keeps the last computed state (`stored`). With SSE clients and
// nothing changed since the computation, GET /api/state returns the stored state instead of recomputing; an
// fs.watch event, a POST that changes state (markDirty) and the first client joining mark the state as
// "dirty". The `update` notice only goes out when the state differs from the last one announced, ignoring `generatedAt`
// (the dashboard's "updated" is the time of the last change); the polling tick always recomputes, because
// some changes depend only on time (running → no signal) or on folders fs.watch does not see.
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
  let stored = null, lastSig = '', dirty = true;   // stored state, last announced state, change since the computation

  // JSON without the timestamp: it is what gets compared to decide the notice
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
    if (clients.size && !dirty && stored) return stored.json;   // without clients there is no freshness guarantee: recompute
    return compute().json;
  }
  function broadcast(force = false) {
    if (!clients.size) return;
    lastUse = Date.now();
    if (force || dirty || !stored) compute();   // a GET that already recomputed after the change is reused
    if (stored.sig === lastSig) return;
    lastSig = stored.sig;
    for (const res of clients) res.write(`event: update\ndata: ${Date.now()}\n\n`);
  }
  const markDirty = () => { dirty = true; };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(() => broadcast(), debounceMs); };
  const onChange = () => { markDirty(); schedule(); };
  // folders that did not exist yet (transcripts before the first session) join on the next cycle
  function ensureWatch() {
    for (const d of watchDirs(projectDir, claudeDir)) if (!watchers.has(d)) { const w = openWatch(d, onChange); if (w) watchers.set(d, w); }
  }
  function start() {
    clearTimeout(idle); idle = null;
    if (poll) return;
    markDirty();   // the watchers were closed: the stored state may be old
    ensureWatch();
    poll = setInterval(() => { ensureWatch(); broadcast(true); }, pollMs);   // safety net: lost fs.watch
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
    if (first) { markDirty(); lastSig = compute().sig; }   // the starting state does not become a notice on the 1st tick
    // notice only for the new client: the tab that reconnected (or did the GET before /events opened) rereads the
    // state, which the GET serves from the stored one; the other clients are not notified
    res.write(`event: update\ndata: ${Date.now()}\n\n`);
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
