#!/usr/bin/env node
// ai-team — decisões pendentes respondidas pelo painel.
//
// Como hook (PermissionRequest em .claude/settings.json):
//   node "$CLAUDE_PROJECT_DIR/.claude/dashboard/ask.mjs"
// grava .claude/ai-team/pending/<id>.json e espera .claude/ai-team/answers/<id>.json, que o painel
// grava (POST /api/answer). O app mostra o diálogo dele ao mesmo tempo: vale quem responder primeiro.
// O hook desiste e sai sem decisão (fluxo normal do app) quando:
//   - a chamada ganhou tool_result no transcript (respondida no app);
//   - passou AI_TEAM_ASK_WAIT_S (padrão 280 s) ou, com o modo longe ligado, AI_TEAM_AWAY_WAIT_S
//     (padrão 3300 s); o timeout do hook no settings.json (3600) deve ser maior.
// Pergunta (AskUserQuestion): a resposta vai em updatedInput.answers, chave = texto da pergunta.
// Comando, edição etc.: allow (uma vez) ou deny (com motivo, que volta para o Claude).
// AI_TEAM_ASK=0 desliga (sai na hora, sem pendência). Em subagente de segundo plano não há diálogo:
// o painel é o único lugar para aprovar, e sem resposta a chamada é negada (como sem o hook).
//
// Modo longe do computador (.claude/ai-team/away.json, ligado pelo painel): no hook Stop, se o turno
// termina com a pergunta do fim do turno (wrap_up do app), o hook segura o fim do turno e espera a
// resposta pelo painel; a resposta volta como {"decision":"block","reason":…}, e o Claude segue como
// se o usuário tivesse respondido. Enquanto espera, o app mostra a sessão rodando, sem os botões dele.
// Sem resposta no prazo, ou com o modo desligado no meio, o turno termina normalmente.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lastAsk } from './plan.mjs';

export const ID_RE = /^[a-z0-9][a-z0-9-]{5,63}$/;
export const pendingDir = (projectDir) => path.join(projectDir, '.claude', 'ai-team', 'pending');
export const answersDir = (projectDir) => path.join(projectDir, '.claude', 'ai-team', 'answers');
export const DEFAULT_WAIT_S = 280;
export const awayFile = (projectDir) => path.join(projectDir, '.claude', 'ai-team', 'away.json');
export function getAway(projectDir) { const a = readJsonSafe(awayFile(projectDir)); return a && a.on ? { on: true, since: a.since || null } : { on: false, since: null }; }
// quanto o hook espera; relido a cada volta, então ligar ou desligar o modo longe no meio vale na hora
export const AWAY_WAIT_S = 3300;   // ~55 min; o timeout dos hooks no settings.json (3600) precisa ser maior
export const waitMs = (projectDir) => (getAway(projectDir).on
  ? Number(process.env.AI_TEAM_AWAY_WAIT_S) || AWAY_WAIT_S
  : Number(process.env.AI_TEAM_ASK_WAIT_S) || DEFAULT_WAIT_S) * 1000;
