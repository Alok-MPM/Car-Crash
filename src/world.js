// The proving ground: tarmac, runway with markings, crash yard full of breakable props, ramps, parked cars.
import { Body, GROUP } from './physics.js';
import { rbox, cylinder, lathe, box, plane, torus, extrude, merge, trs, makeGeo, fixWinding } from './geo.js';
import { m4, mulberry32, clamp } from './math.js';
import { Builder, M } from './carmodel.js';
import { Structures } from './buildings.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));

function canvas(w, h, draw) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  return c;
}

export class Scene {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    const { r, world } = ctx;
    this.r = r; this.world = world;
    this.rng = mulberry32(1234);
    this.props = [];
    this.statics = [];
    this.q = opts.density ?? 1;
    this.tex = {};
    this.meshes = {};
    this.makeTextures();
    this.makeMeshes();
    this.buildStatic();
    this.populate();
  }

  makeTextures() {
    const r = this.r;
    const wood = canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#8a6137'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) { g.fillStyle = `rgba(${60 + Math.random() * 40},${35 + Math.random() * 25},15,0.35)`; g.fillRect(0, i * 32, w, 32); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, i * 32, w, 2); }
      for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(40,25,10,${Math.random() * 0.2})`; g.fillRect(Math.random() * w, Math.random() * h, 40 * Math.random(), 1); }
      g.strokeStyle = '#4a3018'; g.lineWidth = 14; g.strokeRect(7, 7, w - 14, h - 14);
      g.lineWidth = 12; g.beginPath(); g.moveTo(10, 10); g.lineTo(w - 10, h - 10); g.moveTo(w - 10, 10); g.lineTo(10, h - 10); g.stroke();
    });
    if (wood) this.tex.wood = r.texFromCanvas(wood, { repeat: true });
    const cont = canvas(256, 128, (g, w, h) => {
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 8) { g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(x, 0, 3, h); g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 4, 0, 2, h); }
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(80,40,10,${Math.random() * 0.12})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 14 * Math.random()); }
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
    });
    if (cont) this.tex.cont = r.texFromCanvas(cont, { repeat: true });
    const block = canvas(128, 128, (g, w, h) => {
      g.fillStyle = '#ddd'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 1500; i++) { const v = 180 + Math.random() * 60; g.fillStyle = `rgba(${v},${v},${v},0.5)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(24, 40, 30, 48); g.fillRect(74, 40, 30, 48);
    });
    if (block) this.tex.block = r.texFromCanvas(block, { repeat: true });
    const hazard = canvas(128, 128, (g, w, h) => {
      g.fillStyle = '#b30f0f'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd400'; g.fillRect(0, 50, w, 28);
      g.fillStyle = '#111'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('FLAMMABLE', w / 2, 70);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, w, 5); g.fillRect(0, h - 5, w, 5);
    });
    if (hazard) this.tex.hazard = r.texFromCanvas(hazard, { repeat: true });
  }

  makeMeshes() {
    const r = this.r, T = this.tex;
    const mk = (geo, mat, extra = {}) => r.createMesh(geo, { mat, ...extra });
    const M_ = this.meshes;
    // concrete block
    M_.block = mk(rbox(0.4, 0.2, 0.2, 0.012, 1), { kind: 6, base: [0.78, 0.78, 0.76], rough: 0.92, tex: T.block });
    // brick variants
    M_.crate = mk(rbox(0.5, 0.5, 0.5, 0.015, 1), { kind: 6, base: [1, 1, 1], rough: 0.85, tex: T.wood });
    M_.crateS = mk(rbox(0.3, 0.3, 0.3, 0.012, 1), { kind: 6, base: [1, 1, 1], rough: 0.85, tex: T.wood });
    // barrels (groups: body + rings)
    const barrelProf = [[0.0001, -0.45], [0.26, -0.45], [0.29, -0.4], [0.29, -0.3], [0.285, -0.27], [0.29, -0.24], [0.295, 0], [0.29, 0.24], [0.285, 0.27], [0.29, 0.3], [0.29, 0.4], [0.26, 0.45], [0.0001, 0.45]];
    const bgeo = lathe(barrelProf, 20);
    M_.barrel = mk(bgeo, { kind: 0, base: [0.05, 0.2, 0.7], rough: 0.4, metal: 0.4 });
    M_.barrelRed = mk(bgeo, { kind: 6, base: [1, 1, 1], rough: 0.4, metal: 0.2, tex: T.hazard });
    M_.barrelY = mk(bgeo, { kind: 0, base: [0.85, 0.65, 0.05], rough: 0.4, metal: 0.4 });
    // cone with stripes
    {
      const b = new Builder([0, 0, 0]);
      b.addGeo(cylinder(0.04, 0.17, 0.5, 14, true, false), 'paint', 0, M.tr(0, 0.25 + 0.02, 0));
      b.addGeo(rbox(0.19, 0.02, 0.19, 0.01, 1), 'paint', 0, M.tr(0, 0.01, 0));
      b.addGeo(cylinder(0.083, 0.11, 0.1, 14, false, false), 'chrome', 0, M.tr(0, 0.25, 0));
      const f = b.finish();
      f.groups.forEach((g) => { g.mat = g.mat === 'paint' ? { kind: 0, base: [0.9, 0.22, 0.02], rough: 0.5 } : { kind: 0, base: [0.9, 0.9, 0.9], rough: 0.5 }; });
      M_.cone = r.createMesh(f.geo, { groups: f.groups });
    }
    M_.tire = mk(torus(0.24, 0.12, 20, 10), { kind: 5, base: [0.025, 0.025, 0.027], rough: 0.9 });
    // jersey barrier
    {
      const poly = [[-0.31, 0], [0.31, 0], [0.22, 0.25], [0.12, 0.8], [-0.12, 0.8], [-0.22, 0.25]];
      const g = extrude(poly, 3.0);
      M_.jersey = mk(g, { kind: 0, base: [0.55, 0.55, 0.53], rough: 0.95 });
    }
    // container
    const cont = (col) => mk(rbox(3.05, 1.3, 1.2, 0.04, 1), { kind: 6, base: lin(col), rough: 0.55, metal: 0.3, tex: T.cont, texScale: 1 });
    M_.contR = cont([0.7, 0.18, 0.12]); M_.contB = cont([0.1, 0.3, 0.6]); M_.contG = cont([0.15, 0.45, 0.25]); M_.contY = cont([0.8, 0.6, 0.1]);
    // pallet
    {
      const b = new Builder([0, 0, 0]);
      for (const z of [-0.45, 0, 0.45]) b.addGeo(rbox(0.6, 0.05, 0.06, 0.005, 1), 'paint', 0, M.tr(0, 0.07, z));
      for (const z of [-0.45, 0, 0.45]) for (const x of [-0.5, 0, 0.5]) b.addGeo(rbox(0.07, 0.07, 0.07, 0.005, 1), 'paint', 0, M.tr(x * 1.0, 0.0, z * 1.0));
      for (let i = 0; i < 5; i++) b.addGeo(rbox(0.6, 0.012, 0.09, 0.003, 1), 'paint', 0, M.tr(0, 0.14, -0.45 + i * 0.225));
      const f = b.finish();
      f.groups.forEach((g) => (g.mat = { kind: 0, base: lin([0.55, 0.4, 0.22]), rough: 0.9 }));
      M_.pallet = r.createMesh(f.geo, { groups: f.groups });
    }
    // lamp post
    {
      const b = new Builder([0, 0, 0]);
      b.addGeo(cylinder(0.06, 0.1, 7.0, 10), 'chrome', 0, M.tr(0, 3.5, 0));
      b.addGeo(rbox(0.04, 0.04, 0.9, 0.01, 1), 'chrome', 0, M.tr(0, 7.0, 0.8));
      b.addGeo(rbox(0.14, 0.05, 0.3, 0.02, 1), 'lampF', 0, M.tr(0, 6.95, 1.2));
      const f = b.finish();
      f.groups.forEach((g) => (g.mat = g.mat === 'lampF' ? { kind: 3, emis: [2, 1.8, 1.4] } : { kind: 0, base: [0.45, 0.47, 0.5], metal: 0.7, rough: 0.5 }));
      M_.lamp = r.createMesh(f.geo, { groups: f.groups });
    }
    M_.hay = mk(rbox(0.5, 0.3, 0.4, 0.06, 2), { kind: 0, base: lin([0.8, 0.65, 0.25]), rough: 1 });
    M_.bin = mk(cylinder(0.28, 0.22, 0.8, 12), { kind: 0, base: lin([0.15, 0.4, 0.2]), rough: 0.6 });
    M_.pin = mk(lathe([[0.0001, 0], [0.05, 0], [0.06, 0.1], [0.04, 0.25], [0.035, 0.3], [0.05, 0.38], [0.055, 0.45], [0.0001, 0.5]], 12), { kind: 0, base: [0.9, 0.9, 0.9], rough: 0.3 });
    M_.post = mk(rbox(0.08, 0.7, 0.08, 0.01, 1), { kind: 0, base: lin([0.5, 0.38, 0.24]), rough: 0.9 });
    M_.fence = mk(rbox(1.2, 0.5, 0.025, 0.005, 1), { kind: 6, base: [1, 1, 1], rough: 0.85, tex: T.wood, texScale: 1 });
    M_.ball = mk(lathe(Array.from({ length: 13 }, (_, i) => { const a = -Math.PI / 2 + (i / 12) * Math.PI; return [Math.max(0.0001, Math.cos(a) * 0.8), Math.sin(a) * 0.8]; }), 28), { kind: 0, base: [0.55, 0.57, 0.6], metal: 1, rough: 0.28 });
    M_.rampMat = { kind: 0, base: lin([0.45, 0.45, 0.47]), rough: 0.9 };
  }

  // ---------- static scenery / markings ----------
  buildStatic() {
    const { r, world } = this;
    // ground
    this.ground = r.createMesh(plane(24000, 24000, 1, 1), { mat: { kind: 4, base: [1, 1, 1], texScale: 1 } });
    // markings: one merged mesh (white / yellow)
    const white = new Builder([0, 0, 0]), yellow = new Builder([0, 0, 0]);
    const quad = (b, x0, z0, x1, z1) => {
      const hx = (x1 - x0) / 2, hz = (z1 - z0) / 2;
      b.addGeo(rbox(Math.max(hx, 0.001), 0.001, Math.max(hz, 0.001), 0.0005, 1), 'paint', 0, M.tr((x0 + x1) / 2, 0.002, (z0 + z1) / 2));
    };
    const L = 6000;
    // runway edge lines + centre dashes + threshold stripes
    quad(white, -18.2, -L, -18, 40); quad(white, 18, -L, 18.2, 40);
    for (let z = 30; z > -L; z -= 24) quad(yellow, -0.12, z - 12, 0.12, z);
    for (let i = -7; i <= 7; i++) if (i) quad(white, i * 2.2 - 0.5, 10, i * 2.2 + 0.5, 34);
    quad(white, -18, -0.3, 18, 0.3); // start line
    // 100 m ticks along both edges
    for (let z = 0; z > -L; z -= 100) { quad(white, -18.2, z - 0.3, -16.5, z + 0.3); quad(white, 16.5, z - 0.3, 18.2, z + 0.3); }
    // yard floor markings: parking bays
    for (let i = 0; i < 12; i++) quad(white, 100 + i * 3.1, -150, 100 + i * 3.1 + 0.12, -134);
    for (let i = 0; i < 12; i++) quad(white, 100 + i * 3.1, -112, 100 + i * 3.1 + 0.12, -96);
    quad(white, 100, -150, 137, -149.88); quad(white, 100, -96, 137, -95.88);
    // pit box grid on the apron
    for (let i = -12; i <= 12; i++) { quad(white, -120, 60 + i * 0.0 - 0.0, -120, 60); }
    const wf = white.finish(), yf = yellow.finish();
    wf.groups.forEach((g) => (g.mat = { kind: 0, base: [0.8, 0.8, 0.78], rough: 0.7, poly: true }));
    yf.groups.forEach((g) => (g.mat = { kind: 0, base: [0.85, 0.6, 0.05], rough: 0.7, poly: true }));
    this.marks = [r.createMesh(wf.geo, { groups: wf.groups, radius: 8000 }), r.createMesh(yf.geo, { groups: yf.groups, radius: 8000 })];
    this.markModel = m4.fromTRS(new Float32Array(16), [0, 0, 0], [0, 0, 0, 1], 1);
    // distance boards
    this.boards = [];
    for (let k = 1; k <= 24; k++) {
      const z = -k * 250;
      const c = canvas(256, 128, (g, w, h) => { g.fillStyle = '#0a5c36'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12); g.fillStyle = '#fff'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(k * 250 + ' m', w / 2, h / 2 + 4); });
      const tex = c ? r.texFromCanvas(c, {}) : null;
      const m = r.createMesh(rbox(1.4, 0.7, 0.04, 0.01, 1), { mat: { kind: 6, base: [1, 1, 1], rough: 0.5, tex, emis: [0, 0, 0] } });
      this.boards.push({ m, model: m4.fromTRS(new Float32Array(16), [24, 2.2, z], [0, 0, 0, 1], 1) });
      this.boards.push({ m, model: m4.fromTRS(new Float32Array(16), [-24, 2.2, z], [0, 1, 0, 0], 1) });
      this.boards.push({ m: this.meshes.post, model: m4.fromTRS(new Float32Array(16), [24, 0.7, z], [0, 0, 0, 1], 1) });
      this.boards.push({ m: this.meshes.post, model: m4.fromTRS(new Float32Array(16), [-24, 0.7, z], [0, 0, 0, 1], 1) });
    }
    // destructible buildings
    const S = (this.structures = new Structures(this.ctx));
    this.bld = [];
    const house = (x, z, st) => S.addBuilding({ x, z, w: 8, d: 6, floors: 2, style: st || 'plaster', seg: 3 });
    // west district
    S.addBuilding({ x: -90, z: -340, w: 14, d: 14, floors: 9, style: 'glass' });
    S.addBuilding({ x: -130, z: -340, w: 20, d: 14, floors: 6, style: 'concrete' });
    S.addBuilding({ x: -178, z: -340, w: 28, d: 12, floors: 5, style: 'brick' });
    S.addBuilding({ x: -125, z: -405, w: 26, d: 16, floors: 2, style: 'metal', seg: 4 });
    house(-80, -400); house(-68, -400, 'brick'); house(-80, -412); house(-68, -412, 'brick');
    // east district
    S.addBuilding({ x: 70, z: -380, w: 12, d: 12, floors: 7, style: 'concrete' });
    S.addBuilding({ x: 112, z: -380, w: 24, d: 12, floors: 4, style: 'brick' });
    S.addBuilding({ x: 140, z: -305, w: 22, d: 14, floors: 2, style: 'metal', seg: 4 });
    for (let i = 0; i < 6; i++) house(50 + (i % 3) * 12, -300 - Math.floor(i / 3) * 14, i % 2 ? 'brick' : 'plaster');
    // far landmarks
    S.addBuilding({ x: -220, z: -140, w: 30, d: 14, floors: 4, style: 'concrete' });
    S.addBuilding({ x: 260, z: -200, w: 28, d: 14, floors: 3, style: 'brick' });
    S.addBuilding({ x: -250, z: 40, w: 30, d: 18, floors: 2, style: 'metal', seg: 4 });
    S.addBuilding({ x: 240, z: 30, w: 20, d: 14, floors: 5, style: 'glass' });
    // end wall of the runway (stacked concrete blocks)
    S.addBarrier({ x: 0, z: -6100, len: 60, th: 3, h: 6, rows: 2, seg: 3 });
    // ramps (fixed, raycastable)
    this.ramps = [];
    const ramp = (x, z, yaw, len, wid, rise, name) => {
      const ang = Math.atan2(rise, len);
      const th = 0.3;
      const mesh = r.createMesh(rbox(wid / 2, th / 2, Math.hypot(len, rise) / 2, 0.02, 1), { mat: this.meshes.rampMat });
      // box centre so that its top-front edge touches the ground at (z=front)
      const hl = Math.hypot(len, rise) / 2;
      const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
      // local frame: forward -z; pitch about x so the far end rises
      const qp = [Math.sin(ang / 2), 0, 0, Math.cos(ang / 2)]; // rotate about +x: -z end goes up? check numerically below
      const qy = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
      const qm = qmul(qy, qp);
      const cy = rise / 2 - (th / 2) * Math.cos(ang);
      const centerLocal = [0, cy, -len / 2 - (th / 2) * Math.sin(ang) * -1];
      const cw = rotate(qy, centerLocal);
      const pos = [x + cw[0], cw[1], z + cw[2]];
      const b = new Body({ fixed: true, raycast: true, pos, q: qm, fric: 0.9, group: GROUP.STATIC });
      b.addBox([wid / 2, th / 2, hl]);
      world.add(b);
      this.ramps.push({ mesh, body: b });
      return b;
    };
    this.rampFn = ramp;
    // kicker jump 1 at the jump park, and a long ramp
    ramp(100, -420, 0, 22, 9, 3.6);
    ramp(100, -520, Math.PI, 22, 9, 3.6); // landing ramp facing back (descending)
    ramp(-30, -330, 0, 34, 12, 5.2);
    ramp(70, -600, 0, 60, 12, 4);
    // lamp posts: dynamic breakables (created in populate)
  }

  // ---------- props ----------
  body(mass, pos, q, boxes, o = {}) {
    const b = new Body({ mass, pos, q: q || [0, 0, 0, 1], fric: o.fric ?? 0.55, rest: o.rest ?? 0.12, group: GROUP.PROP, linDamp: 0.03, angDamp: 0.15 });
    for (const bx of boxes) b.addBox(bx.he, bx.off, bx.q);
    this.world.add(b);
    return b;
  }
  prop(mesh, mass, pos, yaw, boxes, o = {}) {
    const q = [0, Math.sin((yaw || 0) / 2), 0, Math.cos((yaw || 0) / 2)];
    const b = this.body(mass, pos, q, boxes, o);
    const p = { body: b, mesh, over: o.over, explosive: !!o.explosive, type: o.type || 'prop', hp: o.hp ?? 1, m: new Float32Array(16), radius: o.radius || 2 };
    b.userData = { prop: p };
    this.props.push(p);
    return p;
  }

  populate() {
    const rng = this.rng, M_ = this.meshes, q = this.q;
    const r = rng;
    // --- concrete block wall A
    const wall = (x0, z, cols, rows, yaw = 0) => {
      for (let j = 0; j < rows; j++)
        for (let i = 0; i < cols; i++) {
          const off = (j % 2) * 0.4;
          this.prop(M_.block, 36, [x0 + i * 0.81 + off - cols * 0.4, 0.2 + j * 0.405, z], yaw, [{ he: [0.4, 0.2, 0.2] }], { type: 'block', radius: 0.5, fric: 0.7 });
        }
    };
    wall(-80, -120, 18, 8);
    wall(-80, -126, 14, 6);
    // --- crate pyramid
    const pyramid = (cx, cz, base) => {
      for (let j = 0; j < base; j++) {
        const n = base - j;
        for (let i = 0; i < n; i++) this.prop(M_.crate, 32, [cx + (i - (n - 1) / 2) * 1.02, 0.5 + j * 1.0, cz], 0, [{ he: [0.5, 0.5, 0.5] }], { type: 'crate', radius: 0.9 });
      }
    };
    pyramid(-100, -190, 7);
    pyramid(-118, -200, 5);
    // small crates scattered
    for (let i = 0; i < 12; i++) this.prop(M_.crateS, 10, [-60 + r() * 30, 0.3, -170 - r() * 40], r() * 6, [{ he: [0.3, 0.3, 0.3] }], { type: 'crate', radius: 0.6 });
    // --- barrels
    const barrel = (x, z, kind) => {
      const mesh = kind === 'red' ? M_.barrelRed : kind === 'y' ? M_.barrelY : M_.barrel;
      const a = 0.83 * 0.29;
      return this.prop(mesh, kind === 'red' ? 55 : 28, [x, 0.45, z], r() * 6, [{ he: [a, 0.45, a] }, { he: [a, 0.45, a], q: [0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)] }], { type: 'barrel', explosive: kind === 'red', radius: 0.6, rest: 0.25 });
    };
    for (let i = 0; i < 7; i++) for (let j = 0; j < 8; j++) barrel(-60 + i * 0.75 - 4, -240 - j * 0.75, (i * 3 + j) % 5 === 0 ? 'red' : (i + j) % 3 === 0 ? 'y' : 'b');
    // loose barrels near the runway
    for (let i = 0; i < 10; i++) barrel(30 + r() * 20, -60 - i * 20 - r() * 10, i % 4 === 0 ? 'red' : 'b');
    // --- containers
    const cont = (x, y, z, yaw, mesh) => this.prop(mesh, 2200, [x, y, z], yaw, [{ he: [3.05, 1.3, 1.2] }], { type: 'container', radius: 3.4, fric: 0.6, rest: 0.05 });
    const cm = [M_.contR, M_.contB, M_.contG, M_.contY];
    for (let i = 0; i < 3; i++) cont(-130, 1.3, -70 - i * 2.5 - 0.0, Math.PI / 2, cm[i % 4]);
    for (let i = 0; i < 2; i++) cont(-130, 3.9, -71.2 - i * 2.5, Math.PI / 2, cm[(i + 1) % 4]);
    cont(-130, 6.5, -73.6, Math.PI / 2, cm[3]);
    cont(-150, 1.3, -30, 0.3, cm[1]);
    // --- cone slalom + tire stacks + pins
    const cone = (x, z) => this.prop(M_.cone, 3, [x, 0.25, z], r() * 6, [{ he: [0.14, 0.25, 0.14] }], { type: 'cone', radius: 0.4, rest: 0.3 });
    for (let i = 0; i < 24; i++) cone(60 + (i % 2) * 5, -40 - i * 12);
    for (let i = 0; i < 20; i++) cone(40 + ((i * 7) % 12), -330 - i * 1.5);
    const tire = (x, y, z) => this.prop(M_.tire, 9, [x, y, z], r() * 6, [{ he: [0.34, 0.075 + 0.0, 0.34] }], { type: 'tire', radius: 0.45, rest: 0.4 });
    for (let k = 0; k < 8; k++) for (let j = 0; j < 4; j++) tire(60 + k * 1.0, 0.12 + j * 0.2, -355);
    for (let k = 0; k < 6; k++) for (let j = 0; j < 3; j++) tire(60 + k * 0.9, 0.12 + j * 0.2, -358);
    // bowling pins and a giant ball
    for (let row = 0; row < 4; row++) for (let i = 0; i <= row; i++) this.prop(M_.pin, 4, [-40 + (i - row / 2) * 0.5, 0.25, -300 - row * 0.45], 0, [{ he: [0.06, 0.25, 0.06] }], { type: 'pin', radius: 0.3 });
    // hay bales + pallets
    for (let i = 0; i < 16; i++) this.prop(M_.hay, 18, [20 + (i % 4) * 1.02, 0.3 + Math.floor(i / 8) * 0.6, -250 - ((i >> 2) & 1) * 0.82], 0, [{ he: [0.5, 0.3, 0.4] }], { type: 'hay', radius: 0.7 });
    for (let i = 0; i < 14; i++) this.prop(M_.pallet, 22, [-30 + (i % 7) * 1.4, 0.08, -380 - Math.floor(i / 7) * 1.3], 0, [{ he: [0.6, 0.08, 0.6] }], { type: 'pallet', radius: 0.9 });
    // jersey barriers lining the start of the runway (dynamic, heavy)
    for (let i = 0; i < 16; i++) { this.prop(M_.jersey, 1500, [-21, 0.4, -20 - i * 3.1], 0, [{ he: [0.31, 0.4, 1.5] }], { type: 'barrier', radius: 1.8 }); this.prop(M_.jersey, 1500, [21, 0.4, -20 - i * 3.1], 0, [{ he: [0.31, 0.4, 1.5] }], { type: 'barrier', radius: 1.8 }); }
    // lamp posts along the runway
    for (let i = 0; i < 40; i++) {
      const z = -80 - i * 90;
      this.prop(M_.lamp, 140, [-26, 3.5, z], 0, [{ he: [0.1, 3.5, 0.1] }], { type: 'lamp', radius: 3 });
      this.prop(M_.lamp, 140, [26, 3.5, z - 45], Math.PI, [{ he: [0.1, 3.5, 0.1] }], { type: 'lamp', radius: 3 });
    }
    // end-of-runway crash cushion of barrels
    for (let j = 0; j < 8; j++) for (let i = 0; i < 28; i++) barrel(-21 + i * 1.5 + (j % 2) * 0.7, -6080 + j * 1.3, 'b');
    // fence along the apron edge
    for (let i = 0; i < 20; i++) this.prop(M_.fence, 12, [140 + i * 1.25, 0.25, 20], 0, [{ he: [0.6, 0.25, 0.02] }], { type: 'fence', radius: 0.8 });
    // bins
    for (let i = 0; i < 10; i++) this.prop(M_.bin, 8, [150 + i * 1.2, 0.4, -20], 0, [{ he: [0.24, 0.4, 0.24] }], { type: 'bin', radius: 0.4 });
    // wrecking ball sphere target (heavy, rolls)
    this.prop(M_.ball, 2500, [-160, 0.8, -160], 0, [{ he: [0.7, 0.7, 0.7] }, { he: [0.7, 0.7, 0.7], q: [0, 0.3827, 0, 0.9239] }], { type: 'ball', radius: 1, rest: 0.2 });
  }

  update(dt) {
    this.structures.update(dt);
    // remove props that fell absurdly far
    for (const p of this.props) if (p.body.pos[1] < -50) { p.dead = true; }
  }

  // ---------- drawing ----------
  draw(cam) {
    const { r } = this;
    r.add(this.ground, this._gm || (this._gm = m4.fromTRS(new Float32Array(16), [0, 0, 0], [0, 0, 0, 1], 1)), { cast: false });
    for (const m of this.marks) r.add(m, this.markModel, { cast: false });
    const cx = cam[0], cz = cam[2];
    for (const b of this.boards) if (Math.abs(b.model[14] - cz) < 900) r.add(b.m, b.model, { cast: false });
    this.structures.draw(cam);
    for (const rp of this.ramps) r.add(rp.mesh, this._rampModel(rp));
    for (const p of this.props) {
      if (p.dead) continue;
      const b = p.body;
      const dx = b.pos[0] - cx, dz = b.pos[2] - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 > 520 * 520) continue;
      m4.fromTRS(p.m, b.pos, b.q, 1);
      r.add(p.mesh, p.m, { cast: d2 < 110 * 110 });
    }
  }
  _rampModel(rp) {
    if (!rp.m) { rp.m = new Float32Array(16); m4.fromTRS(rp.m, rp.body.pos, rp.body.q, 1); }
    return rp.m;
  }
}

function qmul(a, b) {
  return [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
}
function rotate(q, v) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
