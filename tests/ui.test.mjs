// dashboard/ui.mjs page helpers: palette ranking, deep links, the theme list, and that every page applies the
// saved theme before its first paint and mounts the palette.
//   node tests/ui.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchScore, rankCommands, parseHash, hashFor, THEMES, typing } from '../dashboard/ui.mjs';
import { sprite, cssUrl } from '../scripts/fallout-dev.mjs';

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

assert.deepEqual(THEMES, ['auto', 'default', 'dracula', 'fallout', 'hacker', 'light']);
assert.equal(typing({ target: { closest: (s) => (s.includes('input') ? {} : null) } }), true);
assert.equal(typing({ target: { closest: () => null } }), false);
assert.equal(typing({ target: null }), false);

// every page: the theme is applied in <head> before ui.css (no flash), and the palette is mounted
const css = fs.readFileSync(new URL('../dashboard/ui.css', import.meta.url), 'utf8');
for (const t of THEMES.filter((x) => x !== 'auto' && x !== 'default')) assert.match(css, new RegExp(`\\[data-theme="${t}"\\]`), `ui.css defines ${t}`);
// (the SVG namespace in the inline sprite is a name, not an address: nothing is fetched)
assert.doesNotMatch(css, /@import|https?:\/\/(?!www\.w3\.org\/2000\/svg')/, 'ui.css loads nothing from outside (the dashboard runs offline)');
// fallout: state still reads by color (unlike hacker), and the CRT refresh band rests above the screen, so with
// reduced motion (no animation) it stays out of sight
const fallout = css.match(/:root\[data-theme="fallout"\] \{([^}]*)\}/)[1];
const tok = (k) => fallout.match(new RegExp(`--${k}: (#[0-9a-f]{6})`))[1];
assert.equal(new Set([tok('ok'), tok('warn'), tok('bad')]).size, 3, 'fallout: ok, warn and bad differ');
assert.match(css, /\[data-theme="fallout"\]\[data-crt\] body::before \{[^}]*transform: translateY\(-100%\)/, 'fallout: the band rests off screen');
// fallout: the live dot is a walking dev, an inline sprite of 12 walk frames and a standing one (the last, shown
// when not live or with no animation), the very one scripts/fallout-dev.mjs makes; the walk runs over the first 12
const walker = css.match(/\[data-theme="fallout"\] \.live::before \{([\s\S]*?) no-repeat; \}/)[1];   // the sprite has its own {}
assert.ok(walker.includes(`--walker: ${cssUrl()};`), 'fallout: the walker is the output of scripts/fallout-dev.mjs --css (paste it again)');
assert.equal((sprite().match(/<g transform='translate\(\d+\)'>/g) || []).length, 13, 'fallout: 13 frames in the sprite');
assert.match(walker, /background: var\(--walker\) 100% 0 \/ 1300% 100%/, 'fallout: at rest it shows the standing frame');
assert.match(css, /\[data-theme="fallout"\] \.live\.on::before \{[^}]*animation: walk [.\d]+s steps\(12\)/, 'fallout: the walk steps over 12 frames');
for (const page of ['index.html', 'hub.html']) {
  const html = fs.readFileSync(new URL(`../dashboard/${page}`, import.meta.url), 'utf8');
  const theme = html.indexOf("localStorage.getItem('ai-team:theme')"), link = html.indexOf('ui.css');
  assert.ok(theme > 0 && theme < link, `${page}: theme applied before ui.css`);
  assert.match(html, /mountPalette\(/, `${page}: command palette`);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\./, `${page}: no outside requests`);
}
for (const mod of ['ui.mjs', 'shell.mjs', 'feed.mjs', 'views.mjs', 'mobile.mjs']) assert.doesNotMatch(fs.readFileSync(new URL(`../dashboard/${mod}`, import.meta.url), 'utf8'), /(?:fetch\(|import\(|from\s|src=|href=|url\()\s*['"`]?https?:\/\/(?!localhost)/i, `${mod}: no outside requests (a URL in help text is fine; loading one is not)`);
console.log('✓ ui helpers ok');
