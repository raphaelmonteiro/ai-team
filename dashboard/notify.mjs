#!/usr/bin/env node
// ai-team — phone notifications through ntfy (https://ntfy.sh, or your own server).
//
// User config (applies to every project): ~/.config/ai-team/notify.json
//   { "ntfy": { "server": "https://ntfy.sh", "topic": "ai-team-<random>", "token": "" },
//     "on": ["decision", "agent_stop", "turn_stop", "turn_failed", "session_end"],   events that notify
//     "eventsVersion": 2,                              new events from later versions start on
//     "detail": true,                                  false: title only, no command nor agent text
//     "dashboardUrl": "",                              link when tapping the notification (e.g. the Tailscale address)
//     "projects": { "<folder>": { "on": [...] } } }    events for that project only (empty = muted project)
// The config belongs to the PC; the hooks that fire live in each project (.claude/settings.json).
// The dashboard edits all of this on the /notifications page (publicView/updateConfig).
// AI_TEAM_NOTIFY_FILE changes the file; AI_TEAM_NOTIFY=0 turns it off. Without the file: nothing is sent.
//
//   node notify.mjs setup [topic]    creates the file (random topic if none given) and shows how to subscribe
//   node notify.mjs test             sends a test notification
//   node notify.mjs hook             reads a hook's JSON (SubagentStop, Stop) on stdin and notifies
// Events: decision (ask.mjs, when a pending item opens), agent_stop (SubagentStop: an agent finished),
// turn_stop (Stop: the main session finished its turn and waits for you), turn_failed (StopFailure: the turn
// ended on an API error, usage limit etc.) and session_end (SessionEnd: the session was closed).
// Interrupting with Esc / the stop button has no hook (Stop does not run in that case): no notification.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { readProjectName } from './conf.mjs';
import { lastAsk } from './plan.mjs';

export const EVENTS = ['decision', 'agent_stop', 'turn_stop', 'turn_failed', 'session_end'];
// events added after the first version: old configs (without eventsVersion) get them on
const EVENTS_VERSION = 2, ADDED_IN = { 2: ['turn_failed', 'session_end'] };
function withNewEvents(c, list) {
  const v = Number(c.eventsVersion) || 1;
  const extra = Object.entries(ADDED_IN).filter(([k]) => Number(k) > v).flatMap(([, e]) => e);
  return [...new Set([...list, ...extra])];
}
export const configFile = () => process.env.AI_TEAM_NOTIFY_FILE || path.join(os.homedir(), '.config', 'ai-team', 'notify.json');

const readRaw = () => { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return null; } };
const projectKey = (dir) => { try { return fs.realpathSync(dir); } catch { return path.resolve(dir); } };

export function loadConfig(projectDir = null) {
  if (process.env.AI_TEAM_NOTIFY === '0') return null;
  const c = readRaw();
  const n = c && c.ntfy;
  if (!n || !n.topic) return null;
  const ov = projectDir && c.projects && c.projects[projectKey(projectDir)];
  return { server: String(n.server || 'https://ntfy.sh').replace(/\/+$/, ''), topic: String(n.topic), token: n.token ? String(n.token) : '',
    on: (ov && Array.isArray(ov.on) ? withNewEvents(c, ov.on) : Array.isArray(c.on) ? withNewEvents(c, c.on) : EVENTS).filter((e) => EVENTS.includes(e)), detail: c.detail !== false, dashboardUrl: c.dashboardUrl ? String(c.dashboardUrl) : '' };
}

const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

const FAIL = { rate_limit: 'usage limit', overloaded: 'API overloaded', authentication_failed: 'login failure', oauth_org_not_allowed: 'organization without access',
  account_on_hold: 'account on hold', billing_error: 'billing', invalid_request: 'invalid request', model_not_found: 'model not found', server_error: 'server error',
  max_output_tokens: 'response too long', cloud_credential_error: 'cloud credential', unknown: 'unknown error' };
const END = { clear: 'cleared with /clear', resume: 'switched with /resume', logout: 'logout', prompt_input_exit: 'you left the session', other: 'the session was closed' };

