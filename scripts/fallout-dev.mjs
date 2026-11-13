#!/usr/bin/env node
// The fallout theme's walker: an original little dev (backwards cap, headphones, a coffee mug) drawn in the
// Pip-Boy's line art, walking in place of the live dot. One SVG sprite: 12 walk frames and a standing one,
// 32x40 units each, side by side. The walk is a bouncy cartoon one: long stride, high knee, toe-off and heel
// strike, a forward lean with a little squash and stretch, the head half a step late, a wide arm swing, a level
// mug whose steam trails behind, and a brow that lifts on the bounce.
//
//   node scripts/fallout-dev.mjs          the sprite as SVG (stdout), e.g. to open it or turn it into a logo
//   node scripts/fallout-dev.mjs --css    the url("data:...") that dashboard/ui.css keeps in --walker
//
// After a change here, paste the --css output into ui.css (tests/ui.test.mjs checks that the two match).
// It lives in scripts/ and not in dashboard/: the installer copies all of dashboard/ into projects.
import { pathToFileURL } from 'node:url';

const L = '#1aff80', BG = '#06120a', NF = 12, W = 32;
const GROUND = 39.5, SHOE = 2.3, TH = 4.5, SH = 4.3, UA = 3.7, FA = 3.4;
const rad = (a) => (a * Math.PI) / 180, n = (v) => +v.toFixed(1);
const at = ([x, y], a, l) => [x + l * Math.sin(rad(a)), y + l * Math.cos(rad(a))];
const P = (pts) => 'M' + pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// a limb: a green stroke with the screen's color inside, so it reads as an outlined tube
const tube = (pts, w) => `<path d='${P(pts)}' stroke-width='${w}'/><path class='i' d='${P(pts)}' stroke-width='${n(w - 1.6)}'/>`;

// the parts every frame reuses, drawn once around their own origin
const DEFS = `<style>.b{fill:${BG}}.i{stroke:${BG}}.l{fill:${L};stroke:none}</style><defs>`
  // the head, centred: face, nape, a tuft through the strap opening, the cap worn backwards, headphones over it
  + `<g id='h'><circle class='b' r='7.5' stroke-width='.8'/><ellipse class='l' cx='3.9' cy='.2' rx='.9' ry='1.25'/>`
  + `<path d='M2.1 3.3Q4.3 6.8 6.6 2.9Q4.4 3.9 2.1 3.3z' fill='${L}' stroke-width='.4'/>`
  + `<path class='b' d='M-7.6 -1.4Q-8.2 1 -7.3 2.8L-4.8 1.2Q-4.4 -.6 -3.6 -1.9z' stroke-width='.8'/>`
  + `<path class='b' d='M3.6 -2.8l.7 1.6l.9 -1.5l.8 1.2l.6 -1.4' stroke-width='.7'/>`
  + `<path class='b' d='M-7.7 -1.4C-8.2 -11 6.4 -11.4 6.8 -2.8z' stroke-width='1'/>`
  + `<path d='M-.6 -9.4Q3 -8 3.6 -2.9' stroke-width='.7'/><circle class='l' cx='-.7' cy='-9.5' r='.9'/>`
  + `<path class='b' d='M-6.6 -1.6Q-11.2 -2 -11.6 .5L-7 .4z' stroke-width='.9'/><path d='M3.6 -2.9a1.6 1.4 0 0 1 2.8 -.3' stroke-width='.8'/>`
  + `<path d='M-2.3 -.6C-3.3 -6.4 -2 -9.6 .2 -9.5' stroke-width='2.4'/><path class='i' d='M-2.3 -.6C-3.3 -6.4 -2 -9.6 .2 -9.5' stroke-width='1'/>`
  + `<rect class='b' x='-4.9' y='-1.2' width='4.6' height='5.6' rx='2' stroke-width='.9'/></g>`
  // the mug, from the hand that holds it
  + `<g id='m'><rect class='b' x='-.4' y='-3.4' width='3.6' height='4.2' rx='.7' stroke-width='.8'/><path d='M-.4 -2.4h-1v1.8h1' stroke-width='.8'/><rect class='l' x='-.4' y='-2.4' width='3.6' height='.9'/></g>`
  // a sneaker, from the ankle
  + `<g id='s'><rect class='b' x='-1.6' y='-.6' width='4.9' height='2.6' rx='1.2' stroke-width='.8'/><path d='M-1.3 1.4h4.3' stroke-width='.6'/></g>`
  // the hoodie, from the hip
  + `<g id='t'><path class='b' d='M-5.4 -9.4q-1.4 -1.6 1 -2.2h5' stroke-width='.9'/><rect class='b' x='-4.9' y='-9.6' width='10' height='11' rx='3.6' stroke-width='.8'/><path d='M-.6 -1.4v-2.2q0 -.8 .8 -.8h3.6' stroke-width='.8'/></g>`
  + `</defs>`;

