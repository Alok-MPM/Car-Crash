// A car in the world: physics vehicle + deformable render mesh + wheels + damage model.
import { buildCarGeometry, buildWheel, MATS, PART, PART_NAME, paintDecals } from './carmodel.js';
import { Vehicle } from './vehicle.js';
import { Body, GROUP } from './physics.js';
import { m4, clamp, lerp, smoothstep, hash3, vnoise, mulberry32 } from './math.js';

const PROTO = new Map();
const hexLin = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255].map((v) => Math.pow(v, 2.2));

function getProto(spec) {
  let P = PROTO.get(spec.id);
  if (P) return P;
  const built = buildCarGeometry(spec);
  const fin = built.out.finish();
  const geo = fin.geo;
  const n = geo.pos.length / 3;
  // weld map for normal recomputation (same position + similar normal)
  const weld = new Int32Array(n);
  const m = new Map();
  let wid = 0;
  const reps = [];
  for (let i = 0; i < n; i++) {
    const key = Math.round(geo.pos[i * 3] * 150) + ',' + Math.round(geo.pos[i * 3 + 1] * 150) + ',' + Math.round(geo.pos[i * 3 + 2] * 150);
    let list = m.get(key);
    if (!list) { list = []; m.set(key, list); }
    let f = -1;
    for (const r of list) {
      const d = geo.nrm[i * 3] * geo.nrm[r * 3] + geo.nrm[i * 3 + 1] * geo.nrm[r * 3 + 1] + geo.nrm[i * 3 + 2] * geo.nrm[r * 3 + 2];
      if (d > 0.6) { f = weld[r]; break; }
    }
    if (f < 0) { f = wid++; list.push(i); }
    weld[i] = f;
  }
  // vertex -> group kind (0 normal, 1 glass, 2 lamp)
  const vkind = new Uint8Array(n);
  const vgroup = new Int16Array(n);
  fin.groups.forEach((g, gi) => {
    for (let k = g.start; k < g.start + g.count; k++) {
      const v = geo.idx[k];
      vgroup[v] = gi;
      vkind[v] = g.mat === 'glass' ? 1 : g.mat === 'lampF' || g.mat === 'lampR' ? 2 : g.mat === 'lampA' ? 2 : 0;
    }
  });
  // part bounding boxes (rest pose, car-local)
  const pb = [];
  for (let p = 0; p < PART.COUNT; p++) pb.push({ min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], n: 0 });
  for (const g of fin.groups) {
    const b = pb[g.part];
    for (let k = g.start; k < g.start + g.count; k++) {
      const v = geo.idx[k];
      for (let a = 0; a < 3; a++) { const x = geo.pos[v * 3 + a]; if (x < b.min[a]) b.min[a] = x; if (x > b.max[a]) b.max[a] = x; }
      b.n++;
    }
  }
  P = { geo, groups: fin.groups, weld, wid, vkind, vgroup, pb, built, n };
  PROTO.set(spec.id, P);
  return P;
}

const PART_MASS = [0, 22, 18, 16, 16, 24, 24, 1.5, 1.5, 12];
const PART_HARD = [9, 0.38, 0.45, 0.28, 0.28, 0.42, 0.42, 0.07, 0.07, 0.22]; // crumple depth needed to tear off

