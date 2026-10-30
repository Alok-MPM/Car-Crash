// Compact rigid-body engine: oriented boxes (compound), plane ground, sequential-impulse solver,
// warm starting, sleeping. Built for destruction: many boxes, car chassis, flying panels.
import { qRot } from './math.js';

let BODY_ID = 1;
const ZERO9 = new Float64Array(9);

export const GROUP = { CAR: 1, PROP: 2, DEBRIS: 4, STATIC: 8, ALL: 0xffff };

function quatAxes(q, m) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  m[0] = 1 - 2 * (yy + zz); m[1] = 2 * (xy + wz); m[2] = 2 * (xz - wy);
  m[3] = 2 * (xy - wz); m[4] = 1 - 2 * (xx + zz); m[5] = 2 * (yz + wx);
  m[6] = 2 * (xz + wy); m[7] = 2 * (yz - wx); m[8] = 1 - 2 * (xx + yy);
}

function inv3(m) {
  const a = m[0], b = m[1], c = m[2], d = m[3], e = m[4], f = m[5], g = m[6], h = m[7], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  const id = Math.abs(det) < 1e-12 ? 0 : 1 / det;
  return [
    A * id, -(b * i - c * h) * id, (b * f - c * e) * id,
    B * id, (a * i - c * g) * id, -(a * f - c * d) * id,
    C * id, -(a * h - b * g) * id, (a * e - b * d) * id,
  ];
}

export class Body {
  constructor(o = {}) {
    this.id = BODY_ID++;
    this.pos = o.pos ? o.pos.slice() : [0, 0, 0];
    this.q = o.q ? o.q.slice() : [0, 0, 0, 1];
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.mass = o.mass || 0;
    this.fixed = !!o.fixed || !o.mass;
    this.invMass = this.fixed ? 0 : 1 / this.mass;
    this.invIl = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    this.shapes = [];
    this.fric = o.fric ?? 0.5;
    this.rest = o.rest ?? 0.05;
    this.sleeping = false;
    this.sleepT = 0;
    this.canSleep = o.canSleep ?? true;
    this.F = [0, 0, 0];
    this.T = [0, 0, 0];
    this.linDamp = o.linDamp ?? 0.02;
    this.angDamp = o.angDamp ?? 0.08;
    this.R = new Float64Array(9);
    this.iiw = new Float64Array(9);
    this.im = this.invMass;
    this.report = false;
    this.userData = null;
    this.group = o.group ?? GROUP.PROP;
    this.mask = o.mask ?? GROUP.ALL;
    this.aabb = [0, 0, 0, 0, 0, 0];
    this.raycast = !!o.raycast;
    this.inertiaDiag = o.inertia || null;
    this.touching = 0;
    this.removed = false;
    quatAxes(this.q, this.R);
  }

  addBox(he, off = [0, 0, 0], q = null) {
    const s = { he: he.slice(), off: off.slice(), q: q ? q.slice() : null, c: [0, 0, 0], m: new Float64Array(9), lm: null, aabb: [0, 0, 0, 0, 0, 0] };
    if (q) {
      s.lm = new Float64Array(9);
      quatAxes(q, s.lm);
    }
    this.shapes.push(s);
    return s;
  }

