// ai-team — regras do quadro de changes (puras, sem dependências).
//
//   parseTasks      tasks.md → cabeçalho, tasks (id, seção, depende de)
//   waitingFor      "esperando o quê", por heurística, sempre com a regra que disparou
//   splitChanges    em andamento / bloqueadas / pendentes / últimas concluídas
//   inferStage      etapa de uma rodada de agente, a partir do prompt e da descrição
//   changeFiles     lista dos .md de uma change
//   resolveChangeFile  caminho seguro (sem path traversal) de um .md de uma change
import fs from 'node:fs';
import path from 'node:path';

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const TASK_ID = /^\d+\.\d+[a-z]?$/i;
export const CHANGE_ID = /^[a-z0-9][a-z0-9._-]*$/i;
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// tasks.md
// ---------------------------------------------------------------------------
// deps: { ids: ['1.2'], unknown: false }. "—" ou ausência = sem dependência;
// qualquer item que não seja um id de task (ex.: outra change) marca unknown.
export function parseDeps(line) {
  const m = line.match(/<!--\s*depende de:\s*([^>]*?)\s*-->/i);
  if (!m) return { ids: [], unknown: false };
  const raw = m[1].trim();
  if (!raw || /^[—–-]+$/.test(raw)) return { ids: [], unknown: false };
  const ids = []; let unknown = false;
  for (const part of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (TASK_ID.test(part)) ids.push(part); else unknown = true;
  }
  return { ids, unknown };
}