// event → ntfy message (JSON publish: https://docs.ntfy.sh/publish/#publish-as-json)
export function buildMessage(event, data, cfg, project) {
  const click = cfg.dashboardUrl || undefined;
  if (event === 'decision') {
    const q = data.kind === 'question' || data.kind === 'reply';
    const body = !cfg.detail ? 'open the dashboard to answer'
      : q ? (data.questions || []).map((x) => `${x.question} (${(x.options || []).map((o) => o.label).join(' / ')})`).join('\n')
      : cut(data.summary, 300);
    return { title: `${project}: ${q ? 'question for you' : `permission for ${data.tool}`}`, message: body || '—', tags: [q ? 'question' : 'warning'], priority: 4, click };
  }
  if (event === 'agent_stop') {
    return { title: `${project}: ${data.agent_type || 'agent'} finished`, message: cfg.detail ? cut(data.last_assistant_message, 400) || 'no summary' : 'open the dashboard', tags: ['white_check_mark'], priority: 3, click };
  }
  if (event === 'turn_failed') {
    const why = FAIL[data.error] || data.error || 'error';
    const body = cfg.detail ? [data.error_details, data.last_assistant_message].map((x) => cut(x, 300)).filter(Boolean).join('\n') : '';
    return { title: `${project}: turn stopped (${why})`, message: body || 'the session stopped on an error; check the app', tags: ['rotating_light'], priority: 4, click };
  }
  if (event === 'session_end') {
    return { title: `${project}: session ended`, message: END[data.reason] || `reason: ${data.reason || 'unknown'}`, tags: ['stop_sign'], priority: 3, click };
  }
  if (event === 'turn_stop' && data.ask && data.ask.questions && data.ask.questions.length) {   // turn ended with a question for you
    const q = data.ask.questions[0], opts = (q.options || []).map((o) => o.label).filter(Boolean);
    return { title: `${project}: question for you`, message: cfg.detail ? `${cut(q.question, 300)}${opts.length ? `\n${opts.join(' / ')}` : ''}` : 'open the dashboard', tags: ['question'], priority: 4, click };
  }
  if (event === 'turn_stop') {
    return { title: `${project}: session waiting for you`, message: cfg.detail ? cut(data.last_assistant_message, 400) || 'turn finished' : 'turn finished', tags: ['hourglass'], priority: 3, click };
  }
  return { title: `${project}: ${event}`, message: cut(data.message, 400) || '—', tags: [], priority: 3, click };
}

// sends if the event is on; never throws (a notification must not break the hook)
export async function notify(event, data, { projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd(), cfg = loadConfig(projectDir), timeoutMs = 5000 } = {}) {
  if (!cfg || !cfg.on.includes(event)) return { sent: false, reason: cfg ? 'event off' : 'no config' };
  const msg = { topic: cfg.topic, ...buildMessage(event, data || {}, cfg, readProjectName(projectDir)) };
  try {
    const r = await fetch(cfg.server, { method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'content-type': 'application/json', ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}) }, body: JSON.stringify(msg) });
    return { sent: r.ok, status: r.status };
  } catch (e) { return { sent: false, reason: String(e.message || e) }; }
}

// --- editing through the dashboard ---------------------------------------------------------
// what the page shows: the token never goes out, only whether it exists
export function publicView(projectDir) {
  const c = readRaw() || {}, n = c.ntfy || {};
  const ov = c.projects && c.projects[projectKey(projectDir)];
  return { file: configFile(), configured: !!n.topic, disabledByEnv: process.env.AI_TEAM_NOTIFY === '0', events: EVENTS,
    server: n.server || 'https://ntfy.sh', topic: n.topic || '', hasToken: !!n.token,
    on: Array.isArray(c.on) ? withNewEvents(c, c.on).filter((e) => EVENTS.includes(e)) : EVENTS, detail: c.detail !== false, dashboardUrl: c.dashboardUrl || '',
    project: { dir: projectKey(projectDir), on: ov && Array.isArray(ov.on) ? withNewEvents(c, ov.on).filter((e) => EVENTS.includes(e)) : null } };
}

