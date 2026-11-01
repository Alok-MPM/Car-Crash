// WebGL2 renderer: camera-relative rendering (huge worlds without jitter), shadow map, sky, uber shader,
// dynamic meshes (damage), billboards, decals.
import { m4 } from './math.js';
import * as S from './shaders.js';

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    const lines = src.split('\n').map((l, i) => `${i + 1}: ${l}`).join('\n');
    throw new Error('Shader compile failed: ' + log + '\n' + lines.slice(0, 6000));
  }
  return sh;
}
function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program link failed: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace(/\[0\]$/, '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export const TOD = {
  day: { sun: [0.45, 0.78, 0.35], sunCol: [1.0, 0.93, 0.8], top: [0.18, 0.38, 0.78], hor: [0.62, 0.76, 0.92], skyI: 1.0, fog: [0.68, 0.78, 0.9], fogD: 0.00055, ground: [0.22, 0.22, 0.23], night: 0, cloud: 0.4, sunI: 2.9 },
  golden: { sun: [-0.7, 0.28, 0.5], sunCol: [1.0, 0.68, 0.38], top: [0.2, 0.3, 0.6], hor: [0.95, 0.62, 0.42], skyI: 0.85, fog: [0.85, 0.6, 0.45], fogD: 0.0006, ground: [0.2, 0.17, 0.15], night: 0, cloud: 0.5, sunI: 2.6 },
  overcast: { sun: [0.3, 0.6, 0.2], sunCol: [0.55, 0.57, 0.6], top: [0.46, 0.5, 0.55], hor: [0.66, 0.69, 0.72], skyI: 0.95, fog: [0.62, 0.65, 0.68], fogD: 0.0009, ground: [0.2, 0.2, 0.21], night: 0, cloud: 1.0, sunI: 0.9 },
  night: { sun: [-0.4, 0.5, -0.6], sunCol: [0.35, 0.42, 0.7], top: [0.015, 0.025, 0.07], hor: [0.05, 0.07, 0.13], skyI: 0.9, fog: [0.03, 0.04, 0.08], fogD: 0.0009, ground: [0.04, 0.04, 0.05], night: 1, cloud: 0.2, sunI: 0.45 },
};

