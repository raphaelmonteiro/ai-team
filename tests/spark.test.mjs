// Sparklines: hourly / daily activity from the transcripts (collect.mjs activityOf, collect().activity) and the
// SVG helpers of the page (ui.mjs sparkSvg, barsSvg, testDots, trendOf).
//   node tests/spark.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { activityOf, collect, projectSlug } from '../dashboard/collect.mjs';
import { sparkPath, sparkSvg, barsSvg, testDots, trendOf, hourLabel } from '../dashboard/ui.mjs';

const H = 3600e3;
const now = Date.parse('2026-11-12T15:30:00Z');
const nowH = Math.floor(now / H);
const PRICES = { opus: [10, 50, 1, 12.5] };   // $ per million: input, output, cache read, cache write
const u = (input, output = 0, cacheRead = 0, cacheCreation = 0) => ({ input, output, cacheRead, cacheCreation });

// --- activityOf: buckets per run, 24 h window, rounds per hour, cost per day ---------------
{
  const hours = new Map([
    ['r1', [[nowH - 30, u(999)], [nowH - 2, u(100000, 0, 500000)], [nowH, u(500, 100)]]],   // the first one is outside the 24 h
    ['r2', [[nowH, u(200, 0, 0, 300)]]],
  ]);
  const runs = [{ id: 'r1', model: 'opus', usage: u(0) }, { id: 'r2', model: 'opus', usage: u(0) },
    { id: 'r3', model: 'opus', end: now - 5 * H, usage: { ...u(100), total: 100 } }];   // no transcript: counts whole at its end
  const a = activityOf(hours, PRICES, now);
  const h = a.hourly(runs);
  assert.equal(h.fresh.length, 24); assert.equal(h.from, (nowH - 23) * H);
  assert.equal(h.fresh[23], 500 + 100 + 200 + 300, 'fresh = input + output + cache written (cache read left out)');
  assert.equal(h.fresh[21], 100000); assert.equal(h.fresh[18], 100, 'a run without a transcript lands at its end');
  assert.equal(h.rounds[23], 2, 'two runs in the current hour'); assert.equal(h.rounds[21], 1);
  assert.equal(h.fresh.reduce((x, y) => x + y, 0), 101200, 'the bucket 30 h ago stays out');
  assert.equal(h.usd[21], 1.5, '100k input at $10/M + 500k cache read at $1/M (cents)');
  assert.equal(a.hourly([{ id: 'none', model: 'opus', usage: u(0) }]), null, 'nothing in 24 h: null (no sparkline)');
  const d = a.daily(runs);
  assert.equal(d.usd.length, 7); assert.equal(d.fresh.reduce((x, y) => x + y, 0), 999 + 101200, 'the 30 h old bucket is inside the 7 days');
  assert.ok(d.fresh[6] > 0, 'today is the last day');
  assert.equal(new Date(d.from).getHours(), 0, 'days start at local midnight');
}

// --- collect(): hourly buckets read from the request timestamps -----------------------------
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-team-spark-'));
  const proj = path.join(tmp, 'proj'), claude = path.join(tmp, 'claude');
  fs.mkdirSync(path.join(proj, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.claude/settings.json'), '{"agent":"orchestrator"}');
  const t0 = Date.now();
  const rec = (i, t, usage) => JSON.stringify({ type: 'assistant', uuid: `a${i}`, requestId: `q${i}`, sessionId: 's1', cwd: proj, timestamp: new Date(t).toISOString(), message: { id: `m${i}`, model: 'claude-opus-4-1', role: 'assistant', content: [{ type: 'text', text: 'ok' }], usage } });
  const dir = path.join(claude, 'projects', projectSlug(proj));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 's1.jsonl'), [
    JSON.stringify({ type: 'user', uuid: 'u1', sessionId: 's1', cwd: proj, timestamp: new Date(t0 - 3 * H).toISOString(), message: { role: 'user', content: '/team hi' } }),
    rec(1, t0 - 3 * H, { input_tokens: 1000, output_tokens: 10 }),
    rec(2, t0 - 60e3, { input_tokens: 400, output_tokens: 20 }),
  ].join('\n') + '\n');
  const st = collect({ projectDir: proj, claudeDir: claude, now: t0 });
  assert.ok(st.activity && st.activity.days.fresh.length === 7);
  assert.ok(st.activity.hours, 'the /team session counts');
  assert.equal(st.activity.hours.fresh[23], 420); assert.equal(st.activity.hours.fresh[20], 1010);
  assert.ok(Array.isArray(st.agents) && st.agents.every((a) => Array.isArray(a.recent)), 'every agent carries its recent round durations');
  assert.ok(!JSON.stringify(st).includes('"hours":[['), 'raw hourly buckets stay out of the JSON');
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --- SVG helpers ------------------------------------------------------------------------
{
  const p = sparkPath([0, 5, 10], 100, 20);
  assert.equal(p.line, 'M2.0 18.0 L50.0 10.0 L98.0 2.0'); assert.equal(p.x, '98.0'); assert.equal(p.y, '2.0');
  assert.equal(sparkPath([0, 0], 10, 10).line, 'M2.0 8.0 L8.0 8.0', 'all zero: a flat line at the bottom');
  assert.equal(sparkSvg([]), ''); assert.equal(sparkSvg(null), '');
  const s = sparkSvg([1, 2, 3], { hot: true, tips: ['a', 'b', '<c>'], label: 'x' });
  assert.match(s, /class="spark hot"/); assert.equal((s.match(/<title>/g) || []).length, 3, 'one hover target per bucket');
  assert.match(s, /<title>&lt;c&gt;<\/title>/, 'tips escaped');
  const b = barsSvg([1, 0, 4], { hotLast: true, tips: ['d1', 'd2', 'd3'] });
  assert.equal((b.match(/class="b/g) || []).length, 3); assert.match(b, /class="b hot"/);
  assert.match(b, /height="2" rx/, 'a zero day still shows a stub');
  const td = testDots([{ ok: true }, { ok: false }], { tips: ['p', 'f'] });
  assert.match(td, /<i class="ok" title="p"><\/i><i class="bad" title="f"><\/i>/);
  assert.equal(testDots([]), '');
  assert.equal(trendOf([1, 1, 1, 1, 1, 1]), 'steady');
  assert.equal(trendOf([2, 2, 3, 3, 4, 5]), 'slower'); assert.equal(trendOf([9, 8, 5, 4, 3, 3]), 'faster');
  assert.equal(trendOf([1, 2, 3]), null, 'too few rounds: no trend');
  assert.match(hourLabel(Date.parse('2026-11-12T10:00:00')), /^10:00–11:00$/);
}

console.log('✓ spark ok');
