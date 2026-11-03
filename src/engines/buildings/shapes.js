// Shape engine: free-form architecture from a handful of primitives. Everything becomes oriented panels (quaternion + size)
// that the same structural / fracture runtime handles as it does straight walls, so a curved wall, a dome or a temple spire
// breaks, falls and piles up as rubble with exactly the same rules.
//
// Primitives (all in building-local metres):
//   line   {x0,z0,x1,z1,y0,h,thick,mat,gaps:[{a,wid,h}]}     straight wall, openings by distance along the wall
//   arc    {cx,cz,r,a0,a1,y0,h,thick,mat,gaps:[{a,wid,h}]}   curved wall (a0..a1 radians; 0..2PI = full round tower)
//   dome   {cx,cz,y0,r,thick,rings,seg,cap}                   poured-concrete hemispherical shell
//   tower  {cx,cz,y0,h,r0,r1,thick,rows,seg,curve}            tapering shell: cone, chimney, temple shikhara (curve>1 bows it)
//   box    {cx,cz,y0,w,d,h}                                   solid poured block (plinth, steps)
//   col    {cx,cz,y0,h,s}                                     square RCC column
const ROW_H = 1.45, PANEL_W = 1.3;

// quaternion from the rotation matrix whose columns are x,y,z axes
function quatFromBasis(X, Y, Z) {
  const m00 = X[0], m10 = X[1], m20 = X[2], m01 = Y[0], m11 = Y[1], m21 = Y[2], m02 = Z[0], m12 = Z[1], m22 = Z[2];
  const tr = m00 + m11 + m22; let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4; }
  const l = Math.hypot(x, y, z, w) || 1; return [x / l, y / l, z / l, w / l];
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function shapeElements(shapes, add, newRun) {
  // one oriented panel: centre c, meridian (up along the surface) m, outward normal n, size (length along tangent, height along m, thickness)
  const panel = (kind, mat, str, c, m, n, len, hgt, th, run, s0, s1, extra = {}) => {
    const X = norm(cross(m, n));
    const q = quatFromBasis(X, m, n);
    // world half-extents of the oriented box (for neighbour tests)
    const hx = len / 2, hy = hgt / 2, hz = th / 2;
    const ax = Math.abs(X[0]) * hx + Math.abs(m[0]) * hy + Math.abs(n[0]) * hz;
    const ay = Math.abs(X[1]) * hx + Math.abs(m[1]) * hy + Math.abs(n[1]) * hz;
    const az = Math.abs(X[2]) * hx + Math.abs(m[2]) * hy + Math.abs(n[2]) * hz;
    return add({ kind, mat, str, f: extra.f || 0, run, axis: 'x', s0, s1, cx: c[0], cy: c[1], cz: c[2], hx, hy, hz, out: [0, 1], outW: [n[0], n[2]], interior: false, q, ax, ay, az, free: true, ...extra.rest });
  };

  // ---- openings: profile = vertical extent [lo, hi] of the hole at distance u from the opening's left edge
  const openProfile = (g) => {
    const w = g.wid, sill = g.sill || 0, kind = g.kind || 'rect';
    if (kind === 'arch') {                      // semicircular arch: straight jambs, round head (apex at g.h)
      const R = w / 2, spring = Math.max(sill + 0.3, g.h - R);
      return (u) => { const x = u - R; return [sill, spring + Math.sqrt(Math.max(0, R * R - x * x))]; };
    }
    if (kind === 'pointed') {                   // two-centred arch: both arcs have radius = span, centred on the opposite springing point
      const r = w, rise = Math.sqrt(r * r - (w / 2) * (w / 2)), spring = Math.max(sill + 0.3, g.h - rise);
      return (u) => { const x = u < w / 2 ? w - u : u; return [sill, spring + Math.sqrt(Math.max(0, r * r - x * x))]; };
    }
    if (kind === 'round') {                     // circular window: diameter = wid
      const R = w / 2, cyy = sill + R;
      return (u) => { const x = u - R; const d = Math.sqrt(Math.max(0, R * R - x * x)); return [cyy - d, cyy + d]; };
    }
    return () => [sill, g.h];                   // plain rectangle
  };

  // ---- one straight or curved wall run, cut by its openings. Opening columns are cut into thin strips so the wall edge follows the profile.
  const wallRows = (pt, tan, y0, h, len, th, mat, gaps, run, sBase, nOut, f, wmax) => {
    const gs = (gaps || []).map((g) => ({ ...g, h: g.h ?? 2.1, sill: g.sill || 0, profile: openProfile({ ...g, h: g.h ?? 2.1 }) })).sort((p, q) => p.a - q.a);
    const cols = [];   // {sa,sb,gap|null}
    let cur = 0;
    const plain = (s0, s1) => { const n = Math.max(1, Math.ceil((s1 - s0) / wmax - 1e-6)); for (let i = 0; i < n; i++) cols.push({ sa: s0 + ((s1 - s0) * i) / n, sb: s0 + ((s1 - s0) * (i + 1)) / n, gap: null }); };
    for (const g of gs) {
      if (g.a > cur + 0.02) plain(cur, g.a);
      const curved = g.kind && g.kind !== 'rect';
      const n = curved ? Math.max(3, Math.ceil(g.wid / 0.2 - 1e-6)) : Math.max(1, Math.ceil(g.wid / wmax - 1e-6));
      for (let i = 0; i < n; i++) cols.push({ sa: g.a + (g.wid * i) / n, sb: g.a + (g.wid * (i + 1)) / n, gap: g });
      cur = Math.min(len, g.a + g.wid);
    }
    if (len > cur + 0.02) plain(cur, len);
    const out = (sa, sb, ya, yb, kind, mat2, str) => {
      if (yb - ya < 0.04 || sb - sa < 0.03) return;
      const sm = (sa + sb) / 2, p = pt(sm), n = nOut(sm);
      const nr = Math.max(1, Math.ceil((yb - ya) / ROW_H - 1e-6));
      for (let rr = 0; rr < nr; rr++) {
        const yA = ya + ((yb - ya) * rr) / nr, yB = ya + ((yb - ya) * (rr + 1)) / nr;
        // widen slightly on curved runs so neighbouring flat panels close the wedge gap on the outer face
        const wlen = (sb - sa) + 0.02 + (wmax < PANEL_W ? th * 0.12 : 0);
        panel(kind, mat2, str, [p[0], (yA + yB) / 2, p[2]], [0, 1, 0], n, wlen, yB - yA, kind === 'pane' ? 0.04 : th, run, sBase + sa, sBase + sb, { f });
      }
    };
    for (const c of cols) {
      if (!c.gap) { out(c.sa, c.sb, y0, y0 + h, 'wall', mat, true); continue; }
      const g = c.gap, sm = (c.sa + c.sb) / 2 - g.a;
      // evaluate the profile at the strip centre (rect: constant)
      const [lo, hi] = g.profile(Math.min(g.wid, Math.max(0, sm)));
      const yLo = y0 + lo, yHi = y0 + Math.min(hi, h - 0.05);
      if (lo > 0.04) out(c.sa, c.sb, y0, yLo, 'wall', mat, true);                     // sill / below the round head
      out(c.sa, c.sb, yHi, y0 + h, 'lintel', 'rcc', false);                          // lintel (RCC beam / arch ring) above the hole
      if (g.pane || g.door) out(c.sa, c.sb, yLo, yHi, g.door ? 'door' : 'pane', g.door ? 'wood' : 'glass', false);
    }
  };

  let runId = 100000;
  for (const S of shapes) {
    const mat = S.mat || 'rcc';
    if (S.t === 'line') {
      const dx = S.x1 - S.x0, dz = S.z1 - S.z0, L = Math.hypot(dx, dz), tx = dx / L, tz = dz / L;
      const n = [tz, 0, -tx];   // outward = to the right of the walking direction (flip with S.flip)
      if (S.flip) { n[0] = -n[0]; n[2] = -n[2]; }
      wallRows((s) => [S.x0 + tx * s, 0, S.z0 + tz * s], () => [tx, 0, tz], S.y0 || 0, S.h, L, S.thick || 0.23, mat, S.gaps, runId++, 0, () => n, S.f || 0, PANEL_W);
    } else if (S.t === 'arc') {
      const a0 = S.a0 ?? 0, a1 = S.a1 ?? Math.PI * 2, L = S.r * (a1 - a0);
      const ang = (s) => a0 + s / S.r;
      wallRows((s) => [S.cx + Math.cos(ang(s)) * S.r, 0, S.cz + Math.sin(ang(s)) * S.r], (s) => [-Math.sin(ang(s)), 0, Math.cos(ang(s))], S.y0 || 0, S.h, L, S.thick || 0.23, mat, S.gaps, runId++, 0, (s) => (S.inward ? [-Math.cos(ang(s)), 0, -Math.sin(ang(s))] : [Math.cos(ang(s)), 0, Math.sin(ang(s))]), S.f || 0, Math.min(PANEL_W, Math.max(0.35, Math.sqrt(8 * S.r * 0.03))));
    } else if (S.t === 'dome' || S.t === 'tower') {
      // a surface of revolution made of rings of panels; each ring knows its slope, so panels tilt to follow the shell
      const rings = S.rings || S.rows || 6, th = S.thick || 0.2;
      const profile = [];   // list of {r, y} points from bottom to top
      if (S.t === 'dome') { const cap = S.cap ?? Math.PI / 2; for (let k = 0; k <= rings; k++) { const ph = cap - (cap * k) / rings; profile.push({ r: S.r * Math.sin(ph), y: (S.y0 || 0) + S.r * (Math.cos(ph) - Math.cos(cap)) }); } }
      else { const cv = S.curve || 1; for (let k = 0; k <= rings; k++) { const u = k / rings; profile.push({ r: S.r0 + (S.r1 - S.r0) * Math.pow(u, cv), y: (S.y0 || 0) + S.h * u }); } }
      for (let k = 0; k < rings; k++) {
        const A = profile[k], Bp = profile[k + 1];
        const dr = Bp.r - A.r, dy = Bp.y - A.y, ml = Math.hypot(dr, dy);
        const mr = dr / ml, my = dy / ml;                    // meridian (up the surface)
        const rm = (A.r + Bp.r) / 2, ym = (A.y + Bp.y) / 2;  // ring mid
        const seg = Math.max(4, Math.round((S.seg || 24) * Math.max(0.2, rm / (S.r || S.r0))));
        const run = runId++;
        for (let j = 0; j < seg; j++) {
          const a = ((j + 0.5) / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          const rh = [ca, 0, sa];
          const m = norm([rh[0] * mr, my, rh[2] * mr]);
          const n = norm([rh[0] * my, -mr, rh[2] * my]);
          const wid = (2 * Math.PI * rm) / seg * 1.03 + 0.02;
          // arc-length coordinate around the ring, so neighbours in the ring are recognised
          const s0 = (j / seg) * 2 * Math.PI * rm, s1 = ((j + 1) / seg) * 2 * Math.PI * rm;
          panel('wall', mat, true, [S.cx + ca * rm, ym, S.cz + sa * rm], m, n, wid, ml * 1.03, th, run, s0, s1, { f: S.f || 0 });
        }
      }
    } else if (S.t === 'box') {
      const o = { w: S.w, d: S.d, h: S.h };
      panel('wall', 'rcc', true, [S.cx, (S.y0 || 0) + S.h / 2, S.cz], [0, 1, 0], [0, 0, 1], S.w, S.h, S.d, runId++, 0, S.w, { f: S.f || 0, rest: { solidBlock: true } });
    } else if (S.t === 'col') {
      add({ kind: 'col', mat: 'rcc', str: true, f: S.f || 0, run: null, axis: 'x', s0: 0, s1: 0, cx: S.cx, cy: (S.y0 || 0) + S.h / 2, cz: S.cz, hx: S.s / 2, hy: S.h / 2, hz: S.s / 2, out: null, interior: false });
    }
  }
}