export class Car {
  constructor(ctx, spec, o = {}) {
    this.ctx = ctx;
    const { r, world } = ctx;
    this.spec = spec;
    this.id = spec.id;
    this.proto = getProto(spec);
    const P = this.proto;
    this.vehicle = new Vehicle(world, spec, { pos: o.pos, q: o.q });
    this.body = this.vehicle.body;
    this.body.userData.car = this;
    this.colorHex = o.color || spec.colors[0];
    this.npc = !!o.npc;
    // instance geometry
    this.pos = new Float32Array(P.geo.pos);
    this.nrm = new Float32Array(P.geo.nrm);
    this.col = new Float32Array(P.geo.col);
    this.dis = new Float32Array(P.geo.pos.length);
    this.geoI = { pos: this.pos, nrm: this.nrm, col: this.col, uv: P.geo.uv, idx: P.geo.idx };
    this.mats = {};
    const base = hexLin(this.colorHex);
    this.paintMat = Object.assign({}, MATS.paint, { base });
    if (ctx.decalCanvas) {
      const tex = ctx.getDecalTex(spec, P.built.B);
      if (tex) this.paintMat.tex = tex;
    }
    this.lampR = Object.assign({}, MATS.lampR);
    this.lampF = Object.assign({}, MATS.lampF);
    this.plateMat = Object.assign({}, MATS.plate);
    if (ctx.plateTex) this.plateMat.tex = ctx.plateTex(spec, o.plate);
    this.groups = P.groups.map((g) => {
      let mat = MATS[g.mat];
      if (g.mat === 'paint') mat = this.paintMat;
      else if (g.mat === 'lampR') mat = this.lampR;
      else if (g.mat === 'lampF') mat = this.lampF;
      else if (g.mat === 'plate') mat = this.plateMat;
      return { start: g.start, count: g.count, mat, part: g.part, hidden: false, name: g.mat };
    });
    this.mesh = r.createMesh(this.geoI, { groups: this.groups, dynamic: true, radius: 4 });
    this.hide = {};
    this.partGone = new Array(PART.COUNT).fill(false);
    // wheels
    this.wheelMesh = getWheelMeshes(r, spec, ctx);
    this.dirtyNormals = false;
    this.dirtyVerts = false;
    this.deform = 0; // accumulated crumple metric
    this.cost = 0;
    this.fire = 0;
    this.burnt = 0;
    this.wrecked = false;
    this.glassGone = {};
    this.smokeT = 0;
    this.lastHit = -10;
    this.vehicle.assist = o.assist ?? 1;
    this.mass = spec.kg;
    this.impactBudget = 0;
    this.hazard = 0;
    this.horn = 0;
    this.lights = true;
    this.dead = false;
    if (o.npc) { this.vehicle.in.handbrake = 1; this.parked = true; }
    this.rng = mulberry32((Math.random() * 1e9) | 0);
  }

  get health() { return clamp(1 - this.deform / 3.2, 0, 1); }

