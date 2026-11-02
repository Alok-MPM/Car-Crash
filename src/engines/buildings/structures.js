// Runtime for engineered buildings: turns Building Engineer output into physics panels, one merged mesh per building,
// layered fracture (paint -> plaster -> brick / concrete -> rebar), load-path collapse, gas-only fires and LOD'd interiors.
import { Body, GROUP } from '../../core/physics.js';
import { m4, clamp } from '../../core/math.js';
import { MATERIALS, UNITS } from '../../data/materials.js';
import { design, capacity } from './engineer.js';
import { layout } from './layout.js';
import { GeoBuf, makeAtlas, T, hexRGB } from './render.js';
import { RECIPES } from '../../data/recipes.js';

const PLASTER_T = 0.012;

const TILE_OF = { clay: T.clay, block: T.block, rcc: T.rcc, glass: T.glass, wood: T.wood };
const WHITE = [1, 1, 1];

export class Structures {
  constructor(ctx) {
    this.ctx = ctx;
    this.r = ctx.r; this.world = ctx.world;
    this.list = [];
    this.atlas = null;
    this.mat0 = null;
    this.freeMeshes = new Map();
    this.rubbleMeshes = new Map();
    this.shatterQ = [];
    this.rubble = [];
    this.fires = [];
    this.soundT = 0;
  }

  material() {
    if (!this.mat0) { this.atlas = makeAtlas(this.r); this.mat0 = { kind: 6, base: [0.66, 0.66, 0.66], rough: 0.88, metal: 0, tex: this.atlas, emis: [0, 0, 0] }; }
    return this.mat0;
  }

  // ---------- construction ----------
  addBuilding(o) {
    const spec = { ...(RECIPES[o.recipe] || {}), ...o };
    const plan = design(spec);
    const seed = o.seed ?? (((o.x * 73856093) ^ (o.z * 19349663)) >>> 0);
    const lay = layout(plan, { seed });
    const B = {
      x: o.x, z: o.z, w: plan.w, d: plan.d, floors: plan.floors, plan, lay, sys: plan.system, panels: [], free: new Set(), dirty: true, mesh: null, intMesh: null, intDirty: true,
      rebuildT: 0, freed: 0, collapseDust: 0, hazards: lay.hazards.map((h) => ({ x: o.x + h.x, y: h.y, z: o.z + h.z, done: false })),
      model: m4.fromTRS(new Float32Array(16), [o.x, 0, o.z], [0, 0, 0, 1], 1),
      paintOut: hexRGB(lay.paint.out), paintIn: hexRGB(lay.paint.in), trim: hexRGB(lay.paint.trim),
    };
    B.radius = Math.hypot(plan.w, plan.d, plan.floors * plan.storeyH) / 2 + 3;
    B.cy = (plan.floors * plan.storeyH) / 2;
    const byId = new Map();
    for (const e of lay.el) byId.set(e.id, this.newPanel(B, e, plan));
    // links stored as panel refs
    for (const e of lay.el) {
      const P = byId.get(e.id);
      if (e.lat) P.lat = e.lat.map((i) => byId.get(i));
    }
    this.finishBuilding(B);
    return B;
  }

  elemInfo(e, plan) {
    const V = 8 * e.hx * e.hy * e.hz;
    const face = 4 * e.hy * Math.max(e.hx, e.hz);
    const plasterFaces = e.kind === 'wall' || e.kind === 'lintel' ? (e.out ? 2 : (e.interior ? 2 : 2)) : e.kind === 'col' ? 4 : e.kind === 'slab' ? 1 : 0;
    const plasterArea = e.kind === 'col' ? 4 * 2 * e.hy * 2 * e.hx : (e.kind === 'slab' ? 4 * e.hx * e.hz : face * plasterFaces / 1);
    let M = 0, cap = 0, key = e.mat;
    if (e.mat === 'glass') { M = MATERIALS.glass.area * face; cap = 0.7e3 * face; }
    else if (e.mat === 'wood') { M = MATERIALS.wood.dens * V; cap = capacity(plan, 'wood', V); }
    else if (e.mat === 'rcc') { M = MATERIALS.rcc.dens * V; cap = capacity(plan, e.kind === 'slab' ? 'slab' : 'rcc', V); }
    else { // masonry: dens includes joints
      const m = MATERIALS[plan.fill];
      M = m.dens * V; cap = capacity(plan, 'clay', V);
    }
    const plaster = (e.mat === 'glass' || e.mat === 'wood') ? 0 : MATERIALS.plaster.dens * PLASTER_T * plasterArea;
    M += plaster;
    return { mass: M, cap, plasterMass: plaster };
  }

