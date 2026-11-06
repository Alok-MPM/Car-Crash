// Vehicle dynamics: raycast suspension, brush-style combined-slip tyres, engine torque curve,
// clutch/launch model, auto gearbox, AWD/RWD drivelines, aero drag + downforce.
import { Body, GROUP } from '../../core/physics.js';
import { clamp, lerp, lin, smoothstep } from '../../core/math.js';

const RHO = 1.2, G = 9.81;

export function prepare(spec) {
  if (spec._p) return spec._p;
  const g = spec.geo, P = {};
  const f = lin(spec.curve);
  let maxP = 0, peakRpm = spec.idle;
  for (let r = spec.idle; r <= spec.redline; r += 20) {
    const p = f(r) * r;
    if (p > maxP) { maxP = p; peakRpm = r; }
  }
  P.scale = (spec.hp * 745.7) / (maxP * Math.PI / 30);
  P.torque = (r) => f(clamp(r, spec.curve[0][0], spec.redline)) * P.scale;
  P.peakRpm = peakRpm;
  P.tqMax = Math.max(...spec.curve.map((c) => c[1])) * P.scale;
  P.eta = 0.9;
  // gearing from first-gear and top-gear speeds at redline
  const Rw = spec.drive === 'FWD' ? g.RF : g.RR;
  const n = spec.nGears;
  const vTop = spec.vmax / 3.6 / 0.945;
  const vFirst = spec.vFirst / 3.6;
  P.ratios = [];
  P.gearSpeed = [];
  for (let i = 0; i < n; i++) {
    const v = vFirst * Math.pow(vTop / vFirst, n > 1 ? i / (n - 1) : 0);
    P.gearSpeed.push(v * 3.6);
    P.ratios.push(((spec.redline * Math.PI) / 30 * Rw) / v);
  }
  // drag area so that power at the natural top speed balances resistance
  const vNat = (spec.vNat || spec.vmax) / 3.6;
  const Pw = spec.hp * 745.7 * 0.88;
  P.CdA = Math.max(0.3, (Pw / vNat - 0.014 * spec.kg * G) / (0.5 * RHO * vNat * vNat));
  P.Iw = 1.4 + (g.RR - 0.33) * 9;
  P.bMax = [spec.kg * G * spec.brakeG * 0.72 * 1.0 * g.RF / 2, spec.kg * G * spec.brakeG * 0.28 * g.RR / 2];
  // suspension per corner
  const wF = 1 - g.wR;
  P.mcF = (spec.kg * wF) / 2;
  P.mcR = (spec.kg * g.wR) / 2;
  P.kF = (P.mcF * G) / g.cs;
  P.kR = (P.mcR * G) / g.cs;
  P.cF = 2 * Math.sqrt(P.kF * P.mcF);
  P.cR = 2 * Math.sqrt(P.kR * P.mcR);
  const m = spec.kg;
  const Iroll = (m * (g.W * g.W + g.H * g.H)) / 12, Ipitch = (m * (g.L * g.L + g.H * g.H)) / 12 * 0.85;
  const Kroll = ((P.kF * g.trackF * g.trackF) / 2 + (P.kR * g.trackR * g.trackR) / 2) * 1.5;
  const wb = g.zRA - g.zFA, aF = wb * g.wR, aR = wb * (1 - g.wR);
  const Kpitch = 2 * (P.kF * aF * aF + P.kR * aR * aR);
  P.cRoll = 0.55 * 2 * Math.sqrt(Kroll * Iroll);
  P.cPitch = 0.45 * 2 * Math.sqrt(Kpitch * Ipitch);
  spec._p = P;
  return P;
}

