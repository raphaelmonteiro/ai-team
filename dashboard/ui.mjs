// ai-team dashboard: helpers shared by the pages (served at /ui.mjs). Formats are the same everywhere:
// fmtTime  HH:MM today, DD/MM HH:MM this year, DD/MM/YY HH:MM before that
// fmtClock HH:MM:SS (the "last change" stamp in the header)
// fmtDur   5s · 5min 03s · 2h 05min
// ago      now · 5 min ago · 3 h ago · 2 days ago (hub cards)
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function fmtDur(ms) {
  if (!ms || ms < 1000) return '0s';
  const s = Math.round(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h) return `${h}h ${String(m % 60).padStart(2, '0')}min`;
  if (m) return `${m}min ${String(s % 60).padStart(2, '0')}s`;
  return `${s}s`;
}
// $0.0042 · $0.38 · $12.5 · $1,234 (estimated cost; — without a price)
export function fmtUsd(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n === 0) return '$0';
  if (n < 0.01) return `$${n.toFixed(4).replace(/0+$/, '')}`;
  if (n < 1) return `$${n.toFixed(2)}`;
  if (n < 100) return `$${n.toFixed(2).replace(/\.?0+$/, '')}`;
  return `$${Math.round(n).toLocaleString('en-US')}`;
}
export function fmtTok(n) { n = n || 0; return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'k' : String(n); }
export function fmtTime(t) {
  if (!t) return '—';
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return hm;
  const day = d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit', ...(d.getFullYear() === now.getFullYear() ? {} : { year: '2-digit' }) });
  return `${day} ${hm}`;
}
export const fmtClock = (t) => (t ? new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—');
export function ago(t) {
  if (!t) return 'no activity';
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
}
// JSON GET: an expired outside session (401) goes to the login page; any other failure throws
export async function getJson(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (r.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; throw new Error('login required'); }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// Markdown → HTML, the subset the change artifacts use (headings, lists, fenced code, tables, quotes, bold,
// italics, inline code, links). Everything is escaped first. Headings get an id (slug); a line or heading that
// starts with D-<n>, R<k>, PV-<n>, B<n>, L-<n> or DT-<n> gets id "<kind>-<n>" (lowercase) so a link can jump to it.
export function mdToHtml(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|#[^)\s]+|[\w./-]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const slug = (s) => s.toLowerCase().replace(/<[^>]+>/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  const markId = (s) => { const m = /^\s*(?:[-*]\s+)?(?:\*\*)?(D|R|PV|B|L|DT)-?(\d+)\b/i.exec(s); return m ? ` id="${m[1].toLowerCase()}-${m[2]}"` : ''; };
  let i = 0;
  const para = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para.length = 0; } };
  while (i < lines.length) {
    const l = lines[i];
    let m;
    if ((m = /^```(\w*)\s*$/.exec(l))) {
      flush(); const code = []; i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; out.push(`<pre><code${m[1] ? ` class="lang-${esc(m[1])}"` : ''}>${esc(code.join('\n'))}</code></pre>`); continue;
    }
    if ((m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l))) { flush(); const n = m[1].length; const id = markId(m[2]) || ` id="${slug(m[2])}"`; out.push(`<h${n}${id}>${inline(m[2])}</h${n}>`); i++; continue; }
    if (/^\s*(?:[-*_]\s*){3,}$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      flush(); const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => inline(c.trim()));
      const head = cells(l); i += 2; const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`); continue;
    }
    if (/^\s*>/.test(l)) { flush(); const q = []; while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, '')); out.push(`<blockquote>${mdToHtml(q.join('\n'))}</blockquote>`); continue; }
    if ((m = /^(\s*)([-*+]|\d+[.)])\s+/.exec(l))) {
      flush(); const ordered = /\d/.test(m[2]); const items = []; const base = m[1].length;
      while (i < lines.length) {
        const mm = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i]);
        if (mm && mm[1].length === base) { items.push([lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''), []]); i++; continue; }
        if (lines[i].trim() && items.length && (/^\s+/.test(lines[i]) || (mm && mm[1].length > base))) { items[items.length - 1][1].push(lines[i]); i++; continue; }
        break;
      }
      const li = items.map(([t, rest]) => { const sub = rest.length ? mdToHtml(rest.map((r) => r.slice(Math.min(base + 2, r.length - r.trimStart().length))).join('\n')) : '';
        return `<li${markId(t)}>${inline(t)}${sub}</li>`; });
      out.push(`<${ordered ? 'ol' : 'ul'}>${li.join('')}</${ordered ? 'ol' : 'ul'}>`); continue;
    }
    if (/^\s*<!--.*-->\s*$/.test(l)) { flush(); out.push(`<p class="marker"><code>${esc(l.trim())}</code></p>`); i++; continue; }
    if (!l.trim()) { flush(); i++; continue; }
    para.push(l.trim()); i++;
  }
  flush();
  return out.join('\n');
}

