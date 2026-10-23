// ai-team — coletor do painel.
//
// Lê os transcripts do Claude Code (~/.claude/projects/<slug>/) e o openspec/
// do projeto e monta o estado do painel: changes, rodadas de cada agente
// (início, fim, tokens, modelo, de quem veio, para quem foi) e esforço por
// agente. Só lê arquivos; não precisa de hook (o hook só refina início/fim).
//
//   node dashboard/collect.mjs [projeto] [--claude-dir DIR] [--json]
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parseTasks, waitingFor, splitChanges, inferStage, inferTask, flowOf, changeFiles } from './board.mjs';
import { stageCounts, buildTrail } from './stages.mjs';

export const projectSlug = (dir) => dir.replace(/[^a-zA-Z0-9]/g, '-');

const STATUS_ORDER = { 'em andamento': 0, bloqueada: 1, pendente: 2, 'concluída': 3, avulsa: 4 };
const MAIN_AGENT_FALLBACK = 'tech-lead';

// ---------------------------------------------------------------------------
// utilitários
// ---------------------------------------------------------------------------
function readJsonl(file) {
  const out = [];
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* linha parcial em escrita */ }
  }
  return out;
}
const ts = (r) => (r && r.timestamp ? Date.parse(r.timestamp) : NaN);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function contentText(message) {
  const c = message && message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c.filter((b) => b && b.type === 'text').map((b) => b.text).join('\n');
}
function contentBlocks(message, type) {
  const c = message && message.content;
  return Array.isArray(c) ? c.filter((b) => b && b.type === type) : [];
}
function isRealPrompt(rec) {
  if (rec.type !== 'user' || rec.isMeta) return false;
  const c = rec.message && rec.message.content;
  if (typeof c === 'string') return !c.startsWith('<task-notification>') && !c.startsWith('<system-reminder>');
  if (!Array.isArray(c)) return false;
  if (c.some((b) => b.type === 'tool_result')) return false;
  const t = contentText(rec.message);
  return t.length > 0 && !t.startsWith('<task-notification>');
}

// soma usage de registros assistant, sem contar duas vezes a mesma resposta
// (o transcript grava um registro por bloco de conteúdo com o mesmo requestId).
// Acumulador: aceita registros aos poucos (leitura incremental do transcript).
class UsageAcc {
  constructor() {
    this.seen = new Set();
    this.u = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, requests: 0 };
    this.models = new Map();
    this.toolUses = 0;
  }
  add(r) {
    if (r.type !== 'assistant' || !r.message) return;
    this.toolUses += contentBlocks(r.message, 'tool_use').length;
    const key = r.requestId || (r.message.id ? `id:${r.message.id}` : r.uuid);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const us = r.message.usage || {}, u = this.u;
    u.input += num(us.input_tokens);
    u.output += num(us.output_tokens);
    u.cacheRead += num(us.cache_read_input_tokens);
    u.cacheCreation += num(us.cache_creation_input_tokens);
    u.requests += 1;
    const m = r.message.model || r.requestedModel;
    if (m) this.models.set(m, (this.models.get(m) || 0) + 1);
  }
  result() {   // objeto novo a cada chamada: o acumulador continua crescendo
    const { input, output, cacheRead, cacheCreation, requests } = this.u;
    const u = { input, output, cacheRead, cacheCreation, total: input + output + cacheRead + cacheCreation, requests };
    const model = [...this.models.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || null;
    return { usage: u, model, models: [...this.models.keys()], toolUses: this.toolUses };
  }
}

// ---------------------------------------------------------------------------
// leitura incremental de transcripts (cache por arquivo)
// ---------------------------------------------------------------------------
// O cache (um Map, vivo no processo do servidor) guarda, por arquivo, o estado
// já analisado + o deslocamento do último byte consumido. Chave: tamanho+mtime.
//  - inalterado: devolve o estado guardado;
//  - só cresceu (append) e os últimos bytes antes do deslocamento batem: lê só
//    o trecho novo e alimenta o mesmo estado;
//  - qualquer outra mudança: relê o arquivo inteiro.
// Só linhas completas (terminadas em \n) são consumidas; um final sem \n que já
// é JSON válido entra como hoje, mas marca o arquivo para releitura completa
// no próximo append (a linha ainda pode estar sendo escrita).
const TAIL_CHECK = 64;
export const createTranscriptCache = () => new Map();

