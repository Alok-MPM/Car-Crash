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

const ONE3 = [1, 1, 1], ZERO3 = [0, 0, 0];
export class Renderer {
  constructor(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: !!opts.preserve });
    if (!gl) throw new Error('WebGL2 not available');
    this.gl = gl; this.canvas = canvas;
    this.quality = opts.quality ?? 2;
    this.dprScale = opts.scale ?? 1;       // scene resolution relative to the screen's native pixels (the governor moves it; the canvas itself never changes size because of it)
    this.outScale = opts.outScale ?? 1;   // canvas resolution relative to native pixels
    this.fxaa = opts.fxaa !== false; this.sharpen = 0.35;
    this.taa = opts.taa !== false;         // temporal AA + upscale (used while `fxaa` is on); false falls back to the plain FXAA resolve
    this.frameNo = 0; this.jit = [0, 0]; this.histOk = false;
    this.progs = {
      main: program(gl, S.VS_MAIN, S.FS_MAIN),
      shadow: program(gl, S.VS_SHADOW, S.FS_SHADOW),
      shadowA: program(gl, S.VS_SHADOW_A, S.FS_SHADOW_A),
      sky: program(gl, S.VS_SKY, S.FS_SKY),
      part: program(gl, S.VS_PART, S.FS_PART),
      decal: program(gl, S.VS_DECAL, S.FS_DECAL),
      grass: program(gl, S.VS_GRASS, S.FS_GRASS),
      post: program(gl, S.VS_POST, S.FS_POST),
      taa: program(gl, S.VS_POST, S.FS_TAA),
      present: program(gl, S.VS_POST, S.FS_PRESENT),
    };
    this.grassMesh = this._makeGrassMesh(8); this.grassMeshFar = this._makeGrassMesh(5); this.grassMeshTri = this._makeGrassMesh(8, true);
    this.grassCfg = null;
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.emptyVAO = gl.createVertexArray();
    this.setShadowSize(this.quality >= 2 ? 2048 : this.quality === 1 ? 1024 : 0);
    this.view = m4.create(); this.proj = m4.create(); this.vp = m4.create(); this.invVP = m4.create();
    this.projU = m4.create(); this.vpU = m4.create(); this.invVPU = m4.create(); this.prevVPU = m4.create(); this.prevEye = [0, 0, 0]; this.reproj = m4.create(); this._T = m4.create(); this._tmp = m4.create();
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

  // The canvas has a fixed size (client size x native pixel ratio x outScale); the scene is drawn into an offscreen texture of canvas x dprScale and resolved to the canvas
  // with FXAA. A new governor scale therefore only changes a viewport: no canvas reallocation, no flicker, no hitch.
  resize(w, h, dpr) {
    const c = this.canvas, gl = this.gl;
    const nat = (dpr ?? Math.min(window.devicePixelRatio || 1, 2));
    const cw = w ?? c.clientWidth ?? 800, ch = h ?? c.clientHeight ?? 600;
    const o = Math.min(1, this.outScale);
    const ow = Math.max(2, Math.floor(cw * nat * o)), oh = Math.max(2, Math.floor(ch * nat * o));
    if (c.width !== ow) c.width = ow;
    if (c.height !== oh) c.height = oh;
    this.outW = ow; this.outH = oh;
    const sw = Math.max(2, Math.floor(cw * nat * this.dprScale)), sh = Math.max(2, Math.floor(ch * nat * this.dprScale));
    // grow-only allocation: scaling down just uses a corner of it
    if (!this.sceneTex || sw > this.allocW || sh > this.allocH) {
      const aw = Math.max(sw, this.allocW || 0), ah = Math.max(sh, this.allocH || 0);
      if (this.sceneTex) { gl.deleteTexture(this.sceneTex); gl.deleteTexture(this.sceneDepth); gl.deleteFramebuffer(this.sceneFB); }
      this.sceneTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, aw, ah, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // depth is a texture too: the TAA resolve reads it to find where every surface was in the previous frame
      this.sceneDepth = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.sceneDepth);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, aw, ah);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.sceneFB = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.sceneTex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.sceneDepth, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.allocW = aw; this.allocH = ah;
    }
    this.w = sw; this.h = sh;
    // TAA history: two canvas-sized textures (ping-pong)
    if (!this.hist || this.histW !== ow || this.histH !== oh) {
      if (this.hist) for (const h of this.hist) { gl.deleteTexture(h.tex); gl.deleteFramebuffer(h.fb); }
      this.hist = [0, 1].map(() => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, ow, oh);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
        return { tex, fb };
      });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.histW = ow; this.histH = oh; this.histCur = 0; this.histOk = false;
    }
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
  // an atlas of cols x rows tiles (each S x S) as a texture ARRAY: one layer per tile, so filtering can never reach into a neighbouring tile; REPEAT wrap lets the shader tile it with no fract()
  texArrayFromCanvas(cv, cols, rows, S) {
    const gl = this.gl, n = cols * rows, g = cv.getContext('2d');
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, Math.floor(Math.log2(S)) + 1, gl.RGBA8, S, S, n);
    const all = g.getImageData(0, 0, cv.width, cv.height).data, buf = new Uint8Array(S * S * 4), rb = S * 4;   // one read-back, then each tile is copied out row by row
    for (let i = 0; i < n; i++) {
      const x0 = (i % cols) * S, y0 = ((i / cols) | 0) * S;
      for (let y = 0; y < S; y++) { const o = ((y0 + y) * cv.width + x0) * 4; buf.set(all.subarray(o, o + rb), y * rb); }
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, S, S, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    }
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
    if (this.aniso) gl.texParameterf(gl.TEXTURE_2D_ARRAY, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
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
    if (geo.tile) attr(4, geo.tile, 1, 'tile');   // atlas cell + 1 for meshes that repeat an atlas tile in the shader; absent -> attribute stays 0 = plain uv
    m.ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, geo.idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    m.radius = o.radius || 0;
    { let mx = 0; const P = geo.pos; for (let i = 0; i < P.length; i += 3) { const d = P[i] * P[i] + P[i + 1] * P[i + 1] + P[i + 2] * P[i + 2]; if (d > mx) mx = d; } m.brad = Math.sqrt(mx) + (o.dynamic ? 1.5 : 0.05); }
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
    this.projU.set(this.proj);
    // TAA: shift the whole picture by a sub-pixel amount that cycles (Halton 2,3, 8 positions); the resolve undoes the shift when it rebuilds each pixel
    const useT = this.fxaa && this.taa;
    if (useT) {
      const i = (this.frameNo++ & 7) + 1, hal = (n, b) => { let f = 1, r = 0; while (n > 0) { f /= b; r += f * (n % b); n = Math.floor(n / b); } return r; };
      this.jit[0] = hal(i, 2) - 0.5; this.jit[1] = hal(i, 3) - 0.5;
      this.proj[8] = -2 * this.jit[0] / this.w; this.proj[9] = -2 * this.jit[1] / this.h;
    } else { this.jit[0] = this.jit[1] = 0; this.histOk = false; }
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
    if (useT) { m4.mul(this.vpU, this.projU, this.view); m4.invert(this.invVPU, this.vpU); }
    this.items.length = 0;
    this.lights.length = 0;
    this.eyeMod = [((cam.eye[0] % 512) + 512) % 512, ((cam.eye[1] % 512) + 512) % 512, ((cam.eye[2] % 512) + 512) % 512];
  }
  // model: Float32Array(16) in WORLD space (not camera relative); opts: {cast:true}
  add(mesh, model, opts) { this.items.push({ mesh, model: Float32Array.from(model), cast: !opts || opts.cast !== false, over: opts && opts.over, only: opts && opts.only, hide: opts && opts.hide, dyn: !!(opts && opts.dyn) }); }
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
    this.stats.draws = 0; this.stats.tris = 0; this.stats.sdraws = 0; this._mc = null;
    const rel = (this._rel = this._rel || new Float32Array(16));
    // ---------- shadow pass
    if (this.shadowTex) {
      const R = this.shadowRadius;
      const tgt = this.cam.shadowCenter || this.cam.target;
      const c = [tgt[0] - this.eye[0], tgt[1] - this.eye[1], tgt[2] - this.eye[2]];
      const sd = this.sunDir;
      const lv = m4.create(), lp = m4.create();
      const up = Math.abs(sd[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
      // The shadow window follows the car, so its texel grid must stay glued to the WORLD or every shadow edge crawls while driving. The window is centred on `c` (so `c` itself is always at (0,0) in
      // light space: snapping that does nothing). The world origin is the fixed reference: where it falls in light space says where the grid sits, and the window is shifted by the remainder.
      const texel = (2 * R) / this.shadowSize;
      const eyeL = [c[0] + sd[0] * 300, c[1] + sd[1] * 300, c[2] + sd[2] * 300];
      m4.lookAt(lv, eyeL, c, up);
      const T = m4.xform(lv, [-this.eye[0], -this.eye[1], -this.eye[2]]);
      const sx = T[0] - Math.round(T[0] / texel) * texel, sy = T[1] - Math.round(T[1] / texel) * texel;
      m4.ortho(lp, -R + sx, R + sx, -R + sy, R + sy, 20, 650);
      m4.mul(this.lightVP, lp, lv);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFB);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.colorMask(false, false, false, false);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.5, 4);
      gl.enable(gl.CULL_FACE); gl.cullFace(gl.FRONT);
      const lim = R * 1.6;
      // pass 0: ordinary casters; pass 1: alpha-cut leaf cards (their own program, both faces, leaf-shaped holes)
      for (let pass = 0; pass < 2; pass++) {
        const cut = pass === 1, P = cut ? this.progs.shadowA : this.progs.shadow;
        gl.useProgram(P.p);
        gl.uniformMatrix4fv(P.u.uLightVP, false, this.lightVP);
        if (cut) { gl.disable(gl.CULL_FACE); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(P.u.uTex, 0); }
        for (const it of this.items) {
          if (!it.cast) continue;
          const mesh = it.mesh;
          if (cut && mesh._cut === undefined) { mesh._cut = false; for (const g of mesh.groups) if (g.mat && g.mat.cut) mesh._cut = true; }
          if (cut && !mesh._cut) continue;
          const m = it.model;
          if (Math.abs(m[12] - tgt[0]) > lim + (mesh.radius || 0) || Math.abs(m[14] - tgt[2]) > lim + (mesh.radius || 0)) continue;
          this._relModel(m, rel);
          gl.uniformMatrix4fv(P.u.uModel, false, rel);
          gl.bindVertexArray(mesh.vao);
          // the depth-only program ignores materials, so neighbouring index ranges are drawn as ONE call (cars went from 53 shadow draws to ~8)
          let rs = 0, re = 0, rt = null;
          for (const g of mesh.groups) {
            if (g.mat && (g.mat.kind === 2 || g.mat.kind === 8 || g.mat.noShadow || g.hidden)) continue;
            if (!!(g.mat && g.mat.cut) !== cut) continue;
            if (it.only !== undefined && g.part !== it.only) continue;
            if (it.hide && it.hide[g.part]) continue;
            if (g.count === 0) continue;
            const tx = cut ? g.mat.tex : null;
            if (re > rs && g.start === re && tx === rt) { re += g.count; continue; }
            if (re > rs) { gl.drawElements(gl.TRIANGLES, re - rs, gl.UNSIGNED_INT, rs * 4); this.stats.sdraws++; }
            rs = g.start; re = g.start + g.count; rt = tx;
            if (cut) gl.bindTexture(gl.TEXTURE_2D, tx);
          }
          if (re > rs) { gl.drawElements(gl.TRIANGLES, re - rs, gl.UNSIGNED_INT, rs * 4); this.stats.sdraws++; }
        }
        if (cut) gl.enable(gl.CULL_FACE);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.cullFace(gl.BACK);
      gl.colorMask(true, true, true, true);
    }
    // ---------- main pass (into the offscreen scene texture; resolved to the canvas at the end)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFB);
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
    gl.uniform1f(u.uPixA, 2 / (this.proj[5] * this.h));      // metres per pixel per metre of distance: fine detail fades by pixel size, not by distance
    // deformable soil field (tyre prints, pits, torn grass): unit 2
    gl.uniform1i(u.uSoil, 2);
    gl.uniform2f(u.uEyeXZ, this.eye[0], this.eye[2]);
    gl.uniform1i(u.uMeta, 3);
    gl.uniform1i(u.uAtlas, 4);
    gl.activeTexture(gl.TEXTURE0 + 4); gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.atlasArr || null);
    if (this.soil && this.soil.on) {
      gl.activeTexture(gl.TEXTURE0 + 2); gl.bindTexture(gl.TEXTURE_2D, this.soil.tex); gl.uniform4f(u.uSoilO, this.soil.ox, this.soil.oz, this.soil.size, 1);
      gl.activeTexture(gl.TEXTURE0 + 3); gl.bindTexture(gl.TEXTURE_2D, this.soil.meta);
      const pc = this.soil.patch; gl.uniform4f(u.uTerrC, pc.cx, pc.cz, pc.half - 0.03, 1);
    } else { gl.uniform4f(u.uSoilO, 0, 0, 1, 0); gl.uniform4f(u.uTerrC, 0, 0, 0, 0); }
    gl.activeTexture(gl.TEXTURE0);

    const trans = [];
    const camPos = this.eye;
    // frustum planes (camera-relative space, view has no translation): left, right, bottom, top, near, far
    const vp = this.vp, PL = (this._pl = this._pl || new Float32Array(24));
    for (let k = 0; k < 6; k++) {
      const row = k >> 1, sg = k & 1 ? -1 : 1, base = k === 4 ? 2 : k === 5 ? 2 : row;
      const sgn = k === 5 ? -1 : k === 4 ? 1 : sg;
      let a = vp[3] + sgn * vp[base], b2 = vp[7] + sgn * vp[4 + base], c2 = vp[11] + sgn * vp[8 + base], d2 = vp[15] + sgn * vp[12 + base];
      const l = Math.hypot(a, b2, c2) || 1; PL[k * 4] = a / l; PL[k * 4 + 1] = b2 / l; PL[k * 4 + 2] = c2 / l; PL[k * 4 + 3] = d2 / l;
    }
    this.stats.culled = 0;
    let dynB = false;   // scene alpha is the TAA "moving" mask: 1 (cleared) where the picture is static, written 0 by anything that moves
    for (const it of this.items) {
      {
        const m = it.model, cx = m[12] - camPos[0], cy = m[13] - camPos[1], cz = m[14] - camPos[2];
        const sc = Math.max(Math.hypot(m[0], m[1], m[2]), 0.0001);
        const rr = (it.mesh.brad || it.mesh.radius || 4) * sc;
        let vis = true;
        for (let k = 0; k < 6; k++) if (PL[k * 4] * cx + PL[k * 4 + 1] * cy + PL[k * 4 + 2] * cz + PL[k * 4 + 3] < -rr) { vis = false; break; }
        if (vis) { const dd = Math.hypot(cx, cy, cz) - rr; if (dd > (it.far || 140 + 110 * rr)) vis = false; }
        if (!vis) { this.stats.culled++; continue; }
      }
      if (it.dyn !== dynB) { dynB = it.dyn; if (dynB) { gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.ONE, gl.ZERO, gl.ZERO, gl.ZERO); } else gl.disable(gl.BLEND); }
      this._relModel(it.model, rel);
      gl.uniformMatrix4fv(u.uModel, false, rel);
      gl.bindVertexArray(it.mesh.vao);
      // neighbouring groups with the very same material object are one draw (parts of one material sit side by side in the index buffer)
      let rm = null, rs = 0, re = 0;
      for (let gi = 0; gi < it.mesh.groups.length; gi++) {
        const g = it.mesh.groups[gi];
        if (g.hidden || g.count === 0) continue;
        if (it.only !== undefined && g.part !== it.only) continue;
        if (it.hide && it.hide[g.part]) continue;
        const mat = (it.over && it.over[gi]) || g.mat;
        if (mat.kind === 2 || mat.kind === 8 || (mat.alpha !== undefined && mat.alpha < 1 && mat.kind !== 2)) {
          trans.push({ it, g, mat, d: Math.hypot(it.model[12] - camPos[0], it.model[13] - camPos[1], it.model[14] - camPos[2]) });
          continue;
        }
        if (rm === mat && g.start === re) { re += g.count; continue; }
        if (rm) { this._setMat(u, rm); gl.drawElements(gl.TRIANGLES, re - rs, gl.UNSIGNED_INT, rs * 4); this.stats.draws++; this.stats.tris += (re - rs) / 3; }
        rm = mat; rs = g.start; re = g.start + g.count;
      }
      if (rm) { this._setMat(u, rm); gl.drawElements(gl.TRIANGLES, re - rs, gl.UNSIGNED_INT, rs * 4); this.stats.draws++; this.stats.tris += (re - rs) / 3; }
    }
    if (dynB) gl.disable(gl.BLEND);
    // real grass (instanced tufts rooted in the soil field)
    this._drawGrass();
    // decals (skid marks, contact blobs)
    this._drawDecals();
    // transparent
    if (trans.length) {
      this._mc = null;
      trans.sort((a, b) => b.d - a.d);
      gl.useProgram(P.p);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      let tDyn = null;
      for (const t of trans) {
        if (t.it.dyn !== tDyn) { tDyn = t.it.dyn; gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, tDyn ? gl.ZERO : gl.ONE); }   // glass keeps the mask of what it is on
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
    this._resolve();
  }

  // scene texture -> canvas. With TAA: rebuild every pixel from the jittered low-res samples + the reprojected history, then present with a light sharpen.
  // Without: FXAA on edges, light sharpen elsewhere.
  _resolve() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.BLEND); gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.depthMask(false);
    gl.bindVertexArray(this.emptyVAO);
    const up = this.outW / this.w;
    const sharp = this.sharpen * Math.min(1, Math.max(0, (up - 1) * 2.5));   // upscaling softens the picture: the lower the scene resolution compared with the canvas, the more it is sharpened back
    if (this.fxaa && this.taa && this.hist) {
      const H = this.hist, cur = this.histCur, prev = cur ^ 1;
      // previous clip <- current NDC: prevVP * translate(eye - prevEye) * inverse(current VP)   (the view has no translation, positions are eye relative)
      const T = this._T; m4.ident(T);
      T[12] = this.eye[0] - this.prevEye[0]; T[13] = this.eye[1] - this.prevEye[1]; T[14] = this.eye[2] - this.prevEye[2];
      m4.mul(this._tmp, T, this.invVPU); m4.mul(this.reproj, this.prevVPU, this._tmp);
      let k = this.histOk ? 0.9 : 0;
      if (Math.abs(T[12]) + Math.abs(T[13]) + Math.abs(T[14]) > 60) k = 0;   // teleport / camera cut
      const P = this.progs.taa, u = P.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, H[cur].fb);
      gl.viewport(0, 0, this.outW, this.outH);
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sceneTex); gl.uniform1i(u.uScene, 0);
      gl.activeTexture(gl.TEXTURE0 + 1); gl.bindTexture(gl.TEXTURE_2D, this.sceneDepth); gl.uniform1i(u.uDepth, 1);
      gl.activeTexture(gl.TEXTURE0 + 2); gl.bindTexture(gl.TEXTURE_2D, H[prev].tex); gl.uniform1i(u.uHist, 2);
      gl.uniform2f(u.uSize, this.w, this.h);
      gl.uniform2f(u.uReg, this.w / this.allocW, this.h / this.allocH);
      gl.uniform2f(u.uPx, 1 / this.allocW, 1 / this.allocH);
      gl.uniform2f(u.uJit, this.jit[0], this.jit[1]);
      gl.uniformMatrix4fv(u.uReproj, false, this.reproj);
      gl.uniform2f(u.uOutPx, 1 / this.outW, 1 / this.outH);
      gl.uniform1f(u.uHistW, k);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // the accumulated picture goes to the canvas
      const Q = this.progs.present, uq = Q.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.outW, this.outH);
      gl.useProgram(Q.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, H[cur].tex); gl.uniform1i(uq.uHist, 0);
      gl.uniform2f(uq.uOutPx, 1 / this.outW, 1 / this.outH);
      gl.uniform1f(uq.uSharp, sharp * 0.4);   // gentle: a stronger sharpen would only amplify the ripple of a moving picture
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.histCur = prev; this.histOk = true;
      this.prevVPU.set(this.vpU); this.prevEye[0] = this.eye[0]; this.prevEye[1] = this.eye[1]; this.prevEye[2] = this.eye[2];
      gl.activeTexture(gl.TEXTURE0);
    } else {
      if (gl.invalidateFramebuffer) gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.DEPTH_ATTACHMENT]);   // tile GPUs need not write the depth back
      const P = this.progs.post, u = P.u;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.outW, this.outH);
      gl.useProgram(P.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.sceneTex);
      gl.uniform1i(u.uScene, 0);
      gl.uniform2f(u.uReg, this.w / this.allocW, this.h / this.allocH);
      gl.uniform2f(u.uPx, 1 / this.allocW, 1 / this.allocH);
      gl.uniform1f(u.uAA, this.fxaa ? 1 : 0);
      gl.uniform1f(u.uSharp, sharp);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    gl.depthMask(true); gl.enable(gl.DEPTH_TEST); gl.enable(gl.CULL_FACE);
  }

  // one grass tuft = K blades x 5 vertices (base L/R, middle L/R, tip); everything else (position, height, bend, colour) is computed per instance in the vertex shader
  _makeGrassMesh(K, tri) {   // tri: one triangle per blade (3 vertices: base L, base R, tip) for short turf
    const gl = this.gl, V = tri ? 3 : 5, v = new Float32Array(K * V * 4), idx = new Uint16Array(K * (tri ? 3 : 9));
    for (let b = 0; b < K; b++) {
      const a = ((b + 0.37) / K) * 6.28318, rx = Math.cos(a), rz = Math.sin(a);
      for (let c = 0; c < V; c++) { const o = (b * V + c) * 4; v[o] = rx; v[o + 1] = rz; v[o + 2] = b; v[o + 3] = tri ? [0, 1, 4][c] : c; }
      const q = b * V;
      if (tri) idx.set([q, q + 1, q + 2], b * 3); else idx.set([q, q + 1, q + 2, q + 1, q + 3, q + 2, q + 2, q + 3, q + 4], b * 9);
    }
    const m = { vao: gl.createVertexArray(), n: idx.length };
    gl.bindVertexArray(m.vao);
    const bf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bf); gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return m;
  }
  // grass: two instanced layers (near: 0.25 m cells 16 m round the eye; far ring: 0.5 m cells over the terrain patch). cfg = {density 0..1.2, near blades, far blades}
  _drawGrass() {
    const G = this.grassCfg, so = this.soil;
    if (!G || !so || !so.on || G.density < 0.03) return;
    const gl = this.gl, P = this.progs.grass, u = P.u, e = this.eye;
    gl.useProgram(P.p);
    this._setEnv(P);
    gl.uniformMatrix4fv(u.uVP, false, this.vp);
    gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
    gl.uniform3f(u.uEye, e[0], e[1], e[2]);
    gl.uniform4f(u.uSoilO, so.ox, so.oz, so.size, 1);
    gl.uniform1f(u.uShadowOn, this.shadowTex ? 1 : 0);
    gl.uniform1i(u.uShadowMap, 1); gl.uniform1i(u.uSoil, 2); gl.uniform1i(u.uMeta, 3);
    const gc = this.grassCars || [], ca = (this._gcA = this._gcA || new Float32Array(24)), cb = (this._gcB = this._gcB || new Float32Array(24));
    ca.fill(0); cb.fill(0);
    for (let i = 0; i < gc.length && i < 6; i++) { ca.set([gc[i][0], gc[i][1], gc[i][2], gc[i][3]], i * 4); cb.set([gc[i][4], gc[i][5], 0, 0], i * 4); }
    gl.uniform4fv(u.uCarA, ca); gl.uniform4fv(u.uCarB, cb); gl.uniform1f(u.uNCars, Math.min(6, gc.length));
    gl.activeTexture(gl.TEXTURE0 + 1); gl.bindTexture(gl.TEXTURE_2D, this.shadowTex || this.dummyShadow);
    gl.activeTexture(gl.TEXTURE0 + 2); gl.bindTexture(gl.TEXTURE_2D, so.tex);
    gl.activeTexture(gl.TEXTURE0 + 3); gl.bindTexture(gl.TEXTURE_2D, so.meta);
    gl.activeTexture(gl.TEXTURE0);
    const pix = 2 / (this.proj[5] * this.h), dn = Math.min(1, G.density);
    const layer = (mesh, cx, cz, cs, n, half, lay, blades, c0) => {
      const ox = Math.round(cx / cs) - n / 2, oz = Math.round(cz / cs) - n / 2, cnt = Math.ceil(n * n * dn), wx = ox * cs + n * cs / 2, wz = oz * cs + n * cs / 2;
      gl.bindVertexArray(mesh.vao);
      gl.uniform4f(u.uG, cs, n, ox, oz); gl.uniform4f(u.uC, wx, wz, n * cs / 2, lay); gl.uniform4f(u.uC0, c0[0], c0[1], c0[2], blades);
      gl.uniform4f(u.uP, 1, 1, pix, 0);
      gl.drawElementsInstanced(gl.TRIANGLES, mesh.n, gl.UNSIGNED_SHORT, 0, cnt);
      this.stats.draws++; this.stats.tris += mesh.n / 3 * cnt * 0.5;
    };
    gl.disable(gl.CULL_FACE); gl.disable(gl.POLYGON_OFFSET_FILL);
    const cs0 = 0.25, c0x = Math.round(e[0] / cs0) * cs0, c0z = Math.round(e[2] / cs0) * cs0, c0 = [c0x, c0z, 8];
    // layer 2: dense short turf (72 x 72 cells of 0.12 m, one triangle blades), layer 0: tufts 64 x 64 of 0.25 m (16 m), layer 1: far ring 80 x 80 of 0.45 m (36 m) over the terrain patch
    layer(this.grassMeshTri, e[0], e[2], 0.12, 72, 4.3, 2, 8, c0);
    layer(this.grassMesh, c0x, c0z, cs0, 64, 8, 0, 8, c0);
    if (G.far > 0) layer(this.grassMeshFar, so.patch.cx, so.patch.cz, 0.45, 80, 18, 1, 5, c0);
    gl.enable(gl.CULL_FACE);
    gl.bindVertexArray(null);
    gl.useProgram(this.progs.main.p);
  }

  // Material uniforms + raster state, with a per-frame cache: only values that really changed reach the driver (a draw used to push ~14 uniforms and 2 state toggles every time).
  _setMat(u, m) {
    const gl = this.gl;
    let c = this._mc;
    if (!c) { c = this._mc = { m: null, kind: -1, br: NaN, bg: NaN, bb: NaN, er: NaN, eg: NaN, eb: NaN, metal: NaN, rough: NaN, coat: NaN, alpha: NaN, flake: NaN, ts: NaN, n2: NaN, sway: NaN, terr: NaN, under: NaN, texOn: -1, tex: undefined, ds: -1, poly: -99 }; }
    if (c.m === m) return;
    c.m = m;
    const kind = m.kind | 0; if (kind !== c.kind) { gl.uniform1i(u.uKind, kind); c.kind = kind; }
    const b = m.base || ONE3; if (b[0] !== c.br || b[1] !== c.bg || b[2] !== c.bb) { gl.uniform3f(u.uBase, b[0], b[1], b[2]); c.br = b[0]; c.bg = b[1]; c.bb = b[2]; }
    const e = m.emis || ZERO3; if (e[0] !== c.er || e[1] !== c.eg || e[2] !== c.eb) { gl.uniform3f(u.uEmis, e[0], e[1], e[2]); c.er = e[0]; c.eg = e[1]; c.eb = e[2]; }
    let v = m.metal || 0; if (v !== c.metal) { gl.uniform1f(u.uMetal, v); c.metal = v; }
    v = m.rough ?? 0.5; if (v !== c.rough) { gl.uniform1f(u.uRough, v); c.rough = v; }
    v = m.coat || 0; if (v !== c.coat) { gl.uniform1f(u.uCoat, v); c.coat = v; }
    v = m.alpha ?? 1; if (v !== c.alpha) { gl.uniform1f(u.uAlpha, v); c.alpha = v; }
    v = m.flake || 0; if (v !== c.flake) { gl.uniform1f(u.uFlake, v); c.flake = v; }
    v = m.texScale || 1; if (v !== c.ts) { gl.uniform1f(u.uTexScale, v); c.ts = v; }
    v = m.near2 || 0; if (v !== c.n2) { gl.uniform1f(u.uNear2, v); c.n2 = v; }
    v = m.sway || 0; if (v !== c.sway) { gl.uniform1f(u.uSway, v); c.sway = v; }
    v = m.terr ? 1 : 0; if (v !== c.terr) { gl.uniform1f(u.uTerr, v); c.terr = v; }
    v = m.under ? 1 : 0; if (v !== c.under) { gl.uniform1f(u.uUnder, v); c.under = v; }
    if (m.tex) { if (c.texOn !== 1) { gl.uniform1f(u.uTexOn, 1); c.texOn = 1; } if (c.tex !== m.tex) { gl.bindTexture(gl.TEXTURE_2D, m.tex); c.tex = m.tex; } } else if (c.texOn !== 0) { gl.uniform1f(u.uTexOn, 0); c.texOn = 0; }
    const ds = m.doubleSided ? 1 : 0; if (ds !== c.ds) { if (ds) gl.disable(gl.CULL_FACE); else gl.enable(gl.CULL_FACE); c.ds = ds; }
    const pl = m.poly ? (m.poly === true ? 2 : m.poly) : 0;
    if (pl !== c.poly) { if (pl) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-pl, -3 * pl); } else gl.disable(gl.POLYGON_OFFSET_FILL); c.poly = pl; }
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
    const groups = [[], [], [], [], []];
    for (const p of list) groups[p.mode || 0].push(p);
    gl.useProgram(P.p);
    this._setEnv(P);
    gl.uniformMatrix4fv(P.u.uVP, false, this.vp);
    gl.enable(gl.BLEND); gl.depthMask(false); gl.disable(gl.CULL_FACE);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ZERO);   // particles move: they write the TAA "moving" mask
    for (let mode = 0; mode < 5; mode++) {
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
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);   // decals sit on static ground: the mask is left alone
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
