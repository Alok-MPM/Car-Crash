// TREE FIELD: every tree of the city, drawn in two ways and never built at run time.
//  - FAR  (beyond ~38 m): a flat painted picture of the species (impostor atlas) on two crossed quads. All pictures of a 192 m cell are ONE static mesh = one draw call, no physics.
//  - NEAR (inside ~38 m): the real 3D tree = a prototype mesh that was compiled once at start (3 seeded variants per species), placed with just a matrix. At most CAP trees at a time.
//  The picture of a near tree is not drawn: the billboard shader discards every quad whose tree anchor is inside the near radius (uNear2), so the swap is instant and needs no list rebuild.
//  - PHYSICS: a tree has no body until a car / person / heavy debris can reach it (10 m). Then ONE hard static trunk body is added (octagon of two boxes, 3.2 m tall); it is removed again beyond ~13 m.
//  - LEAVES: ambient leaves drift down from near trees; a car hitting a trunk shakes the crown loose (leaf shower + bark chips + thud).
import { Body, GROUP } from '../../core/physics.js';
import { m4 } from '../../core/math.js';
import { Builder } from '../cars/carmodel.js';
import { addTree, ellipsoid, makeFoliageTex, makeImpostors } from './trees.js';

export const NEAR = 38, CAP = 26, CAST = 14;
const BG = 192, FAR = 560, BK = 48, TB = 24, PON = 10, POFF = 13.5;
const PETAL = { gulmohar: [0.78, 0.09, 0.03] };
const LEAFERS = { neem: 1, mango: 1, banyan: 1, gulmohar: 1, babool: 0.5 };   // (a coconut palm sheds no little leaves: only nuts fall from it)
// fruit that can be shaken loose. A ripe coconut with its husk weighs about 2 kg: from a palm crown it arrives at 12+ m/s (150+ J) and dents sheet metal.
const FRUIT = {
  coconut: { mass: 2.0, he: [0.1, 0.14, 0.1], box: [0.095, 0.13, 0.095], col: [[0.14, 0.22, 0.05], [0.26, 0.17, 0.075]], tri: 0.07 },
  mango: { mass: 0.4, he: [0.055, 0.085, 0.055], box: [0.05, 0.075, 0.05], col: [[0.24, 0.36, 0.06], [0.55, 0.42, 0.07]], tri: 0 },
};
const FRUIT_OF = { palm: 'coconut', mango: 'mango' };
const MAXNUT = 30;

