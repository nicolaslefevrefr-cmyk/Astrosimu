import { PLANETS, SUN, MOON, dateToJD, jdToDate } from './orbitalData.js';
import { planetPosition, planetOrbitPath, moonPositionGeocentric, rotationAngleDeg } from './kepler.js';
import { buildInitialState, integrateTrajectory, samplePosition, computeVariationFamily } from './physics.js';
import { Renderer } from './render.js';

// ===========================================================
// State
// ===========================================================
const canvas = document.getElementById('sky');
const renderer = new Renderer(canvas);

let simJD = dateToJD(new Date());
let speed = 0;          // simulated days per real second
let lastSpeed = 2;      // remembered for pause/resume
let lastFrame = performance.now();
let selectedKey = null; // 'sun' | planet key | 'moon' | 'ast:<id>'
let locked = false;

const orbitCache = { jd: null, paths: {} };
let asteroids = []; // {id, name, color, params, trajectory, family, massKg}
let astCounter = 0;

const ASTEROID_COLORS = ['#ff6b6b','#ffd166','#8ecae6','#c77dff','#7cf29c','#f4a261'];

const FOCUS_ZOOM = {
  sun: 80, mercury: 900, venus: 500, earth: 380, moon: 60000,
  mars: 260, jupiter: 70, saturn: 45, uranus: 20, neptune: 13
};

const ALL_BODY_META = [
  { key:'sun', name:'Soleil', color: SUN.color },
  ...PLANETS.map(p => ({ key:p.key, name:p.name, color:p.color })),
  { key:'moon', name:'Lune', color: MOON.color },
];

// ===========================================================
// Body positions for a given time
// ===========================================================
function computeBodiesNow(jd){
  const bodies = { sun: { x:0, y:0, z:0 } };
  for (const p of PLANETS) bodies[p.key] = planetPosition(p, jd);
  const moonGeo = moonPositionGeocentric(jd);
  bodies.moon = {
    x: bodies.earth.x + moonGeo.x,
    y: bodies.earth.y + moonGeo.y,
    z: bodies.earth.z + moonGeo.z,
  };
  return bodies;
}

function refreshOrbitCache(jd){
  if (orbitCache.jd !== null && Math.abs(jd - orbitCache.jd) < 25) return;
  orbitCache.jd = jd;
  for (const p of PLANETS) orbitCache.paths[p.key] = planetOrbitPath(p, jd, 160);
}

// ===========================================================
// Camera helpers
// ===========================================================
function focusOn(key){
  selectedKey = key;
  locked = false;
  const bodies = computeBodiesNow(simJD);
  let pos;
  if (key.startsWith('ast:')){
    const a = asteroids.find(x => x.id === key.slice(4));
    pos = a ? samplePosition(a.trajectory, simJD) : { x:0, y:0 };
    renderer.cam.zoom = 300;
  } else {
    pos = bodies[key];
    renderer.cam.zoom = FOCUS_ZOOM[key] ?? 80;
  }
  renderer.cam.x = pos.x; renderer.cam.y = pos.y;
  updateLockPill();
  updateDock();
}

function clearFocus(){
  selectedKey = null;
  locked = false;
  updateLockPill();
  updateDock();
}

// ===========================================================
// UI: body dock
// ===========================================================
const dockEl = document.getElementById('bodyDock');
ALL_BODY_META.forEach(b => {
  const chip = document.createElement('button');
  chip.className = 'body-chip';
  chip.dataset.key = b.key;
  chip.innerHTML = `<span class="dot" style="background:${b.color};color:${b.color}"></span>${b.name}`;
  chip.addEventListener('click', () => focusOn(b.key));
  dockEl.appendChild(chip);
});
function updateDock(){
  [...dockEl.children].forEach(c => c.classList.toggle('active', c.dataset.key === selectedKey));
}

// ===========================================================
// UI: lock pill
// ===========================================================
const lockPill = document.getElementById('lockPill');
const lockLabel = document.getElementById('lockLabel');
const btnLockToggle = document.getElementById('btnLockToggle');
document.getElementById('btnLockClose').addEventListener('click', clearFocus);
btnLockToggle.addEventListener('click', () => {
  locked = !locked;
  updateLockPill();
});
function updateLockPill(){
  if (!selectedKey){ lockPill.classList.add('hidden'); return; }
  lockPill.classList.remove('hidden');
  const meta = selectedKey.startsWith('ast:')
    ? asteroids.find(a => a.id === selectedKey.slice(4))
    : ALL_BODY_META.find(b => b.key === selectedKey);
  lockLabel.textContent = meta ? (meta.name || meta.name) : '—';
  btnLockToggle.setAttribute('aria-pressed', String(locked));
  btnLockToggle.textContent = locked ? 'Suivi ✓' : 'Suivre';
}

