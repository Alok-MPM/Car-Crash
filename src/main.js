// Crash Yard: game loop, input, camera, HUD, menus.
import { Renderer } from './core/gfx.js';
import { World, GROUP } from './core/physics.js';
import { CARS, getCar } from './engines/cars/cars.js';
import { Car, drawDebris } from './engines/cars/car.js';
import { Person } from './engines/people/person.js';
import { initLab } from './ui/lab.js';
import { Scene } from './engines/land/world.js';
import { FX } from './core/fx.js';
import { Sfx } from './core/audio.js';
import { paintDecals } from './engines/cars/carmodel.js';
import { SHAPES } from './engines/cars/shapes.js';
import { m4, clamp, lerp, smoothstep } from './core/math.js';

const $ = (id) => document.getElementById(id);
const isTouch = matchMedia('(pointer:coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.documentElement.classList.add('touch');

// ---------- persisted settings ----------
const defaults = { car: 'tauro', color: 0, assist: 1, tod: 'day', quality: isTouch ? 1 : 2, fps: 60, units: 'kmh', tilt: 0, sound: 1 };
let S = { ...defaults };
try { Object.assign(S, JSON.parse(localStorage.getItem('crashyard') || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem('crashyard', JSON.stringify(S)); } catch (e) {} };

// ---------- core objects ----------
let r;
try { r = new Renderer($('gl'), { quality: S.quality }); } catch (e) { $('loading').style.display = 'none'; $('err').style.display = 'flex'; console.error(e); throw e; }
const world = new World();
const fx = new FX();
const sfx = new Sfx();
const decalCache = {}, plateCache = {};
const ctx = {
  r, world, fx, sfx, debris: [], time: 0, explosions: true, decalCanvas: true,
  getDecalTex(spec, B) {
    if (decalCache[spec.id]) return decalCache[spec.id];
    const c = document.createElement('canvas'); c.width = 1024; c.height = 1024;
    paintDecals(c.getContext('2d'), 1024, 1024, spec, B);
    return (decalCache[spec.id] = r.texFromCanvas(c, { mip: true }));
  },
  plateTex(spec, text) {
    text = text || (spec.id.slice(0, 3).toUpperCase() + ' ' + ((Math.random() * 900 + 100) | 0));
    if (plateCache[text]) return plateCache[text];
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#f3f3ee'; g.fillRect(0, 0, 256, 64);
    g.fillStyle = '#1c3d99'; g.fillRect(0, 0, 22, 64);
    g.strokeStyle = '#222'; g.lineWidth = 3; g.strokeRect(2, 2, 252, 60);
    g.fillStyle = '#111'; g.font = 'bold 40px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 138, 34);
    return (plateCache[text] = r.texFromCanvas(c, {}));
  },
  wheelStyle: (spec) => SHAPES[spec.id].wheelStyle,
  blobs: { push: (body, geo) => fx.blob(body, geo) },
  onDamage(car, depth, E, p) {
    if (car === player) { shake = Math.max(shake, clamp(depth * 2.2, 0.15, 1.4)); redFlash = Math.max(redFlash, clamp(depth * 1.2, 0.1, 0.8)); if (depth > 0.55 && slowT <= 0) slowT = 1.3; }
  },
};
let scene = null;
let cars = [];
let player = null;
let shake = 0, redFlash = 0, slowT = 0, timeScale = 1, userSlow = false, paused = false;

// ---------- quality ----------
function applyQuality() {
  const q = S.quality;
  r.quality = q;
  r.setShadowSize(q === 2 ? 2048 : q === 1 ? 1024 : 0);
  r.shadowRadius = q === 2 ? 55 : 42;
  r.dprScale = [0.6, 0.85, 1][q];
  fx.quality = [0.35, 0.7, 1][q] * (ctx.load || 1);
  resize();
}
function resize() { r.resize(window.innerWidth, window.innerHeight); }
addEventListener('resize', resize);

// ---------- cars ----------
const SPAWN = { pos: [0, 0, 40], yaw: 0 };
// ---------- test tuning box: type a top speed, the car gets the power / torque / grip / brakes for it ----------
let topSet = 0, tcMode = 'auto';
function applyTop(kmh) {
  if (!player) return;
  const sp = player.vehicle.setTop(kmh);
  player.spec = sp; player.vehicle.tcMode = tcMode;
  const box = $('spdIn'); if (box) box.value = kmh ? Math.round(kmh) : '';
  toast(kmh ? `Top speed ${Math.round(kmh)} km/h  -  ${Math.round(sp.hp).toLocaleString()} hp` : 'Stock engine', 'Test tuning');
}

function makePlayer(keepPose) {
  const spec = getCar(S.car);
  let pos = SPAWN.pos, yaw = SPAWN.yaw;
  if (player) { cars.splice(cars.indexOf(player), 1); player.dispose(); }
  const c = new Car(ctx, spec, { color: spec.colors[S.color % spec.colors.length], pos: [pos[0], spec.geo.cgY + 0.15, pos[2]], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], assist: S.assist });
  c.vehicle.reset(pos, yaw);
  cars.unshift(c);
  player = c;
  if (topSet) applyTop(topSet);
  stats.top = stats.top || 0;
  stats.armed = true; stats.t100 = null; stats.t200 = null;
  return c;
}
function spawnNPC(id, x, z, yaw, colorIdx) {
  const spec = getCar(id);
  const c = new Car(ctx, spec, { color: spec.colors[(colorIdx ?? Math.floor(Math.random() * spec.colors.length)) % spec.colors.length], pos: [x, spec.geo.cgY + 0.1, z], q: [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)], npc: true });
  c.vehicle.reset([x, 0, z], yaw);
  cars.push(c);
  return c;
}
function populateNPCs() {
  const ids = CARS.map((c) => c.id);
  let k = 0;
  for (let row = 0; row < 2; row++) for (let i = 0; i < 4; i++) {
    const id = ids[(k++ * 5 + 1) % ids.length];
    spawnNPC(id, 104 + i * 3.1 * 2 + 1.5 * (row), row ? -105 : -143, row ? 0.0 : Math.PI, k);
  }
  // a row of cars to jump over
  for (let i = 0; i < 4; i++) spawnNPC(ids[(i * 3) % ids.length], 96 + i * 0.0, -476 - i * 3.0 + 0, Math.PI / 2, i + 2);
}

// ---------- impacts ----------
let soundBudget = 0;
function blast(pos, R = 11, power = 10) {
  fx.explosion(pos); sfx.boom(pos);
  if (scene.land && scene.land.roadHole && pos[1] < 4) scene.land.roadHole(pos[0], pos[2], Math.max(0.9, R * 0.2));
  lastBlast = { pos: pos.slice(), t: 0 };
  scene.wakeAround(pos[0], pos[2], R + 4);                                    // an explosion reaches buildings and props that were asleep
  shake = Math.max(shake, clamp(1.2 - dist(pos, camPos) / 40, 0.1, 1.2));
  for (const o of world.bodies) {
    if (o.fixed) continue;
    const dx = o.pos[0] - pos[0], dy = o.pos[1] - pos[1] + 0.3, dz = o.pos[2] - pos[2];
    const d = Math.hypot(dx, dy, dz);
    if (d < R && d > 0.05) {
      o.wake();
      const k = (1 - d / R) * power * Math.min(1.5, 700 / (o.mass || 50)) + (1 - d / R) * 3;
      o.v[0] += (dx / d) * k; o.v[1] += (dy / d) * k + k * 0.4; o.v[2] += (dz / d) * k;
      o.w[0] += (Math.random() - 0.5) * k * 0.5; o.w[2] += (Math.random() - 0.5) * k * 0.5;
      const pr = o.userData && o.userData.prop;
      if (pr && pr.explosive && !pr.dead && d < 5) setTimeout(() => boomBarrel(pr), 80 + Math.random() * 260);
      const cr = o.userData && o.userData.car;
      if (cr && d < R * 0.75) {
        const e = { p: o.pos.slice(), n: [dx / d, dy / d, dz / d], speed: 8 * (1 - d / R) + 2 };
        cr.impact(e, { fixed: false, mass: 400, group: GROUP.PROP }, true);
        if (d < 2.5 && cr.fire === 0 && Math.random() < 0.35) { cr.fire = 0.01; cr.leak = false; }
      }
    }
  }
}
function boomBarrel(pr) {
  if (pr.dead) return;
  pr.dead = true;
  world.remove(pr.body);
  blast(pr.body.pos.slice(), 11, 10);
}
let lastBlast = null;
ctx.blast = blast;
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

