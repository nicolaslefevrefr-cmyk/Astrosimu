import { PLANETS, GM_SUN, AU_KM, DAY_S, gmOf } from './orbitalData.js';
import { planetPosition, orbitToEcliptic } from './kepler.js';

const DEG = Math.PI / 180;
const SUN_RADIUS_AU = 696000 / AU_KM;   // treat a passage inside the Sun as a collision
const ESCAPE_RADIUS_AU = 250;            // stop tracking once clearly out of the scene

// Build a heliocentric ecliptic state vector [x,y,z,vx,vy,vz] (AU, AU/day)
// from an intuitive parameterization: distance from Sun, speed, an in-plane
// flight-path angle (0 deg = purely tangential/prograde, 90 deg = purely
// radial outward), an orbital-plane inclination, and the longitude of the
// ascending node (orientation of that plane).
export function buildInitialState({ distAU, speedKms, angleDeg, inclDeg, lonDeg }){
  const r0 = distAU;
  const v0 = speedKms * DAY_S / AU_KM; // AU/day
  const a  = angleDeg * DEG;
  const vr = v0 * Math.sin(a);
  const vt = v0 * Math.cos(a);

  const pos = orbitToEcliptic(r0, 0, inclDeg, 0, lonDeg);
  const vel = orbitToEcliptic(vr, vt, inclDeg, 0, lonDeg);
  return [pos.x, pos.y, pos.z, vel.x, vel.y, vel.z];
}

// Build a state vector for an object launched from a carrier body (e.g. a
// rocket leaving Earth): carrier state plus a delta-v expressed in the
// carrier's own local radial/tangential/normal frame (0deg = prograde
// boost, 90deg = radial outward, 180deg = retrograde, 270deg = radial
// inward — the same convention as buildInitialState's angle). The launch
// position is offset from the carrier's center by carrierRadiusAU along
// the burn direction, so the object never starts at literally zero
// distance from its parent body (which would be a singular starting
// condition for the gravity model).
export function buildLaunchState(carrierPos, carrierVel, deltaVKms, burnAngleDeg, burnInclDeg, carrierRadiusAU=0){
  const lon = Math.atan2(carrierPos.y, carrierPos.x);
  const radial = { x: Math.cos(lon), y: Math.sin(lon) };
  const tangential = { x: -Math.sin(lon), y: Math.cos(lon) };
  const dv = deltaVKms * DAY_S / AU_KM; // AU/day
  const inRad = burnInclDeg * DEG;
  const dvPlane = dv * Math.cos(inRad);
  const dvNormal = dv * Math.sin(inRad);
  const a = burnAngleDeg * DEG;
  const vr = dvPlane * Math.sin(a);
  const vt = dvPlane * Math.cos(a);
  const dvVec = { x: vr*radial.x + vt*tangential.x, y: vr*radial.y + vt*tangential.y, z: dvNormal };

  let dir = dvVec, dirMag = Math.hypot(dir.x, dir.y, dir.z);
  if (dirMag < 1e-9){ dir = { x: radial.x, y: radial.y, z: 0 }; dirMag = 1; }
  const s = carrierRadiusAU / dirMag;

  return [
    carrierPos.x + dir.x*s, carrierPos.y + dir.y*s, (carrierPos.z || 0) + dir.z*s,
    carrierVel.x + dvVec.x, carrierVel.y + dvVec.y, (carrierVel.z || 0) + dvVec.z,
  ];
}

// Small numerical softening applied to every gravity source: purely a
// safety floor against division-by-near-zero (e.g. a rocket's launch
// point sitting only a planetary radius from its parent body) — at
// roughly 300 km it is far smaller than any close-approach distance the
// UI treats as physically meaningful, so it does not affect real dynamics.
const SOFTENING_AU_SQ = Math.pow(2e-6, 2);

// Gravitational acceleration on a massless test particle from the Sun and
// all 8 planets. Exported so the UI can report "total force experienced"
// for any selected body, and so the integrator can build its adaptive step.
export function acceleration(state, jd){
  const [x, y, z] = state;
  const r3 = Math.pow(x*x + y*y + z*z + SOFTENING_AU_SQ, 1.5);
  let ax = -GM_SUN * x / r3;
  let ay = -GM_SUN * y / r3;
  let az = -GM_SUN * z / r3;

  for (const planet of PLANETS){
    const p = planetPosition(planet, jd);
    const dx = p.x - x, dy = p.y - y, dz = p.z - z;
    const d3 = Math.pow(dx*dx + dy*dy + dz*dz + SOFTENING_AU_SQ, 1.5);
    const gm = gmOf(planet.key);
    ax += gm * dx / d3;
    ay += gm * dy / d3;
    az += gm * dz / d3;
  }
  return [ax, ay, az];
}

