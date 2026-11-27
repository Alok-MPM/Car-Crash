// BHARAT UI: the position strip (lat / lon / height / distance driven / ground) and the developer panel
//   (stand at a place to look at its ground, check the fetched heights against known real heights, see how the terrain loader is doing).
//   The panel is an inspection tool for the builder; the game itself has no teleport (the player drives).
import { KNOWN, PLACES, HOME } from '../engines/bharat/bharat.js';

const CSS = `
#bhHud{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(46px + var(--sab,0px));z-index:6;pointer-events:none;display:none;padding:5px 12px;background:rgba(10,11,13,.66);border:1px solid rgba(255,255,255,.1);border-radius:20px;font:600 12.5px/1.25 system-ui,sans-serif;letter-spacing:.02em;color:#eceef1;white-space:nowrap;max-width:94vw;overflow:hidden;text-overflow:ellipsis}
#bhHud b{color:var(--accent,#f5c400);font-weight:700}#bhHud i{font-style:normal;color:#8d939c}
#bhSheet{position:fixed;z-index:30;inset:calc(54px + var(--sat,0px)) calc(14px + var(--sar,0px)) calc(14px + var(--sab,0px)) calc(14px + var(--sal,0px));background:rgba(10,11,13,.97);border:1px solid rgba(255,255,255,.12);overflow:auto;-webkit-overflow-scrolling:touch;padding:16px 18px;display:none;color:#eceef1;font:14px/1.4 system-ui,sans-serif}
#bhSheet h3{margin:0 0 4px;font-size:24px;font-style:italic;font-weight:900;letter-spacing:.05em;text-transform:uppercase}
#bhSheet h4{margin:18px 0 8px;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#8d939c}
#bhSheet .x{position:absolute;right:12px;top:12px;width:42px;height:42px;border-radius:50%;font-size:20px;padding:0}
#bhSheet .note{color:#8d939c;font-size:12.5px;margin:0 0 6px;max-width:70ch}
#bhSheet .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(205px,1fr));gap:8px}
#bhSheet .pl{text-align:left;padding:9px 11px;border-radius:6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:#eceef1;font:inherit;min-height:48px}
#bhSheet .pl b{display:block;font-size:14px}#bhSheet .pl small{display:block;color:#8d939c;font-size:11.5px}
#bhSheet .row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
#bhSheet input{background:#14161a;border:1px solid rgba(255,255,255,.18);color:#eceef1;border-radius:6px;padding:9px 10px;font:inherit;width:130px}
#bhSheet .go{background:var(--accent,#f5c400);color:#000;border:0;border-radius:6px;padding:10px 16px;font-weight:700}
#bhSheet table{border-collapse:collapse;width:100%;max-width:640px;font-size:13px}#bhSheet td,#bhSheet th{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left}
#bhSheet .ok{color:#46c37b}#bhSheet .bad{color:#e5484d}
#bhSheet pre{margin:0;font:12px/1.5 ui-monospace,monospace;color:#cfd3d9;white-space:pre-wrap}
`;