  // compute inertia from shapes (volume-weighted)
  finalize() {
    if (this.fixed) {
      this.invIl = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      this.refresh();
      return;
    }
    if (this.inertiaDiag) {
      const d = this.inertiaDiag;
      this.invIl = [1 / d[0], 0, 0, 0, 1 / d[1], 0, 0, 0, 1 / d[2]];
      this.refresh();
      return;
    }
    let vol = 0;
    for (const s of this.shapes) vol += 8 * s.he[0] * s.he[1] * s.he[2];
    const I = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (const s of this.shapes) {
      const v = 8 * s.he[0] * s.he[1] * s.he[2];
      const m = (this.mass * v) / vol;
      const ex = s.he[0], ey = s.he[1], ez = s.he[2];
      const d = [(m / 3) * (ey * ey + ez * ez), (m / 3) * (ex * ex + ez * ez), (m / 3) * (ex * ex + ey * ey)];
      let Is = [d[0], 0, 0, 0, d[1], 0, 0, 0, d[2]];
      if (s.lm) {
        // R diag R^T with axes columns
        const R = s.lm, out = new Array(9).fill(0);
        for (let r = 0; r < 3; r++)
          for (let c = 0; c < 3; c++) {
            let sum = 0;
            for (let j = 0; j < 3; j++) sum += R[j * 3 + r] * d[j] * R[j * 3 + c];
            out[r * 3 + c] = sum;
          }
        Is = out;
      }
      const o = s.off, o2 = o[0] * o[0] + o[1] * o[1] + o[2] * o[2];
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) I[r * 3 + c] += Is[r * 3 + c] + m * ((r === c ? o2 : 0) - o[r] * o[c]);
    }
    this.invIl = inv3(I);
    this.refresh();
  }

  setPose(pos, q) {
    this.pos[0] = pos[0]; this.pos[1] = pos[1]; this.pos[2] = pos[2];
    this.q[0] = q[0]; this.q[1] = q[1]; this.q[2] = q[2]; this.q[3] = q[3];
    this.refresh();
  }

  // recompute rotation, world shapes, aabb, world inverse inertia
  refresh() {
    quatAxes(this.q, this.R);
    const R = this.R, p = this.pos;
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
    for (const s of this.shapes) {
      const o = s.off;
      s.c[0] = p[0] + R[0] * o[0] + R[3] * o[1] + R[6] * o[2];
      s.c[1] = p[1] + R[1] * o[0] + R[4] * o[1] + R[7] * o[2];
      s.c[2] = p[2] + R[2] * o[0] + R[5] * o[1] + R[8] * o[2];
      const m = s.m;
      if (s.lm) {
        const L = s.lm;
        for (let j = 0; j < 3; j++) {
          const lx = L[j * 3], ly = L[j * 3 + 1], lz = L[j * 3 + 2];
          m[j * 3] = R[0] * lx + R[3] * ly + R[6] * lz;
          m[j * 3 + 1] = R[1] * lx + R[4] * ly + R[7] * lz;
          m[j * 3 + 2] = R[2] * lx + R[5] * ly + R[8] * lz;
        }
      } else for (let k = 0; k < 9; k++) m[k] = R[k];
      const e = s.he;
      const ex = Math.abs(m[0]) * e[0] + Math.abs(m[3]) * e[1] + Math.abs(m[6]) * e[2];
      const ey = Math.abs(m[1]) * e[0] + Math.abs(m[4]) * e[1] + Math.abs(m[7]) * e[2];
      const ez = Math.abs(m[2]) * e[0] + Math.abs(m[5]) * e[1] + Math.abs(m[8]) * e[2];
      const a = s.aabb;
      a[0] = s.c[0] - ex; a[1] = s.c[1] - ey; a[2] = s.c[2] - ez;
      a[3] = s.c[0] + ex; a[4] = s.c[1] + ey; a[5] = s.c[2] + ez;
      if (a[0] < mnx) mnx = a[0]; if (a[1] < mny) mny = a[1]; if (a[2] < mnz) mnz = a[2];
      if (a[3] > mxx) mxx = a[3]; if (a[4] > mxy) mxy = a[4]; if (a[5] > mxz) mxz = a[5];
    }
    const A = this.aabb;
    A[0] = mnx; A[1] = mny; A[2] = mnz; A[3] = mxx; A[4] = mxy; A[5] = mxz;
    if (!this.fixed) {
      // iiw = R * invIl * R^T (R has axes as columns: R[j*3+i])
      const I = this.invIl, o = this.iiw;
      const t = new Float64Array(9);
      // t = invIl * R^T  -> t[r][c] = sum_k I[r][k] * R[c*3+k]
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) t[r * 3 + c] = I[r * 3] * R[c] + I[r * 3 + 1] * R[3 + c] + I[r * 3 + 2] * R[6 + c];
      // o = R * t -> o[r][c] = sum_k R[k*3+r] * t[k][c]
      for (let r = 0; r < 3; r++)
        for (let c = 0; c < 3; c++) o[r * 3 + c] = R[r] * t[c] + R[3 + r] * t[3 + c] + R[6 + r] * t[6 + c];
    }
  }

  applyForce(fx, fy, fz, px, py, pz) {
    this.F[0] += fx; this.F[1] += fy; this.F[2] += fz;
    const rx = px - this.pos[0], ry = py - this.pos[1], rz = pz - this.pos[2];
    this.T[0] += ry * fz - rz * fy;
    this.T[1] += rz * fx - rx * fz;
    this.T[2] += rx * fy - ry * fx;
  }
  applyImpulse(jx, jy, jz, px, py, pz) {
    this.v[0] += jx * this.invMass; this.v[1] += jy * this.invMass; this.v[2] += jz * this.invMass;
    const rx = px - this.pos[0], ry = py - this.pos[1], rz = pz - this.pos[2];
    const tx = ry * jz - rz * jy, ty = rz * jx - rx * jz, tz = rx * jy - ry * jx;
    const I = this.iiw;
    this.w[0] += I[0] * tx + I[1] * ty + I[2] * tz;
    this.w[1] += I[3] * tx + I[4] * ty + I[5] * tz;
    this.w[2] += I[6] * tx + I[7] * ty + I[8] * tz;
    this.wake();
  }
  velAt(px, py, pz, out) {
    const rx = px - this.pos[0], ry = py - this.pos[1], rz = pz - this.pos[2];
    out[0] = this.v[0] + this.w[1] * rz - this.w[2] * ry;
    out[1] = this.v[1] + this.w[2] * rx - this.w[0] * rz;
    out[2] = this.v[2] + this.w[0] * ry - this.w[1] * rx;
    return out;
  }
  wake() {
    this.sleeping = false;
    this.sleepT = 0;
  }
  sleep() {
    if (this.fixed) return;
    this.sleeping = true;
    this.v[0] = this.v[1] = this.v[2] = 0;
    this.w[0] = this.w[1] = this.w[2] = 0;
  }
  // local helpers
  toWorld(p) {
    return qRot(this.q, p).map((v, i) => v + this.pos[i]);
  }
  axisX() { return [this.R[0], this.R[1], this.R[2]]; }
  axisY() { return [this.R[3], this.R[4], this.R[5]]; }
  axisZ() { return [this.R[6], this.R[7], this.R[8]]; }
}

