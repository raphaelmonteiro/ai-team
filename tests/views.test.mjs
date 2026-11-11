// Tests of the Team and Settings tabs (dashboard/views.mjs): gate lines, what an agent owns, the notify body and the HTML.
import assert from 'node:assert/strict';
import { gateLines, ownsOf, notifyBody, teamHtml, settingsHtml, NOTIFY_EVENTS } from '../dashboard/views.mjs';

// gates: one step per line, a PATH prefix repeated on every step shown once
assert.deepEqual(gateLines('PATH="$HOME/n/bin:$PATH" npx eslint x; PATH="$HOME/n/bin:$PATH" npm test && PATH="$HOME/n/bin:$PATH" npm run build'),
  { prefix: '$HOME/n/bin:$PATH', lines: ['npx eslint x', 'npm test', 'npm run build'] });
assert.deepEqual(gateLines('npm run lint; PATH=x npm test'), { prefix: null, lines: ['npm run lint', 'PATH=x npm test'] }, 'not on every step: kept as is');
assert.deepEqual(gateLines(''), { prefix: null, lines: [] });

// owns
assert.equal(ownsOf('chroma-x builder (back-end). Implements X. Use for tasks in section "1. Backend".', 'chroma-x'), '1. Backend');
assert.equal(ownsOf('chroma-x code reviewer. Reviews only the commits.', 'chroma-x'), 'code reviewer', 'the project name goes');
assert.ok(ownsOf('x'.repeat(200)).endsWith('…'));

// notify body: the current view plus the change; the token is never sent back
const view = { file: '/home/u/.config/ai-team/notify.json', topic: 't1', server: 'https://ntfy.sh', hasToken: true, on: ['decision'], events: Object.keys(NOTIFY_EVENTS), detail: true, publicTopic: true,
  quietAtComputer: false, dashboardUrl: '', project: { dir: '/w/app', on: null } };
assert.deepEqual(notifyBody(view, { detail: false }), { topic: 't1', server: 'https://ntfy.sh', token: '', clearToken: false, on: ['decision'], detail: false, quietAtComputer: false, dashboardUrl: '', projectOn: null });

// settings HTML, User scope
{
  const h = settingsHtml(view, null, { scope: 'user', ui: { themes: ['auto', 'light'], theme: 'light', crt: false, tilde: (p) => p.replace('/home/u', '~') } });
  assert.match(h, /data-act="content-off"/, 'public topic with content: the warning and its fix');
  assert.match(h, /~\/\.config\/ai-team\/notify\.json/, 'file shown with ~');
  assert.match(h, /data-set="on:decision" checked/);
  assert.match(h, /data-set="on:budget">/);
  assert.match(h, /saved \(leave empty to keep\)/);
  assert.match(h, /data-set="clearToken"/);
  assert.match(h, /<option selected>light<\/option>/);
  assert.doesNotMatch(settingsHtml({ ...view, detail: false }, null), /data-act="content-off"/);
}
// settings HTML, This project scope: read-only keys with the --set command to copy
{
  const team = { context: { BUDGET_SMALL_USD: '5', FRONTEND_GATE: 'npm run lint; npm test', HUB_TEAM: 'chroma' } };
  const h = settingsHtml(view, team, { scope: 'project' });
  assert.match(h, /readonly/);
  assert.match(h, /--set BUDGET_SMALL_USD=5 \./);
  assert.match(h, /--set FRONTEND_GATE='npm run lint; npm test' \./, 'values with spaces are quoted');
  assert.match(h, /Use other events in this project/);
  assert.doesNotMatch(h, /data-set="projectOn:/, 'no override: no project events');
  assert.match(settingsHtml({ ...view, project: { dir: '/w/app', on: ['decision'] } }, team, { scope: 'project' }), /data-set="projectOn:decision" checked/);
}
assert.match(settingsHtml(null, null), /loading/);
assert.doesNotMatch(settingsHtml({ ...view, topic: '"><img src=x>' }, null), /<img/, 'values are escaped');

// team HTML
{
  const team = { project: 'app', context: { BACKEND_GATE: 'PATH="/n:$PATH" npm test', BACKEND_STACK: 'NestJS', BACKEND_DIR: 'backend', HUB_TEAM: 'chroma' },
    agents: [{ id: 'builder', name: 'builder', description: 'app builder. Use for tasks in section "1. Backend".', model: 'sonnet', tools: 'Read, Bash', frontmatter: true }, { id: 'odd', name: 'odd', frontmatter: false }, { id: 'orchestrator', name: 'orchestrator', frontmatter: true }],
    entry: { skill: true, compactHooks: false } };
  const h = teamHtml(team, { running: new Set(['builder']), stats: new Map([['builder', { runs: 3, durationMs: 60000, usd: 1.5 }]]), fmt: { dur: () => '1m', usd: (n) => `$${n}` } });
  assert.match(h, /st running/);
  assert.match(h, /1\. Backend/);
  assert.match(h, /\$1\.5/);
  assert.match(h, /no frontmatter/);
  assert.match(h, /every line runs with PATH=\/n:\$PATH/);
  assert.match(h, /backend · NestJS · backend\//);
  assert.match(h, /Hub team/);
  assert.doesNotMatch(h, /<div class="k">Backend gate/, 'gates are not repeated in the context');
  assert.match(h, /UserPromptExpansion/, 'missing compaction hooks are flagged');
}
assert.match(teamHtml(null, { fmt: {} }), /loading/);
console.log('✓ views ok');
