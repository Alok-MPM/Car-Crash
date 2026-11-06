// Architect: a short brief (kind, size, floors, style) -> a complete DESIGN (rooms on every floor, stair well, head-house, facade features).
// The Design Lab edits the same DESIGN, so a generated house can be changed room by room afterwards.
import { SLAB, T_EXT, STYLES } from './compile.js';

const q25 = (v) => Math.round(v * 4) / 4;
function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// split a band [x0,x1] x [z0,z1] into rooms along x; items are dropped from the end while their minimum widths do not fit
function band(x0, x1, z0, z1, items) {
  items = items.slice();
  const avail = x1 - x0;
  while (items.length > 1 && items.reduce((a, i) => a + i.min, 0) > avail + 1e-6) items.pop();
  const total = items.reduce((a, i) => a + i.w, 0);
  const out = []; let cur = x0, acc = 0;
  items.forEach((it, i) => {
    acc += it.w;
    let nx = i === items.length - 1 ? x1 : q25(x0 + (avail * acc) / total);
    nx = Math.max(nx, cur + it.min); if (i < items.length - 1) nx = Math.min(nx, x1 - items.slice(i + 1).reduce((a, j) => a + j.min, 0));
    const { w, min, ...rest } = it;
    out.push({ ...rest, x0: cur, x1: nx, z0, z1 }); cur = nx;
  });
  return out;
}

export function generate(b = {}) {
  const kind = b.kind || 'house';
  if (kind === 'market') return market(b);
  return building(b);
}

function stairBox(iz0, iz1, H) {
  const Ht = H + SLAB, n = Math.ceil(Ht / 2 / 0.185);
  const flight = n * 0.27;
  const Lw = Math.max(flight * 0.85 + 0.95, Math.min(flight + 1.0, iz1 - iz0 - 2.6));
  return { Wd: 2.3, Lw };
}

