// TREE GENERATOR: botanical, not painted. A tree is grown as a real skeleton (trunk -> scaffold boughs -> branches -> twigs, orders 0..4, gnarled, phototropic, steered by a crown
// envelope), leaves are then placed one by one along the twigs on a golden-angle spiral (phyllotaxis), fruit hangs from spurs inside the boughs. The same skeleton is emitted as
//   - DETAIL mesh : tapered wood rings + every leaf as its own folded, arched leaf (real geometry, its own wind phase) + fruit + blossom      (used within ~15 m)
//   - CARD mesh   : the wood of the big orders + crossed leaf-clump cards at the leaf clusters (the middle distance)
//   - impostor    : a side projection painted from the very same skeleton (far away)
// Everything is built once per species variant (prototype); a tree in the world is only a matrix.
import { mulberry32 } from '../../core/math.js';
import { Builder } from '../cars/carmodel.js';
import { LEAF, CELL, cellUV } from './leafart.js';

export class TreeBuilder extends Builder {
  constructor(off) { super(off); this.tile = []; }
  vert(x, y, z, nx, ny, nz, u, v, c0 = 1, c1 = 1, c2 = 1, t = 0) { this.tile.push(t); return super.vert(x, y, z, nx, ny, nz, u, v, c0, c1, c2); }
  finish() { const r = super.finish(); r.geo.tile = new Float32Array(this.tile); return r; }
}