export class Renderer {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { antialias: opts.antialias !== false, alpha: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: !!opts.preserve });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl; this.canvas = canvas;
    this.quality = opts.quality ?? 2;
    this.dprScale = 1;
    this.progs = {
      main: program(gl, S.VS_MAIN, S.FS_MAIN),
      shadow: program(gl, S.VS_SHADOW, S.FS_SHADOW),
      sky: program(gl, S.VS_SKY, S.FS_SKY),
      part: program(gl, S.VS_PART, S.FS_PART),
      decal: program(gl, S.VS_DECAL, S.FS_DECAL),
    };
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.emptyVAO = gl.createVertexArray();
    this.setShadowSize(this.quality >= 2 ? 2048 : this.quality === 1 ? 1024 : 0);
    this.view = m4.create(); this.proj = m4.create(); this.vp = m4.create(); this.invVP = m4.create();
    this.lightVP = m4.create();
    this.eye = [0, 2, 0];
    this.items = [];
    this.lights = [];
    this.time = 0;
    this.setTOD('day');
    this.shadowRadius = 55;
    this.whiteTex = this.makeTex(1, 1, new Uint8Array([255, 255, 255, 255]));
    {
      const gl2 = this.gl;
      this.dummyShadow = gl2.createTexture();
      gl2.bindTexture(gl2.TEXTURE_2D, this.dummyShadow);
      gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.DEPTH_COMPONENT24, 1, 1, 0, gl2.DEPTH_COMPONENT, gl2.UNSIGNED_INT, new Uint32Array([0xffffffff]));
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MIN_FILTER, gl2.NEAREST);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_MAG_FILTER, gl2.NEAREST);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_COMPARE_MODE, gl2.COMPARE_REF_TO_TEXTURE);
      gl2.texParameteri(gl2.TEXTURE_2D, gl2.TEXTURE_COMPARE_FUNC, gl2.LEQUAL);
    }
    this.dyn = { part: this.makeDyn(11), decal: this.makeDyn(9) };
    this.stats = { draws: 0, tris: 0 };
    this.resize();
  }

  setShadowSize(n) {
    const gl = this.gl;
    if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFB); }
    this.shadowSize = n;
    if (!n) { this.shadowTex = null; return; }
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, n, n, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFB = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(w, h, dpr) {
    const c = this.canvas;
    const d = (dpr ?? Math.min(window.devicePixelRatio || 1, 2)) * this.dprScale;
    const cw = w ?? c.clientWidth ?? 800, ch = h ?? c.clientHeight ?? 600;
    c.width = Math.max(2, Math.floor(cw * d)); c.height = Math.max(2, Math.floor(ch * d));
    this.w = c.width; this.h = c.height;
  }

  setTOD(name) {
    const t = TOD[name] || TOD.day;
    this.tod = t; this.todName = name;
    const s = t.sun, l = Math.hypot(s[0], s[1], s[2]);
    this.sunDir = [s[0] / l, s[1] / l, s[2] / l];
    this.night = t.night;
  }

  makeTex(w, h, data, opt = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    this._texParams(opt);
    return t;
  }
  texFromCanvas(cv, opt = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    this._texParams(opt);
    return t;
  }
  _texParams(opt) {
    const gl = this.gl;
    const mip = opt.mip !== false && opt.w !== 1;
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const wrap = opt.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    if (this.aniso && mip) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }

  // ---- meshes ----
  // geo: {pos, nrm, col, uv, idx}; groups: [{start,count,mat}]
  createMesh(geo, o = {}) {
    const gl = this.gl;
    const m = { n: geo.idx.length, groups: o.groups || [{ start: 0, count: geo.idx.length, mat: o.mat }], dynamic: !!o.dynamic, bufs: {} };
    m.vao = gl.createVertexArray();
    gl.bindVertexArray(m.vao);
    const usage = o.dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW;
    const attr = (loc, arr, size, name) => {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, arr, usage);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
      m.bufs[name] = b;
    };
    attr(0, geo.pos, 3, 'pos'); attr(1, geo.nrm, 3, 'nrm'); attr(2, geo.col, 3, 'col'); attr(3, geo.uv, 2, 'uv');
    m.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    m.radius = o.radius || 0;
    return m;
  }
  updateMesh(m, geo, which = 'pnc') {
    const gl = this.gl;
    if (which.includes('p')) { gl.bindBuffer(gl.ARRAY_BUFFER, m.bufs.pos); gl.bufferSubData(gl.ARRAY_BUFFER, 0, geo.pos); }
    if (which.includes('n')) { gl.bindBuffer(gl.ARRAY_BUFFER, m.bufs.nrm); gl.bufferSubData(gl.ARRAY_BUFFER, 0, geo.nrm); }
    if (which.includes('c')) { gl.bindBuffer(gl.ARRAY_BUFFER, m.bufs.col); gl.bufferSubData(gl.ARRAY_BUFFER, 0, geo.col); }
  }
  // replace the index buffer (e.g. after a part is torn off)
  updateIndices(m, idx) {
    const gl = this.gl;
    gl.bindVertexArray(m.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
  }
  deleteMesh(m) {
    const gl = this.gl;
    for (const k in m.bufs) gl.deleteBuffer(m.bufs[k]);
    gl.deleteBuffer(m.ibo); gl.deleteVertexArray(m.vao);
  }

  // ---- dynamic vertex streams for particles / decals ----
  makeDyn(stride) {
    const gl = this.gl;
    const d = { stride, cap: 0, buf: gl.createBuffer(), vao: gl.createVertexArray(), data: null, n: 0 };
    return d;
  }

  // ---- frame ----
  // cam: {eye:[x,y,z], target:[x,y,z], fov, near, far, up}
  begin(cam) {
    this.cam = cam;
    this.eye = cam.eye;
    const aspect = this.w / this.h;
    m4.perspective(this.proj, cam.fov * Math.PI / 180, aspect, cam.near || 0.2, cam.far || 9000);
    // rotation-only view: eye at origin, look along (target - eye)
    const f = [cam.target[0] - cam.eye[0], cam.target[1] - cam.eye[1], cam.target[2] - cam.eye[2]];
    m4.lookAt(this.view, [0, 0, 0], f, cam.up || [0, 1, 0]);
    if (cam.roll) {
      const c = Math.cos(cam.roll), s = Math.sin(cam.roll);
      const r = m4.create(); r[0] = c; r[1] = s; r[4] = -s; r[5] = c;
      m4.mul(this.view, r, this.view);
    }
    m4.mul(this.vp, this.proj, this.view);
    m4.invert(this.invVP, this.vp);
    this.items.length = 0;
    this.lights.length = 0;
    this.eyeMod = [((cam.eye[0] % 512) + 512) % 512, ((cam.eye[1] % 512) + 512) % 512, ((cam.eye[2] % 512) + 512) % 512];
  }
  // model: Float32Array(16) in WORLD space (not camera relative); opts: {cast:true}
  add(mesh, model, opts) { this.items.push({ mesh, model: Float32Array.from(model), cast: !opts || opts.cast !== false, over: opts && opts.over, only: opts && opts.only, hide: opts && opts.hide }); }
  addLight(x, y, z, radius, r, g, b, dx = 0, dy = 0, dz = 0, cone = -2) {
    if (this.lights.length < 4) this.lights.push({ p: [x, y, z], r: radius, c: [r, g, b], d: [dx, dy, dz], cone });
  }

  _setEnv(p) {
    const gl = this.gl, u = p.u, t = this.tod;
    gl.uniform3fv(u.uSunDir, this.sunDir);
    gl.uniform3f(u.uSunCol, t.sunCol[0] * t.sunI, t.sunCol[1] * t.sunI, t.sunCol[2] * t.sunI);
    gl.uniform3fv(u.uSkyTop, t.top); gl.uniform3fv(u.uSkyHor, t.hor);
    gl.uniform3fv(u.uGroundCol, t.ground); gl.uniform3fv(u.uFogCol, t.fog);
    gl.uniform1f(u.uSkyI, t.skyI); gl.uniform1f(u.uFogD, t.fogD); gl.uniform1f(u.uNight, t.night);
    gl.uniform1f(u.uTime, this.time);
  }

  _relModel(model, out) {
    out.set(model);
    out[12] = model[12] - this.eye[0]; out[13] = model[13] - this.eye[1]; out[14] = model[14] - this.eye[2];
    return out;
  }

  render() {
    const gl = this.gl;
    this.stats.draws = 0; this.stats.tris = 0;
    const rel = (this._rel = this._rel || new Float32Array(16));
    // ---------- shadow pass
    if (this.shadowTex) {
      const R = this.shadowRadius;
      const tgt = this.cam.shadowCenter || this.cam.target;
      const c = [tgt[0] - this.eye[0], tgt[1] - this.eye[1], tgt[2] - this.eye[2]];
      const sd = this.sunDir;
      const lv = m4.create(), lp = m4.create();
      const up = Math.abs(sd[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
      // snap the centre to texel size to stop shimmering
      const texel = (2 * R) / this.shadowSize;
      const eyeL = [c[0] + sd[0] * 300, c[1] + sd[1] * 300, c[2] + sd[2] * 300];
      m4.lookAt(lv, eyeL, c, up);
      const cl = m4.xform(lv, c);
      const sx = Math.round(cl[0] / texel) * texel - cl[0], sy = Math.round(cl[1] / texel) * texel - cl[1];
      m4.ortho(lp, -R + sx, R + sx, -R + sy, R + sy, 20, 650);
      m4.mul(this.lightVP, lp, lv);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.colorMask(false, false, false, false);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.5, 4);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
      const P = this.progs.shadow;
      gl.useProgram(P.p);
      gl.uniformMatrix4fv(P.u.uLightVP, false, this.lightVP);
      const lim = R * 1.6;
      for (const it of this.items) {
        if (!it.cast) continue;
        const m = it.model;
        if (Math.abs(m[12] - tgt[0]) > lim + (it.mesh.radius || 0) || Math.abs(m[14] - tgt[2]) > lim + (it.mesh.radius || 0)) continue;
        this._relModel(m, rel);
        gl.uniformMatrix4fv(P.u.uModel, false, rel);
        gl.bindVertexArray(it.mesh.vao);
        for (const g of it.mesh.groups) {
          if (g.mat && (g.mat.kind === 2 || g.mat.noShadow || g.hidden)) continue;
          if (it.only !== undefined && g.part !== it.only) continue;
          if (it.hide && it.hide[g.part]) continue;
          gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.start * 4);
        }
      }
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.cullFace(gl.BACK);
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // ---------- main pass
    gl.viewport(0, 0, this.w, this.h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    // sky
    {
      const P = this.progs.sky;
      gl.useProgram(P.p);
      this._setEnv(P);
      gl.uniformMatrix4fv(P.u.uInvVP, false, this.invVP);
      gl.uniform1f(P.u.uCloud, this.tod.cloud);
      gl.disable(gl.CULL_FACE);
      gl.bindVertexArray(this.emptyVAO);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.CULL_FACE);
    }
    const P = this.progs.main, u = P.u;
    gl.useProgram(P.p);
    this._setEnv(P);
    gl.uniformMatrix4fv(u.uVP, false, this.vp);
    gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
    gl.uniform3fv(u.uEyeMod, this.eyeMod);
    gl.uniform1f(u.uNBias, this.shadowTex ? (2 * this.shadowRadius / this.shadowSize) * 1.6 : 0);
    gl.uniform1f(u.uShadowTexel, this.shadowTex ? 1 / this.shadowSize : 0);
    gl.uniform1f(u.uShadowOn, this.shadowTex ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0 + 1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex || this.dummyShadow);
    gl.uniform1i(u.uShadowMap, 1);
    gl.uniform1i(u.uTex, 0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.whiteTex); gl.activeTexture(gl.TEXTURE0 + 1);
    // lights
    const nl = this.lights.length;
    const lp = new Float32Array(16), ld = new Float32Array(16), lc = new Float32Array(16);
    for (let i = 0; i < nl; i++) {
      const L = this.lights[i];
      lp.set([L.p[0] - this.eye[0], L.p[1] - this.eye[1], L.p[2] - this.eye[2], L.r], i * 4);
      ld.set([L.d[0], L.d[1], L.d[2], L.cone], i * 4);
      lc.set([L.c[0], L.c[1], L.c[2], 1], i * 4);
    }
    gl.uniform4fv(u.uLP, lp); gl.uniform4fv(u.uLD, ld); gl.uniform4fv(u.uLC, lc);
    gl.uniform1i(u.uNL, nl);
    gl.uniform1f(u.uDbg, this.dbg || 0);
    gl.activeTexture(gl.TEXTURE0);

    const trans = [];
    const camPos = this.eye;
    for (const it of this.items) {
      this._relModel(it.model, rel);
      gl.uniformMatrix4fv(u.uModel, false, rel);
      gl.bindVertexArray(it.mesh.vao);
      for (let gi = 0; gi < it.mesh.groups.length; gi++) {
        const g = it.mesh.groups[gi];
        if (g.hidden || g.count === 0) continue;
        if (it.only !== undefined && g.part !== it.only) continue;
        if (it.hide && it.hide[g.part]) continue;
        const mat = (it.over && it.over[gi]) || g.mat;
        if (mat.kind === 2 || (mat.alpha !== undefined && mat.alpha < 1 && mat.kind !== 2)) {
          trans.push({ it, g, mat, d: Math.hypot(it.model[12] - camPos[0], it.model[13] - camPos[1], it.model[14] - camPos[2]) });
          continue;
        }
        this._setMat(u, mat);
        gl.drawElements(gl.TRIANGLES, g.count, gl.UNSIGNED_INT, g.start * 4);
        this.stats.draws++; this.stats.tris += g.count / 3;
      }
    }
    // decals (skid marks, contact blobs)
    this._drawDecals();
    // transparent
    if (trans.length) {
      trans.sort((a, b) => b.d - a.d);
      gl.useProgram(P.p);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const t of trans) {
        this._relModel(t.it.model, rel);
        gl.uniformMatrix4fv(u.uModel, false, rel);
        gl.bindVertexArray(t.it.mesh.vao);
        this._setMat(u, t.mat);
        gl.drawElements(gl.TRIANGLES, t.g.count, gl.UNSIGNED_INT, t.g.start * 4);
        this.stats.draws++;
      }
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    // particles
    this._drawParticles();
    gl.bindVertexArray(null);
  }

  _setMat(u, m) {
    const gl = this.gl;
    gl.uniform1i(u.uKind, m.kind | 0);
    const b = m.base || [1, 1, 1];
    gl.uniform3f(u.uBase, b[0], b[1], b[2]);
    const e = m.emis || [0, 0, 0];
    gl.uniform3f(u.uEmis, e[0], e[1], e[2]);
    gl.uniform1f(u.uMetal, m.metal || 0);
    gl.uniform1f(u.uRough, m.rough ?? 0.5);
    gl.uniform1f(u.uCoat, m.coat || 0);
    gl.uniform1f(u.uAlpha, m.alpha ?? 1);
    gl.uniform1f(u.uFlake, m.flake || 0);
    gl.uniform1f(u.uTexScale, m.texScale || 1);
    if (m.tex) { gl.uniform1f(u.uTexOn, 1); gl.bindTexture(gl.TEXTURE_2D, m.tex); } else gl.uniform1f(u.uTexOn, 0);
    if (m.doubleSided) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE);
    if (m.poly) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -6); } else gl.disable(gl.POLYGON_OFFSET_FILL);
  }

  // ---- streams ----
  _ensureDyn(d, n) {
    const gl = this.gl;
    if (n > d.cap) {
      d.cap = Math.max(n, d.cap * 2, 1024);
      d.data = new Float32Array(d.cap * d.stride);
      gl.bindBuffer(gl.ARRAY_BUFFER, d.buf);
      gl.bufferData(gl.ARRAY_BUFFER, d.data.byteLength, gl.DYNAMIC_DRAW);
      d.vaoSet = false;
    }
  }
  _bindDynVAO(d, layout) {
    const gl = this.gl;
    gl.bindVertexArray(d.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, d.buf);
    if (!d.vaoSet) {
      const stride = d.stride * 4;
      let off = 0;
      layout.forEach((sz, loc) => {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, sz, gl.FLOAT, false, stride, off * 4);
        off += sz;
      });
      d.vaoSet = true;
    }
  }

  // particles: arrays supplied via this.particles = [{p:[x,y,z], size, col:[r,g,b,a], mode, seed, vel (for sparks), rot}]
  _drawParticles() {
    const list = this.particleList;
    if (!list || !list.length) return;
    const gl = this.gl;
    const P = this.progs.part;
    const d = this.dyn.part;
    // right / up in camera space (rotation only view)
    const v = this.view;
    const rx = [v[0], v[4], v[8]], ry = [v[1], v[5], v[9]];
    const groups = [[], [], [], []];
    for (const p of list) groups[p.mode || 0].push(p);
    gl.useProgram(P.p);
    this._setEnv(P);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp);
    gl.enable(gl.BLEND); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (let mode = 0; mode < 4; mode++) {
      const g = groups[mode];
      if (!g.length) continue;
      if (mode === 0) g.sort((a, b) => b.dist - a.dist);
      this._ensureDyn(d, g.length * 6);
      let o = 0;
      const data = d.data;
      for (const p of g) {
        const px = p.p[0] - this.eye[0], py = p.p[1] - this.eye[1], pz = p.p[2] - this.eye[2];
        let ax, ay, az, bx, by, bz;
        const s = p.size;
        if (mode === 2 && p.vel) {
          // streak along velocity (screen aligned width)
          const vx = p.vel[0], vy = p.vel[1], vz = p.vel[2];
          const vl = Math.hypot(vx, vy, vz) || 1;
          const len = Math.min(0.5 + vl * 0.03, 2.2) * s;
          ax = (vx / vl) * len; ay = (vy / vl) * len; az = (vz / vl) * len;
          // perpendicular in view: cross(view dir, vel)
          const dx = px, dy = py, dz = pz, dl = Math.hypot(dx, dy, dz) || 1;
          let cx = (dy / dl) * az - (dz / dl) * ay, cy = (dz / dl) * ax - (dx / dl) * az, cz = (dx / dl) * ay - (dy / dl) * ax;
          const cl = Math.hypot(cx, cy, cz) || 1;
          bx = (cx / cl) * s * 0.35; by = (cy / cl) * s * 0.35; bz = (cz / cl) * s * 0.35;
        } else {
          const rot = p.rot || 0, c = Math.cos(rot) * s, sn = Math.sin(rot) * s;
          ax = rx[0] * c + ry[0] * sn; ay = rx[1] * c + ry[1] * sn; az = rx[2] * c + ry[2] * sn;
          bx = -rx[0] * sn + ry[0] * c; by = -rx[1] * sn + ry[1] * c; bz = -rx[2] * sn + ry[2] * c;
        }
        const col = p.col, seed = p.seed || 0;
        const corners = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, -1, 0, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
        for (const [cu, cv, tu, tv] of corners) {
          data[o++] = px + ax * cu + bx * cv; data[o++] = py + ay * cu + by * cv; data[o++] = pz + az * cu + bz * cv;
          data[o++] = tu; data[o++] = tv;
          data[o++] = col[0]; data[o++] = col[1]; data[o++] = col[2];
          // layout: pos3 uv2 col4 seed2 = 11 floats -> we pack alpha & seed below
          data[o++] = col[3]; data[o++] = seed; data[o++] = seed * 0.37 + 0.11;
        }
      }
      gl.uniform1f(P.u.uMode, mode);
      this._bindPartVAO(d);
      gl.bindBuffer(gl.ARRAY_BUFFER, d.buf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, o));
      gl.drawArrays(gl.TRIANGLES, 0, o / 11);
      this.stats.draws++;
    }
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
  }
  _bindPartVAO(d) {
    d.stride = 11;
    const gl = this.gl;
    if (!d.vaoSet || d.stride !== 11) { d.vaoSet = false; }
    gl.bindVertexArray(d.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, d.buf);
    if (!d.vaoSet) {
      const s = 44;
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, s, 0);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, s, 12);
      gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, s, 20);
      gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 2, gl.FLOAT, false, s, 36);
      d.vaoSet = true;
    }
  }

  // decals: this.skidQuads Float32Array in world space (absolute), count in this.skidCount; blobs list
  _drawDecals() {
    const gl = this.gl;
    const P = this.progs.decal;
    const have = (this.skidCount > 0) || (this.blobList && this.blobList.length) || (this.poolList && this.poolList.length);
    if (!have) return;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp);
    gl.enable(gl.BLEND); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    const draw = (data, count, mode) => {
      const d = this.dyn.decal;
      d.stride = 9;
      this._ensureDyn(d, count);
      const arr = d.data;
      // convert to eye-relative while copying
      let o = 0;
      for (let i = 0; i < count; i++) {
        const s = i * 9;
        arr[o++] = data[s] - this.eye[0]; arr[o++] = data[s + 1] - this.eye[1]; arr[o++] = data[s + 2] - this.eye[2];
        arr[o++] = data[s + 3]; arr[o++] = data[s + 4];
        arr[o++] = data[s + 5]; arr[o++] = data[s + 6]; arr[o++] = data[s + 7]; arr[o++] = data[s + 8];
      }
      gl.bindVertexArray(d.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, d.buf);
      if (!d.vaoSet || d.vaoStride !== 9) {
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 36, 0);
        gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 36, 12);
        gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 36, 20);
        gl.disableVertexAttribArray(3);
        d.vaoSet = true; d.vaoStride = 9;
      }
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, arr.subarray(0, o));
      gl.uniform1f(P.u.uMode, mode);
      gl.drawArrays(gl.TRIANGLES, 0, count);
      this.stats.draws++;
    };
    if (this.skidCount > 0) draw(this.skidData, this.skidCount, 0);
    if (this.blobList && this.blobList.length) draw(this.blobData, this.blobList.length, 1);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(true); gl.disable(gl.BLEND); gl.enable(gl.CULL_FACE);
  }
}
