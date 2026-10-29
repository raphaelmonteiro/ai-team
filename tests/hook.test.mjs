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
  hook({ hook_event_name: 'UserPromptExpansion', session_id: 's-onb', command_name: 'onboarding' });
  assert.ok(fs.readFileSync(log, 'utf8').includes('"event":"TeamStart","session_id":"s-onb","via":"onboarding"'), '/onboarding também marca a sessão');
  assert.equal(hook({ hook_event_name: 'SessionStart', session_id: 's-onb', source: 'compact' }).out, REMINDER);
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

// --- rotação do events.jsonl -------------------------------------------------------------------
import { spawn } from 'node:child_process';
const hookMjs = path.join(here, '..', 'dashboard', 'hook.mjs');
const fresh = (limit) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-rot-'));
  const e = { ...env, CLAUDE_PROJECT_DIR: dir, ...(limit === undefined ? {} : { AI_TEAM_EVENTS_MAX_BYTES: String(limit) }) };
  const f = path.join(dir, '.claude', 'ai-team', 'events.jsonl');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  return { dir, env: e, f, g1: f + '.1', run: (o) => runHook(JSON.stringify(o), { env: e, now: () => '2026-10-29T12:00:00.000Z' }) };
};
const tsLine = (sid) => JSON.stringify({ ts: '2026-10-29T11:00:00.000Z', event: 'TeamStart', session_id: sid, via: 'equipe' }) + '\n';
const subLine = (i) => JSON.stringify({ ts: '2026-10-29T11:00:00.000Z', event: 'SubagentStop', agent_id: `x${i}`, agent_type: 'qa', session_id: 'z' }) + '\n';
const lines = (f) => fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const padTo = (start, size) => { let t = start, i = 0; while (Buffer.byteLength(t) + Buffer.byteLength(subLine(1000 + i)) <= size) t += subLine(1000 + i++); return t; };
const startEv = { hook_event_name: 'SubagentStart', session_id: 's9', agent_id: 'novo', agent_type: 'qa' };

