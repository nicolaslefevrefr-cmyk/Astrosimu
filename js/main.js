import { PLANETS, SUN, MOON, GM_SUN, AU_KM, DAY_S, MASS_KG, CITIES, KNOWN_ASTEROIDS, dateToJD, jdToDate } from './orbitalData.js';
import { planetPosition, planetOrbitPath, moonPositionGeocentric, rotationAngleDeg, earthGMSTDeg, knownAsteroidStateAtEpoch } from './kepler.js';
import { buildInitialState, buildLaunchState, integrateTrajectory, samplePosition, computeVariationFamily, computeLaunchVariationFamily, acceleration } from './physics.js';
import { Renderer } from './render.js';

const G_CONST = 6.674e-11; // m^3 kg^-1 s^-2
const ACCEL_AUDAY2_TO_MS2 = (AU_KM*1000) / (DAY_S*DAY_S);
// A rocket "launch" is modeled with the patched-conic simplification: the
// object starts its heliocentric journey already just outside Earth's
// sphere of gravitational influence (Hill radius ≈ 0.01 AU ≈ 1.5M km),
// with velocity = Earth's own + the chosen delta-v. Offsetting only by
// Earth's physical radius instead very nearly zeroes out the object's
// angular momentum *around Earth*, producing a near-radial plunge back
// through Earth's intense local gravity that no practical time step can
// resolve — verified experimentally: it corrupts the heliocentric energy
// within days. The Hill-sphere offset avoids that regime entirely.
const LAUNCH_OFFSET_AU = 0.01;

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
let asteroids = []; // {id, name, color, params, trajectory, family, massKg, approaches}
let astCounter = 0;
let rockets = []; // {id, name, color, burn, trajectory, family, massKg, approaches}
let rocketCounter = 0;
let hitTargets = []; // rebuilt every frame: {key, sx, sy, r}

const ASTEROID_COLORS = ['#ff6b6b','#ffd166','#8ecae6','#c77dff','#7cf29c','#f4a261'];
const ROCKET_COLORS = ['#6fe3d6','#a0e86f','#e8a0f0','#f0d06f'];

const FOCUS_ZOOM = {
  sun: 80, mercury: 900, venus: 500, earth: 380, moon: 60000,
  mars: 260, jupiter: 70, saturn: 45, uranus: 20, neptune: 13,
  apophis: 2500, bennu: 3000, eros: 800, ceres: 100, vesta: 120,
};

const ALL_BODY_META = [
  { key:'sun', name:'Soleil', color: SUN.color },
  ...PLANETS.map(p => ({ key:p.key, name:p.name, color:p.color })),
  { key:'moon', name:'Lune', color: MOON.color },
  ...KNOWN_ASTEROIDS.map(a => ({ key:a.key, name:a.name, color:a.color })),
];

// ===========================================================
// Known asteroids: real, gravitationally-perturbed trajectories
// ===========================================================
// A pure two-body (Keplerian) model can only ever draw an asteroid's orbit
// as one fixed, unchanging ellipse. Real close planetary encounters bend
// the path and change the orbit afterwards — most famously Apophis, which
// passes roughly 32,000 km above Earth on 2029-04-13 (closer than
// geostationary satellites) and has its own orbital period shift from
// ~0.89 to ~1.16 years as a direct result. No two-body model can reproduce
// that, however good its starting elements are. So each known asteroid's
// position is instead taken from a real trajectory: a state vector built
// from its stored osculating elements at their epoch, numerically
// integrated with the same N-body Runge-Kutta engine used for user
// asteroids and rockets (Sun + 8 planets, adaptive step size that
// automatically tightens during a close encounter). The result is cached
// once per asteroid and sampled like any other trajectory.
// Window is anchored on *today*, not on each asteroid's own data epoch —
// epochs differ per asteroid (2010–2025) and don't necessarily bracket
// "now" the way a user actually browses the scene. ±20 years around today
// comfortably covers the 2029 Apophis encounter either way.
const KNOWN_ASTEROID_WINDOW_YEARS = 20;
const knownAsteroidWindow = (() => {
  const nowJD = dateToJD(new Date());
  return { start: nowJD - KNOWN_ASTEROID_WINDOW_YEARS*365.25, end: nowJD + KNOWN_ASTEROID_WINDOW_YEARS*365.25 };
})();
const knownAsteroidTrajectoryCache = {};

function getKnownAsteroidTrajectory(ast){
  let traj = knownAsteroidTrajectoryCache[ast.key];
  if (traj) return traj;
  const state0 = knownAsteroidStateAtEpoch(ast);
  const backDays = Math.max(0, ast.epoch - knownAsteroidWindow.start);
  const spanDays = Math.max(0, knownAsteroidWindow.end - ast.epoch);
  traj = integrateTrajectory(state0, ast.epoch, spanDays, {
    backDays, dtMax: 2.0, dtMin: 0.0005, eta: 0.03,
    sampleIntervalDays: 1.5, minSampleIntervalDays: 0.01, maxSteps: 150000,
  });
  knownAsteroidTrajectoryCache[ast.key] = traj;
  return traj;
}

// Decimate a long cached trajectory down to a manageable number of points
// for drawing the on-screen orbit line (position lookups still use the
// full-resolution trajectory via samplePosition).
function decimatePath(points, maxPoints = 400){
  if (points.length <= maxPoints) return points;
  const step = points.length / maxPoints;
  const out = [];
  for (let i = 0; i < points.length; i += step) out.push(points[Math.floor(i)]);
  out.push(points[points.length - 1]);
  return out;
}

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
  for (const a of KNOWN_ASTEROIDS) bodies[a.key] = samplePosition(getKnownAsteroidTrajectory(a), jd);
  return bodies;
}

function refreshOrbitCache(jd){
  if (orbitCache.jd !== null && Math.abs(jd - orbitCache.jd) < 25) return;
  orbitCache.jd = jd;
  for (const p of PLANETS) orbitCache.paths[p.key] = planetOrbitPath(p, jd, 160);
  for (const a of KNOWN_ASTEROIDS) orbitCache.paths[a.key] = decimatePath(getKnownAsteroidTrajectory(a));
}

// Finite-difference heliocentric velocity (AU/day) for any tracked body,
// used for the info panel and as the "carrier" velocity a rocket launch
// adds its delta-v to.
function bodyVelocity(key, jd){
  const h = 0.02; // days
  const b1 = computeBodiesNow(jd - h)[key];
  const b2 = computeBodiesNow(jd + h)[key];
  return { x:(b2.x-b1.x)/(2*h), y:(b2.y-b1.y)/(2*h), z:(b2.z-b1.z)/(2*h) };
}

// ===========================================================
// Safe-area layout: keep world content clear of fixed UI chrome
// (top HUD, lock pill, bottom time panel) so labels/bodies are never
// hidden or unreachable behind a panel.
// ===========================================================
const headerEl = document.querySelector('.hud-top');
const footerEl = document.querySelector('.bottom-panel');
const lockPillEl = document.getElementById('lockPill');
const dockElForSafeArea = document.getElementById('bodyDock');
const zoomDockEl = document.querySelector('.zoom-dock');

