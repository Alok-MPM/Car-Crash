// Real-world material data. The Building Engineer derives mass, strength and layer thickness from these numbers only.
// Units: metres, kg, MPa. `eK` converts compressive strength into impact energy (J per m3) a panel absorbs before it fails.

export const UNITS = {
  clayBrick: { name: 'Red clay brick', L: 0.23, W: 0.11, H: 0.075, dens: 1800, fc: 3.0, cost: 8, tile: 'clay' },          // 9x4.3x3 in
  concreteBlock: { name: 'Concrete block', L: 0.6, W: 0.2, H: 0.2, dens: 1250, fc: 5.0, cost: 38, tile: 'block' },        // 24x8x8 in, lighter than clay per m3, stronger
};

export const MORTAR = { name: 'Cement-sand mortar 1:6', dens: 2000, joint: 0.01, bond: 0.35 }; // joint thickness, bond (fraction of unit strength kept)

export const MATERIALS = {
  clayMasonry: { unit: 'clayBrick', dens: 1800, fc: 3.0, bond: 0.8, brittle: 1.0, tile: 'clay', rub: [0.62, 0.3, 0.2] },
  blockMasonry: { unit: 'concreteBlock', dens: 1350, fc: 5.0, bond: 0.9, brittle: 1.1, tile: 'block', rub: [0.6, 0.6, 0.58] },
  rcc: { dens: 2450, fc: 25, steel: 500, bond: 1.0, brittle: 0.6, tile: 'rcc', rub: [0.55, 0.55, 0.53] },
  plaster: { dens: 1900, t: 0.012 },
  wood: { dens: 650, fc: 12, tile: 'wood', rub: [0.4, 0.26, 0.15] },
  glass: { area: 20, fc: 1, tile: 'glass', rub: [0.6, 0.72, 0.78] },
  steel: { dens: 7850, fc: 250, tile: 'steel', rub: [0.4, 0.42, 0.45] },
};

// impact energy a solid element absorbs per m3 of volume before it gives way (order-of-magnitude real)
export const E_PER_FC = 60e3;

export const PAINTS = {
  outer: ['#e0cfa8', '#d1a877', '#a8c4a0', '#e0a898', '#9fbad2', '#ead9b0', '#c98a55', '#7fa5c0', '#d6c36a', '#c5887a'],
  inner: ['#f2ede2', '#e6dfd0', '#d8e4e0', '#f0e1d6', '#e0e6ee'],
  trim: ['#5b3d2b', '#3d3d3d', '#2e4a5c', '#6b2f2f'],
};

export const FURNITURE_COLORS = {
  wood: ['#6b4a32', '#8a6240', '#4e3524', '#a67c52'],
  fabric: ['#3b4a63', '#7a3b3b', '#4f6b52', '#8a7a5a', '#5a4a6b'],
  metal: ['#9aa0a6', '#c8c8c4', '#6b7078'],
};