// ---------------------------------------------------------------- vector helpers
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const mad = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vlen = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const perp = (d) => norm(cross(d, Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
const rot = (v, ax, a) => { const c = Math.cos(a), s = Math.sin(a), k = dot(ax, v) * (1 - c), q = cross(ax, v); return [v[0] * c + q[0] * s + ax[0] * k, v[1] * c + q[1] * s + ax[1] * k, v[2] * c + q[2] * s + ax[2] * k]; };
const dir = (pitch, az) => [Math.sin(pitch) * Math.cos(az), Math.cos(pitch), -Math.sin(pitch) * Math.sin(az)];   // pitch from straight up
const GOLD = 2.39996323;

// ---------------------------------------------------------------- species recipes
// leaf: picture name; rows: 3 = arched (long leaves), 2 = straight; fold: V-fold depth; droop: arch of the blade; target: leaves per tree; size: blade length range (m);
// oN / tN / upB: leaf direction = outward * oN + along-the-twig * tN + up * upB; a0: darkness of the crown heart (1 = none)
// fork: trunk height / tree height; env: crown ellipsoid (centre / half height as shares of tree height, half width as a share of crown radius)
const SPEC = {
  apple:  { leaf: 'apple', rows: 2, fold: 0.22, droop: 0.12, target: 4800, fill: 180, size: [0.17, 0.26], oN: 0.8, tN: 0.45, upB: 0.25, leafOrd: 2, a0: 0.42, fork: 0.34, nLead: [4, 5], pitch: [0.55, 1.0], leadLen: 0.95, leadR: 0.5, maxOrd: 4, forks: [0, 3, 3, 2, 0], ratio: [0.6, 0.78], spread: [0.4, 0.7], bend: [0.05, 0.12, 0.22, 0.28, 0.3], nsub: [4, 4, 4, 3, 3], photo: 0.12, sag: 0, sideP: 0.55, env: { cy: 0.7, ry: 0.36, rx: 1.12 }, crownK: 1.0, trunkBend: 0.05, fruit: 'apple' },
  mango:  { leaf: 'mango', rows: 2, fold: 0.16, droop: 0.22, target: 4300, fill: 240, size: [0.3, 0.42], oN: 0.8, tN: 0.5, upB: -0.28, leafOrd: 3, a0: 0.34, fork: 0.2, nLead: [5, 6], pitch: [0.95, 1.3], leadLen: 0.9, leadR: 0.45, maxOrd: 4, forks: [0, 3, 3, 3, 0], ratio: [0.6, 0.76], spread: [0.4, 0.75], bend: [0.05, 0.1, 0.2, 0.26, 0.3], nsub: [4, 4, 4, 3, 3], photo: 0.1, sag: 0.04, sideP: 0.6, env: { cy: 0.62, ry: 0.38, rx: 1.12 }, crownK: 1.0, trunkBend: 0.07, rosette: 5, fruit: 'mango', young: 0.14 },
  neem:   { leaf: 'neem', rows: 3, fold: 0, droop: 0.16, target: 2900, fill: 160, size: [0.34, 0.5], oN: 0.75, tN: 0.6, upB: 0.1, leafOrd: 2, a0: 0.4, fork: 0.34, nLead: [4, 5], pitch: [0.62, 1.0], leadLen: 0.95, leadR: 0.45, maxOrd: 4, forks: [0, 3, 3, 2, 0], ratio: [0.6, 0.78], spread: [0.42, 0.72], bend: [0.05, 0.12, 0.24, 0.3, 0.3], nsub: [4, 4, 4, 3, 3], photo: 0.12, sag: 0, sideP: 0.6, env: { cy: 0.68, ry: 0.36, rx: 1.12 }, crownK: 1.0, trunkBend: 0.06, young: 0.1, fruit: 'nimboli' },
  banyan: { leaf: 'banyan', rows: 2, fold: 0.2, droop: 0.1, target: 5200, fill: 300, size: [0.22, 0.32], oN: 0.8, tN: 0.4, upB: 0.15, leafOrd: 2, a0: 0.36, fork: 0.24, nLead: [6, 7], pitch: [1.25, 1.5], leadLen: 1.0, leadR: 0.45, maxOrd: 4, forks: [0, 3, 3, 2, 0], ratio: [0.55, 0.72], spread: [0.4, 0.7], bend: [0.05, 0.1, 0.2, 0.26, 0.3], nsub: [4, 4, 4, 3, 3], photo: 0.05, sag: 0.03, sideP: 0.6, env: { cy: 0.66, ry: 0.3, rx: 1.12 }, crownK: 1.0, trunkBend: 0.04, upper: 3, roots: [8, 11], fruit: 'fig' },
  gulmohar: { leaf: 'gul', rows: 3, fold: 0, droop: 0.12, target: 2100, fill: 70, size: [0.5, 0.7], oN: 1.0, tN: 0.3, upB: 0.12, leafOrd: 2, a0: 0.5, fork: 0.34, nLead: [4, 5], pitch: [1.15, 1.4], leadLen: 1.0, leadR: 0.45, maxOrd: 4, forks: [0, 3, 3, 2, 0], ratio: [0.58, 0.74], spread: [0.45, 0.78], bend: [0.05, 0.12, 0.22, 0.28, 0.3], nsub: [4, 4, 4, 3, 3], photo: 0.0, sag: 0.02, sideP: 0.55, env: { cy: 0.72, ry: 0.22, rx: 1.12 }, crownK: 1.0, trunkBend: 0.05, flower: 900 },
  babool: { leaf: 'babool', rows: 3, fold: 0, droop: 0.12, target: 1900, fill: 45, size: [0.2, 0.3], oN: 1.0, tN: 0.3, upB: 0.05, leafOrd: 2, a0: 0.55, fork: 0.28, nLead: [3, 3], pitch: [0.5, 0.85], leadLen: 1.0, leadR: 0.5, maxOrd: 4, forks: [0, 2, 3, 2, 0], ratio: [0.62, 0.78], spread: [0.5, 0.9], bend: [0.1, 0.22, 0.34, 0.38, 0.4], nsub: [4, 4, 3, 3, 3], photo: 0.0, sag: 0.04, sideP: 0.5, env: { cy: 0.78, ry: 0.2, rx: 1.15 }, crownK: 1.0, trunkBend: 0.14, thorns: true },
  shrub:  { leaf: 'shrub', rows: 2, fold: 0.18, droop: 0.1, target: 900, fill: 70, size: [0.07, 0.11], oN: 0.8, tN: 0.4, upB: 0.3, leafOrd: 1, a0: 0.55, fork: 0.02, nLead: [8, 10], pitch: [0.12, 0.55], leadLen: 0.9, leadR: 0.7, maxOrd: 3, forks: [0, 3, 2, 0], ratio: [0.55, 0.72], spread: [0.4, 0.8], bend: [0.05, 0.15, 0.25, 0.3], nsub: [3, 3, 3, 3], photo: 0.1, sag: 0, sideP: 0.5, env: { cy: 0.55, ry: 0.5, rx: 1.15 }, crownK: 1.0, trunkBend: 0.02, flowerShrub: true },
  ashoka: { cs: 1.15, leaf: 'ashoka', rows: 2, fold: 0.1, droop: 0.28, target: 3400, size: [0.22, 0.32], oN: 0.5, tN: 0.2, upB: -1.1, leafOrd: 1, a0: 0.66, a0b: 1 },
};

// ---------------------------------------------------------------- skeleton
function growBroad(S, rn, hN, cN, r0) {
  const limbs = [], cy = S.env.cy * hN, ry = S.env.ry * hN, rx = S.env.rx * cN;
  const R = (a, b) => a + (b - a) * rn();
  const e2 = (p) => { const x = p[0] / rx, y = (p[1] - cy) / ry, z = p[2] / rx; return x * x + y * y + z * z; };
  const branch = (p0, d0, len, ra, rb, ord, extra) => {
    const nSub = (extra && extra.ns) || S.nsub[Math.min(ord, S.nsub.length - 1)], seg = len / nSub, bs = S.bend[Math.min(ord, S.bend.length - 1)];
    let p = p0, d = norm(d0); const pts = [p0.slice()], rad = [ra];
    for (let s = 0; s < nSub; s++) {
      if (s > 0 || ord >= 2) {
        d = [d[0] + (rn() - 0.5) * 2 * bs, d[1], d[2] + (rn() - 0.5) * 2 * bs];
        if (ord >= 2) d[1] += (p[1] > cy ? S.photo : S.photo * 0.2) * 0.9 + (rn() - 0.5) * 0.14 - S.sag * ord;
        d = norm(d);
      }
      let q = mad(p, d, seg);
      if (e2(q) > 1) {   // crown envelope: bend back into the crown, then shorten
        const tc = norm([-p[0], cy - p[1], -p[2]]);
        d = norm(add(mul(d, 0.35), mul(tc, 0.65))); q = mad(p, d, seg);
        if (e2(q) > 1.25) q = mad(p, d, seg * 0.5);
      }
      pts.push(q); rad.push(lerp(ra, rb, (s + 1) / nSub)); p = q;
      if (S.sideP && ord >= 1 && ord <= 3 && s > 0 && s < nSub - 1 && rn() < S.sideP) {   // lateral shoot half way along the limb: fills the interior
        const ax = perp(d), sd = rot(rot(d, ax, R(0.55, 0.95)), d, rn() * 6.283), sdn = norm([sd[0], Math.max(-0.15, sd[1] + 0.12), sd[2]]);
        const rr = lerp(ra, rb, (s + 1) / nSub);
        if (len * 0.58 > 0.12) branch(q, sdn, len * 0.58, rr * 0.62, Math.max(0.006, rr * 0.22), ord + 1);
      }
    }
    limbs.push({ pts, rad, ord, ...extra });
    if (ord < S.maxOrd && !(extra && extra.nf)) {
      const nf = S.forks[Math.min(ord, S.forks.length - 1)];
      for (let f = 0; f < nf; f++) {
        const ax = perp(d), az = (f / nf) * 6.283 + (rn() - 0.5) * 0.9;
        let nd = rot(rot(d, ax, R(S.spread[0], S.spread[1])), d, az);
        nd = norm([nd[0], nd[1] > cy / hN * 0 + 0 ? nd[1] + (p[1] > cy ? 0.22 : 0.08) * S.photo * 4 : nd[1] + 0.08, nd[2]]);
        const cl = len * R(S.ratio[0], S.ratio[1]);
        if (cl > 0.1) branch(p, nd, cl, rb * 0.9, Math.max(0.005, rb * R(0.5, 0.64)), ord + 1);
      }
    }
  };
  // trunk
  const ht = S.fork * hN, nT = 4, tp = [[0, -0.12, 0], [0, 0, 0]], tr = [r0 * 1.5, r0 * 1.05];
  for (let i = 1; i <= nT; i++) { const f = i / nT; tp.push([(rn() - 0.5) * ht * S.trunkBend * f * 2, ht * f, (rn() - 0.5) * ht * S.trunkBend * f * 2]); tr.push(r0 * lerp(1, 0.78, f)); }
  limbs.push({ pts: tp, rad: tr, ord: 0 });
  const top = tp[tp.length - 1], nl = S.nLead[0] + Math.floor(rn() * (S.nLead[1] - S.nLead[0] + 1)), a0 = rn() * 6.283;
  for (let i = 0; i < nl; i++) {   // lowest limbs are the most horizontal, higher ones steeper; they leave the trunk at different heights
    const fr = nl > 1 ? i / (nl - 1) : 0, az = a0 + (i / nl) * 6.283 + (rn() - 0.5) * 0.55, th = lerp(S.pitch[1], S.pitch[0], fr) + (rn() - 0.5) * 0.2;
    const st = lerp3(tp[tp.length - 2], top, 0.3 + 0.7 * fr);
    branch(st, dir(th, az), S.leadLen * cN * R(0.85, 1.15), r0 * S.leadR, r0 * S.leadR * 0.55, 1);
  }
  for (let i = 0; i < (S.upper || 0); i++) branch(top, dir(0.5 + rn() * 0.3, a0 + i * 2.1 + rn()), cN * 0.55, r0 * 0.34, r0 * 0.14, 2);
  // central leader straight up through the crown (it carries lateral shoots on the way): never a bare top, never a hollow middle
  branch(top, norm([(rn() - 0.5) * 0.3, 1, (rn() - 0.5) * 0.3]), Math.max(0.6, (hN - ht) * 0.62), r0 * 0.42, r0 * 0.16, 1);
  // volume filling: twigs grow from the nearest limb towards random points inside the crown envelope that nothing reaches yet
  if (S.fill) {
    const all = [];
    for (const l of limbs) if (l.ord >= 1 && l.ord <= 3 && !l.root) for (let i = 0; i < l.pts.length; i++) all.push([l.pts[i], l, i]);
    for (let k = 0; k < S.fill; k++) {
      let q, tries = 0;
      do { q = [(rn() * 2 - 1) * rx, cy + (rn() * 2 - 1) * ry, (rn() * 2 - 1) * rx]; } while ((e2(q) > 0.88 || q[0] * q[0] + q[2] * q[2] < (r0 * 2.2) ** 2) && ++tries < 12);
      let best = null, bd = 1e9;
      for (const a of all) { const dx = a[0][0] - q[0], dy = a[0][1] - q[1], dz = a[0][2] - q[2], dd = dx * dx + dy * dy + dz * dz; if (dd < bd) { bd = dd; best = a; } }
      const dist = Math.sqrt(bd); if (!best || dist < 0.3) continue;
      const rr = best[1].rad[best[2]];
      branch(best[0], norm(sub(q, best[0])), Math.min(1.3, dist * 1.05), Math.max(0.008, rr * 0.45), 0.006, Math.min(S.maxOrd, best[1].ord + 1), { nf: true, ns: 2 });
    }
  }
  return { limbs, cy, ry, rx };
}

// ashoka: a straight mast with spiral whorls of long drooping boughs
function growMast(S, rn, hN, cN, r0) {
  const limbs = [], top = hN * 0.93, cy = hN * 0.55;
  const pts = [[0, -0.12, 0], [0, 0, 0]], rad = [r0 * 1.5, r0 * 1.05];
  for (let i = 1; i <= 5; i++) { const f = i / 5; pts.push([(rn() - 0.5) * 0.1 * f, top * f, (rn() - 0.5) * 0.1 * f]); rad.push(r0 * (1 - 0.8 * f)); }
  limbs.push({ pts, rad, ord: 0 });
  const trunkAt = (y) => { const k = clamp(y / top, 0, 1) * 5, i = Math.min(4, Math.floor(k)); return lerp3(pts[i + 1], pts[i + 2], k - i); };
  const R = (a, b) => a + (b - a) * rn();
  const twig = (p0, d0, len, ra, rb, ord) => {
    const nSub = 3, seg = len / nSub; let p = p0, d = norm(d0); const pp = [p0.slice()], rr = [ra];
    for (let s = 0; s < nSub; s++) { d = norm([d[0] + (rn() - 0.5) * 0.2, d[1] - 0.16 * (1 + ord * 0.4), d[2] + (rn() - 0.5) * 0.2]); p = mad(p, d, seg); pp.push(p); rr.push(lerp(ra, rb, (s + 1) / nSub)); }
    limbs.push({ pts: pp, rad: rr, ord });
    return p;
  };
  let i = 0;
  for (let y = hN * 0.17; y < top; y += 0.42, i++) {
    const q = (y - hN * 0.17) / (top - hN * 0.17), Lb = cN * 1.25 * (1 - q * 0.88) + 0.22, nb = y < hN * 0.5 ? 5 : 4, a0 = i * GOLD;
    const base = trunkAt(y);
    for (let j = 0; j < nb; j++) {
      const az = a0 + (j / nb) * 6.283 + (rn() - 0.5) * 0.5, th = 1.2 + R(0, 0.5) + 0.3 * q;
      let d = dir(th, az), p = base; const nSub = 4, seg = Lb / nSub, pp = [base], rr = [Math.max(0.012, r0 * 0.28 * (1 - q))];
      for (let s = 0; s < nSub; s++) {
        d = norm([d[0], d[1] - 0.2, d[2]]); p = mad(p, d, seg); pp.push(p); rr.push(Math.max(0.006, rr[0] * (1 - (s + 1) / nSub * 0.7)));
        if (s > 0 && rn() < 0.8) twig(p, norm(rot(d, [0, 1, 0], (rn() < 0.5 ? 1 : -1) * R(0.5, 1.1))), Lb * R(0.3, 0.5), 0.006, 0.004, 2);
      }
      limbs.push({ pts: pp, rad: rr, ord: 1 });
    }
  }
  return { limbs, cy, ry: hN * 0.5, rx: cN * 1.3, mast: true };
}

// ---------------------------------------------------------------- leaves, flowers, fruit sites
function foliage(S, T, rn, name) {
  const leaves = [], flowers = [], cen = [0, T.cy, 0], rx = T.rx, ry = T.ry;
  const e = (p) => Math.sqrt(((p[0]) / rx) ** 2 + ((p[1] - T.cy) / ry) ** 2 + (p[2] / rx) ** 2);
  const sizeOf = (p) => lerp(S.size[0], S.size[1], rn());
  const U = LEAF[S.leaf];
  const mkLeaf = (p, d, tw, depthK) => {
    const e0 = e(p), hg = clamp(((p[1] - T.cy) / ry + 1) * 0.5, 0, 1);
    const sun = clamp((e0 - 0.25) / 0.75, 0, 1);
    const ao = (S.a0 + (1 - S.a0) * Math.pow(Math.min(e0, 1.1), 0.9)) * (0.78 + 0.22 * hg) * (0.86 + rn() * 0.28);
    let c = [ao, ao, ao];
    if (S.young && rn() < S.young) c = [ao * 2.0, ao * 0.9, ao * 0.55];            // new flush: coppery
    else if (rn() < 0.04) c = [ao * 1.5, ao * 1.1, ao * 0.6];                        // a yellowing leaf
    const sh = (rn() - 0.5) * 0.08; c = [c[0] * (1 + sh), c[1], c[2] * (1 - sh)];
    const out = norm([p[0], (p[1] - T.cy) * 0.7, p[2]]);
    return { p, d, roll: (rn() - 0.5) * 1.5, len: sizeOf(p) * (0.9 + 0.25 * sun), ws: 0.9 + rn() * 0.25, c, out, seed: (rn() * 4096) | 0, e: e0 };
  };
  // twig length that can carry leaves
  let L = 0;
  for (const l of T.limbs) if (l.ord >= S.leafOrd && !l.root) for (let i = 0; i < l.pts.length - 1; i++) L += vlen(sub(l.pts[i + 1], l.pts[i]));
  const perM = S.target / Math.max(L, 1);
  let idx = 0;
  for (const l of T.limbs) {
    if (l.ord < S.leafOrd || l.root) continue;
    const nSeg = l.pts.length - 1;
    for (let i = 0; i < nSeg; i++) {
      const a = l.pts[i], b = l.pts[i + 1], td = norm(sub(b, a)), sl = vlen(sub(b, a)), o1 = perp(td), o2 = cross(td, o1), rr = lerp(l.rad[i], l.rad[i + 1], 0.5);
      let nL = sl * perM * (l.ord >= S.leafOrd + 1 ? 1.1 : 0.7); let n = Math.floor(nL); if (rn() < nL - n) n++;
      for (let k = 0; k < n; k++) {
        const f = (k + rn() * 0.7) / Math.max(n, 1), np = lerp3(a, b, Math.min(f, 1)), ph = idx++ * GOLD + (rn() - 0.5) * 0.4;
        const out = add(mul(o1, Math.cos(ph)), mul(o2, Math.sin(ph)));
        const base = mad(np, out, rr + 0.01 + rn() * 0.06);
        const d = norm(add(add(mul(out, S.oN), mul(td, S.tN)), [0, S.upB, 0]));
        leaves.push(mkLeaf(base, d));
      }
    }
    // a rosette at the end of every twig (mango: dense tufts at the branch tips)
    if (S.rosette && l.ord >= S.maxOrd && rn() < 0.38) {
      const tp = l.pts[nSeg], td = norm(sub(tp, l.pts[nSeg - 1]));
      for (let k = 0; k < S.rosette; k++) { const ph = k * GOLD, o1 = perp(td), o2 = cross(td, o1), spread = 0.7 + rn() * 0.5; const d = norm(add(mul(td, 0.5), add(mul(add(mul(o1, Math.cos(ph)), mul(o2, Math.sin(ph))), spread), [0, S.upB, 0]))); leaves.push(mkLeaf(mad(tp, td, 0.01), d)); }
    }
  }
  // blossom (gulmohar): clusters at the ends of the outer twigs in the upper crown
  if (S.flower) {
    const tips = T.limbs.filter((l) => l.ord >= 3 && !l.root);
    for (let k = 0, tries = 0; k < S.flower && tries < S.flower * 8; tries++) {
      const l = tips[(rn() * tips.length) | 0], p = lerp3(l.pts[l.pts.length - 2], l.pts[l.pts.length - 1], rn() * 0.5 + 0.5), e0 = e(p);
      if (e0 < 0.5 || p[1] < T.cy - ry * 0.3) continue;
      const out = norm([p[0] + (rn() - 0.5), (p[1] - T.cy) * 0.5 + 0.4, p[2] + (rn() - 0.5)]), sz = 0.17 + rn() * 0.09, kk = 0.95 + rn() * 0.3;
      flowers.push({ name: 'gulflower', p: mad(p, out, 0.08), d: out, roll: rn() * 6.283, len: sz, ws: 1, c: [kk * 1.5, kk * 1.5, kk * 1.5], out, seed: (rn() * 4096) | 0, nolc: true }); k++;
    }
  }
  if (S.flowerShrub && rn() < 0.7) {   // flowering shrub (ixora / hibiscus / marigold style): umbels on the outside of the crown, tinted yellow, orange, pink or deep red
    const TINTS = [[1, 1, 1], [1, 2.4, 1], [1, 7.5, 3.5], [1, 2.4, 14], [0.85, 0.5, 0.5]], tint = TINTS[Math.floor(rn() * TINTS.length)], nf = 6 + Math.floor(rn() * 5);
    for (let i = 0; i < nf; i++) {
      const a = rn() * 6.283, ph = 0.2 + rn() * 0.7, up = dir(ph, a), rr = T.rx * (0.55 + rn() * 0.4), y = T.cy + (rn() - 0.3) * T.ry, sz = 0.16 + rn() * 0.12, kk = 0.8 + rn() * 0.4;
      flowers.push({ name: 'shrubflower', p: [Math.cos(a) * rr, y, -Math.sin(a) * rr], d: up, roll: rn() * 6.283, len: sz, ws: 1, c: [0.75 * kk * tint[0], 0.75 * kk * tint[1], 0.75 * kk * tint[2]], out: up, seed: (rn() * 4096) | 0, nolc: true });
    }
  }
  return { leaves, flowers };
}

// ---------------------------------------------------------------- fruit
export const FRUIT_COUNT = { coconut: [1, 1, 2, 2, 2], mango: [2, 3, 3, 3, 3], apple: [6, 7, 8, 8, 9] };
const FT = { apple: 3, mango: 4, coconut: 5, nimboli: 6, fig: 7 };   // fruit skin type (vertex "tile" type: the shader draws the skin by it)
export const FRUIT_DEF = {   // half sizes (m), mass (kg): used by the tree field for fallen fruit too
  apple: { R: 0.052, mass: 0.22 }, mango: { R: 0.052, L: 0.15, mass: 0.4 }, coconut: { R: 0.1, L: 0.3, mass: 2.0 },
};
// a surface of revolution hanging from C along ax (unit, pointing away from the stem). prof: [r, h] rings from the stem end to the far end. Returns the vertex index range.
export function lathe(b, part, C, ax, prof, ns, colf, type, seed, o = {}) {
  const e1 = perp(ax), e2 = cross(ax, e1), base = b.nv, nR = prof.length, Hm = prof[nR - 1][1] || 1, ns1 = ns + 1;
  for (let i = 0; i < nR; i++) {
    const [r, h] = prof[i], pa = prof[Math.max(0, i - 1)], pb = prof[Math.min(nR - 1, i + 1)], dr = pb[0] - pa[0], dh = pb[1] - pa[1], tl = Math.hypot(dr, dh) || 1;
    const t = i / (nR - 1), w = o.still ? 0 : clamp(h / Hm, 0, 0.99);
    for (let k = 0; k <= ns; k++) {
      const th = (k / ns) * 6.2832, ct = Math.cos(th), st = Math.sin(th), rad = r * (1 + (o.tri || 0) * Math.cos(th * 3) * Math.sin(Math.PI * t));
      const ro = [e1[0] * ct + e2[0] * st, e1[1] * ct + e2[1] * st, e1[2] * ct + e2[2] * st], cv = (o.curve || 0) * Math.sin(Math.PI * t) * Hm;
      const nn = norm([ro[0] * dh / tl - ax[0] * dr / tl, ro[1] * dh / tl - ax[1] * dr / tl, ro[2] * dh / tl - ax[2] * dr / tl]), c = colf(t, th, k / ns);
      b.vert(C[0] + ax[0] * h + ro[0] * rad + e1[0] * cv, C[1] + ax[1] * h + ro[1] * rad + e1[1] * cv, C[2] + ax[2] * h + ro[2] * rad + e1[2] * cv, nn[0], nn[1], nn[2], k / ns, t, c[0], c[1], c[2], type * 4096 + seed + w);
    }
  }
  const gi = b.grp(part, 'paint').idx;
  for (let i = 0; i < nR - 1; i++) for (let k = 0; k < ns; k++) { const a = base + i * ns1 + k, bb = a + 1, c2 = a + ns1, d = bb + ns1; gi.push(a, bb, d, a, d, c2); }
}
const appleProf = (R, nR = 11) => {
  const p = [];
  for (let i = 0; i < nR; i++) {
    const f = Math.PI * i / (nR - 1), cf = Math.cos(f), sf = Math.sin(f);
    let r = R * sf * (1 + 0.08 * cf) * (1 - 0.16 * smooth(0.55 * Math.PI, Math.PI, f)), h = R * (1 - cf) * 0.92 + R * 0.34 * Math.pow(Math.max(0, 1 - f / 0.5), 2) - R * 0.14 * Math.pow(Math.max(0, 1 - (Math.PI - f) / 0.4), 2);
    p.push([r, h]);
  }
  return p;
};
const mangoProf = (R, L, nR = 11) => {
  const p = [];
  for (let i = 0; i < nR; i++) { const t = i / (nR - 1); p.push([R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.72))), 0.85) * (1.1 - 0.3 * t) + (i === 0 ? 0.004 : 0), L * t]); }
  return p;
};
const coconutProf = (R, L, nR = 8) => { const p = []; for (let i = 0; i < nR; i++) { const t = i / (nR - 1); p.push([R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.85))), 0.8) + (i === 0 ? 0.01 : 0), L * t]); } return p; };
const ovalProf = (R, L, nR = 4) => { const p = []; for (let i = 0; i < nR; i++) { const t = i / (nR - 1); p.push([R * Math.sin(Math.PI * t) + (i === 0 || i === nR - 1 ? 0.002 : 0), L * t]); } return p; };
const noise1 = (a) => { const s = Math.sin(a * 12.9898 + 4.1) * 43758.5453; return s - Math.floor(s); };

