import { PLANETS, SUN, MOON, GM_SUN, AU_KM, DAY_S, dateToJD, jdToDate } from './orbitalData.js';
import { planetPosition, planetOrbitPath, moonPositionGeocentric, rotationAngleDeg } from './kepler.js';
import { buildInitialState, integrateTrajectory, samplePosition, computeVariationFamily } from './physics.js';
import { Renderer } from './render.js';

// ===========================================================
// State
// ===========================================================
const canvas = document.getElementById('sky');
const renderer = new Renderer(canvas);

let simJD = dateToJD(new Date());
let speed = 0;          // simulated days per real second (continuous playback)
let lastSpeed = 2;      // remembered for pause/resume
let lastFrame = performance.now();
let selectedKey = null; // 'sun' | planet key | 'moon' | 'ast:<id>'
let locked = false;

const orbitCache = { jd: null, paths: {} };
let asteroids = []; // {id, name, color, params, trajectory, family, massKg}
let astCounter = 0;
let hitTargets = []; // rebuilt every frame: {key, sx, sy, r}

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
// Safe-area layout: keep world content clear of fixed UI chrome
// (top HUD, lock pill, bottom time panel) so labels/bodies are never
// hidden or unreachable behind a panel.
// ===========================================================
const headerEl = document.querySelector('.hud-top');
const footerEl = document.querySelector('.time-panel');
const lockPillEl = document.getElementById('lockPill');

function updateSafeArea(){
  const hRect = headerEl.getBoundingClientRect();
  const fRect = footerEl.getBoundingClientRect();
  let top = hRect.bottom;
  if (!lockPillEl.classList.contains('hidden')){
    top = Math.max(top, lockPillEl.getBoundingClientRect().bottom);
  }
  const bottom = window.innerHeight - fRect.top;
  renderer.setSafeArea({ top: top + 10, bottom: bottom + 10, left: 8, right: 8 });
}
new ResizeObserver(updateSafeArea).observe(headerEl);
new ResizeObserver(updateSafeArea).observe(footerEl);
window.addEventListener('resize', updateSafeArea);

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

// Select a body without moving the camera — used for direct taps on the
// map, so tapping a planet doesn't yank the view around.
function selectOnly(key){
  selectedKey = key;
  locked = false;
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
  if (!selectedKey){ lockPill.classList.add('hidden'); requestAnimationFrame(updateSafeArea); return; }
  lockPill.classList.remove('hidden');
  const meta = selectedKey.startsWith('ast:')
    ? asteroids.find(a => a.id === selectedKey.slice(4))
    : ALL_BODY_META.find(b => b.key === selectedKey);
  lockLabel.textContent = meta ? meta.name : '—';
  btnLockToggle.setAttribute('aria-pressed', String(locked));
  btnLockToggle.textContent = locked ? 'Suivi ✓' : 'Suivre';
  requestAnimationFrame(updateSafeArea);
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
const jumpRowEl = document.getElementById('jumpRow');

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', {
  year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit'
});

function fmtSpeed(v){
  if (v === 0) return 'Pause';
  const abs = Math.abs(v);
  let txt;
  if (abs >= 30) txt = (abs/30).toFixed(1) + ' mois/s';
  else txt = abs.toFixed(abs < 2 ? 2 : 0) + ' j/s';
  return (v < 0 ? '−' : '+') + txt;
}

function setSpeed(v){
  speed = v;
  if (v !== 0) lastSpeed = v;
  speedSlider.value = String(v);
  speedValue.textContent = fmtSpeed(v);
  btnPause.textContent = v === 0 ? '▶ Lecture' : '⏸ Pause';
}

speedSlider.addEventListener('input', () => setSpeed(Number(speedSlider.value)));
btnPause.addEventListener('click', () => setSpeed(speed === 0 ? (lastSpeed || 1) : 0));

// Time-jump buttons: move the clock by a fixed increment once, without
// touching the continuous playback speed at all.
const JUMPS = [
  { label:'-1 an', days:-365 }, { label:'-1 mois', days:-30 }, { label:'-1 sem', days:-7 }, { label:'-1 j', days:-1 },
  { label:'+1 j', days:1 }, { label:'+1 sem', days:7 }, { label:'+1 mois', days:30 }, { label:'+1 an', days:365 },
];
JUMPS.forEach(j => {
  const b = document.createElement('button');
  b.className = 'preset-btn'; b.textContent = j.label;
  b.addEventListener('click', () => { simJD += j.days; manualScrub = false; });
  jumpRowEl.appendChild(b);
});

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
// Camera input: pan + pinch-zoom, rewritten to use purely incremental
// deltas (never a remembered "gesture start" baseline) so switching
// between one- and two-finger gestures never causes a jump.
// ===========================================================
function clampZoom(z){ return Math.max(0.4, Math.min(1.2e8, z)); }

