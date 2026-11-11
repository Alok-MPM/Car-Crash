// Runtime for engineered buildings: turns Building Engineer output into physics panels, one merged mesh per building,
// layered fracture (paint -> plaster -> brick / concrete -> rebar), load-path collapse, gas-only fires and LOD'd interiors.
const b0x = (P) => (P.body ? P.body.pos[0] : P.B.x + P.cx), b0z = (P) => (P.body ? P.body.pos[2] : P.B.z + P.cz);
import { compileDesign, STYLES } from './compile.js';
import { generate } from './architect.js';
import { Body, GROUP } from '../../core/physics.js';
import { m4, clamp, qRot, qMul, segHitsRect } from '../../core/math.js';
import { MATERIALS, UNITS } from '../../data/materials.js';
import { design, capacity } from './engineer.js';
import { layout, mulberry } from './layout.js';
import { shapeElements } from './shapes.js';
import { validateBuilding } from './validate.js';
import { PAINTS } from '../../data/materials.js';
import { GeoBuf, makeAtlas, T, hexRGB } from './render.js';
import { FaceCuller, alignedBox } from './cull.js';
import { RECIPES } from '../../data/recipes.js';
import { LIFT_STYLES, buildCabinMesh, buildLeafMesh } from './lift.js';
import { DOOR_TYPES, doorType } from './catalog.js';

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
  // runs a step generator to the end (steps let the city streamer spread one building over several frames)
  runSteps(it) { let r; do { r = it.next(); } while (!r.done); return r.value; }
  addBuilding(o) { return this.runSteps(this.buildSteps(o)); }
  // a body of a building: in the physics world right away, or kept out of it when the building is born asleep (lazy physics)
  hold(b, B) { if (B.dormant) { b.finalize(); b._fin = true; b.removed = true; } else this.world.add(b); }
  *buildSteps(o) {
    const spec = { ...(RECIPES[o.recipe] || {}), ...o };
    let C = null;
    const cost = { t0: performance.now() };
    if (spec.brief && !spec.design) spec.design = generate(spec.brief);
    cost.gen = performance.now();
    if (spec.design) {
      C = compileDesign(spec.design);
      spec.shapes = C.shapes; spec.w = C.bounds.x1 - C.bounds.x0; spec.d = C.bounds.z1 - C.bounds.z0; spec.floors = spec.design.floors.length;
      spec.system = (spec.design.mat || (C.style && C.style.mat)) === 'clay' && spec.floors <= 4 ? 'loadbearing' : 'frame';
      if (!spec.paint) spec.paint = (C.style && C.style.out) || undefined;
    }
    cost.comp = performance.now();
    yield 'design';
    const plan = design(spec);
    const seed = o.seed ?? (((o.x * 73856093) ^ (o.z * 19349663)) >>> 0);
    let lay;
    const decos = [];
    if (spec.shapes) {
      // free-form building: elements come from the shape engine (curved walls, domes, spires...), no storey layout
      const rng = mulberry(seed), el = [];
      const tagId = new Map();
      shapeElements(spec.shapes, (e) => { if (e.deco) { decos.push(e); return e; } e.id = el.length; el.push(e); if (e.tag) tagId.set(e.tag, e.id); return e; });
      const pk = (a) => a[(rng() * a.length) | 0];
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9, y1 = 0;
      for (const e of el) { const ax = e.ax ?? e.hx, az = e.az ?? e.hz, ay = e.ay ?? e.hy; x0 = Math.min(x0, e.cx - ax); x1 = Math.max(x1, e.cx + ax); z0 = Math.min(z0, e.cz - az); z1 = Math.max(z1, e.cz + az); y1 = Math.max(y1, e.cy + ay); }
      plan.w = x1 - x0; plan.d = z1 - z0; plan.height = y1; plan.note = 'free-form shapes (' + spec.shapes.length + ' primitives)';
      lay = { el, rooms: [], furn: [], hazards: [], paint: { out: spec.paint || pk(PAINTS.outer), in: pk(PAINTS.inner), trim: pk(PAINTS.trim) }, gx: [], gz: [], wallH: y1 };
      if (C) {
        lay.rooms = C.rooms; lay.hazards = C.hazards; lay.stairs = C.stairs; lay.base = C.base;
        lay.furn = C.furn.map((f) => ({ ...f, slab: f.slab == null || f.slab === -1 ? -1 : (tagId.get(f.slab) ?? -1) }));
        if (C.style) { lay.paint.trim = C.style.trim; lay.paint.in = spec.design.inner || C.style.inner || lay.paint.in; }
      }
    } else lay = layout(plan, { seed });
    const B = {
      x: o.x, z: o.z, w: plan.w, d: plan.d, floors: plan.floors, plan, lay, sys: plan.system, panels: [], free: new Set(), dirty: true, mesh: null, intMesh: null, intDirty: true,
      rebuildT: 0, freed: 0, collapseDust: 0, hazards: lay.hazards.map((h) => ({ x: o.x + h.x, y: h.y, z: o.z + h.z, done: false })),
      model: m4.fromTRS(new Float32Array(16), [o.x, 0, o.z], [0, 0, 0, 1], 1),
      paintOut: hexRGB(lay.paint.out), paintIn: hexRGB(lay.paint.in), trim: hexRGB(lay.paint.trim),
    };
    B.spec = o; B.recipe = o.recipe || 'custom'; B.stairs = lay.stairs || []; B.design = spec.design || null; B.compiled = C; B.compileIssues = C ? C.issues : [];
    B.radius = Math.hypot(plan.w, plan.d, plan.height || plan.floors * plan.storeyH) / 2 + 3;
    B.cy = (plan.height || plan.floors * plan.storeyH) / 2;
    B.indestr = !!spec.indestructible;
    B.dormant = !!this.lazyOn && !B.indestr; B.lazy = B.dormant;     // born asleep: no body of this building touches the physics world until something reaches it
    const byId = new Map();
    cost.lay = performance.now();
    yield 'layout';
    for (const e of lay.el) byId.set(e.id, this.newPanel(B, e, plan));
    cost.panels = performance.now();
    yield 'panels';
    // links stored as panel refs
    for (const e of lay.el) {
      const P = byId.get(e.id);
      if (e.lat) P.lat = e.lat.map((i) => byId.get(i));
    }
    B.decos = decos.map((e) => ({ e, host: e.host != null ? byId.get(e.host) : null }));
    B.cost = cost;
    yield* this.finishSteps(B);
    cost.end = performance.now();
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
      ax: e.ax ?? e.hx, ay: e.ay ?? e.hy, az: e.az ?? e.hz, q: e.q || null, outW: e.outW || null, anchored: !!e.anchored,
      y0: e.cy - (e.ay ?? e.hy), y1: e.cy + (e.ay ?? e.hy), body: null, lastO: 0, lastT: -1, releaseAt: 0, cant: e.cant != null, run: e.run, s0: e.s0, s1: e.s1,
    };
    const b = new Body({ fixed: true, pos: [B.x + e.cx, e.cy, B.z + e.cz], q: e.q ? e.q.slice() : [0, 0, 0, 1], group: e.stair ? GROUP.STAIR : GROUP.STATIC, fric: 0.65, rest: 0.05 });
    if (B.indestr || e.ghost) { P.hp = P.maxHp = 1e15; }
    if (e.ghost) P.anchored = true;
    b.addBox([e.hx, e.hy, e.hz]);
    b.brk = P; b.panel = P;
    this.hold(b, B);
    P.body = b;
    B.panels.push(P);
    return P;
  }


  // ---- lazy physics: an untouched building is only a picture + a few numbers until something is about to reach it ----
  // Everything a building puts into the physics world while awake: wall/slab panels, loose furniture, lift shaft pieces.
  bodiesOf(B, all) {
    const list = [];
    for (const P of B.panels) if (P.body && (all || P.state === 'fixed')) list.push(P.body);
    for (const it of B.lay.furn) if (it.body) list.push(it.body);
    for (const L of B.lifts || []) { for (const b of L.doorBodies) if (b) list.push(b); if (L.floorBody) list.push(L.floorBody); if (L.backBody) list.push(L.backBody); }
    return list;
  }
  // everything dynamic that belongs to a building: its standing panels, furniture, lift pieces, panels that came loose and the rubble they made
  stashOf(B) {
    const list = this.bodiesOf(B);
    for (const P of B.free) if (P.body && !list.includes(P.body)) list.push(P.body);
    for (const d of this.rubble) if (d.B === B && !d.dead && d.t < 900) list.push(d.body);
    return list;
  }
  // how far the wreck reaches beyond the footprint (m): the farthest loose piece, 2..30
  spreadOf(B) {
    const f = B.fp; let m = 2;
    const see = (b) => { if (!b || b.fixed) return; const dx = Math.max(f.x0 - b.pos[0], 0, b.pos[0] - f.x1), dz = Math.max(f.z0 - b.pos[2], 0, b.pos[2] - f.z1); const d = Math.hypot(dx, dz); if (d > m) m = d; };
    for (const P of B.free) see(P.body);
    for (const d of this.rubble) if (d.B === B && !d.dead && d.t < 900) see(d.body);
    return Math.min(30, m + 1);
  }
  // A wrecked building may freeze into a "photo" once everything of it has come to rest: nothing is still falling, no collapse is pending, and
  // loose pieces that only creep (< 0.6 m/s) are put to sleep right here. Moving pieces keep it awake.
  settled(B) {
    if (B.checkStab || B.dirty || this.shatterQ.length) return false;
    for (const P of B.panels) if (P.state === 'fixed' && P.releaseAt) return false;
    let ok = true;
    const now = this.world.time;
    const chk = (b) => {
      if (!b || b.fixed || b.sleeping || b.removed) return;
      if (b.pos[1] < -20) return;
      const v2 = b.v[0] * b.v[0] + b.v[1] * b.v[1] + b.v[2] * b.v[2], w2 = b.w[0] * b.w[0] + b.w[1] * b.w[1] + b.w[2] * b.w[2];
      if (v2 < 0.36 && w2 < 4) { b.sleep(); return; }
      // thin plates in a pile rattle in place at the contact and never quite stop: a piece that stays within 2 cm and 1.6 degrees for 0.8 s is at rest
      const a = b._rest;
      if (a && now - a.seen < 1 && Math.hypot(b.pos[0] - a.p[0], b.pos[1] - a.p[1], b.pos[2] - a.p[2]) < 0.02 && Math.abs(b.q[0] * a.q[0] + b.q[1] * a.q[1] + b.q[2] * a.q[2] + b.q[3] * a.q[3]) > 0.9999) {
        a.seen = now;
        if (now - a.t > 0.8 && v2 < 4) { b.sleep(); return; }
      } else b._rest = { t: now, seen: now, p: b.pos.slice(), q: b.q.slice() };
      ok = false;
    };
    for (const P of B.free) chk(P.body);
    for (const it of B.lay.furn) chk(it.body);
    for (const d of this.rubble) if (d.B === B && !d.dead && d.t < 900) chk(d.body);
    return ok;
  }
  sleepBuilding(B) {
    if (B.dormant || B.removed) return false;
    for (const L of B.lifts || []) if (L.state !== 'idle' || L.carry) return false;           // a lift in motion: stay awake
    let list;
    if (B.freed > 0 || B.free.size) {
      if (!this.settled(B)) return false;
      B.spread = this.spreadOf(B);
      list = this.stashOf(B); B.stash = list;                                                 // frozen like a photo: the broken state stays, only physics leaves
    } else {
      for (const it of B.lay.furn) if (it.body && !it.body.sleeping) return false;            // furniture still moving: stay awake
      list = this.bodiesOf(B);
    }
    this.world.removeMany(list);
    B.dormant = true; B.lazy = true;
    return true;
  }
  wakeBuilding(B) {
    if (!B.dormant) return;
    if (B.stash) {
      const alive = B.stash.filter((b) => !(b.rub && (b.rub.t >= 900 || b.rub.dead)) && !(b.panel && b.panel.state === 'gone') && b.pos[1] > -30);
      B.stash = null; this.world.addMany(alive);
    } else this.world.addMany(this.bodiesOf(B));
    B.dormant = false; B.far = 0;
  }
  sleepAll() { this.lazyOn = true; for (const B of this.list) this.sleepBuilding(B); }
  // Does the swept corridor of a watcher (segment (x,z)->(x2,z2), radius r) touch the building footprint grown by m metres?
  static reach(B, p, m) { const f = B.fp; return segHitsRect(p.x, p.z, p.x2, p.z2, f.x0, f.z0, f.x1, f.z1, p.r + m); }
  // pts: watchers [{x,z,x2,z2,r}] = a car's path for the next fraction of a second, or a walking person (x2=x). A building is awake only while a watcher's path
  // reaches it; waking happens in the same frame, before the physics step, so there is no delay and nothing to bounce off.
  // A building that was hit keeps its wreck (loose pieces) awake while a watcher is near; ~10 m clear of the wreck it freezes into a photo: no bodies at all,
  // drawn exactly as it lies. Coming back within reach thaws every piece in the pose it was frozen in.
  updateDormancy(pts) {
    if (!this.lazyOn) return;
    for (const B of this.list) {
      if (B.removed || !B.lazy || !B.fp) continue;
      const dmg = B.freed > 0 || B.free.size > 0 || !!B.stash;
      if (dmg && !B.dormant && (B.spT = (B.spT || 0) + 1) % 15 === 0) B.spread = this.spreadOf(B);
      const sp = dmg ? Math.min(B.spread || 8, 14) : 0;
      let near = false, far = true;
      for (const p of pts) { if (Structures.reach(B, p, sp)) { near = true; far = false; break; } if (far && Structures.reach(B, p, sp + 6)) far = false; }
      if (B.dormant) { if (near) this.wakeBuilding(B); }
      else if (far) { B.far = (B.far || 0) + 1; if (B.far > 24 && this.sleepBuilding(B)) B.far = 0; }
      else B.far = 0;
    }
  }

  finishBuilding(B) { return this.runSteps(this.finishSteps(B)); }
  *finishSteps(B) {
    const P = B.panels, cs = B.cost || {};
    cs.f0 = performance.now();
    { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of P) { x0 = Math.min(x0, p.cx - p.ax); x1 = Math.max(x1, p.cx + p.ax); z0 = Math.min(z0, p.cz - p.az); z1 = Math.max(z1, p.cz + p.az); } B.fp = { x0: B.x + x0, x1: B.x + x1, z0: B.z + z0, z1: B.z + z1 }; }
    for (let i = 0; i < P.length; i++) for (let j = 0; j < P.length; j++) {
      if (i === j) continue;
      const A = P[i], C = P[j];
      if (A.q || C.q) {   // oriented panels: touching world boxes, A sits higher than C
        if (A.cy > C.cy + 0.1 && Math.abs(A.cy - C.cy) < A.ay + C.ay + 0.1 && Math.abs(A.cx - C.cx) < A.ax + C.ax - 0.05 && Math.abs(A.cz - C.cz) < A.az + C.az - 0.05 && A.y0 < C.y1 + 0.12) { A.below.push(C); C.above.push(A); }
      } else if (Math.abs(A.y0 - C.y1) < 0.06 && Math.abs(A.cx - C.cx) < A.hx + C.hx - 0.02 && Math.abs(A.cz - C.cz) < A.hz + C.hz - 0.02) { A.below.push(C); C.above.push(A); }
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
    // furniture is real loose stuff: it has mass, can be pushed, knocked over and smashed through by a car (asleep until something touches it)
    for (const it of B.lay.furn) if (it.solid) {
      const mass = Math.max(8, Math.min(450, 8 * it.hx * it.hy * it.hz * (it.act === 'stove' || it.act === 'fridge' ? 380 : 170)));
      const b = new Body({ mass, pos: [B.x + it.x, it.y + 0.005, B.z + it.z], q: [0, 0, 0, 1], group: GROUP.PROP, fric: 0.6, rest: 0.05, linDamp: 0.25, angDamp: 0.6 });
      b.addBox([it.hx, it.hy, it.hz]); this.hold(b, B); b.sleep(); b.furn = it; it.body = b;
    }
    cs.f1 = performance.now();
    yield 'links';
    this.setupDoors(B);
    this.setupLifts(B);
    this.list.push(B);
    cs.f2 = performance.now();
    validateBuilding(this, B);
    cs.f3 = performance.now();
    yield 'valid';
    yield* this.rebuildSteps(B);
    cs.f4 = performance.now();
  }

  // ---------- surface description of a panel ----------
  faceCfg(P) {
    const B = P.B, cracked = P.hp < P.maxHp * 0.55;
    const core = TILE_OF[P.mat] ?? T.rcc;
    // surface character by building style: old / traditional = rough plaster, brick, block; modern + glass = clean smooth white;
    // luxury (dark) = smooth white walls, with some wall runs in warm wood or crisp concrete
    const Dz = B.design || {}, fin = B._fin || (B._fin = !Dz.style || Dz.style === 'classic' || Dz.style === 'brick' ? 'rough' : Dz.style === 'dark' ? 'lux' : 'smooth');
    const smooth = fin !== 'rough';
    const pl = cracked ? T.crack : smooth ? T.white : T.plaster;
    const pOut = P.e.tint ? hexRGB(P.e.tint) : B.paintOut, pIn = B.paintIn;
    if (P.e.slabLook) { const roofL = P.e.roof; return (fi) => (fi === 2 ? (roofL ? [T.roof, 1, 1, 1] : [T.floor, pOut[0] * 0.6 + 0.4, pOut[1] * 0.6 + 0.4, pOut[2] * 0.6 + 0.4]) : fi === 3 ? [pl, pIn[0], pIn[1], pIn[2]] : [pl, pOut[0], pOut[1], pOut[2]]); }
    if (P.e.tile && T[P.e.tile] !== undefined) { const tl = T[P.e.tile], w = P.e.tint ? pOut : [1, 1, 1]; return () => [tl, w[0], w[1], w[2]]; }   // cladding: marble, slate, fluted, brass ...
    if (P.e.stair) { const w = pOut; return (fi) => [fi === 2 ? T.wood : T.rcc, w[0], w[1], w[2]]; }
    if (P.kind === 'wall' || P.kind === 'lintel') {
      const nAxisX = !P.q && P.hx < P.hz; // wall normal along x -> faces 0,1
      const fo = nAxisX ? (P.out && P.out[0] > 0 ? 0 : 1) : (P.out && P.out[1] > 0 ? 4 : 5);
      const fa = nAxisX ? [0, 1] : [4, 5];
      const isCore = P.e.core;
      return (fi) => {
        if (!fa.includes(fi)) return [core, 1, 1, 1];
        if (isCore) return [T.rcc, 1, 1, 1];
        if (P.e.parapet || P.e.railing) return [pl, pOut[0], pOut[1], pOut[2]];
        if (!P.out) return [pl, pIn[0], pIn[1], pIn[2]];
        if (fi === fo && fin === 'lux' && !cracked && P.run != null) {   // accent runs on luxury houses: warm wood and architectural concrete beside the smooth white
          const h = ((P.run * 2654435761) >>> 0) % 12;
          if (h < 2) return [T.wood, 1.25, 1.1, 0.95];
          if (h < 4) return [T.rcc, 1.05, 1.05, 1.05];
        }
        return fi === fo ? [pl, pOut[0], pOut[1], pOut[2]] : [pl, pIn[0], pIn[1], pIn[2]];
      };
    }
    if (P.kind === 'col') return (fi) => (fi === 2 || fi === 3 ? [T.rcc, 1, 1, 1] : [pl, pOut[0], pOut[1], pOut[2]]);
    if (P.kind === 'slab') {
      const roof = P.e.roof;
      return (fi) => (fi === 2 ? (roof ? [T.roof, 1, 1, 1] : [T.floor, 1, 1, 1]) : fi === 3 ? [pl, pIn[0], pIn[1], pIn[2]] : [T.rcc, 1, 1, 1]);
    }
    if (P.kind === 'pane') { const t = P.e.glassTint || [0.3, 0.4, 0.44]; return () => [T.glass, t[0], t[1], t[2]]; }
    if (P.kind === 'door') { const dc = P.e.doorTint ? hexRGB(P.e.doorTint).map((v) => Math.min(1, v * 1.5)) : [B.trim[0] * 2.2 + 0.25, B.trim[1] * 2.2 + 0.2, B.trim[2] * 2.2 + 0.15]; return (fi) => [T.wood, dc[0], dc[1], dc[2]]; }
    return () => [T.rcc, 1, 1, 1];
  }

  // ---------- mesh ----------
  rebuild(B) { this.runSteps(this.rebuildSteps(B)); }
  *rebuildSteps(B) {
    const g = new GeoBuf(), gl = new GeoBuf();           // gl: window glass, drawn in the transparent pass so the room behind it shows through
    const off = [B.x, 0, B.z];
    let k = 0;
    // faces that are completely covered by another solid panel are never visible: leave them out (see cull.js)
    const inMesh = (P) => P.state === 'fixed' && !P.e.ghost && !P.dyn;
    const culler = new FaceCuller(B.panels.filter((P) => inMesh(P) && P.kind !== 'pane'));
    for (const P of B.panels) if (inMesh(P)) {
      const sh = 0.96 + 0.04 * ((P.e.id * 0.618) % 1);
      const pane = P.kind === 'pane', tg = pane ? gl : g;
      let cfg = this.faceCfg(P);
      if (pane) {   // glass is a thin sheet: only its two broad faces can ever be seen
        const h = [P.hx, P.hy, P.hz], ti = h[0] <= h[1] && h[0] <= h[2] ? 0 : h[1] <= h[2] ? 1 : 2, c0 = cfg;
        cfg = (fi) => ((fi >> 1) === ti ? c0(fi) : null);
      } else {
        const bx = alignedBox(P), mask = bx ? culler.hidden(bx, P) : 0;
        if (mask) { const c0 = cfg; cfg = (fi) => ((mask >> fi) & 1 ? null : c0(fi)); }
      }
      if (P.q) tg.boxQ(P.q, [P.cx, P.cy, P.cz], P.hx, P.hy, P.hz, cfg, off, (P.s0 + P.s1) / 2, pane ? 1 : sh);
      else tg.box(P.cx, P.cy, P.cz, P.hx, P.hy, P.hz, cfg, off, pane ? 1 : sh, !pane);
      if ((++k & 255) === 0) yield 'mesh';
    }
    const trimC = B.trim, nPanelQuads = g.n;
    for (const D of B.decos || []) {
      if (D.host && D.host.state !== 'fixed') continue;
      const e = D.e, c = e.tint ? hexRGB(e.tint) : trimC;
      const bx = e.q ? alignedBox({ q: e.q, hx: e.hx, hy: e.hy, hz: e.hz, cx: e.cx, cy: e.cy, cz: e.cz }) : null, mask = bx ? culler.hidden(bx, null) : 0;
      g.boxQ(e.q, [e.cx, e.cy, e.cz], e.hx, e.hy, e.hz, (fi) => ((mask >> fi) & 1 ? null : [T.white, c[0], c[1], c[2]]), off, 0, 1);
    }
    if (B.cost) B.cost.qPanels = nPanelQuads, B.cost.qDecos = g.n - nPanelQuads;
    const old = B.mesh, tg0 = performance.now();
    const fin = g.n ? g.finish() : null, tg1 = performance.now();
    B.mesh = fin ? this.r.createMesh(fin, { mat: this.material(), radius: B.radius }) : null;
    if (B.cost) { B.cost.geo = tg1 - tg0; B.cost.up = performance.now() - tg1; }
    if (old) this.r.deleteMesh(old);
    const oldG = B.glassMesh;
    B.glassMesh = gl.n ? this.r.createMesh(gl.finish(), { mat: this.glassMat(B), radius: B.radius }) : null;
    if (oldG) this.r.deleteMesh(oldG);
    B.dirty = false;
  }
  // glass: clear, slightly tinted, very little shine. 'glass' (tower) buildings are more tinted and a bit more reflective than houses.
  glassMat(B) {
    const a = (B.design && B.design.style === 'glass') ? 0.5 : 0.3;
    this._gm = this._gm || {};
    return this._gm[a] || (this._gm[a] = { kind: 8, base: [1, 1, 1], alpha: a, rough: 0.05, metal: 0 });
  }

  rebuildInterior(B) {
    const g = new GeoBuf();
    const off = [B.x, 0, B.z];
    const slabOK = new Map();
    for (const P of B.panels) if (P.kind === 'slab' || P.e.slabLook) slabOK.set(P.e.id, P.state === 'fixed');
    for (const R of B.lay.rooms) {
      if (R.f === 0) g.box((R.x0 + R.x1) / 2, 0.015, (R.z0 + R.z1) / 2, (R.x1 - R.x0) / 2, 0.015, (R.z1 - R.z0) / 2, (fi) => (fi === 2 ? [T.floor, 1, 1, 1] : null), off, 1, false);
    }
    for (const it of B.lay.furn) {
      if (it.body) continue;                                      // loose furniture is drawn on its own
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

  furnMesh(it) {
    const key = ['f', it.tile, it.color, it.hx.toFixed(3), it.hy.toFixed(3), it.hz.toFixed(3)].join('|');
    let m = this.freeMeshes.get(key);
    if (!m) {
      const c = hexRGB(it.color);
      const tile = it.tile === 'wood' ? T.wood : it.tile === 'fabric' ? T.fabric : it.tile === 'metal' ? T.metal : T.white;
      const g = new GeoBuf();
      g.box(0, 0, 0, it.hx, it.hy, it.hz, () => [tile, c[0], c[1], c[2]], [0, 0, 0], 1, false);
      m = this.r.createMesh(g.finish(), { mat: this.material(), radius: Math.max(it.hx, it.hy, it.hz) * 2 });
      this.freeMeshes.set(key, m);
    }
    return m;
  }

  // a real door: the leaf plus its design (grooves, raised panels, glass light, slats) and handle, built from the archetype the catalog picked for this building
  doorGeo(P) {
    const B = P.B, g = new GeoBuf(), hx = P.hx, hy = P.hy, hz = P.hz;
    const D = B.design || {}, name = doorType(D.style, (D.seed || 1) + (P.e.id || 0), { garage: !!P.e.garage, shop: !!(D.shopGround && P.e.front) }), T0 = DOOR_TYPES[name];
    const wood = P.e.doorTint ? hexRGB(P.e.doorTint) : [0.5, 0.36, 0.22], trim = B.trim, free = P.e.hinge === 'R' ? -1 : 1;
    const box = (cx, cy, cz, ax, ay, az, tile, c) => g.box(cx, cy, cz, ax, ay, az, () => [tile, c[0], c[1], c[2]], [0, 0, 0], 1, false);
    const lift = (v, k) => v.map((x) => Math.min(1, x * k));
    const leafC = T0.leaf === 'wood' ? lift(wood, 1.5) : T0.leaf === 'fluted' ? [0.55, 0.55, 0.58] : T0.leaf === 'roller' ? [0.7, 0.72, 0.74] : T0.leaf === 'frame' ? [0.16, 0.17, 0.19] : lift(trim, 1.6);
    const leafT = T0.leaf === 'wood' ? T.wood : T0.leaf === 'fluted' ? T.fluted : T0.leaf === 'roller' || T0.leaf === 'frame' ? T.metal : T.plaster;
    box(0, 0, 0, hx, hy, hz, leafT, leafC);
    const zf = hz + 0.004, dark = [0.05, 0.045, 0.04], glass = [0.05, 0.075, 0.09];
    const faces = [1, -1];                                              // detail on the outside (+z) and the inside (-z)
    for (const f of faces) {
      if (T0.grooves) for (let i = 1; i <= T0.grooves; i++) box(0, -hy + (2 * hy * i) / (T0.grooves + 1), f * zf, hx - 0.01, 0.006, 0.004, T.plaster, dark);
      if (T0.panels) { const [nc, nr] = T0.panels, pw = (2 * hx - 0.1) / nc, ph = (2 * hy - 0.1) / nr; for (let c = 0; c < nc; c++) for (let rr = 0; rr < nr; rr++) box(-hx + 0.05 + pw * (c + 0.5), -hy + 0.05 + ph * (rr + 0.5), f * (hz + 0.007), pw / 2 - 0.045, ph / 2 - 0.045, 0.007, T.wood, lift(wood, 1.2)); }
      if (T0.lite) { const L = T0.lite, y0 = hy * L.y0, y1 = hy * L.y1, w = hx * L.w; box(0, (y0 + y1) / 2, f * (hz + 0.003), w, (y1 - y0) / 2, 0.003, T.plaster, glass); for (const sx of [-1, 1]) box(sx * (w + 0.012), (y0 + y1) / 2, f * zf, 0.012, (y1 - y0) / 2 + 0.012, 0.004, T.metal, dark); for (const yy of [y0 - 0.012, y1 + 0.012]) box(0, yy, f * zf, w + 0.024, 0.012, 0.004, T.metal, dark); }
      if (T0.slats) for (let i = 1; i < T0.slats; i++) box(0, -hy + (2 * hy * i) / T0.slats, f * zf, hx - 0.005, 0.009, 0.004, T.plaster, [0.22, 0.23, 0.25]);
      const hxp = free * (hx - 0.1);
      if (T0.handle === 'slot') box(hxp, 0.0, f * (hz + 0.022), 0.014, hy * 0.42, 0.018, T.metal, T0.slotColor);
      else if (T0.handle === 'bar') box(hxp, 0.0, f * (hz + 0.03), 0.012, 0.32, 0.012, T.metal, [0.7, 0.72, 0.74]);
      else if (T0.handle === 'knob') { box(hxp, -0.02, f * (hz + 0.025), 0.035, 0.035, 0.02, T.brass, [1, 1, 1]); box(hxp, -0.2, f * (hz + 0.012), 0.025, 0.07, 0.008, T.brass, [1, 1, 1]); }
      else if (T0.handle === 'push') box(0, 0, f * (hz + 0.04), hx * 0.7, 0.014, 0.014, T.metal, [0.8, 0.82, 0.84]);
    }
    return g;
  }
  freeMesh(P) {
    const cracked = P.hp < P.maxHp * 0.55;
    if (P.kind === 'door') {
      const D = P.B.design || {}, key = ['door', D.style, D.seed, P.e.id, P.e.doorTint, P.e.hinge, P.e.garage ? 1 : 0, P.hx.toFixed(2), P.hy.toFixed(2), P.hz.toFixed(3), P.B.trim.join(',')].join('|');
      let m = this.freeMeshes.get(key);
      if (!m) { m = this.r.createMesh(this.doorGeo(P).finish(), { mat: this.material(), radius: Math.max(P.hx, P.hy, P.hz) * 2 }); this.freeMeshes.set(key, m); }
      return m;
    }
    const key = [P.B.lay.paint.out, P.kind, P.mat, P.hx.toFixed(2), P.hy.toFixed(2), P.hz.toFixed(2), P.out ? P.out.join('') : '', cracked, P.e.roof ? 1 : 0, P.e.parapet ? 1 : 0, P.e.tint || ''].join('|');
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
      body.ghostUntil = world.time + 0.2;
      world.add(body);
      const d = { body, kind: 'rubble', B, mesh: this.rubbleMesh(c.tile, c.tint, c.dims), s: 1, t: 0, tile: c.tile, tint: c.tint, dims: c.dims, dens: c.dens, m: c.m, gen: c.gen || 0 };
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
    for (const it of P.B.lay.furn) if (it.body && it.body.sleeping && Math.abs(P.B.x + it.x - b0x(P)) < 3.2 && Math.abs(P.B.z + it.z - b0z(P)) < 3.2) it.body.wake();
    if (P.f === 0) this.hazardCheck(P.B, P, why === 'hit' ? 1 : 0.4);
  }

  // take a building out of the world completely (used by the Design Lab when a design is rebuilt or deleted)
  removeBuilding(B) {
    this.world.removeMany(this.bodiesOf(B, true));
    for (const P of B.panels) P.state = 'gone';
    for (const it of B.lay.furn) it.body = null;
    B.free.clear();
    if (B.mesh) this.r.deleteMesh(B.mesh);
    if (B.glassMesh) this.r.deleteMesh(B.glassMesh);
    if (B.intMesh) this.r.deleteMesh(B.intMesh);
    B.mesh = B.intMesh = B.glassMesh = null; B.removed = true;
    const i = this.list.indexOf(B); if (i >= 0) this.list.splice(i, 1);
  }

  // surface height of a stair flight under world point (x,z) for a body whose feet are at y; null when not on stairs
  stairHeight(x, z, y) {
    let best = null;
    for (const B of this.list) {
      if (!B.stairs || !B.stairs.length || Math.hypot(B.x - x, B.z - z) > (B.radius || 30)) continue;
      const lx = x - B.x, lz = z - B.z;
      for (const S of B.stairs) {
        if (lx < S.x0 || lx > S.x1 || lz < S.z0 || lz > S.z1 + 0.4) continue;
        const seam = S.seam ?? S.x0 + S.half + 0.06;
        const into = S.z1 - lz;                       // distance back from the front edge of the well
        let h;
        if (lx < seam) {                              // flight A: climbs going back; each tread is a real step
          if (into <= 0) h = S.base;
          else if (into >= S.flight) h = S.base + S.Ht / 2;
          else h = S.base + (Math.floor(into / S.tread) + 1) * S.rise;
        } else {                                      // flight B: climbs coming forward
          if (into <= 0) h = S.base + S.Ht;
          else if (into >= S.flight) h = S.base + S.Ht / 2;
          else h = S.base + S.Ht / 2 + (Math.min(S.n - 1, Math.floor((S.flight - into) / S.tread)) + 1) * S.rise;
        }
        const d = y - h;
        if (d > -0.4 && d < 0.45 && (best === null || Math.abs(d) < Math.abs(y - best))) best = h;
      }
    }
    return best;
  }

  // closest usable piece of furniture (stove, fridge, market counter ...) within R metres of a world point
  interactNear(p, R) {
    let best = null, bd = R;
    for (const B of this.list) {
      if (!B.lay.furn.length || Math.hypot(B.x - p[0], B.z - p[2]) > (B.radius || 30) + 4) continue;
      for (const it of B.lay.furn) {
        if (!it.act) continue;
        const ix = it.body ? it.body.pos[0] : B.x + it.x, iy = it.body ? it.body.pos[1] : it.y, iz = it.body ? it.body.pos[2] : B.z + it.z;
        if (Math.abs(iy - p[1] - 0.6) > 1.6) continue;
        const d = Math.hypot(ix - p[0], iz - p[2]) - Math.max(it.hx, it.hz);
        if (d < bd) { bd = d; best = { act: it.act, B, it }; }
      }
    }
    return best;
  }


  // ---------- lifts: shaft door at every floor, cabin that really travels, floor card ----------
  setupLifts(B) {
    B.lifts = [];
    const defs = (B.compiled && B.compiled.lifts) || [];
    for (const d of defs) {
      const st = LIFT_STYLES[d.style] || LIFT_STYLES.passenger;
      const cx = (d.x0 + d.x1) / 2, doorZ = d.z1, zc = d.z1 - 0.1 - st.d / 2;
      const L = { B, d, style: d.style, st, cx, doorZ, zc, levels: d.levels.slice(), floors: d.floors.slice(), cur: 0, dest: 0, y: d.levels[0], state: 'idle', door: 0, doorT: 0, doorBodies: [], floorBody: null, carry: false, off: 0, idleT: 0, rx: 0, rz: 0 };
      const cb = zc - st.d / 2 + 0.02, top = L.levels[L.levels.length - 1] + 3.2, bot = L.levels[0] - 0.4;
      L.backBody = this.liftBox(L, cx, (top + bot) / 2, (d.z0 + cb) / 2, (d.x1 - d.x0) / 2, (top - bot) / 2, (cb - d.z0) / 2);   // the shaft behind the cabin is solid for the walker
      this.syncLiftBodies(L);
      B.lifts.push(L);
    }
  }
  liftBox(L, x, y, z, hx, hy, hz) {
    const B = L.B, b = new Body({ fixed: true, pos: [B.x + x, y, B.z + z], q: [0, 0, 0, 1], group: GROUP.STATIC, fric: 0.6, rest: 0.05 });
    b.addBox([hx, hy, hz]);
    this.hold(b, B);   // a sleeping building keeps its new shaft pieces out of the world until it wakes
    return b;
  }
  // landing doors block the shaft whenever the cabin is not standing there with open doors; the cabin floor is a platform under the cabin
  syncLiftBodies(L) {
    const open = L.state !== 'moving' && L.door > 0.5;
    L.levels.forEach((lv, k) => {
      const want = !(k === L.cur && open);
      if (want && !L.doorBodies[k]) L.doorBodies[k] = this.liftBox(L, L.cx, lv + 1.05, L.doorZ, L.st.dw / 2 + 0.05, 1.05, 0.07);
      else if (!want && L.doorBodies[k]) { this.world.remove(L.doorBodies[k]); L.doorBodies[k] = null; }
    });
    const d = L.d;
    if (L.floorBody && L.floorBodyY === L.levels[L.cur]) return;
    if (L.floorBody) this.world.remove(L.floorBody);
    L.floorBodyY = L.levels[L.cur];
    L.floorBody = this.liftBox(L, L.cx, L.floorBodyY - 0.06, (d.z0 + d.z1) / 2, (d.x1 - d.x0) / 2 - 0.05, 0.06, (d.z1 - d.z0) / 2 - 0.05);
  }
  liftInside(L, f) {
    const B = L.B, st = L.st;
    return Math.abs(B.x + L.cx - f[0]) < st.w / 2 - 0.02 && Math.abs(B.z + L.zc - f[2]) < st.d / 2 - 0.02 && Math.abs(f[1] - L.y) < 1.1;
  }
  liftGo(L, idx) {
    if (!L || L.state === 'moving' || L.state === 'closing') return false;
    if (idx === L.cur) { L.state = 'opening'; return true; }
    L.dest = idx; L.state = 'closing'; return true;
  }
  // what the HUD should show: the lift the walking person stands in
  liftUI(person) {
    if (!person || !person.active || !person.body) return null;
    const f = person.feet;
    for (const B of this.list) {
      if (!B.lifts || !B.lifts.length || Math.hypot(B.x - f[0], B.z - f[2]) > (B.radius || 30) + 4) continue;
      for (const L of B.lifts) if (this.liftInside(L, f)) return { L, labels: L.floors.map((fl) => (fl === 0 ? 'G' : String(fl))), cur: L.cur, dest: L.dest, moving: L.state === 'moving' || L.state === 'closing', key: B.x + ':' + B.z + ':' + L.style };
    }
    return null;
  }
  updateLifts(dt) {
    const person = this.ctx.person, f = person && person.active && person.body ? person.feet : null;
    this.riding = false;
    for (const B of this.list) {
      if (!B.lifts) continue;
      for (const L of B.lifts) {
        const near = f && Math.hypot(B.x - f[0], B.z - f[2]) < (B.radius || 30) + 6;
        const inside = !!(f && this.liftInside(L, f));
        const spd = 1.1;
        if (L.state === 'closing') { L.door = Math.max(0, L.door - spd * dt); if (L.door <= 0) { L.state = 'moving'; L.carry = inside; if (inside) { L.rx = person.body.pos[0]; L.rz = person.body.pos[2]; L.off = person.body.pos[1] - L.y; } this.syncLiftBodies(L); } }
        else if (L.state === 'moving') {
          const target = L.levels[L.dest], dist = Math.abs(target - L.y), n = Math.abs(L.dest - L.cur) || 1;
          const v = Math.min(7, 1.6 + 0.9 * n) * Math.max(0.25, Math.min(1, dist / 1.2, (Math.abs(L.y - L.levels[L.cur]) + 0.35) / 1.2));
          const step = Math.min(dist, Math.max(0.3, v) * dt);
          L.y += Math.sign(target - L.y) * step;
          if (L.carry && person && person.body) { person.body.pos[0] = L.rx; person.body.pos[2] = L.rz; person.body.pos[1] = L.y + L.off; person.body.v[0] = person.body.v[1] = person.body.v[2] = 0; this.riding = true; }
          if (Math.abs(target - L.y) < 1e-3) { L.y = target; L.cur = L.dest; L.state = 'opening'; L.carry = false; this.syncLiftBodies(L); }
        } else if (L.state === 'opening') { L.door = Math.min(1, L.door + spd * dt); if (L.door >= 1) { L.state = 'idle'; L.idleT = 0; } this.syncLiftBodies(L); }
        else {   // idle: doors follow the person
          const dx = f ? Math.hypot(B.x + L.cx - f[0], B.z + L.doorZ + 1.2 - f[2]) : 99;
          const here = f && Math.abs(f[1] - L.levels[L.cur]) < 1.2;
          if (near && f) {
            if (here && (dx < 2.6 || inside)) { if (L.door < 1) { L.door = Math.min(1, L.door + spd * dt); this.syncLiftBodies(L); } L.idleT = 0; }
            else if (!here) {   // somebody waits at another floor: call the lift
              const k = L.levels.findIndex((lv) => Math.abs(f[1] - lv) < 1.0);
              if (k >= 0 && k !== L.cur && dx < 3.2 && !this.liftOccupied(L) && Math.abs(B.z + L.doorZ + 1.0 - f[2]) < 3.0) this.liftGo(L, k);
            }
          }
          if (L.door > 0 && !inside && !(here && dx < 3.4)) { L.idleT += dt; if (L.idleT > 1.5) { L.door = Math.max(0, L.door - spd * dt); this.syncLiftBodies(L); } }
        }
      }
    }
  }
  liftOccupied(L) { const p = this.ctx.person; return !!(p && p.active && p.body && this.liftInside(L, p.feet)); }
  liftMeshes(style) {
    this._lm = this._lm || {};
    if (!this._lm[style]) this._lm[style] = { cabin: buildCabinMesh(this.r, this.material(), style), leaf: buildLeafMesh(this.r, this.material(), style) };
    return this._lm[style];
  }
  drawLifts(B, cam, d) {
    const r = this.r;
    this._lM = this._lM || [new Float32Array(16), new Float32Array(16), new Float32Array(16)];
    for (const L of B.lifts) {
      const M = this.liftMeshes(L.style), st = L.st, wx = B.x + L.cx, wz = B.z + L.zc;
      m4.fromTRS(this._lM[0], [wx, L.y, wz], [0, 0, 0, 1], 1);
      r.add(M.cabin, this._lM[0], { cast: false });
      if (d - B.radius < 25) r.addLight(wx, L.y + st.h - 0.15, wz, 7, st.light[0] * 1.2, st.light[1] * 1.2, st.light[2] * 1.2);
      const open = L.state === 'moving' ? 0 : L.door, dw = st.dw;
      const place = (y, z, o) => {
        const xs = st.door === 'centre' ? [wx - dw / 4 - o * dw / 2, wx + dw / 4 + o * dw / 2] : [wx - dw / 4 + o * dw * 0.9, wx + dw / 4 + o * dw * 0.45];
        for (let i = 0; i < 2; i++) { m4.fromTRS(this._lM[1], [xs[i], y, z], [0, 0, 0, 1], 1); r.add(M.leaf, this._lM[1], { cast: false }); }
      };
      place(L.y, wz + st.d / 2 - 0.05, open);                                         // cabin doors
      L.levels.forEach((lv, k) => { if (Math.abs(lv - cam[1]) > 40) return; place(lv, B.z + L.doorZ - 0.1, k === L.cur && L.state !== 'moving' ? L.door : 0); });   // landing doors
    }
  }

  // ---------- doors: hinged leaves that swing open and shut, roller shutters that roll up ----------
  setupDoors(B) {
    B.doors = [];
    for (const P of B.panels) {
      if (P.kind !== 'door' || !P.e.hinge) continue;
      P.dyn = true;
      const q = P.q || [0, 0, 0, 1];
      const X = qRot(q, [1, 0, 0]);
      const sgn = P.e.hinge === 'R' ? 1 : -1;
      const H = [P.cx + X[0] * P.hx * sgn, P.cz + X[2] * P.hx * sgn];      // hinge post (building-local x, z)
      const n = P.outW || [0, 1];
      // swing towards the inside of the building, away from whoever opens it from the street
      const dl = Math.hypot(P.cx - H[0], P.cz - H[1]) || 1, dx = (P.cx - H[0]) / dl, dz = (P.cz - H[1]) / dl;
      const swing = (dz * -n[0] + -dx * -n[1]) > 0 ? 1 : -1;          // +90 deg about Y turns (dx,dz) into (dz,-dx); pick the side that points inside
      B.doors.push({ P, H, q0: q.slice(), c0: [P.cx, P.cy, P.cz], open: 0, target: 0, roller: !!P.e.garage, swing, X, moving: false });
    }
  }

  doorPose(D) {
    const P = D.P;
    if (D.roller) return { pos: [D.c0[0], D.c0[1] + D.open * (P.hy * 2 - 0.1), D.c0[2]], q: D.q0 };
    const th = D.open * (Math.PI / 2) * D.swing;
    const c = Math.cos(th), s = Math.sin(th);
    const dx = D.c0[0] - D.H[0], dz = D.c0[2] - D.H[1];
    const nx = D.H[0] + c * dx + s * dz, nz = D.H[1] - s * dx + c * dz;
    const qy = [0, Math.sin(th / 2), 0, Math.cos(th / 2)];
    return { pos: [nx, D.c0[1], nz], q: qMul(qy, D.q0) };
  }

  setDoorBody(B, D) {
    const P = D.P, pose = this.doorPose(D);
    if (P.body) this.world.remove(P.body);
    P.body = null;
    if (D.roller && D.open > 0.5) return;       // rolled up: nothing to collide with
    const b = new Body({ fixed: true, pos: [B.x + pose.pos[0], pose.pos[1], B.z + pose.pos[2]], q: pose.q.slice(), group: GROUP.STATIC, fric: 0.5, rest: 0.05 });
    b.addBox([P.hx, P.hy, P.hz]); b.brk = P; b.panel = P;
    this.hold(b, B); P.body = b; P.cx = pose.pos[0]; P.cz = pose.pos[2];
  }

  // F at a door: open it, or close it again. Returns 'opened' | 'closed' | 'blocked' | false
  toggleDoorNear(p, R) {
    let best = null, bd = R;
    for (const B of this.list) {
      if (!B.doors || !B.doors.length || Math.hypot(B.x - p[0], B.z - p[2]) > (B.radius || 30) + 4) continue;
      for (const D of B.doors) {
        const P = D.P; if (P.state !== 'fixed') continue;
        const d = Math.hypot(B.x + D.c0[0] - p[0], B.z + D.c0[2] - p[2]) - P.hx * 0.6;
        if (Math.abs((P.y0 + P.y1) / 2 - 0.0 - (p[1] + 1.0)) > 1.6) continue;
        if (d < bd) { bd = d; best = { B, D }; }
      }
    }
    if (!best) return false;
    const { B, D } = best;
    if (D.target === 1) {
      // do not close it on somebody standing in the doorway
      const dx = B.x + D.c0[0] - p[0], dz = B.z + D.c0[2] - p[2];
      if (Math.hypot(dx, dz) < 0.55) return 'blocked';
      D.target = 0; D.moving = true; D.auto = false; if (D.P.body) { this.world.remove(D.P.body); D.P.body = null; }
      return 'closed';
    }
    D.target = 1; D.moving = true; if (D.P.body) { this.world.remove(D.P.body); D.P.body = null; }
    return 'opened';
  }

  // automatic doors for the walking person: a door opens when you walk up to it and shuts again after you leave
  autoDoors(p, fx, fz) {
    for (const B of this.list) {
      if (!B.doors || !B.doors.length || Math.hypot(B.x - p[0], B.z - p[2]) > (B.radius || 30) + 4) continue;
      for (const D of B.doors) {
        const P = D.P; if (P.state !== 'fixed' || D.roller) continue;
        if (Math.abs((P.y0 + P.y1) / 2 - (p[1] + 1.0)) > 1.6) continue;
        const dx = B.x + D.c0[0] - p[0], dz = B.z + D.c0[2] - p[2], d = Math.hypot(dx, dz);
        if (D.target === 0) {
          if (d < 1.5 + P.hx && (d < 0.9 + P.hx || (dx * fx + dz * fz) / (d || 1) > 0.35)) { D.target = 1; D.moving = true; D.auto = true; if (P.body) { this.world.remove(P.body); P.body = null; } }
        } else if (D.auto && d > 3.4 + P.hx) { D.target = 0; D.moving = true; D.auto = false; if (P.body) { this.world.remove(P.body); P.body = null; } }
      }
    }
  }

  updateDoors(dt) {
    for (const B of this.list) {
      if (!B.doors) continue;
      for (const D of B.doors) {
        if (!D.moving || D.P.state !== 'fixed') continue;
        const sp = D.roller ? 0.5 : 1.8;
        const dir = Math.sign(D.target - D.open);
        D.open = Math.max(0, Math.min(1, D.open + dir * sp * dt));
        if (Math.abs(D.open - D.target) < 1e-4) { D.open = D.target; D.moving = false; this.setDoorBody(B, D); }
      }
    }
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
    // the striker's velocity as the solver holds it right now can already contain the impulse of an earlier contact in this same step (a car hitting many panels at once);
    // what flies off must never be faster than the hit itself, or crumbs get shot 40 m sideways and wake half the street
    const sv = Math.hypot(O.v[0], O.v[1], O.v[2]), vcap = Math.max(v, 4) * 1.15;
    const ov = sv > vcap ? [O.v[0] * vcap / sv, O.v[1] * vcap / sv, O.v[2] * vcap / sv] : O.v;
    const cb = this.ctx.onProp;
    if (cb) cb(Math.min(E * 0.004, 4000));
    this.fxAt(P, c.p, E, dir);
    if (this.ctx.sfx && this.soundT <= 0 && E > 20e3) { this.soundT = 0.08; this.ctx.sfx.crash(c.p, clamp(E / 400e3, 0.1, 1), E > 120e3); }
    // shock travels through the mortar bond to neighbouring panels (stronger bond = less spreads)
    const share = P.mat === 'rcc' ? 0.05 : P.mat === 'glass' ? 0.02 : 0.14;
    for (const Q of [...P.nL, ...P.nR]) if (Q.state === 'fixed') { Q.hp -= E * share; if (Q.hp <= 0) this.breakPanel(Q, ov, E * 0.3, dir); }
    for (const Q of P.above) if (Q.state === 'fixed') Q.hp -= E * 0.03;
    for (const Q of P.below) if (Q.state === 'fixed') Q.hp -= E * 0.03;
    if (P.hp <= 0) this.breakPanel(P, ov, E, dir);
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
  computeStable(B) {
    const stable = new Set();
    for (const P of B.panels) if (P.state === 'fixed' && (P.y0 < 0.05 || B.indestr || P.anchored)) stable.add(P);
    const fixed = B.panels.filter((P) => P.state === 'fixed' && P.y0 >= 0.05 && !B.indestr && !P.anchored);
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
          // a lintel (or a run of arch-ring strips) is held when the chain of lintels reaches a standing pier on BOTH sides
          const reach = (dir) => { const seen = new Set([P]), st = [P]; while (st.length) { const q = st.pop(); for (const w of dir < 0 ? q.nL : q.nR) { if (seen.has(w)) continue; seen.add(w); if (w.kind === 'lintel') st.push(w); else if (stable.has(w)) return true; } } return false; };
          ok = reach(-1) && reach(1);
        } else if (P.str) {
          ok = P.below.some((q) => stable.has(q));
        } else {
          ok = P.below.some((q) => stable.has(q)) || P.above.some((q) => stable.has(q) && (q.kind === 'slab' || q.kind === 'lintel'));
        }
        if (ok) { stable.add(P); changed = true; }
      }
    }
    return { stable, fixed };
  }

  checkStability(B) {
    const { stable, fixed } = this.computeStable(B);
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
        body.ghostUntil = this.world.time + 0.2;
        this.world.add(body);
        const d = { body, kind: 'rubble', B: R.B, mesh: this.rubbleMesh(R.tile, R.tint, dd), s: 1, t: 0, tile: R.tile, tint: R.tint, dims: dd, dens: R.dens, m, gen: R.gen + 1 };
        body.rub = d;
        this.ctx.debris.push(d); this.rubble.push(d);
      }
      if (this.ctx.fx) this.ctx.fx.chip(ob.pos, [(Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4], '#c9b79c');
      R.t = 999;
    }
  }

  update(dt) {
    this.updateDoors(dt);
    this.updateLifts(dt);
    if (this.shatterQ.length) this.processShatter();
    this.soundT -= dt;
    const t = this.ctx.time, fx = this.ctx.fx;
    for (const B of this.list) {
      if (B.dormant && !B.dirty && !B.checkStab) continue;                           // asleep (or frozen): nothing to simulate, nothing to rebuild
      if (B.checkStab) { B.checkStab = false; this.checkStability(B); }
      for (const P of B.panels) {
        if (P.state === 'fixed' && P.releaseAt && t >= P.releaseAt) {
          P.releaseAt = 0;
          const o = P.outW || P.out || [0, 0];
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
      if (B.glassMesh && d - B.radius < 600) r.add(B.glassMesh, B.model, { cast: false });
      // interiors only exist as geometry when somebody can see them
      if (d - B.radius < 70 && B.lay.furn.length) {
        if (B.intDirty || !B.intMesh) this.rebuildInterior(B);
        if (B.intMesh) r.add(B.intMesh, B.model, { cast: false });
      }
      if (B.lifts && B.lifts.length && d - B.radius < 90) this.drawLifts(B, cam, d);
      if (d - B.radius > 260) continue;
      if (B.doors) for (const D of B.doors) {
        const P = D.P; if (P.state !== 'fixed') continue;
        if (!P.dmesh) P.dmesh = this.freeMesh(P);
        const pose = this.doorPose(D);
        m4.fromTRS(P._m || (P._m = new Float32Array(16)), [B.x + pose.pos[0], pose.pos[1], B.z + pose.pos[2]], pose.q, 1);
        r.add(P.dmesh, P._m, { cast: d - B.radius < 60 });
      }
      if (d - B.radius < 70) for (const it of B.lay.furn) {
        const fb = it.body; if (!fb) continue;
        if (!it.mesh) it.mesh = this.furnMesh(it);
        if (!it._m) it._m = new Float32Array(16);
        m4.fromTRS(it._m, fb.pos, fb.q, 1);
        r.add(it.mesh, it._m, { cast: false });
      }
      for (const P of B.free) {
        const b = P.body;
        m4.fromTRS(P._m, b.pos, b.q, 1);
        r.add(P.mesh, P._m, { cast: d - B.radius < 90 });
      }
    }
  }
}
