// Particles (smoke, fire, sparks, chips, glass), skid marks and contact blobs.
import { clamp, lerp } from './math.js';

const MAXP = 2600;
const SKID_CAP = 7000; // quads
const hexLin = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255].map((v) => Math.pow(v, 2.2));

export class FX {
  constructor() {
    this.ps = [];
    this.skidData = new Float32Array(SKID_CAP * 6 * 9);
    this.skidN = 0; this.skidFull = false;
    this.last = new Map(); // wheel key -> last skid sample
    this.blobData = new Float32Array(64 * 6 * 9);
    this.blobN = 0;
    this.flash = 0;
    this.quality = 1;
  }
  add(p) { if (this.ps.length < MAXP * (0.5 + 0.5 * this.quality)) this.ps.push(p); }

  smoke(p, v, size, life, col = [0.5, 0.5, 0.5], alpha = 0.5) {
    this.add({ m: 0, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]], s: size, g: 1.2 + Math.random(), life, t: 0, c: col, a: alpha, drag: 1.4, up: 0.8, seed: Math.random() * 10, rot: Math.random() * 6, rv: (Math.random() - 0.5) });
  }
  puff(p, size, col) {
    for (let i = 0; i < 4; i++) this.smoke([p[0] + (Math.random() - 0.5) * 0.4, p[1] + Math.random() * 0.3, p[2] + (Math.random() - 0.5) * 0.4], [(Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3], size * (0.5 + Math.random() * 0.5), 0.8 + Math.random() * 0.7, col, 0.3);
  }
  tire(p, v, k) {
    this.smoke(p, [v[0] * 0.2 + (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.6, v[2] * 0.2 + (Math.random() - 0.5) * 0.6], 0.35 + k * 0.5, 1.2 + Math.random() * 0.8, [0.78, 0.78, 0.8], 0.28 * clamp(k + 0.3, 0, 1));
  }
  dust(p, v, k) {
    this.smoke(p, [v[0] * 0.15, 0.6 + Math.random(), v[2] * 0.15], 0.4 + k * 0.6, 1.4, [0.55, 0.47, 0.37], 0.35);
  }
  fire(p, v, s) {
    this.add({ m: 1, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]], s: s, g: -0.8, life: 0.5 + Math.random() * 0.45, t: 0, c: [1.0, 0.45 + Math.random() * 0.25, 0.1], a: 1, drag: 0.5, up: 2.5, seed: Math.random() * 10, rot: 0, rv: 0 });
  }
  spark(p, v) {
    this.add({ m: 2, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]], s: 0.08 + Math.random() * 0.1, g: 0, life: 0.35 + Math.random() * 0.5, t: 0, c: [1.0, 0.7, 0.25], a: 1, drag: 0.4, up: -9.8, seed: Math.random(), rot: 0, rv: 0, bounce: 0.35 });
  }
  chip(p, v, hex) {
    this.add({ m: 3, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]], s: 0.025 + Math.random() * 0.05, g: 0, life: 6 + Math.random() * 6, t: 0, c: hexLin(hex || '#888888'), a: 1, drag: 0.05, up: -9.8, seed: Math.random(), rot: Math.random() * 6, rv: (Math.random() - 0.5) * 8, bounce: 0.3, solid: true });
  }
  glass(p, v) {
    this.add({ m: 3, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]], s: 0.02 + Math.random() * 0.04, g: 0, life: 6 + Math.random() * 6, t: 0, c: [0.7, 0.85, 0.9], a: 1, drag: 0.05, up: -9.8, seed: Math.random(), rot: Math.random() * 6, rv: (Math.random() - 0.5) * 10, bounce: 0.25, solid: true });
  }
  explosion(p) {
    this.flash = 1;
    for (let i = 0; i < 70; i++) { const a = Math.random() * 6.28, e = Math.random() * 3.14 - 0.5, sp = 2 + Math.random() * 9; this.fire([p[0], p[1] + 0.5, p[2]], [Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp], 1.2 + Math.random() * 1.6); }
    for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, sp = 1 + Math.random() * 6; this.smoke([p[0], p[1] + 1, p[2]], [Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp], 2 + Math.random() * 2.5, 3 + Math.random() * 3, [0.06, 0.06, 0.06], 0.8); }
    for (let i = 0; i < 60; i++) { const a = Math.random() * 6.28, sp = 4 + Math.random() * 16; this.spark([p[0], p[1] + 0.6, p[2]], [Math.cos(a) * sp, 4 + Math.random() * 12, Math.sin(a) * sp]); }
  }

  update(dt) {
    const ps = this.ps;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.t += dt;
      if (p.t >= p.life) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      const k = Math.exp(-p.drag * dt);
      p.v[0] *= k; p.v[2] *= k;
      if (p.m === 0 || p.m === 1) p.v[1] = p.v[1] * k + (p.m === 0 ? p.up * dt * 0.6 : p.up * dt * 0.3);
      else p.v[1] += p.up * dt;
      p.p[0] += p.v[0] * dt; p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt;
      if (p.rv) p.rot += p.rv * dt;
      if (p.bounce !== undefined && p.p[1] < 0.02) {
        p.p[1] = 0.02;
        if (p.v[1] < 0) { p.v[1] = -p.v[1] * p.bounce; p.v[0] *= 0.6; p.v[2] *= 0.6; }
        if (Math.abs(p.v[1]) < 0.6) { p.v[1] = 0; p.v[0] *= 0.8; p.v[2] *= 0.8; p.rv = 0; }
      }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5);
  }

  // fill renderer particle list
  collect(r) {
    const eye = r.eye;
    const list = [];
    for (const p of this.ps) {
      const u = p.t / p.life;
      let size, a;
      if (p.m === 0) { size = p.s * (1 + p.g * u * 2.2); a = p.a * (u < 0.1 ? u / 0.1 : 1) * (1 - u) * (1 - u * 0.2); }
      else if (p.m === 1) { size = p.s * (1 - u * 0.7); a = p.a * (1 - u); }
      else if (p.m === 2) { size = p.s; a = 1 - u * u; }
      else { size = p.s; a = u > 0.85 ? (1 - u) / 0.15 : 1; }
      const dx = p.p[0] - eye[0], dy = p.p[1] - eye[1], dz = p.p[2] - eye[2];
      const c = p.m === 1 ? [p.c[0], p.c[1] * (1 - u * 0.5), p.c[2] * (1 - u)] : p.c;
      list.push({ p: p.p, size, col: [c[0], c[1], c[2], a], mode: p.m, seed: p.seed, vel: p.m === 2 ? p.v : null, rot: p.rot, dist: dx * dx + dy * dy + dz * dz });
    }
    r.particleList = list;
    r.skidData = this.skidData;
    r.skidCount = this.skidFull ? SKID_CAP * 6 : this.skidN * 6;
    r.blobData = this.blobData;
    r.blobList = { length: this.blobN * 6 };
  }

  // ---- skid marks: call each frame per wheel with contact point & intensity
  skid(key, p, fwd, width, alpha) {
    const last = this.last.get(key);
    if (alpha < 0.03) { this.last.delete(key); return; }
    // perpendicular (ground plane)
    const l = Math.hypot(fwd[0], fwd[2]) || 1;
    const sx = -fwd[2] / l, sz = fwd[0] / l;
    const cur = { p: [p[0], 0.012, p[2]], sx, sz, a: alpha };
    if (last && Math.hypot(cur.p[0] - last.p[0], cur.p[2] - last.p[2]) < 4) {
      if (Math.hypot(cur.p[0] - last.p[0], cur.p[2] - last.p[2]) > 0.15) {
        this._quad(last, cur, width);
        this.last.set(key, cur);
      }
    } else this.last.set(key, cur);
  }
  _quad(a, b, w) {
    const i = this.skidN;
    const d = this.skidData;
    let o = i * 54;
    const v = (p, s, u, vv, al) => { d[o++] = p[0] + a_s(s) * 0; };
    const put = (x, y, z, u, vv, al) => { d[o++] = x; d[o++] = y; d[o++] = z; d[o++] = u; d[o++] = vv; d[o++] = 0.02; d[o++] = 0.02; d[o++] = 0.022; d[o++] = al; };
    const h = w / 2;
    const A0 = [a.p[0] - a.sx * h, a.p[1], a.p[2] - a.sz * h], A1 = [a.p[0] + a.sx * h, a.p[1], a.p[2] + a.sz * h];
    const B0 = [b.p[0] - b.sx * h, b.p[1], b.p[2] - b.sz * h], B1 = [b.p[0] + b.sx * h, b.p[1], b.p[2] + b.sz * h];
    const al = 0.55 * Math.min(a.a, b.a);
    const sv = (this.skidN % 40) / 40;
    put(A0[0], A0[1], A0[2], 0, sv, al); put(A1[0], A1[1], A1[2], 1, sv, al); put(B1[0], B1[1], B1[2], 1, sv + 0.02, al);
    put(A0[0], A0[1], A0[2], 0, sv, al); put(B1[0], B1[1], B1[2], 1, sv + 0.02, al); put(B0[0], B0[1], B0[2], 0, sv + 0.02, al);
    this.skidN++;
    if (this.skidN >= SKID_CAP) { this.skidN = 0; this.skidFull = true; }
  }

  // ---- contact blobs
  beginBlobs() { this.blobN = 0; }
  blob(body, geo) {
    if (this.blobN >= 63) return;
    const R = body.R;
    // forward = -z axis
    let fx = -R[6], fz = -R[8];
    const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    const sx = -fz, sz = fx;
    const hl = geo.L * 0.62, hw = geo.W * 0.7;
    const cx = body.pos[0], cz = body.pos[2];
    const h = Math.max(0.2, 1 - body.pos[1] * 0.35);
    const al = 0.55 * clamp(1.2 - body.pos[1] * 0.5, 0, 1);
    const d = this.blobData;
    let o = this.blobN * 54;
    const put = (x, z, u, v) => { d[o++] = x; d[o++] = 0.008; d[o++] = z; d[o++] = u; d[o++] = v; d[o++] = 0; d[o++] = 0; d[o++] = 0; d[o++] = al; };
    const P = (a, b) => [cx + fx * hl * a + sx * hw * b, cz + fz * hl * a + sz * hw * b];
    const c = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, -1, 0, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
    for (const [a, b, u, v] of c) { const p = P(a, b); put(p[0], p[1], u, v); }
    this.blobN++;
  }
}
function a_s(x) { return x; }