function readTranscript(file, cache, { init, feed }) {
  let st;
  try { st = fs.statSync(file); } catch { cache.delete(file); return { state: init(), mtime: 0 }; }
  const prev = cache.get(file);
  if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return { state: prev.state, mtime: st.mtimeMs };
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { cache.delete(file); return { state: init(), mtime: 0 }; }
  try {
    let entry = null, from = 0;
    if (prev && !prev.openTail && st.size > prev.size && prev.offset > 0) {
      const n = Math.min(TAIL_CHECK, prev.offset);
      const head = Buffer.alloc(n);
      fs.readSync(fd, head, 0, n, prev.offset - n);
      if (head.equals(prev.tail)) { entry = prev; from = prev.offset; }
    }
    const state = entry ? entry.state : init();
    const pre = Math.min(TAIL_CHECK, from);
    const want = st.size - (from - pre);
    const buf = Buffer.alloc(want);
    let got = 0;
    while (got < want) {
      const k = fs.readSync(fd, buf, got, want - got, from - pre + got);
      if (!k) break;
      got += k;
    }
    const data = buf.subarray(pre, got);
    const feedLine = (a, b) => {
      if (a >= b) return false;
      let rec;
      try { rec = JSON.parse(data.toString('utf8', a, b)); } catch { return false; }
      if (rec && typeof rec === 'object') feed(state, rec);
      return true;
    };
    let pos = 0, nl;
    while ((nl = data.indexOf(10, pos)) >= 0) { feedLine(pos, nl); pos = nl + 1; }
    let openTail = false;
    if (pos < data.length && feedLine(pos, data.length)) { openTail = true; pos = data.length; }
    const consumed = pre + pos;     // bytes de buf já consumidos
    cache.set(file, { size: from - pre + got, mtimeMs: st.mtimeMs, offset: from - pre + consumed, openTail, state,
      tail: Buffer.from(buf.subarray(Math.max(0, consumed - TAIL_CHECK), consumed)) });
    return { state, mtime: st.mtimeMs };
  } finally { fs.closeSync(fd); }
}

function usageFromResult(us) {
  if (!us) return null;
  const u = {
    input: num(us.input_tokens), output: num(us.output_tokens),
    cacheRead: num(us.cache_read_input_tokens), cacheCreation: num(us.cache_creation_input_tokens),
  };
  u.total = u.input + u.output + u.cacheRead + u.cacheCreation;
  return u;
}
// tokens brutos somados; "novos" = input + output + cache creation, "cache lido" = cache read
const zeroTok = () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 });
function addTok(t, u) { t.input += u.input; t.output += u.output; t.cacheRead += u.cacheRead; t.cacheCreation += u.cacheCreation; return t; }
const withSplit = (t) => ({ ...t, fresh: t.input + t.output + t.cacheCreation, cached: t.cacheRead });
const sumTok = (list) => withSplit(list.reduce((t, r) => addTok(t, r.usage), zeroTok()));
const shortModel = (m) => (m ? m.replace(/^claude-/, '').replace(/-\d{8}$/, '') : null);

