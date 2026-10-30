// Procedural car bodies: lofted shell + glasshouse with real wheel arches, then details (lights, grille, mirrors,
// wheels, interior). Everything is plain typed arrays so the same code runs in node tests and in the browser.
import { clamp, lerp, smoothstep, pchip, mulberry32 } from './math.js';
import { rbox, cylinder, lathe, torus, box, makeGeo, merge, trs, fixWinding, computeNormals } from './geo.js';
import { SHAPES } from './shapes.js';

export const PART = { BODY: 0, HOOD: 1, TRUNK: 2, BUMF: 3, BUMR: 4, DOORL: 5, DOORR: 6, MIRL: 7, MIRR: 8, WING: 9, COUNT: 10 };
export const PART_NAME = ['body', 'hood', 'trunk', 'front bumper', 'rear bumper', 'left door', 'right door', 'left mirror', 'right mirror', 'wing'];

// ---------- helpers ----------
function cardinal(ctrl, counts) {
  const n = ctrl.length, out = [];
  const dir = ctrl.map((p, i) => {
    const a = ctrl[Math.max(0, i - 1)], b = ctrl[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  });
  for (let i = 0; i < n - 1; i++) {
    const p0 = ctrl[i], p1 = ctrl[i + 1];
    const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const m0x = dir[i][0] * l, m0y = dir[i][1] * l, m1x = dir[i + 1][0] * l, m1y = dir[i + 1][1] * l;
    const c = counts[i];
    for (let k = 0; k < c; k++) {
      const t = k / c, t2 = t * t, t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
      out.push([h00 * p0[0] + h10 * m0x + h01 * p1[0] + h11 * m1x, h00 * p0[1] + h10 * m0y + h01 * p1[1] + h11 * m1y]);
    }
  }
  out.push(ctrl[n - 1].slice());
  return out;
}
const tab = (pts) => (pts.length > 2 ? pchip(pts) : (x) => pts[0][1]);

// wheel geometry (geo space)
export function wheelLayout(spec) {
  const g = spec.geo;
  return [
    { z: g.zFA, y: g.RF, R: g.RF, tw: g.twF, track: g.trackF },
    { z: g.zRA, y: g.RR, R: g.RR, tw: g.twR, track: g.trackR },
  ];
}

// ---------- body loft ----------
const KB = [2, 3, 3, 2, 2, 2, 1, 2]; // samples per control segment (body half section)
const KG = [3, 3, 5, 6, 4]; // glasshouse

export function buildBody(spec) {
  const g = spec.geo, id = spec.id, S = SHAPES[id];
  const L = g.L;
  const wl = wheelLayout(spec);
  const hw0 = tab(S.hw), top0 = tab(S.top), sh0 = tab(S.sh), bot = tab(S.bot);
  // fender wells need room: bulge width / shoulder around wheels
  const win = (z, zc, r) => 1 - smoothstep(r * 0.7, r * 1.4, Math.abs(z - zc));
  const hw = (z) => {
    let w = hw0(z);
    for (const q of wl) { const o = q.track / 2 + q.tw / 2 + 0.012; w = Math.max(w, lerp(w, o, win(z, q.z, q.R + 0.2))); }
    return w;
  };
  const sh = (z) => {
    let s = sh0(z);
    for (const q of wl) { const need = q.y + q.R + 0.06 + 0.045; s = Math.max(s, lerp(s, need, win(z, q.z, q.R + 0.12))); }
    return s;
  };
  const top = (z) => Math.min(top0(z), sh(z) + 0.04);
  const arch = wl.map((q) => ({ zc: q.z, yc: q.y, ra: q.R + 0.035 + (S.arch?.flare || 0) * 0.2, xin: q.track / 2 - q.tw / 2 - 0.05 }));

  // stations
  const zset = [];
  const pl = 0.12;
  const endK = [0, 0.015, 0.05, 0.12, 0.22, 0.38, 0.6, 1.0];
  for (const e of endK) { zset.push(pl * e); zset.push(L - pl * e); }
  for (let z = pl; z < L - pl; z += 0.085) zset.push(z);
  for (const a of arch) for (let z = a.zc - a.ra - 0.06; z <= a.zc + a.ra + 0.06; z += 0.04) zset.push(z);
  zset.sort((a, b) => a - b);
  const zs = [];
  for (const z of zset) if (z >= 0 && z <= L && (!zs.length || z - zs[zs.length - 1] > 0.0015)) zs.push(z);
  const nS = zs.length;

  const halfCounts = KB.reduce((a, b) => a + b, 0);
  const K = halfCounts; // points in half section excluding last = K, plus last => K+1
  const M = 2 * K; // ring size (closed, centre vertices shared)
  const pos = new Float32Array(nS * M * 3);
  const snapped = new Uint8Array(nS * M);

  const sec = [];
  for (let i = 0; i < nS; i++) {
    const z = zs[i];
    const W = hw(z), T = top(z), Sh = sh(z), B = bot(z);
    const r = S.rs, tk = S.tuck * (0.6 + 0.4 * W);
    const mid = lerp(Sh, B, 0.38);
    const ctrl = [
      [0, T + (S.crown || 0) * 0.3],
      [W * 0.42, lerp(T, Sh, 0.35) + (S.crown || 0)],
      [W - r * 1.7, Sh + 0.004],
      [W - r * 0.32, Sh - r * 0.42],
      [W, mid],
      [W - tk * 0.55, lerp(Sh, B, 0.76)],
      [W - tk, B + 0.05],
      [W - tk - 0.08, B],
      [0, B],
    ];
    let half = cardinal(ctrl, KB);
    // nose / tail pinch (superellipse cap)
    const e = Math.min(z, L - z);
    if (e < pl) {
      const t = e / pl, n = 3;
      const k = Math.pow(1 - Math.pow(1 - t, n), 1 / n);
      const cy = (T + B) / 2;
      half = half.map(([x, y]) => [x * k, cy + (y - cy) * k]);
    }
    sec.push(half);
    for (let j = 0; j < M; j++) {
      const jj = j <= K ? j : 2 * K - j;
      const sx = j <= K ? 1 : -1;
      const p = half[jj];
      let x = p[0] * sx, y = p[1], zz = z;
      let flag = 0;
      for (const a of arch) {
        if (Math.abs(x) < a.xin) continue;
        const dz = zz - a.zc, dy = y - a.yc;
        if (y >= a.yc) {
          const d = Math.hypot(dz, dy);
          if (d < a.ra && d > 1e-6) { zz = a.zc + (dz / d) * a.ra; y = a.yc + (dy / d) * a.ra; flag = 1; }
        } else if (Math.abs(dz) < a.ra) { zz = a.zc + (dz < 0 ? -a.ra : a.ra); flag = 1; }
      }
      const o = (i * M + j) * 3;
      pos[o] = x; pos[o + 1] = y; pos[o + 2] = zz;
      snapped[i * M + j] = flag;
    }
  }
  return { zs, nS, M, K, pos, snapped, sec, arch, fn: { hw, top, sh, bot } };
}

export function buildGlass(spec, B) {
  const S = SHAPES[spec.id], gh = S.gh;
  const Rt = tab(gh.R), gwT = tab(gh.gw), grT = tab(gh.gr);
  const z0 = gh.R[0][0], z1 = gh.R[gh.R.length - 1][0];
  const zs = [];
  const n = Math.ceil((z1 - z0) / 0.05);
  for (let i = 0; i <= n; i++) zs.push(z0 + ((z1 - z0) * i) / n);
  const KGt = KG.reduce((a, b) => a + b, 0);
  const Kg = KGt;
  const Mg = 2 * Kg + 1;
  const nS = zs.length;
  const pos = new Float32Array(nS * Mg * 3);
  const heights = [];
  for (let i = 0; i < nS; i++) {
    const z = zs[i];
    const base = B.fn.top(z) - 0.012;
    const baseSide = B.fn.sh(z) - 0.012;
    const R = Math.max(Rt(z), base + 0.002);
    const H = R - base;
    const gb = gwT(z), gr = grT(z);
    const ctrl = [
      [0, R],
      [gr * 0.6, R - Math.min(0.012, H * 0.2)],
      [gr, R - Math.min(0.05, H * 0.25)],
      [lerp(gr, gb, 0.3), R - H * 0.55],
      [lerp(gr, gb, 0.8), baseSide + H * 0.15],
      [gb, baseSide],
    ];
    const half = cardinal(ctrl, KG);
    for (let j = 0; j < Mg; j++) {
      const k = j <= Kg ? Kg - j : j - Kg; // 0 at belt(right)... center at j=Kg
      const sx = j <= Kg ? 1 : -1;
      const p = half[Math.abs(j - Kg)];
      const o = (i * Mg + j) * 3;
      pos[o] = p[0] * sx; pos[o + 1] = p[1]; pos[o + 2] = z;
    }
    heights.push(H);
  }
  return { zs, nS, Mg, Kg, pos, heights };
}

// grid -> triangles. quad classifier returns {mat, part} or null (drop)
export function gridTris(pos, nS, M, closed, classify, vertOffset = 0) {
  const tris = [];
  const nj = closed ? M : M - 1;
  for (let i = 0; i < nS - 1; i++)
    for (let j = 0; j < nj; j++) {
      const j2 = (j + 1) % M;
      const a = i * M + j, b = i * M + j2, c = (i + 1) * M + j2, d = (i + 1) * M + j;
      const cl = classify(a, b, c, d, i, j);
      if (!cl) continue;
      tris.push({ v: [a, b, c], cl }, { v: [a, c, d], cl });
    }
  return tris;
}

// ---------- materials ----------
export const MATS = {
  paint: { kind: 1, base: [1, 1, 1], metal: 0.35, rough: 0.3, coat: 1, flake: 1 },
  glass: { kind: 2, base: [0.004, 0.006, 0.008], alpha: 0.72 },
  trim: { kind: 0, base: [0.018, 0.018, 0.02], rough: 0.55, metal: 0.1 },
  mesh: { kind: 0, base: [0.012, 0.012, 0.014], rough: 0.4, metal: 0.75 },
  chrome: { kind: 0, base: [0.92, 0.92, 0.94], metal: 1, rough: 0.07 },
  carbon: { kind: 0, base: [0.03, 0.03, 0.035], metal: 0.5, rough: 0.28 },
  under: { kind: 0, base: [0.015, 0.015, 0.016], rough: 0.9 },
  interior: { kind: 0, base: [0.045, 0.042, 0.04], rough: 0.78 },
  seat: { kind: 0, base: [0.09, 0.05, 0.035], rough: 0.5, metal: 0.05 },
  lampF: { kind: 3, emis: [2.6, 2.6, 2.3] },
  lampR: { kind: 3, emis: [1.6, 0.05, 0.03] },
  lampA: { kind: 3, emis: [2.4, 1.1, 0.2] },
  lampLens: { kind: 2, base: [0.05, 0.05, 0.055], alpha: 0.35 },
  rubber: { kind: 5, base: [0.022, 0.022, 0.024], rough: 0.88 },
  rim: { kind: 0, base: [0.78, 0.79, 0.82], metal: 1, rough: 0.22 },
  rimDark: { kind: 0, base: [0.05, 0.05, 0.055], metal: 0.9, rough: 0.3 },
  disc: { kind: 0, base: [0.38, 0.38, 0.4], metal: 0.9, rough: 0.42 },
  caliper: { kind: 0, base: [0.75, 0.04, 0.03], rough: 0.35, metal: 0.2 },
  plate: { kind: 6, base: [1, 1, 1], rough: 0.5 },
};
export const MAT_ORDER = Object.keys(MATS);

// ---------- generic geometry accumulator (groups by part+material) ----------
export class Builder {
  constructor(off) {
    this.off = off; // geo -> local translation
    this.pos = []; this.nrm = []; this.col = []; this.uv = [];
    this.groups = new Map();
    this.nv = 0;
  }
  grp(part, mat) {
    const k = part * 64 + MAT_ORDER.indexOf(mat);
    let g = this.groups.get(k);
    if (!g) { g = { part, mat, idx: [], map: new Map() }; this.groups.set(k, g); }
    return g;
  }
  vert(x, y, z, nx, ny, nz, u, v, c0 = 1, c1 = 1, c2 = 1) {
    this.pos.push(x + this.off[0], y + this.off[1], z + this.off[2]);
    this.nrm.push(nx, ny, nz);
    this.col.push(c0, c1, c2);
    this.uv.push(u, v);
    return this.nv++;
  }
  // add a geo (in some local frame) transformed by matrix m (Float32Array16 or null)
  addGeo(geo, mat, part = 0, m = null, colMul = null) {
    const g = this.grp(part, mat);
    const n = geo.pos.length / 3;
    const base = this.nv;
    for (let i = 0; i < n; i++) {
      let x = geo.pos[i * 3], y = geo.pos[i * 3 + 1], z = geo.pos[i * 3 + 2];
      let nx = geo.nrm[i * 3], ny = geo.nrm[i * 3 + 1], nz = geo.nrm[i * 3 + 2];
      if (m) {
        const X = m[0] * x + m[4] * y + m[8] * z + m[12], Y = m[1] * x + m[5] * y + m[9] * z + m[13], Z = m[2] * x + m[6] * y + m[10] * z + m[14];
        const NX = m[0] * nx + m[4] * ny + m[8] * nz, NY = m[1] * nx + m[5] * ny + m[9] * nz, NZ = m[2] * nx + m[6] * ny + m[10] * nz;
        const l = Math.hypot(NX, NY, NZ) || 1;
        x = X; y = Y; z = Z; nx = NX / l; ny = NY / l; nz = NZ / l;
      }
      const c = colMul || [1, 1, 1];
      this.vert(x, y, z, nx, ny, nz, mat === 'paint' ? 3 : geo.uv[i * 2], mat === 'paint' ? 3 : geo.uv[i * 2 + 1], geo.col[i * 3] * c[0], geo.col[i * 3 + 1] * c[1], geo.col[i * 3 + 2] * c[2]);
    }
    for (let i = 0; i < geo.idx.length; i++) g.idx.push(geo.idx[i] + base);
  }
  // add triangles from a shared grid (dedupe per group)
  addGridTri(grid, tri) {
    const { v, cl } = tri;
    const g = this.grp(cl.part, cl.mat);
    for (const gi of v) {
      const key = gi * 8 + (grid.id || 0);
      let ni = g.map.get(key);
      if (ni === undefined) {
        const p = gi * 3;
        ni = this.vert(grid.pos[p], grid.pos[p + 1], grid.pos[p + 2], grid.nrm[p], grid.nrm[p + 1], grid.nrm[p + 2], grid.uv[gi * 2], grid.uv[gi * 2 + 1], grid.col[p], grid.col[p + 1], grid.col[p + 2]);
        g.map.set(key, ni);
      }
      g.idx.push(ni);
    }
  }
  finish() {
    const keys = [...this.groups.keys()].sort((a, b) => a - b);
    const total = keys.reduce((s, k) => s + this.groups.get(k).idx.length, 0);
    const idx = new Uint32Array(total);
    const groups = [];
    let o = 0;
    for (const k of keys) {
      const g = this.groups.get(k);
      idx.set(g.idx, o);
      groups.push({ start: o, count: g.idx.length, mat: g.mat, part: g.part });
      o += g.idx.length;
    }
    const geo = { pos: new Float32Array(this.pos), nrm: new Float32Array(this.nrm), col: new Float32Array(this.col), uv: new Float32Array(this.uv), idx };
    fixWinding(geo);
    return { geo, groups };
  }
}

const rotX = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]); };
const rotY = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]); };
const rotZ = (a) => { const c = Math.cos(a), s = Math.sin(a); return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };
const mmul = (a, b) => { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + j] * b[i * 4 + k]; o[i * 4 + j] = s; } return o; };
const tr = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
export const M = { rotX, rotY, rotZ, mmul, tr };

