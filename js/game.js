// Mossy Hollow — a small MapleStory-style side-scroller with two maps joined by portals.
// Art: BlueWizard, Slimes, Plant Animations, Mossy Tileset, Cave and Vegetation packs
// (pre-sized into assets/game by the asset converter).
(() => {
'use strict';

const W = 1280, H = 720;
const GRAV = 1800;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const QS = new URLSearchParams(location.search);
const SHOT = QS.get('shot') === '1';
const META = window.ASSET_META;

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  canvas.style.width = (W * s) + 'px';
  canvas.style.height = (H * s) + 'px';
}
addEventListener('resize', fit);
fit();

// ---------- helpers ----------
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1337);
const rr = (a, b) => a + rand() * (b - a);
const ri = (a, b) => Math.floor(rr(a, b + 1));
const pick = a => a[Math.floor(rand() * a.length)];
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - (1 - t) * (1 - t);

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function rrect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function star(g, x, y, n, ro, ri_, rot) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + i / (n * 2) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 ? ri_ : ro;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}

// ---------- assets ----------
const IMG = {};
function loadImage(name) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Could not load assets/game/' + name));
    im.src = 'assets/game/' + name;
  });
}
function loadAll() {
  const names = new Set();
  for (const k in META) {
    const m = META[k];
    if (Array.isArray(m)) m.forEach(p => names.add(p.src));
    else for (const a in m.anims) names.add(m.anims[a].src);
  }
  return Promise.all([...names].map(n => loadImage(n).then(im => { IMG[n] = im; })));
}
function piece(set, i) {
  const p = META[set][i];
  return { img: IMG[p.src], w: p.w, h: p.h };
}
// Draw one frame of an animation strip with its anchor (feet) at x,y.
function drawAnim(g, key, anim, frame, x, y, dir, scale) {
  const m = META[key], a = m.anims[anim];
  const f = ((Math.floor(frame) % a.n) + a.n) % a.n;
  const s = scale || 1;
  g.save();
  g.translate(Math.round(x), Math.round(y));
  g.scale(dir < 0 ? -s : s, s);
  g.drawImage(IMG[a.src], f * m.fw, 0, m.fw, m.fh, -m.ax, -m.ay, m.fw, m.fh);
  g.restore();
}
// Draw a piece with its bottom-centre at x,y.
function drawPiece(g, set, i, x, y, s, flip) {
  const p = piece(set, i);
  g.save();
  g.translate(x, y);
  if (flip) g.scale(-1, 1);
  g.drawImage(p.img, -p.w * s / 2, -p.h * s, p.w * s, p.h * s);
  g.restore();
}
// Draw a piece hanging from its top-centre at x,y (stalactites, hanging plants).
function drawPieceTop(g, set, i, x, y, s, flip) {
  const p = piece(set, i);
  g.save();
  g.translate(x, y);
  if (flip) g.scale(-1, 1);
  g.drawImage(p.img, -p.w * s / 2, 0, p.w * s, p.h * s);
  g.restore();
}
// The packs fill their shapes with pure black; lift it to a tinted dark so it matches each map's mood.
function liftBlacks(c, color) {
  const t = makeCanvas(c.width, c.height), tg = t.getContext('2d');
  tg.fillStyle = color;
  tg.fillRect(0, 0, t.width, t.height);
  tg.globalCompositeOperation = 'destination-in';
  tg.drawImage(c, 0, 0);
  const g = c.getContext('2d');
  g.globalCompositeOperation = 'lighten';
  g.drawImage(t, 0, 0);
  g.globalCompositeOperation = 'source-over';
}

// ---------- current map (set by loadMap) ----------
let MAP, TH, WORLD_W, SEGS, PLATS, ROPES, PORTALS;
const layerW = f => Math.ceil((WORLD_W - W) * f + W);

function groundAt(x) {
  for (const s of SEGS) if (x >= s.x0 && x < s.x1) return s.y;
  return SEGS[SEGS.length - 1].y;
}
function floorAt(x, y, skip) {
  let f = groundAt(x);
  for (const pl of PLATS) {
    if (pl !== skip && x >= pl.x && x <= pl.x + pl.w && pl.y >= y - 0.5 && pl.y < f) f = pl.y;
  }
  return f;
}
function platUnder(x, y) {
  for (const pl of PLATS) if (x >= pl.x && x <= pl.x + pl.w && Math.abs(pl.y - y) < 1) return pl;
  return null;
}
const keepClear = (x, gap) => ROPES.some(r => Math.abs(r.x - x) < gap) || PORTALS.some(p => Math.abs(p.x - x) < gap + 30);

// ---------- shared builders ----------
function buildLayer(f, baseY, items, fog, fillCol, ceil) {
  const w = layerW(f), c = makeCanvas(w, H), g = c.getContext('2d');
  if (ceil) { g.fillStyle = fillCol; g.fillRect(0, 0, w, ceil.y); }
  for (const it of items) {
    if (it.frond) drawFrond(g, it.i, it.x * w, baseY + (it.dy || 0), it.s, it.sy, it.flip);
    else if (it.top) drawPieceTop(g, it.set, it.i, it.x * w, (ceil ? ceil.y : 0) - 4, it.s, it.flip);
    else drawPiece(g, it.set, it.i, it.x * w, baseY + (it.dy || 0), it.s, it.flip);
  }
  g.fillStyle = fillCol;
  g.fillRect(0, baseY - 2, w, H);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = fog;
  g.fillRect(0, 0, w, H);
  g.globalCompositeOperation = 'source-over';
  return { c, f };
}
function scatter(n, opts, extra) {
  const out = [];
  for (let k = 0; k < n; k++) {
    const o = pick(opts);
    out.push(Object.assign({ set: o[0], i: o[1], s: rr(o[2], o[3]), x: (k + rr(0.1, 0.9)) / n, flip: rand() < 0.5, dy: o[4] || 0 }, extra));
  }
  return out;
}
function backdrop(top, bottom, gx, gy, glowCols) {
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const base = g.createLinearGradient(0, 0, 0, H);
  base.addColorStop(0, top); base.addColorStop(1, bottom);
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const glow = g.createRadialGradient(gx, gy, 20, gx, gy + 50, 720);
  glow.addColorStop(0, glowCols[0]); glow.addColorStop(0.3, glowCols[1]); glow.addColorStop(1, glowCols[2]);
  g.fillStyle = glow; g.fillRect(0, 0, W, H);
  return c;
}
function foreground(draw, tint) {
  const f = 1.25, w = Math.ceil((WORLD_W - W) * f + W);
  const c = makeCanvas(w, H), g = c.getContext('2d');
  for (let x = rr(0, 200); x < w; x += rr(320, 620)) draw(g, x);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = tint;
  g.fillRect(0, 0, w, H);
  return { c, f };
}
// Ground: a block piece sliced into left edge / repeating middle / right edge.
function drawGroundSeg(g, s, leftEdge, rightEdge, gp) {
  const t = piece(gp.set, gp.i), k = gp.scale;
  const top = s.y - gp.surf, L = gp.L, R = gp.R, M = t.w - L - R;
  const dl = L * k, dr = R * k, dm = M * k, dh = t.h * k;
  const x0 = Math.max(-40, s.x0), x1 = Math.min(WORLD_W + 40, s.x1);
  g.save();
  g.beginPath();
  g.rect(leftEdge ? x0 - 30 : x0, 0, (x1 - x0) + (leftEdge ? 30 : 0) + (rightEdge ? 30 : 0), H);
  g.clip();
  g.fillStyle = gp.fill;
  g.fillRect(x0, top + dh * 0.5, x1 - x0, H);
  let n = 0;
  for (let x = x0 - 40; x < x1 + 40; x += dm, n++) {
    g.save();
    if (n % 2) { g.translate(x + dm, top); g.scale(-1, 1); } else g.translate(x, top);
    g.drawImage(t.img, L, 0, M, t.h, 0, 0, dm + 1, dh);
    g.restore();
  }
  if (leftEdge) g.drawImage(t.img, 0, 0, L, t.h, x0 - dl * 0.22, top, dl, dh);
  if (rightEdge) g.drawImage(t.img, t.w - R, 0, R, t.h, x1 - dr * 0.78, top, dr, dh);
  g.restore();
}
function drawGround(g, gp) {
  const order = SEGS.map((s, i) => i).sort((a, b) => SEGS[b].y - SEGS[a].y);
  for (const i of order) {
    const s = SEGS[i], prev = SEGS[i - 1], next = SEGS[i + 1];
    drawGroundSeg(g, s, !!prev && prev.y > s.y, !!next && next.y > s.y, gp);
  }
}
function drawPlatforms(g) {
  for (const p of PLATS) {
    const pc = piece(p.set, p.piece);
    g.drawImage(pc.img, p.x - p.side * p.s, p.y - p.surf * p.s, p.dw, p.dh);
  }
}
function drawRope(g, r, cols, leaves) {
  g.lineCap = 'round';
  const pts = [];
  for (let y = r.top - 6; y <= r.bottom; y += 6) pts.push([r.x + Math.sin(y * 0.09) * 2.5, y]);
  const stroke = (w, col, dx) => {
    g.strokeStyle = col; g.lineWidth = w;
    g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x + dx, y) : g.moveTo(x + dx, y)); g.stroke();
  };
  stroke(8, cols[0], 0);
  stroke(5, cols[1], 0);
  stroke(1.5, cols[2], -1.5);
  if (!leaves) {
    g.strokeStyle = cols[0]; g.lineWidth = 1.5;
    for (let y = r.top; y < r.bottom - 6; y += 8) { g.beginPath(); g.moveTo(r.x - 3, y); g.lineTo(r.x + 3, y + 4); g.stroke(); }
    return;
  }
  for (let y = r.top + 12; y < r.bottom - 10; y += rr(18, 30)) {
    const d = rand() < 0.5 ? -1 : 1;
    g.fillStyle = pick(leaves);
    g.strokeStyle = cols[0]; g.lineWidth = 1.2;
    g.beginPath(); g.ellipse(r.x + d * 7, y, 6, 3, d * 0.5, 0, 7); g.fill(); g.stroke();
  }
}

