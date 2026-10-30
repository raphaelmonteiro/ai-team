#!/usr/bin/env node
// ai-team — hook do projeto (chamado pelo hook.sh). Grava eventos em .claude/ai-team/events.jsonl:
//   SubagentStart/SubagentStop  início e fim de cada subagente (tempos exatos no painel;
//                               sem eles o painel usa os timestamps dos transcripts)
//   UserPromptExpansion /equipe ou /onboarding e SessionStart com agent_type=orchestrator
//                               marcam a sessão como da equipe (evento TeamStart)
//   SessionStart source=compact numa sessão marcada pelo /equipe ou /onboarding: escreve no stdout
//                               o lembrete do papel, que entra no contexto compactado
//   SubagentStop e Stop         notificação no celular (notify.mjs, ntfy), em segundo plano,
//                               só se existir ~/.config/ai-team/notify.json
//   Stop com o modo longe ligado (.claude/ai-team/away.json): ask.mjs espera a resposta do fim do turno
//                               pelo painel e devolve {"decision":"block"} (o timeout do Stop deve ser 3600)
//   StopFailure e SessionEnd    idem, mas esperando o envio (no SessionEnd o Claude Code está
//                               saindo e um processo em segundo plano pode não terminar)
// O events.jsonl gira ao passar de AI_TEAM_EVENTS_MAX_BYTES (padrão 1 MiB): vira events.jsonl.1 (a geração
// anterior é substituída) e o arquivo novo começa com os TeamStart (um por sessão, até metade do limite).
// Nunca falha o hook: qualquer erro sai com 0 e sem saída.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REMINDER = `Lembrete do ai-team: nesta sessão você é o orchestrator da equipe (chamado com /equipe ou /onboarding).
Releia agora \`.claude/agents/orchestrator.md\` e siga-o como o seu prompt de sistema:
coordene e delegue aos agentes da equipe, não edite arquivos nem rode comandos que
alterem o repositório. Não recomece o pedido: continue de onde o resumo da conversa
parou (changes e tarefas avulsas em andamento, agentes em segundo plano, o que espera
o usuário).
`;

const str = (v) => (typeof v === 'string' ? v : '');

const DEFAULT_MAX_BYTES = 1024 * 1024, LOCK_STALE_MS = 30e3;
const maxBytes = (env) => { const n = Number(env.AI_TEAM_EVENTS_MAX_BYTES); return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_BYTES; };

// TeamStart de `text`: a última linha de cada session_id, das mais recentes para trás, até `budget` bytes
// (devolvidas em ordem cronológica)
function teamStarts(text, budget) {
  const last = new Map();
  for (const l of text.split('\n')) {
    if (!l.includes('"event":"TeamStart"')) continue;
    let o; try { o = JSON.parse(l); } catch { continue; }
    if (o && o.event === 'TeamStart' && typeof o.session_id === 'string' && o.session_id) { last.delete(o.session_id); last.set(o.session_id, l); }
  }
  const keep = []; let used = 0;
  for (const l of [...last.values()].reverse()) {
    const n = Buffer.byteLength(l) + 1;
    if (used + n > budget) break;
    keep.push(l); used += n;
  }
  return keep.reverse().map((l) => l + '\n').join('');
}

// Gira o log se passou do limite. Trava exclusiva ao lado do arquivo (wx): quem não a pega só grava.
// Trava com mais de LOCK_STALE_MS é abandonada e retomada (unlink + wx). Risco aceito (design.md PV-3): dois
// hooks retomando a mesma trava no mesmo instante podem girar os dois e perder a geração .1 recém-criada.
// O rename é atômico e o arquivo novo só recebe appends, então nenhuma linha se perde; quem já tinha
// o arquivo aberto grava na geração .1, que o painel também lê. Nunca lança.
function rotate(log, limit) {
  const lock = log + '.lock';
  try {
    if (fs.statSync(log).size <= limit) return;
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (e) {
      if (!e || e.code !== 'EEXIST') return;
      try { if (Date.now() - fs.statSync(lock).mtimeMs <= LOCK_STALE_MS) return; fs.unlinkSync(lock); fd = fs.openSync(lock, 'wx'); } catch { return; }
    }
    try {
      if (fs.statSync(log).size <= limit) return;   // outro hook girou entre a checagem e a trava
      fs.renameSync(log, log + '.1');
      const carried = teamStarts(fs.readFileSync(log + '.1', 'utf8'), Math.floor(limit / 2));
      if (carried) fs.appendFileSync(log, carried);
    } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch {} }
  } catch { /* sem escrita ou arquivo sumiu: o hook não falha */ }
}