// ---------------------------------------------------------------------------
// openspec: changes e estado das tasks
// ---------------------------------------------------------------------------
export function readChanges(projectDir) {
  const base = path.join(projectDir, 'openspec', 'changes');
  const changes = new Map();
  const add = (id, dir, archived, archiveName) => {
    const c = { id, dir: path.relative(projectDir, dir), archived, tasks: { total: 0, done: 0, blocked: 0 },
      review: null, reviewRounds: [], qa: null, sections: {}, updatedAt: null, createdAt: null, archivedOn: null, header: '', taskList: [], files: [] };
    try { const st = fs.statSync(dir); c.updatedAt = st.mtimeMs; c.createdAt = st.birthtimeMs || null; } catch { /* ignore */ }
    const am = archiveName && archiveName.match(/^(\d{4}-\d{2}-\d{2})-/);
    if (am) c.archivedOn = Date.parse(`${am[1]}T12:00:00`);
    c.files = changeFiles(dir);
    const tasksFile = path.join(dir, 'tasks.md');
    if (fs.existsSync(tasksFile)) {
      try { c.updatedAt = Math.max(c.updatedAt || 0, fs.statSync(tasksFile).mtimeMs); } catch { /* ignore */ }
      const text = fs.readFileSync(tasksFile, 'utf8');
      for (const m of text.matchAll(/^##\s*\d\.\s*(.+)/gm)) c.sections[m[1].replace(/\s+/g, ' ').trim()] = { total: 0, done: 0 };
      const parsed = parseTasks(text);
      c.header = parsed.header;
      c.taskList = parsed.tasks.map((t) => ({ id: t.id, done: t.done, section: t.section, blocked: t.blocked, deps: t.deps, text: t.text }));
      for (const t of parsed.tasks) {
        c.tasks.total++; if (t.done) c.tasks.done++;
        if (!t.done && t.blocked) c.tasks.blocked++;
        if (t.section && c.sections[t.section]) { c.sections[t.section].total++; if (t.done) c.sections[t.section].done++; }
      }
    }
    const results = (file, re) => {
      const f = path.join(dir, file);
      if (!fs.existsSync(f)) return null;
      return [...fs.readFileSync(f, 'utf8').matchAll(re)].map((m) => m[1].trim());
    };
    const lastOf = (list) => (list === null ? null : list.length ? list[list.length - 1] : 'sem resultado');
    const revList = results('review-report.md', /Resultado:\s*([^\n|]+)/g);
    c.reviewRounds = revList || [];
    c.review = lastOf(revList);
    c.qa = lastOf(results('qa-report.md', /Resultado:\s*([^\n|]+)/g));
    changes.set(id, c);
  };
  const list = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return []; } };
  for (const name of list(base)) {
    if (name === 'archive') continue;
    add(name, path.join(base, name), false);
  }
  for (const name of list(path.join(base, 'archive'))) {
    const id = name.replace(/^\d{4}-\d{2}-\d{2}-/, '');
    if (!changes.has(id)) add(id, path.join(base, 'archive', name), true, name);
    else changes.get(id).archived = true;
  }
  return changes;
}

function attributeChange(text, changeIds) {
  const t = String(text || '');
  const m = t.match(/openspec\/changes\/(?:archive\/\d{4}-\d{2}-\d{2}-)?([a-z0-9][a-z0-9._-]*)/i);
  // 'openspec/changes/add-x-*' (glob) não é um id: ids não terminam em - . _
  if (m && m[1] !== 'archive' && !/[-._]$/.test(m[1])) return m[1];
  let best = null;
  for (const id of changeIds) {
    const re = new RegExp(`(^|[^a-z0-9-])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9-]|$)`, 'i');
    if (re.test(t) && (!best || id.length > best.length)) best = id;
  }
  return best;
}

// ---------------------------------------------------------------------------
// hooks opcionais: .claude/ai-team/events.jsonl (dashboard/hook.sh)
// ---------------------------------------------------------------------------
function readHookEvents(projectDir) {
  const file = path.join(projectDir, '.claude', 'ai-team', 'events.jsonl');
  const byAgent = new Map();
  for (const e of readJsonl(file)) {
    if (!e.agent_id) continue;
    const cur = byAgent.get(e.agent_id) || {};
    const t = e.ts ? Date.parse(e.ts) : NaN;
    if (e.event === 'SubagentStart') cur.start = t; cur.type = cur.type || e.agent_type;
    if (e.event === 'SubagentStop') cur.stop = t;
    byAgent.set(e.agent_id, cur);
  }
  return byAgent;
}

// ---------------------------------------------------------------------------
// sessões do Claude Code
// ---------------------------------------------------------------------------
function findProjectDirs(claudeDir, projectDir) {
  const root = path.join(claudeDir, 'projects');
  const slug = projectSlug(projectDir);
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name); } catch { return out; }
  if (entries.includes(slug)) out.push(path.join(root, slug));
  // sessões abertas noutro caminho para o mesmo projeto (symlink, outro usuário)
  for (const name of entries) {
    if (name === slug) continue;
    const dir = path.join(root, name);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).slice(0, 3); } catch { continue; }
    for (const f of files) {
      const first = readJsonl(path.join(dir, f)).find((r) => r.cwd);
      if (first && path.resolve(first.cwd) === path.resolve(projectDir)) { out.push(dir); break; }
    }
  }
  return out;
}