// ---- theme, CRT effects, command palette and deep links (shared by the pages) ----------------------------------
// The choice lives in this browser (localStorage); each page's <head> applies it before the first paint with a
// one-line inline script, so the page never flashes the other theme. "auto" follows the system (no data-theme).
export const THEMES = ['auto', 'default', 'dracula', 'hacker', 'light'];
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: not kept */ } },
};
export const getTheme = () => (THEMES.includes(store.get('ai-team:theme')) ? store.get('ai-team:theme') : 'auto');
export function setTheme(t) {
  const root = document.documentElement;
  if (!THEMES.includes(t) || t === 'auto') { delete root.dataset.theme; store.set('ai-team:theme', null); }
  else { root.dataset.theme = t; store.set('ai-team:theme', t); }
}
export const getCrt = () => store.get('ai-team:crt') === '1';
export function setCrt(on) {
  const root = document.documentElement;
  if (on) { root.dataset.crt = ''; store.set('ai-team:crt', '1'); } else { delete root.dataset.crt; store.set('ai-team:crt', null); }
}

// palette filter: -1 when the query does not match; lower is better (substring by position, then a subsequence)
export function matchScore(query, text) {
  const q = String(query || '').trim().toLowerCase(), t = String(text || '').toLowerCase();
  if (!q) return 0;
  const at = t.indexOf(q);
  if (at >= 0) return at;
  let i = 0, gaps = 0, last = -1;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) { if (last >= 0) gaps += j - last - 1; last = j; i++; }
  return i === q.length ? 1000 + gaps : -1;
}

// the palette's list for a query: groups keep their order, a label match beats a group/hint match, best first
export function rankCommands(cmds, query) {
  const order = new Map();
  cmds.forEach((c) => { if (!order.has(c.group)) order.set(c.group, order.size); });
  return cmds.map((c, i) => {
    const a = matchScore(query, c.label), b = matchScore(query, `${c.group} ${c.label} ${c.hint || ''}`);
    return { c, i, s: a >= 0 ? a : b >= 0 ? b + 2000 : -1 };
  }).filter((x) => x.s >= 0)
    .sort((x, y) => order.get(x.c.group) - order.get(y.c.group) || x.s - y.s || x.i - y.i)
    .map((x) => x.c);
}

// deep link to an open drawer: #change=<id> or #agent=<name>
// #change=<id>, #agent=<name>, and the singleton tabs #team and #settings
export function parseHash(hash) {
  const h = String(hash || '');
  const one = /^#?(team|settings)$/.exec(h);
  if (one) return { kind: one[1], id: one[1] };
  const m = /^#?(change|agent)=(.+)$/.exec(h);
  if (!m) return null;
  try { return { kind: m[1], id: decodeURIComponent(m[2]) }; } catch { return null; }
}
export const hashFor = (kind, id) => (kind === 'team' || kind === 'settings' ? `#${kind}` : `#${kind}=${encodeURIComponent(id)}`);