// body: { server, topic, token?, clearToken?, on, detail, dashboardUrl, projectOn: null | [events] }
export function updateConfig(projectDir, body) {
  const b = body || {};
  const server = String(b.server || 'https://ntfy.sh').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(server)) return { error: 'server must be http(s)://…' };
  const topic = String(b.topic || '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(topic)) return { error: 'topic: letters, digits, - and _ (up to 64)' };
  const evs = (x) => (Array.isArray(x) ? [...new Set(x.filter((e) => EVENTS.includes(e)))] : null);
  const on = evs(b.on); if (!on) return { error: 'on must be a list of events' };
  const dashboardUrl = String(b.dashboardUrl || '').trim();
  if (dashboardUrl && !/^https?:\/\/\S+$/.test(dashboardUrl)) return { error: 'dashboard address must be http(s)://…' };
  const c = readRaw() || {};
  const token = b.clearToken ? '' : typeof b.token === 'string' && b.token.trim() ? b.token.trim() : (c.ntfy && c.ntfy.token) || '';
  const out = { ...c, ntfy: { server, topic, token }, on, eventsVersion: EVENTS_VERSION, detail: b.detail !== false, dashboardUrl };
  const key = projectKey(projectDir), projects = { ...(c.projects || {}) };
  if (b.projectOn === null || b.projectOn === undefined) delete projects[key];
  else { const po = evs(b.projectOn); if (!po) return { error: 'projectOn must be null or a list' }; projects[key] = { on: po }; }
  if (Object.keys(projects).length) out.projects = projects; else delete out.projects;
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(out, null, 2) + '\n', { mode: 0o600 });
  try { fs.chmodSync(configFile(), 0o600); } catch {}
  return { ok: true, view: publicView(projectDir) };
}

// hook stdin → event
export function hookEvent(h) {
  if (!h) return null;
  if (h.hook_event_name === 'SubagentStop') return 'agent_stop';
  if (h.hook_event_name === 'Stop' && !h.stop_hook_active) return 'turn_stop';
  if (h.hook_event_name === 'StopFailure') return 'turn_failed';
  if (h.hook_event_name === 'SessionEnd') return 'session_end';
  return null;
}

async function main(argv) {
  const cmd = argv[0];
  if (cmd === 'hook') {
    let h; try { h = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return; }
    const ev = hookEvent(h);
    if (ev === 'turn_stop' && h.transcript_path) h.ask = lastAsk(h.transcript_path);
    if (ev) await notify(ev, h);
    return;
  }
  if (cmd === 'setup') {
    const f = configFile();
    if (fs.existsSync(f)) {   // already exists: only changes the topic, if a different one came; the rest stays
      const c = readRaw();
      if (!c) { console.error(`${f} is not valid JSON; fix or delete it`); process.exitCode = 1; return; }
      if (argv[1] && (!c.ntfy || c.ntfy.topic !== argv[1])) {
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(argv[1])) { console.error('topic: letters, digits, - and _ (up to 64)'); process.exitCode = 2; return; }
        c.ntfy = { server: 'https://ntfy.sh', token: '', ...(c.ntfy || {}), topic: argv[1] };
        fs.writeFileSync(f, JSON.stringify(c, null, 2) + '\n', { mode: 0o600 });
        console.log(`topic changed to ${argv[1]} in ${f}`);
      } else console.log(`already configured in ${f} (topic ${c.ntfy && c.ntfy.topic})`);
      return;
    }
    if (argv[1] && !/^[A-Za-z0-9_-]{1,64}$/.test(argv[1])) { console.error('topic: letters, digits, - and _ (up to 64)'); process.exitCode = 2; return; }
    const topic = argv[1] || `ai-team-${crypto.randomBytes(9).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '')}`;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ ntfy: { server: 'https://ntfy.sh', topic, token: '' }, on: EVENTS, eventsVersion: EVENTS_VERSION, detail: true, dashboardUrl: '' }, null, 2) + '\n', { mode: 0o600 });
    console.log(`created: ${f}\ntopic: ${topic}\non the phone: ntfy app → "+" → subscribe to "${topic}" (server ntfy.sh)\nthen: node ${path.relative(process.cwd(), fileURLToPath(import.meta.url))} test`);
    return;
  }
  if (cmd === 'test') {
    const cfg = loadConfig();
    if (!cfg) { console.error(`no config in ${configFile()} (run: node notify.mjs setup)`); process.exitCode = 1; return; }
    const r = await notify('turn_stop', { last_assistant_message: 'ai-team test notification.' }, { cfg: { ...cfg, on: EVENTS } });
    console.log(r.sent ? `sent to ${cfg.server}/${cfg.topic}` : `failed: ${r.reason || r.status}`);
    if (!r.sent) process.exitCode = 1;
    return;
  }
  console.error('usage: node notify.mjs setup [topic] | test | hook');
  process.exitCode = 2;
}

// realpath: on macOS /var is a link to /private/var (import.meta.url is already resolved)
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