document.getElementById('btnRecenter').addEventListener('click', () => {
  clearFocus();
  renderer.cam.x = 0; renderer.cam.y = 0; renderer.cam.zoom = 80;
});

// ===========================================================
// UI: time controls
// ===========================================================
const dateBig = document.getElementById('dateBig');
const dateOffset = document.getElementById('dateOffset');
const speedSlider = document.getElementById('speedSlider');
const speedValue = document.getElementById('speedValue');
const scrubSlider = document.getElementById('scrubSlider');
const scrubValue = document.getElementById('scrubValue');
const btnPause = document.getElementById('btnPause');
const btnNow = document.getElementById('btnNow');
const speedPresetsEl = document.getElementById('speedPresets');

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'
});

function fmtSpeed(v){
  if (v === 0) return 'Pause';
  const abs = Math.abs(v);
  let txt;
  if (abs >= 365) txt = (abs/365).toFixed(1) + ' an/s';
  else if (abs >= 30) txt = (abs/30).toFixed(1) + ' mois/s';
  else txt = abs.toFixed(abs < 2 ? 2 : 0) + ' j/s';
  return (v < 0 ? '−' : '+') + txt;
}

function setSpeed(v){
  speed = v;
  if (v !== 0) lastSpeed = v;
  speedSlider.value = String(v);
  speedValue.textContent = fmtSpeed(v);
  btnPause.textContent = v === 0 ? '▶ Lecture' : '⏸ Pause';
  [...speedPresetsEl.children].forEach(b => b.classList.toggle('active', Number(b.dataset.v) === v));
}

const PRESETS = [
  { label:'-1 an', v:-365 }, { label:'-1 mois', v:-30 }, { label:'-1 j', v:-1 },
  { label:'Pause', v:0 },
  { label:'+1 j', v:1 }, { label:'+1 sem', v:7 }, { label:'+1 mois', v:30 }, { label:'+1 an', v:365 },
];
PRESETS.forEach(p => {
  const b = document.createElement('button');
  b.className = 'preset-btn'; b.textContent = p.label; b.dataset.v = p.v;
  b.addEventListener('click', () => setSpeed(p.v));
  speedPresetsEl.appendChild(b);
});

speedSlider.addEventListener('input', () => setSpeed(Number(speedSlider.value)));
btnPause.addEventListener('click', () => setSpeed(speed === 0 ? (lastSpeed || 1) : 0));

let manualScrub = false;
scrubSlider.addEventListener('input', () => {
  manualScrub = true;
  const off = Number(scrubSlider.value);
  simJD = dateToJD(new Date()) + off;
  scrubValue.textContent = (off >= 0 ? '+' : '') + off + ' j';
});
scrubSlider.addEventListener('change', () => { manualScrub = false; });

btnNow.addEventListener('click', () => {
  simJD = dateToJD(new Date());
  scrubSlider.value = '0';
  scrubValue.textContent = '±0 j';
  manualScrub = false;
});

function updateTimeReadouts(){
  dateBig.textContent = DATE_FMT.format(jdToDate(simJD));
  document.getElementById('epochReadout').textContent = 'JD ' + simJD.toFixed(2);
  if (!manualScrub){
    const off = Math.round(simJD - dateToJD(new Date()));
    const clamped = Math.max(-3650, Math.min(3650, off));
    scrubSlider.value = String(clamped);
    scrubValue.textContent = (off >= 0 ? '+' : '') + off + ' j';
  }
  dateOffset.textContent = speed === 0 ? 'figé' : (speed > 0 ? 'défilement avant' : 'défilement arrière');
}

// ===========================================================
// Camera input: pointer-based pan & pinch-zoom (touch + mouse)
// ===========================================================
const pointers = new Map();
let pinchStartDist = null, pinchStartZoom = null, pinchStartMid = null;
let dragStart = null;

