// dashboard/ui.mjs page helpers: palette ranking, deep links, the theme list, and that every page applies the
// saved theme before its first paint and mounts the palette.
//   node tests/ui.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchScore, rankCommands, parseHash, hashFor, THEMES, typing } from '../dashboard/ui.mjs';

// matchScore: substring by position, then a subsequence; -1 when it does not match
assert.equal(matchScore('', 'anything'), 0);
assert.equal(matchScore('hub', 'hub-token-rotation'), 0);
assert.equal(matchScore('TOKEN', 'hub-token-rotation'), 4, 'case-insensitive');
assert.ok(matchScore('htr', 'hub-token-rotation') >= 1000, 'subsequence ranks after any substring');
assert.equal(matchScore('xyz', 'hub-token-rotation'), -1);

// rankCommands: groups keep their order; a label match beats a hint match; the best label first
const cmds = [
  { group: 'Changes', label: 'fix-hub', hint: 'build' },
  { group: 'Changes', label: 'hub-token-rotation', hint: 'review' },
  { group: 'Changes', label: 'notify-digest', hint: 'hub notices' },
  { group: 'Pages', label: 'Go to Hub' },
  { group: 'Theme', label: 'Theme: dracula' },
];
assert.deepEqual(rankCommands(cmds, 'hub').map((c) => c.label), ['hub-token-rotation', 'fix-hub', 'notify-digest', 'Go to Hub']);
assert.deepEqual(rankCommands(cmds, '').map((c) => c.label), cmds.map((c) => c.label), 'empty query: everything, in order');
assert.deepEqual(rankCommands(cmds, 'theme').map((c) => c.label), ['Theme: dracula'], 'group name matches');
assert.deepEqual(rankCommands(cmds, 'qqq'), []);

// deep links
assert.deepEqual(parseHash('#change=add-x'), { kind: 'change', id: 'add-x' });
assert.deepEqual(parseHash(hashFor('agent', 'spec writer/2')), { kind: 'agent', id: 'spec writer/2' }, 'round trip');
assert.equal(parseHash('#decisions'), null, 'a plain anchor is not a drawer');
assert.equal(parseHash('#change=%E0%A4%A'), null, 'bad escape: ignored');
assert.equal(parseHash(''), null);
assert.deepEqual(parseHash('#team'), { kind: 'team', id: 'team' });
assert.deepEqual(parseHash('#settings'), { kind: 'settings', id: 'settings' });
assert.equal(hashFor('settings', 'settings'), '#settings');
assert.equal(parseHash('#teams'), null);

assert.deepEqual(THEMES, ['auto', 'default', 'dracula', 'hacker', 'light']);
assert.equal(typing({ target: { closest: (s) => (s.includes('input') ? {} : null) } }), true);
assert.equal(typing({ target: { closest: () => null } }), false);
assert.equal(typing({ target: null }), false);

// every page: the theme is applied in <head> before ui.css (no flash), and the palette is mounted
const css = fs.readFileSync(new URL('../dashboard/ui.css', import.meta.url), 'utf8');
for (const t of THEMES.filter((x) => x !== 'auto' && x !== 'default')) assert.match(css, new RegExp(`\\[data-theme="${t}"\\]`), `ui.css defines ${t}`);
assert.doesNotMatch(css, /@import|https?:\/\//, 'ui.css loads nothing from outside (the dashboard runs offline)');
for (const page of ['index.html', 'team.html', 'notifications.html', 'hub.html']) {
  const html = fs.readFileSync(new URL(`../dashboard/${page}`, import.meta.url), 'utf8');
  const theme = html.indexOf("localStorage.getItem('ai-team:theme')"), link = html.indexOf('ui.css');
  assert.ok(theme > 0 && theme < link, `${page}: theme applied before ui.css`);
  assert.match(html, /mountPalette\(/, `${page}: command palette`);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\./, `${page}: no outside requests`);
}
for (const mod of ['ui.mjs', 'shell.mjs', 'feed.mjs', 'views.mjs']) assert.doesNotMatch(fs.readFileSync(new URL(`../dashboard/${mod}`, import.meta.url), 'utf8'), /(?:fetch\(|import\(|from\s|src=|href=|url\()\s*['"`]?https?:\/\/(?!localhost)/i, `${mod}: no outside requests (a URL in help text is fine; loading one is not)`);
console.log('✓ ui helpers ok');
