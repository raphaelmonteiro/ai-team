// ai-team — sessions from the dashboard, page side: the composer (ask a question, start a session, send a message to
// one) and the answers the server keeps (launch.mjs; `launch` in /api/state). Pure functions that return HTML; the
// wiring (open, submit, the typed text kept across redraws) lives in index.html.
import { esc, fmtTime, fmtUsd, fmtDur, mdToHtml } from './ui.mjs';

export const MODES = ['ask', 'start', 'send'];
const firstLine = (s, n = 140) => { const l = String(s || '').split('\n').find((x) => x.trim()) || ''; return l.length > n ? `${l.slice(0, n - 1)}…` : l; };

// the sessions the dashboard lists, as targets: a question goes to any of them (a copy answers); a message only to a
// background session that is idle, since nothing delivers one to a session open in a terminal or in the app
export function targets(state, sessions) {
  const mains = new Map(((state && state.mainRuns) || []).map((m) => [m.sessionId, m]));
  return (sessions || []).map((s) => {
    const m = mains.get(s.sessionId) || {};
    const busy = s.state === 'working' || s.state === 'waiting' || !!(m.proc && m.proc !== 'idle');
    return { sessionId: s.sessionId, name: s.name, state: s.state, change: s.change || null, bg: m.bg || null, proc: m.proc || null, busy, canSend: !!m.bg && !busy };
  });
}

// ready-made texts for the box, by what is being written and to whom: [label, text]
export function suggestions(state, mode, target) {
  if (mode === 'ask') {
    return target
      ? [['status', 'What is the status of this session? What is done, what is left and what is waiting for me?'], ['summary', 'Summarize what this session did and the decisions it took, in a few lines.'], ['why', 'Why did you do it this way? ']]
      : [['open changes', 'Which changes are open and where does each one stand?'], ['find', 'Find the change or the session that dealt with: ']];
  }
  if (mode === 'send') return [['go on', 'Go on.'], ['status', 'Where does this stand? Report in a few lines.']];
  const bd = (state && state.board) || {}, byId = new Map(((state && state.changes) || []).map((c) => [c.id, c]));
  const idle = (id) => { const c = byId.get(id); return c && c.kind !== 'no-change' && !String(id).startsWith('adhoc:') && !((c.activeAgents || []).length); };
  const ids = [...new Set([...(bd.stuck || []), ...(bd.pending || []), ...(bd.running || []), ...(bd.blocked || [])])].filter(idle).slice(0, 6);
  return ids.map((id) => [`resume ${id}`, `/team resume ${id}`]);
}

const NOTE = {
  ask: (t) => (t ? 'Read-only: a copy of the session answers, with everything it knows; the session itself goes on untouched. It costs one reading of its context.'
    : 'Read-only: a fresh run that reads the project and searches its past sessions. It changes nothing.'),
  start: (t, team) => `Starts a session in the background, in this project${team ? ', as the team\'s orchestrator' : ''}. Its permission requests and questions come to this page; <code>claude attach &lt;id&gt;</code> opens it in a terminal.`,
  send: () => 'The session goes on in the background from your message.',
};
const PLACEHOLDER = { ask: 'Your question…', start: 'What should be done? e.g. resume <change-id>, or a small fix with its cause…', send: 'Your message to the session…' };
const SUBMIT = { ask: 'Ask', start: 'Start session', send: 'Send' };