{   // passou do limite: .1 com tudo, arquivo novo só com os TeamStart
  const t = fresh(2000);
  fs.writeFileSync(t.f, padTo(tsLine('s-a') + tsLine('s-b'), 1990));
  assert.ok(fs.statSync(t.f).size <= 1990 && fs.statSync(t.f).size > 1880);
  const before = lines(t.f);
  assert.equal(t.run(startEv).out, '');
  assert.deepEqual(lines(t.g1), [...before, { ts: '2026-10-29T12:00:00.000Z', event: 'SubagentStart', agent_id: 'novo', agent_type: 'qa', session_id: 's9' }]);
  assert.deepEqual(lines(t.f), [JSON.parse(tsLine('s-a')), JSON.parse(tsLine('s-b'))], 'só os dois TeamStart, no formato de antes');
  assert.ok(fs.readFileSync(t.f, 'utf8').includes('"event":"TeamStart","session_id":"s-a","via":"equipe"'));
  assert.ok(!fs.existsSync(t.f + '.lock'), 'trava solta');
  // segunda rotação: .1 é substituído e os TeamStart carregados continuam no arquivo novo
  fs.appendFileSync(t.f, padTo('', 1995 - fs.statSync(t.f).size));
  const second = lines(t.f);
  t.run({ ...startEv, agent_id: 'novo2' });
  assert.deepEqual(lines(t.g1).slice(0, second.length), second, '.1 passa a ser o arquivo girado');
  assert.ok(lines(t.g1).some((e) => e.agent_id === 'novo2'));
  assert.deepEqual(lines(t.f).map((e) => e.session_id), ['s-a', 's-b'], 'TeamStart carregados de novo');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // abaixo do limite: só acrescenta, nenhuma geração criada ou alterada
  const t = fresh(2000);
  fs.writeFileSync(t.f, tsLine('s-a'));
  t.run(startEv);
  assert.equal(lines(t.f).length, 2); assert.ok(!fs.existsSync(t.g1));
  fs.writeFileSync(t.g1, 'antiga\n');
  t.run(startEv);
  assert.equal(fs.readFileSync(t.g1, 'utf8'), 'antiga\n', '.1 intocado');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // limite inválido na variável: vale o padrão de 1 MiB
  for (const bad of ['abc', '0', '-5', '1.5', '']) {
    const t = fresh(bad);
    fs.writeFileSync(t.f, padTo(tsLine('s-a'), 5000));
    t.run(startEv);
    assert.ok(!fs.existsSync(t.g1), `limite "${bad}" não gira um arquivo de 5 KB`);
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
  const t = fresh();
  fs.writeFileSync(t.f, padTo(tsLine('s-a'), 1024 * 1024 - 50));
  t.run(startEv);
  assert.ok(fs.existsSync(t.g1), 'sem a variável, gira ao passar de 1 MiB');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // TeamStart demais: no máximo metade do limite, das sessões mais recentes, sem repetir session_id
  const t = fresh(2000);
  let txt = ''; for (let i = 0; i < 30; i++) txt += tsLine(`sess-${String(i).padStart(2, '0')}`);
  txt += tsLine('sess-03');   // repetida: conta uma vez, como a mais recente
  fs.writeFileSync(t.f, txt);
  assert.ok(Buffer.byteLength(txt) > 2800 && Buffer.byteLength(txt) < 3200);
  t.run(startEv);
  const carried = lines(t.f), ids = carried.map((e) => e.session_id);
  assert.ok(fs.statSync(t.f).size <= 1000, `no máximo 1000 bytes (${fs.statSync(t.f).size})`);
  assert.equal(new Set(ids).size, ids.length, 'sem session_id repetido');
  assert.equal(ids[ids.length - 1], 'sess-03', 'a mais recente fica');
  assert.deepEqual(ids.slice(0, -1), ids.slice(0, -1).slice().sort(), 'ordem cronológica');
  assert.ok(ids.includes('sess-29') && !ids.includes('sess-00'), 'sessões mais recentes');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // o lembrete do compact lê as duas gerações; sessão nunca marcada e prefixo não casam
  const t = fresh(2000);
  t.run({ hook_event_name: 'UserPromptExpansion', session_id: 's-eq', command_name: '/equipe' });
  fs.appendFileSync(t.f, padTo('', 1995 - fs.statSync(t.f).size));
  t.run(startEv);
  // a geração .1 tem o TeamStart; o novo também (carregado). Tira do novo para provar a leitura da .1
  fs.writeFileSync(t.f, '');
  assert.ok(fs.readFileSync(t.g1, 'utf8').includes('"session_id":"s-eq"'));
  assert.equal(t.run({ hook_event_name: 'SessionStart', session_id: 's-eq', source: 'compact' }).out, REMINDER);
  assert.equal(t.run({ hook_event_name: 'SessionStart', session_id: 's-e', source: 'compact' }).out, '');
  assert.equal(t.run({ hook_event_name: 'SessionStart', session_id: 'nunca', source: 'compact' }).out, '');
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // trava: recente = outro hook girando (não gira); abandonada (mais de 30 s) é retomada
  const t = fresh(2000);
  fs.writeFileSync(t.f, padTo(tsLine('s-a'), 2100));
  fs.writeFileSync(t.f + '.lock', '');
  t.run(startEv);
  assert.ok(!fs.existsSync(t.g1), 'trava recente: não gira, só grava');
  assert.ok(lines(t.f).some((e) => e.agent_id === 'novo'));
  const old = new Date(Date.now() - 60e3);
  fs.utimesSync(t.f + '.lock', old, old);
  t.run({ ...startEv, agent_id: 'novo2' });
  assert.ok(fs.existsSync(t.g1), 'trava abandonada: gira');
  assert.ok(!fs.existsSync(t.f + '.lock'));
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // gravações simultâneas perto do limite: nenhuma linha se perde e só um hook gira
  const t = fresh(4000);
  fs.writeFileSync(t.f, padTo(tsLine('s-a'), 3700));
  const prior = lines(t.f).length, N = 12;
  const procs = Array.from({ length: N }, (_, i) => new Promise((done) => {
    const c = spawn(process.execPath, [hookMjs], { env: { ...process.env, ...t.env }, stdio: ['pipe', 'ignore', 'ignore'] });
    c.on('exit', (code) => done(code));
    c.stdin.end(JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: `par-${i}`, agent_type: 'qa' }));
  }));
  assert.deepEqual(await Promise.all(procs), Array(N).fill(0));
  const all = [...lines(t.g1), ...lines(t.f)];
  const agents = new Set(all.filter((e) => /^par-/.test(e.agent_id)).map((e) => e.agent_id));
  assert.equal(agents.size, N, 'todo evento gravado está em uma das gerações');
  assert.equal(all.filter((e) => e.agent_id && !/^par-/.test(e.agent_id)).length, prior - 1, 'nenhuma linha anterior perdida (só um hook girou)');
  assert.ok(!fs.existsSync(t.f + '.lock'));
  fs.rmSync(t.dir, { recursive: true, force: true });
}
{   // pasta sem permissão de escrita: sai 0, saída vazia, sem exceção
  if (typeof process.getuid === 'function' && process.getuid() === 0) console.log('  (pulado: root escreve em pasta sem permissão)');
  else {
    const t = fresh(2000);
    fs.chmodSync(path.dirname(t.f), 0o500);
    try {
      assert.equal(t.run({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a' }).out, '');
      const r = spawnSync(process.execPath, [hookMjs], { input: JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's', agent_id: 'a' }), env: { ...process.env, ...t.env } });
      assert.equal(r.status, 0); assert.equal(r.stdout.length, 0);
      assert.ok(!fs.existsSync(t.f), 'nada gravado');
      // arquivo já existe e passou do limite, mas a pasta não aceita a trava nem o rename: grava e segue
      fs.chmodSync(path.dirname(t.f), 0o700);
      fs.writeFileSync(t.f, padTo(tsLine('s-a'), 2100));
      fs.chmodSync(path.dirname(t.f), 0o500);
      assert.equal(t.run(startEv).out, '');
      assert.ok(!fs.existsSync(t.g1));
    } finally { fs.chmodSync(path.dirname(t.f), 0o700); }
    fs.rmSync(t.dir, { recursive: true, force: true });
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('hook em node ok');