// sessões do Claude Code em execução (~/.claude/sessions/<pid>.json), por sessionId
function liveSessions(claudeDir) {
  const live = new Set();
  const dir = path.join(claudeDir, 'sessions');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return live; }
  for (const f of files) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!s.sessionId || !s.pid) continue;
      process.kill(s.pid, 0);            // lança se o processo não existe
      live.add(s.sessionId);
    } catch { /* arquivo órfão ou processo morto */ }
  }
  return live;
}

function readMainAgentName(projectDir) {
  try {
    const s = JSON.parse(fs.readFileSync(path.join(projectDir, '.claude', 'settings.json'), 'utf8'));
    if (typeof s.agent === 'string') return s.agent;
  } catch { /* ignore */ }
  return MAIN_AGENT_FALLBACK;
}

const newSessionState = (sessionId) => ({ sessionId, count: 0, calls: new Map(), results: new Map(), notifications: new Map(),
  turns: [], turn: null, usage: new UsageAcc(), first: null, last: null });

function feedSession(S, r) {
  S.count++;
  const t = ts(r);
  if (t && !S.first) S.first = r;
  if (t) S.last = r;
  S.usage.add(r);
  if (r.type === 'assistant' && r.message) {
    for (const b of contentBlocks(r.message, 'tool_use')) {
      if (b.name === 'Agent' || b.name === 'Task') {
        S.calls.set(b.id, { toolUseId: b.id, ts: t, input: b.input || {}, sessionId: S.sessionId });
      }
    }
    if (S.turn) S.turn.end = Math.max(S.turn.end, t);
  }
  if (r.type === 'user' && r.message) {
    for (const b of contentBlocks(r.message, 'tool_result')) {
      if (S.calls.has(b.tool_use_id)) {
        const res = r.toolUseResult && typeof r.toolUseResult === 'object' ? r.toolUseResult : {};
        S.results.set(b.tool_use_id, { ts: t, agentId: res.agentId || null, totalDurationMs: res.totalDurationMs,
          totalTokens: res.totalTokens, launched: res.isAsync === true || res.status === 'async_launched', usage: usageFromResult(res.usage), status: res.status || null,
          background: !res.agentId && /background|segundo plano|async/i.test(JSON.stringify(res).slice(0, 2000)) });
      }
    }
    const text = contentText(r.message);
    if (text.includes('<task-notification>')) {
      const id = text.match(/<task-id>([^<]+)<\/task-id>/);
      const st = text.match(/<status>([^<]+)<\/status>/);
      if (id) S.notifications.set(id[1].trim(), { ts: t, status: st ? st[1].trim() : null });
    }
    if (isRealPrompt(r)) {
      if (S.turn && S.turn.end > S.turn.start) S.turns.push(S.turn);
      S.turn = { start: t, end: t, prompt: text.slice(0, 200) };
    }
  }
}

function parseSession(file, now, cache) {
  const { state: S, mtime } = readTranscript(file, cache, { init: () => newSessionState(path.basename(file, '.jsonl')), feed: feedSession });
  const turns = S.turns.slice();
  if (S.turn && S.turn.end > S.turn.start) turns.push({ ...S.turn });
  const main = S.usage.result();
  return {
    sessionId: S.sessionId, file, count: S.count, calls: S.calls, results: S.results, notifications: S.notifications, turns,
    main: { ...main, workMs: turns.reduce((a, x) => a + (x.end - x.start), 0), start: ts(S.first), end: ts(S.last), mtime },
    cwd: (S.first && S.first.cwd) || null, gitBranch: (S.last && S.last.gitBranch) || null, now,
  };
}

const newSubState = () => ({ prompt: null, usage: new UsageAcc(), first: null, last: null, summary: '', agentName: null });
function feedSub(S, r) {
  if (S.prompt === null && r.type === 'user' && r.message) S.prompt = contentText(r.message);
  const t = ts(r);
  if (t && !S.first) S.first = r;
  if (t) S.last = r;
  S.usage.add(r);
  if (r.type === 'assistant') { const tx = contentText(r.message); if (tx) S.summary = tx.slice(0, 600); }
  if (!S.agentName && r.agentName) S.agentName = r.agentName;
}

