import { AU_KM } from './orbitalData.js';

function mulberry32(seed){
  return function(){
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Procedurally generate a stylized surface texture for a body (cached).
function buildSurfaceTexture(body, seed){
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size; c.height = size;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(seed);

  const isGasGiant = ['jupiter','saturn','uranus','neptune','sun'].includes(body.key);
  ctx.fillStyle = body.color;
  ctx.fillRect(0, 0, size, size);

  if (isGasGiant){
    // banded gas-giant texture
    const bands = 10 + Math.floor(rnd()*6);
    for (let i = 0; i < bands; i++){
      const y = (i / bands) * size;
      const h = size / bands;
      const shade = (rnd() - 0.5) * 40;
      ctx.fillStyle = shadeColor(body.color, shade);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, y, size, h + 1);
    }
    ctx.globalAlpha = 1;
  } else {
    // rocky/terrestrial: mottled blotches (continents/craters)
    const blotches = body.key === 'earth' ? 90 : 140;
    for (let i = 0; i < blotches; i++){
      const x = rnd()*size, y = rnd()*size, r = 6 + rnd()*26;
      const shade = (rnd() - 0.5) * 55;
      ctx.fillStyle = shadeColor(body.color, shade);
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (body.key === 'earth'){
      // ocean tint pass
      ctx.fillStyle = '#1d4f8f';
      ctx.globalAlpha = 0.28;
      for (let i = 0; i < 8; i++){
        ctx.beginPath();
        ctx.ellipse(rnd()*size, rnd()*size, 30+rnd()*60, 20+rnd()*40, rnd()*Math.PI, 0, Math.PI*2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
  }
  // subtle vignette for spherical shading
  const grad = ctx.createRadialGradient(size*0.35,size*0.32,size*0.05, size*0.5,size*0.5,size*0.72);
  grad.addColorStop(0, 'rgba(255,255,255,0.18)');
  grad.addColorStop(0.5, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0,size,size);
  return c;
}

function shadeColor(hex, amt){
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt, g = ((n >> 8) & 0xff) + amt, b = (n & 0xff) + amt;
  r = Math.max(0, Math.min(255, r)); g = Math.max(0, Math.min(255, g)); b = Math.max(0, Math.min(255, b));
  return `rgb(${r|0},${g|0},${b|0})`;
}

const ATMO = {
  earth:  { color:'110,170,255', thickness:0.22 },
  venus:  { color:'240,220,160', thickness:0.30 },
  mars:   { color:'230,150,110', thickness:0.10 },
  jupiter:{ color:'230,200,160', thickness:0.06 },
  saturn: { color:'230,210,170', thickness:0.06 },
  uranus: { color:'160,230,230', thickness:0.08 },
  neptune:{ color:'130,150,240', thickness:0.08 },
};

export class Renderer{
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.cam = { x:0, y:0, zoom:90 }; // AU-centered, px per AU
    this.textures = new Map();
    this.resize();
  }

  resize(){
    const { canvas } = this;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
  }

  worldToScreen(x, y){
    const { canvas, cam } = this;
    const cx = canvas.width/2, cy = canvas.height/2;
    return {
      sx: cx + (x - cam.x) * cam.zoom * this.dpr,
      sy: cy - (y - cam.y) * cam.zoom * this.dpr,
    };
  }

  screenToWorld(sx, sy){
    const { canvas, cam } = this;
    const cx = canvas.width/2, cy = canvas.height/2;
    return {
      x: cam.x + (sx - cx) / (cam.zoom * this.dpr),
      y: cam.y - (sy - cy) / (cam.zoom * this.dpr),
    };
  }

  getTexture(body){
    if (!this.textures.has(body.key)){
      const seed = [...body.key].reduce((s,c)=>s + c.charCodeAt(0), 7);
      this.textures.set(body.key, buildSurfaceTexture(body, seed));
    }
    return this.textures.get(body.key);
  }

  clear(){
    const { ctx, canvas } = this;
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // faint starfield (static, seeded by canvas size only, cheap enough per-frame at low count)
    this.drawStars();
  }

  drawStars(){
    const { ctx, canvas } = this;
    if (!this._starCache || this._starCache.w !== canvas.width || this._starCache.h !== canvas.height){
      const rnd = mulberry32(42);
      const stars = [];
      const n = 260;
      for (let i = 0; i < n; i++){
        stars.push({ x: rnd()*canvas.width, y: rnd()*canvas.height, r: rnd()*1.4+0.2, a: rnd()*0.6+0.15 });
      }
      this._starCache = { w: canvas.width, h: canvas.height, stars };
    }
    ctx.save();
    for (const s of this._starCache.stars){
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#cfd6e6';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  drawOrbitPath(points, color, alpha=0.35){
    const { ctx } = this;
    ctx.beginPath();
    points.forEach((p, i) => {
      const { sx, sy } = this.worldToScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1 * this.dpr;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawTrajectory(points, color, alpha=0.8, width=1.6){
    const { ctx } = this;
    ctx.beginPath();
    points.forEach((p, i) => {
      const { sx, sy } = this.worldToScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width * this.dpr;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Draw a body as a disk; automatically switches to a detailed
  // surface+atmosphere rendering once the true angular scale exceeds the
  // symbolic minimum size (i.e. when the user has zoomed in close).
  drawBody(body, worldPos, jd, spinDeg, minPx=6){
    const { ctx } = this;
    const { sx, sy } = this.worldToScreen(worldPos.x, worldPos.y);
    const radiusAU = body.radiusKm / AU_KM;
    const truePx = radiusAU * this.cam.zoom * this.dpr;
    const px = Math.max(minPx * this.dpr, truePx);
    const detailed = truePx > 34 * this.dpr;

    if (body.key === 'sun'){
      const glow = ctx.createRadialGradient(sx, sy, px*0.2, sx, sy, px*3.2);
      glow.addColorStop(0, 'rgba(255,210,120,0.55)');
      glow.addColorStop(1, 'rgba(255,210,120,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(sx, sy, px*3.2, 0, Math.PI*2); ctx.fill();
    }

    if (detailed){
      const atmo = ATMO[body.key];
      if (atmo){
        const outer = px * (1 + atmo.thickness);
        const g = ctx.createRadialGradient(sx, sy, px*0.96, sx, sy, outer);
        g.addColorStop(0, `rgba(${atmo.color},0.55)`);
        g.addColorStop(1, `rgba(${atmo.color},0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(sx, sy, outer, 0, Math.PI*2); ctx.fill();
      }
      const tex = this.getTexture(body);
      ctx.save();
      ctx.beginPath(); ctx.arc(sx, sy, px, 0, Math.PI*2); ctx.clip();
      ctx.translate(sx, sy);
      ctx.rotate(spinDeg * Math.PI/180);
      ctx.drawImage(tex, -px, -px, px*2, px*2);
      ctx.restore();
      // terminator shading for a spherical feel
      const shade = ctx.createRadialGradient(sx-px*0.35, sy-px*0.35, px*0.1, sx, sy, px*1.1);
      shade.addColorStop(0, 'rgba(255,255,255,0)');
      shade.addColorStop(1, 'rgba(0,0,0,0.45)');
      ctx.fillStyle = shade;
      ctx.beginPath(); ctx.arc(sx, sy, px, 0, Math.PI*2); ctx.fill();
    } else {
      ctx.beginPath();
      ctx.fillStyle = body.color;
      ctx.arc(sx, sy, px, 0, Math.PI*2);
      ctx.fill();
      if (body.key !== 'sun'){
        // tiny spin tick to convey rotation even at symbolic scale
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(spinDeg * Math.PI/180);
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = Math.max(1, px*0.18);
        ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(px*0.85, 0); ctx.stroke();
        ctx.restore();
      }
    }
    return { sx, sy, px };
  }

  drawLabel(text, sx, sy, px, color='#eef1f7'){
    const { ctx } = this;
    ctx.font = `${11 * this.dpr}px -apple-system, sans-serif`;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.fillText(text, sx + px + 6*this.dpr, sy + 4*this.dpr);
    ctx.globalAlpha = 1;
  }

  drawMarker(sx, sy, color){
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(sx, sy, 5*this.dpr, 0, Math.PI*2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5*this.dpr;
    ctx.stroke();
  }
}