// colour functions: [r,g,b] per ring/sector (the shader adds streaks and lenticels)
export function skin(kind, rn, ripe) {
  if (kind === 'apple') {
    const strength = ripe ?? (rn() < 0.7 ? 0.8 + rn() * 0.2 : 0.35 + rn() * 0.4), th0 = rn() * 6.28, sd = rn() * 50, S = 0.9 + rn() * 0.2;
    return (t, th) => {
      const sideK = 0.5 + 0.5 * Math.cos(th - th0), n = noise1(sd + Math.floor(th * 5.0)) * 0.35, bl = clamp((sideK * 0.9 + n * 0.6) * strength * 1.25 - 0.05 + (1 - t) * 0.05, 0, 1);
      const g = [0.46 * S, 0.5 * S, 0.12 * S], rd = [0.48 * S, 0.045 * S, 0.035 * S], k = Math.pow(bl, 0.9) * (1 - 0.35 * smooth(0, 0.18, t) * (1 - strength));
      const sh = 0.8 + 0.2 * Math.sin(Math.PI * t) + 0.12 * (1 - t);
      return [lerp(g[0], rd[0], k) * sh, lerp(g[1], rd[1], k) * sh, lerp(g[2], rd[2], k) * sh];
    };
  }
  if (kind === 'mango') {
    const ripeK = ripe ?? (rn() < 0.45 ? 0.55 + rn() * 0.45 : rn() * 0.25), th0 = rn() * 6.28;
    return (t, th) => {
      const blush = clamp((0.5 + 0.5 * Math.cos(th - th0)) * ripeK * 0.8 - 0.1, 0, 1) * smooth(0.12, 0.45, t);
      const gr = [0.17, 0.33, 0.06], yl = [0.58, 0.42, 0.05], rd = [0.58, 0.18, 0.05];
      const y = clamp(ripeK * 1.3 * (0.35 + 0.65 * smooth(0.0, 0.5, t)), 0, 1), c = lerp3(gr, yl, y);
      return lerp3(c, rd, blush);
    };
  }
  if (kind === 'coconut') {
    const ripeK = ripe ?? (rn() < 0.4 ? 1 : 0);
    return () => (ripeK ? [0.27 + rn() * 0.03, 0.18 + rn() * 0.02, 0.08] : [0.13 + rn() * 0.03, 0.21 + rn() * 0.03, 0.045]);
  }
  if (kind === 'nimboli') { const y = rn(); return (t) => [lerp(0.26, 0.55, y) * (0.8 + 0.2 * t), lerp(0.4, 0.46, y), 0.06]; }
  return (t) => [0.5 + 0.1 * rn(), 0.1, 0.06];   // fig
}
function emitFruit(c, part, f, lowLod) {   // one piece of fruit hung from f.P (the stem point), axis f.ax pointing down; deterministic from f.seed so both LODs match
  const { b } = c, rn = mulberry32(f.seed), kind = f.kind, P = f.P, ax = f.ax, seed = (rn() * 4000) | 0, sc = f.sc || 1, cf = skin(kind, rn, f.ripe), still = !!f.lying, lo = !!lowLod;
  if (kind === 'apple') { const R = FRUIT_DEF.apple.R * sc * (0.88 + rn() * 0.25); lathe(b, part, P, ax, appleProf(R, lo ? 6 : 9), lo ? 6 : 10, cf, FT.apple, seed, { still }); if (!f.lying) stem(c, part, P, ax, 0.045, 0.004); return; }
  if (kind === 'mango') { const R = FRUIT_DEF.mango.R * sc * (0.9 + rn() * 0.2), L = FRUIT_DEF.mango.L * sc * (0.92 + rn() * 0.16); lathe(b, part, P, ax, mangoProf(R, L, lo ? 6 : 10), lo ? 6 : 10, cf, FT.mango, seed, { curve: 0.05, still }); if (!f.lying) stem(c, part, P, ax, 0.09 * sc, 0.008); return; }
  if (kind === 'coconut') { const R = FRUIT_DEF.coconut.R * sc * (0.92 + rn() * 0.16), L = FRUIT_DEF.coconut.L * sc * (0.92 + rn() * 0.16); lathe(b, part, P, ax, coconutProf(R, L, lo ? 6 : 8), lo ? 6 : 9, cf, FT.coconut, seed, { tri: 0.07, still }); return; }
  if (kind === 'nimboli') { const R = 0.015 * (0.9 + rn() * 0.3); lathe(b, part, P, ax, ovalProf(R, R * 2.1), 5, cf, FT.nimboli, seed, {}); stem(c, part, P, ax, 0.04, 0.003); return; }
  if (kind === 'fig') { const R = 0.019 * (0.9 + rn() * 0.3); lathe(b, part, P, ax, ovalProf(R, R * 1.7), 6, cf, FT.fig, seed, {}); return; }
}
// a loose piece of fruit centred on the origin (for the bodies of fallen fruit)
export function fruitMesh(b, part, kind, ripe, seed) {
  const L = kind === 'coconut' ? FRUIT_DEF.coconut.L : kind === 'mango' ? FRUIT_DEF.mango.L : 0.09;
  emitFruit({ b }, part, { kind, P: [0, L / 2, 0], ax: [0, -1, 0], sc: 1, ripe, seed, lying: true });
}
function stem(c, part, P, ax, len, r) {   // pedicel: a thin 3-sided prism
  const { b } = c, e1 = perp(ax), e2 = cross(ax, e1), base = b.nv;
  for (let ring = 0; ring < 2; ring++) for (let k = 0; k < 3; k++) {
    const th = k / 3 * 6.2832, o = add(mul(e1, Math.cos(th)), mul(e2, Math.sin(th))), p = mad(mad(P, ax, ring ? -len : 0.004), o, ring ? r * 0.6 : r);
    b.vert(p[0], p[1], p[2], o[0], o[1], o[2], 0, 0, 0.3, 0.26, 0.12, 0);
  }
  const gi = b.grp(part, 'paint').idx; for (let k = 0; k < 3; k++) { const a = base + k, bb = base + (k + 1) % 3; gi.push(a, bb, bb + 3, a, bb + 3, a + 3); }
}