// ---------- map 1: Mossy Hollow ----------
// Hanging moss strands drawn upside down make tall seaweed-like fronds.
function drawFrond(g, i, x, y, s, sy, flip) {
  const p = piece('hanging', i);
  g.save();
  g.translate(x, y);
  g.scale(flip ? -1 : 1, -sy);
  g.drawImage(p.img, -p.w * s / 2, -6, p.w * s, p.h * s);
  g.restore();
}
function fronds(n, sMin, sMax, syMin, syMax) {
  const out = [];
  for (let k = 0; k < n; k++) out.push({ frond: true, i: pick([6, 7]), s: rr(sMin, sMax), sy: rr(syMin, syMax), x: (k + rr(0.1, 0.9)) / n, flip: rand() < 0.5, dy: rr(0, 30) });
  return out;
}
const MOSS_NAVY = '#0b2532';
function buildMossy() {
  const T = {};
  T.SKY = backdrop('#0f3d4a', '#0a2733', W * 0.6, 110, ['rgba(178,236,226,0.95)', 'rgba(96,180,182,0.7)', 'rgba(30,90,105,0)']);
  T.FAR = buildLayer(0.12, 640, [
    ...fronds(10, 0.9, 1.3, 1.2, 1.6),
    ...scatter(6, [['bgdeco', 0, 0.45, 0.6, 80], ['bgdeco', 1, 0.5, 0.7, 40]]),
  ], 'rgba(108,192,188,0.86)', MOSS_NAVY);
  T.MID = buildLayer(0.35, 650, [
    ...fronds(8, 0.8, 1.1, 1.0, 1.3),
    ...scatter(5, [['deco', 2, 0.9, 1.2, 10], ['deco', 1, 0.8, 1.0, 10], ['bgdeco', 1, 0.45, 0.55, 40]]),
    ...scatter(5, [['bgdeco', 2, 0.6, 0.8], ['bgdeco', 5, 0.7, 0.9], ['hills', 0, 1, 1.2]]),
  ], 'rgba(52,138,146,0.68)', MOSS_NAVY);
  T.NEAR = buildLayer(0.6, 680, [
    ...fronds(10, 0.7, 1.0, 0.8, 1.1),
    ...scatter(10, [['hills', 0, 1.1, 1.4], ['hills', 5, 1.1, 1.4], ['hills', 6, 1.1, 1.3], ['deco', 2, 0.8, 1.0, 20]]),
  ], 'rgba(26,82,96,0.55)', MOSS_NAVY);
  T.FG = foreground((g, x) => {
    for (let k = 0; k < ri(1, 3); k++) drawPieceTop(g, 'hanging', pick([0, 1, 2, 3, 4]), x + rr(-40, 40), -rr(10, 80), rr(0.6, 0.9), rand() < 0.5);
  }, 'rgba(5,22,32,0.88)');

  const c = makeCanvas(WORLD_W, H), g = c.getContext('2d');
  // tall decorations standing behind the ground edge (their bases sink into the moss)
  for (const s of SEGS) {
    const x0 = Math.max(40, s.x0 + 60), x1 = Math.min(WORLD_W - 40, s.x1 - 60);
    for (let x = x0; x < x1; x += rr(150, 300)) {
      if (keepClear(x, 50)) continue;
      const r = rand();
      if (r < 0.3) drawPiece(g, 'deco', pick([9, 10, 11, 12]), x, s.y + 10, rr(0.55, 0.75), rand() < 0.5);
      else if (r < 0.55) drawPiece(g, 'deco', pick([0, 1, 2]), x, s.y + 12, rr(0.35, 0.5), rand() < 0.5);
      else if (r < 0.75) drawPiece(g, 'deco', pick([3, 6, 7, 8]), x, s.y + 14, rr(0.4, 0.55), rand() < 0.5);
    }
  }
  drawGround(g, { set: 'tiles', i: 0, scale: 1, L: 100, R: 100, surf: 18, fill: '#000' });
  for (const s of SEGS) {
    const x0 = Math.max(20, s.x0 + 40), x1 = Math.min(WORLD_W - 20, s.x1 - 40);
    for (let x = x0; x < x1; x += rr(60, 140)) {
      if (keepClear(x, 50)) continue;
      drawPiece(g, 'deco', pick([13, 14, 22, 24, 25, 26, 30, 21, 23]), x, s.y + 6, rr(0.4, 0.6), rand() < 0.5);
    }
  }
  // plants hanging under the platforms, kept clear of the ground below
  for (const p of PLATS) {
    const n = Math.max(1, Math.floor(p.w / 90));
    for (let k = 0; k < n; k++) {
      const i = pick([0, 1, 2, 3, 6, 7]), hx = p.x + p.w * (k + rr(0.25, 0.75)) / n, top = p.y + p.dh * 0.4;
      const s = Math.min(rr(0.32, 0.45), (groundAt(hx) - top - 20) / META.hanging[i].h);
      if (s > 0.15) drawPieceTop(g, 'hanging', i, hx, top, s, rand() < 0.5);
    }
  }
  drawPlatforms(g);
  for (const r of ROPES) drawRope(g, r, ['#0d1a0e', '#2f6a34', '#7cc46a'], ['#4f9a48', '#6cbf5a', '#3c7d3a']);
  liftBlacks(c, MOSS_NAVY);
  T.TERRAIN = c;

  T.animBack = []; T.animFront = [];
  for (const s of SEGS) {
    const x0 = Math.max(40, s.x0 + 50), x1 = Math.min(WORLD_W - 40, s.x1 - 50);
    for (let x = x0; x < x1; x += rr(170, 320)) {
      if (keepClear(x, 60)) continue;
      T.animBack.push({ key: pick(['plant1', 'plant2', 'plant3', 'plant4', 'plant5', 'plant6', 'plant7', 'plantWind', 'blueFlower1', 'blueFlower1', 'blueFlower2', 'blueFlower2']), x, y: s.y + 8, s: rr(0.55, 0.75), t: rr(0, 5), flip: rand() < 0.5 ? -1 : 1 });
    }
    for (let x = x0 + 80; x < x1; x += rr(380, 640)) {
      if (keepClear(x, 60)) continue;
      T.animFront.push({ key: pick(['plant1', 'plant4', 'plant7']), x, y: s.y + 26, s: rr(0.4, 0.5), t: rr(0, 5), flip: rand() < 0.5 ? -1 : 1 });
    }
  }
  return T;
}

// ---------- map 2: Ember Cave ----------
const CAVE_DARK = '#1e1517';
function buildCave() {
  const T = {};
  T.SKY = backdrop('#2a1c22', '#120c0f', W * 0.45, 140, ['rgba(236,170,110,0.75)', 'rgba(150,90,70,0.45)', 'rgba(60,30,30,0)']);
  const stalactites = [['caveSmall', 4, 0.9, 1.3], ['caveSmall', 5, 0.9, 1.3], ['caveSmall', 22, 1, 1.4], ['caveCombo', 1, 0.7, 1], ['caveSmall', 18, 1, 1.4]];
  T.FAR = buildLayer(0.12, 640, [
    ...scatter(9, [['caveCombo', 12, 1, 1.3], ['caveCombo', 13, 1, 1.3], ['caveCombo', 14, 1, 1.2], ['caveCombo', 15, 1, 1.2], ['caveBig', 4, 1, 1.2, 20]]),
    ...scatter(6, [['caveBig', 0, 0.9, 1.1], ['caveBig', 7, 0.9, 1.1], ['caveCombo', 9, 1, 1.2]]),
    ...scatter(10, stalactites, { top: true }),
  ], 'rgba(132,92,96,0.86)', CAVE_DARK, { y: 30 });
  T.MID = buildLayer(0.35, 655, [
    ...scatter(7, [['caveSmall', 32, 1, 1.3], ['caveSmall', 29, 1, 1.3], ['caveCombo', 13, 0.8, 1], ['caveBig', 3, 0.9, 1.1]]),
    ...scatter(7, [['caveCombo', 0, 0.9, 1.1], ['caveCombo', 5, 0.9, 1.1], ['caveCombo', 10, 0.9, 1.1], ['caveBig', 8, 0.8, 1]]),
    ...scatter(8, stalactites, { top: true }),
  ], 'rgba(84,56,62,0.7)', CAVE_DARK, { y: 14 });
  T.NEAR = buildLayer(0.6, 690, [
    ...scatter(10, [['caveCombo', 9, 1, 1.2], ['caveCombo', 10, 1, 1.2], ['caveBig', 0, 0.8, 1], ['caveBig', 7, 0.8, 1], ['caveSmall', 32, 1, 1.2, 20]]),
  ], 'rgba(44,28,34,0.55)', CAVE_DARK);
  T.FG = foreground((g, x) => {
    for (let k = 0; k < ri(1, 2); k++) drawPieceTop(g, 'caveSmall', pick([4, 5, 18, 19, 22]), x + rr(-50, 50), -rr(10, 40), rr(0.9, 1.4), rand() < 0.5);
  }, 'rgba(12,7,9,0.9)');

  const c = makeCanvas(WORLD_W, H), g = c.getContext('2d');
  for (const s of SEGS) {
    const x0 = Math.max(40, s.x0 + 60), x1 = Math.min(WORLD_W - 40, s.x1 - 60);
    for (let x = x0; x < x1; x += rr(140, 280)) {
      if (keepClear(x, 50)) continue;
      const r = rand();
      if (r < 0.35) drawPiece(g, 'caveSmall', pick([29, 31, 32, 35]), x, s.y + 24, rr(0.55, 0.85), rand() < 0.5);
      else if (r < 0.6) drawPiece(g, 'caveBig', pick([1, 2, 5, 6]), x, s.y + 24, rr(0.45, 0.65), rand() < 0.5);
      else if (r < 0.8) drawPiece(g, 'caveCombo', pick([2, 3, 4, 6, 7]), x, s.y + 26, rr(0.5, 0.7), rand() < 0.5);
    }
  }
  drawGround(g, { set: 'cavePlat', i: 3, scale: 1.3, L: 40, R: 40, surf: 8, fill: '#000' });
  for (const s of SEGS) {
    const x0 = Math.max(20, s.x0 + 40), x1 = Math.min(WORLD_W - 20, s.x1 - 40);
    for (let x = x0; x < x1; x += rr(90, 200)) {
      if (keepClear(x, 50)) continue;
      drawPiece(g, 'caveSmall', pick([0, 1, 6, 7, 8, 9, 10, 11, 12, 13, 14]), x, s.y + 8, rr(0.3, 0.5), rand() < 0.5);
    }
  }
  // stalactites under the platforms, kept clear of the ground below
  for (const p of PLATS) {
    const n = Math.max(1, Math.floor(p.w / 80));
    for (let k = 0; k < n; k++) {
      const i = pick([4, 5, 18, 19, 22]), hx = p.x + p.w * (k + rr(0.25, 0.75)) / n, top = p.y + p.dh * 0.55;
      const s = Math.min(rr(0.4, 0.6), (groundAt(hx) - top - 20) / META.caveSmall[i].h);
      if (s > 0.15) drawPieceTop(g, 'caveSmall', i, hx, top, s, rand() < 0.5);
    }
  }
  drawPlatforms(g);
  for (const r of ROPES) drawRope(g, r, ['#1e120c', '#8a6038', '#d0a46a']);
  liftBlacks(c, CAVE_DARK);
  T.TERRAIN = c;

  T.animBack = []; T.animFront = [];
  for (const s of SEGS) {
    const x0 = Math.max(40, s.x0 + 50), x1 = Math.min(WORLD_W - 40, s.x1 - 50);
    for (let x = x0; x < x1; x += rr(140, 280)) {
      if (keepClear(x, 60)) continue;
      T.animBack.push({ key: pick(['vegGrass2', 'vegGrass3', 'vegGrass4', 'vegGrass5', 'vegGroup', 'vegCurl', 'vegGrass5', 'blueFlower1']), x, y: s.y + 8, s: rr(0.7, 0.95), t: rr(0, 5), flip: rand() < 0.5 ? -1 : 1 });
    }
    for (let x = x0 + 80; x < x1; x += rr(360, 600)) {
      if (keepClear(x, 60)) continue;
      T.animFront.push({ key: pick(['vegGroup', 'vegGrass2', 'vegCurl']), x, y: s.y + 22, s: rr(0.55, 0.7), t: rr(0, 5), flip: rand() < 0.5 ? -1 : 1 });
    }
  }
  return T;
}

