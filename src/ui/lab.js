// Design Lab. LEFT: draw the plan (rooms, doors, windows, stairs) - RIGHT: the real building rebuilds itself live, nothing to press.
// Tap a part of the 3D building to edit it directly (add a window or door, remove an opening, recolour the wall).
// Nothing is placed in the game from here: designs are tested on a private pad; "Copy design" gives the file to hand over for city placement.
import { RECIPES } from '../data/recipes.js';
import { PAINTS } from '../data/materials.js';
import { generate } from '../engines/buildings/architect.js';
import { STYLES, T_EXT, SLAB } from '../engines/buildings/compile.js';
import { T } from '../engines/buildings/render.js';
import { qRot, qConj, m4 } from '../core/math.js';

const LIB = 'crashyard_lab_v2';
const PAD = { x: 0, z: -260 };                       // private test pad
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o));
const q25 = (v) => Math.round(v * 4) / 4;

const ROOM_TYPES = ['living', 'dining', 'kitchen', 'bedroom', 'bath', 'toilet', 'hall', 'corridor', 'lounge', 'study', 'store', 'garage', 'shop', 'office'];
const ROOM_COL = { living: '#6b8f71', dining: '#8a9a5b', kitchen: '#c58a3a', bedroom: '#5b7ea8', bath: '#4aa3b5', toilet: '#4aa3b5', hall: '#8d8d92', corridor: '#6d6d72', lounge: '#6b8f71', study: '#9a78b5', store: '#8a7a68', garage: '#777c82', shop: '#c4623a', office: '#9a78b5', stairs: '#d4b24c' };
const PRESETS = [
  { name: 'Dark stone modern', note: 'black cladding, wood fins, glass balconies', brief: { kind: 'house', w: 12, d: 10, floors: 3, style: 'dark', garage: true, opts: { frame: false } } },
  { name: 'White box modern', note: 'white frame, round balcony, accent panel', brief: { kind: 'house', w: 10, d: 9.5, floors: 3, style: 'modern', opts: { frame: true, round: true } } },
  { name: 'Classic house', note: 'cream plaster, arches, brick trim', brief: { kind: 'house', w: 10, d: 9, floors: 2, style: 'classic', openStyle: 'arch', opts: { chajja: true } } },
  { name: 'Glass tower', note: 'floor plates, balconies, stair core', brief: { kind: 'tower', w: 16, d: 13, floors: 8, style: 'glass' } },
  { name: 'Brick shop + flat', note: 'shop below, rooms above', brief: { kind: 'house', w: 12, d: 9, floors: 2, shopGround: true, style: 'brick' } },
  { name: 'Market', note: 'stalls, vegetables', brief: { kind: 'market', w: 12, d: 8 } },
];
const WALL_COLS = ['#ece9e2', '#e6d7b4', '#d9c7a0', '#c9b79a', '#b3593a', '#a38a74', '#8c8f94', '#5f6368', '#3b3d41', '#7d8f74', '#6c8396', '#f3f1ec'];