// ---------------------------------------------------------------- emitting
// wood: rings along every limb, parallel-transported frames; a limb starts a little inside its parent
function emitWood(c, T, maxOrd) {
  const { b, W, bk, rn } = c, gi = b.grp(W.trunk, 'paint').idx;
  for (const l of T.limbs) {
    if (l.ord > maxOrd) continue;
    const sides = l.ord === 0 ? 9 : l.ord === 1 ? 7 : l.ord === 2 ? 5 : 3, pts = l.pts, n = pts.length, base = b.nv, kb = bk * (0.9 + rn() * 0.2) * (l.ord >= 3 ? 0.92 : 1);
    let e1 = null;
    for (let i = 0; i < n; i++) {
      const t = norm(sub(pts[Math.min(n - 1, i + 1)], pts[Math.max(0, i - 1)]));
      e1 = e1 ? norm(sub(e1, mul(t, dot(e1, t)))) : perp(t);
      const e2 = cross(t, e1), r = l.rad[i];
      const p = i === 0 && l.ord > 0 ? mad(pts[0], t, -r * 0.7) : pts[i];
      for (let k = 0; k <= sides; k++) { const th = (k / sides) * 6.2832, cs = Math.cos(th), sn = Math.sin(th), nx = e1[0] * cs + e2[0] * sn, ny = e1[1] * cs + e2[1] * sn, nz = e1[2] * cs + e2[2] * sn; b.vert(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz, k / sides, i / (n - 1), kb, kb, kb, 0); }
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) { const a0 = base + i * (sides + 1) + k, b0 = a0 + sides + 1; gi.push(a0, a0 + 1, b0, a0 + 1, b0 + 1, b0); }
  }
}