// ---------- map definitions ----------
const MAPS = {
  mossy: {
    name: 'Mossy Hollow', sub: 'The Overgrown Path', width: 3200, build: buildMossy,
    segs: [{ x0: -200, x1: 820, y: 550 }, { x0: 820, x1: 1420, y: 600 }, { x0: 1420, x1: 2250, y: 545 }, { x0: 2250, x1: 3400, y: 585 }],
    plats: [
      { x: 300, y: 440, set: 'floating', piece: 1, s: 0.85 }, { x: 980, y: 490, set: 'floating', piece: 4, s: 0.7 },
      { x: 1150, y: 380, set: 'floating', piece: 1, s: 0.65 }, { x: 1700, y: 435, set: 'floating', piece: 6, s: 0.65 },
      { x: 2500, y: 475, set: 'floating', piece: 4, s: 0.8 }, { x: 2760, y: 365, set: 'floating', piece: 1, s: 0.65 },
    ],
    platSurf: 18, platSide: 16,
    ropes: [{ x: 1250, top: 380, bottom: 600 }, { x: 2620, top: 475, bottom: 585 }],
    portals: [{ x: 3090, to: 'cave', toX: 190, label: 'Ember Cave' }],
    mobs: [
      ['green', 380, 780], ['orange', 450, 800], ['plant', 860, 1380], ['green', 900, 1400], ['green', 'p1'],
      ['orange', 1480, 2200], ['orange', 1480, 2200], ['green', 1480, 2200], ['plant', 'p3'],
      ['green', 2300, 3000], ['plant', 2300, 3000], ['orange', 2300, 3000], ['green', 'p4'],
    ],
    theme: {
      head: ['#4a8a6a', '#244a3a'], haze: ['rgba(110,200,200,0.22)', 'rgba(70,160,170,0.2)'], shaft: '190,255,240',
      spore: ['240,255,255', '190,245,245', '120,220,230'], sporeRise: 1, grade: 'rgba(20,100,112,0.04)', vignette: 'rgba(3,14,22,0.6)',
    },
    shot: { px: 1590, group: 1480, xs: [1690, 1775, 1850] },
  },
  cave: {
    name: 'Ember Cave', sub: 'The Hollow Below', width: 3000, build: buildCave,
    segs: [{ x0: -200, x1: 700, y: 560 }, { x0: 700, x1: 1300, y: 520 }, { x0: 1300, x1: 1900, y: 600 }, { x0: 1900, x1: 2500, y: 540 }, { x0: 2500, x1: 3200, y: 580 }],
    plats: [
      { x: 350, y: 450, set: 'caveFloor', piece: 1, s: 1 }, { x: 880, y: 410, set: 'caveFloor', piece: 12, s: 1 },
      { x: 1420, y: 490, set: 'caveFloor', piece: 2, s: 1 }, { x: 1660, y: 380, set: 'caveFloor', piece: 6, s: 1 },
      { x: 2010, y: 430, set: 'caveFloor', piece: 9, s: 0.9 }, { x: 2640, y: 470, set: 'caveFloor', piece: 7, s: 1 },
    ],
    platSurf: 6, platSide: 6,
    ropes: [{ x: 1720, top: 380, bottom: 600 }, { x: 2700, top: 470, bottom: 580 }],
    portals: [{ x: 110, to: 'mossy', toX: 3000, label: 'Mossy Hollow' }],
    mobs: [
      ['orange', 300, 650], ['plant2', 760, 1250], ['orange', 760, 1250], ['green', 'p1'],
      ['orange', 1350, 1850], ['plant2', 1350, 1850], ['plant2', 'p3'],
      ['orange', 1950, 2450], ['green', 1950, 2450], ['orange', 1950, 2450], ['green', 'p4'],
      ['plant2', 2550, 2900], ['orange', 2550, 2900],
    ],
    theme: {
      head: ['#8a5a3a', '#4a2a1a'], haze: ['rgba(220,150,110,0.16)', 'rgba(160,100,80,0.16)'], shaft: '255,200,140',
      spore: ['255,236,200', '255,180,110', '220,110,50'], sporeRise: 2.2, grade: 'rgba(90,40,20,0.05)', vignette: 'rgba(10,5,4,0.7)',
    },
    shot: { px: 2000, group: 1950, xs: [2100, 2180, 2260] },
  },
};
for (const id in MAPS) {
  const m = MAPS[id];
  for (const p of m.plats) {
    const pc = META[p.set][p.piece];
    p.surf = m.platSurf; p.side = m.platSide;
    p.dw = pc.w * p.s; p.dh = pc.h * p.s;
    p.w = p.dw - 2 * p.side * p.s;
  }
  for (const pt of m.portals) pt.y = m.segs.find(s => pt.x >= s.x0 && pt.x < s.x1).y;
}
const BUILT = {};

// ---------- game state ----------
const SKILLS = {
  attack: { key: 'Z', name: 'Magic Bolt', mp: 0, cd: 0.1, dur: 0.35, hitAt: 0.12 },
  power: { key: 'X', name: 'Arcane Burst', mp: 6, cd: 0.4, dur: 0.5, hitAt: 0.2 },
  blast: { key: 'C', name: 'Frost Nova', mp: 10, cd: 0.8, dur: 0.55, hitAt: 0.22 },
  dash: { key: 'V', name: 'Shadow Dash', mp: 8, cd: 0.9, dur: 0.3, hitAt: 0 },
  roar: { key: 'R', name: 'Magic Roar', mp: 25, cd: 8, dur: 0.7, hitAt: 0.25 },
};
const SKILL_ORDER = ['attack', 'power', 'blast', 'dash', 'roar'];
const DASH_T = 0.26;

const player = {
  name: 'Hero', job: 'Magician',
  x: 160, y: 550, vx: 0, vy: 0, dir: 1, onGround: true, climb: null,
  anim: 0, atk: null, inv: 0, knock: 0, drop: null, dropT: 0, dash: 0, dashHit: null,
  lv: 1, exp: 0, hp: 100, maxHp: 100, mp: 60, maxMp: 60,
  cd: { attack: 0, power: 0, blast: 0, dash: 0, roar: 0 },
};
const expNeed = lv => 15 + lv * lv * 10;

const MOB_TYPES = {
  green: { key: 'slimeGreen', hp: 110, exp: 4, speed: 40, atk: [4, 8], fps: 14 },
  orange: { key: 'slimeOrange', hp: 150, exp: 6, speed: 30, atk: [6, 10], fps: 12 },
  plant: { key: 'plantJump', hp: 130, exp: 5, speed: 65, atk: [5, 9], fps: 14, hop: true },
  plant2: { key: 'plantJump2', hp: 170, exp: 8, speed: 70, atk: [7, 12], fps: 14, hop: true },
  boss: { key: 'slimeOrange', hp: 2400, exp: 80, speed: 55, atk: [14, 20], fps: 9, boss: true, scale: 2.3, name: 'Ember King' },
};
const mobs = [];
function addMob(type, a, b, floorY) {
  const t = MOB_TYPES[type], s = t.scale || 1;
  mobs.push({
    type, range: [a, b], floor: floorY, x: rr(a, b), y: floorY, vx: 0, vy: 0, dir: rand() < 0.5 ? -1 : 1,
    hp: t.hp, maxHp: t.hp, walk: 0, think: rr(0.5, 2), anim: rr(0, 5), flash: 0, hpShow: 0, knock: 0,
    dead: 0, spawn: 0, onGround: true, h: META[t.key].ay * s, scale: s,
  });
  return mobs[mobs.length - 1];
}

// ---------- quest ----------
// Step 0: clear monsters in Mossy Hollow (unseals the portal). Step 1: clear monsters in Ember Cave.
// Step 2: defeat the Ember King. Step 3: victory.
const GOAL = 8;
const quest = { step: 0, kills: 0, start: 0, end: 0 };
let state = 'title';  // 'title' | 'play' | 'win'
let winT = 0;
function spawnBoss() {
  const b = addMob('boss', 1940, 2460, 540);
  b.x = 2300; b.spawn = 1.2; b.dir = -1;
  effects.push({ type: 'arcane', x: b.x, y: b.y - 60, t: 0, dur: 1.2 });
  shake = 0.6;
}
function onMobKilled(m) {
  if (MOB_TYPES[m.type].boss) {
    quest.step = 3; quest.end = time; winT = 0;
    banner = { t: 0, title: 'Ember King defeated!', sub: 'The hollow is safe again' };
    shake = 0.8;
    return;
  }
  const here = MAP === MAPS.mossy ? 0 : 1;
  if (quest.step !== here) return;
  quest.kills++;
  if (quest.kills < GOAL) return;
  quest.kills = 0;
  quest.step++;
  if (quest.step === 1) banner = { t: 0, title: 'The portal is open!', sub: 'Head right to the Ember Cave' };
  else { banner = { t: 0, title: 'The Ember King awakens!', sub: 'Defeat it to save the hollow' }; spawnBoss(); }
}

const effects = [], particles = [], dmgNums = [], bolts = [];
const SPORES = [];
for (let i = 0; i < 45; i++) SPORES.push({ x: rr(0, W), y: rr(0, H - 60), r: rr(1, 2.4), sp: rr(8, 22), ph: rr(0, 6), par: rr(0.3, 0.9) });
for (let i = 0; i < 7; i++) SPORES.push({ x: rr(0, W), y: rr(0, H - 60), r: rr(4, 6.5), sp: rr(4, 10), ph: rr(0, 6), par: rr(0.2, 0.7), big: true });
const cam = { x: 0 };
let time = 0;
let trans = null;   // portal fade: { t, to, toX, done }
let banner = null;  // big centred banner: { t, title?, sub? } (defaults to the map name)
let shake = 0, flash = 0;
const roarQueue = []; // Magic Roar strikes waiting to land: { m, t }

function loadMap(id, spawnX) {
  MAP = MAPS[id];
  WORLD_W = MAP.width; SEGS = MAP.segs; PLATS = MAP.plats; ROPES = MAP.ropes; PORTALS = MAP.portals;
  if (!BUILT[id]) BUILT[id] = MAP.build();
  TH = BUILT[id];
  mobs.length = 0;
  for (const [type, a, b] of MAP.mobs) {
    if (typeof a === 'string') { const p = PLATS[+a.slice(1)]; addMob(type, p.x + 15, p.x + p.w - 15, p.y); }
    else addMob(type, a, b, groundAt((a + b) / 2));
  }
  effects.length = particles.length = dmgNums.length = bolts.length = roarQueue.length = 0;
  if (id === 'cave' && quest.step === 2) spawnBoss();
  const p = player;
  p.x = spawnX; p.y = groundAt(spawnX); p.vx = p.vy = 0;
  p.climb = null; p.atk = null; p.dash = 0; p.onGround = true; p.knock = 0;
  cam.x = clamp(p.x - W / 2, 0, WORLD_W - W);
  banner = { t: 0 };
}

