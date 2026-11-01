// Destructible buildings. Every wall is made of panels (rigid bodies). Intact panels are static and are drawn as ONE
// merged mesh per building (cheap). A panel gives way when an impact exceeds its strength; the building then re-checks
// which panels are still supported (storeys above a destroyed base fall), and loose panels become free rigid bodies.
import { Body, GROUP } from './physics.js';
import { m4, clamp } from './math.js';
import { makeGeo } from './geo.js';

const FLOOR_H = 3.2, SLAB_T = 0.3, WALL_T = 0.3, CT = 0.5;

// Universal material table. Mass = density x volume (or areal density for thin cladding / glass); strength = energy a
// panel absorbs before it gives way (J per m3, or J per m2 of face for thin sheets). Numbers are order-of-magnitude real:
// a car at 60 km/h (~240 kJ) wrecks an infill wall bay, a reinforced column needs several hundred kJ.
const TYPES = {
  glass: { area: 32, eA: 0.7e3, value: 1200, rub: [0.62, 0.7, 0.75] },      // curtain-wall glass + frame
  brick: { dens: 1800, eV: 52e3, value: 900, rub: [0.55, 0.3, 0.24] },        // 230 mm brick masonry
  plaster: { dens: 1700, eV: 44e3, value: 800, rub: [0.75, 0.7, 0.6] },       // plastered block wall
  concrete: { dens: 2400, eV: 95e3, value: 1400, rub: [0.58, 0.58, 0.56] },   // RCC panel
  metal: { area: 14, eA: 1.8e3, value: 500, rub: [0.5, 0.52, 0.55] },        // sheet cladding
  slab: { dens: 2400, eV: 120e3, value: 2500, rub: [0.5, 0.5, 0.5] },         // RCC floor slab
  column: { dens: 2450, eV: 380e3, value: 2200, rub: [0.52, 0.52, 0.5] },     // RCC column with rebar
  core: { dens: 2500, eV: 300e3, value: 3500, rub: [0.5, 0.5, 0.5] },        // RCC lift / stair core
  barrier: { dens: 2400, eV: 140e3, value: 1500, rub: [0.6, 0.6, 0.58] },
};
const panelMass = (T, hx, hy, hz) => (T.area ? T.area * 4 * hy * Math.max(hx, hz) : T.dens * 8 * hx * hy * hz);
const panelCap = (T, hx, hy, hz) => (T.eA ? T.eA * 4 * hy * Math.max(hx, hz) : T.eV * 8 * hx * hy * hz);

// ---- textures: one atlas per style, 3 columns (window wall, plain wall, storefront) x 2 rows (intact, cracked)
const STYLES = {
  brick: { wall: '#9a4b36', type: 'brick', plain: 'brick' },
  plaster: { wall: '#d8cbb0', type: 'plaster', plain: 'plaster' },
  concrete: { wall: '#aaa9a4', type: 'concrete', plain: 'concrete' },
  glass: { wall: '#35506b', type: 'glass', plain: 'glass' },
  metal: { wall: '#7c8791', type: 'metal', plain: 'metal' },
  barrier: { wall: '#b4b2ac', type: 'barrier', plain: 'concrete' },
};

