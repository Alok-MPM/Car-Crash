// LEAF ART: every leaf, frond, blossom and fruit-leaf of the game is painted here once, procedurally, at 2x and then reduced into one foliage atlas (2048 x 1024).
//  - LEFT half  (1024 x 1024, 4 x 4 cells of 256): "clump" cards = leafy tufts for the middle distance. They are built by stamping the SAME leaf pictures as the real 3D leaves, so a tree
//    changes from individual leaves to cards without changing colour or leaf shape.
//  - RIGHT half (1024 x 1024, 4 x 4 slots of 256): ONE leaf (or compound leaf / palm leaflet / blossom) per slot. Real 3D leaves (treegen.js) map exactly the painted rectangle (LEAF[name].uv).
// Leaves are painted in a neutral bright green; the species hue, the canopy shade and the per-leaf variation are vertex colours.
import { mulberry32 } from '../../core/math.js';

export const AW = 2048, AH = 1024, CL = 256;
export const CELL = { broad: [0, 0], ashoka: [1, 0], palm: [2, 0], shrub: [3, 0], neem: [0, 1], gul: [1, 1], flower: [2, 1], babool: [3, 1], mango: [0, 2], apple: [1, 2], banyan: [2, 2] };
export const SLOT = { mango: [0, 0], banyan: [1, 0], apple: [2, 0], ashoka: [3, 0], neem: [0, 1], gul: [1, 1], babool: [2, 1], palm: [3, 1], shrub: [0, 2], gulflower: [1, 2], shrubflower: [2, 2], neemlet: [3, 2], gulpinna: [0, 3], baboolpinna: [1, 3] };
export const LEAF = {};   // name -> { u0, u1, v0, v1, asp (width / height of the painted rectangle), spr (small canvas), sw, sh, ax, ay }
const TAU = 6.2831853;
const rgb = (r, g, b, k = 1) => `rgb(${Math.min(255, r * k) | 0},${Math.min(255, g * k) | 0},${Math.min(255, b * k) | 0})`;
const lerp = (a, b, t) => a + (b - a) * t;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// ---------------------------------------------------------------- one leaf: outline, gradient, mottling, veins, midrib. Local frame: base at (0, 0), tip at (0, -len), canvas y down.
function prof(t, o) { return o.hw * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, o.a))), o.b); }
function outline(g, o) {
  const N = o.N || 56, as = o.asym || 1, bend = o.bend || 0;
  const edge = (s) => {
    const p = [];
    for (let i = 1; i <= N; i++) {
      const t = i / N;
      let w = prof(t, o) * (s > 0 ? as : 1 / as);
      if (o.wave) w *= 1 + o.wave * Math.sin(t * o.wn * TAU + (s > 0 ? 0 : 1.9));
      if (o.tooth && i > 2 && i < N - 1) w += i % 2 ? o.tooth * 0.5 : -o.tooth * 0.15;
      p.push([s * Math.max(0, w) + bend * o.len * t * t, -o.len * t]);
    }
    return p;
  };
  const R = edge(1), L = edge(-1);
  g.beginPath(); g.moveTo(0, 0);
  for (const q of R) g.lineTo(q[0], q[1]);
  for (let i = L.length - 2; i >= 0; i--) g.lineTo(L[i][0], L[i][1]);
  g.closePath();
}
function paintLeaf(g, o, seed) {
  const rn = mulberry32(seed), len = o.len;
  if (o.pet) { g.strokeStyle = rgb(112, 142, 62); g.lineWidth = o.pet.w; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, o.pet.l); g.lineTo(0, -2); g.stroke(); }
  outline(g, o);
  const gr = g.createLinearGradient(0, 0, 0, -len);
  o.col.forEach((c, i) => gr.addColorStop(i / (o.col.length - 1), rgb(c[0], c[1], c[2])));
  g.fillStyle = gr; g.fill();
  g.save(); g.clip();
  const sh = g.createLinearGradient(-o.hw, 0, o.hw, 0);   // the two halves of a leaf fold a little: darker towards the margins
  sh.addColorStop(0, 'rgba(8,34,6,0.30)'); sh.addColorStop(0.32, 'rgba(8,34,6,0)'); sh.addColorStop(0.68, 'rgba(8,34,6,0)'); sh.addColorStop(1, 'rgba(8,34,6,0.30)');
  g.fillStyle = sh; g.fillRect(-o.hw * 1.4, -len, o.hw * 2.8, len);
  for (let i = 0; i < (o.mot ?? 70); i++) {   // organic cellular mottling
    g.fillStyle = rn() > 0.5 ? 'rgba(190,236,96,0.075)' : 'rgba(14,48,10,0.085)';
    g.beginPath(); g.arc((rn() * 2 - 1) * o.hw, -rn() * len, 5 + rn() * 15, 0, TAU); g.fill();
  }
  const nv = o.veins | 0, vf = o.vf || 0.15;
  g.lineCap = 'round';
  for (let k = 1; k <= nv; k++) {   // pinnate lateral veins sweeping forward to the margin
    const t0 = 0.06 + 0.86 * k / (nv + 1);
    for (const s of [-1, 1]) {
      const t1 = Math.min(0.995, t0 + vf), w1 = prof(t1, o) * 0.9, w0 = prof(t0 + vf * 0.3, o) * 0.5;
      g.strokeStyle = 'rgba(176,224,104,0.55)'; g.lineWidth = Math.max(1.4, 3.2 * (1 - t0 * 0.5));
      g.beginPath(); g.moveTo(0, -len * t0); g.quadraticCurveTo(s * w0, -len * (t0 + vf * 0.2), s * w1, -len * t1); g.stroke();
      if (o.fine) { g.strokeStyle = 'rgba(176,224,104,0.22)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(s * w0 * 0.6, -len * (t0 + vf * 0.12)); g.lineTo(s * w1 * 0.8, -len * (t1 - vf * 0.25)); g.stroke(); }
    }
  }
  g.fillStyle = o.mid || 'rgba(198,230,128,0.95)';   // midrib: pale yellow-green, tapering
  const mw = o.hw * 0.07 + 2;
  g.beginPath(); g.moveTo(-mw, 0); g.lineTo(-0.8, -len * 0.94); g.lineTo(0.8, -len * 0.94); g.lineTo(mw, 0); g.closePath(); g.fill();
  g.restore();
  outline(g, o); g.strokeStyle = o.edge || 'rgba(34,74,20,0.5)'; g.lineWidth = 1.8; g.stroke();
}
const at = (g, x, y, rot, fn) => { g.save(); g.translate(x, y); g.rotate(rot); fn(); g.restore(); };

