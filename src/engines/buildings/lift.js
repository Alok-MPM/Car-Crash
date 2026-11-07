// Lift (elevator) designs. The engine picks one by building style / seed; each is a complete look: cabin size, wall / floor / door finish, door type.
// Dimensions follow real passenger-lift practice (home lift ~4 persons, passenger 6-8 persons, luxury / hospital 10-13, service / freight).
// Cabin local frame: origin = middle of the cabin floor, +z = towards the landing door, x across, y up.
import { T, GeoBuf } from './render.js';

const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

export const LIFT_STYLES = {
  home:      { name: 'Home lift',        w: 1.05, d: 1.25, h: 2.1, dw: 0.8,  door: 'side',   wall: [T.wood, '#c9a27a'],   floor: [T.floor, '#d8d2c6'],  leaf: [T.metal, '#d6d9dc'],  trim: '#9aa0a6', light: [1.0, 0.92, 0.78] },
  passenger: { name: 'Passenger lift',   w: 1.4,  d: 1.7,  h: 2.3, dw: 0.9,  door: 'centre', wall: [T.metal, '#cfd3d6'],  floor: [T.floor, '#bdb8ae'],  leaf: [T.metal, '#e1e4e6'],  trim: '#7d8388', light: [1.0, 0.98, 0.94] },
  luxury:    { name: 'Luxury lift',      w: 1.5,  d: 1.8,  h: 2.4, dw: 1.0,  door: 'centre', wall: [T.fluted, '#8d7b66'], floor: [T.marble, '#ffffff'], leaf: [T.metal, '#5a4f45'],  trim: '#c3a074', light: [1.0, 0.82, 0.6] },
  brass:     { name: 'Rose-gold lift',   w: 1.4,  d: 1.7,  h: 2.3, dw: 0.95, door: 'centre', wall: [T.metal, '#b9a79b'],  floor: [T.floor, '#9d9a94'],  leaf: [T.brass, '#ffffff'],  trim: '#b98d74', light: [1.0, 0.9, 0.8] },
  glass:     { name: 'Panoramic lift',   w: 1.5,  d: 1.7,  h: 2.3, dw: 0.95, door: 'centre', wall: [T.glass, '#cfe4f0'],  floor: [T.floor, '#8f949a'],  leaf: [T.glass, '#cfe4f0'],  trim: '#2b2f33', light: [0.95, 0.98, 1.0] },
  service:   { name: 'Service lift',     w: 1.8,  d: 2.4,  h: 2.4, dw: 1.4,  door: 'centre', wall: [T.metal, '#9ea3a8'],  floor: [T.rcc, '#8d8d89'],    leaf: [T.metal, '#868b90'],  trim: '#5c6166', light: [0.95, 0.97, 1.0] },
};

// shaft (inside clear) = cabin + running clearances
export function shaftOf(st) { const L = LIFT_STYLES[st]; return { w: Math.round((L.w + 0.55) * 20) / 20, d: Math.round((L.d + 0.5) * 20) / 20 }; }

// which lift a building gets: by kind and style, varied by seed so neighbours differ
export function pickLift(kind, style, seed = 1, floors = 4) {
  const r = (((seed * 2654435761) >>> 0) % 1000) / 1000;
  if (kind === 'factory' || kind === 'warehouse') return 'service';
  if (kind === 'tower') return style === 'glass' ? (r < 0.5 ? 'glass' : 'passenger') : (r < 0.35 ? 'luxury' : r < 0.65 ? 'brass' : 'passenger');
  if (style === 'dark' || style === 'modern') return floors <= 5 ? (r < 0.5 ? 'home' : r < 0.8 ? 'luxury' : 'brass') : (r < 0.5 ? 'passenger' : 'luxury');
  return r < 0.6 ? 'home' : 'passenger';
}