function building(b) {
  const kind = b.kind || 'house';
  const tower = kind === 'tower';
  const style = b.style || (tower ? 'glass' : 'modern');
  const S = STYLES[style] || STYLES.modern;
  const w = b.w || (tower ? 16 : 10), d = b.d || (tower ? 13 : 9), N = Math.max(1, b.floors || (tower ? 8 : 2));
  const H = tower ? 3.2 : 3.0;
  const rnd = rng(b.seed || 7);
  const ix0 = -w / 2 + T_EXT, ix1 = w / 2 - T_EXT, iz0 = -d / 2 + T_EXT, iz1 = d / 2 - T_EXT;
  const { Wd, Lw } = stairBox(iz0, iz1, H);
  const zF = Math.ceil((iz0 + Lw) * 4 - 1e-6) / 4;
  const sx0 = tower ? q25(-Wd / 2) : ix0;                // stair strip x range
  const sx1 = sx0 + Wd;
  const stairs = { type: 'stairs', x0: sx0, x1: sx1, z0: iz0, z1: zF };
  const hallF = { type: 'hall', x0: sx0, x1: sx1, z0: zF, z1: iz1 };
  const zones = tower ? [[ix0, sx0], [sx1, ix1]] : [[sx1, ix1]];
  const floors = [];
  let frontRooms = [];                                   // for balconies: first-floor front rooms
  for (let f = 0; f < N; f++) {
    const rooms = [stairs, hallF].map((r) => ({ ...r }));
    for (const [zx0, zx1] of zones) {
      const wz = zx1 - zx0;
      if (f === 0) {
        let gx0 = zx1;
        if (b.garage && !tower && wz >= 7.0) gx0 = zx1 - 3.2;
        const mx1 = gx0;
        const frontType = b.shopGround || tower ? 'shop' : 'living';
        rooms.push({ type: frontType, x0: zx0, x1: mx1, z0: zF, z1: iz1 });
        if (tower) rooms.push(...band(zx0, mx1, iz0, zF, [{ type: 'store', w: 1, min: 1.5 }]));
        else if (wz >= 5.6) rooms.push(...band(zx0, mx1, iz0, zF, [{ type: 'kitchen', w: 1, min: 2.4 }, { type: 'dining', w: 0.85, min: 2.2 }, { type: 'toilet', w: 0.45, min: 1.5 }]));
        else rooms.push(...band(zx0, mx1, iz0, zF, [{ type: 'kitchen', w: 1, min: 2.4 }, { type: 'toilet', w: 0.5, min: 1.5 }]));
        if (gx0 < zx1) {
          const gz0 = Math.max(iz0, q25(iz1 - 6.0));
          rooms.push({ type: 'garage', x0: gx0, x1: zx1, z0: gz0 > iz0 + 1.8 ? gz0 : iz0, z1: iz1 });
          if (gz0 > iz0 + 1.8) rooms.push({ type: 'store', x0: gx0, x1: zx1, z0: iz0, z1: gz0 });
        }
      } else {
        const frontD = iz1 - zF;
        const corridor = !tower && frontD >= 3.95;
        const fz0 = corridor ? zF + 1.15 : zF;
        if (corridor) rooms.push({ type: 'corridor', x0: zx0, x1: zx1, z0: zF, z1: fz0 });
        let fr;
        if (tower) fr = [{ type: 'living', x0: zx0, x1: zx1, z0: zF, z1: iz1, balcony: true }];
        else if (corridor) fr = band(zx0, zx1, fz0, iz1, [{ type: 'bedroom', w: 1.0, min: 3.0, balcony: true }, { type: f === N - 1 && N > 2 ? 'study' : 'bedroom', w: 0.8, min: 2.8 }]);
        else fr = [{ type: 'lounge', x0: zx0, x1: zx1, z0: zF, z1: iz1, balcony: true }];
        rooms.push(...fr);
        if (f === 1) frontRooms = frontRooms.concat(fr.filter((r) => r.balcony));
        rooms.push(...band(zx0, zx1, iz0, zF, tower
          ? [{ type: 'bedroom', w: 1, min: 3.0 }, { type: 'bath', w: 0.4, min: 1.5 }]
          : [{ type: 'bedroom', w: 1, min: 2.8 }, { type: 'bath', w: 0.45, min: 1.5 }, { type: 'bedroom', w: 0.9, min: 2.8 }]));
      }
    }
    floors.push({ h: H, rooms, openings: [] });
  }
  // head-house over the stair well: roof access
  floors.push({ h: 2.4, headhouse: true, openings: [], rooms: [{ ...stairs }, { type: 'hall', x0: sx0, x1: sx1, z0: zF, z1: Math.min(iz1, zF + 1.5) }] });

  // ---- facade features (what makes it look like a designed house and not a box)
  const features = [];
  const o = { frame: true, fins: true, balcony: true, round: true, canopy: true, tank: true, ...(b.opts || {}) };
  const zf = d / 2;                                       // outer face of the front wall
  const bx0 = -w / 2, bx1 = w / 2;
  const mk = (o) => features.push({ ...o });
  if (style === 'modern' || style === 'dark' || style === 'glass') {
    // projecting balcony slab over the entrance (canopy) and a round balcony in front of the master room on the next floor
    const canopyX0 = sx0 - 0.1, canopyX1 = sx1 + 0.1;
    if (!tower) {
      if (o.canopy) mk({ t: 'balcony', f: 1, x0: canopyX0, x1: canopyX1, d: 1.6, rail: 'none', zf, slabTint: S.slab, round: 0 });
      if (o.balcony) for (const r of frontRooms) {
        const bw = Math.min(r.x1 - r.x0 - 0.6, 3.6);
        const cx = (r.x0 + r.x1) / 2;
        mk({ t: 'balcony', f: 1, x0: cx - bw / 2, x1: cx + bw / 2, d: 1.3, rail: S.rail, round: o.round && style === 'modern' ? 0.6 : 0, zf, slabTint: S.slab });
        if (N >= 3) mk({ t: 'balcony', f: 2, x0: cx - bw / 2, x1: cx + bw / 2, d: 1.3, rail: S.rail, round: o.round && style === 'modern' ? 0.6 : 0, zf, slabTint: S.slab });
      }
      // facade skin over the stair strip: wooden fins (dark / modern) or a solid accent panel
      if (o.fins) mk({ t: style === 'dark' ? 'fins' : 'panel', f0: 1, f1: N - 1, x0: sx0 + 0.1, x1: sx1 - 0.1, zf, tint: style === 'dark' ? undefined : S.accent, depth: 0.1, spacing: 0.2 });
      if (o.frame && style === 'modern' && N >= 2) mk({ t: 'frame', f0: 0, f1: N - 1, x0: bx0, x1: bx1, zf: zf + 0.0, depth: 0.45, th: 0.3, tint: S.slab });
    } else {
      for (let f = 1; f < N; f++) for (const [zx0, zx1] of zones) {
        const bw = Math.min(zx1 - zx0 - 1.2, 4.4), cx = (zx0 + zx1) / 2;
        if ((f + (zx0 < 0 ? 0 : 1)) % 2 === 0) mk({ t: 'balcony', f, x0: cx - bw / 2, x1: cx + bw / 2, d: 1.5, rail: 'glass', round: 0, zf, slabTint: S.slab });
      }
    }
  } else {
    // classic / brick: small balconies with solid rails
    for (const r of frontRooms) { const bw = Math.min(r.x1 - r.x0 - 0.8, 2.6), cx = (r.x0 + r.x1) / 2; mk({ t: 'balcony', f: 1, x0: cx - bw / 2, x1: cx + bw / 2, d: 1.2, rail: 'solid', zf, slabTint: S.slab }); }
  }
  if (o.tank) mk({ t: 'tank', x: q25(ix1 - 1.5), z: q25(iz0 + 1.5) });

  return {
    name: b.name || (tower ? 'Tower' : 'House'), style, chajja: !!(b.opts && b.opts.chajja), seed: b.seed || 7, mat: b.mat || S.mat, openStyle: b.openStyle || (style === 'classic' ? 'arch' : 'rect'),
    glazing: tower, floors, features, parapet: true, brief: { kind, w, d, floors: N, garage: !!b.garage, style, shopGround: !!b.shopGround, openStyle: b.openStyle, opts: b.opts || {}, seed: b.seed || 7 },
  };
}

function market(b) {
  const w = b.w || 12, d = b.d || 8, S = STYLES[b.style || 'brick'];
  const ix0 = -w / 2 + T_EXT, ix1 = w / 2 - T_EXT, iz0 = -d / 2 + T_EXT, iz1 = d / 2 - T_EXT;
  const zb = q25(iz0 + 2.0);
  const floors = [{ h: 3.4, openings: [{ x: 0, z: iz1, kind: 'door', w: 2.0 }], rooms: [
    { type: 'shop', x0: ix0, x1: ix1, z0: zb, z1: iz1 }, { type: 'store', x0: ix0, x1: ix1, z0: iz0, z1: zb }] }];
  return { name: b.name || 'Market', style: b.style || 'brick', seed: b.seed || 3, mat: 'clay', openStyle: 'rect', floors, parapet: true,
    features: [{ t: 'balcony', f: 1, x0: -w / 2, x1: w / 2, d: 1.6, rail: 'none', zf: d / 2, slabTint: '#b3402f' }], brief: { kind: 'market', w, d, floors: 1, style: b.style || 'brick' } };
}
