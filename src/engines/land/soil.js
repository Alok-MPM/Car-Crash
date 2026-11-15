// SOIL FIELD: the ground you can actually dig.
//  The soft ground (lawn, meadow, field, bare soil: anything that is not road, paver, floor or water) carries a deformable layer stored in a sparse grid of 0.125 m cells:
//    R = how deep it has been dug (0..0.6 m)       G = how much of the grass has been torn off (0..1)
//    B = tyre compaction (pressed grass / soil)     A = loose spoil heaped above the original surface (0..0.2 m)
//  - ONE 1024 x 1024 RGBA8 texture covers a 128 m window round the camera (toroidal: moving the window only rewrites the strips that scrolled in). The ground shader reads it
//    for colour (grass -> topsoil -> subsoil -> parent material by depth), normals (slope of the heights) and cavity shading. Only the blocks that changed are uploaded.
//  - The same numbers answer the physics: heightAt() moves the suspension ray, so a wheel that digs a pit really sinks in it and has to climb out.
//  - Blocks that scroll out of the window are kept (only if they were modified) in a Map, so a pit is still there when you come back. Untouched blocks are generated on the fly:
//    deterministic bare root zones round the trees, nothing else - an untouched world costs no memory.
//  - The soft lawn is drawn by a TERRAIN PATCH: a 36 m grid (0.25 m quads) that follows the camera and is displaced in the vertex shader by the same texture, so a pit is real geometry
//    (rim, walls, depth, silhouette). A second 'meta' texture (255 = deformable lawn) is rasterised lazily per block from the city plan; the flat ground sheets underneath discard themselves
//    wherever the patch draws, and the instanced grass (drawn after the patch) is rooted in it.
//  Method after MudRunner / Spintires (sparse blocks + a deformation texture the GPU samples, wheel footprints stamped as simple primitives, soft near, simple far).
import { clamp } from '../../core/math.js';

