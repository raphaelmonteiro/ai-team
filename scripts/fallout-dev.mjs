#!/usr/bin/env node
// The fallout theme's walker: an original little dev (backwards cap, headphones, a coffee mug) drawn in the
// Pip-Boy's line art, walking in place of the live dot. One SVG sprite: 24 walk frames (one stride, two steps,
// in a second) and a standing one, 32x40 units each, side by side.
// The walk is built the way an animator would, so it loops without a seam: each foot follows a path (on the
// ground it slides back at a constant speed, as on a treadmill; in the air it rises and comes forward on a smooth
// curve whose speed joins the ground's), the knee is solved from hip and ankle (two-bone IK), and everything else
// is a smooth periodic curve: the bounce (high over the planted foot, low on contact), a forward lean with a
// little squash and stretch, the head half a step late, the arm swing, heel strike and toe-off, the steam behind
// the mug and a brow that lifts on the bounce.
//
//   node scripts/fallout-dev.mjs          the sprite as SVG (stdout), e.g. to open it or turn it into a logo
//   node scripts/fallout-dev.mjs --css    the url("data:...") that dashboard/ui.css keeps in --walker
//
// After a change here, paste the --css output into ui.css (tests/ui.test.mjs checks that the two match).
// Draw it in a 4:5 box (20x25, 28x35): each frame is 32x40. preserveAspectRatio='none' keeps the frames on the
// box's steps even when it is not (with the default, a 26x32 box shrank the sprite and the dev slid back, a moonwalk).
// It lives in scripts/ and not in dashboard/: the installer copies all of dashboard/ into projects.
import { pathToFileURL } from 'node:url';

const L = '#1aff80', BG = '#06120a', NF = 24, W = 32;
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

// the walk, in units of the cycle u in [0, 1): the near leg touches down at u = 0, the far one at u = 0.5
const STANCE = 0.56, STRIDE = 8, LIFT = 3.2, ANKLE_Y = GROUND - SHOE, HIP_X = 14.4, HIP_Y = 29.3, BOB = 0.6;
const TAU = 2 * Math.PI, deg = (r) => (r * 180) / Math.PI, frac = (u) => ((u % 1) + 1) % 1;
// a foot's path over its own phase t: back along the ground, then up and forward (cubic Hermite with the ground's
// speed at both ends, so the foot never jerks when it lifts or lands)
function foot(t) {
  t = frac(t);
  if (t < STANCE) return [STRIDE / 2 - (STRIDE * t) / STANCE, 0];
  const q = (t - STANCE) / (1 - STANCE), v = (-STRIDE / STANCE) * (1 - STANCE);
  const x = (2 * q ** 3 - 3 * q ** 2 + 1) * (-STRIDE / 2) + (q ** 3 - 2 * q ** 2 + q) * v + (-2 * q ** 3 + 3 * q ** 2) * (STRIDE / 2) + (q ** 3 - q ** 2) * v;
  return [x, LIFT * Math.sin(Math.PI * q ** 0.85) ** 2];
}
// a smooth periodic curve through keys [t, value]: the first harmonics of the piecewise-linear one
function smooth(keys, harmonics = 3) {
  const lin = (t) => { t = frac(t); const ks = [...keys, [keys[0][0] + 1, keys[0][1]]];
    for (let i = 0; i < ks.length - 1; i++) if (t >= ks[i][0] && t <= ks[i + 1][0]) return ks[i][1] + ((t - ks[i][0]) / (ks[i + 1][0] - ks[i][0])) * (ks[i + 1][1] - ks[i][1]);
    return keys[0][1]; };
  const N = 720, c = [];
  for (let h = 0; h <= harmonics; h++) { let a = 0, b = 0; for (let i = 0; i < N; i++) { const t = i / N, v = lin(t); a += v * Math.cos(TAU * h * t); b += v * Math.sin(TAU * h * t); } c.push([(a * 2) / N, (b * 2) / N]); }
  return (t) => c.reduce((sum, [a, b], h) => sum + (h ? a * Math.cos(TAU * h * t) + b * Math.sin(TAU * h * t) : a / 2), 0);
}
// the shoe: toe up at heel strike, flat on the ground, toe down at toe-off, back up before the next contact
const shoeTilt = smooth([[0, -12], [0.1, 0], [0.38, 0], [0.56, 26], [0.68, 20], [0.88, -4]]);
// the knee, from hip and ankle: two bones, the knee bending forward
function knee(h, a) {
  const dx = a[0] - h[0], dy = a[1] - h[1], d = Math.min(Math.hypot(dx, dy), TH + SH - 0.01);
  const alpha = Math.acos(clamp((TH * TH + d * d - SH * SH) / (2 * TH * d), -1, 1));
  return at(h, deg(Math.atan2(dx, dy) + alpha), TH);
}

