// Plan model for the Design Lab: walls (straight or curved) with openings -> shape-engine spec.
// All coordinates are metres on the ground plane (x right, z down on the 2D canvas).
export const OPEN_STYLES = ['rect', 'arch', 'pointed', 'round'];

export function newPlan() { return { walls: [], h: 3.2, storeys: 1, roof: 'flat', thick: 0.23, mat: 'clay', style: 'arch' }; }

const TAU = Math.PI * 2;
const mod = (a) => ((a % TAU) + TAU) % TAU;
export function circle3(p0, p1, pm) {
  const ax = p0[0], ay = p0[1], bx = pm[0], by = pm[1], cx = p1[0], cy = p1[1];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-6) return null;
  const ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d;
  const uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d;
  return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}
// geometry of a wall: {kind:'line', len} or {kind:'arc', c, r, a0, sweep (signed), len}
export function wallGeom(w) {
  if (w.type === 'arc' && w.pm) {
    const ci = circle3(w.p0, w.p1, w.pm);
    if (ci) {
      const a0 = Math.atan2(w.p0[1] - ci.c[1], w.p0[0] - ci.c[0]), a1 = Math.atan2(w.p1[1] - ci.c[1], w.p1[0] - ci.c[0]), am = Math.atan2(w.pm[1] - ci.c[1], w.pm[0] - ci.c[0]);
      const d1 = mod(a1 - a0), dm = mod(am - a0);
      const sweep = dm < d1 ? d1 : -(TAU - d1);
      return { kind: 'arc', c: ci.c, r: ci.r, a0, sweep, len: Math.abs(sweep) * ci.r };
    }
  }
  return { kind: 'line', len: Math.hypot(w.p1[0] - w.p0[0], w.p1[1] - w.p0[1]) };
}
// point at distance s along the wall (from p0) and the distance of q from the wall (for picking)
export function wallPoint(w, g, s) {
  if (g.kind === 'arc') { const a = g.a0 + (g.sweep >= 0 ? 1 : -1) * s / g.r; return [g.c[0] + Math.cos(a) * g.r, g.c[1] + Math.sin(a) * g.r]; }
  const t = s / (g.len || 1); return [w.p0[0] + (w.p1[0] - w.p0[0]) * t, w.p0[1] + (w.p1[1] - w.p0[1]) * t];
}
export function project(w, q) {
  const g = wallGeom(w);
  if (g.kind === 'arc') {
    const a = Math.atan2(q[1] - g.c[1], q[0] - g.c[0]);
    const rel = g.sweep >= 0 ? mod(a - g.a0) : mod(g.a0 - a);
    if (rel <= Math.abs(g.sweep)) { const p = wallPoint(w, g, rel * g.r); return { s: rel * g.r, d: Math.hypot(q[0] - p[0], q[1] - p[1]), g }; }
    const d0 = Math.hypot(q[0] - w.p0[0], q[1] - w.p0[1]), d1 = Math.hypot(q[0] - w.p1[0], q[1] - w.p1[1]);
    return d0 < d1 ? { s: 0, d: d0, g } : { s: g.len, d: d1, g };
  }
  const dx = w.p1[0] - w.p0[0], dz = w.p1[1] - w.p0[1], L2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((q[0] - w.p0[0]) * dx + (q[1] - w.p0[1]) * dz) / L2));
  const p = [w.p0[0] + dx * t, w.p0[1] + dz * t];
  return { s: t * g.len, d: Math.hypot(q[0] - p[0], q[1] - p[1]), g };
}

export function makeGap(kind, isDoor, style) {
  if (isDoor) return { wid: 1.1, h: style === 'rect' ? 2.1 : 2.4, sill: 0, kind: style === 'round' ? 'rect' : style, door: true };
  if (style === 'round') return { wid: 0.9, sill: 1.5, h: 2.4, kind: 'round', pane: true };
  return { wid: style === 'rect' ? 1.2 : 1.0, sill: 0.9, h: style === 'rect' ? 2.1 : 2.4, kind: style, pane: true };
}

export function planBounds(plan) {
  let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
  const add = (p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); };
  for (const w of plan.walls) {
    const g = wallGeom(w);
    if (g.kind === 'arc') for (let i = 0; i <= 24; i++) add(wallPoint(w, g, (g.len * i) / 24)); else { add(w.p0); add(w.p1); }
  }
  return plan.walls.length ? { x0, x1, z0, z1 } : null;
}


