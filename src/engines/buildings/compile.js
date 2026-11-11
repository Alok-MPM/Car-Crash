// Architect compiler: a DESIGN (rooms per floor, optional free walls, stairs, facade features) -> shapes + furniture + rooms for the
// Building Engine. The designer only says WHERE rooms are and what they are; the compiler works out the rest the way an architect would:
//   - exterior walls from the outline, partitions between rooms (never between a stair well and its landing hall)
//   - doors so that every room can be reached from the entrance, open arches between living / dining / kitchen
//   - windows sized by room type, an entrance door on the front, a garage door, glass doors to balconies
//   - slabs under every storey with openings above the stair well, dog-leg stairs with mid-landing and a roof head-house
//   - furniture laid out against the walls but clear of the doors, kitchens with hob / sink / fridge, bathrooms, shops
// Coordinates: metres, x right, z towards the street (front = +z). Floor f stands on y = base[f].
import { prof, PLANES } from './shapes.js'
import { applyPalette, windowType } from './catalog.js';
export const T_EXT = 0.23, T_PART = 0.115, SLAB = 0.2;
const E = 0.04;
const snap = (v) => Math.round(v * 20) / 20;

export const STYLES = {
  modern: { inner: '#ece7dc', out: '#e9e6df', trim: '#33363b', wood: '#a8774a', accent: '#d9d5cc', mat: 'block', fin: '#a8774a', rail: 'glass', slab: '#f1efe9' },
  dark:   { inner: '#ddd8ce', out: '#6a6d72', trim: '#1e2023', wood: '#8b6746', accent: '#2c2e32', mat: 'block', fin: '#3a3c40', rail: 'glass', slab: '#2f3135', frontTint: '#3b3d41' },
  classic:{ inner: '#f0e4c9', out: '#e6d7b4', trim: '#a4492f', wood: '#7a5233', accent: '#b5603f', mat: 'clay', fin: '#7a5233', rail: 'solid', slab: '#efe7d3' },
  brick:  { inner: '#e8decc', out: '#b3593a', trim: '#e8dfcf', wood: '#6d4a2e', accent: '#d9cdb8', mat: 'clay', fin: '#6d4a2e', rail: 'solid', slab: '#d8cdb9' },
  glass:  { inner: '#e6e8ea', out: '#c7ccd1', trim: '#2a2d31', wood: '#8f9499', accent: '#3a4249', mat: 'block', fin: '#aab0b6', rail: 'glass', slab: '#d8dbde' },
};

const WIN = {   // exterior window per room type: width, sill, height, minimum wall length
  living: [2.1, 0.45, 2.1], lounge: [1.8, 0.5, 2.1], bedroom: [1.5, 0.9, 2.1], kitchen: [1.2, 1.0, 1.2], dining: [1.5, 0.9, 2.1],
  bath: [0.6, 1.6, 0.6], toilet: [0.6, 1.6, 0.6], hall: [1.0, 0.9, 2.1], study: [1.4, 0.9, 2.1], store: [0.8, 1.5, 0.6], office: [1.6, 0.9, 2.1], corridor: [0.9, 0.9, 2.1], shop: [3.0, 0.0, 2.4],
};
const OPEN_PAIRS = new Set(['living|dining', 'dining|kitchen', 'living|kitchen', 'hall|living', 'hall|lounge', 'corridor|hall', 'corridor|lounge']);

// ---------- helpers ----------
function subRects(r, holes) {
  let out = [r];
  for (const h of holes) {
    const n = [];
    for (const a of out) {
      const ox0 = Math.max(a.x0, h.x0), ox1 = Math.min(a.x1, h.x1), oz0 = Math.max(a.z0, h.z0), oz1 = Math.min(a.z1, h.z1);
      if (ox1 - ox0 < 1e-3 || oz1 - oz0 < 1e-3) { n.push(a); continue; }
      if (oz0 > a.z0 + 1e-3) n.push({ x0: a.x0, x1: a.x1, z0: a.z0, z1: oz0 });
      if (oz1 < a.z1 - 1e-3) n.push({ x0: a.x0, x1: a.x1, z0: oz1, z1: a.z1 });
      if (ox0 > a.x0 + 1e-3) n.push({ x0: a.x0, x1: ox0, z0: oz0, z1: oz1 });
      if (ox1 < a.x1 - 1e-3) n.push({ x0: ox1, x1: a.x1, z0: oz0, z1: oz1 });
    }
    out = n;
  }
  return out.filter((r) => r.x1 - r.x0 > 0.05 && r.z1 - r.z0 > 0.05);
}

// ---------- walls from rooms ----------
// A wall segment lies on a line (axis 'x' = runs along x at z=c, 'z' = runs along z at x=c) and has a room on one or both sides.
export function deriveWalls(rooms) {
  const lines = new Map();
  const addEdge = (axis, c, a0, a1, side, R) => {
    const k = axis + ':' + snap(c).toFixed(2);
    if (!lines.has(k)) lines.set(k, { axis, c: snap(c), edges: [] });
    lines.get(k).edges.push({ a0, a1, side, R });
  };
  for (const R of rooms) {
    addEdge('x', R.z0, R.x0, R.x1, +1, R); addEdge('x', R.z1, R.x0, R.x1, -1, R);
    addEdge('z', R.x0, R.z0, R.z1, +1, R); addEdge('z', R.x1, R.z0, R.z1, -1, R);
  }
  const segs = [];
  for (const L of lines.values()) {
    const pts = [...new Set(L.edges.flatMap((e) => [snap(e.a0), snap(e.a1)]))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < pts.length; i++) {
      const a0 = pts[i], a1 = pts[i + 1];
      if (a1 - a0 < 0.1) continue;
      const mid = (a0 + a1) / 2;
      const cover = L.edges.filter((e) => e.a0 <= mid && e.a1 >= mid);
      const pos = cover.find((e) => e.side > 0), neg = cover.find((e) => e.side < 0);
      if (!pos && !neg) continue;
      const prev = segs[segs.length - 1];
      const same = prev && prev.axis === L.axis && prev.c === L.c && Math.abs(prev.a1 - a0) < 1e-6 && prev.A === (pos ? pos.R : null) && prev.B === (neg ? neg.R : null);
      if (same) { prev.a1 = a1; continue; }
      segs.push({ axis: L.axis, c: L.c, a0, a1, A: pos ? pos.R : null, B: neg ? neg.R : null, ext: !(pos && neg), out: pos && neg ? null : (pos ? -1 : 1), gaps: [] });
    }
  }
  return segs;
}

const segPoint = (s, a) => (s.axis === 'x' ? [a, s.c] : [s.c, a]);
const segDist = (s, x, z) => { const [px, pz] = s.axis === 'x' ? [x, z] : [z, x]; return Math.abs(pz - s.c); };
const segPos = (s, x, z) => (s.axis === 'x' ? x : z);

