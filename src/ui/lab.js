// Design Lab: pick a building that is already in the game (or start a new one), change it with sliders, or draw its floor plan
// with straight and curved walls, doors and windows. The Building Engine turns it into 3D, checks it and repairs what it can.
import { RECIPES } from '../data/recipes.js';
import { PAINTS } from '../data/materials.js';
import { newPlan, wallGeom, wallPoint, project, makeGap, planToSpec, rectPlan, planBounds } from './plan.js';

const LIB = 'crashyard_lab_v1';
const PAD = { x: 0, z: -260 };                       // where new designs are built
const NAMES = { house: 'House', houseSmall: 'Small house', shop: 'Shop', tower: 'Tower (6 floors)', roundTower: 'Round tower', mandir: 'Mandir', arcadeHall: 'Arcade hall', apse: 'Domed apse' };
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initLab(api) {
  const root = document.createElement('div');
  root.id = 'lab'; root.className = 'hidden';
  root.innerHTML = `
  <div id="labBar"><div class="brand"><i></i><div>Design Lab<small>Engine-checked</small></div></div>
    <div class="labTabs"><button data-t="b" class="on">Buildings</button><button data-t="d">Design</button><button data-t="p">Plan</button></div>
    <button id="labClose">Back to garage</button></div>
  <div id="labSide">
    <div class="pane" data-p="b">
      <h4>In the world</h4><div id="labList" class="list"></div>
      <h4>New from template</h4><div id="labTpl" class="chips"></div>
      <h4>Library</h4><div id="labLib" class="list"></div>
    </div>
    <div class="pane hidden" data-p="d"><div id="labForm"></div></div>
    <div class="pane hidden" data-p="p">
      <div class="toolbar" id="pTools">
        <button data-tool="wall" class="on">Wall</button><button data-tool="arc">Curve</button><button data-tool="door">Door</button><button data-tool="win">Window</button><button data-tool="del">Erase</button><button id="pUndo">Undo</button>
      </div>
      <canvas id="planCv" width="640" height="560"></canvas>
      <div id="planHint" class="hint2">Tap to place wall points. Snaps to 0.5 m.</div>
      <div class="grid2" id="planProps"></div>
    </div>
    <div id="labReport" class="report"></div>
    <div id="labActs">
      <button id="aApply" class="pri">Build</button><button id="aPlace">Place near me</button><button id="aSave">Save</button><button id="aDel" class="danger">Delete</button>
    </div>
  </div>`;
  document.body.appendChild(root);

  const L = { active: false, tab: 'b', cur: null, spec: null, x: PAD.x, z: PAD.z, plan: null, tool: 'wall', pend: null, pendM: null, hover: null, scale: 20, yaw: 0.7, pitch: 0.38, dist: 28, target: [PAD.x, 3, PAD.z] };
  const scene = () => api.scene();
  const S = () => scene().structures;

  // ---------- tabs ----------
  function tab(t) {
    L.tab = t;
    root.querySelectorAll('.labTabs button').forEach((b) => b.classList.toggle('on', b.dataset.t === t));
    root.querySelectorAll('.pane').forEach((p) => p.classList.toggle('hidden', p.dataset.p !== t));
    if (t === 'b') renderList(); if (t === 'd') renderForm(); if (t === 'p') { ensurePlan(); drawPlan(); renderProps(); }
  }
  root.querySelectorAll('.labTabs button').forEach((b) => (b.onclick = () => tab(b.dataset.t)));

  // ---------- buildings ----------
  const stock = () => S().list.filter((B) => B.spec && B.sys !== 'barrier');
  function nameOf(B) { return NAMES[B.recipe] || (B.spec && B.spec.name) || (B.spec && B.spec.lab ? 'Custom plan' : 'Building'); }
  function renderList() {
    const el = $('labList'); el.innerHTML = '';
    for (const B of stock()) {
      const b = document.createElement('button'); b.className = 'item' + (L.cur === B ? ' sel' : '');
      const ok = B.report ? (B.report.ok ? 'ok' : 'warn') : '';
      b.innerHTML = `<b>${esc(nameOf(B))}</b><small>${B.panels.filter((p) => p.state === 'fixed').length} parts · ${B.report ? B.report.tons : '?'} t · at ${Math.round(B.x)}, ${Math.round(B.z)}</small><i class="dot ${ok}"></i>`;
      b.onclick = () => { select(B); tab('d'); };
      el.appendChild(b);
    }
    if (!el.children.length) el.innerHTML = '<div class="empty">No buildings in the world yet.</div>';
    const tp = $('labTpl'); tp.innerHTML = '';
    for (const k of Object.keys(NAMES)) { const b = document.createElement('button'); b.textContent = NAMES[k]; b.onclick = () => fromTemplate(k); tp.appendChild(b); }
    const blank = document.createElement('button'); blank.textContent = 'Blank plan'; blank.className = 'pri'; blank.onclick = () => { L.plan = newPlan(); L.spec = { name: 'My building', lab: L.plan }; L.cur = null; L.x = PAD.x; L.z = PAD.z; focus(PAD.x, PAD.z, 12); tab('p'); status('Draw walls on the plan, then press Build.'); }; tp.appendChild(blank);
    const lb = $('labLib'); lb.innerHTML = '';
    const lib = loadLib();
    lib.forEach((e, i) => {
      const b = document.createElement('div'); b.className = 'item row';
      b.innerHTML = `<b>${esc(e.name)}</b><span><button data-a="s">Build</button><button data-a="x">✕</button></span>`;
      b.querySelector('[data-a=s]').onclick = () => { L.spec = JSON.parse(JSON.stringify(e.spec)); L.plan = L.spec.lab || null; L.cur = null; L.x = PAD.x; L.z = PAD.z; build(); tab('d'); };
      b.querySelector('[data-a=x]').onclick = () => { lib.splice(i, 1); saveLib(lib); renderList(); };
      lb.appendChild(b);
    });
    if (!lib.length) lb.innerHTML = '<div class="empty">Saved designs show up here.</div>';
  }
  const loadLib = () => { try { return JSON.parse(localStorage.getItem(LIB) || '[]'); } catch (e) { return []; } };
  const saveLib = (a) => { try { localStorage.setItem(LIB, JSON.stringify(a)); } catch (e) {} };

  function focus(x, z, r) { L.target = [x, Math.max(2, r * 0.25), z]; L.dist = Math.max(14, r * 2.4); }
  function select(B) {
    L.cur = B;
    const base = RECIPES[B.recipe] || {};
    L.spec = JSON.parse(JSON.stringify({ ...base, ...B.spec }));
    delete L.spec.x; delete L.spec.z;
    L.x = B.x; L.z = B.z; L.plan = L.spec.lab ? JSON.parse(JSON.stringify(L.spec.lab)) : null;
    focus(B.x, B.z, B.radius);
    showReport(B);
  }
  function fromTemplate(k) {
    L.spec = JSON.parse(JSON.stringify({ ...RECIPES[k], recipe: k })); L.plan = null; L.cur = null; L.x = PAD.x; L.z = PAD.z;
    build(); tab('d');
  }
  function build() {
    const s = S();
    if (L.cur) s.removeBuilding(L.cur);
    const spec = { ...L.spec, x: L.x, z: L.z };
    if (L.plan && L.spec.lab) { const sp = planToSpec(L.plan, L.spec.paint); if (sp) { spec.shapes = sp.shapes; spec.lab = sp.lab; delete spec.recipe; } else { status('Draw at least one wall first.'); L.cur = null; return; } }
    try { L.cur = s.addBuilding(spec); } catch (e) { console.error(e); status('Engine could not build this: ' + e.message); L.cur = null; return; }
    L.spec = { ...spec }; delete L.spec.x; delete L.spec.z;
    focus(L.x, L.z, L.cur.radius);
    showReport(L.cur);
    if (L.tab === 'b') renderList();
  }
  function showReport(B) {
    const r = B.report, el = $('labReport');
    if (!r) { el.innerHTML = ''; return; }
    const open = r.issues.filter((i) => !i.fixed), fixed = r.issues.filter((i) => i.fixed);
    el.innerHTML = `<b class="${open.length ? 'warn' : 'ok'}">Engine check: ${open.length ? open.length + ' open issue(s)' : 'all clear'}</b> · ${r.panels} parts · ${r.tons} t` +
      (fixed.length ? `<div class="fx">${fixed.length} auto-repaired: ${esc(fixed.slice(0, 3).map((i) => i.msg).join('; '))}${fixed.length > 3 ? '…' : ''}</div>` : '') +
      (open.length ? `<div class="op">${esc(open.slice(0, 3).map((i) => i.msg).join('; '))}</div>` : '');
  }
  const status = (m) => { $('labReport').innerHTML = `<span>${esc(m)}</span>`; };

  // ---------- Design tab ----------
  function renderForm() {
    const el = $('labForm'); const sp = L.spec;
    if (!sp) { el.innerHTML = '<div class="empty">Pick a building in the Buildings tab, or start from a template.</div>'; return; }
    const std = !sp.shapes && !sp.lab;
    const num = (key, label, min, max, step) => `<label class="fld"><span>${label}<b id="v_${key}">${sp[key] ?? ''}</b></span><input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" value="${sp[key] ?? min}"></label>`;
    const chk = (key, label) => `<label class="chk"><input type="checkbox" data-c="${key}" ${sp[key] ? 'checked' : ''}> ${label}</label>`;
    let h = `<h4>${esc(nameOf(L.cur || { spec: sp, recipe: sp.recipe }))}</h4>`;
    if (std) {
      h += num('w', 'Width (m)', 5, 24, 0.5) + num('d', 'Depth (m)', 5, 20, 0.5) + num('floors', 'Floors', 1, 8, 1);
      h += `<label class="fld"><span>Structure</span><select data-s="system"><option value="auto">Auto (engine decides)</option><option value="loadbearing">Load-bearing brick</option><option value="frame">RCC frame + block</option></select></label>`;
      h += `<div class="chks">${chk('garage', 'Garage')}${chk('balcony', 'Balcony')}${chk('storefront', 'Shop front')}</div>`;
      h += `<button id="fConvert" class="wide">Convert to editable plan (walls, curves, openings)</button>`;
    } else if (sp.lab) {
      h += '<div class="note">Built from the Plan tab. Change the walls there.</div>';
    } else {
      h += '<div class="note">Free-form shape recipe (curved walls / dome / spire). Colour and strength can be changed here; draw a new plan for full control.</div>';
      h += `<div class="chks">${chk('indestructible', 'Indestructible (temple boundary)')}</div>`;
    }
    h += `<div class="fld"><span>Paint</span></div><div class="paints" id="fPaint">${['auto', ...PAINTS.outer].map((c) => `<button class="sw ${sp.paint === c || (c === 'auto' && !sp.paint) ? 'sel' : ''}" data-p="${c}" style="${c === 'auto' ? '' : 'background:' + c}">${c === 'auto' ? 'A' : ''}</button>`).join('')}</div>`;
    h += `<div class="chks"><button id="fShuffle">Shuffle layout / colours</button></div>`;
    el.innerHTML = h;
    el.querySelectorAll('input[type=range]').forEach((i) => { i.oninput = () => { $('v_' + i.dataset.k).textContent = i.value; }; i.onchange = () => { sp[i.dataset.k] = +i.value; build(); }; });
    el.querySelectorAll('input[type=checkbox]').forEach((i) => (i.onchange = () => { sp[i.dataset.c] = i.checked; build(); }));
    const sel = el.querySelector('select[data-s]'); if (sel) { sel.value = sp.system || 'auto'; sel.onchange = () => { sp.system = sel.value; build(); }; }
    el.querySelectorAll('#fPaint .sw').forEach((b) => (b.onclick = () => { if (b.dataset.p === 'auto') delete sp.paint; else sp.paint = b.dataset.p; build(); renderForm(); }));
    const sh = $('fShuffle'); if (sh) sh.onclick = () => { sp.seed = (Math.random() * 1e9) | 0; build(); };
    const cv = $('fConvert'); if (cv) cv.onclick = () => { L.plan = rectPlan(sp.w || 10, sp.d || 8, sp.floors || 2); L.spec = { name: 'My building', lab: L.plan, paint: sp.paint }; build(); tab('p'); };
  }

  // ---------- Plan tab ----------
  function ensurePlan() { if (!L.plan) { L.plan = newPlan(); L.spec = L.spec && L.spec.lab ? L.spec : { name: 'My building', lab: L.plan }; } }
  const cv = $('planCv'), g2 = cv.getContext('2d');
  const toPx = (p) => [320 + p[0] * L.scale, 280 + p[1] * L.scale];
  const fromPx = (x, y) => [(x - 320) / L.scale, (y - 280) / L.scale];
  const snap = (p) => {
    if (L.plan) for (const w of L.plan.walls) for (const q of [w.p0, w.p1]) if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 0.45) return q.slice();
    return [Math.round(p[0] * 2) / 2, Math.round(p[1] * 2) / 2];
  };
  function drawPlan() {
    const c = g2, W = cv.width, H = cv.height;
    c.fillStyle = '#0c0d10'; c.fillRect(0, 0, W, H);
    for (let m = -16; m <= 16; m++) {
      const [x] = toPx([m, 0]), [, y] = toPx([0, m]);
      c.strokeStyle = m % 5 === 0 ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.05)'; c.lineWidth = 1;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x, H); c.moveTo(0, y); c.lineTo(W, y); c.stroke();
    }
    const plan = L.plan; if (!plan) return;
    for (const w of plan.walls) {
      const g = wallGeom(w); const th = Math.max(4, (w.thick || plan.thick) * L.scale);
      c.lineCap = 'butt'; c.strokeStyle = plan.mat === 'rcc' ? '#9aa0a8' : '#c27a58'; c.lineWidth = th;
      c.beginPath();
      if (g.kind === 'arc') { const [cx, cy] = toPx(g.c); c.arc(cx, cy, g.r * L.scale, g.a0, g.a0 + g.sweep, g.sweep < 0); }
      else { const a = toPx(w.p0), b = toPx(w.p1); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
      c.stroke();
      for (const q of w.gaps || []) {
        c.strokeStyle = q.door ? '#f5c400' : '#4aa8ff'; c.lineWidth = th + 2;
        c.beginPath();
        const steps = 10; for (let i = 0; i <= steps; i++) { const p = toPx(wallPoint(w, g, q.a + (q.wid * i) / steps)); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); }
        c.stroke();
      }
    }
    for (const w of plan.walls) for (const p of [w.p0, w.p1]) { const [x, y] = toPx(p); c.fillStyle = '#fff'; c.fillRect(x - 3, y - 3, 6, 6); }
    // pending points
    const dot = (p, col) => { const [x, y] = toPx(p); c.fillStyle = col; c.beginPath(); c.arc(x, y, 6, 0, 6.3); c.fill(); };
    if (L.pend) {
      dot(L.pend, '#f5c400');
      if (L.hover) {
        const a = toPx(L.pend), b = toPx(L.hover); c.strokeStyle = 'rgba(245,196,0,.7)'; c.lineWidth = 2; c.setLineDash([6, 5]);
        c.beginPath();
        if (L.tool === 'arc' && L.pendM) { const w = { type: 'arc', p0: L.pend, p1: L.pendM, pm: L.hover }; const g = wallGeom(w); if (g.kind === 'arc') { const [cx, cy] = toPx(g.c); c.arc(cx, cy, g.r * L.scale, g.a0, g.a0 + g.sweep, g.sweep < 0); } else { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); } }
        else { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); }
        c.stroke(); c.setLineDash([]);
        const len = Math.hypot(L.hover[0] - L.pend[0], L.hover[1] - L.pend[1]); c.fillStyle = '#fff'; c.font = '700 20px system-ui'; c.fillText(len.toFixed(1) + ' m', b[0] + 10, b[1] - 10);
      }
      if (L.pendM) dot(L.pendM, '#f5c400');
    }
    const bb = planBounds(plan); if (bb) { c.fillStyle = 'rgba(255,255,255,.55)'; c.font = '600 18px system-ui'; c.fillText(`${(bb.x1 - bb.x0).toFixed(1)} × ${(bb.z1 - bb.z0).toFixed(1)} m · ${plan.walls.length} walls`, 12, 26); }
  }
  const HINTS = { wall: 'Tap two points to draw a straight wall. Keep tapping to continue the chain.', arc: 'Curved wall: tap START, tap END, then tap a point the curve passes through.', door: 'Tap a wall to add a door.', win: 'Tap a wall to add a window.', del: 'Tap a wall or an opening to remove it.' };
  function setTool(t) { L.tool = t; L.pend = null; L.pendM = null; root.querySelectorAll('#pTools [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)); $('planHint').textContent = HINTS[t]; drawPlan(); }
  root.querySelectorAll('#pTools [data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
  $('pUndo').onclick = () => { if (L.pend) { L.pend = null; L.pendM = null; } else if (L.plan) L.plan.walls.pop(); drawPlan(); };
  function evPlan(e) { const r = cv.getBoundingClientRect(); return fromPx(((e.clientX - r.left) / r.width) * cv.width, ((e.clientY - r.top) / r.height) * cv.height); }
  cv.addEventListener('pointermove', (e) => { if (!L.pend) return; L.hover = snap(evPlan(e)); drawPlan(); });
  cv.addEventListener('pointerdown', (e) => {
    ensurePlan(); const plan = L.plan; const raw = evPlan(e); const p = snap(raw);
    if (L.tool === 'wall') {
      if (!L.pend) L.pend = p; else if (Math.hypot(p[0] - L.pend[0], p[1] - L.pend[1]) > 0.2) { plan.walls.push({ type: 'line', p0: L.pend, p1: p, gaps: [] }); L.pend = p; }
    } else if (L.tool === 'arc') {
      if (!L.pend) L.pend = p; else if (!L.pendM) L.pendM = p; else { plan.walls.push({ type: 'arc', p0: L.pend, p1: L.pendM, pm: p, gaps: [] }); L.pend = null; L.pendM = null; }
    } else {
      let best = null, bd = 0.9;
      for (const w of plan.walls) { const pr = project(w, raw); if (pr.d < bd) { bd = pr.d; best = { w, pr }; } }
      if (best) {
        const { w, pr } = best;
        if (L.tool === 'del') {
          const hit = (w.gaps || []).findIndex((q) => pr.s >= q.a - 0.1 && pr.s <= q.a + q.wid + 0.1);
          if (hit >= 0) w.gaps.splice(hit, 1); else plan.walls.splice(plan.walls.indexOf(w), 1);
        } else {
          const q = makeGap(L.tool === 'door' ? 'rect' : 'rect', L.tool === 'door', plan.style);
          q.a = Math.max(0.15, Math.min(pr.g.len - q.wid - 0.15, pr.s - q.wid / 2));
          if (pr.g.len < q.wid + 0.3) status('Wall too short for that opening.');
          else if ((w.gaps || []).some((o) => q.a < o.a + o.wid + 0.1 && q.a + q.wid > o.a - 0.1)) status('Opening overlaps another one.');
          else (w.gaps = w.gaps || []).push(q);
        }
      }
    }
    drawPlan();
  });
  function renderProps() {
    const plan = L.plan; if (!plan) return;
    const opt = (v, arr) => arr.map((a) => `<option ${a[0] === v ? 'selected' : ''} value="${a[0]}">${a[1]}</option>`).join('');
    $('planProps').innerHTML = `
      <label class="fld"><span>Wall height<b>${plan.h} m</b></span><input type="range" data-q="h" min="2.4" max="6" step="0.1" value="${plan.h}"></label>
      <label class="fld"><span>Storeys<b>${plan.storeys}</b></span><input type="range" data-q="storeys" min="1" max="4" step="1" value="${plan.storeys}"></label>
      <label class="fld"><span>Wall</span><select data-q="mat">${opt(plan.mat, [['clay', 'Red clay brick'], ['block', 'Concrete block'], ['rcc', 'RCC / poured concrete']])}</select></label>
      <label class="fld"><span>Thickness</span><select data-q="thick">${opt(String(plan.thick), [['0.115', '115 mm'], ['0.23', '230 mm'], ['0.35', '350 mm'], ['0.45', '450 mm']])}</select></label>
      <label class="fld"><span>Openings</span><select data-q="style">${opt(plan.style, [['rect', 'Rectangular'], ['arch', 'Round arch'], ['pointed', 'Pointed arch'], ['round', 'Round window']])}</select></label>
      <label class="fld"><span>Roof</span><select data-q="roof">${opt(plan.roof, [['flat', 'Flat slab'], ['none', 'Open top'], ['dome', 'Dome']])}</select></label>`;
    $('planProps').querySelectorAll('[data-q]').forEach((i) => {
      i.onchange = () => { const k = i.dataset.q; plan[k] = ['h', 'storeys', 'thick'].includes(k) ? +i.value : i.value; if (k === 'thick') for (const w of plan.walls) delete w.thick; renderProps(); drawPlan(); };
    });
  }

  // ---------- actions ----------
  $('aApply').onclick = () => { if (!L.spec) { status('Pick a building or a template first.'); return; } build(); if (L.tab === 'd') renderForm(); };
  $('aPlace').onclick = () => {
    if (!L.spec) return;
    const p = api.player(); const b = p.body, R = b.R;
    const fw = [-R[6], 0, -R[8]]; const l = Math.hypot(fw[0], fw[2]) || 1;
    const rad = L.cur ? L.cur.radius : 12;
    L.x = Math.round(b.pos[0] + (fw[0] / l) * (rad + 14)); L.z = Math.round(b.pos[2] + (fw[2] / l) * (rad + 14));
    build(); status(`Placed at ${L.x}, ${L.z} - in front of your car.`);
  };
  $('aSave').onclick = () => {
    if (!L.spec) return;
    const name = (window.prompt && window.prompt('Name this design', nameOf(L.cur || { spec: L.spec, recipe: L.spec.recipe }))) || '';
    if (!name) return;
    const lib = loadLib(); const sp = JSON.parse(JSON.stringify(L.spec)); sp.name = name; delete sp.x; delete sp.z;
    lib.push({ name, spec: sp }); saveLib(lib); status('Saved to library.'); if (L.tab === 'b') renderList();
  };
  $('aDel').onclick = () => { if (L.cur) { S().removeBuilding(L.cur); L.cur = null; L.spec = null; $('labReport').innerHTML = ''; tab('b'); } };
  $('labClose').onclick = () => close();

  // ---------- camera ----------
  const cvs = document.getElementById('gl');
  const ptrs = new Map(); let pinch = 0;
  cvs.addEventListener('pointerdown', (e) => { if (!L.active) return; ptrs.set(e.pointerId, [e.clientX, e.clientY]); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); } });
  addEventListener('pointerup', (e) => ptrs.delete(e.pointerId)); addEventListener('pointercancel', (e) => ptrs.delete(e.pointerId));
  cvs.addEventListener('pointermove', (e) => {
    if (!L.active || !ptrs.has(e.pointerId)) return;
    const o = ptrs.get(e.pointerId); const dx = e.clientX - o[0], dy = e.clientY - o[1]; ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) { L.yaw -= dx * 0.006; L.pitch = Math.max(0.05, Math.min(1.45, L.pitch + dy * 0.005)); }
    else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) L.dist = Math.max(6, Math.min(140, L.dist * (pinch / d))); pinch = d; }
  });
  cvs.addEventListener('wheel', (e) => { if (!L.active) return; L.dist = Math.max(6, Math.min(140, L.dist * (1 + Math.sign(e.deltaY) * 0.1))); e.preventDefault(); }, { passive: false });

  function open() { L.active = true; root.classList.remove('hidden'); document.getElementById('menu').classList.add('hidden'); L.yaw = 0.7; renderList(); tab('b'); if (L.cur) focus(L.x, L.z, L.cur.radius); else focus(PAD.x, PAD.z, 12); }
  function close() { L.active = false; root.classList.add('hidden'); document.getElementById('menu').classList.remove('hidden'); if (api.onClose) api.onClose(); }
  window.openLab = open;
  return {
    get active() { return L.active; },
    cam() {
      const t = L.target, d = L.dist, k = d * 0.2, rx = Math.cos(L.yaw) * k, rz = -Math.sin(L.yaw) * k;   // shift so the model sits right of the side panel
      const look = [t[0] - rx, t[1], t[2] - rz];
      return { eye: [look[0] + Math.sin(L.yaw) * Math.cos(L.pitch) * d, look[1] + Math.sin(L.pitch) * d, look[2] + Math.cos(L.yaw) * Math.cos(L.pitch) * d], look, fov: 50 };
    },
    state: L, open, close, build,
  };
}