const LEAF_DEF = {
  mango: { len: 470, hw: 58, a: 0.86, b: 0.8, N: 64, wave: 0.04, wn: 8, veins: 15, vf: 0.12, col: [[46, 108, 34], [78, 146, 46], [108, 172, 60]], pet: { l: 20, w: 7 } },
  banyan: { len: 430, hw: 142, a: 0.72, b: 0.62, N: 52, veins: 9, vf: 0.2, col: [[50, 112, 38], [84, 152, 48], [112, 172, 60]], pet: { l: 22, w: 8 }, fine: 1 },
  apple: { len: 470, hw: 116, a: 0.78, b: 1.0, N: 46, tooth: 9, veins: 10, vf: 0.16, col: [[96, 172, 48], [86, 162, 42], [70, 140, 34]], pet: { l: 22, w: 7 }, fine: 1 },
  ashoka: { len: 480, hw: 46, a: 0.92, b: 0.72, N: 76, wave: 0.14, wn: 15, veins: 20, vf: 0.07, col: [[44, 104, 34], [74, 140, 44], [100, 164, 56]], pet: { l: 14, w: 6 }, mot: 40 },
  shrub: { len: 400, hw: 126, a: 0.8, b: 0.9, N: 44, veins: 8, vf: 0.18, col: [[54, 116, 38], [88, 156, 50], [112, 174, 62]], pet: { l: 16, w: 6 } },
};
const LEAFLET_NEEM = { len: 200, hw: 38, a: 0.9, b: 0.85, N: 34, tooth: 8, asym: 1.3, bend: 0.1, veins: 8, vf: 0.18, col: [[78, 130, 36], [118, 168, 52], [160, 200, 72]], mot: 18 };

