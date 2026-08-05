import { PLANETS, GM_SUN, AU_KM, DAY_S, gmOf } from './orbitalData.js';
import { planetPosition, orbitToEcliptic } from './kepler.js';

const DEG = Math.PI / 180;

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

// Integrate both forward and backward from epoch jd0, return a time-sorted
// array of samples: { jd, x, y, z }.
export function integrateTrajectory(state0, jd0, spanDays, opts = {}){
  const dt = opts.dt ?? 0.25;          // physics step, days
  const sampleEvery = opts.sampleEvery ?? 4; // store every Nth step
  const samples = [];

  // backward
  let s = state0.slice();
  let jd = jd0;
  const back = [];
  let steps = Math.round(spanDays / dt);
  for (let i = 0; i <= steps; i++){
    if (i % sampleEvery === 0) back.push({ jd, x: s[0], y: s[1], z: s[2] });
    s = rk4Step(s, jd, -dt);
    jd -= dt;
  }
  back.reverse();

  // forward
  s = state0.slice();
  jd = jd0;
  const fwd = [];
  for (let i = 0; i <= steps; i++){
    if (i % sampleEvery === 0) fwd.push({ jd, x: s[0], y: s[1], z: s[2] });
    s = rk4Step(s, jd, dt);
    jd += dt;
  }

  samples.push(...back, ...fwd.slice(1));
  return samples;
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
export function computeVariationFamily(baseParams, jd0, spanDays, marginPct, samples, dt){
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
    family.push(integrateTrajectory(st, jd0, spanDays, { dt, sampleEvery: 6 }));
  }
  return family;
}
