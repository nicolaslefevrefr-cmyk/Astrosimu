// ===========================================================
// Physical constants
// ===========================================================
export const AU_KM = 149597870.7;
export const DAY_S = 86400;

// Gaussian gravitational constant squared -> GM_sun in AU^3/day^2
export const GM_SUN = 0.00029591220828559; // AU^3 / day^2

// Planet mass ratios (Sun/Planet) -> used to derive each planet's GM
// for perturbing an asteroid's trajectory.
const MASS_RATIO = {
  mercury: 6023600, venus: 408523.71, earth: 328900.56, // earth+moon combined
  mars: 3098708, jupiter: 1047.3486, saturn: 3497.898,
  uranus: 22902.98, neptune: 19412.24
};

// ===========================================================
// Keplerian elements at J2000 + rates per Julian century (deg / cy, AU / cy)
// Source family: JPL "Keplerian elements for approximate positions of the
// major planets" (Standish et al.), low precision, valid ~1800-2050 AD.
//   a: semi-major axis (AU)          e: eccentricity
//   I: inclination (deg)             L: mean longitude (deg)
//   peri: longitude of perihelion ϖ (deg)
//   node: longitude of ascending node Ω (deg)
// ===========================================================
export const PLANETS = [
  { key:'mercury', name:'Mercure', color:'#b7b2ab', radiusKm:2439.7, spinHours:1407.6,
    a:[0.38709843,0.00000000], e:[0.20563661,0.00002123], I:[7.00559432,-0.00590158],
    L:[252.25166724,149472.67486623], peri:[77.45771895,0.15940013], node:[48.33961819,-0.12214182] },
  { key:'venus', name:'Vénus', color:'#e8cda0', radiusKm:6051.8, spinHours:-5832.5,
    a:[0.72332102,-0.00000026], e:[0.00676399,-0.00005107], I:[3.39777545,0.00043494],
    L:[181.97970850,58517.81560260], peri:[131.76755713,0.05679648], node:[76.67261496,-0.27274174] },
  { key:'earth', name:'Terre', color:'#4d8fe0', radiusKm:6371.0, spinHours:23.9345,
    a:[1.00000018,-0.00000003], e:[0.01673163,-0.00003661], I:[-0.00054346,-0.01337178],
    L:[100.46691572,35999.37306329], peri:[102.93005885,0.31795260], node:[-5.11260389,-0.24123856] },
  { key:'mars', name:'Mars', color:'#c1440e', radiusKm:3389.5, spinHours:24.6229,
    a:[1.52371243,0.00000097], e:[0.09336511,0.00009149], I:[1.85181869,-0.00724757],
    L:[-4.56813164,19140.29934243], peri:[-23.91744784,0.45223625], node:[49.71320984,-0.26852431] },
  { key:'jupiter', name:'Jupiter', color:'#d8ae82', radiusKm:69911, spinHours:9.9250,
    a:[5.20248019,-0.00002864], e:[0.04853590,0.00018026], I:[1.29861416,-0.00322699],
    L:[34.33479152,3034.90371757], peri:[14.27495244,0.18199196], node:[100.29282654,0.13024619] },
  { key:'saturn', name:'Saturne', color:'#e3c88f', radiusKm:58232, spinHours:10.656,
    a:[9.54149883,-0.00003065], e:[0.05550825,-0.00032044], I:[2.49424102,0.00451969],
    L:[50.07571329,1222.11494724], peri:[92.86136063,0.54179478], node:[113.63998702,-0.25015002] },
  { key:'uranus', name:'Uranus', color:'#8fd4d4', radiusKm:25362, spinHours:-17.24,
    a:[19.18797948,-0.00020455], e:[0.04685740,-0.00001550], I:[0.77298127,-0.00180155],
    L:[314.20276625,428.49512595], peri:[172.43404441,0.09266985], node:[73.96250215,0.05739699] },
  { key:'neptune', name:'Neptune', color:'#5b76f0', radiusKm:24622, spinHours:16.11,
    a:[30.06952752,0.00006447], e:[0.00895439,0.00000818], I:[1.77005520,0.00022400],
    L:[304.22289287,218.46515314], peri:[46.68158724,0.01009938], node:[131.78635853,-0.00606302] },
];

export const SUN = { key:'sun', name:'Soleil', color:'#ffd27a', radiusKm:696000, spinHours:609.12 };

// Simplified mean lunar elements (geocentric), correct period & precession
// rates, low absolute precision — sufficient for visualization.
export const MOON = {
  key:'moon', name:'Lune', color:'#c7c7c7', radiusKm:1737.4, spinHours:655.728,
  a_km: 384400, e:0.0549, I:5.145,
  L0:218.3164591, Ldot:13.17639648,          // deg, deg/day
  peri0:83.3532465, peridot:0.1114041,       // deg, deg/day (apsidal precession)
  node0:125.1228, nodedot:-0.0529538083      // deg, deg/day (nodal regression)
};

export function gmOf(key){
  if(key === 'sun') return GM_SUN;
  const r = MASS_RATIO[key];
  return r ? GM_SUN / r : 0;
}

// Curated list of major cities for the "my location" feature — only
// longitude matters for orienting the ground-direction ray.
export const CITIES = [
  { name:'Paris', lon:2.35 }, { name:'Londres', lon:-0.13 },
  { name:'New York', lon:-74.01 }, { name:'Los Angeles', lon:-118.24 },
  { name:'San Francisco', lon:-122.42 }, { name:'Chicago', lon:-87.65 },
  { name:'Mexico', lon:-99.13 }, { name:'São Paulo', lon:-46.63 },
  { name:'Buenos Aires', lon:-58.38 }, { name:'Reykjavik', lon:-21.94 },
  { name:'Madrid', lon:-3.70 }, { name:'Rome', lon:12.50 },
  { name:'Berlin', lon:13.40 }, { name:'Moscou', lon:37.62 },
  { name:'Le Caire', lon:31.24 }, { name:'Lagos', lon:3.38 },
  { name:'Nairobi', lon:36.82 }, { name:'Dubaï', lon:55.30 },
  { name:'New Delhi', lon:77.21 }, { name:'Pékin', lon:116.40 },
  { name:'Shanghai', lon:121.47 }, { name:'Tokyo', lon:139.69 },
  { name:'Séoul', lon:126.98 }, { name:'Singapour', lon:103.82 },
  { name:'Sydney', lon:151.21 }, { name:'Auckland', lon:174.76 },
  { name:'Honolulu', lon:-157.86 },
];

// ===========================================================
// Time helpers
// ===========================================================
export function dateToJD(date){
  return date.getTime() / DAY_S / 1000 + 2440587.5;
}
export function jdToDate(jd){
  return new Date((jd - 2440587.5) * DAY_S * 1000);
}
export const J2000 = 2451545.0;
export function centuriesSinceJ2000(jd){ return (jd - J2000) / 36525; }
export function daysSinceJ2000(jd){ return jd - J2000; }