function derivative(state, jd){
  const [,, , vx, vy, vz] = state;
  const [ax, ay, az] = acceleration(state, jd);
  return [vx, vy, vz, ax, ay, az];
}

function addScaled(a, b, s){
  const out = new Array(6);
  for (let i = 0; i < 6; i++) out[i] = a[i] + b[i] * s;
  return out;
}

function rk4Step(state, jd, dt){
  const k1 = derivative(state, jd);
  const k2 = derivative(addScaled(state, k1, dt/2), jd + dt/2);
  const k3 = derivative(addScaled(state, k2, dt/2), jd + dt/2);
  const k4 = derivative(addScaled(state, k3, dt), jd + dt);
  const out = new Array(6);
  for (let i = 0; i < 6; i++){
    out[i] = state[i] + (dt/6) * (k1[i] + 2*k2[i] + 2*k3[i] + k4[i]);
  }
  return out;
}

// Adaptive step, per-body dynamical timescale.
//
// Scaling only the total force against a single (solar) reference badly
// under-reacts to a close planetary encounter: a planet's pull only ever
// rivals the Sun's within a few hundred thousand km of it, so anything
// looser than that — exactly the range where an asteroid's path visibly
// bends around a planet — used to get the same coarse step as empty
// space, producing jagged, angular-looking flybys.
//
// Instead, for every massive body we compute its own local dynamical
// timescale sqrt(r^3/GM) (essentially the orbital period at the current
// distance from *that* body alone) and take the smallest one across the
// Sun and all planets. This shrinks the step whenever the object is
// close to *any* body relative to that body's own scale, regardless of
// how that body's pull compares to the Sun's.
function localTimescaleDays(state, jd){
  const [x, y, z] = state;
  const rSun = Math.sqrt(x*x + y*y + z*z + SOFTENING_AU_SQ);
  let minT = Math.sqrt(Math.pow(rSun, 3) / GM_SUN);

  for (const planet of PLANETS){
    const p = planetPosition(planet, jd);
    const d = Math.sqrt((p.x-x)**2 + (p.y-y)**2 + (p.z-z)**2 + SOFTENING_AU_SQ);
    const gm = gmOf(planet.key);
    const t = Math.sqrt(Math.pow(d, 3) / gm);
    if (t < minT) minT = t;
  }
  return minT;
}

// Integrate from epoch jd0. By default it goes both forward and backward
// by spanDays (useful for an asteroid: "where does it come from"). Pass
// opts.backDays = 0 for objects that don't have a meaningful past before
// jd0 — a rocket, for instance, didn't exist before launch, and
// numerically, back-extrapolating something that started only ~0.01 AU
// from Earth tends to re-trace uncomfortably close to Earth's own past
// position (it's a real mathematical feature of the extrapolation, not
// a fresh "close approach" worth flagging).
//
// Each sample carries position *and* velocity (AU, AU/day) so the UI can
// show speed/heading without re-differentiating. The sampling density
// adapts along with the step size, so a fast close encounter is drawn
// with enough points to look smooth instead of cutting a visible corner.
export function integrateTrajectory(state0, jd0, spanDays, opts = {}){
  const dtMax = opts.dtMax ?? 0.4;          // days, far from any body
  const dtMin = opts.dtMin ?? 0.00025;      // days (~22s), floor near close encounters
  const eta = opts.eta ?? 0.035;            // fraction of the local timescale used as dt
  const sampleIntervalDays = opts.sampleIntervalDays ?? 1;   // coarsest sampling, far from bodies
  const minSampleIntervalDays = opts.minSampleIntervalDays ?? (dtMin * 2);
  const maxSteps = opts.maxSteps ?? 200000;
  const backDays = opts.backDays ?? spanDays;

  function adaptiveDt(state, jd){
    const t = localTimescaleDays(state, jd);
    return Math.min(dtMax, Math.max(dtMin, eta * t));
  }

  function integrateDirection(sign, targetSpanDays){
    const pts = [];
    if (targetSpanDays <= 0) return pts;
    let s = state0.slice();
    let jd = jd0;
    let elapsed = 0;
    let sinceSample = 0;
    pts.push({ jd, x: s[0], y: s[1], z: s[2], vx: s[3], vy: s[4], vz: s[5] });
    let steps = 0;
    while (elapsed < targetSpanDays && steps < maxSteps){
      let dt = adaptiveDt(s, jd);
      if (elapsed + dt > targetSpanDays) dt = targetSpanDays - elapsed;
      s = rk4Step(s, jd, sign * dt);
      jd += sign * dt;
      elapsed += dt;
      sinceSample += dt;
      steps++;
      const r = Math.hypot(s[0], s[1], s[2]);
      if (r < SUN_RADIUS_AU || r > ESCAPE_RADIUS_AU){
        pts.push({ jd, x: s[0], y: s[1], z: s[2], vx: s[3], vy: s[4], vz: s[5] });
        break; // collided with the Sun, or clearly escaped the scene
      }
      // sample more densely while dt itself is small (close encounter)
      const targetInterval = Math.min(sampleIntervalDays, Math.max(minSampleIntervalDays, dt * 6));
      if (sinceSample >= targetInterval || elapsed >= targetSpanDays){
        pts.push({ jd, x: s[0], y: s[1], z: s[2], vx: s[3], vy: s[4], vz: s[5] });
        sinceSample = 0;
      }
    }
    return pts;
  }

  const back = integrateDirection(-1, backDays).reverse();
  const fwd = integrateDirection(1, spanDays);
  if (back.length) back.pop(); // avoid duplicating the epoch point shared with fwd[0]
  return back.length || fwd.length ? [...back, ...fwd] : [{ jd:jd0, x:state0[0], y:state0[1], z:state0[2], vx:state0[3], vy:state0[4], vz:state0[5] }];
}

