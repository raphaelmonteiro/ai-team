// dashboard/ui.mjs page helpers: palette ranking, deep links, the theme list, and that every page applies the
// saved theme before its first paint and mounts the palette.
//   node tests/ui.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchScore, rankCommands, parseHash, hashFor, THEMES, typing } from '../dashboard/ui.mjs';
import { sprite, cssUrl, favicon, faviconUrl } from '../scripts/fallout-dev.mjs';

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
// fallout: the live dot is a walking dev, an inline sprite of 24 walk frames and a standing one (the last, shown
// when not live or with no animation), the very one scripts/fallout-dev.mjs makes; the walk runs over the first 24
assert.ok(css.includes(`--walker: ${cssUrl()};`), 'fallout: the walker is the output of scripts/fallout-dev.mjs --css (paste it again)');
assert.equal((sprite().match(/<g transform='translate\(\d+\)'>/g) || []).length, 25, 'fallout: 25 frames in the sprite');
// every box the walker is drawn in is 4:5 like its 32x40 frames, and the sprite stretches to the box exactly: off
// that ratio the default "meet" shrank it and the frames drifted a little each step (the dev moonwalked on a phone)
assert.match(sprite(), /^<svg [^>]*preserveAspectRatio='none'/, 'fallout: the sprite stretches to its box');
const pageCss = fs.readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
const boxes = [...(css + pageCss).matchAll(/\[data-theme="fallout"\][^{]*\.live \{[^}]*?width: ([.\d]+)px; height: ([.\d]+)px/g)];
assert.ok(boxes.length >= 2, 'fallout: the desktop and phone walker boxes');
for (const [, w, h] of boxes) assert.equal(Number(w) * 5, Number(h) * 4, `fallout: the walker box ${w}x${h} is 4:5`);
// the favicon, in every theme and on every page (dashboard, hub, sign-in): the dev from the chest up, inline (nothing
// fetched), the SVG exactly what scripts/fallout-dev.mjs --favicon-url makes, a PNG for browsers without SVG icons
assert.match(favicon(), /^<svg [^>]*viewBox='0 0 32 32'/, 'favicon: a 32x32 square');
for (const file of ['index.html', 'hub.html', 'auth.mjs']) {
  const src = fs.readFileSync(new URL(`../dashboard/${file}`, import.meta.url), 'utf8');
  assert.ok(src.includes(`<link rel="icon" type="image/svg+xml" href="${faviconUrl()}">`), `${file}: the favicon is the output of scripts/fallout-dev.mjs --favicon-url (paste it again)`);
  assert.match(src, /<link rel="icon" type="image\/png" sizes="64x64" href="data:image\/png;base64,[A-Za-z0-9+/=]+"><link rel="icon" type="image\/svg\+xml"/, `${file}: a PNG icon first, the SVG last`);
}
assert.match(css, /background: var\(--walker\) 100% 0 \/ 2500% 100% no-repeat; \}/, 'fallout: at rest it shows the standing frame');
assert.match(css, /\[data-theme="fallout"\] \.live\.on::before \{[^}]*animation: walk [.\d]+s steps\(24\)/, 'fallout: the walk runs over 24 frames');
for (const page of ['index.html', 'hub.html']) {
  const html = fs.readFileSync(new URL(`../dashboard/${page}`, import.meta.url), 'utf8');
  const theme = html.indexOf("localStorage.getItem('ai-team:theme')"), link = html.indexOf('ui.css');
  assert.ok(theme > 0 && theme < link, `${page}: theme applied before ui.css`);
  assert.match(html, /mountPalette\(/, `${page}: command palette`);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\./, `${page}: no outside requests`);
}
for (const mod of ['ui.mjs', 'shell.mjs', 'feed.mjs', 'views.mjs', 'mobile.mjs']) assert.doesNotMatch(fs.readFileSync(new URL(`../dashboard/${mod}`, import.meta.url), 'utf8'), /(?:fetch\(|import\(|from\s|src=|href=|url\()\s*['"`]?https?:\/\/(?!localhost)/i, `${mod}: no outside requests (a URL in help text is fine; loading one is not)`);
console.log('✓ ui helpers ok');
