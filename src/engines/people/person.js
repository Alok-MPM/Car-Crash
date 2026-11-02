// People engine: a walking character that can leave the car, walk (and run / jump), enter open doorways and get back in.
// Physics: a rotation-locked box body inside the shared world, so walls, floors, cars and rubble all collide with it for free.
import { Body, GROUP } from '../../core/physics.js';
import { m4, clamp } from '../../core/math.js';
import { T } from '../buildings/render.js';

const SKIN = [0.78, 0.55, 0.42], SHIRT = [0.16, 0.3, 0.55], PANTS = [0.14, 0.14, 0.17], SHOE = [0.07, 0.07, 0.08];
const HALF_H = 0.9;

export class Person {
  constructor(ctx) {
    this.ctx = ctx;
    this.active = false;
    this.yaw = 0; this.walkT = 0; this.speed = 0; this.body = null;
    this.M = new Float32Array(16); this.L = new Float32Array(16); this.O = new Float32Array(16); this.F = new Float32Array(16); this.D = m4.create();
    this.meshes = null;
  }
  _mesh(tile, tint, dims) { return this.ctx.scene.structures.rubbleMesh(tile, tint, dims); }
  _build() {
    this.meshes = {
      torso: this._mesh(T.fabric, SHIRT, [0.42, 0.6, 0.24]),
      head: this._mesh(T.white, SKIN, [0.22, 0.25, 0.22]),
      leg: this._mesh(T.fabric, PANTS, [0.17, 0.85, 0.19]),
      arm: this._mesh(T.fabric, SHIRT, [0.12, 0.6, 0.13]),
      hand: this._mesh(T.white, SKIN, [0.11, 0.12, 0.11]),
    };
  }
  spawn(pos, yaw) {
    this.despawn();
    const b = new Body({ mass: 75, pos: [pos[0], pos[1] + HALF_H + 0.05, pos[2]], q: [0, 0, 0, 1], fric: 0.05, rest: 0, group: GROUP.PROP, mask: GROUP.STATIC | GROUP.CAR | GROUP.DEBRIS | GROUP.PROP, angDamp: 1, canSleep: false });
    b.addBox([0.26, HALF_H, 0.2]);
    b.invIl = [0, 0, 0, 0, 0, 0, 0, 0, 0];   // never tips over
    b.person = true;
    this.ctx.world.add(b);
    this.body = b; this.yaw = yaw; this.active = true; this.speed = 0;
  }
  despawn() { if (this.body) { this.ctx.world.remove(this.body); this.body = null; } this.active = false; }
  get feet() { const p = this.body.pos; return [p[0], p[1] - HALF_H, p[2]]; }
  get grounded() { const b = this.body; return b.gcT !== undefined && this.ctx.world.time - b.gcT < 0.12 || b.pos[1] - HALF_H < 0.06; }

  // inp: {fwd -1..1, turn -1..1, run 0/1, jump bool}
  update(dt, inp) {
    const b = this.body; if (!b) return;
    this.yaw -= inp.turn * 2.4 * dt;
    const v = inp.fwd * (inp.run ? 6.2 : 2.6);
    const tx = Math.sin(this.yaw) * v, tz = Math.cos(this.yaw) * v;
    const k = 1 - Math.exp(-dt * (this.grounded ? 12 : 2));
    b.v[0] += (tx - b.v[0]) * k; b.v[2] += (tz - b.v[2]) * k;
    if (inp.jump && this.grounded) b.v[1] = 4.2;
    b.wake && b.wake();
    this.speed = Math.hypot(b.v[0], b.v[2]);
    this.walkT += dt * (this.speed * 1.9);
    if (b.pos[1] < -20) { b.pos[1] = 2; b.v = [0, 0, 0]; }
  }

  draw() {
    if (!this.active || !this.body) return;
    if (!this.meshes) this._build();
    const r = this.ctx.r, M = this.M, L = this.L, O = this.O, F = this.F, D = this.D;
    const f = this.feet, h = this.yaw / 2;
    m4.fromTRS(M, f, [0, Math.sin(h), 0, Math.cos(h)], 1);
    const sw = Math.sin(this.walkT) * clamp(this.speed / 3, 0, 1) * 0.9;
    const part = (mesh, x, top, len, ang) => {
      m4.fromTRS(L, [x, top, 0], [Math.sin(ang / 2), 0, 0, Math.cos(ang / 2)], 1);
      m4.ident(D); D[13] = -len / 2;
      m4.mul(O, L, D); m4.mul(F, M, O);
      r.add(mesh, F, { cast: true });
    };
    const at = (mesh, x, y, z) => { m4.ident(D); D[12] = x; D[13] = y; D[14] = z; m4.mul(F, M, D); r.add(mesh, F, { cast: true }); };
    part(this.meshes.leg, -0.1, 0.85, 0.85, sw); part(this.meshes.leg, 0.1, 0.85, 0.85, -sw);
    part(this.meshes.arm, -0.27, 1.4, 0.6, -sw); part(this.meshes.arm, 0.27, 1.4, 0.6, sw);
    at(this.meshes.torso, 0, 1.12, 0);
    at(this.meshes.head, 0, 1.58, 0.01);
  }
}