function emitLeaf(c, L, name, S, type) {
  const { b, W } = c, U = LEAF[name], rows = L.rows || S.rows, cols = L.cols || (S.fold > 0 ? 3 : 2), d = L.d;
  let w0 = cross(d, [0, 1, 0]); if (Math.hypot(w0[0], w0[1], w0[2]) < 1e-3) w0 = [1, 0, 0]; w0 = norm(w0);
  const n0 = cross(w0, d), cr = Math.cos(L.roll), sr = Math.sin(L.roll);
  const w = [w0[0] * cr + n0[0] * sr, w0[1] * cr + n0[1] * sr, w0[2] * cr + n0[2] * sr], n = [n0[0] * cr - w0[0] * sr, n0[1] * cr - w0[1] * sr, n0[2] * cr - w0[2] * sr];
  const hw = L.len * U.asp * 0.5 * L.ws, fold = S.fold || 0, droop = S.droop || 0, sgn = dot(n, L.out) >= 0 ? 1 : -1, amp = clamp(L.len / 0.5, 0.15, 0.98), base = b.nv, lm = L.nolc ? [1, 1, 1] : c.lc, c0 = [L.c[0] * lm[0], L.c[1] * lm[1], L.c[2] * lm[2]];
  for (let r = 0; r < rows; r++) {
    const t = r / (rows - 1), ctr = mad(mad(L.p, d, L.len * t), n, -droop * L.len * t * t), v = lerp(U.v1, U.v0, t);
    for (let k = 0; k < cols; k++) {
      const x = cols === 2 ? (k ? 1 : -1) : k - 1, p = mad(mad(ctr, w, x * hw), n, fold * Math.abs(x) * hw);
      const fn = norm(add(add(n, mul(w, -x * fold * 1.6)), mul(d, 2 * droop * t)));
      const N = norm(add(mul(L.out, 0.78), mul(fn, 0.5 * sgn)));
      const tint = 1 + 0.06 * x * sgn;
      b.vert(p[0], p[1], p[2], N[0], N[1], N[2], lerp(U.u0, U.u1, cols === 2 ? k : (k / 2)), v, c0[0] * tint, c0[1], c0[2] / tint, type * 4096 + L.seed + t * amp);
    }
  }
  const gi = b.grp(W.leaf, 'paint').idx;
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) { const a = base + r * cols + k, bb = a + 1, c2 = a + cols, dd = c2 + 1; gi.push(a, bb, dd, a, dd, c2); }
}