export function setAway(projectDir, on) {
  const f = awayFile(projectDir);
  if (on) writeAtomic(f, JSON.stringify({ on: true, since: Date.now() })); else { try { fs.unlinkSync(f); } catch {} }
  return getAway(projectDir);
}
function readJsonSafe(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const writeAtomic = (f, data) => { fs.mkdirSync(path.dirname(f), { recursive: true }); const tmp = `${f}.${process.pid}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, f); };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((y) => [y, x[y]])) : x));

// o que o painel precisa mostrar, sem o input inteiro de ferramentas grandes (Write/Edit)
export function describe(toolName, input = {}) {
  if (toolName === 'AskUserQuestion') return { kind: 'question', questions: (input.questions || []).map((q) => ({
    question: String(q.question || ''), header: String(q.header || ''), multiSelect: !!q.multiSelect,
    options: (q.options || []).map((o) => ({ label: String(o.label || ''), description: String(o.description || '') })) })) };
  const s = (x, n = 2000) => (x == null ? '' : String(x).slice(0, n));
  const summary = toolName === 'Bash' ? s(input.command)
    : input.file_path ? s(input.file_path) : input.url ? s(input.url) : input.path ? s(input.path) : s(JSON.stringify(input), 600);
  return { kind: 'permission', summary, detail: s(input.description, 300) };
}

// pendências vivas (hook ainda rodando); as órfãs (hook morto) saem do disco
export function listPending(projectDir) {
  const dir = pendingDir(projectDir);
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith('.json')); } catch { return []; }
  const out = [];
  for (const n of names) {
    const p = readJson(path.join(dir, n));
    if (!p || !ID_RE.test(p.id || '')) continue;
    if (p.pid && !alive(p.pid)) { try { fs.unlinkSync(path.join(dir, n)); } catch {} continue; }
    const { input, ...pub } = p;
    out.push(pub);
  }
  return out.sort((a, b) => a.ts - b.ts);
}

// resposta do painel: { id, behavior: 'allow'|'deny', message?, answers? }; devolve { ok } ou { error }
export function writeAnswer(projectDir, body) {
  const id = String((body && body.id) || '');
  if (!ID_RE.test(id)) return { error: 'id inválido' };
  const p = readJson(path.join(pendingDir(projectDir), `${id}.json`));
  if (!p) return { error: 'pendência não existe mais (respondida no app ou expirada)' };
  const behavior = body.behavior === 'deny' ? 'deny' : body.behavior === 'allow' ? 'allow' : null;
  if (!behavior) return { error: 'behavior deve ser allow ou deny' };
  const a = { id, behavior, ts: Date.now() };
  if (behavior === 'deny') a.message = String(body.message || 'Negado pelo painel do ai-team.').slice(0, 1000);
  if (p.kind === 'reply') {   // fim do turno: o texto vira a resposta do usuário
    if (behavior === 'allow') {
      const txt = String(body.reply ?? '').trim();
      if (!txt) return { error: 'resposta vazia' };
      a.reply = txt.slice(0, 4000);
    }
  } else if (p.kind === 'question' && behavior === 'allow') {
    const answers = {};
    for (const q of p.questions) {
      const v = body.answers && body.answers[q.question];
      const txt = Array.isArray(v) ? v.map(String).filter(Boolean).join(', ') : String(v ?? '').trim();
      if (!txt) return { error: `sem resposta para "${q.question}"` };
      answers[q.question] = txt.slice(0, 2000);
    }
    a.answers = answers;
  }
  writeAtomic(path.join(answersDir(projectDir), `${id}.json`), JSON.stringify(a));
  return { ok: true };
}

// resposta do painel → saída do hook PermissionRequest
export function hookOutput(pending, answer, input) {
  if (pending.kind === 'reply') {   // hook Stop: block = o Claude continua, com a resposta como motivo
    if (answer.behavior !== 'allow') return {};
    return { decision: 'block', reason: `O usuário respondeu pelo painel do ai-team (está longe do computador): "${answer.reply}". Siga como se ele tivesse respondido isso na sessão.` };
  }
  const decision = answer.behavior === 'deny'
    ? { behavior: 'deny', message: answer.message || 'Negado pelo painel do ai-team.' }
    : { behavior: 'allow', ...(pending.kind === 'question' ? { updatedInput: { ...input, answers: answer.answers } } : {}) };
  return { hookSpecificOutput: { hookEventName: 'PermissionRequest', decision } };
}

// a chamada já foi resolvida no app? (tool_use igual ao pedido com tool_result depois dele)
export function resolvedInTranscript(file, toolName, input, sinceMs) {
  let text = '';
  try {
    const st = fs.statSync(file), fd = fs.openSync(file, 'r'), len = Math.min(st.size, 2 * 1024 * 1024);
    const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, st.size - len); fs.closeSync(fd);
    text = buf.toString('utf8');
  } catch { return false; }
  const want = stable(input);
  let id = null;
  for (const line of text.split('\n')) {
    if (!line.includes('"tool_use"') && !line.includes('"tool_result"')) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const c = r.message && Array.isArray(r.message.content) ? r.message.content : [];
    for (const b of c) {
      if (b.type === 'tool_use' && b.name === toolName && stable(b.input || {}) === want) id = b.id;
      else if (b.type === 'tool_result' && id && b.tool_use_id === id && Date.parse(r.timestamp || 0) >= sinceMs - 2000) return true;
    }
  }
  return false;
}

// modo longe: o turno acabou com pergunta? espera a resposta pelo painel
async function runStop(h) {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || h.cwd || process.cwd();
  if (!getAway(projectDir).on || !h.transcript_path) return;
  const ask = lastAsk(h.transcript_path);
  if (!ask || ask.kind !== 'wrap_up' || !ask.questions || !ask.questions.length) return;
  const ts = Date.now(), id = `${ts.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const q = ask.questions[0];
  const pending = { id, ts, pid: process.pid, sessionId: h.session_id || null, agentId: null, agentType: null, tool: 'fim do turno', kind: 'reply',
    questions: [{ question: q.question, header: '', multiSelect: false, options: q.options.map((o) => ({ label: o.label, description: o.description || '' })) }],
    summary: String(h.last_assistant_message || '').slice(0, 1500) };
  const pf = path.join(pendingDir(projectDir), `${id}.json`), af = path.join(answersDir(projectDir), `${id}.json`);
  const cleanup = () => { for (const f of [pf, af]) { try { fs.unlinkSync(f); } catch {} } };
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  writeAtomic(pf, JSON.stringify(pending));
  import('./notify.mjs').then((m) => m.notify('decision', pending, { projectDir })).catch(() => {});
  try {
    while (Date.now() - ts < waitMs(projectDir)) {
      const a = readJson(af);
      if (a && a.id === id) { const out = hookOutput(pending, a); if (out.decision) process.stdout.write(JSON.stringify(out)); else process.exitCode = 3; return; }
      if (!getAway(projectDir).on) break;   // voltou ao computador: o turno termina e o app mostra a pergunta
      await new Promise((r) => setTimeout(r, 300));
    }
    process.exitCode = 3;   // sem resposta, mas o aviso já foi: o hook.sh não manda outro
  } finally { cleanup(); }
}

async function runHook() {
  const raw = fs.readFileSync(0, 'utf8');
  let h; try { h = JSON.parse(raw || '{}'); } catch { return; }
  if (process.env.AI_TEAM_ASK !== '0' && h.hook_event_name === 'Stop') return runStop(h);
  if (h.hook_event_name !== 'PermissionRequest' || !h.tool_name) return;
  if (process.env.AI_TEAM_ASK === '0') return;   // desligado: só o app pergunta
  const projectDir = process.env.CLAUDE_PROJECT_DIR || h.cwd || process.cwd();
  const ts = Date.now();
  const id = `${ts.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const input = h.tool_input || {};
  const pending = { id, ts, pid: process.pid, sessionId: h.session_id || null, agentId: h.agent_id || null, agentType: h.agent_type || null,
    tool: h.tool_name, mode: h.permission_mode || null, cwd: h.cwd || null, ...describe(h.tool_name, input), input };
  const pf = path.join(pendingDir(projectDir), `${id}.json`), af = path.join(answersDir(projectDir), `${id}.json`);
  const cleanup = () => { for (const f of [pf, af]) { try { fs.unlinkSync(f); } catch {} } };
  process.on('SIGTERM', () => { cleanup(); process.exit(0); });
  process.on('SIGINT', () => { cleanup(); process.exit(0); });
  writeAtomic(pf, JSON.stringify(pending));
  import('./notify.mjs').then((m) => m.notify('decision', pending, { projectDir })).catch(() => {});   // celular (ntfy), sem bloquear
  const transcript = h.agent_transcript_path || h.transcript_path;
  let lastCheck = 0;
  try {
    while (Date.now() - ts < waitMs(projectDir)) {
      const a = readJson(af);
      if (a && a.id === id) { process.stdout.write(JSON.stringify(hookOutput(pending, a, input))); return; }
      if (transcript && Date.now() - lastCheck > 1500) { lastCheck = Date.now(); if (resolvedInTranscript(transcript, h.tool_name, input, ts)) return; }
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally { cleanup(); }
}

// realpath: no macOS /var é link para /private/var (o import.meta.url já vem resolvido)
// sem await no topo: com await, quem importa este módulo (collect.mjs, via notify.mjs) ficaria parado
// até a decisão ser respondida, e a notificação só sairia depois
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) runHook().catch(() => {});