world.onImpact = (e) => {
  scene.structures.onImpact(e);
  const ca = e.a.userData && e.a.userData.car, cb = e.b.userData && e.b.userData.car;
  if (ca) ca.impact(e, e.b, true);
  if (cb) cb.impact(e, e.a, false);
  for (const b of [e.a, e.b]) {
    const pr = b.userData && b.userData.prop;
    if (pr && pr.explosive && !pr.dead && e.speed > 5.5) boomBarrel(pr);
  }
  // wake parked NPC (release handbrake) when hit
  for (const c of [ca, cb]) if (c && c.parked && e.speed > 2.5) { c.parked = false; c.vehicle.in.handbrake = 0; }
  if (soundBudget > 0 && e.speed > 2) {
    soundBudget--;
    if (ca || cb) sfx.crash(e.p, clamp(e.speed / 22, 0.05, 1), e.speed > 7);
    else sfx.tap(e.p, e.speed);
  }
};
let scrape = 0;
let propDmg = 0;
world.onScrape = (body, c) => { if (body.userData && body.userData.car === player) scrape = Math.max(scrape, clamp(c.vt0 / 15, 0, 1)); };

// ---------- input ----------
const keys = {};
const inp = { throttle: 0, brake: 0, steer: 0, hb: 0 };
let kbThr = 0, kbBrk = 0, pedThr = 0, pedBrk = 0, steerKb = 0, tiltSteer = 0, touchSteer = 0, touchGas = 0, touchBrk = 0, touchHb = 0, touchHorn = 0;
let horn = false;
const person = new Person(ctx);
ctx.person = person;
// ---------- everyday life: market, fridge, stove, table, bed ----------
const life = { cash: 500, veg: 0, meal: 0, hunger: 60, cooking: 0 };
function bag() { const bc = $('bCar'); if (bc) bc.style.display = person.active ? '' : 'none'; const e = $('bag'); if (e) { e.style.display = person.active ? 'block' : 'none'; e.innerHTML = `<b>Rs ${life.cash}</b> &nbsp; Vegetables ${life.veg} &nbsp; Meals ${life.meal} &nbsp; Hunger ${Math.round(life.hunger)}%`; } }
function useThing(act) {
  if (act === 'market') { if (life.cash < 40) { toast('Not enough cash', 'Market'); return; } life.cash -= 40; life.veg += 1; toast('Bought 1 kg vegetables  -Rs 40', 'Market'); }
  else if (act === 'stove') {
    if (life.cooking > 0) { toast('Still cooking...', 'Kitchen'); return; }
    if (life.veg < 1) { toast('You need vegetables - buy them from the market', 'Kitchen'); return; }
    life.veg -= 1; life.cooking = 6; toast('Cooking...', 'Kitchen');
  }
  else if (act === 'fridge') toast(`Fridge: ${life.veg} kg vegetables, ${life.meal} meals`, 'Kitchen');
  else if (act === 'eat') { if (life.meal < 1) { toast('No cooked food yet - cook something first', 'Dining'); return; } life.meal -= 1; life.hunger = Math.max(0, life.hunger - 60); toast('Ate a meal. Hunger down.', 'Dining'); }
  else if (act === 'sink') toast('Washed hands', 'Kitchen');
  else if (act === 'bed') toast('Rested for a while', 'Bedroom');
  bag();
}
setInterval(() => { if (life.cooking > 0) { life.cooking -= 1; if (life.cooking <= 0) { life.meal += 1; toast('Meal is ready - eat at the table (F)', 'Kitchen'); } } life.hunger = Math.min(100, life.hunger + 0.15); bag(); }, 1000);
function toggleWalk() {
  if (menuOpen) return;
  const c = player, b = c.body;
  if (!person.active) {
    if (c.vehicle.speed > 2.5) { toast('Stop the car first', ''); return; }
    const g = c.spec.geo;
    const p = b.toWorld([-(g.W / 2 + 0.7), 0, -g.L * 0.1]);
    person.spawn([p[0], 0.05, p[2]], camYaw);
    bag();
    toast('Walking - doors open by themselves. Car button: back in the car from anywhere', '');
    return;
  }
  // walking: nearest closed door first, then things in the house (stove, market...), then the car
  const dr = scene.structures.toggleDoorNear && scene.structures.toggleDoorNear(person.feet, 2.0);
  if (dr) { toast(dr === 'opened' ? 'Door opened' : dr === 'closed' ? 'Door closed' : 'Step out of the doorway first', ''); return; }
  const use = scene.structures.interactNear && scene.structures.interactNear(person.feet, 1.4);
  if (use) { useThing(use.act); return; }
  backToCar();
}
function backToCar() { if (!person.active) return; person.despawn(); bag(); toast('Back in the car', ''); }
addEventListener('keydown', (e) => { if (e.target && e.target.tagName === 'INPUT') return; if (e.code === 'KeyF' && !e.repeat) toggleWalk(); });
addEventListener('keydown', (e) => {
  if (e.target && e.target.tagName === 'INPUT') return;
  if (e.repeat) { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault(); return; }
  keys[e.code] = true;
  if (e.code === 'KeyC') cycleCam();
  if (e.code === 'KeyR') flipUpright();
  if (e.code === 'KeyQ') toggleRev();
  if (e.code === 'KeyE') repair();
  if (e.code === 'KeyT') nextTod();
  if (e.code === 'KeyM') toggleSound();
  if (e.code === 'KeyB') toggleSlow();
  if (e.code === 'KeyP') paused = !paused;
  if (e.code === 'KeyN') spawnAhead();
  if (e.code === 'Escape') toggleMenu();
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let gpPrev = {};
function readInput(dt) {
  let th = 0, br = 0, st = 0, hb = 0, hn = false;
  // keyboard
  const L = keys.KeyA || keys.ArrowLeft, Rr = keys.KeyD || keys.ArrowRight;
  const tgt = (Rr ? 1 : 0) - (L ? 1 : 0);
  const speed = player ? player.vehicle.speed : 0;
  const rate = tgt === 0 ? 6 : tgt * steerKb < 0 ? 8 : 3.2 / (1 + speed / 40);
  steerKb += clamp(tgt - steerKb, -rate * dt, rate * dt);
  st = steerKb;
  kbThr += ((keys.KeyW || keys.ArrowUp ? 1 : 0) - kbThr) * (1 - Math.exp(-dt * ((keys.KeyW || keys.ArrowUp) ? 7 : 14)));
  kbBrk += ((keys.KeyS || keys.ArrowDown ? 1 : 0) - kbBrk) * (1 - Math.exp(-dt * ((keys.KeyS || keys.ArrowDown) ? 9 : 16)));
  th = kbThr < 0.01 ? 0 : kbThr; br = kbBrk < 0.01 ? 0 : kbBrk;
  hb = keys.Space ? 1 : 0;
  hn = !!keys.KeyH;
  // gamepad
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  for (const gp of gps) {
    if (!gp || !gp.connected) continue;
    const ax = gp.axes[0] || 0;
    if (Math.abs(ax) > 0.08) st = clamp(ax * 1.1, -1, 1);
    const rt = gp.buttons[7] ? gp.buttons[7].value : 0, lt = gp.buttons[6] ? gp.buttons[6].value : 0;
    th = Math.max(th, rt); br = Math.max(br, lt);
    if (gp.buttons[0] && gp.buttons[0].pressed) hb = 1;
    if (gp.buttons[2] && gp.buttons[2].pressed) hn = true;
    const press = (i, fn) => { const p = gp.buttons[i] && gp.buttons[i].pressed; if (p && !gpPrev[i]) fn(); gpPrev[i] = p; };
    press(3, cycleCam); press(1, flipUpright); press(9, toggleMenu); press(4, repair);
  }
  // touch
  if (isTouch) {
    pedThr += (touchGas - pedThr) * (1 - Math.exp(-dt * (touchGas > pedThr ? 16 : 10)));
    pedBrk += (touchBrk - pedBrk) * (1 - Math.exp(-dt * (touchBrk > pedBrk ? 16 : 10)));
    th = Math.max(th, pedThr < 0.01 ? 0 : pedThr); br = Math.max(br, pedBrk < 0.01 ? 0 : pedBrk); hb = Math.max(hb, touchHb); hn = hn || !!touchHorn;
    if (S.tilt) st = clamp(tiltSteer, -1, 1); else if (Math.abs(touchSteer) > 0.02) st = touchSteer;
  }
  inp.throttle = th; inp.brake = br; inp.steer = st; inp.hb = hb;
  if (isTouch) setPed();
  horn = hn;
}

const pedEls = {};
function setPed() {
  for (const [id, val] of [['gas', inp.throttle], ['brk', inp.brake]]) {
    const el = pedEls[id] || (pedEls[id] = { f: $(id).querySelector('.fill'), s: $(id).querySelector('small'), v: -1 });
    const p = Math.round(val * 100);
    if (p !== el.v) { el.v = p; el.f.style.height = p + '%'; el.s.textContent = p + '%'; }
  }
}
// touch controls
function bindTouch() {
  const hold = (el, on, off) => {
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); el.classList.add('on'); on(e); e.preventDefault(); });
    const up = (e) => { el.classList.remove('on'); off(e); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  // analog pedals: swipe up/down inside the pedal; the box stays fixed, only the fill level moves
  const pedal = (el, set) => {
    const lvl = (e) => { const rc = el.getBoundingClientRect(); const y = 1 - (e.clientY - rc.top) / rc.height; return clamp((y - 0.04) / 0.88, 0, 1); };
    el.addEventListener('pointerdown', (e) => { el.setPointerCapture(e.pointerId); el.classList.add('on'); set(lvl(e)); e.preventDefault(); });
    el.addEventListener('pointermove', (e) => { if (el.hasPointerCapture(e.pointerId)) set(lvl(e)); });
    const up = () => { el.classList.remove('on'); set(0); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  pedal($('gas'), (x) => (touchGas = x));
  pedal($('brk'), (x) => (touchBrk = x));
  hold($('hbk'), () => (touchHb = 1), () => (touchHb = 0));
  $('revT').addEventListener('pointerdown', (e) => { toggleRev(); e.preventDefault(); });
  hold($('hornT'), () => (touchHorn = 1), () => (touchHorn = 0));
  const pad = $('steerPad'), knob = $('steerKnob');
  const setS = (e) => {
    const rc = pad.getBoundingClientRect();
    const x = clamp(((e.clientX - rc.left) / rc.width) * 2 - 1, -1, 1);
    touchSteer = Math.sign(x) * Math.pow(Math.abs(x), 1.15);
    knob.style.left = `calc(${50 + x * 36}% - 40px)`;
  };
  pad.addEventListener('pointerdown', (e) => { pad.setPointerCapture(e.pointerId); pad.classList.add('on'); setS(e); e.preventDefault(); });
  pad.addEventListener('pointermove', (e) => { if (pad.hasPointerCapture(e.pointerId)) setS(e); });
  const rel = () => { pad.classList.remove('on'); touchSteer = 0; knob.style.left = 'calc(50% - 40px)'; };
  pad.addEventListener('pointerup', rel); pad.addEventListener('pointercancel', rel);
}
bindTouch();
addEventListener('deviceorientation', (e) => {
  if (!S.tilt) return;
  const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
  let g = ang === 90 ? -e.beta : ang === -90 || ang === 270 ? e.beta : e.gamma;
  if (g == null) return;
  tiltSteer = clamp(g / 28, -1, 1);
});

// ---------- camera ----------
const CAMS = ['Chase', 'Far chase', 'Hood', 'Bumper', 'Orbit', 'TV'];
let camMode = 0;
let camPos = [0, 3, 60], camYaw = 0, camLook = [0, 1, 0], camFov = 60, orbitYaw = 0.6, orbitPitch = 0.22, orbitDist = 7.5, tvPos = null;
function cycleCam() { camMode = (camMode + 1) % CAMS.length; tvPos = null; toast(CAMS[camMode] + ' cam', ''); }
let dragging = false, dragId = -1, lastX = 0, lastY = 0;
$('gl').addEventListener('pointerdown', (e) => { dragging = true; dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY; });
addEventListener('pointerup', (e) => { if (e.pointerId === dragId) dragging = false; });
addEventListener('pointercancel', (e) => { if (e.pointerId === dragId) dragging = false; });
addEventListener('pointermove', (e) => {
  if (!dragging || e.pointerId !== dragId) return;
  if (camMode === 4 || menuOpen) { orbitYaw -= (e.clientX - lastX) * 0.006; orbitPitch = clamp(orbitPitch + (e.clientY - lastY) * 0.005, -0.1, 1.2); }
  lastX = e.clientX; lastY = e.clientY;
});
addEventListener('wheel', (e) => { orbitDist = clamp(orbitDist * (1 + Math.sign(e.deltaY) * 0.08), 3.5, 30); }, { passive: true });
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; };

let lab = null;
function updateCamera(dt) {
  if (lab && lab.active) { const c = lab.cam(); camPos = c.eye; camLook = c.look; camFov = c.fov; return; }
  if (person.active && person.body) {
    const pp = person.body.pos;
    camYaw += angDiff(person.yaw, camYaw) * (1 - Math.exp(-dt * 4));
    camFov += (62 - camFov) * (1 - Math.exp(-dt * 3));
    const hd = [-Math.sin(camYaw) * 3.6, 0.35, -Math.cos(camYaw) * 3.6], hl = Math.hypot(hd[0], hd[1], hd[2]);
    const o = [pp[0], pp[1] + 0.9, pp[2]], dn = [hd[0] / hl, hd[1] / hl, hd[2] / hl];
    const hit = world.raycastStatic(o, dn, hl + 0.3);      // pull the camera in when a wall is behind the person
    const k = hit ? Math.max(0.5, hit.t - 0.3) / hl : 1;
    const eye = [o[0] + hd[0] * Math.min(1, k), o[1] + hd[1] * Math.min(1, k), o[2] + hd[2] * Math.min(1, k)];
    camPos = eye; camLook = [pp[0] + Math.sin(camYaw) * 3, pp[1] + 0.55, pp[2] + Math.cos(camYaw) * 3];
    return;
  }
  const c = player;
  const b = c.body, g = c.spec.geo;
  const R = b.R;
  const fwd = [-R[6], 0, -R[8]];
  const fl = Math.hypot(fwd[0], fwd[2]) || 1;
  let hdg = Math.atan2(fwd[0] / fl, fwd[2] / fl); // yaw of body forward (x/z)
  const sp = c.vehicle.speed;
  if (sp > 4) {
    const vh = Math.atan2(b.v[0], b.v[2]);
    const dv = angDiff(vh, hdg);
    if (c.vehicle.vf > 0 && Math.abs(dv) < 1.9) hdg += dv * 0.45; // follow velocity a little in drifts
  }
  const k = 1 - Math.exp(-dt * (menuOpen ? 2 : 5.5));
  camYaw += angDiff(hdg, camYaw) * k;
  const tgtFov = 58 + clamp(sp / 95, 0, 1) * 20 + (camMode === 2 || camMode === 3 ? 12 : 0);
  camFov += (tgtFov - camFov) * (1 - Math.exp(-dt * 3));
  const cp = [b.pos[0], b.pos[1], b.pos[2]];
  let eye, look;
  if (menuOpen) {
    orbitYaw += dt * (dragging ? 0 : 0.22);
    const d = g.L * 1.95 + 1.4;
    const pitch = 0.2;
    eye = [cp[0] + Math.sin(orbitYaw) * Math.cos(pitch) * d, cp[1] + 0.45 + Math.sin(pitch) * d, cp[2] + Math.cos(orbitYaw) * Math.cos(pitch) * d];
    // look slightly above the car so it sits in the lower-middle of the screen with room for the name above the nav bar
    const rx = Math.cos(orbitYaw), rz = -Math.sin(orbitYaw), sh = d * 0.13;
    look = [cp[0] - rx * sh, cp[1] + 0.45, cp[2] - rz * sh];
    camFov = 34;
  } else if (camMode === 0 || camMode === 1) {
    const far = camMode === 1 ? 1.9 : 1;
    const dist = (g.L * 0.95 + 2.6 + clamp(sp / 80, 0, 1) * 1.6) * far;
    const h = (1.35 + g.H * 0.55) * (camMode === 1 ? 1.5 : 1) + clamp(sp / 120, 0, 1) * 0.3;
    eye = [cp[0] - Math.sin(camYaw) * dist, cp[1] + h, cp[2] - Math.cos(camYaw) * dist];
    look = [cp[0] + Math.sin(camYaw) * 4 * far, cp[1] + 0.7, cp[2] + Math.cos(camYaw) * 4 * far];
  } else if (camMode === 2) {
    eye = b.toWorld([0, g.H * 0.55 + 0.0, -g.L * 0.12]);
    const f = [-R[6], -R[7], -R[8]];
    look = [eye[0] + f[0] * 20, eye[1] + f[1] * 20 - 0.5, eye[2] + f[2] * 20];
  } else if (camMode === 3) {
    eye = b.toWorld([0, 0.05 - 0.2, -g.L * 0.5 + g.zFA * 0 + 0.0]);
    const f = [-R[6], -R[7], -R[8]];
    look = [eye[0] + f[0] * 20, eye[1] + f[1] * 20, eye[2] + f[2] * 20];
  } else if (camMode === 4) {
    const d = Math.max(orbitDist, g.L * 1.4);
    eye = [cp[0] + Math.sin(orbitYaw) * Math.cos(orbitPitch) * d, cp[1] + 0.4 + Math.sin(orbitPitch) * d, cp[2] + Math.cos(orbitYaw) * Math.cos(orbitPitch) * d];
    look = [cp[0], cp[1] + 0.5, cp[2]];
  } else {
    if (!tvPos || dist3(tvPos, cp) > 90) { const a = camYaw + 0.9 + Math.random() * 0.6; tvPos = [cp[0] + Math.sin(a) * 55 + b.v[0] * 1.2, 2.5 + Math.random() * 2, cp[2] + Math.cos(a) * 55 + b.v[2] * 1.2]; }
    eye = tvPos; look = [cp[0], cp[1] + 0.6, cp[2]];
    camFov = clamp(18 + 900 / Math.max(25, dist3(tvPos, cp)), 18, 50);
  }
  if (shake > 0.01) {
    const s = shake * 0.14;
    eye = [eye[0] + (Math.random() - 0.5) * s, eye[1] + (Math.random() - 0.5) * s, eye[2] + (Math.random() - 0.5) * s];
    shake *= Math.exp(-dt * 5);
  }
  if (c.vehicle.speed > 60 && (camMode === 2 || camMode === 3)) { const j = (c.vehicle.speed - 60) * 0.0006; eye[1] += (Math.random() - 0.5) * j; }
  eye[1] = Math.max(eye[1], 0.35);
  camPos = eye; camLook = look;
}
const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------- game actions ----------
let reverseOn = 0;
function toggleRev() { reverseOn = reverseOn ? 0 : 1; const el = $('revT'); if (el) el.textContent = reverseOn ? 'R' : 'D'; toast(reverseOn ? 'Reverse gear' : 'Drive', ''); }
function flipUpright() {
  if (!player) return;
  const b = player.body;
  const yaw = Math.atan2(b.R[6], b.R[8]);
  b.setPose([b.pos[0], player.spec.geo.cgY + 0.6, b.pos[2]], yawQuat(yaw));
  b.v = [0, 0, 0]; b.w = [0, 0, 0];
  toast('Upright', '');
}
function yawQuat(yaw) { return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)]; }
function repair() {
  if (!player) return;
  const b = player.body;
  const fwd = [-b.R[6], 0, -b.R[8]];
  const yaw = Math.atan2(-fwd[0], -fwd[2]);
  const pos = [b.pos[0], 0, b.pos[2]];
  const spec = player.spec;
  const old = player; old.dead = true; old.fire = -1; old.exploded = true;
  for (let i = ctx.debris.length - 1; i >= 0; i--) if (ctx.debris[i].car === old) ctx.debris[i].t = 999;
  cars.splice(cars.indexOf(player), 1); player.dispose();
  if (fx.clearNear) fx.clearNear(pos, 14);
  const c = new Car(ctx, spec, { color: spec.colors[S.color % spec.colors.length], pos: [pos[0], spec.geo.cgY + 0.2, pos[2]], q: yawQuat(yaw), assist: S.assist });
  c.vehicle.reset(pos, yaw);
  cars.unshift(c); player = c;
  toast('Repaired', 'Fresh from the shop');
}
function gotoCity() {
  if (!player || !scene.cityPlan) return;
  const P = scene.cityPlan; if (person.active) backToCar();
  // start on the main east-west road of the city, driving east
  const bz = P.roads.find((q) => q.type === 'bazaar' && q.axis === 'x'); const z0 = bz ? bz.c + 2.5 : P.cz;
  player.vehicle.reset([P.cx - P.ext + 24, 0, z0], -Math.PI / 2);
  scene.city.prime([{ x: P.cx - P.ext + 24, z: z0 }, { x: P.cx, z: z0 }], 12);
  camYaw = -Math.PI / 2;
  toast('City: roads, lots, parking, farms around. Buildings stream in as you drive', 'City');
}
function gotoStreet() {
  // the designed (showcase) buildings stand on real lots of the city; this puts the car on the road in front of the next one
  const P = scene.cityPlan; if (!player || !P || !P.showcase.length) return;
  const L = P.showcase[streetIx++ % P.showcase.length];
  if (person.active) backToCar();
  const z = L.roadC + 3;
  scene.city.prime([{ x: L.x, z: L.z }], 4);
  player.vehicle.reset([L.x, 0, z], 0);
  camYaw = 0;
  toast(`${L.show} - facing the building from the road`, 'Showcase');
}
let streetIx = 0;
function spawnAhead() {
  if (!player) return;
  const b = player.body;
  const f = [-b.R[6], 0, -b.R[8]]; const fl = Math.hypot(f[0], f[2]) || 1;
  const ids = CARS.map((c) => c.id);
  const npcs = cars.filter((c) => c.npc);
  if (npcs.length > 22) { const old = npcs[0]; cars.splice(cars.indexOf(old), 1); old.dispose(); }
  for (let i = 0; i < 3; i++) {
    const d = 30 + i * 9, side = (i - 1) * 4.5;
    const x = b.pos[0] + (f[0] / fl) * d + (f[2] / fl) * side, z = b.pos[2] + (f[2] / fl) * d - (f[0] / fl) * side;
    spawnNPC(ids[(Math.random() * ids.length) | 0], x, z, Math.atan2(-f[0], -f[2]) + Math.PI * (Math.random() > 0.5 ? 1 : 0) + (Math.random() - 0.5) * 0.6);
  }
  toast('3 cars ahead', 'Go get them');
}
const TODS = ['day', 'golden', 'overcast', 'night'];
function nextTod() { S.tod = TODS[(TODS.indexOf(S.tod) + 1) % TODS.length]; r.setTOD(S.tod); save(); syncMenu(); toast({ day: 'Noon', golden: 'Sunset', overcast: 'Overcast', night: 'Night' }[S.tod], ''); }
function toggleSound() { S.sound = S.sound ? 0 : 1; sfx.mute(!S.sound); save(); toast(S.sound ? 'Sound on' : 'Sound off', ''); }
function toggleSlow() { userSlow = !userSlow; toast(userSlow ? 'Slow motion' : 'Normal speed', ''); }

