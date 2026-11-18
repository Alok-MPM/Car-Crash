// Perf Lab: finds out what each part of the picture costs ON THIS DEVICE.
// It switches one feature off at a time, measures the real frame interval for 2 s, switches it back on, and shows a table.
// Nothing here runs unless the Perf Lab button is pressed: zero cost while playing.
export class PerfLab {
  constructor(api) { this.api = api; this.active = false; this.res = []; this.step = -1; this.t0 = 0; this.frames = []; this.cpu = 0; this.cpuN = 0; this.undo = null; this.el = null; this._lt = 0; }
  steps() {
    const { r, getScene, fx, resize } = this.api;
    const sc = () => getScene(), land = () => sc().land;
    const patch = (obj, key, val) => { const old = obj[key]; obj[key] = val; return () => { obj[key] = old; }; };
    const noop = () => {};
    const list = [
      ['Everything on (as you play)', () => noop],
      ['Shadows off', () => { const t = r.shadowTex; r.shadowTex = null; return () => { r.shadowTex = t; }; }],
      ['Grass off', () => patch(r, '_drawGrass', noop)],
      ['All trees off', () => patch(land().treeField, 'draw', noop)],
      ['Leaf-by-leaf trees off (pictures only)', () => { const tf = land().treeField, o = tf.detScale; tf.detScale = 0; return () => { tf.detScale = o; }; }],
      ['Buildings + city off', () => { const u1 = patch(sc().structures, 'draw', noop), u2 = sc().city ? patch(sc().city, 'draw', noop) : noop; return () => { u1(); u2(); }; }],
      ['Ground / soil patch off', () => patch(land().soil, 'draw', noop)],
      ['Road + land meshes off', () => { const L = land(), a = L.meshes, b = L.furMeshes, c = sc().marks; L.meshes = []; L.furMeshes = []; sc().marks = []; return () => { L.meshes = a; L.furMeshes = b; sc().marks = c; }; }],
      ['Props off', () => { const s = sc(), o = s.props; s.props = []; return () => { s.props = o; }; }],
      ['Smoke / sparks / decals off', () => { const u1 = patch(fx, 'collect', noop), u2 = patch(r, '_drawDecals', noop); return () => { u1(); u2(); }; }],
      ['Resolution x 0.7', () => { const o = r.dprScale; r.dprScale = o * 0.7; resize(); return () => { r.dprScale = o; resize(); }; }],
      ['Resolution x 0.5', () => { const o = r.dprScale; r.dprScale = o * 0.5; resize(); return () => { r.dprScale = o; resize(); }; }],
    ];
    // last row: everything off at once = the floor (sky + car). If this is still slow, the cost is the screen size / the car, not the world.
    list.push(['EVERYTHING off (sky + car only)', () => {
      const us = [list[1][1](), list[2][1](), list[3][1](), list[5][1](), list[6][1](), list[7][1](), list[8][1](), list[9][1]()];
      return () => { for (const u of us.reverse()) u(); };
    }]);
    return list;
  }
  start() {
    if (this.active) return;
    const a = this.api;
    this.active = true; this.res = []; this.step = -1; this.list = this.steps();
    this.saved = { fps: a.S.fps, load: a.ctx.load, lod2: a.ctx.lod2 };
    a.S.fps = 0; a.setLod2(0); this._lt = 0;
    a.hideMenu(true);
    this._ui('Perf Lab: ready...');
    this.phase = 'settle'; this.t0 = performance.now() + 1500; this.next();
  }
  next() {
    if (this.undo) { this.undo(); this.undo = null; }
    this.step++;
    if (this.step >= this.list.length) return this.finish();
    const [name, on] = this.list[this.step];
    this.undo = on();
    this.name = name; this.phase = 'settle'; this.t0 = performance.now(); this.frames = []; this.cpu = 0; this.cpuN = 0;
    this._ui('Perf Lab ' + (this.step + 1) + '/' + this.list.length + ': ' + name);
  }
  // called once per rendered frame with the rAF timestamp (ms) and the JS time this frame spent (ms)
  tick(tMs, cpuMs) {
    if (!this.active) return;
    const dtMs = this._lt ? tMs - this._lt : 16.7; this._lt = tMs;
    const now = performance.now(), el = now - this.t0;
    if (el < 0) return;
    if (this.phase === 'settle') { if (el > 700) { this.phase = 'measure'; this.t0 = now; this.frames = []; } return; }
    this.frames.push(dtMs); this.cpu += cpuMs; this.cpuN++;
    if (el > 2000 && this.frames.length >= 8) {
      const f = this.frames.slice().sort((x, y) => x - y), med = f[f.length >> 1], avg = f.reduce((s, v) => s + v, 0) / f.length;
      this.res.push({ name: this.name, ms: avg, med, worst: f[Math.min(f.length - 1, Math.floor(f.length * 0.95))], cpu: this.cpu / Math.max(1, this.cpuN), n: f.length });
      this.next();
    }
  }
  finish() {
    const a = this.api;
    a.S.fps = this.saved.fps; a.ctx.load = this.saved.load === undefined ? 1 : this.saved.load;
    this.active = false;
    window.__perfLab = this.res;
    const base = this.res[0], gl = a.r.gl, ext = gl.getExtension('WEBGL_debug_renderer_info');
    const dev = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'GPU ?';
    const rows = this.res.map((x, i) => {
      const sv = base.ms - x.ms, w = Math.max(0, Math.min(100, x.ms / (base.ms * 1.05) * 100));
      const hot = i > 0 && i < this.res.length - 1 && sv > base.ms * 0.08;
      return '<tr' + (hot ? ' style="color:#ffd35c"' : '') + '><td>' + x.name + '</td><td style="text-align:right">' + x.ms.toFixed(1) + ' ms</td><td style="text-align:right">' + (1000 / x.ms).toFixed(0) + ' fps</td><td style="text-align:right">' + (i ? (sv >= 0 ? '-' : '+') + Math.abs(sv).toFixed(1) + ' ms' : '') + '</td><td style="text-align:right;opacity:.75">js ' + x.cpu.toFixed(1) + '</td><td style="width:90px"><div style="height:8px;background:' + (hot ? '#ffb02e' : '#4aa8ff') + ';width:' + w + '%"></div></td></tr>';
    }).join('');
    const floor = this.res[this.res.length - 1];
    const verdict = base.cpu > base.ms * 0.8 ? 'CPU-bound: JavaScript time (physics / draw calls) is the limit, not the GPU.' : floor.ms > base.ms * 0.6 ? 'Even with everything off the frame is slow: screen size / car / driver overhead dominates. Resolution is the lever.' : 'GPU-bound by the world: look at the highlighted rows (biggest savings).';
    this._ui(null);
    const d = document.createElement('div'); this.el = d; d.id = 'perfLabRes';
    d.style.cssText = 'position:fixed;inset:0;z-index:99;background:rgba(8,10,14,.985);color:#dde3ea;font:600 13px system-ui;padding:max(14px,env(safe-area-inset-top)) 16px 16px;overflow:auto';
    d.innerHTML = '<div style="max-width:760px;margin:0 auto"><div style="font:800 18px system-ui;letter-spacing:.06em;margin-bottom:4px">PERF LAB</div><div style="opacity:.7;margin-bottom:10px">' + dev + ' · ' + a.r.w + 'x' + a.r.h + ' · quality ' + ['Low', 'Medium', 'High'][a.S.quality] + ' · bodies ' + a.world.dyn.length + ' loose / ' + a.world.bodies.length + ' all · draws ' + a.r.stats.draws + ' · ' + Math.round(a.r.stats.tris / 1000) + 'k tris</div><table style="width:100%;border-collapse:collapse;line-height:1.9">' + rows + '</table><div style="margin:12px 0;color:#9fe3a6">' + verdict + '</div><div style="opacity:.7;margin-bottom:12px">Screenshot this and send it. (-x ms = how much faster the frame gets without that thing.)</div><button id="plClose" style="padding:10px 22px;font:800 15px system-ui;border-radius:6px;background:#f5b81c;color:#14110a;border:0">CLOSE</button></div>';
    document.body.appendChild(d);
    d.querySelector('#plClose').onclick = () => { d.remove(); a.hideMenu(false); };
  }
  _ui(text) {
    if (!this.bar) { const b = document.createElement('div'); b.style.cssText = 'position:fixed;left:50%;top:max(10px,env(safe-area-inset-top));transform:translateX(-50%);z-index:98;background:rgba(12,15,20,.85);color:#ffd35c;font:700 13px system-ui;padding:6px 14px;border-radius:10px;pointer-events:none;display:none'; document.body.appendChild(b); this.bar = b; }
    this.bar.style.display = text ? 'block' : 'none'; if (text) this.bar.textContent = text;
  }
}