export function initLab(api) {
  const root = document.createElement('div');
  root.id = 'lab'; root.className = 'hidden';
  root.innerHTML = `
  <div id="labBar"><div class="brand"><i></i><div>Design Lab<small>Live engine</small></div></div>
    <div class="labTabs"><button data-t="s" class="on">Start</button><button data-t="p">Plan</button><button data-t="l">Look</button></div>
    <button id="labCopy">Copy design</button><button id="labClose">Back to garage</button></div>
  <div id="labSide">
    <div class="pane" data-p="s">
      <h4>In the world</h4><div id="labList" class="list"></div>
      <h4>Start from a style</h4><div id="labPre" class="list"></div>
      <h4>Library</h4><div id="labLib" class="list"></div>
    </div>
    <div class="pane hidden" data-p="p">
      <div class="toolbar" id="fTabs"></div>
      <div class="toolbar" id="pTools">
        <button data-tool="sel" class="on">Select</button><button data-tool="room">Room</button><button data-tool="door">Door</button><button data-tool="win">Window</button><button data-tool="open">Arch</button><button data-tool="stairs">Stairs</button><button data-tool="del">Erase</button>
      </div>
      <canvas id="planCv" width="720" height="620"></canvas>
      <div id="planHint" class="hint2"></div>
      <div id="roomProps"></div>
      <div class="toolbar"><button id="fAdd">+ Floor</button><button id="fRem">- Floor</button><button id="fCopy">Copy this floor up</button></div>
    </div>
    <div class="pane hidden" data-p="l"><div id="labForm"></div></div>
    <div id="labReport" class="report"></div>
    <div id="labActs"><button id="aSave" class="pri">Save</button><button id="aApply">Update in world</button><button id="aNew">New</button><button id="aDel" class="danger">Close test</button></div>
  </div>
  <div id="labPick" class="hidden"></div>`;
  document.body.appendChild(root);

  const L = { active: false, tab: 's', design: null, cur: null, src: null, f: 0, tool: 'sel', sel: null, drag: null, hover: null, pick: null, timer: 0, built: 0,
    yaw: 0.7, pitch: 0.38, dist: 28, target: [PAD.x, 3, PAD.z], brief: null, roomType: 'bedroom', free: null };
  const scene = () => api.scene();
  const S = () => scene().structures;

  // ---------- tabs ----------
  function tab(t) {
    L.tab = t;
    root.querySelectorAll('.labTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    root.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== t));
    if (t === 's') renderStart(); if (t === 'p') { renderFloors(); renderProps(); drawPlan(); } if (t === 'l') renderForm();
  }
  root.querySelectorAll('.labTabs button').forEach((b) => (b.onclick = () => tab(b.dataset.t)));

  // ---------- design helpers ----------
  const realFloors = () => (L.design ? L.design.floors.filter((F) => !F.headhouse) : []);
  const curFloor = () => (L.design ? L.design.floors[Math.min(L.f, L.design.floors.length - 1)] : null);
  const loadLib = () => { try { return JSON.parse(localStorage.getItem(LIB) || '[]'); } catch (e) { return []; } };
  const saveLib = (a) => { try { localStorage.setItem(LIB, JSON.stringify(a)); } catch (e) {} };
  const status = (m) => { $('labReport').innerHTML = `<span>${esc(m)}</span>`; };
  function setDesign(D, srcB) {
    L.design = D; L.src = srcB || null; L.f = 0; L.sel = null; L.pick = null; L.brief = clone(D.brief || { kind: 'house', w: 10, d: 9, floors: 2, style: D.style });
    hidePick(); scheduleBuild(0); if (L.tab === 'p') { renderFloors(); renderProps(); drawPlan(); } if (L.tab === 'l') renderForm();
  }

  // ---------- live build ----------
  function scheduleBuild(ms = 280) { clearTimeout(L.timer); L.timer = setTimeout(build, ms); }
  function build(refocus) {
    if (!L.design) return;
    const s = S();
    if (L.cur) { s.removeBuilding(L.cur); L.cur = null; }
    let B;
    try { B = s.addBuilding({ design: clone(L.design), x: PAD.x, z: PAD.z, paint: L.design.paint }); } catch (e) { console.error(e); status('Engine could not build this: ' + e.message); return; }
    L.cur = B; L.built++;
    if (L.built === 1 || refocus) focus(PAD.x, PAD.z, B.radius, B.cy);
    showReport(B);
    if (L.tab === 'p') drawPlan();
    if (L.tab === 's') renderStart();
    L.pick = null; hidePick();
  }
  function focus(x, z, r, cy) { L.target = [x, Math.max(2, (cy || r * 0.3) * 0.9), z]; L.dist = Math.max(14, r * 2.6); }
  function showReport(B) {
    const r = B.report, el = $('labReport');
    if (!r) { el.innerHTML = ''; return; }
    const open = r.issues.filter((i) => !i.fixed), fixed = r.issues.filter((i) => i.fixed);
    const ci = B.compileIssues || [];
    el.innerHTML = `<b class="${open.length || ci.length ? 'warn' : 'ok'}">Engine check: ${open.length || ci.length ? (open.length + ci.length) + ' issue(s)' : 'all clear'}</b> · ${r.panels} parts · ${r.tons} t · ${B.lay.furn.length} furniture · ${(B.doors || []).length} doors` +
      (ci.length ? `<div class="op">${esc(ci.slice(0, 3).join('; '))}</div>` : '') +
      (fixed.length ? `<div class="fx">${fixed.length} auto-repaired</div>` : '') + (open.length ? `<div class="op">${esc(open.slice(0, 3).map((i) => i.msg).join('; '))}</div>` : '');
  }

  // ---------- Start tab ----------
  function renderStart() {
    const el = $('labList'); el.innerHTML = '';
    const mine = S().list.filter((B) => B.sys !== 'barrier' && B !== L.cur);
    for (const B of mine) {
      const b = document.createElement('button'); b.className = 'item' + (L.src === B ? ' sel' : '');
      const name = (B.design && B.design.name) || B.recipe;
      b.innerHTML = `<b>${esc(name)}</b><small>${B.design ? 'editable design' : 'shape recipe'} · ${B.panels.filter((p) => p.state === 'fixed').length} parts · at ${Math.round(B.x)}, ${Math.round(B.z)}</small>`;
      b.onclick = () => { if (B.design) { setDesign(clone(B.design), B); tab('p'); } else shapeEdit(B); };
      el.appendChild(b);
    }
    if (!mine.length) el.innerHTML = '<div class="empty">No buildings in the world.</div>';
    const pr = $('labPre'); pr.innerHTML = '';
    for (const p of PRESETS) { const b = document.createElement('button'); b.className = 'item'; b.innerHTML = `<b>${esc(p.name)}</b><small>${esc(p.note)}</small>`; b.onclick = () => { setDesign(generate(clone(p.brief)), null); tab('p'); }; pr.appendChild(b); }
    const lb = $('labLib'); lb.innerHTML = ''; const lib = loadLib();
    lib.forEach((e, i) => {
      const b = document.createElement('div'); b.className = 'item row';
      b.innerHTML = `<b>${esc(e.name)}</b><span><button data-a="s">Open</button><button data-a="x">x</button></span>`;
      b.querySelector('[data-a=s]').onclick = () => { setDesign(clone(e.design), null); tab('p'); };
      b.querySelector('[data-a=x]').onclick = () => { lib.splice(i, 1); saveLib(lib); renderStart(); };
      lb.appendChild(b);
    });
    if (!lib.length) lb.innerHTML = '<div class="empty">Saved designs show up here.</div>';
  }
  // old free-form recipes (temple, round tower...): colour / strength only
  function shapeEdit(B) {
    const el = $('labList');
    const paints = ['auto', ...PAINTS.outer];
    $('labReport').innerHTML = `<b>${esc(B.recipe)}</b> is a free-form shape recipe. Colour:<div class="paints">${paints.map((c) => `<button class="sw" data-p="${c}" style="${c === 'auto' ? '' : 'background:' + c}">${c === 'auto' ? 'A' : ''}</button>`).join('')}</div>`;
    $('labReport').querySelectorAll('.sw').forEach((b) => (b.onclick = () => { const sp = { ...B.spec }; if (b.dataset.p === 'auto') delete sp.paint; else sp.paint = b.dataset.p; const x = B.x, z = B.z; S().removeBuilding(B); S().addBuilding({ ...sp, x, z }); renderStart(); }));
    focus(B.x, B.z, B.radius, B.cy);
  }

  // ---------- Look tab ----------
  function renderForm() {
    const el = $('labForm'); const D = L.design;
    if (!D) { el.innerHTML = '<div class="empty">Pick a style on the Start tab first.</div>'; return; }
    const b = L.brief; const o = b.opts || (b.opts = {});
    const num = (key, label, min, max, step) => `<label class="fld"><span>${label}<b id="v_${key}">${b[key] ?? ''}</b></span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${b[key] ?? min}"></label>`;
    const chk = (key, label, obj) => `<label class="chk"><input type="checkbox" data-c="${key}" data-o="${obj}" ${(obj === 'b' ? b : o)[key] ? 'checked' : ''}> ${label}</label>`;
    let h = `<h4>${esc(D.name)} - brief</h4>` + num('w', 'Width (m)', 6, 26, 0.5) + num('d', 'Depth (m)', 6, 22, 0.5) + num('floors', 'Floors', 1, 12, 1);
    h += `<div class="fld"><span>Style</span></div><div class="chips" id="fStyle">${Object.keys(STYLES).map((k) => `<button data-s="${k}" class="${b.style === k ? 'pri' : ''}">${k}</button>`).join('')}</div>`;
    h += `<div class="chks">${chk('garage', 'Garage', 'b')}${chk('shopGround', 'Shop below', 'b')}${chk('balcony', 'Balconies', 'o')}${chk('round', 'Round balcony', 'o')}${chk('fins', 'Fins / panel', 'o')}${chk('frame', 'Frame', 'o')}${chk('canopy', 'Entrance canopy', 'o')}${chk('chajja', 'Window hoods', 'o')}${chk('tank', 'Roof tank', 'o')}</div>`;
    h += `<div class="chks"><label class="chk"><input type="checkbox" id="fArch" ${b.openStyle === 'arch' ? 'checked' : ''}> Arched openings</label></div>`;
    h += `<button class="wide pri" id="fGen">Regenerate rooms from this brief</button><div class="hint2">Regenerate replaces the rooms you drew. Colour, openings and the rest stay editable in Plan and in the 3D view.</div>`;
    h += `<div class="fld"><span>Wall colour</span></div><div class="paints" id="fPaint">${WALL_COLS.map((c) => `<button class="sw ${D.paint === c ? 'sel' : ''}" data-p="${c}" style="background:${c}"></button>`).join('')}<button class="sw" data-p="auto">A</button></div>`;
    h += `<div class="chks"><button id="fShuffle">Shuffle furniture / seed</button></div>`;
    el.innerHTML = h;
    el.querySelectorAll('input[type=range]').forEach((i) => { i.oninput = () => { $('v_' + i.dataset.k).textContent = i.value; }; i.onchange = () => { b[i.dataset.k] = +i.value; regen(); }; });
    el.querySelectorAll('input[type=checkbox][data-c]').forEach((i) => (i.onchange = () => { (i.dataset.o === 'b' ? b : o)[i.dataset.c] = i.checked; regen(); }));
    $('fArch').onchange = (e) => { b.openStyle = e.target.checked ? 'arch' : 'rect'; regen(); };
    el.querySelectorAll('#fStyle button').forEach((x) => (x.onclick = () => { b.style = x.dataset.s; delete L.design.paint; regen(); renderForm(); }));
    el.querySelectorAll('#fPaint .sw').forEach((x) => (x.onclick = () => { if (x.dataset.p === 'auto') delete L.design.paint; else L.design.paint = x.dataset.p; scheduleBuild(0); renderForm(); }));
    $('fGen').onclick = regen;
    $('fShuffle').onclick = () => { b.seed = (Math.random() * 1e9) | 0; L.design.seed = b.seed; scheduleBuild(0); };
  }
  function regen() {
    const keep = { paint: L.design.paint, tints: L.design.tints };
    const D = generate(clone(L.brief)); D.paint = keep.paint; D.tints = keep.tints;
    L.design = D; L.f = Math.min(L.f, realFloors().length - 1); L.sel = null;
    scheduleBuild(120); if (L.tab === 'p') { renderFloors(); drawPlan(); renderProps(); }
  }

  // ---------- Plan tab: 2D editor ----------
  const cv = $('planCv'), g2 = cv.getContext('2d');
  const view = { s: 30, cx: 360, cy: 310, x0: 0, z0: 0 };
  function fit() {
    const D = L.design; if (!D) return;
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const F of D.floors) for (const r of F.rooms) { x0 = Math.min(x0, r.x0); x1 = Math.max(x1, r.x1); z0 = Math.min(z0, r.z0); z1 = Math.max(z1, r.z1); }
    const w = Math.max(10, x1 - x0 + 5), d = Math.max(8, z1 - z0 + 5);
    view.s = Math.min(cv.width / w, cv.height / d);
    view.x0 = (x0 + x1) / 2; view.z0 = (z0 + z1) / 2;
  }
  const toPx = (x, z) => [cv.width / 2 + (x - view.x0) * view.s, cv.height / 2 + (z - view.z0) * view.s];
  const fromPx = (px, py) => [(px - cv.width / 2) / view.s + view.x0, (py - cv.height / 2) / view.s + view.z0];
  function drawPlan() {
    const D = L.design, c = g2, W = cv.width, H = cv.height;
    c.fillStyle = '#0c0d10'; c.fillRect(0, 0, W, H);
    if (!D) { c.fillStyle = '#888'; c.font = '600 22px system-ui'; c.fillText('Pick a style on the Start tab', 40, 60); return; }
    fit();
    const [gx0, gz0] = fromPx(0, 0), [gx1, gz1] = fromPx(W, H);
    for (let m = Math.floor(gx0); m <= gx1; m++) { const [x] = toPx(m, 0); c.strokeStyle = m % 5 === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)'; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.stroke(); }
    for (let m = Math.floor(gz0); m <= gz1; m++) { const [, y] = toPx(0, m); c.strokeStyle = m % 5 === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)'; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    const F = curFloor(); if (!F) return;
    // ghost of the floor below
    if (L.f > 0) for (const r of D.floors[L.f - 1].rooms) { const [a, b] = toPx(r.x0, r.z0), [e, f2] = toPx(r.x1, r.z1); c.strokeStyle = 'rgba(255,255,255,.12)'; c.setLineDash([4, 4]); c.strokeRect(a, b, e - a, f2 - b); c.setLineDash([]); }
    F.rooms.forEach((r, i) => {
      const [a, b] = toPx(r.x0, r.z0), [e, f2] = toPx(r.x1, r.z1);
      c.fillStyle = (ROOM_COL[r.type] || '#777') + '66'; c.fillRect(a, b, e - a, f2 - b);
      if (r.type === 'stairs') { c.strokeStyle = 'rgba(245,196,0,.55)'; c.lineWidth = 1; const n = 10; for (let k = 1; k < n; k++) { const yy = b + ((f2 - b) * k) / n; c.beginPath(); c.moveTo(a, yy); c.lineTo(e, yy); c.stroke(); } }
      c.fillStyle = '#fff'; c.font = '700 ' + Math.max(11, Math.min(17, view.s * 0.5)) + 'px system-ui'; c.textAlign = 'center';
      c.fillText(r.type, (a + e) / 2, (b + f2) / 2 - 2);
      c.font = '500 ' + Math.max(10, Math.min(13, view.s * 0.4)) + 'px system-ui'; c.fillStyle = 'rgba(255,255,255,.7)';
      c.fillText(`${(r.x1 - r.x0).toFixed(1)} x ${(r.z1 - r.z0).toFixed(1)}`, (a + e) / 2, (b + f2) / 2 + 14); c.textAlign = 'left';
    });
    // compiled walls with their doors / windows (from the real build)
    const P = L.cur && L.cur.compiled && L.cur.compiled.plan && L.cur.compiled.plan[L.f];
    if (P) for (const s of P) {
      if (s.open) continue;
      const th = Math.max(2, (s.ext ? T_EXT : 0.115) * view.s);
      const p0 = s.axis === 'x' ? toPx(s.a0, s.c) : toPx(s.c, s.a0), p1 = s.axis === 'x' ? toPx(s.a1, s.c) : toPx(s.c, s.a1);
      c.lineCap = 'butt'; c.strokeStyle = s.ext ? '#cfc6b6' : '#8d8a84'; c.lineWidth = th; c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.stroke();
      for (const g of s.gaps) {
        const q0 = s.axis === 'x' ? toPx(s.a0 + g.a, s.c) : toPx(s.c, s.a0 + g.a), q1 = s.axis === 'x' ? toPx(s.a0 + g.a + g.wid, s.c) : toPx(s.c, s.a0 + g.a + g.wid);
        c.strokeStyle = g.door ? '#f5c400' : (g.pane ? '#4aa8ff' : '#0c0d10'); c.lineWidth = th + 2; c.beginPath(); c.moveTo(q0[0], q0[1]); c.lineTo(q1[0], q1[1]); c.stroke();
      }
    }
    // selection
    if (L.sel && L.sel.f === L.f && F.rooms[L.sel.i]) {
      const r = F.rooms[L.sel.i]; const [a, b] = toPx(r.x0, r.z0), [e, f2] = toPx(r.x1, r.z1);
      c.strokeStyle = '#f5c400'; c.lineWidth = 3; c.strokeRect(a, b, e - a, f2 - b);
      c.fillStyle = '#f5c400'; for (const [px, py] of [[a, b], [e, b], [a, f2], [e, f2], [(a + e) / 2, b], [(a + e) / 2, f2], [a, (b + f2) / 2], [e, (b + f2) / 2]]) c.fillRect(px - 5, py - 5, 10, 10);
    }
    if (L.drag && L.drag.mode === 'new') { const d = L.drag; const [a, b] = toPx(Math.min(d.x0, d.x1), Math.min(d.z0, d.z1)), [e, f2] = toPx(Math.max(d.x0, d.x1), Math.max(d.z0, d.z1)); c.strokeStyle = '#f5c400'; c.setLineDash([6, 5]); c.lineWidth = 2; c.strokeRect(a, b, e - a, f2 - b); c.setLineDash([]); }
    // pick marker from the 3D view
    if (L.pick && L.pick.f === L.f) { const [x, y] = toPx(L.pick.x, L.pick.z); c.fillStyle = '#f5c400'; c.beginPath(); c.arc(x, y, 7, 0, 6.3); c.fill(); }
    c.fillStyle = 'rgba(255,255,255,.55)'; c.font = '600 15px system-ui'; c.fillText(`Floor ${L.f === 0 ? 'ground' : L.f}${F.headhouse ? ' (roof head-house)' : ''} - ${F.rooms.length} rooms`, 10, 22);
  }
  const HINTS = { sel: 'Tap a room to select it. Drag inside to move, drag an edge or corner to resize.', room: 'Drag on the plan to draw a room. Pick its type below.', door: 'Tap a wall to add a door.', win: 'Tap an outside wall to add a window.', open: 'Tap a wall for an arched opening.', stairs: 'Tap to place a dog-leg stair well on every floor.', del: 'Tap a room to delete it, or tap an opening to remove it.' };
  function setTool(t) { L.tool = t; L.drag = null; root.querySelectorAll('#pTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); $('planHint').textContent = HINTS[t]; renderProps(); drawPlan(); }
  root.querySelectorAll('#pTools [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  function renderFloors() {
    const D = L.design; const el = $('fTabs'); el.innerHTML = '';
    if (!D) return;
    D.floors.forEach((F, i) => { const b = document.createElement('button'); b.textContent = F.headhouse ? 'Roof' : (i === 0 ? 'Ground' : 'Floor ' + i); b.className = i === L.f ? 'on' : ''; b.onclick = () => { L.f = i; L.sel = null; renderFloors(); renderProps(); drawPlan(); }; el.appendChild(b); });
    $('planHint').textContent = HINTS[L.tool];
  }
  function renderProps() {
    const el = $('roomProps'); const F = curFloor();
    if (!F) { el.innerHTML = ''; return; }
    const chips = ROOM_TYPES.map((t) => `<button data-t="${t}" class="${(L.sel && F.rooms[L.sel.i] && F.rooms[L.sel.i].type === t) || (!L.sel && L.roomType === t) ? 'pri' : ''}">${t}</button>`).join('');
    el.innerHTML = `<h4>${L.sel ? 'Selected room type' : 'Type for new rooms'}</h4><div class="chips">${chips}</div>` + (L.sel ? '<div class="toolbar"><button id="rDel" class="danger">Delete room</button></div>' : '');
    el.querySelectorAll('[data-t]').forEach((b) => (b.onclick = () => {
      if (L.sel && F.rooms[L.sel.i]) { F.rooms[L.sel.i].type = b.dataset.t; scheduleBuild(); } else L.roomType = b.dataset.t;
      renderProps(); drawPlan();
    }));
    const d = $('rDel'); if (d) d.onclick = () => { F.rooms.splice(L.sel.i, 1); L.sel = null; scheduleBuild(); renderProps(); drawPlan(); };
  }
  const evPlan = (e) => { const r = cv.getBoundingClientRect(); return fromPx(((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height); };
  const roomAt = (F, x, z) => { for (let i = F.rooms.length - 1; i >= 0; i--) { const r = F.rooms[i]; if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return i; } return -1; };
  const nearestSeg = (x, z, maxD = 0.7) => {
    const P = L.cur && L.cur.compiled && L.cur.compiled.plan && L.cur.compiled.plan[L.f]; if (!P) return null;
    let best = null, bd = maxD;
    for (const s of P) { const along = s.axis === 'x' ? x : z, across = s.axis === 'x' ? z : x; if (along < s.a0 - 0.1 || along > s.a1 + 0.1) continue; const d = Math.abs(across - s.c) - (s.ext ? 0 : 0); if (Math.abs(d) < bd) { bd = Math.abs(d); best = s; } }
    return best;
  };
  function addOpening(f, x, z, kind) {
    const F = L.design.floors[f];
    (F.openings = F.openings || []).push({ x, z, kind, w: kind === 'door' ? 1.0 : kind === 'window' ? 1.4 : 1.3, style: kind === 'arch' ? 'arch' : undefined });
    scheduleBuild(60);
  }
  function removeOpening(f, x, z) {
    const F = L.design.floors[f]; F.openings = F.openings || [];
    const i = F.openings.findIndex((o) => o.kind !== 'block' && Math.hypot(o.x - x, o.z - z) < 0.8);
    if (i >= 0) F.openings.splice(i, 1); else F.openings.push({ x, z, kind: 'block' });
    scheduleBuild(60);
  }
  function placeStairs(x, z) {
    const D = L.design; const ex = D.floors.find((F) => F.rooms.some((r) => r.type === 'stairs'));
    let W = 2.3, Lw = 3.45;
    if (ex) { const r = ex.rooms.find((r) => r.type === 'stairs'); W = r.x1 - r.x0; Lw = r.z1 - r.z0; }
    const x0 = q25(x - W / 2), z0 = q25(z - Lw / 2);
    for (const F of D.floors) {
      F.rooms = F.rooms.filter((r) => r.type !== 'stairs');
      F.rooms.push({ type: 'stairs', x0, x1: x0 + W, z0, z1: z0 + Lw });
    }
    scheduleBuild(60); drawPlan();
  }
  cv.addEventListener('pointerdown', (e) => {
    const D = L.design; if (!D) return; const F = curFloor(); const [x, z] = evPlan(e); const sx = q25(x), sz = q25(z);
    cv.setPointerCapture(e.pointerId);
    if (L.tool === 'room') { L.drag = { mode: 'new', x0: sx, z0: sz, x1: sx, z1: sz }; }
    else if (L.tool === 'sel') {
      const sel = L.sel && L.sel.f === L.f ? F.rooms[L.sel.i] : null;
      if (sel) {
        const m = 0.45 / Math.max(0.6, view.s / 30);
        const nx = Math.abs(x - sel.x0) < m ? 'x0' : Math.abs(x - sel.x1) < m ? 'x1' : null, nz = Math.abs(z - sel.z0) < m ? 'z0' : Math.abs(z - sel.z1) < m ? 'z1' : null;
        const inX = x > sel.x0 - m && x < sel.x1 + m, inZ = z > sel.z0 - m && z < sel.z1 + m;
        if ((nx && inZ) || (nz && inX)) { L.drag = { mode: 'resize', i: L.sel.i, nx: inZ ? nx : null, nz: inX ? nz : null }; return; }
      }
      const i = roomAt(F, x, z);
      if (i >= 0) { L.sel = { f: L.f, i }; const r = F.rooms[i]; L.drag = { mode: 'move', i, ox: x - r.x0, oz: z - r.z0, w: r.x1 - r.x0, d: r.z1 - r.z0 }; } else L.sel = null;
      renderProps(); drawPlan();
    } else if (L.tool === 'door' || L.tool === 'win' || L.tool === 'open') {
      const s = nearestSeg(x, z); if (!s) { status('Tap closer to a wall.'); return; }
      if (L.tool === 'win' && !s.ext) { status('Windows go on outside walls.'); return; }
      const px = s.axis === 'x' ? x : s.c, pz = s.axis === 'x' ? s.c : z;
      addOpening(L.f, px, pz, L.tool === 'door' ? 'door' : L.tool === 'win' ? 'window' : 'arch');
    } else if (L.tool === 'stairs') placeStairs(x, z);
    else if (L.tool === 'del') {
      const s = nearestSeg(x, z, 0.5);
      const onGap = s && s.gaps.some((g) => { const a = (s.axis === 'x' ? x : z) - s.a0; return a >= g.a - 0.2 && a <= g.a + g.wid + 0.2; });
      if (onGap) { removeOpening(L.f, s.axis === 'x' ? x : s.c, s.axis === 'x' ? s.c : z); drawPlan(); return; }
      const i = roomAt(F, x, z); if (i >= 0) { F.rooms.splice(i, 1); L.sel = null; scheduleBuild(); renderProps(); }
    }
    drawPlan();
  });
  cv.addEventListener('pointermove', (e) => {
    const D = L.design; if (!D || !L.drag) return; const F = curFloor(); const [x, z] = evPlan(e); const sx = q25(x), sz = q25(z);
    const d = L.drag;
    if (d.mode === 'new') { d.x1 = sx; d.z1 = sz; }
    else if (d.mode === 'move') { const r = F.rooms[d.i]; if (r) { const nx = q25(x - d.ox), nz = q25(z - d.oz); r.x0 = nx; r.z0 = nz; r.x1 = nx + d.w; r.z1 = nz + d.d; } }
    else if (d.mode === 'resize') { const r = F.rooms[d.i]; if (r) { if (d.nx) r[d.nx] = sx; if (d.nz) r[d.nz] = sz; } }
    drawPlan();
  });
  const endDrag = () => {
    const d = L.drag; L.drag = null; if (!d) return; const F = curFloor();
    if (d.mode === 'new') {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), z0 = Math.min(d.z0, d.z1), z1 = Math.max(d.z0, d.z1);
      if (x1 - x0 >= 1.0 && z1 - z0 >= 1.0) { F.rooms.push({ type: L.roomType, x0, x1, z0, z1 }); L.sel = { f: L.f, i: F.rooms.length - 1 }; setTool('sel'); }
    } else {
      const r = F.rooms[d.i]; if (r) { if (r.x0 > r.x1) [r.x0, r.x1] = [r.x1, r.x0]; if (r.z0 > r.z1) [r.z0, r.z1] = [r.z1, r.z0]; if (r.x1 - r.x0 < 1 || r.z1 - r.z0 < 1) { F.rooms.splice(d.i, 1); L.sel = null; } }
    }
    scheduleBuild(); renderProps(); drawPlan();
  };
  cv.addEventListener('pointerup', endDrag); cv.addEventListener('pointercancel', endDrag);

  $('fAdd').onclick = () => { const D = L.design; if (!D) return; const real = realFloors(); const top = real[real.length - 1]; const nf = clone(top); nf.openings = []; D.floors.splice(real.length, 0, nf); L.f = real.length; scheduleBuild(60); renderFloors(); drawPlan(); };
  $('fRem').onclick = () => { const D = L.design; if (!D) return; const real = realFloors(); if (real.length < 2) return; D.floors.splice(real.length - 1, 1); L.f = Math.min(L.f, real.length - 2); scheduleBuild(60); renderFloors(); drawPlan(); };
  $('fCopy').onclick = () => { const D = L.design; if (!D) return; const src = curFloor(); for (let i = L.f + 1; i < D.floors.length; i++) { if (D.floors[i].headhouse) continue; D.floors[i].rooms = clone(src.rooms); D.floors[i].openings = clone(src.openings || []); } scheduleBuild(60); status('Copied this floor to the floors above.'); };

  // ---------- 3D: click a part to edit it ----------
  const cvs = document.getElementById('gl');
  function camRay(ev) {
    const c = L.camNow || camState(); const r = cvs.getBoundingClientRect();
    const nx = ((ev.clientX - r.left) / r.width) * 2 - 1, ny = 1 - ((ev.clientY - r.top) / r.height) * 2;
    const f = norm3(sub3(c.look, c.eye)); const rt = norm3(cross3(f, [0, 1, 0])); const up = cross3(rt, f);
    const th = Math.tan((c.fov * Math.PI) / 360), asp = r.width / r.height;
    return { o: c.eye, d: norm3([f[0] + rt[0] * nx * th * asp + up[0] * ny * th, f[1] + rt[1] * nx * th * asp + up[1] * ny * th, f[2] + rt[2] * nx * th * asp + up[2] * ny * th]) };
  }
  const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm3 = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function rayBox(o, d, P, B) {
    const c = [B.x + P.cx, P.cy, B.z + P.cz];
    let lo = sub3(o, c), ld = d;
    if (P.q) { const qi = qConj(P.q); lo = qRot(qi, lo); ld = qRot(qi, d); }
    let t0 = 0, t1 = 1e9; const h = [P.hx, P.hy, P.hz];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(ld[i]) < 1e-9) { if (Math.abs(lo[i]) > h[i]) return -1; continue; }
      let a = (-h[i] - lo[i]) / ld[i], b = (h[i] - lo[i]) / ld[i]; if (a > b) [a, b] = [b, a];
      t0 = Math.max(t0, a); t1 = Math.min(t1, b); if (t0 > t1) return -1;
    }
    return t0;
  }
  function pickAt(ev) {
    const B = L.cur; if (!B) return;
    const { o, d } = camRay(ev);
    let best = null, bt = 1e9;
    for (const P of B.panels) {
      if (P.state !== 'fixed' || P.e.ghost) continue;
      const t = rayBox(o, d, P, B); if (t >= 0 && t < bt) { bt = t; best = P; }
    }
    if (!best) { L.pick = null; hidePick(); return; }
    const hit = [o[0] + d[0] * bt - B.x, o[1] + d[1] * bt, o[2] + d[2] * bt - B.z];
    const e = best.e;
    L.pick = { P: best, x: hit[0], y: hit[1], z: hit[2], f: Math.max(0, Math.min(L.design.floors.length - 1, e.f || 0)), src: e.src || null, kind: best.kind, mat: best.mat };
    showPick();
    if (L.tab === 'p') { L.f = L.pick.f; renderFloors(); renderProps(); drawPlan(); }
  }
  function hidePick() { const el = $('labPick'); if (el) el.classList.add('hidden'); }
  function showPick() {
    const p = L.pick, el = $('labPick'); if (!p) return hidePick();
    const nice = { wall: 'Wall', lintel: 'Beam over opening', pane: 'Window glass', door: 'Door', col: 'Column', slab: 'Slab' }[p.kind] || p.kind;
    const part = p.P.e.stair ? 'Stair step' : p.P.e.slabLook ? 'Floor slab' : p.P.e.parapet ? 'Parapet' : p.P.e.railing ? 'Balcony rail' : nice;
    const isWall = p.kind === 'wall' || p.kind === 'lintel' || p.kind === 'pane' || p.kind === 'door';
    let h = `<b>${esc(part)}</b><small>${p.f === 0 ? 'ground floor' : 'floor ' + p.f} - ${esc(p.mat)} - ${(p.P.hx * 2).toFixed(2)} x ${(p.P.hy * 2).toFixed(2)} x ${(p.P.hz * 2).toFixed(2)} m</small>`;
    if (isWall) {
      h += `<div class="toolbar"><button data-a="win">Window here</button><button data-a="door">Door here</button><button data-a="arch">Arch here</button><button data-a="rm">Remove opening</button></div>`;
      if (p.src && p.P.e.src) h += `<div class="paints">${WALL_COLS.map((c) => `<button class="sw" data-c="${c}" style="background:${c}"></button>`).join('')}</div><small>Colour applies to this wall line</small>`;
    } else h += '<small>Edit rooms, stairs and openings on the Plan tab.</small>';
    el.innerHTML = h + '<button class="x" data-a="x">x</button>'; el.classList.remove('hidden');
    el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = () => {
      const a = b.dataset.a;
      if (a === 'x') { L.pick = null; hidePick(); return; }
      if (a === 'rm') removeOpening(p.f, p.x, p.z);
      else addOpening(p.f, p.x, p.z, a === 'win' ? 'window' : a);
      status(a === 'rm' ? 'Opening removed (or blocked).' : 'Added - the engine placed it on the nearest wall.');
    }));
    el.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => { L.design.tints = L.design.tints || {}; L.design.tints[p.src] = b.dataset.c; scheduleBuild(40); }));
  }
  // camera: drag = orbit, pinch / wheel = zoom, short tap = pick
  const ptrs = new Map(); let pinch = 0, down = null;
  cvs.addEventListener('pointerdown', (e) => { if (!L.active) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]); down = { x: e.clientX, y: e.clientY, t: performance.now(), n: ptrs.size }; if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  addEventListener('pointerup', (e) => {
    if (L.active && down && ptrs.has(e.pointerId) && down.n === 1 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 450 && e.target === cvs) pickAt(e);
    ptrs.delete(e.pointerId);
  });
  addEventListener('pointercancel', (e) => ptrs.delete(e.pointerId));
  cvs.addEventListener('pointermove', (e) => {
    if (!L.active || !ptrs.has(e.pointerId)) return;
    const o = ptrs.get(e.pointerId); const dx = e.clientX - o[0], dy = e.clientY - o[1]; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { L.yaw -= dx * 0.006; L.pitch = Math.max(0.03, Math.min(1.45, L.pitch + dy * 0.005)); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) L.dist = Math.max(5, Math.min(140, L.dist * (pinch / d))); pinch = d; }
  });
  cvs.addEventListener('wheel', (e) => { if (!L.active) return; L.dist = Math.max(5, Math.min(140, L.dist * (1 + Math.sign(e.deltaY) * 0.1))); e.preventDefault(); }, { passive: false });

  // ---------- actions ----------
  $('aSave').onclick = () => {
    if (!L.design) return;
    const name = (window.prompt && window.prompt('Name this design', L.design.name || 'My building')) || ''; if (!name) return;
    L.design.name = name; const lib = loadLib(); lib.push({ name, design: clone(L.design) }); saveLib(lib); status('Saved to library.'); if (L.tab === 's') renderStart();
  };
  $('aApply').onclick = () => {
    if (!L.design) return;
    if (!L.src) { status('This is a new design. It stays on the test pad; use Copy design to hand it over for placement.'); return; }
    const s = S(); const o = L.src; const x = o.x, z = o.z;
    s.removeBuilding(o);
    L.src = s.addBuilding({ design: clone(L.design), x, z, paint: L.design.paint });
    status('World building updated at ' + Math.round(x) + ', ' + Math.round(z) + '.');
  };
  $('aNew').onclick = () => { L.design = null; if (L.cur) { S().removeBuilding(L.cur); L.cur = null; } L.src = null; $('labReport').innerHTML = ''; tab('s'); };
  $('aDel').onclick = () => { if (L.cur) { S().removeBuilding(L.cur); L.cur = null; } L.design = null; L.src = null; $('labReport').innerHTML = ''; tab('s'); };
  $('labCopy').onclick = async () => {
    if (!L.design) { status('Nothing to copy yet.'); return; }
    const txt = JSON.stringify({ name: L.design.name, design: L.design });
    try { await navigator.clipboard.writeText(txt); status('Design copied. Paste it in the chat for placement.'); }
    catch (e) { window.prompt && window.prompt('Copy this design', txt); }
  };
  $('labClose').onclick = () => close();

  // ---------- open / close ----------
  function open() { L.active = true; root.classList.remove('hidden'); document.getElementById('menu').classList.add('hidden'); L.yaw = 0.7; tab(L.design ? 'p' : 's'); if (L.design && !L.cur) scheduleBuild(0); setTool(L.tool); }
  function close() { L.active = false; root.classList.remove('hidden'); root.classList.add('hidden'); clearTimeout(L.timer); if (L.cur) { S().removeBuilding(L.cur); L.cur = null; } document.getElementById('menu').classList.remove('hidden'); if (api.onClose) api.onClose(); }
  window.openLab = open;
  const camState = () => {
    const t = L.target, d = L.dist, k = d * 0.2, rx = Math.cos(L.yaw) * k, rz = -Math.sin(L.yaw) * k;   // shift so the model sits right of the side panel
    const look = [t[0] - rx, t[1], t[2] - rz];
    return { eye: [look[0] + Math.sin(L.yaw) * Math.cos(L.pitch) * d, look[1] + Math.sin(L.pitch) * d, look[2] + Math.cos(L.yaw) * Math.cos(L.pitch) * d], look, fov: 50 };
  };
  const M = new Float32Array(16);
  return {
    get active() { return L.active; },
    cam() { L.camNow = camState(); return L.camNow; },
    // yellow marker over the part picked in the 3D view
    draw(r) {
      const p = L.pick; if (!p || !L.cur || p.P.state !== 'fixed') return;
      const P = p.P, B = L.cur;
      if (!P.selMesh) P.selMesh = S().rubbleMesh(T.white, [1, 0.8, 0.05], [P.hx * 2 + 0.05, P.hy * 2 + 0.05, P.hz * 2 + 0.05]);
      m4.fromTRS(M, [B.x + P.cx, P.cy, B.z + P.cz], P.q || [0, 0, 0, 1], 1);
      r.add(P.selMesh, M, { cast: false });
    },
    state: L, open, close, build,
  };
}
