#!/usr/bin/env node
// ai-team — hook do projeto (chamado pelo hook.sh). Grava eventos em .claude/ai-team/events.jsonl:
//   SubagentStart/SubagentStop  início e fim de cada subagente (tempos exatos no painel;
//                               sem eles o painel usa os timestamps dos transcripts)
//   UserPromptExpansion /equipe e SessionStart com agent_type=tech-lead
//                               marcam a sessão como da equipe (evento TeamStart)
//   SessionStart source=compact numa sessão marcada pelo /equipe: escreve no stdout
//                               o lembrete do papel, que entra no contexto compactado
//   SubagentStop e Stop         notificação no celular (notify.mjs, ntfy), em segundo plano,
//                               só se existir ~/.config/ai-team/notify.json
//   Stop com o modo longe ligado (.claude/ai-team/away.json): ask.mjs espera a resposta do fim do turno
//                               pelo painel e devolve {"decision":"block"} (o timeout do Stop deve ser 3600)
//   StopFailure e SessionEnd    idem, mas esperando o envio (no SessionEnd o Claude Code está
//                               saindo e um processo em segundo plano pode não terminar)
// Nunca falha o hook: qualquer erro sai com 0 e sem saída.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const REMINDER = `Lembrete do ai-team: nesta sessão você é o tech-lead da equipe (chamado com /equipe).
Releia agora \`.claude/agents/tech-lead.md\` e siga-o como o seu prompt de sistema:
coordene e delegue aos agentes da equipe, não edite arquivos nem rode comandos que
alterem o repositório. Não recomece o pedido: continue de onde o resumo da conversa
parou (changes e tarefas avulsas em andamento, agentes em segundo plano, o que espera
o usuário).
`;

const str = (v) => (typeof v === 'string' ? v : '');

// raw: o JSON do hook, como veio no stdin (repassado intacto ao notify.mjs e ao ask.mjs)
export function runHook(raw, { env = process.env, now = () => new Date().toISOString() } = {}) {
  let h; try { h = JSON.parse(raw || '{}'); } catch { return { out: '' }; }
  if (!h || typeof h !== 'object') return { out: '' };
  const dir = path.join(env.CLAUDE_PROJECT_DIR || process.cwd(), '.claude', 'ai-team');
  const log = path.join(dir, 'events.jsonl');
  const ev = str(h.hook_event_name), sid = str(h.session_id);
  const logline = (o) => { fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(log, JSON.stringify(o) + '\n'); };
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
      if (str(h.command_name).replace(/^\//, '') === 'equipe') team('equipe');
      break;
    case 'SessionStart':
      if (str(h.agent_type)) {
        // --agent: o prompt do agente é o de sistema e sobrevive à compactação; só marca
        if (h.source === 'startup' && h.agent_type === 'tech-lead') team('agent');
      } else if (h.source === 'compact' && sid) {
        let text = ''; try { text = fs.readFileSync(log, 'utf8'); } catch {}
        if (text.includes(`"event":"TeamStart","session_id":${JSON.stringify(sid)}`)) result.out = REMINDER;
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
