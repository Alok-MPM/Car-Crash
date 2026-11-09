// ENGINE CATALOG - the one place where looks are decided for EVERY building in the game.
// Change a window type, a colour combination or glass tint here and every existing and future building follows (nothing is set per building).
// Window frame sizes are in metres. 'cols' = vertical panes by width, 'bar' = glazing bar (mullion) width, 'rows' = transom height fraction.

export const WINDOW_TYPES = {
  // big modern grid: heavy dark frame, mullion columns, one transom (reference: black-framed grid window)
  grid:    { frame: 0.075, bar: 0.07, maxPane: 1.05, transom: 0.74, liner: 1.0, sill: 'slab' },
  // sliding window: 3 panes, thick centre meeting stiles (reference: sliding window on white render)
  slider:  { frame: 0.09,  bar: 0.10, cols: 3,      transom: 0,    liner: 1.0, sill: 'slab' },
  // single big picture pane, hairline frame
  picture: { frame: 0.05,  bar: 0.0,  cols: 1,      transom: 0,    liner: 1.0, sill: 'thin' },
  // tall pane with a transom, slim frame (wood-clad house reference)
  tall:    { frame: 0.055, bar: 0.05, cols: 1,      transom: 0.55, liner: 1.0, sill: 'thin' },
  // traditional: slim bars, chajja friendly
  classic: { frame: 0.06,  bar: 0.04, maxPane: 0.7, transom: 0.72, liner: 0.6, sill: 'stone' },
};

// colour combinations, tried per building family. Each: outer wall, trim/frame, accent, wood, slab, glass tint, sill.
export const PALETTES = {
  modern: [
    { out: '#eceae5', trim: '#2c2e32', accent: '#d9d5cc', wood: '#a8774a', slab: '#f2f0ea', glass: [0.30, 0.40, 0.44], sill: '#f4f3ef', name: 'white-charcoal' },
    { out: '#d9d6cf', trim: '#34383c', accent: '#8a8f94', wood: '#8f6a45', slab: '#e7e4dd', glass: [0.30, 0.38, 0.42], sill: '#e9e7e2', name: 'greige' },
    { out: '#f0ebe0', trim: '#4a3a2d', accent: '#b9a58a', wood: '#7a5233', slab: '#f3eee4', glass: [0.34, 0.40, 0.38], sill: '#f3eee4', name: 'cream-bronze' },
    { out: '#cfd3d4', trim: '#1f2326', accent: '#9aa3a8', wood: '#a8774a', slab: '#dfe2e3', glass: [0.26, 0.36, 0.42], sill: '#e8eaea', name: 'cool-grey' },
  ],
  dark: [
    { out: '#6a6d72', trim: '#17191b', accent: '#2c2e32', wood: '#8b6746', slab: '#2f3135', glass: [0.22, 0.30, 0.34], sill: '#3a3c40', name: 'graphite' },
    { out: '#4c4f54', trim: '#111315', accent: '#8a8d91', wood: '#7a5233', slab: '#232528', glass: [0.20, 0.28, 0.32], sill: '#2a2c2f', name: 'charcoal-slate' },
    { out: '#5b524a', trim: '#1b1612', accent: '#a38b72', wood: '#8b6746', slab: '#3a332d', glass: [0.26, 0.30, 0.30], sill: '#4a423a', name: 'umber' },
  ],
  classic: [
    { out: '#e6d7b4', trim: '#a4492f', accent: '#b5603f', wood: '#7a5233', slab: '#efe7d3', glass: [0.32, 0.40, 0.42], sill: '#efe5cc', name: 'ochre' },
    { out: '#efe2cc', trim: '#6e3b28', accent: '#c2764c', wood: '#6d4a2e', slab: '#efe7d3', glass: [0.32, 0.38, 0.40], sill: '#f5ecd8', name: 'sand-terracotta' },
    { out: '#e9d9b8', trim: '#2f5d50', accent: '#c9a45c', wood: '#7a5233', slab: '#eee6d0', glass: [0.30, 0.40, 0.42], sill: '#f0e8d2', name: 'sand-green' },
  ],
  brick: [
    { out: '#b3593a', trim: '#e8dfcf', accent: '#d9cdb8', wood: '#6d4a2e', slab: '#d8cdb9', glass: [0.30, 0.38, 0.40], sill: '#e8dfcf', name: 'red-brick' },
    { out: '#a2593f', trim: '#2a2623', accent: '#d9c9b0', wood: '#5d4028', slab: '#cfc2ad', glass: [0.28, 0.36, 0.38], sill: '#d9ccb8', name: 'brick-black' },
  ],
  glass: [
    { out: '#c7ccd1', trim: '#2a2d31', accent: '#3a4249', wood: '#8f9499', slab: '#d8dbde', glass: [0.24, 0.38, 0.46], sill: '#d8dbde', name: 'blue-glass' },
    { out: '#b9c2c0', trim: '#232b2a', accent: '#35423f', wood: '#8f9499', slab: '#d0d6d4', glass: [0.22, 0.38, 0.36], sill: '#d0d6d4', name: 'green-glass' },
    { out: '#c9c4bd', trim: '#2c2926', accent: '#4a4038', wood: '#8f9499', slab: '#d8d3cc', glass: [0.34, 0.36, 0.34], sill: '#d8d3cc', name: 'bronze-glass' },
  ],
};