// ---------- full body assembly ----------
export function buildCarGeometry(spec) {
  const g = spec.geo, id = spec.id, S = SHAPES[id];
  const zcg = g.zFA + (g.zRA - g.zFA) * g.wR;
  const off = [0, -g.cgY, -zcg];
  const B = buildBody(spec);
  const G = buildGlass(spec, B);
  const out = new Builder(off);
  const L = g.L;

  // ---- body grid normals / uv / colour
  const nBody = B.nS * B.M;
  const bNrm = new Float32Array(nBody * 3);
  const bUv = new Float32Array(nBody * 2), bCol = new Float32Array(nBody * 3).fill(1);
  // base triangle list for normals (all quads, orientation fixed below)
  const idxAll = [];
  for (let i = 0; i < B.nS - 1; i++)
    for (let j = 0; j < B.M; j++) {
      const j2 = (j + 1) % B.M;
      const a = i * B.M + j, b = i * B.M + j2, c = (i + 1) * B.M + j2, d = (i + 1) * B.M + j;
      idxAll.push(a, d, c, a, c, b);
    }
  computeNormals(B.pos, idxAll, bNrm);
  // outward check on a flank vertex
  {
    const i = Math.floor(B.nS / 2), j = Math.floor(B.K / 2) + 3;
    const o = (i * B.M + j) * 3;
    if (bNrm[o] * Math.sign(B.pos[o]) < 0 && Math.abs(B.pos[o]) > 0.2) { for (let t = 0; t < idxAll.length; t += 3) { const x = idxAll[t + 1]; idxAll[t + 1] = idxAll[t + 2]; idxAll[t + 2] = x; } computeNormals(B.pos, idxAll, bNrm); }
  }
  // poles
  for (let i of [0, B.nS - 1]) for (let j = 0; j < B.M; j++) { const o = (i * B.M + j) * 3; const l = Math.hypot(bNrm[o], bNrm[o + 1], bNrm[o + 2]); if (l < 0.5) { bNrm[o] = 0; bNrm[o + 1] = 0.1; bNrm[o + 2] = i === 0 ? -1 : 1; } }
  for (let i = 0; i < B.nS; i++)
    for (let j = 0; j < B.M; j++) {
      const o = i * B.M + j;
      bUv[o * 2] = j / B.M; bUv[o * 2 + 1] = B.zs[i] / L;
      const y = B.pos[o * 3 + 1];
      const bt = B.fn.bot(B.zs[i]);
      const ao = 0.6 + 0.4 * smoothstep(bt, bt + 0.3, y);
      bCol[o * 3] = bCol[o * 3 + 1] = bCol[o * 3 + 2] = ao;
    }
  const bGrid = { pos: B.pos, nrm: bNrm, uv: bUv, col: bCol };
  const hwAt = B.fn.hw;
  const classB = (a, b, c, d, i, j) => {
    const sn = B.snapped[a] + B.snapped[b] + B.snapped[c] + B.snapped[d];
    if (sn >= 3) return null;
    const p = B.pos;
    const cx = (p[a * 3] + p[b * 3] + p[c * 3] + p[d * 3]) / 4, cy = (p[a * 3 + 1] + p[b * 3 + 1] + p[c * 3 + 1] + p[d * 3 + 1]) / 4, cz = (p[a * 3 + 2] + p[b * 3 + 2] + p[c * 3 + 2] + p[d * 3 + 2]) / 4;
    const ny = (bNrm[a * 3 + 1] + bNrm[b * 3 + 1] + bNrm[c * 3 + 1] + bNrm[d * 3 + 1]) / 4;
    const ax = Math.abs(cx), side = cx >= 0 ? 1 : -1;
    const W = hwAt(cz);
    let part = PART.BODY, mat = 'paint';
    if (ny < -0.7) mat = 'under';
    if (cz < S.bumF) part = PART.BUMF;
    else if (cz > S.bumR) part = PART.BUMR;
    else if (ny > 0.5 && ax < W * 0.7 && cz >= S.hood[0] && cz <= S.hood[1]) part = PART.HOOD;
    else if (ny > 0.5 && ax < W * 0.7 && cz >= S.trunk[0] && cz <= S.trunk[1]) part = PART.TRUNK;
    else if (cz >= S.door[0] && cz <= S.door[1] && ax > W * 0.75 && ny < 0.6 && cy > B.fn.bot(cz) + 0.1) part = side > 0 ? PART.DOORR : PART.DOORL;
    return { mat, part };
  };
  for (const t of gridTris(B.pos, B.nS, B.M, true, classB)) {
    // gridTris builds a,b,c / a,c,d; our normals assume a,d,c / a,c,b winding -> reverse for rendering later via fixWinding check
    out.addGridTri(bGrid, t);
  }

  // ---- glasshouse grid
  const nG = G.nS * G.Mg;
  const gNrm = new Float32Array(nG * 3), gUv = new Float32Array(nG * 2), gCol = new Float32Array(nG * 3).fill(1);
  const idxG = [];
  for (let i = 0; i < G.nS - 1; i++)
    for (let j = 0; j < G.Mg - 1; j++) {
      const a = i * G.Mg + j, b = i * G.Mg + j + 1, c = (i + 1) * G.Mg + j + 1, d = (i + 1) * G.Mg + j;
      idxG.push(a, d, c, a, c, b);
    }
  computeNormals(G.pos, idxG, gNrm);
  {
    const i = Math.floor(G.nS / 2), j = Math.floor(G.Mg / 2);
    const o = (i * G.Mg + j) * 3;
    if (gNrm[o + 1] < 0) { for (let t = 0; t < idxG.length; t += 3) { const x = idxG[t + 1]; idxG[t + 1] = idxG[t + 2]; idxG[t + 2] = x; } computeNormals(G.pos, idxG, gNrm); }
  }
  for (let i = 0; i < G.nS; i++) for (let j = 0; j < G.Mg; j++) { gUv[(i * G.Mg + j) * 2] = j / (G.Mg - 1); gUv[(i * G.Mg + j) * 2 + 1] = G.zs[i] / L; }
  const gGrid = { pos: G.pos, nrm: gNrm, uv: gUv, col: gCol, id: 1 };
  const gh = S.gh;
  const classG = (a, b, c, d, i, j) => {
    const p = G.pos;
    const cz = (p[a * 3 + 2] + p[c * 3 + 2]) / 2, cx = (p[a * 3] + p[c * 3]) / 2;
    const tq = Math.abs((j + 0.5) - G.Kg) / G.Kg; // 0 centre-roof, 1 belt
    const H = G.heights[i];
    if (H < 0.012 && G.heights[i + 1] < 0.012) return { mat: 'paint', part: PART.BODY };
    let part = PART.BODY, mat = 'paint';
    const side = cx >= 0 ? 1 : -1;
    const inDoor = cz >= S.door[0] && cz <= S.door[1];
    if (tq >= 0.33 && inDoor) part = side > 0 ? PART.DOORR : PART.DOORL;
    const z0 = gh.R[0][0], z1 = gh.R[gh.R.length - 1][0];
    if (tq < 0.31) {
      if (cz < gh.roofZ[0]) mat = tq < 0.25 && cz > z0 + 0.03 ? 'glass' : 'paint';
      else if (cz > gh.roofZ[1]) mat = tq < 0.25 && cz < z1 - 0.03 ? 'glass' : 'paint';
      else mat = 'paint';
    } else if (tq < 0.42) mat = 'paint';
    else {
      const inWin = cz > gh.win[0] + gh.pillarA && cz < gh.win[1] - gh.pillarA * 0.8;
      const inB = gh.bpillar && Math.abs(cz - gh.bpillar[0]) < gh.bpillar[1] / 2;
      mat = inWin && !inB ? 'glass' : 'paint';
    }
    return { mat, part };
  };
  for (const t of gridTris(G.pos, G.nS, G.Mg, false, classG)) out.addGridTri(gGrid, t);

  addDetails(out, spec, B, bNrm, G);
  return { out, B, G, off, zcg, S };
}