export const CELL = 0.125, BLK = 32, NB = 32, N = BLK * NB, WIN = N * CELL, BM = BLK * CELL;
const PHALF = 18, PQ = 0.25, PY = 0.0045;   // terrain patch: half size, quad size, rest height (the lawn slabs sit here)
const DIG = 0.6 / 255, MND = 0.2 / 255;
const mod = (a, n) => ((a % n) + n) % n;
const hash = (i, j, s) => { let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const vnoise = (x, z, s) => { const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz); const a = hash(i, j, s), b = hash(i + 1, j, s), c = hash(i, j + 1, s), d = hash(i + 1, j + 1, s); return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
const stoch = (x) => (x + Math.random()) | 0;
// colours of the soil profile (linear), the same as the ground shader: crust, moist topsoil, clay subsoil, parent material
const SOIL = [[0.182, 0.097, 0.045], [0.087, 0.038, 0.018], [0.267, 0.121, 0.045], [0.389, 0.241, 0.121]];
const GRASS = [0.1, 0.22, 0.05];
const soilCol = (dep, k) => { const a = dep < 0.05 ? 0 : dep < 0.16 ? 1 : dep < 0.36 ? 2 : 3, c = SOIL[a], e = 0.78 + k * 0.4; return [c[0] * e, c[1] * e, c[2] * e]; };

export class SoilField {
  // trees: [{ x, z, r0 }] bare root zones; isHard(x, z): true on road, paver, floor or water (no deformation there)
  constructor({ r, trees, isHard }) {
    this.r = r; this.gl = r.gl; this.isHard = isHard; this.world = null; this.fx = null;
    this.data = new Uint8Array(N * N * 4);
    const NS = NB * NB;
    this.sbx = new Int32Array(NS).fill(1 << 30); this.sbz = new Int32Array(NS).fill(1 << 30);
    this.dirty = new Uint8Array(NS); this.gpu = new Uint8Array(NS); this.gpuList = [];
    this.store = new Map(); this.grassK = 1;   // grass density 0..1 (the frame-rate governor in main.js lowers it when the device struggles)
    this.bx0 = 1 << 30; this.bz0 = 1 << 30;
    this.ext = 0.6;
    this.dug = 0;      // cells dug so far (debug)
    this.spots = new Map();
    for (const t of trees) { const k = Math.floor(t.x / BM) + ':' + Math.floor(t.z / BM); (this.spots.get(k) || this.spots.set(k, []).get(k)).push({ x: t.x, z: t.z, r0: t.r0, ph: hash(Math.round(t.x * 10), Math.round(t.z * 10), 3) * 6.283 }); }
    const gl = this.gl;
    this.meta = gl.createTexture(); this.metaData = new Uint8Array(N * N); this.mq = []; this._first = true;
    gl.activeTexture(gl.TEXTURE0 + 3); gl.bindTexture(gl.TEXTURE_2D, this.meta);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, N, N, 0, gl.RED, gl.UNSIGNED_BYTE, this.metaData);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    this.patch = { cx: 0, cz: 0, half: PHALF };
    this.patchMesh = this._makePatch();
    this.patchModel = new Float32Array(16); this.patchModel[0] = this.patchModel[5] = this.patchModel[10] = this.patchModel[15] = 1;
    this.tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + 2); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.activeTexture(gl.TEXTURE0);
  }
  attach(world, fx) { this.world = world; this.fx = fx; world.soil = this; fx.soil = this; }

  // ---------------------------------------------------------------- window, blocks
  draw(cam) {
    const cbx = Math.floor(cam[0] / BM), cbz = Math.floor(cam[2] / BM);
    if (Math.abs(cbx - (this.bx0 + NB / 2)) > 3 || Math.abs(cbz - (this.bz0 + NB / 2)) > 3) this._recentre(cbx - NB / 2, cbz - NB / 2);
    this._classify(cam, this._first ? 140 : 2.5); this._first = false;
    this._sync();
    const r = this.r, c = r.cam || {}, e = r.eye;
    // the patch sits a few metres ahead of the camera (that is where the eye looks); its corners stay on the 0.25 m grid so nothing swims
    let fx = c.target ? c.target[0] - e[0] : 0, fz = c.target ? c.target[2] - e[2] : 0; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const pc = this.patch; pc.cx = Math.round((e[0] + fx * 6) / PQ) * PQ; pc.cz = Math.round((e[2] + fz * 6) / PQ) * PQ;
    this.patchModel[12] = pc.cx; this.patchModel[13] = PY; this.patchModel[14] = pc.cz;
    r.soil = { tex: this.tex, meta: this.meta, ox: this.bx0 * BM, oz: this.bz0 * BM, size: WIN, on: 1, patch: pc };
    r.add(this.patchMesh, this.patchModel, { cast: false });
    r.grassCfg = { density: this.grassK, near: 7, far: 5 };
  }
  _makePatch() {
    const n = Math.round(2 * PHALF / PQ), v = n + 1, pos = new Float32Array(v * v * 3), nrm = new Float32Array(v * v * 3), col = new Float32Array(v * v * 3).fill(1), uv = new Float32Array(v * v * 2), idx = new Uint32Array(n * n * 6);
    for (let j = 0; j < v; j++) for (let i = 0; i < v; i++) { const k = j * v + i; pos[k * 3] = -PHALF + i * PQ; pos[k * 3 + 2] = -PHALF + j * PQ; nrm[k * 3 + 1] = 1; uv[k * 2] = i * PQ; uv[k * 2 + 1] = j * PQ; }
    let o = 0;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const a = j * v + i, b = a + 1, c = a + v, d = c + 1; idx[o++] = a; idx[o++] = c; idx[o++] = d; idx[o++] = a; idx[o++] = d; idx[o++] = b; }
    const mat = { kind: 7, flake: 1, base: [0.11, 0.23, 0.065], texScale: 1, poly: 1, terr: true };
    return this.r.createMesh({ pos, nrm, col, uv, idx }, { groups: [{ start: 0, count: idx.length, mat }], radius: 30 });
  }
  _recentre(bx0, bz0) {
    this.bx0 = bx0; this.bz0 = bz0;
    for (let sz = 0; sz < NB; sz++) for (let sx = 0; sx < NB; sx++) {
      const bx = bx0 + mod(sx - bx0, NB), bz = bz0 + mod(sz - bz0, NB), si = sz * NB + sx;
      if (this.sbx[si] === bx && this.sbz[si] === bz) continue;
      if (this.dirty[si]) this.store.set(this.sbx[si] + ':' + this.sbz[si], this._copyOut(si));
      this.dirty[si] = 0; this.sbx[si] = bx; this.sbz[si] = bz;
      const st = this.store.get(bx + ':' + bz);
      if (st) this._copyIn(si, st); else this._gen(si, bx, bz);
      for (let r = 0; r < BLK; r++) this.metaData.fill(0, (sz * BLK + r) * N + sx * BLK, (sz * BLK + r) * N + sx * BLK + BLK);
      this.mq.push(si);
      this._gpu(si);
    }
  }
  _copyOut(si) {
    const sx = si % NB, sz = (si / NB) | 0, out = new Uint8Array(BLK * BLK * 4);
    for (let r = 0; r < BLK; r++) out.set(this.data.subarray(((sz * BLK + r) * N + sx * BLK) * 4, ((sz * BLK + r) * N + sx * BLK + BLK) * 4), r * BLK * 4);
    return out;
  }
  _copyIn(si, arr) {
    const sx = si % NB, sz = (si / NB) | 0;
    for (let r = 0; r < BLK; r++) this.data.set(arr.subarray(r * BLK * 4, (r + 1) * BLK * 4), ((sz * BLK + r) * N + sx * BLK) * 4);
  }
  _gpu(si) { if (!this.gpu[si]) { this.gpu[si] = 1; this.gpuList.push(si); } }
  // a block that has never been touched: empty ground plus the bare, ragged root zone round every garden tree
  _gen(si, bx, bz) {
    const sx = si % NB, sz = (si / NB) | 0, d = this.data;
    for (let r = 0; r < BLK; r++) d.fill(0, ((sz * BLK + r) * N + sx * BLK) * 4, ((sz * BLK + r) * N + sx * BLK + BLK) * 4);
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
      const l = this.spots.get((bx + ox) + ':' + (bz + oz)); if (!l) continue;
      for (const t of l) {
        const R = t.r0 * 1.35 + 0.5, i0 = Math.max(bx * BLK, Math.floor((t.x - R) / CELL)), i1 = Math.min(bx * BLK + BLK - 1, Math.floor((t.x + R) / CELL));
        const j0 = Math.max(bz * BLK, Math.floor((t.z - R) / CELL)), j1 = Math.min(bz * BLK + BLK - 1, Math.floor((t.z + R) / CELL));
        for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
          const px = (i + 0.5) * CELL - t.x, pz = (j + 0.5) * CELL - t.z, dd = Math.hypot(px, pz), a = Math.atan2(pz, px);
          const rr = t.r0 * (0.8 + 0.18 * Math.sin(a * 3 + t.ph) + 0.1 * Math.sin(a * 7 + t.ph * 2.3)) + (hash(i, j, 5) - 0.5) * 0.12;
          const g = clamp((rr - dd) / 0.5 + 0.2, 0, 1);
          if (g <= 0) continue;
          const o = (mod(j, N) * N + mod(i, N)) * 4;
          d[o + 1] = Math.max(d[o + 1], Math.round(g * 255));
        }
      }
    }
  }
  // deformable-lawn map of one block (meta). Coarse probes first: a block that is entirely lawn or entirely something else is filled at once, only blocks on an edge are done cell by cell
  _classify(cam, ms) {
    if (!this.mq.length) return;
    const t0 = performance.now(), cb = [Math.floor(cam[0] / BM), Math.floor(cam[2] / BM)];
    while (this.mq.length) {
      let bi = 0, bd = 1e9;
      for (let i = 0; i < this.mq.length; i++) { const si = this.mq[i], d = Math.hypot(this.sbx[si] - cb[0], this.sbz[si] - cb[1]); if (d < bd) { bd = d; bi = i; } }
      const si = this.mq[bi]; this.mq[bi] = this.mq[this.mq.length - 1]; this.mq.pop();
      this._metaBlock(si);
      if (bd > 8 && performance.now() - t0 > ms) break;                                    // blocks under the patch (within ~32 m) are never left waiting
    }
  }
  _metaBlock(si) {
    const sx = si % NB, sz = (si / NB) | 0, bx = this.sbx[si], bz = this.sbz[si], x0 = bx * BM, z0 = bz * BM, md = this.metaData, hard = this.isHard;
    let s0 = 0, s1 = 0;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) { if (hard(x0 + (i + 0.5) * 0.5, z0 + (j + 0.5) * 0.5)) s0 = 1; else s1 = 1; if (s0 && s1) break; }
    for (let r = 0; r < BLK; r++) {
      const o = (sz * BLK + r) * N + sx * BLK;
      if (!s0 || !s1) md.fill(s1 ? 255 : 0, o, o + BLK);
      else for (let i = 0; i < BLK; i++) md[o + i] = hard(x0 + (i + 0.5) * CELL, z0 + (r + 0.5) * CELL) ? 0 : 255;
    }
    this._gpu(si);
  }
  _sync() {
    if (!this.gpuList.length) return;
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.activeTexture(gl.TEXTURE0 + 2); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    const full = this.gpuList.length > 96;
    if (full) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
    else {
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, N);
      for (const si of this.gpuList) {
        const sx = (si % NB) * BLK, sz = ((si / NB) | 0) * BLK;
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, sx); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, sz);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, sx, sz, BLK, BLK, gl.RGBA, gl.UNSIGNED_BYTE, this.data);
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    }
    gl.activeTexture(gl.TEXTURE0 + 3); gl.bindTexture(gl.TEXTURE_2D, this.meta);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (full) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RED, gl.UNSIGNED_BYTE, this.metaData);
    else {
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, N);
      for (const si of this.gpuList) {
        const sx = (si % NB) * BLK, sz = ((si / NB) | 0) * BLK;
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, sx); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, sz);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, sx, sz, BLK, BLK, gl.RED, gl.UNSIGNED_BYTE, this.metaData);
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    for (const si of this.gpuList) this.gpu[si] = 0;
    this.gpuList.length = 0;
    gl.activeTexture(gl.TEXTURE0);
  }

  // ---------------------------------------------------------------- cell access
  _off(i, j) {   // byte offset of cell (i, j) or -1 when it is outside the window
    const bx = Math.floor(i / BLK), bz = Math.floor(j / BLK);
    if (bx < this.bx0 || bx >= this.bx0 + NB || bz < this.bz0 || bz >= this.bz0 + NB) return -1;
    return (mod(j, N) * N + mod(i, N)) * 4;
  }
  _mark(i, j) { const si = mod(Math.floor(j / BLK), NB) * NB + mod(Math.floor(i / BLK), NB); this.dirty[si] = 1; this._gpu(si); }
  soft(x, z) {   // deformable lawn here? (the same map the GPU draws the patch from)
    const o = this._off(Math.floor(x / CELL), Math.floor(z / CELL));
    return o >= 0 && this.metaData[o >> 2] > 127;
  }
  // height of the soil surface above (+) / below (-) the original ground, bilinear
  heightAt(x, z) {
    const fx = x / CELL - 0.5, fz = z / CELL - 0.5, i0 = Math.floor(fx), j0 = Math.floor(fz), tx = fx - i0, tz = fz - j0, d = this.data;
    let h = 0;
    for (let dj = 0; dj < 2; dj++) for (let di = 0; di < 2; di++) {
      const o = this._off(i0 + di, j0 + dj); if (o < 0) continue;
      h += (di ? tx : 1 - tx) * (dj ? tz : 1 - tz) * (d[o + 3] * MND - d[o] * DIG);
    }
    return h;
  }
  // [dug depth m, grass torn 0..1] at a point
  stateAt(x, z) {
    const o = this._off(Math.floor(x / CELL), Math.floor(z / CELL));
    return o < 0 ? [0, 0] : [this.data[o] * DIG, this.data[o + 1] / 255];
  }
  _heap(x, z, rad, vol) {   // loose soil: a volume (m3) spread over a small disc
    const i0 = Math.floor((x - rad) / CELL), i1 = Math.floor((x + rad) / CELL), j0 = Math.floor((z - rad) / CELL), j1 = Math.floor((z + rad) / CELL), d = this.data;
    let S = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const dd = Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z); if (dd < rad) S += 1 - dd / rad; }
    if (S <= 0) return;
    const h = vol / (S * CELL * CELL) / MND;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dd = Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z); if (dd >= rad) continue;
      const o = this._off(i, j); if (o < 0) continue;
      d[o + 3] = Math.min(255, d[o + 3] + stoch(h * (1 - dd / rad))); this._mark(i, j);
    }
  }

  // ---------------------------------------------------------------- a hard round object lands (a coconut): a small crater with a rim, grass torn at the middle
  dent(x, z, r, depth) {
    if (!this.soft(x, z)) return;
    const R = r * 1.6, i0 = Math.floor((x - R) / CELL), i1 = Math.floor((x + R) / CELL), j0 = Math.floor((z - R) / CELL), j1 = Math.floor((z + R) / CELL), d = this.data;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const o = this._off(i, j); if (o < 0) continue;
      const dd = Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - z) + (hash(i, j, 9) - 0.5) * 0.03;
      if (dd < r) {
        const w = 1 - dd / r, k = w * w * (3 - 2 * w);
        d[o] = Math.max(d[o], Math.round(depth * k / DIG)); d[o + 1] = Math.max(d[o + 1], Math.round(255 * Math.min(1, k * 1.6))); d[o + 2] = Math.max(d[o + 2], Math.round(200 * k));
      } else if (dd < R) { const k = 1 - (dd - r) / (R - r); d[o + 3] = Math.min(255, d[o + 3] + stoch(depth * 0.5 * k / MND * 0.5)); d[o + 2] = Math.max(d[o + 2], Math.round(90 * k)); }
      this._mark(i, j);
    }
  }

  // ---------------------------------------------------------------- tyres
  // Called once per frame for a wheel on soft ground. Rolling presses a print (compaction + a shallow rut). Wheel spin or sliding tears the grass off, then digs the soil
  // out layer by layer (slower the deeper it gets), heaps it behind the wheel and throws grass tufts and clods in the direction the rubber is pushing the ground.
  wheel(w, body, dt, player) {
    const cp = w.contact, Fn = w.Fn || 0;
    if (!cp || !w.grounded || !w.soft || Fn < 120) { w._sx = undefined; return; }
    const x = cp[0], z = cp[2], Rm = body.R, cs = Math.cos(w.steer || 0), sn = Math.sin(w.steer || 0);
    let fx = -Rm[6] * cs + Rm[0] * sn, fz = -Rm[8] * cs + Rm[2] * sn;
    const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const lx = -fz, lz = fx;
    const wr = (w.omega || 0) * w.R, vl = w.vlong || 0, vt = w.vlat || 0;
    let pxv = (vl - wr) * fx + vt * lx, pzv = (vl - wr) * fz + vt * lz;        // the way the rubber moves over the ground = the way it pushes the soil
    const vs = Math.hypot(pxv, pzv), spd = Math.hypot(vl, vt), lk = clamp(Fn / 3500, 0.25, 2);
    const hw = (w.tw || 0.22) * 0.5, d = this.data;
    if (w._sx === undefined || Math.hypot(x - w._sx, z - w._sz) > 3) { w._sx = x; w._sz = z; }
    const sx0 = w._sx, sz0 = w._sz, dx = x - sx0, dz = z - sz0, len = Math.hypot(dx, dz), steps = clamp(Math.ceil(len / 0.07), 1, 14);
    const firm = 0.65 + 0.8 * vnoise(x * 0.17, z * 0.17, 2);
    const d0 = (0.004 + 0.016 * lk) * firm * clamp(1.25 - spd / 30, 0.4, 1) / DIG;           // rolling rut, about 1 - 2 cm
    const c0 = Math.min(255, 130 + 90 * lk);
    const spin = vs > 1.2, tear = clamp((vs - 0.8) * 0.9, 0, 6) * dt / steps * 255, digRate = spin ? 0.0075 * Math.min(vs, 20) * lk * dt / steps / DIG : 0;
    let vol = 0;
    for (let s = 1; s <= steps; s++) {
      const cx = sx0 + dx * s / steps, cz = sz0 + dz * s / steps, rr = hw + 0.16;
      const i0 = Math.floor((cx - rr) / CELL), i1 = Math.floor((cx + rr) / CELL), j0 = Math.floor((cz - rr) / CELL), j1 = Math.floor((cz + rr) / CELL);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const o = this._off(i, j); if (o < 0) continue;
        const px = (i + 0.5) * CELL - cx, pz = (j + 0.5) * CELL - cz, q = Math.abs(px * lx + pz * lz), p = Math.abs(px * fx + pz * fz);
        if (q > hw + 0.05 || p > 0.09) continue;
        const wq = q < hw * 0.8 ? 1 : Math.max(0, 1 - (q - hw * 0.8) / (hw * 0.2 + 0.05));
        const dT = d0 * wq; if (d[o] < dT) d[o] = Math.round(dT);
        const cT = c0 * wq; if (d[o + 2] < cT) d[o + 2] = Math.round(cT);
        if (spin) {
          d[o + 1] = Math.min(255, d[o + 1] + stoch(tear * wq));
          const gk = d[o + 1] > 170 ? 1 : 0;                                          // the sod has to go first, then the soil comes out
          if (gk && d[o] < 255) { const inc = stoch(digRate * wq / (1 + d[o] * DIG / 0.3)); d[o] = Math.min(255, d[o] + inc); vol += inc * DIG * CELL * CELL; this.dug += inc; }
        }
        this._mark(i, j);
      }
    }
    w._sx = x; w._sz = z;
    if (!spin) return;
    // spoil heap behind the wheel, thrown clods and grass tufts
    const pn = vs || 1, ux = pxv / pn, uz = pzv / pn;
    if (vol > 0) this._heap(x + ux * (0.4 + 0.04 * Math.min(vs, 12)), z + uz * (0.4 + 0.04 * Math.min(vs, 12)), 0.3, vol * 1.3);
    const fxs = this.fx;
    if (!fxs || fxs.ps.length > 1900) return;
    let n = Math.min(5, vs * 0.1 * lk * dt * 60 * (player ? 1 : 0.5)); n = (n | 0) + (Math.random() < n % 1 ? 1 : 0);
    const st = this.stateAt(x, z), grassy = st[1] < 0.55, bv = body.v;
    for (let k = 0; k < n; k++) {
      const sp = 0.8 + Math.random() * 0.22 * vs, vy = 1.6 + Math.random() * Math.min(5.5, 0.2 * vs + 1);
      const v = [bv[0] * 0.6 + ux * sp + (Math.random() - 0.5) * 1.8 + lx * (Math.random() - 0.5), vy, bv[2] * 0.6 + uz * sp + (Math.random() - 0.5) * 1.8 + lz * (Math.random() - 0.5)];
      const p = [x + (Math.random() - 0.5) * hw * 1.6, 0.06, z + (Math.random() - 0.5) * 0.2];
      if (grassy && Math.random() < 0.6) fxs.tuft(p, v, GRASS);
      else fxs.clod(p, v, soilCol(st[0] + Math.random() * 0.03, Math.random()));
    }
    if (!grassy && vs > 4 && Math.random() < 0.07 * dt * 60) fxs.smoke([x, 0.1, z], [bv[0] * 0.3 + ux * 0.8, 0.5, bv[2] * 0.3 + uz * 0.8], 0.35 + 0.05 * Math.min(vs, 10), 1.4, [0.5, 0.4, 0.3], 0.07);   // only a thin brown dust from dry bare soil, never tyre smoke
  }
}