function updateSafeArea(){
  const hRect = headerEl.getBoundingClientRect();
  const fRect = footerEl.getBoundingClientRect();
  let top = hRect.bottom;
  if (!lockPillEl.classList.contains('hidden')){
    top = Math.max(top, lockPillEl.getBoundingClientRect().bottom);
  }
  const bottom = window.innerHeight - fRect.top;
  renderer.setSafeArea({ top: top + 10, bottom: bottom + 10, left: 8, right: 8 });
  dockElForSafeArea.style.bottom = (bottom + 12) + 'px';
  zoomDockEl.style.bottom = (bottom + 12) + 'px';
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
  } else if (key.startsWith('roc:')){
    const r = rockets.find(x => x.id === key.slice(4));
    pos = r ? samplePosition(r.trajectory, simJD) : { x:0, y:0 };
    renderer.cam.zoom = 3000;
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
    : selectedKey.startsWith('roc:')
      ? rockets.find(r => r.id === selectedKey.slice(4))
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

// True logarithmic mapping for the time-flow slider: equal slider
// increments correspond to equal *ratio* changes in speed, so there's as
// much control between 1 s/s and 1 h/s as there is between 1 day/s and
// 300 days/s. The slowest non-zero speed is real time (1 simulated
// second per real second); 0 is an exact, separate "pause".
const MIN_FLOW_SPEED = 1 / 86400; // days/sec == real time
const MAX_FLOW_SPEED = 300;       // days/sec ceiling
const FLOW_LOG_RANGE = Math.log(MAX_FLOW_SPEED / MIN_FLOW_SPEED);

function rawToSpeed(raw){
  if (raw === 0) return 0;
  const frac = Math.min(1, Math.abs(raw) / 100);
  const s = MIN_FLOW_SPEED * Math.exp(FLOW_LOG_RANGE * frac);
  return Math.sign(raw) * s;
}
function speedToRaw(v){
  if (v === 0) return 0;
  const frac = Math.log(Math.abs(v) / MIN_FLOW_SPEED) / FLOW_LOG_RANGE;
  return Math.sign(v) * 100 * Math.max(0, Math.min(1, frac));
}

function fmtSpeed(v){
  if (v === 0) return 'Pause';
  const abs = Math.abs(v);
  const secPerSec = abs * 86400;
  let txt;
  if (secPerSec <= 1.5) txt = 'Temps réel';
  else if (abs < 1/24) txt = secPerSec.toFixed(0) + ' s/s';
  else if (abs < 1) txt = (abs*24).toFixed(2) + ' h/s';
  else if (abs < 30) txt = abs.toFixed(abs < 2 ? 2 : 0) + ' j/s';
  else txt = (abs/30).toFixed(1) + ' mois/s';
  return secPerSec <= 1.5 ? txt : (v < 0 ? '−' : '+') + txt;
}

function setSpeed(v){
  speed = v;
  if (v !== 0) lastSpeed = v;
  speedSlider.value = String(speedToRaw(v));
  speedValue.textContent = fmtSpeed(v);
  btnPause.textContent = v === 0 ? '▶ Lecture' : '⏸ Pause';
  const tabIcon = document.getElementById('tabTimeIcon');
  if (tabIcon) tabIcon.textContent = v === 0 ? '⏸' : '▶';
}

speedSlider.addEventListener('input', () => setSpeed(rawToSpeed(Number(speedSlider.value))));
btnPause.addEventListener('click', () => setSpeed(speed === 0 ? (lastSpeed || MIN_FLOW_SPEED) : 0));

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
    placePointerId = e.pointerId; // finalize on pointerup, so a plain tap still works
    return;
  }
  if (placing === 'vector'){
    if (placeAimPointerId === null){
      placeAimPointerId = e.pointerId;
      const rect = canvas.getBoundingClientRect();
      placeDragWorld = renderer.screenToWorld(e.clientX-rect.left, e.clientY-rect.top);
    }
    return; // ignore extra fingers while aiming
  }

  if (pointers.size === 1){ gestureMoved = 0; gestureStartTarget = e.pointerId; }
  resetGestureRefs();
});

canvas.addEventListener('pointermove', e => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x:e.clientX, y:e.clientY });

  if (placing === 'vector' && e.pointerId === placeAimPointerId){
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
  if (placing === 'point' && e.pointerId === placePointerId){
    commitPlacePoint(e);
    pointers.delete(e.pointerId);
    resetGestureRefs();
    return;
  }
  if (placing === 'vector' && e.pointerId === placeAimPointerId){
    pointers.delete(e.pointerId);
    resetGestureRefs();
    finalizePlacement();
    return;
  }
  const wasSingleTap = pointers.size === 1 && gestureMoved < 6 && gestureStartTarget === e.pointerId
    && placing === null;
  pointers.delete(e.pointerId);
  resetGestureRefs();
  if (wasSingleTap) handleCanvasTap(e);
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', e => {
  if ((placing === 'point' && e.pointerId === placePointerId) ||
      (placing === 'vector' && e.pointerId === placeAimPointerId)){
    endPlacement();
  }
  pointers.delete(e.pointerId);
  resetGestureRefs();
});
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
function wireSheet(sheetId, backdropId, openBtnId, closeBtnId, nonModal=false){
  const sheet = document.getElementById(sheetId);
  const backdrop = document.getElementById(backdropId);
  const open = () => { sheet.classList.remove('hidden'); if (!nonModal) backdrop.classList.remove('hidden'); };
  const close = () => { sheet.classList.add('hidden'); backdrop.classList.add('hidden'); };
  if (openBtnId) document.getElementById(openBtnId).addEventListener('click', open);
  document.getElementById(closeBtnId).addEventListener('click', close);
  if (!nonModal) backdrop.addEventListener('click', close);
  return { open, close };
}
wireSheet('infoSheet','infoBackdrop','btnInfo','btnCloseInfo');

