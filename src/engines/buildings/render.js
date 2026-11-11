// Surface look of buildings: one shared tile atlas (plaster, clay brick, concrete block, RCC, wood, glass, tiles...)
// and a box builder that tiles each face in world space, so brick courses line up across neighbouring panels.
// Paint is only a tint on the plaster tile; everything underneath keeps its own material colour.
import { makeGeo } from '../../core/geo.js';

export const TILE = 1.2; // metres covered by one atlas tile
export const T = { plaster: 0, clay: 1, block: 2, rcc: 3, crack: 4, wood: 5, glass: 6, floor: 7, roof: 8, metal: 9, fabric: 10, white: 11, marble: 12, slate: 13, fluted: 14, brass: 15 };
const COLS = 4, ROWS = 4, PAD = 0.012;

function rnd(a, b) { return a + Math.random() * (b - a); }
function speckle(g, x, y, S, n, a, dark = 80) {
  for (let i = 0; i < n; i++) { const v = (Math.random() * dark) | 0; g.fillStyle = `rgba(${v},${v},${v},${Math.random() * a})`; g.fillRect(x + Math.random() * S, y + Math.random() * S, 1 + Math.random() * 2.5, 1 + Math.random() * 2.5); }
}

function drawTile(g, x, y, S, t) {
  g.save(); g.beginPath(); g.rect(x, y, S, S); g.clip();
  if (t === T.white) {
    // clean modern finish: flat white, only a whisper of grain
    g.fillStyle = '#f6f5f2'; g.fillRect(x, y, S, S);
    speckle(g, x, y, S, 80, 0.035, 60);
  } else if (t === T.plaster || t === T.crack) {
    g.fillStyle = '#f4f2ee'; g.fillRect(x, y, S, S);
    // trowel marks + fine grit
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '120,115,105'},${rnd(0.03, 0.08)})`; g.beginPath(); g.ellipse(x + rnd(0, S), y + rnd(0, S), rnd(10, 40), rnd(4, 14), rnd(0, 3), 0, 7); g.fill(); }
    speckle(g, x, y, S, 500, 0.16, 120);
    if (t === T.crack) {
      // spalled patches reveal the brick underneath, hairline cracks run between them
      for (let k = 0; k < 5; k++) {
        const px = x + rnd(0, S), py = y + rnd(0, S), r = rnd(14, 38);
        g.fillStyle = 'rgba(120,70,55,.95)'; g.beginPath(); g.ellipse(px, py, r, r * 0.7, rnd(0, 3), 0, 7); g.fill();
        g.strokeStyle = 'rgba(70,60,55,.8)'; g.lineWidth = 1; for (let m = 0; m < 3; m++) g.strokeRect(px - r * 0.8 + m * r * 0.5, py - r * 0.35, r * 0.5, r * 0.3);
      }
      g.lineCap = 'round';
      for (let k = 0; k < 7; k++) {
        let px = x + rnd(0, S), py = y + rnd(0, S);
        g.strokeStyle = 'rgba(25,22,20,.85)'; g.lineWidth = rnd(1, 2.4);
        g.beginPath(); g.moveTo(px, py);
        for (let i = 0; i < 8; i++) { px += rnd(-30, 30); py += rnd(-8, 34); g.lineTo(px, py); }
        g.stroke();
      }
    }
  } else if (t === T.clay) {
    // 5 bricks per 1.2 m course, 14 courses, stretcher bond, mortar joints
    g.fillStyle = '#a49f94'; g.fillRect(x, y, S, S);
    const bw = S / 5, bh = S / 14;
    for (let r = 0; r < 14; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let c = -1; c < 6; c++) {
        const hue = rnd(-14, 14);
        g.fillStyle = `rgb(${(168 + hue) | 0},${(80 + hue * 0.5) | 0},${(56 + hue * 0.4) | 0})`;
        g.fillRect(x + c * bw + off + 1.6, y + r * bh + 1.4, bw - 3.2, bh - 2.8);
        // rough fired surface
        for (let k = 0; k < 14; k++) { const v = rnd(0.05, 0.22); g.fillStyle = Math.random() > 0.5 ? `rgba(60,20,10,${v})` : `rgba(230,150,110,${v * 0.6})`; g.fillRect(x + c * bw + off + rnd(2, bw - 4), y + r * bh + rnd(2, bh - 4), rnd(1, 4), 1); }
      }
    }
  } else if (t === T.block) {
    g.fillStyle = '#8f8d87'; g.fillRect(x, y, S, S);
    const bw = S / 2, bh = S / 6;
    for (let r = 0; r < 6; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let c = -1; c < 3; c++) {
        const v = rnd(-8, 8) | 0;
        g.fillStyle = `rgb(${176 + v},${174 + v},${168 + v})`;
        g.fillRect(x + c * bw + off + 2, y + r * bh + 2, bw - 4, bh - 4);
      }
    }
    speckle(g, x, y, S, 900, 0.18, 110);
  } else if (t === T.rcc) {
    g.fillStyle = '#9a9994'; g.fillRect(x, y, S, S);
    for (let i = 0; i < 26; i++) { g.fillStyle = `rgba(${Math.random() > 0.5 ? '255,255,255' : '60,60,55'},${rnd(0.03, 0.09)})`; g.beginPath(); g.ellipse(x + rnd(0, S), y + rnd(0, S), rnd(14, 60), rnd(8, 30), rnd(0, 3), 0, 7); g.fill(); }
    speckle(g, x, y, S, 1100, 0.35, 120);
    g.strokeStyle = 'rgba(40,40,38,.35)'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, y + S * 0.5); g.lineTo(x + S, y + S * 0.5); g.stroke();
  } else if (t === T.wood) {
    g.fillStyle = '#8a6240'; g.fillRect(x, y, S, S);
    for (let i = 0; i < 8; i++) { const v = rnd(-14, 14) | 0; g.fillStyle = `rgb(${138 + v},${98 + v},${64 + v})`; g.fillRect(x, y + (i * S) / 8 + 1, S, S / 8 - 2); }
    for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(50,30,15,${rnd(0.05, 0.25)})`; g.lineWidth = 1; const yy = y + rnd(0, S); g.beginPath(); g.moveTo(x, yy); g.bezierCurveTo(x + S * 0.3, yy + rnd(-2, 2), x + S * 0.6, yy + rnd(-2, 2), x + S, yy + rnd(-2, 2)); g.stroke(); }
  } else if (t === T.glass) {
    // neutral flat glass: colour comes from the building's glass tint, shine from the shader (sky reflection), so no painted streaks
    g.fillStyle = '#ffffff'; g.fillRect(x, y, S, S);
  } else if (t === T.marble) {
    g.fillStyle = '#26272a'; g.fillRect(x, y, S, S);
    for (let k = 0; k < 7; k++) {   // white veins: wandering polylines
      g.strokeStyle = `rgba(235,235,238,${rnd(0.35, 0.85)})`; g.lineWidth = rnd(0.6, 2.2); g.beginPath();
      let px = x + rnd(0, S), py = y + rnd(0, S); g.moveTo(px, py);
      for (let m = 0; m < 9; m++) { px += rnd(-30, 38); py += rnd(-14, 34); g.lineTo(px, py); if (Math.random() < 0.25) { g.moveTo(px, py); g.lineTo(px + rnd(-25, 25), py + rnd(-25, 25)); g.moveTo(px, py); } }
      g.stroke();
    }
    speckle(g, x, y, S, 400, 0.12, 200);
  } else if (t === T.slate) {
    g.fillStyle = '#4a4c50'; g.fillRect(x, y, S, S);
    const rows = 6;   // stacked stone ledgers
    for (let r = 0; r < rows; r++) { let cx = x - rnd(0, 40); while (cx < x + S) { const w = rnd(40, 110), v = rnd(-16, 16) | 0; g.fillStyle = `rgb(${72 + v},${74 + v},${78 + v})`; g.fillRect(cx + 1, y + (r * S) / rows + 1, w - 2, S / rows - 2); cx += w; } }
    speckle(g, x, y, S, 700, 0.25, 140);
  } else if (t === T.fluted) {
    g.fillStyle = '#2b2d31'; g.fillRect(x, y, S, S);
    for (let i = 0; i < 16; i++) { const gr = g.createLinearGradient(x + (i * S) / 16, 0, x + ((i + 1) * S) / 16, 0); gr.addColorStop(0, 'rgba(255,255,255,.00)'); gr.addColorStop(0.35, 'rgba(255,255,255,.16)'); gr.addColorStop(1, 'rgba(0,0,0,.35)'); g.fillStyle = gr; g.fillRect(x + (i * S) / 16, y, S / 16, S); }
  } else if (t === T.brass) {
    const gr = g.createLinearGradient(x, y, x, y + S); gr.addColorStop(0, '#c99c83'); gr.addColorStop(0.5, '#a97c63'); gr.addColorStop(1, '#8a5f4a');
    g.fillStyle = gr; g.fillRect(x, y, S, S);
    for (let i = 0; i < 60; i++) { g.fillStyle = i % 2 ? 'rgba(255,235,220,.10)' : 'rgba(40,20,10,.10)'; g.fillRect(x, y + (i * S) / 60, S, S / 120); }
  } else if (t === T.floor) {
    g.fillStyle = '#d9d6cf'; g.fillRect(x, y, S, S);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { const v = rnd(-6, 6) | 0; g.fillStyle = `rgb(${226 + v},${222 + v},${214 + v})`; g.fillRect(x + (i * S) / 2 + 2, y + (j * S) / 2 + 2, S / 2 - 4, S / 2 - 4); }
    speckle(g, x, y, S, 300, 0.1, 140);
  } else if (t === T.roof) {
    g.fillStyle = '#8c8a86'; g.fillRect(x, y, S, S);
    speckle(g, x, y, S, 1400, 0.4, 100);
    g.strokeStyle = 'rgba(30,30,28,.3)'; g.lineWidth = 2; g.strokeRect(x + 6, y + 6, S - 12, S - 12);
  } else if (t === T.metal) {
    g.fillStyle = '#b8bcc0'; g.fillRect(x, y, S, S);
    for (let i = 0; i < 40; i++) { g.fillStyle = i % 2 ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.12)'; g.fillRect(x + (i * S) / 40, y, S / 80, S); }
  } else if (t === T.fabric) {
    g.fillStyle = '#e8e8e8'; g.fillRect(x, y, S, S);
    for (let i = 0; i < 90; i++) { g.fillStyle = `rgba(0,0,0,${rnd(0.03, 0.09)})`; g.fillRect(x, y + (i * S) / 90, S, 1); }
    speckle(g, x, y, S, 500, 0.12, 100);
  }
  g.restore();
}