function paintNeem(g, rn) {   // pinnate compound leaf: 12 sickle-shaped serrated leaflets, alternate, over a curved rachis
  const L = 340, N = 12, rx = (t) => 20 * Math.sin(t * 2.4) * t;
  g.strokeStyle = rgb(120, 150, 64); g.lineCap = 'round';
  for (let i = 0; i < 30; i++) { const t = i / 30, t2 = (i + 1) / 30; g.lineWidth = 7 - 4 * t; g.beginPath(); g.moveTo(rx(t), -L * t); g.lineTo(rx(t2), -L * t2); g.stroke(); }
  for (let i = 0; i < N; i++) {
    const t = 0.1 + 0.8 * i / (N - 1), s = i % 2 ? 1 : -1, size = lerp(0.8, 0.5, t) * (0.92 + rn() * 0.16);
    at(g, rx(t), -L * t, s * (0.92 + rn() * 0.18), () => paintLeaf(g, { ...LEAFLET_NEEM, len: LEAFLET_NEEM.len * size, hw: LEAFLET_NEEM.hw * size, asym: s > 0 ? 1.3 : 0.77 }, 100 + i));
  }
  at(g, rx(1), -L, 0.08, () => paintLeaf(g, { ...LEAFLET_NEEM, len: 125, hw: 24, asym: 1 }, 99));
  return [256 - 175, 496 - L - 128, 256 + 175, 506];
}
function leaflet(g, x, y, ang, l, w, col) {
  at(g, x, y, ang, () => {
    g.fillStyle = col; g.beginPath(); g.ellipse(0, -l / 2, w / 2, l / 2, 0, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(206,232,140,0.55)'; g.lineWidth = Math.max(0.8, w * 0.12); g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -l * 0.94); g.stroke();
  });
}
function pinnae(g, rn, o) {   // bipinnate: rachis -> pairs of pinnae -> pairs of tiny leaflets (gulmohar, babool)
  const L = o.L;
  const rx = (t) => o.arch * Math.sin(t * 2.2) * t;
  g.strokeStyle = rgb(104, 128, 54); g.lineCap = 'round';
  for (let i = 0; i < 26; i++) { const t = i / 26, t2 = (i + 1) / 26; g.lineWidth = 6.5 - 3.5 * t; g.beginPath(); g.moveTo(rx(t), -L * t); g.lineTo(rx(t2), -L * t2); g.stroke(); }
  for (let k = 0; k < o.np; k++) {
    const t = 0.1 + 0.84 * k / (o.np - 1), size = Math.sin(Math.PI * (0.18 + 0.72 * t)) * 0.9 + 0.12;
    for (const s of [-1, 1]) {
      const pa = s * (1.28 - 0.22 * t), pl = o.pl * size, px = rx(t), py = -L * t, nl = o.nl;
      g.strokeStyle = rgb(110, 134, 58); g.lineWidth = 3; g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.sin(pa) * pl, py - Math.cos(pa) * pl); g.stroke();
      for (let j = 1; j <= nl; j++) {
        const q = j / (nl + 0.5), cx = px + Math.sin(pa) * pl * q, cy = py - Math.cos(pa) * pl * q, ls = o.ll * (1 - 0.35 * q) * (0.9 + rn() * 0.2), sh = 0.82 + rn() * 0.36;
        const col = rgb(o.c[0] * sh, o.c[1] * sh, o.c[2] * sh);
        leaflet(g, cx, cy, pa + 1.2, ls, ls * o.lw, col); leaflet(g, cx, cy, pa - 1.2, ls, ls * o.lw, col);
      }
    }
  }
  leaflet(g, rx(1), -L, 0, o.ll * 1.1, o.ll * o.lw * 1.1, rgb(o.c[0], o.c[1], o.c[2]));
}
function paintGul(g, rn) { pinnae(g, rn, { L: 440, arch: 22, np: 11, pl: 140, nl: 12, ll: 27, lw: 0.34, c: [98, 170, 58] }); return [256 - 180, 496 - 470, 256 + 180, 506]; }
function paintBabool(g, rn) { pinnae(g, rn, { L: 410, arch: 18, np: 8, pl: 100, nl: 12, ll: 21, lw: 0.28, c: [122, 146, 58] }); return [256 - 135, 496 - 440, 256 + 135, 506]; }
// single pieces of the compound leaves: the 3D tree builds neem / gulmohar / babool leaves from these, one quad each, so every leaflet (every feather) is its own little surface
function paintNeemlet(g) { paintLeaf(g, { ...LEAFLET_NEEM, len: 450, hw: 84, asym: 1.18, bend: 0.05, mot: 30, N: 40, tooth: 10, veins: 9, pet: { l: 16, w: 7 } }, 120); return [256 - 130, 496 - 450, 256 + 130, 514]; }
function singlePinna(g, rn, o) {
  const L = o.L;
  g.strokeStyle = rgb(108, 132, 56); g.lineCap = 'round';
  for (let i = 0; i < 20; i++) { const t = i / 20, t2 = (i + 1) / 20; g.lineWidth = 6 - 3.4 * t; g.beginPath(); g.moveTo(0, -L * t); g.lineTo(0, -L * t2); g.stroke(); }
  for (let j = 1; j <= o.nl; j++) {
    const q = j / (o.nl + 0.6), cy = -L * q, ls = o.ll * (1 - 0.4 * q) * (0.92 + rn() * 0.16), sh = 0.84 + rn() * 0.32, col = rgb(o.c[0] * sh, o.c[1] * sh, o.c[2] * sh);
    leaflet(g, 0, cy, 1.2 - 0.25 * q, ls, ls * o.lw, col); leaflet(g, 0, cy, -1.2 + 0.25 * q, ls, ls * o.lw, col);
  }
  leaflet(g, 0, -L, 0, o.ll * 0.9, o.ll * o.lw * 0.9, rgb(o.c[0], o.c[1], o.c[2]));
}
function paintGulPinna(g, rn) { singlePinna(g, rn, { L: 430, nl: 13, ll: 52, lw: 0.34, c: [98, 170, 58] }); return [256 - 90, 496 - 450, 256 + 90, 508]; }
function paintBaboolPinna(g, rn) { singlePinna(g, rn, { L: 400, nl: 11, ll: 44, lw: 0.3, c: [122, 146, 58] }); return [256 - 76, 496 - 420, 256 + 76, 508]; }
function paintPalmLeaflet(g) {
  const len = 480, o = { len, hw: 15, a: 0.36, b: 0.5, N: 40, veins: 0, col: [[70, 128, 36], [92, 152, 46], [112, 170, 56]], mot: 10, mid: 'rgba(190,214,120,0.9)' };
  paintLeaf(g, o, 7);
  g.save(); outline(g, o); g.clip();
  g.strokeStyle = 'rgba(150,200,90,0.45)'; g.lineWidth = 1.4;
  for (const s of [-1, 1]) for (const f of [0.35, 0.65]) { g.beginPath(); g.moveTo(s * o.hw * f * 0.9, -20); g.lineTo(s * o.hw * f * 0.3, -len * 0.9); g.stroke(); }
  g.restore();
}
function paintGulFlower(g, rn) {   // five-petalled vermilion blossom: four ruffled red petals, one white-and-yellow streaked standard, long red stamens
  const petal = (ang, len, wid, std) => at(g, 0, 0, ang, () => {
    g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(-wid * 0.2, -len * 0.25, -wid * 0.55, -len * 0.5, -wid * 0.42, -len * 0.82);
    for (let i = 0; i <= 6; i++) { const f = i / 6, x = lerp(-wid * 0.42, wid * 0.42, f), y = -len * (0.9 + 0.1 * Math.sin(f * Math.PI)) - Math.abs(Math.sin(f * Math.PI * 3)) * len * 0.035; g.lineTo(x, y); }
    g.bezierCurveTo(wid * 0.55, -len * 0.5, wid * 0.2, -len * 0.25, 0, 0); g.closePath();
    const gr = g.createRadialGradient(0, -len * 0.35, 4, 0, -len * 0.55, len * 0.62);
    if (std) { gr.addColorStop(0, 'rgb(250,214,110)'); gr.addColorStop(0.45, 'rgb(250,236,200)'); gr.addColorStop(1, 'rgb(246,246,236)'); } else { gr.addColorStop(0, 'rgb(188,32,18)'); gr.addColorStop(0.55, 'rgb(228,58,28)'); gr.addColorStop(1, 'rgb(246,100,48)'); }
    g.fillStyle = gr; g.fill(); g.save(); g.clip();
    g.strokeStyle = std ? 'rgba(220,60,40,0.8)' : 'rgba(120,14,10,0.42)'; g.lineWidth = std ? 3.2 : 2;
    for (let i = -5; i <= 5; i++) { g.beginPath(); g.moveTo(0, -len * 0.06); g.quadraticCurveTo(i * wid * 0.05, -len * 0.45, i * wid * 0.085, -len * 0.9); g.stroke(); }
    g.restore();
  });
  const A = [-1.15, -0.45, 0.45, 1.15];
  for (const a of A) petal(a, 200, 190, false);
  g.strokeStyle = 'rgb(214,40,30)'; g.lineCap = 'round';
  for (let i = 0; i < 9; i++) { const a = -0.9 + i * 0.22; g.lineWidth = 2.6; g.beginPath(); g.moveTo(0, -8); g.quadraticCurveTo(Math.sin(a) * 70, -150, Math.sin(a) * 140, -196 + Math.abs(a) * 40); g.stroke(); g.fillStyle = 'rgb(96,18,10)'; g.beginPath(); g.ellipse(Math.sin(a) * 140, -196 + Math.abs(a) * 40, 6, 3.4, a, 0, TAU); g.fill(); }
  petal(0.04, 215, 160, true);
}
function paintShrubFlower(g, rn) {   // ixora-like umbel: 11 four-petal florets
  g.strokeStyle = rgb(70, 110, 40); g.lineWidth = 4; g.lineCap = 'round';
  const F = [];
  for (let i = 0; i < 11; i++) { const a = rn() * TAU, r = Math.sqrt(rn()) * 115; F.push([Math.cos(a) * r, -(200 + Math.sin(a) * r * 0.8)]); }
  for (const [x, y] of F) { g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(x * 0.2, y * 0.5, x, y); g.stroke(); }
  F.sort((a, b) => a[1] - b[1]);
  for (const [x, y] of F) {
    const rot = rn() * TAU, k = 0.88 + rn() * 0.24;
    for (let p = 0; p < 4; p++) { const a = rot + p * 1.5708; g.fillStyle = rgb(236 * k, 74 * k, 40 * k); g.beginPath(); g.ellipse(x + Math.cos(a) * 24, y + Math.sin(a) * 24, 28, 14, a, 0, TAU); g.fill(); g.strokeStyle = 'rgba(140,30,20,0.4)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * 44, y + Math.sin(a) * 44); g.stroke(); }
    g.fillStyle = rgb(248, 214, 110); g.beginPath(); g.arc(x, y, 6, 0, TAU); g.fill();
  }
}

// ---------------------------------------------------------------- atlas painting
let BASE = null;
const SPB = new Map();
function sprite(name, k) {   // brightness-binned copy of a leaf picture
  const b = Math.max(3, Math.min(18, Math.round(k * 10))), key = name + b;
  let c = SPB.get(key); if (c) return c;
  const L = LEAF[name]; c = mk(L.spr.width, L.spr.height);
  const x = c.getContext('2d'); x.drawImage(L.spr, 0, 0);
  x.globalCompositeOperation = 'source-atop';
  const kk = b / 10; x.fillStyle = kk < 1 ? `rgba(0,0,0,${1 - kk})` : `rgba(255,246,190,${(kk - 1) * 0.5})`;
  x.fillRect(0, 0, c.width, c.height);
  SPB.set(key, c); return c;
}
const SPT = new Map();
function tinted(name, k, tt) {   // a leaf picture multiplied by a species colour (for the far-away tree pictures)
  const b = Math.max(3, Math.min(18, Math.round(k * 10))), key = name + b + '|' + tt.key;
  let c = SPT.get(key); if (c) return c;
  const src = sprite(name, k); c = mk(src.width, src.height);
  const x = c.getContext('2d'); x.drawImage(src, 0, 0);
  x.globalCompositeOperation = 'multiply'; x.fillStyle = rgb(tt.rgb[0] * 255, tt.rgb[1] * 255, tt.rgb[2] * 255); x.fillRect(0, 0, c.width, c.height);
  x.globalCompositeOperation = 'destination-in'; x.drawImage(src, 0, 0);
  SPT.set(key, c); return c;
}
export function stampLeaf(g, name, x, y, ang, len, k, ws = 1, tt = null) {   // base of the leaf at (x, y), tip pointing along `ang` (0 = up), `len` long in the current units
  const L = LEAF[name], c = tt ? tinted(name, k, tt) : sprite(name, k), s = len / L.sh, cs = Math.cos(ang), sn = Math.sin(ang);
  g.transform(cs * s * ws, sn * s * ws, -sn * s, cs * s, x, y); g.drawImage(c, -L.ax, -L.ay); g.setTransform(BASE);
}
export function setBase(m) { BASE = m; }

function paintLeaves(g) {
  const jobs = {
    mango: (c, rn) => { paintLeaf(c, LEAF_DEF.mango, 1); return [256 - 66, 496 - 480, 256 + 66, 516]; },
    banyan: (c, rn) => { paintLeaf(c, LEAF_DEF.banyan, 2); return [256 - 150, 496 - 436, 256 + 150, 520]; },
    apple: (c, rn) => { paintLeaf(c, LEAF_DEF.apple, 3); return [256 - 128, 496 - 476, 256 + 128, 520]; },
    ashoka: (c, rn) => { paintLeaf(c, LEAF_DEF.ashoka, 4); return [256 - 58, 496 - 486, 256 + 58, 512]; },
    shrub: (c, rn) => { paintLeaf(c, LEAF_DEF.shrub, 5); return [256 - 134, 496 - 406, 256 + 134, 514]; },
    neem: (c, rn) => paintNeem(c, rn),
    gul: (c, rn) => paintGul(c, rn),
    babool: (c, rn) => paintBabool(c, rn),
    palm: (c) => { paintPalmLeaflet(c); return [256 - 22, 496 - 486, 256 + 22, 500]; },
    neemlet: (c) => paintNeemlet(c),
    gulpinna: (c, rn) => paintGulPinna(c, rn),
    baboolpinna: (c, rn) => paintBaboolPinna(c, rn),
    gulflower: (c, rn) => { paintGulFlower(c, rn); return [256 - 250, 496 - 232, 256 + 250, 508]; },
    shrubflower: (c, rn) => { paintShrubFlower(c, rn); return [256 - 180, 496 - 350, 256 + 180, 508]; },
  };
  let n = 0;
  for (const name of Object.keys(jobs)) {
    const cv = mk(512, 512), c = cv.getContext('2d'), rn = mulberry32(911 + n * 37); n++;
    c.translate(256, 496);
    const bb = jobs[name](c, rn);
    c.setTransform(1, 0, 0, 1, 0, 0);
    // into the atlas slot (2x -> 1x)
    const [sc, sr] = SLOT[name], sx = AW / 2 + sc * CL, sy = sr * CL;
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(cv, 0, 0, 512, 512, sx, sy, CL, CL);
    const x0 = Math.max(0, bb[0]), y0 = Math.max(0, bb[1]), x1 = Math.min(512, bb[2]), y1 = Math.min(512, bb[3]);
    LEAF[name] = { u0: (sx + x0 / 2) / AW, u1: (sx + x1 / 2) / AW, v0: (sy + y0 / 2) / AH, v1: (sy + y1 / 2) / AH, asp: (x1 - x0) / (y1 - y0) };
    // small reusable sprite for stamping (cropped, 160 px high at most)
    const k = Math.min(1, 160 / (y1 - y0)), sw = Math.max(2, Math.round((x1 - x0) * k)), sh = Math.max(2, Math.round((y1 - y0) * k));
    const sp = mk(sw, sh), sg = sp.getContext('2d'); sg.imageSmoothingQuality = 'high'; sg.drawImage(cv, x0, y0, x1 - x0, y1 - y0, 0, 0, sw, sh);
    Object.assign(LEAF[name], { spr: sp, sw, sh, ax: (256 - x0) * k, ay: (496 - y0) * k });
  }
}

// a clump: leaves radiating from the middle (outer ones brighter), over a dark core so the middle of the card is never see-through
function clump(g, rn, o) {
  const cx = 128, cy = o.cy ?? 128, R = o.R, base = o.core || [30, 60, 22];
  g.fillStyle = rgb(base[0], base[1], base[2]); g.beginPath(); g.ellipse(cx, cy, R * (o.cr || 0.5), R * (o.cr || 0.5) * 0.95 * (o.sy || 1), 0, 0, TAU); g.fill();
  const L = [], Rt = 113;   // every leaf must end inside a circle of Rt around the middle of the cell: the card then has a round, leafy outline instead of a square one
  for (let i = 0; i < o.n; i++) {
    for (let tries = 0; tries < 10; tries++) {
      const a = rn() * TAU, r = Math.sqrt(rn()) * R, x = Math.cos(a) * r, y = Math.sin(a) * r * (o.sy || 1), f = r / R;
      const ang = o.hang ? Math.PI + (rn() - 0.5) * 1.1 : a + Math.PI / 2 + (rn() - 0.5) * (o.jit ?? 1.2);
      const len0 = lerp(o.len[0], o.len[1], rn()) * (1 - 0.18 * (1 - f));
      const ux = cx + x - 128, uy = cy + y - 128, dx = Math.sin(ang), dy = -Math.cos(ang), ud = ux * dx + uy * dy, uu = ux * ux + uy * uy;
      if (uu > Rt * Rt) continue;
      const room = (-ud + Math.sqrt(Math.max(0, ud * ud - uu + Rt * Rt))) * 0.9;
      if (room < len0 * 0.5 && tries < 9) continue;
      L.push({ r, x, y, a, ang, len: Math.min(len0, Math.max(room, len0 * 0.4)), f }); break;
    }
  }
  L.sort((p, q) => p.r - q.r);
  for (const l of L) {
    const k = lerp(o.k[0], o.k[1], l.f) * (0.86 + rn() * 0.28) + 0.22 * (-l.y / R);
    stampLeaf(g, o.leaf, cx + l.x, cy + l.y, l.ang, l.len, k, o.wscale ?? 1);
  }
}
function sprayPalm(g, rn) {   // one arched pinnate frond: rachis + stamped leaflets hanging in pairs
  const P0 = [128, 250], P1 = [112, 118], P2 = [150, 26];
  const B = (t) => [(1 - t) * (1 - t) * P0[0] + 2 * (1 - t) * t * P1[0] + t * t * P2[0], (1 - t) * (1 - t) * P0[1] + 2 * (1 - t) * t * P1[1] + t * t * P2[1]];
  const Tg = (t) => Math.atan2(2 * (1 - t) * (P1[0] - P0[0]) + 2 * t * (P2[0] - P1[0]), -(2 * (1 - t) * (P1[1] - P0[1]) + 2 * t * (P2[1] - P1[1])));
  const n = 34;
  for (let i = 0; i < n; i++) {
    const t = 0.05 + 0.93 * i / (n - 1), p = B(t), ta = Tg(t), len = 36 + 86 * Math.sin(Math.PI * Math.pow(t, 0.75));
    for (const sd of [-1, 1]) stampLeaf(g, 'palm', p[0], p[1], ta + sd * (0.95 - 0.4 * t + (rn() - 0.5) * 0.18), len * (0.92 + 0.16 * rn()), 0.75 + 0.45 * rn(), 1.5);
  }
  g.lineCap = 'round'; g.strokeStyle = rgb(112, 124, 62);
  for (let i = 0; i < 20; i++) { const a = B(i / 20), b = B((i + 1) / 20); g.lineWidth = 4.2 - 2.6 * (i / 20); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
}
function sprayBabool(g, rn) {
  clump(g, rn, { leaf: 'babool', n: 70, R: 112, len: [64, 100], k: [0.6, 1.2], core: [60, 72, 28], sy: 0.9, jit: 1.7, cr: 0.4 });
  g.strokeStyle = rgb(212, 206, 186); g.lineWidth = 1.6;
  for (let i = 0; i < 14; i++) { const x = 40 + rn() * 176, y = 40 + rn() * 176; g.beginPath(); g.moveTo(x, y); g.lineTo(x - 6, y - 3); g.moveTo(x, y); g.lineTo(x + 6, y - 3); g.stroke(); }
  for (let i = 0; i < 8; i++) { const x = 60 + rn() * 136, y = 50 + rn() * 150; g.fillStyle = rgb(240, 208, 56); g.beginPath(); g.arc(x, y, 4.5, 0, TAU); g.fill(); g.fillStyle = rgb(252, 236, 120); g.beginPath(); g.arc(x - 1, y - 1, 2, 0, TAU); g.fill(); }
}
function sprayFlower(g, rn) {   // gulmohar blossom clump: feathery leaves with ~16 stamped blossoms on top
  clump(g, rn, { leaf: 'gul', n: 26, R: 112, len: [80, 116], k: [0.55, 1.1], core: [40, 86, 30], sy: 0.95, cr: 0.42 });
  const cl = [];
  for (let i = 0; i < 18; i++) { const a = rn() * TAU, r = Math.sqrt(rn()) * 66; cl.push([128 + Math.cos(a) * r, 128 + Math.sin(a) * r * 0.95]); }
  cl.sort((a, b) => Math.hypot(a[0] - 128, a[1] - 128) - Math.hypot(b[0] - 128, b[1] - 128));
  for (const [x, y] of cl) stampLeaf(g, 'gulflower', x, y + 22, (rn() - 0.5) * 3, 48 + rn() * 14, 0.85 + rn() * 0.3, 1);
}

export function paintAtlas() {
  const cv = mk(AW, AH), g = cv.getContext('2d', { willReadFrequently: true });
  paintLeaves(g);
  const cells = {
    broad: (rn) => clump(g, rn, { leaf: 'banyan', n: 95, R: 112, len: [52, 74], k: [0.5, 1.15], core: [26, 56, 20] }),
    mango: (rn) => clump(g, rn, { leaf: 'mango', n: 120, R: 114, len: [74, 104], k: [0.5, 1.15], core: [24, 52, 20], jit: 1.4 }),
    apple: (rn) => clump(g, rn, { leaf: 'apple', n: 110, R: 112, len: [52, 72], k: [0.55, 1.2], core: [34, 66, 22] }),
    banyan: (rn) => clump(g, rn, { leaf: 'banyan', n: 100, R: 112, len: [54, 78], k: [0.5, 1.15], core: [26, 56, 20] }),
    neem: (rn) => clump(g, rn, { leaf: 'neem', n: 70, R: 108, len: [78, 112], k: [0.5, 1.15], core: [52, 78, 26], jit: 1.6, cr: 0.4 }),
    gul: (rn) => clump(g, rn, { leaf: 'gul', n: 34, R: 112, len: [84, 120], k: [0.55, 1.1], core: [40, 86, 30], cr: 0.42 }),
    ashoka: (rn) => clump(g, rn, { leaf: 'ashoka', n: 120, R: 104, len: [70, 104], k: [0.5, 1.15], core: [24, 50, 20], hang: true, cy: 96, sy: 1.1 }),
    shrub: (rn) => clump(g, rn, { leaf: 'shrub', n: 150, R: 112, len: [34, 54], k: [0.5, 1.15], core: [28, 58, 20] }),
    palm: (rn) => sprayPalm(g, rn),
    flower: (rn) => sprayFlower(g, rn),
    babool: (rn) => sprayBabool(g, rn),
  };
  let i = 0;
  for (const name of Object.keys(cells)) {
    const [cu, cr] = CELL[name];
    g.save(); g.beginPath(); g.rect(cu * CL, cr * CL, CL, CL); g.clip(); g.translate(cu * CL, cr * CL); BASE = g.getTransform();
    cells[name](mulberry32(7001 + i * 131)); i++;
    g.restore();
  }
  return { cv, g };
}
// transparent texels carry a leaf colour too (no dark fringe when filtered / mip-mapped)
export function finishTex(r, g, W, H, fill) {
  const id = g.getImageData(0, 0, W, H), d = id.data;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (d[i + 3] < 6) { const c = fill(x, y); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = 0; }
  }
  return r.makeTex(W, H, new Uint8Array(d.buffer));
}
export function makeFoliageTex(r) {
  const { g } = paintAtlas();
  return finishTex(r, g, AW, AH, (x, y) => (x >= AW / 2 ? [96, 150, 52] : [80, 140, 50]));
}
// uv rectangle of a spray cell, 1.5 px inside the cell
export const cellUV = (name) => { const [cu, cr] = CELL[name]; return [(cu * CL + 1.5) / AW, ((cu + 1) * CL - 1.5) / AW, (cr * CL + 1.5) / AH, ((cr + 1) * CL - 1.5) / AH]; };