const h32 = (n) => (((Math.imul((n | 0) + 1, 2654435761) >>> 0) ^ 0x9e3779b9) >>> 0) / 4294967296;

// returns a copy of a style with one of the family's palettes mixed in (chosen by seed so neighbours differ)
export function applyPalette(style, family, seed) {
  const list = PALETTES[family];
  if (!list) return { ...style, glass: [0.3, 0.4, 0.44], sillC: '#d8d4ca' };
  const p = list[Math.floor(h32(seed || 1) * list.length) % list.length];
  return { ...style, out: p.out, trim: p.trim, accent: p.accent, wood: p.wood, slab: p.slab, glass: p.glass, sillC: p.sill, palette: p.name };
}

// which window type a room's window gets (width in m, building style)
export function windowType(style, roomType, wid, h, seed) {
  if (style === 'classic' || style === 'brick') return 'classic';
  if (roomType === 'bath' || roomType === 'toilet' || roomType === 'store') return 'picture';
  if (wid >= 2.4) return h38(seed, wid) < 0.5 ? 'slider' : 'grid';
  if (wid >= 1.6 && h >= 1.9) return h38(seed, wid) < 0.4 ? 'slider' : 'grid';
  if (h >= 2.0 && wid <= 1.3) return 'tall';
  return wid > 1.1 ? 'grid' : 'picture';
}
function h38(seed, w) { return h32((seed || 1) * 31 + Math.round(w * 10)); }

// DOORS - every door in the game is one of these archetypes; the engine picks one from the building style + seed (never the same flat brown slab twice in a row).
// Dimensions are fractions of the leaf (w = width, h = height) so any door size works.
export const DOOR_TYPES = {
  pivotWood:  { leaf: 'wood',   grooves: 5, handle: 'slot',  slotColor: [0.03, 0.03, 0.035] },                            // tall wood slab, long black slot handle, fine grooves (modern wood house)
  glassLite:  { leaf: 'paint',  lite: { w: 0.56, y0: -0.06, y1: 0.86 }, handle: 'bar' },                                // painted frame, tall glass light, metal bar
  panelled:   { leaf: 'wood',   panels: [2, 3], handle: 'knob' },                                                       // raised panels, brass knob (classic / brick houses)
  fluted:     { leaf: 'fluted', handle: 'slot', slotColor: [0.78, 0.6, 0.36] },                                          // dark fluted timber, brass slot (dark / modern)
  shopfront:  { leaf: 'frame',  lite: { w: 0.8, y0: -0.9, y1: 0.9 }, handle: 'push' },                                  // aluminium frame, full glass, push bar (shops, towers)
  roller:     { leaf: 'roller',  slats: 11 },                                                                            // garage roller shutter
};
const DOOR_FOR = {
  modern:  ['pivotWood', 'glassLite', 'fluted', 'pivotWood'],
  dark:    ['fluted', 'pivotWood', 'glassLite'],
  classic: ['panelled', 'panelled', 'glassLite'],
  brick:   ['panelled', 'fluted', 'panelled'],
  glass:   ['shopfront'],
};
export function doorType(style, seed, flags = {}) {
  if (flags.garage) return 'roller';
  if (flags.shop) return 'shopfront';
  const list = DOOR_FOR[style] || DOOR_FOR.modern;
  return list[Math.floor(h32((seed || 1) * 13 + 5) * list.length) % list.length];
}
