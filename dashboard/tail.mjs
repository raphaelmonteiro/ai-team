// OUTPUT panel: the latest steps of one run, read from the end of its transcript (no tokens: a local file).
//
// readTail(file, { after, from, to }) reads only what the file gained since `after` (a byte offset it returned
// before), or, the first time, its last TAIL_BYTES. Each complete JSON line becomes zero or more steps:
//   text    the agent's text            { k:'text', t, text }
//   tool    a tool call                 { k:'tool', t, id, name, arg }
//   result  a tool call's result        { k:'result', t, id, ok, text, lines, cut }
//   prompt  the prompt of the run / leg { k:'prompt', t, text }
//   note    the context was compacted   { k:'note', t, text }
// `from` / `to` (ms) keep only the records of one round (a resumed agent's leg shares the file with the others).
// A result keeps its last RESULT_LINES lines (`cut` = lines left out); the offset stops before a line still
// being written, so the next read picks it up whole.
import fs from 'node:fs';

export const TAIL_BYTES = 256 * 1024;      // first read: the end of the file only
export const READ_MAX = 2 * 1024 * 1024;   // later reads: at most this much (a huge burst restarts from the end)
export const STEPS_MAX = 300;
export const RESULT_LINES = 40;
const TEXT_MAX = 4000, ARG_MAX = 300, PROMPT_MAX = 600, RESULT_CHARS = 6000;

const blocks = (m) => (m && Array.isArray(m.content) ? m.content : []);
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map((b) => (b && b.type === 'text' ? b.text : '')).filter(Boolean).join('\n') : '';
const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

// the one argument that says what a call does
export function toolArg(name, input = {}) {
  const i = input || {};
  const v = i.command ?? i.file_path ?? i.notebook_path ?? i.pattern ?? i.url ?? i.query ?? i.description ?? i.prompt ?? i.path ?? '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return clip(s.replace(/\s+\n/g, '\n').trim(), ARG_MAX);
}

// the last lines of a result
export function resultText(content) {
  const s = textOf(content).replace(/\r/g, '');
  const lines = s.split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const keep = lines.slice(-RESULT_LINES);
  let text = keep.join('\n');
  if (text.length > RESULT_CHARS) text = `…${text.slice(-RESULT_CHARS)}`;
  return { text, lines: lines.length, cut: lines.length - keep.length };
}

// the steps of one transcript record
export function stepsOf(r) {
  if (!r || typeof r !== 'object' || !r.message) return [];
  const t = Date.parse(r.timestamp) || null;
  const out = [];
  if (r.type === 'assistant') {
    for (const b of blocks(r.message)) {
      if (b.type === 'text' && b.text && b.text.trim()) out.push({ k: 'text', t, text: clip(b.text.trim(), TEXT_MAX) });
      else if (b.type === 'tool_use') out.push({ k: 'tool', t, id: b.id, name: b.name, arg: toolArg(b.name, b.input) });
    }
  } else if (r.type === 'user') {
    const c = r.message.content;
    const results = blocks(r.message).filter((b) => b.type === 'tool_result');
    for (const b of results) out.push({ k: 'result', t, id: b.tool_use_id, ok: b.is_error !== true, ...resultText(b.content) });
    if (r.isCompactSummary) out.push({ k: 'note', t, text: 'context compacted: the session goes on from a summary' });
    else if (!results.length && !r.isMeta) {
      const tx = textOf(c).trim();
      if (tx && !/^\[Request interrupted/.test(tx)) out.push({ k: 'prompt', t, text: clip(tx, PROMPT_MAX) });
      else if (tx) out.push({ k: 'text', t, text: tx });
    }
  }
  return out;
}

// paths read shorter: the project folder becomes "." and the home folder "~"
export function shortPaths(steps, { root = null, home = null } = {}) {
  const subs = [root && [root.replace(/\/+$/, ''), '.'], home && [home.replace(/\/+$/, ''), '~']].filter(Boolean).filter(([a]) => a.length > 1);
  if (!subs.length) return steps;
  const fix = (v) => { if (typeof v !== 'string') return v; for (const [a, b] of subs) v = v.split(a).join(b); return v; };
  return steps.map((x) => ({ ...x, ...(x.text !== undefined ? { text: fix(x.text) } : {}), ...(x.arg !== undefined ? { arg: fix(x.arg) } : {}) }));
}

export function readTail(file, { after = null, from = null, to = null, root = null, home = null } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return { steps: [], offset: 0, size: 0, missing: true }; }
  const size = st.size;
  // a stale offset (the file shrank) or none: start near the end
  let start = Number.isInteger(after) && after >= 0 && after <= size ? after : Math.max(0, size - TAIL_BYTES);
  let reset = !(Number.isInteger(after) && after >= 0 && after <= size);
  if (size - start > READ_MAX) { start = size - TAIL_BYTES; reset = true; }
  const len = size - start;
  if (len <= 0) return { steps: [], offset: size, size, reset };
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, len, start); } finally { fs.closeSync(fd); }
  let s = buf.toString('utf8');
  let skip = 0;
  // started mid-file: drop the partial first line
  if (reset && start > 0) { const nl = s.indexOf('\n'); skip = nl < 0 ? s.length : nl + 1; }
  const lastNl = s.lastIndexOf('\n');
  const endChars = lastNl < 0 ? 0 : lastNl + 1;
  const offset = start + Buffer.byteLength(s.slice(0, Math.max(endChars, skip)));
  s = s.slice(skip, Math.max(endChars, skip));
  const steps = [];
  for (const line of s.split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    const t = Date.parse(r.timestamp);
    if (from && Number.isFinite(t) && t < from - 1000) continue;
    if (to && Number.isFinite(t) && t > to + 1000) continue;
    steps.push(...stepsOf(r));
  }
  return { steps: shortPaths(steps.slice(-STEPS_MAX), { root, home }), offset, size, reset };
}