// ---------- input ----------
const keys = {}, pressed = {};
const BLOCK = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space', 'AltLeft', 'AltRight', 'ControlLeft', 'ControlRight', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyR'];
addEventListener('keydown', e => {
  if (!keys[e.code]) pressed[e.code] = true;
  keys[e.code] = true;
  if (BLOCK.includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; if (BLOCK.includes(e.code)) e.preventDefault(); });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
canvas.addEventListener('pointerdown', () => { canvas.focus(); if (state !== 'play') pressed.Enter = true; });

// ---------- combat ----------
function tryAttack(id) {
  const p = player, s = SKILLS[id];
  if (p.atk || p.climb || p.knock > 0 || p.dash > 0 || p.cd[id] > 0) return;
  if (p.mp < s.mp) {
    if (pressed['Key' + s.key]) dmgNums.push({ x: p.x, y: p.y - 110, text: 'Not enough MP', t: 0, kind: 'text' });
    return;
  }
  p.mp -= s.mp;
  p.cd[id] = s.cd;
  p.atk = { id, t: 0, hit: false };
  if (id === 'roar') effects.push({ type: 'cast', t: 0, dur: 0.7, follow: true, dir: p.dir });
  else if (id !== 'dash') effects.push({ type: id === 'blast' ? 'nova' : 'cast', t: 0, dur: id === 'blast' ? 0.6 : 0.35, follow: true, dir: p.dir });
}
function targetsInFront(range, max) {
  const p = player;
  return mobs
    .filter(m => !m.dead && m.spawn <= 0)
    .map(m => ({ m, dx: (m.x - p.x) * p.dir }))
    .filter(o => o.dx > -25 && o.dx < range && Math.abs((o.m.y - o.m.h / 2) - (p.y - 40)) < 70)
    .sort((a, b) => a.dx - b.dx)
    .slice(0, max)
    .map(o => o.m);
}
function doHit(id) {
  const p = player;
  if (id === 'attack') {
    bolts.push({ x: p.x + p.dir * 30, y: p.y - 46, vx: p.dir * 820, dist: 0, trail: [], range: 480, dmg: [18, 30] });
  } else if (id === 'power') {
    const t = targetsInFront(300, 1)[0];
    const ex = t ? t.x : p.x + p.dir * 140, ey = t ? t.y - t.h / 2 : p.y - 40;
    effects.push({ type: 'arcane', x: ex, y: ey, t: 0, dur: 0.55 });
    if (t) { hitMob(t, ri(55, 85), '#c48aff'); sparkBurst(t.x, ey, 12, ['#d6a8ff', '#ffffff', '#8a5aff']); }
  } else if (id === 'blast') {
    for (const m of targetsInFront(230, 6)) hitMob(m, ri(32, 52), '#9fe8ff');
  } else if (id === 'dash') {
    p.dash = DASH_T;
    p.dashHit = new Set();
    p.inv = Math.max(p.inv, DASH_T + 0.1);
  } else if (id === 'roar') {
    // Magic Roar: a shockwave across the whole map; each monster is struck as the wave reaches it
    effects.push({ type: 'roar', x: p.x, y: p.y - 40, t: 0, dur: 1.1 });
    for (const m of mobs) if (!m.dead && m.spawn <= 0) roarQueue.push({ m, t: Math.abs(m.x - p.x) / 1800 });
    shake = 0.55;
    flash = 0.35;
  }
}
function hitMob(m, dmg, color) {
  const boss = MOB_TYPES[m.type].boss;
  let ny = m.y - m.h - 28;
  for (const d of dmgNums) if (d.mob === m && d.t < 0.9) ny = Math.min(ny, dmgY(d) - 38);
  m.hp -= dmg;
  m.flash = 0.12;
  m.hpShow = 3;
  if (!boss) {
    m.knock = 0.22;
    m.vx = player.dir * 170;
    m.walk = 0;
  }
  dmgNums.push({ x: m.x, y: ny, v: dmg, t: 0, kind: 'mob', mob: m });
  effects.push({ type: 'burst', x: m.x, y: m.y - m.h / 2, t: 0, dur: 0.3, color });
  if (m.dead === 0 && m.hp <= 0) {
    m.dead = 0.0001;
    sparkBurst(m.x, m.y - m.h / 2, boss ? 60 : 16, ['#b6f08a', '#ffffff', '#6fd0a0', '#ffd27a']);
    gainExp(MOB_TYPES[m.type].exp);
    onMobKilled(m);
  }
}
function sparkBurst(x, y, n, cols) {
  for (let i = 0; i < n; i++) {
    const a = rand() * Math.PI * 2, sp = rr(100, 300);
    particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 100, t: 0, life: rr(0.5, 0.9), size: rr(3, 6), col: pick(cols) });
  }
}
function gainExp(n) {
  const p = player;
  p.exp += n;
  while (p.exp >= expNeed(p.lv)) {
    p.exp -= expNeed(p.lv);
    p.lv++;
    p.maxHp += 12; p.maxMp += 8;
    p.hp = p.maxHp; p.mp = p.maxMp;
    effects.push({ type: 'levelup', t: 0, dur: 1.6, follow: true, dir: 1 });
    sparkBurst(p.x, p.y - 40, 24, ['#ffe27a', '#ffffff', '#ffb84a']);
  }
}
function hurtPlayer(dmg, fromX) {
  const p = player;
  p.hp -= dmg;
  p.inv = 1.4;
  p.knock = 0.3;
  p.vx = (p.x < fromX ? -1 : 1) * 220;
  p.vy = -330;
  p.onGround = false;
  p.climb = null;
  p.atk = null;
  dmgNums.push({ x: p.x, y: p.y - 105, v: dmg, t: 0, kind: 'hurt' });
  if (p.hp <= 0) {
    // knocked out: wake up at the start of the current map
    p.hp = p.maxHp; p.mp = p.maxMp;
    p.exp = Math.floor(p.exp * 0.9);
    loadMap(MAP === MAPS.mossy ? 'mossy' : 'cave', MAP === MAPS.mossy ? 160 : 190);
    banner = { t: 0, title: 'You were knocked out!', sub: 'Lost 10% EXP' };
  }
}

// ---------- game flow ----------
function startGame() {
  const p = player;
  Object.assign(p, { lv: 1, exp: 0, hp: 100, maxHp: 100, mp: 60, maxMp: 60, inv: 0, dir: 1 });
  for (const k in p.cd) p.cd[k] = 0;
  Object.assign(quest, { step: 0, kills: 0, start: time, end: 0 });
  winT = 0;
  state = 'play';
  loadMap('mossy', 160);
}

// ---------- update ----------
const portalLocked = pt => pt.to === 'cave' && quest.step < 1;
function nearPortal(p) {
  return PORTALS.find(pt => Math.abs(p.x - pt.x) < 34 && Math.abs(p.y - pt.y) < 4);
}
function updatePlayer(dt) {
  const p = player;
  const left = keys.ArrowLeft, right = keys.ArrowRight, up = keys.ArrowUp, down = keys.ArrowDown;
  const jumpP = pressed.Space || pressed.AltLeft || pressed.AltRight;

  for (const k in p.cd) p.cd[k] = Math.max(0, p.cd[k] - dt);
  p.inv = Math.max(0, p.inv - dt);
  p.knock = Math.max(0, p.knock - dt);
  p.dropT = Math.max(0, p.dropT - dt);
  if (p.dropT <= 0) p.drop = null;
  p.mp = Math.min(p.maxMp, p.mp + 2.5 * dt);
  p.hp = Math.min(p.maxHp, p.hp + 1 * dt);

  if (keys.KeyZ || keys.ControlLeft || keys.ControlRight) tryAttack('attack');
  if (keys.KeyX) tryAttack('power');
  if (keys.KeyC) tryAttack('blast');
  if (keys.KeyV) tryAttack('dash');
  if (keys.KeyR) tryAttack('roar');

  if (p.atk) {
    const s = SKILLS[p.atk.id];
    p.atk.t += dt;
    if (!p.atk.hit && p.atk.t >= s.hitAt) { p.atk.hit = true; doHit(p.atk.id); }
    if (p.atk.t >= s.dur) p.atk = null;
  }

  // shadow dash: fast horizontal blink that damages everything it passes through
  if (p.dash > 0) {
    p.dash -= dt;
    p.vy = 0;
    let nx = clamp(p.x + p.dir * 900 * dt, 20, WORLD_W - 20);
    if (p.y > groundAt(nx) + 1) { nx = p.x; p.dash = 0; }
    p.x = nx;
    if (Math.floor(p.dash * 60) % 2 === 0) effects.push({ type: 'ghost', x: p.x, y: p.y, dir: p.dir, t: 0, dur: 0.3, f: Math.floor((1 - p.dash / DASH_T) * 8) });
    for (const m of mobs) {
      if (m.dead || m.spawn > 0 || p.dashHit.has(m)) continue;
      if (Math.abs(m.x - p.x) < 40 && Math.abs((m.y - m.h / 2) - (p.y - 40)) < 60) { p.dashHit.add(m); hitMob(m, ri(40, 60), '#7a6aff'); }
    }
    if (p.dash <= 0) { p.vx = 0; p.onGround = false; }
    return;
  }

  // portals: press Up while standing in one
  if (pressed.ArrowUp && p.onGround && !p.atk && p.knock <= 0) {
    const pt = nearPortal(p);
    if (pt && portalLocked(pt)) {
      dmgNums.push({ x: p.x, y: p.y - 110, text: `Sealed — defeat ${GOAL} monsters first`, t: 0, kind: 'text' });
    } else if (pt) { trans = { t: 0, to: pt.to, toX: pt.toX, done: false }; p.vx = 0; return; }
  }

  // rope / vine climbing
  if (p.climb) {
    const r = p.climb;
    p.vx = 0; p.vy = 0;
    if (up) p.y -= 170 * dt;
    if (down) p.y += 170 * dt;
    if (up || down) p.anim += dt;
    if (p.y <= r.top) { p.y = r.top; p.climb = null; p.onGround = true; }
    else if (p.y >= r.bottom) { p.y = r.bottom; p.climb = null; p.onGround = true; }
    else if (jumpP && (left || right)) { p.climb = null; p.vy = -380; p.vx = (right ? 1 : -1) * 220; p.dir = right ? 1 : -1; }
    return;
  }
  if (!p.atk && p.knock <= 0) {
    for (const r of ROPES) {
      if (Math.abs(p.x - r.x) > 16) continue;
      if (up && p.y > r.top + 4 && p.y <= r.bottom + 2) { p.climb = r; p.x = r.x; p.y = Math.min(p.y - 2, r.bottom - 2); return; }
      if (down && p.onGround && Math.abs(p.y - r.top) < 2) { p.climb = r; p.x = r.x; p.y = r.top + 6; return; }
    }
  }

  const atkLock = p.atk && p.onGround;
  let target = 0;
  if (!atkLock && p.knock <= 0) { if (left) target -= 1; if (right) target += 1; }
  if (target && !p.atk) p.dir = target;
  const spd = 250;
  if (p.knock > 0) { /* keep knockback velocity */ }
  else if (p.onGround) p.vx = target * spd;
  else p.vx += (target * spd - p.vx) * Math.min(1, dt * 3);

  if (jumpP && p.onGround && !atkLock && p.knock <= 0) {
    const pl = platUnder(p.x, p.y);
    if (down && pl) { p.drop = pl; p.dropT = 0.3; p.onGround = false; }
    else { p.vy = -700; p.onGround = false; }
  }

  let nx = clamp(p.x + p.vx * dt, 20, WORLD_W - 20);
  if (p.y > groundAt(nx) + 1) nx = p.x;
  p.x = nx;

  p.vy = Math.min(900, p.vy + GRAV * dt);
  let ny = p.y + p.vy * dt;
  const fl = floorAt(p.x, p.y, p.drop);
  if (ny >= fl) { ny = fl; p.vy = 0; p.onGround = true; } else p.onGround = false;
  p.y = ny;

  if (p.onGround && Math.abs(p.vx) > 10) p.anim += dt;
}