const pointers = new Map();     // id -> {x,y} latest CSS-px client coords
let panRef = null;              // {x,y} last position of the single active pointer
let pinchRef = null;            // {dist, mid:{x,y}} last pinch state
let gestureMoved = 0;           // total movement of the current gesture, for tap detection
let gestureStartTarget = null;  // pointerId that started a potential tap

function resetGestureRefs(){
  const vals = [...pointers.values()];
  if (vals.length === 1){ panRef = { x: vals[0].x, y: vals[0].y }; pinchRef = null; }
  else if (vals.length >= 2){
    const [p1, p2] = vals;
    pinchRef = { dist: Math.hypot(p1.x-p2.x, p1.y-p2.y), mid: { x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2 } };
    panRef = null;
  } else { panRef = null; pinchRef = null; }
}

canvas.addEventListener('pointerdown', e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });

  if (placing === 'point'){
    handlePlacePoint(e);
    return;
  }
  if (placing === 'vector' && e.pointerId !== placePointerId) return; // ignore extra fingers

  if (pointers.size === 1){ gestureMoved = 0; gestureStartTarget = e.pointerId; }
  resetGestureRefs();
});

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });

  if (placing === 'vector' && e.pointerId === placePointerId){
    updatePlaceDrag(e);
    return;
  }
  if (placing) return;

  if (pointers.size >= 2 && pinchRef){
    const vals = [...pointers.values()];
    const [p1, p2] = vals;
    const dist = Math.hypot(p1.x-p2.x, p1.y-p2.y);
    const mid = { x:(p1.x+p2.x)/2, y:(p1.y+p2.y)/2 };
    const factor = dist / pinchRef.dist;

    const rect = canvas.getBoundingClientRect();
    const beforeWorld = renderer.screenToWorld(pinchRef.mid.x - rect.left, pinchRef.mid.y - rect.top);
    renderer.cam.zoom = clampZoom(renderer.cam.zoom * factor);
    const afterWorld = renderer.screenToWorld(pinchRef.mid.x - rect.left, pinchRef.mid.y - rect.top);
    renderer.cam.x += beforeWorld.x - afterWorld.x;
    renderer.cam.y += beforeWorld.y - afterWorld.y;

    const dx = mid.x - pinchRef.mid.x, dy = mid.y - pinchRef.mid.y;
    renderer.cam.x -= dx / renderer.cam.zoom;
    renderer.cam.y += dy / renderer.cam.zoom;

    pinchRef = { dist, mid };
  } else if (pointers.size === 1 && panRef){
    const dx = e.clientX - panRef.x, dy = e.clientY - panRef.y;
    gestureMoved += Math.hypot(dx, dy);
    renderer.cam.x -= dx / renderer.cam.zoom;
    renderer.cam.y += dy / renderer.cam.zoom;
    if (gestureMoved > 4 && locked){ locked = false; updateLockPill(); }
    panRef = { x: e.clientX, y: e.clientY };
  }
});

function endPointer(e){
  const wasSingleTap = pointers.size === 1 && gestureMoved < 6 && gestureStartTarget === e.pointerId
    && placing === null;
  pointers.delete(e.pointerId);
  resetGestureRefs();
  if (wasSingleTap) handleCanvasTap(e);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', e => { pointers.delete(e.pointerId); resetGestureRefs(); });
canvas.addEventListener('pointerleave', e => { if (pointers.size && pointers.has(e.pointerId)){ pointers.delete(e.pointerId); resetGestureRefs(); } });

function handleCanvasTap(e){
  const rect = canvas.getBoundingClientRect();
  const tx = e.clientX - rect.left, ty = e.clientY - rect.top;
  let best = null, bestD = Infinity;
  for (const t of hitTargets){
    const d = Math.hypot(t.sx - tx, t.sy - ty);
    const r = Math.max(t.r, 16);
    if (d <= r && d < bestD){ best = t; bestD = d; }
  }
  if (best) selectOnly(best.key);
}

canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left, my = e.clientY - rect.top;
  const before = renderer.screenToWorld(mx, my);
  const factor = Math.exp(-e.deltaY * 0.0015);
  renderer.cam.zoom = clampZoom(renderer.cam.zoom * factor);
  const after = renderer.screenToWorld(mx, my);
  renderer.cam.x += before.x - after.x;
  renderer.cam.y += before.y - after.y;
}, { passive:false });

