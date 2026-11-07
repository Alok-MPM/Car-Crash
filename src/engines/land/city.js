// CITY / LAND ENGINE. One seed -> roads of every type, building lots with parking, lawns, street trees, parks, farmland and forests.
// Nothing here is hand placed: it reads the catalogs (data/land.js, buildings catalog / facade composer) and streams buildings in and out around the player.
import { ROADS, GROUND, CROPS, TREES, TREE_SETS, PARKING } from '../../data/land.js';
import { Builder, M } from '../cars/carmodel.js';
import { rbox, cylinder } from '../../core/geo.js';
import { mulberry32 } from '../../core/math.js';

const H = 0.012;   // base height of flat land layers above the tarmac plane (avoids z-fight, cars drive over them)
const hash = (a, b, c = 0) => (Math.imul(a | 0, 73856093) ^ Math.imul(b | 0, 19349663) ^ Math.imul(c | 0, 83492791)) >>> 0;

// ---------------------------------------------------------------- planning (pure data, no rendering)
export function planCity({ seed = 1, cx = 1200, cz = -1200, half = 2, pitch = 100, farmR = 700 } = {}) {
  const rnd = mulberry32(seed);
  const roads = [], lots = [], pads = [], lawns = [], fields = [], trees = [], plots = [], chowks = [], ponds = [];
  const R = (type, axis, c, a0, a1) => roads.push({ type, axis, c, a0, a1, w: ROADS[type].w });
  const ext = half * pitch + 8;
  // ---- Indian-style fabric: an old dense core (irregular bazaar + galis) around a chowk with the mandir, planned colonies outside it.
  // Road spacing is irregular, widths vary by district, some lanes dead-end, and the town has a pond.
  const zs = [], xs = []; { let z = -ext; while (z < ext) { zs.push(z); z += pitch * (0.62 + rnd() * 0.6); } zs.push(ext); let x = -ext; while (x < ext) { xs.push(x); x += pitch * (0.7 + rnd() * 0.6); } xs.push(ext); }
  const zMid = zs.reduce((m, v) => (Math.abs(v) < Math.abs(m) ? v : m), zs[0]), xMid = xs.reduce((m, v) => (Math.abs(v) < Math.abs(m) ? v : m), xs[0]);
  const typeFor = (u, mid, isMain) => (u === mid ? (isMain ? 'bazaar' : 'city') : Math.abs(u - mid) < pitch * 1.1 ? 'gali' : 'city');
  zs.forEach((z) => R(typeFor(z, zMid, true), 'x', cz + z, cx - ext, cx + ext));
  xs.forEach((x, i) => { const t = typeFor(x, xMid, false); const trunc = t === 'gali' && rnd() < 0.5; R(t, 'z', cx + x, trunc ? cz - ext + rnd() * ext * 0.9 : cz - ext, cz + ext); });
  R('highway', 'x', cz + ext + 260, cx - 2400, cx + 2400);
  R('expressway', 'z', cx - ext - 240, cz - 2000, cz + ext + 260);
  R('village', 'x', cz + zMid, cx + ext, cx + 1500);
  R('village', 'z', cx + ext + 420, cz - 900, cz + 120);
  R('offroad', 'x', cz - 480, cx + ext + 420, cx + 1400);
  R('offroad', 'z', cx + ext + 900, cz - 900, cz + 120);
  R('offroad', 'x', cz + 400, cx - ext - 240, cx - 900);
  // village cluster by the east road: houses around a pond with its own small mandir
  const vx = cx + ext + 600, vz = cz + zMid - 8;

  // road test helpers
  const onRoad = (x, z, m = 0, skip = null) => roads.some((r) => r !== skip && (r.axis === 'x' ? Math.abs(z - r.c) < r.w / 2 + m && x > r.a0 - m && x < r.a1 + m : Math.abs(x - r.c) < r.w / 2 + m && z > r.a0 - m && z < r.a1 + m));
  const rectOnRoad = (x0, z0, x1, z1, m) => onRoad((x0 + x1) / 2, (z0 + z1) / 2, 0) || [[x0, z0], [x1, z0], [x0, z1], [x1, z1], [(x0 + x1) / 2, z0], [(x0 + x1) / 2, z1], [x0, (z0 + z1) / 2], [x1, (z0 + z1) / 2]].some(([x, z]) => onRoad(x, z, m));
  const inCity = (x, z, m = 0) => Math.abs(x - cx) < ext + m && Math.abs(z - cz) < ext + m;

  // ---- lots on the north side of every east-west road (buildings face +z = towards the road); dense in the core, with parking pads in colonies
  const ewRoads = roads.filter((q) => q.axis === 'x' && (q.type === 'bazaar' || q.type === 'gali' || q.type === 'city') && q.c >= cz - ext - 1 && q.c <= cz + ext + 1);
  const nsRoads = roads.filter((q) => q.axis === 'z' && q.a0 < cz + ext);
  for (const er of ewRoads) {
    const zr = er.c, rw = er.w, core = Math.hypot(0, zr - cz) < pitch * 1.3 && er.type !== 'city' || er.type === 'bazaar';
    const setback = er.type === 'bazaar' ? 1.2 : er.type === 'gali' ? 1.6 : 4.5, zFront = zr - rw / 2 - setback - (er.type === 'bazaar' ? 2 : 0);
    const cuts = nsRoads.filter((q) => zr > q.a0 - 2 && zr < q.a1 + 2).map((q) => [q.c - q.w / 2 - 1, q.c + q.w / 2 + 1]).sort((a1, b1) => a1[0] - b1[0]);
    let x = cx - ext + 3;
    const xEndAll = cx + ext - 3;
    while (x < xEndAll - 9) {
      const cut = cuts.find((c) => x > c[0] - 0.01 && x < c[1]);                // skip over crossing roads
      if (cut) { x = cut[1] + 0.5; continue; }
      const nextCut = cuts.find((c) => c[0] >= x); const xEnd = Math.min(xEndAll, nextCut ? nextCut[0] : xEndAll);
      if (xEnd - x < 9) { x = (nextCut ? nextCut[1] : xEndAll) + 0.5; continue; }
      const dd = Math.hypot(x - cx, zr - cz) / (half * pitch);
      const r = rnd(); let brief, w, d;
      const old = dd < 0.55;
      if (old && er.type === 'bazaar') { w = 5 + Math.floor(rnd() * 5); d = 8 + Math.floor(rnd() * 3); brief = { kind: 'house', w: Math.max(6, w), d, floors: 2 + Math.floor(rnd() * 3), style: r < 0.5 ? 'brick' : 'classic', shopGround: true }; }
      else if (old) { w = 6 + Math.floor(rnd() * 4); d = 7 + Math.floor(rnd() * 4); brief = { kind: 'house', w, d, floors: 2 + Math.floor(rnd() * 3), style: r < 0.45 ? 'classic' : r < 0.75 ? 'brick' : 'modern', facade: undefined }; }
      else if (dd < 0.5 && r < 0.2) { w = 14 + Math.floor(rnd() * 3) * 2; d = 11 + Math.floor(rnd() * 3); brief = { kind: 'tower', w, d, floors: 5 + Math.floor(rnd() * 5), style: 'glass' }; }
      else {
        w = 9 + Math.floor(rnd() * 5); d = 8 + Math.floor(rnd() * 4);
        const sr = rnd(), style = sr < 0.38 ? 'modern' : sr < 0.58 ? 'dark' : sr < 0.88 ? 'classic' : 'brick';
        brief = { kind: 'house', w, d, floors: 2 + Math.floor(rnd() * 3), style, garage: rnd() < 0.55, facade: style === 'modern' || style === 'dark' ? 'auto' : undefined };
      }
      const wantPad = !old && er.type === 'city';
      const padW = wantPad ? (brief.kind === 'tower' ? 6.4 : 3.4) : 0, gap = old ? 0.45 : 1.6;
      const lotW = brief.w + padW + gap;
      if (x + lotW > xEnd) { x = (nextCut ? nextCut[1] : xEndAll) + 0.5; continue; }
      const padLeft = rnd() < 0.5, bx = x + (padLeft && padW ? padW + 0.8 : 0) + brief.w / 2;
      brief.seed = hash(Math.round(bx), Math.round(zFront), seed) % 100000 + 1;
      lots.push({ id: lots.length, x: bx, z: zFront - brief.d / 2, zFront, w: brief.w, d: brief.d, brief, B: null });
      if (padW) { const px0 = padLeft ? x : bx + brief.w / 2 + 0.8; pads.push({ x0: px0, x1: px0 + padW, z0: zFront - 6.2, z1: zFront, apron: [px0 + 0.3, zFront, px0 + padW - 0.3, zr - rw / 2], bays: Math.max(1, Math.round(padW / PARKING.bayW)) }); }
      if (!old) lawns.push({ x0: bx - brief.w / 2 - 0.4, x1: bx + brief.w / 2 + 0.4, z0: zFront, z1: zr - rw / 2 - 0.3 });
      x += lotW;
    }
  }
  // the mandir on the chowk: north of the bazaar at the central crossing
  { const zr = cz + zMid; const mz = zr - ROADS.bazaar.w / 2 - 6 - 8; lots.push({ id: lots.length, x: cx + xMid, z: mz, zFront: mz + 8, w: 16, d: 16, recipe: 'mandir', B: null }); chowks.push({ x0: cx + xMid - 14, x1: cx + xMid + 14, z0: zr - 14, z1: zr + 14 }); }
  // village: small classic houses around a pond (houses face the road, pond behind)
  { const row = (zz, n, x0) => { for (let i = 0; i < n; i++) { const w = 7 + Math.floor(rnd() * 3), d = 7 + Math.floor(rnd() * 2); lots.push({ id: lots.length, x: x0 + i * 11, z: zz - d / 2, zFront: zz, w, d, brief: { kind: 'house', w, d, floors: 1 + Math.floor(rnd() * 2), style: rnd() < 0.7 ? 'classic' : 'brick', seed: hash(i, zz, seed) % 100000 + 1 }, B: null }); } };
    row(vz - 4.5, 7, vx - 38); ponds.push({ x: vx, z: vz + 36, rx: 22, rz: 14 });
    for (let t = 0; t < 22; t++) { const a = (t / 22) * Math.PI * 2; trees.push({ x: vx + Math.cos(a) * 26, z: vz + 36 + Math.sin(a) * 18, set: 'village', s: rnd(), s2: rnd(), s3: rnd() }); } }
  // town pond in one block of the old city
  ponds.push({ x: cx - pitch * 0.8, z: cz - pitch * 0.9, rx: 20, rz: 13 });

  // ---- open land between roads: grass + trees (mostly in the planned colonies; the old core is built up)
  for (let i = 0; i < zs.length - 1; i++) for (let j = 0; j < xs.length - 1; j++) {
    const x0 = cx + xs[j] + 6, x1 = cx + xs[j + 1] - 6, z0 = cz + zs[i] + 6, z1 = cz + zs[i + 1] - 6;
    if (x1 - x0 < 12 || z1 - z0 < 30) continue;
    plots.push({ x0, x1, z0, z1, kind: 'grass' });
    const old = Math.hypot((x0 + x1) / 2 - cx, (z0 + z1) / 2 - cz) < pitch * 1.2, n = old ? 4 : 14 + Math.floor(rnd() * 10);
    for (let t = 0; t < n; t++) { const x = x0 + 3 + rnd() * (x1 - x0 - 6), z = z0 + 3 + rnd() * (z1 - z0 - 26); trees.push({ x, z, set: 'park', s: rnd(), s2: rnd(), s3: rnd() }); }
  }
  // street trees on the south side of each city road (opposite the lots)
  for (const r of roads) if ((r.type === 'city') && r.axis === 'x') for (let x = r.a0 + 14; x < r.a1 - 14; x += 17 + rnd() * 5) if (!onRoad(x, r.c + r.w / 2 + 2, 1, r)) trees.push({ x, z: r.c + r.w / 2 + 2.2, set: 'street', s: rnd(), s2: rnd(), s3: rnd() });

  // ---- farmland outside the city
  const FW = 70, FD = 90, gap = 8;
  for (let gx = -Math.ceil(farmR / (FW + gap)); gx <= Math.ceil(farmR / (FW + gap)); gx++) for (let gz = -Math.ceil(farmR / (FD + gap)); gz <= Math.ceil(farmR / (FD + gap)); gz++) {
    const x0 = cx + gx * (FW + gap) + (hash(gx, gz, 1) % 13) - 6, z0 = cz + gz * (FD + gap) + (hash(gx, gz, 2) % 17) - 8;
    const x1 = x0 + FW - (hash(gx, gz, 3) % 14), z1 = z0 + FD - (hash(gx, gz, 4) % 16);
    if (Math.hypot((x0 + x1) / 2 - cx, (z0 + z1) / 2 - cz) > farmR) continue;
    if (inCity(x0, z0, 60) || inCity(x1, z1, 60) || inCity(x0, z1, 60) || inCity(x1, z0, 60)) continue;
    if (rectOnRoad(x0, z0, x1, z1, 6)) continue;
    fields.push({ x0, x1, z0, z1, crop: CROPS[hash(gx, gz, 5) % CROPS.length], dir: hash(gx, gz, 6) & 1 });
    if (hash(gx, gz, 7) % 3 === 0) trees.push({ x: x0 - 2.5, z: (z0 + z1) / 2 + (hash(gx, gz, 8) % 20) - 10, set: 'farm', s: rnd(), s2: rnd(), s3: rnd() });
  }
  // forests: patches at the edge of the farm belt
  for (let f = 0; f < 7; f++) {
    const a = rnd() * Math.PI * 2, rr = farmR * (0.8 + rnd() * 0.5), fx = cx + Math.cos(a) * rr, fz = cz + Math.sin(a) * rr, n = 50 + Math.floor(rnd() * 50);
    for (let t = 0; t < n; t++) { const x = fx + (rnd() - 0.5) * 120, z = fz + (rnd() - 0.5) * 120; if (!onRoad(x, z, 8)) trees.push({ x, z, set: 'forest', s: rnd(), s2: rnd(), s3: rnd() }); }
  }
  return { seed, cx, cz, half, pitch, ext, roads, lots, pads, lawns, plots, fields, trees, chowks, ponds, onRoad };
}