export function makeAtlas(r) {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S * COLS; c.height = S * ROWS;
  const g = c.getContext('2d');
  for (let t = 0; t < COLS * ROWS; t++) drawTile(g, (t % COLS) * S, ((t / COLS) | 0) * S, S, t);
  return r.texFromCanvas(c, { mip: true });
}

function tileUV(t, a, b) {
  const col = t % COLS, row = (t / COLS) | 0;
  const u0 = col / COLS + PAD / COLS, u1 = (col + 1) / COLS - PAD / COLS, v0 = row / ROWS + PAD / ROWS, v1 = (row + 1) / ROWS - PAD / ROWS;
  return [u0 + (u1 - u0) * a, v1 - (v1 - v0) * b];
}

const FACES = [
  { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] }, { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] }, { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] }, { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
];
export const hexRGB = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];

export class GeoBuf {
  constructor() { this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.tile = []; this.idx = []; this.n = 0; }
  // cfg(i) -> [tile, r, g, b] for face i (order +x -x +y -y +z -z) or null to skip it. off = world offset of the local origin.
  // Every face is ONE quad (two triangles, however large). The atlas tile repeats in the fragment shader: uv is the face's tile-space coordinate
  // (1.0 = TILE metres, anchored on the world grid so brick courses line up across neighbouring panels) and the atlas cell travels in `tile` (index + 1).
  // The only extra cut is at 1.2 m for faces that stand on the ground, so the darker ground weathering ramp is unchanged.
  box(cx, cy, cz, hx, hy, hz, cfg, off = [0, 0, 0], shade = 1, ground = true) {
    const h = [hx, hy, hz], c = [cx, cy, cz];
    for (let fi = 0; fi < 6; fi++) {
      const spec = cfg(fi);
      if (!spec) continue;
      const f = FACES[fi];
      const iu = f.u.findIndex((q) => q !== 0), iv = f.v.findIndex((q) => q !== 0);
      const su = f.u[iu], sv = f.v[iv];
      // extents of the face along its u / v axes, in the (signed) world coordinate of that axis
      const cu = (c[iu] + off[iu]) * su, cv = (c[iv] + off[iv]) * sv;
      const u0 = cu - h[iu], u1 = cu + h[iu], v0 = cv - h[iv], v1 = cv + h[iv];
      const gu = Math.floor(u0 / TILE + 1e-6) * TILE, gv = Math.floor(v0 / TILE + 1e-6) * TILE;
      const ni = f.n.findIndex((q) => q !== 0);
      const vs = [v0, v1];
      if (ground && iv === 1 && sv > 0 && v0 < TILE - 1e-4 && v1 > TILE + 1e-4) vs.splice(1, 0, TILE);   // keeps the same ground-weathering ramp as before (0 .. 1.2 m)
      for (let b = 0; b < vs.length - 1; b++) {
        const va = vs[b], vb = vs[b + 1];
        const corners = [[u0, va], [u1, va], [u1, vb], [u0, vb]];
        for (const [pu, pv] of corners) {
          const p = [0, 0, 0];
          p[iu] = (pu / su) - off[iu]; p[iv] = (pv / sv) - off[iv];
          p[ni] = c[ni] + f.n[ni] * h[ni];
          this.pos.push(p[0], p[1], p[2]);
          this.nrm.push(f.n[0], f.n[1], f.n[2]);
          this.uv.push((pu - gu) / TILE, (pv - gv) / TILE);
          this.tile.push(spec[0] + 1);
          // weathering: darker near the ground, tiny per-panel variation
          const wy = p[1];
          const ao = ground ? 0.72 + 0.28 * Math.min(1, Math.max(0, wy / 0.7)) : 1;
          const k = ao * shade;
          this.col.push(spec[1] * k, spec[2] * k, spec[3] * k);
        }
        const bb = this.n;
        this.idx.push(bb, bb + 1, bb + 2, bb, bb + 2, bb + 3);
        this.n += 4;
      }
    }
  }
  // oriented box: built in its own local frame (tiles keep running along `phase` = arc-length position), then rotated by quaternion q and moved to c
  boxQ(q, c, hx, hy, hz, cfg, off, phase, shade = 1) {
    const i0 = this.pos.length / 3;
    this.box(0, 0, 0, hx, hy, hz, cfg, [phase, c[1], 0], shade, false);
    const [x, y, z, w] = q;
    const R = [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y), 2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x), 2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
    const rot = (a, i, add) => { const px = a[i * 3], py = a[i * 3 + 1], pz = a[i * 3 + 2]; a[i * 3] = R[0] * px + R[3] * py + R[6] * pz + (add ? add[0] : 0); a[i * 3 + 1] = R[1] * px + R[4] * py + R[7] * pz + (add ? add[1] : 0); a[i * 3 + 2] = R[2] * px + R[5] * py + R[8] * pz + (add ? add[2] : 0); };
    for (let i = i0; i < this.pos.length / 3; i++) { rot(this.pos, i, [c[0], c[1], c[2]]); rot(this.nrm, i, null); }
  }
  finish() {
    const g = makeGeo(this.n, this.idx.length);
    g.pos.set(this.pos); g.nrm.set(this.nrm); g.uv.set(this.uv); g.col.set(this.col); g.idx.set(this.idx); g.tile = new Float32Array(this.tile);
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