// raw: o JSON do hook, como veio no stdin (repassado intacto ao notify.mjs e ao ask.mjs)
export function runHook(raw, { env = process.env, now = () => new Date().toISOString() } = {}) {
  let h; try { h = JSON.parse(raw || '{}'); } catch { return { out: '' }; }
  if (!h || typeof h !== 'object') return { out: '' };
  const dir = path.join(env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'ai-team');
  const log = path.join(dir, 'events.jsonl');
  const ev = str(h.hook_event_name), sid = str(h.session_id);
  const logline = (o) => {
    try { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(log, JSON.stringify(o) + '\n'); } catch { return; }   // sem escrita: segue sem gravar
    rotate(log, maxBytes(env));
  };
  const team = (via) => logline({ ts: now(), event: 'TeamStart', session_id: sid, via });
  const notifyFile = env.AI_TEAM_NOTIFY_FILE || path.join(env.HOME || '', '.config', 'ai-team', 'notify.json');
  const canNotify = () => env.AI_TEAM_NOTIFY !== '0' && fs.existsSync(notifyFile) && fs.existsSync(path.join(here, 'notify.mjs'));
  const result = { out: '', notify: null };   // notify: 'bg' (não segura o hook) | 'fg' (espera o envio; o notify.mjs desiste em 5 s)

  switch (ev) {
    case 'SubagentStart': case 'SubagentStop':
      logline({ ts: now(), event: ev, agent_id: str(h.agent_id), agent_type: str(h.agent_type), session_id: sid });
      if (ev === 'SubagentStop' && canNotify()) result.notify = 'bg';
      break;
    case 'Stop': {
      // modo longe (painel): com pergunta no fim do turno, o ask.mjs segura o turno até a resposta
      // pelo painel e já manda o aviso da decisão; sem pergunta (ou sem o modo), só o aviso de sempre
      const ask = path.join(here, 'ask.mjs');
      if (fs.existsSync(path.join(dir, 'away.json')) && fs.existsSync(ask)) {
        const r = spawnSync(process.execPath, [ask], { input: raw, env, stdio: ['pipe', 'pipe', 'ignore'] });
        const out = r.stdout ? r.stdout.toString() : '';
        if (out) return { out };
        if (r.status === 3) return { out: '' };   // perguntou pelo painel e ninguém respondeu: o aviso já saiu
      }
      if (canNotify()) result.notify = 'bg';
      break;
    }
    case 'StopFailure': case 'SessionEnd':
      if (canNotify()) result.notify = 'fg';
      break;
    case 'UserPromptExpansion':
      { const cmd = str(h.command_name).replace(/^\//, ''); if (cmd === 'equipe' || cmd === 'onboarding') team(cmd); }
      break;
    case 'SessionStart':
      if (str(h.agent_type)) {
        // --agent: o prompt do agente é o de sistema e sobrevive à compactação; só marca
        if (h.source === 'startup' && h.agent_type === 'orchestrator') team('agent');
      } else if (h.source === 'compact' && sid) {
        const needle = `"event":"TeamStart","session_id":${JSON.stringify(sid)}`;   // as duas gerações, e só elas
        for (const f of [log, log + '.1']) {
          let text = ''; try { text = fs.readFileSync(f, 'utf8'); } catch {}
          if (text.includes(needle)) { result.out = REMINDER; break; }
        }
      }
      break;
  }
  return result;
}

function sendNotify(raw, mode, env) {
  const args = [path.join(here, 'notify.mjs'), 'hook'];
  if (mode === 'fg') { spawnSync(process.execPath, args, { input: raw, env, stdio: ['pipe', 'ignore', 'ignore'] }); return Promise.resolve(); }
  const child = spawn(process.execPath, args, { env, detached: true, stdio: ['pipe', 'ignore', 'ignore'] });
  child.on('error', () => {});
  child.unref();
  return new Promise((done) => { child.stdin.on('error', done); child.stdin.end(raw, done); });
}

// realpath: no macOS /var é link para /private/var (o import.meta.url já vem resolvido)
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let raw = ''; try { raw = fs.readFileSync(0, 'utf8'); } catch {}
  let r = { out: '' };
  try { r = runHook(raw); } catch {}
  if (r.out) process.stdout.write(r.out);
  if (r.notify) await sendNotify(raw, r.notify, process.env).catch(() => {});
  process.exitCode = 0;
}
