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
