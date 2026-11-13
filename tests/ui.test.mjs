// dashboard/ui.mjs page helpers: palette ranking, deep links, the theme list, and that every page applies the
// saved theme before its first paint and mounts the palette.
//   node tests/ui.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { matchScore, rankCommands, parseHash, hashFor, THEMES, typing, KEYS, WALKER_COLORS, getWalker, walkerHtml, baseCommands } from '../dashboard/ui.mjs';
import { sprite, symbol, favicon, faviconUrl } from '../scripts/mascot.mjs';

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
assert.doesNotMatch(css, /@import|https?:\/\//, 'ui.css loads nothing from outside (the dashboard runs offline)');
// fallout: state still reads by color (unlike hacker), and the CRT refresh band rests above the screen, so with
// reduced motion (no animation) it stays out of sight
const fallout = css.match(/:root\[data-theme="fallout"\] \{([^}]*)\}/)[1];
const tok = (k) => fallout.match(new RegExp(`--${k}: (#[0-9a-f]{6})`))[1];
assert.equal(new Set([tok('ok'), tok('warn'), tok('bad')]).size, 3, 'fallout: ok, warn and bad differ');
assert.match(css, /\[data-theme="fallout"\]\[data-crt\] body::before \{[^}]*transform: translateY\(-100%\)/, 'fallout: the band rests off screen');
// the live mark is the mascot in every theme, on the dashboard and the hub: one inline <symbol>, exactly what
// scripts/mascot.mjs --symbol makes (25 frames of 32x40: 24 walking, the last standing), drawn by walkerHtml
assert.equal((sprite().match(/<g transform='translate\(\d+\)'>/g) || []).length, 25, 'mascot: 25 frames');
assert.doesNotMatch(symbol(), /#1aff80|#06120a|class='[bil]'/, 'mascot: no fixed color in the symbol, the page paints it');
const pageCss = fs.readFileSync(new URL('../dashboard/index.html', import.meta.url), 'utf8');
for (const page of ['index.html', 'hub.html']) {
  const html = fs.readFileSync(new URL(`../dashboard/${page}`, import.meta.url), 'utf8');
  assert.ok(html.includes(symbol()), `${page}: the mascot is the output of scripts/mascot.mjs --symbol (paste it again)`);
  const walker = html.indexOf("localStorage.getItem('ai-team:walker')");
  assert.ok(walker > 0 && walker < html.indexOf('ui.css'), `${page}: the walker color applied before ui.css`);
}
assert.match(walkerHtml(true), /^<span class="live on"><svg viewBox="0 0 32 40"[^>]*><use href="#dv-sprite" class="strip" width="800" height="40"\/><\/svg><\/span>$/);
assert.match(walkerHtml(false), /^<span class="live">/, 'not live: it stands');
// it walks over the first 24 frames, stands on the last, dims when not live; green like "live", or the theme's accent
assert.match(css, /\.live \.strip \{ transform: translateX\(-768px\); \}/, 'mascot: at rest the standing frame (24 x 32)');
assert.match(css, /\.live\.on \.strip \{ animation: walk [.\d]+s steps\(24\)/, 'mascot: the walk runs over 24 frames');
assert.match(css, /@keyframes walk \{ from \{ transform: translateX\(0\); \} to \{ transform: translateX\(-768px\); \} \}/);
assert.match(css, /\.live \{[^}]*--dvl: var\(--live\)/, 'mascot: green like the word "live" by default');
assert.match(css, /:root\[data-walker="theme"\] \.live \{ --dvl: var\(--accent\); \}/, "mascot: or the theme's accent");
assert.equal(KEYS.walker, 'ai-team:walker'); assert.deepEqual(WALKER_COLORS, ['green', 'theme']); assert.equal(getWalker(), 'green', 'green unless chosen');
assert.deepEqual(baseCommands().filter((c) => c.label.startsWith('Walker')).map((c) => c.label), ['Walker: green', 'Walker: theme'], 'the palette offers both');
// every box the walker is drawn in is 4:5 like its frames
const boxes = [...(css + pageCss).matchAll(/\.live \{[^}]*?width: ([.\d]+)px; height: ([.\d]+)px/g)];
assert.ok(boxes.length >= 2, 'the desktop and phone walker boxes');
for (const [, w, h] of boxes) assert.equal(Number(w) * 5, Number(h) * 4, `the walker box ${w}x${h} is 4:5`);
// the favicon, in every theme and on every page (dashboard, hub, sign-in): the dev from the chest up, inline (nothing
// fetched), the SVG exactly what scripts/mascot.mjs --favicon-url makes, a PNG for browsers without SVG icons
assert.match(favicon(), /^<svg [^>]*viewBox='0 0 32 32'/, 'favicon: a 32x32 square');
for (const file of ['index.html', 'hub.html', 'auth.mjs']) {
  const src = fs.readFileSync(new URL(`../dashboard/${file}`, import.meta.url), 'utf8');
  assert.ok(src.includes(`<link rel="icon" type="image/svg+xml" href="${faviconUrl()}">`), `${file}: the favicon is the output of scripts/mascot.mjs --favicon-url (paste it again)`);
  assert.match(src, /<link rel="icon" type="image\/png" sizes="64x64" href="data:image\/png;base64,[A-Za-z0-9+/=]+"><link rel="icon" type="image\/svg\+xml"/, `${file}: a PNG icon first, the SVG last`);
}
for (const page of ['index.html', 'hub.html']) {
  const html = fs.readFileSync(new URL(`../dashboard/${page}`, import.meta.url), 'utf8');
  const theme = html.indexOf("localStorage.getItem('ai-team:theme')"), link = html.indexOf('ui.css');
  assert.ok(theme > 0 && theme < link, `${page}: theme applied before ui.css`);
  assert.match(html, /mountPalette\(/, `${page}: command palette`);
  assert.doesNotMatch(html, /fonts\.googleapis|cdn\./, `${page}: no outside requests`);
}
for (const mod of ['ui.mjs', 'shell.mjs', 'feed.mjs', 'views.mjs', 'mobile.mjs']) assert.doesNotMatch(fs.readFileSync(new URL(`../dashboard/${mod}`, import.meta.url), 'utf8'), /(?:fetch\(|import\(|from\s|src=|href=|url\()\s*['"`]?https?:\/\/(?!localhost)/i, `${mod}: no outside requests (a URL in help text is fine; loading one is not)`);
console.log('✓ ui helpers ok');
