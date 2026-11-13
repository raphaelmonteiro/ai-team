// Team and Settings tabs of the main page (v3 step 4). Pure HTML builders over /api/team and /api/notify;
// index.html wires the events (save on change, search, scope).
import { esc } from './ui.mjs';

// ---------------------------------------------------------------- Team
export const CONF_LABELS = [
  ['HUB_TEAM', 'Hub team'], ['OUTPUT_LANGUAGE', 'Output language'], ['LAYOUT', 'Layout'], ['BACKEND_STACK', 'Backend'], ['BACKEND_DIR', 'Backend folder'], ['BACKEND_BRANCH', 'Backend branch'],
  ['BACKEND_PROTECTED_BRANCH', 'Protected (backend)'], ['BACKEND_GATE', 'Backend gate'],
  ['FRONTEND_STACK', 'Frontend'], ['FRONTEND_DIR', 'Frontend folder'], ['FRONTEND_BRANCH', 'Frontend branch'],
  ['FRONTEND_PROTECTED_BRANCH', 'Protected (frontend)'], ['FRONTEND_GATE', 'Frontend gate'],
  ['GIT_WORK_BRANCH', 'Work branch'], ['GIT_DEFAULT_BRANCH', 'Default branch'], ['GIT_PROTECTED_BRANCHES', 'Protected branches'],
  ['CI', 'CI'], ['DOCS_CONTEXT', 'Context'], ['DOCS_STANDARDS', 'Code standards'], ['DOCS_ENV', 'Environment'],
];
const GATE_KEYS = ['BACKEND_GATE', 'FRONTEND_GATE'];

