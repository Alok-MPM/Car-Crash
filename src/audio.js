// Fully procedural audio (WebAudio): engines per cylinder count, turbo, tyres, wind, crashes, glass, explosions, horn.
import { clamp, lerp } from './math.js';

export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.cam = [0, 0, 0];
    this.vol = 0.8;
  }
  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = this.vol;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp); comp.connect(c.destination);
    // noise buffer
    const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = nb;
    this.buildEngine();
    this.buildLoops();
  }
  setVolume(v) { this.vol = v; if (this.master) this.master.gain.value = this.muted ? 0 : v; }
  mute(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : this.vol; }
  noise(loop = true) { const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf; s.loop = loop; return s; }

  buildEngine() {
    const c = this.ctx;
    const e = (this.eng = {});
    e.out = c.createGain(); e.out.gain.value = 0.0; e.out.connect(this.master);
    e.lp = c.createBiquadFilter(); e.lp.type = 'lowpass'; e.lp.frequency.value = 1800; e.lp.Q.value = 0.8;
    const ws = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = (i / 1023) * 2 - 1; curve[i] = Math.tanh(x * 2.6); }
    ws.curve = curve; ws.oversample = '2x';
    e.ws = ws;
    e.o1 = c.createOscillator(); e.o1.type = 'sawtooth';
    e.o2 = c.createOscillator(); e.o2.type = 'square';
    e.o3 = c.createOscillator(); e.o3.type = 'sawtooth';
    e.g1 = c.createGain(); e.g2 = c.createGain(); e.g3 = c.createGain();
    e.g1.gain.value = 0.5; e.g2.gain.value = 0.25; e.g3.gain.value = 0.22;
    e.o1.connect(e.g1); e.o2.connect(e.g2); e.o3.connect(e.g3);
    const mix = c.createGain();
    e.g1.connect(mix); e.g2.connect(mix); e.g3.connect(mix);
    // intake / exhaust noise
    e.n = this.noise(); e.ng = c.createGain(); e.ng.gain.value = 0.0;
    e.nf = c.createBiquadFilter(); e.nf.type = 'bandpass'; e.nf.frequency.value = 600; e.nf.Q.value = 0.7;
    e.n.connect(e.nf); e.nf.connect(e.ng); e.ng.connect(mix);
    mix.connect(ws); ws.connect(e.lp); e.lp.connect(e.out);
    // sub
    e.sub = c.createOscillator(); e.sub.type = 'sine'; e.subG = c.createGain(); e.subG.gain.value = 0.3; e.sub.connect(e.subG); e.subG.connect(e.out);
    // turbo whistle
    e.tb = c.createOscillator(); e.tb.type = 'sine'; e.tbG = c.createGain(); e.tbG.gain.value = 0; e.tb.connect(e.tbG); e.tbG.connect(this.master);
    e.o1.start(); e.o2.start(); e.o3.start(); e.n.start(); e.sub.start(); e.tb.start();
    this.lastThrottle = 0;
  }
  buildLoops() {
    const c = this.ctx;
    // tyre squeal
    this.sq = { n: this.noise(), f: c.createBiquadFilter(), g: c.createGain() };
    this.sq.f.type = 'bandpass'; this.sq.f.frequency.value = 1100; this.sq.f.Q.value = 6;
    this.sq.g.gain.value = 0; this.sq.n.connect(this.sq.f); this.sq.f.connect(this.sq.g); this.sq.g.connect(this.master); this.sq.n.start();
    // wind
    this.wd = { n: this.noise(), f: c.createBiquadFilter(), g: c.createGain() };
    this.wd.f.type = 'lowpass'; this.wd.f.frequency.value = 500; this.wd.g.gain.value = 0;
    this.wd.n.connect(this.wd.f); this.wd.f.connect(this.wd.g); this.wd.g.connect(this.master); this.wd.n.start();
    // scrape / road rumble
    this.rb = { n: this.noise(), f: c.createBiquadFilter(), g: c.createGain() };
    this.rb.f.type = 'lowpass'; this.rb.f.frequency.value = 220; this.rb.g.gain.value = 0;
    this.rb.n.connect(this.rb.f); this.rb.f.connect(this.rb.g); this.rb.g.connect(this.master); this.rb.n.start();
    this.sc = { n: this.noise(), f: c.createBiquadFilter(), g: c.createGain() };
    this.sc.f.type = 'bandpass'; this.sc.f.frequency.value = 2200; this.sc.f.Q.value = 1.5; this.sc.g.gain.value = 0;
    this.sc.n.connect(this.sc.f); this.sc.f.connect(this.sc.g); this.sc.g.connect(this.master); this.sc.n.start();
    // horn
    this.hn = { a: c.createOscillator(), b: c.createOscillator(), g: c.createGain() };
    this.hn.a.type = 'square'; this.hn.b.type = 'square'; this.hn.a.frequency.value = 415; this.hn.b.frequency.value = 520;
    this.hn.g.gain.value = 0; this.hn.a.connect(this.hn.g); this.hn.b.connect(this.hn.g);
    const hf = c.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1800; this.hn.g.connect(hf); hf.connect(this.master);
    this.hn.a.start(); this.hn.b.start();
  }

  // spec: car spec; v: vehicle
  engine(spec, v, camDist = 0) {
    if (!this.ctx) return;
    const c = this.ctx, e = this.eng, t = c.currentTime;
    const rpm = v.rpm;
    const cyl = spec.cyl;
    const fire = (rpm / 60) * (cyl / 2); // firing frequency
    const load = clamp(v.tl, 0, 1);
    const f = Math.max(18, fire);
    const tm = 0.04;
    e.o1.frequency.setTargetAtTime(f, t, tm);
    e.o2.frequency.setTargetAtTime(f * (cyl >= 12 ? 2 : 0.5), t, tm);
    e.o3.frequency.setTargetAtTime(f * 1.004 * (cyl >= 8 ? 1.5 : 1.0), t, tm);
    e.sub.frequency.setTargetAtTime(Math.max(14, f * 0.5), t, tm);
    const rn = clamp((rpm - spec.idle) / (spec.redline - spec.idle), 0, 1);
    const brightness = 700 + rn * 3200 + load * 1600;
    e.lp.frequency.setTargetAtTime(brightness * (spec.turbo ? 0.9 : 1.15), t, 0.05);
    const vol = (0.18 + 0.5 * load + 0.2 * rn) * (v.revLimiter ? (Math.sin(t * 90) > 0 ? 0.4 : 1) : 1);
    e.out.gain.setTargetAtTime(vol * (v.wrecked ? 0.6 : 1) * clamp(1 - camDist / 260, 0.15, 1), t, 0.05);
    e.ng.gain.setTargetAtTime(0.12 + load * 0.35 + rn * 0.2, t, 0.05);
    e.nf.frequency.setTargetAtTime(300 + rn * 1800, t, 0.05);
    // turbo whistle
    if (spec.turbo) {
      const spool = clamp(v.boost || (load * rn), 0, 1);
      e.tb.frequency.setTargetAtTime(1500 + spool * 4200, t, 0.08);
      e.tbG.gain.setTargetAtTime(0.012 + spool * 0.05, t, 0.08);
      // blow-off valve when lifting
      if (this.lastThrottle > 0.6 && load < 0.2 && rn > 0.35) this.bov();
    } else e.tbG.gain.setTargetAtTime(0, t, 0.05);
    // exhaust pop on lift for sporty cars
    if (this.lastThrottle > 0.7 && load < 0.15 && rn > 0.5 && Math.random() < 0.35) this.pop();
    this.lastThrottle = load;
  }
  bov() {
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(false), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 2500;
    g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t, Math.random(), 0.4);
  }
  pop() {
    const c = this.ctx, t = c.currentTime;
    const n = this.noise(false), g = c.createGain(), f = c.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 900;
    g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t, Math.random(), 0.12);
  }
  // continuous: slip 0..1 (tyres), speed m/s, rumble 0..1 (off-asphalt / debris), scrape 0..1
  continuous(slip, speed, scrape) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sq.g.gain.setTargetAtTime(clamp(slip, 0, 1) * 0.22, t, 0.04);
    this.sq.f.frequency.setTargetAtTime(900 + clamp(slip, 0, 1) * 700 + speed * 4, t, 0.05);
    this.wd.g.gain.setTargetAtTime(Math.pow(clamp(speed / 100, 0, 1.4), 2) * 0.5, t, 0.1);
    this.wd.f.frequency.setTargetAtTime(300 + speed * 12, t, 0.1);
    this.rb.g.gain.setTargetAtTime(clamp(speed / 60, 0, 1) * 0.07, t, 0.1);
    this.sc.g.gain.setTargetAtTime(clamp(scrape, 0, 1) * 0.28, t, 0.03);
  }
  horn(on) { if (this.ctx) this.hn.g.gain.setTargetAtTime(on ? 0.12 : 0, this.ctx.currentTime, 0.01); }

  att(pos) {
    const dx = pos[0] - this.cam[0], dy = pos[1] - this.cam[1], dz = pos[2] - this.cam[2];
    const d = Math.hypot(dx, dy, dz);
    return clamp(1 / (1 + d * d / 900), 0.02, 1);
  }
  burst(freq, dur, gain, q = 1, type = 'bandpass', start = 0, lowFreq = 0) {
    const c = this.ctx, t = c.currentTime + start;
    const n = this.noise(false), f = c.createBiquadFilter(), g = c.createGain();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    n.connect(f); f.connect(g); g.connect(this.master); n.start(t, Math.random(), dur + 0.05);
    if (lowFreq) {
      const o = c.createOscillator(), og = c.createGain();
      o.frequency.setValueAtTime(lowFreq, t); o.frequency.exponentialRampToValueAtTime(lowFreq * 0.4, t + dur);
      og.gain.setValueAtTime(gain * 1.2, t); og.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      o.connect(og); og.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  // crash: k ~ depth (m)
  crash(pos, k, hard = true) {
    if (!this.ctx) return;
    const a = this.att(pos) * clamp(0.25 + k * 1.6, 0.15, 1.4);
    this.burst(180, 0.35 + k * 0.6, 0.9 * a, 0.7, 'lowpass', 0, 90);
    this.burst(1500, 0.2 + k * 0.5, 0.5 * a, 1.2, 'bandpass', 0.005);
    if (hard) { this.burst(3200, 0.18, 0.28 * a, 3, 'bandpass', 0.02); this.burst(800, 0.5, 0.35 * a, 4, 'bandpass', 0.04); }
  }
  tap(pos, v) {
    if (!this.ctx) return;
    const a = this.att(pos) * clamp(v / 14, 0.05, 0.6);
    this.burst(700 + Math.random() * 600, 0.12, 0.5 * a, 2, 'bandpass', 0, 160);
  }
  thud(pos, k = 1) { if (this.ctx) { const a = this.att(pos); this.burst(220, 0.3, 0.6 * a * k, 1, 'lowpass', 0, 80); this.burst(1800, 0.15, 0.25 * a, 2); } }
  glass(pos) {
    if (!this.ctx) return;
    const a = this.att(pos);
    for (let i = 0; i < 9; i++) this.burst(3500 + Math.random() * 3500, 0.08 + Math.random() * 0.12, 0.25 * a, 8, 'bandpass', i * 0.035 + Math.random() * 0.03);
    this.burst(2400, 0.4, 0.3 * a, 1.5, 'highpass');
  }
  boom(pos) {
    if (!this.ctx) return;
    const a = this.att(pos) * 1.5;
    this.burst(120, 1.8, 1.2 * a, 0.5, 'lowpass', 0, 70);
    this.burst(600, 1.2, 0.8 * a, 0.5, 'lowpass', 0.02);
    this.burst(2500, 0.5, 0.3 * a, 1, 'highpass');
  }
}