// a key typed into a field is text, never a shortcut
export const typing = (e) => !!(e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'));

export async function copyText(text, btn) {
  try { await navigator.clipboard.writeText(text); } catch { return false; }
  if (btn) { const was = btn.dataset.label || btn.innerHTML; btn.dataset.label = was; btn.textContent = 'copied'; setTimeout(() => { btn.innerHTML = was; delete btn.dataset.label; }, 1400); }
  return true;
}

// The commands every page offers: pages, theme, CRT. `pages` maps a label to its href (the hub serves from /).
export function baseCommands(pages = { Overview: './', Team: 'team', Notifications: 'notifications' }) {
  const go = Object.entries(pages).map(([label, href]) => ({ group: 'Pages', label: `Go to ${label}`, run: () => { location.href = href; } }));
  const cur = getTheme();
  const th = THEMES.map((t) => ({ group: 'Theme', label: `Theme: ${t}`, hint: t === 'auto' ? 'follow the system' : '', keys: t === cur ? ['current'] : [], run: () => setTheme(t) }));
  return [...go, ...th, { group: 'Theme', label: `${getCrt() ? 'Turn off' : 'Turn on'} CRT effects`, hint: 'scanlines and glow', run: () => setCrt(!getCrt()) }];
}

// Command palette: ⌘K / Ctrl+K toggles it, ↑↓ select, Enter runs, Esc closes and gives the focus back.
// commands() is called on every open and every keystroke, so it always reflects the current state.
export function mountPalette(commands) {
  const el = document.createElement('div');
  el.className = 'pal'; el.hidden = true;
  el.innerHTML = '<div class="box" role="dialog" aria-modal="true" aria-label="Command palette"></div>';
  document.body.appendChild(el);
  const box = el.firstElementChild;
  let sel = 0, list = [], opener = null, mode = 'cmd';
  const close = () => { if (el.hidden) return; el.hidden = true; if (opener && opener.isConnected) opener.focus(); opener = null; };
  const draw = () => {
    const q = box.querySelector('input').value;
    list = rankCommands(commands(), q);
    sel = Math.min(sel, Math.max(0, list.length - 1));
    let html = '', g = null;
    list.forEach((c, i) => {
      if (c.group !== g) { g = c.group; html += `<li class="g">${esc(g)}</li>`; }
      html += `<li class="c${i === sel ? ' sel' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}"><span>${esc(c.label)}</span>${c.hint ? `<span class="h">${esc(c.hint)}</span>` : ''}${c.keys && c.keys.length ? `<span class="k">${c.keys.map((k) => `<span class="kbd">${esc(k)}</span>`).join('')}</span>` : ''}</li>`;
    });
    box.querySelector('ul').innerHTML = html || '<li class="none">no command matches</li>';
    const s = box.querySelector('li.sel'); if (s) s.scrollIntoView({ block: 'nearest' });
  };
  const run = (i) => { const c = list[i]; if (!c) return; close(); c.run(); };
  const open = (query = '') => {
    mode = 'cmd'; opener = document.activeElement; sel = 0;
    box.innerHTML = `<div class="in"><span>&gt;</span><input type="text" aria-label="Command" placeholder="Search changes and agents, or run a command" autocomplete="off" spellcheck="false"><span class="kbd">esc</span></div><ul role="listbox"></ul><div class="ft"><span><span class="kbd">↑</span> <span class="kbd">↓</span> select</span><span><span class="kbd">↵</span> run</span><span><span class="kbd">esc</span> close</span></div>`;
    const inp = box.querySelector('input'); inp.value = query;
    el.hidden = false; draw(); inp.focus();
  };
  const help = (rows) => {
    mode = 'help'; opener = document.activeElement;
    box.innerHTML = `<div class="in"><b style="color:var(--ink2)">Keyboard shortcuts</b><span class="kbd" style="margin-left:auto">esc</span></div><dl>${rows.map(([keys, what]) => `<dt>${keys.map((k) => `<span class="kbd">${esc(k)}</span>`).join(' ')}</dt><dd>${esc(what)}</dd>`).join('')}</dl>`;
    el.hidden = false; box.setAttribute('tabindex', '-1'); box.focus();
  };
  el.addEventListener('click', (e) => { if (e.target === el) return close(); const li = e.target.closest('li.c'); if (li) run(Number(li.dataset.i)); });
  el.addEventListener('input', () => { sel = 0; draw(); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); return close(); }
    if (mode !== 'cmd') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, list.length - 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(sel); }
    else if (e.key === 'Tab') e.preventDefault();   // the focus stays in the field while the palette is open
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); if (el.hidden) open(); else close(); }
  });
  return { open, close, help, isOpen: () => !el.hidden };
}