document.getElementById('btnZoomIn').addEventListener('click', () => {
  renderer.cam.zoom = clampZoom(renderer.cam.zoom * 1.6);
});
document.getElementById('btnZoomOut').addEventListener('click', () => {
  renderer.cam.zoom = clampZoom(renderer.cam.zoom / 1.6);
});

window.addEventListener('resize', () => { renderer.resize(); updateSafeArea(); });

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

function toast(msg, ms=2600){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add('hidden'), ms);
}

// ===========================================================
// Asteroid: numeric form -> compute
// ===========================================================
function readAsteroidForm(){
  return {
    distAU: Number(document.getElementById('fAst_dist').value),
    speedKms: Number(document.getElementById('fAst_speed').value),
    angleDeg: Number(document.getElementById('fAst_angle').value),
    inclDeg: Number(document.getElementById('fAst_incl').value),
    lonDeg: Number(document.getElementById('fAst_lon').value),
  };
}

document.getElementById('btnAddAsteroid').addEventListener('click', () => {
  const params = readAsteroidForm();
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
// Asteroid: place-on-map mode
//   1. tap "Placer sur la carte" -> tap the map to set position
//   2. drag from that point to set direction + speed (arrow)
//   3. release -> numeric fields are filled in, ready to compute
// A plain tap with no drag falls back to a circular-orbit velocity
// at that distance, so placement always yields a sensible orbit.
// ===========================================================
const placeBanner = document.getElementById('placeBanner');
const placeBannerText = document.getElementById('placeBannerText');
let placing = null;        // null | 'point' | 'vector'
let placePointerId = null;
let placePointWorld = null;
let placeDragWorld = null;
let placeSpeedBeforeHold = 0;
const REF_DAYS = 15; // drag length is interpreted as displacement over this many days

function circularSpeedKms(distAU){
  const vAUday = Math.sqrt(GM_SUN / distAU);
  return vAUday * AU_KM / DAY_S;
}

document.getElementById('btnPlaceOnMap').addEventListener('click', () => {
  asteroidSheetCtl.close();
  placeSpeedBeforeHold = speed; setSpeed(0);
  placing = 'point';
  placeBannerText.textContent = "Touchez la carte pour placer l'astéroïde";
  placeBanner.classList.remove('hidden');
});

function endPlacement(reopenSheet){
  placing = null; placePointerId = null; placePointWorld = null; placeDragWorld = null;
  placeBanner.classList.add('hidden');
  setSpeed(placeSpeedBeforeHold);
  if (reopenSheet) asteroidSheetCtl.open();
}
document.getElementById('btnPlaceCancel').addEventListener('click', () => endPlacement(true));

function handlePlacePoint(e){
  const rect = canvas.getBoundingClientRect();
  placePointWorld = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  placeDragWorld = { ...placePointWorld };
  placePointerId = e.pointerId;
  placing = 'vector';
  placeBannerText.textContent = 'Glissez pour la direction et la vitesse, relâchez pour valider';
}

function updatePlaceDrag(e){
  const rect = canvas.getBoundingClientRect();
  placeDragWorld = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  const dx = placeDragWorld.x - placePointWorld.x, dy = placeDragWorld.y - placePointWorld.y;
  const lenAU = Math.hypot(dx, dy);
  if (lenAU > 1e-6){
    const speedKms = Math.min(80, lenAU * (AU_KM/DAY_S) / REF_DAYS);
    placeBannerText.textContent = `${speedKms.toFixed(1)} km/s — relâchez pour valider`;
  }
}

canvas.addEventListener('pointerup', e => {
  if (placing === 'vector' && e.pointerId === placePointerId) finalizePlacement();
});
canvas.addEventListener('pointercancel', e => {
  if (placing === 'vector' && e.pointerId === placePointerId) endPlacement(true);
});

function finalizePlacement(){
  const p = placePointWorld;
  const distAU = Math.hypot(p.x, p.y);
  const nodeRad = Math.atan2(p.y, p.x);
  let lonDeg = nodeRad * 180/Math.PI; if (lonDeg < 0) lonDeg += 360;

  const dx = placeDragWorld.x - p.x, dy = placeDragWorld.y - p.y;
  const lenAU = Math.hypot(dx, dy);

  let speedKms, angleDeg;
  if (lenAU < 0.02){
    speedKms = circularSpeedKms(distAU);
    angleDeg = 0; // pure tangential -> circular orbit
  } else {
    const radial = { x: Math.cos(nodeRad), y: Math.sin(nodeRad) };
    const tangential = { x: -Math.sin(nodeRad), y: Math.cos(nodeRad) };
    const vr = dx*radial.x + dy*radial.y;
    const vt = dx*tangential.x + dy*tangential.y;
    angleDeg = Math.atan2(vr, vt) * 180/Math.PI;
    speedKms = Math.min(80, Math.max(0.1, lenAU * (AU_KM/DAY_S) / REF_DAYS));
  }

  document.getElementById('fAst_dist').value = distAU.toFixed(3);
  document.getElementById('fAst_speed').value = speedKms.toFixed(2);
  document.getElementById('fAst_angle').value = angleDeg.toFixed(1);
  document.getElementById('fAst_lon').value = lonDeg.toFixed(1);
  document.getElementById('fAst_incl').value = '0';

  endPlacement(true);
  toast('Position et vitesse définies depuis la carte — vérifiez puis calculez');
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

  renderer.beginFrame();
  hitTargets = [];

  for (const p of PLANETS){
    renderer.drawOrbitPath(orbitCache.paths[p.key], p.color, 0.28);
  }

  for (const a of asteroids){
    if (a.family){
      for (const traj of a.family) renderer.drawTrajectory(traj, a.color, 0.10, 1);
    }
  }
  for (const a of asteroids){
    renderer.drawTrajectory(a.trajectory, a.color, 0.85, 1.5);
    const pos = samplePosition(a.trajectory, simJD);
    if (pos){
      const { sx, sy } = renderer.worldToScreen(pos.x, pos.y);
      renderer.drawMarker(sx, sy, a.color);
      renderer.drawLabel(a.name, sx, sy, 6, a.color, selectedKey === 'ast:'+a.id);
      if (selectedKey === 'ast:'+a.id) renderer.drawSelectionRing(sx, sy, 6, a.color);
      hitTargets.push({ key:'ast:'+a.id, sx, sy, r:14 });
    }
  }

  const sunSpin = rotationAngleDeg(SUN.spinHours, simJD);
  const sunDrawn = renderer.drawBody(SUN, bodies.sun, simJD, sunSpin, 10);
  hitTargets.push({ key:'sun', sx:sunDrawn.sx, sy:sunDrawn.sy, r:Math.max(sunDrawn.px, 16) });
  if (selectedKey === 'sun') renderer.drawSelectionRing(sunDrawn.sx, sunDrawn.sy, sunDrawn.px, SUN.color);

  for (const p of PLANETS){
    const spin = rotationAngleDeg(p.spinHours, simJD);
    const { sx, sy, px } = renderer.drawBody(p, bodies[p.key], simJD, spin, 5);
    hitTargets.push({ key:p.key, sx, sy, r:Math.max(px, 16) });
    if (selectedKey === p.key) renderer.drawSelectionRing(sx, sy, px, p.color);
    if (renderer.cam.zoom < 3000 || selectedKey === p.key){
      renderer.drawLabel(p.name, sx, sy, px, p.color, selectedKey === p.key);
    }
  }

  const moonSpin = rotationAngleDeg(MOON.spinHours, simJD);
  const { sx:msx, sy:msy, px:mpx } = renderer.drawBody(MOON, bodies.moon, simJD, moonSpin, 3);
  hitTargets.push({ key:'moon', sx:msx, sy:msy, r:Math.max(mpx, 16) });
  if (selectedKey === 'moon') renderer.drawSelectionRing(msx, msy, mpx, MOON.color);
  if (renderer.cam.zoom > 400 || selectedKey === 'moon') renderer.drawLabel(MOON.name, msx, msy, mpx, MOON.color, selectedKey === 'moon');

  // placement-mode overlay
  if (placing === 'vector' && placePointWorld){
    const a = renderer.worldToScreen(placePointWorld.x, placePointWorld.y);
    const b = renderer.worldToScreen(placeDragWorld.x, placeDragWorld.y);
    renderer.drawCrosshair(a.sx, a.sy);
    if (Math.hypot(b.sx-a.sx, b.sy-a.sy) > 3) renderer.drawArrow(a.sx, a.sy, b.sx, b.sy);
  }

  requestAnimationFrame(frame);
}

// initial camera
renderer.cam.x = 0; renderer.cam.y = 0; renderer.cam.zoom = 80;
setSpeed(2);
updateSafeArea();
requestAnimationFrame(frame);

// ===========================================================
// PWA service worker registration
// ===========================================================
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  });
}
