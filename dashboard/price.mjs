// ai-team — what the tokens cost, in USD (shown next to the tokens on rounds, changes, agents and sessions).
// Table per model id as the collector names it (`claude-` and the date suffix removed): base input, output,
// cache read and 5-minute cache write, in USD per million tokens, from Anthropic's pricing page
// (https://platform.claude.com/docs/en/about-claude/pricing) on PRICED_AT. A project corrects or adds a model
// in .claude/ai-team.conf: PRICE_<MODEL>='<input> <output> <cache read> <cache write>' with the id uppercased
// and dashes as underscores (PRICE_SONNET_5_5='2 10 0.10 2.50'). A model with no price has no cost: the
// dashboard says so instead of guessing. The cost is an estimate for comparing rounds and changes, not a
// bill: batch discounts, plan limits, a subscription instead of the API, or Haiku 5.5 prompts over 100k
// tokens (priced higher) all make the real figure differ.
export const PRICED_AT = '2026-11-10';
// [input, output, cacheRead, cacheWrite] USD / MTok
export const PRICES = {
  'fable-5-2': [8, 40, 0.20, 10], 'mythos-5-2': [8, 40, 0.20, 10],
  'fable-5-1': [10, 50, 0.25, 12.5], 'mythos-5-1': [10, 50, 0.25, 12.5],
  'fable-5': [10, 50, 1, 12.5], 'mythos-5': [10, 50, 1, 12.5],
  'opus-5-5': [4, 20, 0.20, 5], 'opus-5': [5, 25, 0.50, 6.25],
  'opus-4-8': [5, 25, 0.50, 6.25], 'opus-4-7': [5, 25, 0.50, 6.25], 'opus-4-6': [5, 25, 0.50, 6.25], 'opus-4-5': [5, 25, 0.50, 6.25],
  'opus-4-1': [15, 75, 1.50, 18.75], 'opus-4': [15, 75, 1.50, 18.75],
  'sonnet-5-5': [2, 10, 0.10, 2.50], 'sonnet-5': [2, 10, 0.20, 2.50],
  'sonnet-4-6': [3, 15, 0.30, 3.75], 'sonnet-4-5': [3, 15, 0.30, 3.75], 'sonnet-4': [3, 15, 0.30, 3.75],
  'haiku-5-5': [0.10, 0.50, 0.01, 0.125],   // prompts up to 100k tokens
  'haiku-4-5': [1, 5, 0.10, 1.25],
};

// the table plus the conf overrides (PRICE_<MODEL>): { model → [in, out, read, write] }
export function readPrices(conf = {}) {
  const out = { ...PRICES };
  for (const [k, v] of Object.entries(conf)) {
    const m = /^PRICE_([A-Z0-9_]+)$/.exec(k);
    if (!m) continue;
    const nums = String(v).trim().split(/[\s,]+/).map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n) || n < 0)) continue;
    out[m[1].toLowerCase().replace(/_/g, '-')] = nums;
  }
  return out;
}

// the id the collector shows (sonnet-5-5) → the table key; "inherit" and unknown names have no price
export function priceKey(model, prices) {
  if (!model || typeof model !== 'string') return null;
  const m = model.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/-latest$/, '');
  return prices[m] ? m : null;
}

// usage { input, output, cacheRead, cacheCreation } of one model → USD, or null without a price
export function costOf(usage, model, prices = PRICES) {
  const k = priceKey(model, prices);
  if (!k || !usage) return null;
  const [i, o, r, w] = prices[k];
  return ((usage.input || 0) * i + (usage.output || 0) * o + (usage.cacheRead || 0) * r + (usage.cacheCreation || 0) * w) / 1e6;
}

export { fmtUsd } from './ui.mjs';

// budget per change size from the conf (BUDGET_SMALL_USD / BUDGET_LARGE_USD): { small, large } in USD or null
export function readBudgets(conf = {}) {
  const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };
  return { small: num(conf.BUDGET_SMALL_USD), large: num(conf.BUDGET_LARGE_USD) };
}
