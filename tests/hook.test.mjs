// Testes do hook.mjs (e do repasse hook.sh): JSON de verdade no lugar do sed, eventos com valores
// estranhos continuam JSON válido, entrada inválida não quebra o hook e sem node o hook.sh não faz nada.
//   node tests/hook.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runHook, REMINDER } from '../dashboard/hook.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
const hookSh = path.join(here, '..', 'dashboard', 'hook.sh');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-hook-'));
const env = { CLAUDE_PROJECT_DIR: tmp, AI_TEAM_NOTIFY_FILE: path.join(tmp, 'sem-notify.json'), HOME: tmp };
const log = path.join(tmp, '.claude', 'ai-team', 'events.jsonl');
const events = () => fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const hook = (o) => runHook(typeof o === 'string' ? o : JSON.stringify(o), { env, now: () => '2026-10-29T12:00:00.000Z' });

{   // aspas e barras no valor, e a mesma chave dentro de outro campo: o sed antigo pegava a última
  const r = hook({ hook_event_name: 'SubagentStart', session_id: 's1', agent_id: 'a"1\\x', agent_type: 'qa',
    tool_input: { session_id: 'outra', agent_type: 'falso' } });
  assert.equal(r.out, '');
  assert.deepEqual(events(), [{ ts: '2026-10-29T12:00:00.000Z', event: 'SubagentStart', agent_id: 'a"1\\x', agent_type: 'qa', session_id: 's1' }]);
}
{   // formato da linha igual ao do hook.sh antigo (o collect.mjs e o grep da compactação dependem dele)
  hook({ hook_event_name: 'UserPromptExpansion', session_id: 's-eq', command_name: '/equipe' });
  assert.ok(fs.readFileSync(log, 'utf8').includes('"event":"TeamStart","session_id":"s-eq","via":"equipe"'));
  assert.equal(hook({ hook_event_name: 'SessionStart', session_id: 's-eq', source: 'compact' }).out, REMINDER);
  assert.equal(hook({ hook_event_name: 'SessionStart', session_id: 's-e', source: 'compact' }).out, '', 'prefixo de outra sessão não conta');
}
{   // entrada inválida ou sem evento conhecido: nada gravado, nada na saída
  const n = events().length;
  for (const raw of ['', 'não é json', 'null', '[1,2]', JSON.stringify({ hook_event_name: 'Outro' })]) { const r = hook(raw); assert.equal(r.out, ''); assert.ok(!r.notify); }
  assert.equal(events().length, n);
}
{   // sem config do ntfy não notifica; com ela, SubagentStop/Stop em segundo plano e SessionEnd esperando
  assert.equal(hook({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a' }).notify, null);
  fs.writeFileSync(env.AI_TEAM_NOTIFY_FILE, '{}');
  assert.equal(hook({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a' }).notify, 'bg');
  assert.equal(hook({ hook_event_name: 'Stop', session_id: 's' }).notify, 'bg');
  assert.equal(hook({ hook_event_name: 'SessionEnd', session_id: 's' }).notify, 'fg');
  assert.equal(runHook(JSON.stringify({ hook_event_name: 'Stop' }), { env: { ...env, AI_TEAM_NOTIFY: '0' } }).notify, null);
  fs.unlinkSync(env.AI_TEAM_NOTIFY_FILE);
}
{   // pelo hook.sh: com node repassa; sem node no PATH sai 0 sem gravar
  const raw = JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's2', agent_id: 'b', agent_type: 'qa' });
  const ok = spawnSync('bash', [hookSh], { input: raw, env: { ...process.env, ...env } });
  assert.equal(ok.status, 0);
  assert.ok(events().some((e) => e.agent_id === 'b' && e.event === 'SubagentStop'));
  const n = events().length;
  const bare = spawnSync('/bin/bash', [hookSh], { input: raw, env: { ...env, PATH: '/nonexistent' } });
  assert.equal(bare.status, 0); assert.equal(bare.stdout.length, 0);
  assert.equal(events().length, n, 'sem node: não grava');
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('hook em node ok');