  // ---------- damage ----------
  impact(e, other, selfIsA) {
    const b = this.body;
    const m1 = b.mass, m2 = other.fixed || !other.mass ? 1e9 : other.mass;
    const mu = (m1 * m2) / (m1 + m2);
    const v = e.speed;
    if (v < 1.5) return;
    // rate limit repeated contact with the same thing (piles of debris resting on the car)
    const ot = this.hitT || (this.hitT = new Map());
    const nowT = this.ctx.time;
    const lastT = ot.get(other.id) || -9;
    if (nowT - lastT < 0.35 && v < 8) return;
    ot.set(other.id, nowT);
    if (ot.size > 40) for (const [k, t] of ot) if (nowT - t > 2) ot.delete(k);
    const E = 0.5 * mu * v * v; // joules
    const ek = E / 154000;
    let depth = 0.35 * Math.pow(ek, 0.62);
    if (other.group === GROUP.CAR) depth *= 0.8;
    depth = clamp(depth, 0, 1.15);
    if (depth < 0.012) { this.scrape(e.p, v); return; }
    const now = this.ctx.time;
    // local frame
    const R = b.R;
    const d = [e.p[0] - b.pos[0], e.p[1] - b.pos[1], e.p[2] - b.pos[2]];
    const pl = [d[0] * R[0] + d[1] * R[1] + d[2] * R[2], d[0] * R[3] + d[1] * R[4] + d[2] * R[5], d[0] * R[6] + d[1] * R[7] + d[2] * R[8]];
    let n = e.n;
    // normal pointing out of the car at the contact
    const sg = n[0] * d[0] + n[1] * d[1] + n[2] * d[2] > 0 ? 1 : -1;
    const nOut = [n[0] * sg, n[1] * sg, n[2] * sg];
    const nl = [nOut[0] * R[0] + nOut[1] * R[1] + nOut[2] * R[2], nOut[0] * R[3] + nOut[1] * R[4] + nOut[2] * R[5], nOut[0] * R[6] + nOut[1] * R[7] + nOut[2] * R[8]];
    const cl = Math.hypot(pl[0], pl[1], pl[2]) || 1;
    let dir = [-nl[0] * 0.7 - (pl[0] / cl) * 0.3, -nl[1] * 0.7 - (pl[1] / cl) * 0.3, -nl[2] * 0.7 - (pl[2] / cl) * 0.3];
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    dir = [dir[0] / dl, dir[1] / dl, dir[2] / dl];
    const radius = 0.5 + depth * 0.7;
    this.deformAt(pl, dir, depth, radius);
    this.deform += depth * (other.group === GROUP.CAR ? 0.9 : 1);
    this.cost = Math.min(this.spec.price * 1.0, this.cost + this.spec.price * 0.3 * Math.pow(depth, 1.4));
    this.lastHit = now;
    this.ctx.onDamage && this.ctx.onDamage(this, depth, E, e.p);
    // mechanical damage
    const L = this.spec.geo.L;
    const front = pl[2] < -L * 0.18, rear = pl[2] > L * 0.18;
    if (front && depth > 0.1) {
      this.vehicle.health.engine = clamp(this.vehicle.health.engine - depth * 0.55, 0, 1);
      this.vehicle.health.radiator = clamp(this.vehicle.health.radiator - depth * 0.9, 0, 1);
    }
    if (depth > 0.18 && Math.abs(pl[2]) > L * 0.2) this.vehicle.health.steerBias += (this.rng() - 0.5) * depth * 0.08;
    // wheels
    this.vehicle.wheels.forEach((w, i) => {
      if (w.detached) return;
      const wc = this.wheelLocal(w);
      const dw = Math.hypot(pl[0] - wc[0], pl[1] - wc[1], pl[2] - wc[2]);
      if (dw < 0.7) {
        w.health -= depth * 1.3 * (1 - dw / 0.9);
        if (w.health < 0.5) w.flat = true;
        if (w.health < 0.05 && depth > 0.3) this.detachWheel(i, dir);
      }
    });
    // parts
    for (let p = 1; p < PART.COUNT; p++) {
      if (this.partGone[p]) continue;
      const bb = this.proto.pb[p];
      if (!bb.n) continue;
      const pad = 0.28 + depth * 0.3;
      if (pl[0] < bb.min[0] - pad || pl[0] > bb.max[0] + pad || pl[1] < bb.min[1] - pad || pl[1] > bb.max[1] + pad || pl[2] < bb.min[2] - pad || pl[2] > bb.max[2] + pad) continue;
      if (depth * (0.85 + 0.5 * this.rng()) > PART_HARD[p]) this.detachPart(p, nl, v);
    }
    // glass shatter check
    this.checkGlass();
    // sparks / debris fx
    const fx = this.ctx.fx;
    if (fx) {
      const n = Math.min(40, 6 + (depth * 60) | 0);
      for (let i = 0; i < n; i++) fx.spark(e.p, [nOut[0] * 3 + (this.rng() - 0.5) * 10 + b.v[0] * 0.3, nOut[1] * 3 + this.rng() * 6 + b.v[1] * 0.3, nOut[2] * 3 + (this.rng() - 0.5) * 10 + b.v[2] * 0.3]);
      if (depth > 0.1) for (let i = 0; i < 6; i++) fx.chip(e.p, [nOut[0] * 3 + (this.rng() - 0.5) * 8, 1 + this.rng() * 4, nOut[2] * 3 + (this.rng() - 0.5) * 8], this.colorHex);
    }
    if (this.vehicle.health.engine < 0.2 && !this.wrecked) this.wreck();
  }

  scrape(p, v) {
    // light scratch: darken paint a bit around the contact
    const b = this.body, R = b.R;
    const d = [p[0] - b.pos[0], p[1] - b.pos[1], p[2] - b.pos[2]];
    const pl = [d[0] * R[0] + d[1] * R[1] + d[2] * R[2], d[0] * R[3] + d[1] * R[4] + d[2] * R[5], d[0] * R[6] + d[1] * R[7] + d[2] * R[8]];
    this.deformAt(pl, [0, 0, 0], 0.0, 0.3, 0.2 * clamp(v / 8, 0, 1));
    if (this.ctx.fx && v > 4) this.ctx.fx.spark(p, [(this.rng() - 0.5) * 4, 1 + this.rng() * 2, (this.rng() - 0.5) * 4]);
  }