function frame(k, standing) {
  const u = k / NF, tn = u, tf = u + 0.5;
  const hb = standing ? 0 : Math.cos(2 * TAU * (u - STANCE / 2));          // 1 over the planted foot, -1 on contact
  const hip = [HIP_X, standing ? ANKLE_Y - (TH + SH) + 0.15 : HIP_Y - BOB * hb];
  const lean = standing ? 2 : 5 - 1.2 * hb, stretch = n((1 + 0.03 * hb) * 1000) / 1000;
  const body = `translate(${n(hip[0])} ${n(hip[1])}) rotate(${n(lean)}) scale(1 ${stretch})`;   // from here on, hip-relative
  const late = standing ? 0 : 2 * TAU * (u - STANCE / 2) - 1.0;               // the head follows half a step late
  const head = [1.7, -17.4 + (standing ? 0 : 0.45 * Math.cos(late))], tilt = standing ? 0 : 2.5 * Math.sin(late);
  const sho = [0.7, -7.4], brow = standing ? 0 : 0.4 * (hb + 1);
  const leg = (t, dx) => {
    const [fx, lift] = standing ? [dx, 0] : foot(t), an = [hip[0] + fx, ANKLE_Y - lift], kn = knee(hip, an);
    return tube([hip, kn, an], 3.6) + `<use href='#s' transform='translate(${n(an[0])} ${n(an[1])}) rotate(${n(standing ? 0 : shoeTilt(frac(t)))})'/>`; };
  const arm = (up, fore) => { const e = at(sho, up, UA), h = at(e, fore, FA);
    return { svg: tube([sho, e, h], 3.4) + `<circle class='b' cx='${n(h[0])}' cy='${n(h[1])}' r='1.45' stroke-width='.8'/>`, h }; };
  // the far arm swings against the far leg (back when that foot lands), bending more as it comes forward
  const farUp = standing ? 6 : -34 * Math.cos(TAU * tf), farArm = arm(farUp, farUp + 16 + 26 * ((farUp + 34) / 68)).svg;
  const mugArm = arm(standing ? 16 : 14 - 4 * Math.cos(TAU * tn), 88), [hx, hy] = mugArm.h, sway = standing ? 0 : Math.sin(2 * TAU * u);
  const steam = `<path d='M1.2 -3.9q${n(-0.7 - 0.4 * sway)} -.8 -.4 -1.6t-.4 -1.3M2.5 -4q${n(-0.5 + 0.3 * sway)} -.7 -.3 -1.4t-.3 -1' stroke-width='.6' opacity='.75'/>`;
  return `<g opacity='.55'>${leg(tf, -0.4)}</g>`
    + `<g transform='${body}'><g opacity='.55'>${farArm}</g><use href='#t'/></g>`
    + leg(tn, 0.8)
    + `<g transform='${body}'><g transform='translate(${n(head[0])} ${n(head[1])}) rotate(${n(tilt)})'><use href='#h'/><path d='M2.7 ${n(-2 - brow)}q1.3 -1 2.7 -.2' stroke-width='.8'/></g>`
    + `${mugArm.svg}<g transform='translate(${n(hx)} ${n(hy)}) rotate(${n(-lean)})'><use href='#m'/>${steam}</g></g>`;
}

export function sprite() {
  const frames = [...Array(NF)].map((_, k) => frame(k, false)).concat(frame(0, true));
  const body = frames.map((g, i) => `<g transform='translate(${i * W})'>${g}</g>`).join('');
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W * frames.length} 40' preserveAspectRatio='none' fill='none' stroke='${L}' stroke-linecap='round' stroke-linejoin='round'>${DEFS}${body}</svg>`;
  return svg.replace(/([^\d.])0\.(\d)/g, '$1.$2');   // .5, not 0.5
}
export const cssUrl = () => `url("data:image/svg+xml,${sprite().replace(/#/g, '%23').replace(/</g, '%3C').replace(/>/g, '%3E')}")`;

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write((process.argv.includes('--css') ? cssUrl() : sprite()) + '\n');
}