// ---------- main entry ----------
export function compileDesign(D) {
  const style = applyPalette(STYLES[D.style] || STYLES.modern, STYLES[D.style] ? D.style : 'modern', D.seed || 7);
  const WOODY = D.style === 'modern' || D.style === 'dark';   // fins / louvres on these styles are timber
  const mat = D.mat || style.mat || 'block';
  const floors = D.floors;
  const shapes = [], furn = [], rooms = [], hazards = [], stairsOut = [], acts = [], issues = [];
  const H = floors.map((f) => f.h || D.H || 3.0);
  const base = [0]; for (let f = 0; f < floors.length; f++) base.push(base[f] + H[f] + SLAB);
  let slabN = 0;
  const slabRects = floors.map(() => []);       // for furniture -> slab tag

  // bounds of everything on the ground floor
  const gr = floors[0].rooms;
  const bx0 = Math.min(...gr.map((r) => r.x0)) - T_EXT, bx1 = Math.max(...gr.map((r) => r.x1)) + T_EXT;
  const bz0 = Math.min(...gr.map((r) => r.z0)) - T_EXT, bz1 = Math.max(...gr.map((r) => r.z1)) + T_EXT;
  const bounds = { x0: bx0, x1: bx1, z0: bz0, z1: bz1 };

  floors.forEach((F, f) => {
    const Rs = F.rooms.map((r, i) => ({ ...r, id: r.id ?? `f${f}r${i}`, f, x0: snap(r.x0), x1: snap(r.x1), z0: snap(r.z0), z1: snap(r.z1) }));
    const segs = deriveWalls(Rs);
    const y0 = base[f], h = H[f];

    // ---- stair wells on this floor
    const wells = Rs.filter((r) => r.type === 'stairs');
    // ---- openings: manual first, then automatic
    const manual = (F.openings || []);
    const takeManual = (s) => {
      for (const o of manual) {
        if (o.kind === 'block') continue;
        if (segDist(s, o.x, o.z) > 0.35) continue;
        const a = segPos(s, o.x, o.z) - s.a0, len = s.a1 - s.a0;
        const w = o.w || (o.kind === 'door' ? 1.0 : 1.3);
        if (a < 0.1 || a > len - 0.1) continue;
        const aa = Math.max(0.12, Math.min(len - w - 0.12, a - w / 2));
        if (len < w + 0.2) continue;
        if (s.gaps.some((g) => aa < g.a + g.wid + 0.1 && aa + w > g.a - 0.1)) continue;
        s.gaps.push(gapFor(o.kind, w, o.sill, o.h, o.style || D.openStyle, s, aa));
      }
    };
    const blocked = (s, a) => manual.some((o) => o.kind === 'block' && segDist(s, o.x, o.z) < 0.4 && Math.abs(segPos(s, o.x, o.z) - s.a0 - a) < 0.9);

    // connectivity of rooms through partition doors
    const doorSegs = [], liftSegs = [];
    for (const s of segs) {
      takeManual(s);
      if (s.ext) continue;
      const ta = s.A.type, tb = s.B.type;
      if ((ta === 'stairs' && tb === 'hall') || (ta === 'hall' && tb === 'stairs') || (ta === 'stairs' && tb === 'stairs')) { s.open = true; continue; }
      if (ta === 'stairs' || tb === 'stairs') continue;
      if (ta === 'lift' || tb === 'lift') { const o = ta === 'lift' ? tb : ta; if (o === 'hall' || o === 'corridor' || o === 'lounge') liftSegs.push(s); continue; }
      doorSegs.push(s);
    }
    const parent = new Map(Rs.map((r) => [r, r]));
    const find = (r) => { while (parent.get(r) !== r) { parent.set(r, parent.get(parent.get(r))); r = parent.get(r); } return r; };
    const join = (a, b) => parent.set(find(a), find(b));
    for (const s of segs) if (s.open) join(s.A, s.B);
    for (const s of liftSegs) {   // landing door of the lift shaft, centred on the shaft
      const L = (s.A.type === 'lift' ? s.A : s.B), dw = (L.lift && L.lift.dw) || 0.9, len = s.a1 - s.a0;
      if (len >= dw + 0.3) s.gaps.push({ wid: dw, sill: 0, h: 2.1, kind: 'rect', a: (len - dw) / 2, liftDoor: true });
      join(s.A, s.B);
    }
    const prio = (s) => {
      const pair = [s.A.type, s.B.type].sort().join('|');
      const hallish = ['hall', 'corridor', 'lounge'];
      if (hallish.includes(s.A.type) || hallish.includes(s.B.type)) return 0;
      if (OPEN_PAIRS.has(pair)) return 1;
      return 2;
    };
    const longest = (s) => s.a1 - s.a0;
    const cand = doorSegs.slice().sort((p, q) => prio(p) - prio(q) || longest(q) - longest(p));
    for (const s of cand) {
      const pair = [s.A.type, s.B.type].sort().join('|');
      const isOpen = OPEN_PAIRS.has(pair);
      const need = find(s.A) !== find(s.B);
      if (!need && !(isOpen && !F.noOpenArches)) continue;
      const len = s.a1 - s.a0;
      if (len < 0.95) continue;
      if (s.gaps.length && !isOpen) { join(s.A, s.B); continue; }
      if (s.gaps.length) { join(s.A, s.B); continue; }
      const w = isOpen ? Math.min(2.0, len - 0.5) : 0.95;
      if (w < 0.8) continue;
      let a = (len - w) / 2;
      // keep the door away from a crossing wall: nudge towards the side of the longer neighbour
      if (!isOpen && len > 2.2) a = Math.min(len - w - 0.25, Math.max(0.25, len * 0.3));
      if (blocked(s, a + w / 2)) continue;
      s.gaps.push(isOpen ? { wid: w, sill: 0, h: 2.2, kind: 'rect', a } : { wid: w, sill: 0, h: 2.1, kind: 'rect', a, door: true });
      join(s.A, s.B);
    }
    for (const r of Rs) if (find(r) !== find(Rs[0])) { issues.push(`${r.type} on floor ${f} has no way in`); }

    // exterior openings
    for (const s of segs) {
      if (!s.ext) continue;
      const room = s.A || s.B, len = s.a1 - s.a0;
      const isFront = s.axis === 'x' && s.out > 0;
      const entry = f === 0 && isFront && room.type === 'hall';
      if (entry && !s.gaps.some((g) => g.door) && len >= 1.4 && !F.noEntry && !blocked(s, len / 2)) {
        const w = 1.1; const a = Math.min(len - w - 0.15, Math.max(0.15, (len - w) / 2));
        s.gaps.push({ wid: w, sill: 0, h: D.openStyle === 'arch' ? 2.4 : 2.2, kind: D.openStyle === 'arch' ? 'arch' : 'rect', a, door: true, front: true });
      }
      if (room.type === 'garage') {
        if (isFront && len >= 2.4) { const w = Math.min(3.0, len - 0.6); s.gaps.push({ wid: w, sill: 0, h: 2.3, kind: 'rect', a: (len - w) / 2, door: true, garage: true }); }
        continue;
      }
      if (room.type === 'lift') continue;
      if (F.frontGlass && isFront) {   // full-width glazing bays (sliding glass behind deep pods / balconies)
        for (const [u0, u1] of F.frontGlass) {
          const aa = Math.max(0.3, u0 - s.a0), bb = Math.min(len - 0.3, u1 - s.a0);
          if (bb - aa < 0.9) continue;
          if (s.gaps.some((g) => aa < g.a + g.wid + 0.2 && bb > g.a - 0.2)) continue;
          s.gaps.push({ wid: bb - aa, sill: 0.1, h: Math.min(h - 0.35, 2.8), kind: 'rect', a: aa, pane: true, wtype: 'slider' });
        }
      }
      if (room.type === 'stairs') { if (len >= 1.2 && f < floors.length - 1) { const w = Math.min(0.9, len - 0.5); s.gaps.push({ wid: w, sill: 1.0, h: 2.4, kind: 'rect', a: (len - w) / 2, pane: true }); } continue; }
      const spec = WIN[room.type] || WIN.hall;
      let ww = spec[0];
      if (D.glazing) ww = Math.min(2.6, Math.max(spec[0], 2.2));
      const nWin = Math.max(len >= ww + 0.6 ? 1 : 0, Math.floor(len / (D.glazing ? 3.0 : 2.8)));
      const bal = room.balcony && isFront;
      for (let i = 0; i < nWin; i++) {
        let w = Math.min(ww, (len / nWin) - 0.5);
        if (w < 0.5) continue;
        const a = (len / nWin) * (i + 0.5) - w / 2;
        if (s.gaps.some((g) => a < g.a + g.wid + 0.3 && a + w > g.a - 0.3)) continue;
        if (blocked(s, a + w / 2)) continue;
        if (bal && i === Math.floor(nWin / 2)) { s.gaps.push({ wid: Math.min(1.9, w + 0.3), sill: 0, h: 2.3, kind: 'rect', a: Math.max(0.15, a - 0.15), pane: true, bdoor: true, wtype: 'slider' }); continue; }
        s.gaps.push({ wid: w, sill: Math.min(spec[1], 1.2), h: Math.min(spec[1] + spec[2], h - 0.35), kind: D.openStyle === 'arch' && spec[1] > 0 && room.type !== 'bath' ? 'arch' : 'rect', a, pane: true, wtype: windowType(D.style, room.type, w, Math.min(spec[1] + spec[2], h - 0.35) - Math.min(spec[1], 1.2), (D.seed || 7) + f * 5 + i) });
      }
    }
    for (const s of segs) s.gaps.sort((p, q) => p.a - q.a);

    // ---- wall shapes
    const frontTint = style.frontTint;
    for (const s of segs) {
      const liftWall = !!((s.A && s.A.type === 'lift') || (s.B && s.B.type === 'lift'));
      let a0 = s.a0, a1 = s.a1, c = s.c, th = s.ext ? T_EXT : (liftWall ? 0.2 : T_PART);
      if (s.ext) {
        c += (s.axis === 'x' ? s.out : s.out) * T_EXT / 2;
        if (s.axis === 'x') { a0 -= T_EXT; a1 += T_EXT; }
      } else { a0 -= T_PART / 2; a1 += T_PART / 2; }
      const shift = s.a0 - a0;   // gaps were measured from s.a0
      if (s.open) continue;
      const gaps = s.gaps.map((g) => ({ ...g, a: g.a + shift, hinge: g.door ? (g.hinge || (((Math.round(s.c * 10) + Math.round(g.a * 10)) & 1) ? 'L' : 'R')) : undefined }));
      const m = liftWall ? 'rcc' : s.ext ? mat : (mat === 'clay' ? 'clay' : 'block');
      const srcKey = `f${f}:${s.axis}${s.c}`;
      const tint = s.ext ? ((D.tints && D.tints[srcKey]) || (frontTint && s.axis === 'x' && s.out > 0 ? frontTint : (F.tint || undefined))) : undefined;
      const extra = s.ext ? { tint, trim: style.trim, glassTint: style.glass, sill: style.sillC, doorTint: style.wood, chajja: !!D.chajja || D.style === 'classic' } : { interior: true, trim: '#ece7dc', doorTint: style.wood, core: liftWall };
      if (s.axis === 'x') {
        // walking +x; outward normal for a "line" = right of walking direction = (tz,-tx) -> (0,-1) i.e. -z; flip when outward is +z
        shapes.push({ t: 'line', x0: a0, z0: c, x1: a1, z1: c, y0, h, thick: th, mat: m, gaps, flip: s.ext ? s.out > 0 : false, f, ...extra, src: srcKey });
      } else {
        // walking +z; right of direction = (+1,0): outward +x needs no flip
        shapes.push({ t: 'line', x0: c, z0: a0, x1: c, z1: a1, y0, h, thick: th, mat: m, gaps, flip: s.ext ? s.out < 0 : false, f, ...extra, src: srcKey });
      }
      s.placed = { c, a0, a1 };
    }
    F._segs = segs;

    // ---- slab above this floor
    const ySlab = y0 + h;
    const holes = [];
    const nextHasWell = f + 1 < floors.length && floors[f + 1].rooms.some((r) => r.type === 'stairs');
    for (const W of wells) if (nextHasWell) for (const r of stairHoles(W, h)) holes.push(r);
    if (f + 1 < floors.length) for (const R of Rs) if (R.type === 'lift' && floors[f + 1].rooms.some((q) => q.type === 'lift' && Math.abs(q.x0 - R.x0) < 0.1 && Math.abs(q.z0 - R.z0) < 0.1)) holes.push({ x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1 });
    const roofSlab = f === floors.length - 1;
    const addSlab = (r) => {
      for (const p of subRects(r, holes)) {
        const tag = `s${f}:${slabN++}`;
        shapes.push({ t: 'box', cx: (p.x0 + p.x1) / 2, cz: (p.z0 + p.z1) / 2, y0: ySlab, w: p.x1 - p.x0, d: p.z1 - p.z0, h: SLAB, f, slabLook: true, roof: roofSlab, tag, tint: F.slabTint || style.slab });
        slabRects[f].push({ ...p, tag });
      }
    };
    for (const R of Rs) addSlab({ x0: R.x0 - 0.06, x1: R.x1 + 0.06, z0: R.z0 - 0.06, z1: R.z1 + 0.06 });
    for (const s of segs) if (s.ext) {
      const cin = s.c - s.out * 0.06, cout = s.c + s.out * T_EXT, ext = s.axis === 'x' ? T_EXT : 0;
      if (s.axis === 'x') addSlab({ x0: s.a0 - ext, x1: s.a1 + ext, z0: Math.min(cin, cout), z1: Math.max(cin, cout) });
      else addSlab({ x0: Math.min(cin, cout), x1: Math.max(cin, cout), z0: s.a0, z1: s.a1 });
    }
    // rooms for the interior mesh / furniture
    for (const R of Rs) rooms.push({ f, type: R.type, x0: R.x0, x1: R.x1, z0: R.z0, z1: R.z1, y: y0, id: R.id, slabBelow: f > 0 ? null : -1, _R: R });
  });

  // ---------- stairs: dog-leg concrete stair, solid steps with nosing and stepped soffit, wall handrails + balustrade, mid-landing ----------
  floors.forEach((F, f) => {
    if (f + 1 >= floors.length) return;
    const wells = F.rooms.filter((r) => r.type === 'stairs');
    for (const W of wells) {
      if (!floors[f + 1].rooms.some((r) => r.type === 'stairs')) continue;
      const g = stairGeom(W, H[f]);
      const b = base[f], x0 = W.x0, x1 = W.x1, z1 = W.z1, z0 = W.z0;
      const half = g.half, seam = x0 + half + 0.06, wB = x1 - x0 - half - 0.12;
      const stone = style.stair || '#c9c4b8', rail = style.trim || '#2a2c30';
      const box = (cx, cz, w, d, top, th) => shapes.push({ t: 'box', cx, cz, y0: top - th, w, d, h: th, f, stair: true, anchored: true, tint: stone });
      for (let i = 0; i < g.n; i++) {
        box(x0 + half / 2, z1 - (i + 0.5) * g.tread, half, g.tread + 0.03, b + (i + 1) * g.rise, g.rise + 0.18);                                   // flight A going back
        box(x1 - wB / 2, z1 - g.flight + (i + 0.5) * g.tread, wB, g.tread + 0.03, b + g.Ht / 2 + (i + 1) * g.rise, g.rise + 0.18);                 // flight B coming forward
      }
      const landD = (z1 - g.flight) - z0;
      if (landD > 0.05) box((x0 + x1) / 2, z0 + landD / 2, x1 - x0, landD, b + g.Ht / 2, 0.2);
      // invisible guard wall between the flights (and as a guard rail around the opening above): the walker cannot step across
      shapes.push({ t: 'line', x0: seam, z0: z1 - g.flight, x1: seam, z1: z1, y0: b, h: g.Ht + 1.0, thick: 0.08, mat: 'block', gaps: [], f, interior: true, ghost: true, anchored: true });
      // handrails (sloped bars) on the wall sides and balusters + rail along the open seam
      const hr = 0.9, beam = (xx, za, ya, zb, yb) => shapes.push({ t: 'beam', x0: xx, y0: ya, z0: za, x1: xx, y1: yb, z1: zb, h: 0.05, w: 0.05, tint: rail, f });
      beam(seam - 0.03, z1, b + g.rise + hr, z1 - g.flight, b + g.Ht / 2 + hr);                          // A, seam side
      beam(seam + 0.09, z1 - g.flight, b + g.Ht / 2 + g.rise + hr, z1, b + g.Ht + hr);                    // B, seam side
      beam(x0 + 0.07, z1, b + g.rise + hr, z1 - g.flight, b + g.Ht / 2 + hr);                             // A, wall side
      beam(x1 - 0.07, z1 - g.flight, b + g.Ht / 2 + g.rise + hr, z1, b + g.Ht + hr);                      // B, wall side
      for (let i = 0; i < g.n; i += 2) {
        const za = z1 - (i + 0.5) * g.tread, ya = b + (i + 1) * g.rise;
        shapes.push({ t: 'box', deco: true, cx: seam - 0.03, cz: za, y0: ya, w: 0.035, d: 0.035, h: hr, tint: rail, f });
        const zb = z1 - g.flight + (i + 0.5) * g.tread, yb = b + g.Ht / 2 + (i + 1) * g.rise;
        shapes.push({ t: 'box', deco: true, cx: seam + 0.09, cz: zb, y0: yb, w: 0.035, d: 0.035, h: hr, tint: rail, f });
      }
      stairsOut.push({ t: f, base: b, Ht: g.Ht, x0, x1, z0, z1, half, flight: g.flight, n: g.n, rise: g.rise, tread: g.tread, seam });
    }
  });

  // ---------- facade features ----------
  const feat = [...(D.features || [])];
  const front = (bz1);
  // DOOR CLEARANCE (engine rule): no facade feature may ever cover an entrance, garage or balcony door on the front.
  // Zones are measured from the real door gaps; features are trimmed around them (or dropped when they cannot be trimmed).
  const doorZones = [];
  floors.forEach((F, f) => { for (const s of (F._segs || [])) if (s.ext && s.axis === 'x' && s.out > 0) for (const g of s.gaps) {
    if (!(g.door || g.bdoor)) continue;
    const [x0] = segPoint(s, s.a0 + g.a), [x1] = segPoint(s, s.a0 + g.a + g.wid);
    doorZones.push({ u0: Math.min(x0, x1) - 0.4, u1: Math.max(x0, x1) + 0.4, v0: base[f] + 0.05, v1: base[f] + 2.6 });
  } });
  // u-intervals of [u0,u1] left after removing door zones that overlap the height band [v0,v1]
  const carve = (u0, u1, v0, v1) => {
    let iv = [[u0, u1]];
    for (const z of doorZones) {
      if (z.v1 <= v0 + 0.02 || z.v0 >= v1 - 0.02) continue;
      const n = [];
      for (const [a, b] of iv) { if (z.u1 <= a || z.u0 >= b) { n.push([a, b]); continue; } if (z.u0 > a) n.push([a, z.u0]); if (z.u1 < b) n.push([z.u1, b]); }
      iv = n;
    }
    return iv.filter(([a, b]) => b - a > 0.3);
  };
  const hitsDoor = (u0, u1, v0, v1) => { const iv = carve(u0, u1, v0, v1); return !(iv.length === 1 && Math.abs(iv[0][0] - u0) < 1e-6 && Math.abs(iv[0][1] - u1) < 1e-6); };
  for (const ft of feat) {
    const tint = ft.tint;
    if (ft.t === 'balcony') {
      const f = ft.f, yb = base[f], d = ft.d || 1.3, x0 = ft.x0, x1 = ft.x1;
      const zf = ft.zf ?? bz1;                     // front face of the wall below
      const rr = ft.round || 0;
      const cell = 0.25;
      for (let z = zf; z < zf + d - 1e-6; z += cell) {
        const dd = Math.min(cell, zf + d - z);
        let xa = x0, xb = x1;
        if (rr > 0) { const dz = zf + d - (z + dd / 2); if (dz < rr) { const k = rr - Math.sqrt(Math.max(0, rr * rr - (rr - dz) * (rr - dz))); xa += k; xb -= k; } }
        if (xb - xa > 0.1) shapes.push({ t: 'box', cx: (xa + xb) / 2, cz: z + dd / 2, y0: yb - SLAB, w: xb - xa, d: dd + 0.01, h: SLAB, f: Math.max(0, f - 1), slabLook: true, tint: ft.slabTint || style.slab, cant: true, anchored: true });
      }
      const rail = ft.rail || style.rail;
      const rh = 1.05;
      if (rail !== 'none') {
        const mk = (ax, az, bx, bz) => shapes.push({ t: 'line', x0: ax, z0: az, x1: bx, z1: bz, y0: yb, h: rh, thick: rail === 'glass' ? 0.05 : 0.12, mat: rail === 'glass' ? 'glass' : mat, kind: rail === 'glass' ? 'pane' : 'wall', str: false, f, flip: true, tint: ft.railTint || (rail === 'glass' ? undefined : style.accent), railing: true, anchored: true });
        const e = 0.07;
        if (rr > 0) {
          // straight front + two quarter-round corners (as short straight pieces)
          const zc = zf + d - 0.07;
          mk(x0 + rr, zc, x1 - rr, zc);
          for (const sgn of [-1, 1]) {
            const cx = sgn < 0 ? x0 + rr : x1 - rr;
            let px = cx, pz = zc;
            for (let k = 1; k <= 4; k++) { const a = (k / 4) * (Math.PI / 2); const nx = cx + sgn * Math.sin(a) * (rr - 0.07), nz = zc - rr + 0.07 + Math.cos(a) * (rr - 0.07); mk(px, pz, nx, nz); px = nx; pz = nz; }
          }
          mk(x0 + 0.07, zf + d - rr, x0 + 0.07, zf); mk(x1 - 0.07, zf + d - rr, x1 - 0.07, zf);
        } else {
          mk(x0, zf + d - e, x1, zf + d - e); mk(x0 + e, zf + d - e, x0 + e, zf); mk(x1 - e, zf, x1 - e, zf + d - e);
        }
      }
    } else if (ft.t === 'fins') {
      const sp = ft.spacing || 0.22, th = ft.th || 0.09, dz = ft.depth || 0.16;
      const ya = base[ft.f0], yb = base[ft.f1] + H[ft.f1];
      const zf = ft.zf ?? bz1;
      for (let x = ft.x0 + sp / 2; x < ft.x1; x += sp) shapes.push({ t: 'box', cx: x, cz: zf + dz / 2 + (ft.off || 0), y0: ya, w: th, d: dz, h: yb - ya, f: ft.f0, tint: ft.tile || WOODY ? ft.tint : (ft.tint || style.fin), tile: ft.tile || (WOODY ? 'wood' : undefined), anchored: true, fin: true });
    } else if (ft.t === 'panel') {
      if (hitsDoor(ft.x0, ft.x1, base[ft.f0] + (ft.dy || 0), ft.h ? base[ft.f0] + (ft.dy || 0) + ft.h : base[ft.f1] + H[ft.f1]) && (ft.zf ?? bz1) >= bz1 - 0.01) { const iv = carve(ft.x0, ft.x1, base[ft.f0] + (ft.dy || 0), ft.h ? base[ft.f0] + (ft.dy || 0) + ft.h : base[ft.f1] + H[ft.f1]); if (!ft._carved) for (const [a, b] of iv) feat.push({ ...ft, x0: a, x1: b, _carved: true }); continue; }
      const ya = base[ft.f0] + (ft.dy || 0), yb = ft.h ? ya + ft.h : base[ft.f1] + H[ft.f1];
      shapes.push({ t: 'box', cx: (ft.x0 + ft.x1) / 2, cz: (ft.zf ?? bz1) + (ft.depth || 0.1) / 2, y0: ya, w: ft.x1 - ft.x0, d: ft.depth || 0.1, h: yb - ya, f: ft.f0, tint: ft.tint || (ft.tile ? undefined : style.accent), tile: ft.tile, anchored: true });
    } else if (ft.t === 'frame') {
      const dp = ft.depth || 0.5, th = ft.th || 0.35, yb = base[ft.f1] + H[ft.f1] + SLAB, zf = ft.zf ?? bz1;
      const ya = base[ft.f0 || 0];
      const tn = ft.tint || style.slab;
      shapes.push({ t: 'box', cx: ft.x0 + th / 2, cz: zf + dp / 2, y0: ya, w: th, d: dp, h: yb - ya, f: 0, tint: tn, anchored: true });
      shapes.push({ t: 'box', cx: ft.x1 - th / 2, cz: zf + dp / 2, y0: ya, w: th, d: dp, h: yb - ya, f: 0, tint: tn, anchored: true });
      shapes.push({ t: 'box', cx: (ft.x0 + ft.x1) / 2, cz: zf + dp / 2, y0: yb - th, w: ft.x1 - ft.x0, d: dp, h: th, f: 0, tint: tn, anchored: true });
    } else if (['cframe', 'pods', 'jali', 'louvre', 'volume'].includes(ft.t)) {
      const face = ft.face || 'front', pl = PLANES[face] || PLANES.front;
      const org = face === 'front' ? [0, 0, ft.zf ?? bz1] : face === 'back' ? [0, 0, bz0] : face === 'right' ? [bx1, 0, 0] : [bx0, 0, 0];
      const f0 = ft.f0 ?? ft.f ?? 1, f1 = ft.f1 ?? f0;
      const vLo = base[f0] + (ft.dy || 0), vHi = ft.vTop != null ? ft.vTop : base[f1] + H[f1] + SLAB;
      const woodLouvre = ft.t === 'louvre' && !ft.tile && WOODY;   // timber louvres on modern / luxury houses carry real wood grain
      const common = { o: org, face, f: f0, tint: woodLouvre ? undefined : ft.tint, tile: woodLouvre ? 'wood' : ft.tile };
      if ((face === 'front') && ['cframe', 'jali'].includes(ft.t) && hitsDoor(ft.u0, ft.u1, vLo, vHi)) { issues.push('engine: ' + ft.t + ' would block a door - removed'); continue; }
      if (face === 'front' && ft.t === 'volume') {
        const vH2 = ft.h != null ? vLo + ft.h : vHi;
        if ((ft.d ?? 1.2) > 0.2) { const iv = carve(ft.u0, ft.u1, vLo, vH2); if (!(iv.length === 1 && iv[0][0] === ft.u0 && iv[0][1] === ft.u1)) {
          for (const [a, b] of iv) feat.push({ ...ft, u0: a, u1: b, _carved: true });
          continue;
        } }
      }
      if (face === 'front' && ft.t === 'louvre') { const iv = carve(ft.u0, ft.u1, vLo, vHi); if (!(iv.length === 1 && iv[0][0] === ft.u0 && iv[0][1] === ft.u1)) { for (const [a, b] of iv) feat.push({ ...ft, u0: a, u1: b }); continue; } }
      if (ft.t === 'cframe') {
        // thick rounded frame stroked around a window group (C-frame of the modern houses)
        const path = prof.rrect(ft.u0, vLo, ft.u1, vHi, ft.r ?? 0.9, 7);
        shapes.push({ t: 'sweep', ...common, path, closed: true, w: ft.w ?? 0.35, depth: ft.depth ?? 0.6, d0: ft.d0 ?? -0.1, cant: true });
      } else if (ft.t === 'pods') {
        // projecting window pods: an outline pulled out of the wall with the window hole left open
        for (const it of ft.items || []) {
          if (face === 'front' && hitsDoor(it.u0, it.u1, base[it.f ?? f0] + (it.dy ?? 0), base[it.f ?? f0] + (it.dy ?? 0) + (it.hgt ?? 2.6))) { issues.push('engine: pod would block a door - removed'); continue; }
          const a = base[it.f ?? f0] + (it.dy ?? 0.0), b = a + (it.hgt ?? 2.6), w = it.w ?? ft.w ?? 0.28, u0 = it.u0, u1 = it.u1, cu = (u0 + u1) / 2, cv = (a + b) / 2;
          // poured concrete ring: a closed path (inset by half the stroke) swept by angled slab segments = smooth curves and slanted edges
          let path;
          if (it.kind === 'tri') path = [[u0 + w * 0.6, a + w / 2], [u1 - w * 0.6, a + w / 2], [cu, b - w * 0.9]];
          else if (it.kind === 'arch') path = prof.arch(u0 + w / 2, a + w / 2, u1 - w / 2, b - w / 2, 14);
          else path = prof.rrect(u0 + w / 2, a + w / 2, u1 - w / 2, b - w / 2, it.r ?? 0.5, 12);
          shapes.push({ t: 'sweep', ...common, f: it.f ?? f0, tint: it.tint ?? ft.tint, path, closed: true, w, depth: it.depth ?? ft.depth ?? 0.9, d0: 0, cant: true, poured: true });
        }
      } else if (ft.t === 'jali') {
        // laser-cut tree of life: recursive branches as slim bars, visual ornament
        const rnd = (() => { let q = (ft.seed || 5) >>> 0; return () => ((q = (q * 1664525 + 1013904223) >>> 0) / 4294967296); })();
        const cu = (ft.u0 + ft.u1) / 2, h0 = vHi - vLo, trunkH = h0 * 0.28;
        const seg = (u, v, ang, len, w, depth) => {
          const u2 = u + Math.sin(ang) * len, v2 = v + Math.cos(ang) * len;
          shapes.push({ t: 'sweep', ...common, tile: undefined, path: [[u, v], [u2, v2]], w, depth: 0.04, d0: 0.0, deco: true, tint: ft.motif || '#e9dcb4' });
          if (depth <= 0) return;
          const k = 2 + (rnd() < 0.5 ? 1 : 0);
          for (let i = 0; i < k; i++) seg(u2, v2, ang + (i / (k - 1) - 0.5) * 1.5 + (rnd() - 0.5) * 0.3, len * (0.66 + rnd() * 0.1), Math.max(0.018, w * 0.68), depth - 1);
        };
        seg(cu, vLo + 0.2, 0, trunkH, 0.07, 4);
      } else if (ft.t === 'louvre') {
        const pitch = ft.pitch ?? 0.14, th = ft.th ?? 0.07;
        for (let v = vLo; v + th <= vHi + 1e-6; v += pitch) shapes.push({ t: 'extrude', ...common, outline: [[ft.u0, v], [ft.u1, v], [ft.u1, v + th], [ft.u0, v + th]], depth: ft.depth ?? 0.06, d0: ft.d0 ?? 0, deco: true, tile: undefined });
      } else if (ft.t === 'volume') {
        // projecting solid mass (cantilevered box / cheek) cladded in stone, wood or paint
        const ww = ft.u1 - ft.u0;
        const vH = ft.h != null ? vLo + ft.h : vHi;
        shapes.push({ t: 'extrude', ...common, outline: [[ft.u0, vLo], [ft.u1, vLo], [ft.u1, vH], [ft.u0, vH]], depth: ft.d ?? 1.2, d0: ft.d0 ?? 0, res: Math.max(0.4, Math.min(ww, vH - vLo) / 3), cant: true });
      }
    } else if (ft.t === 'planter') {
      shapes.push({ t: 'box', cx: ft.x, cz: ft.z, y0: ft.y || 0, w: ft.w || 1.2, d: ft.d || 0.5, h: 0.5, f: 0, tint: '#3f6b36', anchored: true });
    } else if (ft.t === 'tank') {
      let rf = floors.length - 1; while (rf > 0 && floors[rf].headhouse) rf--;
      const yr = base[rf] + H[rf] + SLAB;
      shapes.push({ t: 'box', cx: ft.x, cz: ft.z, y0: yr + 0.5, w: 1.2, d: 1.2, h: 1.0, f: rf, tint: '#23272b' });
      for (const [dx, dz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) shapes.push({ t: 'box', cx: ft.x + dx, cz: ft.z + dz, y0: yr, w: 0.12, d: 0.12, h: 0.5, f: rf, tint: '#6c7075' });
    }
  }

  // ---------- parapet on the roof ----------
  {
    const top = floors.length - 1;
    // the building's own roof: the highest floor that is not a head-house
    let rf = top;
    while (rf > 0 && floors[rf].headhouse) rf--;
    const F = floors[rf]; const segs = F._segs;
    const yr = base[rf] + H[rf] + SLAB;
    const hh = floors[rf + 1] && floors[rf + 1].headhouse ? floors[rf + 1].rooms : [];
    const inHH = (x, z) => hh.some((r) => x > r.x0 - 0.3 && x < r.x1 + 0.3 && z > r.z0 - 0.3 && z < r.z1 + 0.3);
    if (D.parapet !== false) for (const s of segs) if (s.ext) {
      // split the run around the head-house
      let a = s.a0, end = s.a1; const step = 0.5;
      const ranges = []; let cur = null;
      const ext = s.axis === 'x' ? T_EXT : 0;
      for (let t = s.a0 - ext; t < s.a1 + ext - 1e-6; t += step) {
        const tm = Math.min(t + step / 2, s.a1 + ext);
        const [px, pz] = segPoint(s, tm); const [qx, qz] = [px + (s.axis === 'x' ? 0 : s.out * T_EXT), pz + (s.axis === 'x' ? s.out * T_EXT : 0)];
        const bad = inHH(qx, qz);
        if (!bad) { if (!cur) cur = [t, t + step]; else cur[1] = t + step; } else if (cur) { ranges.push(cur); cur = null; }
      }
      if (cur) ranges.push(cur);
      for (const [r0, r1] of ranges) {
        const c = s.c + s.out * (T_EXT - 0.06);
        const rr1 = Math.min(r1, s.a1 + ext);
        if (rr1 - r0 < 0.2) continue;
        if (s.axis === 'x') shapes.push({ t: 'line', x0: r0, z0: c, x1: rr1, z1: c, y0: yr, h: 0.9, thick: 0.12, mat, gaps: [], flip: s.out > 0, f: rf + 1, parapet: true, tint: F.tint });
        else shapes.push({ t: 'line', x0: c, z0: r0, x1: c, z1: rr1, y0: yr, h: 0.9, thick: 0.12, mat, gaps: [], flip: s.out < 0, f: rf + 1, parapet: true, tint: F.tint });
      }
    }
  }

  // ---------- furniture ----------
  const doorPts = new Map();   // room id -> [{x,z}]
  const dp = (R, x, z) => { if (!doorPts.has(R.id)) doorPts.set(R.id, []); doorPts.get(R.id).push({ x, z }); };
  floors.forEach((F) => { for (const s of F._segs) for (const g of s.gaps) { const a = s.a0 + g.a + g.wid / 2 - (s.placed ? (s.a0 - s.placed.a0) : 0); const [x, z] = segPoint(s, s.a0 + (g.a + g.wid / 2)); if (!g.pane || g.bdoor) for (const R of [s.A, s.B]) if (R) dp(R, x, z); } for (const s of F._segs) if (s.open) for (const R of [s.A, s.B]) { const [x, z] = segPoint(s, (s.a0 + s.a1) / 2); dp(R, x, z); } });
  rooms.forEach((rm) => {
    const R = rm._R; delete rm._R;
    const F = floors[R.f];
    const sl = slabRects[R.f - 1] || [];
    furnish(R, doorPts.get(R.id) || [], base[R.f] + 0.02, (x, z) => { const s = sl.find((p) => x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1); return s ? s.tag : null; }, furn, hazards, style, D.seed || 1);
  });

  const lifts = [];
  { const seen = new Set();
    floors.forEach((F, f) => { for (const r of F.rooms) if (r.type === 'lift') {
      const k = r.x0.toFixed(2) + ':' + r.z0.toFixed(2);
      let L = lifts.find((q) => q.key === k);
      if (!L) { L = { key: k, style: (r.lift && r.lift.style) || 'passenger', x0: snap(r.x0), x1: snap(r.x1), z0: snap(r.z0), z1: snap(r.z1), levels: [], floors: [] }; lifts.push(L); }
      L.levels.push(base[f]); L.floors.push(f);
    } }); }
  const height = base[floors.length];
  const plan = floors.map((F) => (F._segs || []).map((s) => ({ axis: s.axis, c: s.c, a0: s.a0, a1: s.a1, ext: s.ext, open: !!s.open, gaps: s.gaps.map((g) => ({ a: g.a, wid: g.wid, door: !!g.door, pane: !!g.pane, garage: !!g.garage })) })));
  return { shapes, furn, rooms, hazards, stairs: stairsOut, lifts, issues, base, bounds, height, style, plan };
}

// ---------- openings ----------
function gapFor(kind, w, sill, h, style, s, a) {
  const st = style === 'arch' ? 'arch' : 'rect';
  if (kind === 'door') return { wid: w, sill: 0, h: st === 'arch' ? 2.4 : 2.1, kind: st, a, door: true };
  if (kind === 'open') return { wid: w, sill: 0, h: 2.2, kind: 'rect', a };
  if (kind === 'arch') return { wid: w, sill: 0, h: 2.4, kind: 'arch', a };
  if (kind === 'garage') return { wid: w, sill: 0, h: 2.3, kind: 'rect', a, door: true, garage: true };
  const sl = sill ?? 0.9;
  return { wid: w, sill: sl, h: h ? sl + h : Math.min(sl + 1.2, 2.2), kind: st === 'arch' && sl > 0 ? 'arch' : 'rect', a, pane: true };
}

// ---------- stairs ----------
export function stairGeom(W, h) {
  const Ht = h + SLAB, Lw = W.z1 - W.z0, half = (W.x1 - W.x0 - 0.12) / 2;
  let n = Math.ceil(Ht / 2 / 0.185), rise = Ht / 2 / n;
  const avail = Lw - 0.95;
  const tread = Math.min(0.3, avail / n);
  return { Ht, n, rise, tread, half, flight: tread * n };
}
function stairHoles(W, h) {
  const g = stairGeom(W, h);
  const seam = W.x0 + g.half + 0.06;
  const k = Math.max(0, Math.floor((h - 2.0) / g.rise));
  return [{ x0: seam, x1: W.x1, z0: W.z0, z1: W.z1 }, { x0: W.x0, x1: seam, z0: W.z0, z1: W.z1 - k * g.tread }];
}

// ---------- furniture ----------
function rng32(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const COL = {
  wood: ['#8a6a48', '#6f5238', '#a9825a', '#5d4631'], fabric: ['#5d6b7a', '#7b6a5a', '#4f6a58', '#8a5a52', '#6a6f78'], metal: ['#9aa0a6'], white: ['#efede8'],
};
function furnish(R, doors, y0, slabAt, furn, hazards, style, seed) {
  const rnd = rng32(seed * 7 + Math.round(R.x0 * 13 + R.z0 * 29 + R.f * 101));
  const pick = (a) => a[(rnd() * a.length) | 0];
  const wood = style.wood && rnd() < 0.5 ? style.wood : pick(COL.wood), fab = pick(COL.fabric);
  const rw0 = R.x1 - R.x0, rd0 = R.z1 - R.z0;
  if (R.type === 'corridor' || R.type === 'stairs') return;
  // back wall = the side furthest from every door (ties: the longer wall)
  const sides = [
    { s: 'N', len: rw0, d: (x, z) => Math.abs(z - R.z0) },       // back wall at z0, room extends +z
    { s: 'S', len: rw0, d: (x, z) => Math.abs(z - R.z1) },
    { s: 'W', len: rd0, d: (x, z) => Math.abs(x - R.x0) },
    { s: 'E', len: rd0, d: (x, z) => Math.abs(x - R.x1) },
  ];
  for (const sd of sides) sd.score = (doors.length ? Math.min(...doors.map((p) => sd.d(p.x, p.z))) : 3) + sd.len * 0.15;
  const back = sides.sort((a, b) => b.score - a.score)[0].s;
  // local frame: u along the back wall (centred), v from the back wall into the room
  let rw, rd, toW, boxW;
  if (back === 'N') { rw = rw0; rd = rd0; toW = (u, v) => [(R.x0 + R.x1) / 2 + u, R.z0 + v]; boxW = (hu, hv) => [hu, hv]; }
  else if (back === 'S') { rw = rw0; rd = rd0; toW = (u, v) => [(R.x0 + R.x1) / 2 - u, R.z1 - v]; boxW = (hu, hv) => [hu, hv]; }
  else if (back === 'W') { rw = rd0; rd = rw0; toW = (u, v) => [R.x0 + v, (R.z0 + R.z1) / 2 - u]; boxW = (hu, hv) => [hv, hu]; }
  else { rw = rd0; rd = rw0; toW = (u, v) => [R.x1 - v, (R.z0 + R.z1) / 2 + u]; boxW = (hu, hv) => [hv, hu]; }
  const placed = [];
  const free = (cx, cz, hx, hz, clear = 0.7) => {
    if (cx - hx < R.x0 + 0.05 || cx + hx > R.x1 - 0.05 || cz - hz < R.z0 + 0.05 || cz + hz > R.z1 - 0.05) return false;
    for (const d of doors) { const dx = Math.max(Math.abs(d.x - cx) - hx, 0), dz = Math.max(Math.abs(d.z - cz) - hz, 0); if (Math.hypot(dx, dz) < clear) return false; }
    return true;
  };
  const clash = (cx, cz, hx, hz) => placed.some((p) => Math.abs(p.cx - cx) < p.hx + hx - 0.02 && Math.abs(p.cz - cz) < p.hz + hz - 0.02);
  // put(u,v,hu,hv,hy, tile,color, opts): box standing on the floor. opts.y = centre height, opts.soft = no collision, opts.must = skip clearance checks
  const put = (u, v, hu, hv, hy, tile, color, o = {}) => {
    const [cx, cz] = toW(u, v), [hx, hz] = boxW(hu, hv);
    const solidItem = !o.soft;
    if (!o.noCheck) { if (!free(cx, cz, hx, hz, o.clear ?? 0.65)) return false; if (solidItem && clash(cx, cz, hx, hz)) return false; }
    if (solidItem) placed.push({ cx, cz, hx, hz });
    const it = { x: cx, y: y0 + (o.y ?? hy), z: cz, hx, hy, hz, tile, color, f: R.f, slab: R.f > 0 ? slabAt(cx, cz) : -1, solid: solidItem && !o.top && hy > 0.12 };
    if (o.act) { it.act = o.act; if (hy > 0.1) it.solid = true; }
    furn.push(it);
    return true;
  };
  const ok = (v) => v; const rep = (...a) => a;
  switch (R.type) {
    case 'bedroom': {
      const bw = rw >= 3.6 ? 0.9 : 0.78;
      put(0, 1.05, bw, 1.0, 0.2, 'wood', wood, { act: 'bed' });
      put(0, 1.1, bw - 0.04, 0.95, 0.13, 'fabric', pick(['#e9e4da', '#d8d2c6', '#c9d0d6']), { y: 0.46, top: true, soft: true, noCheck: true });
      put(0, 0.1, bw, 0.05, 0.5, 'wood', wood, { y: 0.55, noCheck: true, soft: true });
      put(-0.35, 0.35, 0.26, 0.16, 0.08, 'fabric', '#f3f1ec', { y: 0.65, soft: true, noCheck: true }); put(0.35, 0.35, 0.26, 0.16, 0.08, 'fabric', '#f3f1ec', { y: 0.65, soft: true, noCheck: true });
      if (rw >= 3.4) { put(-(bw + 0.3), 0.3, 0.22, 0.22, 0.27, 'wood', wood); put(bw + 0.3, 0.3, 0.22, 0.22, 0.27, 'wood', wood); }
      // wardrobe: along a side wall, else along the front wall
      const wl = Math.min(0.85, rd * 0.22);
      const slots = [[-(rw / 2 - 0.32), rd - 0.2 - 0.85, 0.3, 0.85], [(rw / 2 - 0.32), rd - 0.2 - 0.85, 0.3, 0.85], [-(rw / 2 - 0.32), rd * 0.5 + 0.9, 0.3, 0.85], [(rw / 2 - 0.32), rd * 0.5 + 0.9, 0.3, 0.85], [-0.9, rd - 0.35, 0.9, 0.3], [0.9, rd - 0.35, 0.9, 0.3]];
      for (const [u, v, hu, hv] of slots) if (put(u, v, hu, hv, 1.0, 'wood', wood)) break;
      break;
    }
    case 'living': case 'lounge': {
      const tvW = Math.min(1.0, rw * 0.28);
      put(0, 0.32, tvW + 0.2, 0.22, 0.3, 'wood', wood);                                  // tv unit
      put(0, 0.12, tvW * 0.7, 0.03, 0.3, 'metal', '#15171a', { y: 0.95, soft: true, noCheck: true });   // tv
      const sv = Math.min(rd - 0.55, Math.max(2.4, rd * 0.62));
      const sw = Math.min(1.05, rw * 0.3);
      put(0, sv, sw, 0.45, 0.24, 'fabric', fab); put(0, sv + 0.36, sw, 0.1, 0.3, 'fabric', fab, { y: 0.62, soft: true, noCheck: true });
      put(-sw - 0.1, sv, 0.1, 0.45, 0.18, 'fabric', fab, { y: 0.4, soft: true, noCheck: true }); put(sw + 0.1, sv, 0.1, 0.45, 0.18, 'fabric', fab, { y: 0.4, soft: true, noCheck: true });
      put(0, sv - 1.0, 0.55, 0.32, 0.2, 'wood', wood);                                    // coffee table
      put(-(rw / 2 - 0.3), rd - 0.3, 0.22, 0.22, 0.4, 'fabric', '#4f6a48', { soft: true });   // plant
      break;
    }
    case 'dining': {
      const tw = Math.min(0.8, rw / 2 - 0.5), tl = Math.min(1.3, rd / 2 - 0.4);
      const cu = 0, cv = rd / 2;
      put(cu, cv, tw, tl, 0.37, 'wood', wood, { act: 'eat', clear: 0.5 });
      put(cu, cv, tw + 0.02, tl + 0.02, 0.03, 'wood', wood, { y: 0.74, top: true, soft: true, noCheck: true });
      for (const sgn of [-1, 1]) for (const dv of [-0.55, 0.55]) put(cu + sgn * (tw + 0.28), cv + dv, 0.2, 0.2, 0.22, 'fabric', fab, { soft: true });
      put(0, 0.3, Math.min(1.0, rw * 0.3), 0.22, 0.4, 'wood', wood);
      break;
    }
    case 'kitchen': {
      const len = Math.min(rw - 0.3, 3.4);
      put(0, 0.32, len / 2, 0.32, 0.45, 'wood', '#d4cdbf');                              // base units
      put(0, 0.32, len / 2, 0.34, 0.025, 'white', '#3b3d41', { y: 0.915, top: true, soft: true, noCheck: true });   // worktop
      put(len / 2 - 0.5, 0.32, 0.3, 0.22, 0.015, 'metal', '#222426', { y: 0.95, act: 'stove', soft: true, noCheck: true });   // hob
      put(-len / 2 + 0.55, 0.32, 0.3, 0.2, 0.05, 'metal', '#b8bec4', { y: 0.93, act: 'sink', soft: true, noCheck: true });   // sink
      put(-len / 2 + 0.55, 0.12, 0.03, 0.03, 0.14, 'metal', '#b8bec4', { y: 1.05, soft: true, noCheck: true });
      put(0, 0.17, len / 2, 0.17, 0.3, 'wood', '#cfc8b9', { y: 1.65, soft: true, noCheck: true });   // wall cabinets
      // fridge on the side wall near the back corner
      const fu = (rw / 2 - 0.35);
      if (rw - len > 0.5) put(fu, 0.4, 0.32, 0.32, 0.9, 'metal', '#c9ccd0', { act: 'fridge' }); else put(-len / 2 - 0.0, 1.1, 0.3, 0.3, 0.9, 'metal', '#c9ccd0', { act: 'fridge' });
      const gv = 0.55; const [gx, gz] = toW(len / 2 - 0.9, 0.35);
      furn.push({ x: gx, y: y0 + 0.3, z: gz, hx: 0.16, hy: 0.3, hz: 0.16, tile: 'metal', color: '#c1272d', f: R.f, slab: R.f > 0 ? slabAt(gx, gz) : -1 }); hazards.push({ x: gx, y: y0 + 0.4, z: gz });
      if (rd > 2.8 && rw > 2.8) put(0, rd - 0.9, 0.5, 0.4, 0.37, 'wood', wood, { act: 'eat' });
      break;
    }
    case 'bath': case 'toilet': {
      put(0, 0.35, 0.2, 0.3, 0.2, 'white', '#f1f1ee'); put(0, 0.12, 0.2, 0.1, 0.3, 'white', '#f1f1ee', { y: 0.55, soft: true, noCheck: true });
      put(-(rw / 2 - 0.3), rd * 0.55, 0.22, 0.28, 0.05, 'white', '#f1f1ee', { y: 0.85, soft: true });
      put(-(rw / 2 - 0.3), rd * 0.55, 0.14, 0.18, 0.4, 'white', '#e8e8e4', { y: 0.4, soft: true, noCheck: true });
      if (R.type === 'bath' && rw > 1.9 && rd > 1.9) put(rw / 2 - 0.45, rd - 0.45, 0.45, 0.45, 0.04, 'white', '#d9dde0', { soft: true, noCheck: true });
      break;
    }
    case 'hall': {
      put(0, 0.2, Math.min(0.5, rw / 3), 0.16, 0.28, 'wood', wood);
      put(-(rw / 2 - 0.3), rd - 0.35, 0.18, 0.18, 0.5, 'fabric', '#4f6a48', { soft: true });
      break;
    }
    case 'study': case 'office': {
      const n = Math.max(1, Math.floor(rw / 2.4));
      for (let i = 0; i < n; i++) { const u = (i - (n - 1) / 2) * 2.2; put(u, 0.45, 0.7, 0.35, 0.37, 'wood', wood); put(u, 0.7, 0.2, 0.18, 0.2, 'fabric', '#25282d', { soft: true }); put(u, 0.35, 0.28, 0.02, 0.18, 'metal', '#15171a', { y: 1.0, soft: true, noCheck: true }); }
      put(rw / 2 - 0.25, rd * 0.5, 0.2, 0.7, 1.0, 'wood', wood);
      break;
    }
    case 'shop': {
      const tint = ['#c8412f', '#4f8a3a', '#b8884a', '#d9a636', '#7b3a6a', '#e0702c'];
      put(0, 0.3, Math.min(rw / 2 - 0.4, 3.4), 0.3, 0.55, 'wood', '#7a5a3a', { act: 'market', clear: 0.3 });          // counter with produce
      const n = Math.max(2, Math.floor(rw / 1.25));
      for (let i = 0; i < n; i++) { const u = (i - (n - 1) / 2) * 1.2; if (Math.abs(u) > rw / 2 - 0.5) continue; put(u, 0.3, 0.22, 0.22, 0.09, 'fabric', tint[i % tint.length], { y: 1.18, soft: true, noCheck: true }); }
      for (let i = 0; i < 2; i++) put(((i ? 1 : -1)) * Math.min(rw / 2 - 0.9, 2.0), rd * 0.55, 0.9, 0.35, 0.55, 'wood', '#8a6a45', { act: 'market', clear: 0.3 });
      put(-(rw / 2 - 0.3), rd - 0.5, 0.25, 0.7, 0.9, 'metal', '#a9aeb3');
      break;
    }
    case 'store': {
      for (let i = 0; i < 3; i++) put(-0.8 + i * 0.8, 0.35, 0.3, 0.3, 0.3 + (i % 2) * 0.25, 'wood', i % 2 ? '#8a6a45' : '#a08058');
      break;
    }
    case 'garage': {
      put(rw / 2 - 0.3, 0.3, 0.25, 0.5, 0.9, 'metal', '#8a8f95', { clear: 0.3 });
      break;
    }
    default: break;
  }
}
