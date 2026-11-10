// Hidden-face culling for the building mesh.
// A face that is pressed against (or buried inside) another solid panel can never be seen, so it is not put into the mesh at all.
// Works on axis-aligned boxes (every wall / slab / column the generator makes, including the ones turned by a multiple of 90 degrees).
// A face is only dropped when the neighbours cover ALL of it (checked on a compressed grid), so no hole can ever open up.
// The mesh is rebuilt whenever a panel breaks, and the test only counts panels that are in the mesh, so a face reappears the moment its neighbour is gone.

const TOL = 0.004;     // two faces closer than this count as touching
const MINT = 0.015;    // a covering box must reach at least this far behind the face
const EPS = 0.002;     // overlap slack when checking coverage

// local axis i -> { w: world axis, s: sign } for a yaw/pitch-free orientation q (null if the box is not axis-aligned)
function axisMap(q) {
  if (!q) return [[0, 1], [1, 1], [2, 1]];
  const [x, y, z, w] = q;
  const cols = [[1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)], [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)], [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)]];
  const out = [], used = [false, false, false];
  for (const c of cols) {
    let k = 0;
    for (let a = 1; a < 3; a++) if (Math.abs(c[a]) > Math.abs(c[k])) k = a;
    if (Math.abs(c[k]) < 0.9995 || used[k]) return null;
    used[k] = true; out.push([k, c[k] > 0 ? 1 : -1]);
  }
  return out;
}

// world-aligned box of a panel / deco: { lo:[x,y,z], hi:[x,y,z], map }  (null when not axis-aligned)
export function alignedBox(P) {
  const map = axisMap(P.q);
  if (!map) return null;
  const h = [P.hx, P.hy, P.hz], c = [P.cx, P.cy, P.cz], lo = [0, 0, 0], hi = [0, 0, 0];
  for (let i = 0; i < 3; i++) { const w = map[i][0]; lo[w] = c[w] - h[i]; hi[w] = c[w] + h[i]; }
  return { lo, hi, map };
}

export class FaceCuller {
  // solids: the opaque panels that are really in the mesh
  constructor(solids) {
    this.cs = 2; this.hash = new Map(); this.n = 0;
    for (const P of solids) {
      const bx = alignedBox(P);
      if (!bx) continue;
      const it = { lo: bx.lo, hi: bx.hi, P };
      this.n++;
      this._each(bx.lo, bx.hi, 0, (k) => { let l = this.hash.get(k); if (!l) this.hash.set(k, l = []); l.push(it); });
    }
  }
  _each(lo, hi, pad, fn) {
    const cs = this.cs;
    const x0 = Math.floor((lo[0] - pad) / cs), x1 = Math.floor((hi[0] + pad) / cs), y0 = Math.floor((lo[1] - pad) / cs), y1 = Math.floor((hi[1] + pad) / cs), z0 = Math.floor((lo[2] - pad) / cs), z1 = Math.floor((hi[2] + pad) / cs);
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) for (let k = z0; k <= z1; k++) fn(i + ',' + j + ',' + k);
  }
  // bit mask of LOCAL faces (order +x -x +y -y +z -z) of `box` (from alignedBox) that are completely hidden; `self` is skipped as a neighbour
  hidden(box, self) {
    if (!box) return 0;
    const cand = new Set();
    this._each(box.lo, box.hi, 0.05, (k) => { const l = this.hash.get(k); if (l) for (const it of l) cand.add(it); });
    let mask = 0;
    for (let fi = 0; fi < 6; fi++) {
      const i = fi >> 1, sl = fi & 1 ? -1 : 1;
      const w = box.map[i][0], sg = sl * box.map[i][1];
      const p = sg > 0 ? box.hi[w] : box.lo[w];
      const a1 = (w + 1) % 3, a2 = (w + 2) % 3;
      const f1 = box.lo[a1], f2 = box.hi[a1], g1 = box.lo[a2], g2 = box.hi[a2];
      if (f2 - f1 < 1e-4 || g2 - g1 < 1e-4) continue;
      const rects = [];
      for (const it of cand) {
        if (it.P === self) continue;
        const lo = it.lo, hi = it.hi;
        if (sg > 0 ? !(lo[w] <= p + TOL && hi[w] >= p + MINT) : !(hi[w] >= p - TOL && lo[w] <= p - MINT)) continue;
        const r1 = Math.max(f1, lo[a1] - EPS), r2 = Math.min(f2, hi[a1] + EPS), s1 = Math.max(g1, lo[a2] - EPS), s2 = Math.min(g2, hi[a2] + EPS);
        if (r2 - r1 > 1e-4 && s2 - s1 > 1e-4) rects.push([r1, r2, s1, s2]);
      }
      if (!rects.length) continue;
      if (covered(f1, f2, g1, g2, rects)) mask |= 1 << fi;
    }
    return mask;
  }
}

// is the rectangle [f1,f2]x[g1,g2] completely inside the union of rects?
function covered(f1, f2, g1, g2, rects) {
  for (const r of rects) if (r[0] <= f1 + 1e-4 && r[1] >= f2 - 1e-4 && r[2] <= g1 + 1e-4 && r[3] >= g2 - 1e-4) return true;
  if (rects.length < 2) return false;
  const xs = [f1, f2], ys = [g1, g2];
  for (const r of rects) { xs.push(r[0], r[1]); ys.push(r[2], r[3]); }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  for (let i = 0; i < xs.length - 1; i++) {
    if (xs[i + 1] - xs[i] < 1e-5) continue;
    const mx = (xs[i] + xs[i + 1]) / 2;
    if (mx < f1 || mx > f2) continue;
    for (let j = 0; j < ys.length - 1; j++) {
      if (ys[j + 1] - ys[j] < 1e-5) continue;
      const my = (ys[j] + ys[j + 1]) / 2;
      if (my < g1 || my > g2) continue;
      let ok = false;
      for (const r of rects) if (mx >= r[0] && mx <= r[1] && my >= r[2] && my <= r[3]) { ok = true; break; }
      if (!ok) return false;
    }
  }
  return true;
}
