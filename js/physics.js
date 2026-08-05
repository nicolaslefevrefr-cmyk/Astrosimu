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

function acceleration(state, jd){
  const [x, y, z] = state;
  const r3 = Math.pow(x*x + y*y + z*z, 1.5);
  let ax = -GM_SUN * x / r3;
  let ay = -GM_SUN * y / r3;
  let az = -GM_SUN * z / r3;

  for (const planet of PLANETS){
    const p = planetPosition(planet, jd);
    const dx = p.x - x, dy = p.y - y, dz = p.z - z;
    const d3 = Math.pow(dx*dx + dy*dy + dz*dz, 1.5);
    const gm = gmOf(planet.key);
    ax += gm * dx / d3;
    ay += gm * dy / d3;
    az += gm * dz / d3;
  }
  return [ax, ay, az];
}

function accelMagnitude(state, jd){
  const [ax, ay, az] = acceleration(state, jd);
  return Math.hypot(ax, ay, az);
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

// Reference acceleration: the Sun's pull at 1 AU. Used to scale the
// adaptive step — a step "feels right" at dtMax when the local
// acceleration matches this reference, and shrinks when a close
// planetary encounter pushes the acceleration well above it.
const REF_ACCEL = GM_SUN; // AU/day^2 at r = 1 AU

// Adaptive-step integration: the time step shrinks whenever the total
// gravitational acceleration on the body rises (e.g. a close approach
// to a planet), which keeps fast-changing curvature well resolved
// without paying for tiny steps everywhere else. Samples are recorded
// at roughly even *time* intervals (via linear interpolation) so the
// stored polyline stays smooth for rendering regardless of how the
// underlying step size varied.
export function integrateTrajectory(state0, jd0, spanDays, opts = {}){
  const dtMax = opts.dtMax ?? 0.5;       // days, far from any body
  const dtMin = opts.dtMin ?? 0.0004;    // days (~35s), floor near close encounters
  const sampleIntervalDays = opts.sampleIntervalDays ?? 1;
  const maxSteps = opts.maxSteps ?? 150000;

  function adaptiveDt(state, jd){
    const amag = accelMagnitude(state, jd);
    const dt = dtMax * Math.sqrt(REF_ACCEL / Math.max(amag, 1e-12));
    return Math.min(dtMax, Math.max(dtMin, dt));
  }

  function integrateDirection(sign){
    const pts = [];
    let s = state0.slice();
    let jd = jd0;
    let elapsed = 0;
    let sinceSample = 0;
    pts.push({ jd, x: s[0], y: s[1], z: s[2] });
    let steps = 0;
    while (elapsed < spanDays && steps < maxSteps){
      let dt = adaptiveDt(s, jd);
      if (elapsed + dt > spanDays) dt = spanDays - elapsed;
      s = rk4Step(s, jd, sign * dt);
      jd += sign * dt;
      elapsed += dt;
      sinceSample += dt;
      steps++;
      const r = Math.hypot(s[0], s[1], s[2]);
      if (r < SUN_RADIUS_AU || r > ESCAPE_RADIUS_AU){
        pts.push({ jd, x: s[0], y: s[1], z: s[2] });
        break; // collided with the Sun, or clearly escaped the scene
      }
      if (sinceSample >= sampleIntervalDays || elapsed >= spanDays){
        pts.push({ jd, x: s[0], y: s[1], z: s[2] });
        sinceSample = 0;
      }
    }
    return pts;
  }

  const back = integrateDirection(-1).reverse();
  const fwd = integrateDirection(1);
  back.pop(); // avoid duplicating the epoch point shared with fwd[0]
  return [...back, ...fwd];
}

// Sample position at arbitrary jd from a precomputed trajectory via linear
// interpolation between the two bracketing samples.
export function samplePosition(trajectory, jd){
  if (!trajectory.length) return null;
  if (jd <= trajectory[0].jd) return trajectory[0];
  if (jd >= trajectory[trajectory.length - 1].jd) return trajectory[trajectory.length - 1];
  // binary search
  let lo = 0, hi = trajectory.length - 1;
  while (hi - lo > 1){
    const mid = (lo + hi) >> 1;
    if (trajectory[mid].jd <= jd) lo = mid; else hi = mid;
  }
  const a = trajectory[lo], b = trajectory[hi];
  const f = (jd - a.jd) / (b.jd - a.jd || 1);
  return { jd, x: a.x + (b.x - a.x)*f, y: a.y + (b.y - a.y)*f, z: a.z + (b.z - a.z)*f };
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