function updateMob(m, dt) {
  const t = MOB_TYPES[m.type];
  if (m.dead) {
    m.dead += dt;
    if (m.dead > 5 && !t.boss) {
      m.dead = 0; m.hp = m.maxHp; m.x = rr(m.range[0], m.range[1]); m.y = m.floor; m.vx = m.vy = 0; m.spawn = 0.6;
    }
    return;
  }
  m.anim += dt;
  m.spawn = Math.max(0, m.spawn - dt);
  m.flash = Math.max(0, m.flash - dt);
  m.hpShow -= dt;
  if (t.boss) {
    // the boss lumbers toward the player and makes heavy hops that shake the ground
    const dx = player.x - m.x;
    m.walk = Math.abs(dx) > 20 ? Math.sign(dx) : 0;
    if (m.walk) m.dir = m.walk;
    m.vx = m.walk * t.speed;
    m.think -= dt;
    if (m.think <= 0 && m.onGround) { m.think = rr(2, 3.5); m.vy = -520; m.landShake = true; }
    if (m.onGround && m.landShake && m.vy === 0) { m.landShake = false; shake = Math.max(shake, 0.3); }
  } else if (m.knock > 0) { m.knock -= dt; m.vx *= 0.9; }
  else {
    m.think -= dt;
    if (m.think <= 0) {
      m.think = rr(1, 3);
      const r = rand();
      m.walk = r < 0.35 ? 0 : r < 0.67 ? -1 : 1;
      if (m.walk) m.dir = m.walk;
    }
    m.vx = m.walk * t.speed;
  }
  m.x += m.vx * dt;
  if (m.x < m.range[0]) { m.x = m.range[0]; m.walk = 1; m.dir = 1; }
  if (m.x > m.range[1]) { m.x = m.range[1]; m.walk = -1; m.dir = -1; }
  if (t.hop && m.onGround && m.walk && m.knock <= 0) m.vy = -300;
  m.vy += 1400 * dt;
  m.y += m.vy * dt;
  if (m.y >= m.floor) { m.y = m.floor; m.vy = 0; m.onGround = true; } else m.onGround = false;

  const p = player;
  if (p.inv <= 0 && m.spawn <= 0 && Math.abs(m.x - p.x) < 30 * m.scale && p.y > m.y - m.h && p.y < m.y + 40) hurtPlayer(ri(t.atk[0], t.atk[1]), m.x);
}

function update(dt) {
  time += dt;
  shake = Math.max(0, shake - dt);
  flash = Math.max(0, flash - dt);
  if (state !== 'play') {
    if (pressed.Enter || pressed.NumpadEnter || pressed.Space) startGame();
  } else if (trans) {
    trans.t += dt;
    if (!trans.done && trans.t >= 0.3) { trans.done = true; loadMap(trans.to, trans.toX); }
    if (trans.t >= 0.6) trans = null;
  } else {
    updatePlayer(dt);
  }
  if (quest.step === 3 && state === 'play') { winT += dt; if (winT > 2.2) state = 'win'; }
  if (banner) { banner.t += dt; if (banner.t > 3) banner = null; }
  for (let i = roarQueue.length - 1; i >= 0; i--) {
    const q = roarQueue[i];
    q.t -= dt;
    if (q.t > 0) continue;
    roarQueue.splice(i, 1);
    if (q.m.dead || q.m.spawn > 0) continue;
    effects.push({ type: 'strike', x: q.m.x, y: q.m.y, t: 0, dur: 0.45 });
    hitMob(q.m, ri(90, 140), '#e6c2ff');
  }
  for (const m of mobs) updateMob(m, dt);

  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.trail.unshift([b.x, b.y]);
    if (b.trail.length > 7) b.trail.pop();
    b.x += b.vx * dt;
    b.dist += Math.abs(b.vx) * dt;
    let done = b.dist > b.range;
    for (const m of mobs) {
      if (done || m.dead || m.spawn > 0) continue;
      if (Math.abs(m.x - b.x) < m.h * 0.6 && b.y > m.y - m.h - 10 && b.y < m.y + 5) {
        hitMob(m, ri(b.dmg[0], b.dmg[1]), '#b89aff');
        done = true;
      }
    }
    if (done) bolts.splice(i, 1);
  }
  for (let i = effects.length - 1; i >= 0; i--) { effects[i].t += dt; if (effects[i].t >= effects[i].dur) effects.splice(i, 1); }
  for (let i = particles.length - 1; i >= 0; i--) {
    const q = particles[i];
    q.t += dt;
    q.vx *= 0.96; q.vy = q.vy * 0.96 + 300 * dt;
    q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.t > q.life) particles.splice(i, 1);
  }
  for (let i = dmgNums.length - 1; i >= 0; i--) { dmgNums[i].t += dt; if (dmgNums[i].t > 1.2) dmgNums.splice(i, 1); }
  for (const d of TH.animBack) d.t += dt;
  for (const d of TH.animFront) d.t += dt;

  const tx = clamp(player.x - W / 2, 0, WORLD_W - W);
  cam.x += (tx - cam.x) * Math.min(1, dt * 8);

  for (const k in pressed) delete pressed[k];
}

// ---------- drawing: characters ----------
function heroFrame(p) {
  if (p.dash > 0) return ['dash3', 1 + Math.floor((1 - p.dash / DASH_T) * 6)];
  if (p.climb) return ['walk', Math.floor(p.anim * 10)];
  if (!p.onGround) {
    const v = p.vy;
    return ['jump', v < -450 ? 1 : v < -150 ? 2 : v < 100 ? 3 : v < 400 ? 5 : 6];
  }
  if (Math.abs(p.vx) > 20 && !p.atk) return ['walk', Math.floor(p.anim * 14)];
  return ['idle', Math.floor(time * 10)];
}
function nameTag(g, x, y, text) {
  g.font = 'bold 12px Arial, sans-serif';
  const tw = g.measureText(text).width + 14;
  g.fillStyle = 'rgba(20,20,30,0.75)';
  rrect(g, x - tw / 2, y + 6, tw, 17, 3); g.fill();
  g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, x, y + 15);
}
function drawPlayer(p) {
  const g = ctx;
  if (p.onGround && !p.climb) {
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath(); g.ellipse(p.x, p.y + 1, 22, 5, 0, 0, 7); g.fill();
  }
  nameTag(g, p.x, p.y, p.name);
  g.save();
  if (p.inv > 0 && p.dash <= 0 && Math.floor(p.inv * 18) % 2) g.globalAlpha = 0.45;
  const [anim, f] = heroFrame(p);
  drawAnim(g, 'wizard', anim, f, p.x, p.y, p.dir);
  g.restore();
}
function drawMob(m) {
  if (m.dead && m.dead > 0.6) return;
  const g = ctx, t = MOB_TYPES[m.type];
  let alpha = 1;
  if (m.dead) alpha = 1 - m.dead / 0.6;
  if (m.spawn > 0) alpha = 1 - m.spawn / 0.6;
  g.save();
  g.fillStyle = `rgba(0,0,0,${0.28 * alpha})`;
  g.beginPath(); g.ellipse(m.x, m.floor + 1, m.h * 0.6, 5 * m.scale, 0, 0, 7); g.fill();
  if (m.hpShow > 0 && !m.dead && !t.boss) {
    g.fillStyle = '#1a1a1a'; g.fillRect(m.x - 26, m.y - m.h - 14, 52, 7);
    g.fillStyle = '#e83a3a'; g.fillRect(m.x - 25, m.y - m.h - 13, 50 * Math.max(0, m.hp / m.maxHp), 5);
  }
  g.globalAlpha = alpha;
  if (m.flash > 0) g.filter = 'brightness(2)';
  else if (t.boss) g.filter = 'saturate(1.6) hue-rotate(-18deg)';
  drawAnim(g, t.key, 'idle', m.anim * t.fps, m.x, m.y, m.dir, m.scale);
  g.restore();
  if (t.boss && !m.dead) nameTag(g, m.x, m.y, t.name);
}
// MapleStory-style portal: a swirling column of light with rising sparkles.
function drawPortal(pt) {
  const g = ctx, x = pt.x, y = pt.y, cy = y - 46;
  g.save();
  if (portalLocked(pt)) {
    // sealed: a dim, still ring of stone-grey light
    g.globalAlpha = 0.6;
    g.strokeStyle = '#8a94a8'; g.lineWidth = 4;
    g.beginPath(); g.ellipse(x, cy, 28, 52, 0, 0, 7); g.stroke();
    g.fillStyle = 'rgba(60,70,90,0.35)';
    g.beginPath(); g.ellipse(x, cy, 26, 50, 0, 0, 7); g.fill();
    g.globalAlpha = 1;
    g.font = 'bold 12px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const text = `Sealed (${quest.kills}/${GOAL})`;
    const tw = g.measureText(text).width + 16;
    g.fillStyle = 'rgba(30,20,20,0.8)';
    rrect(g, x - tw / 2, y - 132, tw, 20, 5); g.fill();
    g.fillStyle = '#ffd0b0'; g.fillText(text, x, y - 122);
    g.restore();
    return;
  }
  const pulse = 1 + Math.sin(time * 4) * 0.05;
  // dark backing so the light reads against bright backgrounds too
  const bk = g.createRadialGradient(x, cy, 10, x, cy, 70);
  bk.addColorStop(0, 'rgba(20,30,90,0.55)'); bk.addColorStop(1, 'rgba(20,30,90,0)');
  g.fillStyle = bk;
  g.beginPath(); g.ellipse(x, cy, 46, 74, 0, 0, 7); g.fill();
  g.globalCompositeOperation = 'lighter';
  const gr = g.createRadialGradient(x, cy, 4, x, cy, 64 * pulse);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.4, 'rgba(120,200,255,0.8)'); gr.addColorStop(1, 'rgba(80,90,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.ellipse(x, cy, 34 * pulse, 62 * pulse, 0, 0, 7); g.fill();
  g.lineWidth = 3.5; g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const a = time * 3 + i * 1.05;
    g.strokeStyle = i % 2 ? 'rgba(150,235,255,1)' : 'rgba(210,170,255,1)';
    g.beginPath(); g.ellipse(x, cy, 26 + i * 2, 54 - i * 3, 0, a, a + 1.7); g.stroke();
  }
  g.fillStyle = 'rgba(140,220,255,0.5)';
  g.beginPath(); g.ellipse(x, y, 36, 7, 0, 0, 7); g.fill();
  for (let k = 0; k < 10; k++) {
    const h = (time * 45 + k * 11) % 100;
    const px = x + Math.sin(k * 2.3 + time * 2) * 18;
    g.fillStyle = `rgba(220,250,255,${1 - h / 100})`;
    g.beginPath(); g.arc(px, y - h, 2.2, 0, 7); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  const near = nearPortal(player);
  if (near === pt && !trans) {
    g.font = 'bold 12px Arial, sans-serif';
    const text = '↑  ' + pt.label;
    const tw = g.measureText(text).width + 16;
    g.fillStyle = 'rgba(10,20,40,0.8)';
    rrect(g, x - tw / 2, y - 132, tw, 20, 5); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, x, y - 122);
  }
  g.restore();
}

