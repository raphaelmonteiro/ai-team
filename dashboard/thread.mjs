// ai-team — the conversation of a session, page side: what /api/tail returns for `main:<session id>` (the last steps of
// its transcript, tail.mjs) turned into a chat: what was asked, what the session answered, and the work in between
// folded into a count. Pure functions that return data or HTML; the polling and the redraw live in index.html.
import { esc, fmtClock, mdToHtml } from './ui.mjs';

export const SHOWN = 10;   // conversation items shown at first; the rest sit behind "earlier"

// What the user typed, as it was typed: a slash command is recorded with its tags, and some records that look like a
// prompt are the harness talking (hooks, reminders, background task notices): those are left out.
export function cleanPrompt(text) {
  const s = String(text || '').trim();
  const cmd = /<command-name>\s*\/?([^<\s]+)\s*<\/command-name>/.exec(s);
  if (cmd) { const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(s); return `/${cmd[1]}${args && args[1].trim() ? ` ${args[1].trim()}` : ''}`; }
  if (/^<(system-reminder|local-command|task-notification|command-message|bash-)/.test(s)) return null;
  return s || null;
}

// steps → items: { k: 'you'|'ai'|'work'|'note', t, text | n }. Tool calls and their results fold into 'work' (n calls)
export function threadItems(steps) {
  const items = []; let work = 0;
  const flush = () => { if (work) { items.push({ k: 'work', n: work }); work = 0; } };
  for (const s of steps || []) {
    if (s.k === 'prompt') { const text = cleanPrompt(s.text); if (text) { flush(); items.push({ k: 'you', t: s.t, text }); } }
    else if (s.k === 'text') { flush(); items.push(/^\[Request interrupted/.test(s.text) ? { k: 'note', t: s.t, text: 'interrupted' } : { k: 'ai', t: s.t, text: s.text }); }
    else if (s.k === 'note') { flush(); items.push({ k: 'note', t: s.t, text: s.text }); }
    else if (s.k === 'tool') work++;
  }
  flush();
  return items;
}

// A message just sent is shown at once, from the page; it stops being shown when the transcript has it. `steps` are
// the ones a read returned: a continued read (reset false) holds only what the file gained, so any prompt is the new
// one; the first read holds the end of the file, so the prompt has to be the one that was sent (compared by its start,
// without the /team the server may have put in front, since the transcript clips long prompts).
export function arrived(local, steps, reset = false) {
  if (!local) return false;
  const norm = (s) => String(s || '').replace(/^\/team\s+/, '').trim();
  const mine = norm(local.text).slice(0, 100);
  return (steps || []).some((s) => { if (s.k !== 'prompt') return false; const c = cleanPrompt(s.text); return !!c && (!reset || norm(c).startsWith(mine)); });
}

// the last reply the session wrote after the last thing it was asked (what "did it answer?" looks at)
export const lastReply = (items) => { for (let i = items.length - 1; i >= 0; i--) { if (items[i].k === 'you') return null; if (items[i].k === 'ai') return items[i]; } return null; };

// th: { steps, local: { text } | null (a message sent that the transcript does not have yet), err, all (show everything),
// working (the session is answering), name, limit (items shown at first; SHOWN) }
export function threadHtml(th) {
  const items = threadItems(th.steps), local = th.local && !th.local.arrived ? th.local : null;
  const hidden = th.all ? 0 : Math.max(0, items.length - (th.limit || SHOWN)), shown = items.slice(hidden);
  const who = esc(th.name || 'session');
  const row = (i) => {
    const at = i.t ? `<span class="t">${esc(fmtClock(i.t))}</span>` : '';
    if (i.k === 'you') return `<div class="th you"><div class="thh"><b>you</b>${at}</div><div class="thx">${esc(i.text)}</div></div>`;
    if (i.k === 'ai') return `<div class="th ai"><div class="thh"><b>${who}</b>${at}</div><div class="doc thx">${mdToHtml(i.text)}</div></div>`;
    if (i.k === 'work') return `<div class="th work">▸ ${i.n} tool call${i.n === 1 ? '' : 's'}</div>`;
    return `<div class="th work">· ${esc(i.text)}</div>`;
  };
  const empty = !shown.length && !local;
  return `${hidden ? `<button type="button" class="th more" data-thread-more>${hidden} earlier</button>` : ''}`
    + shown.map(row).join('')
    + (local ? `<div class="th you pend"><div class="thh"><b>you</b><span class="t">sending…</span></div><div class="thx">${esc(local.text)}</div></div>` : '')
    + (th.working ? `<div class="th wait"><span class="dot pulse" style="background:var(--ok)"></span> ${who} is answering…${th.since ? ` <span class="sub" data-since="${th.since}"></span>` : ''}</div>` : '')
    + (empty ? `<div class="th work">${th.err ? esc(th.err) : 'reading the conversation…'}</div>` : '');
}
