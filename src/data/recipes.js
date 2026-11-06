// Building recipes: only a few numbers. The Building Engineer decides everything else (structure, sizes, layout, colours).
export const RECIPES = {
  // Architect briefs: kind, size, floors and style. The Architect (engines/buildings/architect.js) designs rooms, stairs, doors, windows, furniture and facade.
  house: { brief: { kind: 'house', w: 11.5, d: 9.5, floors: 2, garage: true, style: 'modern' } },
  houseSmall: { brief: { kind: 'house', w: 8, d: 8.5, floors: 2, style: 'classic' } },
  villa: { brief: { kind: 'house', w: 12, d: 10, floors: 3, style: 'dark', garage: true } },
  shop: { brief: { kind: 'house', w: 12, d: 9, floors: 2, shopGround: true, style: 'brick' } },
  market: { brief: { kind: 'market', w: 12, d: 8 } },
  tower: { brief: { kind: 'tower', w: 16, d: 13, floors: 8, style: 'glass' } },
};

// Free-form recipes: lists of shape primitives (see engines/buildings/shapes.js). No code needed to add a new building.
RECIPES.roundTower = {
  shapes: [
    { t: 'arc', cx: 0, cz: 0, r: 4, y0: 0, h: 8.7, thick: 0.23, mat: 'clay', gaps: [{ a: 0.4, wid: 1.2, h: 2.1 }] },
    { t: 'dome', cx: 0, cz: 0, y0: 8.7, r: 4.1, thick: 0.18, rings: 5, seg: 22 },
  ],
};
RECIPES.mandir = {
  indestructible: true, paint: '#efe2c4',
  shapes: [
    { t: 'box', cx: 0, cz: 0, y0: 0, w: 16, d: 16, h: 0.6 },
    { t: 'box', cx: 0, cz: 0, y0: 0.6, w: 13.5, d: 13.5, h: 0.6 },
    // sanctum
    { t: 'line', x0: -3, z0: -5, x1: 3, z1: -5, y0: 1.2, h: 4.5, thick: 0.45, mat: 'rcc' },
    { t: 'line', x0: 3, z0: -5, x1: 3, z1: 1, y0: 1.2, h: 4.5, thick: 0.45, mat: 'rcc' },
    { t: 'line', x0: 3, z0: 1, x1: -3, z1: 1, y0: 1.2, h: 4.5, thick: 0.45, mat: 'rcc', gaps: [{ a: 2.2, wid: 1.6, h: 2.6 }] },
    { t: 'line', x0: -3, z0: 1, x1: -3, z1: -5, y0: 1.2, h: 4.5, thick: 0.45, mat: 'rcc' },
    // shikhara (spire) and kalash
    { t: 'tower', cx: 0, cz: -2, y0: 5.7, h: 6.6, r0: 3.0, r1: 0.45, thick: 0.3, rings: 8, seg: 20, curve: 0.75 },
    { t: 'tower', cx: 0, cz: -2, y0: 12.3, h: 1.1, r0: 0.4, r1: 0.05, thick: 0.1, rings: 2, seg: 8 },
    // mandap: columns, flat roof, small dome
    { t: 'col', cx: -4, cz: 3, y0: 1.2, h: 3.6, s: 0.5 }, { t: 'col', cx: 4, cz: 3, y0: 1.2, h: 3.6, s: 0.5 },
    { t: 'col', cx: -4, cz: 5.8, y0: 1.2, h: 3.6, s: 0.5 }, { t: 'col', cx: 4, cz: 5.8, y0: 1.2, h: 3.6, s: 0.5 },
    { t: 'box', cx: 0, cz: 4.4, y0: 4.8, w: 9.6, d: 3.6, h: 0.35 },
    { t: 'dome', cx: 0, cz: 4.4, y0: 5.15, r: 1.7, thick: 0.15, rings: 3, seg: 14 },
  ],
};
// showcase of cut openings: round-headed windows, a gothic door, a round window, glazed rect windows, a curved apse
RECIPES.arcadeHall = {
  paint: '#e8dcc0',
  shapes: [
    { t: 'line', x0: -6, z0: 5, x1: 6, z1: 5, y0: 0, h: 4.2, thick: 0.35, mat: 'clay', flip: true,
      gaps: [{ a: 1.2, wid: 1.2, h: 2.8, sill: 0.9, kind: 'arch', pane: true }, { a: 4.2, wid: 1.6, h: 3.1, kind: 'pointed', door: true }, { a: 7.8, wid: 1.2, h: 2.8, sill: 0.9, kind: 'arch', pane: true }, { a: 10, wid: 1.0, h: 3.4, sill: 2.4, kind: 'round', pane: true }] },
    { t: 'line', x0: 6, z0: 5, x1: 6, z1: -5, y0: 0, h: 4.2, thick: 0.35, mat: 'clay', flip: true, gaps: [{ a: 3, wid: 1.4, h: 2.2, sill: 0.9, pane: true }, { a: 6, wid: 1.4, h: 2.2, sill: 0.9, pane: true }] },
    { t: 'line', x0: 6, z0: -5, x1: -6, z1: -5, y0: 0, h: 4.2, thick: 0.35, mat: 'clay', flip: true },
    { t: 'line', x0: -6, z0: -5, x1: -6, z1: 5, y0: 0, h: 4.2, thick: 0.35, mat: 'clay', flip: true, gaps: [{ a: 2, wid: 1.4, h: 2.2, sill: 0.9, pane: true }, { a: 6.5, wid: 1.4, h: 2.2, sill: 0.9, pane: true }] },
    { t: 'box', cx: 0, cz: 0, y0: 4.2, w: 12.8, d: 10.8, h: 0.25 },
  ],
};
RECIPES.apse = {
  shapes: [
    { t: 'arc', cx: 0, cz: 0, r: 5, a0: 0, a1: Math.PI * 2, y0: 0, h: 4.4, thick: 0.3, mat: 'clay', gaps: [{ a: 1.0, wid: 1.4, h: 3.0, kind: 'arch', door: true }, { a: 6.3, wid: 1.0, h: 3.0, sill: 1.0, kind: 'arch', pane: true }, { a: 10, wid: 1.0, h: 3.0, sill: 1.0, kind: 'arch', pane: true }, { a: 14, wid: 1.0, h: 3.0, sill: 1.0, kind: 'arch', pane: true }] },
    { t: 'dome', cx: 0, cz: 0, y0: 4.4, r: 5.1, thick: 0.2, rings: 6, seg: 26 },
  ],
};
