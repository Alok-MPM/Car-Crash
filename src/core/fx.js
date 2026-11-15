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
    for (let i = 0; i < 4; i++) this.smoke([p[0] + (Math.random() - 0.5) * 0.4, p[1] + Math.random() * 0.3, p[2] + (Math.random() - 0.5) * 0.4], [(Math.random() - 0.5) * 3, Math.random() * 1.5, (Math.random() - 0.5) * 3], size * (0.5 + Math.random() * 0.5), 0.8 + Math.random() * 0.7, col, 0.12);
  }
  tire(p, v, k) {
    this.smoke(p, [v[0] * 0.2 + (Math.random() - 0.5) * 0.6, 0.4 + Math.random() * 0.6, v[2] * 0.2 + (Math.random() - 0.5) * 0.6], 0.35 + k * 0.5, 1.2 + Math.random() * 0.8, [0.78, 0.78, 0.8], 0.28 * clamp(k + 0.3, 0, 1));
  }
  dust(p, v, k) {
    this.smoke(p, [v[0] * 0.15, 0.6 + Math.random(), v[2] * 0.15], 0.4 + k * 0.6, 1.4, [0.55, 0.47, 0.37], 0.18);
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
  // a leaf (mode 4): drifts down slowly, sways sideways, tumbles, then lies on the ground and fades
  leaf(p, v, c) {
    this.add({ m: 4, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]], s: 0.05 + Math.random() * 0.045, g: 0, life: 8 + Math.random() * 5, t: 0, c: [c[0], c[1], c[2]], a: 1, drag: 0.7, up: -2.2, seed: Math.random() * 10, rot: Math.random() * 6, rv: (Math.random() - 0.5) * 5, fl: Math.random() * 6.28, landed: false });
  }
  // a clod of soil thrown by a spinning wheel or a landing object: tumbles, bounces once or twice, lies a moment and fades
  clod(p, v, c) {
    this.add({ m: 3, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]], s: 0.02 + Math.random() * 0.04, g: 0, life: 1.6 + Math.random() * 1.6, t: 0, c: [c[0], c[1], c[2]], a: 1, drag: 0.15, up: -9.8, seed: Math.random(), rot: Math.random() * 6, rv: (Math.random() - 0.5) * 12, bounce: 0.22, solid: true });
  }
  // a torn tuft of grass with its root ball: flies like a clod, but it is a leaf-shaped blade bunch (mode 4, ballistic)
  tuft(p, v, c) {
    const k = 0.8 + Math.random() * 0.5;
    this.add({ m: 4, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]], s: 0.055 + Math.random() * 0.05, g: 0, life: 1.6 + Math.random() * 1.2, t: 0, c: [c[0] * k, c[1] * k, c[2] * k], a: 1, drag: 0.25, up: -9.8, seed: Math.random() * 10, rot: Math.random() * 6, rv: (Math.random() - 0.5) * 14, fl: 0, landed: false, bal: true });
  }
  glass(p, v) {
    this.add({ m: 3, p: [p[0], p[1], p[2]], v: [v[0], v[1], v[2]], s: 0.02 + Math.random() * 0.04, g: 0, life: 6 + Math.random() * 6, t: 0, c: [0.7, 0.85, 0.9], a: 1, drag: 0.05, up: -9.8, seed: Math.random(), rot: Math.random() * 6, rv: (Math.random() - 0.5) * 10, bounce: 0.25, solid: true });
  }
  clearNear(p, R) { this.ps = this.ps.filter((q) => Math.hypot(q.p[0] - p[0], q.p[2] - p[2]) > R); }
  explosion(p) {
    this.flash = 1;
    for (let i = 0; i < 70; i++) { const a = Math.random() * 6.28, e = Math.random() * 3.14 - 0.5, sp = 2 + Math.random() * 9; this.fire([p[0], p[1] + 0.5, p[2]], [Math.cos(a) * Math.cos(e) * sp, Math.sin(e) * sp + 3, Math.sin(a) * Math.cos(e) * sp], 1.2 + Math.random() * 1.6); }
    for (let i = 0; i < 10; i++) { const a = Math.random() * 6.28, sp = 1 + Math.random() * 4; this.smoke([p[0], p[1] + 1, p[2]], [Math.cos(a) * sp, 2 + Math.random() * 4, Math.sin(a) * sp], 1.2 + Math.random() * 1.2, 2 + Math.random() * 2, [0.08, 0.08, 0.08], 0.35); }
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
      const ox = p.p[0], oy = p.p[1], oz = p.p[2];
      p.p[0] += p.v[0] * dt; p.p[1] += p.v[1] * dt; p.p[2] += p.v[2] * dt;
      if (p.rv) p.rot += p.rv * dt;
      // solid bits (clods, chips, shards, torn tufts, leaves) are stopped by cars, walls and trunks instead of flying through them
      if ((p.m === 3 && p.solid || p.m === 4 && !p.landed) && (p.p[1] > 0.06 || p.cf === undefined)) this._collide(p, ox, oy, oz, dt);
      if (p.m === 4) {
        if (p.landed) { p.v[0] = p.v[1] = p.v[2] = 0; p.rv = 0; continue; }
        if (!p.bal) {
          if (p.v[1] < -1.15) p.v[1] = -1.15;                                              // light and wide: terminal speed about 1 m/s
          p.v[0] += Math.cos(p.t * 2.3 + p.fl) * 1.5 * dt; p.v[2] += Math.sin(p.t * 1.8 + p.fl * 1.3) * 1.2 * dt;   // side-to-side flutter
        }
        const gh = this.soil ? this.soil.heightAt(p.p[0], p.p[2]) : 0;
        if (p.p[1] < 0.03 + gh) { p.p[1] = 0.03 + gh; p.landed = true; p.life = Math.min(p.life, p.t + (p.bal ? 0.6 : 5) + Math.random() * 3); }
        continue;
      }
      const gh2 = this.soil && p.solid ? this.soil.heightAt(p.p[0], p.p[2]) : 0;
      if (p.bounce !== undefined && p.p[1] < 0.02 + gh2) {
        p.p[1] = 0.02 + gh2;
        if (p.v[1] < 0) { p.v[1] = -p.v[1] * p.bounce; p.v[0] *= 0.6; p.v[2] *= 0.6; }
        if (Math.abs(p.v[1]) < 0.6) { p.v[1] = 0; p.v[0] *= 0.8; p.v[2] *= 0.8; p.rv = 0; }
      }
    }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.5);
  }

  // ---- particle collision: car bodies (their box shapes) and the static spatial hash of the physics world (walls, trunks, fences, furniture)
  _collide(p, ox, oy, oz, dt) {
    const first = p.cf === undefined; p.cf = 1;
    const rad = p.m === 4 ? p.s * 0.25 : p.s * 0.5;
    const x = p.p[0], y = p.p[1], z = p.p[2];
    const mnx = Math.min(x, ox) - rad - 0.02, mxx = Math.max(x, ox) + rad + 0.02, mny = Math.min(y, oy) - rad - 0.02, mxy = Math.max(y, oy) + rad + 0.02, mnz = Math.min(z, oz) - rad - 0.02, mxz = Math.max(z, oz) + rad + 0.02;
    const cars = this.cars;
    if (cars) for (let i = 0; i < cars.length; i++) {
      const b = cars[i].body, a = b.aabb;
      if (mxx < a[0] || mnx > a[3] || mxz < a[2] || mnz > a[5] || mxy < a[1] || mny > a[4]) continue;
      if (this._body(p, b, ox, oy, oz, rad, first, true)) return;
    }
    const W = this.world;
    if (W && W.sgrid && !W.staticDirty) {
      const cs = W.cell, g = W.sgrid;
      const c0x = Math.floor(mnx / cs), c1x = Math.floor(mxx / cs), c0z = Math.floor(mnz / cs), c1z = Math.floor(mxz / cs);
      for (let cx = c0x; cx <= c1x; cx++) for (let cz = c0z; cz <= c1z; cz++) {
        const l = g.get(cx * 8192 + cz); if (!l) continue;
        for (let i = 0; i < l.length; i++) {
          const b = l[i], a = b.aabb;
          if (b.removed || mxx < a[0] || mnx > a[3] || mxz < a[2] || mnz > a[5] || mxy < a[1] || mny > a[4]) continue;
          if (this._body(p, b, ox, oy, oz, rad, first, false)) return;
        }
      }
    }
  }
  _body(p, b, ox, oy, oz, rad, first, moving) {
    const sh = b.shapes;
    if (p.ign === b.id) {                                  // born inside this body (a clod leaves the wheel arch): free to pass until it is outside of every box
      let inside = false;
      for (let i = 0; i < sh.length && !inside; i++) inside = this._inside(p.p, sh[i], rad);
      if (!inside) p.ign = 0; else return false;
    }
    const q = p.p, dx = q[0] - ox, dy = q[1] - oy, dz = q[2] - oz;
    for (let i = 0; i < sh.length; i++) {
      const s = sh[i], A = s.aabb;
      if (q[0] + rad < A[0] && ox + rad < A[0] || q[0] - rad > A[3] && ox - rad > A[3] || q[2] + rad < A[2] && oz + rad < A[2] || q[2] - rad > A[5] && oz - rad > A[5] || q[1] + rad < A[1] && oy + rad < A[1] || q[1] - rad > A[4] && oy - rad > A[4]) continue;
      const m = s.m, c = s.c, e = s.he;
      const rx = ox - c[0], ry = oy - c[1], rz = oz - c[2];
      let tmin = -1e9, tmax = 1, nk = -1, ns = 1, hit = true;
      for (let k = 0; k < 3 && hit; k++) {
        const ax = m[k * 3], ay = m[k * 3 + 1], az = m[k * 3 + 2];
        const o = rx * ax + ry * ay + rz * az, d = dx * ax + dy * ay + dz * az, ek = e[k] + rad;
        if (Math.abs(d) < 1e-9) { if (Math.abs(o) > ek) hit = false; }
        else {
          let t1 = (-ek - o) / d, t2 = (ek - o) / d, sg = -1;
          if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; sg = 1; }
          if (t1 > tmin) { tmin = t1; nk = k; ns = sg; }
          if (t2 < tmax) tmax = t2;
          if (tmin > tmax) hit = false;
        }
      }
      if (!hit || tmax < 0) continue;
      let nx, ny, nz;
      if (tmin < 0) {                                      // the previous position was already inside: spawned there (ignore this body until clear) or pushed in by a moving body
        if (first) { p.ign = b.id; return false; }
        // push out through the nearest face from the new position
        const px = q[0] - c[0], py = q[1] - c[1], pz = q[2] - c[2];
        let best = 1e9, bk = 0, bs = 1;
        for (let k = 0; k < 3; k++) { const l = px * m[k * 3] + py * m[k * 3 + 1] + pz * m[k * 3 + 2], pen = e[k] + rad - Math.abs(l); if (pen < best) { best = pen; bk = k; bs = l < 0 ? -1 : 1; } }
        if (best <= 0) continue;
        nx = bs * m[bk * 3]; ny = bs * m[bk * 3 + 1]; nz = bs * m[bk * 3 + 2];
        q[0] += nx * (best + 0.002); q[1] += ny * (best + 0.002); q[2] += nz * (best + 0.002);
      } else {
        if (nk < 0 || tmin > 1) continue;
        nx = ns * m[nk * 3]; ny = ns * m[nk * 3 + 1]; nz = ns * m[nk * 3 + 2];
        q[0] = ox + dx * tmin + nx * 0.002; q[1] = oy + dy * tmin + ny * 0.002; q[2] = oz + dz * tmin + nz * 0.002;
      }
      // velocity of the surface at the contact (a moving, spinning car drags and throws what hits it)
      let bx = 0, by = 0, bz = 0;
      if (!b.fixed) { const rr0 = q[0] - b.pos[0], rr1 = q[1] - b.pos[1], rr2 = q[2] - b.pos[2]; bx = b.v[0] + b.w[1] * rr2 - b.w[2] * rr1; by = b.v[1] + b.w[2] * rr0 - b.w[0] * rr2; bz = b.v[2] + b.w[0] * rr1 - b.w[1] * rr0; }
      const v = p.v, rvx = v[0] - bx, rvy = v[1] - by, rvz = v[2] - bz;
      const vn = rvx * nx + rvy * ny + rvz * nz;
      if (vn < 0) {
        const e0 = p.m === 4 ? (p.bal ? 0.04 : 0) : (p.bounce === undefined ? 0.2 : p.bounce), er = -vn < 0.9 ? 0 : e0;      // slow touches do not bounce, they rest
        let tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
        const mu = p.m === 4 ? (p.bal ? 0.5 : 0.1) : 0.38, fr = Math.max(0, 1 - mu - Math.min(0.4, -vn * 0.03));
        tx *= fr; ty *= fr; tz *= fr;
        v[0] = bx + tx - nx * vn * er; v[1] = by + ty - ny * vn * er; v[2] = bz + tz - nz * vn * er;
        if (p.rv) p.rv *= 0.45;
      }
      return true;
    }
    return false;
  }
  _inside(q, s, rad) {
    const m = s.m, c = s.c, e = s.he, px = q[0] - c[0], py = q[1] - c[1], pz = q[2] - c[2];
    for (let k = 0; k < 3; k++) if (Math.abs(px * m[k * 3] + py * m[k * 3 + 1] + pz * m[k * 3 + 2]) > e[k] + rad) return false;
    return true;
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

  // ---- road damage: gouge strokes and craters (reuse the skid ribbon buffer, darker/wider)
  gouge(key, x, z, fwd, width, alpha) { this.skid('g' + key, [x, 0, z], fwd, width, alpha); }
  crater(x, z, r, alpha) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * 3.14, c = Math.cos(a), s = Math.sin(a), rr = r * (0.6 + Math.random() * 0.6);
      const k = 'c' + this.skidN + i;
      this.skid(k, [x - c * rr * 0.5, 0, z - s * rr * 0.5], [c, 0, s], rr * 0.5, alpha);
      this.skid(k, [x + c * rr * 0.5, 0, z + s * rr * 0.5], [c, 0, s], rr * 0.5, alpha);
      this.last.delete(k);
    }
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
