// FACADE COMPOSER - the engine's own designer. Given only size, floors, style and a seed it picks one facade ARCHETYPE (learned from reference
// photos) and randomises its proportions, so no two seeds give the same house. It never decides placement of doors: compile.js trims anything that would block a door.
// To teach the engine a new look from a new photo: add one archetype function here (or a row in ARCHETYPES). Every house in the game can then use it.
const rng = (seed) => { let s = (Math.imul((seed | 0) ^ 0x9e3779b9, 2246822519) >>> 0) || 1; const f = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); f(); f(); f(); return () => { const a = f(), b = f(); return (a * 0.5 + b * 0.5 + 0.0) % 1 === 0 ? a : (a + b * 0.37) % 1; }; };
const pick = (r, a) => a[Math.floor(r() * a.length) % a.length];
const range = (r, a, b) => a + r() * (b - a);
const q = (v) => Math.round(v * 20) / 20;

const WOODS = ['#b8a98f', '#c4b69d', '#a98462', '#9b7a58'];
const DARKS = ['#2b2d31', '#3a3c40', '#2a2c30'];

export const ARCHETYPES = {
  // beige vertical louvre screen over the upper floor, plain white box below, thin overhang slab (photo: white box + louvre block)
  louvreBlock(c, r) {
    const side = r() < 0.5 ? -1 : 1, hw = c.w / 2, cut = q(range(r, c.w * 0.35, c.w * 0.6));
    const tint = pick(r, WOODS), top = c.N - 1;
    const f = [{ t: 'louvre', f0: top, dy: 0, vTop: undefined, u0: side < 0 ? -hw : hw - cut, u1: side < 0 ? -hw + cut : hw, pitch: range(r, 0.11, 0.18), tint }];
    f.push({ t: 'volume', f0: top, f1: top, dy: -0.1, h: 0.28, u0: -hw - 0.3, u1: hw + 0.3, d: q(range(r, 0.8, 1.6)), tint: pick(r, ['#f1efe9', '#e4e1da']) });
    return f;
  },
  // tall wood-clad shaft + dark flat roof overhang (photo: timber entry volume with tall glass)
  woodShaft(c, r) {
    const hw = c.w / 2, sw = q(range(r, 2.8, 3.8)), x0 = q(range(r, -hw + 0.6, hw - sw - 0.6));
    return [
      { t: 'volume', f0: 0, f1: Math.min(c.N - 1, 1), u0: x0, u1: x0 + sw, d: q(range(r, 0.3, 0.55)), tile: 'wood' },
      { t: 'volume', f0: c.N - 1, f1: c.N - 1, dy: 2.9, h: 0.32, u0: -hw - 0.4, u1: hw + 0.4, d: q(range(r, 1.2, 2.2)), tint: pick(r, DARKS) },
    ];
  },
  // black ribbon of connected pods on the first floor with glass balcony above and heavy roof slab (photo: black-marble pods)
  podRibbon(c, r) {
    const hw = c.w / 2, n = 4, edges = [-hw]; const wd = c.w / n;
    const kinds = ['rbox', 'tri', 'rbox', 'rbox'];
    const items = []; const a = r() < 0.5 ? 1 : 0;
    for (let i = 0; i < n; i++) items.push({ u0: q(-hw + i * wd), u1: q(-hw + (i + 1) * wd), kind: kinds[(i + a) % n], hgt: 3.3, r: 0.7 });
    const f = [{ t: 'pods', f0: 1, w: 0.3, depth: q(range(r, 1.3, 1.7)), tile: 'rcc', tint: pick(r, DARKS), items }];
    if (c.N >= 3) f.push({ t: 'volume', f0: c.N - 1, f1: c.N - 1, dy: -0.2, h: 0.28, u0: -hw, u1: hw, d: q(range(r, 1.6, 2.2)), tint: pick(r, DARKS) });
    f.push({ t: 'volume', f0: 0, f1: c.N - 1, u0: q(-hw), u1: q(-hw + range(r, 1.0, 1.6)), d: 0.4, tile: 'marble' });
    return f;
  },
  // rounded white C-frame hugging the upper window group (photo: curved cantilever frame house)
  cFrame(c, r) {
    const hw = c.w / 2, fw = q(range(r, c.w * 0.5, c.w * 0.75)), x0 = q(r() < 0.5 ? -hw + 0.4 : hw - fw - 0.4);
    return [{ t: 'cframe', f0: Math.min(1, c.N - 1), f1: c.N - 1, u0: x0, u1: x0 + fw, r: q(range(r, 0.8, 1.4)), w: 0.3, depth: q(range(r, 0.5, 0.9)), tint: '#f2f0ea' }];
  },
  // stone / marble vertical shaft on one side + glass balcony + dark roof slab (photo: stepped massing)
  stoneShaft(c, r) {
    const hw = c.w / 2, sw = q(range(r, 1.2, 2.2)), left = r() < 0.5;
    return [
      { t: 'volume', f0: 0, f1: c.N - 1, u0: left ? -hw : hw - sw, u1: left ? -hw + sw : hw, d: 0.45, tile: pick(r, ['marble', 'slate', 'fluted']) },
      { t: 'volume', f0: c.N - 1, f1: c.N - 1, dy: -0.1, h: 0.3, u0: -hw - 0.3, u1: hw + 0.3, d: q(range(r, 1.0, 1.8)), tint: pick(r, DARKS) },
    ];
  },
  plain() { return []; },
};

// which archetypes suit a style / floor count
const FOR_STYLE = {
  modern: ['louvreBlock', 'woodShaft', 'cFrame', 'stoneShaft', 'plain'],
  dark: ['podRibbon', 'stoneShaft', 'woodShaft', 'louvreBlock'],
  glass: ['stoneShaft', 'plain'],
};

export function composeFacade({ w, d, N, style, seed, name }) {
  const r = rng(seed || 7);
  const list = (FOR_STYLE[style] || ['plain']).filter((k) => (k === 'podRibbon' ? N >= 3 : N >= 2) || k === 'plain');
  const arch = name && ARCHETYPES[name] ? name : pick(r, list);
  return { arch, features: ARCHETYPES[arch]({ w, d, N }, r) };
}