function noise(g, x, y, w, h, n, a) {
  for (let i = 0; i < n; i++) {
    const v = (Math.random() * 90) | 0;
    g.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`;
    g.fillRect(x + Math.random() * w, y + Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3);
  }
}

function glassRect(g, x, y, w, h, tint, bad) {
  const gr = g.createLinearGradient(x, y, x + w * 0.3, y + h);
  gr.addColorStop(0, tint[0]); gr.addColorStop(0.55, tint[1]); gr.addColorStop(1, tint[2]);
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(255,255,255,.16)';
  g.beginPath(); g.moveTo(x + w * 0.08, y); g.lineTo(x + w * 0.4, y); g.lineTo(x + w * 0.1, y + h); g.lineTo(x - w * 0.08, y + h); g.closePath(); g.fill();
  if (bad) { g.fillStyle = 'rgba(10,14,20,.85)'; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x + Math.random() * w, y + Math.random() * h); for (let k = 0; k < 5; k++) g.lineTo(x + Math.random() * w, y + Math.random() * h); g.fill(); } }
}

function crack(g, x, y, s, windowRect) {
  g.save(); g.beginPath(); g.rect(x, y, s, s); g.clip();
  g.fillStyle = 'rgba(0,0,0,.14)'; g.fillRect(x, y, s, s);
  if (windowRect) glassRect(g, windowRect[0], windowRect[1], windowRect[2], windowRect[3], ['#1c2430', '#0d1218', '#05080b'], true);
  g.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    let px = x + Math.random() * s, py = y + Math.random() * s;
    g.strokeStyle = k % 3 === 0 ? 'rgba(255,255,255,.35)' : 'rgba(20,20,20,.85)';
    g.lineWidth = 1 + Math.random() * 2.2;
    g.beginPath(); g.moveTo(px, py);
    for (let i = 0; i < 7; i++) { px += (Math.random() - 0.5) * 70; py += (Math.random() - 0.3) * 60; g.lineTo(px, py); }
    g.stroke();
  }
  // spalled patches
  for (let k = 0; k < 4; k++) { g.fillStyle = 'rgba(30,26,22,.55)'; g.beginPath(); g.arc(x + Math.random() * s, y + Math.random() * s, 5 + Math.random() * 12, 0, 7); g.fill(); }
  g.restore();
}

function drawTile(g, x, y, S, style, kind, bad) {
  const st = STYLES[style];
  g.save(); g.beginPath(); g.rect(x, y, S, S); g.clip();
  g.fillStyle = st.wall; g.fillRect(x, y, S, S);
  if (style === 'brick') {
    for (let r = 0; r < 18; r++) {
      const off = r % 2 ? 0 : 14;
      for (let c = -1; c < 10; c++) {
        const v = (Math.random() * 28 - 14) | 0;
        g.fillStyle = `rgb(${154 + v},${75 + v / 2},${54 + v / 2})`;
        g.fillRect(x + c * 28 + off + 1, y + r * 14.2 + 1, 26, 12.2);
      }
    }
  } else if (style === 'concrete' || style === 'barrier') {
    noise(g, x, y, S, S, 1400, 0.25);
    g.strokeStyle = 'rgba(0,0,0,.18)'; g.lineWidth = 2;
    g.strokeRect(x + 3, y + 3, S - 6, S - 6);
  } else if (style === 'plaster') {
    noise(g, x, y, S, S, 700, 0.12);
  } else if (style === 'metal') {
    for (let i = 0; i < 32; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.16)'; g.fillRect(x + i * 8, y, 4, S); }
    noise(g, x, y, S, S, 400, 0.2);
  } else if (style === 'glass') {
    glassRect(g, x, y, S, S, ['#7fb0d6', '#35607f', '#1d3446'], false);
    g.strokeStyle = 'rgba(15,22,30,.9)'; g.lineWidth = 5;
    for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(x + (i * S) / 4, y); g.lineTo(x + (i * S) / 4, y + S); g.stroke(); }
    g.beginPath(); g.moveTo(x, y + S * 0.62); g.lineTo(x + S, y + S * 0.62); g.stroke();
    g.fillStyle = 'rgba(210,225,235,.85)'; g.fillRect(x, y + S * 0.62 - 9, S, 14);
  }
  let win = null;
  if (kind === 'window' && style !== 'glass') {
    if (style === 'concrete') win = [x + 14, y + 78, S - 28, 96];
    else if (style === 'metal') win = [x + 40, y + 36, S - 80, 38];
    else win = [x + 62, y + 52, S - 124, 140];
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(win[0] - 6, win[1] - 6, win[2] + 12, win[3] + 12);
    glassRect(g, win[0], win[1], win[2], win[3], ['#8db4d4', '#3d6585', '#1f3345'], false);
    g.fillStyle = 'rgba(20,24,30,.9)'; g.fillRect(win[0] + win[2] / 2 - 2, win[1], 4, win[3]);
    g.fillStyle = 'rgba(230,230,225,.9)'; g.fillRect(win[0] - 10, win[1] + win[3] + 4, win[2] + 20, 9);
    if (style === 'plaster') { g.fillStyle = '#4a5a3a'; g.fillRect(win[0] - 28, win[1], 22, win[3]); g.fillRect(win[0] + win[2] + 6, win[1], 22, win[3]); }
  } else if (kind === 'store') {
    win = style === 'glass' ? null : [x + 18, y + 40, S - 36, S - 72];
    if (win) {
      g.fillStyle = 'rgba(0,0,0,.5)'; g.fillRect(win[0] - 6, win[1] - 6, win[2] + 12, win[3] + 12);
      glassRect(g, win[0], win[1], win[2], win[3], ['#a5c4dc', '#587f99', '#26394a'], false);
      g.fillStyle = 'rgba(25,28,34,.95)'; g.fillRect(win[0] + win[2] * 0.62, win[1], 6, win[3]); g.fillRect(win[0] + win[2] * 0.62 + win[2] * 0.2, win[1], 6, win[3]);
      g.fillStyle = '#c9a227'; g.fillRect(x + 30, y + 10, S - 60, 22);
    }
  }
  if (style !== 'glass') { g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x, y + S - 5, S, 5); g.fillRect(x, y, S, 3); }
  if (bad) crack(g, x, y, S, win || (style === 'glass' ? [x + 8, y + 8, S - 16, S * 0.55] : null));
  g.restore();
}

function makeAtlas(r, style) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S * 3; c.height = S * 2;
  const g = c.getContext('2d');
  const kinds = ['window', 'plain', 'store'];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) drawTile(g, col * S, row * S, S, style, kinds[col], row === 1);
  return r.texFromCanvas(c, { mip: true });
}

// ---- geometry: boxes with per-face atlas cells
const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
const PAD = 0.012;
function cellUV(col, row, a, b) {
  // a,b in 0..1 across the cell; v flipped (canvas top = v 0)
  const u0 = col / 3 + PAD / 3, u1 = (col + 1) / 3 - PAD / 3, v0 = row / 2 + PAD / 2, v1 = (row + 1) / 2 - PAD / 2;
  return [u0 + (u1 - u0) * a, v1 - (v1 - v0) * b];
}

class GeoBuf {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.idx = []; this.n = 0; }
  box(cx, cy, cz, hx, hy, hz, out, cracked, kind) {
    const h = [hx, hy, hz];
    const row = cracked ? 1 : 0;
    for (const f of FACES) {
      const isOut = out && f.n[0] === out[0] && f.n[2] === out[1] && f.n[1] === 0;
      const col = isOut ? kind : 1; // facade face uses window/store cell, other faces the plain cell
      for (let k = 0; k < 4; k++) {
        const su = k === 0 || k === 3 ? -1 : 1, sv = k < 2 ? -1 : 1;
        for (let a = 0; a < 3; a++) this.pos.push([cx, cy, cz][a] + f.n[a] * h[a] + f.u[a] * su * h[a] + f.v[a] * sv * h[a]);
        this.nrm.push(f.n[0], f.n[1], f.n[2]);
        const uv = cellUV(col, row, (su + 1) / 2, (sv + 1) / 2);
        this.uv.push(uv[0], uv[1]);
      }
      const b = this.n;
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
      this.n += 4;
    }
  }
  finish() {
    const g = makeGeo(this.n, this.idx.length);
    g.pos.set(this.pos); g.nrm.set(this.nrm); g.uv.set(this.uv); g.idx.set(this.idx);
    // winding is fixed per face below: ensure outward-facing triangles
    for (let i = 0; i < g.idx.length; i += 3) {
      const a = g.idx[i], b = g.idx[i + 1], c = g.idx[i + 2];
      const ux = g.pos[b * 3] - g.pos[a * 3], uy = g.pos[b * 3 + 1] - g.pos[a * 3 + 1], uz = g.pos[b * 3 + 2] - g.pos[a * 3 + 2];
      const vx = g.pos[c * 3] - g.pos[a * 3], vy = g.pos[c * 3 + 1] - g.pos[a * 3 + 1], vz = g.pos[c * 3 + 2] - g.pos[a * 3 + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * g.nrm[a * 3] + ny * g.nrm[a * 3 + 1] + nz * g.nrm[a * 3 + 2] < 0) { g.idx[i + 1] = c; g.idx[i + 2] = b; }
    }
    return g;
  }
}

export class Structures {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.r; this.world = ctx.world;
    this.list = [];
    this.mats = {};
    this.freeMeshes = new Map();
    this.rubble = [];
    this.fires = [];
    this.soundT = 0;
    // shared rubble mesh (unit cube)
    const g = new GeoBuf();
    g.box(0, 0, 0, 0.5, 0.5, 0.5, null, false, 1);
    this.rubbleGeo = g.finish();
    this.rubbleMeshes = {};
  }

  mat(style) {
    if (!this.mats[style]) this.mats[style] = { kind: 6, base: [1, 1, 1], rough: 0.88, metal: style === 'glass' ? 0.2 : 0, tex: makeAtlas(this.r, style), emis: [0, 0, 0] };
    return this.mats[style];
  }

  rubbleMesh(col, shade = 1) {
    const key = col.join(',') + '|' + shade;
    if (!this.rubbleMeshes[key]) {
      const f = [0.42, 0.55, 0.7][shade];
      const geo = { ...this.rubbleGeo, col: new Float32Array(this.rubbleGeo.col.length) };
      for (let i = 0; i < geo.col.length; i += 3) { geo.col[i] = col[0] * f; geo.col[i + 1] = col[1] * f; geo.col[i + 2] = col[2] * f; }
      this.rubbleMeshes[key] = this.r.createMesh(geo, { mat: { kind: 0, base: [1, 1, 1], rough: 0.95 } });
    }
    return this.rubbleMeshes[key];
  }

  // ---------- construction ----------
  newPanel(B, o) {
    const T = TYPES[o.type];
    const mass = panelMass(T, o.hx, o.hy, o.hz), cap = panelCap(T, o.hx, o.hy, o.hz);
    const P = {
      B, kind: o.kind, type: o.type, f: o.f, cx: o.cx, cy: o.cy, cz: o.cz, hx: o.hx, hy: o.hy, hz: o.hz, str: !!o.str,
      out: o.out || null, col: o.col ?? 0, hp: cap, maxHp: cap, mass, state: 'fixed', below: [], above: [], lat: [], nbL: null, nbR: null,
      y0: o.cy - o.hy, y1: o.cy + o.hy, body: null, lastO: 0, lastT: -1, releaseAt: 0,
    };
    const b = new Body({ fixed: true, pos: [B.x + o.cx, o.cy, B.z + o.cz], group: GROUP.STATIC, fric: 0.65, rest: 0.05 });
    b.addBox([o.hx, o.hy, o.hz]);
    b.brk = P; b.panel = P;
    this.world.add(b);
    P.body = b;
    B.panels.push(P);
    return P;
  }

  // system 'frame': RCC columns + slabs carry everything, walls / glass are infill (they break, the building stands).
  // system 'masonry': the walls themselves are load-bearing; lose enough of them and the slabs above come down.
  addBuilding(o) {
    const style = o.style || 'concrete';
    const ty = STYLES[style].type;
    const sys = o.system || (ty === 'brick' ? 'masonry' : 'frame');
    const F = o.floors || 3, H = FLOOR_H, wallH = H - SLAB_T, seg = o.seg || 3.5;
    const B = { x: o.x, z: o.z, w: o.w, d: o.d, floors: F, style, sys, panels: [], free: new Set(), dirty: true, mesh: null, rebuildT: 0, freed: 0, fireStarted: false, collapseDust: 0, hazards: [], model: m4.fromTRS(new Float32Array(16), [o.x, 0, o.z], [0, 0, 0, 1], 1) };
    B.radius = Math.hypot(o.w, o.d, F * H) / 2 + 2;
    B.cy = (F * H) / 2;
    const bay = F >= 4 ? 5.5 : 7;
    const sx = Math.max(1, Math.ceil(o.w / bay)), sz = Math.max(1, Math.ceil(o.d / bay));
    const spx = o.w / sx, spz = o.d / sz;
    const kx = Math.max(1, Math.round(spx / seg)), kz = Math.max(1, Math.round(spz / seg));
    // grid lines (column centres); outer lines sit flush with the outside faces
    const gx = [], gz = [];
    for (let a = 0; a <= sx; a++) gx.push(a === 0 ? -o.w / 2 + CT / 2 : a === sx ? o.w / 2 - CT / 2 : -o.w / 2 + spx * a);
    for (let c = 0; c <= sz; c++) gz.push(c === 0 ? -o.d / 2 + CT / 2 : c === sz ? o.d / 2 - CT / 2 : -o.d / 2 + spz * c);
    const frame = sys === 'frame';
    const wallType = (f) => (f === 0 && style === 'glass' ? 'glass' : ty);
    for (let f = 0; f < F; f++) {
      const y0 = f * H, cy = y0 + wallH / 2;
      const kindCol = f === 0 && o.store !== false ? 2 : 0;
      const core = frame && F >= 4 ? { ax: Math.min(3, o.w * 0.2), az: Math.min(3, o.d * 0.2) } : null;
      if (core) {
        const { ax, az } = core, t = 0.175;
        for (const sg of [-1, 1]) {
          this.newPanel(B, { kind: 'wall', type: 'core', f, cx: 0, cy, cz: sg * (az - t), hx: ax, hy: wallH / 2, hz: t, out: null, col: 1, str: true });
          this.newPanel(B, { kind: 'wall', type: 'core', f, cx: sg * (ax - t), cy, cz: 0, hx: t, hy: wallH / 2, hz: az - 2 * t, out: null, col: 1, str: true });
        }
      }
      if (frame) for (let a = 0; a <= sx; a++) for (let c = 0; c <= sz; c++) {
        if (core && Math.abs(gx[a]) < core.ax + 0.3 && Math.abs(gz[c]) < core.az + 0.3) continue;
        this.newPanel(B, { kind: 'col', type: 'column', f, cx: gx[a], cy, cz: gz[c], hx: CT / 2, hy: wallH / 2, hz: CT / 2, out: null, col: 1, str: true });
      }
      // perimeter walls: split between grid lines, trimmed where a column stands
      const lineX = (zc, zOut, outV) => {
        const row = [];
        for (let a = 0; a < sx; a++) {
          const x0 = frame ? gx[a] + CT / 2 : (a === 0 ? -o.w / 2 : gx[a] - 0), x1 = frame ? gx[a + 1] - CT / 2 : (a === sx - 1 ? o.w / 2 : gx[a + 1]);
          const pw = (x1 - x0) / kx;
          for (let i = 0; i < kx; i++) row.push(this.newPanel(B, { kind: 'wall', type: wallType(f), f, cx: x0 + pw * (i + 0.5), cy, cz: zc, hx: pw / 2, hy: wallH / 2, hz: WALL_T / 2, out: outV, col: kindCol, str: !frame }));
        }
        for (let i = 0; i < row.length; i++) { row[i].nbL = row[i - 1] || null; row[i].nbR = row[i + 1] || null; }
      };
      const lineZ = (xc, outV) => {
        const row = [];
        for (let c = 0; c < sz; c++) {
          const z0 = frame ? gz[c] + CT / 2 : (c === 0 ? -o.d / 2 + WALL_T : gz[c]), z1 = frame ? gz[c + 1] - CT / 2 : (c === sz - 1 ? o.d / 2 - WALL_T : gz[c + 1]);
          const pw = (z1 - z0) / kz;
          for (let i = 0; i < kz; i++) row.push(this.newPanel(B, { kind: 'wall', type: wallType(f), f, cx: xc, cy, cz: z0 + pw * (i + 0.5), hx: WALL_T / 2, hy: wallH / 2, hz: pw / 2, out: outV, col: kindCol, str: !frame }));
        }
        for (let i = 0; i < row.length; i++) { row[i].nbL = row[i - 1] || null; row[i].nbR = row[i + 1] || null; }
      };
      lineX(o.d / 2 - WALL_T / 2, [0, 1]);
      lineX(-o.d / 2 + WALL_T / 2, [0, -1]);
      lineZ(o.w / 2 - WALL_T / 2, [1, 0]);
      lineZ(-o.w / 2 + WALL_T / 2, [-1, 0]);
      // masonry: interior bearing walls on the slab grid lines
      if (!frame) {
        for (let a = 1; a < sx; a++) lineZ(gx[a], null);
        for (let c = 1; c < sz; c++) lineX(gz[c], null);
      }
      // floor slab (roof of this storey), one per bay
      const slabs = [];
      for (let a = 0; a < sx; a++) for (let c = 0; c < sz; c++) {
        slabs.push(this.newPanel(B, { kind: 'slab', type: 'slab', f, cx: -o.w / 2 + spx * (a + 0.5), cy: (f + 1) * H - SLAB_T / 2, cz: -o.d / 2 + spz * (c + 0.5), hx: spx / 2 - 0.01, hy: SLAB_T / 2, hz: spz / 2 - 0.01, out: null, col: 1 }));
      }
      for (let i = 0; i < slabs.length; i++) for (let j = i + 1; j < slabs.length; j++) {
        const A = slabs[i], C = slabs[j];
        const dx = Math.abs(A.cx - C.cx), dz = Math.abs(A.cz - C.cz);
        if ((dx <= A.hx + C.hx + 0.05 && dz < 0.5) || (dz <= A.hz + C.hz + 0.05 && dx < 0.5)) { A.lat.push(C); C.lat.push(A); }
      }
    }
    // LPG cylinders in kitchens / shops: the only way a building catches fire
    const ng = o.gas ?? (ty === 'plaster' || ty === 'brick' ? (F <= 3 ? 1 : 2) : 0);
    for (let i = 0; i < ng; i++) B.hazards.push({ x: o.x + (Math.random() - 0.5) * (o.w - 3), y: 0.6, z: o.z + (Math.random() - 0.5) * (o.d - 3), done: false });
    this.finishBuilding(B);
    return B;
  }

  // a long free-standing barrier / boundary wall of stacked concrete blocks
  addBarrier(o) {
    const B = { x: o.x, z: o.z, w: o.len, d: o.th, floors: 1, style: 'barrier', panels: [], free: new Set(), dirty: true, mesh: null, rebuildT: 0, freed: 0, fireStarted: true, collapseDust: 0, hazards: [], sys: 'barrier', model: m4.fromTRS(new Float32Array(16), [o.x, 0, o.z], [0, 0, 0, 1], 1) };
    B.radius = o.len / 2 + 4; B.cy = 3;
    const n = Math.round(o.len / o.seg), pw = o.len / n, ph = o.h / o.rows;
    for (let r = 0; r < o.rows; r++) {
      const line = [];
      for (let i = 0; i < n; i++) line.push(this.newPanel(B, { kind: 'wall', type: 'barrier', f: r, cx: -o.len / 2 + pw * (i + 0.5), cy: ph * (r + 0.5), cz: 0, hx: pw / 2 - 0.01, hy: ph / 2 - 0.005, hz: o.th / 2, out: [0, 1], col: 1 }));
      for (let i = 0; i < line.length; i++) { line[i].nbL = line[i - 1] || null; line[i].nbR = line[i + 1] || null; }
    }
    this.finishBuilding(B);
    return B;
  }

  finishBuilding(B) {
    const P = B.panels;
    for (let i = 0; i < P.length; i++) for (let j = 0; j < P.length; j++) {
      if (i === j) continue;
      const A = P[i], C = P[j];
      // C directly under A
      if (Math.abs(A.y0 - C.y1) < 0.03 && Math.abs(A.cx - C.cx) < A.hx + C.hx - 0.02 && Math.abs(A.cz - C.cz) < A.hz + C.hz - 0.02) { A.below.push(C); C.above.push(A); }
    }
    this.list.push(B);
    this.rebuild(B);
  }

  // ---------- mesh ----------
  rebuild(B) {
    const g = new GeoBuf();
    for (const P of B.panels) if (P.state === 'fixed') g.box(P.cx, P.cy, P.cz, P.hx, P.hy, P.hz, P.out, P.hp < P.maxHp * 0.55, P.col);
    const old = B.mesh;
    B.mesh = g.n ? this.r.createMesh(g.finish(), { mat: this.mat(B.style), radius: B.radius }) : null;
    if (old) this.r.deleteMesh(old);
    B.dirty = false;
  }

  freeMesh(P) {
    const cracked = P.hp < P.maxHp * 0.55;
    const key = [P.B.style, P.kind, P.hx.toFixed(2), P.hy.toFixed(2), P.hz.toFixed(2), P.out ? P.out.join('') : '', P.col, cracked].join('|');
    let m = this.freeMeshes.get(key);
    if (!m) {
      const g = new GeoBuf();
      g.box(0, 0, 0, P.hx, P.hy, P.hz, P.out, cracked, P.col);
      m = this.r.createMesh(g.finish(), { mat: this.mat(P.B.style), radius: Math.max(P.hx, P.hy, P.hz) * 2 });
      this.freeMeshes.set(key, m);
    }
    return m;
  }

  // ---------- breaking ----------
  fxAt(P, p, E, dir) {
    const fx = this.ctx.fx;
    if (!fx) return;
    const rub = TYPES[P.type].rub;
    const n = clamp((E / 30e3) | 0, 1, 14);
    for (let i = 0; i < Math.min(n, 5); i++) {
      fx.smoke([p[0], p[1], p[2]], [(Math.random() - 0.5) * 3 + dir[0] * 2, Math.random() * 2, (Math.random() - 0.5) * 3 + dir[2] * 2], 0.6 + Math.random() * 1.2, 1.4 + Math.random() * 1.4, [0.66, 0.64, 0.6], 0.14);
    }
    const hex = '#' + rub.map((c) => ((c * 255) | 0).toString(16).padStart(2, '0')).join('');
    for (let i = 0; i < clamp(n * 2, 4, 26); i++) fx.chip(p, [(Math.random() - 0.5) * 9 + dir[0] * 3, 1 + Math.random() * 5, (Math.random() - 0.5) * 9 + dir[2] * 3], hex);
    if (P.B.style === 'glass' || P.col !== 1) for (let i = 0; i < clamp(n * 2, 4, 20); i++) fx.glass(p, [(Math.random() - 0.5) * 8, 1 + Math.random() * 4, (Math.random() - 0.5) * 8]);
  }

  // total rubble mass is conserved: a broken panel becomes pieces whose masses add up to what is left of it
  spawnRubble(P, p, totalMass, dir, speed) {
    const T = TYPES[P.type], world = this.world;
    const dens = T.dens || 1800;
    let n = clamp(Math.round(totalMass / 160), 2, 16);
    const L = this.rubble.length;
    n = Math.max(L < 450 ? 2 : 1, Math.round(n * (L < 150 ? 1 : L < 300 ? 0.5 : L < 450 ? 0.25 : 0)));
    const m = totalMass / n;
    const s = Math.cbrt(m / dens);
    for (let i = 0; i < n; i++) {
      const ka = 0.55 + Math.random() * 1.1, kb = 0.55 + Math.random() * 1.1, kc = 0.55 + Math.random() * 1.1, nrm = Math.cbrt(1 / (ka * kb * kc));
      const k = [ka * nrm, kb * nrm, kc * nrm];
      const sz = s;
      const body = new Body({ mass: m, pos: [p[0] + (Math.random() - 0.5) * 0.8, p[1] + (Math.random() - 0.5) * 0.6, p[2] + (Math.random() - 0.5) * 0.8], q: [0, 0, 0, 1], fric: 0.75, rest: 0.12, group: GROUP.DEBRIS, mask: GROUP.STATIC | GROUP.PROP | GROUP.DEBRIS | GROUP.CAR, angDamp: 0.25 });
      body.addBox([sz * k[0] / 2, sz * k[1] / 2, sz * k[2] / 2]);
      body.v = [dir[0] * speed * 0.4 + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, dir[2] * speed * 0.4 + (Math.random() - 0.5) * 4];
      body.w = [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8];
      world.add(body);
      const d = { body, kind: 'rubble', mesh: this.rubbleMesh(T.rub, (Math.random() * 3) | 0), s: sz, k, t: 0 };
      this.ctx.debris.push(d);
      this.rubble.push(d);
    }
    // only when the pile gets enormous do the oldest settled pieces get cleaned up
    while (this.rubble.length > 900) { const old = this.rubble.shift(); old.t = 999; }
  }

  releasePanel(P, v, why, frac = 1) {
    if (P.state !== 'fixed') return;
    this.world.release(P.body, P.mass * frac);
    P.state = 'free';
    P.body.brk = null;
    P.body.report = true;
    P.body.group = GROUP.PROP;
    P.body.rest = 0.1;
    if (v) { P.body.v = [v[0], v[1], v[2]]; }
    P.B.dirty = true;
    P.B.free.add(P);
    P.B.freed++;
    P.mesh = this.freeMesh(P);
    P._m = new Float32Array(16);
    P.B.checkStab = true;
    P.B.lastWhy = why;
    if (P.f === 0) this.hazardCheck(P.B, P, why === 'hit' ? 1 : 0.4);
  }

  breakCost(P) { return TYPES[P.type].value; }

  // gas cylinder near a wrecked ground-floor panel may go off
  hazardCheck(B, P, k) {
    for (const h of B.hazards) {
      if (h.done) continue;
      const d = Math.hypot(B.x + P.cx - h.x, B.z + P.cz - h.z);
      if (d < 4.5 && Math.random() < 0.22 * k) this.gasBlast(B, h);
    }
  }
  gasBlast(B, h) {
    h.done = true;
    const pos = [h.x, h.y, h.z];
    if (this.ctx.blast) this.ctx.blast(pos, 10, 7);
    this.fires.push({ p: [h.x, 0.6, h.z], t: 0, life: 40 + Math.random() * 25 });
    // the blast shoves nearby wall panels
    for (const Q of B.panels) {
      if (Q.state !== 'fixed') continue;
      const d = Math.hypot(B.x + Q.cx - h.x, Q.cy - h.y, B.z + Q.cz - h.z);
      if (d < 8) { Q.hp -= 160e3 * (1 - d / 8) * (1 - d / 8); if (Q.hp <= 0) this.breakPanel(Q, [(B.x + Q.cx - h.x) / (d + 1) * 6, 3, (B.z + Q.cz - h.z) / (d + 1) * 6], 150e3, [0, 0, 0]); else B.dirty = true; }
    }
  }

  // called from the physics step BEFORE the contact is solved
  preHit(a, b, c) {
    const P = a.brk || b.brk;
    const O = a.brk ? b : a;
    if (!P || P.state !== 'fixed') return;
    if (O.fixed || !O.mass) return;
    const wt = this.world.time;
    if (P.lastO === O.id && wt - P.lastT < 0.05) return; // one hit per contact patch per moment
    P.lastO = O.id; P.lastT = wt;
    const v = -c.vn0;
    // effective mass: a long-lived heap of debris resting on the wall should not count
    const E = 0.5 * O.mass * v * v * (O.group === GROUP.DEBRIS ? 0.5 : 1);
    if (E < 2500) return;
    P.hp -= E;
    const n = c.n, sg = a.brk ? -1 : 1;
    const dir = [n[0] * sg, n[1] * sg, n[2] * sg]; // roughly the direction the impactor was travelling
    const cb = this.ctx.onProp;
    if (cb) cb(Math.min(E * 0.004, 4000));
    this.fxAt(P, c.p, E, dir);
    if (this.ctx.sfx && this.soundT <= 0 && E > 20e3) { this.soundT = 0.08; this.ctx.sfx.crash(c.p, clamp(E / 400e3, 0.1, 1), E > 120e3); }
    // the shock spreads through bonded neighbours (mortar / concrete): infill takes more than structure
    const share = P.str ? 0.06 : 0.16;
    for (const Q of [P.nbL, P.nbR]) if (Q && Q.state === 'fixed') { Q.hp -= E * share; if (Q.hp <= 0) this.breakPanel(Q, O.v, E * 0.3, dir); }
    for (const Q of P.above) if (Q.state === 'fixed') Q.hp -= E * 0.04;
    for (const Q of P.below) if (Q.state === 'fixed') Q.hp -= E * 0.04;
    if (P.hp <= 0) this.breakPanel(P, O.v, E, dir);
    else P.B.dirty = true;
    if (cb && P.hp <= 0) cb(this.breakCost(P));
  }

  breakPanel(P, vel, E, dir) {
    if (P.state !== 'fixed') return;
    const k = 0.35;
    this.releasePanel(P, [vel[0] * k, vel[1] * k + 0.5, vel[2] * k], 'hit', 0.55);
    P.body.w = [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3];
    this.spawnRubble(P, [P.body.pos[0], P.body.pos[1], P.body.pos[2]], P.mass * 0.45, dir, Math.hypot(vel[0], vel[2]));
  }

  // free panel hits something hard: it shatters (all of its mass turns into rubble)
  onImpact(e) {
    for (const b of [e.a, e.b]) {
      const P = b.panel;
      if (!P || P.state !== 'free') continue;
      const E = 0.5 * b.mass * e.speed * e.speed;
      if (e.speed > 4.5 && E > P.maxHp * 0.55) {
        const dir = [b.v[0] * 0.1, 0, b.v[2] * 0.1];
        this.fxAt(P, e.p, E * 1.4, dir);
        this.spawnRubble(P, [b.pos[0], b.pos[1], b.pos[2]], b.mass, dir, Math.hypot(b.v[0], b.v[2]));
        if (this.ctx.sfx && this.soundT <= 0) { this.soundT = 0.08; this.ctx.sfx.crash(b.pos, clamp(E / 500e3, 0.15, 1), true); }
        const cb = this.ctx.onProp; if (cb) cb(this.breakCost(P) * 0.5);
        this.world.remove(b);
        P.state = 'gone';
        P.B.free.delete(P);
        P.B.checkStab = true;
      }
    }
  }

  // load path: which fixed panels are still carried? Columns / bearing walls pass load down through slabs;
  // a slab needs most of its supports; infill walls only need a stable slab above or below.
  checkStability(B) {
    const stable = new Set();
    for (const P of B.panels) { if (P.state === 'fixed' && P.y0 < 0.05) stable.add(P); }
    const fixed = B.panels.filter((P) => P.state === 'fixed' && P.y0 >= 0.05);
    let changed = true, guard = 0;
    while (changed && guard++ < 40) {
      changed = false;
      for (const P of fixed) {
        if (stable.has(P)) continue;
        let ok = false;
        if (P.kind === 'slab') {
          const sup = P.below.filter((q) => q.str);
          const nS = sup.length;
          const live = sup.filter((q) => stable.has(q));
          const nOK = live.length;
          const need = nS <= 2 ? nS : Math.ceil(nS * (B.sys === 'masonry' ? 0.65 : 0.5));
          // enough supports AND spread around the bay (a slab held only along one edge peels off)
          const ex = P.hx * 0.4, ez = P.hz * 0.4;
          const spread = live.some((q) => q.cx <= P.cx - ex) && live.some((q) => q.cx >= P.cx + ex) && live.some((q) => q.cz <= P.cz - ez) && live.some((q) => q.cz >= P.cz + ez);
          ok = nS > 0 && nOK >= need && (spread || nS <= 2);
        } else if (P.str) {
          ok = P.below.some((q) => stable.has(q));
        } else {
          ok = P.below.some((q) => stable.has(q)) || P.above.some((q) => stable.has(q) && q.kind === 'slab');
        }
        if (ok) { stable.add(P); changed = true; }
      }
    }
    let lost = 0;
    const t = this.ctx.time;
    for (const P of fixed) if (!stable.has(P) && !P.releaseAt) {
      // failure wave: panels right above the damage let go first, then the rest of the building follows
      P.releaseAt = t + 0.1 + Math.random() * 0.4 + P.f * 0.05; lost++;
    }
    if (lost && !B.collapseNoted) { B.collapseNoted = true; if (this.ctx.onCollapse) this.ctx.onCollapse(B); }
    return lost;
  }

  update(dt) {
    this.soundT -= dt;
    const t = this.ctx.time, fx = this.ctx.fx;
    for (const B of this.list) {
      if (B.checkStab) { B.checkStab = false; this.checkStability(B); }
      // delayed releases of unsupported panels
      for (const P of B.panels) {
        if (P.state === 'fixed' && P.releaseAt && t >= P.releaseAt) {
          P.releaseAt = 0;
          const o = P.out || [0, 0];
          this.releasePanel(P, [o[0] * 0.8 + (Math.random() - 0.5) * 0.6, -0.5, o[1] * 0.8 + (Math.random() - 0.5) * 0.6], 'collapse');
          P.body.w = [(Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.2];
          if (fx && B.collapseDust < 22) {
            B.collapseDust++;
            fx.smoke([B.x + P.cx, Math.max(1, P.cy), B.z + P.cz], [(Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2], 2 + Math.random() * 2, 3 + Math.random() * 2.5, [0.6, 0.58, 0.55], 0.2);
          }
          B.checkStab = true;
        }
      }
      // a big collapse can rupture a gas cylinder; plain masonry / concrete never burns by itself
      if (!B.gasCollapse && B.freed > B.panels.length * 0.25 && B.lastWhy === 'collapse') {
        B.gasCollapse = true;
        for (const h of B.hazards) if (!h.done && Math.random() < 0.7) setTimeout(() => this.gasBlast(B, h), 300 + Math.random() * 1500);
      }
      if (B.dirty) { B.rebuildT -= dt; if (B.rebuildT <= 0) { this.rebuild(B); B.rebuildT = 0.12; } }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t > f.life) { this.fires.splice(i, 1); continue; }
      if (fx) {
        const k = 1 - f.t / f.life;
        if (Math.random() < 0.7 * k) fx.fire([f.p[0] + (Math.random() - 0.5) * 2, f.p[1] + Math.random(), f.p[2] + (Math.random() - 0.5) * 2], [(Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6], 0.8 + Math.random() * 0.9);
        if (Math.random() < 0.35) fx.smoke([f.p[0], f.p[1] + 2, f.p[2]], [(Math.random() - 0.5), 3 + Math.random() * 2, (Math.random() - 0.5)], 1.6 + Math.random() * 2, 4 + Math.random() * 3, [0.05, 0.05, 0.05], 0.55);
      }
    }
  }

  draw(cam) {
    const r = this.r;
    for (const B of this.list) {
      const dx = B.x - cam[0], dz = B.z - cam[2];
      const d = Math.hypot(dx, dz);
      if (d - B.radius > 900) continue;
      if (B.mesh) r.add(B.mesh, B.model, { cast: d - B.radius < 140 });
      if (d - B.radius > 260) continue;
      for (const P of B.free) {
        const b = P.body;
        m4.fromTRS(P._m, b.pos, b.q, 1);
        r.add(P.mesh, P._m, { cast: d - B.radius < 90 });
      }
    }
  }
}