// ui: { mode, sid, text, team, busy, pinned }; view: state.launch; tg: targets()
// With a session as the target the card is its conversation (thread.mjs fills `[data-thread]`): what it was asked and
// what it answered, then the box. A background session can be sent a message; any session can be asked (a copy answers).
export function composerHtml(ui, view, tg, state) {
  const target = ui.sid ? tg.find((t) => t.sessionId === ui.sid) || null : null;
  const mode = MODES.includes(ui.mode) && (ui.mode !== 'send' || (target && target.bg)) ? ui.mode : 'ask';
  const modes = [...(target && target.bg ? ['send'] : []), 'ask', ...(ui.pinned ? [] : ['start'])], LABEL = { send: 'Send', ask: 'Ask', start: 'Start a session' };
  const seg = modes.map((m) => `<button type="button" role="tab" aria-selected="${mode === m}" class="${mode === m ? 'on' : ''}" data-launch-mode="${m}">${LABEL[m]}</button>`).join('');
  const fixed = mode === 'send' || (ui.pinned && target);   // a session's own screen talks to that session only
  const to = mode === 'ask' && !fixed
    ? `<label class="lto">to <select name="sid" aria-label="Who answers"><option value="">this project (a fresh run)</option>${tg.map((t) => `<option value="${esc(t.sessionId)}"${t.sessionId === ui.sid ? ' selected' : ''}>${esc(t.name)}${t.change ? ` · ${esc(t.change)}` : ''}</option>`).join('')}</select></label>`
    : fixed ? `<span class="lto">to <b>${esc(target ? target.name : String(ui.sid || '').slice(0, 8))}</b></span>` : '';
  const wait = mode === 'send' && target && !target.canSend;   // a session answering takes no message until it is done
  const chips = suggestions(state, mode, target).map(([label, text]) => `<button type="button" class="lchip" data-launch-fill="${esc(text)}">${esc(label)}</button>`).join('');
  const team = mode === 'start' && view && view.team
    ? `<label class="lteam"><input type="checkbox" name="team"${ui.team === false ? '' : ' checked'}> through the team (<code>/team</code>): the orchestrator decides whether it is a question, an ad-hoc task or a change</label>` : '';
  const off = !view || !view.enabled;
  return `<form class="dec lform" data-launch-form="${mode}">
    <div class="top"><div class="lseg" role="tablist">${seg}</div>${to}${ui.pinned ? '' : '<button type="button" class="lx" data-launch-close aria-label="Close" title="Close (Esc)">×</button>'}</div>
    ${target ? '<div class="lth" data-thread role="log" aria-label="Conversation"></div>' : ''}
    <textarea name="prompt" rows="3" maxlength="8000" placeholder="${esc(PLACEHOLDER[mode])}" aria-label="${esc(PLACEHOLDER[mode])}"${off ? ' disabled' : ''}>${esc(ui.text || '')}</textarea>
    ${chips ? `<div class="lchips">${chips}</div>` : ''}${team}
    <div class="acts"><button type="submit" class="pri"${off || ui.busy || wait ? ' disabled' : ''}>${SUBMIT[mode]} <span class="kbd">⌘↵</span></button><span class="msg${off ? ' err' : ''}" aria-live="polite">${off ? esc((view && view.reason) || 'not available') : wait ? 'the session is answering: you can send when it is done' : ''}</span></div>
    <p class="note lnote">${NOTE[mode](target, mode === 'start' && view && view.team && ui.team !== false)}</p></form>`;
}

// the questions asked from here, newest first: running, answered (Markdown rendered) or failed
export function asksHtml(asks) {
  const row = (a) => {
    const who = a.sessionId ? esc(a.sessionName || a.sessionId.slice(0, 8)) : 'the project';
    const body = a.status === 'running' ? `<div class="lwait"><span class="dot pulse" style="background:var(--ok)"></span> asking ${who}… <span class="sub" data-since="${a.at}"></span></div>`
      : a.status === 'done' ? `<div class="doc lbody">${mdToHtml(a.answer || '')}</div>${a.cut ? '<p class="note">The answer was cut at 20,000 characters.</p>' : ''}`
      : `<div class="lerr">${esc(a.error || 'no answer')}</div>`;
    const meta = [fmtTime(a.at), a.status === 'done' && a.model ? esc(a.model) : null, a.usd != null ? fmtUsd(a.usd) : null, a.ms ? fmtDur(a.ms) : null].filter(Boolean).join(' · ');
    return `<div class="lans${a.status === 'failed' ? ' bad' : ''}" data-ask="${esc(a.id)}">
      <div class="lq"><span class="lqt"><b>${esc(firstLine(a.prompt))}</b><span class="sub">to ${who} · ${meta}</span></span>
        <span class="lqa"><button type="button" class="btn" data-ask-again="${esc(a.id)}" title="Ask the same target again">Ask again</button><button type="button" class="lx" data-ask-dismiss="${esc(a.id)}" aria-label="Remove this answer" title="Remove">×</button></span></div>
      ${body}</div>`;
  };
  return (asks || []).map(row).join('');
}

// the text a selected passage puts in the box: the quote, where it comes from, and room for the question
export function quoteText(sel, where) {
  const q = String(sel || '').replace(/\r\n?/g, '\n').trim().slice(0, 1500);
  if (!q) return '';
  return `About this passage${where ? ` of ${where}` : ''}:\n${q.split('\n').map((l) => `> ${l}`).join('\n')}\n\n`;
}