function parseSubagent(file, cache) {
  const { state: S, mtime } = readTranscript(file, cache, { init: newSubState, feed: feedSub });
  const agentId = path.basename(file, '.jsonl').replace(/^agent-/, '');
  return {
    agentId, file, prompt: S.prompt || '', ...S.usage.result(), start: ts(S.first), end: ts(S.last), mtime,
    summary: S.summary, agentName: S.agentName || null,
  };
}

// ---------------------------------------------------------------------------
// coleta
// ---------------------------------------------------------------------------
export function collect({ projectDir = process.cwd(), claudeDir = path.join(os.homedir(), '.claude'),
  now = Date.now(), activeWindowMs = 10 * 60 * 1000, mainAgent = null, cache = createTranscriptCache() } = {}) {
  projectDir = path.resolve(projectDir);
  const changes = readChanges(projectDir);
  const changeIds = [...changes.keys()];
  const hooks = readHookEvents(projectDir);
  const live = liveSessions(claudeDir);
  const mainName = mainAgent || readMainAgentName(projectDir);
  const runs = [];
  const sessions = [];
  const unlinked = [];
  const touched = new Set();
  const dirs = findProjectDirs(claudeDir, projectDir);

  for (const dir of dirs) {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      touched.add(path.join(dir, f));
      const s = parseSession(path.join(dir, f), now, cache);
      if (!s.count) continue;
      s.live = live.has(s.sessionId);
      sessions.push(s);
      // transcripts dos subagentes desta sessão
      const subDir = path.join(dir, s.sessionId, 'subagents');
      let subs = [];
      try { subs = fs.readdirSync(subDir).filter((x) => x.startsWith('agent-') && x.endsWith('.jsonl')).map((x) => { touched.add(path.join(subDir, x)); return parseSubagent(path.join(subDir, x), cache); }); } catch { /* sem subagentes */ }
      const byAgentId = new Map(subs.map((x) => [x.agentId, x]));
      const usedSubs = new Set();
      const callList = [...s.calls.values()].sort((a, b) => a.ts - b.ts);
      // 1) ligação por agentId do resultado; 2) por prompt; 3) por ordem
      for (const call of callList) {
        const res = s.results.get(call.toolUseId);
        let sub = res && res.agentId ? byAgentId.get(res.agentId) : null;
        if (!sub) {
          const p = norm(call.input.prompt);
          sub = subs.find((x) => !usedSubs.has(x.agentId) && p && norm(x.prompt) === p) || null;
        }
        if (!sub) {
          sub = subs.filter((x) => !usedSubs.has(x.agentId) && x.start >= call.ts - 5000).sort((a, b) => a.start - b.start)[0] || null;
        }
        if (sub) usedSubs.add(sub.agentId);
        runs.push(buildRun({ call, res, sub, session: s, hooks, changeIds, now, activeWindowMs }));
      }
      for (const sub of subs) {
        if (usedSubs.has(sub.agentId)) continue;
        // subagente sem chamada visível (sessão principal truncada/compactada)
        const run = buildRun({ call: null, res: null, sub, session: s, hooks, changeIds, now, activeWindowMs });
        runs.push(run);
        unlinked.push(run.id);
      }
    }
  }

  // arquivo removido sai do cache (só dentro das pastas varridas)
  for (const k of [...cache.keys()]) if (!touched.has(k) && dirs.some((d) => k.startsWith(d + path.sep))) cache.delete(k);

  // sessão principal = esforço do agente orquestrador (tech-lead), fora das changes
  const mainRuns = sessions.map((s) => ({
    id: `main:${s.sessionId}`, sessionId: s.sessionId, agent: mainName, main: true,
    change: null, description: `sessão ${s.sessionId.slice(0, 8)}`, model: shortModel(s.main.model), models: s.main.models.map(shortModel),
    start: s.main.start, end: s.main.end, durationMs: s.main.workMs, usage: s.main.usage, tokenSplit: withSplit(addTok(zeroTok(), s.main.usage)), toolUses: s.main.toolUses,
    active: s.live || now - s.main.mtime < activeWindowMs, turns: s.turns.length, gitBranch: s.gitBranch, live: s.live,
  }));

  // por change: ordem, de/para, trocas, agente ativo
  const byChange = new Map();
  for (const r of runs) {
    const key = r.change || '(sem change)';
    if (!byChange.has(key)) byChange.set(key, []);
    byChange.get(key).push(r);
  }
  const changeViews = [];
  const allIds = new Set([...changeIds, ...byChange.keys()]);
  for (const id of allIds) {
    const c = changes.get(id) || { id, dir: null, archived: false, tasks: { total: 0, done: 0, blocked: 0 }, review: null, reviewRounds: [], qa: null, sections: {}, updatedAt: null, createdAt: null, archivedOn: null, header: '', taskList: [], files: [], unknown: true };
    const list = (byChange.get(id) || []).sort((a, b) => a.start - b.start);
    let prev = mainName;
    let handoffs = 0;
    for (const r of list) {
      r.from = prev;
      if (r.agent !== prev) handoffs++;
      prev = r.agent;
    }
    let reviewed = false;
    for (const r of list) {     // etapa da trilha e task citada, em ordem cronológica
      const tk = inferTask(r.description, r.promptPreview, c.taskList);
      r.task = tk ? tk.id : null; r.taskSection = tk ? tk.section : null;
      r.flow = flowOf(r, { mainAgent: mainName, afterReview: reviewed });
      if (r.flow === 'revisao') reviewed = true;
    }
    for (let i = 0; i < list.length; i++) list[i].to = i + 1 < list.length ? list[i + 1].agent : (list[i].active ? null : mainName);
    const agents = {};
    for (const r of list) {
      const a = agents[r.agent] || (agents[r.agent] = { agent: r.agent, runs: 0, durationMs: 0, tokens: 0, raw: zeroTok(), models: new Set(), active: false });
      a.runs++; a.durationMs += r.durationMs; a.tokens += r.usage.total; addTok(a.raw, r.usage); if (r.model) a.models.add(r.model); if (r.active) a.active = true;
    }
    const active = list.filter((r) => r.active);
    const lastActivity = Math.max(c.updatedAt || 0, ...list.map((r) => r.end || r.start || 0));
    let status;
    if (active.length) status = 'em andamento';
    else if (id === '(sem change)') status = 'avulsa';
    else if (c.archived) status = 'concluída';
    else if (c.tasks.blocked > 0) status = 'bloqueada';
    else if (c.tasks.total > 0 && c.tasks.done === c.tasks.total && /APROVADO/i.test(c.review || '') && !/MUDAN[ÇC]AS/i.test(c.review || '')) status = 'concluída';
    else if (c.tasks.done > 0 || list.length > 0) status = 'em andamento';
    else status = 'pendente';
    const firstStart = list.map((r) => r.start).filter((x) => Number.isFinite(x)).sort((a, b) => a - b)[0];
    const startedAt = firstStart || c.createdAt || c.archivedOn || null;
    const startSource = firstStart ? 'primeira execução de agente' : (c.createdAt ? 'criação da pasta' : (c.archivedOn ? 'data do archive' : null));
    const lastRun = Math.max(0, ...list.map((r) => r.end || r.start || 0));
    const completedAt = c.archived ? Math.max(c.archivedOn || 0, lastRun) : lastActivity;
    const waiting = status === 'avulsa' ? null : c.unknown ? { text: 'indefinido', rule: 'a change citada nas rodadas não tem pasta em openspec/changes' } : waitingFor({ archived: c.archived, header: c.header, taskList: c.taskList, review: c.review, qa: c.qa });
    const trail = buildTrail({ id, status, archived: c.archived, unknown: !!c.unknown, waiting, tasks: c.tasks, taskList: c.taskList,
      review: c.review, reviewRounds: c.reviewRounds || [], qa: c.qa, runs: list }, mainName);
    changeViews.push({
      id, status, trail, archived: c.archived, unknown: !!c.unknown, tasks: c.tasks, sections: c.sections, review: c.review, qa: c.qa,
      files: c.files, startedAt, startSource, completedAt, waiting,
      lastActivity, runs: list, handoffs, rounds: list.length,
      durationMs: list.reduce((a, r) => a + r.durationMs, 0), tokens: list.reduce((a, r) => a + r.usage.total, 0), tokenSplit: sumTok(list),
      activeAgents: active.map((r) => ({ agent: r.agent, runId: r.id, model: r.model, since: r.start, tokens: r.usage.total, tokenSplit: withSplit(addTok(zeroTok(), r.usage)), durationMs: r.durationMs })),
      agents: Object.values(agents).map(({ raw, ...a }) => ({ ...a, tokenSplit: withSplit(raw), models: [...a.models] })).sort((x, y) => y.durationMs - x.durationMs),
    });
  }
  changeViews.sort((a, b) => (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) || (b.lastActivity - a.lastActivity));
  const board = splitChanges(changeViews);
  const brief = (r) => ({ id: r.id, agent: r.agent, change: r.change, stage: r.stage || null, description: r.description, model: r.model,
    since: r.start, lastActivity: r.lastActivity || r.end || r.start, end: r.end, status: r.status || (r.active ? 'ativo' : 'terminou'),
    tokens: r.usage.total, tokenSplit: withSplit(addTok(zeroTok(), r.usage)), main: !!r.main });
  const running = [...runs.filter((r) => r.active), ...mainRuns.filter((r) => r.active && r.live)]
    .sort((a, b) => (a.start || 0) - (b.start || 0)).map(brief);
  const recent = runs.filter((r) => !r.active).sort((a, b) => (b.end || 0) - (a.end || 0)).slice(0, 8).map(brief);

  // esforço por agente (todas as changes + sessão principal)
  const effort = {};
  for (const r of [...runs, ...mainRuns]) {
    const a = effort[r.agent] || (effort[r.agent] = { agent: r.agent, runs: 0, durationMs: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, models: new Set(), changes: new Set(), active: false });
    a.runs++; a.durationMs += r.durationMs; a.tokens += r.usage.total; a.input += r.usage.input; a.output += r.usage.output;
    a.cacheRead += r.usage.cacheRead; a.cacheCreation += r.usage.cacheCreation;
    if (r.model) a.models.add(r.model); if (r.change) a.changes.add(r.change); if (r.active) a.active = true;
  }
  const agents = Object.values(effort).map((a) => ({ ...a, tokenSplit: withSplit({ input: a.input, output: a.output, cacheRead: a.cacheRead, cacheCreation: a.cacheCreation }), models: [...a.models], changes: a.changes.size })).sort((x, y) => y.durationMs - x.durationMs);

  return {
    generatedAt: now, project: { dir: projectDir, name: path.basename(projectDir), mainAgent: mainName, claudeDir },
    totals: {
      changes: changeViews.length, active: changeViews.filter((c) => c.status === 'em andamento').length,
      runs: runs.length, tokens: agents.reduce((a, x) => a + x.tokens, 0), tokenSplit: withSplit(agents.reduce((t, x) => addTok(t, x), zeroTok())), durationMs: agents.reduce((a, x) => a + x.durationMs, 0),
      sessions: sessions.length,
    },
    changes: changeViews, agents, mainRuns, unlinked,
    running, recent,
    stages: stageCounts(changeViews),
    board: { running: board.running.map((c) => c.id), blocked: board.blocked.map((c) => c.id), pending: board.pending.map((c) => c.id),
      done: board.done.map((c) => c.id), doneOlder: board.doneOlder.map((c) => c.id) },
  };
}