// ---------------------------------------------------------------- palm skeleton: ringed trunk, crownshaft, arched fronds with real leaflets
function along(pts, t) {   // point and tangent at arc fraction t of a polyline
  let L = 0; const ls = [];
  for (let i = 0; i < pts.length - 1; i++) { const l = vlen(sub(pts[i + 1], pts[i])); ls.push(l); L += l; }
  let d = clamp(t, 0, 1) * L;
  for (let i = 0; i < ls.length; i++) { if (d <= ls[i] || i === ls.length - 1) { const f = ls[i] ? clamp(d / ls[i], 0, 1) : 0; return [lerp3(pts[i], pts[i + 1], f), norm(sub(pts[i + 1], pts[i]))]; } d -= ls[i]; }
}
function growPalm(sp, rn, hN, cN) {
  const r0 = sp.trunk, lean = (rn() - 0.5) * 0.5, az0 = rn() * 6.283, nS = 12, step = hN / nS;
  const pts = [[0, -0.12, 0], [0, 0, 0]], rad = [r0 * 1.55, r0 * 1.12];
  let P = [0, 0, 0];
  for (let i = 0; i < nS; i++) { P = mad(P, dir(lean * (0.3 + 0.9 * i / nS), az0), step); pts.push(P); rad.push(r0 * (1 - i * 0.018) * (i % 2 ? 1.07 : 0.93)); }
  const limbs = [{ pts, rad, ord: 0 }, { pts: [mad(P, [0, 1, 0], -0.5), mad(P, [0, 1, 0], 0.18)], rad: [r0 * 0.95, r0 * 1.35], ord: 0 }];
  const nF = 15, Lf = cN * 2.0, fronds = [], leaves = [];
  const cen = [P[0], P[1] - 0.2, P[2]], Rr = cN * 2.2;
  for (let i = 0; i < nF; i++) {
    const az = (i / nF) * 6.283 + (rn() - 0.5) * 0.3, Lfi = Lf * (0.9 + rn() * 0.2);
    let ph = 0.5 + rn() * 0.4, q = mad(P, [0, 1, 0], 0.1); const fp = [q];
    for (let s = 0; s < 6; s++) { q = mad(q, dir(ph, az), Lfi / 6); fp.push(q); ph += 0.2 + rn() * 0.12; }
    fronds.push({ pts: fp, az, L: Lfi });
    limbs.push({ pts: fp.map((p) => p.slice()), rad: [0.034, 0.03, 0.026, 0.021, 0.016, 0.011, 0.006], ord: 1, frond: true });
    for (let t = 0.13; t < 1; t += 0.034) {
      const [p, tg] = along(fp, t), side = norm(cross(tg, [0, 1, 0])), ln = (Lfi * 0.23 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.1) * (0.9 + rn() * 0.2);
      for (const sg of [-1, 1]) {
        const d = norm([side[0] * sg * 0.8 + tg[0] * 0.5, side[1] * sg * 0.8 + tg[1] * 0.5 - 0.5, side[2] * sg * 0.8 + tg[2] * 0.5]), k = (0.7 + rn() * 0.5) * (0.75 + 0.25 * t);
        leaves.push({ p: mad(p, tg, rn() * 0.03), d, roll: (rn() - 0.5) * 0.5, len: ln, ws: 2.3, c: [k, k, k], out: norm(sub(p, cen)), seed: (rn() * 4096) | 0, rows: 3, cols: 2 });
      }
    }
  }
  return { limbs, leaves, flowers: [], fronds, cen, R: Rr, cy: P[1], ry: Rr * 0.4, rx: Rr, crown: P, S: SPEC.palm };
}
SPEC.palm = { leaf: 'palm', rows: 3, fold: 0, droop: 0.22, a0: 0.6, fruit: 'coconut' };