// Sample position+velocity at arbitrary jd from a precomputed trajectory
// via linear interpolation between the two bracketing samples.
export function samplePosition(trajectory, jd){
  if (!trajectory.length) return null;
  if (jd <= trajectory[0].jd) return trajectory[0];
  if (jd >= trajectory[trajectory.length - 1].jd) return trajectory[trajectory.length - 1];
  let lo = 0, hi = trajectory.length - 1;
  while (hi - lo > 1){
    const mid = (lo + hi) >> 1;
    if (trajectory[mid].jd <= jd) lo = mid; else hi = mid;
  }
  const a = trajectory[lo], b = trajectory[hi];
  const f = (jd - a.jd) / (b.jd - a.jd || 1);
  return {
    jd,
    x: a.x + (b.x - a.x)*f, y: a.y + (b.y - a.y)*f, z: a.z + (b.z - a.z)*f,
    vx: a.vx + (b.vx - a.vx)*f, vy: a.vy + (b.vy - a.vy)*f, vz: a.vz + (b.vz - a.vz)*f,
  };
}

// Generate a family of trajectories by perturbing distance, speed, angle,
// inclination and node within +/- marginPct, uniformly sampled.
export function computeVariationFamily(baseParams, jd0, spanDays, marginPct, samples, opts = {}){
  const family = [];
  const m = marginPct / 100;
  for (let i = 0; i < samples; i++){
    const jitter = () => 1 + (Math.random()*2 - 1) * m;
    const p = {
      distAU: baseParams.distAU * jitter(),
      speedKms: baseParams.speedKms * jitter(),
      angleDeg: baseParams.angleDeg + (Math.random()*2 - 1) * m * 45,
      inclDeg: baseParams.inclDeg + (Math.random()*2 - 1) * m * 20,
      lonDeg: baseParams.lonDeg + (Math.random()*2 - 1) * m * 20,
    };
    const st = buildInitialState(p);
    family.push(integrateTrajectory(st, jd0, spanDays, opts));
  }
  return family;
}

// Same idea for a launch (rocket): perturb delta-v magnitude/angle and a
// small inclination jitter around the base burn.
export function computeLaunchVariationFamily(carrierPos, carrierVel, baseBurn, marginPct, samples, jd0, spanDays, opts = {}, carrierRadiusAU=0){
  const family = [];
  const m = marginPct / 100;
  for (let i = 0; i < samples; i++){
    const jitter = () => 1 + (Math.random()*2 - 1) * m;
    const dv = baseBurn.deltaVKms * jitter();
    const ang = baseBurn.burnAngleDeg + (Math.random()*2 - 1) * m * 30;
    const incl = baseBurn.burnInclDeg + (Math.random()*2 - 1) * m * 15;
    const st = buildLaunchState(carrierPos, carrierVel, dv, ang, incl, carrierRadiusAU);
    family.push(integrateTrajectory(st, jd0, spanDays, opts));
  }
  return family;
}