function buildRun({ call, res, sub, session, hooks, changeIds, now, activeWindowMs }) {
  const input = call ? call.input : {};
  const agentId = (sub && sub.agentId) || (res && res.agentId) || (call && `call:${call.toolUseId}`);
  const hook = hooks.get(agentId) || {};
  const agent = input.subagent_type || hook.type || (sub && sub.agentName) || (call ? 'general-purpose' : 'desconhecido');
  const prompt = input.prompt || (sub && sub.prompt) || '';
  const notif = session.notifications.get(agentId);
  const start = [call && call.ts, hook.start, sub && sub.start].filter((x) => Number.isFinite(x)).sort((a, b) => a - b)[0] || null;
  // o resultado de um agente em segundo plano traz o agentId já no lançamento (async_launched): não é término
  const resDone = !!(res && res.agentId && !res.launched);
  const ended = resDone || notif || Number.isFinite(hook.stop);
  // segundo plano: o resultado imediato da chamada não indica o fim; o fim real está no
  // SubagentStop (se houver), senão no último registro do transcript do subagente, senão na notificação
  const bg = !!input.run_in_background || !!(res && res.launched);
  const subEnd = sub && Number.isFinite(sub.end) ? sub.end : null;
  const lastSeen = Math.max(sub ? sub.mtime : 0, subEnd || 0, start || 0);
  // delegação sem resultado numa sessão viva está em andamento, mesmo que o
  // subagente esteja há tempo num comando longo; sem sessão viva vale a janela
  const active = !ended && ((call && session.live) || (now - lastSeen) < activeWindowMs);
  let end = null;
  if (ended) {
    if (bg) end = (Number.isFinite(hook.stop) ? hook.stop : null) || subEnd || (notif && notif.ts) || null;
    else end = (resDone && res.ts) || (notif && notif.ts) || (Number.isFinite(hook.stop) ? hook.stop : null);
  }
  if (!end && !active) end = subEnd || lastSeen || start;
  // totalDurationMs só vale se for positivo e coerente com os timestamps conhecidos
  const total = res && num(res.totalDurationMs) > 0 ? res.totalDurationMs : 0;
  const span = Math.max(0, (end || 0) - (start || 0));
  const coherent = total > 0 && (!span || Math.abs(total - span) <= Math.max(5000, span * 0.25));
  const durationMs = active ? Math.max(0, now - (start || now)) : (coherent ? total : span);
  const usage = (sub && sub.usage.requests > 0) ? sub.usage : (res && res.usage) || { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, total: 0, requests: 0 };
  const model = shortModel(input.model === 'inherit' ? null : input.model) || shortModel(sub && sub.model) || null;
  // o evento de parada só prova que terminou, não que deu certo
  let status = active ? 'ativo' : (ended ? 'terminou' : 'sem sinal');
  if (notif && notif.status && /fail|error|erro/i.test(notif.status)) status = 'falhou';
  return {
    id: agentId, sessionId: session.sessionId, agent, change: attributeChange(prompt, changeIds),
    description: input.description || (sub && sub.summary ? sub.summary.split('\n')[0].slice(0, 120) : ''),
    background: !!input.run_in_background, model, models: sub ? sub.models.map(shortModel) : [],
    stage: inferStage(agent, input.description, prompt), lastActivity: lastSeen || end || start,
    start, end, durationMs, active, status, usage, tokenSplit: withSplit(addTok(zeroTok(), usage)), toolUses: sub ? sub.toolUses : 0,
    totalTokensReported: res ? res.totalTokens : null, summary: sub ? sub.summary : '',
    promptPreview: prompt.slice(0, 400), linked: !!(sub && call), delegated: !!call,
  };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  const args = process.argv.slice(2);
  const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
  const projectDir = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--claude-dir') || process.cwd();
  const state = collect({ projectDir, claudeDir: opt('--claude-dir', undefined) });
  if (args.includes('--json')) { console.log(JSON.stringify(state, null, 2)); }
  else {
    const fmt = (ms) => `${Math.round(ms / 60000)}min`;
    console.log(`${state.project.name}: ${state.totals.changes} changes, ${state.totals.runs} rodadas, ${state.totals.tokens} tokens, ${fmt(state.totals.durationMs)}`);
    for (const c of state.changes) console.log(`  [${c.status}] ${c.id}  tasks ${c.tasks.done}/${c.tasks.total}  rodadas ${c.rounds}  trocas ${c.handoffs}  ${fmt(c.durationMs)}  ${c.tokens} tok  ativo: ${c.activeAgents.map((a) => a.agent).join(', ') || '-'}`);
    console.log('esforço por agente:');
    for (const a of state.agents) console.log(`  ${a.agent.padEnd(16)} ${String(a.runs).padStart(3)} rodadas  ${fmt(a.durationMs).padStart(8)}  ${String(a.tokens).padStart(9)} tok  ${a.models.join(',')}`);
    if (state.unlinked.length) console.log(`(${state.unlinked.length} rodadas sem chamada visível na sessão principal)`);
  }
}