// a gate command as one step per line, with a PATH="…" prefix repeated on every step shown once
export function gateLines(cmd) {
  const steps = String(cmd || '').split(/\s*(?:;|&&)\s*/).map((x) => x.trim()).filter(Boolean);
  const pre = /^PATH=("[^"]*"|'[^']*'|\S+)\s+/;
  const first = steps[0] && pre.exec(steps[0]);
  const prefix = first && steps.every((x) => x.startsWith(first[0])) ? first[1].replace(/^["']|["']$/g, '') : null;
  return { prefix, lines: prefix ? steps.map((x) => x.replace(pre, '')) : steps };
}

// what an agent owns, from its description: 'Use for tasks in section "1. Backend"' → 1. Backend; else its first
// sentence without the leading project name ("chroma-x code reviewer." → code reviewer)
export function ownsOf(description, project = '') {
  const d = String(description || '');
  const sec = /section\s+["“]?([0-9]+\.\s*[^"”.]+)["”]?/i.exec(d);
  if (sec) return sec[1].trim();
  let first = d.split(/\.\s/)[0].replace(/\.$/, '');
  if (project && first.toLowerCase().startsWith(project.toLowerCase() + ' ')) first = first.slice(project.length + 1);
  return first.length > 70 ? first.slice(0, 70) + '…' : first;
}

// team: /api/team; running: Set of agent names running now; stats: Map name → { runs, durationMs, usd }; fmt: { dur, usd }
export function teamHtml(team, { running = new Set(), stats = new Map(), extra = '', fmt }) {
  if (!team) return '<p class="note">loading the team…</p>';
  const ctx = team.context || {};
  const rows = team.agents.map((a) => {
    const st = stats.get(a.id) || null;
    return `<tr><td style="width:18px">${running.has(a.id) ? '<span class="st running" title="running now"></span>' : '<span class="st idle"></span>'}</td>
      <td class="mono"><a href="agents/${encodeURIComponent(a.id)}.md" target="_blank" rel="noopener" title="${esc(a.description || '')}">${esc(a.name)}</a>${a.frontmatter ? '' : ' <span class="badge warn">no frontmatter</span>'}</td>
      <td class="sub">${esc(ownsOf(a.description, team.project))}</td><td>${a.model ? `<span class="badge">${esc(a.model)}</span>` : ''}</td>
      <td class="mono sub" title="${esc(a.tools || '')}">${esc(a.tools || '')}</td>
      <td class="num">${st ? st.runs : '—'}</td><td class="num">${st ? fmt.dur(st.durationMs) : '—'}</td>
      <td class="num" title="${st && fmt.tok ? `cache read ${fmt.tok(st.cached || 0)}${st.models && st.models.length ? ` · models: ${esc(st.models.join(', '))}` : ''}` : ''}">${st && fmt.tok ? fmt.tok(st.fresh || 0) : '—'}</td>
      <td class="num">${st ? fmt.usd(st.usd) : '—'}</td><td class="num">${st && st.changes != null ? st.changes : '—'}</td><td>${(st && st.roundsHtml) || ''}</td>
      <td><button type="button" class="lnk" data-open-agent="${esc(a.id)}">open</button></td></tr>`;
  }).join('');
  const e = team.entry, lead = team.agents.some((a) => a.id === 'orchestrator');
  let entry = '';
  if (e && lead) {
    const items = e.fixedAgent
      ? [`Every session starts as <b>${esc(e.fixedAgent)}</b> (<code>"agent"</code> in <code>.claude/settings.json</code>).`]
      : [e.skill ? '<code>/team &lt;request&gt;</code> in any session' : 'skill <code>/team</code> not installed: run <code>install.sh</code> again', '<code>claude --agent orchestrator</code>'];
    if (!e.fixedAgent && e.skill && !e.compactHooks) items.push('<span class="badge warn">warning</span> the <code>SessionStart</code> / <code>UserPromptExpansion</code> hooks are missing: after compaction the <code>/team</code> session loses the hook reminder');
    entry = `<p class="note">Call the team with ${items.join(' · ')}. Without that, the session is plain Claude (a loose session).</p>`;
  }
  const gates = GATE_KEYS.filter((k) => ctx[k]).map((k) => {
    const g = gateLines(ctx[k]);
    const side = k.startsWith('BACKEND') ? 'backend' : 'frontend';
    const head = [side, ctx[`${side.toUpperCase()}_STACK`], ctx[`${side.toUpperCase()}_DIR`] && `${ctx[`${side.toUpperCase()}_DIR`]}/`].filter(Boolean).join(' · ');
    return `<div class="gate"><div class="sub mono">${esc(head)}</div><pre class="code">${esc(g.lines.join('\n'))}</pre>${g.prefix ? `<div class="sub mono">every line runs with PATH=${esc(g.prefix)}</div>` : ''}<button type="button" class="lnk" data-copy="${esc(ctx[k])}">copy the full command</button></div>`;
  }).join('');
  const kv = CONF_LABELS.filter(([k]) => ctx[k] && !GATE_KEYS.includes(k)).map(([k, l]) => `<div class="k">${esc(l)}</div><div class="v" title="${esc(k)}">${esc(ctx[k])}</div>`).join('');
  return `<div class="teamtab">
    <p class="note">${team.agents.length} agent${team.agents.length === 1 ? '' : 's'} in <code>.claude/agents/</code>${ctx.PROJECT_DESCRIPTION ? ` · ${esc(String(ctx.PROJECT_DESCRIPTION).replace(/\*\*/g, '').slice(0, 160))}` : ''}</p>
    ${team.agents.length ? `<div class="ctbl scroll"><table><thead><tr><th></th><th>agent</th><th>owns</th><th>model</th><th>tools</th><th class="num">runs</th><th class="num">time</th><th class="num" title="fresh tokens (hover: cache read and models used)">fresh</th><th class="num">cost</th><th class="num">changes</th><th>last rounds</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>${extra}` : '<div class="empty">No agent in <code>.claude/agents/</code>. Run <code>install.sh</code> in the project.</div>'}
    ${entry}
    ${gates ? `<h2>Gates<span class="sub" style="text-transform:none;letter-spacing:0;font-weight:400">run before a section is marked done</span></h2><div class="gates">${gates}</div>` : ''}
    ${kv ? `<h2>Project context<span class="sub" style="text-transform:none;letter-spacing:0;font-weight:400">from .claude/ai-team.conf</span></h2><div class="kvgrid">${kv}</div>` : ''}

  </div>`;
}

// ---------------------------------------------------------------- Settings
export const NOTIFY_EVENTS = {
  decision: ['Decision waiting for you', 'permission or question, the same as in the dashboard'],
  agent_stop: ['Agent finished', 'each team subagent that ends'],
  turn_stop: ['Session waiting for you', 'the main session finished its turn'],
  turn_failed: ['Turn stopped on error', 'usage limit, API overloaded, login failure'],
  session_end: ['Session ended', '/clear, /resume, logout or the session closed (Esc does not notify: there is no hook)'],
  budget: ['Change over budget', 'estimated cost past BUDGET_SMALL_USD / BUDGET_LARGE_USD, once per change'],
};
// the body POST /api/notify expects, from the current view plus the changed fields
export function notifyBody(view, patch = {}) {
  return { topic: view.topic, server: view.server, token: '', clearToken: false, on: view.on, detail: view.detail, quietAtComputer: !!view.quietAtComputer,
    dashboardUrl: view.dashboardUrl, projectOn: view.project ? view.project.on : null, ...patch };
}

const row = (group, label, desc, control, opts = {}) => `<div class="set${opts.mod ? ' mod' : ''}" data-group="${esc(group)}" data-text="${esc(`${group} ${label} ${desc} ${opts.key || ''}`.toLowerCase())}">
  <div class="lbl"><b>${esc(label)}</b>${opts.key ? ` <code class="sub">${esc(opts.key)}</code>` : ''}</div>${desc ? `<div class="desc">${desc}</div>` : ''}${control}</div>`;
const check = (name, on, text, extra = '') => `<label class="chk"><input type="checkbox" data-set="${name}"${on ? ' checked' : ''}${extra}> <span>${text}</span></label>`;

// a heading before the first row of each group, so a row's group shows next to it (the left menu jumps to these)
const withHeads = (html) => { let cur = null; return html.split(/(?=<div class="set[ "])/).map((part) => {
  const g = (/^<div class="set[^"]*" data-group="([^"]*)"/.exec(part) || [])[1];
  if (!g || g === cur) return part;
  cur = g; return `<h3 class="setgrp" data-grp="${g}">${g}</h3>${part}`;
}).join(''); };
// the bar over the ai-team.conf fields: pending changes → review (files that change, hand-edited ones kept, agents
// running) → save; after saving, what changed and an undo. conf: { view, edits: Map, review, result, errors, error, busy }
const fmtAt = (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
export function confBar(conf) {
  if (!conf || !conf.view || !conf.view.canEdit) return '<div id="confbar"></div>';
  const v = conf.view, n = conf.edits.size, list = (xs) => xs.map((x) => `<code>${esc(x)}</code>`).join(' ');
  const err = conf.error ? `<div class="seterr">${esc(conf.error)}</div>` : '';
  const undo = v.lastBackup ? `<button type="button" class="btn" data-act="conf-undo"${conf.busy ? ' disabled' : ''} title="put back the ai-team.conf saved at ${fmtAt(v.lastBackup)} and render again">Undo last change</button>` : '';
  let inner;
  if (conf.busy) inner = `<span>${esc(conf.busy)}…</span>`;
  else if (conf.review) {
    const r = conf.review, old = new Map(v.keys.map((k) => [k.key, k.value]));
    inner = `<div class="cbhead"><b>Review ${Object.keys(r.changes).length} change${Object.keys(r.changes).length === 1 ? '' : 's'}</b></div>
      <ul class="cblist">${Object.entries(r.changes).map(([k, val]) => `<li><code>${esc(k)}</code> <span class="sub">${esc(old.get(k) || '(empty)')}</span> → <b>${esc(val || '(empty)')}</b></li>`).join('')}</ul>
      <div>Files rewritten: ${list(r.changed)}</div>
      ${r.handEdited.length ? `<div class="cbwarn">Edited by hand, kept as they are (not rewritten): ${list(r.handEdited)}</div>` : ''}
      ${r.running && r.running.length ? `<div class="cbwarn">Running now: ${esc(r.running.join(', '))}. They read their files when a round starts: the change applies from their next round.</div>` : ''}
      <div class="cbacts"><button type="button" class="btn pri" data-act="conf-save">Save and re-render</button><button type="button" class="btn" data-act="conf-back">Back</button></div>`;
  } else if (n) inner = `<span><b>${n}</b> change${n === 1 ? '' : 's'} to ai-team.conf</span><span class="grow"></span><button type="button" class="btn pri" data-act="conf-review">Review</button><button type="button" class="btn" data-act="conf-discard">Discard</button>`;
  else if (conf.result) {
    const r = conf.result;
    inner = `<span>${r.restored ? 'Previous version restored' : 'Saved'}: ${r.changed.length ? `rewrote ${list(r.changed)}` : 'no file needed a change'}.</span>${r.handEdited && r.handEdited.length ? ` <span class="cbwarn">Kept (edited by hand): ${list(r.handEdited)}</span>` : ''}<span class="grow"></span>${undo}`;
  } else inner = `<span class="sub">Edit a field and review before saving: the clone's install.sh rewrites the agents and project-context.md from the conf.</span><span class="grow"></span>${undo}`;
  return `<div id="confbar" class="setbar${conf.review ? ' review' : n ? ' pending' : ''}">${inner}${err}</div>`;
}

// view: /api/notify; team: /api/team (for the read-only project keys); ui: { theme, crt, themes, walker, walkers }
export function settingsHtml(view, team, { scope = 'user', ui = {}, conf = null } = {}) {
  if (!view) return '<p class="note">loading the settings…</p>';
  const ev = (name, sel) => Object.keys(NOTIFY_EVENTS).filter((k) => view.events.includes(k)).map((k) => check(`${name}:${k}`, sel.includes(k), `${esc(NOTIFY_EVENTS[k][0])} <span class="sub">${esc(NOTIFY_EVENTS[k][1])}</span>`)).join('');
  let groups, body;
  if (scope === 'user') {
    groups = ['Notifications', 'Events', 'Content', 'Appearance'];
    body = [
      row('Notifications', 'Topic', 'The name you subscribe to in the ntfy phone app. Anyone who knows it reads the messages on a public server.',
        `<div class="ctl"><input class="in" type="text" data-set="topic" value="${esc(view.topic)}" autocomplete="off" spellcheck="false" placeholder="ai-team-…"><button type="button" class="btn" data-act="gen-topic">Random</button></div>`, { mod: !!view.topic }),
      row('Notifications', 'Server', 'https://ntfy.sh or your own server.', `<input class="in" type="url" data-set="server" value="${esc(view.server)}" spellcheck="false">`, { mod: view.server !== 'https://ntfy.sh' }),
      row('Notifications', 'Access token', view.hasToken ? 'A token is saved. Type a new one to replace it.' : 'Only when the server (or a reserved topic) requires it.',
        `<input class="in" type="password" data-set="token" autocomplete="new-password" placeholder="${view.hasToken ? 'saved (leave empty to keep)' : ''}">${view.hasToken ? check('clearToken', false, 'delete the saved token') : ''}`, { mod: view.hasToken }),
      row('Notifications', 'Dashboard address', 'Opened when you tap a notification (a Tailscale address; in a hub, the project page …/p/&lt;name&gt;/). With it, a permission gets Allow / Deny buttons.',
        `<input class="in" type="url" data-set="dashboardUrl" value="${esc(view.dashboardUrl)}" spellcheck="false" placeholder="https://…">`, { mod: !!view.dashboardUrl }),
      row('Events', 'Notify when', '', `<div class="checks">${ev('on', view.on)}</div>`),
      row('Content', 'Send the content', '', check('detail', view.detail, 'The requested command, the question options and the start of the agent text. Off: only the title goes. Tokens, passwords and Authorization headers are blanked either way.')),
      row('Content', 'Only when away', '', check('quietAtComputer', view.quietAtComputer, '"Agent finished" and "Session waiting" go out only with the dashboard\'s Away switch on. Decisions, errors and session end always go.'), { mod: !!view.quietAtComputer }),
      row('Appearance', 'Theme', 'auto follows the system (dark → default, light → light). Kept in this browser.',
        `<select class="in sel" data-ui="theme">${(ui.themes || []).map((t) => `<option${t === ui.theme ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`, { path: 'Dashboard' }),
      row('Appearance', 'CRT effects', '', check('ui:crt', ui.crt, 'An old-monitor look: scanlines and a soft vignette over the page, a glow on the logo, the live mark and the running dots, and a short flicker when a decision arrives. With reduced motion on in the system, nothing moves. Kept in this browser.'), { path: 'Dashboard' }),
      row('Appearance', 'Walker', 'The little dev that walks while the page is live (it stands dimmed when the connection drops): green like the word "live" in every theme, or the theme\'s accent color. Kept in this browser.',
        `<select class="in sel" data-ui="walker">${(ui.walkers || ['green', 'theme']).map((c) => `<option${c === (ui.walker || 'green') ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>`, { path: 'Dashboard', mod: ui.walker === 'theme' }),
      row('Appearance', 'Layout', 'Explorer width, panel height, folded groups and open tabs are kept in this browser.', '<button type="button" class="btn" data-act="reset-layout">Reset layout</button>', { path: 'Dashboard' }),
    ].join('');
  } else {
    // ai-team.conf: the safe keys are fields saved through the clone's install.sh (conf-edit.mjs); the gate commands
    // are run by the agents, so they only change from a terminal
    const cv = conf && conf.view;
    const cmdOf = (k, v) => `./install.sh --render --set ${k}=${/\s/.test(v) ? `'${String(v).replace(/'/g, "'\\''")}'` : v} .`;
    let rows;
    if (cv && cv.canEdit) {
      rows = cv.keys.map((k) => {
        const edited = conf.edits.has(k.key), v = edited ? conf.edits.get(k.key) : k.value, err = conf.errors && conf.errors[k.key];
        return row(k.group, k.label, '', `<input class="in${err ? ' bad' : ''}" type="text" data-conf="${k.key}" value="${esc(v)}" spellcheck="false" autocomplete="off"${conf.busy ? ' disabled' : ''}>${err ? `<div class="seterr">${esc(err)}</div>` : ''}`, { key: k.key, mod: edited });
      }).join('');
    } else if (cv) {
      rows = `<p class="note">${esc(cv.reason)}</p>` + cv.keys.filter((k) => k.value).map((k) => row(k.group, k.label, '',
        `<div class="ctl"><input class="in" type="text" value="${esc(k.value)}" readonly><button type="button" class="btn" data-copy="${esc(cmdOf(k.key, k.value))}" title="${esc(cmdOf(k.key, k.value))}">copy --set</button></div>`, { key: k.key })).join('');
    } else rows = '<p class="note">loading the project keys…</p>';
    const keyGroups = cv ? [...new Set(cv.keys.map((k) => k.group))] : [];
    groups = ['Notifications', ...keyGroups, 'Gate'];
    body = row('Notifications', 'Other events in this project', `Overrides the User events only for <code>${esc(view.project.dir)}</code>.`,
      `${check('override', !!view.project.on, 'Use other events in this project')}${view.project.on ? `<div class="checks">${ev('projectOn', view.project.on)}</div>` : ''}`, { mod: !!view.project.on })
      + confBar(conf) + rows
      + row('Gate', 'Gate commands', 'Lint, format, type check, tests and build are run by the agents, so they never change from a browser. They are listed in the Team tab; change one from the clone with <code>./install.sh --render --set BACKEND_CMD_TEST=\'…\' .</code> (or FRONTEND_…, _LINT, _FORMAT, _TYPECHECK, _BUILD).', '');
  }
  const warn = scope === 'user' && view.detail && view.publicTopic
    ? '<div class="setwarn"><span>⚠</span><span>The content goes to the public <code>ntfy.sh</code> without a token: anyone who guesses the topic reads the commands awaiting your approval.</span><button type="button" class="btn" data-act="content-off">Turn content off</button></div>' : '';
  const env = view.disabledByEnv ? '<div class="setwarn"><span>⚠</span><span><code>AI_TEAM_NOTIFY=0</code> is set in the dashboard environment: nothing is sent.</span></div>' : '';
  return `<div class="settab" data-scope="${scope}">
    <div class="setsearch"><input type="search" id="setq" placeholder="Search settings" autocomplete="off" spellcheck="false"><span class="sub" id="setfound"></span></div>
    <div class="setscope" role="tablist"><button type="button" role="tab" data-scope="user" class="${scope === 'user' ? 'cur' : ''}">User <span class="sub" title="${esc(view.file)}">${esc(ui.tilde ? ui.tilde(view.file) : view.file)}</span></button><button type="button" role="tab" data-scope="project" class="${scope === 'project' ? 'cur' : ''}">This project <span class="sub">${esc(view.project.dir.split(/[\\/]/).pop())}</span></button>
      <span class="grow"></span><span class="msg" id="setmsg"></span><button type="button" class="btn" data-act="test">Send test</button><button type="button" class="btn" data-act="raw">${scope === 'user' ? 'Open notify.json' : 'Open the keys'}</button></div>
    ${env}${warn}
    <div class="setcols"><nav class="settoc">${groups.map((g, i) => `<button type="button" data-toc="${esc(g)}"${i ? '' : ' class="cur"'}>${esc(g)}</button>`).join('')}</nav><div class="setrows">${withHeads(body)}</div></div>
    <pre class="code setraw" hidden>${esc(JSON.stringify(scope === 'user' ? { file: view.file, topic: view.topic, server: view.server, token: view.hasToken ? '(saved)' : '', on: view.on, detail: view.detail, quietAtComputer: !!view.quietAtComputer, dashboardUrl: view.dashboardUrl, projects: { [view.project.dir]: { on: view.project.on } } } : ((team && team.context) || {}), null, 2))}</pre>
  </div>`;
}