// ---------- wheels ----------
// Wheel frame: axis = +X (outer face towards +x). Returns {spin: {geo,groups}, caliper: {geo,groups}}.
export function buildWheel(R, tw, style) {
  const b = new Builder([0, 0, 0]);
  const half = tw / 2;
  const rr = R * 0.7; // rim radius (bead seat)
  // tyre profile (r, axial) smoothed
  const prof = cardinal([
    [rr - 0.005, -half * 0.86], [rr + (R - rr) * 0.22, -half * 1.0], [rr + (R - rr) * 0.7, -half * 0.97], [R - 0.014, -half * 0.84],
    [R, -half * 0.5], [R, half * 0.5], [R - 0.014, half * 0.84], [rr + (R - rr) * 0.7, half * 0.97], [rr + (R - rr) * 0.22, half * 1.0], [rr - 0.005, half * 0.86],
  ], [2, 2, 2, 2, 3, 2, 2, 2, 2]);
  prof.push([rr - 0.03, half * 0.6], [rr - 0.03, -half * 0.6], [rr - 0.005, -half * 0.86]);
  const toAxis = rotZ(-Math.PI / 2); // lathe about Y -> about X
  const tyre = lathe(prof.map(([r, y]) => [r, y]), 40);
  b.addGeo(tyre, 'rubber', 0, toAxis);
  // rim barrel + lip
  const rim = lathe([[rr - 0.03, -half * 0.7], [rr - 0.012, -half * 0.7], [rr - 0.012, half * 0.55], [rr + 0.004, half * 0.78], [rr + 0.012, half * 0.9], [rr - 0.006, half * 0.93]], 40);
  b.addGeo(rim, 'rim', 0, toAxis);
  // face disc (dark dish behind spokes) and hub
  const dish = lathe([[0.001, half * 0.28], [rr * 0.2, half * 0.26], [rr * 0.5, half * 0.1], [rr * 0.93, half * 0.05], [rr * 0.93, -half * 0.5]], 36);
  b.addGeo(dish, 'rimDark', 0, toAxis);
  const hub = lathe([[0.001, half * 0.74], [rr * 0.18, half * 0.74], [rr * 0.2, half * 0.68], [rr * 0.2, half * 0.5]], 20);
  b.addGeo(hub, 'chrome', 0, toAxis);
  // spokes
  const sx = half * 0.62;
  const spoke = (ang, w, th, r0, r1, skew = 0) => {
    const len = r1 - r0;
    const geo = rbox(th, len / 2, w / 2, Math.min(th, w / 2) * 0.6, 1);
    // place along +Y local then rotate around X
    const place = M.mmul(tr(sx, 0, 0), M.mmul(rotX(ang), tr(0, (r0 + r1) / 2, 0)));
    const m2 = skew ? M.mmul(place, rotY(skew)) : place;
    b.addGeo(geo, 'rim', 0, m2);
  };
  if (style === 'multi') for (let i = 0; i < 10; i++) spoke((i / 10) * Math.PI * 2, rr * 0.13, 0.012, rr * 0.2, rr * 0.96);
  else if (style === '5dbl') for (let i = 0; i < 5; i++) for (const o of [-0.1, 0.1]) spoke((i / 5) * Math.PI * 2 + o, rr * 0.12, 0.014, rr * 0.2, rr * 0.96);
  else for (let i = 0; i < 14; i++) spoke((i / 14) * Math.PI * 2, rr * 0.11, 0.01, rr * 0.2, rr * 0.96, 0.35);
  // brake disc (inboard of spokes) with a hat
  const disc = cylinder(rr * 0.88, rr * 0.88, 0.032, 36);
  b.addGeo(disc, 'disc', 0, M.mmul(tr(half * 0.12, 0, 0), rotZ(-Math.PI / 2)));
  const spin = b.finish();
  const c = new Builder([0, 0, 0]);
  const cal = rbox(0.045, rr * 0.2, rr * 0.34, 0.012, 2);
  c.addGeo(cal, 'caliper', 0, M.mmul(rotX(0.9), tr(half * 0.12, rr * 0.7, 0)));
  const caliper = c.finish();
  return { spin, caliper, rr };
}

