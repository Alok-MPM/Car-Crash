// Self-check for every building the engine produces. It looks for the mistakes a hand-written design usually has
// (broken numbers, duplicated pieces, parts hanging in the air, lintels that bridge nothing) and repairs what it can.
// The result is kept on B.report so the Design Lab can show it.

export function validateBuilding(S, B) {
  const issues = [];
  const note = (type, msg, fixed) => issues.push({ type, msg, fixed: !!fixed });
  const P = B.panels;

  // 1. geometry sanity
  for (const p of P) {
    if (p.state !== 'fixed') continue;
    const bad = ![p.cx, p.cy, p.cz, p.hx, p.hy, p.hz].every(Number.isFinite) || p.hx <= 0 || p.hy <= 0 || p.hz <= 0;
    if (bad) { S.world.remove(p.body); p.state = 'gone'; note('geometry', `${p.kind} #${p.e.id} had invalid size - removed`, true); }
  }

  // 2. duplicated pieces: two straight panels that fill the same space
  const st = P.filter((p) => p.state === 'fixed' && !p.q);
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
    const a = st[i], b = st[j];
    const ox = Math.min(a.cx + a.hx, b.cx + b.hx) - Math.max(a.cx - a.hx, b.cx - b.hx);
    const oy = Math.min(a.cy + a.hy, b.cy + b.hy) - Math.max(a.cy - a.hy, b.cy - b.hy);
    const oz = Math.min(a.cz + a.hz, b.cz + b.hz) - Math.max(a.cz - a.hz, b.cz - b.hz);
    if (ox <= 0.02 || oy <= 0.02 || oz <= 0.02) continue;
    const va = 8 * a.hx * a.hy * a.hz, vb = 8 * b.hx * b.hy * b.hz, ov = ox * oy * oz;
    if (ov > 0.85 * Math.min(va, vb) && a.kind === b.kind) {
      const drop = va < vb ? a : b;
      S.world.remove(drop.body); drop.state = 'gone';
      note('overlap', `duplicate ${drop.kind} #${drop.e.id} removed`, true);
    }
  }

  // 3. ground contact
  if (!P.some((p) => p.state === 'fixed' && p.y0 < 0.05)) note('ground', 'nothing touches the ground', false);

  // 4. load path: every piece must be held by something that reaches the ground. Repair, then re-check.
  for (let pass = 0; pass < 4; pass++) {
    const { stable, fixed } = S.computeStable(B);
    const lost = fixed.filter((p) => !stable.has(p));
    if (!lost.length) break;
    for (const p of lost) {
      if (p.kind === 'lintel') { p.kind = 'wall'; p.str = true; p.e.kind = 'wall'; note('load', `lintel #${p.e.id} bridged nothing - now a wall piece`, true); continue; }
      // a support that stops short: link to the nearest panel below within 0.4 m
      let best = null, bd = 0.4;
      for (const q of P) {
        if (q === p || q.state !== 'fixed' || !stable.has(q)) continue;
        const dy = p.y0 - q.y1;
        if (dy < -0.05 || dy > bd) continue;
        if (Math.abs(p.cx - q.cx) < p.ax + q.ax && Math.abs(p.cz - q.cz) < p.az + q.az) { best = q; bd = dy; }
      }
      if (best) { p.below.push(best); best.above.push(p); note('load', `${p.kind} #${p.e.id} floated ${Math.max(0, bd).toFixed(2)} m above support - linked`, true); }
      else if (best === null && (() => {   // hanging concrete (pods, frames): rests against the nearest standing panel it touches
        const tol = 0.15; let bq = null, bdist = 1e9;
        for (const q of P) { if (q === p || q.state !== 'fixed' || !stable.has(q)) continue;
          if (Math.abs(p.cx - q.cx) < p.ax + q.ax + tol && Math.abs(p.cy - q.cy) < p.ay + q.ay + tol && Math.abs(p.cz - q.cz) < p.az + q.az + tol) { const d = Math.hypot(p.cx - q.cx, p.cy - q.cy, p.cz - q.cz); if (d < bdist) { bdist = d; bq = q; } } }
        if (bq) { p.below.push(bq); bq.above.push(p); return true; } return false; })()) { note('load', `${p.kind} #${p.e.id} hangs from the wall behind it`, true); }
      else if (pass === 3) { p.anchored = true; note('load', `${p.kind} #${p.e.id} had no support path - pinned to its neighbour`, true); }
    }
  }
  // 5. mass sanity
  const tons = P.reduce((s, p) => s + (p.state === 'fixed' ? p.mass : 0), 0) / 1000;
  if (!(tons > 0)) note('mass', 'building has no mass', false);
  B.report = { ok: issues.every((i) => i.fixed), issues, panels: P.filter((p) => p.state === 'fixed').length, tons: +tons.toFixed(1) };
  return B.report;
}