  // push vertices around pl along dir (inward); also darken / crack colour
  deformAt(pl, dir, depth, radius, scratch = 0) {
    const P = this.proto, pos = this.pos, rest = P.geo.pos, dis = this.dis, col = this.col, vk = P.vkind;
    const n = rest.length / 3;
    const r2 = radius * radius;
    const sev = clamp(depth / 0.3, 0, 1);
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const dx = x - pl[0], dy = y - pl[1], dz = z - pl[2];
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) continue;
      const f0 = 1 - d2 / r2;
      const f = f0 * f0;
      const k = vk[i];
      if (depth > 0) {
        const rx = rest[i * 3], ry = rest[i * 3 + 1], rz = rest[i * 3 + 2];
        const nz = (vnoise(rx * 8, ry * 8, rz * 8) - 0.5) * 2;
        const amt = depth * f * (1 + 0.55 * nz);
        let ox = dir[0] * amt, oy = dir[1] * amt, oz = dir[2] * amt;
        // pinch toward the impact point makes creases
        const pin = 0.16 * f * Math.min(1, depth / 0.3);
        ox -= dx * pin; oy -= dy * pin; oz -= dz * pin;
        // crumple jitter
        const j2 = hash3((rx * 400) | 0, (ry * 400) | 0, (rz * 400) | 0) - 0.5;
        ox += j2 * 0.05 * amt * 3; oy += (hash3((ry * 300) | 0, (rz * 300) | 0, 7) - 0.5) * 0.05 * amt * 3;
        let nx = dis[i * 3] + ox, ny = dis[i * 3 + 1] + oy, nzz = dis[i * 3 + 2] + oz;
        const m = Math.hypot(nx, ny, nzz);
        const cap = 1.25;
        if (m > cap) { const s = cap / m; nx *= s; ny *= s; nzz *= s; }
        dis[i * 3] = nx; dis[i * 3 + 1] = ny; dis[i * 3 + 2] = nzz;
        pos[i * 3] = rest[i * 3] + nx; pos[i * 3 + 1] = rest[i * 3 + 1] + ny; pos[i * 3 + 2] = rest[i * 3 + 2] + nzz;
      }
      // colour: dirt/scratches on paint & other, cracks on glass, dead lamps
      const dm = k === 1 ? f * (sev * 1.4 + 0.1 + scratch) : k === 2 ? f * sev * 2 : f * (0.25 + sev * 0.5 + scratch);
      const c = clamp(col[i * 3] - dm, 0.0, 1);
      col[i * 3] = c;
      if (k !== 1) { col[i * 3 + 1] = clamp(col[i * 3 + 1] - dm * 0.7, 0, 1); col[i * 3 + 2] = clamp(col[i * 3 + 2] - dm * 0.7, 0, 1); }
    }
    this.dirtyVerts = true;
    if (depth > 0) this.dirtyNormals = true;
  }

  checkGlass() {
    const P = this.proto;
    const sums = {}, cnt = {};
    this.groups.forEach((g, gi) => {
      if (g.name !== 'glass' || g.hidden) return;
      let s = 0, c = 0, mx = 0;
      for (let k = g.start; k < g.start + g.count; k += 3) { const v = P.geo.idx[k]; const dmg = 1 - this.col[v * 3]; s += dmg; c++; if (dmg > mx) mx = dmg; }
      if (c && (s / c > 0.45 || mx > 0.98 && s / c > 0.3)) {
        g.hidden = true;
        this.glassGone[gi] = true;
        const fx = this.ctx.fx;
        if (fx) {
          const b = this.body;
          for (let i = 0; i < 24; i++) {
            const lp = [(this.rng() - 0.5) * 1.0, this.spec.geo.beltY - this.spec.geo.cgY + 0.15 + this.rng() * 0.2, (this.rng() - 0.5) * 2.4];
            fx.glass(b.toWorld(lp), [b.v[0] * 0.5 + (this.rng() - 0.5) * 5, 2 + this.rng() * 3, b.v[2] * 0.5 + (this.rng() - 0.5) * 5]);
          }
        }
        this.ctx.sfx && this.ctx.sfx.glass(this.body.pos);
      }
    });
  }

  flushDamage() {
    if (!this.dirtyVerts) return;
    const P = this.proto;
    if (this.dirtyNormals) {
      const acc = new Float32Array(P.wid * 3);
      const pos = this.pos, idx = P.geo.idx, weld = P.weld;
      for (let i = 0; i < idx.length; i += 3) {
        const a = idx[i], b = idx[i + 1], c = idx[i + 2];
        const ux = pos[b * 3] - pos[a * 3], uy = pos[b * 3 + 1] - pos[a * 3 + 1], uz = pos[b * 3 + 2] - pos[a * 3 + 2];
        const vx = pos[c * 3] - pos[a * 3], vy = pos[c * 3 + 1] - pos[a * 3 + 1], vz = pos[c * 3 + 2] - pos[a * 3 + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const v of [a, b, c]) { const w = weld[v] * 3; acc[w] += nx; acc[w + 1] += ny; acc[w + 2] += nz; }
      }
      const rn = P.geo.nrm;
      for (let v = 0; v < P.n; v++) {
        const w = weld[v] * 3;
        let x = acc[w], y = acc[w + 1], z = acc[w + 2];
        const l = Math.hypot(x, y, z);
        if (l < 1e-9) continue;
        x /= l; y /= l; z /= l;
        // keep orientation consistent with rest normal (triangles winding is rest-oriented)
        if (x * rn[v * 3] + y * rn[v * 3 + 1] + z * rn[v * 3 + 2] < 0) { x = -x; y = -y; z = -z; }
        const bx = x * 0.8 + rn[v * 3] * 0.2, by = y * 0.8 + rn[v * 3 + 1] * 0.2, bz = z * 0.8 + rn[v * 3 + 2] * 0.2;
        const bl = Math.hypot(bx, by, bz) || 1;
        this.nrm[v * 3] = bx / bl; this.nrm[v * 3 + 1] = by / bl; this.nrm[v * 3 + 2] = bz / bl;
      }
      this.dirtyNormals = false;
      this.ctx.r.updateMesh(this.mesh, this.geoI, 'pnc');
    } else this.ctx.r.updateMesh(this.mesh, this.geoI, 'c');
    this.dirtyVerts = false;
  }

  wheelLocal(w) { return [w.mount[0], w.mount[1] - w.susp, w.mount[2]]; }

  // ---------- parts ----------
  detachPart(p, nl, v) {
    if (this.partGone[p]) return;
    this.partGone[p] = true;
    this.hide[p] = true;
    const bb = this.proto.pb[p];
    const c = [(bb.min[0] + bb.max[0]) / 2, (bb.min[1] + bb.max[1]) / 2, (bb.min[2] + bb.max[2]) / 2];
    const he = [Math.max(0.03, (bb.max[0] - bb.min[0]) / 2), Math.max(0.012, Math.min((bb.max[1] - bb.min[1]) / 2, 0.12)), Math.max(0.03, (bb.max[2] - bb.min[2]) / 2)];
    // flat panels: thin along their smallest axis
    const b = this.body;
    const body = new Body({ mass: PART_MASS[p], pos: b.toWorld(c), q: b.q.slice(), fric: 0.45, rest: 0.1, group: GROUP.DEBRIS, mask: GROUP.STATIC | GROUP.PROP | GROUP.DEBRIS, angDamp: 0.12 });
    const hy = p === PART.HOOD || p === PART.TRUNK || p === PART.DOORL || p === PART.DOORR ? Math.max(0.035, Math.min(he[1], 0.09)) : Math.max(0.04, he[1]);
    body.addBox([he[0], hy, he[2]]);
    body.v = [b.v[0] + nl[0] * 2 * 0.3, b.v[1] + 2 + this.rng() * 3, b.v[2] + nl[2] * 2 * 0.3];
    for (let i = 0; i < 3; i++) body.v[i] += (this.rng() - 0.5) * 3;
    body.w = [(this.rng() - 0.5) * 8, (this.rng() - 0.5) * 8, (this.rng() - 0.5) * 8];
    this.ctx.world.add(body);
    this.ctx.debris.push({ body, mesh: this.mesh, part: p, c, car: this, t: 0, kind: 'part', col: this.colorHex });
    setTimeout(() => { body.mask |= GROUP.CAR; }, 900);
    this.cost += this.spec.price * 0.02;
    this.ctx.sfx && this.ctx.sfx.thud(b.pos, 1.0);
  }

  detachWheel(i, dir) {
    const w = this.vehicle.wheels[i];
    if (w.detached) return;
    w.detached = true;
    const b = this.body;
    const lc = this.wheelLocal(w);
    const wp = b.toWorld(lc);
    const R = w.R, hw = w.tw / 2;
    const body = new Body({ mass: 22, pos: wp, q: b.q.slice(), fric: 0.8, rest: 0.35, group: GROUP.DEBRIS, mask: GROUP.STATIC | GROUP.PROP | GROUP.DEBRIS, angDamp: 0.02, linDamp: 0.01 });
    for (let k = 0; k < 3; k++) body.addBox([hw, R * 0.5, R * 0.866], [0, 0, 0], [Math.sin((k * Math.PI) / 6), 0, 0, Math.cos((k * Math.PI) / 6)]);
    body.v = [b.v[0] + (this.rng() - 0.5) * 3, b.v[1] + 1.5, b.v[2] + (this.rng() - 0.5) * 3];
    const sp = w.omega;
    const ax = [b.R[0] * w.side, b.R[1] * w.side, b.R[2] * w.side];
    body.w = [-ax[0] * sp, -ax[1] * sp, -ax[2] * sp];
    this.ctx.world.add(body);
    this.ctx.debris.push({ body, kind: 'wheel', car: this, side: w.side, front: w.front, spin: w.spin, t: 0 });
    setTimeout(() => { body.mask |= GROUP.CAR; }, 700);
    this.vehicle.health.steerBias += w.front ? (this.rng() - 0.5) * 0.06 : 0;
    this.ctx.sfx && this.ctx.sfx.thud(b.pos, 1.3);
  }

  wreck() {
    this.wrecked = true;
    // most wrecks only smoke; a fuel leak that ignites is the exception
    if (this.rng() < 0.3) { this.fire = 0.01; this.leak = this.rng() < 0.4; }
  }

  // ---------- per frame ----------
  update(dt, input) {
    const v = this.vehicle;
    // brake lights
    const braking = v.in.brake > 0.1 && v.vf > 0.5 || v.gear < 0;
    const k = (braking ? 3.2 : 0.7) * (1 - this.burnt * 0.8);
    this.lampR.emis = [1.6 * k, 0.05 * k, 0.03 * k];
    const night = this.ctx.r.night;
    const hk = this.lights ? (0.5 + night * 3.5) : 0.1;
    this.lampF.emis = [2.4 * hk, 2.4 * hk, 2.1 * hk];
    // smoke / fire
    const fx = this.ctx.fx;
    const he = v.health.engine;
    const b = this.body;
    if (fx && !this.dead) {
      const fwd = [-b.R[6], -b.R[7], -b.R[8]];
      const hoodP = b.toWorld([0, 0.25, -this.spec.geo.L * 0.38]);
      if (he < 0.4) {
        this.smokeT -= dt;
        const rate = lerp(0.35, 0.07, clamp((0.4 - he) / 0.4, 0, 1));
        if (this.smokeT <= 0) { this.smokeT = rate; const dark = he < 0.35; fx.smoke(hoodP, [b.v[0] * 0.3 + (Math.random() - 0.5), 1.2 + Math.random(), b.v[2] * 0.3 + (Math.random() - 0.5)], 0.4 + (1 - he) * 0.5, 1.4 + Math.random() * 0.8, dark ? [0.05, 0.05, 0.05] : [0.6, 0.6, 0.6], dark ? 0.55 : 0.3); }
      }
      if (this.fire > 0) {
        this.fire += dt;
        this.burnt = clamp(this.fire / 25, 0, 1);
        if (this.fire > 16 && !this.leak) { this.fire = -1; }
        for (let i = 0; i < 2; i++) fx.fire(b.toWorld([(Math.random() - 0.5) * 1.0, 0.35, -this.spec.geo.L * 0.3 + (Math.random() - 0.5) * 0.8]), [(Math.random() - 0.5) * 0.8, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 0.8], 0.4 + Math.random() * 0.4);
        if (Math.random() < 0.25) fx.smoke(b.toWorld([0, 0.7, -0.6]), [0, 2.2, 0], 0.9 + Math.random(), 2.5, [0.04, 0.04, 0.04], 0.75);
        this.ctx.r.addLight && this.ctx.r.addLight(hoodP[0], hoodP[1] + 0.5, hoodP[2], 9, 1.6, 0.6, 0.2);
        if (this.fire > 11 && this.leak && !this.exploded && this.ctx.explosions) this.explode();
      }
    }
    if (this.burnt > 0) {
      // charring: darken vertex colours gradually
      const t = this.burnt;
      this.paintMat.base = hexLin(this.colorHex).map((c) => c * (1 - t * 0.85));
    }
    this.flushDamage();
  }

  explode() {
    this.exploded = true;
    const b = this.body;
    this.ctx.fx && this.ctx.fx.explosion(b.pos);
    this.ctx.sfx && this.ctx.sfx.boom(b.pos);
    b.v[1] += 6; b.w[0] += (Math.random() - 0.5) * 3; b.w[2] += (Math.random() - 0.5) * 3;
    // blast pushes nearby bodies
    for (const o of this.ctx.world.bodies) {
      if (o === b || o.fixed) continue;
      const dx = o.pos[0] - b.pos[0], dy = o.pos[1] - b.pos[1], dz = o.pos[2] - b.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d < 12 && d > 0.1) { o.wake(); const k = (1 - d / 12) * 9 * Math.min(1, 600 / (o.mass || 50)) ; o.v[0] += (dx / d) * k; o.v[1] += (dy / d) * k + k * 0.5; o.v[2] += (dz / d) * k; }
    }
    for (let p = 1; p < PART.COUNT; p++) if (!this.partGone[p] && this.rng() < 0.6) this.detachPart(p, [0, 1, 0], 20);
    for (let i = 0; i < 4; i++) if (this.rng() < 0.5) this.detachWheel(i, [0, 1, 0]);
    this.deformAt([0, 0.5, -1], [0, -1, 0], 0.5, 1.8);
    this.deform += 1.0;
    this.burnt = 1;
    this.vehicle.health.engine = 0;
    this.groups.forEach((g) => { if (g.name === 'glass') g.hidden = true; });
  }

  // ---------- draw ----------
  draw() {
    const { r } = this.ctx;
    const b = this.body;
    const M = this._m || (this._m = new Float32Array(16));
    m4.fromTRS(M, b.pos, b.q, 1);
    r.add(this.mesh, M, { hide: this.hide });
    // wheels
    const W = this.vehicle.wheels;
    const T = this._t || (this._t = new Float32Array(16)), A = this._a || (this._a = new Float32Array(16)), B2 = this._b || (this._b = new Float32Array(16));
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      if (w.detached) continue;
      const wm = this.wheelMesh[w.front ? 0 : 1];
      const cs = Math.cos(w.front ? this.vehicle.steerAngle : 0), sn = Math.sin(w.front ? this.vehicle.steerAngle : 0);
      // local: translate * steer(Y) * [flip] * spin(X)
      const sp = w.side > 0 ? -w.spin : w.spin;
      const csp = Math.cos(sp), ssp = Math.sin(sp);
      const flip = w.side > 0 ? 1 : -1;
      // build rotation columns: steer * flip(Ry pi if left) * Rx(sp)
      // Rx: [1,0,0; 0,c,-s; 0,s,c] (columns)
      // compute step by step with small matrices
      const rx = [1, 0, 0, 0, csp, ssp, 0, -ssp, csp];
      const fl = w.side > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [-1, 0, 0, 0, 1, 0, 0, 0, -1];
      const st = [cs, 0, sn, 0, 1, 0, -sn, 0, cs];
      const mm3 = (a, c) => { const o = new Array(9); for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) o[col * 3 + row] = a[row] * c[col * 3] + a[3 + row] * c[col * 3 + 1] + a[6 + row] * c[col * 3 + 2]; return o; };
      const R3 = mm3(st, mm3(fl, rx));
      const lc = this.wheelLocal(w);
      T.fill(0);
      T[0] = R3[0]; T[1] = R3[1]; T[2] = R3[2]; T[4] = R3[3]; T[5] = R3[4]; T[6] = R3[5]; T[8] = R3[6]; T[9] = R3[7]; T[10] = R3[8];
      T[12] = lc[0]; T[13] = lc[1]; T[14] = lc[2]; T[15] = 1;
      m4.mul(A, M, T);
      r.add(wm.spin, A);
      // caliper: steer only (no spin), flipped on the left
      const fl2 = w.side > 0 ? [1, 0, 0, 0, 1, 0, 0, 0, 1] : [-1, 0, 0, 0, 1, 0, 0, 0, -1];
      const R4 = mm3(st, fl2);
      T[0] = R4[0]; T[1] = R4[1]; T[2] = R4[2]; T[4] = R4[3]; T[5] = R4[4]; T[6] = R4[5]; T[8] = R4[6]; T[9] = R4[7]; T[10] = R4[8];
      m4.mul(B2, M, T);
      r.add(wm.caliper, B2, { cast: false });
    }
    // contact shadow blob
    this.ctx.blobs && this.ctx.blobs.push(b, this.spec.geo);
  }

  dispose() {
    this.ctx.world.remove(this.body);
    this.ctx.r.deleteMesh(this.mesh);
  }
}

