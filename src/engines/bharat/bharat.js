// BHARAT: the real ground of the sub-continent, 1 : 1, built round the player (about 6 km in every direction) from real elevation tiles.
//   One local frame (x east, z south, y up, true metres) is centred on the player; every ~8 km of driving it is re-centred by a multiple of 4096 m: all movable bodies, particles and the
//   terrain / soil / ground-window caches move together, the big far chunks stay, so nothing blinks and numbers never grow past ~13 km (float32 stays millimetre exact in the renderer).
//   The hand-built proving ground + city of Muzaffarpur (the old test world) is 'legacy': it lives in the HOME frame on a flat platform, is parked (out of physics and out of sight) when the
//   frame is not its own, and comes back when the player returns. There is no teleport for the player: the player drives, or later rides. Teleport exists only as a developer's inspection tool.
//   Water is not in here (separate engine, later): rivers are dry channels, the regional moisture is a static value, Regions.setSeason() is the hook for the water engine.
import { Dem } from './dem.js';
import { Terrain } from './terrain.js';
import { TerrainWindow } from './terrainwin.js';
import { Frame, toTile, geoDist } from './geo.js';

export const HOME = { lat: 26.1209, lon: 85.3647, name: 'Muzaffarpur', E0: 54 };
export const PLATEAU = [-700, -6300, 4100, 500];     // x0, z0, x1, z1 of the flat platform under the legacy world (home frame)
const STAMP = { x0: PLATEAU[0], z0: PLATEAU[1], x1: PLATEAU[2], z1: PLATEAU[3], y: 0, blend: 300 };
const REB = 7000, SNAP = 4096;                         // re-centre when the player is 7 km from the origin; shift by a multiple of the biggest chunk
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Bharat {
  // api (provided by the game): keepBodies() -> Set of bodies that travel with the player, setLegacy(on), shift(sx, dy, sz), clearTransients(), place(x, y, z, yaw), busy(text|null), toast(a, b), pos() -> [x, y, z]
  constructor({ r, world, fx, soil, api }) {
    this.r = r; this.world = world; this.fx = fx; this.soil = soil; this.api = api;
    this.dem = new Dem({ zoom: 12 });
    this.T = new Terrain(this.dem, r);
    this.tw = new TerrainWindow(r.gl);
    this.on = false; this.atHome = true; this.off = [0, 0]; this.parked = [];
    this.homeFrame = null; this.status = 'starting';
    this.odo = 0; this._last = null; this.region = [1, 1, 0, 1]; this.surface = ''; this._surfT = 0; this.rebases = 0;
    this.moist = 0.3; this.cover = 0.25; this._pb = { moist: 0.3, cover: 0.25 };
  }
  get Z() { return this.dem.zoom; }
  _pix(lat, lon) { const t = toTile(lat, lon, this.Z); return [t[0] * 256, t[1] * 256]; }
  _mpp(lat) { return 156543.034 * Math.cos(lat * Math.PI / 180) / 2 ** this.Z; }
  // wait (pumping the loader) until the tiles within `radiusM` of a lat / lon are here
  async _tiles(lat, lon, radiusM, ms) {
    const p = this._pix(lat, lon), rp = radiusM / this._mpp(lat), t0 = performance.now();
    while (performance.now() - t0 < ms) {
      this.dem.loadAround(this.Z, p[0], p[1], rp); this.dem.tick();
      if (this.dem.readyAround(this.Z, p[0], p[1], rp)) return true;
      await sleep(50);
    }
    return false;
  }
  // boot: fetch the heights round home; with them the real terrain is on, without them (offline) the game runs on its flat legacy ground and keeps trying
  async init(ms = 9000) {
    const ok = await this._tiles(HOME.lat, HOME.lon, 3200, ms);
    if (ok) { this.enable(); return true; }
    this.status = 'offline';
    return false;
  }
  enable() {
    const e = this.dem.elevGeo(HOME.lat, HOME.lon);
    this.homeFrame = new Frame(HOME.lat, HOME.lon, e === e ? Math.round(e * 100) / 100 : HOME.E0);
    this.T.stamps = [STAMP];
    this.T.setFrame(this.homeFrame);
    this.world.terrain = this.T; this.r.terrWin = this.tw;
    const s = this.soil; s.T = this.T; s.win = this.tw; s.legacy = { on: true, plateau: PLATEAU };
    this.tw.reset(); const p = this.api.pos(); this.tw.update(this.T, p[0], p[2], 1e9);
    s.setLegacy(true);
    this.on = true; this.atHome = true; this.off = [0, 0]; this.status = 'on';
    this.T.update(p[0], p[2], 800);
  }
  // each frame, before physics: re-centre the world when the player has driven 7 km from the origin
  preFrame(pl) {
    this.dem.tick();
    if (!this.on) { if (this.status === 'offline' && this._tick(2) && this.dem.readyAround(this.Z, ...this._pix(HOME.lat, HOME.lon), 3200 / this._mpp(HOME.lat))) { const p = this.api.pos(); if (Math.hypot(p[0], p[2]) < 4000) this.enable(); } return false; }
    const ax = Math.abs(pl[0]), az = Math.abs(pl[2]);
    if (ax < REB && az < REB) return false;
    this._rebase(ax >= REB ? Math.round(pl[0] / SNAP) * SNAP : 0, az >= REB ? Math.round(pl[2] / SNAP) * SNAP : 0);
    return true;
  }
  _tick(n) { this._c = ((this._c || 0) + 1) % n; return this._c === 0; }
  _park() {
    const keep = this.api.keepBodies(), list = this.world.bodies.filter((b) => !keep.has(b));
    this.parked = list; this.world.removeMany(list);
    this.api.setLegacy(false); this.soil.setLegacy(false);
    this.atHome = false;
  }
  _unpark() {
    this.world.addMany(this.parked); this.parked = [];
    this.api.setLegacy(true); this.soil.setLegacy(true);
    this.atHome = true;
  }
  _rebase(sx, sz) {
    const T = this.T, w = this.world, was = this.atHome;
    const newOff = this.off ? [this.off[0] + sx, this.off[1] + sz] : null;
    const toHome = !!newOff && newOff[0] === 0 && newOff[1] === 0;
    let frame;
    if (toHome) frame = this.homeFrame;
    else { const g = T.localToGeo(sx, sz), e = T.elev(sx, sz); frame = new Frame(g[0], g[1], Math.round(e)); }
    const dyB = T.E0 - frame.E0;
    const hint = this.api.pos();
    if (was && !toHome) this._park();
    w.shiftDyn(-sx, dyB, -sz);
    // the platform under the legacy world appears / disappears: chunks and window cells that touch it are rebuilt
    const rects = [], toggled = was !== toHome;
    if (toggled) { const o = this.off || [0, 0], m = STAMP.blend + 200; rects.push([PLATEAU[0] - o[0] - m, PLATEAU[1] - o[1] - m, PLATEAU[2] - o[0] + m, PLATEAU[3] - o[1] + m]); }
    T.stamps = toHome ? [STAMP] : [];
    T.rebase(frame, sx, sz, dyB, { dropRects: rects });
    this.tw.rebase(sx, sz, dyB);
    this.soil.rebase(sx, sz);
    if (toggled) { this.tw.reset(); this.tw.update(T, hint[0] - sx, hint[2] - sz, 1e9); }
    if (!was && toHome) this._unpark();
    this.api.shift(sx, dyB, sz);
    this.off = newOff; this.atHome = toHome; this.rebases++;
    if (this._last) { this._last[0] -= sx; this._last[2] -= sz; }
    this.T.update(hint[0] - sx, hint[2] - sz, 120);
  }
  // each frame, after the camera is known: load / build / scroll the ground round it
  update(dt, cam, pl) {
    if (!this.on) return;
    const T = this.T;
    T.prefetch(cam[0], cam[2]);
    T.update(cam[0], cam[2], 4);
    this.tw.update(T, cam[0], cam[2], 900);
    // odometer (true metres driven, whatever the re-centring did)
    if (this._last) { const d = Math.hypot(pl[0] - this._last[0], pl[2] - this._last[2]); if (d < 60) this.odo += d; }
    this._last = [pl[0], pl[1], pl[2]];
    // what the player is standing on: moisture / cover -> the grass look of the region and the name of the ground
    this._surfT -= dt;
    if (this._surfT <= 0) {
      this._surfT = 0.25;
      if (this.tw.on && this.tw.at(pl[0], pl[2], this._pb)) {
        const m = this._pb.moist, k = 0.25, R = this.region;
        const dens = clamp(0.3 + 1.6 * m, 0.25, 1.3), hgt = clamp(0.6 + 1.0 * m, 0.6, 1.3), dry = clamp((0.38 - m) * 3.5, 0, 1);
        R[0] += (dens - R[0]) * k; R[1] += (hgt - R[1]) * k; R[2] += (dry - R[2]) * k; R[3] = 1;
        this.moist = m; this.cover = this._pb.cover;
      }
      const sf = this.soil.surfaceAt(pl[0], pl[2], 3500, 0, 0, this.soil._sf); this.surface = sf.name;
    }
    this.soil.region = this.region;
  }
  draw() { if (this.on) this.T.draw(); }
  // geographic facts about a point of the frame (HUD)
  geo(x, y, z) {
    const g = this.on ? this.T.localToGeo(x, z) : [HOME.lat - z / 110789, HOME.lon + x / 100015];
    return { lat: g[0], lon: g[1], alt: (this.on ? this.T.E0 : HOME.E0) + y };
  }
  // ---------------------------------------------------------------- developer tools
  // the real height at a lat / lon (loads the tiles first); NaN when they cannot be fetched
  async heightAt(lat, lon, ms = 12000) {
    if (!(await this._tiles(lat, lon, 400, ms))) return NaN;
    return this.dem.elevGeo(lat, lon);
  }
  // known heights: does the data we fetch agree with the real world?
  async selfCheck(list, onRow) {
    const out = [];
    for (const [name, lat, lon, want, tol] of list) {
      const e = await this.heightAt(lat, lon, 15000), ok = e === e && Math.abs(e - want) <= tol;
      const row = { name, lat, lon, want, tol, got: e, ok }; out.push(row); if (onRow) onRow(row);
    }
    return out;
  }
  // the developer's inspection tool: stand at a lat / lon (there is no teleport in the game itself)
  async teleport(lat, lon, yaw = 0) {
    if (!this.on && !this.homeFrame) { this.api.toast('Height data is not available (offline)', 'Terrain'); return false; }
    this.api.busy('Loading the ground at ' + lat.toFixed(4) + ', ' + lon.toFixed(4) + ' ...');
    const ok = await this._tiles(lat, lon, 3200, 25000);
    if (!ok) { this.api.busy(null); this.api.toast('The height tiles did not arrive (network)', 'Terrain'); return false; }
    const home = geoDist(lat, lon, HOME.lat, HOME.lon) < 3;
    const T = this.T;
    if (this.atHome && !home) this._park();
    this.api.clearTransients();
    const keep = this.api.keepBodies();
    const stray = this.world.bodies.filter((b) => !keep.has(b) && !b.fixed); this.world.removeMany(stray);
    let frame;
    if (home) frame = this.homeFrame;
    else { const e = this.dem.elevGeo(lat, lon); frame = new Frame(lat, lon, Math.round(e)); }
    T.stamps = home ? [STAMP] : [];
    T.setFrame(frame); this.tw.reset(); this.soil.reset(); this.fx.ps.length = 0;
    if (home && !this.atHome) this._unpark();
    this.atHome = home; this.off = home ? [0, 0] : null; this._last = null; this.odo = 0;
    const x = home ? 0 : 0, z = home ? 40 : 0, gy = T.h(x, z);
    this.api.place(x, gy, z, yaw);
    T.update(x, z, 900); this.tw.update(T, x, z, 1e9); this.soil.setLegacy(home);
    this.api.busy(null);
    return true;
  }
  stats() { const d = this.dem.stats; return { tilesLoaded: d.loaded, tilesFailed: d.failed, tilesReq: d.requested, chunks: this.T.chunks.size, leaves: this.T.stats.leaves, built: this.T.stats.built, pending: !!this.T.pending, rebases: this.rebases, win: this.tw.stats.cells }; }
}

