// Procedural geometry builders. Every builder returns {pos, nrm, col, uv, idx} as plain typed arrays.
import { m4 } from './math.js';

export function makeGeo(nv, ni) {
  return { pos: new Float32Array(nv * 3), nrm: new Float32Array(nv * 3), col: new Float32Array(nv * 3).fill(1), uv: new Float32Array(nv * 2), idx: new Uint32Array(ni) };
}

// Merge geometries (each optionally transformed by mat4).
export function merge(list) {
  let nv = 0, ni = 0;
  for (const g of list) { nv += g.geo.pos.length / 3; ni += g.geo.idx.length; }
  const out = makeGeo(nv, ni);
  let vo = 0, io = 0;
  const nm = new Float32Array(16);
  for (const { geo, m, color } of list) {
    const n = geo.pos.length / 3;
    for (let i = 0; i < n; i++) {
      const x = geo.pos[i * 3], y = geo.pos[i * 3 + 1], z = geo.pos[i * 3 + 2];
      const nx = geo.nrm[i * 3], ny = geo.nrm[i * 3 + 1], nz = geo.nrm[i * 3 + 2];
      if (m) {
        out.pos[(vo + i) * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
        out.pos[(vo + i) * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        out.pos[(vo + i) * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
        let tx = m[0] * nx + m[4] * ny + m[8] * nz, ty = m[1] * nx + m[5] * ny + m[9] * nz, tz = m[2] * nx + m[6] * ny + m[10] * nz;
        const l = Math.hypot(tx, ty, tz) || 1;
        out.nrm[(vo + i) * 3] = tx / l; out.nrm[(vo + i) * 3 + 1] = ty / l; out.nrm[(vo + i) * 3 + 2] = tz / l;
      } else {
        out.pos[(vo + i) * 3] = x; out.pos[(vo + i) * 3 + 1] = y; out.pos[(vo + i) * 3 + 2] = z;
        out.nrm[(vo + i) * 3] = nx; out.nrm[(vo + i) * 3 + 1] = ny; out.nrm[(vo + i) * 3 + 2] = nz;
      }
      const c = color || null;
      out.col[(vo + i) * 3] = geo.col[i * 3] * (c ? c[0] : 1);
      out.col[(vo + i) * 3 + 1] = geo.col[i * 3 + 1] * (c ? c[1] : 1);
      out.col[(vo + i) * 3 + 2] = geo.col[i * 3 + 2] * (c ? c[2] : 1);
      out.uv[(vo + i) * 2] = geo.uv[i * 2]; out.uv[(vo + i) * 2 + 1] = geo.uv[i * 2 + 1];
    }
    for (let i = 0; i < geo.idx.length; i++) out.idx[io + i] = geo.idx[i] + vo;
    vo += n; io += geo.idx.length;
  }
  return out;
}

export function trs(p = [0, 0, 0], q = [0, 0, 0, 1], s = 1) {
  return m4.fromTRS(new Float32Array(16), p, q, s);
}

export function box(hx, hy, hz) {
  const g = makeGeo(24, 36);
  const faces = [
    [[1, 0, 0], [0, 0, -1], [0, 1, 0]], [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]], [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  const h = [hx, hy, hz];
  let v = 0, ii = 0;
  for (const [n, u, w] of faces) {
    for (let k = 0; k < 4; k++) {
      const su = k === 0 || k === 3 ? -1 : 1, sw = k < 2 ? -1 : 1;
      for (let a = 0; a < 3; a++) g.pos[v * 3 + a] = n[a] * h[a] + u[a] * su * h[a] + w[a] * sw * h[a];
      g.nrm[v * 3] = n[0]; g.nrm[v * 3 + 1] = n[1]; g.nrm[v * 3 + 2] = n[2];
      g.uv[v * 2] = su < 0 ? 0 : 1; g.uv[v * 2 + 1] = sw < 0 ? 0 : 1;
      v++;
    }
    const b = v - 4;
    g.idx.set([b, b + 1, b + 2, b, b + 2, b + 3], ii); ii += 6;
  }
  fixWinding(g);
  return g;
}

// make sure triangles face along their stored normals
export function fixWinding(g) {
  for (let i = 0; i < g.idx.length; i += 3) {
    const a = g.idx[i], b = g.idx[i + 1], c = g.idx[i + 2];
    const ux = g.pos[b * 3] - g.pos[a * 3], uy = g.pos[b * 3 + 1] - g.pos[a * 3 + 1], uz = g.pos[b * 3 + 2] - g.pos[a * 3 + 2];
    const vx = g.pos[c * 3] - g.pos[a * 3], vy = g.pos[c * 3 + 1] - g.pos[a * 3 + 1], vz = g.pos[c * 3 + 2] - g.pos[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const d = nx * g.nrm[a * 3] + ny * g.nrm[a * 3 + 1] + nz * g.nrm[a * 3 + 2];
    if (d < 0) { g.idx[i + 1] = c; g.idx[i + 2] = b; }
  }
}

// rounded box: clamp trick; k = bevel subdivisions
export function rbox(hx, hy, hz, r, k = 3) {
  r = Math.min(r, hx, hy, hz);
  const h = [hx, hy, hz], inner = [hx - r, hy - r, hz - r];
  const coords = (a) => {
    const c = [];
    for (let j = 0; j < k; j++) c.push(-h[a] + (r * j) / k);
    c.push(-inner[a], inner[a]);
    for (let j = 1; j <= k; j++) c.push(inner[a] + (r * j) / k);
    return c;
  };
  const cs = [coords(0), coords(1), coords(2)];
  const verts = [], idx = [];
  const norm = [], uvs = [];
  const faces = [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]];
  for (const [ax, sg] of faces) {
    const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3;
    const A = cs[a1], B = cs[a2];
    const base = verts.length / 3;
    for (let j = 0; j < B.length; j++)
      for (let i = 0; i < A.length; i++) {
        const p = [0, 0, 0];
        p[ax] = sg * h[ax]; p[a1] = A[i]; p[a2] = B[j];
        const c = [Math.max(-inner[0], Math.min(inner[0], p[0])), Math.max(-inner[1], Math.min(inner[1], p[1])), Math.max(-inner[2], Math.min(inner[2], p[2]))];
        const d = [p[0] - c[0], p[1] - c[1], p[2] - c[2]];
        const l = Math.hypot(d[0], d[1], d[2]) || 1;
        verts.push(c[0] + (d[0] / l) * r, c[1] + (d[1] / l) * r, c[2] + (d[2] / l) * r);
        norm.push(d[0] / l, d[1] / l, d[2] / l);
        uvs.push(i / (A.length - 1), j / (B.length - 1));
      }
    for (let j = 0; j < B.length - 1; j++)
      for (let i = 0; i < A.length - 1; i++) {
        const a = base + j * A.length + i, b = a + 1, c = a + A.length, d = c + 1;
        idx.push(a, b, d, a, d, c);
      }
  }
  const g = { pos: new Float32Array(verts), nrm: new Float32Array(norm), col: new Float32Array(verts.length).fill(1), uv: new Float32Array(uvs), idx: new Uint32Array(idx) };
  fixWinding(g);
  return g;
}

export function cylinder(rt, rb, h, seg = 24, capT = true, capB = true) {
  const verts = [], norm = [], uvs = [], idx = [];
  const slope = (rb - rt) / h;
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    const nl = Math.hypot(1, slope);
    verts.push(c * rt, h / 2, s * rt, c * rb, -h / 2, s * rb);
    norm.push(c / nl, slope / nl, s / nl, c / nl, slope / nl, s / nl);
    uvs.push(i / seg, 1, i / seg, 0);
  }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const cap = (y, r, ny) => {
    const base = verts.length / 3;
    verts.push(0, y, 0); norm.push(0, ny, 0); uvs.push(0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      verts.push(Math.cos(a) * r, y, Math.sin(a) * r); norm.push(0, ny, 0); uvs.push(0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5);
    }
    for (let i = 0; i < seg; i++) idx.push(base, base + 1 + i, base + 2 + i);
  };
  if (capT) cap(h / 2, rt, 1);
  if (capB) cap(-h / 2, rb, -1);
  const g = { pos: new Float32Array(verts), nrm: new Float32Array(norm), col: new Float32Array(verts.length).fill(1), uv: new Float32Array(uvs), idx: new Uint32Array(idx) };
  fixWinding(g);
  return g;
}

// profile: [[r,y],...] revolve around Y, smooth normals from profile
export function lathe(profile, seg = 32) {
  const n = profile.length;
  const verts = [], norm = [], uvs = [], idx = [];
  const pn = [];
  for (let i = 0; i < n; i++) {
    const a = profile[Math.max(0, i - 1)], b = profile[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    pn.push([ty / l, -tx / l]);
  }
  for (let j = 0; j <= seg; j++) {
    const a = (j / seg) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (let i = 0; i < n; i++) {
      verts.push(profile[i][0] * c, profile[i][1], profile[i][0] * s);
      norm.push(pn[i][0] * c, pn[i][1], pn[i][0] * s);
      uvs.push(j / seg, i / (n - 1));
    }
  }
  for (let j = 0; j < seg; j++)
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + n, c = a + 1, d = b + 1;
      idx.push(a, b, d, a, d, c);
    }
  const g = { pos: new Float32Array(verts), nrm: new Float32Array(norm), col: new Float32Array(verts.length).fill(1), uv: new Float32Array(uvs), idx: new Uint32Array(idx) };
  fixWinding(g);
  return g;
}

export function torus(R, r, segM = 32, segm = 12) {
  const verts = [], norm = [], uvs = [], idx = [];
  for (let i = 0; i <= segM; i++) {
    const a = (i / segM) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j <= segm; j++) {
      const b = (j / segm) * Math.PI * 2, cb = Math.cos(b), sb = Math.sin(b);
      verts.push((R + r * cb) * ca, r * sb, (R + r * cb) * sa);
      norm.push(cb * ca, sb, cb * sa);
      uvs.push(i / segM, j / segm);
    }
  }
  for (let i = 0; i < segM; i++)
    for (let j = 0; j < segm; j++) {
      const a = i * (segm + 1) + j, b = a + segm + 1;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  const g = { pos: new Float32Array(verts), nrm: new Float32Array(norm), col: new Float32Array(verts.length).fill(1), uv: new Float32Array(uvs), idx: new Uint32Array(idx) };
  fixWinding(g);
  return g;
}

export function sphere(r, seg = 16) {
  const prof = [];
  for (let i = 0; i <= seg; i++) {
    const a = -Math.PI / 2 + (i / seg) * Math.PI;
    prof.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  prof[0][0] = prof[prof.length - 1][0] = 0.0001;
  return lathe(prof, seg * 2);
}

export function plane(sx, sz, uvx = 1, uvz = 1, nsx = 1, nsz = 1) {
  const verts = [], norm = [], uvs = [], idx = [];
  for (let j = 0; j <= nsz; j++)
    for (let i = 0; i <= nsx; i++) {
      verts.push((i / nsx - 0.5) * sx, 0, (j / nsz - 0.5) * sz);
      norm.push(0, 1, 0);
      uvs.push((i / nsx) * uvx, (j / nsz) * uvz);
    }
  for (let j = 0; j < nsz; j++)
    for (let i = 0; i < nsx; i++) {
      const a = j * (nsx + 1) + i, b = a + 1, c = a + nsx + 1, d = c + 1;
      idx.push(a, c, d, a, d, b);
    }
  const g = { pos: new Float32Array(verts), nrm: new Float32Array(norm), col: new Float32Array(verts.length).fill(1), uv: new Float32Array(uvs), idx: new Uint32Array(idx) };
  return g;
}

// extrude a convex polygon [[x,y],...] (in XY plane, CCW) along Z by depth (centered)
export function extrude(poly, depth) {
  const n = poly.length;
  const verts = [], norm = [], uvs = [], idx = [];
  const hz = depth / 2;
  // caps
  for (const [z, nz] of [[hz, 1], [-hz, -1]]) {
    const base = verts.length / 3;
    for (const p of poly) { verts.push(p[0], p[1], z); norm.push(0, 0, nz); uvs.push(p[0], p[1]); }
    for (let i = 1; i < n - 1; i++) idx.push(base, base + i, base + i + 1);
  }
  // sides
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    let ex = b[0] - a[0], ey = b[1] - a[1];
    const l = Math.hypot(ex, ey) || 1;
    const nx = ey / l, ny = -ex / l;
    const base = verts.length / 3;
    verts.push(a[0], a[1], hz, b[0], b[1], hz, b[0], b[1], -hz, a[0], a[1], -hz);
    for (let k = 0; k < 4; k++) norm.push(nx, ny, 0);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const g = { pos: new Float32Array(verts), nrm: new Float32Array(norm), col: new Float32Array(verts.length).fill(1), uv: new Float32Array(uvs), idx: new Uint32Array(idx) };
  fixWinding(g);
  return g;
}

export function computeNormals(pos, idx, nrm) {
  nrm.fill(0);
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    nrm[a] += nx; nrm[a + 1] += ny; nrm[a + 2] += nz;
    nrm[b] += nx; nrm[b + 1] += ny; nrm[b + 2] += nz;
    nrm[c] += nx; nrm[c + 1] += ny; nrm[c + 2] += nz;
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
  }
}
