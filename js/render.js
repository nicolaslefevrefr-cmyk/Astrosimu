import { AU_KM } from './orbitalData.js';

function mulberry32(seed){
  return function(){
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

// All camera / drawing math below operates in CSS pixels. The canvas
// backing store is scaled up by devicePixelRatio for sharpness, but a
// single ctx transform at the start of each frame makes 1 unit = 1 CSS
// pixel for every subsequent drawing call, so geometry and hit-testing
// never have to think about dpr.
export class Renderer{
  constructor(canvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    this.cam = { x:0, y:0, zoom:90 }; // AU-centered, CSS px per AU
    this.safe = { top:0, bottom:0, left:0, right:0 };
    this.textures = new Map();
    this.resize();
  }

  resize(){
    const { canvas } = this;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = Math.round(w * this.dpr);
    canvas.height = Math.round(h * this.dpr);
  }

  setSafeArea(rect){ this.safe = rect; }

  get centerCSS(){
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    const s = this.safe;
    return {
      cx: s.left + (w - s.left - s.right) / 2,
      cy: s.top + (h - s.top - s.bottom) / 2,
    };
  }

  worldToScreen(x, y){
    const { cx, cy } = this.centerCSS;
    const { cam } = this;
    return { sx: cx + (x - cam.x) * cam.zoom, sy: cy - (y - cam.y) * cam.zoom };
  }

  screenToWorld(sx, sy){
    const { cx, cy } = this.centerCSS;
    const { cam } = this;
    return { x: cam.x + (sx - cx) / cam.zoom, y: cam.y - (sy - cy) / cam.zoom };
  }

  getTexture(body){
    if (!this.textures.has(body.key)){
      const seed = [...body.key].reduce((s,c)=>s + c.charCodeAt(0), 7);
      this.textures.set(body.key, buildSurfaceTexture(body, seed));
    }
    return this.textures.get(body.key);
  }

  beginFrame(){
    const { ctx, canvas, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    ctx.fillStyle = '#05070d';
    ctx.fillRect(0, 0, w, h);
    this.drawStars();
  }

  drawStars(){
    const { ctx, canvas } = this;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!this._starCache || this._starCache.w !== w || this._starCache.h !== h){
      const rnd = mulberry32(42);
      const stars = [];
      for (let i = 0; i < 260; i++){
        stars.push({ x: rnd()*w, y: rnd()*h, r: rnd()*1.4+0.2, a: rnd()*0.6+0.15 });
      }
      this._starCache = { w, h, stars };
    }
    ctx.save();
    for (const s of this._starCache.stars){
      ctx.globalAlpha = s.a;
      ctx.fillStyle = '#cfd6e6';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
  }

  drawOrbitPath(points, color, alpha=0.28){
    const { ctx } = this;
    ctx.beginPath();
    points.forEach((p, i) => {
      const { sx, sy } = this.worldToScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawTrajectory(points, color, alpha=0.8, width=1.5){
    const { ctx } = this;
    ctx.beginPath();
    points.forEach((p, i) => {
      const { sx, sy } = this.worldToScreen(p.x, p.y);
      if (i === 0) ctx.moveTo(sx, sy); else ctx.lineTo(sx, sy);
    });
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawBody(body, worldPos, jd, spinDeg, minPx=6){
    const { ctx } = this;
    const { sx, sy } = this.worldToScreen(worldPos.x, worldPos.y);
    const radiusAU = body.radiusKm / AU_KM;
    const truePx = radiusAU * this.cam.zoom;
    const px = Math.max(minPx, truePx);
    const detailed = truePx > 34;

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

  // Label with a small pill background so it stays legible over orbit
  // lines; also doubles as the visual anchor for tap-selection hit tests.
  drawLabel(text, sx, sy, px, color='#eef1f7', highlight=false){
    const { ctx } = this;
    const fontSize = 11;
    ctx.font = `${highlight ? '700' : '500'} ${fontSize}px -apple-system, sans-serif`;
    const tw = ctx.measureText(text).width;
    const lx = sx + px + 8, ly = sy;
    ctx.fillStyle = 'rgba(5,7,13,0.55)';
    ctx.fillRect(lx - 3, ly - fontSize*0.5 - 3, tw + 6, fontSize + 6);
    ctx.fillStyle = highlight ? color : '#eef1f7';
    ctx.globalAlpha = 0.95;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx, ly + 1);
    ctx.globalAlpha = 1;
  }

  drawMarker(sx, sy, color){
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(sx, sy, 5, 0, Math.PI*2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  drawSelectionRing(sx, sy, px, color){
    const { ctx } = this;
    ctx.beginPath();
    ctx.arc(sx, sy, px + 6, 0, Math.PI*2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3,3]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  drawCrosshair(sx, sy, color='#6fe3d6'){
    const { ctx } = this;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.moveTo(sx-10, sy); ctx.lineTo(sx+10, sy);
    ctx.moveTo(sx, sy-10); ctx.lineTo(sx, sy+10);
    ctx.stroke();
    ctx.beginPath(); ctx.arc(sx, sy, 4, 0, Math.PI*2); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawArrow(sx1, sy1, sx2, sy2, color='#ffb454'){
    const { ctx } = this;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
    const ang = Math.atan2(sy2-sy1, sx2-sx1);
    const head = 9;
    ctx.beginPath();
    ctx.moveTo(sx2, sy2);
    ctx.lineTo(sx2 - head*Math.cos(ang-0.4), sy2 - head*Math.sin(ang-0.4));
    ctx.lineTo(sx2 - head*Math.cos(ang+0.4), sy2 - head*Math.sin(ang+0.4));
    ctx.closePath(); ctx.fill();
  }
}