// ---------- surface snapping helpers ----------
function makeSnap(B, bNrm) {
  const n = B.nS * B.M;
  const P = B.pos;
  const pick = (score) => {
    let best = -1, bs = Infinity;
    for (let i = 0; i < n; i++) { const s = score(P[i * 3], P[i * 3 + 1], P[i * 3 + 2], bNrm[i * 3], bNrm[i * 3 + 1], bNrm[i * 3 + 2]); if (s < bs) { bs = s; best = i; } }
    return { p: [P[best * 3], P[best * 3 + 1], P[best * 3 + 2]], n: [bNrm[best * 3], bNrm[best * 3 + 1], bNrm[best * 3 + 2]] };
  };
  return {
    top: (x, z) => pick((px, py, pz, nx, ny) => (ny < 0.15 ? 1e9 : (px - x) ** 2 * 2 + (pz - z) ** 2 * 2 - py * 0.05)),
    front: (x, y) => pick((px, py, pz, nx, ny, nz) => (nz > -0.1 ? 1e9 : (px - x) ** 2 + (py - y) ** 2 + pz * 0.02)),
    rear: (x, y) => pick((px, py, pz, nx, ny, nz) => (nz < 0.1 ? 1e9 : (px - x) ** 2 + (py - y) ** 2 - pz * 0.02)),
    side: (z, y, sd) => pick((px, py, pz, nx) => (nx * sd < 0.2 || px * sd < 0 ? 1e9 : (pz - z) ** 2 + (py - y) ** 2 - Math.abs(px) * 0.02)),
  };
}
// matrix whose local +Y = n, local -Z = projected "forward" (towards car front), local X = right
function frameMat(p, n, yaw = 0, fwd = [0, 0, -1]) {
  let ny = Math.hypot(n[0], n[1], n[2]) || 1;
  const up = [n[0] / ny, n[1] / ny, n[2] / ny];
  let f = [fwd[0] - up[0] * (fwd[0] * up[0] + fwd[1] * up[1] + fwd[2] * up[2]), fwd[1] - up[1] * (fwd[0] * up[0] + fwd[1] * up[1] + fwd[2] * up[2]), fwd[2] - up[2] * (fwd[0] * up[0] + fwd[1] * up[1] + fwd[2] * up[2])];
  const fl = Math.hypot(f[0], f[1], f[2]) || 1; f = [f[0] / fl, f[1] / fl, f[2] / fl];
  // right = f x up
  const r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
  const m = new Float32Array([r[0], r[1], r[2], 0, up[0], up[1], up[2], 0, -f[0], -f[1], -f[2], 0, p[0], p[1], p[2], 1]);
  return yaw ? mmul(m, rotY(yaw)) : m;
}
export { frameMat };

