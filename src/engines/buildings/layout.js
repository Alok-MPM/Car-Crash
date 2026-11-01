// Layout generator: structural plan -> list of physical elements (piers, sills, lintels, glass, doors, slabs, columns,
// parapets), rooms and furniture. Pure data in / data out; nothing here touches WebGL or physics.
import { PAINTS, FURNITURE_COLORS } from '../../data/materials.js';

const ROW_H = 1.45;        // masonry panel height (about 17 courses of brick)
const PANEL_W = 1.3;       // panel width along a wall

export function mulberry(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (rng, arr) => arr[(rng() * arr.length) | 0];

export function layout(plan, o = {}) {
  const rng = mulberry(o.seed ?? 1234);
  const { w, d, floors, storeyH: H, slabT, system, sx, sz, spx, spz } = plan;
  const wallH = H - slabT;
  const loadbearing = system === 'loadbearing';
  const paint = { out: pick(rng, o.paintOut || PAINTS.outer), in: pick(rng, PAINTS.inner), trim: pick(rng, PAINTS.trim) };
  const el = [], rooms = [], furn = [], hazards = [];
  let runId = 0;

  const add = (e) => { e.id = el.length; el.push(e); return e; };

  // ---- grid lines (column centres / bearing wall centres)
  const colAt = (f) => plan.storeys[f].col || 0;
  const gx = [], gz = [];
  const outerT = (f) => (loadbearing ? plan.storeys[f].wallT : Math.max(colAt(f), plan.storeys[f].wallT));
  // grid lines are placed for the ground storey, upper storeys follow the same lines
  const t0 = outerT(0);
  for (let a = 0; a <= sx; a++) gx.push(a === 0 ? -w / 2 + t0 / 2 : a === sx ? w / 2 - t0 / 2 : -w / 2 + spx * a);
  for (let c = 0; c <= sz; c++) gz.push(c === 0 ? -d / 2 + t0 / 2 : c === sz ? d / 2 - t0 / 2 : -d / 2 + spz * c);

  // ---- one straight wall, split around its openings into piers / sills / lintels / glass / doors
  function wallRun(r) {
    // r: {axis:'x'|'z', c, a0, a1, f, t, out:[nx,nz]|null, mat, str, ops, interior, plaster}
    const id = runId++;
    const y0 = r.f * H, len = r.a1 - r.a0;
    const ops = (r.ops || []).slice().sort((p, q) => p.a - q.a);
    const mk = (s0, s1, ya, yb, kind, mat, str, extra = {}) => {
      const L = s1 - s0, hh = yb - ya;
      if (L < 0.05 || hh < 0.05) return;
      const am = (s0 + s1) / 2;
      const cx = r.axis === 'x' ? r.a0 + am : r.c, cz = r.axis === 'x' ? r.c : r.a0 + am;
      add({
        kind, mat, str, f: r.f, run: id, axis: r.axis, s0: r.a0 + s0, s1: r.a0 + s1,
        cx, cy: y0 + (ya + yb) / 2, cz,
        hx: r.axis === 'x' ? L / 2 : (extra.t ?? r.t) / 2, hy: hh / 2, hz: r.axis === 'x' ? (extra.t ?? r.t) / 2 : L / 2,
        out: r.out, interior: !!r.interior, ...extra,
      });
    };
    const spanPiers = (s0, s1, ya, yb) => {
      if (s1 - s0 < 0.05) return;
      const nr = Math.max(1, Math.ceil((yb - ya) / ROW_H - 1e-6)), nc = Math.max(1, Math.ceil((s1 - s0) / PANEL_W - 1e-6));
      for (let rr = 0; rr < nr; rr++) for (let cc = 0; cc < nc; cc++) {
        mk(s0 + ((s1 - s0) * cc) / nc, s0 + ((s1 - s0) * (cc + 1)) / nc, ya + ((yb - ya) * rr) / nr, ya + ((yb - ya) * (rr + 1)) / nr, 'wall', r.mat, r.str);
      }
    };
    let cur = 0;
    for (const op of ops) {
      spanPiers(cur, op.a, 0, wallH);
      const s0 = op.a, s1 = op.a + op.wid, top = op.sill + op.hgt;
      if (op.sill > 0.05) spanPiers(s0, s1, 0, op.sill);
      if (wallH - top > 0.05) mk(s0, s1, top, wallH, loadbearing || r.interior ? 'lintel' : 'wall', loadbearing || r.interior ? 'rcc' : r.mat, loadbearing || r.interior ? r.str : false, loadbearing || r.interior ? {} : {});
      if (op.type === 'window') mk(s0 + 0.04, s1 - 0.04, op.sill + 0.04, top - 0.04, 'pane', 'glass', false, { t: 0.04, noWall: true });
      else if (op.type === 'door') mk(s0 + 0.02, s1 - 0.02, 0, top, 'door', 'wood', false, { t: 0.045 });
      cur = s1;
    }
    spanPiers(cur, len, 0, wallH);
  }

  // ---- openings generator for a facade
  function facadeOps(len, kind, f, first = true) {
    const ops = [];
    const target = kind === 'front' && f === 0 ? 3.6 : 3.2;
    const n = Math.max(1, Math.floor(len / target));
    const m = len / n;
    for (let i = 0; i < n; i++) {
      const cc = (i + 0.5) * m;
      let op;
      if (kind === 'front' && f === 0 && i === 0 && first && !plan.spec.noDoor) op = { wid: 1.0, sill: 0, hgt: 2.1, type: 'door' };
      else if (kind === 'front' && f === 0 && i === n - 1 && plan.spec.garage) op = { wid: Math.min(3.0, m - 0.8), sill: 0, hgt: 2.3, type: 'open' };
      else if (kind === 'front' && f > 0 && i === n - 1 && plan.spec.balcony) op = { wid: 1.2, sill: 0, hgt: 2.1, type: 'window', balcony: true };
      else if (kind === 'back' && f === 0 && i === n - 1 && first) op = { wid: 1.0, sill: 0, hgt: 2.1, type: 'door' };
      else op = { wid: kind === 'side' ? 1.0 : 1.2, sill: 0.95, hgt: 1.2, type: 'window' };
      if (plan.spec.storefront && kind === 'front' && f === 0) op = { wid: Math.max(1.5, m - 0.9), sill: 0.15, hgt: wallH - 0.9, type: i === 0 && first ? 'door' : 'window' };
      op.a = cc - op.wid / 2;
      ops.push(op);
    }
    return ops;
  }

  // ---- structure, storey by storey
  const slabsByFloor = [];
  for (let f = 0; f < floors; f++) {
    const st = plan.storeys[f];
    const T = loadbearing ? st.wallT : st.wallT;
    const col = st.col;
    const front = f; // for readability
    if (!loadbearing) {
      // RCC columns on every grid point (core area skipped in tall frames)
      const core = plan.core ? { ax: Math.min(3, w * 0.2), az: Math.min(3, d * 0.2) } : null;
      for (let a = 0; a <= sx; a++) for (let c = 0; c <= sz; c++) {
        const cxx = a === 0 ? -w / 2 + col / 2 : a === sx ? w / 2 - col / 2 : gx[a];
        const czz = c === 0 ? -d / 2 + col / 2 : c === sz ? d / 2 - col / 2 : gz[c];
        if (core && Math.abs(cxx) < core.ax + 0.3 && Math.abs(czz) < core.az + 0.3) continue;
        add({ kind: 'col', mat: 'rcc', str: true, f, cx: cxx, cy: f * H + wallH / 2, cz: czz, hx: col / 2, hy: wallH / 2, hz: col / 2, out: null, col: true });
      }
      if (core) {
        const { ax, az } = core, t = 0.175;
        for (const sg of [-1, 1]) {
          add({ kind: 'wall', mat: 'rcc', str: true, f, cx: 0, cy: f * H + wallH / 2, cz: sg * (az - t), hx: ax, hy: wallH / 2, hz: t, out: null, interior: true, core: true });
          add({ kind: 'wall', mat: 'rcc', str: true, f, cx: sg * (ax - t), cy: f * H + wallH / 2, cz: 0, hx: t, hy: wallH / 2, hz: az - 2 * t, out: null, interior: true, core: true });
        }
      }
    }
    const strWall = loadbearing;
    const mat = plan.fill === 'clayMasonry' ? 'clay' : 'block';
    const inset = loadbearing ? 0 : col;   // frame infill sits between columns
    // exterior runs (S front +z, N back -z, E / W sides)
    const zS = d / 2 - T / 2, zN = -d / 2 + T / 2, xE = w / 2 - T / 2, xW = -w / 2 + T / 2;
    const xa0 = -w / 2 + (loadbearing ? 0 : 0), xa1 = w / 2;
    const frameRuns = (axis, c, from, to, out, kind) => {
      // for frame buildings cut the run at every column line; each bay becomes its own run
      const lines = axis === 'x' ? gx : gz;
      let a0 = from;
      const segs = [];
      for (let i = 0; i < lines.length - 1; i++) segs.push([lines[i] + col / 2, lines[i + 1] - col / 2]);
      return segs;
    };
    const emitRun = (axis, c, a0, a1, out, kind, first = true) => {
      const ops = facadeOps(a1 - a0, kind, f, first);
      wallRun({ axis, c, a0, a1, f, t: T, out, mat, str: strWall, ops });
    };
    if (loadbearing) {
      emitRun('x', zS, -w / 2, w / 2, [0, 1], 'front');
      emitRun('x', zN, -w / 2, w / 2, [0, -1], 'back');
      emitRun('z', xE, -d / 2 + T, d / 2 - T, [1, 0], 'side');
      emitRun('z', xW, -d / 2 + T, d / 2 - T, [-1, 0], 'side');
    } else {
      const cw = col;
      for (let a = 0; a < sx; a++) {
        const a0 = gx[a] + (a === 0 ? col / 2 : cw / 2) - (a === 0 ? 0 : 0), a1 = gx[a + 1] - (a + 1 === sx ? col / 2 : cw / 2);
        // column faces: first / last column is flush with the outside, interior grid columns are centred on their line
        const s0 = (a === 0 ? -w / 2 + col : gx[a] + col / 2), s1 = (a + 1 === sx ? w / 2 - col : gx[a + 1] - col / 2);
        emitRun('x', zS, s0, s1, [0, 1], 'front', a === 0);
        emitRun('x', zN, s0, s1, [0, -1], 'back', a === sx - 1);
      }
      for (let c = 0; c < sz; c++) {
        const s0 = (c === 0 ? -d / 2 + col : gz[c] + col / 2), s1 = (c + 1 === sz ? d / 2 - col : gz[c + 1] - col / 2);
        emitRun('z', xE, s0, s1, [1, 0], 'side');
        emitRun('z', xW, s0, s1, [-1, 0], 'side');
      }
    }
    // interior walls on the interior grid lines: bearing (loadbearing) or light infill (frame)
    const partT = loadbearing ? 0.23 : 0.1;
    for (let a = 1; a < sx; a++) {
      const door = { wid: 0.95, sill: 0, hgt: 2.1, type: 'open', a: 0 };
      const len = d - 2 * T;
      door.a = len * 0.5 - door.wid / 2 + (rng() - 0.5) * 0.4;
      wallRun({ axis: 'z', c: gx[a], a0: -d / 2 + T, a1: d / 2 - T, f, t: partT, out: null, mat, str: strWall, ops: [door], interior: true });
    }
    for (let c = 1; c < sz; c++) {
      const door = { wid: 0.95, sill: 0, hgt: 2.1, type: 'open', a: 0 };
      const len = w - 2 * T;
      door.a = len * 0.28 - door.wid / 2 + (rng() - 0.5) * 0.3;
      wallRun({ axis: 'x', c: gz[c], a0: -w / 2 + T, a1: w / 2 - T, f, t: partT, out: null, mat, str: strWall, ops: [door], interior: true });
    }
    // slab (roof of this storey), one per bay
    const slabs = [];
    for (let a = 0; a < sx; a++) for (let c = 0; c < sz; c++) {
      slabs.push(add({ kind: 'slab', mat: 'rcc', str: false, f, cx: -w / 2 + spx * (a + 0.5), cy: (f + 1) * H - slabT / 2, cz: -d / 2 + spz * (c + 0.5), hx: spx / 2 - 0.01, hy: slabT / 2, hz: spz / 2 - 0.01, out: null, roof: f === floors - 1, ia: a, ic: c }));
    }
    for (let i = 0; i < slabs.length; i++) for (let j = i + 1; j < slabs.length; j++) {
      const A = slabs[i], C = slabs[j];
      const dx = Math.abs(A.cx - C.cx), dz = Math.abs(A.cz - C.cz);
      if ((dx <= A.hx + C.hx + 0.05 && dz < 0.5) || (dz <= A.hz + C.hz + 0.05 && dx < 0.5)) { (A.lat = A.lat || []).push(C.id); (C.lat = C.lat || []).push(A.id); }
    }
    slabsByFloor.push(slabs);
    // balcony: cantilever slab + railing on the front of the upper floors
    if (f > 0 && plan.spec.balcony && loadbearing) {
      const hostIdx = slabsByFloor[f - 1];
      const nF = Math.max(1, Math.floor(w / 3.6));
      const m = w / nF, xc = -w / 2 + (nF - 0.5) * m, bw = Math.min(2.6, m - 0.6), bd = 1.25;
      const host = hostIdx.find((s) => s.ic === sz - 1 && Math.abs(s.cx - xc) <= s.hx);
      if (host) {
        const bal = add({ kind: 'slab', mat: 'rcc', str: false, f: f - 1, cx: xc, cy: f * H - slabT / 2, cz: d / 2 + bd / 2 - 0.02, hx: bw / 2, hy: slabT / 2, hz: bd / 2, out: null, cant: host.id, bal: true });
        bal.lat = [host.id]; (host.lat = host.lat || []).push(bal.id);
        // railing: low brick wall on three sides
        const rh = 1.0, rt = 0.115, ry = f * H + rh / 2;
        const rail = (cx, cz, hx, hz) => add({ kind: 'wall', mat, str: false, f, cx, cy: ry, cz, hx, hy: rh / 2, hz, out: null, railing: true, parapet: true });
        rail(xc, d / 2 + bd - rt / 2, bw / 2, rt / 2);
        rail(xc - bw / 2 + rt / 2, d / 2 + bd / 2, rt / 2, bd / 2 - rt);
        rail(xc + bw / 2 - rt / 2, d / 2 + bd / 2, rt / 2, bd / 2 - rt);
      }
    }
  }
  // parapet on the roof
  {
    const mat = plan.fill === 'clayMasonry' ? 'clay' : 'block';
    const ph = 0.9, pt = 0.115, y = floors * H + ph / 2;
    const run = (axis, c, a0, a1, out) => {
      const L = a1 - a0, n = Math.max(1, Math.ceil(L / 2));
      for (let i = 0; i < n; i++) {
        const s0 = a0 + (L * i) / n, s1 = a0 + (L * (i + 1)) / n, am = (s0 + s1) / 2;
        add({ kind: 'wall', mat, str: false, f: floors, cx: axis === 'x' ? am : c, cy: y, cz: axis === 'x' ? c : am, hx: axis === 'x' ? (s1 - s0) / 2 : pt / 2, hy: ph / 2, hz: axis === 'x' ? pt / 2 : (s1 - s0) / 2, out, parapet: true });
      }
    };
    run('x', d / 2 - pt / 2, -w / 2, w / 2, [0, 1]); run('x', -d / 2 + pt / 2, -w / 2, w / 2, [0, -1]);
    run('z', w / 2 - pt / 2, -d / 2 + pt, d / 2 - pt, [1, 0]); run('z', -w / 2 + pt / 2, -d / 2 + pt, d / 2 - pt, [-1, 0]);
  }

  // ---- rooms (one per grid cell) and furniture
  const roomTypes = floors > 0 ? (loadbearing
    ? [['living', 'kitchen', 'store', 'dining'], ['bedroom', 'bedroom', 'bath', 'bedroom'], ['bedroom', 'study', 'bedroom', 'bedroom']]
    : [['shop', 'shop', 'shop', 'shop'], ['office', 'office', 'office', 'office'], ['office', 'office', 'office', 'office']]) : [];
  for (let f = 0; f < floors; f++) {
    for (let a = 0; a < sx; a++) for (let c = 0; c < sz; c++) {
      const x0 = a === 0 ? -w / 2 + plan.storeys[f].wallT : gx[a] + 0.12, x1 = a === sx - 1 ? w / 2 - plan.storeys[f].wallT : gx[a + 1] - 0.12;
      const z0 = c === 0 ? -d / 2 + plan.storeys[f].wallT : gz[c] + 0.12, z1 = c === sz - 1 ? d / 2 - plan.storeys[f].wallT : gz[c + 1] - 0.12;
      let type = roomTypes[Math.min(f, roomTypes.length - 1)][(c * sx + a) % 4];
      // garage bay: no furniture, a parked space instead
      const isGarage = f === 0 && plan.spec.garage && loadbearing && c === sz - 1 && a === sx - 1;
      if (isGarage) type = 'garage';
      const room = { f, type, x0, x1, z0, z1, y: f * H, slabBelow: f > 0 ? slabsByFloor[f - 1][a * sz + c].id : -1 };
      rooms.push(room);
      fillRoom(room);
    }
  }

  function fillRoom(R) {
    const wood = pick(rng, FURNITURE_COLORS.wood), fab = pick(rng, FURNITURE_COLORS.fabric), met = pick(rng, FURNITURE_COLORS.metal);
    const cx = (R.x0 + R.x1) / 2, cz = (R.z0 + R.z1) / 2, rw = R.x1 - R.x0, rd = R.z1 - R.z0, y0 = R.y + 0.02;
    const F = (x, y, z, hx, hy, hz, tile, color) => furn.push({ x, y: y0 + y, z, hx, hy, hz, tile, color, slab: R.slabBelow, f: R.f });
    const wall = (sx_, sz_) => ({ x: sx_ < 0 ? R.x0 : R.x1, z: sz_ < 0 ? R.z0 : R.z1 });
    switch (R.type) {
      case 'bedroom': {
        // double bed with headboard against the back wall, pillows, wardrobe, side tables
        const bz = R.z0 + 0.1 + 1.0;
        F(cx, 0.28, bz, 0.9, 0.28, 1.0, 'wood', wood);
        F(cx, 0.6, bz + 0.05, 0.86, 0.1, 0.95, 'fabric', fab);
        F(cx, 0.55, R.z0 + 0.1, 0.95, 0.55, 0.05, 'wood', wood);
        F(cx - 0.4, 0.74, R.z0 + 0.4, 0.28, 0.08, 0.16, 'fabric', '#ece8e0'); F(cx + 0.4, 0.74, R.z0 + 0.4, 0.28, 0.08, 0.16, 'fabric', '#ece8e0');
        F(cx - 1.25, 0.25, R.z0 + 0.35, 0.22, 0.25, 0.22, 'wood', wood); F(cx + 1.25, 0.25, R.z0 + 0.35, 0.22, 0.25, 0.22, 'wood', wood);
        F(R.x1 - 0.35, 1.0, cz + 0.2, 0.3, 1.0, Math.min(0.9, rd * 0.22), 'wood', wood);
        break;
      }
      case 'living': {
        F(cx, 0.22, R.z1 - 0.7, 1.0, 0.22, 0.42, 'fabric', fab);            // sofa seat
        F(cx, 0.55, R.z1 - 0.38, 1.0, 0.3, 0.1, 'fabric', fab);             // sofa back
        F(cx - 1.0, 0.35, R.z1 - 0.7, 0.1, 0.18, 0.42, 'fabric', fab); F(cx + 1.0, 0.35, R.z1 - 0.7, 0.1, 0.18, 0.42, 'fabric', fab);
        F(cx, 0.2, cz, 0.6, 0.2, 0.35, 'wood', wood);                        // coffee table
        F(cx, 0.35, R.z0 + 0.3, 1.0, 0.35, 0.22, 'wood', wood);              // tv unit
        F(cx, 0.95, R.z0 + 0.3, 0.55, 0.3, 0.03, 'metal', '#202225');       // tv
        break;
      }
      case 'dining': case 'study': {
        F(cx, 0.72, cz, 0.75, 0.04, 0.45, 'wood', wood);
        for (const [dx, dz] of [[-0.68, -0.38], [0.68, -0.38], [-0.68, 0.38], [0.68, 0.38]]) F(cx + dx, 0.36, cz + dz, 0.04, 0.36, 0.04, 'wood', wood);
        for (const dz of [-0.75, 0.75]) for (const dx of [-0.35, 0.35]) { F(cx + dx, 0.45, cz + dz, 0.2, 0.03, 0.2, 'fabric', fab); F(cx + dx, 0.7, cz + dz + Math.sign(dz) * 0.18, 0.2, 0.25, 0.03, 'fabric', fab); }
        break;
      }
      case 'kitchen': {
        F(cx, 0.45, R.z0 + 0.35, Math.min(1.6, rw * 0.4), 0.45, 0.32, 'wood', wood);   // counter
        F(cx, 0.92, R.z0 + 0.35, Math.min(1.6, rw * 0.4), 0.03, 0.34, 'white', '#cfcfcf');
        F(cx + 0.7, 0.97, R.z0 + 0.35, 0.28, 0.03, 0.2, 'metal', '#2a2a2c');        // hob
        F(cx - 0.6, 0.97, R.z0 + 0.35, 0.28, 0.04, 0.2, 'metal', '#b9bec4');        // sink
        F(R.x1 - 0.3, 0.9, R.z1 - 0.4, 0.3, 0.9, 0.32, 'metal', '#c9ccd0');         // fridge
        // LPG cylinder under the counter: the building's gas hazard
        F(cx + 0.9, 0.3, R.z0 + 0.85, 0.16, 0.3, 0.16, 'metal', '#c1272d');
        hazards.push({ x: cx + 0.9, y: R.y + 0.4, z: R.z0 + 0.85 });
        break;
      }
      case 'bath': {
        F(R.x1 - 0.4, 0.2, R.z0 + 0.45, 0.2, 0.2, 0.28, 'white', '#f1f1ee');         // toilet
        F(R.x0 + 0.4, 0.45, R.z0 + 0.3, 0.3, 0.05, 0.2, 'white', '#f1f1ee');          // basin
        break;
      }
      case 'office': {
        for (let i = 0; i < Math.max(1, Math.floor(rw / 3)); i++) {
          const dx = R.x0 + 1.4 + i * 3;
          F(dx, 0.72, cz - 0.3, 0.7, 0.04, 0.4, 'wood', wood);
          F(dx, 0.36, cz - 0.3, 0.04, 0.36, 0.3, 'metal', '#8a8f95');
          F(dx, 0.45, cz + 0.45, 0.22, 0.04, 0.22, 'fabric', '#2b2e33'); F(dx, 0.7, cz + 0.65, 0.22, 0.25, 0.03, 'fabric', '#2b2e33');
          F(dx, 0.95, cz - 0.45, 0.25, 0.2, 0.02, 'metal', '#16181b');
        }
        break;
      }
      case 'shop': {
        for (const dz of [-0.8, 0.8]) F(cx, 0.9, cz + dz * Math.min(1, rd / 3), Math.min(rw * 0.4, 3.0), 0.9, 0.28, 'wood', wood);
        F(R.x0 + 0.5, 1.0, cz, 0.3, 1.0, Math.min(1.5, rd * 0.3), 'metal', '#a9aeb3');
        break;
      }
      case 'store': {
        for (let i = 0; i < 3; i++) F(cx - 0.8 + i * 0.8, 0.3 + (i % 2) * 0.25, R.z1 - 0.4, 0.3, 0.3 + (i % 2) * 0.25, 0.3, 'wood', i % 2 ? '#8a6a45' : '#a08058');
        break;
      }
      default: break;
    }
  }

  return { el, rooms, furn, hazards, paint, gx, gz, wallH };
}
