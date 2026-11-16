// TREE PICTURES (impostors): every species painted as one shaded full-tree picture, from the very SAME skeleton and leaves as the 3D tree (treegen.js), seen from the side.
// A picture stands in for the 3D tree beyond a few tens of metres, so it has to match its colour, size and fullness.
import { mulberry32 } from '../../core/math.js';
import { AW, AH, CL, finishTex, stampLeaf, setBase, makeFoliageTex } from './leafart.js';
import { clusters } from './treegen.js';

export { makeFoliageTex };
export const IMP_ORDER = ['neem', 'mango', 'banyan', 'gulmohar', 'ashoka', 'babool', 'palm', 'shrub', 'apple'];
export function impSize(sp, name) {   // metres covered by the picture of the nominal tree
  const h = (sp.h[0] + sp.h[1]) / 2, cr = (sp.crown[0] + sp.crown[1]) / 2;
  const W = name === 'palm' ? cr * 2 * 2.1 : name === 'shrub' ? cr * 2 * 1.5 : name === 'ashoka' ? cr * 2 * 1.35 : name === 'banyan' ? cr * 2 * 1.4 : cr * 2 * 1.3;
  return { W, H: h * 1.08, h, cr };
}
const IA = 1024, IH = 1024;   // impostor atlas: 4 x 4 cells of 256
export function makeImpostors(r, TREES, Tmap) {
  const cv = document.createElement('canvas'); cv.width = IA; cv.height = IH;
  const g = cv.getContext('2d', { willReadFrequently: true }), info = {};
  IMP_ORDER.forEach((name, i) => {
    const sp = TREES[name], S = impSize(sp, name), cu = i % 4, cr = (i / 4) | 0, T0 = Tmap[name];
    if (T0 && T0.leaves && T0.leaves.length) {   // the picture covers exactly the extent of the real tree
      let mx = 0, my = 0; for (const l of T0.leaves) { mx = Math.max(mx, Math.abs(l.p[0]) + l.len * 0.6, Math.abs(l.p[2]) + l.len * 0.6); my = Math.max(my, l.p[1] + l.len * 0.6); }
      for (const l of T0.limbs) for (const p of l.pts) { mx = Math.max(mx, Math.abs(p[0])); }
      S.W = Math.max(0.5, mx * 2 * 1.06); S.H = Math.max(S.h * 0.5, my * 1.04);
    }
    info[name] = { cell: [cu, cr], W: S.W, H: S.H, uv: [(cu * CL + 1.5) / IA, ((cu + 1) * CL - 1.5) / IA, (cr * CL + 1.5) / IH, ((cr + 1) * CL - 1.5) / IH] };
    if (!Tmap[name]) return;
    g.save(); g.beginPath(); g.rect(cu * CL, cr * CL, CL, CL); g.clip();
    g.translate(cu * CL + CL / 2, cr * CL + CL - 4); g.scale(CL / S.W, -(CL - 4) / S.H);   // metres, y up, origin at the foot of the trunk
    setBase(g.getTransform());
    paintTree(g, Tmap[name], name, sp, S);
    g.restore();
  });
  return { tex: finishTex(r, g, IA, IH, (x, y) => [64, 110, 42]), info };
}
function paintTree(g, T, name, sp, S) {
  const L = sp.leaf[0], lc = [L[0] / 0.14 * 0.5 + sp.leaf[1][0] / 0.14 * 0.5, L[1] / 0.28 * 0.5 + sp.leaf[1][1] / 0.28 * 0.5, L[2] / 0.09 * 0.5 + sp.leaf[1][2] / 0.09 * 0.5];
  const tt = { key: name, rgb: [Math.min(1, lc[0] / 1.32), Math.min(1, lc[1] / 1.32), Math.min(1, lc[2] / 1.32)] };
  const h = S.h, hasLeaves = T.leaves && T.leaves.length;
  g.lineCap = 'round'; g.lineJoin = 'round';
  // wood
  for (const l of T.limbs) {
    if (l.ord > 3 && !l.root) continue;
    g.strokeStyle = l.frond ? 'rgb(96,108,56)' : 'rgb(70,52,36)';
    for (let i = 0; i < l.pts.length - 1; i++) { g.lineWidth = Math.max(0.035, l.rad[i] * 2); g.beginPath(); g.moveTo(l.pts[i][0], l.pts[i][1]); g.lineTo(l.pts[i + 1][0], l.pts[i + 1][1]); g.stroke(); }
  }
  if (!hasLeaves) return;
  // crown mass: dark filled puffs at the leaf clusters, so the picture is as full as the tree
  if (T.name !== 'palm') {
    const cs = Math.max(0.3, Math.min(2.0, T.rx * 0.3)), base = [lc[0] * 255 * 0.52 * 0.55, lc[1] * 255 * 0.52 * 0.55, lc[2] * 255 * 0.52 * 0.55];
    for (const cl of clusters(T, cs)) {
      const e0 = T.e(cl.p), k = 0.5 + 0.5 * Math.min(1, e0);
      g.fillStyle = `rgb(${Math.min(255, base[0] * k) | 0},${Math.min(255, base[1] * k) | 0},${Math.min(255, base[2] * k) | 0})`;
      g.beginPath(); g.ellipse(cl.p[0], cl.p[1], cs * 0.5, cs * 0.45 * (T.name === 'gulmohar' ? 0.7 : 1), 0, 0, 6.283); g.fill();
    }
  }
  // leaves, far side first
  const L2 = T.leaves.slice().sort((a, b) => a.p[2] - b.p[2]);
  for (const lf of L2) {
    const ang = Math.atan2(lf.d[0], -lf.d[1] * 0.8 - 0.05 * 0), k = Math.max(0.3, Math.min(1.5, lf.c[1] * 1.1));
    stampLeaf(g, T.S.leaf, lf.p[0], lf.p[1], Math.atan2(lf.d[0], -lf.d[1]) * 0.85 + 0.0 * ang, lf.len * 1.25, k, lf.ws * (name === 'palm' ? 1.0 : 1.05), tt);
  }
  for (const f of T.flowers || []) if (f.name === 'gulflower') stampLeaf(g, 'gulflower', f.p[0], f.p[1], Math.atan2(f.d[0], -f.d[1]), f.len * 1.2, 1.0, 1);
  // baked ambient occlusion: darker low and inside, warm light on top (only where something was painted)
  g.globalCompositeOperation = 'source-atop';
  const vg = g.createLinearGradient(0, 0, 0, h * 1.05), dk = name === 'ashoka' ? 0.28 : 0.42; vg.addColorStop(0, 'rgba(0,0,0,' + dk + ')'); vg.addColorStop(0.35, 'rgba(0,0,0,' + dk * 0.3 + ')'); vg.addColorStop(1, 'rgba(255,240,170,0.08)');
  g.fillStyle = vg; g.fillRect(-S.W, -1, S.W * 2, h * 1.2);
  g.globalCompositeOperation = 'source-over';
}