// ---- meshes (built once per lift style and shared) ----
// cabin shell (walls, floor, ceiling with light panel, front jambs). Leaves are separate meshes because they slide.
export function buildCabinMesh(r, mat, st) {
  const L = LIFT_STYLES[st], g = new GeoBuf(), W = L.w / 2, D = L.d / 2, h = L.h, t = 0.04;
  const wall = [L.wall[0], ...rgb(L.wall[1])], fl = [L.floor[0], ...rgb(L.floor[1])], tr = rgb(L.trim);
  const face = (spec, only) => (fi) => (only === undefined || only === fi ? spec : null);
  const on = [0, 0, 0];
  g.box(0, -0.03, 0, W, 0.03, D, (fi) => (fi === 2 ? fl : [T.metal, 0.3, 0.3, 0.32]), on, 1, false);                    // floor
  g.box(0, h + 0.03, 0, W, 0.03, D, (fi) => (fi === 3 ? [T.white, 0.95, 0.93, 0.88] : [T.metal, 0.4, 0.4, 0.42]), on, 1, false);   // ceiling
  g.box(0, h - 0.01, 0, W * 0.7, 0.012, D * 0.55, (fi) => (fi === 3 ? [T.white, ...L.light] : null), on, 1.6, false);                // light panel
  g.box(0, h / 2, -D + t / 2, W, h / 2, t / 2, (fi) => (fi === 4 ? wall : [T.metal, 0.3, 0.3, 0.32]), on, 1, false);              // back wall
  g.box(-W + t / 2, h / 2, 0, t / 2, h / 2, D, (fi) => (fi === 0 ? wall : [T.metal, 0.3, 0.3, 0.32]), on, 1, false);              // left wall
  g.box(W - t / 2, h / 2, 0, t / 2, h / 2, D, (fi) => (fi === 1 ? wall : [T.metal, 0.3, 0.3, 0.32]), on, 1, false);               // right wall
  // handrail along the back and sides, car operating panel on the right of the door, floor indicator over it
  g.box(0, 0.9, -D + 0.07, W * 0.8, 0.02, 0.02, () => [T.metal, ...tr], on, 1, false);
  g.box(-W + 0.07, 0.9, 0, 0.02, 0.02, D * 0.7, () => [T.metal, ...tr], on, 1, false);
  g.box(W - 0.07, 0.9, 0, 0.02, 0.02, D * 0.7, () => [T.metal, ...tr], on, 1, false);
  const jw = (L.w - L.dw) / 2;
  g.box(-(W - jw / 2), h / 2, D - 0.03, jw / 2, h / 2, 0.03, () => [T.metal, ...tr], on, 1, false);                                  // front jambs
  g.box((W - jw / 2), h / 2, D - 0.03, jw / 2, h / 2, 0.03, () => [T.metal, ...tr], on, 1, false);
  g.box(0, h - 0.1, D - 0.03, L.dw / 2, 0.1, 0.03, () => [T.metal, ...tr], on, 1, false);                                          // header
  g.box(W - jw / 2, 1.2, D - 0.07, 0.05, 0.2, 0.012, () => [T.metal, 0.12, 0.12, 0.13], on, 1, false);                             // panel
  return r.createMesh(g.finish(), { mat, radius: Math.hypot(L.w, L.d, L.h) });
}
// one door leaf (width = leafW); centre-opening lifts use two, side-opening ones use a telescoping pair
export function buildLeafMesh(r, mat, st) {
  const L = LIFT_STYLES[st], g = new GeoBuf(), lw = L.door === 'centre' ? L.dw / 2 : L.dw / 2, hh = Math.min(L.h, 2.1) / 2;
  const c = [L.leaf[0], ...rgb(L.leaf[1])];
  g.box(0, hh, 0, lw / 2 - 0.004, hh, 0.02, (fi) => (fi === 4 || fi === 5 ? c : [T.metal, 0.35, 0.35, 0.37]), [0, 0, 0], 1, false);
  return r.createMesh(g.finish(), { mat, radius: 2 });
}