// known places and their real heights (m): [name, lat, lon, height, tolerance]
export const KNOWN = [
  ['Muzaffarpur', 26.1209, 85.3647, 54, 25], ['Patna', 25.5941, 85.1376, 53, 25], ['Delhi', 28.6139, 77.2090, 216, 30], ['Mumbai (Nariman Pt)', 18.9256, 72.8242, 8, 18],
  ['Kanyakumari', 8.0883, 77.5385, 3, 18], ['Jaisalmer', 26.9157, 70.9083, 225, 40], ['Srinagar', 34.0837, 74.7973, 1585, 50], ['Leh', 34.1526, 77.5771, 3524, 80],
  ['Kedarnath temple', 30.7352, 79.0669, 3583, 90], ['Gangotri temple', 30.9946, 78.9397, 3100, 90], ['Kanchenjunga summit', 27.7025, 88.1475, 8586, 170],
];
// places to stand at, for looking at a region's ground (developer tool): [name, lat, lon, note]
export const PLACES = [
  ['Muzaffarpur (home)', 26.1209, 85.3647, 'Gangetic alluvial plain, the old proving ground'],
  ['Patna (Ganga bank)', 25.6205, 85.1900, 'alluvial, river city'],
  ['Jaisalmer (Thar)', 26.9157, 70.9083, 'dry cracked soil, desert scrub'],
  ['Bhuj (Kutch)', 23.2420, 69.6669, 'dry, salt flats near'],
  ['Delhi', 28.6139, 77.2090, 'plain'],
  ['Guwahati (Assam)', 26.1445, 91.7362, 'humid, lush, wet soil'],
  ['Kolkata (Bengal)', 22.5726, 88.3639, 'delta, humid'],
  ['Kochi (Kerala)', 9.9312, 76.2673, 'humid coast'],
  ['Munnar hills', 10.0889, 77.0595, 'Western Ghats'],
  ['Mumbai', 18.9256, 72.8242, 'coast'],
  ['Chennai', 13.0827, 80.2707, 'coast'],
  ['Kanyakumari', 8.0883, 77.5385, 'southern tip'],
  ['Shimla', 31.1048, 77.1734, 'mid Himalaya'],
  ['Kedarnath', 30.7352, 79.0669, 'high Himalaya, 3,583 m'],
  ['Gangotri', 30.9946, 78.9397, 'Ganga source valley'],
  ['Leh (Ladakh)', 34.1526, 77.5771, 'cold desert, 3,500 m'],
  ['Gurudongmar Lake', 28.0222, 88.7131, '5,148 m, Sikkim'],
  ['Kanchenjunga summit', 27.7025, 88.1475, '8,586 m: highest point of Bharat'],
];
