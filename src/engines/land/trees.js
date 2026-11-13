// TREES AND SHRUBS: real alpha-cut leaf cards on skeletal wood, never spheres or solid cones.
//  - the foliage atlas (1024x512, 8 cells) is painted procedurally: dense broadleaf twig, conifer fan, palm frond, shrub, neem leaflets, gulmohar leaf, gulmohar blossom, babool
//  - every species has its own architecture (ARCH + banyan roots + babool pads + ashoka tiers + palm crown)
//  - each species is built ONCE as a prototype mesh (a few seeded variants); instances are just a matrix (see treefield.js)
//  - the same species are painted once more as a flat "picture" (impostor atlas) that stands in for the 3D tree beyond a few tens of metres
import { mulberry32 } from '../../core/math.js';

const AW = 1024, AH = 512, CL = 256;
export const CELL = { broad: [0, 0], conifer: [1, 0], palm: [2, 0], shrub: [3, 0], neem: [0, 1], gul: [1, 1], flower: [2, 1], babool: [3, 1] };
const rgb = (r, g, b, k = 1) => `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;

// ---------------------------------------------------------------- foliage atlas
function paintLeaf(g, x, y, ang, len, wid, k, veins = true) {
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
// serrated lanceolate leaflet (neem): saw-tooth edge, olive gradient
function paintSer(g, x, y, ang, len, wid, k) {
  g.save(); g.translate(x, y); g.rotate(ang);
  const gr = g.createLinearGradient(0, 0, 0, -len);
  gr.addColorStop(0, rgb(60, 114, 30, k)); gr.addColorStop(0.5, rgb(108, 160, 42, k)); gr.addColorStop(1, rgb(172, 206, 72, k));
  g.fillStyle = gr; g.beginPath(); g.moveTo(0, 0);
  const n = 7;
  for (let i = 1; i <= n; i++) { const t = i / n, w = wid * Math.sin(Math.PI * Math.pow(t, 0.8)); g.lineTo(w * (i % 2 ? 1 : 0.82), -len * t); }
  for (let i = n - 1; i >= 1; i--) { const t = i / n, w = wid * Math.sin(Math.PI * Math.pow(t, 0.8)); g.lineTo(-w * (i % 2 ? 1 : 0.82), -len * t); }
  g.closePath(); g.fill();
  g.strokeStyle = rgb(180, 210, 100, k); g.lineWidth = 1; g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.92); g.stroke();
  g.restore();
}
// Sprites: every leaf type is painted once per brightness bin onto a tiny canvas and then only stamped (drawImage) - the atlas and the impostors need thousands of leaves, and
// path + gradient + stroke per leaf made the start-up paint take seconds on a tablet.
const SPR = new Map();
const spr = (key, w, h, draw) => { let c = SPR.get(key); if (!c) { c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')); SPR.set(key, c); } return c; };
const bin = (k, n = 10) => Math.max(1, Math.min(n * 2, Math.round(k * n)));   // brightness bins of 0.1
let BASE = null;   // the cell transform (set per cell); a stamp is one transform + one drawImage + one reset, no save/restore stack
const stamp = (g, c, x, y, ang, ox, oy, sx, sy) => { const cs = Math.cos(ang), sn = Math.sin(ang); g.transform(cs * sx, sn * sx, -sn * sy, cs * sy, x, y); g.drawImage(c, -ox, -oy); g.setTransform(BASE); };
function leaf(g, x, y, ang, len, wid, k) { const b = bin(k); stamp(g, spr('L' + b, 48, 100, (c) => paintLeaf(c, 24, 98, 0, 96, 21, b / 10, true)), x, y, ang, 24, 98, wid / 21, len / 96); }
function serLeaf(g, x, y, ang, len, wid, k) { const b = bin(k); stamp(g, spr('S' + b, 60, 100, (c) => paintSer(c, 30, 98, 0, 96, 26, b / 10)), x, y, ang, 30, 98, wid / 26, len / 96); }
function ovalLeaf(g, x, y, ang, len, wid, base, sh) {
  const b = bin(sh), key = 'O' + base.join(',') + '|' + b;
  stamp(g, spr(key, 22, 58, (c) => { c.fillStyle = rgb(base[0], base[1], base[2], b / 10); c.beginPath(); c.ellipse(11, 29, 10, 28, 0, 0, 6.283); c.fill(); }), x, y, ang, 11, 57, wid / 10, len / 56);
}

function drawBroadleaf(g, rn) {   // dense twig spray: shaded under-leaves make the middle opaque, 6 sub-twigs and ~115 crisp pointed leaves round them
  for (let i = 0; i < 46; i++) { const a = rn() * 6.283, r = Math.sqrt(rn()) * 72; leaf(g, 128 + Math.cos(a) * r, 140 + Math.sin(a) * r * 1.1, rn() * 6.283, 60 + rn() * 18, 24 + rn() * 8, 0.46 + rn() * 0.14, false); }
  const stem = (t) => [128 + 10 * Math.sin(t * 2.2), 252 - 216 * t];
  g.lineCap = 'round'; g.strokeStyle = rgb(84, 60, 36);
  for (let i = 0; i < 24; i++) { const a = stem(i / 24), b = stem((i + 1) / 24); g.lineWidth = 4 - 2.4 * (i / 24); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  const L = [];
  for (let i = 0; i < 12; i++) {
    const t = 0.08 + 0.88 * i / 11, p = stem(t), p2 = stem(t + 0.01), sa = Math.atan2(p2[0] - p[0], -(p2[1] - p[1])), len = 70 * (1 - 0.42 * t) + rn() * 8;
    for (const s of [-1, 1]) L.push([p[0], p[1], sa + s * (0.7 + rn() * 0.36), len * (0.88 + rn() * 0.24), len * 0.36, 0.84 + rn() * 0.34]);
  }
  [0.16, 0.3, 0.44, 0.58, 0.72, 0.84].forEach((t, k) => {
    const s = k % 2 ? 1 : -1, p = stem(t), ang = s * (0.78 + rn() * 0.3), len = 98 * (1 - 0.5 * t), ex = p[0] + Math.sin(ang) * len, ey = p[1] - Math.cos(ang) * len;
    g.strokeStyle = rgb(84, 60, 36); g.lineWidth = 1.8; g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(ex, ey); g.stroke();
    for (let j = 0; j < 7; j++) {
      const f = 0.2 + j / 6.5 * 0.8, x = p[0] + (ex - p[0]) * f, y = p[1] + (ey - p[1]) * f, ll = 44 - 14 * t - 6 * f;
      for (const sd of [-1, 1]) L.push([x, y, ang + sd * (0.6 + rn() * 0.4), ll * (0.9 + rn() * 0.2), ll * 0.37, 0.86 + rn() * 0.3]);
    }
    L.push([ex, ey, ang, 40, 15, 1.12]);
  });
  L.push([stem(1)[0], stem(1)[1], 0.12, 56, 21, 1.15]);
  L.sort((a, b) => Math.hypot(a[0] - 128, a[1] - 140) - Math.hypot(b[0] - 128, b[1] - 140));   // inner first, crisp outer leaves on top
  for (const l of L) leaf(g, l[0], l[1], l[2], l[3], l[4], l[5]);
}

function drawConifer(g, rn) {   // a full fan of 7 overlapping needle branchlets, each with its own side sprigs: no bare patch anywhere in the card
  g.lineCap = 'round';
  const NB = 6, paths = [];   // all needles of one brightness are one path = one stroke call
  for (let i = 0; i < NB * 2; i++) paths.push(new Path2D());
  const needle = (x0, y0, x1, y1, k, thin) => { const p = paths[Math.min(NB - 1, Math.max(0, Math.round((k - 0.7) / 0.6 * (NB - 1)))) * 2 + (thin ? 1 : 0)]; p.moveTo(x0, y0); p.lineTo(x1, y1); };
  const wood = new Path2D();
  const sprig = (x0, y0, ang, Ln, s, depth) => {
    const steps = Math.max(4, (Ln / 3.8) | 0); let x = x0, y = y0, a = ang;
    wood.moveTo(x, y);
    const pts = [];
    for (let i = 1; i <= steps; i++) { a -= s * 0.02; x += Math.sin(a) * Ln / steps; y -= Math.cos(a) * Ln / steps; wood.lineTo(x, y); pts.push([x, y, a, i / steps]); }
    for (const [px, py, pa, f] of pts) {
      const nl = 18 * (1 - 0.45 * f) + 4;
      for (const sd of [-1, 1]) {
        const na = pa + sd * (0.74 + rn() * 0.28), k = (0.76 + rn() * 0.5) * (0.88 + 0.3 * f);
        needle(px, py, px + Math.sin(na) * nl, py - Math.cos(na) * nl, k, f > 0.5);
      }
    }
    if (!depth) for (let i = 4; i < pts.length - 3; i += 7) { const [px, py, pa, f] = pts[i]; for (const sd of [-1, 1]) sprig(px, py, pa + sd * (0.95 + rn() * 0.2), (46 + rn() * 26) * (1 - f * 0.6), -sd, 1); }
  };
  const N = 7;
  for (let i = 0; i < N; i++) { const th = -0.95 + (1.9 * i) / (N - 1) + (rn() - 0.5) * 0.1; sprig(128, 250, th, Math.min(228, 118 / Math.max(0.25, Math.abs(Math.sin(th)))), Math.sign(th) || 1, 0); }
  g.strokeStyle = rgb(84, 60, 38); g.lineWidth = 1.8; g.stroke(wood);
  for (let i = 0; i < NB; i++) for (let t = 0; t < 2; t++) { const k = 0.7 + (i / (NB - 1)) * 0.6; g.strokeStyle = rgb(72, 124, 38, k); g.lineWidth = t ? 1.5 : 2.3; g.stroke(paths[i * 2 + t]); }
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
    const a = rn() * 6.283, rr = Math.sqrt(rn()) * R, x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr, l = len * (0.8 + rn() * 0.4);
    leaf(g, x, y, a + Math.PI / 2 + (rn() - 0.5) * 1.3, l, l * 0.44, k * (0.85 + rn() * 0.3));
  }
  for (let i = 0; i < 16; i++) {
    const a = rn() * 6.283, rr = 70 + rn() * 40, x = 128 + Math.cos(a) * rr, y = 128 + Math.sin(a) * rr;
    g.fillStyle = rgb(238, 228, 150); g.beginPath(); g.arc(x, y, 3.4, 0, 6.283); g.fill();
    g.fillStyle = rgb(250, 246, 200); g.beginPath(); g.arc(x - 0.8, y - 0.8, 1.4, 0, 6.283); g.fill();
  }
}

function drawNeem(g, rn) {   // pinnate compound leaves: 7 fronds of 10-11 serrated olive leaflets, over a dark under-layer
  for (let i = 0; i < 34; i++) { const a = rn() * 6.283, r = Math.sqrt(rn()) * 70; serLeaf(g, 128 + Math.cos(a) * r, 140 + Math.sin(a) * r, rn() * 6.283, 54 + rn() * 16, 15 + rn() * 4, 0.55 + rn() * 0.15); }
  const N = 7;
  for (let i = 0; i < N; i++) {
    const th = -1 + (2 * i) / (N - 1) + (rn() - 0.5) * 0.1, Ln = Math.min(226, 122 / Math.max(0.25, Math.abs(Math.sin(th))));
    g.strokeStyle = rgb(100, 120, 50); g.lineWidth = 2.4; g.lineCap = 'round'; g.beginPath(); g.moveTo(128, 250); g.lineTo(128 + Math.sin(th) * Ln, 250 - Math.cos(th) * Ln); g.stroke();
    for (let j = 1; j <= 11; j++) {
      const f = j / 11.5, x = 128 + Math.sin(th) * Ln * f, y = 250 - Math.cos(th) * Ln * f, ll = 50 - 14 * f;
      for (const sd of [-1, 1]) serLeaf(g, x, y, th + sd * (0.85 + rn() * 0.2), ll * (0.9 + rn() * 0.2), ll * 0.27, 0.86 + rn() * 0.3);
    }
    serLeaf(g, 128 + Math.sin(th) * Ln, 250 - Math.cos(th) * Ln, th, 42, 11, 1.12);
  }
}

function bipinnate(g, rn, N, spread, flowerK) {   // feathery acacia-like gulmohar foliage: rachis -> pinnae -> tiny paired leaflets
  for (let i = 0; i < N; i++) {
    const th = -spread + (2 * spread * i) / (N - 1) + (rn() - 0.5) * 0.1, Ln = Math.min(224, 120 / Math.max(0.25, Math.abs(Math.sin(th))));
    g.strokeStyle = rgb(92, 112, 44); g.lineWidth = 2.2; g.lineCap = 'round'; g.beginPath(); g.moveTo(128, 250); g.lineTo(128 + Math.sin(th) * Ln, 250 - Math.cos(th) * Ln); g.stroke();
    for (let j = 1; j <= 12; j++) {
      const f = j / 12.5, x = 128 + Math.sin(th) * Ln * f, y = 250 - Math.cos(th) * Ln * f, pl = 40 * (1 - 0.5 * f) + 8;
      for (const sd of [-1, 1]) {
        const pa = th + sd * 1.15;
        for (let k = 1; k <= 5; k++) {
          const q = k / 5, lx = x + Math.sin(pa) * pl * q, ly = y - Math.cos(pa) * pl * q, sh = 0.72 + rn() * 0.5;
          ovalLeaf(g, lx, ly, pa + 1.1, 19, 5.6, [78, 160, 52], sh);
          ovalLeaf(g, lx, ly, pa - 1.1, 19, 5.6, [86, 168, 56], sh);
        }
      }
    }
  }
}
function drawGul(g, rn) {
  g.fillStyle = rgb(46, 100, 34); g.beginPath(); g.ellipse(128, 142, 78, 74, 0, 0, 6.283); g.fill();
  bipinnate(g, rn, 6, 0.95, 0);
}
function drawFlower(g, rn) {   // gulmohar blossom: leaf base with ~20 vermilion five-petal clusters, one white-streaked standard petal each
  g.fillStyle = rgb(44, 96, 32); g.beginPath(); g.ellipse(128, 142, 78, 74, 0, 0, 6.283); g.fill();
  bipinnate(g, rn, 4, 0.9, 0);
  const cl = [];
  for (let i = 0; i < 22; i++) { const a = rn() * 6.283, r = Math.sqrt(rn()) * 96; cl.push([128 + Math.cos(a) * r, 140 + Math.sin(a) * r * 0.95]); }
  cl.sort((a, b) => Math.hypot(a[0] - 128, a[1] - 140) - Math.hypot(b[0] - 128, b[1] - 140));
  for (const [x, y] of cl) {
    const rot = rn() * 6.283, k = 0.85 + rn() * 0.3;
    for (let p = 0; p < 5; p++) { const a = rot + (p / 5) * 6.283; g.fillStyle = rgb(232 * k, 64 * k, 28 * k); g.beginPath(); g.ellipse(x + Math.cos(a) * 9, y + Math.sin(a) * 9, 10, 6.4, a, 0, 6.283); g.fill(); }
    g.fillStyle = rgb(246, 214, 120); g.beginPath(); g.ellipse(x + Math.cos(rot + 0.3) * 4, y + Math.sin(rot + 0.3) * 4, 6, 4, rot, 0, 6.283); g.fill();
    g.strokeStyle = rgb(120, 20, 10); g.lineWidth = 1.2; g.beginPath(); for (let s = 0; s < 4; s++) { const a = rot + s * 1.57; g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 11, y + Math.sin(a) * 11); } g.stroke();
  }
}

function drawBabool(g, rn) {   // acacia: thin zig-zag twigs with tiny paired leaflets, thorn pairs, yellow puff flowers; lighter and airier than the other cells
  const tw = [];
  for (let i = 0; i < 6; i++) tw.push(-1 + (2 * i) / 5 + (rn() - 0.5) * 0.12);
  for (const th of tw) {
    let x = 128, y = 250, a = th * 0.8, L = Math.min(220, 118 / Math.max(0.25, Math.abs(Math.sin(th * 0.8))));
    const steps = Math.floor(L / 22);
    for (let i = 0; i < steps; i++) {
      const na = a + (i % 2 ? 0.42 : -0.42) + (rn() - 0.5) * 0.2, nx = x + Math.sin(na) * 22, ny = y - Math.cos(na) * 22;
      g.strokeStyle = rgb(70, 52, 38); g.lineWidth = 2 - i * 0.07; g.lineCap = 'round'; g.beginPath(); g.moveTo(x, y); g.lineTo(nx, ny); g.stroke();
      for (let k = 0; k < 6; k++) {
        const t = (k + 1) / 7, lx = x + (nx - x) * t, ly = y + (ny - y) * t;
        for (const sd of [-1, 1]) { const sh = 0.8 + rn() * 0.4; ovalLeaf(g, lx, ly, na + sd * 1.25, 14, 3.4, [118, 142, 52], sh); }
      }
      if (i % 3 === 1) { g.strokeStyle = rgb(214, 208, 190); g.lineWidth = 1.6; g.beginPath(); g.moveTo(nx, ny); g.lineTo(nx - 6, ny - 3); g.moveTo(nx, ny); g.lineTo(nx + 6, ny - 3); g.stroke(); }
      x = nx; y = ny; a = na;
    }
    ovalLeaf(g, x, y, a, 16, 4, [130, 150, 56], 1);
  }
  for (let i = 0; i < 6; i++) { g.fillStyle = rgb(240, 210, 60); g.beginPath(); g.arc(70 + rn() * 116, 60 + rn() * 140, 4.5, 0, 6.283); g.fill(); }
}

export function makeFoliageTex(r) {
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d', { willReadFrequently: true });
  const cells = [['broad', drawBroadleaf], ['conifer', drawConifer], ['palm', drawPalm], ['shrub', drawShrub], ['neem', drawNeem], ['gul', drawGul], ['flower', drawFlower], ['babool', drawBabool]];
  cells.forEach(([nm, fn], i) => {
    const [cu, cr] = CELL[nm];
    g.save(); g.beginPath(); g.rect(cu * CL, cr * CL, CL, CL); g.clip(); g.translate(cu * CL, cr * CL); BASE = g.getTransform();
    fn(g, mulberry32(7001 + i * 131));
    g.restore();
  });
  return finishTex(r, g, [[88, 164, 52], [70, 128, 64], [100, 150, 50], [78, 150, 46], [100, 156, 44], [88, 164, 56], [120, 130, 50], [110, 140, 52]]);
}
// transparent texels carry the cell's leaf colour too (no dark fringe when filtered / mip-mapped)
function finishTex(r, g, fill) {
  const id = g.getImageData(0, 0, AW, AH), d = id.data;
  for (let y = 0; y < AH; y++) for (let x = 0; x < AW; x++) {
    const i = (y * AW + x) * 4;
    if (d[i + 3] < 6) { const c = fill[(x / CL | 0) + (y >= CL ? 4 : 0)]; d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 0; }
  }
  return r.makeTex(AW, AH, new Uint8Array(d.buffer));
}

// ---------------------------------------------------------------- impostor atlas: every species painted as one shaded full-tree picture
export const IMP_ORDER = ['neem', 'mango', 'banyan', 'gulmohar', 'ashoka', 'babool', 'palm', 'shrub'];
export function impSize(sp, name) {   // metres covered by the picture of the nominal tree
  const h = (sp.h[0] + sp.h[1]) / 2, cr = (sp.crown[0] + sp.crown[1]) / 2;
  const W = name === 'palm' ? cr * 2 * 2.1 : name === 'shrub' ? cr * 2 * 1.5 : name === 'ashoka' ? cr * 2 * 1.35 : name === 'banyan' ? cr * 2 * 1.4 : cr * 2 * 1.3;
  return { W, H: h * 1.08, h, cr };
}
export function makeImpostors(r, TREES) {
  const cv = document.createElement('canvas'); cv.width = AW; cv.height = AH;
  const g = cv.getContext('2d', { willReadFrequently: true }), info = {};
  IMP_ORDER.forEach((name, i) => {
    const sp = TREES[name], S = impSize(sp, name), rn = mulberry32(5003 + i * 97), cu = i % 4, cr = (i / 4) | 0;
    info[name] = { cell: [cu, cr], W: S.W, H: S.H };
    g.save(); g.beginPath(); g.rect(cu * CL, cr * CL, CL, CL); g.clip();
    g.translate(cu * CL + CL / 2, cr * CL + CL - 4); g.scale(CL / S.W, -(CL - 4) / S.H);   // metres, y up, origin at the foot of the trunk
    BASE = g.getTransform();
    paintTree(g, rn, name, sp, S);
    g.restore();
  });
  return { tex: finishTex(r, g, [[64, 120, 40], [40, 100, 40], [40, 90, 36], [64, 120, 40], [40, 100, 50], [100, 110, 50], [70, 120, 40], [60, 120, 40]]), info };
}
function paintTree(g, rn, name, sp, S) {
  const L = sp.leaf[0], base = [L[0] / 0.52 * 255 * 0.82, L[1] / 0.52 * 255 * 0.82, L[2] / 0.52 * 255 * 0.82], h = S.h, cr = S.cr;
  const blade = (x, y, ang, len, wid, k, tint) => {
    const b = bin(k, 8), key = 'B' + name + '|' + b + '|' + tint.join(',');
    const c = spr(key, 22, 42, (cc) => { cc.fillStyle = rgb(base[0] * b / 8 * tint[0], base[1] * b / 8 * tint[1], base[2] * b / 8 * tint[2]); cc.beginPath(); cc.moveTo(11, 0); cc.bezierCurveTo(21, 10, 18, 31, 11, 41); cc.bezierCurveTo(4, 31, 1, 10, 11, 0); cc.fill(); });
    stamp(g, c, x, y, ang, 11, 0, wid / 10, len / 41);
  };
  const trunk = (pts, r0, r1, col = [74, 54, 36]) => {
    g.fillStyle = rgb(col[0], col[1], col[2]);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], ra = r0 + (r1 - r0) * (i / (pts.length - 1)), rb = r0 + (r1 - r0) * ((i + 1) / (pts.length - 1));
      g.beginPath(); g.moveTo(a[0] - ra, a[1]); g.lineTo(a[0] + ra, a[1]); g.lineTo(b[0] + rb, b[1]); g.lineTo(b[0] - rb, b[1]); g.closePath(); g.fill();
    }
  };
  const lobe = (cx, cy, rx, ry, n, tint = [1, 1, 1], bl = 0.34) => {
    g.fillStyle = rgb(base[0] * 0.5 * tint[0], base[1] * 0.5 * tint[1], base[2] * 0.5 * tint[2]);
    g.beginPath(); g.ellipse(cx, cy, rx * 0.94, ry * 0.92, 0, 0, 6.283); g.fill();
    for (let i = 0, nn = Math.round(n * 0.68); i < nn; i++) {   // the picture is only seen from 38 m and further: fewer, slightly larger blades
      let x, y; do { x = rn() * 2 - 1; y = rn() * 2 - 1; } while (x * x + y * y > 1);
      const lit = 0.6 + 0.55 * Math.max(0, y * 0.75 + x * 0.3) + (rn() - 0.5) * 0.25;
      blade(cx + x * rx, cy + y * ry, rn() * 6.283, bl * 1.15 * (0.8 + rn() * 0.5), bl * 0.52, lit, tint);
    }
  };
  const roundIt = (lobes) => { for (const [x, y, rx, ry, n, tint] of lobes) lobe(x, y, rx, ry, n, tint); };
  if (name === 'neem') {
    trunk([[0, 0], [0.04, 1.2], [0.1, 2.4]], 0.3, 0.2); trunk([[0.1, 2.3], [-0.5, 3.1], [-0.9, 3.9]], 0.2, 0.12); trunk([[0.1, 2.3], [0.5, 3.1], [0.8, 3.8]], 0.2, 0.12);
    roundIt([[-1.6, 4.4, 1.2, 0.95, 60], [-0.6, 5.5, 1.9, 1.5, 150], [1.0, 5.1, 1.8, 1.4, 140], [0.1, 6.7, 1.7, 1.3, 120], [1.9, 4.5, 1.1, 0.9, 55]]);
  } else if (name === 'mango') {
    trunk([[0, 0], [0.02, 0.8], [0, 1.7]], 0.42, 0.32);
    roundIt([[-2.3, 2.9, 1.9, 1.4, 90], [2.4, 2.9, 1.9, 1.4, 90], [0, 4.0, 3.9, 2.8, 330], [-0.8, 5.5, 2.3, 1.4, 120], [1.1, 5.4, 2.2, 1.4, 110]]);
  } else if (name === 'banyan') {
    trunk([[0, 0], [0, 1.4], [0.1, 3]], 0.85, 0.55); trunk([[-0.9, 0], [-0.3, 0.9]], 0.3, 0.2); trunk([[0.9, 0], [0.3, 0.9]], 0.3, 0.2);
    g.strokeStyle = rgb(78, 58, 40); g.lineCap = 'round';
    for (let i = 0; i < 9; i++) { const x = (i / 8 * 2 - 1) * 5.4 + (rn() - 0.5) * 0.4; g.lineWidth = 0.06 + rn() * 0.05; g.beginPath(); g.moveTo(x, 4.6 + rn() * 0.5); g.lineTo(x + (rn() - 0.5) * 0.3, 0); g.stroke(); }
    roundIt([[-3.8, 5.0, 3.0, 1.5, 150], [3.9, 5.0, 3.1, 1.5, 150], [0, 6.3, 6.4, 2.1, 380], [-2.2, 7.9, 3.0, 1.3, 130], [2.4, 8.0, 3.0, 1.3, 130], [0, 9.2, 2.4, 1.0, 70]]);
  } else if (name === 'gulmohar') {
    trunk([[0, 0], [-0.1, 1.5], [-0.3, 2.9]], 0.34, 0.24); trunk([[-0.3, 2.8], [-1.3, 3.8], [-1.9, 4.5]], 0.2, 0.1); trunk([[-0.3, 2.8], [0.8, 3.9], [1.7, 4.5]], 0.2, 0.1);
    roundIt([[-2.4, 4.6, 2.1, 1.0, 120], [2.5, 4.6, 2.1, 1.0, 120], [0, 5.1, 4.1, 1.5, 300]]);
    for (let i = 0; i < 95; i++) { let x, y; do { x = rn() * 2 - 1; y = rn() * 2 - 1; } while (x * x + y * y > 1 || y < -0.2); const px = x * 4.1, py = 5.4 + y * 1.5; g.fillStyle = rgb(228 + rn() * 20, 56 + rn() * 40, 26 + rn() * 14); g.beginPath(); g.ellipse(px, py, 0.2, 0.15, rn() * 3, 0, 6.283); g.fill(); }
  } else if (name === 'ashoka') {
    trunk([[0, 0], [0, 4], [0, h * 0.82]], 0.22, 0.08);
    for (let i = 0; i < 12; i++) { const f = 0.14 + i * 0.075, cy = f * h, rx = cr * 1.2 * (1 - (f - 0.14) / 0.86 * 0.86) + 0.15; lobe(0, cy, rx, 0.78, 46 + (i < 6 ? 14 : 0)); lobe(-rx * 0.62, cy - 0.35, rx * 0.5, 0.5, 14); lobe(rx * 0.62, cy - 0.35, rx * 0.5, 0.5, 14); }
  } else if (name === 'babool') {
    trunk([[0, 0], [-0.1, 0.8], [-0.3, 1.4]], 0.2, 0.14); trunk([[-0.3, 1.3], [-0.8, 2.2], [-1.2, 3.2]], 0.14, 0.08); trunk([[-0.2, 1.3], [0.4, 2.3], [0.9, 3.4]], 0.14, 0.08);
    for (const [x, y, rx, ry, n] of [[-1.2, 3.5, 1.7, 0.55, 80], [0.9, 3.8, 1.8, 0.5, 80], [0, 4.5, 1.3, 0.4, 56]]) lobe(x, y, rx, ry, n, [1.05, 1.05, 1.0], 0.22);
  } else if (name === 'palm') {
    const tp = [[0, 0], [0.12, 2.2], [0.3, 4.6], [0.55, 6.8], [0.8, h * 0.93]];
    trunk(tp, 0.2, 0.14);
    g.strokeStyle = rgb(60, 44, 30); g.lineWidth = 0.05; for (let y = 0.4; y < h * 0.9; y += 0.45) { g.beginPath(); g.moveTo(0.1 + y * 0.09 - 0.17, y); g.lineTo(0.1 + y * 0.09 + 0.17, y); g.stroke(); }
    const cx = 0.8, cy = h * 0.93;
    for (let i = 0; i < 16; i++) {
      const ph = -1.45 + (2.9 * i) / 15 + (rn() - 0.5) * 0.12, Lf = cr * 2.1 * (0.85 + rn() * 0.3), n = 20;
      const pt = (t) => [cx + Math.sin(ph) * Lf * t, cy + Math.cos(ph) * Lf * t * 0.55 + Math.abs(Math.sin(ph)) * 0.35 * Lf * t - 0.55 * Lf * t * t];
      g.strokeStyle = rgb(100, 112, 58); g.lineWidth = 0.07; g.beginPath(); let q = pt(0); g.moveTo(q[0], q[1]); for (let s = 1; s <= 12; s++) { q = pt(s / 12); g.lineTo(q[0], q[1]); } g.stroke();
      for (let k = 1; k <= n; k++) {
        const t = k / (n + 1), a = pt(t), len = 0.9 * Math.sin(Math.PI * Math.pow(t, 0.8)) + 0.12, lit = 0.7 + rn() * 0.5;
        g.strokeStyle = rgb(base[0] * lit * 1.1, base[1] * lit * 1.1, base[2] * lit); g.lineWidth = 0.06;
        g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(a[0] - len * 0.55, a[1] - len * 0.8); g.moveTo(a[0], a[1]); g.lineTo(a[0] + len * 0.55, a[1] - len * 0.8); g.stroke();
      }
    }
  } else {   // shrub
    lobe(0, 0.55, 0.85, 0.62, 110, [1, 1, 1], 0.2);
    for (let i = 0; i < 9; i++) { g.fillStyle = rgb(240, 230, 150); g.beginPath(); g.arc((rn() - 0.5) * 1.5, 0.35 + rn() * 0.7, 0.045, 0, 6.283); g.fill(); }
  }
  // baked ambient occlusion: darker low and inside, warm light on top (only where something was painted)
  g.globalCompositeOperation = 'source-atop';
  const vg = g.createLinearGradient(0, 0, 0, h * 1.05); const dk = name === 'ashoka' ? 0.3 : 0.5; vg.addColorStop(0, 'rgba(0,0,0,' + dk + ')'); vg.addColorStop(0.35, 'rgba(0,0,0,' + dk * 0.36 + ')'); vg.addColorStop(1, 'rgba(255,240,170,0.1)');
  g.fillStyle = vg; g.fillRect(-S.W, -1, S.W * 2, h * 1.2);
  g.globalCompositeOperation = 'source-over';
}

// ---------------------------------------------------------------- geometry helpers
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const dir = (pitch, az) => [Math.sin(pitch) * Math.cos(az), Math.cos(pitch), -Math.sin(pitch) * Math.sin(az)];   // pitch measured from straight up
const mad = (p, d, s) => [p[0] + d[0] * s, p[1] + d[1] * s, p[2] + d[2] * s];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

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
function card(c, o, up, w, h, cell, roll, rightIn, lcOv) {
  const { b, W, rn, cen, R } = c, lc = lcOv || c.lc;
  let e1;
  if (rightIn) { const k = dot(rightIn, up); e1 = norm([rightIn[0] - up[0] * k, rightIn[1] - up[1] * k, rightIn[2] - up[2] * k]); }
  else e1 = norm(cross(up, Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const e2 = cross(up, e1), cs = Math.cos(roll), sn = Math.sin(roll);
  const right = [e1[0] * cs + e2[0] * sn, e1[1] * cs + e2[1] * sn, e1[2] * cs + e2[2] * sn], fwd = cross(right, up);
  const sgn = dot(fwd, [o[0] - cen[0], o[1] - cen[1], o[2] - cen[2]]) >= 0 ? 1 : -1;
  const kv = 0.86 + rn() * 0.28, sh = (rn() - 0.5) * 0.08;
  const u0 = cell[0] * 0.25 + 0.004, u1 = cell[0] * 0.25 + 0.246, v0 = cell[1] * 0.5 + 0.006, v1 = cell[1] * 0.5 + 0.494;
  const base = b.nv;
  for (const [sx, sy, u, v] of [[-1, 0, u0, v1], [1, 0, u1, v1], [1, 1, u1, v0], [-1, 1, u0, v0]]) {
    const p = [o[0] + right[0] * sx * w / 2 + up[0] * sy * h, o[1] + right[1] * sx * w / 2 + up[1] * sy * h, o[2] + right[2] * sx * w / 2 + up[2] * sy * h];
    const dx = p[0] - cen[0], dy = p[1] - cen[1], dz = p[2] - cen[2], dd = Math.hypot(dx, dy, dz) || 1, r = Math.min(1, dd / R), hg = clamp((dy / R + 1) * 0.5, 0, 1);
    const a0 = c.ao0 || 0.46, ao = (a0 + (1 - a0) * Math.pow(r, 0.9)) * (0.8 + 0.2 * hg) * kv;
    const n = norm([dx / dd * 0.8 + fwd[0] * sgn * 0.3, dy / dd * 0.8 + fwd[1] * sgn * 0.3, dz / dd * 0.8 + fwd[2] * sgn * 0.3]);
    b.vert(p[0], p[1], p[2], n[0], n[1], n[2], u, v, lc[0] * ao * (1 + sh), lc[1] * ao, lc[2] * ao * (1 - sh));
  }
  b.grp(W.leaf, 'paint').idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

// mulch / soil pit under a tree or shrub (built into the always-drawn lot mesh by city.js, so it costs no draw call of its own)
export function mulchDisc(b, part, x, z, r, rn) {
  const n = 7, base = b.nv, y = 0.0075;
  b.vert(x, y, z, 0, 1, 0, 3, 3, 1, 1, 1);
  for (let i = 0; i < n; i++) { const a = (i / n) * 6.2832, rr = r * (0.88 + 0.24 * rn()); b.vert(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr, 0, 1, 0, 3, 3, 1, 1, 1); }
  const gi = b.grp(part, 'paint').idx;
  for (let i = 0; i < n; i++) gi.push(base, base + 1 + ((i + 1) % n), base + 1 + i);
}

// ---------------------------------------------------------------- species architectures
// fork: trunk height as a share of tree height; reach: limb length as a share of the crown radius; pitch: limb angle from vertical (1.57 = horizontal); asym: one side of the crown is fuller;
// cenY: crown centre above the fork in crown radii; w: card width range; rose: cards in the rosette at every branch end; core: cards in the crown heart
const ARCH = {
  neem:     { fork: 0.34, limbs: [4, 5], pitch: [0.62, 1.0], reach: 0.62, asym: 0.42, cenY: 0.62, R: 1.25, cell: CELL.neem, w: [1.5, 2.3], rose: 8, core: 7 },
  mango:    { fork: 0.2, limbs: [5, 6], pitch: [0.95, 1.3], reach: 0.78, asym: 0.08, cenY: 0.5, R: 1.2, cell: CELL.broad, w: [1.7, 2.6], rose: 9, core: 8 },
  banyan:   { fork: 0.26, limbs: [6, 7], pitch: [1.3, 1.5], reach: 0.95, asym: 0.15, cenY: 0.38, R: 1.25, cell: CELL.broad, w: [2.2, 3.2], rose: 8, core: 8, roots: [7, 10], upper: 3 },
  gulmohar: { fork: 0.34, limbs: [4, 5], pitch: [1.15, 1.4], reach: 0.9, asym: 0.15, cenY: 0.42, R: 1.2, cell: CELL.gul, flower: CELL.flower, w: [1.8, 2.8], rose: 8, core: 6, flat: true },
};

function rosette(c, A, tp, d, n, sc) {
  const { rn } = c;
  for (let j = 0; j < n; j++) {
    let dd;
    if (A.flat) dd = norm([d[0] * 0.8 + (rn() - 0.5) * 1.2, 0.05 + rn() * 0.4, d[2] * 0.8 + (rn() - 0.5) * 1.2]);
    else {
      const m = j % 3;
      if (m === 0) dd = norm([d[0] * 0.5 + (rn() - 0.5) * 1.2, 0.4 + rn() * 0.8, d[2] * 0.5 + (rn() - 0.5) * 1.2]);      // up
      else if (m === 1) dd = norm([d[0] + (rn() - 0.5) * 1.1, -0.15 + rn() * 0.55, d[2] + (rn() - 0.5) * 1.1]);           // out
      else dd = norm([d[0] + (rn() - 0.5) * 0.9, -0.3 - rn() * 0.4, d[2] + (rn() - 0.5) * 0.9]);                            // drape: skirts hang down and outward
    }
    const w = (A.w[0] + rn() * (A.w[1] - A.w[0])) * sc, hh = w * (0.95 + 0.15 * rn());
    const bloom = A.flower && tp[1] > c.cen[1] - 0.2 && rn() < 0.6;
    card(c, mad([tp[0] + (rn() - 0.5) * 0.3, tp[1] + (rn() - 0.5) * 0.3, tp[2] + (rn() - 0.5) * 0.3], dd, -0.22 * hh), dd, w, hh, bloom ? A.flower : A.cell, rn() * 6.283, null, bloom ? [1.05, 1.0, 1.0] : null);
  }
}

function broad(c, A, sp, t, h, cr) {
  const { rn } = c;
  const x0 = t.x, z0 = t.z, ht = h * A.fork, r0 = sp.trunk, sc = clamp(cr / 3, 0.8, 1.4);
  c.cen = [x0, ht + cr * A.cenY, z0]; c.R = cr * A.R + 0.5;
  // root flare + three-segment curved trunk
  const p = [[x0, 0.5, z0]];
  for (const f of [0.38, 0.72, 1]) p.push([x0 + (rn() - 0.5) * ht * 0.14 * f, ht * f, z0 + (rn() - 0.5) * ht * 0.14 * f]);
  tube(c, [x0, -0.12, z0], p[0], r0 * 1.7, r0 * 1.04, 7);
  const rad = [1, 0.88, 0.74, 0.62];
  for (let i = 0; i < 3; i++) tube(c, p[i], p[i + 1], r0 * rad[i], r0 * rad[i + 1], 6);
  const nb = r0 > 0.4 ? 7 : r0 > 0.18 ? 4 : 0;
  for (let i = 0; i < nb; i++) { const a = (i / nb) * 6.28 + rn() * 0.5; tube(c, [x0 + Math.cos(a) * r0 * 0.4, 0.7, z0 - Math.sin(a) * r0 * 0.4], [x0 + Math.cos(a) * r0 * 3.2, -0.07, z0 - Math.sin(a) * r0 * 3.2], r0 * 0.5, r0 * 0.14, 4); }
  // primary limbs (level 1) with secondary branches (level 2); each one starts inside its parent
  const nl = A.limbs[0] + Math.floor(rn() * (A.limbs[1] - A.limbs[0] + 1)), a0 = rn() * 6.28, big = rn() * 6.28, ends = [], B2 = [];
  const limb = (A0, az, th, Ll, rl, sec) => {
    const B = mad(A0, dir(th, az), Ll * 0.5), C = mad(B, dir(th * 0.7, az + (rn() - 0.5) * 0.4), Ll * 0.5);
    tube(c, A0, B, rl, rl * 0.72, 5); tube(c, B, C, rl * 0.72, rl * 0.46, 5);
    if (sec) {
      const s1 = mad(B, dir(th * 0.8, az + 0.9 + rn() * 0.4), Ll * 0.55), s2 = mad(C, dir(th * 0.8, az - 0.9 - rn() * 0.4), Ll * 0.5);
      tube(c, B, s1, rl * 0.48, rl * 0.2, 4); tube(c, C, s2, rl * 0.42, rl * 0.18, 4);
      ends.push([s1, dir(th * 0.9, az + 1)], [s2, dir(th * 0.9, az - 1)]);
    }
    ends.push([C, dir(th * 0.6, az)]); B2.push([B, C, az]);
  };
  for (let i = 0; i < nl; i++) {
    const az = a0 + (i / nl) * 6.283 + (rn() - 0.5) * 0.55, Ll = cr * A.reach * (0.82 + rn() * 0.36) * (1 + A.asym * Math.cos(az - big)), th = A.pitch[0] + rn() * (A.pitch[1] - A.pitch[0]);
    limb(lerp3(p[2], p[3], Math.min(1, (i / (nl - 1)) * 0.95 + rn() * 0.05)), az, th, Ll, r0 * 0.42, true);
  }
  for (let i = 0; i < (A.upper || 0); i++) limb(p[3], a0 + i * 2.1 + rn(), 0.75 + rn() * 0.25, cr * A.reach * 0.55, r0 * 0.34, false);   // banyan: a second, higher tier
  const top = mad(p[3], [0, 1, 0], cr * 0.5 * (0.9 + 0.2 * rn()));
  tube(c, p[3], top, r0 * 0.5, r0 * 0.15, 5); ends.push([top, [0, 1, 0]]);
  for (const [tp, d] of ends) rosette(c, A, tp, d, A.rose + (rn() > 0.5 ? 1 : 0), sc);
  // inner core: the heart of the crown above the fork is never see-through
  for (let j = 0; j < A.core; j++) {
    const a = (j / A.core) * 6.283 + rn(), rr = rn() * cr * 0.3, dd = norm([Math.cos(a) * 0.7, 0.35 + rn() * 0.8, -Math.sin(a) * 0.7]), w = A.w[1] * 1.1 * sc;
    card(c, [x0 + Math.cos(a) * rr, c.cen[1] - cr * 0.35 + rn() * cr * 0.5, z0 - Math.sin(a) * rr], dd, w, w, A.cell, rn() * 6.283);
  }
  // banyan: hanging aerial prop-roots from the horizontal limbs, thicker towards the ground
  if (A.roots) {
    const nr = A.roots[0] + Math.floor(rn() * (A.roots[1] - A.roots[0] + 1));
    for (let i = 0; i < nr; i++) {
      const [B, C] = B2[i % B2.length], q = lerp3(B, C, 0.35 + rn() * 0.6);
      if (Math.hypot(q[0] - x0, q[2] - z0) < cr * 0.3 || q[1] < 1.5) continue;
      tube(c, q, [q[0] + (rn() - 0.5) * 0.25, -0.06, q[2] + (rn() - 0.5) * 0.25], 0.035, 0.07 + rn() * 0.05, 4);
    }
  }
}

function babool(c, sp, t, h, cr) {   // crooked V trunk, two or three wide flat-topped savanna pads
  const { rn } = c, x0 = t.x, z0 = t.z, r0 = sp.trunk, A = { w: [2.0, 2.8], cell: CELL.babool }, sc = clamp(cr / 2.4, 0.8, 1.3);
  c.cen = [x0, h * 0.74, z0]; c.R = cr * 1.4 + 0.4;
  const f = [x0 + (rn() - 0.5) * 0.3, h * 0.28, z0 + (rn() - 0.5) * 0.3];
  const m = [x0 + (rn() - 0.5) * 0.2, h * 0.12, z0 + (rn() - 0.5) * 0.2];
  tube(c, [x0, -0.12, z0], m, r0 * 1.5, r0 * 1.1, 6); tube(c, m, f, r0 * 1.1, r0 * 0.85, 6);
  for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.28 + rn(); tube(c, [x0 + Math.cos(a) * r0 * 0.4, 0.4, z0 - Math.sin(a) * r0 * 0.4], [x0 + Math.cos(a) * r0 * 2.6, -0.06, z0 - Math.sin(a) * r0 * 2.6], r0 * 0.45, r0 * 0.12, 4); }
  const np = 2 + (rn() > 0.5 ? 1 : 0), az0 = rn() * 6.28, pads = [];
  for (let i = 0; i < np; i++) {
    const az = az0 + (i / np) * 6.283 + (rn() - 0.5) * 0.4, th = 0.5 + rn() * 0.35, Ll = h * 0.42, B = mad(f, dir(th, az), Ll * 0.5), C = mad(B, dir(th * 0.55, az + (rn() - 0.5) * 0.5), Ll * 0.5);
    tube(c, f, B, r0 * 0.6, r0 * 0.4, 5); tube(c, B, C, r0 * 0.4, r0 * 0.22, 5);
    tube(c, B, mad(B, dir(th + 0.5, az + 1.2), Ll * 0.35), r0 * 0.26, r0 * 0.12, 4);
    pads.push(C);
  }
  for (const C of pads) {
    for (let j = 0; j < 7; j++) {
      const a = rn() * 6.283, rr = Math.sqrt(rn()) * cr * 0.55, dd = norm([Math.cos(a) * 0.9, 0.2 + rn() * 0.3, -Math.sin(a) * 0.9]), w = (A.w[0] + rn() * (A.w[1] - A.w[0])) * sc;
      card(c, [C[0] + Math.cos(a) * rr * 0.6, C[1] + 0.15 + rn() * 0.4, C[2] - Math.sin(a) * rr * 0.6], dd, w, w * 0.95, CELL.babool, rn() * 6.283);
    }
    for (let j = 0; j < 3; j++) { const a = rn() * 6.283, dd = norm([Math.cos(a) * 0.8, -0.3 - rn() * 0.3, -Math.sin(a) * 0.8]); card(c, [C[0], C[1] + 0.1, C[2]], dd, 1.6 * sc, 1.5 * sc, CELL.babool, rn() * 6.283); }
  }
}

function conifer(c, sp, t, h, cr) {   // ashoka: tall columnar mast tree, 14 tight whorls of drooping boughs from 18 % to the tip, trunk veiled by inner cards
  const { rn } = c, x0 = t.x, z0 = t.z, r0 = sp.trunk, ty = h * 0.85;
  c.cen = [x0, h * 0.52, z0]; c.R = Math.max(cr * 1.3, h * 0.5); c.ao0 = 0.68;   // a dense evergreen is dark inside but not black
  const flat = (d) => norm([-d[2], 0, d[0]]);
  const p = [[x0, 0.5, z0], [x0 + (rn() - 0.5) * 0.12, ty * 0.38, z0 + (rn() - 0.5) * 0.12], [x0 + (rn() - 0.5) * 0.1, ty * 0.72, z0 + (rn() - 0.5) * 0.1], [x0, ty, z0]];
  tube(c, [x0, -0.12, z0], p[0], r0 * 1.55, r0 * 1.05, 6);
  const rad = [1, 0.8, 0.58, 0.3];
  for (let i = 0; i < 3; i++) tube(c, p[i], p[i + 1], r0 * rad[i], r0 * rad[i + 1], 5);
  tube(c, p[3], [x0, h * 0.99, z0], r0 * 0.3, r0 * 0.05, 3);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * 6.28 + rn(); tube(c, [x0 + Math.cos(a) * r0 * 0.4, 0.5, z0 - Math.sin(a) * r0 * 0.4], [x0 + Math.cos(a) * r0 * 2.6, -0.06, z0 - Math.sin(a) * r0 * 2.6], r0 * 0.45, r0 * 0.14, 4); }
  const W = 14;
  for (let i = 0; i < W; i++) {
    const f = 0.18 + (i / (W - 1)) * 0.79, y = h * f, q = (f - 0.18) / 0.79, Lb = cr * 1.3 * (1 - q * 0.9) + 0.2, nb = i < 6 ? 6 : 5, a0 = i * 0.93 + rn() * 0.4;
    const k = clamp(y / ty, 0, 1) * 3, tc = lerp3(p[Math.min(2, Math.floor(k))], p[Math.min(3, Math.floor(k) + 1)], k - Math.floor(k)), tx = tc[0], tz = tc[2];
    for (let j = 0; j < 3; j++) { const az = a0 + (j / 3) * 6.283 + rn() * 0.5, d = dir(0.55 + rn() * 0.3, az); card(c, [tx, y - 0.1, tz], d, Lb * 0.8, Lb * 0.75, CELL.conifer, rn() * 6.28, flat(d)); }   // trunk-hugging cards
    for (let j = 0; j < nb; j++) {
      const az = a0 + (j / nb) * 6.283 + (rn() - 0.5) * 0.4, d = dir(1.65 + 0.3 * q + (rn() - 0.5) * 0.2, az), A0 = [tx, y, tz], o = mad(A0, d, Lb * 0.14);
      if (i < 7) tube(c, A0, mad(A0, d, Lb), Math.max(0.014, r0 * 0.3 * (1 - q)), 0.01, 3);
      card(c, o, d, Lb * 1.25, Lb * 0.95, CELL.conifer, 0, flat(d));
      card(c, mad(o, [0, 0.04, 0], 1), d, Lb * 0.9, Lb * 0.9, CELL.conifer, 1.25 + (rn() - 0.5) * 0.4, flat(d));
    }
  }
}

// ---------------------------------------------------------------- fruit: coconuts on palms, mangoes in mango crowns
// An ellipsoid (long axis `ax`), rings x segments, with a slightly triangular section for coconuts. Fruit is built in 5 groups (W.nuts[k], 1+1+2+2+2 pieces) so a tree can lose
// them one group at a time: the renderer hides a group by its part id, and the tree field spawns a falling body for every piece of that group.
export const FRUIT_GROUPS = [1, 1, 2, 2, 2];
export function ellipsoid(b, part, cx, cy, cz, rw, rl, ax, col, tri) {
  const nS = 9, nR = 6, base = b.nv, e1 = norm(cross(ax, Math.abs(ax[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])), e2 = cross(ax, e1);
  for (let i = 0; i <= nR; i++) {
    const a = (Math.PI * i) / nR, ca = Math.cos(a), sa = Math.sin(a), shade = 0.62 + 0.38 * Math.pow(Math.sin(a * 0.5 + 0.2), 0.6);
    for (let k = 0; k < nS; k++) {
      const th = (k / nS) * 6.2832, ct = Math.cos(th), st = Math.sin(th), rad = rw * sa * (1 + tri * Math.cos(th * 3));
      const o = [e1[0] * ct + e2[0] * st, e1[1] * ct + e2[1] * st, e1[2] * ct + e2[2] * st];
      const n = norm([ax[0] * ca / rl + o[0] * sa / rw, ax[1] * ca / rl + o[1] * sa / rw, ax[2] * ca / rl + o[2] * sa / rw]);
      const sh = shade * (0.9 + 0.1 * Math.cos(th * 3));
      b.vert(cx + ax[0] * ca * rl + o[0] * rad, cy + ax[1] * ca * rl + o[1] * rad, cz + ax[2] * ca * rl + o[2] * rad, n[0], n[1], n[2], 0, 0, col[0] * sh, col[1] * sh, col[2] * sh);
    }
  }
  const gi = b.grp(part, 'paint').idx;
  for (let i = 0; i < nR; i++) for (let k = 0; k < nS; k++) {
    const a = base + i * nS + k, bb = base + i * nS + ((k + 1) % nS), c2 = a + nS, d = bb + nS;
    gi.push(a, bb, d, a, d, c2);
  }
}
// pieces of one fruit group on a tree: returns their local centres so the tree field can drop them from exactly where they hung
function fruitGroups(c, kind, anchor, spread, yLo, yHi) {
  const { b, W, rn } = c, groups = [], a0 = rn() * 6.283;
  for (let g = 0; g < FRUIT_GROUPS.length; g++) {
    const list = [], az = a0 + (g / FRUIT_GROUPS.length) * 6.283 + (rn() - 0.5) * 0.4;
    for (let k = 0; k < FRUIT_GROUPS[g]; k++) {
      const a = az + (rn() - 0.5) * 0.5, r = spread * (0.85 + 0.3 * rn()), y = yLo + (yHi - yLo) * rn();
      const px = anchor[0] + Math.cos(a) * r, py = anchor[1] + y, pz = anchor[2] + Math.sin(a) * r;
      if (kind === 'coconut') {
        const ripe = rn() < 0.4, col = ripe ? [0.25 + rn() * 0.05, 0.16 + rn() * 0.04, 0.07] : [0.12 + rn() * 0.05, 0.2 + rn() * 0.05, 0.04];
        const ax = norm([Math.cos(a) * 0.18 + (rn() - 0.5) * 0.15, -1, Math.sin(a) * 0.18 + (rn() - 0.5) * 0.15]);
        ellipsoid(b, W.nuts[g], px, py, pz, 0.1, 0.14, ax, col, 0.07);
        list.push([px, py, pz]);
      } else {
        const blush = rn() < 0.45, col = blush ? [0.5 + rn() * 0.1, 0.4 + rn() * 0.08, 0.06] : [0.22 + rn() * 0.06, 0.34 + rn() * 0.06, 0.05];
        const ax = norm([(rn() - 0.5) * 0.3, -1, (rn() - 0.5) * 0.3]);
        ellipsoid(b, W.nuts[g], px, py, pz, 0.055, 0.085, ax, col, 0.0);
        list.push([px, py, pz]);
      }
    }
    groups.push(list);
  }
  c.fruitPos = groups;
}

function palm(c, sp, t, h, cr) {   // curved ringed trunk, crownshaft, 16 arched fronds each of three hinged quads
  const { b, W, rn } = c;
  const x0 = t.x, z0 = t.z, lean = (rn() - 0.5) * 0.5, az0 = rn() * 6.283, nS = 5, sl = h / nS;
  let P = [x0, 0, z0];
  tube(c, [x0, -0.12, z0], [x0, 0.4, z0], sp.trunk * 1.5, sp.trunk * 1.08, 6);
  for (let i = 0; i < nS; i++) {
    const tl = lean * (0.35 + i * 0.3), Q = mad(P, dir(tl, az0), sl), rA = sp.trunk * (1 - i * 0.08), rB = sp.trunk * (1 - (i + 1) * 0.08);
    for (let k = 0; k < 3; k++) {   // stacked rings: every third of a segment steps out a little, like leaf-scar ridges
      const a = lerp3(P, Q, k / 3), e = lerp3(P, Q, (k + 1) / 3), ra = rA + (rB - rA) * (k / 3), re = rA + (rB - rA) * ((k + 1) / 3);
      tube(c, a, e, ra * 0.94, re * 1.07, 5);
    }
    P = Q;
  }
  c.cen = [P[0], P[1] - 0.2, P[2]]; c.R = cr * 2.2;
  const n = 16, Lf = cr * 2.0, wf = Lf * 0.72, segs = 3;
  tube(c, mad(P, [0, 1, 0], -0.5), mad(P, [0, 1, 0], 0.18), sp.trunk * 0.95, sp.trunk * 1.35, 6);   // crownshaft
  fruitGroups(c, 'coconut', P, sp.trunk * 1.5 + 0.12, -0.78, -0.5);                                    // coconuts hang in bunches just under the crown
  for (let i = 0; i < n; i++) {
    const az = (i / n) * 6.283 + (rn() - 0.5) * 0.3, rv = [Math.sin(az), 0, Math.cos(az)];
    let ph = 0.5 + rn() * 0.35, q = mad(P, [0, 1, 0], 0.1);
    const ring = [q];
    for (let s = 0; s < segs; s++) { q = mad(q, dir(ph, az), Lf / segs); ring.push(q); ph += 0.5 + rn() * 0.22; }
    const base = b.nv, v0 = CELL.palm[1] * 0.5 + 0.006, v1 = CELL.palm[1] * 0.5 + 0.494, lc = c.lc;
    ring.forEach((pt, k) => {
      const nx = ring[Math.min(k + 1, segs)], pv = ring[Math.max(k - 1, 0)], tg = norm([nx[0] - pv[0], nx[1] - pv[1], nx[2] - pv[2]]);
      let nn = cross(rv, tg); if (nn[1] < 0) nn = [-nn[0], -nn[1], -nn[2]];
      const f = k / segs, sag = wf * 0.09 * (k ? 1 : 0.5), vv = v1 - (v1 - v0) * f, ao = 0.6 + 0.4 * f;
      for (const sx of [-1, 1]) b.vert(pt[0] + rv[0] * sx * wf / 2, pt[1] + rv[1] * sx * wf / 2 - sag, pt[2] + rv[2] * sx * wf / 2, nn[0], nn[1], nn[2], (CELL.palm[0] + (sx < 0 ? 0.016 : 0.984)) * 0.25 - (sx < 0 ? 0 : 0.0) , vv, lc[0] * ao, lc[1] * ao, lc[2] * ao);
    });
    const gi = b.grp(W.leaf, 'paint').idx;
    for (let s = 0; s < segs; s++) { const a = base + s * 2; gi.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
}

function shrub(c, sp, t, h, cr) {
  const { rn } = c, x0 = t.x, z0 = t.z;
  c.cen = [x0, h * 0.5, z0]; c.R = cr * 1.3 + 0.2;
  const n = 9 + (rn() > 0.5 ? 2 : 0), size = Math.max(cr * 2.0, h * 0.95);
  for (let i = 0; i < n; i++) {
    const a = rn() * 6.283, ph = 0.25 + rn() * 0.8, d = cr * 0.25 * rn(), up = dir(ph, a), sz = size * (0.8 + rn() * 0.35);
    card(c, [x0 + Math.cos(a) * d, 0.02, z0 - Math.sin(a) * d], up, sz, sz * 0.92, CELL.shrub, rn() * 6.283);
  }
  // flowering shrubs (ixora / hibiscus / marigold style): clusters of blossoms on the outside of the crown. The painted cluster is red-orange; the tint turns it yellow, orange, pink or deep red.
  if (rn() < 0.7) {
    const TINTS = [[1, 1, 1], [1, 2.4, 1], [1, 7.5, 3.5], [1, 2.4, 14], [0.85, 0.5, 0.5]], tint = TINTS[Math.floor(rn() * TINTS.length)], ao0 = c.ao0;
    c.ao0 = 0.95;
    const nf = 6 + Math.floor(rn() * 5);
    for (let i = 0; i < nf; i++) {
      const a = rn() * 6.283, ph = 0.2 + rn() * 0.7, up = dir(ph, a), rr = cr * (0.35 + rn() * 0.4), y = h * (0.35 + rn() * 0.55), sz = 0.16 + rn() * 0.12;
      card(c, [x0 + Math.cos(a) * rr, y, z0 - Math.sin(a) * rr], up, sz, sz * 0.9, CELL.flower, rn() * 6.283, null, tint);
    }
    c.ao0 = ao0;
  }
}

// b: Builder (vertices already offset), W: { trunk, leaf } part ids, name: species key in TREES, col: leaf colour multiplier
export function addTree(b, W, name, sp, t, h, cr, col) {
  const rn = mulberry32(Math.floor((t.s * 7919 + t.s2 * 104729 + t.s3 * 1299709) * 1000) + 1);
  const c = { b, W, rn, bk: 0.82 + rn() * 0.34, lc: col, cen: [t.x, h * 0.5, t.z], R: 2 };
  if (sp.kind === 'palm') palm(c, sp, t, h, cr);
  else if (sp.kind === 'conifer') conifer(c, sp, t, h, cr);
  else if (name === 'shrub') shrub(c, sp, t, h, cr);
  else if (name === 'babool') babool(c, sp, t, h, cr);
  else broad(c, ARCH[name] || ARCH.neem, sp, t, h, cr);
  if (name === 'mango') fruitGroups(c, 'mango', [c.cen[0], c.cen[1], c.cen[2]], cr * 0.62, -cr * 0.55, -cr * 0.1);   // mangoes hang under the outer crown
  return c.fruitPos || null;
}
