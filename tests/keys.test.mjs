// The keymap (dashboard/keys.mjs): which shortcut a key fires in which context, no two shortcuts on the same key in
// the same context, the "?" list built from it, and an action in index.html for every shortcut it dispatches.
//   node tests/keys.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { KEYMAP, matchKey, helpRows, conflicts, keyLabel } from '../dashboard/keys.mjs';

const ev = (key, o = {}) => ({ key, code: o.code || '', metaKey: !!o.meta, ctrlKey: !!o.ctrl, altKey: !!o.alt, shiftKey: !!o.shift });
const base = { mac: true, typing: false, paletteOpen: false, inTab: false, inDecision: false };
const id = (e, ctx = {}) => { const h = matchKey(e, { ...base, ...ctx }); return h && h.id; };

assert.deepEqual(conflicts(), [], 'no two shortcuts share a key in the same context');
assert.deepEqual(conflicts([{ id: 'a', key: 'x', when: 'free' }, { id: 'b', key: 'x', when: 'overview' }]), [['a', 'b']], 'a clash is reported');

// modifiers per platform
assert.equal(id(ev('k', { meta: true })), 'palette', '⌘K on a Mac');
assert.equal(id(ev('k', { ctrl: true }), { mac: false }), 'palette', 'Ctrl K elsewhere');
assert.equal(id(ev('k', { ctrl: true })), null, 'Ctrl K on a Mac is not the palette');
assert.equal(matchKey(ev('k', { meta: true }), base).handledBy, 'palette', 'the palette owns its key');
assert.equal(id(ev('b', { meta: true })), 'side'); assert.equal(id(ev('b', { meta: true, shift: true })), null, '⇧⌘B is not ⌘B');
assert.equal(id(ev('`', { ctrl: true, code: 'Backquote' })), 'panel'); assert.equal(id(ev('`', { ctrl: true, code: 'Backquote' }), { mac: false }), 'panel');
{ const h = matchKey(ev('¡', { alt: true, code: 'Digit1' }), base); assert.deepEqual([h.id, h.arg], ['tab', 1], 'Alt+1 by code (the character differs per layout)'); }
assert.equal(matchKey(ev('™', { alt: true, code: 'Digit9' }), base).arg, 9);
assert.equal(id(ev('∑', { alt: true, code: 'KeyW' })), 'close');

// plain keys and their contexts
assert.equal(id(ev('j')), 'next'); assert.equal(id(ev('k')), 'prev'); assert.equal(id(ev('J', { shift: true })), null, 'J (shift) is not j');
assert.equal(id(ev('j'), { inTab: true }), null, 'J/K only on the Overview');
assert.equal(id(ev('j'), { typing: true }), null, 'not while typing');
assert.equal(id(ev('j'), { paletteOpen: true }), null, 'not with the palette open');
assert.equal(id(ev('a')), null, 'A only inside a decision'); assert.equal(id(ev('a'), { inDecision: true }), 'allow'); assert.equal(id(ev('d'), { inDecision: true }), 'deny');
assert.equal(id(ev('?', { shift: true })), 'help', '? needs shift on most layouts');
assert.equal(id(ev('/')), 'filter'); assert.equal(id(ev('/'), { typing: true }), null);
assert.equal(id(ev('Escape'), { inTab: true }), 'back');
assert.equal(id(ev('k', { meta: true }), { typing: true }), 'palette', '⌘K works inside a text field');
assert.equal(id(ev('x')), null);

// help built from the map
const rows = helpRows(true);
assert.equal(rows.length, KEYMAP.length + 4);
assert.deepEqual(rows[0], [['⌘K'], KEYMAP[0].help]);
assert.equal(keyLabel(KEYMAP.find((b) => b.id === 'palette'), false), 'Ctrl K');
assert.equal(keyLabel(KEYMAP.find((b) => b.id === 'tab'), true), 'alt 1…9');

// index.html: one action per dispatched shortcut, and no keydown listener on document besides the dispatcher and
// the activate one (Enter / Space on focusable rows)
const page = fs.readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const actions = page.slice(page.indexOf('const KEY_ACTIONS = {'), page.indexOf('};', page.indexOf('const KEY_ACTIONS = {')));
for (const b of KEYMAP.filter((x) => !x.handledBy)) assert.match(actions, new RegExp(`\\b${b.id}: `), `an action for ${b.id}`);
assert.equal((page.match(/document\.addEventListener\('keydown'/g) || []).length, 2, 'the dispatcher and activate, nothing else on document');
console.log('✓ keys ok');