// floor / roof slab that follows the outline: walls are treated as a closed boundary (even-odd rule), cells 0.5 m, merged along rows
function slabRuns(plan, B) {
  const segs = [];
  for (const w of plan.walls) {
    const g = wallGeom(w);
    if (g.kind === 'arc') { let prev = wallPoint(w, g, 0); for (let i = 1; i <= 24; i++) { const q = wallPoint(w, g, (g.len * i) / 24); segs.push([prev, q]); prev = q; } }
    else segs.push([w.p0, w.p1]);
  }
  const inside = (x, z) => { let c = 0; for (const [a, b] of segs) if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c++; return c & 1; };
  const near = (x, z) => { for (const [a, b] of segs) { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); if (Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t) < 0.32) return true; } return false; };
  const cell = 0.5, runs = [];
  for (let z = Math.floor((B.z0 - 0.3) / cell) * cell; z < B.z1 + 0.3; z += cell) {
    let start = null;
    for (let x = Math.floor((B.x0 - 0.3) / cell) * cell; x <= B.x1 + 1.2; x += cell) {
      const on = x < B.x1 + 0.3 && (inside(x + cell / 2, z + cell / 2) || near(x + cell / 2, z + cell / 2));
      if (on && start === null) start = x;
      if (!on && start !== null) { runs.push({ cx: (start + x) / 2, cz: z + cell / 2, w: x - start, d: cell }); start = null; }
    }
  }
  return runs;
}

export function planToSpec(plan, paint) {
  const B = planBounds(plan);
  if (!B) return null;
  const shapes = [];
  const cen = [(B.x0 + B.x1) / 2, (B.z0 + B.z1) / 2];
  // centroid of wall midpoints decides which side of each wall is "outside"
  let mx = 0, mz = 0;
  for (const w of plan.walls) { const g = wallGeom(w), p = wallPoint(w, g, g.len / 2); mx += p[0]; mz += p[1]; }
  const cx = mx / plan.walls.length, cz = mz / plan.walls.length;
  const slabT = 0.25, Hs = plan.h + slabT;
  for (let k = 0; k < plan.storeys; k++) {
    const y0 = k * Hs;
    for (const w of plan.walls) {
      const g = wallGeom(w);
      let gaps = (w.gaps || []).filter((q) => k === 0 || !q.door).map((q) => ({ ...q, h: Math.min(q.h, plan.h - 0.2) }));
      const base = { y0, h: plan.h, thick: w.thick || plan.thick, mat: w.mat || plan.mat, f: k };
      if (g.kind === 'arc') {
        const ccw = g.sweep >= 0;
        const a0 = ccw ? g.a0 : g.a0 + g.sweep, a1 = ccw ? g.a0 + g.sweep : g.a0;
        if (!ccw) gaps = gaps.map((q) => ({ ...q, a: g.len - q.a - q.wid }));
        const dc = Math.hypot(cx - g.c[0], cz - g.c[1]);
        shapes.push({ t: 'arc', cx: g.c[0], cz: g.c[1], r: g.r, a0, a1, ...base, gaps, inward: dc > g.r });
      } else {
        const dx = w.p1[0] - w.p0[0], dz = w.p1[1] - w.p0[1], L = g.len || 1;
        const n = [dz / L, -dx / L];
        const mid = [(w.p0[0] + w.p1[0]) / 2, (w.p0[1] + w.p1[1]) / 2];
        const flip = n[0] * (mid[0] - cx) + n[1] * (mid[1] - cz) < 0;
        shapes.push({ t: 'line', x0: w.p0[0], z0: w.p0[1], x1: w.p1[0], z1: w.p1[1], ...base, gaps, flip });
      }
    }
    // floor / roof slab over the footprint's bounding box
    const top = k === plan.storeys - 1;
    if (!top || plan.roof === 'flat') for (const r of slabRuns(plan, B)) shapes.push({ t: 'box', cx: r.cx, cz: r.cz, y0: y0 + plan.h, w: r.w, d: r.d, h: slabT, f: k });
    if (top && plan.roof === 'dome') shapes.push({ t: 'dome', cx: cen[0], cz: cen[1], y0: y0 + plan.h, r: Math.max(B.x1 - B.x0, B.z1 - B.z0) / 2 + 0.1, thick: 0.2, rings: 6, seg: 26 });
  }
  return { shapes, paint, lab: JSON.parse(JSON.stringify(plan)) };
}

// a rectangle plan from simple house numbers (used to convert a stock building into an editable plan)
export function rectPlan(w, d, floors, style = 'arch') {
  const p = newPlan(); p.storeys = Math.max(1, floors | 0); p.style = style;
  const x0 = -w / 2, x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const front = { type: 'line', p0: [x0, z1], p1: [x1, z1], gaps: [] };
  front.gaps.push({ ...makeGap('rect', true, style), a: w / 2 - 0.55 });
  for (const a of [w * 0.15, w * 0.75]) front.gaps.push({ ...makeGap('rect', false, style), a });
  const right = { type: 'line', p0: [x1, z1], p1: [x1, z0], gaps: [{ ...makeGap('rect', false, style), a: d / 2 - 0.5 }] };
  const back = { type: 'line', p0: [x1, z0], p1: [x0, z0], gaps: [{ ...makeGap('rect', false, style), a: w / 2 - 0.5 }] };
  const left = { type: 'line', p0: [x0, z0], p1: [x0, z1], gaps: [{ ...makeGap('rect', false, style), a: d / 2 - 0.5 }] };
  p.walls = [front, right, back, left];
  return p;
}