// Bottom panel: always expanded (map keeps the top ~2/3 of the screen via
// the safe-area mechanism below). The 4 tabs never open/close a sheet —
// they just switch which pane is visible inside the one permanent panel,
// so the map stays interactive and the trajectory preview never has to
// be interrupted by a panel opening or closing.
const TAB_PANE_IDS = { time:'paneTime', asteroids:'paneAsteroids', rocket:'paneRocket', location:'paneLocation' };
const TAB_BTN_IDS = { time:'btnTabTime', asteroids:'btnAsteroids', rocket:'btnRocket', location:'btnLocation' };
function switchTab(tabKey){
  Object.entries(TAB_PANE_IDS).forEach(([k, paneId]) => {
    document.getElementById(paneId).classList.toggle('hidden', k !== tabKey);
  });
  document.querySelectorAll('.tab-bar .tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(TAB_BTN_IDS[tabKey]).classList.add('active');
  if (tabKey !== 'asteroids' && tabKey !== 'rocket') clearPreview();
  else schedulePreview();
}
Object.entries(TAB_BTN_IDS).forEach(([tabKey, btnId]) => {
  document.getElementById(btnId).addEventListener('click', () => switchTab(tabKey));
});
// Initial pane visibility is set in the HTML (paneTime visible, others
// hidden) and btnTabTime's "active" class likewise — switchTab('time') is
// invoked at the end of the script instead of here, since it also calls
// clearPreview()/schedulePreview(), which touch state declared further down.

// ===========================================================
// "My location" ground-direction ray
// ===========================================================
const locationSelect = document.getElementById('locationSelect');
let selectedCity = null; // { name, lon } | null

const noneOpt = document.createElement('option');
noneOpt.value = ''; noneOpt.textContent = 'Aucune (désactivé)';
locationSelect.appendChild(noneOpt);
CITIES.forEach((c, i) => {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = `${c.name} (${c.lon >= 0 ? c.lon.toFixed(1)+'° E' : (-c.lon).toFixed(1)+'° O'})`;
  locationSelect.appendChild(opt);
});
locationSelect.addEventListener('change', () => {
  const v = locationSelect.value;
  selectedCity = v === '' ? null : CITIES[Number(v)];
  toast(selectedCity ? `Position : ${selectedCity.name}` : 'Repère de position désactivé');
});

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
    const trajectory = integrateTrajectory(state0, simJD, spanDays); // precise defaults

    let family = null;
    if (withVariation){
      statusEl.textContent = 'Calcul de la famille de trajectoires…';
      family = computeVariationFamily(params, simJD, spanDays, marginPct, samples, { dtMax:0.5, dtMin:0.0006, sampleIntervalDays:1.5 });
    }

    const id = 'a' + (++astCounter) + '_' + Math.random().toString(36).slice(2,7);
    const color = ASTEROID_COLORS[asteroids.length % ASTEROID_COLORS.length];
    const approaches = findCloseApproaches(trajectory, 'ast:'+id);
    asteroids.push({ id, name, color, params, massKg, trajectory, family, spanYears, approaches });
    clearPreview();
    renderAsteroidList();
    const ms = (performance.now() - t0).toFixed(0);
    statusEl.textContent = `Trajectoire calculée (${trajectory.length} points, ${ms} ms).`;
    toast(approaches.length ? `${name} ajouté — ${approachSummary(approaches)}` : `${name} ajouté`, 4200);
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
    const warnLine = a.approaches && a.approaches.length
      ? `<div class="a-meta" style="color:${a.approaches[0].minAU < CLOSE_WARN_AU ? 'var(--danger)' : 'var(--amber)'}">${approachSummary(a.approaches)}</div>`
      : '';
    el.innerHTML = `
      <div>
        <div class="a-name" style="color:${a.color}">${a.name}</div>
        <div class="a-meta">${a.params.distAU.toFixed(2)} UA · ${a.params.speedKms.toFixed(1)} km/s · i=${a.params.inclDeg}°${a.family ? ' · famille ✓' : ''}</div>
        ${warnLine}
      </div>
      <div style="display:flex; gap:6px;">
        <button data-act="focus">Voir</button>
        <button data-act="del">✕</button>
      </div>`;
    el.querySelector('[data-act="focus"]').addEventListener('click', () => {
      focusOn('ast:' + a.id);
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
// "Gros-croiseur" generator: given an impact date + approach speed/angle,
// work out (precisely, by integrating backward from the exact impact
// state) what state the asteroid must be in right now to reach Earth
// exactly then. The approximate (distAU, speed, angle, incl, lon) shown
// in the form afterward are for reference/further hand-editing only —
// the object actually added uses the exact computed trajectory, so the
// impact is guaranteed regardless of any small representational gap
// between the two (see readme: the 5-field form always starts an object
// exactly at its ascending node, which the impactor's state generally
// isn't sitting at by the time it reaches "now").
// ===========================================================
let impDateAnchor = simJD;
let impFineMode = false;
const impDateSlider = document.getElementById('fImp_dateSlider');
const impDateValue = document.getElementById('fImp_dateValue');
const impFineToggle = document.getElementById('fImp_fineToggle');

function impApplySliderRange(){
  if (impFineMode){ impDateSlider.min = '1'; impDateSlider.max = '20'; impDateSlider.step = '0.05'; }
  else { impDateSlider.min = '1'; impDateSlider.max = '3650'; impDateSlider.step = '1'; }
}
function impCurrentJD(){ return impDateAnchor + Number(impDateSlider.value); }
function impUpdateLabel(){ impDateValue.textContent = DATE_FMT.format(jdToDate(impCurrentJD())); }

document.getElementById('btnAsteroids').addEventListener('click', () => {
  impDateAnchor = simJD;
  impApplySliderRange();
  impDateSlider.value = impFineMode ? '5' : '200';
  impUpdateLabel();
});
impFineToggle.addEventListener('change', () => {
  impFineMode = impFineToggle.checked;
  impDateAnchor = impCurrentJD();
  impApplySliderRange();
  impDateSlider.value = impFineMode ? '5' : '200';
  impUpdateLabel();
});
impDateSlider.addEventListener('input', impUpdateLabel);
impApplySliderRange();
impDateSlider.value = '200';

// Derive an approximate (distAU, speedKms, angleDeg, inclDeg, lonDeg)
// equivalent for a raw state vector — exact for inclination (from the
// true 3D angular momentum), approximate for the rest (ecliptic-plane
// projection), since the 5-field model can only exactly represent a
// state sitting at its own ascending node.
function stateToApproxParams(state, jd){
  const [x,y,z,vx,vy,vz] = state;
  const distAU = Math.hypot(x, y);
  let lonDeg = Math.atan2(y, x) * 180/Math.PI; if (lonDeg < 0) lonDeg += 360;
  const hx = y*vz - z*vy, hy = z*vx - x*vz, hz = x*vy - y*vx;
  const hmag = Math.hypot(hx, hy, hz);
  const inclDeg = hmag > 1e-12 ? Math.acos(Math.max(-1, Math.min(1, hz/hmag))) * 180/Math.PI : 0;
  const nodeRad = lonDeg * Math.PI/180;
  const radial = { x:Math.cos(nodeRad), y:Math.sin(nodeRad) };
  const tangential = { x:-Math.sin(nodeRad), y:Math.cos(nodeRad) };
  const vr = vx*radial.x + vy*radial.y;
  const vt = vx*tangential.x + vy*tangential.y;
  const angleDeg = Math.atan2(vr, vt) * 180/Math.PI;
  const speedKms = Math.hypot(vx, vy) * AU_KM/DAY_S;
  return { distAU, speedKms, angleDeg, inclDeg, lonDeg };
}

document.getElementById('btnGenerateImpactor').addEventListener('click', () => {
  const jdImpact = impCurrentJD();
  if (jdImpact <= simJD){
    toast("La date d'impact doit être dans le futur par rapport à l'horloge actuelle");
    return;
  }
  const impactSpeedKms = Number(document.getElementById('fImp_speed').value) || 19;
  const approachAngleDeg = Number(document.getElementById('fImp_angle').value) || 45;

  const statusEl = document.getElementById('computeStatus');
  statusEl.textContent = 'Calcul de la trajectoire d\'impact…';

  setTimeout(() => {
    const t0 = performance.now();

    // Targeting a precise impact means backward-integrating through a
    // close planetary encounter, which is numerically delicate (and, for
    // some approach geometries, briefly chaotic). Rather than accept
    // whatever the first attempt lands on, try a few starting offsets
    // from Earth and refine each with a couple of feedback-correction
    // passes (aim point += observed miss vector), keeping the best hit
    // found. Step counts are capped per attempt so a bad geometry fails
    // fast instead of grinding for seconds.
    const CAP = { maxSteps: 6000 };
    const earthAtImpact = computeBodiesNow(jdImpact).earth;
    const earthVelI = bodyVelocity('earth', jdImpact);
    let best = null;
    const earthRadiusAU = PLANETS.find(p => p.key === 'earth').radiusKm / AU_KM;
    outer:
    for (const mult of [3, 1, 5, 8]){
      const trialOffset = mult * earthRadiusAU;
      let aim = { x:earthAtImpact.x, y:earthAtImpact.y, z:earthAtImpact.z };
      for (let iter = 0; iter < 3; iter++){
        const impactState = buildLaunchState(aim, earthVelI, impactSpeedKms, approachAngleDeg, 0, trialOffset);
        const backTraj = integrateTrajectory(impactState, jdImpact, 0, Object.assign({ backDays: jdImpact - simJD }, CAP));
        const stateNow = backTraj[0];
        const fwdState = [stateNow.x, stateNow.y, stateNow.z, stateNow.vx, stateNow.vy, stateNow.vz];
        const fwdTraj = integrateTrajectory(fwdState, simJD, jdImpact - simJD, Object.assign({ backDays:0 }, CAP));
        const finalPt = fwdTraj[fwdTraj.length - 1];
        const missVec = { x: earthAtImpact.x-finalPt.x, y: earthAtImpact.y-finalPt.y, z: earthAtImpact.z-finalPt.z };
        const missAU = Math.hypot(missVec.x, missVec.y, missVec.z);
        if (!best || missAU < best.missAU) best = { trajectory: fwdTraj, missAU, stateAtNow: stateNow };
        if (missAU * AU_KM < 20000) break outer; // close enough to call it a hit
        aim = { x: aim.x+missVec.x, y: aim.y+missVec.y, z: aim.z+missVec.z };
      }
    }

    const trajectory = best.trajectory;
    const s = best.stateAtNow;
    const params = stateToApproxParams([s.x,s.y,s.z,s.vx,s.vy,s.vz], simJD);

    document.getElementById('fAst_dist').value = params.distAU.toFixed(3);
    document.getElementById('fAst_speed').value = Math.min(80, params.speedKms).toFixed(2);
    document.getElementById('fAst_angle').value = params.angleDeg.toFixed(1);
    document.getElementById('fAst_incl').value = params.inclDeg.toFixed(1);
    document.getElementById('fAst_lon').value = params.lonDeg.toFixed(1);

    const id = 'a' + (++astCounter) + '_' + Math.random().toString(36).slice(2,7);
    const color = ASTEROID_COLORS[asteroids.length % ASTEROID_COLORS.length];
    const name = document.getElementById('fAst_name').value.trim() || `Impacteur ${astCounter}`;
    const massKg = Number(document.getElementById('fAst_mass').value) || 0;
    const approaches = findCloseApproaches(trajectory, 'ast:'+id);
    asteroids.push({ id, name, color, params, massKg, trajectory, family:null, spanYears:null, approaches, isImpactor:true });
    renderAsteroidList();

    const ms = (performance.now() - t0).toFixed(0);
    const missKm = best.missAU * AU_KM;
    const precision = missKm < 20000
      ? 'impact confirmé'
      : `écart résiduel ≈ ${missKm.toLocaleString('fr-FR',{maximumFractionDigits:0})} km`;
    statusEl.textContent = `Impacteur calculé (${trajectory.length} points, ${ms} ms, ${precision}).`;
    toast(`${name} : impact prévu le ${DATE_FMT.format(jdToDate(jdImpact))} (${precision})`, 4500);
  }, 20);
});

// ===========================================================
// Rocket: launch from Earth
// ===========================================================
// Launch date: a single slider, no popup/keyboard entry needed, so the
// map + preview trajectory stay visible and update live while dragging.
// A checkbox switches its range between a wide coarse sweep (±10 years)
// and a narrow fine one (±10 days), re-centered on the currently chosen
// date each time it's toggled.
let rocLaunchJD = simJD;
let rocDateAnchor = simJD;
let rocFineMode = false;
const rocDateSlider = document.getElementById('fRoc_dateSlider');
const rocDateValue = document.getElementById('fRoc_dateValue');
const rocFineToggle = document.getElementById('fRoc_fineToggle');

function rocApplySliderRange(){
  if (rocFineMode){ rocDateSlider.min = '-10'; rocDateSlider.max = '10'; rocDateSlider.step = '0.02'; }
  else { rocDateSlider.min = '-3650'; rocDateSlider.max = '3650'; rocDateSlider.step = '1'; }
  rocDateSlider.value = '0';
}
function rocUpdateDateLabel(){
  rocDateValue.textContent = DATE_FMT.format(jdToDate(rocLaunchJD));
}
function rocResetToNow(){
  rocLaunchJD = simJD; rocDateAnchor = simJD;
  rocApplySliderRange();
  rocUpdateDateLabel();
  schedulePreview();
}
document.getElementById('btnRocket').addEventListener('click', rocResetToNow);
document.getElementById('btnRocLaunchNow').addEventListener('click', rocResetToNow);
rocFineToggle.addEventListener('change', () => {
  rocFineMode = rocFineToggle.checked;
  rocDateAnchor = rocLaunchJD;
  rocApplySliderRange();
});
rocDateSlider.addEventListener('input', () => {
  rocLaunchJD = rocDateAnchor + Number(rocDateSlider.value);
  rocUpdateDateLabel();
  schedulePreview();
});
rocApplySliderRange();

function readRocketLaunchJD(){ return rocLaunchJD; }

// Rocket type presets: pick one to prefill delta-v/mass/burn — loosely
// inspired by real mission classes (impulsive-burn model, so no
// continuous low-thrust "ion drive" preset).
const ROCKET_PRESETS = [
  { name:'— Personnalisé —', deltaVKms:null },
  { name:'Sonde légère (300 kg, Δv 3 km/s)', massKg:300, deltaVKms:3, burnAngleDeg:0 },
  { name:'Satellite standard (1 500 kg, Δv 4 km/s)', massKg:1500, deltaVKms:4, burnAngleDeg:0 },
  { name:'Lanceur lourd (12 000 kg, Δv 3.2 km/s)', massKg:12000, deltaVKms:3.2, burnAngleDeg:0 },
  { name:'Sonde rapide type New Horizons (480 kg, Δv 16.5 km/s)', massKg:480, deltaVKms:16.5, burnAngleDeg:0 },
];
const rocPresetSelect = document.getElementById('fRoc_preset');
ROCKET_PRESETS.forEach((p, i) => {
  const opt = document.createElement('option');
  opt.value = String(i); opt.textContent = p.name;
  rocPresetSelect.appendChild(opt);
});
rocPresetSelect.addEventListener('change', () => {
  const p = ROCKET_PRESETS[Number(rocPresetSelect.value)];
  if (!p || p.deltaVKms === null) return;
  document.getElementById('fRoc_dv').value = p.deltaVKms;
  document.getElementById('fRoc_mass').value = p.massKg;
  document.getElementById('fRoc_angle').value = p.burnAngleDeg;
  schedulePreview();
});

let interceptThresholdAU = 100000 / AU_KM;
const rocThresholdInput = document.getElementById('fRoc_threshold');
rocThresholdInput.addEventListener('input', () => {
  const km = Number(rocThresholdInput.value);
  if (Number.isFinite(km) && km > 0) interceptThresholdAU = km / AU_KM;
  schedulePreview();
});

const rocSiteSelect = document.getElementById('fRoc_site');
CITIES.forEach((c, i) => {
  const opt = document.createElement('option');
  opt.value = String(i);
  opt.textContent = c.name;
  rocSiteSelect.appendChild(opt);
});
rocSiteSelect.selectedIndex = 0;

document.querySelectorAll('#rocketSheet .preset-btn[data-ang]').forEach(b => {
  b.addEventListener('click', () => {
    document.getElementById('fRoc_angle').value = b.dataset.ang;
    schedulePreview();
  });
});

document.getElementById('fRoc_varToggle').addEventListener('change', e => {
  document.getElementById('rocketVariationParams').style.opacity = e.target.checked ? '1' : '0.4';
});
document.getElementById('rocketVariationParams').style.opacity = '0.4';

function readRocketBurn(){
  return {
    deltaVKms: Number(document.getElementById('fRoc_dv').value),
    burnAngleDeg: Number(document.getElementById('fRoc_angle').value),
    burnInclDeg: Number(document.getElementById('fRoc_incl').value),
  };
}

document.getElementById('btnLaunchRocket').addEventListener('click', () => {
  const burn = readRocketBurn();
  const massKg = Number(document.getElementById('fRoc_mass').value) || 0;
  const name = document.getElementById('fRoc_name').value.trim() || `Fusée ${++rocketCounter}`;
  const spanYears = Number(document.getElementById('fRoc_span').value) || 1.5;
  const withVariation = document.getElementById('fRoc_varToggle').checked;
  const marginPct = Number(document.getElementById('fRoc_margin').value) || 5;
  const samples = Math.max(4, Math.min(60, Number(document.getElementById('fRoc_samples').value) || 24));
  const launchJD = readRocketLaunchJD();

  const statusEl = document.getElementById('rocketComputeStatus');
  statusEl.textContent = 'Calcul de la trajectoire…';

  setTimeout(() => {
    const t0 = performance.now();
    const earthPos = computeBodiesNow(launchJD).earth;
    const earthVel = bodyVelocity('earth', launchJD);
    const state0 = buildLaunchState(earthPos, earthVel, burn.deltaVKms, burn.burnAngleDeg, burn.burnInclDeg, LAUNCH_OFFSET_AU);
    const spanDays = spanYears * 365.25;
    const trajectory = integrateTrajectory(state0, launchJD, spanDays, { backDays:0 });

    let family = null;
    if (withVariation){
      statusEl.textContent = 'Calcul de la famille de trajectoires…';
      family = computeLaunchVariationFamily(earthPos, earthVel, burn, marginPct, samples, launchJD, spanDays,
        { dtMax:0.5, dtMin:0.0006, sampleIntervalDays:1.5, backDays:0 }, LAUNCH_OFFSET_AU);
    }

    const id = 'r' + (++rocketCounter) + '_' + Math.random().toString(36).slice(2,7);
    const color = ROCKET_COLORS[rockets.length % ROCKET_COLORS.length];
    const approaches = findCloseApproaches(trajectory, 'roc:'+id);
    rockets.push({ id, name, color, burn, massKg, trajectory, family, spanYears, launchJD, approaches });
    clearPreview();
    renderRocketList();
    const ms = (performance.now() - t0).toFixed(0);
    statusEl.textContent = `Trajectoire calculée (${trajectory.length} points, ${ms} ms).`;
    toast(approaches.length ? `${name} lancée — ${approachSummary(approaches)}` : `${name} lancée`, 4200);
  }, 20);
});

document.getElementById('btnClearRockets').addEventListener('click', () => {
  rockets = [];
  if (selectedKey && selectedKey.startsWith('roc:')) clearFocus();
  renderRocketList();
  document.getElementById('rocketComputeStatus').textContent = '';
});

function renderRocketList(){
  const list = document.getElementById('rocketList');
  list.innerHTML = '';
  rockets.forEach(r => {
    const el = document.createElement('div');
    el.className = 'asteroid-item';
    const warnLine = r.approaches && r.approaches.length
      ? `<div class="a-meta" style="color:${r.approaches[0].minAU < CLOSE_WARN_AU ? 'var(--danger)' : 'var(--amber)'}">${approachSummary(r.approaches)}</div>`
      : '';
    el.innerHTML = `
      <div>
        <div class="a-name" style="color:${r.color}">🚀 ${r.name}</div>
        <div class="a-meta">Δv ${r.burn.deltaVKms.toFixed(1)} km/s · ${r.burn.burnAngleDeg}° · incl ${r.burn.burnInclDeg}°${r.family ? ' · famille ✓' : ''}</div>
        ${warnLine}
      </div>
      <div style="display:flex; gap:6px;">
        <button data-act="focus">Voir</button>
        <button data-act="del">✕</button>
      </div>`;
    el.querySelector('[data-act="focus"]').addEventListener('click', () => {
      focusOn('roc:' + r.id);
    });
    el.querySelector('[data-act="del"]').addEventListener('click', () => {
      rockets = rockets.filter(x => x.id !== r.id);
      if (selectedKey === 'roc:' + r.id) clearFocus();
      renderRocketList();
    });
    list.appendChild(el);
  });
}

// ===========================================================
// Live preview: while either creation sheet is open and the user edits
// a field, a fast/coarse trajectory is (re)computed and drawn immediately,
// so the shape of the orbit is visible before committing to a full,
// precise calculation via "Calculer" / "Lancer".
// ===========================================================
let activePreview = null; // { trajectory, color }
let activeCheckpoints = null; // { rocketPoints:[{jd,x,y,label}], tracks:[{key,color,points}], bestKey }
let previewTimer = null;

function clearPreview(){ activePreview = null; activeCheckpoints = null; }

function schedulePreview(){
  clearTimeout(previewTimer);
  previewTimer = setTimeout(computePreview, 180);
}

function computePreview(){
  const PREVIEW_OPTS = { dtMax:2.5, dtMin:0.03, sampleIntervalDays:4, maxSteps:4000 };
  const astReadoutEl = document.getElementById('asteroidInterceptReadout');
  const rocReadoutEl = document.getElementById('rocketInterceptReadout');
  try{
    if (!asteroidSheetEl.classList.contains('hidden')){
      const params = readAsteroidForm();
      if (!Number.isFinite(params.distAU) || params.distAU <= 0 || !Number.isFinite(params.speedKms)){
        astReadoutEl.textContent = ''; return;
      }
      const spanYears = Math.min(2, Number(document.getElementById('fAst_span').value) || 2);
      const st = buildInitialState(params);
      const trajectory = integrateTrajectory(st, simJD, spanYears*365.25, PREVIEW_OPTS);
      activePreview = { trajectory, color: '#ffffff' };

      const approaches = findCloseApproaches(trajectory, null);
      astReadoutEl.classList.remove('hit');
      astReadoutEl.textContent = approaches.length
        ? approachSummary(approaches)
        : 'Aucun passage rapproché détecté (< 0,05 UA) sur la fenêtre affichée.';
    } else if (!rocketSheetEl.classList.contains('hidden')){
      const burn = readRocketBurn();
      if (!Number.isFinite(burn.deltaVKms) || burn.deltaVKms <= 0){
        rocReadoutEl.textContent = ''; activeCheckpoints = null; return;
      }
      const launchJD = readRocketLaunchJD();
      const earthPos = computeBodiesNow(launchJD).earth;
      const earthVel = bodyVelocity('earth', launchJD);
      const st = buildLaunchState(earthPos, earthVel, burn.deltaVKms, burn.burnAngleDeg, burn.burnInclDeg, LAUNCH_OFFSET_AU);
      const spanYears = Math.min(1.5, Number(document.getElementById('fRoc_span').value) || 1.5);
      const trajectory = integrateTrajectory(st, launchJD, spanYears*365.25, { ...PREVIEW_OPTS, backDays:0 });
      activePreview = { trajectory, color: '#ffffff' };

      const noteThreshold = Math.max(CLOSE_NOTE_AU, interceptThresholdAU);
      const approaches = findCloseApproaches(trajectory, null, noteThreshold);
      const toAsteroids = approaches.filter(a => a.isAsteroid);
      const best = toAsteroids[0] || approaches[0];
      if (!best){
        rocReadoutEl.classList.remove('hit');
        rocReadoutEl.textContent = 'Aucun objet suivi à proximité de cette trajectoire pour le moment.';
      } else {
        const isHit = best.minAU <= interceptThresholdAU && best.isAsteroid;
        rocReadoutEl.classList.toggle('hit', isHit);
        const km = (best.minAU*AU_KM).toLocaleString('fr-FR',{maximumFractionDigits:0});
        const when = DATE_FMT.format(jdToDate(best.jd));
        rocReadoutEl.textContent = isHit
          ? `🎯 INTERCEPTION : ${best.name} à ${km} km le ${when}`
          : `Approche la plus proche : ${best.name} à ${km} km le ${when} (seuil : ${(interceptThresholdAU*AU_KM).toLocaleString('fr-FR',{maximumFractionDigits:0})} km)`;
      }

      // Time-synchronized checkpoints: show where the rocket AND *every*
      // tracked astre (planets, Lune, astéroïdes connus) actually are at
      // the same handful of moments — not just the closest target — so
      // "the paths cross" can be told apart from "they're there at the
      // same time", which is what a real interception needs. The closest
      // tracked object (if any) is additionally linked to the rocket with
      // a dashed line, at each checkpoint, to call out the aiming target.
      const jd0 = trajectory[0].jd, jd1 = trajectory[trajectory.length-1].jd;
      const nCk = 6;
      const rocketPoints = [];
      for (let i = 1; i <= nCk; i++){
        const t = jd0 + (jd1 - jd0) * i / (nCk + 1);
        const rp = samplePosition(trajectory, t);
        if (rp) rocketPoints.push({ jd:t, x:rp.x, y:rp.y, label:'+'+Math.round(t-launchJD)+'j' });
      }
      const tracks = ALL_BODY_META
        .filter(b => b.key !== 'sun')
        .map(b => ({ key:b.key, color:b.color, points: rocketPoints.map(cp => resolveTargetPosition(b.key, cp.jd)) }))
        .filter(tr => tr.points.length === rocketPoints.length && tr.points.every(p => p));
      activeCheckpoints = rocketPoints.length ? { rocketPoints, tracks, bestKey: best ? best.key : null } : null;
    }
  } catch(e){ /* ignore transient bad input while typing */ }
}

const asteroidSheetEl = document.getElementById('paneAsteroids');
const rocketSheetEl = document.getElementById('paneRocket');
['fAst_dist','fAst_speed','fAst_angle','fAst_incl','fAst_lon','fAst_span'].forEach(id => {
  document.getElementById(id).addEventListener('input', schedulePreview);
});
['fRoc_dv','fRoc_angle','fRoc_incl','fRoc_span'].forEach(id => {
  document.getElementById(id).addEventListener('input', schedulePreview);
});

// ===========================================================
// Asteroid: place-on-map mode
//   1. tap "Placer sur la carte" -> tap the map once to set position
//   2. a second tap (or a press-drag-release) sets direction + speed
//   3. release -> numeric fields are filled in, ready to compute
// The two steps are independent gestures on purpose: requiring one
// continuous press-drag-release is unreliable on touch (a plain tap has
// no move events at all), so step 2 accepts a fresh tap just as well as
// a drag — whatever the finger's last position was becomes the aim.
// A "circular orbit" button also lets you skip aiming entirely.
// ===========================================================
const placeBanner = document.getElementById('placeBanner');
const placeBannerText = document.getElementById('placeBannerText');
const btnPlaceCircular = document.getElementById('btnPlaceCircular');
let placing = null;        // null | 'point' | 'vector'
let placePointerId = null; // pointer doing step 1 (set position)
let placeAimPointerId = null; // pointer doing step 2 (aim direction/speed)
let placePointWorld = null;
let placeDragWorld = null;
let placeSpeedBeforeHold = 0;
const REF_DAYS = 15; // drag length is interpreted as displacement over this many days

function circularSpeedKms(distAU){
  const vAUday = Math.sqrt(GM_SUN / distAU);
  return vAUday * AU_KM / DAY_S;
}

document.getElementById('btnPlaceOnMap').addEventListener('click', () => {
  placeSpeedBeforeHold = speed; setSpeed(0);
  placing = 'point';
  placePointerId = null; placeAimPointerId = null;
  btnPlaceCircular.classList.add('hidden');
  placeBannerText.textContent = "Touchez la carte pour placer l'astéroïde";
  placeBanner.classList.remove('hidden');
});

function endPlacement(){
  placing = null; placePointerId = null; placeAimPointerId = null;
  placePointWorld = null; placeDragWorld = null;
  btnPlaceCircular.classList.add('hidden');
  placeBanner.classList.add('hidden');
  setSpeed(placeSpeedBeforeHold);
}
document.getElementById('btnPlaceCancel').addEventListener('click', () => endPlacement());

// Step 1 complete: position is set, now waiting for a second, independent
// gesture to aim the direction/speed.
function commitPlacePoint(e){
  const rect = canvas.getBoundingClientRect();
  placePointWorld = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  placeDragWorld = { ...placePointWorld };
  placing = 'vector';
  placeAimPointerId = null;
  btnPlaceCircular.classList.remove('hidden');
  placeBannerText.textContent = 'Touchez à nouveau pour viser la direction et la vitesse';
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

btnPlaceCircular.addEventListener('click', () => {
  placeDragWorld = { ...placePointWorld }; // zero-length -> circular fallback in finalizePlacement
  finalizePlacement();
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

  endPlacement();
  schedulePreview();
  toast('Position et vitesse définies depuis la carte — vérifiez puis calculez');
}

// ===========================================================
// Body info panel: distance / velocity / force / proximity readouts
// for whichever body or object is currently selected.
// ===========================================================
const CLOSE_WARN_AU = 0.005;   // ~750,000 km — highlighted in the distance list
const CLOSE_NOTE_AU = 0.05;    // ~7.5M km — surfaced as a close-approach notice

const bodyInfoSheetCtl = wireSheet('bodyInfoSheet','bodyInfoBackdrop', null, 'btnCloseBodyInfo');
let bodyInfoOpen = false;
document.getElementById('btnLockInfo').addEventListener('click', () => {
  if (!selectedKey) return;
  bodyInfoOpen = true;
  bodyInfoSheetCtl.open();
});
document.getElementById('bodyInfoBackdrop').addEventListener('click', () => { bodyInfoOpen = false; });
document.getElementById('btnCloseBodyInfo').addEventListener('click', () => { bodyInfoOpen = false; });

// Resolve whatever is selected into a common {name, pos, vel, mass} shape.
function getSelectedState(jd){
  if (!selectedKey) return null;
  if (selectedKey.startsWith('ast:')){
    const a = asteroids.find(x => x.id === selectedKey.slice(4));
    if (!a) return null;
    const p = samplePosition(a.trajectory, jd);
    return { name:a.name, pos:{x:p.x,y:p.y,z:p.z}, vel:{x:p.vx,y:p.vy,z:p.vz}, mass:a.massKg, color:a.color };
  }
  if (selectedKey.startsWith('roc:')){
    const r = rockets.find(x => x.id === selectedKey.slice(4));
    if (!r) return null;
    const p = samplePosition(r.trajectory, jd);
    return { name:'🚀 '+r.name, pos:{x:p.x,y:p.y,z:p.z}, vel:{x:p.vx,y:p.vy,z:p.vz}, mass:r.massKg, color:r.color };
  }
  const bodies = computeBodiesNow(jd);
  const pos = bodies[selectedKey];
  const vel = selectedKey === 'sun' ? {x:0,y:0,z:0} : bodyVelocity(selectedKey, jd);
  const meta = ALL_BODY_META.find(b => b.key === selectedKey);
  return { name: meta ? meta.name : selectedKey, pos, vel, mass: MASS_KG[selectedKey] || null, color: meta ? meta.color : '#fff' };
}

function fmtAU(au){
  return au < 0.01 ? `${(au*AU_KM).toLocaleString('fr-FR',{maximumFractionDigits:0})} km` : `${au.toFixed(4)} UA`;
}
function statCell(label, value, warn=false){
  return `<div class="stat-cell"><div class="s-label">${label}</div><div class="s-value${warn?' warn':''}">${value}</div></div>`;
}

function updateBodyInfoPanel(){
  if (!bodyInfoOpen || !selectedKey) return;
  const now = performance.now();
  if (updateBodyInfoPanel._t && now - updateBodyInfoPanel._t < 200) return;
  updateBodyInfoPanel._t = now;
  const s = getSelectedState(simJD);
  if (!s) return;

  document.getElementById('biName').textContent = s.name;

  const rSun = Math.hypot(s.pos.x, s.pos.y, s.pos.z);
  const speedAUday = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
  const speedKms = speedAUday * AU_KM / DAY_S;
  const headingDeg = (Math.atan2(s.vel.y, s.vel.x) * 180/Math.PI + 360) % 360;

  const [ax, ay, az] = acceleration([s.pos.x,s.pos.y,s.pos.z,0,0,0], simJD);
  const accelMS2 = Math.hypot(ax,ay,az) * ACCEL_AUDAY2_TO_MS2;
  const forceN = s.mass ? accelMS2 * s.mass : null;

  const stats = [
    statCell('Distance au Soleil', fmtAU(rSun)),
    statCell('Vitesse héliocentrique', speedKms.toFixed(2) + ' km/s'),
    statCell('Cap (direction)', headingDeg.toFixed(0) + '°'),
    statCell('Accélération subie', accelMS2.toExponential(2) + ' m/s²'),
  ];
  if (forceN !== null){
    stats.push(statCell('Force totale (F=ma)', forceN >= 1000 ? (forceN/1000).toFixed(2)+' kN' : forceN.toFixed(1)+' N'));
  }
  document.getElementById('biStats').innerHTML = stats.join('');

  // distances to every other tracked body/object
  const bodies = computeBodiesNow(simJD);
  const rows = [];
  const pushRow = (name, color, pos) => {
    if (!pos) return;
    const d = Math.hypot(s.pos.x-pos.x, s.pos.y-pos.y, s.pos.z-(pos.z||0));
    rows.push({ name, color, d });
  };
  if (selectedKey !== 'sun') pushRow('Soleil', SUN.color, {x:0,y:0,z:0});
  for (const p of PLANETS) if (selectedKey !== p.key) pushRow(p.name, p.color, bodies[p.key]);
  if (selectedKey !== 'moon') pushRow('Lune', MOON.color, bodies.moon);
  for (const a of KNOWN_ASTEROIDS) if (selectedKey !== a.key) pushRow(a.name, a.color, bodies[a.key]);
  for (const a of asteroids) if (selectedKey !== 'ast:'+a.id){
    const p = samplePosition(a.trajectory, simJD); pushRow(a.name, a.color, p);
  }
  for (const r of rockets) if (selectedKey !== 'roc:'+r.id){
    const p = samplePosition(r.trajectory, simJD); pushRow('🚀 '+r.name, r.color, p);
  }
  rows.sort((a,b) => a.d - b.d);
  document.getElementById('biDistances').innerHTML = rows.map(r => `
    <div class="distance-row${r.d < CLOSE_WARN_AU ? ' warn' : ''}">
      <span class="d-name"><span class="d-dot" style="background:${r.color}"></span>${r.name}</span>
      <span class="d-val">${fmtAU(r.d)}</span>
    </div>`).join('');
}

// ===========================================================
// Close-approach scanning: after any asteroid/rocket trajectory is
// computed, check it against every planet/Sun/Moon and every other
// tracked object for how close it gets, so genuinely risky passes can
// be surfaced as a warning instead of discovered by eye.
// ===========================================================
const KNOWN_ASTEROID_KEYS = new Set(KNOWN_ASTEROIDS.map(a => a.key));
function isAsteroidTarget(key){ return key.startsWith('ast:') || KNOWN_ASTEROID_KEYS.has(key); }

// Resolve any tracked key (body, known asteroid, user asteroid, rocket)
// to its position at an arbitrary jd — used for the aiming checkpoints.
function resolveTargetPosition(key, jd){
  if (key.startsWith('ast:')){ const a = asteroids.find(x => x.id === key.slice(4)); return a ? samplePosition(a.trajectory, jd) : null; }
  if (key.startsWith('roc:')){ const r = rockets.find(x => x.id === key.slice(4)); return r ? samplePosition(r.trajectory, jd) : null; }
  return computeBodiesNow(jd)[key] || null;
}

function findCloseApproaches(trajectory, selfKey, noteThresholdAU = CLOSE_NOTE_AU){
  const targets = [{ key:'sun', name:'Soleil', isObj:false }];
  for (const p of PLANETS) targets.push({ key:p.key, name:p.name, isObj:false });
  targets.push({ key:'moon', name:'Lune', isObj:false });
  for (const a of KNOWN_ASTEROIDS) targets.push({ key:a.key, name:a.name, isObj:false });
  for (const a of asteroids) if ('ast:'+a.id !== selfKey) targets.push({ key:'ast:'+a.id, name:a.name, isObj:true, obj:a });
  for (const r of rockets) if ('roc:'+r.id !== selfKey) targets.push({ key:'roc:'+r.id, name:'🚀 '+r.name, isObj:true, obj:r });

  const best = new Map();
  for (const s of trajectory){
    const bodies = computeBodiesNow(s.jd);
    for (const t of targets){
      let p;
      if (t.isObj) p = samplePosition(t.obj.trajectory, s.jd);
      else p = bodies[t.key];
      if (!p) continue;
      const d = Math.hypot(s.x-p.x, s.y-p.y, s.z-(p.z||0));
      const cur = best.get(t.key);
      if (!cur || d < cur.minAU) best.set(t.key, { key:t.key, minAU:d, jd:s.jd, name:t.name, isAsteroid:isAsteroidTarget(t.key) });
    }
  }
  const results = [];
  for (const val of best.values()) if (val.minAU <= noteThresholdAU) results.push(val);
  results.sort((a,b) => a.minAU - b.minAU);
  return results;
}

function approachSummary(approaches){
  if (!approaches.length) return '';
  const top = approaches[0];
  const level = top.minAU < CLOSE_WARN_AU ? '⚠ Rencontre très rapprochée' : '△ Passage rapproché';
  return `${level} : ${top.name} à ${fmtAU(top.minAU)} (${DATE_FMT.format(jdToDate(top.jd))})`;
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
    } else if (selectedKey.startsWith('roc:')){
      const r = rockets.find(x => x.id === selectedKey.slice(4));
      pos = r ? samplePosition(r.trajectory, simJD) : null;
    } else pos = bodies[selectedKey];
    if (pos){ renderer.cam.x = pos.x; renderer.cam.y = pos.y; }
  }

  renderer.beginFrame();
  hitTargets = [];

  for (const p of PLANETS){
    renderer.drawOrbitPath(orbitCache.paths[p.key], p.color, 0.28);
  }
  for (const a of KNOWN_ASTEROIDS){
    renderer.drawOrbitPath(orbitCache.paths[a.key], a.color, 0.16);
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

  for (const r of rockets){
    if (r.family){
      for (const traj of r.family) renderer.drawTrajectory(traj, r.color, 0.10, 1);
    }
  }
  for (const r of rockets){
    renderer.drawTrajectory(r.trajectory, r.color, 0.9, 1.6);
    const pos = samplePosition(r.trajectory, simJD);
    if (pos){
      const { sx, sy } = renderer.worldToScreen(pos.x, pos.y);
      renderer.drawMarker(sx, sy, r.color);
      renderer.drawLabel('🚀 ' + r.name, sx, sy, 6, r.color, selectedKey === 'roc:'+r.id);
      if (selectedKey === 'roc:'+r.id) renderer.drawSelectionRing(sx, sy, 6, r.color);
      hitTargets.push({ key:'roc:'+r.id, sx, sy, r:14 });
    }
  }

  // live coarse preview while a creation sheet is open and being edited
  if (activePreview){
    renderer.drawTrajectory(activePreview.trajectory, activePreview.color, 0.55, 1.2);
    const pos = samplePosition(activePreview.trajectory, simJD);
    if (pos){
      const { sx, sy } = renderer.worldToScreen(pos.x, pos.y);
      renderer.drawMarker(sx, sy, activePreview.color);
    }
  }

  // Time-synchronized checkpoints: at each of a handful of moments along
  // the rocket's preview trajectory, show where the rocket AND *every*
  // tracked astre actually are — not just the closest one — so "the paths
  // cross" can be told apart from "they're there at the same time". The
  // closest tracked object (if any) is additionally linked to the rocket
  // by a faint dashed line at each checkpoint, to call out the aiming
  // target without hiding where everything else is at that same instant.
  if (activeCheckpoints){
    for (let i = 0; i < activeCheckpoints.rocketPoints.length; i++){
      const cp = activeCheckpoints.rocketPoints[i];
      const r = renderer.worldToScreen(cp.x, cp.y);
      for (const track of activeCheckpoints.tracks){
        const p = track.points[i];
        if (!p) continue;
        const t = renderer.worldToScreen(p.x, p.y);
        if (track.key === activeCheckpoints.bestKey){
          renderer.ctx.save();
          renderer.ctx.setLineDash([2,3]);
          renderer.ctx.strokeStyle = 'rgba(255,255,255,0.25)';
          renderer.ctx.lineWidth = 1;
          renderer.ctx.beginPath();
          renderer.ctx.moveTo(r.sx, r.sy); renderer.ctx.lineTo(t.sx, t.sy);
          renderer.ctx.stroke();
          renderer.ctx.restore();
        }
        const isBest = track.key === activeCheckpoints.bestKey;
        renderer.drawTick(t.sx, t.sy, track.color, isBest ? cp.label : '', true);
      }
      renderer.drawTick(r.sx, r.sy, '#ffb454', cp.label, false);
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

  for (const a of KNOWN_ASTEROIDS){
    const spin = rotationAngleDeg(a.spinHours, simJD);
    const { sx, sy, px } = renderer.drawBody(a, bodies[a.key], simJD, spin, 3);
    hitTargets.push({ key:a.key, sx, sy, r:Math.max(px, 16) });
    if (selectedKey === a.key) renderer.drawSelectionRing(sx, sy, px, a.color);
    if (renderer.cam.zoom > 200 || selectedKey === a.key){
      renderer.drawLabel(a.name, sx, sy, px, a.color, selectedKey === a.key);
    }
  }

  // "my location" ground-direction ray, anchored to Earth, rotating with
  // both Earth's real sidereal spin and its orbital motion.
  if (selectedCity){
    const gmst = earthGMSTDeg(simJD);
    const theta = (gmst + selectedCity.lon) * Math.PI / 180;
    const lengthAU = Math.min(3, Math.max(0.01, 220 / renderer.cam.zoom));
    const tipWorld = { x: bodies.earth.x + lengthAU*Math.cos(theta), y: bodies.earth.y + lengthAU*Math.sin(theta) };
    const a = renderer.worldToScreen(bodies.earth.x, bodies.earth.y);
    const b = renderer.worldToScreen(tipWorld.x, tipWorld.y);
    renderer.drawArrow(a.sx, a.sy, b.sx, b.sy, '#6fe3d6');
    renderer.drawLabel(selectedCity.name, b.sx, b.sy, 2, '#6fe3d6', true);
  }

  // placement-mode overlay
  if (placing === 'vector' && placePointWorld){
    const a = renderer.worldToScreen(placePointWorld.x, placePointWorld.y);
    const b = renderer.worldToScreen(placeDragWorld.x, placeDragWorld.y);
    renderer.drawCrosshair(a.sx, a.sy);
    if (Math.hypot(b.sx-a.sx, b.sy-a.sy) > 3) renderer.drawArrow(a.sx, a.sy, b.sx, b.sy);
  }

  // velocity arrow + live stats while the info panel is open
  if (bodyInfoOpen && selectedKey){
    const s = getSelectedState(simJD);
    if (s){
      const speedAUday = Math.hypot(s.vel.x, s.vel.y, s.vel.z);
      if (speedAUday > 1e-9){
        const dirLenAU = Math.min(2, Math.max(0.02, 260 / renderer.cam.zoom));
        const ux = s.vel.x/speedAUday, uy = s.vel.y/speedAUday;
        const a = renderer.worldToScreen(s.pos.x, s.pos.y);
        const b = renderer.worldToScreen(s.pos.x + ux*dirLenAU, s.pos.y + uy*dirLenAU);
        renderer.drawArrow(a.sx, a.sy, b.sx, b.sy, '#ffb454');
      }
    }
    updateBodyInfoPanel();
  }

  requestAnimationFrame(frame);
}

// initial camera
renderer.cam.x = 0; renderer.cam.y = 0; renderer.cam.zoom = 80;
setSpeed(2);
updateSafeArea();
switchTab('time');
requestAnimationFrame(frame);

// ===========================================================
// PWA service worker registration
// ===========================================================
if ('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').then(reg => {
      // Always check for a fresher service worker on load, and again
      // periodically — combined with the network-first fetch strategy in
      // the worker itself, this keeps a reload from ever getting stuck on
      // a stale cached build.
      reg.update().catch(() => {});
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch(() => {});

    let refreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshed) return;
      refreshed = true;
      window.location.reload();
    });
  });
}