// ---------- drawing: effects ----------
function arc(g, cx, cy, r, a0, a1, thick, col, glow, alpha) {
  if (a1 <= a0 + 0.02 || alpha <= 0) return;
  g.save();
  g.globalAlpha = alpha;
  g.shadowColor = glow; g.shadowBlur = 18;
  g.beginPath();
  g.arc(cx, cy, r, a0, a1);
  g.arc(cx + thick * 0.45, cy, r - thick, a1, a0, true);
  g.closePath();
  g.fillStyle = col; g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = 2.5;
  g.beginPath(); g.arc(cx, cy, r - 2, a0 + (a1 - a0) * 0.3, a1); g.stroke();
  g.restore();
}
function glowOrb(g, x, y, r, inner, outer) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, inner); gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
}
function drawEffect(e) {
  const g = ctx, p = player;
  const k = e.t / e.dur;
  g.save();
  if (e.follow) { g.translate(p.x, p.y); g.scale(e.dir, 1); } else g.translate(e.x, e.y);
  if (e.type === 'cast') {
    g.globalAlpha = 1 - k;
    glowOrb(g, 30, -46, 8 + k * 22, 'rgba(190,150,255,0.9)', 'rgba(110,60,255,0)');
    g.strokeStyle = 'rgba(210,180,255,0.9)'; g.lineWidth = 2;
    g.beginPath(); g.ellipse(0, -2, 26 + k * 20, 7 + k * 4, 0, 0, 7); g.stroke();
  } else if (e.type === 'nova') {
    const u = e.t / SKILLS.blast.dur;
    if (u > 0.3) {
      const s = Math.min(1, (u - 0.3) / 0.25), fade = u > 0.55 ? Math.max(0, 1 - (u - 0.55) / 0.5) : 1;
      arc(g, -10, -40, 130, -1.7, lerp(-1.7, 1.0, easeOut(s)), 34, 'rgba(120,220,255,0.75)', '#1aa0ff', fade);
      arc(g, -10, -40, 105, -1.5, lerp(-1.5, 1.0, easeOut(s)), 14, 'rgba(230,250,255,0.9)', '#7fdcff', fade);
      g.globalAlpha = fade;
      g.strokeStyle = '#bff0ff'; g.lineWidth = 3;
      g.beginPath(); g.ellipse(70, -2, 40 + s * 150, 8 + s * 6, 0, 0, 7); g.stroke();
    }
  } else if (e.type === 'arcane') {
    g.globalAlpha = 1 - k;
    glowOrb(g, 0, 0, 20 + k * 50, 'rgba(200,140,255,0.85)', 'rgba(120,60,255,0)');
    g.strokeStyle = '#e6ccff'; g.lineWidth = 4 * (1 - k) + 1; g.shadowColor = '#a060ff'; g.shadowBlur = 16;
    g.beginPath(); g.arc(0, 0, 18 + k * 70, 0, 7); g.stroke();
    g.fillStyle = '#ffffff';
    star(g, 0, 0, 4, 40 * (1 - k) + 6, 6, k * 2);
    g.fill();
  } else if (e.type === 'burst') {
    g.globalAlpha = 1 - k;
    g.strokeStyle = e.color; g.lineWidth = 3; g.shadowColor = e.color; g.shadowBlur = 12;
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + 0.3;
      const r0 = 6 + k * 20, r1 = 18 + k * 40;
      g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.9)';
    star(g, 0, 0, 4, 16 * (1 - k) + 4, 4, k);
    g.fill();
  } else if (e.type === 'roar') {
    // expanding shockwave rings that sweep across the whole map
    for (let i = 0; i < 3; i++) {
      const u = clamp(k * 1.3 - i * 0.15, 0, 1);
      if (u <= 0 || u >= 1) continue;
      g.globalAlpha = 1 - u;
      g.strokeStyle = i === 1 ? '#ffffff' : '#c890ff';
      g.lineWidth = 14 * (1 - u) + 2;
      g.shadowColor = '#9a50ff'; g.shadowBlur = 24;
      g.beginPath(); g.ellipse(0, 0, 40 + u * 1800, 30 + u * 500, 0, 0, 7); g.stroke();
    }
    g.shadowBlur = 0;
    g.globalAlpha = Math.max(0, 1 - k * 1.5);
    glowOrb(g, 0, 0, 60 + k * 120, 'rgba(220,170,255,0.9)', 'rgba(130,60,255,0)');
  } else if (e.type === 'strike') {
    // a beam of light falling onto each monster hit by Magic Roar
    const w = 34 * (1 - k) + 4;
    g.globalAlpha = 1 - k;
    const gr = g.createLinearGradient(0, -e.y, 0, 0);
    gr.addColorStop(0, 'rgba(200,150,255,0)'); gr.addColorStop(0.7, 'rgba(220,180,255,0.85)'); gr.addColorStop(1, 'rgba(255,255,255,1)');
    g.fillStyle = gr;
    g.fillRect(-w / 2, -e.y, w, e.y);
    glowOrb(g, 0, -10, 40 * (1 - k) + 20, 'rgba(230,200,255,0.9)', 'rgba(140,70,255,0)');
  } else if (e.type === 'ghost') {
    g.globalAlpha = 0.45 * (1 - k);
    drawAnim(g, 'wizard', 'dashfx', e.f, 0, 0, e.dir);
  } else if (e.type === 'levelup') {
    g.globalAlpha = k < 0.2 ? k / 0.2 : 1 - (k - 0.2) / 0.8;
    const gr = g.createLinearGradient(0, -260, 0, 0);
    gr.addColorStop(0, 'rgba(255,230,120,0)'); gr.addColorStop(1, 'rgba(255,220,90,0.7)');
    g.fillStyle = gr; g.fillRect(-36, -260, 72, 260);
    g.font = 'bold 34px Impact, "Arial Black", sans-serif';
    g.textAlign = 'center';
    g.lineWidth = 6; g.strokeStyle = '#5a2a00';
    g.strokeText('LEVEL UP!', 0, -130 - k * 40);
    g.fillStyle = '#ffd84a'; g.fillText('LEVEL UP!', 0, -130 - k * 40);
  }
  g.restore();
}
function drawBolt(b) {
  const g = ctx;
  g.save();
  b.trail.forEach(([x, y], i) => {
    g.globalAlpha = 0.45 * (1 - i / b.trail.length);
    g.fillStyle = '#a080ff';
    g.beginPath(); g.arc(x, y, 9 - i, 0, 7); g.fill();
  });
  g.globalAlpha = 1;
  glowOrb(g, b.x, b.y, 16, '#c8b0ff', 'rgba(100,60,255,0)');
  g.restore();
}
function drawParticle(q) {
  const g = ctx;
  g.save();
  g.globalAlpha = Math.max(0, 1 - q.t / q.life);
  g.fillStyle = q.col;
  g.shadowColor = q.col; g.shadowBlur = 8;
  g.beginPath(); g.arc(q.x, q.y, q.size * (1 - q.t / q.life * 0.5), 0, 7); g.fill();
  g.restore();
}
function dmgY(d) { return d.y - Math.max(0, d.t - 0.25) * 50; }
function drawDmg(d) {
  const g = ctx;
  const a = d.t > 0.75 ? 1 - (d.t - 0.75) / 0.45 : 1;
  if (a <= 0) return;
  g.save();
  g.globalAlpha = a;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (d.kind === 'text') {
    g.font = 'bold 14px Arial, sans-serif';
    g.lineWidth = 4; g.strokeStyle = '#000'; g.strokeText(d.text, d.x, d.y - d.t * 30);
    g.fillStyle = '#ffe08a'; g.fillText(d.text, d.x, d.y - d.t * 30);
    g.restore();
    return;
  }
  const s = String(d.v);
  const pop = d.t < 0.12 ? 1.6 - d.t / 0.12 * 0.6 : 1;
  const y = dmgY(d);
  const dw = 25;
  g.font = 'bold 40px Impact, "Arial Black", sans-serif';
  const hurt = d.kind === 'hurt';
  for (let i = 0; i < s.length; i++) {
    const cx = d.x - (s.length * dw) / 2 + dw * (i + 0.5);
    const cy = y + (i % 2 ? 5 : -3);
    g.save();
    g.translate(cx, cy); g.scale(pop, pop);
    g.lineWidth = 7; g.strokeStyle = hurt ? '#2a0a40' : '#4a1000';
    g.strokeText(s[i], 0, 0);
    const gr = g.createLinearGradient(0, -18, 0, 18);
    if (hurt) { gr.addColorStop(0, '#f6dcff'); gr.addColorStop(0.5, '#c27aff'); gr.addColorStop(1, '#7a2ad0'); }
    else { gr.addColorStop(0, '#fffbb0'); gr.addColorStop(0.45, '#ffc21a'); gr.addColorStop(1, '#ff5a10'); }
    g.fillStyle = gr; g.fillText(s[i], 0, 0);
    g.restore();
  }
  g.restore();
}