export class Vehicle {
  constructor(world, spec, pose = {}) {
    this.world = world;
    this.spec = spec;
    const P = (this.P = prepare(spec));
    const g = spec.geo;
    this.zcg = g.zFA + (g.zRA - g.zFA) * g.wR;
    const m = spec.kg;
    this.body = new Body({
      mass: m, pos: pose.pos || [0, g.cgY + 0.02, 0], q: pose.q || [0, 0, 0, 1], fric: 0.35, rest: 0.02,
      group: GROUP.CAR, canSleep: false, linDamp: 0, angDamp: 0.02,
      inertia: [(m * (g.L * g.L + g.H * g.H)) / 12 * 0.85, (m * (g.L * g.L + g.W * g.W)) / 12 * 0.9, (m * (g.W * g.W + g.H * g.H)) / 12],
    });
    this.body.report = true;
    this.body.userData = { vehicle: this };
    // collision boxes (COM-local; forward = -z)
    const zl = this.zcg;
    const lowH = (g.beltY - g.boxY0) / 2;
    this.body.addBox([(g.W / 2) * 0.95, lowH, (g.L - 0.1) / 2], [0, g.boxY0 + lowH - g.cgY, g.L / 2 - zl]);
    const cz0 = g.cabZ[0], cz1 = g.cabZ[1], chH = (g.cabY[1] - g.beltY) / 2;
    this.body.addBox([g.W * 0.38, chH, (cz1 - cz0) / 2], [0, g.beltY + chH - g.cgY, (cz0 + cz1) / 2 - zl]);
    world.add(this.body);
    // wheels
    this.wheels = [];
    const mk = (sx, front) => {
      const Rw = front ? g.RF : g.RR;
      const zAx = (front ? g.zFA : g.zRA) - zl;
      const L0 = g.travel;
      const my = Rw + (L0 - g.cs) - g.cgY;
      return {
        side: sx, front, R: Rw, tw: front ? g.twF : g.twR,
        mount: [(sx * (front ? g.trackF : g.trackR)) / 2, my, zAx],
        L0, omega: 0, spin: 0, susp: L0 - g.cs, comp: 0, grounded: false, Fn: 0,
        steer: 0, drive: spec.drive === 'AWD' || (spec.drive === 'RWD' && !front) || (spec.drive === 'FWD' && front),
        sig: 0, slipLong: 0, slipLat: 0, contact: [0, 0, 0], normal: [0, 1, 0], detached: false, health: 1, flat: false,
        vlat: 0, vlong: 0, surface: 0,
      };
    };
    this.wheels = [mk(-1, true), mk(1, true), mk(-1, false), mk(1, false)];
    this.in = { throttle: 0, brake: 0, steer: 0, handbrake: 0, reverse: 0 };
    this.bp = 0;
    this.assist = 1; // 0 pro, 1 sport (ABS+TC), 2 casual (+stability)
    this.gear = 1;
    this.shiftT = 0;
    this.rpm = spec.idle;
    this.tl = 0;
    this.boost = 0;
    this.steerAngle = 0;
    this.speed = 0; this.vf = 0; this.g = [0, 0, 0];
    this.health = { engine: 1, steerBias: 0, radiator: 1 };
    this.airborne = false;
    this.tcAct = 0; this.absAct = 0;
    this.lastV = [0, 0, 0];
    this.latG = 0; this.longG = 0;
    this.distance = 0;
    this.odo = 0;
    this.revLimiter = false;
  }

  // ---- test tuning: top speed box. Power, torque, redline, gearing, grip and brakes are re-derived so the car really gets to the speed, fast and stable.
  setTop(kmh) {
    if (!this.spec0) this.spec0 = this.spec;
    const s0 = this.spec0;
    this.topKmh = kmh > 0 ? kmh : 0;
    this.body.vmax = this.topKmh ? Math.max(160, (this.topKmh / 3.6) * 1.25) : 0;
    if (!this.topKmh) { this.spec = s0; this.P = prepare(s0); this.hyperOn = false; this.gripK = 1; this.brakeK = 1; return this.spec; }
    const vt = this.topKmh / 3.6, kk = this.topKmh / s0.vmax;
    if (kk <= 1.02) {                                         // slower than stock: just a governor
      const s2 = { ...s0, vmax: this.topKmh, vNat: Math.max(s0.vNat || 0, this.topKmh * 1.05), _p: undefined };
      this.spec = s2; this.P = prepare(s2); this.hyperOn = false; this.gripK = 1; this.brakeK = 1; return s2;
    }
    const Tacc = 2.8;                                          // seconds the car should need to reach the top speed
    const hp = Math.max(s0.hp, (0.5 * s0.kg * vt * vt) / (Tacc * 745.7));
    const s2 = {
      ...s0, hp, nm: Math.round(s0.nm * (hp / s0.hp) ** 0.9), vmax: this.topKmh, vNat: this.topKmh * 1.3,
      redline: Math.round(s0.redline * (1 + Math.min(0.6, Math.log10(kk) * 0.45)) / 100) * 100,
      vFirst: s0.vFirst * Math.min(kk, 6), shiftTime: Math.min(s0.shiftTime, 0.07), _p: undefined,
    };
    const aimG = vt / Tacc / G;
    const drvFrac = s0.drive === 'AWD' ? 1 : s0.drive === 'FWD' ? 1 - s0.geo.wR : s0.geo.wR;      // share of the weight on the driven wheels
    this.gripK = clamp((aimG * 0.85) / (s0.mu * Math.max(0.4, drvFrac)), 1.2, 100);
    this.brakeK = this.gripK * 2.6;
    this.hyperOn = true;
    this.spec = s2; this.P = prepare(s2);
    this.P.bMax = this.P.bMax.map((x) => x * this.brakeK);
    this.P.Iw *= clamp(this.gripK * 0.25, 1, 6);                 // heavier wheel inertia: with this much grip a light wheel would flip between locked and spinning every step
    return s2;
  }