function frame(k, standing) {
  const phi = (2 * Math.PI * k) / NF;
  // thigh and shin angles from the vertical, forward positive; the knee lifts in the swing and gives on contact
  const legAt = (p) => { if (standing) return [0, 0]; const th = 30 * Math.sin(p); return [th, th - (2 + 14 * Math.sin(p) ** 2 + 52 * Math.max(0, Math.cos(p)))]; };
  const near = legAt(phi), far = legAt(phi + Math.PI);
  const drop = Math.max(...[near, far].map(([a, b]) => TH * Math.cos(rad(a)) + SH * Math.cos(rad(b))));
  const hip = [14.4, GROUND - SHOE - drop];                    // the planted foot stays on the ground: that is the bounce
  const s2 = standing ? 0 : Math.cos(2 * phi);                  // 1 at the top of the bounce, -1 at the bottom
  const lean = standing ? 2 : 5 - 1.5 * s2, stretch = n((1 + 0.035 * s2) * 1000) / 1000;
  const body = `translate(${n(hip[0])} ${n(hip[1])}) rotate(${n(lean)}) scale(1 ${stretch})`;   // from here on, hip-relative
  const lag = standing ? 0 : Math.cos(2 * phi - 1.1), tilt = standing ? 0 : 3 * Math.sin(2 * phi - 1.1);
  const head = [1.7, -17.4 + 0.45 * lag], sho = [0.7, -7.4], brow = standing ? 0 : 0.4 * (s2 + 1);
  const leg = ([a, b]) => { const kn = at(hip, a, TH), an = at(kn, b, SH), t = standing ? 0 : clamp(-0.6 * b, -14, 35);
    return tube([hip, kn, an], 3.6) + `<use href='#s' transform='translate(${n(an[0])} ${n(an[1])}) rotate(${n(t)})'/>`; };
  const arm = (up, fore) => { const e = at(sho, up, UA), h = at(e, fore, FA);
    return { svg: tube([sho, e, h], 3.4) + `<circle class='b' cx='${n(h[0])}' cy='${n(h[1])}' r='1.45' stroke-width='.8'/>`, h }; };
  const farUp = standing ? 6 : -1.35 * far[0];
  const farArm = arm(farUp, farUp + (farUp > 0 ? 50 : 14)).svg;
  const mugArm = arm(standing ? 16 : 14 - 0.25 * near[0], 88), [hx, hy] = mugArm.h, sway = standing ? 0 : Math.sin(2 * phi);
  const steam = `<path d='M1.2 -3.9q${n(-0.7 - 0.4 * sway)} -.8 -.4 -1.6t-.4 -1.3M2.5 -4q${n(-0.5 + 0.3 * sway)} -.7 -.3 -1.4t-.3 -1' stroke-width='.6' opacity='.75'/>`;
  return `<g opacity='.55'>${leg(far)}</g>`
    + `<g transform='${body}'><g opacity='.55'>${farArm}</g><use href='#t'/></g>`
    + leg(near)
    + `<g transform='${body}'><g transform='translate(${n(head[0])} ${n(head[1])}) rotate(${n(tilt)})'><use href='#h'/><path d='M2.7 ${n(-2 - brow)}q1.3 -1 2.7 -.2' stroke-width='.8'/></g>`
    + `${mugArm.svg}<g transform='translate(${n(hx)} ${n(hy)}) rotate(${n(-lean)})'><use href='#m'/>${steam}</g></g>`;
}

export function sprite() {
  const frames = [...Array(NF)].map((_, k) => frame(k, false)).concat(frame(0, true));
  const body = frames.map((g, i) => `<g transform='translate(${i * W})'>${g}</g>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W * frames.length} 40' fill='none' stroke='${L}' stroke-linecap='round' stroke-linejoin='round'>${DEFS}${body}</svg>`;
  return svg.replace(/([^\d.])0\.(\d)/g, '$1.$2');   // .5, not 0.5
}
export const cssUrl = () => `url("data:image/svg+xml,${sprite().replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write((process.argv.includes('--css') ? cssUrl() : sprite()) + '\n');
}