// ---------- narrow phase: box vs box (SAT + clipping) ----------
const C = new Float64Array(9), AC = new Float64Array(9);
const _t = [0, 0, 0];

function axisOf(m, j) {
  return [m[j * 3], m[j * 3 + 1], m[j * 3 + 2]];
}
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function clipPoly(poly, n, d) {
  // keep points with dot(p,n) - d <= 0
  const out = [];
  const len = poly.length;
  for (let i = 0; i < len; i++) {
    const a = poly[i], b = poly[(i + 1) % len];
    const da = a[0] * n[0] + a[1] * n[1] + a[2] * n[2] - d;
    const db = b[0] * n[0] + b[1] * n[1] + b[2] * n[2] - d;
    if (da <= 0) out.push(a);
    if (da * db < 0) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

function boxBox(sa, sb, out) {
  const ca = sa.c, cb = sb.c, ma = sa.m, mb = sb.m, ea = sa.he, eb = sb.he;
  const dx = cb[0] - ca[0], dy = cb[1] - ca[1], dz = cb[2] - ca[2];
  for (let i = 0; i < 3; i++) {
    _t[i] = dx * ma[i * 3] + dy * ma[i * 3 + 1] + dz * ma[i * 3 + 2];
    for (let j = 0; j < 3; j++) {
      const c = ma[i * 3] * mb[j * 3] + ma[i * 3 + 1] * mb[j * 3 + 1] + ma[i * 3 + 2] * mb[j * 3 + 2];
      C[i * 3 + j] = c;
      AC[i * 3 + j] = Math.abs(c) + 1e-7;
    }
  }
  const t = _t;
  let bestA = -Infinity, ia = 0, bestB = -Infinity, ib = 0;
  for (let i = 0; i < 3; i++) {
    const s = Math.abs(t[i]) - (ea[i] + eb[0] * AC[i * 3] + eb[1] * AC[i * 3 + 1] + eb[2] * AC[i * 3 + 2]);
    if (s > 0) return 0;
    if (s > bestA) { bestA = s; ia = i; }
  }
  for (let j = 0; j < 3; j++) {
    const tj = t[0] * C[j] + t[1] * C[3 + j] + t[2] * C[6 + j];
    const s = Math.abs(tj) - (eb[j] + ea[0] * AC[j] + ea[1] * AC[3 + j] + ea[2] * AC[6 + j]);
    if (s > 0) return 0;
    if (s > bestB) { bestB = s; ib = j; }
  }
  let bestE = -Infinity, ei = 0, ej = 0;
  for (let i = 0; i < 3; i++) {
    const i1 = (i + 1) % 3, i2 = (i + 2) % 3;
    for (let j = 0; j < 3; j++) {
      const j1 = (j + 1) % 3, j2 = (j + 2) % 3;
      const l2 = 1 - C[i * 3 + j] * C[i * 3 + j];
      if (l2 < 1e-5) continue;
      const ra = ea[i1] * AC[i2 * 3 + j] + ea[i2] * AC[i1 * 3 + j];
      const rb = eb[j1] * AC[i * 3 + j2] + eb[j2] * AC[i * 3 + j1];
      const tt = Math.abs(t[i2] * C[i1 * 3 + j] - t[i1] * C[i2 * 3 + j]);
      const s = (tt - ra - rb) / Math.sqrt(l2);
      if (s > 0) return 0;
      if (s > bestE) { bestE = s; ei = i; ej = j; }
    }
  }
  const faceBest = Math.max(bestA, bestB - 0.005);
  let n = 0;
  if (bestE > faceBest + 0.02) {
    // edge-edge
    const A = axisOf(ma, ei), B = axisOf(mb, ej);
    let nx = A[1] * B[2] - A[2] * B[1], ny = A[2] * B[0] - A[0] * B[2], nz = A[0] * B[1] - A[1] * B[0];
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    // points on edges
    const pa = [ca[0], ca[1], ca[2]], pb = [cb[0], cb[1], cb[2]];
    for (let k = 0; k < 3; k++) {
      if (k !== ei) {
        const ax = axisOf(ma, k);
        const sg = (ax[0] * nx + ax[1] * ny + ax[2] * nz) > 0 ? 1 : -1;
        for (let q = 0; q < 3; q++) pa[q] += sg * ea[k] * ax[q];
      }
      if (k !== ej) {
        const bx = axisOf(mb, k);
        const sg = (bx[0] * nx + bx[1] * ny + bx[2] * nz) > 0 ? -1 : 1;
        for (let q = 0; q < 3; q++) pb[q] += sg * eb[k] * bx[q];
      }
    }
    // closest points of two lines pa+s*A , pb+u*B
    const r = [pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]];
    const a = 1, b = dot3(A, B), c = 1, d = dot3(A, r), e = dot3(B, r);
    const den = a * c - b * b;
    const s = den > 1e-8 ? (b * e - c * d) / den : 0;
    const u = den > 1e-8 ? (a * e - b * d) / den : e;
    const qa = [pa[0] + A[0] * s, pa[1] + A[1] * s, pa[2] + A[2] * s];
    const qb = [pb[0] + B[0] * u, pb[1] + B[1] * u, pb[2] + B[2] * u];
    out.push({ p: [(qa[0] + qb[0]) / 2, (qa[1] + qb[1]) / 2, (qa[2] + qb[2]) / 2], n: [nx, ny, nz], d: -bestE });
    return 1;
  }
  // face contact
  let refM, refC, refE, incM, incC, incE, k, flip;
  let refN;
  if (bestA >= bestB - 0.005) {
    refM = ma; refC = ca; refE = ea; incM = mb; incC = cb; incE = eb; k = ia; flip = false;
    const sg = t[ia] > 0 ? 1 : -1;
    refN = [sg * ma[ia * 3], sg * ma[ia * 3 + 1], sg * ma[ia * 3 + 2]];
  } else {
    refM = mb; refC = cb; refE = eb; incM = ma; incC = ca; incE = ea; k = ib; flip = true;
    const tj = t[0] * C[ib] + t[1] * C[3 + ib] + t[2] * C[6 + ib];
    const sg = tj > 0 ? -1 : 1; // pointing from B toward A
    refN = [sg * mb[ib * 3], sg * mb[ib * 3 + 1], sg * mb[ib * 3 + 2]];
  }
  // incident face
  let m = 0, bd = 0;
  for (let j = 0; j < 3; j++) {
    const dj = incM[j * 3] * refN[0] + incM[j * 3 + 1] * refN[1] + incM[j * 3 + 2] * refN[2];
    if (Math.abs(dj) > Math.abs(bd)) { bd = dj; m = j; }
  }
  const sgi = bd > 0 ? -1 : 1;
  const u = (m + 1) % 3, v = (m + 2) % 3;
  const fc = [0, 0, 0];
  for (let q = 0; q < 3; q++) fc[q] = incC[q] + sgi * incE[m] * incM[m * 3 + q];
  const au = axisOf(incM, u), av = axisOf(incM, v);
  const poly = [];
  const sx = [1, -1, -1, 1], sy = [1, 1, -1, -1];
  for (let q = 0; q < 4; q++)
    poly.push([
      fc[0] + sx[q] * incE[u] * au[0] + sy[q] * incE[v] * av[0],
      fc[1] + sx[q] * incE[u] * au[1] + sy[q] * incE[v] * av[1],
      fc[2] + sx[q] * incE[u] * au[2] + sy[q] * incE[v] * av[2],
    ]);
  // clip against ref side planes
  let pts = poly;
  for (let q = 1; q <= 2 && pts.length; q++) {
    const sidx = (k + q) % 3;
    const ax = axisOf(refM, sidx);
    const off = ax[0] * refC[0] + ax[1] * refC[1] + ax[2] * refC[2];
    pts = clipPoly(pts, ax, off + refE[sidx]);
    if (!pts.length) break;
    pts = clipPoly(pts, [-ax[0], -ax[1], -ax[2]], -off + refE[sidx]);
  }
  if (!pts.length) return 0;
  const nrm = flip ? [-refN[0], -refN[1], -refN[2]] : refN;
  const planeD = refN[0] * refC[0] + refN[1] * refC[1] + refN[2] * refC[2] + refE[k];
  const cand = [];
  for (const p of pts) {
    const dist = p[0] * refN[0] + p[1] * refN[1] + p[2] * refN[2] - planeD;
    if (dist <= 0.004) cand.push({ p: [p[0] - refN[0] * dist * 0.5, p[1] - refN[1] * dist * 0.5, p[2] - refN[2] * dist * 0.5], n: nrm, d: -dist });
  }
  if (!cand.length) return 0;
  if (cand.length > 4) reduce4(cand);
  for (const c of cand) out.push(c);
  return cand.length;
}

function reduce4(c) {
  // keep deepest, farthest from it, then max area pair
  let i0 = 0;
  for (let i = 1; i < c.length; i++) if (c[i].d > c[i0].d) i0 = i;
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  let i1 = -1, bd = -1;
  for (let i = 0; i < c.length; i++) if (i !== i0) { const d = d2(c[i].p, c[i0].p); if (d > bd) { bd = d; i1 = i; } }
  const area = (a, b, cc) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = cc[0] - a[0], vy = cc[1] - a[1], vz = cc[2] - a[2];
    return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  let i2 = -1, ba = -1;
  for (let i = 0; i < c.length; i++) if (i !== i0 && i !== i1) { const a = area(c[i0].p, c[i1].p, c[i].p); if (a > ba) { ba = a; i2 = i; } }
  let i3 = -1, bn = 0;
  for (let i = 0; i < c.length; i++) if (i !== i0 && i !== i1 && i !== i2) {
    const a = Math.abs(area(c[i0].p, c[i1].p, c[i].p)) + Math.abs(area(c[i1].p, c[i2].p, c[i].p)) + Math.abs(area(c[i2].p, c[i0].p, c[i].p));
    if (a > bn) { bn = a; i3 = i; }
  }
  const keep = [c[i0], c[i1], c[i2]];
  if (i3 >= 0) keep.push(c[i3]);
  c.length = 0;
  for (const k of keep) c.push(k);
}

// ---------- world ----------
class Contact {
  constructor() {
    this.a = null; this.b = null; this.key = 0;
    this.n = [0, 0, 0]; this.p = [0, 0, 0]; this.depth = 0;
    this.ra = [0, 0, 0]; this.rb = [0, 0, 0];
    this.t1 = [0, 0, 0]; this.t2 = [0, 0, 0];
    this.mn = 0; this.mt1 = 0; this.mt2 = 0; this.bias = 0;
    this.jn = 0; this.jt1 = 0; this.jt2 = 0; this.fric = 0.5; this.vn0 = 0; this.vt0 = 0;
  }
}

export class World {
  constructor() {
    this.bodies = [];
    this.gravity = -9.81;
    this.ground = new Body({ fixed: true });
    this.groundOn = true;
    this.contacts = [];
    this.pool = [];
    this.nc = 0;
    this.cache = new Map();
    this.iters = 12;
    this.onImpact = null;
    this.onScrape = null;
    this.cell = 7;
    this.statics = [];
    this.time = 0;
  }
  add(b) {
    b.finalize();
    this.bodies.push(b);
    if (b.fixed && b.raycast) this.statics.push(b);
    return b;
  }
  remove(b) {
    b.removed = true;
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
    const j = this.statics.indexOf(b);
    if (j >= 0) this.statics.splice(j, 1);
  }

  // ray against ground plane and static OBBs. returns {t, n:[..]} or null
  raycastStatic(o, d, maxT) {
    let best = null;
    if (this.groundOn && d[1] < -1e-6) {
      const t = -o[1] / d[1];
      if (t >= 0 && t <= maxT) best = { t, n: [0, 1, 0] };
    }
    for (const b of this.statics) {
      for (const s of b.shapes) {
        const m = s.m, c = s.c, e = s.he;
        const rx = o[0] - c[0], ry = o[1] - c[1], rz = o[2] - c[2];
        let tmin = 0, tmax = best ? best.t : maxT, nIdx = -1, nSgn = 1, hit = true;
        for (let k = 0; k < 3 && hit; k++) {
          const ax = m[k * 3], ay = m[k * 3 + 1], az = m[k * 3 + 2];
          const p = rx * ax + ry * ay + rz * az;
          const dd = d[0] * ax + d[1] * ay + d[2] * az;
          if (Math.abs(dd) < 1e-9) {
            if (Math.abs(p) > e[k]) hit = false;
          } else {
            let t1 = (-e[k] - p) / dd, t2 = (e[k] - p) / dd, sg = -1;
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; sg = 1; }
            if (t1 > tmin) { tmin = t1; nIdx = k; nSgn = sg; }
            if (t2 < tmax) tmax = t2;
            if (tmin > tmax) hit = false;
          }
        }
        if (hit && nIdx >= 0 && tmin >= 0 && tmin <= maxT && (!best || tmin < best.t)) {
          best = { t: tmin, n: [nSgn * m[nIdx * 3], nSgn * m[nIdx * 3 + 1], nSgn * m[nIdx * 3 + 2]] };
        }
      }
    }
    return best;
  }

  newContact() {
    if (this.nc >= this.pool.length) this.pool.push(new Contact());
    return this.pool[this.nc++];
  }

  step(dt) {
    const bodies = this.bodies, g = this.gravity;
    this.time += dt;
    // integrate velocities
    for (const b of bodies) {
      if (b.fixed || b.sleeping) { b.im = 0; continue; }
      b.im = b.invMass;
      const im = b.invMass, ld = 1 / (1 + b.linDamp * dt), ad = 1 / (1 + b.angDamp * dt);
      b.v[0] = (b.v[0] + b.F[0] * im * dt) * ld;
      b.v[1] = (b.v[1] + (b.F[1] * im + g) * dt) * ld;
      b.v[2] = (b.v[2] + b.F[2] * im * dt) * ld;
      const I = b.iiw, tx = b.T[0], ty = b.T[1], tz = b.T[2];
      b.w[0] = (b.w[0] + (I[0] * tx + I[1] * ty + I[2] * tz) * dt) * ad;
      b.w[1] = (b.w[1] + (I[3] * tx + I[4] * ty + I[5] * tz) * dt) * ad;
      b.w[2] = (b.w[2] + (I[6] * tx + I[7] * ty + I[8] * tz) * dt) * ad;
    }
    this.collide();
    this.prepare(dt);
    for (let it = 0; it < this.iters; it++) this.iterate();
    this.finish(dt);
  }

  collide() {
    this.nc = 0;
    const cs = this.cell, bodies = this.bodies;
    const grid = new Map();
    const cellRange = (b) => {
      const A = b.aabb;
      b._cx0 = Math.floor(A[0] / cs); b._cx1 = Math.floor(A[3] / cs);
      b._cz0 = Math.floor(A[2] / cs); b._cz1 = Math.floor(A[5] / cs);
    };
    const tmp = [];
    for (const b of bodies) {
      if (b.removed) continue;
      if (!b.fixed && !b.sleeping) b.refresh();
      cellRange(b);
      const span = (b._cx1 - b._cx0 + 1) * (b._cz1 - b._cz0 + 1);
      if (span > 400) continue; // absurdly large
      for (let cx = b._cx0; cx <= b._cx1; cx++)
        for (let cz = b._cz0; cz <= b._cz1; cz++) {
          const key = cx * 8192 + cz;
          let l = grid.get(key);
          if (!l) { l = []; grid.set(key, l); }
          l.push(b);
        }
    }
    this.pairs = 0;
    for (const [key, list] of grid) {
      if (list.length < 2) continue;
      const cz = ((key % 8192) + 8192 + 4096) % 8192 - 4096;
      const cx = (key - cz) / 8192;
      for (let i = 0; i < list.length; i++) {
        const a = list[i];
        const aInactive = a.fixed || a.sleeping;
        for (let j = i + 1; j < list.length; j++) {
          const b = list[j];
          if (aInactive && (b.fixed || b.sleeping)) continue;
          if (!(a.mask & b.group) || !(b.mask & a.group)) continue;
          if (cx !== Math.max(a._cx0, b._cx0) || cz !== Math.max(a._cz0, b._cz0)) continue;
          const A = a.aabb, B = b.aabb;
          if (A[3] < B[0] || B[3] < A[0] || A[4] < B[1] || B[4] < A[1] || A[5] < B[2] || B[5] < A[2]) continue;
          this.pairs++;
          this.narrow(a, b, tmp);
        }
      }
    }
    // ground
    if (this.groundOn)
      for (const b of bodies) {
        if (b.fixed || b.sleeping || b.removed) continue;
        if (!(b.mask & GROUP.STATIC)) continue;
        if (b.aabb[1] > 0.02) continue;
        for (const s of b.shapes) {
          if (s.aabb[1] > 0.02) continue;
          const m = s.m, c = s.c, e = s.he;
          for (let sx = -1; sx <= 1; sx += 2)
            for (let sy = -1; sy <= 1; sy += 2)
              for (let sz = -1; sz <= 1; sz += 2) {
                const lx = sx * e[0], ly = sy * e[1], lz = sz * e[2];
                const y = c[1] + m[1] * lx + m[4] * ly + m[7] * lz;
                if (y < 0.003) {
                  const x = c[0] + m[0] * lx + m[3] * ly + m[6] * lz;
                  const z = c[2] + m[2] * lx + m[5] * ly + m[8] * lz;
                  const ct = this.newContact();
                  ct.a = this.ground; ct.b = b;
                  ct.n[0] = 0; ct.n[1] = 1; ct.n[2] = 0;
                  ct.p[0] = x; ct.p[1] = y * 0.5; ct.p[2] = z;
                  ct.depth = -y;
                }
              }
        }
      }
  }

  narrow(a, b, tmp) {
    // wake a sleeping body that is about to be hit by a fast one, before solving
    if (a.sleeping !== b.sleeping && !a.fixed && !b.fixed) {
      const mv = a.sleeping ? b : a, sl = a.sleeping ? a : b;
      const sp = Math.abs(mv.v[0]) + Math.abs(mv.v[1]) + Math.abs(mv.v[2]) + 0.5 * (Math.abs(mv.w[0]) + Math.abs(mv.w[1]) + Math.abs(mv.w[2]));
      if (sp > 1.2) {
        sl.wake();
        sl.im = sl.invMass;
      }
    }
    for (const sa of a.shapes) {
      for (const sb of b.shapes) {
        const A = sa.aabb, B = sb.aabb;
        if (A[3] < B[0] || B[3] < A[0] || A[4] < B[1] || B[4] < A[1] || A[5] < B[2] || B[5] < A[2]) continue;
        tmp.length = 0;
        if (!boxBox(sa, sb, tmp)) continue;
        for (const c of tmp) {
          const ct = this.newContact();
          ct.a = a; ct.b = b;
          ct.n[0] = c.n[0]; ct.n[1] = c.n[1]; ct.n[2] = c.n[2];
          ct.p[0] = c.p[0]; ct.p[1] = c.p[1]; ct.p[2] = c.p[2];
          ct.depth = c.d;
        }
      }
    }
  }

  prepare(dt) {
    const newCache = new Map();
    const events = new Map();
    this.events = events;
    const vA = [0, 0, 0], vB = [0, 0, 0];
    for (let i = 0; i < this.nc; i++) {
      const c = this.contacts[i] = this.pool[i];
      const a = c.a, b = c.b;
      if (a !== this.ground && !a.fixed && !a.sleeping) a.touching++;
      if (!b.fixed && !b.sleeping) b.touching++;
      const key = a.id * 100000 + b.id;
      c.key = key;
      const n = c.n;
      c.ra[0] = c.p[0] - a.pos[0]; c.ra[1] = c.p[1] - a.pos[1]; c.ra[2] = c.p[2] - a.pos[2];
      c.rb[0] = c.p[0] - b.pos[0]; c.rb[1] = c.p[1] - b.pos[1]; c.rb[2] = c.p[2] - b.pos[2];
      // tangents
      let tx, ty, tz;
      if (Math.abs(n[0]) < 0.6) { tx = 0; ty = n[2]; tz = -n[1]; } else { tx = -n[2]; ty = 0; tz = n[0]; }
      let l = Math.hypot(tx, ty, tz) || 1;
      tx /= l; ty /= l; tz /= l;
      c.t1[0] = tx; c.t1[1] = ty; c.t1[2] = tz;
      c.t2[0] = n[1] * tz - n[2] * ty; c.t2[1] = n[2] * tx - n[0] * tz; c.t2[2] = n[0] * ty - n[1] * tx;
      c.mn = this.effMass(a, b, c.ra, c.rb, n);
      c.mt1 = this.effMass(a, b, c.ra, c.rb, c.t1);
      c.mt2 = this.effMass(a, b, c.ra, c.rb, c.t2);
      a.velAt(c.p[0], c.p[1], c.p[2], vA);
      b.velAt(c.p[0], c.p[1], c.p[2], vB);
      const rx = vB[0] - vA[0], ry = vB[1] - vA[1], rz = vB[2] - vA[2];
      c.vn0 = rx * n[0] + ry * n[1] + rz * n[2];
      c.vt0 = Math.hypot(rx - c.vn0 * n[0], ry - c.vn0 * n[1], rz - c.vn0 * n[2]);
      c.fric = Math.sqrt(a.fric * b.fric);
      const pen = Math.max(c.depth - 0.004, 0);
      let bias = Math.min((0.22 / dt) * pen, 3.0);
      const rest = Math.max(a.rest, b.rest);
      if (c.vn0 < -1.8) bias += -rest * c.vn0;
      c.bias = bias;
      // warm start
      c.jn = c.jt1 = c.jt2 = 0;
      const prev = this.cache.get(key);
      let isNew = true;
      if (prev) {
        isNew = false;
        let bd = 0.0016, bi = null;
        for (const pc of prev) {
          const d = (pc.p[0] - c.p[0]) ** 2 + (pc.p[1] - c.p[1]) ** 2 + (pc.p[2] - c.p[2]) ** 2;
          if (d < bd) { bd = d; bi = pc; }
        }
        if (bi) { c.jn = bi.jn * 0.9; c.jt1 = bi.jt1 * 0.9; c.jt2 = bi.jt2 * 0.9; }
      }
      let arr = newCache.get(key);
      if (!arr) { arr = []; newCache.set(key, arr); }
      arr.push(c);
      // events
      if ((a.report || b.report) && c.vn0 < -1.2) {
        const ex = events.get(key);
        if (!ex || -c.vn0 > ex.speed) events.set(key, { a, b, p: [c.p[0], c.p[1], c.p[2]], n: [n[0], n[1], n[2]], speed: -c.vn0, isNew });
      }
      // apply warm impulses
      if (c.jn || c.jt1 || c.jt2) {
        const px = n[0] * c.jn + c.t1[0] * c.jt1 + c.t2[0] * c.jt2;
        const py = n[1] * c.jn + c.t1[1] * c.jt1 + c.t2[1] * c.jt2;
        const pz = n[2] * c.jn + c.t1[2] * c.jt1 + c.t2[2] * c.jt2;
        this.applyP(a, b, c.ra, c.rb, px, py, pz);
      }
    }
    // cache copies (contacts are pooled so snapshot values later in finish)
    this.newCache = newCache;
  }

  effMass(a, b, ra, rb, n) {
    let k = a.im + b.im;
    if (a.im) {
      const cx = ra[1] * n[2] - ra[2] * n[1], cy = ra[2] * n[0] - ra[0] * n[2], cz = ra[0] * n[1] - ra[1] * n[0];
      const I = a.iiw;
      const ix = I[0] * cx + I[1] * cy + I[2] * cz, iy = I[3] * cx + I[4] * cy + I[5] * cz, iz = I[6] * cx + I[7] * cy + I[8] * cz;
      k += cx * ix + cy * iy + cz * iz;
    }
    if (b.im) {
      const cx = rb[1] * n[2] - rb[2] * n[1], cy = rb[2] * n[0] - rb[0] * n[2], cz = rb[0] * n[1] - rb[1] * n[0];
      const I = b.iiw;
      const ix = I[0] * cx + I[1] * cy + I[2] * cz, iy = I[3] * cx + I[4] * cy + I[5] * cz, iz = I[6] * cx + I[7] * cy + I[8] * cz;
      k += cx * ix + cy * iy + cz * iz;
    }
    return k > 1e-12 ? 1 / k : 0;
  }

  applyP(a, b, ra, rb, px, py, pz) {
    if (a.im) {
      a.v[0] -= px * a.im; a.v[1] -= py * a.im; a.v[2] -= pz * a.im;
      const tx = ra[1] * pz - ra[2] * py, ty = ra[2] * px - ra[0] * pz, tz = ra[0] * py - ra[1] * px;
      const I = a.iiw;
      a.w[0] -= I[0] * tx + I[1] * ty + I[2] * tz;
      a.w[1] -= I[3] * tx + I[4] * ty + I[5] * tz;
      a.w[2] -= I[6] * tx + I[7] * ty + I[8] * tz;
    }
    if (b.im) {
      b.v[0] += px * b.im; b.v[1] += py * b.im; b.v[2] += pz * b.im;
      const tx = rb[1] * pz - rb[2] * py, ty = rb[2] * px - rb[0] * pz, tz = rb[0] * py - rb[1] * px;
      const I = b.iiw;
      b.w[0] += I[0] * tx + I[1] * ty + I[2] * tz;
      b.w[1] += I[3] * tx + I[4] * ty + I[5] * tz;
      b.w[2] += I[6] * tx + I[7] * ty + I[8] * tz;
    }
  }

  relV(c, t) {
    const a = c.a, b = c.b, ra = c.ra, rb = c.rb;
    const vx = b.v[0] + b.w[1] * rb[2] - b.w[2] * rb[1] - a.v[0] - a.w[1] * ra[2] + a.w[2] * ra[1];
    const vy = b.v[1] + b.w[2] * rb[0] - b.w[0] * rb[2] - a.v[1] - a.w[2] * ra[0] + a.w[0] * ra[2];
    const vz = b.v[2] + b.w[0] * rb[1] - b.w[1] * rb[0] - a.v[2] - a.w[0] * ra[1] + a.w[1] * ra[0];
    return vx * t[0] + vy * t[1] + vz * t[2];
  }

  iterate() {
    for (let i = 0; i < this.nc; i++) {
      const c = this.pool[i];
      const a = c.a, b = c.b;
      if (!a.im && !b.im) continue;
      const n = c.n;
      // friction
      const maxF = c.fric * c.jn;
      let dj = -this.relV(c, c.t1) * c.mt1;
      let nj = Math.max(-maxF, Math.min(maxF, c.jt1 + dj));
      dj = nj - c.jt1; c.jt1 = nj;
      if (dj) this.applyP(a, b, c.ra, c.rb, c.t1[0] * dj, c.t1[1] * dj, c.t1[2] * dj);
      dj = -this.relV(c, c.t2) * c.mt2;
      nj = Math.max(-maxF, Math.min(maxF, c.jt2 + dj));
      dj = nj - c.jt2; c.jt2 = nj;
      if (dj) this.applyP(a, b, c.ra, c.rb, c.t2[0] * dj, c.t2[1] * dj, c.t2[2] * dj);
      // normal
      const vn = this.relV(c, n);
      dj = -(vn - c.bias) * c.mn;
      nj = Math.max(0, c.jn + dj);
      dj = nj - c.jn; c.jn = nj;
      if (dj) this.applyP(a, b, c.ra, c.rb, n[0] * dj, n[1] * dj, n[2] * dj);
    }
  }

  finish(dt) {
    // store cache snapshot values
    const out = new Map();
    for (const [key, arr] of this.newCache) {
      out.set(key, arr.map((c) => ({ p: [c.p[0], c.p[1], c.p[2]], jn: c.jn, jt1: c.jt1, jt2: c.jt2 })));
    }
    this.cache = out;
    // wake sleeping bodies if hit hard
    for (let i = 0; i < this.nc; i++) {
      const c = this.pool[i];
      for (const body of [c.a, c.b]) {
        if (body.sleeping && !body.fixed && body.invMass * c.jn > 0.3) body.wake();
      }
      // scrape callback
      if (this.onScrape && (c.a.report || c.b.report) && c.vt0 > 2.5 && c.jn > 0) {
        this.onScrape(c.a.report ? c.a : c.b, c);
      }
    }
    // integrate positions
    for (const b of this.bodies) {
      if (b.fixed || b.sleeping) continue;
      // velocity sanity clamps (no CCD, keep things from tunnelling / blowing up)
      const vm = b.group === GROUP.CAR ? 160 : 55, wm = b.group === GROUP.CAR ? 40 : 28;
      const vl = Math.hypot(b.v[0], b.v[1], b.v[2]);
      if (vl > vm) { const k = vm / vl; b.v[0] *= k; b.v[1] *= k; b.v[2] *= k; }
      const wl = Math.hypot(b.w[0], b.w[1], b.w[2]);
      if (wl > wm) { const k = wm / wl; b.w[0] *= k; b.w[1] *= k; b.w[2] *= k; }
      b.pos[0] += b.v[0] * dt; b.pos[1] += b.v[1] * dt; b.pos[2] += b.v[2] * dt;
      const q = b.q, wx = b.w[0], wy = b.w[1], wz = b.w[2];
      const hx = 0.5 * dt;
      const nx = q[0] + hx * (wx * q[3] + wy * q[2] - wz * q[1]);
      const ny = q[1] + hx * (wy * q[3] + wz * q[0] - wx * q[2]);
      const nz = q[2] + hx * (wz * q[3] + wx * q[1] - wy * q[0]);
      const nw = q[3] + hx * (-wx * q[0] - wy * q[1] - wz * q[2]);
      const l = Math.hypot(nx, ny, nz, nw) || 1;
      q[0] = nx / l; q[1] = ny / l; q[2] = nz / l; q[3] = nw / l;
      b.F[0] = b.F[1] = b.F[2] = 0; b.T[0] = b.T[1] = b.T[2] = 0;
      if (b.canSleep) {
        const v2 = b.v[0] ** 2 + b.v[1] ** 2 + b.v[2] ** 2, w2 = wx * wx + wy * wy + wz * wz;
        if (v2 < 0.02 && w2 < 0.06 && b.touching > 0) {
          b.sleepT += dt;
          if (b.sleepT > 0.6) b.sleep();
        } else b.sleepT = 0;
      }
      b.touching = 0;
    }
    if (this.onImpact && this.events.size) for (const e of this.events.values()) this.onImpact(e);
  }
}