  // continuous collision: at very high speed the car moves several metres per physics step, so look ahead for fixed walls and
  // shorten this step's travel to just reach the wall; the full speed is given back afterwards so the impact itself is at full speed.
  ccdBegin(dt) {
    const b = this.body, v = b.v, sp = Math.hypot(v[0], v[2]);
    this._ccd = null;
    if (sp * dt < 1.0) return;
    const g = this.spec.geo, R = b.R, dx = v[0] / sp, dz = v[2] / sp;
    const half = g.L * 0.5, move = sp * dt;
    let best = Infinity;
    for (const off of [0, 0.45, -0.45]) for (const hy of [0.05, 0.5]) {
      const lat = off * g.W;
      const o = [b.pos[0] + R[0] * lat, b.pos[1] + hy, b.pos[2] + R[2] * lat];
      const t = this.world.rayFixed(o, [dx, 0, dz], move + half + 0.6);
      if (t < best) best = t;
    }
    if (best - half < -0.02 || best - half > move) return;          // already touching (the solver sees it) or nothing to hit this step
    const k = clamp((best - half + 0.05) / move, 0.003, 1);
    this._ccd = { k, v0: [v[0], v[1], v[2]] };
    v[0] *= k; v[1] *= k; v[2] *= k;
  }
  ccdEnd() {
    const c = this._ccd; if (!c) return;
    const v = this.body.v, f = 1 - c.k;
    v[0] += c.v0[0] * f; v[1] += c.v0[1] * f; v[2] += c.v0[2] * f;
    this._ccd = null;
  }

  reset(pos, yaw = 0) {
    const b = this.body, g = this.spec.geo;
    const q = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
    b.setPose([pos[0], g.cgY + 0.15, pos[2]], q);
    b.v = [0, 0, 0]; b.w = [0, 0, 0];
    for (const w of this.wheels) { w.omega = 0; w.susp = w.L0 - g.cs; }
    this.gear = 1; this.rpm = this.spec.idle; this.steerAngle = 0;
  }

  // power loss from damage
  get powerScale() {
    return 0.25 + 0.75 * clamp(this.health.engine, 0, 1);
  }