const fmtLL = (lat, lon) => Math.abs(lat).toFixed(4) + '°' + (lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(lon).toFixed(4) + '°' + (lon >= 0 ? 'E' : 'W');

export function initBharatUI({ bharat, getPlayer, toast, $, inMenu }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const hud = document.createElement('div'); hud.id = 'bhHud'; document.body.appendChild(hud);
  const btn = document.createElement('button'); btn.id = 'bBharat'; btn.textContent = 'Bharat';
  const tb = $('topbtns'); if (tb) tb.appendChild(btn);
  const sh = document.createElement('div'); sh.id = 'bhSheet'; document.body.appendChild(sh);
  let open = false, t = 0;

  const stats = () => { const s = bharat.stats(); return `status      ${bharat.status}${bharat.on ? (bharat.atHome ? ' (home frame, old proving ground present)' : ' (away from home)') : ''}\nheight tiles  loaded ${s.tilesLoaded}   failed ${s.tilesFailed}   asked ${s.tilesReq}\nterrain     chunks ${s.chunks}   visible ${s.leaves}   built ${s.built}   ${s.pending ? 'building...' : 'complete'}\nre-centres  ${s.rebases}   ground cells ${s.win}`; };
  function render() {
    const p = getPlayer(), here = p ? bharat.geo(p.body.pos[0], p.body.pos[1], p.body.pos[2]) : null;
    sh.innerHTML = `<button class="x" id="bhX">✕</button><h3>Bharat</h3>
<p class="note">Real ground, 1 : 1. The game has no teleport for the player: you drive. This panel is the builder's inspection tool: stand somewhere to look at its ground, and check that the heights we fetch match the real world.</p>
${bharat.on ? '' : '<p class="note bad">Height data is not available right now (no network or tile server blocked): the old flat ground is in use. It keeps retrying by itself.</p>'}
<h4>Now</h4><pre id="bhNow">${here ? fmtLL(here.lat, here.lon) + '   height ' + here.alt.toFixed(0) + ' m' : ''}</pre>
<h4>Loader</h4><pre id="bhStats">${stats()}</pre>
<h4>Check heights against the real world</h4>
<div class="row"><button class="go" id="bhCheck">Run height self-check</button><span class="note" id="bhCheckNote"></span></div>
<table id="bhTable"></table>
<h4>Go to lat / lon (inspection)</h4>
<div class="row"><input id="bhLat" inputmode="decimal" placeholder="lat  26.1209"><input id="bhLon" inputmode="decimal" placeholder="lon  85.3647"><button class="go" id="bhGo">Go</button></div>
<h4>Places (look at the region's ground)</h4>
<div class="grid" id="bhPlaces">${PLACES.map((q, i) => `<button class="pl" data-i="${i}"><b>${q[0]}</b><small>${q[3]}</small></button>`).join('')}</div>`;
    sh.querySelector('#bhX').onclick = () => close();
    sh.querySelector('#bhGo').onclick = async () => { const la = parseFloat(sh.querySelector('#bhLat').value), lo = parseFloat(sh.querySelector('#bhLon').value); if (!(la > 5 && la < 38 && lo > 66 && lo < 99)) { toast('Enter a latitude 5 - 38 and longitude 66 - 99 (Bharat)', 'Go to'); return; } close(); await bharat.teleport(la, lo, 0); };
    for (const b of sh.querySelectorAll('.pl')) b.onclick = async () => { const q = PLACES[+b.dataset.i]; close(); await bharat.teleport(q[1], q[2], 0); toast(q[0], q[3]); };
    sh.querySelector('#bhCheck').onclick = async () => {
      const tab = sh.querySelector('#bhTable'), note = sh.querySelector('#bhCheckNote'); tab.innerHTML = '<tr><th>Place</th><th>Real</th><th>Fetched</th><th></th></tr>'; note.textContent = 'fetching tiles...';
      const rows = await bharat.selfCheck(KNOWN, (r) => { tab.insertAdjacentHTML('beforeend', `<tr><td>${r.name}</td><td>${r.want} m</td><td>${r.got === r.got ? r.got.toFixed(1) + ' m' : 'not fetched'}</td><td class="${r.ok ? 'ok' : 'bad'}">${r.ok ? 'OK' : 'CHECK'}</td></tr>`); });
      const ok = rows.filter((r) => r.ok).length; note.textContent = `${ok} of ${rows.length} agree with the real heights (within the tolerance for each place)`;
    };
  }
  function show() { open = true; render(); sh.style.display = 'block'; btn.classList.add('on'); }
  function close() { open = false; sh.style.display = 'none'; btn.classList.remove('on'); }
  btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); open ? close() : show(); });
  btn.addEventListener('click', (e) => e.stopPropagation());

  function tick(dt) {
    t -= dt; if (t > 0) return; t = 0.2;
    const p = getPlayer(); if (!p) return;
    const b = p.body.pos, g = bharat.geo(b[0], b[1], b[2]);
    if (bharat.on && !(inMenu && inMenu())) {
      const km = bharat.odo / 1000;
      hud.style.display = 'block';
      hud.innerHTML = `<b>${fmtLL(g.lat, g.lon)}</b> <i>·</i> ${g.alt.toFixed(0)} m <i>·</i> ${bharat.surface || ''} <i>·</i> ${km < 10 ? km.toFixed(2) : km.toFixed(1)} km driven`;
    } else hud.style.display = 'none';
    if (open) {
      const n = sh.querySelector('#bhNow'); if (n) n.textContent = fmtLL(g.lat, g.lon) + '   height ' + g.alt.toFixed(0) + ' m';
      const s = sh.querySelector('#bhStats'); if (s) s.textContent = stats();
    }
  }
  return { tick, show, close };
}