// ---------- drawing: HUD ----------
function bar(x, y, w, h, frac, c0, c1, label) {
  const g = ctx;
  g.fillStyle = '#0c0d12'; rrect(g, x - 1, y - 1, w + 2, h + 2, 3); g.fill();
  g.fillStyle = '#2a2d36'; g.fillRect(x, y, w, h);
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, c0); gr.addColorStop(1, c1);
  g.fillStyle = gr; g.fillRect(x, y, w * clamp(frac, 0, 1), h);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y, w * clamp(frac, 0, 1), h / 2);
  g.font = 'bold 11px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = '#000'; g.fillText(label, x + 6, y + h / 2 + 1);
  g.fillStyle = '#fff'; g.fillText(label, x + 5, y + h / 2);
}
function drawIcon(id, cx, cy) {
  const g = ctx;
  g.save();
  g.translate(cx, cy);
  g.lineWidth = 1.5; g.strokeStyle = '#1a1030';
  if (id === 'attack') {
    glowOrb(g, 3, 0, 11, '#b89aff', 'rgba(90,50,220,0.2)');
    g.strokeStyle = 'rgba(160,130,255,0.8)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(-14, 0); g.lineTo(-5, 0); g.stroke();
  } else if (id === 'power') {
    star(g, 0, 0, 6, 14, 6, 0.2); g.fillStyle = '#b07aff'; g.fill(); g.stroke();
    star(g, 0, 0, 6, 7, 3, 0.5); g.fillStyle = '#f2e6ff'; g.fill();
  } else if (id === 'blast') {
    g.beginPath(); g.arc(-6, 2, 15, -1.6, 1.0); g.arc(-2, 2, 9, 1.0, -1.6, true); g.closePath();
    g.fillStyle = '#7fdcff'; g.fill(); g.strokeStyle = '#1a5a8a'; g.stroke();
  } else if (id === 'roar') {
    glowOrb(g, 0, 0, 9, '#e0c0ff', 'rgba(140,70,255,0.3)');
    g.lineWidth = 2.5;
    for (const [r, c] of [[11, '#a060ff'], [15, '#c890ff']]) { g.strokeStyle = c; g.beginPath(); g.arc(0, 0, r, 0, 7); g.stroke(); }
  } else if (id === 'dash') {
    g.strokeStyle = '#5a4ad0'; g.lineWidth = 3; g.lineCap = 'round';
    for (const [y, l] of [[-7, 12], [0, 18], [7, 12]]) { g.beginPath(); g.moveTo(-14, y); g.lineTo(-14 + l, y); g.stroke(); }
    g.fillStyle = '#2a2a4a';
    g.beginPath(); g.moveTo(4, -10); g.lineTo(14, 0); g.lineTo(4, 10); g.closePath(); g.fill();
  }
  g.restore();
}
function drawHUD() {
  const g = ctx, p = player;
  const y0 = H - 54;
  const bg = g.createLinearGradient(0, y0, 0, H);
  bg.addColorStop(0, '#4d5466'); bg.addColorStop(1, '#1f222b');
  g.fillStyle = bg; g.fillRect(0, y0, W, 54);
  g.fillStyle = '#9aa3b8'; g.fillRect(0, y0, W, 2);

  g.fillStyle = '#16181f'; rrect(g, 10, y0 + 9, 96, 36, 6); g.fill();
  g.font = 'italic bold 15px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillStyle = '#fff'; g.fillText('LV.', 20, y0 + 28);
  g.font = 'bold 24px Impact, "Arial Black", sans-serif';
  g.lineWidth = 4; g.strokeStyle = '#5a2a00'; g.strokeText(String(p.lv), 56, y0 + 28);
  g.fillStyle = '#ffb030'; g.fillText(String(p.lv), 56, y0 + 28);
  g.font = 'bold 13px Arial, sans-serif'; g.fillStyle = '#fff'; g.fillText(p.job, 118, y0 + 19);
  g.fillStyle = '#c8cfdd'; g.fillText(p.name, 118, y0 + 37);

  bar(210, y0 + 20, 210, 15, p.hp / p.maxHp, '#ff7a7a', '#c41a1a', `HP [${Math.ceil(p.hp)}/${p.maxHp}]`);
  bar(436, y0 + 20, 210, 15, p.mp / p.maxMp, '#7ab8ff', '#1a4ac4', `MP [${Math.floor(p.mp)}/${p.maxMp}]`);
  const need = expNeed(p.lv);
  bar(662, y0 + 20, 200, 15, p.exp / need, '#f8f07a', '#b8a812', `EXP ${p.exp} [${(p.exp / need * 100).toFixed(1)}%]`);

  SKILL_ORDER.forEach((id, i) => {
    const s = SKILLS[id];
    const x = 884 + i * 78, y = y0 + 6;
    g.fillStyle = '#e8ecf4'; rrect(g, x, y, 66, 42, 5); g.fill();
    g.strokeStyle = '#6a7388'; g.lineWidth = 1.5; g.stroke();
    drawIcon(id, x + 24, y + 22);
    g.font = 'bold 10px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
    g.fillStyle = '#3a4258'; g.fillText(s.key, x + 4, y + 3);
    if (s.mp) { g.textAlign = 'right'; g.fillStyle = '#1a4ac4'; g.fillText(s.mp + 'MP', x + 63, y + 30); }
    const cdf = s.cd ? player.cd[id] / s.cd : 0;
    if (cdf > 0) { g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, y, 66, 42 * cdf); }
    if (player.mp < s.mp) { g.fillStyle = 'rgba(200,0,0,0.3)'; rrect(g, x, y, 66, 42, 5); g.fill(); }
  });
}
function drawMinimap() {
  const g = ctx;
  const x = 8, y = 8, w = 240, h = 104;
  g.fillStyle = 'rgba(20,26,40,0.78)'; rrect(g, x, y, w, h, 6); g.fill();
  g.strokeStyle = '#8fa6c8'; g.lineWidth = 1.5; g.stroke();
  const hg = g.createLinearGradient(0, y, 0, y + 34);
  hg.addColorStop(0, MAP.theme.head[0]); hg.addColorStop(1, MAP.theme.head[1]);
  g.fillStyle = hg; rrect(g, x + 2, y + 2, w - 4, 32, 5); g.fill();
  g.font = 'bold 12px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillStyle = '#fff'; g.fillText(MAP.name, x + 10, y + 5);
  g.font = '11px Arial, sans-serif'; g.fillStyle = '#f0f4ff'; g.fillText(MAP.sub, x + 10, y + 19);
  const sx = (w - 20) / WORLD_W, sy = 0.11, ox = x + 10, oy = y + 22;
  g.strokeStyle = '#9ad06a'; g.lineWidth = 2;
  for (const s of SEGS) { g.beginPath(); g.moveTo(ox + Math.max(0, s.x0) * sx, oy + s.y * sy); g.lineTo(ox + Math.min(WORLD_W, s.x1) * sx, oy + s.y * sy); g.stroke(); }
  for (const p of PLATS) { g.beginPath(); g.moveTo(ox + p.x * sx, oy + p.y * sy); g.lineTo(ox + (p.x + p.w) * sx, oy + p.y * sy); g.stroke(); }
  g.fillStyle = '#7fe0ff';
  for (const pt of PORTALS) { g.beginPath(); g.ellipse(ox + pt.x * sx, oy + pt.y * sy - 5, 2.5, 4.5, 0, 0, 7); g.fill(); }
  g.fillStyle = '#ff5a5a';
  for (const m of mobs) if (!m.dead) { g.beginPath(); g.arc(ox + m.x * sx, oy + m.y * sy - 3, 2, 0, 7); g.fill(); }
  g.fillStyle = '#ffe04a';
  g.beginPath(); g.arc(ox + player.x * sx, oy + player.y * sy - 4, 3.2, 0, 7); g.fill();
}
function drawHelp() {
  const g = ctx;
  const lines = ['← → Move    Space / Alt  Jump', '↑ ↓ Climb    ↑ at a portal  Travel', 'Z / Ctrl Magic Bolt    X Arcane Burst', 'C Frost Nova    V Shadow Dash', 'R Magic Roar (hits the whole map)'];
  const w = 252, h = 22 + lines.length * 16, x = W - w - 8, y = 8;
  g.fillStyle = 'rgba(225,232,240,0.85)'; rrect(g, x, y, w, h, 6); g.fill();
  g.strokeStyle = '#6a86a0'; g.lineWidth = 1.5; g.stroke();
  g.font = 'bold 11px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillStyle = '#1a2a3a'; g.fillText('Controls', x + 10, y + 6);
  g.font = '11px Arial, sans-serif'; g.fillStyle = '#24324e';
  lines.forEach((l, i) => g.fillText(l, x + 10, y + 22 + i * 16));
}
function drawBanner() {
  if (!banner || state !== 'play') return;
  const g = ctx, t = banner.t;
  const a = t < 0.4 ? t / 0.4 : t > 2.4 ? Math.max(0, 1 - (t - 2.4) / 0.6) : 1;
  const title = banner.title || MAP.name, sub = banner.sub || MAP.sub;
  g.save();
  g.globalAlpha = a;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 30px Georgia, serif';
  const bw = Math.max(400, g.measureText(title).width + 80);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  rrect(g, W / 2 - bw / 2, 120, bw, 70, 10); g.fill();
  g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText(title, W / 2, 146);
  g.fillStyle = '#fff3d0'; g.fillText(title, W / 2, 146);
  g.font = 'italic 14px Georgia, serif'; g.fillStyle = '#e0e8f0'; g.fillText(sub, W / 2, 174);
  g.restore();
}
function fmtTime(s) {
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}
function drawQuest() {
  const g = ctx;
  const steps = [
    ['Clear the overgrown path', `Defeat monsters in Mossy Hollow  ${quest.kills}/${GOAL}`],
    ['Into the cave', `Defeat monsters in Ember Cave  ${quest.kills}/${GOAL}`],
    ['The Ember King', 'Find and defeat the boss in Ember Cave'],
    ['Complete!', 'The hollow is safe'],
  ];
  const [title, line] = steps[quest.step];
  const x = W - 260, y = 118, w = 252, h = 64;
  g.fillStyle = 'rgba(225,232,240,0.85)'; rrect(g, x, y, w, h, 6); g.fill();
  g.strokeStyle = '#6a86a0'; g.lineWidth = 1.5; g.stroke();
  g.font = 'bold 11px Arial, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
  g.fillStyle = '#7a3a10'; g.fillText(`Quest ${Math.min(quest.step + 1, 3)}/3`, x + 10, y + 6);
  g.textAlign = 'right'; g.fillStyle = '#24324e';
  g.fillText(fmtTime(state === 'title' ? 0 : (quest.end || time) - quest.start), x + w - 10, y + 6);
  g.textAlign = 'left';
  g.font = 'bold 12px Arial, sans-serif'; g.fillStyle = '#1a2a3a'; g.fillText(title, x + 10, y + 24);
  g.font = '11px Arial, sans-serif'; g.fillStyle = '#24324e'; g.fillText(line, x + 10, y + 42);
}
function drawBossBar() {
  const b = mobs.find(m => MOB_TYPES[m.type].boss && !m.dead);
  if (!b) return;
  const g = ctx, w = 520, x = W / 2 - w / 2, y = 24;
  g.fillStyle = 'rgba(10,6,6,0.8)'; rrect(g, x - 8, y - 6, w + 16, 34, 6); g.fill();
  g.font = 'bold 12px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'top';
  g.fillStyle = '#ffd9a0'; g.fillText(MOB_TYPES.boss.name, W / 2, y - 3);
  bar(x, y + 12, w, 12, b.hp / b.maxHp, '#ff8a5a', '#b8200a', '');
}
function drawOverlay() {
  if (state === 'play') return;
  const g = ctx;
  g.fillStyle = 'rgba(4,10,16,0.62)';
  g.fillRect(0, 0, W, H);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const pulse = 0.6 + 0.4 * Math.sin(time * 3);
  if (state === 'title') {
    g.font = 'bold 64px Georgia, serif';
    g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText('Mossy Hollow', W / 2, 200);
    g.fillStyle = '#e6fff0'; g.fillText('Mossy Hollow', W / 2, 200);
    g.font = 'italic 18px Georgia, serif'; g.fillStyle = '#bfe6dc';
    g.fillText('Clear the forest, enter the cave, and defeat the Ember King.', W / 2, 250);
    g.font = '15px Arial, sans-serif'; g.fillStyle = '#e0ecf4';
    ['← → move   ·   Space jump   ·   ↑ climb / use portals',
      'Z Magic Bolt   ·   X Arcane Burst   ·   C Frost Nova   ·   V Shadow Dash',
      'R Magic Roar — strikes every monster on the map'].forEach((l, i) => g.fillText(l, W / 2, 320 + i * 28));
    g.globalAlpha = pulse;
    g.font = 'bold 22px Arial, sans-serif'; g.fillStyle = '#ffe08a';
    g.fillText('Click or press Enter to start', W / 2, 460);
    g.globalAlpha = 1;
  } else {
    g.font = 'bold 72px Georgia, serif';
    g.lineWidth = 8; g.strokeStyle = 'rgba(0,0,0,0.7)'; g.strokeText('Victory!', W / 2, 210);
    g.fillStyle = '#ffe08a'; g.fillText('Victory!', W / 2, 210);
    g.font = '20px Arial, sans-serif'; g.fillStyle = '#f0f4ff';
    g.fillText(`Clear time ${fmtTime(quest.end - quest.start)}   ·   Level ${player.lv}`, W / 2, 290);
    g.globalAlpha = pulse;
    g.font = 'bold 22px Arial, sans-serif'; g.fillStyle = '#ffe08a';
    g.fillText('Click or press Enter to play again', W / 2, 400);
    g.globalAlpha = 1;
  }
}

