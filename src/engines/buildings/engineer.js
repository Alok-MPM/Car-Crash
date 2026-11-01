// Building Engineer: turns a short spec (footprint, floors, style) into a structural plan.
// It decides the structural system, wall thickness per storey, column sizes, slab thickness and steel ratio from loads
// and material strengths - so a taller building automatically gets a thicker, stronger base.
import { MATERIALS, UNITS, E_PER_FC } from '../../data/materials.js';

const G = 9.81;
const LOAD = { floor: 7.0, roof: 6.0 };   // kN/m2 (self weight + finishes + live), working loads
const SOIL = 150;                          // kPa safe bearing capacity
const ROUND = (v, step) => Math.ceil(v / step - 1e-9) * step;

export function design(spec) {
  const floors = Math.max(1, spec.floors | 0 || 2);
  const storeyH = spec.storeyH || 3.2;
  const w = spec.w, d = spec.d;
  const maxSpan = 4.2;
  // --- system choice: small low houses are load-bearing red-clay masonry, anything bigger is an RCC frame with block infill
  let system = spec.system || 'auto';
  if (system === 'auto') system = floors <= 3 && Math.max(w, d) <= 14 ? 'loadbearing' : 'frame';
  if (system === 'loadbearing' && floors > 4) system = 'frame';
  const fill = system === 'loadbearing' ? 'clayMasonry' : 'blockMasonry';
  const fillMat = MATERIALS[fill];
  const unit = UNITS[fillMat.unit];
  // --- slab
  const slabT = Math.max(0.125, ROUND(maxSpan / 28, 0.025));
  const slabSelf = slabT * 24.5;             // kN/m2
  // --- per-storey sizing (index 0 = ground)
  const storeys = [];
  const wallArea = (w + d) * 2;
  const bay = floors >= 4 ? 5.5 : 7;
  const sx = Math.max(1, Math.ceil(w / bay)), sz = Math.max(1, Math.ceil(d / bay));
  const spx = w / sx, spz = d / sz;
  for (let f = 0; f < floors; f++) {
    const above = floors - f;                                  // storeys (and roof) resting on this one
    const sw = fillMat.dens * G / 1000;                         // kN/m3 of masonry
    if (system === 'loadbearing') {
      // load per metre of wall: tributary slab strip (half span) x floors above + own weight of the walls above
      const q = (maxSpan / 2) * (LOAD.floor * (above - 1) + LOAD.roof) + 0 * slabSelf;
      let t = 0.23;
      for (let iter = 0; iter < 8; iter++) {
        const self = sw * t * (storeyH - slabT) * above * 0.9;
        const sigma = (fillMat.fc * 1000 * fillMat.bond) / 6;      // allowable masonry stress, kPa
        const need = (q + self) / sigma;
        if (need <= t) break;
        t = ROUND(need, 0.115);
      }
      storeys.push({ f, wallT: Math.max(0.23, ROUND(t, 0.115)), col: 0 });
    } else {
      const N = spx * spz * (LOAD.floor * (above - 1) + LOAD.roof + slabSelf * 0) * 1.0 + (spx + spz) * 2 * 0.2 * (storeyH - slabT) * sw * above * 0.5;
      const sigma = 0.4 * MATERIALS.rcc.fc * 1000 + 0.67 * MATERIALS.rcc.steel * 1000 * 0.015; // kPa with 1.5% steel
      const A = (N * 1.5) / sigma;
      const c = Math.max(0.3, ROUND(Math.sqrt(A), 0.05));
      storeys.push({ f, wallT: unit.W + 0.02 + (unit.W >= 0.2 ? 0 : 0.12) , col: Math.min(c, 0.9) });
    }
  }
  // infill walls in a frame: one block thick (block W=0.2 -> 0.2 + plaster)
  if (system === 'frame') for (const s of storeys) s.wallT = Math.max(0.2, unit.W);
  // --- foundation: strip / pad width from base reaction
  const baseLoad = LOAD.floor * (floors - 1) + LOAD.roof;
  const strip = ROUND(Math.max(0.6, (baseLoad * 2 + storeys[0].wallT * 22 * (storeyH * floors)) / SOIL), 0.1);
  // --- reinforcement ratio of slabs / columns (affects impact strength)
  const rho = system === 'frame' ? 0.012 + 0.002 * Math.min(floors, 6) : 0.008;
  const rccFc = MATERIALS.rcc.fc * (1 + 8 * rho);
  return {
    spec, system, fill, unit, floors, storeyH, w, d, slabT, storeys, sx, sz, spx, spz, strip, rho,
    fe: { clay: unit.fc * fillMat.bond, rcc: rccFc },
    // twice the span of a 125 mm slab needs a beam; core for tall frames
    core: system === 'frame' && floors >= 4,
    note: system === 'loadbearing'
      ? `load-bearing ${fillMat.unit}, wall ${storeys.map((s) => s.wallT.toFixed(3)).join('/')} m, strip footing ${strip} m`
      : `RCC frame, columns ${storeys.map((s) => s.col.toFixed(2)).join('/')} m, ${unit.name} infill, strip footing ${strip} m`,
  };
}

// impact energy capacity (J) of an element of volume V (m3) made of a given material
export function capacity(plan, kind, V) {
  switch (kind) {
    case 'clay': return E_PER_FC * plan.fe.clay * V;
    case 'rcc': return E_PER_FC * plan.fe.rcc * V;
    case 'slab': return E_PER_FC * plan.fe.rcc * V * 0.32;
    case 'wood': return E_PER_FC * MATERIALS.wood.fc * V;
    default: return E_PER_FC * 3 * V;
  }
}