// ---- sparklines: a trend the size of a word, no axes. Hover on a bucket shows its <title> (tips[i]).
export function sparkPath(vals, w, h, pad = 2) {
  const max = Math.max(...vals, 0) || 1, n = vals.length;
  const pts = vals.map((v, i) => [n > 1 ? pad + (i * (w - 2 * pad)) / (n - 1) : w / 2, h - pad - (Math.max(0, v) / max) * (h - 2 * pad)]);
  const f = (x) => x.toFixed(1);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${f(p[0])} ${f(p[1])}`).join(' ');
  return { line, area: `${line} L${f(pts[n - 1][0])} ${h} L${f(pts[0][0])} ${h} Z`, x: f(pts[n - 1][0]), y: f(pts[n - 1][1]) };
}
const hitRects = (n, w, h, tips) => {
  const step = w / n;
  return tips.length ? tips.map((t, i) => `<rect x="${(i * step).toFixed(1)}" y="0" width="${step.toFixed(1)}" height="${h}" fill="transparent"><title>${esc(t)}</title></rect>`).join('') : '';
};
export function sparkSvg(vals, { w = 120, h = 20, hot = false, tips = [], label = '' } = {}) {
  if (!Array.isArray(vals) || !vals.length) return '';
  const p = sparkPath(vals, w, h);
  return `<svg class="spark${hot ? ' hot' : ''}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}"><path class="sa" d="${p.area}"></path><path class="sl" d="${p.line}"></path><circle class="sd" cx="${p.x}" cy="${p.y}" r="2.2"></circle>${hitRects(vals.length, w, h, tips)}</svg>`;
}
export function barsSvg(vals, { w = 120, h = 32, hotLast = false, tips = [], label = '' } = {}) {
  if (!Array.isArray(vals) || !vals.length) return '';
  const max = Math.max(...vals, 0) || 1, n = vals.length, gap = 3, bw = (w - gap * (n - 1)) / n;
  const bars = vals.map((v, i) => { const bh = Math.max(2, Math.round((Math.max(0, v) / max) * (h - 2))); return `<rect class="b${i === n - 1 && hotLast ? ' hot' : ''}" x="${(i * (bw + gap)).toFixed(1)}" y="${h - bh}" width="${bw.toFixed(1)}" height="${bh}" rx="2"></rect>`; }).join('');
  return `<svg class="sbars" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">${bars}${hitRects(n, w, h, tips)}</svg>`;
}
// test runs as blocks: green passed, red failed; tips[i] on hover
export function testDots(list, { tips = [], label = '' } = {}) {
  if (!Array.isArray(list) || !list.length) return '';
  return `<span class="tdots" role="img" aria-label="${esc(label)}">${list.map((x, i) => `<i class="${x.ok ? 'ok' : 'bad'}"${tips[i] ? ` title="${esc(tips[i])}"` : ''}></i>`).join('')}</span>`;
}
// duration trend of the last rounds: mean of the last third against the first third
export function trendOf(durs) {
  if (!Array.isArray(durs) || durs.length < 6) return null;
  const k = Math.floor(durs.length / 3), mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const r = mean(durs.slice(-k)) / (mean(durs.slice(0, k)) || 1);
  return r > 1.3 ? 'slower' : r < 0.77 ? 'faster' : 'steady';
}
// hour labels for the 24 h tips: "14:00–15:00"
export const hourLabel = (t) => { const a = new Date(t), b = new Date(t + 3600e3), f = (d) => `${String(d.getHours()).padStart(2, '0')}:00`; return `${f(a)}–${f(b)}`; };