// ---------- render ----------
function drawSky() {
  const g = ctx;
  g.drawImage(TH.SKY, 0, 0);
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 4; i++) {
    const x = ((i * 360 + 300 - cam.x * 0.05) % (W + 400) + W + 400) % (W + 400) - 200;
    const gr = g.createLinearGradient(x, 0, x + 200, H * 0.8);
    gr.addColorStop(0, `rgba(${MAP.theme.shaft},0.07)`); gr.addColorStop(1, `rgba(${MAP.theme.shaft},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 70, 0); g.lineTo(x + 300, H); g.lineTo(x + 180, H); g.closePath(); g.fill();
  }
  g.restore();
}
function drawHaze(y0, y1, col) {
  const g = ctx;
  const gr = g.createLinearGradient(0, y0, 0, y1);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.6, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, y0, W, y1 - y0);
}
function drawSpores() {
  const g = ctx, th = MAP.theme;
  g.save();
  g.globalCompositeOperation = 'lighter';
  for (const s of SPORES) {
    const x = ((s.x - cam.x * s.par + Math.sin(time * 0.7 + s.ph) * 20) % W + W) % W;
    const y = ((s.y - time * s.sp * th.sporeRise) % (H - 60) + (H - 60)) % (H - 60);
    const a = (s.big ? 0.75 : 0.4) + 0.2 * Math.sin(time * 2 + s.ph);
    const gr = g.createRadialGradient(x, y, 0, x, y, s.r * 4);
    gr.addColorStop(0, `rgba(${th.spore[0]},${a})`);
    gr.addColorStop(0.25, `rgba(${th.spore[1]},${a * 0.7})`);
    gr.addColorStop(1, `rgba(${th.spore[2]},0)`);
    g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, s.r * 4, 0, 7); g.fill();
  }
  g.restore();
}
function drawGrade() {
  const g = ctx, th = MAP.theme;
  g.fillStyle = th.grade;
  g.fillRect(0, 0, W, H);
  const v = g.createRadialGradient(W / 2, H * 0.45, H * 0.35, W / 2, H * 0.45, H * 0.95);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, th.vignette);
  g.fillStyle = v;
  g.fillRect(0, 0, W, H);
}
function render() {
  const g = ctx;
  g.save();
  if (shake > 0) g.translate(rr(-1, 1) * shake * 14, rr(-1, 1) * shake * 10);
  drawWorld();
  g.restore();
  if (flash > 0) { g.fillStyle = `rgba(230,200,255,${flash * 1.6})`; g.fillRect(0, 0, W, H); }
  drawBanner();
  drawBossBar();
  drawMinimap();
  drawHelp();
  drawQuest();
  drawHUD();
  if (trans) {
    g.fillStyle = `rgba(0,0,0,${trans.t < 0.3 ? trans.t / 0.3 : Math.max(0, 1 - (trans.t - 0.3) / 0.3)})`;
    g.fillRect(0, 0, W, H);
  }
  drawOverlay();
}
function drawWorld() {
  const g = ctx, th = MAP.theme;
  drawSky();
  g.drawImage(TH.FAR.c, -Math.round(cam.x * TH.FAR.f), 0);
  drawHaze(380, 700, th.haze[0]);
  g.drawImage(TH.MID.c, -Math.round(cam.x * TH.MID.f), 0);
  drawHaze(450, 720, th.haze[1]);
  g.drawImage(TH.NEAR.c, -Math.round(cam.x * TH.NEAR.f), 0);

  g.save();
  g.translate(-Math.round(cam.x), 0);
  for (const d of TH.animBack) drawAnim(g, d.key, 'idle', d.t * 12, d.x, d.y, d.flip, d.s);
  g.drawImage(TH.TERRAIN, 0, 0);
  for (const pt of PORTALS) drawPortal(pt);
  for (const m of mobs) drawMob(m);
  drawPlayer(player);
  for (const b of bolts) drawBolt(b);
  for (const e of effects) drawEffect(e);
  for (const q of particles) drawParticle(q);
  for (const d of TH.animFront) drawAnim(g, d.key, 'idle', d.t * 12, d.x, d.y, d.flip, d.s);
  g.restore();

  g.drawImage(TH.FG.c, -Math.round(cam.x * TH.FG.f), 0);
  drawSpores();
  drawGrade();
  g.save();
  g.translate(-Math.round(cam.x), 0);
  for (const d of dmgNums) drawDmg(d);
  g.restore();
}

// ---------- start ----------
function start() {
  const shot = QS.get('shot');
  const first = MAPS[QS.get('map')] ? QS.get('map') : 'mossy';
  loadMap(first, first === 'mossy' ? 160 : 190);
  banner = null;
  if (shot) state = 'play';
  if (shot === 'title') {
    state = 'title';
    for (let f = 0; f < 30; f++) update(1 / 60);
    render();
    return;
  }
  if (shot === 'portal') {
    // Preview: hero standing at the map's portal, with the map-name banner showing.
    const pt = PORTALS[0];
    loadMap(first, pt.x + (pt.x < WORLD_W / 2 ? 20 : -20));
    for (let f = 0; f < 50; f++) update(1 / 60);
    render();
    return;
  }
  if (shot === 'test') {
    // Self-test: a bot plays the whole quest at high speed (it hops next to targets instead of
    // path-finding) and the result is written to the page title.
    startGame();
    const dt = 1 / 60;
    let f = 0;
    const log = [];
    let lastStep = -1;
    while (f++ < 60 * 900 && state !== 'win') {
      const p = player;
      p.inv = 99;
      if (quest.step !== lastStep) { log.push(`step${quest.step}@${Math.round(f / 60)}s`); lastStep = quest.step; }
      if (!trans) {
        if (quest.step === 1 && MAP === MAPS.mossy) {
          const pt = PORTALS[0];
          p.x = pt.x; p.y = pt.y; p.vy = 0; p.onGround = true; p.climb = null;
          pressed.ArrowUp = true;
        } else {
          const live = mobs.filter(m => !m.dead && m.spawn <= 0);
          const near = live.find(m => MOB_TYPES[m.type].boss) || live.sort((a, b) => Math.abs(a.x - p.x) - Math.abs(b.x - p.x))[0];
          if (near) {
            if (Math.abs(near.x - p.x) > 160 || Math.abs(near.floor - p.y) > 50) { p.x = clamp(near.x - 100, 30, WORLD_W - 30); p.y = groundAt(p.x); p.vy = 0; p.climb = null; }
            p.dir = near.x > p.x ? 1 : -1;
            tryAttack(p.mp >= 25 && p.cd.roar <= 0 ? 'roar' : p.mp >= 31 ? 'power' : 'attack');
          }
        }
      }
      update(dt);
    }
    render();
    document.title = `TEST state=${state} map=${MAP.name} step=${quest.step} lv=${player.lv} ${log.join(' ')} end@${Math.round(f / 60)}s`;
    return;
  }
  if (shot === 'roar') {
    // Preview: Magic Roar in the cave during the boss fight.
    quest.step = 2;
    loadMap('cave', 1820);
    banner = null;
    for (const m of mobs) m.spawn = 0;
    const boss = mobs.find(m => MOB_TYPES[m.type].boss);
    boss.x = 2150;
    player.dir = 1;
    for (let f = 0; f < 40; f++) {
      if (f === 2) tryAttack('roar');
      update(1 / 60);
    }
    render();
    return;
  }
  if (SHOT) {
    // Scripted scene for a preview screenshot.
    const sh = MAP.shot;
    player.x = sh.px; player.y = groundAt(sh.px); player.dir = 1;
    const group = mobs.filter(m => m.range[0] === sh.group);
    sh.xs.forEach((x, i) => { if (group[i]) { group[i].x = x; group[i].dir = -1; group[i].think = 99; group[i].walk = 0; } });
    cam.x = clamp(player.x - W / 2, 0, WORLD_W - W);
    banner = null;
    const dt = 1 / 60;
    for (let f = 0; f < 56; f++) {
      if (f === 4) tryAttack('power');
      if (f === 36) tryAttack('blast');
      update(dt);
    }
    render();
    document.title = 'READY';
    return;
  }
  let last = performance.now();
  const frame = now => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

ctx.fillStyle = '#10201a'; ctx.fillRect(0, 0, W, H);
ctx.fillStyle = '#cfe8d8'; ctx.font = 'bold 22px Arial, sans-serif'; ctx.textAlign = 'center';
ctx.fillText('Loading…', W / 2, H / 2);
loadAll().then(start).catch(err => {
  ctx.fillStyle = '#10201a'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ff9a8a'; ctx.fillText(err.message, W / 2, H / 2);
  console.error(err);
});
})();
