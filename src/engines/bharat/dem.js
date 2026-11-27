// DEM: the real height of the ground, from Terrarium elevation tiles (zoom 12: about 30 m per pixel at the equator, 27 m at Muzaffarpur's latitude).
//   A tile is a 256 x 256 PNG whose red / green / blue channels encode metres above sea level: (R * 256 + G + B / 256) - 32768.
//   Tiles are fetched at run time (the game never ships them), decoded once into Float32 arrays, kept in a small LRU, and re-tried with a back-off when the network fails.
//   bicubic(z, gx, gy) is the sampler everything else uses: gx, gy are global pixel coordinates (tile x * 256 + pixel). It returns NaN where a tile has not arrived.
//   Besides heights each tile keeps `rel`: the relief (max - min over 3 x 3 pixels, metres), which tells the terrain how rough the real ground is, so fine detail is only added where it fits.
export const TS = 256;
const TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

export class Dem {
  constructor(opts = {}) {
    this.zoom = opts.zoom || 12;
    this.url = opts.url || TILE_URL;
    this.tiles = new Map();
    this.maxTiles = opts.maxTiles || 120;
    this.maxActive = opts.maxActive || 6;
    this.stamp = 0; this.active = 0; this.queue = []; this.onChange = null; this._last = null;
    this.stats = { loaded: 0, failed: 0, requested: 0 };
    this.canvas = null; this.ctx = null;
  }
  _k(z, x, y) { return (z * 8192 + x) * 8192 + y; }   // numeric key (no string made per lookup: the sampler is called tens of thousands of times a frame)
  get(z, x, y) { return this.tiles.get(this._k(z, x, y)); }
  // ask for a tile (once); returns its record. state: 0 loading / queued, 1 ready, 2 failed (re-tried later)
  load(z, x, y) {
    const n = 2 ** z;
    if (y < 0 || y >= n) return null;
    x = ((x % n) + n) % n;
    const k = this._k(z, x, y); let t = this.tiles.get(k);
    if (!t) {
      t = { z, x, y, state: 0, h: null, rel: null, used: this.stamp, tries: 0, retryAt: 0 };
      this.tiles.set(k, t); this.queue.push(t); this.stats.requested++;
    } else {
      t.used = this.stamp;
      if (t.state === 2 && performance.now() >= t.retryAt) { t.state = 0; this.queue.push(t); }
    }
    return t;
  }
  // every tile that overlaps the pixel square (gx +- r, gy +- r): ask for it; returns how many are not ready yet
  loadAround(z, gx, gy, r) {
    let missing = 0;
    const i0 = Math.floor((gx - r) / TS), i1 = Math.floor((gx + r) / TS), j0 = Math.floor((gy - r) / TS), j1 = Math.floor((gy + r) / TS);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const t = this.load(z, i, j); if (t && t.state !== 1) missing++; }
    return missing;
  }
  readyAround(z, gx, gy, r) {
    const i0 = Math.floor((gx - r) / TS), i1 = Math.floor((gx + r) / TS), j0 = Math.floor((gy - r) / TS), j1 = Math.floor((gy + r) / TS), n = 2 ** z;
    for (let j = j0; j <= j1; j++) {
      if (j < 0 || j >= n) continue;
      for (let i = i0; i <= i1; i++) { const t = this.tiles.get(this._k(z, ((i % n) + n) % n, j)); if (!t || t.state !== 1) return false; if (t) t.used = this.stamp; }
    }
    return true;
  }
  // ask for the tiles round a lat / lon (radius in metres)
  prefetchGeo(lat, lon, radiusM) {
    const z = this.zoom, p = tilePix(lat, lon, z), r = radiusM / (40075016.686 * Math.cos(lat * Math.PI / 180) / (TS * 2 ** z));
    return this.loadAround(z, p[0], p[1], r);
  }
  // real elevation (m above sea level) at a lat / lon, NaN while the tile is not here
  elevGeo(lat, lon) {
    const p = tilePix(lat, lon, this.zoom);
    return this.bicubic(this.zoom, p[0], p[1]);
  }
  // one pump per frame: start queued tile loads (nearest first would need a position; the queue is first come first served), drop old tiles
  tick() {
    this.stamp++;
    while (this.active < this.maxActive && this.queue.length) {
      const t = this.queue.shift();
      if (t.state !== 0 || t.loading) continue;
      this._fetch(t);
    }
    if (this.tiles.size > this.maxTiles) {
      const a = [...this.tiles.values()].filter((t) => t.state !== 0).sort((p, q) => p.used - q.used);
      for (let i = 0; i < a.length && this.tiles.size > this.maxTiles; i++) if (a[i].used < this.stamp - 2) this.tiles.delete(this._k(a[i].z, a[i].x, a[i].y));
      this._last = null;
    }
  }
  _fetch(t) {
    t.loading = true; this.active++;
    const done = (ok) => {
      t.loading = false; this.active--;
      if (ok) { t.state = 1; this.stats.loaded++; this._last = null; if (this.onChange) this.onChange(t); }
      else { t.state = 2; t.tries++; t.retryAt = performance.now() + Math.min(60000, 1500 * 2 ** Math.min(t.tries, 5)); this.stats.failed++; }
    };
    fetch(this.url(t.z, t.x, t.y), { mode: 'cors', cache: 'force-cache' })
      .then((r) => { if (!r.ok) throw new Error('http ' + r.status); return r.blob(); })
      .then((b) => (typeof createImageBitmap === 'function' ? createImageBitmap(b) : imgFromBlob(b)))
      .then((img) => { this._decode(t, img); done(true); })
      .catch(() => done(false));
  }
  _decode(t, img) {
    if (!this.canvas) { this.canvas = document.createElement('canvas'); this.canvas.width = this.canvas.height = TS; this.ctx = this.canvas.getContext('2d', { willReadFrequently: true }); }
    this.ctx.clearRect(0, 0, TS, TS); this.ctx.drawImage(img, 0, 0, TS, TS);
    if (img.close) img.close();
    const d = this.ctx.getImageData(0, 0, TS, TS).data, h = new Float32Array(TS * TS), rel = new Uint8Array(TS * TS);
    for (let i = 0, o = 0; i < h.length; i++, o += 4) h[i] = d[o] * 256 + d[o + 1] + d[o + 2] / 256 - 32768;
    for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
      let mn = 1e9, mx = -1e9;
      for (let dj = -1; dj <= 1; dj++) { const jj = j + dj < 0 ? 0 : j + dj > TS - 1 ? TS - 1 : j + dj; for (let di = -1; di <= 1; di++) { const ii = i + di < 0 ? 0 : i + di > TS - 1 ? TS - 1 : i + di, v = h[jj * TS + ii]; if (v < mn) mn = v; if (v > mx) mx = v; } }
      const r = mx - mn; rel[j * TS + i] = r > 255 ? 255 : r;
    }
    t.h = h; t.rel = rel;
  }
  // a tile from outside (tests, offline data): `h` is a Float32Array(TS * TS) of metres
  put(z, x, y, h) {
    const k = this._k(z, x, y); let t = this.tiles.get(k);
    if (!t) { t = { z, x, y, state: 0, h: null, rel: null, used: this.stamp, tries: 0, retryAt: 0 }; this.tiles.set(k, t); }
    const rel = new Uint8Array(TS * TS);
    for (let j = 0; j < TS; j++) for (let i = 0; i < TS; i++) {
      let mn = 1e9, mx = -1e9;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const jj = Math.min(TS - 1, Math.max(0, j + dj)), ii = Math.min(TS - 1, Math.max(0, i + di)), v = h[jj * TS + ii]; if (v < mn) mn = v; if (v > mx) mx = v; }
      rel[j * TS + i] = Math.min(255, mx - mn);
    }
    t.h = h; t.rel = rel; t.state = 1; this._last = null; if (this.onChange) this.onChange(t);
  }
  _t(z, tx, ty) {
    const L = this._last;
    if (L && L.z === z && L.x === tx && L.y === ty && L.state === 1) return L;
    const t = this.tiles.get((z * 8192 + tx) * 8192 + ty);
    if (t && t.state === 1) { this._last = t; return t; }
    return null;
  }
  px(z, i, j) {
    const t = this._t(z, i >> 8, j >> 8);
    return t ? t.h[(j & 255) * TS + (i & 255)] : NaN;
  }
  rel(z, i, j) {
    const t = this._t(z, i >> 8, j >> 8);
    return t ? t.rel[(j & 255) * TS + (i & 255)] : 0;
  }
  // bicubic (Catmull-Rom) height at global pixel coordinates; pixel centres are at +0.5
  bicubic(z, gx, gy) {
    const x = gx - 0.5, y = gy - 0.5, i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
    const u2 = u * u, u3 = u2 * u, v2 = v * v, v3 = v2 * v;
    const wu0 = 0.5 * (-u3 + 2 * u2 - u), wu1 = 0.5 * (3 * u3 - 5 * u2 + 2), wu2 = 0.5 * (-3 * u3 + 4 * u2 + u), wu3 = 0.5 * (u3 - u2);
    const wv0 = 0.5 * (-v3 + 2 * v2 - v), wv1 = 0.5 * (3 * v3 - 5 * v2 + 2), wv2 = 0.5 * (-3 * v3 + 4 * v2 + v), wv3 = 0.5 * (v3 - v2);
    let s = 0;
    // all 16 taps inside one tile (nearly always): straight array reads
    if (((i - 1) >> 8) === ((i + 2) >> 8) && ((j - 1) >> 8) === ((j + 2) >> 8)) {
      const t = this._t(z, i >> 8, j >> 8);
      if (!t) return NaN;
      const h = t.h, i0 = (i - 1) & 255, j0 = (j - 1) & 255;
      for (let dj = 0; dj < 4; dj++) {
        const wv = dj === 0 ? wv0 : dj === 1 ? wv1 : dj === 2 ? wv2 : wv3, o = (j0 + dj) * TS + i0;
        s += wv * (wu0 * h[o] + wu1 * h[o + 1] + wu2 * h[o + 2] + wu3 * h[o + 3]);
      }
      return s;
    }
    for (let dj = -1; dj <= 2; dj++) {
      const wv = dj === -1 ? wv0 : dj === 0 ? wv1 : dj === 1 ? wv2 : wv3;
      for (let di = -1; di <= 2; di++) {
        const p = this.px(z, i + di, j + dj);
        if (p !== p) return NaN;
        s += wv * (di === -1 ? wu0 : di === 0 ? wu1 : di === 1 ? wu2 : wu3) * p;
      }
    }
    return s;
  }
}
function tilePix(lat, lon, z) {
  const n = 2 ** z, s = Math.sin(Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI / 180);
  return [(lon + 180) / 360 * n * TS, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n * TS];
}
function imgFromBlob(b) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = URL.createObjectURL(b); });
}