function distBetween(p1, p2){ return Math.hypot(p1.x-p2.x, p1.y-p2.y); }
function midOf(p1, p2){ return { x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2 }; }

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });
  if (pointers.size === 1){
    dragStart = { x:e.clientX, y:e.clientY, camX:renderer.cam.x, camY:renderer.cam.y, moved:false };
  } else if (pointers.size === 2){
    const [p1, p2] = [...pointers.values()];
    pinchStartDist = distBetween(p1, p2);
    pinchStartZoom = renderer.cam.zoom;
    pinchStartMid = midOf(p1, p2);
  }
});

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });

  if (pointers.size === 2){
    const [p1, p2] = [...pointers.values()];
    const d = distBetween(p1, p2);
    if (pinchStartDist){
      const factor = d / pinchStartDist;
      renderer.cam.zoom = clampZoom(pinchStartZoom * factor);
    }
  } else if (pointers.size === 1 && dragStart){
    const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
    if (Math.hypot(dx,dy) > 4) dragStart.moved = true;
    const rect = canvas.getBoundingClientRect();
    renderer.cam.x = dragStart.camX - (dx * renderer.dpr) / (renderer.cam.zoom * renderer.dpr) ;
    renderer.cam.y = dragStart.camY + (dy * renderer.dpr) / (renderer.cam.zoom * renderer.dpr);
    if (dragStart.moved && locked){ locked = false; updateLockPill(); }
  }
});

function endPointer(e){
  pointers.delete(e.pointerId);
  if (pointers.size < 2){ pinchStartDist = null; }
  if (pointers.size === 0){ dragStart = null; }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', endPointer);

function clampZoom(z){ return Math.max(0.4, Math.min(1.2e8, z)); }

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const factor = Math.exp(-e.deltaY * 0.0015);
  renderer.cam.zoom = clampZoom(renderer.cam.zoom * factor);
}, { passive:false });

document.getElementById('btnZoomIn').addEventListener('click', () => {
  renderer.cam.zoom = clampZoom(renderer.cam.zoom * 1.6);
});
document.getElementById('btnZoomOut').addEventListener('click', () => {
  renderer.cam.zoom = clampZoom(renderer.cam.zoom / 1.6);
});

window.addEventListener('resize', () => renderer.resize());

// ===========================================================
// Sheets (asteroid panel + info panel)
// ===========================================================
function wireSheet(sheetId, backdropId, openBtnId, closeBtnId){
  const sheet = document.getElementById(sheetId);
  const backdrop = document.getElementById(backdropId);
  const open = () => { sheet.classList.remove('hidden'); backdrop.classList.remove('hidden'); };
  const close = () => { sheet.classList.add('hidden'); backdrop.classList.add('hidden'); };
  if (openBtnId) document.getElementById(openBtnId).addEventListener('click', open);
  document.getElementById(closeBtnId).addEventListener('click', close);
  backdrop.addEventListener('click', close);
  return { open, close };
}
wireSheet('infoSheet','infoBackdrop','btnInfo','btnCloseInfo');
const asteroidSheetCtl = wireSheet('asteroidSheet','sheetBackdrop','btnAsteroids','btnCloseSheet');

document.getElementById('fAst_varToggle').addEventListener('change', e => {
  document.getElementById('variationParams').style.opacity = e.target.checked ? '1' : '0.4';
});
document.getElementById('variationParams').style.opacity = '0.4';

function toast(msg, ms=2400){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add('hidden'), ms);
}

document.getElementById('btnAddAsteroid').addEventListener('click', () => {
  const params = {
    distAU: Number(document.getElementById('fAst_dist').value),
    speedKms: Number(document.getElementById('fAst_speed').value),
    angleDeg: Number(document.getElementById('fAst_angle').value),
    inclDeg: Number(document.getElementById('fAst_incl').value),
    lonDeg: Number(document.getElementById('fAst_lon').value),
  };
  const massKg = Number(document.getElementById('fAst_mass').value) || 0;
  const name = document.getElementById('fAst_name').value.trim() || `Objet ${++astCounter}`;
  const spanYears = Number(document.getElementById('fAst_span').value) || 3;
  const withVariation = document.getElementById('fAst_varToggle').checked;
  const marginPct = Number(document.getElementById('fAst_margin').value) || 5;
  const samples = Math.max(4, Math.min(60, Number(document.getElementById('fAst_samples').value) || 24));

  const statusEl = document.getElementById('computeStatus');
  statusEl.textContent = 'Calcul de la trajectoire…';

  setTimeout(() => {
    const t0 = performance.now();
    const state0 = buildInitialState(params);
    const spanDays = spanYears * 365.25;
    const trajectory = integrateTrajectory(state0, simJD, spanDays, { dt:0.25, sampleEvery:4 });

    let family = null;
    if (withVariation){
      statusEl.textContent = 'Calcul de la famille de trajectoires…';
      family = computeVariationFamily(params, simJD, spanDays, marginPct, samples, 0.5);
    }

    const id = 'a' + (++astCounter) + '_' + Math.random().toString(36).slice(2,7);
    const color = ASTEROID_COLORS[asteroids.length % ASTEROID_COLORS.length];
    asteroids.push({ id, name, color, params, massKg, trajectory, family, spanYears });
    renderAsteroidList();
    const ms = (performance.now() - t0).toFixed(0);
    statusEl.textContent = `Trajectoire calculée (${trajectory.length} points, ${ms} ms).`;
    toast(`${name} ajouté`);
  }, 20);
});

