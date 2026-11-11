// TREES AND SHRUBS: real alpha-cut leaf cards on skeletal wood (root flare, curved trunk, limbs that join, branchlets), never spheres or solid cones.
// The leaf cards are drawn from one procedural 512x512 foliage atlas (2x2 cells): broadleaf twig spray, conifer bough, palm frond, garden shrub.
// Every tree is built twice: a full near model (used inside ~150 m, casts leaf-shaped shadows) and a cheap far model (a few big crossed cards).
import { mulberry32 } from '../../core/math.js';

const AT = 512, CL = 256;
const rgb = (r, g, b, k = 1) => `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;

// ---------------------------------------------------------------- foliage atlas
function leaf(g, x, y, ang, len, wid, k, veins = true) {
  g.save(); g.translate(x, y); g.rotate(ang);
  const gr = g.createLinearGradient(0, 0, 0, -len);
  gr.addColorStop(0, rgb(50, 104, 33, k)); gr.addColorStop(0.55, rgb(86, 162, 50, k)); gr.addColorStop(1, rgb(144, 200, 72, k));
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, 0);
  g.bezierCurveTo(wid, -len * 0.2, wid * 0.8, -len * 0.72, 0, -len);
  g.bezierCurveTo(-wid * 0.8, -len * 0.72, -wid, -len * 0.2, 0, 0);
  g.fill();
  g.strokeStyle = rgb(38, 82, 26, k); g.lineWidth = 0.8; g.stroke();
  g.strokeStyle = rgb(158, 204, 100, k); g.lineWidth = Math.max(0.8, len * 0.028);
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.93); g.stroke();
  if (veins) {
    g.lineWidth = 0.6; g.strokeStyle = rgb(120, 178, 76, k);
    g.beginPath();
    for (let i = 1; i <= 3; i++) { const yy = -len * 0.2 * i - len * 0.04; g.moveTo(0, yy); g.lineTo(wid * 0.58, yy - len * 0.15); g.moveTo(0, yy); g.lineTo(-wid * 0.58, yy - len * 0.15); }
    g.stroke();
  }
  g.restore();
}

function drawBroadleaf(g, rn) {   // central twig with ~38 pointed leaves, side twigs, sunlit tips
  const stem = (t) => [128 + 12 * Math.sin(t * 2.3), 250 - 190 * t];
  g.lineCap = 'round'; g.strokeStyle = rgb(88, 64, 38);
  for (let i = 0; i < 24; i++) { const a = stem(i / 24), b = stem((i + 1) / 24); g.lineWidth = 3.6 - 2.2 * (i / 24); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  const L = [];
  const n = 17;
  for (let i = 0; i < n; i++) {
    const t = 0.08 + 0.86 * i / (n - 1), p = stem(t), p2 = stem(t + 0.01), sa = Math.atan2(p2[0] - p[0], -(p2[1] - p[1]));
    const len = 74 * (1 - 0.46 * t) + rn() * 8;
    for (const s of [-1, 1]) L.push([p[0], p[1], sa + s * (0.7 + rn() * 0.38), len * (0.88 + rn() * 0.24), len * 0.36, 0.82 + rn() * 0.34]);
  }
  // two lateral twigs with three leaves each
  for (const [t, s] of [[0.3, -1], [0.55, 1]]) {
    const p = stem(t), ang = s * 0.95; let x = p[0], y = p[1];
    g.strokeStyle = rgb(88, 64, 38); g.lineWidth = 1.6; g.beginPath(); g.moveTo(x, y);
    const ex = x + Math.sin(ang) * 58, ey = y - Math.cos(ang) * 58; g.lineTo(ex, ey); g.stroke();
    for (let j = 0; j < 3; j++) { const f = 0.4 + j * 0.3; L.push([x + (ex - x) * f, y + (ey - y) * f, ang + (j % 2 ? 0.7 : -0.7) * (rn() > 0.5 ? 1 : -1), 40 - j * 5, 15, 0.85 + rn() * 0.3]); }
    L.push([ex, ey, ang * 0.7, 40, 15, 1.1]);
  }
  L.push([stem(1)[0], stem(1)[1], 0.12, 56, 21, 1.15]);
  for (const l of L) leaf(g, l[0], l[1], l[2], l[3], l[4], l[5]);
}

function drawConifer(g, rn) {   // feathered bough: woody stem, alternate side branchlets, hundreds of fine needles
  const N = 22;
  g.lineCap = 'round';
  const lateral = (x0, y0, ang, Ln, s) => {
    const steps = Math.max(4, (Ln / 5) | 0), pts = []; let x = x0, y = y0, a = ang;
    g.strokeStyle = rgb(84, 60, 38); g.lineWidth = 2; g.beginPath(); g.moveTo(x, y);
    for (let i = 1; i <= steps; i++) { a -= s * 0.03; x += Math.sin(a) * Ln / steps; y -= Math.cos(a) * Ln / steps; g.lineTo(x, y); pts.push([x, y, a, i / steps]); }
    g.stroke();
    for (const [px, py, pa, f] of pts) {
      const nl = 17 * (1 - 0.5 * f) + 3;
      for (const sd of [-1, 1]) {
        const na = pa + sd * (0.78 + rn() * 0.26), k = (0.78 + rn() * 0.5) * (0.88 + 0.3 * f);
        g.strokeStyle = rgb(46, 102, 58, k); g.lineWidth = 2.3 - 0.9 * f;
        g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(na) * nl, py - Math.cos(na) * nl); g.stroke();
      }
    }
  };
  g.strokeStyle = rgb(80, 58, 36); g.lineWidth = 3.4; g.beginPath(); g.moveTo(128, 252); g.lineTo(128, 16); g.stroke();
  for (let i = 0; i < N; i++) {
    const f = i / (N - 1), y = 246 - 222 * f, Ln = 116 * Math.pow(1 - f, 0.72) * Math.min(1, 0.45 + f * 5) + 10;
    for (const s of [-1, 1]) lateral(128, y - (s > 0 ? 0 : 5), s * (1.12 + rn() * 0.14), Ln * (0.9 + rn() * 0.2), s);
  }
  for (let j = 0; j < 7; j++) { const a = -0.8 + j * 0.27; g.strokeStyle = rgb(60, 118, 66, 0.9 + rn() * 0.3); g.lineWidth = 2.2; g.beginPath(); g.moveTo(128, 30); g.lineTo(128 + Math.sin(a) * 22, 30 - Math.cos(a) * 22); g.stroke(); }
}

function drawPalm(g, rn) {   // arched pinnate frond: rachis + 52 leaflets
  const P0 = [128, 252], P1 = [112, 120], P2 = [148, 22];
  const B = (t) => [(1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
  const Tg = (t) => Math.atan2(2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), -(2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1])));
  const n = 26;
  for (let i = 0; i < n; i++) {
    const t = 0.05 + 0.93 * i / (n - 1), p = B(t), ta = Tg(t), len = 22 + 86 * Math.sin(Math.PI * Math.pow(t, 0.75));
    for (const sd of [-1, 1]) leaf(g, p[0], p[1], ta + sd * (0.95 - 0.35 * t + (rn() - 0.5) * 0.18), len * (0.92 + 0.16 * rn()), len * 0.085 + 1.2, 0.78 + 0.42 * rn(), false);
  }
  g.lineCap = 'round'; g.strokeStyle = rgb(112, 124, 62);
  for (let i = 0; i < 20; i++) { const a = B(i / 20), b = B((i + 1) / 20); g.lineWidth = 4.2 - 2.6 * (i / 20); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
}

function drawShrub(g, rn) {   // dense small-leaf garden bush: solid dark core, three leaf layers pointing outward, a few pale blossoms
  g.fillStyle = rgb(40, 86, 28); g.beginPath(); g.ellipse(128, 128, 84, 82, 0, 0, 6.283); g.fill();
  const layers = [[130, 0.6, 92, 24], [140, 0.86, 96, 26], [120, 1.12, 98, 28]];
  for (const [cnt, k, R, len] of layers) for (let i = 0; i < cnt; i++) {
    const a = rn() * 6.283, rr = Math.sqrt(rn()) * R, x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr;
    const l = len * (0.8 + rn() * 0.4);
    leaf(g, x, y, a + Math.PI / 2 + (rn() - 0.5) * 1.3, l, l * 0.44, k * (0.85 + rn() * 0.3));
  }
  for (let i = 0; i < 16; i++) {
    const a = rn() * 6.283, rr = 70 + rn() * 40, x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr;
    g.fillStyle = rgb(238, 228, 150); g.beginPath(); g.arc(x, y, 3.4, 0, 6.283); g.fill();
    g.fillStyle = rgb(250, 246, 200); g.beginPath(); g.arc(x - 0.8, y - 0.8, 1.4, 0, 6.283); g.fill();
  }
}

export function makeFoliageTex(r) {
  const cv = document.createElement('canvas'); cv.width = cv.height = AT;
  const g = cv.getContext('2d');
  const cells = [[0, 0, drawBroadleaf], [1, 0, drawConifer], [0, 1, drawPalm], [1, 1, drawShrub]];
  cells.forEach(([cu, cv2, fn], i) => {
    g.save(); g.beginPath(); g.rect(cu * CL, cv2 * CL, CL, CL); g.clip(); g.translate(cu * CL, cv2 * CL);
    fn(g, mulberry32(7001 + i * 131));
    g.restore();
  });
  // transparent texels carry leaf colour too (no dark fringe when filtered / mip-mapped)
  const id = g.getImageData(0, 0, AT, AT), d = id.data, fill = [[88, 164, 52], [70, 128, 64], [100, 150, 50], [78, 150, 46]];
  for (let y = 0; y < AT; y++) for (let x = 0; x < AT; x++) {
    const i = (y * AT + x) * 4;
    if (d[i + 3] < 6) { const c = fill[(x >= CL ? 1 : 0) + (y >= CL ? 2 : 0)]; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 0; }
  }
  return r.makeTex(AT, AT, new Uint8Array(d.buffer));
}

// ---------------------------------------------------------------- geometry helpers
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dir = (pitch, az) => [Math.sin(pitch) * Math.cos(az), Math.cos(pitch), -Math.sin(pitch) * Math.sin(az)];   // pitch measured from straight up
const mad = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// tapered wood: a closed ring of `sides` at each end, so a branch really starts inside its parent and nothing floats
function tube(c, p0, p1, r0, r1, sides) {
  const { b, W, bk } = c;
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], L = Math.hypot(d[0], d[1], d[2]);
  if (L < 1e-4) return;
  const u = [d[0] / L, d[1] / L, d[2] / L], e1 = norm(cross(u, Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(u, e1), base = b.nv;
  for (let ring = 0; ring < 2; ring++) {
    const p = ring ? p1 : p0, r = ring ? r1 : r0;
    for (let k = 0; k <= sides; k++) {
      const th = (k / sides) * 6.2832, cs = Math.cos(th), sn = Math.sin(th), nx = e1[0] * cs + e2[0] * sn, ny = e1[1] * cs + e2[1] * sn, nz = e1[2] * cs + e2[2] * sn;
      b.vert(p[0] + nx * r, p[1] + ny * r, p[2] + nz * r, nx, ny, nz, k / sides, ring, bk, bk, bk);
    }
  }
  const gi = b.grp(W.trunk, 'paint').idx;
  for (let k = 0; k < sides; k++) { const a0 = base + k, a1 = a0 + 1, b0 = base + sides + 1 + k, b1 = b0 + 1; gi.push(a0, a1, b0, a1, b1, b0); }
}

// one leaf card: o = bottom centre, up = its long axis, w x h metres, cell = atlas cell. Vertex normals point away from the crown centre (soft volumetric light, no flat
// plates) and vertex colour darkens towards the middle of the canopy and the underside (ambient occlusion), so outer tips are bright and the inside is shaded.
function card(c, o, up, w, h, cell, roll, rightIn) {
  const { b, W, rn, cen, R, lc } = c;
  let e1;
  if (rightIn) { const k = dot(rightIn, up); e1 = norm([rightIn[0] - up[0] * k, rightIn[1] - up[1] * k, rightIn[2] - up[2] * k]); }
  else e1 = norm(cross(up, Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const e2 = cross(up, e1), cs = Math.cos(roll), sn = Math.sin(roll);
  const right = [e1[0] * cs + e2[0] * sn, e1[1] * cs + e2[1] * sn, e1[2] * cs + e2[2] * sn], fwd = cross(right, up);
  const sgn = dot(fwd, [o[0] - cen[0], o[1] - cen[1], o[2] - cen[2]]) >= 0 ? 1 : -1;
  const kv = 0.86 + rn() * 0.28, sh = (rn() - 0.5) * 0.08;
  const u0 = cell[0] * 0.5 + 0.006, u1 = cell[0] * 0.5 + 0.494, v0 = cell[1] * 0.5 + 0.006, v1 = cell[1] * 0.5 + 0.494;
  const base = b.nv;
  for (const [sx, sy, u, v] of [[-1, 0, u0, v1], [1, 0, u1, v1], [1, 1, u1, v0], [-1, 1, u0, v0]]) {
    const p = [o[0] + right[0] * sx * w / 2 + up[0] * sy * h, o[1] + right[1] * sx * w / 2 + up[1] * sy * h, o[2] + right[2] * sx * w / 2 + up[2] * sy * h];
    const dx = p[0] - cen[0], dy = p[1] - cen[1], dz = p[2] - cen[2], dd = Math.hypot(dx, dy, dz) || 1, r = Math.min(1, dd / R), hg = Math.min(1, Math.max(0, (dy / R + 1) * 0.5));
    const ao = (0.46 + 0.54 * Math.pow(r, 0.9)) * (0.8 + 0.2 * hg) * kv;
    const n = norm([dx / dd * 0.8 + fwd[0] * sgn * 0.3, dy / dd * 0.8 + fwd[1] * sgn * 0.3, dz / dd * 0.8 + fwd[2] * sgn * 0.3]);
    b.vert(p[0], p[1], p[2], n[0], n[1], n[2], u, v, lc[0] * ao * (1 + sh), lc[1] * ao, lc[2] * ao * (1 - sh));
  }
  b.grp(W.leaf, 'paint').idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// mulch / soil bed under a tree or shrub
function disc(c, x, z, r) {
  const { b, W, rn } = c, n = 9, base = b.nv, y = 0.0075;
  b.vert(x, y, z, 0, 1, 0, 3, 3, 1, 1, 1);
  for (let i = 0; i < n; i++) { const a = (i / n) * 6.2832, rr = r * (0.88 + 0.24 * rn()); b.vert(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, 0, 1, 0, 3, 3, 1, 1, 1); }
  const gi = b.grp(W.mulch, 'paint').idx;
  for (let i = 0; i < n; i++) gi.push(base, base + 1 + ((i + 1) % n), base + 1 + i);
}

// ---------------------------------------------------------------- species
function broad(c, sp, t, h, cr, lod) {
  const { rn } = c;
  const x0 = t.x, z0 = t.z, ht = h * 0.46, r0 = sp.trunk, sc = Math.max(0.75, Math.min(1.3, cr / 3));
  c.cen = [x0, ht + cr * 0.6, z0]; c.R = cr * 1.3 + 0.4;
  if (lod) {
    tube(c, [x0, -0.1, z0], [x0, ht * 1.05, z0], r0 * 1.25, r0 * 0.7, 4);
    const n = cr < 2.6 ? 5 : 7;
    for (let j = 0; j < n; j++) {
      const az = (j / n) * 6.2832 + rn() * 0.5, o = [x0 + Math.cos(az) * cr * 0.34, c.cen[1] - cr * 0.2 + (j % 2) * cr * 0.4, z0 - Math.sin(az) * cr * 0.34];
      const d = norm([Math.cos(az) * 0.6, 0.85, -Math.sin(az) * 0.6]), w = cr * (1.7 + rn() * 0.4);
      card(c, o, d, w, w * 0.95, [0, 0], rn() * 6.28);
    }
    card(c, [x0, ht + cr * 0.9, z0], [0, 1, 0], cr * 1.7, cr * 1.1, [0, 0], rn() * 6.28);
    return;
  }
  // root flare + three-segment curved trunk
  const p = [[x0, 0.5, z0]];
  for (const f of [0.38, 0.72, 1]) p.push([x0 + (rn() - 0.5) * ht * 0.14 * f, ht * f, z0 + (rn() - 0.5) * ht * 0.14 * f]);
  tube(c, [x0, -0.12, z0], p[0], r0 * 1.7, r0 * 1.04, 7);
  const rad = [1, 0.88, 0.74, 0.62];
  for (let i = 0; i < 3; i++) tube(c, p[i], p[i + 1], r0 * rad[i], r0 * rad[i + 1], 6);
  if (r0 > 0.18) for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + rn() * 0.8; tube(c, [x0 + Math.cos(a) * r0 * 0.4, 0.55, z0 - Math.sin(a) * r0 * 0.4], [x0 + Math.cos(a) * r0 * 3.1, -0.07, z0 - Math.sin(a) * r0 * 3.1], r0 * 0.5, r0 * 0.14, 4); }
  // primary limbs (level 1), each with secondary branches (level 2); every one starts inside its parent
  const nl = cr < 2.4 ? 4 : cr < 3.6 ? 5 : 6, a0 = rn() * 6.28, ends = [];
  for (let i = 0; i < nl; i++) {
    const A = lerp3(p[2], p[3], Math.min(1, (i / (nl - 1)) * 0.95 + rn() * 0.05));
    const az = a0 + (i / nl) * 6.283 + (rn() - 0.5) * 0.55, th = 0.62 + rn() * 0.42 + (cr > 3.5 ? 0.18 : 0), Ll = cr * (0.5 + rn() * 0.16);
    const B = mad(A, dir(th, az), Ll * 0.5), C = mad(B, dir(th * 0.6, az + (rn() - 0.5) * 0.4), Ll * 0.5), rl = r0 * 0.42;
    tube(c, A, B, rl, rl * 0.72, 5); tube(c, B, C, rl * 0.72, rl * 0.46, 5);
    const s1 = mad(B, dir(th * 0.72, az + 0.9 + rn() * 0.4), Ll * 0.55), s2 = mad(C, dir(th * 0.7, az - 0.9 - rn() * 0.4), Ll * 0.5);
    tube(c, B, s1, rl * 0.48, rl * 0.2, 4); tube(c, C, s2, rl * 0.42, rl * 0.18, 4);
    ends.push([C, dir(th * 0.5, az)], [s1, dir(th * 0.8, az + 1)], [s2, dir(th * 0.8, az - 1)]);
  }
  const top = mad(p[3], [0, 1, 0], cr * 0.55 * (0.9 + 0.2 * rn()));
  tube(c, p[3], top, r0 * 0.5, r0 * 0.15, 5); ends.push([top, [0, 1, 0]]);
  // 4-5 crossed leaf sprays round the end of every branch
  const nc = cr < 2.6 ? 4 : 5;
  for (const [tp, d] of ends) for (let j = 0; j < nc; j++) {
    const dd = norm([d[0] + (rn() - 0.5) * 1.5, d[1] * 0.7 + 0.25 + (rn() - 0.4) * 0.9, d[2] + (rn() - 0.5) * 1.5]), w = (1.4 + rn() * 0.9) * sc, hh = w * (0.95 + 0.15 * rn());
    card(c, mad([tp[0] + (rn() - 0.5) * 0.3, tp[1] + (rn() - 0.5) * 0.3, tp[2] + (rn() - 0.5) * 0.3], dd, -0.18 * hh), dd, w, hh, [0, 0], rn() * 6.283);
  }
  disc(c, x0, z0, r0 * 2.6 + 0.4);
}

function conifer(c, sp, t, h, cr, lod) {
  const { rn } = c;
  const x0 = t.x, z0 = t.z, r0 = sp.trunk, ty = h * 0.85;
  c.cen = [x0, h * 0.52, z0]; c.R = Math.max(cr * 1.2, h * 0.5);
  const flat = (d) => norm([-d[2], 0, d[0]]);   // horizontal width axis of a bough
  if (lod) {
    tube(c, [x0, -0.1, z0], [x0, ty, z0], r0 * 1.3, r0 * 0.35, 4);
    for (const f of [0.3, 0.5, 0.7, 0.88]) {
      const Lb = cr * 1.25 * (1 - (f - 0.22) / 0.78 * 0.9) + 0.2, a0 = rn() * 6.28;
      for (let j = 0; j < 3; j++) { const az = a0 + (j / 3) * 6.283, d = norm([Math.cos(az), -0.2, -Math.sin(az)]); card(c, [x0, h * f, z0], d, Lb * 1.5, Lb * 1.15, [1, 0], 0, flat(d)); }
    }
    return;
  }
  const p = [[x0, 0.5, z0], [x0 + (rn() - 0.5) * 0.12, ty * 0.38, z0 + (rn() - 0.5) * 0.12], [x0 + (rn() - 0.5) * 0.1, ty * 0.72, z0 + (rn() - 0.5) * 0.1], [x0, ty, z0]];
  tube(c, [x0, -0.12, z0], p[0], r0 * 1.55, r0 * 1.05, 6);
  const rad = [1, 0.8, 0.58, 0.3];
  for (let i = 0; i < 3; i++) tube(c, p[i], p[i + 1], r0 * rad[i], r0 * rad[i + 1], 5);
  tube(c, p[3], [x0, h * 0.99, z0], r0 * 0.3, r0 * 0.05, 3);
  if (r0 > 0.12) for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.28 + rn(); tube(c, [x0 + Math.cos(a) * r0 * 0.4, 0.5, z0 - Math.sin(a) * r0 * 0.4], [x0 + Math.cos(a) * r0 * 2.6, -0.06, z0 - Math.sin(a) * r0 * 2.6], r0 * 0.45, r0 * 0.14, 4); }
  const W = 8;
  for (let i = 0; i < W; i++) {
    const f = 0.22 + (i / (W - 1)) * 0.74, y = h * f, q = (f - 0.22) / 0.78, Lb = cr * 1.25 * (1 - q * 0.92) + 0.18, nb = i < 3 ? 5 : 4, a0 = i * 0.93 + rn() * 0.4;
    const trunkAt = lerp3(p[Math.min(2, Math.floor((y / ty) * 3))], p[Math.min(3, Math.floor((y / ty) * 3) + 1)], 0.5);
    const tx = x0 + (trunkAt[0] - x0) * 0.5, tz = z0 + (trunkAt[2] - z0) * 0.5;
    for (let j = 0; j < nb; j++) {
      const az = a0 + (j / nb) * 6.283 + (rn() - 0.5) * 0.4, droop = 1.5 + 0.25 * q + (rn() - 0.5) * 0.2;   // pitch from vertical: a little under horizontal low down, rising near the top
      const d = dir(droop, az), A = [tx, y, tz], E = mad(A, d, Lb);
      if (i < 5) tube(c, A, E, Math.max(0.014, r0 * 0.3 * (1 - q)), 0.01, 3);
      const o = mad(A, d, Lb * 0.16);
      card(c, o, d, Lb * 1.25, Lb * 0.92, [1, 0], 0, flat(d));
      card(c, mad(o, [0, 0.04, 0], 1), d, Lb * 0.9, Lb * 0.9, [1, 0], 1.25 + (rn() - 0.5) * 0.4, flat(d));
    }
  }
  disc(c, x0, z0, r0 * 2.4 + 0.35);
}

function palm(c, sp, t, h, cr, lod) {
  const { b, W, rn } = c;
  const x0 = t.x, z0 = t.z, lean = (rn() - 0.5) * 0.5, az0 = rn() * 6.283, nS = lod ? 2 : 5, sl = h / nS;
  let P = [x0, 0, z0];
  tube(c, [x0, -0.12, z0], [x0, 0.4, z0], sp.trunk * 1.5, sp.trunk * 1.08, 6);
  for (let i = 0; i < nS; i++) {
    const tl = lean * (0.35 + i * 0.3), Q = mad(P, dir(tl, az0), sl), rA = sp.trunk * (1 - i * 0.08), rB = sp.trunk * (1 - (i + 1) * 0.08);
    if (lod) tube(c, P, Q, rA, rB, 4);
    else for (let k = 0; k < 3; k++) {   // stacked rings: every third of a segment steps out a little, like leaf-scar ridges
      const a = lerp3(P, Q, k / 3), e = lerp3(P, Q, (k + 1) / 3), ra = rA + (rB - rA) * (k / 3), re = rA + (rB - rA) * ((k + 1) / 3);
      tube(c, a, e, ra * 0.94, re * 1.07, 5);
    }
    P = Q;
  }
  c.cen = [P[0], P[1] - 0.2, P[2]]; c.R = cr * 2.2;
  const n = lod ? 8 : 14, Lf = cr * 2.0, wf = Lf * 0.72, segs = lod ? 2 : 3;
  tube(c, mad(P, [0, 1, 0], -0.5), mad(P, [0, 1, 0], 0.18), sp.trunk * 0.95, sp.trunk * 1.35, 6);
  for (let i = 0; i < n; i++) {
    const az = (i / n) * 6.283 + (rn() - 0.5) * 0.4, rv = [Math.sin(az), 0, Math.cos(az)];
    let ph = 0.5 + rn() * 0.35, q = mad(P, [0, 1, 0], 0.1);
    const ring = [q];
    for (let s = 0; s < segs; s++) { q = mad(q, dir(ph, az), Lf / segs); ring.push(q); ph += 0.5 + rn() * 0.22; }
    const base = b.nv, v0 = 0.006, v1 = 0.994 * 0.5;
    ring.forEach((pt, k) => {
      const tg = norm([ring[Math.min(k + 1, segs)][0] - ring[Math.max(k - 1, 0)][0], ring[Math.min(k + 1, segs)][1] - ring[Math.max(k - 1, 0)][1], ring[Math.min(k + 1, segs)][2] - ring[Math.max(k - 1, 0)][2]]);
      let nn = cross(rv, tg); if (nn[1] < 0) nn = [-nn[0], -nn[1], -nn[2]];
      const f = k / segs, sag = wf * 0.09 * (k ? 1 : 0.5), vv = 0.5 + v1 - (v1 - v0) * f, ao = 0.6 + 0.4 * f, lc = c.lc;
      for (const sx of [-1, 1]) b.vert(pt[0] + rv[0] * sx * wf / 2, pt[1] + rv[1] * sx * wf / 2 - sag, pt[2] + rv[2] * sx * wf / 2, nn[0], nn[1], nn[2], sx < 0 ? 0.006 : 0.494, vv, lc[0] * ao, lc[1] * ao, lc[2] * ao);
    });
    const gi = b.grp(W.leaf, 'paint').idx;
    for (let s = 0; s < segs; s++) { const a = base + s * 2; gi.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
}

function shrub(c, sp, t, h, cr, lod) {
  const { rn } = c, x0 = t.x, z0 = t.z;
  c.cen = [x0, h * 0.5, z0]; c.R = cr * 1.3 + 0.2;
  const n = lod ? 4 : 9 + (rn() > 0.5 ? 2 : 0), size = Math.max(cr * 2.0, h * 0.95);
  for (let i = 0; i < n; i++) {
    const a = rn() * 6.283, ph = 0.25 + rn() * 0.8, d = cr * 0.25 * rn(), up = dir(ph, a), sz = size * (0.8 + rn() * 0.35);
    card(c, [x0 + Math.cos(a) * d, 0.02, z0 - Math.sin(a) * d], up, sz, sz * 0.92, [1, 1], rn() * 6.283);
  }
  if (!lod) disc(c, x0, z0, cr * 1.3);
}

// b: Builder (vertices already offset to the cell centre), W: { trunk, leaf, mulch } part ids, col: leaf colour multiplier, lod 0 = near, 1 = far
export function addTree(b, W, sp, t, h, cr, col, lod) {
  const rn = mulberry32(Math.floor((t.s * 7919 + t.s2 * 104729 + t.s3 * 1299709) * 1000) + 1);
  const c = { b, W, rn, bk: 0.82 + rn() * 0.34, lc: col, cen: [t.x, h * 0.5, t.z], R: 2 };
  if (sp.kind === 'palm') palm(c, sp, t, h, cr, lod);
  else if (sp.kind === 'conifer') conifer(c, sp, t, h, cr, lod);
  else if (sp.trunk < 0.06) shrub(c, sp, t, h, cr, lod);
  else broad(c, sp, t, h, cr, lod);
}
