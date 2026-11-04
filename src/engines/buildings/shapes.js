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
  // Doors become ONE hinged leaf (so they can swing open and shut); windows get a real frame, glazing bars and sills set into the wall depth.
  const decoBox = (host, c, X, Y, Z, hx, hy, hz, tint, f) => add({ deco: true, host: host ? host.id : null, kind: 'deco', mat: 'wood', tint, f: f || 0, cx: c[0], cy: c[1], cz: c[2], hx, hy, hz, q: quatFromBasis(X, Y, Z) });
  const wallRows = (pt, tan, y0, h, len, th, mat, gaps, run, sBase, nOut, f, wmax, ex = {}, kind0 = 'wall', str0 = true) => {
    const gs = (gaps || []).map((g) => ({ ...g, h: g.h ?? 2.1, sill: g.sill || 0 })).map((g) => ({ ...g, profile: openProfile(g) })).sort((p, q) => p.a - q.a);
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
    const out = (sa, sb, ya, yb, kind, mat2, str, single, rest2) => {
      if (yb - ya < 0.04 || sb - sa < 0.03) return null;
      const sm = (sa + sb) / 2, p = pt(sm), n = nOut(sm);
      const nr = single ? 1 : Math.max(1, Math.ceil((yb - ya) / ROW_H - 1e-6));
      let first = null;
      for (let rr = 0; rr < nr; rr++) {
        const yA = ya + ((yb - ya) * rr) / nr, yB = ya + ((yb - ya) * (rr + 1)) / nr;
        // widen slightly on curved runs so neighbouring flat panels close the wedge gap on the outer face
        const wlen = (sb - sa) + (single ? 0 : 0.02) + (wmax < PANEL_W ? th * 0.12 : 0);
        const e = panel(kind, mat2, str, [p[0], (yA + yB) / 2, p[2]], [0, 1, 0], n, wlen, yB - yA, kind === 'pane' ? Math.min(0.04, th) : kind === 'door' ? Math.min(0.05, th) : th, run, sBase + sa, sBase + sb, { f, rest: { ...ex, ...(rest2 || {}) } });
        first = first || e;
      }
      return first;
    };
    // frame bars around an opening (visual only; they live and die with the glazing / door leaf)
    const frame = (g, host, jambOnly) => {
      const sm = g.a + g.wid / 2, c0 = pt(sm), n = nOut(sm), X = norm(cross([0, 1, 0], n)), Y = [0, 1, 0];
      const sill = y0 + g.sill, top = y0 + Math.min(g.h, h - 0.05);
      const tint = ex.trim || '#2e3135';
      const bar = (along, yc, wl, hh, dep, off, tn) => decoBox(host, [c0[0] + X[0] * along + n[0] * off, yc, c0[2] + X[2] * along + n[2] * off], X, Y, n, wl / 2, hh / 2, dep / 2, tn || tint, f);
      const wf = 0.06, dp = Math.min(0.1, th * 0.5);
      bar(-g.wid / 2 + wf / 2, (sill + top) / 2, wf, top - sill, dp, 0);           // left jamb
      bar(g.wid / 2 - wf / 2, (sill + top) / 2, wf, top - sill, dp, 0);            // right jamb
      if (g.kind === 'arch' || g.kind === 'pointed' || g.kind === 'round') return;
      bar(0, top - wf / 2, g.wid, wf, dp, 0);                                       // head
      if (jambOnly) return;
      bar(0, sill + wf / 2, g.wid, wf, dp, 0);                                      // bottom rail
      if (g.wid > 1.25) bar(0, (sill + top) / 2, 0.04, top - sill, dp * 0.8, 0);   // mullion
      if (top - sill > 1.5) bar(0, sill + (top - sill) * 0.72, g.wid, 0.04, dp * 0.8, 0);   // transom
      // outer sill (projects past the wall face) and inner window board
      const o = th / 2;
      const sillTint = ex.sill || '#cfcac0';
      bar(0, sill - 0.025, g.wid + 0.24, 0.05, 0.14, o + 0.03, sillTint);
      bar(0, sill + 0.005, g.wid + 0.1, 0.03, 0.10, -o + 0.04, sillTint);
      if (ex.chajja) bar(0, top + 0.06, g.wid + 0.5, 0.06, 0.45, o + 0.2, sillTint);
    };
    for (const c of cols) {
      if (!c.gap) { out(c.sa, c.sb, y0, y0 + h, kind0, mat, str0); continue; }
      const g = c.gap, sm = (c.sa + c.sb) / 2 - g.a;
      // evaluate the profile at the strip centre (rect: constant)
      const [lo, hi] = g.profile(Math.min(g.wid, Math.max(0, sm)));
      const yLo = y0 + lo, yHi = y0 + Math.min(hi, h - 0.05);
      if (lo > 0.04) out(c.sa, c.sb, y0, yLo, 'wall', mat, true);                     // sill / below the round head
      out(c.sa, c.sb, yHi, y0 + h, 'lintel', 'rcc', false);                          // lintel (RCC beam / arch ring) above the hole
      if (g.door) {
        const leafTop = g.kind === 'arch' ? Math.max(g.sill + 0.3, g.h - g.wid / 2) : Math.min(g.h, h - 0.05);
        if (yHi > y0 + leafTop + 0.05) out(c.sa, c.sb, y0 + leafTop, yHi, 'pane', 'glass', false);   // fan-light above the leaf
        if (!g._leaf) {
          g._leaf = true;
          const e = out(g.a + 0.02, g.a + g.wid - 0.02, y0 + g.sill, y0 + leafTop, 'door', 'wood', false, true, { hinge: g.hinge || 'L', garage: !!g.garage });
          frame({ ...g, h: g.sill + (leafTop) }, e, true);
        }
      } else if (g.pane) {
        const e = out(c.sa, c.sb, yLo, yHi, 'pane', 'glass', false);
        if (e && !g._deco) { g._deco = true; frame(g, e, false); }
      }
    }
  };

  const exOf = (S) => { const o = {}; for (const k of ['tint', 'interior', 'anchored', 'parapet', 'railing', 'src', 'slabLook', 'roof', 'stair', 'tag', 'cant', 'fin', 'ghost', 'trim', 'sill', 'chajja', 'doorTint']) if (S[k] !== undefined) o[k] = S[k]; if (S.interior) o.out = null; return o; };
  let runId = 100000;
  for (const S of shapes) {
    const mat = S.mat || 'rcc';
    if (S.t === 'line') {
      const dx = S.x1 - S.x0, dz = S.z1 - S.z0, L = Math.hypot(dx, dz), tx = dx / L, tz = dz / L;
      const n = [tz, 0, -tx];   // outward = to the right of the walking direction (flip with S.flip)
      if (S.flip) { n[0] = -n[0]; n[2] = -n[2]; }
      wallRows((s) => [S.x0 + tx * s, 0, S.z0 + tz * s], () => [tx, 0, tz], S.y0 || 0, S.h, L, S.thick || 0.23, mat, S.gaps, runId++, 0, () => n, S.f || 0, PANEL_W, exOf(S), S.kind || 'wall', S.str ?? true);
    } else if (S.t === 'arc') {
      const a0 = S.a0 ?? 0, a1 = S.a1 ?? Math.PI * 2, L = S.r * (a1 - a0);
      const ang = (s) => a0 + s / S.r;
      wallRows((s) => [S.cx + Math.cos(ang(s)) * S.r, 0, S.cz + Math.sin(ang(s)) * S.r], (s) => [-Math.sin(ang(s)), 0, Math.cos(ang(s))], S.y0 || 0, S.h, L, S.thick || 0.23, mat, S.gaps, runId++, 0, (s) => (S.inward ? [-Math.cos(ang(s)), 0, -Math.sin(ang(s))] : [Math.cos(ang(s)), 0, Math.sin(ang(s))]), S.f || 0, Math.min(PANEL_W, Math.max(0.35, Math.sqrt(8 * S.r * 0.03))), exOf(S), S.kind || 'wall', S.str ?? true);
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
    } else if (S.t === 'beam') {
      const dx = S.x1 - S.x0, dy = S.y1 - S.y0, dz = S.z1 - S.z0, L = Math.hypot(dx, dy, dz) || 1;
      const X = [dx / L, dy / L, dz / L];
      let Z = Math.abs(X[1]) > 0.99 ? [0, 0, 1] : norm(cross(X, [0, 1, 0]));
      const Y = norm(cross(Z, X));
      decoBox(null, [(S.x0 + S.x1) / 2, (S.y0 + S.y1) / 2, (S.z0 + S.z1) / 2], X, Y, Z, L / 2, (S.h || 0.05) / 2, (S.w || 0.05) / 2, S.tint, S.f || 0);
    } else if (S.t === 'box' && S.deco) {
      decoBox(null, [S.cx, (S.y0 || 0) + S.h / 2, S.cz], [1, 0, 0], [0, 1, 0], [0, 0, 1], S.w / 2, S.h / 2, S.d / 2, S.tint, S.f || 0);
    } else if (S.t === 'box') {
      const o = { w: S.w, d: S.d, h: S.h };
      panel('wall', S.mat || 'rcc', true, [S.cx, (S.y0 || 0) + S.h / 2, S.cz], [0, 1, 0], [0, 0, 1], S.w, S.h, S.d, runId++, 0, S.w, { f: S.f || 0, rest: { solidBlock: true, ...exOf(S) } });
    } else if (S.t === 'col') {
      add({ kind: 'col', mat: 'rcc', str: true, f: S.f || 0, run: null, axis: 'x', s0: 0, s1: 0, cx: S.cx, cy: (S.y0 || 0) + S.h / 2, cz: S.cz, hx: S.s / 2, hy: S.h / 2, hz: S.s / 2, out: null, interior: false });
    }
  }
}
