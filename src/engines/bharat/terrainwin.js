// TERRAIN WINDOW: the real ground right round the camera, as two small textures the shaders read.
//   heights (R32F) and ground (RGBA8: sqrt colour, alpha = cover * 50 + moisture * 49), 256 x 256 cells of 0.5 m = a 128 m square, toroidal
//   (moving the window only recomputes the cells that scrolled in, nearest 16 x 16 blocks first, a fixed number of cells per frame).
//   The soil patch (tyre prints, pits) and the instanced grass sit on these heights, and the patch takes its colour from them, so the deformable lawn near the car
//   is the same ground as the big terrain chunks around it.
import { COVER } from './regions.js';

export const WN = 256, WC = 0.5, WSIZE = WN * WC, BS = 16;

export class TerrainWindow {
  constructor(gl) {
    this.gl = gl;
    this.H = new Float32Array(WN * WN); this.G = new Uint8Array(WN * WN * 4);
    this.th = gl.createTexture(); this.tg = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + 5); gl.bindTexture(gl.TEXTURE_2D, this.th);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, WN, WN, 0, gl.RED, gl.FLOAT, this.H);
    for (const [pn, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, pn, v);
    gl.activeTexture(gl.TEXTURE0 + 6); gl.bindTexture(gl.TEXTURE_2D, this.tg);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, WN, WN, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.G);
    for (const [pn, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, pn, v);
    gl.activeTexture(gl.TEXTURE0);
    this.ci = 1 << 30; this.cj = 1 << 30;   // origin cell of the window
    this.ox = 0; this.oz = 0; this.size = WSIZE; this.on = false;
    this.queue = []; this.queued = new Set(); this.dirty = false; this.cl = null; this.cx = 0; this.cz = 0;
    this.out = [0, 0, 0, 0, 0, 0]; this.stats = { cells: 0 };
  }
  // everything is stale (a new frame of reference, new stamps / river carve)
  reset() { this.ci = 1 << 30; this.cj = 1 << 30; this.queue.length = 0; this.queued.clear(); this.on = false; }
  // the world is re-centred by (sx, sz) (multiples of the 128 m window, so every cell keeps its slot) and all heights move by dyB: nothing is recomputed, the ground stays where it is
  rebase(sx, sz, dyB) {
    if (this.ci === 1 << 30) return;
    const di = sx / WC, dj = sz / WC;
    this.ci -= di; this.cj -= dj; this.ox = this.ci * WC; this.oz = this.cj * WC; this.cx -= sx; this.cz -= sz;
    const H = this.H; for (let i = 0; i < H.length; i++) H[i] += dyB;
    const q = this.queue.slice(); this.queue.length = 0; this.queued.clear();
    for (let k = 0; k < q.length; k += 2) this._enqueue(q[k] - di, q[k + 1] - dj);
    this.dirty = true;
  }
  _enqueue(bi, bj) { const k = bi * 131072 + bj; if (!this.queued.has(k)) { this.queued.add(k); this.queue.push(bi, bj); } }
  // terrain: the Terrain; (x, z): camera. budget: cells to compute this call (the first call after a reset fills what is needed to start at once)
  update(T, x, z, budget = 1400) {
    if (!T.frame) return;
    const ci = Math.floor(x / WC) - WN / 2, cj = Math.floor(z / WC) - WN / 2;
    if (Math.abs(ci - this.ci) >= 16 || Math.abs(cj - this.cj) >= 16) {
      const first = this.ci === 1 << 30, oi = this.ci, oj = this.cj;
      this.ci = ci - (ci % BS + BS) % BS; this.cj = cj - (cj % BS + BS) % BS;   // blocks stay aligned to a 16-cell grid
      this.ox = this.ci * WC; this.oz = this.cj * WC;
      this.cl = T.baseClimate(this.ox + WSIZE / 2, this.oz + WSIZE / 2);
      this.queue.length = 0; this.queued.clear();
      for (let bj = 0; bj < WN / BS; bj++) for (let bi = 0; bi < WN / BS; bi++) {
        const gi = this.ci + bi * BS, gj = this.cj + bj * BS;
        if (!first && gi >= oi && gi < oi + WN && gj >= oj && gj < oj + WN) continue;     // this block was already in the old window
        this._enqueue(gi, gj);
      }
    }
    this.cx = x; this.cz = z;
    if (this.queue.length) {
      // nearest blocks first
      const q = this.queue, n = q.length / 2; const d = [];
      for (let k = 0; k < n; k++) d.push([Math.hypot((q[2 * k] + BS / 2) * WC - x, (q[2 * k + 1] + BS / 2) * WC - z), q[2 * k], q[2 * k + 1]]);
      d.sort((a, b) => a[0] - b[0]);
      let used = 0, k = 0;
      for (; k < d.length && (used < budget || !this.on && false); k++) { this._fill(T, d[k][1], d[k][2]); used += BS * BS; this.queued.delete(d[k][1] * 131072 + d[k][2]); }
      this.queue.length = 0; for (let m = k; m < d.length; m++) this.queue.push(d[m][1], d[m][2]);
      this.dirty = true;
    }
    if (this.dirty) this._upload();
    // switched on once the blocks round the camera exist (the far blocks may still be on their way)
    if (!this.on && this.ci !== 1 << 30) { let near = true; for (let k = 0; k < this.queue.length; k += 2) if (Math.hypot((this.queue[k] + BS / 2) * WC - x, (this.queue[k + 1] + BS / 2) * WC - z) < 40) { near = false; break; } this.on = near; }
  }
  // all remaining blocks now (boot, teleport)
  finish(T) { if (!T.frame) return; this.update(T, this.cx, this.cz, 1e9); }
  _fill(T, gi, gj) {
    const H = this.H, G = this.G, out = this.out, cl = this.cl, E0 = T.E0;
    // a one-cell margin is not needed: ground classification uses the coarse slope from the elevation data, not the cell neighbours
    for (let j = 0; j < BS; j++) for (let i = 0; i < BS; i++) {
      const ci = gi + i, cj = gj + j, x = (ci + 0.5) * WC, z = (cj + 0.5) * WC;
      const y = T.h(x, z), wi = ((ci % WN) + WN) % WN, wj = ((cj % WN) + WN) % WN, o = wj * WN + wi;
      H[o] = y;
      T.groundAt(x, z, y + E0, T.slopeNy(x, z), cl, out);
      const code = out[5] > 0.5 ? (out[0] > 0.5 ? 255 : 254) : Math.round(out[4] / 0.25) * 50 + Math.min(49, Math.round(out[3] * 49));   // 254 = bare rock / scree, 255 = snow and ice (hard ground)
      G[o * 4] = Math.round(Math.sqrt(Math.min(1, out[0])) * 255); G[o * 4 + 1] = Math.round(Math.sqrt(Math.min(1, out[1])) * 255); G[o * 4 + 2] = Math.round(Math.sqrt(Math.min(1, out[2])) * 255); G[o * 4 + 3] = code;
    }
    this.stats.cells += BS * BS;
  }
  _upload() {
    const gl = this.gl; this.dirty = false;
    gl.activeTexture(gl.TEXTURE0 + 5); gl.bindTexture(gl.TEXTURE_2D, this.th);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WN, WN, gl.RED, gl.FLOAT, this.H);
    gl.activeTexture(gl.TEXTURE0 + 6); gl.bindTexture(gl.TEXTURE_2D, this.tg);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, WN, WN, gl.RGBA, gl.UNSIGNED_BYTE, this.G);
    gl.activeTexture(gl.TEXTURE0);
  }
  // cover / moisture / height at a point straight from the window (CPU side: the soil classifier and the physics use it)
  at(x, z, out) {
    const ci = Math.floor(x / WC), cj = Math.floor(z / WC), wi = ((ci % WN) + WN) % WN, wj = ((cj % WN) + WN) % WN, o = wj * WN + wi;
    if (ci < this.ci || ci >= this.ci + WN || cj < this.cj || cj >= this.cj + WN) return false;
    const code = this.G[o * 4 + 3], k = Math.floor(code / 50);
    if (code >= 254) { out.cover = -1; out.moist = 0.4; out.hard = code === 255 ? 2 : 1; return true; }
    out.hard = 0; out.cover = k * 0.25; out.moist = (code - k * 50) / 49; return true;
  }
}
export { COVER };