export class TreeField {
  // W: { trunk, leaf } part ids; leafMat / trunkMat: the shared material objects of the land mesh
  constructor({ r, plan, TREES, TREE_SETS, W, leafMat, trunkMat, nutMat }) {
    this.r = r; this.W = W; this.world = null; this.fx = null; this.sfx = null;
    const t0 = performance.now();
    leafMat.tex = makeFoliageTex(r);
    const t1 = performance.now();
    const imp = makeImpostors(r, TREES);
    const t2 = performance.now();
    this.impMat = { kind: 11, base: [0.52, 0.52, 0.52], rough: 0.9, doubleSided: true, cut: true, tex: imp.tex, near2: 0 };
    // ---- prototypes: built once, here, for the species that are actually planted
    const used = new Set();
    for (const k of Object.keys(TREE_SETS)) for (const n of TREE_SETS[k]) used.add(n);
    this.protos = {};
    for (const name of used) {
      const sp = TREES[name], hN = (sp.h[0] + sp.h[1]) / 2, cN = (sp.crown[0] + sp.crown[1]) / 2, list = [], fruit = [];
      for (let v = 0; v < 3; v++) {
        const la = v === 0 ? sp.leaf[0] : v === 1 ? sp.leaf[1] : [(sp.leaf[0][0] + sp.leaf[1][0]) / 2, (sp.leaf[0][1] + sp.leaf[1][1]) / 2, (sp.leaf[0][2] + sp.leaf[1][2]) / 2];
        const b = new Builder([0, 0, 0]);
        const fp = addTree(b, W, name, sp, { x: 0, z: 0, s: 0.137 + 0.29 * v, s2: 0.5 + 0.11 * v, s3: 0.31 + 0.23 * v }, hN, cN, [la[0] / 0.14, la[1] / 0.28, la[2] / 0.09]);
        const f = b.finish(); f.groups.forEach((g) => { g.mat = g.part === W.trunk ? trunkMat : W.nuts.includes(g.part) ? nutMat : leafMat; });
        list.push(r.createMesh(f.geo, { groups: f.groups, radius: hN * 1.2 + cN }));
        fruit.push(fp);
      }
      this.protos[name] = { hN, cN, list, fruit };
    }
    // the shapes of loose fruit (one mesh per fruit kind and skin colour), drawn for every fallen piece
    this.nutMesh = {};
    for (const k of Object.keys(FRUIT)) this.nutMesh[k] = FRUIT[k].col.map((col) => { const b = new Builder([0, 0, 0]); ellipsoid(b, W.nuts[0], 0, 0, 0, FRUIT[k].he[0], FRUIT[k].he[1], [0, 1, 0], col, FRUIT[k].tri); const f = b.finish(); f.groups.forEach((g) => { g.mat = nutMat; }); return r.createMesh(f.geo, { groups: f.groups, radius: 0.4 }); });
    this.nuts = []; this.pend = [];
    const t3 = performance.now();
    // ---- every tree of the plan
    this.trees = []; this.bk = new Map(); this.tb = new Map();
    const cells = new Map();
    for (const t of plan.trees) {
      const set = TREE_SETS[t.set], name = set[Math.floor(t.s * 97) % set.length], sp = TREES[name], P = this.protos[name];
      const h = sp.h[0] + t.s2 * (sp.h[1] - sp.h[0]), cr = sp.crown[0] + t.s3 * (sp.crown[1] - sp.crown[0]), s = Math.sqrt((h / P.hN) * (cr / P.cN));
      const fk = FRUIT_OF[name] && P.fruit[0], tr = { x: t.x, z: t.z, set: t.set, name, sp, P, s, left: fk ? fk.map((_, g) => g) : null, hide: null, h, cr, v: Math.floor(t.s * 1000) % 3, yaw: (t.s2 * 6.2832 + t.s3 * 3.1) % 6.2832, trunkR: name === 'shrub' ? 0 : sp.trunk * s * 0.95, body: null, idle: 0, want: 0, m: null, d2: 0, hitT: -9 };
      this.trees.push(tr);
      const key = (t.x / BK | 0) + ':' + (t.z / BK | 0), key2 = (Math.floor(t.x / BG)) + ':' + (Math.floor(t.z / BG));
      const kb = Math.floor(t.x / BK) + ':' + Math.floor(t.z / BK);
      void key;
      (this.bk.get(kb) || this.bk.set(kb, []).get(kb)).push(tr);
      if (tr.trunkR > 0.05) { const kt = Math.floor(t.x / TB) + ':' + Math.floor(t.z / TB); (this.tb.get(kt) || this.tb.set(kt, []).get(kt)).push(tr); }
      let c = cells.get(key2);
      if (!c) { c = { cx: (Math.floor(t.x / BG) + 0.5) * BG, cz: (Math.floor(t.z / BG) + 0.5) * BG, items: [] }; cells.set(key2, c); }
      c.items.push(tr);
    }
    // ---- one static picture mesh per 192 m cell: two crossed quads per tree, the tree's anchor (cell-local x, z) rides in the vertex colour so the shader can hide it when the 3D tree is drawn
    this.cells = [];
    for (const c of cells.values()) {
      const b = new Builder([-c.cx, 0, -c.cz]);
      for (const tr of c.items) {
        const I = imp.info[tr.name], [cu, cv] = I.cell, Wd = I.W * tr.s, Ht = I.H * tr.s, ax = tr.x - c.cx, az = tr.z - c.cz;
        const u0 = cu * 0.25 + 0.004, u1 = cu * 0.25 + 0.246, v0 = cv * 0.5 + 0.006, v1 = cv * 0.5 + 0.494;
        for (let k = 0; k < 2; k++) {
          const a = tr.yaw + k * 1.5708, cs = Math.cos(a), sn = Math.sin(a), base = b.nv, ny = 0.9;
          for (const [sx, y, u, v] of [[-1, -0.016 * Ht, u0, v1], [1, -0.016 * Ht, u1, v1], [1, Ht, u1, v0], [-1, Ht, u0, v0]]) {
            b.vert(tr.x + cs * sx * Wd / 2, y, tr.z + sn * sx * Wd / 2, -sn * 0.25, ny, cs * 0.25, u, v, ax, az, 1);
          }
          b.grp(W.leaf, 'paint').idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
      const f = b.finish(); f.groups.forEach((g) => { g.mat = this.impMat; });
      c.mesh = r.createMesh(f.geo, { groups: f.groups, radius: BG });
      c.model = m4.fromTRS(new Float32Array(16), [c.cx, 0, c.cz], [0, 0, 0, 1], 1);
      this.cells.push(c);
    }
    this.buildMs = Math.round(performance.now() - t0); this.buildT = { atlas: Math.round(t1 - t0), imp: Math.round(t2 - t1), proto: Math.round(t3 - t2), rest: Math.round(performance.now() - t3) };
    this.cand = []; this.near = []; this.active = []; this.stamp = 0; this.leafT = 0; this.t = 0; this.camX = 0; this.camZ = 0;
  }
  attach(world, fx, sfx) { this.world = world; this.fx = fx; this.sfx = sfx; }

  // ---------------------------------------------------------------- drawing
  draw(cam) {
    const r = this.r, cx = cam[0], cz = cam[2];
    this.camX = cx; this.camZ = cz;
    const cand = this.cand; cand.length = 0;
    const x0 = Math.floor((cx - NEAR) / BK), x1 = Math.floor((cx + NEAR) / BK), z0 = Math.floor((cz - NEAR) / BK), z1 = Math.floor((cz + NEAR) / BK);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const l = this.bk.get(i + ':' + j); if (!l) continue;
      for (const tr of l) { const dx = tr.x - cx, dz = tr.z - cz, d2 = dx * dx + dz * dz; if (d2 < NEAR * NEAR) { tr.d2 = d2; cand.push(tr); } }
    }
    cand.sort((a, b) => a.d2 - b.d2);
    let R = NEAR;
    if (cand.length > CAP) R = Math.sqrt(cand[CAP].d2);                 // more trees than the budget: only the nearest CAP are 3D, pictures take over beyond the CAP-th
    const n = Math.min(cand.length, CAP);
    this.near.length = 0;
    this.impMat.near2 = (R - 1.5) * (R - 1.5);                        // pictures are hidden inside this radius; the 3D tree overlaps it by 1.5 m, so there is never a gap
    for (let i = 0; i < n; i++) {
      const tr = cand[i];
      if (!tr.m) { tr.m = new Float32Array(16); const hy = tr.yaw / 2; m4.fromTRS(tr.m, [tr.x, 0, tr.z], [0, Math.sin(hy), 0, Math.cos(hy)], tr.s); }
      r.add(tr.P.list[tr.v], tr.m, { cast: i < CAST, hide: tr.hide || undefined });
      this.near.push(tr);
    }
    for (const n of this.nuts) {
      const b = n.body, dx = b.pos[0] - cx, dz = b.pos[2] - cz;
      if (dx * dx + dz * dz > 150 * 150) continue;
      m4.fromTRS(n.m, b.pos, b.q, 1);
      r.add(this.nutMesh[n.kind][n.skin], n.m, { cast: dx * dx + dz * dz < 25 * 25 });
    }
    for (const c of this.cells) {
      if (Math.abs(c.cx - cx) > FAR + BG || Math.abs(c.cz - cz) > FAR + BG) continue;
      r.add(c.mesh, c.model, { cast: false });
    }
  }

  // ---------------------------------------------------------------- physics bubble: one trunk body per tree, only while something can reach it
  watch(pts) {
    if (!this.world) return;
    const st = ++this.stamp, add = [];
    for (const q of pts) {
      const lim = q.r + PON, minx = Math.min(q.x, q.x2) - lim, maxx = Math.max(q.x, q.x2) + lim, minz = Math.min(q.z, q.z2) - lim, maxz = Math.max(q.z, q.z2) + lim;
      const dx = q.x2 - q.x, dz = q.z2 - q.z, l2 = dx * dx + dz * dz;
      for (let i = Math.floor(minx / TB), i1 = Math.floor(maxx / TB); i <= i1; i++) for (let j = Math.floor(minz / TB), j1 = Math.floor(maxz / TB); j <= j1; j++) {
        const l = this.tb.get(i + ':' + j); if (!l) continue;
        for (const tr of l) {
          let t = l2 > 1e-6 ? ((tr.x - q.x) * dx + (tr.z - q.z) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const ex = tr.x - (q.x + dx * t), ez = tr.z - (q.z + dz * t), L = lim + tr.trunkR;
          if (ex * ex + ez * ez < L * L) {
            tr.want = st; tr.idle = 0;
            if (!tr.body) { this._makeBody(tr); this.active.push(tr); add.push(tr.body); }
          }
        }
      }
    }
    if (add.length) this.world.addMany(add);
    if (this.active.length) {
      const rem = [], keep = [];
      for (const tr of this.active) {
        if (tr.want !== st && ++tr.idle > 18) { rem.push(tr.body); tr.body = null; tr.idle = 0; } else keep.push(tr);
      }
      if (rem.length) { this.world.removeMany(rem); this.active = keep; }
    }
  }
  _makeBody(tr) {
    const hr = Math.max(0.08, tr.trunkR), b = new Body({ fixed: true, pos: [tr.x, 1.6, tr.z], q: [0, 0, 0, 1], fric: 0.6, group: GROUP.STATIC });
    b.addBox([hr, 1.6, hr]); b.addBox([hr, 1.6, hr], [0, 0, 0], [0, 0.38268343, 0, 0.92387953]);   // two boxes at 45 degrees = an octagon
    b.report = true; b.tree = tr; tr.body = b;
  }

  // ---------------------------------------------------------------- leaves
  _leafCol(tr, petal) {
    const la = tr.sp.leaf[(Math.random() * 2) | 0], k = 1.3 + Math.random() * 1.1;
    if (petal && Math.random() < 0.5) { const c = PETAL.gulmohar, e = 0.8 + Math.random() * 0.5; return [c[0] * e, c[1] * e, c[2] * e]; }
    if (Math.random() < 0.12) return [0.42 + Math.random() * 0.12, 0.34 + Math.random() * 0.08, 0.06];   // a yellowing leaf
    return [la[0] * k, la[1] * k, la[2] * k];
  }
  _spawn(tr, x, y, z, vx, vy, vz) { this.fx.leaf([x, y, z], [vx, vy, vz], this._leafCol(tr, tr.name === 'gulmohar')); }
  update(dt) {
    if (!this.fx) return;
    this.t += dt;
    this._nuts(dt);
    this.leafT -= dt;
    if (this.leafT > 0 || !this.near.length) return;
    this.leafT = 0.11 + Math.random() * 0.16;
    const tr = this.near[(Math.random() * Math.min(this.near.length, 10)) | 0];   // the nearest trees shed, so what the camera sees is what falls
    if (!tr || !LEAFERS[tr.name] || Math.random() > LEAFERS[tr.name] || tr.d2 > 22 * 22 || this.fx.ps.length > 2000) return;
    const a = Math.random() * 6.2832, rr = Math.sqrt(Math.random()) * tr.cr * 0.85, y = tr.h * (0.5 + Math.random() * 0.4);
    this._spawn(tr, tr.x + Math.cos(a) * rr, y, tr.z + Math.sin(a) * rr, 0.35 + (Math.random() - 0.5) * 0.4, -0.2, 0.15 + (Math.random() - 0.5) * 0.4);
  }
  // ---------------------------------------------------------------- fruit: shaken loose, falling, landing
  _nuts(dt) {
    for (let i = this.pend.length - 1; i >= 0; i--) { const q = this.pend[i]; q.t -= dt; if (q.t <= 0) { this._makeNut(q); this.pend.splice(i, 1); } }
    for (let i = this.nuts.length - 1; i >= 0; i--) {
      const n = this.nuts[i], b = n.body, dx = b.pos[0] - this.camX, dz = b.pos[2] - this.camZ;
      n.age += dt;
      if (n.age > 150 || b.pos[1] < -20 || dx * dx + dz * dz > 220 * 220) { this.world.remove(b); this.nuts.splice(i, 1); }
    }
    while (this.nuts.length > MAXNUT) this.world.remove(this.nuts.shift().body);
  }
  _makeNut(q) {
    const F = FRUIT[q.kind], b = new Body({ mass: F.mass, pos: q.pos, fric: 0.7, rest: 0.3, linDamp: 0.01, angDamp: 0.3, group: GROUP.PROP });
    b.addBox(F.box.map((v) => v * q.sc));
    b.v = q.v; b.w = [(Math.random() - 0.5) * 4, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 4];
    b.report = true; b.nut = q.kind; b.dent = true;
    this.world.add(b);
    this.nuts.push({ body: b, kind: q.kind, skin: Math.random() < 0.55 ? 0 : 1, m: new Float32Array(16), age: 0 });
  }
  // the trunk was hit at `speed` (m/s). Up to ~15 km/h: nothing; 15 - 30 km/h: sometimes one nut; 30 - 50 km/h: one or two; 50 - 72 km/h: most of the bunches; faster: every nut comes down.
  _shake(tr, p, speed) {
    const kind = FRUIT_OF[tr.name], left = tr.left;
    if (!kind || !left || !left.length) return;
    const groups = tr.P.fruit[tr.v];
    let take = [];
    if (speed >= 20) take = left.slice();
    else if (speed >= 14) take = left.slice(0, Math.max(1, Math.ceil(left.length * 0.6)));
    else {
      const want = speed >= 8 ? 1 + (Math.random() < 0.5 ? 1 : 0) : speed >= 4 && Math.random() < (speed - 4) / 4 ? 1 : 0;
      let got = 0; for (const g of left) { if (got >= want) break; take.push(g); got += groups[g].length; }
    }
    if (!take.length) return;
    const cs = Math.cos(tr.yaw), sn = Math.sin(tr.yaw), ax = tr.x - p[0], az = tr.z - p[2], al = Math.hypot(ax, az) || 1, push = Math.min(2.5, 0.12 * speed);
    let k = 0;
    for (const g of take) {
      tr.left.splice(tr.left.indexOf(g), 1);
      (tr.hide || (tr.hide = {}))[this.W.nuts[g]] = true;
      for (const l of groups[g]) {
        const x = (l[0] * cs + l[2] * sn) * tr.s + tr.x, z = (-l[0] * sn + l[2] * cs) * tr.s + tr.z;
        this.pend.push({ t: 0.04 + Math.random() * 0.3 + k++ * 0.05, kind, sc: tr.s, pos: [x, l[1] * tr.s, z], v: [ax / al * push * 0.4 + (Math.random() - 0.5) * 1.6, -0.2, az / al * push * 0.4 + (Math.random() - 0.5) * 1.6] });
      }
    }
  }
  // a fallen piece of fruit touched something. Cars take the dent through Car.impact; here: the ground. A 2 kg coconut from palm height leaves a crater in soft soil.
  nutHit(b, e, other) {
    if (other !== this.world.ground || e.speed < 3 || this.t - (b.dentT || -9) < 0.2) return;
    b.dentT = this.t;
    const F = FRUIT[b.nut], k = Math.min(1, e.speed * Math.sqrt(F.mass) / 18), x = e.p[0], z = e.p[2], so = this.world.soil;
    if (so && so.soft(x, z)) {
      so.dent(x, z, 0.08 + 0.08 * k, 0.012 + 0.06 * k);
      for (let i = 0, n = 3 + ((k * 6) | 0); i < n; i++) { const c = 0.5 + Math.random() * 0.7; this.fx.clod([x, 0.04, z], [(Math.random() - 0.5) * 2.4, 0.8 + Math.random() * 2.6 * k, (Math.random() - 0.5) * 2.4], [0.16 * c, 0.09 * c, 0.045 * c]); }
      this.fx.smoke([x, 0.08, z], [(Math.random() - 0.5) * 0.5, 0.5, (Math.random() - 0.5) * 0.5], 0.3 + 0.3 * k, 1.1, [0.5, 0.4, 0.3], 0.08);
    }
    if (this.sfx && this.sfx.thud) this.sfx.thud(e.p, Math.min(1, 0.25 + k * 0.6));
  }
  // a car (or anything heavy) hit the trunk: the crown shakes, leaves rain down, bark flies, the trunk thuds
  hit(tr, p, speed) {
    if (!this.fx || this.t - tr.hitT < 0.45) return;
    tr.hitT = this.t; this.hits = (this.hits || 0) + 1;
    this._shake(tr, p, speed);
    const n = tr.name === 'palm' ? 0 : Math.min(45, Math.round(22 + speed * 2.4)), fx = this.fx;   // a palm has no small leaves to shed: its nuts fall instead
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2832, rr = Math.sqrt(Math.random()) * tr.cr * 0.9, y = tr.h * (0.42 + Math.random() * 0.5);
      this._spawn(tr, tr.x + Math.cos(a) * rr, y, tr.z + Math.sin(a) * rr, (Math.random() - 0.5) * 1.6, -0.3 - Math.random() * 0.8, (Math.random() - 0.5) * 1.6);
    }
    const bark = '#6a4a30';
    for (let i = 0; i < 7; i++) fx.chip([p[0], Math.max(0.15, p[1]), p[2]], [(Math.random() - 0.5) * 4, 1 + Math.random() * 3, (Math.random() - 0.5) * 4], bark);
    if (this.sfx && this.sfx.thud) this.sfx.thud(p, Math.min(1, speed / 14));
  }
}
