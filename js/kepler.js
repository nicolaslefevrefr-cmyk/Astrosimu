import { PLANETS, MOON, centuriesSinceJ2000, daysSinceJ2000 } from './orbitalData.js';

const DEG = Math.PI / 180;

function norm360(deg){
  let d = deg % 360;
  if (d < 0) d += 360;
  return d;
}

// Solve Kepler's equation M = E - e*sin(E) for E (radians), Newton-Raphson.
export function solveKepler(Mdeg, e){
  const M = norm360(Mdeg) * DEG;
  let E = e < 0.8 ? M : Math.PI;
  for (let i = 0; i < 12; i++){
    const dE = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
    E -= dE;
    if (Math.abs(dE) < 1e-9) break;
  }
  return E;
}

// Orbital-plane -> ecliptic frame rotation, returns {x,y,z} in AU.
// Exported so the same rotation can be applied to velocity vectors.
export function orbitToEcliptic(xp, yp, IDeg, wDeg, nodeDeg){
  const I = IDeg * DEG, w = wDeg * DEG, O = nodeDeg * DEG;
  const cosO = Math.cos(O), sinO = Math.sin(O);
  const cosw = Math.cos(w), sinw = Math.sin(w);
  const cosI = Math.cos(I), sinI = Math.sin(I);
  const x = (cosO*cosw - sinO*sinw*cosI)*xp + (-cosO*sinw - sinO*cosw*cosI)*yp;
  const y = (sinO*cosw + cosO*sinw*cosI)*xp + (-sinO*sinw + cosO*cosw*cosI)*yp;
  const z = (sinw*sinI)*xp + (cosw*sinI)*yp;
  return { x, y, z };
}

// Generic Keplerian element -> heliocentric position (AU) at Julian Date.
export function elementsToPosition(a, e, IDeg, LDeg, periDeg, nodeDeg){
  const wDeg = periDeg - nodeDeg;          // argument of perihelion
  const Mdeg = LDeg - periDeg;             // mean anomaly
  const E = solveKepler(Mdeg, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(1 - e*e) * Math.sin(E);
  return orbitToEcliptic(xp, yp, IDeg, wDeg, nodeDeg);
}

// Full body -> heliocentric position + derived mean anomaly / true anomaly.
export function planetPosition(planet, jd){
  const T = centuriesSinceJ2000(jd);
  const a = planet.a[0] + planet.a[1]*T;
  const e = planet.e[0] + planet.e[1]*T;
  const I = planet.I[0] + planet.I[1]*T;
  const L = planet.L[0] + planet.L[1]*T;
  const peri = planet.peri[0] + planet.peri[1]*T;
  const node = planet.node[0] + planet.node[1]*T;
  return { ...elementsToPosition(a, e, I, L, peri, node), a, e, I, L, peri, node };
}

// Precomputed orbit path (array of {x,y,z}) for drawing, N points.
export function planetOrbitPath(planet, jd, n = 180){
  const T = centuriesSinceJ2000(jd);
  const a = planet.a[0] + planet.a[1]*T;
  const e = planet.e[0] + planet.e[1]*T;
  const I = planet.I[0] + planet.I[1]*T;
  const peri = planet.peri[0] + planet.peri[1]*T;
  const node = planet.node[0] + planet.node[1]*T;
  const w = peri - node;
  const pts = [];
  for (let i = 0; i <= n; i++){
    const E = (i / n) * 2 * Math.PI;
    const xp = a * (Math.cos(E) - e);
    const yp = a * Math.sqrt(1 - e*e) * Math.sin(E);
    pts.push(orbitToEcliptic(xp, yp, I, (w*180/Math.PI), (node)));
  }
  return pts;
}

// Moon geocentric position (AU), simplified mean elements.
export function moonPositionGeocentric(jd){
  const d = daysSinceJ2000(jd);
  const L = MOON.L0 + MOON.Ldot * d;
  const peri = MOON.peri0 + MOON.peridot * d;
  const node = MOON.node0 + MOON.nodedot * d;
  const a = MOON.a_km / 149597870.7;
  return elementsToPosition(a, MOON.e, MOON.I, L, peri, node);
}

export function rotationAngleDeg(spinHours, jd){
  const hoursSinceJ2000 = daysSinceJ2000(jd) * 24;
  return norm360((hoursSinceJ2000 / spinHours) * 360);
}