// ---------- toast ----------
let toastT = 0;
function toast(a, b) {
  const t = $('toast');
  t.innerHTML = (b ? `<small>${b}</small>` : '') + a;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- stats ----------
const stats = { top: 0, armed: true, t100: null, t200: null, tRun: 0, running: false, air: 0, bestAir: 0, drift: 0, driftAcc: 0, shownWreck: false, lastTopToast: 0, airStartPos: null };
const unitK = () => (S.units === 'mph' ? 0.621371 : 1);
function trackStats(dt) {
  const v = player.vehicle, kmh = Math.abs(v.vf) * 3.6;
  if (!stats.running && kmh < 1 && inp.throttle < 0.05) { stats.armed = true; }
  if (stats.armed && !stats.running && v.vf > 0.4 && inp.throttle > 0.3) { stats.running = true; stats.tRun = 0; stats.t100 = null; stats.t200 = null; }
  if (stats.running) {
    stats.tRun += dt;
    if (!stats.t100 && kmh >= 100) { stats.t100 = stats.tRun; toast(`0–${S.units === 'mph' ? '62' : '100'} in ${stats.t100.toFixed(2)} s`, 'Acceleration'); }
    if (!stats.t200 && kmh >= 200) { stats.t200 = stats.tRun; toast(`0–200 in ${stats.t200.toFixed(2)} s`, 'Acceleration'); }
    if (inp.brake > 0.5 || inp.throttle < 0.1 && kmh < 90 || stats.tRun > 90) { stats.running = false; stats.armed = false; }
  }
  if (kmh > stats.top) { stats.top = kmh; if (kmh > 200 && kmh - stats.lastTopToast > 30) { stats.lastTopToast = kmh; toast(`${Math.round(kmh * unitK())} ${S.units === 'mph' ? 'mph' : 'km/h'}`, 'New top speed'); } }
  // air
  if (v.airborne && v.speed > 8) { if (stats.air === 0) stats.airStartPos = [player.body.pos[0], player.body.pos[2]]; stats.air += dt; }
  else { if (stats.air > 0.9) { const d = Math.hypot(player.body.pos[0] - stats.airStartPos[0], player.body.pos[2] - stats.airStartPos[1]); toast(`${stats.air.toFixed(1)} s · ${d.toFixed(0)} m`, 'Air time'); stats.bestAir = Math.max(stats.bestAir, stats.air); } stats.air = 0; }
  // drift
  const ang = Math.abs(Math.atan2(v.wheels[2].vlat || 0, Math.max(Math.abs(v.vf), 0.5)));
  const sideSlip = Math.abs(player.body.v[0] * player.body.R[0] + player.body.v[1] * player.body.R[1] + player.body.v[2] * player.body.R[2]);
  const slipAng = Math.atan2(sideSlip, Math.max(Math.abs(v.vf), 1));
  if (slipAng > 0.2 && v.speed > 10 && !v.airborne) { stats.driftAcc += v.speed * slipAng * dt * 6; stats.drift = stats.driftAcc; }
  else if (stats.driftAcc > 0) { stats.driftAcc = Math.max(0, stats.driftAcc - dt * 200); if (stats.driftAcc <= 0 && stats.drift > 400) toast(`${Math.round(stats.drift)} pts`, 'Drift'); }
  if (player.health < 0.1 && !stats.shownWreck) { stats.shownWreck = true; toast('TOTAL WRECK', `$${Math.round(player.cost).toLocaleString()} damage`); }
  if (player.health > 0.3) stats.shownWreck = false;
}

// ---------- HUD ----------
const PF = { vs: 0, ws: 0, n: 0, ph: 0, up: 0, fx: 0, dr: 0, rn: 0 }; window.__PF = PF;
const fpsEl = (() => { const d = document.createElement('div'); d.id = 'fps'; d.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(6px + env(safe-area-inset-bottom,0px));font:700 11px system-ui;color:#98a3b3;background:rgba(12,15,20,.6);padding:3px 8px;border-radius:8px;pointer-events:none'; document.body.appendChild(d); return d; })();
const gauge = $('gauge'), gctx = gauge.getContext('2d');
let hudT = 0;
function drawGauge() {
  const w = gauge.width, h = gauge.height, g = gctx;
  g.clearRect(0, 0, w, h);
  const v = player.vehicle, spec = player.spec;
  const cx = w / 2, cy = h * 0.52, R = h * 0.4;
  const maxRpm = Math.ceil((spec.redline + 300) / 1000) * 1000;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, span = a1 - a0;
  const f = clamp(v.rpm / maxRpm, 0, 1), rl = spec.redline / maxRpm;
  // plate
  const rr = (x, y, ww, hh, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + ww, y, x + ww, y + hh, r); g.arcTo(x + ww, y + hh, x, y + hh, r); g.arcTo(x, y + hh, x, y, r); g.arcTo(x, y, x + ww, y, r); g.closePath(); };
  const pg = g.createLinearGradient(0, 0, 0, h); pg.addColorStop(0, 'rgba(14,17,23,.88)'); pg.addColorStop(1, 'rgba(5,6,9,.9)');
  g.fillStyle = pg; rr(2, 2, w - 4, h - 4, 34); g.fill();
  g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2; g.stroke();
  // shift lights
  const nL = 11, lit = clamp((f - rl * 0.72) / (rl * 0.28), 0, 1) * nL;
  const blink = v.revLimiter && ((performance.now() / 70) | 0) % 2;
  for (let i = 0; i < nL; i++) {
    const x = w / 2 + (i - (nL - 1) / 2) * 34, on = i < lit || blink;
    const col = i < 4 ? '#37d67a' : i < 8 ? '#ffb02e' : '#ff3b30';
    g.fillStyle = on ? col : 'rgba(255,255,255,.08)';
    if (on) { g.shadowColor = col; g.shadowBlur = 14; }
    g.beginPath(); g.arc(x, 26, 9, 0, 7); g.fill(); g.shadowBlur = 0;
  }
  // rpm segment ring
  const N = 54;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1), a = a0 + span * t;
    const on = t <= f, red = t >= rl * 0.93;
    const major = i % 6 === 0;
    const r1 = R * 0.9, r2 = R * (major ? 0.74 : 0.8);
    g.strokeStyle = on ? (red ? '#ff3b30' : t > rl * 0.75 ? '#ffb02e' : '#f5c400') : red ? 'rgba(255,59,48,.28)' : 'rgba(255,255,255,.18)';
    g.lineWidth = major ? 6 : 4;
    if (on) { g.shadowColor = red ? '#ff3b30' : '#f5c400'; g.shadowBlur = 8; }
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke(); g.shadowBlur = 0;
  }
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = `700 ${R * 0.12}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k <= maxRpm / 1000; k++) { const a = a0 + span * (k * 1000 / maxRpm); g.fillText(k, cx + Math.cos(a) * R * 0.62, cy + Math.sin(a) * R * 0.62); }
  g.font = `600 ${R * 0.09}px system-ui`; g.fillStyle = 'rgba(255,255,255,.45)'; g.fillText('x1000 RPM', cx, cy - R * 0.38);
  // needle (glowing digital blade)
  const na = a0 + span * f;
  g.save(); g.translate(cx, cy); g.rotate(na);
  const ng = g.createLinearGradient(R * 0.2, 0, R * 0.92, 0); ng.addColorStop(0, 'rgba(245,196,0,0)'); ng.addColorStop(1, '#f5c400');
  g.shadowColor = '#f5c400'; g.shadowBlur = 16; g.fillStyle = ng;
  g.beginPath(); g.moveTo(R * 0.2, -2); g.lineTo(R * 0.93, -3.5); g.lineTo(R * 0.97, 0); g.lineTo(R * 0.93, 3.5); g.lineTo(R * 0.2, 2); g.closePath(); g.fill();
  g.restore(); g.shadowBlur = 0;
  // speed
  const kmh = Math.abs(v.vf) * 3.6 * unitK();
  g.fillStyle = '#fff'; g.font = `800 ${R * 0.7}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(Math.round(kmh), cx, cy + R * 0.02);
  g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `700 ${R * 0.13}px system-ui`; g.fillText(S.units === 'mph' ? 'MPH' : 'KM/H', cx, cy + R * 0.42);
  // gear box
  const gear = v.gear < 0 ? 'R' : v.gear === 0 ? 'N' : v.gear;
  g.fillStyle = 'rgba(255,255,255,.07)'; rr(cx + R * 0.58, cy + R * 0.28, R * 0.52, R * 0.52, 12); g.fill();
  g.strokeStyle = 'rgba(255,176,46,.55)'; g.lineWidth = 2; g.stroke();
  g.fillStyle = '#ffb02e'; g.font = `800 ${R * 0.4}px system-ui`; g.fillText(gear, cx + R * 0.84, cy + R * 0.56);
  // side readouts: boost & brake temp
  const bar = (x, y, ww, frac, col, label) => {
    g.fillStyle = 'rgba(255,255,255,.1)'; rr(x, y, ww, 9, 4); g.fill();
    g.fillStyle = col; rr(x, y, Math.max(8, ww * clamp(frac, 0, 1)), 9, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,.5)'; g.font = `700 ${R * 0.085}px system-ui`; g.textAlign = 'left'; g.fillText(label, x, y - 9);
  };
  const bt = Math.max(...v.wheels.map((q) => q.bTemp || 25));
  bar(24, h - 34, 170, inp.brake, '#ff3b30', 'BRAKE ' + Math.round(inp.brake * 100) + '%  ·  disc ' + Math.round(bt) + '°C');
  bar(w - 194, h - 34, 170, inp.throttle, '#f5c400', 'THROTTLE ' + Math.round(inp.throttle * 100) + '%');
  if (spec.turbo) bar(24, h - 84, 170, clamp(v.boost, 0, 1), '#4aa8ff', 'BOOST');
  g.textAlign = 'center'; g.font = `800 ${R * 0.11}px system-ui`;
  if (v.tcAct > 0.3) { g.fillStyle = '#ffb02e'; g.fillText('TC', cx - R * 0.55, cy + R * 0.7); }
  if (v.absAct > 0.3) { g.fillStyle = '#ffb02e'; g.fillText('ABS', cx - R * 0.8, cy + R * 0.7); }
}
function updateHud(dt) {
  hudT -= dt;
  if (hudT > 0) return;
  hudT = 0.05;
  drawGauge();
  const hp = player.health;
  fpsEl.textContent = Math.round(1000 / Math.max(fpsAvg, 1)) + ' FPS · phys ' + PF.ph.toFixed(1) + ' upd ' + PF.up.toFixed(1) + ' fx ' + PF.fx.toFixed(1) + ' draw ' + PF.dr.toFixed(1) + ' gl ' + PF.rn.toFixed(1) + ' ms · ' + r.stats.draws + 'd ' + Math.round(r.stats.tris / 1000) + 'kt · bodies ' + world.bodies.length;
  $('hpfill').style.width = (hp * 100).toFixed(0) + '%';
  $('hpfill').style.background = hp > 0.6 ? '#dfe3e8' : hp > 0.3 ? '#f5c400' : '#e5484d';
  $('cost').innerHTML = '$' + Math.round(player.cost).toLocaleString() + (propDmg > 500 ? '<small style="display:block;font-size:12px;font-weight:600;color:var(--muted)">property $' + Math.round(propDmg).toLocaleString() + '</small>' : '');
  const lost = [];
  const names = ['', 'Hood', 'Trunk', 'Front bumper', 'Rear bumper', 'Left door', 'Right door', 'L mirror', 'R mirror', 'Wing'];
  player.partGone.forEach((g, i) => { if (g) lost.push(names[i]); });
  player.vehicle.wheels.forEach((w, i) => { if (w.detached) lost.push(['FL', 'FR', 'RL', 'RR'][i] + ' wheel'); else if (w.flat) lost.push(['FL', 'FR', 'RL', 'RR'][i] + ' flat'); });
  if (player.vehicle.health.engine < 0.5) lost.push('Engine');
  for (const k in player.glassGone) lost.push('Glass');
  $('lost').innerHTML = lost.slice(0, 10).map((s) => `<span>${s}</span>`).join('');
  const u = S.units === 'mph' ? 'mph' : 'km/h';
  $('s0100').textContent = stats.t100 ? stats.t100.toFixed(2) + ' s' : stats.running ? stats.tRun.toFixed(1) + ' s…' : '–';
  $('s0200').textContent = stats.t200 ? stats.t200.toFixed(2) + ' s' : '–';
  $('stop').textContent = Math.round(stats.top * unitK()) + ' ' + u;
  $('sair').textContent = (stats.air || stats.bestAir).toFixed(1) + ' s';
  $('sdrift').textContent = Math.round(stats.drift);
  $('redflash').style.opacity = redFlash.toFixed(2);
  redFlash *= 0.85;
  $('flash').style.opacity = clamp(fx.flash * 0.7, 0, 0.8).toFixed(2);
}

