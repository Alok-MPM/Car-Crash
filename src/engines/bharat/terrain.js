// TERRAIN: the real ground of Bharat, as a height function plus the meshes that show it.
//   h(x, z)  height above the frame's y = 0 (y = 0 is E0 metres above sea level), from the real 30 m elevation data (bicubic), a little fine-scale detail whose size
//            follows how rough the real ground is there, optional carved river channels, and optional flat platforms (stamps) where hand-built content stands.
//   Everything else (physics contacts, suspension rays, the walking person, the meshes) uses this one function, so what you see is what you drive on.
//   Meshes: a quadtree of 128 m ... 4 km chunks (33 x 33 vertices each) round the camera, about 6 km in every direction; chunks that are not built yet are covered by a
//   coarser parent, chunk edges have skirts, so there are never holes.
import { toTile, fromTile } from './geo.js';
import { Regions } from './regions.js';

const TS = 256;
const hash2 = (i, j) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1), su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

export const LEAF0 = 128, LEVELS = 6, REACH = 6200;

export class Terrain {
  constructor(dem, r) {
    this.dem = dem; this.r = r; this.Z = dem.zoom;
    this.frame = null; this.stamps = []; this.carve = null; this.carveColor = null;
    this.chunks = new Map(); this.frameNo = 0; this.visible = []; this.lastCam = [1e12, 1e12]; this.dirty = true;
    this.mat = { kind: 7, base: [1, 1, 1], texScale: 1, flake: 4, poly: -1, under: true };   // flake 4: the ground shader reads colour / moisture / cover from the vertices
    this.stats = { built: 0, leaves: 0, hits: 0 };
    this.detailOn = true;
    this.reg = new Regions(); this._gc = [0, 0, 0, 0, 0, 0];
    this._ceil = new Map();
    const prev = dem.onChange;
    dem.onChange = (t) => { this._ceil.clear(); if (prev) prev(t); };
  }
  // call after stamps / carve change: cached ceilings and chunk meshes are stale
  invalidate() { this._ceil.clear(); this.dropChunks(); this.dirty = true; }
  // a new local frame (frames re-centre the world every few km so numbers stay small); chunk meshes of the old frame are dropped
  setFrame(frame) { this._applyFrame(frame); this.dropChunks(); this._ceil.clear(); this.dirty = true; this.nearReady = false; }
  _applyFrame(frame) {
    this.frame = frame; this.E0 = frame.E0;
    const t = toTile(frame.lat0, frame.lon0, this.Z);
    this.gx0 = t[0] * TS; this.gy0 = t[1] * TS;
    // true ground metres per pixel along each axis at this latitude (web-Mercator is conformal only on a sphere; on the ellipsoid the two differ by about half a percent)
    const k = 360 / (TS * 2 ** this.Z), cl = Math.cos(frame.lat0 * Math.PI / 180);
    this.sx = frame.mPerDegLon * k; this.sz = frame.mPerDegLat * cl * k; this.s = Math.min(this.sx, this.sz);
  }
  dropChunks() { for (const c of this.chunks.values()) if (c.mesh) this.r.deleteMesh(c.mesh); this.chunks.clear(); this.visible = []; this.lastCam = [1e12, 1e12]; }
  // global pixel coordinates of a local point, and back (the player is moved through these on a re-centre, so the ground under it never jumps)
  toPix(x, z) { return [this.gx0 + x / this.sx, this.gy0 + z / this.sz]; }
  fromPix(gx, gy) { return [(gx - this.gx0) * this.sx, (gy - this.gy0) * this.sz]; }
  // lat / lon <-> local metres (through the pixel grid, so the ground, rivers and towns all agree)
  localToGeo(x, z) { const p = this.toPix(x, z); return fromTile(p[0] / TS, p[1] / TS, this.Z); }
  geoToLocal(lat, lon) { const t = toTile(lat, lon, this.Z); return this.fromPix(t[0] * TS, t[1] * TS); }
  // real elevation above sea level (m) at a local point, without detail / carve / stamps
  elev(x, z) {
    const v = this.dem.bicubic(this.Z, this.gx0 + x / this.sx, this.gy0 + z / this.sz);
    if (v === v) return v;
    const g = this.localToGeo(x, z), w = this.dem.elevGeo(g[0], g[1]);
    return w === w ? w : (this.lastElev === undefined ? this.E0 : this.lastElev);
  }
  _rel(gx, gy) {
    const i = Math.floor(gx - 0.5), j = Math.floor(gy - 0.5), u = gx - 0.5 - i, v = gy - 0.5 - j, d = this.dem, Z = this.Z;
    return (d.rel(Z, i, j) * (1 - u) + d.rel(Z, i + 1, j) * u) * (1 - v) + (d.rel(Z, i, j + 1) * (1 - u) + d.rel(Z, i + 1, j + 1) * u) * v;
  }
  // height of the ground in the frame (y = 0 is E0 above sea level)
  h(x, z) {
    const gx = this.gx0 + x / this.sx, gy = this.gy0 + z / this.sz;
    let e = this.dem.bicubic(this.Z, gx, gy);
    if (e !== e) { const g = this.localToGeo(x, z); e = this.dem.elevGeo(g[0], g[1]); if (e !== e) e = this.lastElev === undefined ? this.E0 : this.lastElev; }
    else this.lastElev = e;
    let y = e - this.E0;
    if (this.detailOn) {
      const amp = Math.min(3, 0.03 + 0.04 * this._rel(gx, gy));
      y += amp * (0.55 * vnoise(gx * 0.9, gy * 0.9) + 0.3 * vnoise(gx * 2.3 + 17.1, gy * 2.3 + 5.7) + 0.15 * vnoise(gx * 6.1 + 3.3, gy * 6.1 + 9.1));
    }
    if (this.carve) y += this.carve(x, z, y);
    for (let i = 0; i < this.stamps.length; i++) {
      const p = this.stamps[i], dx = Math.max(p.x0 - x, 0, x - p.x1), dz = Math.max(p.z0 - z, 0, z - p.z1);
      const d = Math.hypot(dx, dz);
      if (d < p.blend) y += (p.y - y) * (1 - sstep(0, p.blend, d));
    }
    return y;
  }
  // 1 on a platform, falling to 0 over its blend ring
  stampW(x, z) {
    let w = 0;
    for (let i = 0; i < this.stamps.length; i++) {
      const p = this.stamps[i], d = Math.hypot(Math.max(p.x0 - x, 0, x - p.x1), Math.max(p.z0 - z, 0, z - p.z1));
      if (d < p.blend) { const k = 1 - sstep(0, p.blend, d); if (k > w) w = k; }
    }
    return w;
  }
  // unit normal (written into out)
  n(x, z, out) {
    const e = 0.6, a = this.h(x - e, z), b = this.h(x + e, z), c = this.h(x, z - e), d = this.h(x, z + e);
    let nx = a - b, ny = 2 * e, nz = c - d; const l = Math.hypot(nx, ny, nz);
    out[0] = nx / l; out[1] = ny / l; out[2] = nz / l; return out;
  }
  // highest ground inside a box (9 samples + a margin): lets the physics skip bodies that are clearly above the ground
  hMax(x0, z0, x1, z1) {
    const xm = (x0 + x1) / 2, zm = (z0 + z1) / 2;
    let m = this.h(xm, zm);
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [xm, z0], [xm, z1], [x0, zm], [x1, zm]]) { const v = this.h(x, z); if (v > m) m = v; }
    return m + 0.35;
  }
  // highest ground over a box, for the physics (a body whose lowest point is above this cannot touch the ground). Memoised per 32 m cell: 25 samples + a margin for what lies between them
  ceil(x0, z0, x1, z1) {
    const i0 = Math.floor(x0 / 32), i1 = Math.floor(x1 / 32), j0 = Math.floor(z0 / 32), j1 = Math.floor(z1 / 32);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 64) return 1e9;           // a very large box: never culled
    let m = -1e9;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = (i + 4096) * 8192 + (j + 4096); let v = this._ceil.get(key);
      if (v === undefined) {
        let mx = -1e9, mn = 1e9;
        for (let b = 0; b <= 4; b++) for (let a = 0; a <= 4; a++) { const y = this.h((i + a / 4) * 32, (j + b / 4) * 32); if (y > mx) mx = y; if (y < mn) mn = y; }
        v = mx + 0.9 + 0.1 * (mx - mn);
        if (this._ceil.size > 30000) this._ceil.clear();
        this._ceil.set(key, v);
      }
      if (v > m) m = v;
    }
    return m;
  }
  // first hit of a ray with the ground from above (origin must be above it): {t, n, ground} or null
  ray(o, d, maxT) {
    const f0 = o[1] - this.h(o[0], o[2]);
    if (f0 < 0) return null;
    let t = 0, f = f0, tp = 0;
    while (t < maxT) {
      tp = t; t += Math.max(0.12, f * 0.45); if (t > maxT) t = maxT;
      f = (o[1] + d[1] * t) - this.h(o[0] + d[0] * t, o[2] + d[2] * t);
      if (f <= 0) {
        let a = tp, b = t;
        for (let i = 0; i < 12; i++) { const m = (a + b) / 2; if ((o[1] + d[1] * m) - this.h(o[0] + d[0] * m, o[2] + d[2] * m) > 0) a = m; else b = m; }
        const tt = (a + b) / 2, n = this.n(o[0] + d[0] * tt, o[2] + d[2] * tt, [0, 1, 0]);
        return { t: tt, n, ground: true };
      }
      if (t >= maxT) break;
    }
    return null;
  }

  // ---------------------------------------------------------------- what the ground is (colour, moisture, cover): one function for the chunk meshes and the soil window
  // coarse slope from the real elevation data alone (no fine detail), 1 = flat: the same number everywhere the ground is classified, so a chunk and the soil patch agree
  slopeNy(x, z) {
    const d = 17, a = this.elev(x - d, z), b = this.elev(x + d, z), c = this.elev(x, z - d), e = this.elev(x, z + d), gx = (b - a) / (2 * d), gz = (e - c) / (2 * d);
    return 1 / Math.sqrt(1 + gx * gx + gz * gz);
  }
  // aridity of the region at a local point (cached per chunk / window)
  baseClimate(x, z) { const g = this.localToGeo(x, z); return { a0: this.reg.base(g[0], g[1]), lat: g[0] }; }
  // out: [r, g, b, moisture, cover, hard]. e: real elevation (m).
  groundAt(x, z, e, ny, cl, out) {
    const gx = this.gx0 + x / this.sx, gy = this.gy0 + z / this.sz;
    this.reg.at(cl.a0, cl.lat, e, ny, gx, gy, out);
    const sw = this.stampW(x, z);
    if (sw > 0) {   // on a hand-built platform the ground is the old proving-ground lawn
      out[0] += (0.12 - out[0]) * sw; out[1] += (0.22 - out[1]) * sw; out[2] += (0.07 - out[2]) * sw; out[3] += (0.3 - out[3]) * sw; out[4] += (0.25 - out[4]) * sw; out[5] *= 1 - sw;
    }
    if (this.carveColor) { const k = this.carveColor(x, z); if (k > 0) { out[0] += (0.33 - out[0]) * k; out[1] += (0.27 - out[1]) * k; out[2] += (0.18 - out[2]) * k; out[4] = 0; out[3] = Math.max(out[3], 0.5 * k); } }
    return out;
  }

  // ---------------------------------------------------------------- chunk meshes
  _buildChunk(level, ci, cj) {
    const S = LEAF0 * 2 ** level, N = 32, st = S / N, X0 = ci * S, Z0 = cj * S, cx = X0 + S / 2, cz = Z0 + S / 2;
    const G = N + 3, H = new Float32Array(G * G);
    for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) H[j * G + i] = this.h(X0 + (i - 1) * st, Z0 + (j - 1) * st);
    const yb = H[(N / 2 + 1) * G + N / 2 + 1];
    const cl = this.baseClimate(cx, cz), gc = this._gc, soft = yb + this.E0 < 1300;
    const V = (N + 1) * (N + 1), SK = 4 * (N + 1), nv = V + SK;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = new Uint32Array((N * N * 2 + 4 * N * 2) * 3);
    const skirt = Math.max(1.5, st * 0.9 + (level > 1 ? S * 0.01 : 0));
    let o = 0;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++, o++) {
      const g = (j + 1) * G + (i + 1), y = H[g], vx = X0 + i * st, vz = Z0 + j * st;
      const nx = H[g - 1] - H[g + 1], nz = H[g - G] - H[g + G], ny = 2 * st, l = Math.hypot(nx, ny, nz);
      pos[o * 3] = i * st - S / 2; pos[o * 3 + 1] = y - yb; pos[o * 3 + 2] = j * st - S / 2;
      nrm[o * 3] = nx / l; nrm[o * 3 + 1] = ny / l; nrm[o * 3 + 2] = nz / l;
      this.groundAt(vx, vz, y + this.E0, this.slopeNy(vx, vz), cl, gc);
      col[o * 3] = gc[0]; col[o * 3 + 1] = gc[1]; col[o * 3 + 2] = gc[2];
      uv[o * 2] = gc[3]; uv[o * 2 + 1] = gc[4];
    }
    let k = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1; idx[k++] = a; idx[k++] = c; idx[k++] = d; idx[k++] = a; idx[k++] = d; idx[k++] = b; }
    // skirts: the edge vertices copied and dropped, so a finer neighbour never leaves a crack
    const edges = [[0, 0, 1, 0], [0, N, 1, 0], [0, 0, 0, 1], [N, 0, 0, 1]];
    for (let e = 0; e < 4; e++) {
      const [sx, sz, dx, dz] = edges[e], base = o;
      for (let q = 0; q <= N; q++, o++) {
        const i = sx + dx * q, j = sz + dz * q, src = j * (N + 1) + i;
        pos[o * 3] = pos[src * 3]; pos[o * 3 + 1] = pos[src * 3 + 1] - skirt; pos[o * 3 + 2] = pos[src * 3 + 2];
        nrm[o * 3] = nrm[src * 3]; nrm[o * 3 + 1] = nrm[src * 3 + 1]; nrm[o * 3 + 2] = nrm[src * 3 + 2];
        col[o * 3] = col[src * 3]; col[o * 3 + 1] = col[src * 3 + 1]; col[o * 3 + 2] = col[src * 3 + 2];
        uv[o * 2] = uv[src * 2]; uv[o * 2 + 1] = uv[src * 2 + 1];
      }
      for (let q = 0; q < N; q++) {
        const i0 = sx + dx * q, j0 = sz + dz * q, i1 = i0 + dx, j1 = j0 + dz, a = j0 * (N + 1) + i0, b = j1 * (N + 1) + i1, a2 = base + q, b2 = base + q + 1;
        if (e === 0 || e === 3) { idx[k++] = a; idx[k++] = b; idx[k++] = a2; idx[k++] = b; idx[k++] = b2; idx[k++] = a2; }
        else { idx[k++] = a; idx[k++] = a2; idx[k++] = b; idx[k++] = b; idx[k++] = a2; idx[k++] = b2; }
      }
    }
    const mesh = this.r.createMesh({ pos, nrm, col, uv, idx }, { mat: this.mat, radius: S * 0.75 });
    const model = new Float32Array(16); model[0] = model[5] = model[10] = model[15] = 1; model[12] = cx; model[13] = yb; model[14] = cz;
    this.stats.built++;
    return { level, ci, cj, mesh, model, used: this.frameNo };
  }
  // the real data under a chunk has arrived (a chunk is never built from stand-in heights, so it never changes shape afterwards)
  _ready(level, ci, cj) {
    const S = LEAF0 * 2 ** level, p = this.toPix(ci * S + S / 2, cj * S + S / 2);
    return this.dem.readyAround(this.Z, p[0], p[1], S * 0.5 / this.s + 4);
  }
  _chunk(level, ci, cj, build) {
    const key = level + ':' + ci + ':' + cj; let c = this.chunks.get(key);
    if (!c && build && this._ready(level, ci, cj)) { c = this._buildChunk(level, ci, cj); this.chunks.set(key, c); }
    return c;
  }
  // ask for every height tile the terrain reach needs (and a margin beyond it, so tiles are in before the chunks need them)
  prefetch(x, z) {
    const p = this.toPix(x, z);
    return this.dem.loadAround(this.Z, p[0], p[1], (REACH + 1800) / this.s);
  }
  // choose the leaves round (cx, cz) and queue them for drawing. New chunks are built nearest first until `ms` milliseconds are used (at least one per call while any is missing;
  // `ms` large = build everything now: boot, teleport)
  update(cx, cz, ms = 4) {
    this.frameNo++;
    const moved = Math.hypot(cx - this.lastCam[0], cz - this.lastCam[1]);
    if (!this.dirty && moved < 20 && !this.pending) return;
    this.lastCam = [cx, cz]; this.dirty = false;
    const leaves = [], top = LEVELS - 1, TS0 = LEAF0 * 2 ** top;
    const rec = (l, i, j) => {
      const S = LEAF0 * 2 ** l, x0 = i * S, z0 = j * S, dx = Math.max(x0 - cx, 0, cx - (x0 + S)), dz = Math.max(z0 - cz, 0, cz - (z0 + S));
      const d = Math.hypot(dx, dz);
      if (d > REACH) return;
      if (l > 0 && d < S * 1.25) { for (let b = 0; b < 4; b++) rec(l - 1, i * 2 + (b & 1), j * 2 + (b >> 1)); }
      else leaves.push([l, i, j, d]);
    };
    for (let j = Math.floor((cz - REACH) / TS0); j <= Math.floor((cz + REACH) / TS0); j++) for (let i = Math.floor((cx - REACH) / TS0); i <= Math.floor((cx + REACH) / TS0); i++) rec(top, i, j);
    leaves.sort((a, b) => a[3] - b[3]);
    const t0 = performance.now(); let built = 0, missing = 0, nearMiss = 0; const out = [], seen = new Set();
    for (const [l, i, j, dd] of leaves) {
      let c = this._chunk(l, i, j, false);
      if (!c && (built === 0 || performance.now() - t0 < ms)) { const had = this.stats.built; c = this._chunk(l, i, j, true); if (this.stats.built > had) built++; }
      let drop = 0;
      if (!c) {   // not built yet: the nearest built ancestor stands in for it (sunk a little, so a finer neighbour that exists always shows over it)
        missing++; if (dd < 400) nearMiss++;
        for (let a = l + 1, ai = i >> 1, aj = j >> 1; a < LEVELS && !c; a++, ai >>= 1, aj >>= 1) { c = this._chunk(a, ai, aj, false); if (c) drop = 0.45 * (a - l); }
        if (!c) continue;
      }
      const key = c.level + ':' + c.ci + ':' + c.cj; if (seen.has(key)) continue; seen.add(key);
      c.used = this.frameNo; out.push(drop ? { c, drop } : c);
    }
    this.pending = missing > 0; this.nearReady = nearMiss === 0 && out.length > 0; this.visible = out; this.stats.leaves = out.length;
    if (this.frameNo % 60 === 0 || ms > 50) for (const [k, c] of this.chunks) if (c.used < this.frameNo - 240) { this.r.deleteMesh(c.mesh); this.chunks.delete(k); }
  }
  draw() {
    const m = this._dm || (this._dm = new Float32Array(16));
    for (const v of this.visible) {
      if (v.c) { m.set(v.c.model); m[13] -= v.drop; this.r.add(v.c.mesh, m, { cast: false }); }
      else this.r.add(v.mesh, v.model, { cast: false });
    }
  }
  // The world is re-centred: the new origin is the old point (sx, sz) (a multiple of the biggest chunk, 4096 m, so the chunk grid still lines up), heights are all moved by dyB (old E0 - new E0).
  // Big far chunks are kept (moved), so the horizon never blinks; the nearby ones are built again with the new frame's exact scale. dropRects: [x0, z0, x1, z1] in OLD coordinates whose chunks must go
  // (hand-built platforms appear / disappear there).
  rebase(frame, sx, sz, dyB, o = {}) {
    const keep = o.keepLevel === undefined ? 3 : o.keepLevel, rects = o.dropRects || [], old = this.chunks;
    this.chunks = new Map(); this.nearReady = false;
    for (const c of old.values()) {
      const S = LEAF0 * 2 ** c.level, x0 = c.ci * S, z0 = c.cj * S;
      let drop = c.level < keep || (sx % S) !== 0 || (sz % S) !== 0;
      if (!drop) for (const R of rects) if (x0 < R[2] && x0 + S > R[0] && z0 < R[3] && z0 + S > R[1]) { drop = true; break; }
      if (drop) { this.r.deleteMesh(c.mesh); continue; }
      c.ci -= sx / S; c.cj -= sz / S; c.model[12] -= sx; c.model[13] += dyB; c.model[14] -= sz;
      this.chunks.set(c.level + ':' + c.ci + ':' + c.cj, c);
    }
    this._applyFrame(frame);
    this.visible = []; this.lastCam = [1e12, 1e12]; this.dirty = true; this._ceil.clear();
  }
}
