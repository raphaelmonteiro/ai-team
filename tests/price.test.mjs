// price.mjs tests: the table, the conf overrides, the cost of a usage, formatting, budgets.
//   node tests/price.test.mjs
import assert from 'node:assert/strict';
import { PRICES, PRICED_AT, readPrices, priceKey, costOf, fmtUsd, readBudgets } from '../dashboard/price.mjs';

assert.match(PRICED_AT, /^\d{4}-\d\d-\d\d$/);
for (const [k, v] of Object.entries(PRICES)) assert.ok(/^[a-z]+-\d(-\d)?$/.test(k) && v.length === 4 && v.every((n) => n >= 0), `row ${k}`);
assert.deepEqual(PRICES['sonnet-5-5'], [2, 10, 0.10, 2.50]); assert.deepEqual(PRICES['opus-5-5'], [4, 20, 0.20, 5]); assert.deepEqual(PRICES['fable-5-1'], [10, 50, 0.25, 12.5]);
// the collector's short id, the full id and a dated id all find the row; unknown and "inherit" do not
assert.equal(priceKey('sonnet-5-5', PRICES), 'sonnet-5-5'); assert.equal(priceKey('claude-sonnet-5-5', PRICES), 'sonnet-5-5'); assert.equal(priceKey('claude-opus-4-6-20260101', PRICES), 'opus-4-6');
assert.equal(priceKey('sonnet', PRICES), 'sonnet-5-5', 'a bare family name is priced as the current generation'); assert.equal(priceKey('opus', PRICES), 'opus-5-5'); assert.equal(priceKey('haiku', PRICES), 'haiku-5-5');
assert.equal(priceKey('inherit', PRICES), null); assert.equal(priceKey('gpt-9', PRICES), null); assert.equal(priceKey(null, PRICES), null);
// cost: 1M input on Sonnet 5.5 = $2; a mixed usage; no price → null; empty usage → 0
assert.equal(costOf({ input: 1e6, output: 0, cacheRead: 0, cacheCreation: 0 }, 'claude-sonnet-5-5'), 2);
assert.equal(costOf({ input: 1000, output: 500, cacheRead: 100000, cacheCreation: 2000 }, 'opus-5-5'), (1000 * 4 + 500 * 20 + 100000 * 0.20 + 2000 * 5) / 1e6);
assert.equal(costOf({ input: 1, output: 1, cacheRead: 1, cacheCreation: 1 }, 'unknown-9'), null);
assert.equal(costOf({}, 'haiku-5-5'), 0);
// conf overrides: a corrected row, a new model, odd values ignored
const prices = readPrices({ PRICE_SONNET_5_5: '3 15 0.3 3.75', PRICE_MY_MODEL_1: '1,2,0.1,1.25', PRICE_BAD: '1 2', PRICE_WORSE: 'a b c d', PRICE_NEG: '-1 2 3 4', OTHER: 'x' });
assert.deepEqual(prices['sonnet-5-5'], [3, 15, 0.3, 3.75]); assert.deepEqual(prices['my-model-1'], [1, 2, 0.1, 1.25]);
assert.equal(prices.bad, undefined); assert.equal(prices.worse, undefined); assert.equal(prices.neg, undefined);
assert.deepEqual(PRICES['sonnet-5-5'], [2, 10, 0.10, 2.50], 'the table itself is untouched');
assert.equal(costOf({ input: 1e6, output: 0, cacheRead: 0, cacheCreation: 0 }, 'my-model-1', prices), 1);
// formatting
assert.deepEqual([0, 0.004567, 0.38, 12.5, 7, 99.999, 1234.4, null, NaN].map(fmtUsd), ['$0', '$0.0046', '$0.38', '$12.5', '$7', '$100', '$1,234', '—', '—']);
// budgets
assert.deepEqual(readBudgets({ BUDGET_SMALL_USD: '5', BUDGET_LARGE_USD: '40.5' }), { small: 5, large: 40.5 });
assert.deepEqual(readBudgets({ BUDGET_SMALL_USD: '0', BUDGET_LARGE_USD: 'x' }), { small: null, large: null });
assert.deepEqual(readBudgets({}), { small: null, large: null });
console.log('✓ prices ok');