// ---------- menu ----------
let menuOpen = true;
function carInfoHTML(spec) {
  const mx = { hp: 1500, nm: 1700, vmax: 430 };
  const st = (label, val, unit, frac) => `<div class="stat"><small>${label}</small><b>${val}<em>${unit}</em></b><div class="bar"><i style="width:${clamp(frac, 0.05, 1) * 100}%"></i></div></div>`;
  return `<div class="maker">${spec.maker} &nbsp;·&nbsp; ${spec.drive}</div><div class="carName">${spec.name}</div><div class="tagline">${spec.tag} &nbsp;·&nbsp; ${spec.engine}</div>` +
    `<div class="statRow">${st('Power', Math.round(spec.hp), 'hp', spec.hp / mx.hp)}${st('Torque', spec.nm, 'Nm', spec.nm / mx.nm)}${st('0-100', spec.zero100.toFixed(1), 's', 1 - (spec.zero100 - 2) / 2.2)}${st('Top', spec.vmax, 'km/h', spec.vmax / mx.vmax)}${st('Weight', spec.kg, 'kg', 1 - (spec.kg - 1400) / 1200)}</div>`;
}
function pickCar(id, dir) {
  if (S.car === id) return;
  S.car = id; S.color = 0; save(); makePlayer(false); syncMenu();
  const ci = $('carInfo'); ci.classList.remove('swap'); void ci.offsetWidth; ci.classList.add('swap');
  orbitYaw = camYaw + Math.PI + 0.55;
}
function stepCar(d) { const i = CARS.findIndex((c) => c.id === S.car); pickCar(CARS[(i + d + CARS.length) % CARS.length].id); }
function syncMenu() {
  const list = $('carList');
  if (!list.children.length) {
    for (const c of CARS) {
      const b = document.createElement('button'); b.className = 'carBtn'; b.dataset.id = c.id;
      b.innerHTML = `<b>${c.name}</b><small>${c.tag}</small><div class="nums"><span>${Math.round(c.hp)}<em>HP</em></span><span>${c.zero100.toFixed(1)}<em>S</em></span><span>${c.vmax}<em>KM/H</em></span></div><div class="pr">$${c.price.toLocaleString()}</div>`;
      b.onclick = () => { pickCar(c.id); openSheet(null); };
      list.appendChild(b);
    }
    $('dots').innerHTML = CARS.map(() => '<i></i>').join('');
  }
  [...list.children].forEach((b) => b.classList.toggle('sel', b.dataset.id === S.car));
  [...$('dots').children].forEach((d, i) => d.classList.toggle('on', CARS[i].id === S.car));
  const spec = getCar(S.car);
  $('carInfo').innerHTML = carInfoHTML(spec);
  const sw = $('swatches'); sw.innerHTML = '';
  spec.colors.forEach((hex, i) => {
    const b = document.createElement('button'); b.className = 'sw' + (i === S.color % spec.colors.length ? ' sel' : ''); b.style.background = hex; b.setAttribute('aria-label', 'paint ' + (i + 1));
    b.onclick = () => { S.color = i; save(); makePlayer(false); syncMenu(); };
    sw.appendChild(b);
  });
  const seg = (id, key, cb) => { [...$(id).children].forEach((b) => { b.classList.toggle('sel', String(S[key]) === b.dataset.v); b.onclick = () => { S[key] = isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v; save(); cb && cb(); syncMenu(); }; }); };
  seg('segAssist', 'assist', () => player && (player.vehicle.assist = S.assist));
  seg('segTod', 'tod', () => r.setTOD(S.tod));
  seg('segQ', 'quality', applyQuality);
  seg('segFps', 'fps', () => { ctx.load = 1; });
  seg('segU', 'units');
  seg('segTilt', 'tilt', () => { if (S.tilt && window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function') DeviceOrientationEvent.requestPermission().catch(() => {}); });
}
let sheetOpen = null;
function openSheet(name) {
  sheetOpen = sheetOpen === name ? null : name;
  $('invSheet').classList.toggle('hidden', sheetOpen !== 'inv');
  $('setSheet').classList.toggle('hidden', sheetOpen !== 'set');
  $('nInv').classList.toggle('on', sheetOpen === 'inv');
  $('nSet').classList.toggle('on', sheetOpen === 'set');
  const hideInfo = sheetOpen === 'inv';
  $('carInfo').style.visibility = hideInfo ? 'hidden' : 'visible';
}
$('arL').onclick = () => stepCar(-1); $('arR').onclick = () => stepCar(1);
$('nInv').onclick = () => openSheet('inv'); $('nSet').onclick = () => openSheet('set'); $('bSet').onclick = () => openSheet('set');
$('invX').onclick = () => openSheet(null); $('setX').onclick = () => openSheet(null);
$('nPaint').onclick = () => { const sw = $('swatches'); sw.style.outline = '2px solid var(--accent)'; setTimeout(() => (sw.style.outline = ''), 700); S.color = (S.color + 1) % getCar(S.car).colors.length; save(); makePlayer(false); syncMenu(); };
$('nLab').onclick = () => { if (window.openLab) window.openLab(); };
addEventListener('keydown', (e) => { if (!menuOpen) return; if (e.code === 'ArrowLeft') stepCar(-1); else if (e.code === 'ArrowRight') stepCar(1); else if (e.code === 'Enter') $('go').click(); });
function toggleMenu() { menuOpen = !menuOpen; $('menu').classList.toggle('hidden', !menuOpen); if (menuOpen) { orbitYaw = camYaw + Math.PI + 0.5; openSheet(null); } }
$('go').onclick = () => { warmUntil = performance.now() / 1000 + 7; sfx.start(); sfx.mute(!S.sound); menuOpen = false; $('menu').classList.add('hidden'); };
// HUD buttons fire on pointerdown (not click): a click is dropped while another finger is on the pedals / steering, pointerdown is not
const tap = (id, fn) => { const el = $(id); el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('on'); fn(); }); const off = () => el.classList.remove('on'); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off); el.addEventListener('click', (e) => e.preventDefault()); };
{
  const inEl = $('spdIn'), go = () => { const v = parseFloat(inEl.value); topSet = isFinite(v) && v > 0 ? clamp(v, 30, 5000) : 0; applyTop(topSet); inEl.blur(); };
  tap('spdSet', go); tap('spdStock', () => { topSet = 0; applyTop(0); });
  inEl.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') go(); });
  inEl.addEventListener('pointerdown', (e) => e.stopPropagation());
  const labels = { auto: 'TC: Auto', on: 'TC: On', off: 'TC: Off' };
  tap('spdTc', () => { tcMode = tcMode === 'auto' ? 'on' : tcMode === 'on' ? 'off' : 'auto'; $('spdTc').textContent = labels[tcMode]; if (player) player.vehicle.tcMode = tcMode; toast(tcMode === 'off' ? 'Traction control OFF - all the power goes to the tyres' : tcMode === 'on' ? 'Traction control ON' : 'Traction control: auto', ''); });
}
tap('bWalk', toggleWalk); tap('bCar', backToCar); tap('bMenu', toggleMenu); tap('bCam', cycleCam); tap('bRep', repair); tap('bSpawn', spawnAhead); tap('bStreet', gotoStreet); tap('bCity', gotoCity); tap('bTod', nextTod); tap('bSlow', toggleSlow); tap('bSnd', toggleSound);

