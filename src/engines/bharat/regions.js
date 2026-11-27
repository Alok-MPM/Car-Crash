// REGIONS: what the ground is made of and what grows on it, anywhere in Bharat.
//  Soil follows the EdgeSoil profiles (dry cracked loam / alluvial loam / garden soil), picked by a coarse climate model of the sub-continent:
//    arid   Thar (Rajasthan), Kutch, the cold desert of Ladakh-Spiti, the rain-shadow of the Deccan -> dry cracked loam, bare or thorny scrub, dust
//    alluvial  Indo-Gangetic plain, river deltas -> moist alluvial loam, the farmland (fields: ploughed, green crop, ripe crop, fallow)
//    humid  Assam / North-East, Bengal, Konkan, Western Ghats, Kerala, the Terai -> wetter soil, lush ground cover, keechar after rain
//    hills / mountains -> forest, meadow, bare rock, scree, snow by height and slope
//  Moisture is a static regional value for now (no rain / water here: the water engine comes later and will move `wet` through setSeason()).
//  This is an approximation of the real soil map; it is refined state by state when each state's layer is designed.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash2 = (i, j) => { let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
export function vnoise(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = hash2(i, j), b = hash2(i + 1, j), c = hash2(i, j + 1), d = hash2(i + 1, j + 1), su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
  return (a + (b - a) * su + (c - a) * sv + (a - b - c + d) * su * sv) * 2 - 1;
}
// a soft elliptical blob: 1 at the centre, 0 outside
const blob = (lat, lon, c) => { const a = (lat - c[0]) / c[2], b = (lon - c[1]) / c[3]; return Math.exp(-(a * a + b * b)); };
// [lat, lon, sigma lat, sigma lon]
const ARID = [[27.2, 71.0, 3.0, 3.4, 1.0], [23.7, 69.9, 1.5, 2.3, 0.95], [25.3, 71.0, 2.2, 1.8, 0.5], [33.6, 77.8, 2.0, 2.8, 0.85], [32.2, 78.2, 1.3, 1.6, 0.7], [15.0, 77.2, 1.8, 2.2, 0.62], [18.6, 75.8, 1.3, 1.9, 0.38], [11.2, 78.3, 1.1, 1.2, 0.3], [30.0, 75.3, 1.2, 1.5, 0.32], [26.0, 74.8, 2.0, 2.0, 0.3]];
const HUMID = [[26.2, 92.4, 2.2, 3.6, 0.95], [22.8, 88.8, 1.6, 2.0, 0.75], [15.2, 74.1, 5.0, 0.7, 0.9], [10.4, 76.4, 2.4, 0.8, 0.95], [20.6, 85.6, 1.8, 1.8, 0.45], [27.0, 85.0, 0.6, 3.2, 0.42], [27.2, 88.5, 0.9, 0.9, 0.7], [12.0, 92.7, 3.0, 1.0, 0.9], [19.0, 82.0, 2.0, 1.6, 0.3]];

export const COVER = { BARE: 0, GRASS: 0.25, PLOUGHED: 0.5, CROP: 0.75, RIPE: 1 };