// ---------- details ----------
export function addDetails(out, spec, B, bNrm, G) {
  const S = SHAPES[spec.id], g = spec.geo, L = g.L, look = S.look;
  const snap = makeSnap(B, bNrm);
  const W = B.fn.hw, top = B.fn.top, bot = B.fn.bot;
  const both = (fn) => { fn(1); fn(-1); };
  const add = (geo, mat, part, m) => out.addGeo(geo, mat, part, m);
  // ---- headlights
  const frontLamp = (sd) => {
    const x = sd * W(0.35) * (look.lamps === 'round' ? 0.68 : look.lamps === 'ring' ? 0.7 : 0.66);
    const zl = look.lamps === 'round' ? 0.42 : 0.3;
    const h = snap.top(x, zl);
    const nn = h.n;
    if (look.lamps === 'blade' || look.lamps === 'slim') {
      const w = look.lamps === 'slim' ? 0.17 : 0.2, d = 0.055;
      const m = frameMat([h.p[0], h.p[1] + 0.004, h.p[2]], nn, sd * -0.35);
      add(rbox(w, 0.012, d, 0.008, 1), 'trim', 0, m);
      add(rbox(w * 0.9, 0.013, d * 0.28, 0.005, 1), 'lampF', 0, mmul(m, tr(0, 0.003, -d * 0.35)));
      add(rbox(w * 0.7, 0.013, d * 0.18, 0.004, 1), 'lampF', 0, mmul(m, tr(-sd * w * 0.1, 0.003, d * 0.35)));
    } else if (look.lamps === 'round') {
      const m = frameMat([h.p[0], h.p[1], h.p[2]], nn, 0);
      add(cylinder(0.095, 0.095, 0.05, 24), 'trim', 0, mmul(m, tr(0, 0.006, 0)));
      add(sphere2(0.088), 'lampF', 0, mmul(m, tr(0, 0.028, 0)));
      add(torus(0.093, 0.008, 24, 6), 'chrome', 0, mmul(m, tr(0, 0.03, 0)));
    } else if (look.lamps === 'ring') {
      const m = frameMat([h.p[0], h.p[1], h.p[2]], nn, 0);
      add(cylinder(0.1, 0.1, 0.05, 24), 'trim', 0, mmul(m, tr(0, 0.005, 0)));
      add(torus(0.07, 0.014, 24, 8), 'lampF', 0, mmul(m, tr(0, 0.028, 0)));
      add(sphere2(0.042), 'lampF', 0, mmul(m, tr(0, 0.03, 0)));
    }
  };
  both(frontLamp);
  // ---- grille / intakes
  const fr = (x, y, w, h, mat, d = 0.012) => {
    const s = snap.front(x, y);
    const m = frameMat(s.p, s.n, 0, [0, 0, -1]);
    // box standing on the front face: local Y = normal -> rotate so box depth aligns with normal
    add(rbox(w / 2, d, h / 2, 0.006, 1), mat, 0, mmul(m, rotX(0)));
  };
  const lowY = bot(0.05);
  if (look.grille === 'lowwide' || look.grille === 'horseshoe') {
    fr(0, lowY + 0.17, W(0.1) * 1.2, 0.1, 'mesh');
    both((sd) => fr(sd * W(0.1) * 0.78, lowY + 0.2, 0.28, 0.11, 'mesh'));
  } else if (look.grille === 'muscle') {
    fr(0, lowY + 0.2, 0.9, 0.1, 'mesh');
    both((sd) => fr(sd * 0.62, lowY + 0.17, 0.28, 0.1, 'mesh'));
  } else if (look.grille === 'luxe') {
    fr(0, lowY + 0.3, 0.6, 0.34, 'chrome', 0.006);
    fr(0, lowY + 0.3, 0.56, 0.3, 'mesh', 0.01);
    fr(0, lowY + 0.1, 1.0, 0.1, 'mesh');
  } else if (look.grille === 'suv') {
    fr(0, lowY + 0.34, 0.95, 0.42, 'chrome', 0.006);
    fr(0, lowY + 0.34, 0.9, 0.38, 'mesh', 0.01);
    fr(0, lowY + 0.1, 1.1, 0.12, 'mesh');
  } else if (look.grille === 'round') {
    fr(0, lowY + 0.12, 1.1, 0.12, 'mesh');
    both((sd) => fr(sd * 0.7, lowY + 0.13, 0.3, 0.13, 'mesh'));
  }
  // ---- tail lights
  const tail = (sd) => {
    const x = sd * W(L - 0.15) * 0.72;
    const y = Math.min(top(L - 0.2), 1.1) - 0.1;
    const s = snap.rear(x, y);
    const m = frameMat(s.p, s.n, 0, [0, 0, 1]);
    const lw = look.tail === 'wide' ? 0.26 : 0.2;
    add(rbox(lw, 0.008, 0.04, 0.004, 1), 'lampR', 0, mmul(m, tr(0, 0.002, 0)));
    add(rbox(lw * 1.08, 0.006, 0.05, 0.004, 1), 'trim', 0, mmul(m, tr(0, 0.0, 0)));
  };
  both(tail);
  if (look.tail === 'bar') {
    const s = snap.rear(0, Math.min(top(L - 0.2), 1.1) - 0.1);
    add(rbox(W(L - 0.15) * 0.5, 0.008, 0.012, 0.004, 1), 'lampR', 0, frameMat(s.p, s.n, 0, [0, 0, 1]));
  }
  // ---- mirrors
  both((sd) => {
    const mi = S.mirror, part = sd > 0 ? PART.MIRR : PART.MIRL;
    const m = tr(sd * mi.x, mi.y, mi.z);
    add(rbox(0.07, 0.045, 0.09, 0.025, 2), look.wing === 'big' ? 'carbon' : 'paint', part, mmul(m, mmul(rotY(sd * -0.15), tr(sd * 0.05, 0, 0))));
    add(rbox(0.05, 0.012, 0.04, 0.006, 1), 'trim', part, mmul(m, tr(sd * 0.0, -0.035, 0.03)));
  });
  // ---- door handles
  both((sd) => {
    const s = snap.side(S.door[0] + (S.door[1] - S.door[0]) * 0.7, (bot(2) + top(2)) / 2 + 0.06, sd);
    const m = new Float32Array([0, 0, -sd, 0, 0, 1, 0, 0, sd, 0, 0, 0, s.p[0], s.p[1], s.p[2], 1]);
    add(rbox(0.09, 0.014, 0.012, 0.006, 1), 'trim', sd > 0 ? PART.DOORR : PART.DOORL, mmul(tr(s.p[0] + sd * 0.004, s.p[1], s.p[2]), rotY(0)));
  });
  // ---- exhaust
  for (const ex of S.exhaust.x) {
    const m = mmul(tr(ex, S.exhaust.y, S.exhaust.z - 0.02), rotX(Math.PI / 2));
    add(cylinder(0.05, 0.05, 0.12, 20, false, false), 'chrome', PART.BUMR, m);
    add(cylinder(0.044, 0.044, 0.14, 20, false, true), 'under', PART.BUMR, mmul(m, tr(0, -0.01, 0)));
  }
  // ---- wing / spoilers
  if (look.wing === 'big' || look.wing === 'active') {
    const z = L - 0.28, y = top(z) + 0.32;
    const w = W(z) * 0.98;
    add(rbox(w, 0.012, 0.16, 0.008, 1), 'carbon', PART.WING, tr(0, y, z));
    both((sd) => { add(rbox(0.01, 0.1, 0.17, 0.006, 1), 'carbon', PART.WING, tr(sd * w, y - 0.03, z)); add(rbox(0.015, 0.16, 0.02, 0.008, 1), 'carbon', PART.WING, tr(sd * w * 0.35, y - 0.17, z + 0.04)); });
  } else if (look.wing === 'duck') {
    const z = L - 0.45, y = top(z) + 0.02;
    add(rbox(W(z) * 0.55, 0.01, 0.1, 0.006, 1), 'carbon', PART.WING, tr(0, y, z));
  } else if (look.wing === 'lip') {
    const z = L - 0.22, y = top(z) + 0.05;
    add(rbox(W(z) * 0.62, 0.016, 0.07, 0.008, 1), 'paint', PART.WING, tr(0, y, z));
  } else if (look.wing === 'roof') {
    const z = G.zs[G.zs.length - 1] + 0.12, y = SHAPES.titan.gh.R[SHAPES.titan.gh.R.length - 1][1] + 0.1;
    add(rbox(0.7, 0.012, 0.09, 0.006, 1), 'paint', PART.WING, tr(0, 1.45, z - 0.1));
  }
  // ---- splitter / diffuser
  const lipY = bot(0.1) - 0.0;
  add(rbox(W(0.3) * 0.82, 0.012, 0.06, 0.006, 1), 'carbon', PART.BUMF, tr(0, lipY + 0.005, 0.0));
  if (S.look.diffuser) add(rbox(W(L - 0.3) * 0.7, 0.015, 0.1, 0.006, 1), 'carbon', PART.BUMR, tr(0, bot(L - 0.1) + 0.04, L - 0.12));
  // ---- plates
  const plate = (front) => {
    if (front) { const s = snap.front(0, bot(0.05) + 0.09); add(rbox(0.26, 0.095, 0.006, 0.003, 1), 'plate', PART.BUMF, mmul(tr(s.p[0], s.p[1], s.p[2] - 0.004), rotX(0))); }
    else { const s = snap.rear(0, bot(L - 0.05) + 0.17); add(rbox(0.26, 0.095, 0.006, 0.003, 1), 'plate', PART.BUMR, tr(s.p[0], s.p[1], s.p[2] + 0.004)); }
  };
  if (S.plate.f) plate(true);
  if (S.plate.r) plate(false);
  // ---- interior
  const sz = S.seat.z, sy = S.seat.y;
  const cabY0 = sy + 0.28;
  add(rbox(W(sz) * 0.8, 0.01, (S.gh.R[S.gh.R.length - 1][0] - S.gh.R[0][0]) / 2 * 0.9, 0.005, 1), 'interior', 0, tr(0, sy - 0.3, (S.gh.R[0][0] + S.gh.R[S.gh.R.length - 1][0]) / 2));
  both((sd) => {
    const seat = tr(sd * 0.36, cabY0 - 0.22, sz + 0.1);
    add(rbox(0.22, 0.05, 0.25, 0.03, 2), 'seat', 0, seat);
    add(rbox(0.21, 0.28, 0.05, 0.03, 2), 'seat', 0, mmul(seat, mmul(tr(0, 0.28, 0.24), rotX(-0.2))));
    add(rbox(0.07, 0.1, 0.04, 0.02, 1), 'seat', 0, mmul(seat, tr(0, 0.5, 0.31)));
  });
  const dz = S.gh.R[0][0] + 0.25;
  add(rbox(W(dz) * 0.75, 0.09, 0.2, 0.04, 2), 'interior', 0, tr(0, cabY0 - 0.12, dz));
  add(torus(0.17, 0.016, 24, 8), 'trim', 0, mmul(tr(-0.36, cabY0 + 0.0, dz + 0.22), rotX(1.1)));
  add(rbox(0.07, 0.12, 0.28, 0.03, 1), 'interior', 0, tr(0, cabY0 - 0.2, sz + 0.1));
}
function sphere2(r) { return lathe(Array.from({ length: 9 }, (_, i) => { const a = (i / 8) * Math.PI * 0.5; return [Math.sin(a) * r + 0.0005, Math.cos(a) * r * 0.5]; }), 20); }

