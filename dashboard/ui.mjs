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