// ---------- frame loop ----------
const H = 1 / 120;
let warmUntil = performance.now() / 1000 + 6;
let acc = 0, last = 0, hudAcc = 0, fpsAvg = 16, lowT = 0, highT = 0;
let engineT = 0;

// ---- lift floor card: appears when the walking person is inside a lift cabin ----
const liftEl = (() => { const d = document.createElement('div'); d.id = 'liftCard'; d.style.cssText = 'position:fixed;right:max(14px,env(safe-area-inset-right,0px));top:50%;transform:translateY(-50%);z-index:30;display:none;background:rgba(14,17,22,.88);border:1px solid rgba(255,255,255,.12);border-left:3px solid #f5b81c;border-radius:12px;padding:10px 12px;max-height:72vh;overflow:auto;touch-action:pan-y;font:700 12px system-ui;color:#c9d1db;min-width:92px'; document.body.appendChild(d); return d; })();
let liftKey = '', liftUi = null;
function updateLiftCard(u) {
  liftUi = u;
  if (!u) { if (liftEl.style.display !== 'none') { liftEl.style.display = 'none'; liftKey = ''; } return; }
  if (liftKey !== u.key) {
    liftKey = u.key; liftEl.style.display = 'block';
    let h = '<div style="letter-spacing:.14em;font-size:10px;color:#98a3b3;margin-bottom:8px">SELECT FLOOR</div><div id="liftGrid" style="display:grid;grid-template-columns:repeat(' + (u.labels.length > 8 ? 3 : 2) + ',1fr);gap:8px">';
    for (let i = u.labels.length - 1; i >= 0; i--) h += '<button data-i="' + i + '" style="min-width:52px;min-height:52px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#1d232c;color:#e8edf3;font:800 18px system-ui;touch-action:manipulation">' + u.labels[i] + '</button>';
    liftEl.innerHTML = h + '</div><div id="liftSt" style="margin-top:8px;font-size:11px;color:#f5b81c;min-height:14px"></div>';
    for (const b of liftEl.querySelectorAll('button')) b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); if (liftUi) scene.structures.liftGo(liftUi.L, +b.dataset.i); });
  }
  const bs = liftEl.querySelectorAll('button');
  for (const b of bs) { const i = +b.dataset.i; const on = i === (u.moving ? u.dest : u.cur); b.style.background = on ? '#f5b81c' : '#1d232c'; b.style.color = on ? '#14110a' : '#e8edf3'; b.style.opacity = u.moving && i !== u.dest ? '.5' : '1'; }
  const st = liftEl.querySelector('#liftSt'); if (st) st.textContent = u.moving ? 'Going to ' + u.labels[u.dest] : 'Floor ' + u.labels[u.cur];
}
// ---------- the 10 m physics bubble ----------
// Only things a "watcher" can reach in the next instant are in the physics world: a car is a swept path (where it is -> 10 m ahead along its velocity, 4 m wide),
// a walking person is a 10 m circle, and anything already moving fast (flying debris, a shoved prop) wakes what lies in its way. Buildings and loose props
// outside every watcher are only pictures + a few numbers. Waking is done before each physics step, so there is no delay and nothing to bounce off.
let debrisPts = [];
function scanMovers() {
  // fast loose bodies (not cars / person: those are watchers already) keep the things in their path awake
  debrisPts = [];
  for (const b of world.bodies) {
    if (b.fixed || b.sleeping || b.removed || b.person || (b.userData && b.userData.vehicle)) continue;
    const sp2 = b.v[0] * b.v[0] + b.v[2] * b.v[2];
    if (sp2 < 4 || b.pos[1] < -5) continue;
    const k = Math.max(3, Math.sqrt(sp2) * 0.35) / Math.sqrt(sp2);
    debrisPts.push({ x: b.pos[0], z: b.pos[2], x2: b.pos[0] + b.v[0] * k, z2: b.pos[2] + b.v[2] * k, r: 1.5 });
    if (debrisPts.length >= 160) break;
  }
}
function wakeWatchers() {
  const pts = debrisPts.slice(), foci = [];
  for (const c of cars) {
    const b = c.vehicle ? c.vehicle.body : null; if (!b) continue;
    const vx = b.v[0], vz = b.v[2], sp = Math.hypot(vx, vz);
    if (c !== player && sp < 1 && !c.vehicle.hyperOn) continue;                       // parked traffic stays quiet
    const k = sp > 1.5 ? 10 / sp : 0;                                                  // 10 m ahead
    pts.push({ x: b.pos[0], z: b.pos[2], x2: b.pos[0] + vx * k, z2: b.pos[2] + vz * k, r: 4 });
    if (c === player) foci.push({ x: b.pos[0], z: b.pos[2], vx, vz });
  }
  if (person.active) { const q = person.body.pos; pts.push({ x: q[0], z: q[2], x2: q[0], z2: q[2], r: 10 }); foci.push({ x: q[0], z: q[2], vx: person.body.v[0], vz: person.body.v[2] }); }
  scene.structures.updateDormancy(pts);
  scene.watchProps(pts);
  return foci;
}
function watchBuildings() {
  scanMovers();
  const foci = wakeWatchers();
  if (scene.city) { if (!foci.length && player && player.vehicle) foci.push({ x: player.vehicle.body.pos[0], z: player.vehicle.body.pos[2], vx: 0, vz: 0 }); scene.city.update(1 / 60, foci); }
}
function stepPhysics(real) {
  const ts = paused ? 0 : userSlow ? 0.25 : slowT > 0 ? 0.3 : 1;
  timeScale = ts;
  acc += real * ts;
  let n = 0;
  while (acc >= H && n < 4) {
    const a0 = performance.now();
    if (n > 0) wakeWatchers();                                                          // the first step was prepared at frame start; later steps re-check (a car moves up to 11 m per frame at 600 km/h)
    for (const c of cars) { c.vehicle.step(H); if (c.vehicle.hyperOn || c.vehicle.speed > 110) c.vehicle.ccdBegin(H); }
    const a1 = performance.now();
    world.step(H);
    PF.vs += a1 - a0; PF.ws += performance.now() - a1; PF.n++;
    for (const c of cars) if (c.vehicle._ccd) c.vehicle.ccdEnd();
    ctx.time += H;
    acc -= H; n++;
  }
  if (acc > H * 4) acc = 0;
}
function frame(t) {
  requestAnimationFrame(frame);
  const now = t / 1000;
  const tgt = S.fps || 0;                       // user's target FPS (0 = unlimited)
  if (tgt && now - last < 1 / tgt - 0.003) return;   // frame cap: saves heat + battery
  let dt = Math.min(0.05, now - last); last = now;
  if (!player) return;
  fpsAvg = fpsAvg * 0.95 + dt * 1000 * 0.05;
  // load governor: when the frame rate drops under the target, shed detail (particles, rubble, resolution) in steps; recover when there is headroom
  const goal = tgt || 60, fpsNow = 1000 / Math.max(fpsAvg, 1);
  // the first seconds after loading / pressing Play are full of one-off work (shader compile, mesh upload, audio start): never shed detail for that
  const warm = now < warmUntil;
  if (warm) { lowT = 0; highT = 0; fpsAvg = Math.min(fpsAvg, 1000 / goal * 1.05); if ((ctx.load ?? 1) < 1 || r.dprScale < [0.6, 0.85, 1][S.quality]) { ctx.load = 1; fx.quality = [0.35, 0.7, 1][S.quality]; r.dprScale = [0.6, 0.85, 1][S.quality]; } }
  else if (dt > 0.09) { /* hitch (one-off), ignore */ }
  else if (fpsNow < goal * 0.7) { lowT += dt * 1.5; highT = 0; } else if (fpsNow < goal * 0.85) { lowT += dt; highT = 0; } else if (fpsNow > goal * 0.95) { highT += dt; lowT = 0; } else { lowT = highT = 0; }
  const load = ctx.load === undefined ? 1 : ctx.load;
  if (lowT > 2.0) {
    lowT = 0;
    if (load > 0.5) { ctx.load = Math.max(0.5, load - 0.1); fx.quality = [0.35, 0.7, 1][S.quality] * ctx.load; }
    else if (r.dprScale > 0.7) { r.dprScale = Math.max(0.7, r.dprScale - 0.1); resize(); }
  }
  if (highT > 1.5) {
    highT = 0;
    const dm = [0.6, 0.85, 1][S.quality];
    if (r.dprScale < dm) { r.dprScale = Math.min(dm, r.dprScale + 0.05); resize(); }
    else if (load < 1) { ctx.load = Math.min(1, load + 0.1); fx.quality = [0.35, 0.7, 1][S.quality] * ctx.load; }
  }
  soundBudget = 5;
  scrape = 0;
  readInput(dt);
  if (person.active && !menuOpen && !scene.structures.riding) { person.update(dt, { fwd: inp.throttle - inp.brake, turn: inp.steer, run: inp.hb, jump: horn }); const vi = player.vehicle.in; vi.throttle = 0; vi.brake = 0.5; vi.steer = 0; vi.handbrake = 1; }
  else if (menuOpen) { player.vehicle.in.throttle = 0; player.vehicle.in.brake = 0.4; player.vehicle.in.steer = 0; player.vehicle.in.handbrake = 1; }
  else { const vi = player.vehicle.in; vi.throttle = inp.throttle; vi.brake = inp.brake; vi.steer = inp.steer; vi.handbrake = inp.hb; vi.reverse = reverseOn; }
  if (slowT > 0) slowT -= dt;
  const _t0 = performance.now();
  watchBuildings();
  stepPhysics(dt);
  const _t1 = performance.now();
  const sdt = dt * timeScale;
  scene.update(sdt);
  updateLiftCard(person.active ? scene.structures.liftUI(person) : null);
  const _t2 = performance.now();
  for (const c of cars) c.update(sdt);
  fx.update(sdt);
  const _t3 = performance.now();
  PF.ph = PF.ph * 0.9 + (_t1 - _t0) * 0.1; PF.up = PF.up * 0.9 + (_t2 - _t1) * 0.1; PF.fx = PF.fx * 0.9 + (_t3 - _t2) * 0.1;
  // tyre smoke + skids for moving cars
  for (const c of cars) {
    if (c.npc && c.vehicle.speed < 3) continue;
    const v = c.vehicle;
    v.wheels.forEach((w, i) => {
      if (w.detached && w.stubOn && w.stubV > 1.5) { const kk = Math.min(1, w.stubV / 15); for (let q = 0; q < 2; q++) if (Math.random() < kk) fx.spark(w.stubP, [-v.body.v[0] * 0.15 + (Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, -v.body.v[2] * 0.15 + (Math.random() - 0.5) * 3]); fx.gouge(c.id + 'h' + i, w.stubP[0], w.stubP[2], [v.body.v[0], 0, v.body.v[2]], 0.12, 0.6 * kk + 0.2); } else if (w.detached) fx.gouge(c.id + 'h' + i, 0, 0, [0, 0, 1], 0.1, 0);
      if (w.detached || !w.grounded) { fx.skid(c.id + i + (c === player ? 'p' : c.body.id), [0, 0, 0], [0, 0, 1], 0.2, 0); return; }
      const s = Math.max(w.slipLong * 0.8, Math.abs(w.slipLat) * 2.3) * (w.Fn > 300 ? 1 : 0);
      const key = (c === player ? 'p' : c.body.id) + i;
      const a = clamp((s - 0.55) / 0.5, 0, 1);
      if (a > 0.02) {
        fx.skid(key, w.contact, [-v.body.R[6], 0, -v.body.R[8]], w.tw * 0.9, a);
        if (v.speed > 2 && Math.random() < a * 0.6 * (c === player ? 1 : 0.5)) fx.tire(w.contact, v.body.v, a);
      } else fx.skid(key, w.contact, [0, 0, 1], 0.2, 0);
      if (w.flat && v.speed > 4) fx.spark(w.contact, [(Math.random() - 0.5) * 3, 1 + Math.random(), (Math.random() - 0.5) * 3]);
    });
  }
  // road damage: body scraping on asphalt throws sparks and carves a gouge; hard landings leave a dent
  for (const c of cars) {
    const b = c.body, sp = Math.hypot(b.v[0], b.v[2]);
    if (b.gcT !== undefined && world.time - b.gcT < 0.05) {
      if (sp > 3.5) {
        const fw = [b.v[0], 0, b.v[2]];
        const k = Math.min(1, sp / 18);
        for (let i = 0; i < 2; i++) if (Math.random() < k) fx.spark([b.gcX, 0.05, b.gcZ], [-b.v[0] * 0.2 + (Math.random() - 0.5) * 4, 1.5 + Math.random() * 3, -b.v[2] * 0.2 + (Math.random() - 0.5) * 4]);
        fx.gouge(c.id + '' + b.id, b.gcX, b.gcZ, fw, 0.16, 0.5 * k + 0.2);
      }
      if (b.gcV > 4.5 && !c.npc || b.gcV > 7) {
        const sz = clamp(b.gcV / 10, 0.4, 1.6);
        fx.crater(b.gcX, b.gcZ, sz, 0.7);
        for (let i = 0; i < 10; i++) fx.dust([b.gcX, 0.1, b.gcZ], [(Math.random() - 0.5) * 4, 1 + Math.random() * 2, (Math.random() - 0.5) * 4], 0.7);
      }
      b.gcV = 0;
    } else { if (b.gcT !== undefined) fx.gouge(c.id + '' + b.id, 0, 0, [0, 0, 1], 0.1, 0); b.gcV = 0; }
  }
  trackStats(sdt);
  // debris housekeeping
  const deb = ctx.debris;
  for (let i = deb.length - 1; i >= 0; i--) { const d = deb[i]; d.t += dt; if ((d.kind !== 'rubble' && d.t > 45) || d.t > 900 || d.body.pos[1] < -30 || deb.length > 1000 && i < deb.length - 1000) { world.remove(d.body); deb.splice(i, 1); } }
  // camera
  updateCamera(dt);
  // audio
  sfx.cam = camPos;
  if (sfx.ctx && !menuOpen) {
    const v = player.vehicle;
    sfx.engine(player.spec, v, 0);
    let slip = 0; for (const w of v.wheels) if (w.grounded) slip = Math.max(slip, clamp((Math.max(w.slipLong * 0.8, Math.abs(w.slipLat) * 2.3) - 0.5) / 0.5, 0, 1));
    sfx.continuous(slip, v.speed, scrape);
    sfx.horn(horn);
  } else if (sfx.ctx) { sfx.engine(player.spec, { rpm: player.spec.idle, tl: 0, revLimiter: false, boost: 0 }, 0); sfx.continuous(0, 0, 0); }
  // render
  r.time = now;
  if (window.__camOv) { camPos = window.__camOv.eye; camLook = window.__camOv.look; if (window.__camOv.fov) camFov = window.__camOv.fov; }
  r.begin({ eye: camPos, target: camLook, fov: camFov, near: 0.25, far: 9000, shadowCenter: [player.body.pos[0], 0, player.body.pos[2]] });
  fx.beginBlobs();
  const _d0 = performance.now();
  scene.draw(camPos);
  if (lab && lab.active && lab.draw) lab.draw(r);
  for (const c of cars) c.draw();
  person.draw();
  for (const d of deb) drawDebris(ctx, d);
  fx.collect(r);
  // lights
  if (S.tod === 'night' || S.tod === 'overcast' && false) {
    const b = player.body, f = [-b.R[6], -b.R[7], -b.R[8]];
    for (const sd of [-0.65, 0.65]) { const p = b.toWorld([sd, 0.0, -player.spec.geo.L * 0.47]); r.addLight(p[0], p[1], p[2], 40, 1.4, 1.35, 1.2, f[0], f[1] - 0.04, f[2], 0.88); }
  }
  if (lastBlast) { lastBlast.t += dt; if (lastBlast.t < 0.8) { const k = 1 - lastBlast.t / 0.8; r.addLight(lastBlast.pos[0], lastBlast.pos[1] + 2, lastBlast.pos[2], 40, 4 * k, 2 * k, 0.6 * k); } }
  const _d1 = performance.now();
  r.render();
  const _d2 = performance.now();
  PF.dr = PF.dr * 0.9 + (_d1 - _d0) * 0.1; PF.rn = PF.rn * 0.9 + (_d2 - _d1) * 0.1;
  updateHud(dt);
}

// ---------- boot ----------
async function boot() {
  applyQuality();
  r.setTOD(S.tod);
  ctx.onProp = (v) => { propDmg += v; };
  scene = new Scene(ctx, { density: S.quality === 0 ? 0.6 : 1 });
  ctx.scene = scene;
  lab = initLab({ scene: () => scene, player: () => player });
  world.preHit = (a, b, c) => scene.structures.preHit(a, b, c);
  makePlayer(false);
  populateNPCs();
  for (const c of cars) if (c.npc) { c.body.canSleep = true; c.body.sleep(); }
  for (const b of world.bodies) if (!b.fixed && b.group === 2 && !b.sleeping && !(b.userData && b.userData.vehicle) && !b.person) b.sleep();   // every resting prop starts asleep, so the 10 m bubble can shelve it
  scene.structures.sleepAll(); watchBuildings();
  syncMenu();
  $('loading').style.display = 'none';
  requestAnimationFrame((t) => { last = t / 1000; frame(t); });
  window.__game = { watch: watchBuildings, life, get lab() { return lab; }, person, toggleWalk, orbit: (y, p, d) => { orbitYaw = y; orbitPitch = p; orbitDist = d; }, hold: (v) => { dragging = v; }, get player() { return player; }, cars, world, ctx, fx, scene, r, S, blast, spawnNPC, camPos: () => camPos };
}
setTimeout(() => { boot().catch((e) => { console.error(e); $('loading').innerHTML = '<div style="padding:24px;text-align:center">Failed to start: ' + String(e.message || e).slice(0, 300) + '</div>'; }); }, 30);