// ---------------------------------------------------------------- whole tree: skeleton -> leaves -> fruit
function normalise(T, S, hN, cN) {
  let maxY = 0; const rs = [];
  for (const l of T.limbs) if (l.ord >= S.leafOrd) for (const p of l.pts) { maxY = Math.max(maxY, p[1]); rs.push(Math.hypot(p[0], p[2])); }
  rs.sort((a, b) => a - b);
  const r90 = rs[Math.floor(rs.length * 0.9)] || 1, kx = clamp(cN * S.crownK / r90, 0.4, 1.8), ky = clamp(hN * 0.97 / Math.max(maxY, 0.5), 0.5, 1.8);
  for (const l of T.limbs) for (const p of l.pts) { p[0] *= kx; p[2] *= kx; if (p[1] > 0) p[1] *= ky; }
  for (const l of T.limbs) for (let i = 0; i < l.rad.length; i++) if (l.ord >= 1) l.rad[i] = Math.max(0.004, l.rad[i]);
}
function extents(T, S, cN) {
  let y0 = 1e9, y1 = -1e9; const rs = [];
  for (const l of T.limbs) if (l.ord >= S.leafOrd && !l.root) for (const p of l.pts) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); rs.push(Math.hypot(p[0], p[2])); }
  rs.sort((a, b) => a - b);
  const r90 = rs[Math.floor(rs.length * 0.9)] || 1;
  T.cy = (y0 + y1) / 2; T.ry = Math.max(0.4, (y1 - y0) / 2 * 1.08); T.rx = Math.max(0.4, r90 * 1.22); T.cen = [0, T.cy, 0]; T.R = Math.max(T.rx, T.ry);
}
function addRoots(T, S, sp, rn, cN) {
  const r0 = sp.trunk, nb = r0 > 0.4 ? 7 : r0 > 0.18 ? 4 : 0;
  for (let i = 0; i < nb; i++) { const a = (i / nb) * 6.28 + rn() * 0.5; T.limbs.push({ pts: [[Math.cos(a) * r0 * 0.4, 0.7, -Math.sin(a) * r0 * 0.4], [Math.cos(a) * r0 * 3.2, -0.07, -Math.sin(a) * r0 * 3.2]], rad: [r0 * 0.5, r0 * 0.14], ord: 3, root: true }); }
  if (S.roots) {   // banyan: hanging aerial prop-roots from the horizontal limbs, thicker towards the ground
    const hor = T.limbs.filter((l) => l.ord === 1 || l.ord === 2), nr = S.roots[0] + Math.floor(rn() * (S.roots[1] - S.roots[0] + 1));
    for (let i = 0; i < nr; i++) {
      const l = hor[(rn() * hor.length) | 0], f = 0.35 + rn() * 0.6, k = Math.min(l.pts.length - 2, Math.floor(f * (l.pts.length - 1))), q = lerp3(l.pts[k], l.pts[k + 1], f * (l.pts.length - 1) - k);
      if (Math.hypot(q[0], q[2]) < cN * 0.3 || q[1] < 1.5) continue;
      const mid = [q[0] + (rn() - 0.5) * 0.25, q[1] * 0.5, q[2] + (rn() - 0.5) * 0.25];
      T.limbs.push({ pts: [q, mid, [mid[0] + (rn() - 0.5) * 0.15, -0.06, mid[2] + (rn() - 0.5) * 0.15]], rad: [0.03, 0.05, 0.07 + rn() * 0.05], ord: 2, root: true });
    }
  }
}
function fruitPlan(T, S, rn, sp) {
  const kind = S.fruit; T.fruit = null; T.decor = []; T.fallen = [];
  const eF = (p) => Math.sqrt((p[0] / T.rx) ** 2 + ((p[1] - T.cy) / T.ry) ** 2 + (p[2] / T.rx) ** 2);
  const shuf = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (rn() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const hang = () => norm([(rn() - 0.5) * 0.3, -1, (rn() - 0.5) * 0.3]);
  if (kind === 'coconut') {
    const cnt = FRUIT_COUNT.coconut, a0 = rn() * 6.283, P = T.crown; T.fruit = [];
    for (let g = 0; g < cnt.length; g++) {
      const list = [], az = a0 + (g / cnt.length) * 6.283 + (rn() - 0.5) * 0.4;
      for (let k = 0; k < cnt[g]; k++) { const a = az + (rn() - 0.5) * 0.5, r = sp.trunk * 1.5 + 0.12 + 0.05 * rn(), y = -0.78 + 0.28 * rn(), ax = norm([Math.cos(a) * 0.12 + (rn() - 0.5) * 0.12, -1, Math.sin(a) * 0.12 + (rn() - 0.5) * 0.12]), q = [P[0] + Math.cos(a) * r, P[1] + y, P[2] + Math.sin(a) * r]; list.push({ kind, P: q, ax, sc: 1, seed: (rn() * 1e6) | 0, ripe: rn() < 0.4 ? 1 : 0, ctr: mad(q, ax, FRUIT_DEF.coconut.L * 0.5) }); }
      T.fruit.push(list);
    }
    return;
  }
  const tipTop = T.cy + T.ry;
  const sites = (eLo, eHi, yLo, yHi, ordLo) => {
    const out = [];
    for (const l of T.limbs) {
      if (l.ord < ordLo || l.ord > 4 || l.root) continue;
      for (let i = 0; i < l.pts.length - 1; i++) for (let k = 0; k < 2; k++) { const p = lerp3(l.pts[i], l.pts[i + 1], rn()), e0 = eF(p); if (e0 >= eLo && e0 <= eHi && p[1] >= yLo && p[1] <= yHi) out.push(p); }
    }
    return shuf(out);
  };
  if (kind === 'apple' || kind === 'mango') {
    const cnt = FRUIT_COUNT[kind], N = cnt.reduce((a, b) => a + b, 0), stemL = kind === 'apple' ? 0.045 : 0.09, def = FRUIT_DEF[kind];
    const cand = kind === 'apple' ? sites(0.42, 1.0, T.cy - T.ry * 0.6, tipTop, 2) : sites(0.55, 1.05, T.cy - T.ry * 0.9, T.cy + T.ry * 0.25, 3);
    T.fruit = []; let ci = 0;
    for (let g = 0; g < cnt.length; g++) {
      const list = [];
      for (let k = 0; k < cnt[g] && ci < cand.length; k++) { const site = cand[ci++], ax = hang(), P = mad(site, ax, stemL), sc = 0.9 + rn() * 0.3; list.push({ kind, P, ax, sc, seed: (rn() * 1e6) | 0, ctr: mad(P, ax, def.L ? def.L * 0.5 : def.R) }); }
      T.fruit.push(list);
    }
    const nf = kind === 'apple' ? 7 : 4;   // fallen fruit on the ground below the crown (static)
    for (let i = 0; i < nf; i++) { const a = rn() * 6.283, r = Math.sqrt(rn()) * T.rx * 0.75, R = def.R, ang = rn() * 6.283; T.fallen.push({ kind, lying: true, P: [Math.cos(a) * r, R * 0.95, Math.sin(a) * r], ax: norm([Math.cos(ang), -0.12 - rn() * 0.25, Math.sin(ang)]), sc: 0.9 + rn() * 0.2, seed: (rn() * 1e6) | 0 }); }
    return;
  }
  if (kind === 'nimboli') {   // drupes in drooping panicles at the ends of the outer twigs
    for (const site of sites(0.55, 1.0, T.cy - T.ry * 0.5, tipTop, 3).slice(0, 18)) for (let i = 0, n = 4 + ((rn() * 3) | 0); i < n; i++) T.decor.push({ kind, P: [site[0] + (rn() - 0.5) * 0.1, site[1] - 0.05 - rn() * 0.13, site[2] + (rn() - 0.5) * 0.1], ax: hang(), sc: 1, seed: (rn() * 1e6) | 0 });
    return;
  }
  if (kind === 'fig') {   // figs in pairs along the twigs
    for (const site of sites(0.45, 1.0, 1.2, tipTop, 3).slice(0, 70)) for (let i = 0; i < 2; i++) T.decor.push({ kind, P: [site[0] + (rn() - 0.5) * 0.05, site[1] - 0.02, site[2] + (rn() - 0.5) * 0.05], ax: hang(), sc: 1, seed: (rn() * 1e6) | 0 });
  }
}

export function genTree(name, sp, hN, cN, seed) {
  const rn = mulberry32(seed), S = SPEC[name] || SPEC.neem; let T;
  if (name === 'palm') { T = growPalm(sp, rn, hN, cN); T.name = name; T.S = S; fruitPlan(T, S, rn, sp); return T; }
  if (name === 'ashoka') { T = growMast(S, rn, hN, cN, sp.trunk); extents(T, S, cN); T.rx = Math.max(T.rx, cN * 1.1); }
  else { T = growBroad(S, rn, hN, cN, sp.trunk); normalise(T, S, hN, cN); extents(T, S, cN); }
  T.name = name; T.S = S;
  addRoots(T, S, sp, rn, cN);
  const f = foliage(S, T, rn, name); T.leaves = f.leaves; T.flowers = f.flowers;
  fruitPlan(T, S, rn, sp);
  T.e = (p) => Math.sqrt((p[0] / T.rx) ** 2 + ((p[1] - T.cy) / T.ry) ** 2 + (p[2] / T.rx) ** 2);
  return T;
}
export const fruitPositions = (T) => (T.fruit ? T.fruit.map((g) => g.map((f) => f.ctr)) : null);

// ---------------------------------------------------------------- emitting a whole tree
function thorn(b, W, p, d, len, r, k) {
  const e1 = perp(d), e2 = cross(d, e1), base = b.nv;
  for (let i = 0; i < 3; i++) { const th = i / 3 * 6.2832, o = add(mul(e1, Math.cos(th)), mul(e2, Math.sin(th))); b.vert(p[0] + o[0] * r, p[1] + o[1] * r, p[2] + o[2] * r, o[0], o[1], o[2], 0, 0, k, k * 0.95, k * 0.85, 0); }
  const t = mad(p, d, len); b.vert(t[0], t[1], t[2], d[0], d[1], d[2], 0, 0, k, k * 0.95, k * 0.85, 0);
  const gi = b.grp(W.trunk, 'paint').idx; gi.push(base, base + 1, base + 3, base + 1, base + 2, base + 3, base + 2, base, base + 3);
}
export function emitDetail(b, W, T, lc, rnSeed) {
  const rn = mulberry32(rnSeed), c = { b, W, rn, bk: 0.82 + rn() * 0.34, lc }, S = T.S;
  emitWood(c, T, 4);
  for (const L of T.leaves) emitLeaf(c, L, S.leaf, S, 0);
  if (T.name !== 'palm') clusterCards(c, T, 1.1, 0.62, 0.8);   // a few dark leaf clumps deep inside the crown: the single leaves sit in front of them, so the tree is never hollow
  const fs = { rows: 2, fold: 0, droop: 0 };
  for (const f of T.flowers) emitLeaf(c, f, f.name, fs, 2);
  if (T.fruit) T.fruit.forEach((g, i) => { for (const f of g) emitFruit(c, W.nuts[i], f); });
  for (const f of T.decor) emitFruit(c, W.fruitS, f);
  for (const f of T.fallen) emitFruit(c, W.fruitS, f);
  if (S.thorns) {   // babool: pairs of long pale spines at the nodes
    for (const l of T.limbs) {
      if (l.ord < 3 || l.root) continue;
      for (let i = 1; i < l.pts.length; i++) if (rn() < 0.6) { const p = l.pts[i], t = norm(sub(l.pts[i], l.pts[i - 1])), o = perp(t); for (const sg of [-1, 1]) thorn(b, W, p, norm(add(mul(o, sg * 0.8), mul(t, 0.3))), 0.05 + rn() * 0.03, 0.004, 2.3); }
    }
  }
}

function clusters(T, cs) {
  const m = new Map();
  for (const L of T.leaves) { const k = Math.floor(L.p[0] / cs) + ':' + Math.floor(L.p[1] / cs) + ':' + Math.floor(L.p[2] / cs); let o = m.get(k); if (!o) { o = { n: 0, p: [0, 0, 0] }; m.set(k, o); } o.n++; o.p[0] += L.p[0]; o.p[1] += L.p[1]; o.p[2] += L.p[2]; }
  const all = [...m.values()]; if (!all.length) return [];
  const mean = all.reduce((a, o) => a + o.n, 0) / all.length;
  return all.filter((o) => o.n >= Math.max(2, mean * 0.3)).map((o) => ({ n: o.n, p: mul(o.p, 1 / o.n) }));
}
function cardQuad(c, T, o, right, up, w, h, cell, out, kv) {
  const { b, W, rn } = c, S = T.S, uv = cellUV(cell), base = b.nv, seed = (rn() * 4096) | 0, fwd = cross(right, up), sgn = dot(fwd, out) >= 0 ? 1 : -1;
  for (const [sx, sy, u, v] of [[-1, -1, uv[0], uv[3]], [1, -1, uv[1], uv[3]], [1, 1, uv[1], uv[2]], [-1, 1, uv[0], uv[2]]]) {
    const p = add(add(o, mul(right, sx * w / 2)), mul(up, sy * h / 2)), e0 = T.e(p), hg = clamp(((p[1] - T.cy) / T.ry + 1) * 0.5, 0, 1);
    const ao = (S.a0 + (1 - S.a0) * Math.pow(Math.min(e0, 1.1), 0.9)) * (0.8 + 0.2 * hg) * kv, N = norm(add(mul(out, 0.8), mul(fwd, 0.3 * sgn)));
    b.vert(p[0], p[1], p[2], N[0], N[1], N[2], u, v, c.lc[0] * ao, c.lc[1] * ao, c.lc[2] * ao, seed + (sy > 0 ? 0.35 : 0.08));
  }
  b.grp(W.leaf, 'paint').idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
// leaf-clump cards over the crown: pick(e, rn) decides per cluster whether it gets cards, kk scales the brightness, wk the size
function clusterCards(c, T, wk, kk, pickE) {
  const { W, rn } = c, S = T.S;
  const cs = (S.cs || clamp(T.rx * 0.3, 0.3, 2.0)) * (wk || 1), cells = { apple: 'apple', mango: 'mango', neem: 'neem', banyan: 'banyan', gulmohar: 'gul', babool: 'babool', ashoka: 'ashoka', shrub: 'shrub' }, cell = cells[T.name] || 'broad';
  for (const cl of clusters(T, cs)) {
    if (pickE && (T.e(cl.p) > pickE || rn() < 0.3)) continue;
    const out = norm([cl.p[0], (cl.p[1] - T.cy) * 0.5, cl.p[2]]), W0 = cs * 2.15 * (0.9 + rn() * 0.25), kv = (0.9 + rn() * 0.2) * kk;
    const hz = norm([out[0], 0, out[2]]), right = norm(cross([0, 1, 0], Math.hypot(hz[0], hz[2]) > 0.2 ? hz : [0, 0, 1]));
    const cellA = T.name === 'gulmohar' && cl.p[1] > T.cy && rn() < 0.5 && !pickE ? 'flower' : cell;
    if (T.name === 'ashoka') {   // hanging boughs: two vertical cards crossed
      const a = rn() * 3.1416, r1 = [Math.cos(a), 0, Math.sin(a)], r2 = [-Math.sin(a), 0, Math.cos(a)];
      cardQuad(c, T, cl.p, r1, [0, 1, 0], W0, W0, cell, hz, kv); cardQuad(c, T, cl.p, r2, [0, 1, 0], W0, W0, cell, hz, kv);
    } else {
      cardQuad(c, T, cl.p, right, [0, 1, 0], W0, W0, cellA, out, kv);                                  // faces outward
      const az = rn() * 6.283; cardQuad(c, T, cl.p, [Math.cos(az), 0, Math.sin(az)], [-Math.sin(az), 0, Math.cos(az)], W0 * 0.95, W0 * 0.95, cell, [0, 1, 0], kv * 0.97);   // lies flat: seen from above
    }
  }
}
export function emitCards(b, W, T, lc, rnSeed) {
  const rn = mulberry32(rnSeed), c = { b, W, rn, bk: 0.82 + rn() * 0.34, lc }, S = T.S;
  emitWood(c, T, T.name === 'palm' || T.name === 'ashoka' ? 1 : 2);
  if (T.name === 'palm') {   // 15 arched fronds, each a strip of hinged quads carrying the stamped frond picture
    const uv = cellUV('palm');
    for (const fr of T.fronds) {
      const n = fr.pts.length, rv = [Math.sin(fr.az), 0, Math.cos(fr.az)], wf = fr.L * 0.74, base = b.nv;
      fr.pts.forEach((pt, k) => {
        const nx = fr.pts[Math.min(k + 1, n - 1)], pv = fr.pts[Math.max(k - 1, 0)], tg = norm(sub(nx, pv));
        let nn = cross(rv, tg); if (nn[1] < 0) nn = mul(nn, -1);
        const f = k / (n - 1), sag = wf * 0.09 * (k ? 1 : 0.5), ao = 0.6 + 0.4 * f, vv = uv[3] - (uv[3] - uv[2]) * f, seed = (rn() * 4096) | 0;
        for (const sx of [-1, 1]) b.vert(pt[0] + rv[0] * sx * wf / 2, pt[1] + rv[1] * sx * wf / 2 - sag, pt[2] + rv[2] * sx * wf / 2, nn[0], nn[1], nn[2], sx < 0 ? uv[0] : uv[1], vv, lc[0] * ao, lc[1] * ao, lc[2] * ao, 4096 * 1 + seed + f * 0.9);
      });
      const gi = b.grp(W.leaf, 'paint').idx;
      for (let s = 0; s < n - 1; s++) { const a = base + s * 2; gi.push(a, a + 1, a + 3, a, a + 3, a + 2); }
    }
  } else {
    clusterCards(c, T, 1, 1, 0);
  }
  if (T.fruit) T.fruit.forEach((g, i) => { for (const f of g) emitFruit(c, W.nuts[i], f, true); });
  for (const f of T.fallen) emitFruit(c, W.fruitS, f, true);
}
export { SPEC, FT, clusters };