export class Regions {
  constructor() { this.season = 0; }
  setSeason(wet) { this.season = wet; }                       // -1 .. +1, added to the moisture of every place (the water engine will drive this)
  // the part of the climate that changes over hundreds of km (monsoon belts, deserts): aridity before the height terms. Cheap to cache per chunk.
  base(lat, lon) {
    let a = 0.3;
    for (const c of ARID) a += c[4] * blob(lat, lon, c) * 0.62;
    for (const c of HUMID) a -= c[4] * blob(lat, lon, c) * 0.5;
    return a;
  }
  // ground at a point (a0 = base(lat, lon)). gx, gy: absolute global pixel coordinates (so fields are the same in every frame); e: metres above sea level; ny: slope (1 = flat).
  // out: [r, g, b (colour, before the lawn shader's own tint), moisture 0..1, cover code 0..1, hard 0/1]
  at(a0, lat, e, ny, gx, gy, out) {
    let A = a0 + sstep(2800, 4300, e) * 0.35 * (lat > 29 ? 1 : 0.4) - sstep(900, 2200, e) * (1 - sstep(2800, 3600, e)) * 0.18;   // high and dry: Ladakh, Spiti; mid-height mountains catch the rain
    A = clamp(A, 0, 1);
    const cl = { moist: clamp(0.5 - 0.5 * A + 0.03 + this.season * 0.3, 0.04, 0.9) };
    const n1 = vnoise(gx * 0.33, gy * 0.33), n2 = vnoise(gx * 1.9 + 4.2, gy * 1.9 - 7.7), nf = vnoise(gx * 0.07 + 40, gy * 0.07 + 11), nb = vnoise(gx * 0.8 + 90, gy * 0.8 + 3);
    const steep = clamp((1 - ny - 0.1) / 0.32, 0, 1);
    const tone = 0.88 + 0.12 * n2;
    let m = cl.moist + 0.06 * n1;
    // ---- colours (linear). dry cracked loam is pale clay-brown; alluvial loam is darker grey-brown; humid soil is dark and rich
    const dryC = [0.30, 0.185, 0.095], alluC = [0.16, 0.115, 0.07], richC = [0.075, 0.052, 0.03];
    let soil = mixc(mixc(alluC, richC, sstep(0.5, 0.7, m)), dryC, sstep(0.55, 0.9, A));
    // ---- what covers it
    const cultivable = ny > 0.985 && e < 800 && A < 0.78;                 // flat low ground that is not desert: the farmland
    const f = (nf + 1) * 0.5;
    let cover = COVER.GRASS, g = [0.115, 0.215, 0.07];
    if (A > 0.7) { cover = COVER.BARE; g = soil; }                        // desert: bare cracked loam
    else if (A > 0.5) { const sc = sstep(0.5, 0.7, A); cover = sc > 0.5 ? COVER.BARE : COVER.GRASS; g = mixc([0.2, 0.18, 0.08], soil, sc); }   // scrub fading to bare
    if (cultivable) {
      // a patchwork of fields ~100 m across: ploughed, green crop, ripe crop, fallow
      const k = f * 0.7 + (n1 + 1) * 0.15;
      if (k < 0.3) { cover = COVER.PLOUGHED; g = mixc(soil, [0.11, 0.075, 0.045], 0.5); }
      else if (k < 0.55) { cover = COVER.CROP; g = [0.1, 0.23, 0.06]; }
      else if (k < 0.72) { cover = COVER.RIPE; g = [0.3, 0.235, 0.09]; }
      else { cover = COVER.GRASS; g = [0.12, 0.2, 0.07]; }                // fallow / meadow strip
    } else if (e > 180 && ny > 0.8 && A < 0.5) { cover = COVER.GRASS; g = mixc(g, [0.07, 0.15, 0.05], sstep(180, 420, e)); }
    // forest belts and meadow with height (the trees themselves come with the forest layer)
    if (A < 0.6) { g = mixc(g, [0.042, 0.095, 0.045], sstep(1500, 2000, e) * (1 - sstep(3000, 3400, e))); g = mixc(g, [0.13, 0.165, 0.07], sstep(2900, 3300, e)); }
    // bare rock / scree / snow
    const rockC = mixc([0.2, 0.19, 0.18], [0.26, 0.23, 0.2], (n2 + 1) * 0.5);
    const rockK = Math.max(sstep(4200, 4900, e), steep * 0.95);
    let hard = rockK > 0.55 ? 1 : 0;
    g = mixc(g, rockC, rockK);
    const snow = sstep(4900, 5500, e + 220 * n1) * (1 - steep * 0.8);
    g = mixc(g, [0.78, 0.8, 0.83], snow);
    if (snow > 0.5) hard = 1;
    if (rockK > 0.4 || snow > 0.2) { cover = COVER.BARE; m = 0.4; }          // rock / scree / snow: not dry-cracked, not mud
    // patchy damp / dry spots, so a field is not one flat colour
    out[0] = g[0] * tone; out[1] = g[1] * tone; out[2] = g[2] * tone;
    out[3] = clamp(m + 0.05 * nb, 0.03, 0.95); out[4] = cover; out[5] = hard;
    return out;
  }
}
function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