export function parseTasks(text) {
  const lines = String(text || '').split('\n');
  const headerLines = [];
  const tasks = [];
  let section = null, seenSection = false;
  for (const line of lines) {
    const h = line.match(/^##\s*(\d)\.\s*(.+)/);
    if (h) { section = norm(h[2]); seenSection = true; continue; }
    if (/^##\s/.test(line)) seenSection = true;
    if (!seenSection) headerLines.push(line);
    const t = line.match(/^\s*[-*]\s*\[( |x|X)\]\s*(?:(\d+\.\d+[a-z]?)\b)?/);
    if (!t) continue;
    tasks.push({ id: t[2] || null, done: t[1] !== ' ', section, blocked: /bloquead/i.test(line), deps: parseDeps(line),
      text: norm(line.replace(/<!--.*?-->/g, '').replace(/^\s*[-*]\s*\[.\]\s*/, '')).slice(0, 140) });
  }
  return { header: headerLines.join('\n'), tasks };
}

// ---------------------------------------------------------------------------
// "esperando o quê"
// ---------------------------------------------------------------------------
const HEADER_WAIT = /aguarda(?:ndo)?\s+(?:a\s+|sua\s+)?aprova\w*|RASCUNHO|aguarda(?:ndo)?\s+(?:a\s+)?leitura/i;

// change: { archived, header, taskList, review, qa }
// → { text, rule }   (text 'indefinido' quando nenhuma regra decide)
export function waitingFor(change) {
  const tasks = change.taskList || [];
  const review = change.review || null;
  if (change.archived) return { text: 'nada (arquivada)', rule: 'a change está em openspec/changes/archive' };
  if (change.header && HEADER_WAIT.test(change.header)) {
    const m = change.header.match(HEADER_WAIT);
    return { text: 'esperando o desenvolvedor', rule: `o cabeçalho do tasks.md diz "${norm(m[0])}"` };
  }
  if (review && /MUDAN[ÇC]AS PEDIDAS/i.test(review)) {
    return { text: 'esperando correção', rule: 'a última rodada do review-report.md é MUDANÇAS PEDIDAS' };
  }
  if (!tasks.length) return { text: 'indefinido', rule: 'sem tasks.md ou sem tasks com checkbox' };
  const open = tasks.filter((t) => !t.done);
  if (!open.length) {
    if (!review) return { text: 'esperando revisão', rule: 'todas as tasks estão [x] e não há review-report.md' };
    if (/APROVADO/i.test(review) && !/MUDAN[ÇC]AS/i.test(review)) {
      return { text: 'indefinido', rule: 'tasks [x] e revisão APROVADO; o tasks.md não diz se falta QA ou arquivamento' };
    }
    return { text: 'indefinido', rule: `tasks [x], mas o resultado da revisão ("${review}") não é reconhecido` };
  }
  const doneIds = new Set(tasks.filter((t) => t.done && t.id).map((t) => t.id));
  const known = new Set(tasks.filter((t) => t.id).map((t) => t.id));
  const unmet = (t) => t.deps.ids.filter((d) => !doneIds.has(d));
  // 1ª task aberta com dependências cumpridas (e nenhuma dependência ilegível)
  const ready = open.find((t) => !t.deps.unknown && !unmet(t).length && t.deps.ids.every((d) => known.has(d)));
  if (ready) {
    if (ready.blocked) return { text: 'indefinido', rule: `a task ${ready.id || '?'} está marcada como bloqueada no tasks.md` };
    return { text: `esperando executar a task ${ready.id || '(sem número)'}${ready.section ? ` (${ready.section.replace(/\s*\(.*$/, '')})` : ''}`,
      rule: 'primeira task [ ] cujas dependências ("depende de") estão todas [x]' };
  }
  const first = open[0];
  if (first.deps.unknown || first.deps.ids.some((d) => !known.has(d))) {
    return { text: 'indefinido', rule: `o "depende de" da task ${first.id || '?'} cita algo que não é task desta change` };
  }
  const u = unmet(first);
  return { text: `esperando a task ${u.join(', ')}`, rule: `nenhuma task [ ] está liberada; a ${first.id || '?'} depende de ${u.join(', ')}, ainda não [x]` };
}

// ---------------------------------------------------------------------------
// separação do quadro
// ---------------------------------------------------------------------------
// changes: visões do coletor ({status, completedAt|lastActivity, id}).
export function splitChanges(changes, recentCount = 3) {
  const when = (c) => c.completedAt || c.lastActivity || 0;
  const byId = (a, b) => (a.id < b.id ? -1 : 1);
  const doneAll = changes.filter((c) => c.status === 'concluída').sort((a, b) => (when(b) - when(a)) || byId(a, b));
  const order = (a, b) => ((b.lastActivity || 0) - (a.lastActivity || 0)) || byId(a, b);
  return {
    running: changes.filter((c) => c.status === 'em andamento').sort(order),
    blocked: changes.filter((c) => c.status === 'bloqueada').sort(order),
    pending: changes.filter((c) => c.status === 'pendente').sort(order),
    done: doneAll.slice(0, recentCount),
    doneOlder: doneAll.slice(recentCount),
    other: changes.filter((c) => c.status === 'avulsa'),
  };
}

// ---------------------------------------------------------------------------
// etapa de uma rodada (prompt/descrição); null quando nada decide
// ---------------------------------------------------------------------------
export function inferStage(agent, description, prompt) {
  const t = `${description || ''}\n${String(prompt || '').slice(0, 600)}`;
  let m = t.match(/\btasks?\s+(\d+\.\d+[a-z]?(?:\s*(?:a|–|-|e)\s*\d+\.\d+[a-z]?)?)/i);
  if (m) return `task ${norm(m[1])}`;
  const secs = [...t.matchAll(/\bse[çc][ãa]o\s+(\d)\b\.?[ \t]*(Infra|Backend|Frontend|QA)?/gi)];
  if (secs.length) { const q = secs.find((x) => x[2]) || secs[0]; return `seção ${q[1]}${q[2] ? ` (${q[2]})` : ''}`; }
  if (agent === 'code-reviewer' || /\brevis[ãa]o\b|\bR\d+\b.*\breview/i.test(t)) return 'revisão';
  if (agent === 'qa') return 'QA';
  if (/\barquiv(?:ar|e|amento)\b/i.test(t)) return 'arquivamento';
  if (/\bproposta|\bproposal\b|\bcriar? a change\b|\bcrie a change\b/i.test(t)) return 'proposta';
  if (/\bgate\b/i.test(t)) return 'gate';
  return null;
}

// ---------------------------------------------------------------------------
// arquivos .md da change
// ---------------------------------------------------------------------------
const FIRST = ['proposal.md', 'design.md', 'tasks.md', 'review-report.md', 'qa-report.md'];

export function changeFiles(dir) {
  const out = [];
  let top = [];
  try { top = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of top) if (e.isFile() && e.name.endsWith('.md')) out.push(e.name);
  out.sort((a, b) => {
    const ia = FIRST.indexOf(a), ib = FIRST.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || (a < b ? -1 : 1);
  });
  const walk = (rel, depth) => {
    if (depth > 6) return;
    let es = [];
    try { es = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    es.sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const e of es) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(r, depth + 1);
      else if (e.isFile() && e.name.endsWith('.md')) out.push(r);
    }
  };
  walk('specs', 0);
  return out;
}

// pasta da change: openspec/changes/<id> ou a mais recente em archive/<data>-<id>
export function changeDir(projectDir, id) {
  if (!CHANGE_ID.test(id) || id === 'archive') return null;
  const base = path.join(projectDir, 'openspec', 'changes');
  const live = path.join(base, id);
  try { if (fs.statSync(live).isDirectory()) return live; } catch { /* tenta o archive */ }
  try {
    const names = fs.readdirSync(path.join(base, 'archive')).filter((n) => n.replace(/^\d{4}-\d{2}-\d{2}-/, '') === id && /^\d{4}-/.test(n)).sort();
    if (names.length) return path.join(base, 'archive', names[names.length - 1]);
  } catch { /* sem archive */ }
  return null;
}

// segments já decodificados (['specs','x','spec.md']). Devolve o caminho real
// do arquivo ou null. Recusa traversal, separadores, pontos iniciais, não-.md,
// symlinks que saiam da pasta da change e o que não for arquivo comum.
export function resolveChangeFile(projectDir, id, segments) {
  if (!Array.isArray(segments) || !segments.length || segments.length > 8) return null;
  for (const s of segments) if (typeof s !== 'string' || !SEGMENT.test(s) || s === '..') return null;
  if (!segments[segments.length - 1].endsWith('.md')) return null;
  const dir = changeDir(projectDir, id);
  if (!dir) return null;
  if (segments.length > 1 && segments[0] !== 'specs') return null;
  const file = path.join(dir, ...segments);
  try {
    const realDir = fs.realpathSync(dir), real = fs.realpathSync(file);
    if (!real.startsWith(realDir + path.sep) || !fs.statSync(real).isFile()) return null;
    return real;
  } catch { return null; }
}

// '/changes/<id>/<arquivo...>' → { id, segments } ou null (percent-encoding inválido incluso)
export function parseChangePath(pathname) {
  const m = /^\/changes\/([^/]+)\/(.+)$/.exec(pathname);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]);
    const segments = m[2].split('/').map((s) => decodeURIComponent(s));
    return { id, segments };
  } catch { return null; }
}
