// The page state (dashboard/uistate.mjs) and the shared storage (ui.mjs store / tabStore / KEYS): what is open
// survives a reload of the tab, the changes view and "seen" live in the browser, and nothing throws when storage
// is missing or blocked.
//   node tests/uistate.test.mjs
import assert from 'node:assert/strict';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m }; };
globalThis.localStorage = mem(); globalThis.sessionStorage = mem(); globalThis.location = { pathname: '/p/demo/' };
const { KEYS, store, tabStore } = await import('../dashboard/ui.mjs');

// what a previous load of this tab left open
sessionStorage.setItem(KEYS.open('/p/demo/'), JSON.stringify({ changes: ['add-x', 7], sessions: ['s1'], details: ['older'] }));
localStorage.setItem(KEYS.boardView, 'cards');
const S = await import('../dashboard/uistate.mjs');
assert.ok(S.isOpen('changes', 'add-x'), 'open rows come back after a reload'); assert.ok(!S.isOpen('changes', '7'), 'only string ids');
assert.ok(S.isOpen('sessions', 's1')); assert.ok(S.isOpen('details', 'older'));
assert.equal(S.ui.boardView, 'cards', 'the changes view of this browser');

assert.equal(S.setOpen('changes', 'add-y'), true, 'undefined toggles on'); assert.equal(S.setOpen('changes', 'add-y'), false, 'and off');
S.setOpen('problems', 'red', true);
const saved = JSON.parse(sessionStorage.getItem(KEYS.open('/p/demo/')));
assert.deepEqual(saved.changes, ['add-x']); assert.deepEqual(saved.problems, ['red'], 'each change is saved for this tab');
S.clearOpen('changes'); assert.deepEqual(JSON.parse(sessionStorage.getItem(KEYS.open('/p/demo/'))).changes, []);
for (let i = 0; i < 260; i++) S.setOpen('details', `d${i}`, true);
assert.equal(JSON.parse(sessionStorage.getItem(KEYS.open('/p/demo/'))).details.length, 200, 'the kept list is capped');

assert.equal(S.setBoardView('table'), 'table'); assert.equal(localStorage.getItem(KEYS.boardView), 'table');
assert.equal(S.setBoardView('nonsense'), 'table');
assert.equal(S.seenAt('/w/app'), 0); S.markSeen('/w/app', 1234); assert.equal(S.seenAt('/w/app'), 1234); assert.equal(localStorage.getItem('ai-team:seen:/w/app'), '1234');

// storage helpers: json, removal, and a blocked storage that throws
store.setJson('x', { a: 1 }); assert.deepEqual(store.json('x'), { a: 1 }); store.set('x', null); assert.equal(store.get('x'), null);
assert.equal(store.json('missing', 'fb'), 'fb'); localStorage.setItem('bad', '{'); assert.equal(store.json('bad', 'fb'), 'fb', 'broken JSON falls back');
assert.equal(store.getItem, store.get, 'the Storage shape for loadLayout');
globalThis.sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
assert.equal(tabStore.get('a'), null); tabStore.set('a', 1); assert.doesNotThrow(() => S.setOpen('changes', 'z', true), 'a blocked tab storage never throws');
delete globalThis.sessionStorage; assert.equal(tabStore.get('a'), null, 'no storage at all');
assert.equal(KEYS.tabs('/p/x/'), 'ai-team:tabs:/p/x/');
console.log('✓ uistate ok');