document.getElementById('btnClearAsteroids').addEventListener('click', () => {
  asteroids = [];
  if (selectedKey && selectedKey.startsWith('ast:')) clearFocus();
  renderAsteroidList();
  document.getElementById('computeStatus').textContent = '';
});

function renderAsteroidList(){
  const list = document.getElementById('asteroidList');
  list.innerHTML = '';
  asteroids.forEach(a => {
    const el = document.createElement('div');
    el.className = 'asteroid-item';
    el.innerHTML = `
      <div>
        <div class="a-name" style="color:${a.color}">${a.name}</div>
        <div class="a-meta">${a.params.distAU.toFixed(2)} UA · ${a.params.speedKms.toFixed(1)} km/s · i=${a.params.inclDeg}°${a.family ? ' · famille ✓' : ''}</div>
      </div>
      <div style="display:flex; gap:6px;">
        <button data-act="focus">Voir</button>
        <button data-act="del">✕</button>
      </div>`;
    el.querySelector('[data-act="focus"]').addEventListener('click', () => {
      focusOn('ast:' + a.id);
      asteroidSheetCtl.close();
    });
    el.querySelector('[data-act="del"]').addEventListener('click', () => {
      asteroids = asteroids.filter(x => x.id !== a.id);
      if (selectedKey === 'ast:' + a.id) clearFocus();
      renderAsteroidList();
    });
    list.appendChild(el);
  });
}

// ===========================================================
// Main render loop
// ===========================================================
function frame(now){
  const dtReal = Math.min((now - lastFrame) / 1000, 0.25);
  lastFrame = now;
  if (speed !== 0) simJD += speed * dtReal;

  updateTimeReadouts();
  refreshOrbitCache(simJD);
  const bodies = computeBodiesNow(simJD);

  if (locked && selectedKey){
    let pos;
    if (selectedKey.startsWith('ast:')){
      const a = asteroids.find(x => x.id === selectedKey.slice(4));
      pos = a ? samplePosition(a.trajectory, simJD) : null;
    } else pos = bodies[selectedKey];
    if (pos){ renderer.cam.x = pos.x; renderer.cam.y = pos.y; }
  }

  renderer.clear();

  // Sun-lock proximity fade for orbit lines far zoomed in
  for (const p of PLANETS){
    renderer.drawOrbitPath(orbitCache.paths[p.key], p.color, 0.28);
  }

  // asteroid variation families (drawn under main trajectories)
  for (const a of asteroids){
    if (a.family){
      for (const traj of a.family){
        renderer.drawTrajectory(traj, a.color, 0.10, 1);
      }
    }
  }
  // asteroid main trajectories
  for (const a of asteroids){
    renderer.drawTrajectory(a.trajectory, a.color, 0.85, 1.5);
    const pos = samplePosition(a.trajectory, simJD);
    if (pos){
      const { sx, sy } = renderer.worldToScreen(pos.x, pos.y);
      renderer.drawMarker(sx, sy, a.color);
      renderer.drawLabel(a.name, sx, sy, 5, a.color);
    }
  }

  // Sun
  const sunSpin = rotationAngleDeg(SUN.spinHours, simJD);
  renderer.drawBody(SUN, bodies.sun, simJD, sunSpin, 10);

  // Planets
  for (const p of PLANETS){
    const spin = rotationAngleDeg(p.spinHours, simJD);
    const { sx, sy, px } = renderer.drawBody(p, bodies[p.key], simJD, spin, 5);
    if (renderer.cam.zoom < 3000 || selectedKey === p.key){
      renderer.drawLabel(p.name, sx, sy, px);
    }
  }

  // Moon
  const moonSpin = rotationAngleDeg(MOON.spinHours, simJD);
  const { sx:msx, sy:msy, px:mpx } = renderer.drawBody(MOON, bodies.moon, simJD, moonSpin, 3);
  if (renderer.cam.zoom > 400) renderer.drawLabel(MOON.name, msx, msy, mpx);

  requestAnimationFrame(frame);
}

// initial camera
renderer.cam.x = 0; renderer.cam.y = 0; renderer.cam.zoom = 80;
setSpeed(2);
requestAnimationFrame(frame);

// ===========================================================
// PWA service worker registration
// ===========================================================
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
