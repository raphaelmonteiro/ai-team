// mdToHtml (dashboard/ui.mjs): the markdown subset of the change artifacts, escaped, with anchors on D-<n> and friends.
//   node tests/md.test.mjs
import assert from 'node:assert/strict';
import { mdToHtml } from '../dashboard/ui.mjs';

const h = mdToHtml(`# Proposal — add-x
Intro with **bold**, *em*, \`code\` and a [link](https://x.y/z).

## Open decisions
- D-1 · Keep the old route? Recommended: yes
- D-2 · **Soft delete**: use a flag
  continued line
  - nested item

| a | b |
|---|---|
| 1 | <x> |

> quoted
> text

\`\`\`js
const a = "<b>";
\`\`\`
1. first
2. second
<!-- state: build · waiting: builder · since: 2026-11-10T10:00Z -->
R3 · src/a.ts:10 · category: duplication
`);
assert.match(h, /<h1 id="proposal-add-x">Proposal — add-x<\/h1>/);
assert.match(h, /<p>Intro with <b>bold<\/b>, <i>em<\/i>, <code>code<\/code> and a <a href="https:\/\/x\.y\/z" target="_blank" rel="noopener">link<\/a>\.<\/p>/);
assert.match(h, /<h2 id="open-decisions">Open decisions<\/h2>/);
assert.match(h, /<li id="d-1">D-1 · Keep the old route\? Recommended: yes<\/li>/, 'anchor on the decision');
assert.match(h, /<li id="d-2">D-2 · <b>Soft delete<\/b>: use a flag<p>continued line<\/p>\n?<ul><li>nested item<\/li><\/ul><\/li>/, 'continuation and nested list');
assert.match(h, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td>&lt;x&gt;<\/td><\/tr><\/tbody><\/table>/, 'table, escaped');
assert.match(h, /<blockquote>\n?<p>quoted text<\/p>\n?<\/blockquote>/);
assert.match(h, /<pre><code class="lang-js">const a = &quot;&lt;b&gt;&quot;;<\/code><\/pre>/, 'code escaped, not inlined');
assert.match(h, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
assert.match(h, /<p class="marker"><code>&lt;!-- state: build · waiting: builder · since: 2026-11-10T10:00Z --&gt;<\/code><\/p>/, 'protocol markers stay visible');
assert.match(h, /<p>R3 · src\/a\.ts:10 · category: duplication<\/p>/);
assert.equal(mdToHtml(''), '');
assert.equal(mdToHtml('<script>alert(1)</script>'), '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>', 'html is text');
assert.equal(mdToHtml('[x](javascript:alert(1))'), '<p>[x](javascript:alert(1))</p>', 'only http(s), # and relative links');
assert.match(mdToHtml('### PV-4 kept\n- B2 (task 1.2): steps\n- L-7 · rule\n- DT-9 · debt'), /<h3 id="pv-4">.*<li id="b-2">.*<li id="l-7">.*<li id="dt-9">/s, 'anchors for the protocol ids');
console.log('✓ markdown ok');