// ---------------------------------------------------------------- land meshes (roads, markings, fields, trees)
const PART = { water: 21, chowk: 22, dry: 0, grass: 1, soil: 2, plough: 3, wheat: 4, paddy: 5, mustard: 6, paver: 7, footpath: 8, white: 9, yellow: 10, curb: 11, median: 12, roadHigh: 13, roadExp: 14, roadCity: 15, roadVil: 16, roadOff: 17, trunk: 18, leafA: 19, leafB: 20 };
const MATC = (c, rough = 0.95) => ({ kind: 0, base: c, rough, poly: true });

export function buildLand(r, plan) {
  const parts = {}; const B = (k) => parts[k] || (parts[k] = new Builder([0, 0, 0]));
  const flat = new Map();
  const slab = (bd, part, x0, z0, x1, z1, y0, y1) => bd.addGeo(rbox(Math.max((x1 - x0) / 2, 0.001), (y1 - y0) / 2, Math.max((z1 - z0) / 2, 0.001), 0.0005, 1), 'paint', part, M.tr((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
  const Q = (key, part, x0, z0, x1, z1, y0 = H, hh = 0.003) => slab(B(key), part, x0, z0, x1, z1, y0, y0 + hh);
  const { cx, cz, ext, roads } = plan;

  // ground cover: dry grass everywhere, green inside the city
  Q('land', PART.dry, cx - 3400, cz - 3400, cx + 3400, cz + 3400, 0.002, 0.002);
  Q('land', PART.grass, cx - ext - 30, cz - ext - 30, cx + ext + 30, cz + ext + 30, 0.004, 0.002);
  for (const f of plan.fields) {
    Q('land', PART[f.crop], f.x0, f.z0, f.x1, f.z1, 0.006, 0.002);
    // crop rows
    const dark = f.crop === 'plough' ? PART.soil : f.crop === 'wheat' ? PART.mustard : PART.grass;
    if (f.crop !== 'mustard') for (let t = 1.2; t < (f.dir ? f.x1 - f.x0 : f.z1 - f.z0) - 1; t += 3.4) {
      if (f.dir) Q('land', dark, f.x0 + t, f.z0 + 1, f.x0 + t + 0.7, f.z1 - 1, 0.008, 0.002);
      else Q('land', dark, f.x0 + 1, f.z0 + t, f.x1 - 1, f.z0 + t + 0.7, 0.008, 0.002);
    }
  }
  // roads (bigger roads sit a hair higher so intersections are clean), footpaths, kerbs and markings
  const roadPart = { highway: PART.roadHigh, expressway: PART.roadExp, city: PART.roadCity, bazaar: PART.roadCity, gali: PART.roadVil, village: PART.roadVil, offroad: PART.roadOff };
  const yOf = { highway: 0.016, expressway: 0.015, city: 0.014, bazaar: 0.0145, gali: 0.0135, village: 0.013, offroad: 0.012 };
  const A = (rd, t0, t1, c0, c1, part, y, hh = 0.003) => rd.axis === 'x' ? Q('road', part, t0, rd.c + c0, t1, rd.c + c1, y, hh) : Q('road', part, rd.c + c0, t0, rd.c + c1, t1, y, hh);
  for (const rd of roads) {
    const T = ROADS[rd.type], y = yOf[rd.type], hw = rd.w / 2;
    if (T.footpath) { A(rd, rd.a0, rd.a1, -hw - T.footpath, -hw, PART.footpath, 0.008); A(rd, rd.a0, rd.a1, hw, hw + T.footpath, PART.footpath, 0.008); }
    A(rd, rd.a0, rd.a1, -hw, hw, roadPart[rd.type], y, 0.004);
    if (T.shoulder > 0.5 && rd.type !== 'village') { A(rd, rd.a0, rd.a1, -hw, -hw + T.shoulder, PART.curb, y + 0.004, 0.001); A(rd, rd.a0, rd.a1, hw - T.shoulder, hw, PART.curb, y + 0.004, 0.001); }
  }
  const crossing = (rd, t) => { const x = rd.axis === 'x' ? t : rd.c, z = rd.axis === 'x' ? rd.c : t; return plan.onRoad(x, z, 1.5, rd); };
  const my = (rd) => yOf[rd.type] + 0.0045;
  for (const rd of roads) {
    const T = ROADS[rd.type], hw = rd.w / 2, y = my(rd);
    const line = (c, w, part, dash) => {
      if (!dash) { let s = rd.a0; for (let t = rd.a0; t <= rd.a1; t += 4) { const bad = crossing(rd, t + 2); if (!bad) { if (s === null) s = t; } else if (s !== null) { if (t - s > 1) A(rd, s, t, c - w / 2, c + w / 2, part, y, 0.002); s = null; } } if (s !== null) A(rd, s, rd.a1, c - w / 2, c + w / 2, part, y, 0.002); }
      else for (let t = rd.a0 + 2; t < rd.a1 - 4; t += dash[1]) { if (crossing(rd, t) || crossing(rd, t + dash[0])) continue; A(rd, t, t + dash[0], c - w / 2, c + w / 2, part, y, 0.002); }
    };
    if (T.edge === 'solid') { line(-hw + (T.shoulder || 0) + 0.3, 0.15, PART.white); line(hw - (T.shoulder || 0) - 0.3, 0.15, PART.white); }
    if (T.centre === 'dash') line(0, 0.15, PART.yellow, [3, 9]);
    if (T.centre === 'double') { line(-0.12, 0.12, PART.yellow); line(0.12, 0.12, PART.yellow); }
    if (T.centre === 'median') { A(rd, rd.a0, rd.a1, -T.median / 2, T.median / 2, PART.median, y, 0.02); }
    if (T.lanes > 1 || T.centre === 'median' || T.centre === 'double') {
      const lw = (rd.w - (T.median || 0) - 2 * (T.shoulder || 0)) / (2 * T.lanes);
      for (let side = -1; side <= 1; side += 2) for (let l = 1; l < T.lanes; l++) line(side * ((T.median || 0.24) / 2 + l * lw), 0.13, PART.white, [3, 9]);
    }
    // stop lines on city roads at junctions are left to the intersection logic later
  }
  for (const c of plan.chowks) Q('lot', PART.chowk, c.x0, c.z0, c.x1, c.z1, 0.016, 0.003);
  for (const p of plan.ponds) { const n = 18; for (let i = 0; i < n; i++) { const a0 = (i / n) * Math.PI, c = Math.cos(a0) * p.rx; const wz = Math.sin(a0) * p.rz; Q('lot', PART.water, p.x - c, p.z - wz, p.x + c, p.z + wz + 0.0001, 0.011, 0.002); } }
  // parking pads, aprons and bays, lawns
  for (const p of plan.pads) {
    Q('lot', PART.paver, p.x0, p.z0, p.x1, p.z1, 0.014, 0.003);
    const [ax0, az0, ax1, az1] = p.apron; Q('lot', PART.paver, ax0, az0, ax1, az1, 0.014, 0.003);
    const bw = (p.x1 - p.x0) / p.bays;
    for (let b = 0; b <= p.bays; b++) Q('lot', PART.white, p.x0 + b * bw - 0.05, p.z0 + 0.4, p.x0 + b * bw + 0.05, p.z1 - 0.8, 0.0175, 0.002);
  }
  for (const l of plan.lawns) Q('lot', PART.grass, l.x0, l.z0, l.x1, l.z1, 0.01, 0.003);

  const meshes = [];
  const PM = { [PART.dry]: MATC(GROUND.grassDry.color), [PART.grass]: MATC(GROUND.grass.color), [PART.soil]: MATC(GROUND.soil.color), [PART.plough]: MATC(GROUND.plough.color), [PART.wheat]: MATC(GROUND.wheat.color), [PART.paddy]: MATC(GROUND.paddy.color), [PART.mustard]: MATC(GROUND.mustard.color), [PART.paver]: MATC(GROUND.paver.color, 0.85), [PART.footpath]: MATC(GROUND.footpath.color, 0.9), [PART.white]: MATC(GROUND.white.color, 0.7), [PART.yellow]: MATC(GROUND.yellow.color, 0.7), [PART.curb]: MATC(GROUND.curb.color, 0.8), [PART.median]: MATC([0.2, 0.32, 0.12]), [PART.roadHigh]: MATC(ROADS.highway.color, 0.9), [PART.roadExp]: MATC(ROADS.expressway.color, 0.9), [PART.roadCity]: MATC(ROADS.city.color, 0.9), [PART.roadVil]: MATC(ROADS.village.color, 0.95), [PART.roadOff]: MATC(ROADS.offroad.color, 1), [PART.water]: MATC(GROUND.water.color, 0.15), [PART.chowk]: MATC(GROUND.chowk.color, 0.9), [PART.trunk]: MATC([0.18, 0.12, 0.07]), [PART.leafA]: MATC([0.14, 0.28, 0.09]), [PART.leafB]: MATC([0.17, 0.32, 0.1]) };
  for (const k of Object.keys(parts)) { const f = parts[k].finish(); f.groups.forEach((g) => { g.mat = PM[g.part]; }); meshes.push(r.createMesh(f.geo, { groups: f.groups, radius: 9000 })); }

  // trees: merged per 240 m cell so they can be distance culled
  const cell = new Map();
  for (const t of plan.trees) {
    const sp = TREES[TREE_SETS[t.set][Math.floor(t.s * 97) % TREE_SETS[t.set].length]];
    const key = Math.floor(t.x / 240) + ':' + Math.floor(t.z / 240);
    let c = cell.get(key); if (!c) { c = { b: new Builder([0, 0, 0]), cx: (Math.floor(t.x / 240) + 0.5) * 240, cz: (Math.floor(t.z / 240) + 0.5) * 240 }; cell.set(key, c); }
    const h = sp.h[0] + t.s2 * (sp.h[1] - sp.h[0]), cr = sp.crown[0] + t.s3 * (sp.crown[1] - sp.crown[0]), la = sp.leaf[t.s3 > 0.5 ? 1 : 0];
    const col = [la[0] / 0.14, la[1] / 0.28, la[2] / 0.09];
    c.b.addGeo(cylinder(sp.trunk * 0.7, sp.trunk, h * 0.55, 6), 'paint', PART.trunk, M.tr(t.x, h * 0.275, t.z));
    if (sp.kind === 'broad') c.b.addGeo(rbox(cr, cr * 0.75, cr, cr * 0.8, 2), 'paint', PART.leafA, M.tr(t.x, h * 0.55 + cr * 0.55, t.z), col);
    else for (let i = 0; i < 3; i++) c.b.addGeo(cylinder(0.05, cr * (1.15 - i * 0.28), h * 0.34, 7), 'paint', PART.leafA, M.tr(t.x, h * (0.34 + i * 0.22) + h * 0.17, t.z), col);
  }
  const treeMeshes = [];
  for (const c of cell.values()) { const f = c.b.finish(); f.groups.forEach((g) => { g.mat = PM[g.part]; }); treeMeshes.push({ m: r.createMesh(f.geo, { groups: f.groups, radius: 220 }), cx: c.cx, cz: c.cz }); }
  return { meshes, treeMeshes };
}

// ---------------------------------------------------------------- streaming of buildings around the player
export class CityStreamer {
  constructor(plan, structures) { this.plan = plan; this.S = structures; this.t = 0; this.inR = 230; this.outR = 420; this.built = 0; }
  // build the nearest buildings right away (used when entering the city, shows as one short loading moment)
  prime(pts, n = 10) { const lots = this.plan.lots.filter((l) => !l.B && !l.dead).map((l) => ({ l, d: Math.min(...pts.map((p) => Math.hypot(l.x - p.x, l.z - p.z))) })).sort((a, b) => a.d - b.d).slice(0, n); for (const { l, d } of lots) if (d < this.inR) { try { l.B = this.S.addBuilding(l.recipe ? { recipe: l.recipe, x: l.x, z: l.z } : { brief: { ...l.brief }, x: l.x, z: l.z }); } catch (e) { l.dead = true; } } }
  update(dt, pts) {
    this.t -= dt; if (this.t > 0) return; this.t = 0.4;
    let made = 0;
    for (const l of this.plan.lots) {
      let dmin = 1e9; for (const p of pts) dmin = Math.min(dmin, Math.hypot(l.x - p.x, l.z - p.z));
      if (!l.B && !l.dead && dmin < this.inR && made < 1) {
        try { l.B = this.S.addBuilding(l.recipe ? { recipe: l.recipe, x: l.x, z: l.z } : { brief: { ...l.brief }, x: l.x, z: l.z }); this.built++; made++; } catch (e) { console.warn('lot failed', l.id, e.message); l.B = null; l.dead = true; }
      } else if (l.B && dmin > this.outR && !(l.B.freed > 0)) { this.S.removeBuilding(l.B); l.B = null; this.built--; }
    }
  }
}