// ---------- decal texture (panel gaps etc.) in (u = ring index fraction, v = z / L) space ----------
export function paintDecals(ctx, W, H, spec, B) {
  const S = SHAPES[spec.id], L = spec.geo.L;
  ctx.clearRect(0, 0, W, H);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const stationAt = (z) => { let bi = 0, bd = 1e9; for (let i = 0; i < B.nS; i++) { const d = Math.abs(B.zs[i] - z); if (d < bd) { bd = d; bi = i; } } return bi; };
  // right-hand ring index for a given height on the flank (j in 0..K), or for a given |x| on the top
  const jForY = (st, y) => { const h = B.sec[st]; for (let j = 3; j < B.K - 1; j++) if (h[j][1] >= y && h[j + 1][1] < y) return j + (h[j][1] - y) / (h[j][1] - h[j + 1][1] || 1); return 4; };
  const jForX = (st, x) => { const h = B.sec[st]; for (let j = 0; j < 4; j++) if (h[j][0] <= x && h[j + 1][0] > x) return j + (x - h[j][0]) / (h[j + 1][0] - h[j][0] || 1); return x > h[3][0] ? 3 : 0; };
  const px = (u, z) => [u * W, (z / L) * H];
  const line = (pts, w = 2, a = 0.85) => {
    ctx.strokeStyle = `rgba(6,6,8,${a})`; ctx.lineWidth = w;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.stroke();
  };
  const bot = B.fn.bot, top = B.fn.top, sh = B.fn.sh, hw = B.fn.hw;
  for (const sd of [1, -1]) {
    const U = (j) => (sd > 0 ? j / B.M : 1 - j / B.M);
    // door
    const [d0, d1] = S.door;
    const yLow = (z) => bot(z) + 0.1;
    const vert = (z) => { const st = stationAt(z); return [px(U(jForY(st, yLow(z))), z), px(U(jForY(st, sh(z) - 0.02)), z)]; };
    line(vert(d0)); line(vert(d1));
    const bottom = [], beltL = [];
    for (let z = d0; z <= d1; z += 0.05) { const st = stationAt(z); bottom.push(px(U(jForY(st, yLow(z))), z)); }
    line(bottom);
    // door mirror triangle / belt trim handled by geometry
  }
  // hood / trunk shut lines (cross the top centre: u wraps around 0)
  const across = (z, frac) => {
    const st = stationAt(z), x = hw(z) * frac, j = jForX(st, x), u = j / B.M;
    line([px(u, z), px(0, z)]); line([px(1, z), px(1 - u, z)]);
  };
  const side = (z0, z1, frac) => {
    for (const sd of [1, -1]) {
      const pts = [];
      for (let z = z0; z <= z1; z += 0.05) { const st = stationAt(z), j = jForX(st, hw(z) * frac); pts.push(px(sd > 0 ? j / B.M : 1 - j / B.M, z)); }
      line(pts);
    }
  };
  across(S.hood[0], 0.7); side(S.hood[0], S.hood[1], 0.7); across(S.hood[1], 0.7);
  across(S.trunk[0], 0.7); side(S.trunk[0], S.trunk[1], 0.7); across(S.trunk[1], 0.7);
  // fuel flap
  // soft darker band along the lower rocker
  ctx.fillStyle = 'rgba(0,0,0,0.0)';
}