  newPanel(B, e, plan) {
    const info = this.elemInfo(e, plan);
    const P = {
      B, e, kind: e.kind, mat: e.mat, f: e.f, cx: e.cx, cy: e.cy, cz: e.cz, hx: e.hx, hy: e.hy, hz: e.hz, str: !!e.str, out: e.out, interior: !!e.interior,
      hp: info.cap, maxHp: info.cap, mass: info.mass, plasterMass: info.plasterMass, state: 'fixed', below: [], above: [], lat: [], nL: [], nR: [],
      y0: e.cy - e.hy, y1: e.cy + e.hy, body: null, lastO: 0, lastT: -1, releaseAt: 0, cant: e.cant != null, run: e.run, s0: e.s0, s1: e.s1,
    };
    const b = new Body({ fixed: true, pos: [B.x + e.cx, e.cy, B.z + e.cz], group: GROUP.STATIC, fric: 0.65, rest: 0.05 });
    b.addBox([e.hx, e.hy, e.hz]);
    b.brk = P; b.panel = P;
    this.world.add(b);
    P.body = b;
    B.panels.push(P);
    return P;
  }

  finishBuilding(B) {
    const P = B.panels;
    for (let i = 0; i < P.length; i++) for (let j = 0; j < P.length; j++) {
      if (i === j) continue;
      const A = P[i], C = P[j];
      if (Math.abs(A.y0 - C.y1) < 0.06 && Math.abs(A.cx - C.cx) < A.hx + C.hx - 0.02 && Math.abs(A.cz - C.cz) < A.hz + C.hz - 0.02) { A.below.push(C); C.above.push(A); }
    }
    // lateral neighbours along a wall run (for lintels bridging openings)
    const byRun = new Map();
    for (const p of P) if (p.run != null) { if (!byRun.has(p.run)) byRun.set(p.run, []); byRun.get(p.run).push(p); }
    for (const list of byRun.values()) for (const a of list) for (const b of list) {
      if (a === b) continue;
      const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ov < 0.05) continue;
      if (Math.abs(a.s1 - b.s0) < 0.06) { a.nR.push(b); b.nL.push(a); }
    }
    this.list.push(B);
    this.rebuild(B);
  }

  // ---------- surface description of a panel ----------
  faceCfg(P) {
    const B = P.B, cracked = P.hp < P.maxHp * 0.55;
    const core = TILE_OF[P.mat] ?? T.rcc;
    const pl = cracked ? T.crack : T.plaster;
    const pOut = B.paintOut, pIn = B.paintIn;
    if (P.kind === 'wall' || P.kind === 'lintel') {
      const nAxisX = P.hx < P.hz; // wall normal along x -> faces 0,1
      const fo = nAxisX ? (P.out && P.out[0] > 0 ? 0 : 1) : (P.out && P.out[1] > 0 ? 4 : 5);
      const fa = nAxisX ? [0, 1] : [4, 5];
      const isCore = P.e.core;
      return (fi) => {
        if (!fa.includes(fi)) return [core, 1, 1, 1];
        if (isCore) return [T.rcc, 1, 1, 1];
        if (P.e.parapet || P.e.railing) return [pl, pOut[0], pOut[1], pOut[2]];
        if (!P.out) return [pl, pIn[0], pIn[1], pIn[2]];
        return fi === fo ? [pl, pOut[0], pOut[1], pOut[2]] : [pl, pIn[0], pIn[1], pIn[2]];
      };
    }
    if (P.kind === 'col') return (fi) => (fi === 2 || fi === 3 ? [T.rcc, 1, 1, 1] : [pl, pOut[0], pOut[1], pOut[2]]);
    if (P.kind === 'slab') {
      const roof = P.e.roof;
      return (fi) => (fi === 2 ? (roof ? [T.roof, 1, 1, 1] : [T.floor, 1, 1, 1]) : fi === 3 ? [pl, pIn[0], pIn[1], pIn[2]] : [T.rcc, 1, 1, 1]);
    }
    if (P.kind === 'pane') { const fa = P.hx < P.hz ? [0, 1] : [4, 5]; return (fi) => (fa.includes(fi) ? [T.glass, 1, 1, 1] : [T.metal, 0.3, 0.3, 0.33]); }
    if (P.kind === 'door') return (fi) => [T.wood, B.trim[0] * 2.2 + 0.25, B.trim[1] * 2.2 + 0.2, B.trim[2] * 2.2 + 0.15];
    return () => [T.rcc, 1, 1, 1];
  }

  // ---------- mesh ----------
  rebuild(B) {
    const g = new GeoBuf();
    const off = [B.x, 0, B.z];
    for (const P of B.panels) if (P.state === 'fixed') g.box(P.cx, P.cy, P.cz, P.hx, P.hy, P.hz, this.faceCfg(P), off, 0.96 + 0.04 * ((P.e.id * 0.618) % 1), true);
    const old = B.mesh;
    B.mesh = g.n ? this.r.createMesh(g.finish(), { mat: this.material(), radius: B.radius }) : null;
    if (old) this.r.deleteMesh(old);
    B.dirty = false;
  }

  rebuildInterior(B) {
    const g = new GeoBuf();
    const off = [B.x, 0, B.z];
    const slabOK = new Map();
    for (const P of B.panels) if (P.kind === 'slab') slabOK.set(P.e.id, P.state === 'fixed');
    for (const R of B.lay.rooms) {
      if (R.f === 0) g.box((R.x0 + R.x1) / 2, 0.015, (R.z0 + R.z1) / 2, (R.x1 - R.x0) / 2, 0.015, (R.z1 - R.z0) / 2, (fi) => (fi === 2 ? [T.floor, 1, 1, 1] : null), off, 1, false);
    }
    for (const it of B.lay.furn) {
      if (it.slab >= 0 && !slabOK.get(it.slab)) continue;
      const c = hexRGB(it.color);
      const tile = it.tile === 'wood' ? T.wood : it.tile === 'fabric' ? T.fabric : it.tile === 'metal' ? T.metal : T.white;
      g.box(it.x, it.y, it.z, it.hx, it.hy, it.hz, () => [tile, c[0], c[1], c[2]], off, 1, false);
    }
    const old = B.intMesh;
    B.intMesh = g.n ? this.r.createMesh(g.finish(), { mat: this.material(), radius: B.radius }) : null;
    if (old) this.r.deleteMesh(old);
    B.intDirty = false;
  }

  freeMesh(P) {
    const cracked = P.hp < P.maxHp * 0.55;
    const key = [P.B.lay.paint.out, P.kind, P.mat, P.hx.toFixed(2), P.hy.toFixed(2), P.hz.toFixed(2), P.out ? P.out.join('') : '', cracked, P.e.roof ? 1 : 0, P.e.parapet ? 1 : 0].join('|');
    let m = this.freeMeshes.get(key);
    if (!m) {
      const g = new GeoBuf();
      g.box(0, 0, 0, P.hx, P.hy, P.hz, this.faceCfg(P), [0, 0, 0], 1, false);
      m = this.r.createMesh(g.finish(), { mat: this.material(), radius: Math.max(P.hx, P.hy, P.hz) * 2 });
      this.freeMeshes.set(key, m);
    }
    return m;
  }

  // ---------- fracture ----------
  rubbleMesh(tile, tint, dims) {
    const q = (v) => Math.max(0.02, Math.round(v * 20) / 20);
    const d = dims.map(q);
    const key = [tile, tint.map((x) => x.toFixed(2)).join(','), d.join('x')].join('|');
    let m = this.rubbleMeshes.get(key);
    if (!m) {
      const g = new GeoBuf();
      g.box(0, 0, 0, d[0] / 2, d[1] / 2, d[2] / 2, () => [tile, tint[0], tint[1], tint[2]], [Math.random() * 3, Math.random() * 3, Math.random() * 3], 1, false);
      m = this.r.createMesh(g.finish(), { mat: this.material(), radius: Math.max(d[0], d[1], d[2]) });
      this.rubbleMeshes.set(key, m);
      if (this.rubbleMeshes.size > 400) { const k = this.rubbleMeshes.keys().next().value; this.r.deleteMesh(this.rubbleMeshes.get(k)); this.rubbleMeshes.delete(k); }
    }
    return m;
  }

  fxAt(P, p, E, dir) {
    const fx = this.ctx.fx;
    if (!fx) return;
    const rub = P.mat === 'glass' ? MATERIALS.glass.rub : P.mat === 'wood' ? MATERIALS.wood.rub : (MATERIALS[P.mat === 'clay' ? 'clayMasonry' : P.mat === 'block' ? 'blockMasonry' : 'rcc'] || MATERIALS.rcc).rub;
    const n = clamp((E / 30e3) | 0, 1, 14);
    for (let i = 0; i < (Math.random() < 0.5 ? 1 : 0); i++) {
      fx.smoke([p[0], p[1], p[2]], [(Math.random() - 0.5) * 3 + dir[0] * 2, Math.random() * 2, (Math.random() - 0.5) * 3 + dir[2] * 2], 0.5 + Math.random() * 1.0, 1.2 + Math.random() * 1.2, [0.5, 0.47, 0.43], 0.05);
    }
    const hex = '#' + rub.map((c) => ((c * 255) | 0).toString(16).padStart(2, '0')).join('');
    for (let i = 0; i < clamp(n * 2, 4, 26); i++) fx.chip(p, [(Math.random() - 0.5) * 9 + dir[0] * 3, 1 + Math.random() * 5, (Math.random() - 0.5) * 9 + dir[2] * 3], hex);
    if (P.mat === 'glass') for (let i = 0; i < clamp(n * 2, 4, 20); i++) fx.glass(p, [(Math.random() - 0.5) * 8, 1 + Math.random() * 4, (Math.random() - 0.5) * 8]);
  }

  // A broken panel turns into what it was really made of: plaster flakes in the paint colour, brick / block clumps,
  // concrete lumps with rebar, planks or glass shards. Total mass is conserved.
  spawnRubble(P, p, totalMass, dir, speed) {
    const B = P.B, world = this.world;
    const L = this.rubble.length;
    const ld = this.ctx.load || 1, lod = (L < 150 ? 1 : L < 300 ? 0.5 : L < 450 ? 0.25 : 0) * (0.5 + 0.5 * ld);
    const pcs = [];
    const frac = totalMass / P.mass;
    const plasterM = P.plasterMass * frac;
    let bodyM = totalMass - plasterM;
    const push = (tile, tint, dims, m, dens) => pcs.push({ tile, tint, dims, m, dens });
    if (plasterM > 1) {
      const n = Math.max(1, Math.round(3 * lod + 0.5));
      for (let i = 0; i < n; i++) push(T.plaster, B.paintOut, [0.3 + Math.random() * 0.25, 0.012 * 3, 0.2 + Math.random() * 0.2], plasterM / n, 1900);
    } else bodyM = totalMass;
    if (P.mat === 'clay' || P.mat === 'block') {
      const u = UNITS[P.mat === 'clay' ? 'clayBrick' : 'concreteBlock'];
      const avg = P.mat === 'clay' ? 38 : 60;
      let n = clamp(Math.round(bodyM / avg), 2, 20);
      n = Math.max(L < 450 ? 2 : 1, Math.round(n * lod));
      const m = bodyM / n;
      for (let i = 0; i < n; i++) {
        const nl = 1 + ((Math.random() * (P.mat === 'clay' ? 3 : 2)) | 0), nw = 1 + ((Math.random() * 2) | 0), nh = 1 + ((Math.random() * 3) | 0);
        let dims = [u.L * nl, u.H * nh, u.W * nw];
        if (Math.random() < 0.5) dims = [dims[2], dims[1], dims[0]];
        const vol = dims[0] * dims[1] * dims[2];
        const s = Math.cbrt(m / (u.dens * vol));
        push(P.mat === 'clay' ? T.clay : T.block, WHITE, dims.map((q) => q * s), m, u.dens);
      }
    } else if (P.mat === 'rcc') {
      const steel = bodyM * 0.02;
      let n = clamp(Math.round(bodyM / 140), 2, 16);
      n = Math.max(L < 450 ? 2 : 1, Math.round(n * lod));
      const m = (bodyM - steel) / n;
      for (let i = 0; i < n; i++) { const s = Math.cbrt(m / MATERIALS.rcc.dens); const k = [0.6 + Math.random() * 1.1, 0.6 + Math.random() * 1.1, 0.6 + Math.random() * 1.1]; const nn = Math.cbrt(1 / (k[0] * k[1] * k[2])); push(T.rcc, WHITE, k.map((q) => q * nn * s), m, MATERIALS.rcc.dens); }
      const nr = Math.max(1, Math.round(2 * lod));
      for (let i = 0; i < nr; i++) push(T.metal, [0.32, 0.33, 0.36], [0.02, 0.02, 0.5 + Math.random() * 0.6], steel / nr, 7850);
    } else if (P.mat === 'wood') {
      const n = Math.max(2, Math.round(3 * lod + 0.5));
      for (let i = 0; i < n; i++) push(T.wood, WHITE, [0.04, 0.12, 0.5 + Math.random() * 0.5], bodyM / n, 650);
    } else {
      const n = Math.max(2, Math.round(5 * lod + 0.5));
      for (let i = 0; i < n; i++) push(T.glass, WHITE, [0.2 + Math.random() * 0.2, 0.012, 0.2 + Math.random() * 0.2], bodyM / n, 2500);
    }
    for (const c of pcs) {
      const body = new Body({ mass: Math.max(0.05, c.m), pos: [p[0] + (Math.random() - 0.5) * 0.8, p[1] + (Math.random() - 0.5) * 0.6, p[2] + (Math.random() - 0.5) * 0.8], q: [0, 0, 0, 1], fric: 0.75, rest: 0.12, group: GROUP.DEBRIS, mask: GROUP.STATIC | GROUP.PROP | GROUP.DEBRIS | GROUP.CAR, angDamp: 0.25 });
      body.addBox([c.dims[0] / 2, c.dims[1] / 2, c.dims[2] / 2]);
      body.v = [dir[0] * speed * 0.4 + (Math.random() - 0.5) * 4, 1 + Math.random() * 3, dir[2] * speed * 0.4 + (Math.random() - 0.5) * 4];
      body.w = [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8];
      world.add(body);
      const d = { body, kind: 'rubble', mesh: this.rubbleMesh(c.tile, c.tint, c.dims), s: 1, t: 0, tile: c.tile, tint: c.tint, dims: c.dims, dens: c.dens, m: c.m, gen: c.gen || 0 };
      body.rub = d;
      this.ctx.debris.push(d);
      this.rubble.push(d);
    }
    while (this.rubble.length > 900 * (this.ctx.load || 1)) { const old = this.rubble.shift(); old.t = 999; }
  }

  releasePanel(P, v, why, frac = 1) {
    if (P.state !== 'fixed') return;
    this.world.release(P.body, Math.max(1, P.mass * frac));
    P.state = 'free';
    P.body.brk = null;
    P.body.report = true;
    P.body.group = GROUP.PROP;
    P.body.rest = 0.1;
    if (v) P.body.v = [v[0], v[1], v[2]];
    P.B.dirty = true; P.B.intDirty = true;
    P.B.free.add(P);
    P.B.freed++;
    P.mesh = this.freeMesh(P);
    P._m = new Float32Array(16);
    P.B.checkStab = true;
    P.B.lastWhy = why;
    if (P.f === 0) this.hazardCheck(P.B, P, why === 'hit' ? 1 : 0.4);
  }

  // a person standing at a closed door can open it (the door leaf is taken out of the wall; no damage, no rubble)
  openDoorNear(p, R) {
    for (const B of this.list) {
      if (Math.hypot(B.x - p[0], B.z - p[2]) > (B.radius || 30) + 4) continue;
      for (const P of B.panels) {
        if (P.kind !== 'door' || P.state !== 'fixed') continue;
        if (Math.hypot(B.x + P.cx - p[0], B.z + P.cz - p[2]) > R) continue;
        if (Math.abs((P.y0 + P.y1) / 2 - p[1]) > 2.2) continue;
        this.world.remove(P.body);
        P.state = 'open';
        B.dirty = true;
        return true;
      }
    }
    return false;
  }

  breakCost(P) { return P.mat === 'glass' ? 400 : P.mat === 'wood' ? 300 : P.kind === 'slab' ? 2500 : P.mat === 'rcc' ? 1800 : 700; }

  hazardCheck(B, P, k) {
    for (const h of B.hazards) {
      if (h.done) continue;
      const d = Math.hypot(B.x + P.cx - h.x, B.z + P.cz - h.z);
      if (d < 1.6 && k >= 1 && Math.random() < 0.3) this.gasBlast(B, h);   // only a direct hard hit on the cylinder itself
    }
  }
  gasBlast(B, h) {
    if (h.done) return;
    h.done = true;
    const pos = [h.x, h.y, h.z];
    if (this.ctx.blast) this.ctx.blast(pos, 10, 7);
    this.fires.push({ p: [h.x, 0.6, h.z], t: 0, life: 40 + Math.random() * 25 });
    for (const Q of B.panels) {
      if (Q.state !== 'fixed') continue;
      const d = Math.hypot(B.x + Q.cx - h.x, Q.cy - h.y, B.z + Q.cz - h.z);
      if (d < 8) { Q.hp -= 160e3 * (1 - d / 8) * (1 - d / 8); if (Q.hp <= 0) this.breakPanel(Q, [(B.x + Q.cx - h.x) / (d + 1) * 6, 3, (B.z + Q.cz - h.z) / (d + 1) * 6], 150e3, [0, 0, 0]); else B.dirty = true; }
    }
  }

  // called from the physics step BEFORE the contact is solved
  preHit(a, b, c) {
    const P = a.brk || b.brk;
    const O = a.brk ? b : a;
    if (!P || P.state !== 'fixed') return;
    if (O.fixed || !O.mass) return;
    const wt = this.world.time;
    if (P.lastO === O.id && wt - P.lastT < 0.05) return;
    P.lastO = O.id; P.lastT = wt;
    const v = -c.vn0;
    const E = 0.5 * O.mass * v * v * (O.group === GROUP.DEBRIS ? 0.5 : 1);
    if (E < 2500) return;
    P.hp -= E;
    const n = c.n, sg = a.brk ? -1 : 1;
    const dir = [n[0] * sg, n[1] * sg, n[2] * sg];
    const cb = this.ctx.onProp;
    if (cb) cb(Math.min(E * 0.004, 4000));
    this.fxAt(P, c.p, E, dir);
    if (this.ctx.sfx && this.soundT <= 0 && E > 20e3) { this.soundT = 0.08; this.ctx.sfx.crash(c.p, clamp(E / 400e3, 0.1, 1), E > 120e3); }
    // shock travels through the mortar bond to neighbouring panels (stronger bond = less spreads)
    const share = P.mat === 'rcc' ? 0.05 : P.mat === 'glass' ? 0.02 : 0.14;
    for (const Q of [...P.nL, ...P.nR]) if (Q.state === 'fixed') { Q.hp -= E * share; if (Q.hp <= 0) this.breakPanel(Q, O.v, E * 0.3, dir); }
    for (const Q of P.above) if (Q.state === 'fixed') Q.hp -= E * 0.03;
    for (const Q of P.below) if (Q.state === 'fixed') Q.hp -= E * 0.03;
    if (P.hp <= 0) this.breakPanel(P, O.v, E, dir);
    else P.B.dirty = true;
    if (cb && P.hp <= 0) cb(this.breakCost(P));
  }

  breakPanel(P, vel, E, dir) {
    if (P.state !== 'fixed') return;
    const k = 0.35;
    // the panel's body keeps part of its mass as one big lump; the rest crumbles into real constituents
    const keep = P.mat === 'glass' ? 0 : 0.35;
    if (keep === 0) {
      this.fxAt(P, [P.body.pos[0], P.body.pos[1], P.body.pos[2]], E, dir);
      this.spawnRubble(P, [P.body.pos[0], P.body.pos[1], P.body.pos[2]], P.mass, dir, Math.hypot(vel[0], vel[2]));
      this.world.remove(P.body);
      P.state = 'gone'; P.B.dirty = true; P.B.intDirty = true; P.B.freed++; P.B.checkStab = true; P.B.lastWhy = 'hit';
      return;
    }
    this.releasePanel(P, [vel[0] * k, vel[1] * k + 0.5, vel[2] * k], 'hit', keep);
    P.body.w = [(Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 3];
    this.spawnRubble(P, [P.body.pos[0], P.body.pos[1], P.body.pos[2]], P.mass * (1 - keep), dir, Math.hypot(vel[0], vel[2]));
  }

  onImpact(e) {
    for (const b of [e.a, e.b]) {
      const R = b.rub;
      // secondary fracture: a hard landing / hit splits a chunk into smaller, irregular pieces (mass conserved)
      if (R && !R.dead && R.gen < 2 && R.m > 4 && e.speed > 5.5 && R.tile !== T.metal && Math.random() < 0.5 + e.speed * 0.02) { R.dead = true; this.shatterQ.push({ R, speed: e.speed, p: e.p }); }
      const P = b.panel;
      if (!P || P.state !== 'free') continue;
      const E = 0.5 * b.mass * e.speed * e.speed;
      if (e.speed > 4.5 && E > P.maxHp * 0.55) {
        const dir = [b.v[0] * 0.1, 0, b.v[2] * 0.1];
        this.fxAt(P, e.p, E * 1.4, dir);
        this.spawnRubble(P, [b.pos[0], b.pos[1], b.pos[2]], b.mass, dir, Math.hypot(b.v[0], b.v[2]));
        if (this.ctx.sfx && this.soundT <= 0) { this.soundT = 0.08; this.ctx.sfx.crash(b.pos, clamp(E / 500e3, 0.15, 1), true); }
        const cb = this.ctx.onProp; if (cb) cb(this.breakCost(P) * 0.5);
        this.world.remove(b);
        P.state = 'gone';
        P.B.free.delete(P);
        P.B.checkStab = true;
      }
    }
  }

  // load path: columns / bearing walls carry slabs, slabs carry what stands on them, lintels need both piers
  checkStability(B) {
    const stable = new Set();
    for (const P of B.panels) if (P.state === 'fixed' && P.y0 < 0.05) stable.add(P);
    const fixed = B.panels.filter((P) => P.state === 'fixed' && P.y0 >= 0.05);
    let changed = true, guard = 0;
    while (changed && guard++ < 50) {
      changed = false;
      for (const P of fixed) {
        if (stable.has(P)) continue;
        let ok = false;
        if (P.kind === 'slab') {
          if (P.cant) ok = P.lat.some((q) => stable.has(q));
          else {
            const sup = P.below.filter((q) => q.str);
            const nS = sup.length;
            const live = sup.filter((q) => stable.has(q));
            const need = nS <= 2 ? nS : Math.ceil(nS * (B.sys === 'loadbearing' ? 0.6 : 0.5));
            const ex = P.hx * 0.4, ez = P.hz * 0.4;
            const spread = live.some((q) => q.cx <= P.cx - ex) && live.some((q) => q.cx >= P.cx + ex) && live.some((q) => q.cz <= P.cz - ez) && live.some((q) => q.cz >= P.cz + ez);
            ok = nS > 0 && live.length >= need && (spread || nS <= 2);
          }
        } else if (P.kind === 'lintel') {
          ok = P.nL.some((q) => stable.has(q)) && P.nR.some((q) => stable.has(q));
        } else if (P.str) {
          ok = P.below.some((q) => stable.has(q));
        } else {
          ok = P.below.some((q) => stable.has(q)) || P.above.some((q) => stable.has(q) && (q.kind === 'slab' || q.kind === 'lintel'));
        }
        if (ok) { stable.add(P); changed = true; }
      }
    }
    let lost = 0;
    const t = this.ctx.time;
    for (const P of fixed) if (!stable.has(P) && !P.releaseAt) { P.releaseAt = t + 0.1 + Math.random() * 0.4 + P.f * 0.05; lost++; }
    if (lost && !B.collapseNoted) { B.collapseNoted = true; if (this.ctx.onCollapse) this.ctx.onCollapse(B); }
    return lost;
  }

  addBarrier(o) {
    // stacked RCC blocks used as the runway end wall
    const B = { x: o.x, z: o.z, w: o.len, d: o.th, floors: 1, sys: 'barrier', plan: { fe: { clay: 3, rcc: 25 } }, lay: { paint: { out: '#b4b2ac' }, rooms: [], furn: [] }, panels: [], free: new Set(), dirty: true, mesh: null, intMesh: null, rebuildT: 0, freed: 0, collapseDust: 0, hazards: [], paintOut: WHITE, paintIn: WHITE, trim: WHITE, model: m4.fromTRS(new Float32Array(16), [o.x, 0, o.z], [0, 0, 0, 1], 1) };
    B.radius = o.len / 2 + 4; B.cy = 3;
    const n = Math.round(o.len / o.seg), pw = o.len / n, ph = o.h / o.rows;
    let id = 0;
    for (let r = 0; r < o.rows; r++) for (let i = 0; i < n; i++) {
      const e = { id: id++, kind: 'wall', mat: 'rcc', str: false, f: r, cx: -o.len / 2 + pw * (i + 0.5), cy: ph * (r + 0.5), cz: 0, hx: pw / 2 - 0.01, hy: ph / 2 - 0.005, hz: o.th / 2, out: [0, 1], core: true, run: 1000, s0: -o.len / 2 + pw * i, s1: -o.len / 2 + pw * (i + 1) };
      this.newPanel(B, e, { fe: { clay: 3, rcc: 25 }, fill: 'clayMasonry' });
    }
    this.finishBuilding(B);
    return B;
  }

  processShatter() {
    let budget = 6;
    while (this.shatterQ.length && budget-- > 0) {
      const { R, speed } = this.shatterQ.shift();
      const ob = R.body;
      if (R.t >= 999) continue;
      const parts = 2 + ((Math.random() * (R.m > 30 ? 3 : 2)) | 0);
      const ld = this.ctx.load || 1;
      const n = Math.max(2, Math.round(parts * (0.5 + 0.5 * ld)));
      // split along the longest axis into unequal slabs, each squashed differently so no two pieces look alike
      let w = Array.from({ length: n }, () => 0.5 + Math.random());
      const sw = w.reduce((a, b) => a + b, 0); w = w.map((x) => x / sw);
      const ax = R.dims[0] >= R.dims[1] && R.dims[0] >= R.dims[2] ? 0 : R.dims[1] >= R.dims[2] ? 1 : 2;
      for (let i = 0; i < n; i++) {
        const m = R.m * w[i];
        const dims = R.dims.slice();
        dims[ax] *= w[i];
        const o = (ax + 1 + ((Math.random() * 2) | 0)) % 3;
        dims[o] *= 0.55 + Math.random() * 0.5;
        const vol = dims[0] * dims[1] * dims[2];
        const k = Math.cbrt(m / (R.dens * vol));          // keep density: volume follows mass
        const dd = dims.map((q) => Math.max(0.02, q * k));
        const body = new Body({ mass: Math.max(0.05, m), pos: [ob.pos[0] + (Math.random() - 0.5) * R.dims[0] * 0.6, ob.pos[1] + (Math.random() - 0.5) * 0.2 + 0.05, ob.pos[2] + (Math.random() - 0.5) * R.dims[2] * 0.6], q: ob.q.slice(), fric: 0.75, rest: 0.12, group: GROUP.DEBRIS, mask: GROUP.STATIC | GROUP.PROP | GROUP.DEBRIS | GROUP.CAR, angDamp: 0.25 });
        body.addBox([dd[0] / 2, dd[1] / 2, dd[2] / 2]);
        body.v = [ob.v[0] * 0.6 + (Math.random() - 0.5) * speed * 0.5, Math.abs(ob.v[1]) * 0.3 + Math.random() * speed * 0.25, ob.v[2] * 0.6 + (Math.random() - 0.5) * speed * 0.5];
        body.w = [(Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9];
        this.world.add(body);
        const d = { body, kind: 'rubble', mesh: this.rubbleMesh(R.tile, R.tint, dd), s: 1, t: 0, tile: R.tile, tint: R.tint, dims: dd, dens: R.dens, m, gen: R.gen + 1 };
        body.rub = d;
        this.ctx.debris.push(d); this.rubble.push(d);
      }
      if (this.ctx.fx) this.ctx.fx.chip(ob.pos, [(Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4], '#c9b79c');
      R.t = 999;
    }
  }

  update(dt) {
    if (this.shatterQ.length) this.processShatter();
    this.soundT -= dt;
    const t = this.ctx.time, fx = this.ctx.fx;
    for (const B of this.list) {
      if (B.checkStab) { B.checkStab = false; this.checkStability(B); }
      for (const P of B.panels) {
        if (P.state === 'fixed' && P.releaseAt && t >= P.releaseAt) {
          P.releaseAt = 0;
          const o = P.out || [0, 0];
          this.releasePanel(P, [o[0] * 0.8 + (Math.random() - 0.5) * 0.6, -0.5, o[1] * 0.8 + (Math.random() - 0.5) * 0.6], 'collapse');
          P.body.w = [(Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.2];
          if (fx && B.collapseDust < 6) {
            B.collapseDust++;
            fx.smoke([B.x + P.cx, Math.max(1, P.cy), B.z + P.cz], [(Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2], 1.2 + Math.random() * 1.2, 2.5 + Math.random() * 2, [0.5, 0.47, 0.43], 0.07);
          }
          B.checkStab = true;
        }
      }
      if (B.dirty) { B.rebuildT -= dt; if (B.rebuildT <= 0) { this.rebuild(B); B.rebuildT = 0.12; } }
    }
    for (let i = this.fires.length - 1; i >= 0; i--) {
      const f = this.fires[i];
      f.t += dt;
      if (f.t > f.life) { this.fires.splice(i, 1); continue; }
      if (fx) {
        const k = 1 - f.t / f.life;
        if (Math.random() < 0.7 * k) fx.fire([f.p[0] + (Math.random() - 0.5) * 2, f.p[1] + Math.random(), f.p[2] + (Math.random() - 0.5) * 2], [(Math.random() - 0.5) * 0.6, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 0.6], 0.8 + Math.random() * 0.9);
        if (Math.random() < 0.12) fx.smoke([f.p[0], f.p[1] + 2, f.p[2]], [(Math.random() - 0.5), 3 + Math.random() * 2, (Math.random() - 0.5)], 1.0 + Math.random(), 3 + Math.random() * 2, [0.08, 0.08, 0.08], 0.25);
      }
    }
  }

  draw(cam) {
    const r = this.r;
    for (const B of this.list) {
      const dx = B.x - cam[0], dz = B.z - cam[2];
      const d = Math.hypot(dx, dz);
      if (d - B.radius > 900) continue;
      if (B.mesh) r.add(B.mesh, B.model, { cast: d - B.radius < 140 });
      // interiors only exist as geometry when somebody can see them
      if (d - B.radius < 70 && B.lay.furn.length) {
        if (B.intDirty || !B.intMesh) this.rebuildInterior(B);
        if (B.intMesh) r.add(B.intMesh, B.model, { cast: false });
      }
      if (d - B.radius > 260) continue;
      for (const P of B.free) {
        const b = P.body;
        m4.fromTRS(P._m, b.pos, b.q, 1);
        r.add(P.mesh, P._m, { cast: d - B.radius < 90 });
      }
    }
  }
}