  // A missing wheel leaves the hub / brake disc / strut hanging ~0.55R above the road. It only touches asphalt when the
  // corner is loaded (cornering towards that side, braking): then it drags with metal-on-asphalt friction and throws sparks.
  stubContact(w, dt) {
    const b = this.body, R = b.R, m = w.mount;
    const o = [b.pos[0] + R[0] * m[0] + R[3] * m[1] + R[6] * m[2], b.pos[1] + R[1] * m[0] + R[4] * m[1] + R[7] * m[2], b.pos[2] + R[2] * m[0] + R[5] * m[1] + R[8] * m[2]];
    const rs = w.R * 0.5;
    w.stubOn = false;
    const hit = this.world.raycastStatic(o, [0, -1, 0], w.L0 + rs);
    if (!hit) return;
    const depth = (w.L0 + rs) - hit.t; // hub hangs at full droop; it touches only when the corner has sagged enough
    if (depth <= 0) return;
    const cp = [o[0], o[1] - hit.t, o[2]];
    const tmp = [0, 0, 0];
    b.velAt(cp[0], cp[1], cp[2], tmp);
    const k = (this.P.kF + this.P.kR) * 1.2;
    const Fn = Math.min(k * depth + Math.max(0, -tmp[1]) * (this.P.cF + this.P.cR), this.spec.kg * G * 1.5);
    b.applyForce(0, Fn, 0, cp[0], cp[1], cp[2]);
    const vh = Math.hypot(tmp[0], tmp[2]);
    if (vh > 0.3) {
      const mu = 0.42, Ff = Math.min(mu * Fn, (this.spec.kg * 0.5 * vh) / dt);
      b.applyForce(-tmp[0] / vh * Ff, 0, -tmp[2] / vh * Ff, cp[0], cp[1], cp[2]);
    }
    w.stubOn = true; w.stubF = Fn; w.stubV = vh; w.stubP = cp;
  }
  step(dt) {
    const b = this.body, P = this.P, s = this.spec, g = s.geo;
    if (b.sleeping) return;
    if (!(isFinite(b.pos[0] + b.pos[1] + b.pos[2] + b.v[0] + b.v[1] + b.v[2] + b.w[0] + b.w[1] + b.w[2]))) { const g0 = this.spec.geo; const lp = this._lastGood || [0, g0.cgY + 0.2, 0]; this.reset([lp[0], 0, lp[2]], 0); }
    else if (this.hyperOn) {                                  // keep the solver sane at extreme speed
      const cap = (this.topKmh / 3.6) * 1.2, sp0 = Math.hypot(b.v[0], b.v[1], b.v[2]);
      if (sp0 > cap) { const k = cap / sp0; b.v[0] *= k; b.v[1] *= k; b.v[2] *= k; }
      const wl = Math.hypot(b.w[0], b.w[1], b.w[2]); if (wl > 30) { const k = 30 / wl; b.w[0] *= k; b.w[1] *= k; b.w[2] *= k; }
    }
    // a crash may shove the car hard, never launch it: limit how much upward speed / spin one solver step can add (deep-penetration blow-ups)
    if (this._vy !== undefined) {
      if (b.v[1] - this._vy > 9) b.v[1] = this._vy + 9;
      const wl = Math.hypot(b.w[0], b.w[1], b.w[2]); if (wl > 24 && !this.hyperOn) { const k = 24 / wl; b.w[0] *= k; b.w[1] *= k; b.w[2] *= k; }
    }
    {   // energy guard: one solver step can never speed a car up more than its engine/gravity could, and a wall may bounce it back only at a fraction of the impact speed
      const p0 = this._v0, sp = Math.hypot(b.v[0], b.v[1], b.v[2]);
      if (p0) {
        const sp0 = Math.hypot(p0[0], p0[1], p0[2]), allow = 2 + (this.topKmh || 300) / 3.6 / 2.8 / 120 * 1.5;
        if (sp > sp0 + allow && sp > 6) {
          const dot = b.v[0] * p0[0] + b.v[1] * p0[1] + b.v[2] * p0[2];
          const lim = dot < 0 ? sp0 * 0.45 : sp0 + allow, k = Math.min(1, lim / sp);
          b.v[0] *= k; b.v[1] *= k; b.v[2] *= k;
        }
      }
      this._v0 = [b.v[0], b.v[1], b.v[2]];
    }
    this._vy = b.v[1];
    this._lastGood = [b.pos[0], b.pos[1], b.pos[2]];
    const R = b.R;
    const up = [R[3], R[4], R[5]], fwd = [-R[6], -R[7], -R[8]], right = [R[0], R[1], R[2]];
    const v = b.v;
    const speed = Math.hypot(v[0], v[1], v[2]);
    const vf = v[0] * fwd[0] + v[1] * fwd[1] + v[2] * fwd[2];
    this.speed = speed; this.vf = vf;
    // load transfer / G meters
    const ax = (v[0] - this.lastV[0]) / dt, ay = (v[1] - this.lastV[1]) / dt, az = (v[2] - this.lastV[2]) / dt;
    this.lastV = [v[0], v[1], v[2]];
    this.longG += ((ax * fwd[0] + ay * fwd[1] + az * fwd[2]) / G - this.longG) * 0.1;
    this.latG += ((ax * right[0] + ay * right[1] + az * right[2]) / G - this.latG) * 0.1;
    const inp = this.in;
    // brake hydraulics: pressure rises fast, pads release slower
    {
      const tgt = Math.max(inp.brake, 0);
      const k = tgt > this.bp ? 22 : 11;
      this.bp += (tgt - this.bp) * (1 - Math.exp(-dt * k));
    }

    // ---- pedals / gear direction
    let drive = inp.throttle, brk = inp.brake;
    // reverse is a deliberate gear selection (R toggle), only when (nearly) stopped
    if (inp.reverse && this.gear >= 0 && Math.abs(vf) < 2) this.gear = -1;
    else if (!inp.reverse && this.gear < 0 && Math.abs(vf) < 2) this.gear = 1;
    // ---- steering
    const lockSpd = 0.62 / (1 + Math.pow(speed / 13, 1.6));
    let target = inp.steer * lockSpd + this.health.steerBias;
    if (this.assist === 2) {
      // stability assist: counter the yaw rate when sliding
      const yaw = b.w[0] * up[0] + b.w[1] * up[1] + b.w[2] * up[2];
      const wb = g.zRA - g.zFA;
      const desired = (vf * Math.tan(clamp(target, -0.5, 0.5))) / wb;
      target += clamp(-(yaw - desired) * 0.12, -0.12, 0.12) * clamp(speed / 12, 0, 1);
    }
    const rate = 2.2;
    this.steerAngle += clamp(target - this.steerAngle, -rate * dt, rate * dt);
    const dC = this.steerAngle;
    const wbase = g.zRA - g.zFA;

    // ---- engine & gearbox (uses wheel speeds from previous step)
    const drv = this.wheels.filter((w) => w.drive && !w.detached);
    let wAvg = 0;
    for (const w of drv) wAvg += w.omega;
    wAvg = drv.length ? wAvg / drv.length : 0;
    const nG = s.nGears;
    const ratio = this.gear > 0 ? P.ratios[this.gear - 1] : this.gear < 0 ? -P.ratios[0] * 0.92 : 0;
    const ratioAbs = Math.abs(ratio);
    let rpmIn = Math.max(0, (wAvg * ratio * 30) / Math.PI);
    if (this.shiftT > 0) this.shiftT -= dt;
    // traction control
    let tcF = 1;
    const tcOn = this.tcMode === 'off' ? false : this.tcMode === 'on' ? true : (this.assist >= 2 || !!this.hyperOn);
    if (tcOn && inp.brake < 0.3) {
      let mx = 0;
      for (const w of drv) mx = Math.max(mx, w.tcSlip || 0);
      if (mx > 0.3) { tcF = clamp(1 - (mx - 0.3) * 2.5, 0.3, 1); this.tcAct = 1; } else this.tcAct *= 0.9;
    }
    drive *= tcF;
    this.tl += (drive - this.tl) * (1 - Math.exp(-dt / 0.05));
    const tl = this.tl;
    const launchTarget = lerp(s.idle * 1.4, Math.min(s.nmRpm, 5000) * 0.95, Math.pow(clamp(tl, 0, 1), 0.7));
    const locked = rpmIn >= launchTarget;
    let rpmEng = this.shiftT > 0 ? Math.max(rpmIn, s.idle) : locked ? rpmIn : launchTarget;
    rpmEng = Math.max(rpmEng, s.idle);
    this.rpmTarget = rpmEng;
    this.rpm += (rpmEng - this.rpm) * (1 - Math.exp(-dt / 0.04));
    let Te = 0;
    if (this.gear !== 0) {
      const Tf = P.torque(rpmEng);
      let mult = 1;
      if (s.turbo) {
        const bt = tl * smoothstep(900, 2300, rpmEng);
        this.boost += (bt - this.boost) * (1 - Math.exp(-dt / (tl > 0.3 ? 0.35 : 0.15)));
        mult = 0.74 + 0.26 * this.boost;
      }
      const engBrake = (10 + (rpmEng / s.redline) * P.tqMax * 0.11) * (1 - tl);
      Te = tl * Tf * mult * this.powerScale - engBrake;
      this.revLimiter = rpmEng >= s.redline - 20;
      if (this.revLimiter && Te > 0) Te = 0;
      if (this.shiftT > 0) Te = 0;
      if (s.vNat && vf * 3.6 > s.vmax) Te = Math.min(Te, 0);
      if (rpmEng < s.idle * 0.8) Te = 0;
    }
    // gear changes
    if (this.gear > 0 && this.shiftT <= 0) {
      if (rpmIn > s.redline * 0.955 && this.gear < nG && Math.abs(vf) * 3.6 > P.gearSpeed[this.gear - 1] * 0.6) { this.gear++; this.shiftT = s.shiftTime; }
      else if (this.gear > 1) {
        const rpmDown = (rpmIn * P.ratios[this.gear - 2]) / P.ratios[this.gear - 1];
        if (rpmDown < s.redline * 0.9 && (rpmIn < s.redline * 0.3 || (tl > 0.85 && rpmIn < P.peakRpm * 0.6))) { this.gear--; this.shiftT = s.shiftTime * 0.6; }
      }
    }
    const Twheels = Te * ratio * P.eta;
    // front/rear split
    const nFr = this.wheels.filter((w) => w.front && w.drive && !w.detached).length;
    const nRr = this.wheels.filter((w) => !w.front && w.drive && !w.detached).length;
    const shareF = s.drive === 'AWD' ? (nRr ? s.frontShare : 1) : s.drive === 'FWD' ? 1 : 0;
    const shareR = 1 - shareF;
    const Ired = locked && this.shiftT <= 0 ? s.Ie * ratio * ratio : 0;

    // ---- suspension raycasts
    const W = this.wheels;
    const origin = [0, 0, 0];
    const comps = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      w.grounded = false;
      w.FnPrev = w.Fn;
      w.FmaxPrev = w.Fmax || 0;
      w.Fn = 0;
      if (w.detached) { w.susp = w.L0; this.stubContact(w, dt); continue; }
      const m = w.mount;
      origin[0] = b.pos[0] + R[0] * m[0] + R[3] * m[1] + R[6] * m[2];
      origin[1] = b.pos[1] + R[1] * m[0] + R[4] * m[1] + R[7] * m[2];
      origin[2] = b.pos[2] + R[2] * m[0] + R[5] * m[1] + R[8] * m[2];
      w.origin = [origin[0], origin[1], origin[2]];
      const hit = this.world.raycastStatic(origin, [-up[0], -up[1], -up[2]], w.L0 + w.R);
      if (hit) {
        w.hit = hit;
        const sl = hit.t - w.R;
        w.susp = clamp(sl, 0.0, w.L0);
        w.grounded = sl < w.L0 + 0.005;
        w.comp = Math.max(0, w.L0 - sl);
        w.normal = hit.n;
        w.contact = [origin[0] - up[0] * hit.t, origin[1] - up[1] * hit.t, origin[2] - up[2] * hit.t];
      } else {
        w.susp += (w.L0 - w.susp) * Math.min(1, dt * 12);
        w.comp = 0;
      }
      comps[i] = w.grounded ? w.comp : 0;
    }
    // spring/damper forces (before anti-roll), then conserve-force anti-roll transfer per axle
    const Fs0 = [0, 0, 0, 0];
    const tmp0 = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      if (!w.grounded || w.detached) continue;
      const n = w.normal, m = w.origin;
      b.velAt(m[0], m[1], m[2], tmp0);
      const compVel = -(tmp0[0] * n[0] + tmp0[1] * n[1] + tmp0[2] * n[2]);
      const k = w.front ? P.kF : P.kR, cc = w.front ? P.cF : P.cR;
      let Fs = k * w.comp + (compVel > 0 ? 0.3 : 0.5) * cc * compVel;
      if (w.susp < 0.04) Fs += k * 8 * (0.04 - w.susp);
      Fs0[i] = Math.max(Fs, 0);
    }
    const kArb = [P.kF * (s.arbF ?? 0.5), P.kR * (s.arbR ?? 0.4)];
    for (let ax = 0; ax < 2; ax++) {
      const L = ax * 2, Rr = L + 1;
      if (!(W[L].grounded && W[Rr].grounded)) continue;
      const A = kArb[ax] * (comps[L] - comps[Rr]);
      if (A > 0) { const t = Math.min(A, Fs0[Rr]); Fs0[L] += t; Fs0[Rr] -= t; }
      else { const t = Math.min(-A, Fs0[L]); Fs0[Rr] += t; Fs0[L] -= t; }
    }

    // ---- driveline torque distribution (open/LSD split, traction cap, surplus redistribution)
    const Tdrv = [0, 0, 0, 0], capT = [Infinity, Infinity, Infinity, Infinity];
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      if (!w.drive || w.detached) continue;
      const dshare = w.front ? shareF : shareR;
      const nAx = w.front ? nFr : nRr;
      if (!nAx) continue;
      let t = (Twheels * dshare) / nAx;
      if (nAx > 1) {
        const mate = W[i ^ 1];
        const lim = Math.abs(t) * 0.5 + 30;
        t += clamp((mate.omega - w.omega) * s.lsd * 0.5, -lim, lim);
      }
      Tdrv[i] = t;
      if (tcOn && inp.brake < 0.3) {
        const capF = clamp(1 - ((w.tcSlip || 0) - 0.25) * 3, 0.3, 1);
        capT[i] = 0.97 * capF * (w.FmaxPrev || 0) * w.R + 40;
      }
    }
    if (tcOn && inp.brake < 0.3) {
      let left = 0, head = 0;
      for (let i = 0; i < 4; i++) {
        if (Math.abs(Tdrv[i]) > capT[i]) { left += Tdrv[i] - Math.sign(Tdrv[i]) * capT[i]; Tdrv[i] = Math.sign(Tdrv[i]) * capT[i]; this.tcAct = 1; }
      }
      if (Math.abs(left) > 1) {
        for (let i = 0; i < 4; i++) if (W[i].drive && !W[i].detached && isFinite(capT[i])) head += Math.max(0, capT[i] - Math.abs(Tdrv[i]));
        if (head > 1) for (let i = 0; i < 4; i++) if (W[i].drive && !W[i].detached && isFinite(capT[i])) {
          const h = Math.max(0, capT[i] - Math.abs(Tdrv[i]));
          Tdrv[i] += Math.sign(left) * Math.min(h, (Math.abs(left) * h) / head);
        }
      }
    }
    let anyGround = false;
    this.absAct *= 0.9;
    const tmp = [0, 0, 0];
    for (let i = 0; i < 4; i++) {
      const w = W[i];
      const Tdrive = Tdrv[i];
      const dshare = w.front ? shareF : shareR;
      const nAx = w.front ? nFr : nRr;
      const Iw = P.Iw + (w.drive && dshare ? Ired * dshare / Math.max(nAx, 1) : 0);
      let Tbrake = 0;
      const bm = w.front ? P.bMax[0] : P.bMax[1];
      const fade = 1 - clamp(((w.bTemp || 25) - 450) / 800, 0, 0.55);
      if (this.bp > 0.015 || brk > 0.02) Tbrake += Math.max(brk, this.bp) * bm * fade;
      if (!w.front && inp.handbrake > 0.02) Tbrake += inp.handbrake * bm * 12;
      if (w.detached) { w.omega *= 0.99; continue; }

      if (!w.grounded) {
        // airborne: wheel free-spins
        let om = w.omega + ((Tdrive - 0.0) / Iw) * dt;
        const dec = (Tbrake + 8) * dt / Iw;
        om = Math.abs(om) <= dec ? 0 : om - Math.sign(om) * dec;
        w.omega = om;
        w.sig = 0; w.slipLong = 0; w.slipLat = 0;
        w.spin += w.omega * dt;
        continue;
      }
      anyGround = true;
      const n = w.normal;
      const Fn = Fs0[i];
      w.Fn = Fn;
      // wheel frame
      let ang = 0;
      if (w.front) {
        const t = Math.tan(clamp(dC, -0.9, 0.9));
        const half = (g.trackF / 2) * w.side;
        // Ackermann: inner wheel turns more
        ang = Math.atan((wbase * t) / (wbase - half * t));
      }
      w.steer = ang;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      let fx = fwd[0] * cs + right[0] * sn, fy = fwd[1] * cs + right[1] * sn, fz = fwd[2] * cs + right[2] * sn;
      const d = fx * n[0] + fy * n[1] + fz * n[2];
      fx -= n[0] * d; fy -= n[1] * d; fz -= n[2] * d;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      const lx = fy * n[2] - fz * n[1], ly = fz * n[0] - fx * n[2], lz = fx * n[1] - fy * n[0];
      const cp = w.contact;
      b.velAt(cp[0], cp[1], cp[2], tmp);
      const vlong = tmp[0] * fx + tmp[1] * fy + tmp[2] * fz;
      const vlat = tmp[0] * lx + tmp[1] * ly + tmp[2] * lz;
      w.vlong = vlong; w.vlat = vlat;
      const vden = Math.max(Math.abs(vlong), 3.0);
      const kappa = (w.omega * w.R - vlong) / vden;
      const KP = 0.12, TP = 0.13;
      const loadRef = (s.kg * G) / 4;
      const muEff = s.mu * clamp(1 - 0.2 * (Fn / loadRef - 1), 0.62, 1.2) * (w.flat ? 0.35 : 1) * (1 - 0.25 * (1 - clamp(w.health, 0, 1)));
      const mu = muEff * (w.surface ? 0.68 : 1) * (this.gripK || 1);
      const launchB = 1 + 0.3 * clamp(1 - Math.abs(vf) / 30, 0, 1);
      const Fmax = mu * Fn * launchB;
      const FmaxY = s.constLat ? mu * loadRef : mu * Fn;
      w.Fmax = Fmax;
      const tyre = (kap) => {
        const sx = kap / KP, sy = vlat / vden / TP;
        const sig = Math.hypot(sx, sy);
        if (sig < 1e-6) return [0, 0, 0];
        const gg = Math.sin(1.5 * Math.atan(1.732 * sig));
        return [Fmax * gg * sx / sig, -FmaxY * gg * sy / sig, sig];
      };
      const T0 = tyre(kappa);
      let Fx = T0[0], Fy = T0[1];
      const mc = s.kg / 4;
      if (Fy * vlat < 0) { const cap = (0.3 * mc * Math.max(Math.abs(vlat), 0.6)) / dt; if (Math.abs(Fy) > cap) Fy = Math.sign(Fy) * cap; }
      if (Fx * vlong < 0) { const cap = (0.3 * mc * Math.max(Math.abs(vlong), 0.6)) / dt; if (Math.abs(Fx) > cap) Fx = Math.sign(Fx) * cap; }
      w.sig = T0[2];
      w.slipLong = Math.abs(kappa);
      w.slipLat = Math.atan2(vlat, Math.max(Math.abs(vlong), 0.5));
      w.kappa = kappa;
      w.tcSlip = Math.max(0, (w.omega * w.R - vlong) / Math.max(Math.abs(vlong), 5));
      // wheel rotation (implicit in the tyre force), then apply the end-of-step tyre force
      const T1 = tyre(kappa + 0.01);
      const D = Math.max(0, ((T1[0] - T0[0]) / 0.01) * (w.R / vden));
      let Tb = Tbrake;
      if (this.assist >= 1 && brk > 0.02 && kappa < -0.15 && inp.handbrake < 0.1 && inp.throttle < 0.4) { Tb *= 0.12; this.absAct = 1; }
      // disc heat: brake power in, airflow cooling out
      w.bTemp = (w.bTemp || 25) + (Tb * Math.abs(w.omega) * dt) / 4200 - ((w.bTemp || 25) - 25) * (0.008 + 0.0025 * speed) * dt;
      const Trr = 0.013 * Fn * w.R;
      const sg = clamp(w.omega / 0.12, -1, 1);
      const Tres = (Tb + Trr) * sg;
      const dOm = (Tdrive - Tres - w.R * Fx) / (Iw / dt + w.R * D);
      let om = w.omega + dOm;
      if (om * w.omega < 0 && Tb + Trr > 0) om = 0; // brake can't reverse the wheel
      let FxEnd = Fx + D * (om - w.omega);
      if (this.hyperOn) {
        // extreme grip: integrate the wheel in small sub-steps so lock / spin cannot flip every physics step
        const ns = 12, hh = dt / ns; let o2 = w.omega, fs = 0;
        for (let k = 0; k < ns; k++) {
          const kp = (o2 * w.R - vlong) / vden, sx = kp / KP, sy = vlat / vden / TP, sg2 = Math.hypot(sx, sy);
          let fxk = sg2 < 1e-6 ? 0 : Fmax * Math.sin(1.5 * Math.atan(1.732 * sg2)) * sx / sg2;
          const lim = (0.6 * Iw * Math.abs(o2 - vlong / w.R)) / (w.R * hh) + 60;      // the road cannot do more than bring the wheel to ground speed within the sub-step
          if (Math.abs(fxk) > lim) fxk = Math.sign(fxk) * lim;
          let no;
          if (o2 === 0 && Math.abs(Tdrive - w.R * fxk) <= Tb + Trr) no = 0;          // locked wheel stays locked while the brake can hold it (stick-slip)
          else { no = o2 + (Tdrive - (Tb + Trr) * clamp(o2 / 0.12, -1, 1) - w.R * fxk) * hh / Iw; if (no * o2 < 0 && Tb + Trr > 0) no = 0; }
          o2 = no; fs += fxk;
        }
        om = o2; FxEnd = fs / ns;
      }
      FxEnd = clamp(FxEnd, -Fmax * 1.05, Fmax * 1.05);
      if (FxEnd * vlong < 0) { const cap = (0.3 * mc * Math.max(Math.abs(vlong), 0.6)) / dt; if (Math.abs(FxEnd) > cap) FxEnd = Math.sign(FxEnd) * cap; }
      if (this.hyperOn && brk > 0.2 && inp.throttle < 0.1) {   // braking to a stop: never push harder than what is needed to stop this wheel's share of the car (no forward / backward rocking)
        const cap2 = (0.45 * mc * Math.max(Math.abs(vlong), 0.25)) / dt;
        if (Math.abs(FxEnd) > cap2) FxEnd = Math.sign(FxEnd) * cap2;
        if (Math.abs(vlong) < 1.0) om = 0;
      }
      w.omega = om;
      w.Fx = FxEnd; w.Fy = Fy; w.T0 = T0[0];
      b.applyForce(n[0] * Fn, n[1] * Fn, n[2] * Fn, cp[0], cp[1], cp[2]);
      const rcH = this.hyperOn ? g.cgY : (s.rc ?? 0.18);
      b.applyForce(fx * FxEnd + lx * Fy, fy * FxEnd + ly * Fy, fz * FxEnd + lz * Fy, cp[0] + n[0] * rcH, cp[1] + n[1] * rcH, cp[2] + n[2] * rcH);
      w.spin += w.omega * dt;
    }
    this.airborne = !anyGround;

    // ---- locked-front hold: with the pedal fully down the locked front tyres bite (static friction),
    // so a launch-control burnout keeps the car in place; easing the pedal releases it gradually
    if (inp.brake > 0.6 && inp.throttle > 0.3 && speed < 6 && !this.airborne && this.gear > 0) {
      const k = 6 * clamp((inp.brake - 0.6) / 0.4, 0, 1) * dt;
      const vl = vf * (1 - Math.exp(-k));
      b.v[0] -= fwd[0] * vl; b.v[1] -= fwd[1] * vl * 0.0; b.v[2] -= fwd[2] * vl;
    }
    // ---- aero
    const CdA = P.CdA;
    if (speed > 0.1) {
      const fd = -0.5 * RHO * CdA * speed;
      b.applyForce(fd * v[0], fd * v[1], fd * v[2], b.pos[0], b.pos[1] + 0.2, b.pos[2]);
    }
    const down = 0.5 * RHO * s.clA * vf * vf;
    if (down > 1) b.applyForce(-up[0] * down, -up[1] * down, -up[2] * down, b.pos[0] + fwd[0] * 0.1, b.pos[1], b.pos[2] + fwd[2] * 0.1);
    // casual assist: yaw damping
    if (this.assist === 2 && speed > 8) {
      const yaw = b.w[0] * up[0] + b.w[1] * up[1] + b.w[2] * up[2];
      const slip = Math.abs(W[2].slipLat) + Math.abs(W[3].slipLat);
      if (slip > 0.18) { const t = -yaw * s.kg * 0.9 * clamp((slip - 0.18) * 3, 0, 1); b.T[0] += up[0] * t; b.T[1] += up[1] * t; b.T[2] += up[2] * t; }
    }
    // body roll / pitch damping (anti-roll geometry + dampers)
    {
      const rr = b.w[0] * fwd[0] + b.w[1] * fwd[1] + b.w[2] * fwd[2];
      const pr = b.w[0] * right[0] + b.w[1] * right[1] + b.w[2] * right[2];
      const tr = -P.cRoll * (s.rollD ?? 1) * rr, tp = -P.cPitch * (s.rollD ?? 1) * pr;
      b.T[0] += fwd[0] * tr + right[0] * tp; b.T[1] += fwd[1] * tr + right[1] * tp; b.T[2] += fwd[2] * tr + right[2] * tp;
    }
    this.distance += Math.abs(vf) * dt;
  }
}