// debris items: draw detached parts / wheels
export function drawDebris(ctx, d) {
  const { r } = ctx;
  const b = d.body;
  const M = d._m || (d._m = new Float32Array(16)), T = d._t || (d._t = new Float32Array(16));
  m4.fromTRS(M, b.pos, b.q, 1);
  if (d.kind === 'part') {
    T.fill(0); T[0] = T[5] = T[10] = T[15] = 1; T[12] = -d.c[0]; T[13] = -d.c[1]; T[14] = -d.c[2];
    const O = d._o || (d._o = new Float32Array(16));
    m4.mul(O, M, T);
    r.add(d.mesh, O, { only: d.part });
  } else if (d.kind === 'rubble') {
    m4.fromTRS(M, b.pos, b.q, d.s);
    r.add(d.mesh, M, { cast: false });
  } else if (d.kind === 'wheel') {
    const wm = d.car.wheelMesh[d.front ? 0 : 1];
    const fl = d.side > 0 ? 1 : -1;
    T.fill(0); T[0] = fl; T[5] = 1; T[10] = fl; T[15] = 1;
    const O = d._o || (d._o = new Float32Array(16));
    m4.mul(O, M, T);
    r.add(wm.spin, O);
  }
}

// ---------- wheel meshes (shared per spec id & renderer) ----------
function getWheelMeshes(r, spec, ctx) {
  r._wm = r._wm || {};
  if (r._wm[spec.id]) return r._wm[spec.id];
  const g = spec.geo;
  const style = ctx.wheelStyle(spec) || 'multi';
  const out = [];
  for (const [R, tw] of [[g.RF, g.twF], [g.RR, g.twR]]) {
    const w = buildWheel(R, tw, style);
    const mk = (b) => {
      const groups = b.groups.map((gr) => ({ ...gr, mat: gr.mat === 'caliper' ? Object.assign({}, MATS.caliper, { base: hexLin('#c8102e') }) : MATS[gr.mat] }));
      return r.createMesh(b.geo, { groups, radius: R * 1.5 });
    };
    out.push({ spin: mk(w.spin), caliper: mk(w.caliper) });
  }
  r._wm[spec.id] = out;
  return out;
}
