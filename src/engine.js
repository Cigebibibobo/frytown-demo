import { MAP_W, MAP_H, PLOTS, OCTO_SHIP_BERTH, OCTO_PIPE, terrainAt, terrainEdgeFamily, seabedAt, defOf, roadSpriteKey } from './content.js';
import { CAMERA } from './data/runtime.js';
import { t } from './i18n.js';
import { GLStage, Mesh, WHITE } from './gl-stage.js';
import {
  roadMask, statusOf, key, objectAt, plotUnlocked, queueAtShop, demolitionQuote,
  formatSeconds, wormPhase, octopusPhase, deepSeaHarborBuilt,
} from './rules.js';

const HALF_W = 32;
const HALF_H = 16;
// Ground never changes between road/paint/field edits, so bake it once per
// 8x8-tile block instead of issuing ~1000 drawImage calls every frame.
const GROUND_CHUNK = 8;
const GROUND_CHUNK_COLS = Math.ceil(MAP_W / GROUND_CHUNK);
const GROUND_CHUNK_ROWS = Math.ceil(MAP_H / GROUND_CHUNK);
const GROUND_CHUNK_W = GROUND_CHUNK * 64;
const GROUND_CHUNK_H = GROUND_CHUNK * 32;
const CHUNK_AUDIT_MS = 1500;
// A reclaimed chunk is a hole in the map until the sweep reaches it, so the
// sweep has to be fast enough to measure in seconds. One probe every 4s left a
// 23-chunk view unhealed for a minute and a half.
const CHUNK_AUDIT_MS_TOUCH = 700;
const CHUNK_AUDIT_MAX = 8;
const CHUNK_AUDIT_MAX_TOUCH = 2;
const CHUNK_BAKE_PER_FRAME = 3;
// Evicted chunks go back into a small pool instead of the garbage collector: a
// phone gesture can retire a dozen 512x256 canvases, and allocating that many
// fresh ones per swipe is what exhausts the webview's canvas budget, after
// which new chunks bake as flat placeholders and every frame retries.
const CHUNK_POOL_MAX = 16;
const CHUNK_BAKE_RETRY_MS = 900;
const CHUNK_HEAL_DELAY_MS = 1800;
// Swapping the canvas surface is the only thing that has ever brought WebGL back
// on a phone that lost it, but each swap rebuilds a node in the page, so a device
// that never gets a context again stops after this many tries and keeps playing
// on the canvas path.
const GL_SWAP_MAX = 8;
// How long a context has to survive before a fresh loss starts the retry gap over
// again from the short end.
const GL_SETTLE_MS = 20000;
// The static stack (backdrop, map base, ground, plot veil) dominates a phone
// frame while carrying no motion, so it is composited into one viewport canvas
// and blitted; the animated layers stay per-frame. It is a second full-screen
// surface on a webview that is already evicting canvases, so it stays exactly
// viewport-sized and is dropped when the same GC that clears ground chunks
// takes it, rather than showing the player a black town.
const SCENE_REFRESH_MS = 60000;
const SCENE_CHECK_MS = 4000;
const SCENE_RETRY_MS = 15000;
// Phone webviews are where a full-screen blend or a readback stops being free.
const TOUCH = (navigator.maxTouchPoints || 0) > 0;

// Flat under-paint per surface. The atlas draws on top of it, so it is only
// visible when a sprite can't be drawn — and then a plain colour beats a hole.
const SURFACE_FILL = {
  grass: '#7aa65c', sand: '#ddc894', coral: '#e5a79a', desert: '#d6bf86',
  rock: '#948f85', crag: '#87836f', gravel: '#b0a894', ice: '#c9e2e8',
  snow: '#e9f0ee', plaza: '#c8bca4', water: '#4d97b8', deep: '#2e6d92',
  void: '#7aa65c',
};
const ROAD_FILL = '#6f6e68';
const PAVE_FILL = '#bfb49c';
const SOIL_FILL = '#8a6a46';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TAU = Math.PI * 2;

// Props that move in the wind. Trees and shrubs only — rocks, benches and lamps
// stay put, and food stalls are deliberately excluded so a busy street doesn't
// shimmer while the player is trying to read prices.
const SWAY_PROPS = new Set(['oak', 'pine', 'birch', 'palm', 'bush', 'acacia']);

function hash(x, y, s = 1) {
  const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

export const RANGE_FENCE_STYLE = { chickenRange: 1, cowRange: 0 };

export function buildingSpriteKey(sprite, variant = 0, rot = 0) {
  const q = ((Number(rot) || 0) % 4 + 4) % 4;
  return q ? `b:${sprite}:${variant}:r${q}` : `b:${sprite}:${variant}`;
}

export function propSpriteKey(prop, variant = 0, rot = 0) {
  const q = ((Number(rot) || 0) % 4 + 4) % 4;
  return q ? `p:${prop}:${variant}:r${q}` : `p:${prop}:${variant}`;
}

export function spriteKeyFor(o) {
  const def = defOf(o.type);
  if (!def) return null;
  if (def.sprite) return buildingSpriteKey(def.sprite, o.variant || 0, o.rot);
  if (def.prop) return propSpriteKey(def.prop, o.variant || 0, o.rot);
  return null;
}

export function fieldStage(o) {
  return Math.min(3, Math.floor((o.growth || 0) * 4));
}

function drawKey(item) {
  return item.sk !== undefined ? item.sk : item.x + item.w + item.y + item.d + (item.bias || 0);
}

function sortDrawables(p, q) {
  const ps = drawKey(p);
  const qs = drawKey(q);
  if (ps !== qs) return ps - qs;
  return p.y + p.d - (q.y + q.d) || p.x - q.x;
}

const WORM_DUST_COLORS = ['#f0c98f', '#dba76c', '#bd8251'];
const WORM_DUST_RATE = { dormant: 2, breach: 22, tower: 10, dive: 24, settle: 8 };

function wormRise(phase) {
  if (phase.id === 'breach') return 1 - Math.pow(1 - phase.progress, 3);
  if (phase.id === 'tower') return 1;
  if (phase.id === 'dive') return Math.pow(1 - phase.progress, 2.2);
  return 0;
}

// Each phase maps to one baked pose. The swap is short enough to read as the
// animal unrolling, and long enough to hide the cut between key frames.
const OCTOPUS_POSE = { lurk: 0, rise: 1, spread: 2, fold: 3, sink: 4 };
const OCTOPUS_FADE = 0.6;

// ---- GL shape primitives -------------------------------------------------
// The harbour specials are canvas strokes and fills, and WebGL has no path API.
// Their geometry is built in world pixels over the 1 px white texture and
// tinted per vertex. World and screen share a uniform scale, so an
// axis-aligned canvas ellipse is an axis-aligned world ellipse of radius /
// zoom, and a canvas line width is lineWidth / zoom world pixels.
const GL_COLOR_CACHE = new Map();

function glColor(hex, alpha) {
  let c = GL_COLOR_CACHE.get(hex);
  if (!c) {
    const h = hex.replace('#', '');
    c = [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255, 1];
    GL_COLOR_CACHE.set(hex, c);
  }
  return alpha === undefined || alpha === 1 ? c : [c[0], c[1], c[2], alpha];
}

function glPush(v, x, y, c) {
  v.push(x, y, 0.5, 0.5, 0, c[0], c[1], c[2], c[3]);
}

function glTri(v, ax, ay, bx, by, cx, cy, c) {
  glPush(v, ax, ay, c);
  glPush(v, bx, by, c);
  glPush(v, cx, cy, c);
}

function glQuad(v, x0, y0, x1, y1, c) {
  glTri(v, x0, y0, x1, y0, x1, y1, c);
  glTri(v, x0, y0, x1, y1, x0, y1, c);
}

function glFan(v, pts, c) {
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p[0];
    cy += p[1];
  }
  cx /= pts.length;
  cy /= pts.length;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    glTri(v, cx, cy, a[0], a[1], b[0], b[1], c);
  }
}

function glDisk(v, x, y, rx, ry, c, segs = 16) {
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const t = (i / segs) * TAU;
    pts.push([x + Math.cos(t) * rx, y + Math.sin(t) * ry]);
  }
  glFan(v, pts, c);
}

// Stroked ellipse: the band is offset along the ellipse normal, which is how
// canvas distributes the width of a stroke around its path.
function glBand(v, x, y, rx, ry, width, c, segs = 28) {
  const h = width / 2;
  const outer = [];
  const inner = [];
  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * TAU;
    const ct = Math.cos(t);
    const st = Math.sin(t);
    let nx = ct / rx;
    let ny = st / ry;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const px = x + rx * ct;
    const py = y + ry * st;
    outer.push([px + nx * h, py + ny * h]);
    inner.push([px - nx * h, py - ny * h]);
  }
  for (let i = 0; i < segs; i++) {
    const j = i + 1;
    glTri(v, outer[i][0], outer[i][1], outer[j][0], outer[j][1], inner[j][0], inner[j][1], c);
    glTri(v, outer[i][0], outer[i][1], inner[j][0], inner[j][1], inner[i][0], inner[i][1], c);
  }
}

// Segment with round caps: the same shape as a canvas stroke with lineCap round.
function glCapsule(v, ax, ay, bx, by, hw, c, segs = 8) {
  const dx = bx - ax;
  const dy = by - ay;
  if (Math.hypot(dx, dy) < 1e-4) {
    glDisk(v, ax, ay, hw, hw, c, segs * 2);
    return;
  }
  const ang = Math.atan2(dy, dx);
  const pts = [];
  for (let i = 0; i <= segs; i++) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / segs;
    pts.push([bx + Math.cos(t) * hw, by + Math.sin(t) * hw]);
  }
  for (let i = 0; i <= segs; i++) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / segs;
    pts.push([ax + Math.cos(t) * hw, ay + Math.sin(t) * hw]);
  }
  glFan(v, pts, c);
}

function glStroke(v, pts, width, c) {
  const hw = width / 2;
  for (let i = 1; i < pts.length; i++) {
    glCapsule(v, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], hw, c);
  }
}

// Dashed polyline with the dash phase running from the first point, matching
// setLineDash + stroke. A dash that crosses a corner splits into one capsule
// per piece; their round caps overlap and read as one unbroken dash.
function glDash(v, pts, on, off, width, c, phase = 0) {
  const hw = width / 2;
  const segs = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const ax = pts[i - 1][0];
    const ay = pts[i - 1][1];
    const bx = pts[i][0];
    const by = pts[i][1];
    const len = Math.hypot(bx - ax, by - ay);
    segs.push({ ax, ay, bx, by, len, at: total });
    total += len;
  }
  const period = on + off;
  const start = -(((phase % period) + period) % period);
  for (let s = start; s < total; s += period) {
    const e = Math.min(s + on, total);
    for (const g of segs) {
      const l0 = Math.max(s, g.at);
      const l1 = Math.min(e, g.at + g.len);
      if (l1 <= l0) continue;
      const u0 = (l0 - g.at) / g.len;
      const u1 = (l1 - g.at) / g.len;
      glCapsule(v,
        g.ax + (g.bx - g.ax) * u0, g.ay + (g.by - g.ay) * u0,
        g.ax + (g.bx - g.ax) * u1, g.ay + (g.by - g.ay) * u1, hw, c);
    }
  }
}

// ---- GL UI layer ---------------------------------------------------------
// Labels are baked once into the stage's texture array and tinted by the
// vertex colour; panels, bars and borders ride the same array on layer 0
// (solid white). Everything the 2D pass drew with fillText/fillRect/strokeRect
// becomes one ordered run, so a frame uploads nothing for it after the strings
// have been cached.
const UI_FAMILY = '"Fusion Pixel", "Microsoft YaHei", monospace';
const UI_FONT_9 = `9px ${UI_FAMILY}`;
const UI_FONT_10 = `600 10px ${UI_FAMILY}`;
const UI_FONT_10R = `10px ${UI_FAMILY}`;
const UI_FONT_11 = `11px ${UI_FAMILY}`;
const UI_FONT_11B = `600 11px ${UI_FAMILY}`;
const UI_FONT_12 = `600 12px ${UI_FAMILY}`;

// The UI run is premultiplied (array textures are uploaded that way), so the
// vertex tint has to be premultiplied too or translucent panels glow.
function glColorP(hex, alpha) {
  const c = glColor(hex);
  const a = alpha === undefined ? 1 : alpha;
  return [c[0] * a, c[1] * a, c[2] * a, a];
}

function uiQuad(v, x0, y0, x1, y1, u0, vv0, u1, vv1, layer, c) {
  v.push(
    x0, y0, u0, vv0, layer, c[0], c[1], c[2], c[3],
    x1, y0, u1, vv0, layer, c[0], c[1], c[2], c[3],
    x1, y1, u1, vv1, layer, c[0], c[1], c[2], c[3],
    x0, y0, u0, vv0, layer, c[0], c[1], c[2], c[3],
    x1, y1, u1, vv1, layer, c[0], c[1], c[2], c[3],
    x0, y1, u0, vv1, layer, c[0], c[1], c[2], c[3],
  );
}

export class TownEngine {
  constructor(canvas, data, images) {
    this.canvas = canvas;
    this.data = data;
    this.images = images;
    // There is one canvas on the page. WebGL owns it and blits the animated 2D
    // layer over the town at the end of every frame, so the webview no longer
    // has two layers it can drop one at a time. Without WebGL the same surface
    // is the canvas path's own.
    this.glStage = /[?&]gl=0/.test(location.search) ? new GLStage(null) : new GLStage(canvas);
    this.useGL = this.glStage.ok;
    // Temporary A/B switch for the S2 water migration; ?watergl=0 puts the four
    // water passes back on the 2D overlay so one build can be compared against
    // itself. Removed once S2 is accepted.
    this._waterGL = !/[?&]watergl=0/.test(location.search);
    const wpass = /[?&]wpass=([^&]*)/.exec(location.search);
    this._waterPasses = wpass ? new Set(wpass[1].split(',')) : null;
    // Same A/B switch for the object stream; ?objgl=0 keeps the 2D sprites.
    this._objGL = !/[?&]objgl=0/.test(location.search);
    // And for the UI pass (labels, panels, badges); ?uigl=0 keeps them on canvas.
    this._uiGL = !/[?&]uigl=0/.test(location.search);
    // Baked label slices, keyed by text|font|colour|stroke. Bounded because each
    // one holds a 256x128 slice of the shared array.
    this._glTexts = new Map();
    this._glTextLimit = 36;
    this._uiCtx = null;
    this.overlay = this.useGL ? document.createElement('canvas') : canvas;
    this._overlayShown = !this.useGL;
    this.ctx = this.overlay.getContext('2d', { alpha: this.useGL });
    this._glScreenKey = '';
    this._glWorldKey = '';
    this._glVeilKey = '';
    this._glAtlasKey = '';
    this._glPoolKey = '';
    // True only while a frame actually renders through WebGL. The canvas
    // fallback after a lost context shares useGL, and ?objgl=0 keeps GL but
    // hands sprites back to the canvas, so the object stream needs both flags.
    this._glActive = false;
    this.viewW = 1;
    this.viewH = 1;
    this.cam = { x: 0, y: 0, zoom: 1 };
    this.minZoom = CAMERA.MIN_ZOOM;
    this.maxZoom = CAMERA.MAX_ZOOM;
    this.centerYOffset = CAMERA.CENTER_Y_OFFSET;
    this.time = 0;
    this.animals = [];
    this.ranchTruck = null;
    this._animalSig = '';
    this.floaters = [];
    // Store art and trailers turn the status tags off so roofs stay readable.
    this.badgesHidden = false;
    this.puffs = [];
    this.smokeTimers = new Map();
    this.gridPath = null;
    this.groundChunks = new Map();
    this._chunkKeep = new Set();
    this._chunkPool = [];
    this._chunkAuditAt = 0;
    this._chunkAuditCursor = 0;
    this._blankCursor = 0;
    this._blankSample = 0;
    this.debugSkip = 0;
    this._sceneA = null;
    this._sceneCamKey = '';
    this._sceneContent = '';
    this._sceneAt = 0;
    this._sceneCheckAt = 0;
    this._sceneBuilds = 0;
    this._sceneForce = true;
    this._sceneFails = 0;
    this._sceneLost = false;
    this._sceneRetryAt = 0;
    this._glFellBack = false;
    this._glSwapAt = 0;
    this._glSwapWait = 0;
    this._camKey = '';
    this._chunkRepair = [];
    this._chunkProbe = null;
    this._chunkProbeCtx = null;
    this._bakes = 0;
    this._repairs = 0;
    this._chunkAllocs = 0;
    this._bakeFailAt = 0;
    // The first chunk bakes can land while the 4096px atlas is still uploading
    // and bake a half-res or black sprite into the cache. Re-bake whatever is
    // live once things have settled rather than leaving those chunks wrong.
    this._healAt = TOUCH ? performance.now() + CHUNK_HEAL_DELAY_MS : 0;
    this.groundSig = null;
    this.fieldTiles = new Set();
    this.groundRoads = new Map();
    this.groundPaint = new Set();
    this.groundFieldTiles = new Set();
    this._grassTiles = [];
    this._waterTiles = null;
    this._seaLifeReady = false;
    this._schools = [];
    this._gulls = [];
    this._staticKey = null;
    this._static = [];
    this._sales = [];
    this._fieldSprites = new Map();
    this._hatch = null;
    this.wormDust = [];
    this._wormDustAcc = 0;
    this.octoBubbles = [];
    this._octoBubbleAcc = 0;
    this.octoPose = -1;
    this.octoPrevPose = -1;
    this.octoSwapAt = 0;
    this.dpr = 1;
    // Backing-store multiplier on top of the display ratio. Only the on-device
    // diagnostic panel changes it; the store builds keep it at 1.
    this.renderScale = 1;
    // Baked labels drawn before the pixel font arrived would keep the fallback
    // face forever; the font loader tells us to throw them away and re-bake.
    if (document.fonts?.addEventListener) {
      document.fonts.addEventListener('loadingdone', () => this._glTextClear());
    }
    this._makeBackdropPattern();
    this.resize();
  }

  setRenderScale(scale) {
    this.renderScale = scale;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1) * this.renderScale;
    // Bakes are sized in device pixels, so a new ratio invalidates all of them.
    if (this._glTexts?.size && dpr !== this.dpr) this._glTextClear();
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    this.dpr = dpr;
    this.viewW = w;
    this.viewH = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    if (this.overlay !== this.canvas) {
      this.overlay.width = this.canvas.width;
      this.overlay.height = this.canvas.height;
      // Only matters when the fallback puts it in the page: without a CSS size a
      // device-scale canvas would be laid out at its intrinsic pixel size.
      this.overlay.style.width = `${w}px`;
      this.overlay.style.height = `${h}px`;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this._makeBackdrop();
    this._sceneForce = true;
    if (this.useGL) {
      this.glStage.resize(w, h, dpr);
      this._glScreenKey = '';
      this._glVeilKey = '';
    }
  }

  defaultZoom() {
    // One 20x16 plot should read at a glance on a landscape phone.
    const fit = Math.min(
      this.viewW / CAMERA.DEFAULT_FIT_W,
      (this.viewH + CAMERA.DEFAULT_FIT_H_ADD) / CAMERA.DEFAULT_FIT_H,
    );
    return clamp(fit, CAMERA.DEFAULT_MIN, CAMERA.DEFAULT_MAX);
  }

  centerOnTile(tx, ty, zoom = this.cam.zoom) {
    this.cam.zoom = clamp(zoom, this.minZoom, this.maxZoom);
    this.cam.x = (tx - ty) * HALF_W;
    this.cam.y = (tx + ty) * HALF_H;
    this.clampCam();
  }

  clampCam() {
    // Clamp in tile space, not in a world-space box: the map is a diamond, and
    // the corners of its bounding box are far outside it. A box clamp lets the
    // camera park in one of those corners at high zoom, where not a single
    // chunk is on screen and the game looks frozen on a bare backdrop.
    // Keeping the camera itself over a map tile means the map is always under
    // the middle of the screen; the shoreline can still be pushed to the
    // centre of the view, which leaves plenty of sky to look at.
    // A degenerate pinch can hand the camera a NaN, and a NaN survives every
    // clamp below and then reaches the shader as NaN vertices — geometry some
    // drivers rasterise as garbage instead of skipping. Put it back on the map.
    if (!Number.isFinite(this.cam.x) || !Number.isFinite(this.cam.y)
      || !Number.isFinite(this.cam.zoom) || this.cam.zoom <= 0) {
      this.cam.zoom = this.defaultZoom();
      this.cam.x = ((MAP_W - MAP_H) / 2) * HALF_W;
      this.cam.y = ((MAP_W + MAP_H) / 2) * HALF_H;
    }
    let tx = this.cam.x / (2 * HALF_W) + this.cam.y / (2 * HALF_H);
    let ty = this.cam.y / (2 * HALF_H) - this.cam.x / (2 * HALF_W);
    tx = clamp(tx, 0, MAP_W);
    ty = clamp(ty, 0, MAP_H);
    this.cam.x = (tx - ty) * HALF_W;
    this.cam.y = (tx + ty) * HALF_H;
  }

  worldToScreen(wx, wy) {
    return {
      x: (wx - this.cam.x) * this.cam.zoom + this.viewW / 2,
      y: (wy - this.cam.y) * this.cam.zoom + this.viewH / 2 + this.centerYOffset,
    };
  }

  tileToScreen(x, y, z = 0) {
    return this.worldToScreen((x - y) * HALF_W, (x + y) * HALF_H - z * 32);
  }

  screenToWorld(sx, sy) {
    return {
      x: (sx - this.viewW / 2) / this.cam.zoom + this.cam.x,
      y: (sy - this.viewH / 2 - this.centerYOffset) / this.cam.zoom + this.cam.y,
    };
  }

  screenToTile(sx, sy) {
    const w = this.screenToWorld(sx, sy);
    return {
      x: Math.floor(w.x / (HALF_W * 2) + w.y / (HALF_H * 2)),
      y: Math.floor(w.y / (HALF_H * 2) - w.x / (HALF_W * 2)),
    };
  }

  panBy(dx, dy) {
    this.cam.x -= dx / this.cam.zoom;
    this.cam.y -= dy / this.cam.zoom;
    this.clampCam();
  }

  zoomAt(factor, sx = this.viewW / 2, sy = this.viewH / 2) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    const before = this.screenToWorld(sx, sy);
    this.cam.zoom = clamp(this.cam.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(sx, sy);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCam();
  }

  isOnScreen(sx, sy, pad = 160) {
    return sx > -pad && sy > -pad && sx < this.viewW + pad && sy < this.viewH + pad;
  }

  _makeBackdropPattern() {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const g = c.getContext('2d');
    g.fillStyle = 'rgba(242, 238, 221, 0.045)';
    g.fillRect(0, 0, 1, 1);
    g.fillRect(8, 8, 1, 1);
    g.fillStyle = 'rgba(145, 200, 184, 0.04)';
    g.fillRect(8, 0, 1, 1);
    g.fillRect(0, 8, 1, 1);
    this._bgTile = c;
  }

  // The sky is three full-screen fills plus a repeating dot pattern. It used to
  // be baked into a viewport-sized canvas to save those fills, but that canvas
  // cost ~10 MB of the same budget the ground chunks need — and when the
  // webview reclaimed it the whole map went black behind the island. Drawing
  // the fills from cached gradients keeps the canvas budget for the map.
  _makeBackdrop() {
    const g = this.ctx;
    const lin = g.createLinearGradient(0, 0, 0, this.viewH);
    lin.addColorStop(0, '#cfe9f5');
    lin.addColorStop(0.45, '#e6f2e4');
    lin.addColorStop(1, '#f7eccd');
    this._bgGradient = lin;
    this._bgPattern = g.createPattern(this._bgTile, 'repeat');

    const cx = this.viewW / 2;
    const cy = this.viewH / 2 + this.centerYOffset;
    const halo = g.createRadialGradient(cx, cy, 20, cx, cy, Math.max(this.viewW, this.viewH) * 0.62);
    halo.addColorStop(0, 'rgba(255, 246, 214, 0.28)');
    halo.addColorStop(0.55, 'rgba(255, 240, 200, 0.12)');
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    this._bgHalo = halo;
  }

  addFloater(tx, ty, text, color = '#ffe07a', z = 1.3) {
    this.floaters.push({
      x: tx,
      y: ty,
      text,
      color,
      z,
      age: 0,
      life: 1.55,
      jitter: (Math.random() - 0.5) * 18,
    });
    if (this.floaters.length > 30) this.floaters.shift();
  }

  addPuff(tx, ty, z, color = null) {
    this.puffs.push({
      x: tx,
      y: ty,
      z,
      age: 0,
      life: 2.3,
      drift: (Math.random() - 0.5) * 14,
      size: 2 + Math.random() * 2,
      color,
    });
    if (this.puffs.length > 80) this.puffs.shift();
  }

  update(dt, state, ui) {
    this.time += dt;
    this.ensureAnimals(state);
    this._updateAnimals(dt);
    this._updateRanchTruck(dt);
    for (const f of this.floaters) f.age += dt;
    this.floaters = this.floaters.filter((f) => f.age < f.life);
    for (const p of this.puffs) p.age += dt;
    this.puffs = this.puffs.filter((p) => p.age < p.life);
    this._updateWorm(state, dt);
    this._updateOctopus(state, dt);

    for (const o of state.objects) {
      if (o.type !== 'bakery' && o.type !== 'pattyPlant' && o.type !== 'sausageWorks' && o.type !== 'cheeseHouse' && o.type !== 'pizzaOven' && o.type !== 'seafoodPlant') continue;
      const st = statusOf(state, o);
      if (st.code !== 'work') continue;
      let t = this.smokeTimers.get(o.id) ?? Math.random() * 1.4;
      t -= dt;
      if (t <= 0) {
        this.addPuff(o.x + o.w * 0.36, o.y + o.d * 0.28, 1.55);
        t = 1.7 + Math.random() * 1.1;
      }
      this.smokeTimers.set(o.id, t);
    }

    // Festival confetti drifts around the review hall while the fair runs.
    if (state.festival) {
      const hall = state.objects.find((o) => o.type === 'reviewHall');
      if (hall && Math.random() < dt * 3.2) {
        const colors = ['#ef8a67', '#ffe07a', '#91c8b8', '#eab5c5'];
        this.addPuff(
          hall.x + 0.5 + Math.random() * (hall.w - 1),
          hall.y + 0.5 + Math.random() * (hall.d - 1),
          2.2 + Math.random() * 0.8,
          colors[Math.floor(Math.random() * colors.length)],
        );
      }
    }
  }

  _groundKey(state, x, y, fieldTiles) {
    const k = key(x, y);
    if (state.roads[k]) {
      const ground = terrainAt(x, y);
      if (ground === 'water') return `g:bridge:${roadMask(state, x, y)}`;
      if (ground === 'ice') return `g:iceRoad:${roadMask(state, x, y)}`;
      // A road laid on the plaza keeps the plain road look (curbs, centre
      // dashes). A road approaching from grass drops the curb on the plaza
      // side so the two surfaces flow together.
      const mask = ground === 'plaza' ? roadMask(state, x, y) : this._streetMask(state, x, y);
      return roadSpriteKey(state.roads[k], mask);
    }
    if (state.paint[k]) return `g:pave:${(x * 5 + y * 3) % 3}`;
    if (fieldTiles.has(k)) return `g:soil:${(x * 7 + y * 3) % 2}`;
    const terrain = terrainAt(x, y);
    if (terrain === 'water') return `g:water:${(x * 5 + y * 7) % 4}`;
    if (terrain === 'deep') return `g:deep:${(x * 7 + y * 5) % 3}`;
    if (terrain === 'sand') return `g:sand:${(x * 3 + y * 5) % 2}`;
    if (terrain === 'coral') return `g:coral:${(x * 5 + y * 3 + ((x * y) % 3)) % 4}`;
    if (terrain === 'desert') {
      // Broad diagonal dune field, not per-tile noise: crests run in long bands
      // so the sand reads as wind-sculpted ridges instead of confetti.
      const band = Math.sin((x * 0.33 + y * 0.61) * Math.PI * 0.9 + Math.sin((x - y) * 0.17) * 1.2);
      const tone = band > 0.42 ? 0 : band < -0.5 ? 2 : 1;
      return `g:desert:${tone}`;
    }
    if (terrain === 'rock') return `g:rock:${(x * 5 + y * 3) % 2}`;
    if (terrain === 'crag') {
      // Two outcrop sheets in broad bands; the facet joints are irregular, so a
      // variant change at their border reads as another crack in the rock.
      const band = Math.sin((x * 0.43 + y * 0.29) * Math.PI + Math.sin((x + y) * 0.21) * 1.3);
      return `g:crag:${band > 0.2 ? 1 : 0}`;
    }
    if (terrain === 'gravel') return `g:gravel:${(x * 5 + y * 3) % 2}`;
    if (terrain === 'ice') {
      const deep = Math.sin((x * 0.31 + y * 0.19) * Math.PI + Math.sin((x + y) * 0.11) * 1.3);
      return `g:ice:${deep > 0.35 ? 1 : 0}`;
    }
    if (terrain === 'snow') {
      // Broad drift bands, not per-tile confetti: crests and wind-packed
      // hollows run across many tiles so the snowfield reads as one surface.
      const drift = Math.sin((x * 0.27 + y * 0.53) * Math.PI + Math.sin((x - y) * 0.15) * 1.4);
      return `g:snow:${drift > 0.55 ? 2 : (x * 3 + y * 5) % 2}`;
    }
    if (terrain === 'plaza') return `g:plaza:${(x + y) % 2}`;
    return `g:grass:${this._grassVariant(x, y)}`;
  }

  // Cover on the seabed is a second pass over the water tile, so bridges, paint
  // and fields simply skip it — nothing can grow through a deck.
  _seabedDecal(state, x, y) {
    const k = key(x, y);
    if (state.roads[k] || state.paint[k] || this.fieldTiles.has(k)) return null;
    const bed = seabedAt(x, y);
    if (!bed) return null;
    // A bed tile touching bare water or land is a fringe: it only gets sparse
    // cover, which turns the field boundary ragged instead of square.
    let fringe = false;
    for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || seabedAt(nx, ny) !== bed) {
        fringe = true;
        break;
      }
    }
    const variant = fringe ? 0 : hash(x, y, 51) > 0.5 ? 2 : 1;
    return `g:seabed:${bed}:${variant}`;
  }

  // Plaza is open street. A road crossing it (or the plaza itself) must not
  // draw a curb seam at every join, so the road mask treats plaza as connected.
  _streetMask(state, x, y) {
    const street = (nx, ny) => {
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) return false;
      if (state.roads[key(nx, ny)]) return true;
      return terrainAt(nx, ny) === 'plaza';
    };
    let m = 0;
    if (street(x, y - 1)) m |= 1;
    if (street(x + 1, y)) m |= 2;
    if (street(x, y + 1)) m |= 4;
    if (street(x - 1, y)) m |= 8;
    return m;
  }

  // Value noise in map space: broad bands let the lawn breathe in patches,
  // the low bit keeps neighbouring tiles from looking stamped.
  _noise2(gx, gy) {
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    const tx = gx - x0;
    const ty = gy - y0;
    const h = (x, y) => {
      let n = (x * 374761393 + y * 668265263) | 0;
      n = (n ^ (n >>> 13)) * 1274126177 | 0;
      return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
    };
    const a = h(x0, y0);
    const b = h(x0 + 1, y0);
    const c = h(x0, y0 + 1);
    const d = h(x0 + 1, y0 + 1);
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
  }

  _grassVariant(x, y) {
    const n = this._noise2(x / 5.5, y / 5.5) * 0.7 + this._noise2(x / 2.3 + 11, y / 2.3 + 7) * 0.3;
    const band = n < 0.45 ? 0 : n < 0.68 ? 1 : 2;
    return band * 2 + ((x * 3 + y * 5) & 1);
  }

  _meta(skey) {
    const m = this.data.sprites[skey];
    if (m) return m;
    const parts = skey.split(':');
    if (parts.length === 3 && (parts[0] === 'b' || parts[0] === 'p')) {
      return this.data.sprites[`${parts[0]}:${parts[1]}:0`] || null;
    }
    return null;
  }

  _drawSprite(meta, px, py, s, alpha = 1) {
    if (!meta) return;
    if (alpha < 1) {
      this.ctx.globalAlpha = alpha;
      this.ctx.drawImage(this.images[meta.p], meta.x, meta.y, meta.w, meta.h, px, py, meta.w * s, meta.h * s);
      this.ctx.globalAlpha = 1;
    } else {
      this.ctx.drawImage(this.images[meta.p], meta.x, meta.y, meta.w, meta.h, px, py, meta.w * s, meta.h * s);
    }
  }

  _diamondPath(x, y, w = 1, d = 1) {
    const ctx = this.ctx;
    const a = this.tileToScreen(x, y);
    const b = this.tileToScreen(x + w, y);
    const c = this.tileToScreen(x + w, y + d);
    const dpt = this.tileToScreen(x, y + d);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(dpt.x, dpt.y);
    ctx.closePath();
    return [a, b, c, dpt];
  }

  _drawBackdrop() {
    const ctx = this.ctx;
    ctx.fillStyle = this._bgGradient;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.fillStyle = this._bgPattern;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    ctx.restore();
    ctx.fillStyle = this._bgHalo;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
  }

  _drawMapBase() {
    const ctx = this.ctx;
    const a = this.tileToScreen(0, 0);
    const b = this.tileToScreen(MAP_W, 0);
    const c = this.tileToScreen(MAP_W, MAP_H);
    const d = this.tileToScreen(0, MAP_H);
    const drop = 30 * this.cam.zoom;

    ctx.save();
    // Layered drop shadow.
    for (let i = 3; i >= 1; i--) {
      const off = i * 7 * this.cam.zoom;
      ctx.fillStyle = `rgba(90, 70, 40, ${0.05 + i * 0.028})`;
      ctx.beginPath();
      ctx.moveTo(a.x + off, a.y + off * 1.35);
      ctx.lineTo(b.x + off, b.y + off * 1.35);
      ctx.lineTo(c.x + off, c.y + off * 1.35);
      ctx.lineTo(d.x + off, d.y + off * 1.35);
      ctx.closePath();
      ctx.fill();
    }

    // Floating-island shelf: a turf/sand lip over the cliff face. The face is
    // painted per run of terrain, so 炸浪湾's coral shoreline ends in pale sand
    // instead of the warm soil used under the rest of the map.
    const lip = Math.min(drop * 0.22, 14 * this.cam.zoom);
    const shelfRuns = (count, tileAt, pointAt, east) => {
      let start = 0;
      let kind = null;
      const flush = (end) => {
        if (end <= start) return;
        const p0 = pointAt(start);
        const p1 = pointAt(end);
        const sandy = kind === 'sand';
        const top = sandy ? (east ? '#e8d2a0' : '#dcc48e') : (east ? '#c48f55' : '#a97442');
        const bottom = sandy ? (east ? '#c2a46c' : '#ae8e5c') : (east ? '#8a5b33' : '#6a4529');
        const g = ctx.createLinearGradient(0, Math.min(p0.y, p1.y), 0, Math.max(p0.y, p1.y) + drop);
        g.addColorStop(0, top);
        g.addColorStop(1, bottom);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p1.x, p1.y + drop);
        ctx.lineTo(p0.x, p0.y + drop);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = sandy ? (east ? '#f2e3b8' : '#e4d0a0') : (east ? '#69b94a' : '#52a03c');
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p1.x, p1.y + lip);
        ctx.lineTo(p0.x, p0.y + lip);
        ctx.closePath();
        ctx.fill();
      };
      for (let i = 0; i < count; i++) {
        const t = tileAt(i);
        const next = (t === 'coral' || t === 'sand') ? 'sand' : 'soil';
        if (next !== kind) {
          flush(i);
          kind = next;
          start = i;
        }
      }
      flush(count);
    };
    shelfRuns(MAP_H, (i) => terrainAt(MAP_W - 1, i), (i) => this.tileToScreen(MAP_W, i), true);
    shelfRuns(MAP_W, (i) => terrainAt(i, MAP_H - 1), (i) => this.tileToScreen(i, MAP_H), false);

    // Strata lines on the two visible cliff faces.
    ctx.strokeStyle = 'rgba(122, 86, 44, 0.2)';
    ctx.lineWidth = 1;
    for (const f of [0.34, 0.66]) {
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + drop * f);
      ctx.lineTo(c.x, c.y + drop * f);
      ctx.lineTo(d.x, d.y + drop * f);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255, 250, 236, 0.55)';
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.stroke();
    ctx.restore();
  }

  _visibleTiles() {
    const c = this.screenToTile(-140, -160);
    const r = this.screenToTile(this.viewW + 140, -160);
    const bl = this.screenToTile(-140, this.viewH + 200);
    const br = this.screenToTile(this.viewW + 140, this.viewH + 200);
    return {
      x0: Math.max(0, Math.min(c.x, r.x, bl.x, br.x) - 2),
      x1: Math.min(MAP_W - 1, Math.max(c.x, r.x, bl.x, br.x) + 2),
      y0: Math.max(0, Math.min(c.y, r.y, bl.y, br.y) - 2),
      y1: Math.min(MAP_H - 1, Math.max(c.y, r.y, bl.y, br.y) + 2),
    };
  }

  // Road/paint/field edits are already tracked by revision counters, so the
  // per-frame check is a number instead of a string of every painted tile.
  _groundSignature(state) {
    let h = ((state.roadRev || 0) * 31 + (state.paintRev || 0)) | 0;
    for (const o of state.objects) {
      if (defOf(o.type)?.kind !== 'field') continue;
      h = (h * 31 + o.x * 7 + o.y * 13 + o.w * 3 + o.d * 5) | 0;
    }
    return h;
  }

  // Only the edited tiles (plus their 4 neighbours, whose road masks and edge
  // overlays depend on them) need a fresh chunk; a long road drag otherwise
  // rebakes every visible chunk on every placed tile.
  _markGroundDirty(dirty, k) {
    const comma = k.indexOf(',');
    const x = Number(k.slice(0, comma));
    const y = Number(k.slice(comma + 1));
    for (const [tx, ty] of [[x, y], [x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
      if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
      dirty.add(Math.floor(ty / GROUND_CHUNK) * GROUND_CHUNK_COLS + Math.floor(tx / GROUND_CHUNK));
    }
  }

  _syncGroundState(state) {
    const roads = new Map(Object.entries(state.roads));
    const paint = new Set(Object.keys(state.paint));
    const fieldTiles = new Set();
    for (const o of state.objects) {
      if (defOf(o.type)?.kind !== 'field') continue;
      for (let y = o.y; y < o.y + o.d; y++) {
        for (let x = o.x; x < o.x + o.w; x++) fieldTiles.add(key(x, y));
      }
    }

    const dirty = new Set();
    for (const [k, v] of this.groundRoads) {
      if (!roads.has(k) || roads.get(k) !== v) this._markGroundDirty(dirty, k);
    }
    for (const k of roads.keys()) if (!this.groundRoads.has(k)) this._markGroundDirty(dirty, k);
    for (const k of this.groundPaint) if (!paint.has(k)) this._markGroundDirty(dirty, k);
    for (const k of paint) if (!this.groundPaint.has(k)) this._markGroundDirty(dirty, k);
    for (const k of this.groundFieldTiles) if (!fieldTiles.has(k)) this._markGroundDirty(dirty, k);
    for (const k of fieldTiles) if (!this.groundFieldTiles.has(k)) this._markGroundDirty(dirty, k);
    for (const id of dirty) {
      this._recycleChunk(this.groundChunks.get(id));
      this.groundChunks.delete(id);
    }

    this.groundRoads = roads;
    this.groundPaint = paint;
    this.groundFieldTiles = fieldTiles;
    this.fieldTiles = fieldTiles;
    this._grassTiles = this._collectGrassTiles(state, roads, paint, fieldTiles);
  }

  // Every tile the wind can move through: open turf with nothing built on it and
  // no road or field on top. Collected once per ground-sync (which only fires
  // when the map actually changes), because the per-frame pass only needs to
  // test membership. Beaches and rock are excluded — grass doesn't grow there.
  //
  // Tiles that will never draw a blade are dropped here rather than per frame:
  // the seed test is the same one _drawGrassWind uses, so pre-filtering it cuts
  // the per-frame list to roughly a third of the turf on the map.
  _collectGrassTiles(state, roads, paint, fieldTiles) {
    const occupied = new Set();
    for (const o of state.objects) {
      for (let y = o.y; y < o.y + o.d; y++) {
        for (let x = o.x; x < o.x + o.w; x++) occupied.add(key(x, y));
      }
    }
    const out = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const k = key(x, y);
        if (roads.has(k) || paint.has(k) || fieldTiles.has(k) || occupied.has(k)) continue;
        if (terrainAt(x, y) !== 'grass') continue;
        const seed = hash(x, y, 211);
        if (seed > 0.2) continue;
        out.push({ x, y, seed });
      }
    }
    return out;
  }

  _surfaceFill(state, x, y) {
    const k = key(x, y);
    if (state.roads[k]) return ROAD_FILL;
    if (state.paint[k]) return PAVE_FILL;
    if (this.fieldTiles.has(k)) return SOIL_FILL;
    return SURFACE_FILL[terrainAt(x, y)] || SURFACE_FILL.grass;
  }

  _bakeGroundChunk(cx, cy, state) {
    this._bakes++;
    let canvas = this._chunkPool.pop();
    if (!canvas) {
      canvas = document.createElement('canvas');
      this._chunkAllocs++;
    }
    // A pooled surface is only trusted to be a canvas, not to still be the size
    // it was when it left: baking into a shrunk one silently produces a chunk
    // that reads back blank, and the repair loop then bakes it again forever.
    if (canvas.width !== GROUND_CHUNK_W || canvas.height !== GROUND_CHUNK_H) {
      canvas.width = GROUND_CHUNK_W;
      canvas.height = GROUND_CHUNK_H;
    }
    const g = canvas.getContext('2d');
    if (!g) {
      this._chunkPool.push(canvas);
      this._bakeFailAt = performance.now();
      return null;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, GROUND_CHUNK_W, GROUND_CHUNK_H);

    const x0 = cx * GROUND_CHUNK;
    const y0 = cy * GROUND_CHUNK;
    const originX = (x0 - y0 - GROUND_CHUNK) * HALF_W;
    const originY = (x0 + y0) * HALF_H;
    const bs = 1 / this.data.scale;
    const transitionTiles = [];

    for (let y = y0; y < Math.min(MAP_H, y0 + GROUND_CHUNK); y++) {
      for (let x = x0; x < Math.min(MAP_W, x0 + GROUND_CHUNK); x++) {
        const meta = this._meta(this._groundKey(state, x, y, this.fieldTiles));
        if (meta) {
          g.drawImage(
            this.images[meta.p], meta.x, meta.y, meta.w, meta.h,
            (x - y) * HALF_W - meta.ax * bs - originX,
            (x + y) * HALF_H - meta.ay * bs - originY,
            meta.w * bs, meta.h * bs,
          );
        }
        const decalKey = this._seabedDecal(state, x, y);
        const decal = decalKey && this._meta(decalKey);
        if (decal) {
          g.drawImage(
            this.images[decal.p], decal.x, decal.y, decal.w, decal.h,
            (x - y) * HALF_W - decal.ax * bs - originX,
            (x + y) * HALF_H - decal.ay * bs - originY,
            decal.w * bs, decal.h * bs,
          );
        }
        if (!state.roads[key(x, y)] && !state.paint[key(x, y)] && !this.fieldTiles.has(key(x, y))) {
          transitionTiles.push(x, y);
        }
      }
    }

    for (let i = 0; i < transitionTiles.length; i += 2) {
      const x = transitionTiles[i];
      const y = transitionTiles[i + 1];
      const from = terrainAt(x, y);
      let groups = null;
      for (const [nx, ny, bit] of [[x, y - 1, 1], [x + 1, y, 2], [x, y + 1, 4], [x - 1, y, 8]]) {
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        const nk = key(nx, ny);
        if (state.roads[nk] || state.paint[nk] || this.fieldTiles.has(nk)) continue;
        const family = terrainEdgeFamily(from, terrainAt(nx, ny));
        if (!family) continue;
        if (!groups) groups = new Map();
        groups.set(family, (groups.get(family) || 0) | bit);
      }
      if (!groups) continue;
      for (const [family, mask] of groups) {
        const meta = this._meta(`g:edge:${family}:${mask}`);
        if (!meta) continue;
        g.drawImage(
          this.images[meta.p], meta.x, meta.y, meta.w, meta.h,
          (x - y) * HALF_W - meta.ax * bs - originX,
          (x + y) * HALF_H - meta.ay * bs - originY,
          meta.w * bs, meta.h * bs,
        );
      }
    }
    return canvas;
  }

  // Off-screen chunks keep their canvas available for the next bake instead of
  // handing it to the GC. Capped so the pool never becomes the memory problem
  // it exists to prevent.
  _recycleChunk(canvas) {
    if (!canvas) return;
    if (this._chunkPool.length < CHUNK_POOL_MAX) this._chunkPool.push(canvas);
  }

  // Baked chunks hold atlas pixels at the resolution they were baked with, so
  // an atlas swap has to drop them or the old copy stays on screen.
  dropGroundChunks() {
    for (const chunk of this.groundChunks.values()) this._recycleChunk(chunk);
    this.groundChunks.clear();
    this._chunkRepair.length = 0;
    this._sceneForce = true;
    this._glWorldKey = '';
  }

  // Stand-in for a chunk this frame's bake budget couldn't afford: the same
  // diamond in the flat surface colour, so a swipe slides over plain ground
  // instead of transparent holes until the real chunk lands.
  _drawChunkPlaceholder(cx, cy, state) {
    const x0 = cx * GROUND_CHUNK;
    const y0 = cy * GROUND_CHUNK;
    const x1 = Math.min(MAP_W, x0 + GROUND_CHUNK);
    const y1 = Math.min(MAP_H, y0 + GROUND_CHUNK);
    const a = this.tileToScreen(x0, y0);
    const b = this.tileToScreen(x1, y0);
    const c = this.tileToScreen(x1, y1);
    const d = this.tileToScreen(x0, y1);
    const ctx = this.ctx;
    ctx.fillStyle = this._surfaceFill(state, (x0 + x1) >> 1, (y0 + y1) >> 1);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
    ctx.closePath();
    ctx.fill();
  }

  // Wind over the grass, read as light rather than as blades.
  //
  // Two attempts at drawing individual blades both failed for the same reason:
  // the turf already has its own per-tile speckle baked in, so a stroke at the
  // same scale doesn't read as grass — vertical ones looked like confetti, and
  // isometric ones looked like white pins stuck in the lawn. Fighting an
  // existing texture with more texture just dirties it.
  //
  // So the motion is a wave of shading: a broad, soft band drifting along the
  // isometric axis, slightly darker where it passes so the field looks brushed.
  // That is the one scale the baked speckle doesn't already occupy, and it is
  // what actually sells "wind" at a glance. Cost is one gradient fill, same
  // technique as the cloud shadows, and it scales with the viewport rather than
  // the tile count.
  _drawGrassWind() {
    if (!this._grassTiles || !this._grassTiles.length) return;
    const zoom = this.cam.zoom;
    if (zoom < 0.5) return;
    // Three full-screen multiply bands every frame. This is the only thing that
    // gives the turf depth — without it the field reads as flat paper — so it
    // stays on every platform, phone included.
    const ctx = this.ctx;
    const t = this.time;

    // Drawn between the ground and the water overlays, so the sea covers it
    // without needing a clip path — cheaper than building one, and water already
    // repaints this area every frame.
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const band = (cx, cy, rx, ry, rot, alpha) => {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.scale(1, ry / rx);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
      g.addColorStop(0, `rgba(104, 140, 92, ${alpha})`);
      g.addColorStop(0.55, `rgba(130, 166, 112, ${alpha * 0.45})`);
      g.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, rx, 0, TAU);
      ctx.fill();
      ctx.restore();
    };
    // The bands travel along the 2:1 axis, so the gust reads as running down the
    // island rather than sliding across the monitor.
    const span = Math.max(this.viewW, this.viewH) * 1.6;
    const z = clamp(zoom, 0.75, 1.2);
    for (let i = 0; i < 3; i++) {
      const bx = ((t * (26 + i * 9) + (i * span) / 3) % (span * 1.3)) - span * 0.15;
      const by = this.viewH * (0.18 + i * 0.3) + (bx - this.viewW / 2) * 0.21
        + Math.sin(t * 0.11 + i * 1.7) * 22;
      band(bx, by, (170 + i * 54) * z, (74 + i * 22) * z, 0.46, 0.1);
    }
    ctx.restore();
  }

  _drawGround(state, fullBake = false) {
    const ctx = this.ctx;
    const sig = this._groundSignature(state);
    if (sig !== this.groundSig) {
      this.groundSig = sig;
      this._syncGroundState(state);
    }

    const now = performance.now();
    if (this._healAt && now >= this._healAt) {
      this._healAt = 0;
      for (const id of this.groundChunks.keys()) {
        if (!this._chunkRepair.includes(id)) this._chunkRepair.push(id);
      }
    }

    const zoom = this.cam.zoom;
    const w = GROUND_CHUNK_W * zoom;
    const h = GROUND_CHUNK_H * zoom;
    const keep = this._chunkKeep;
    keep.clear();
    // A fast pan can need a dozen fresh blocks in one frame. Baking them all at
    // once is what turns a swipe into a multi-second stall on a phone, so touch
    // devices get a budget and a flat placeholder for the rest. A scene rebuild
    // is the exception: it is the one moment where a complete static stack is
    // worth the stall, because the cache then holds it until the map changes.
    let budget = TOUCH && !fullBake ? CHUNK_BAKE_PER_FRAME : Infinity;
    const bakeBlocked = this._bakeFailAt && now - this._bakeFailAt < CHUNK_BAKE_RETRY_MS;
    for (let cy = 0; cy < GROUND_CHUNK_ROWS; cy++) {
      for (let cx = 0; cx < GROUND_CHUNK_COLS; cx++) {
        const x0 = cx * GROUND_CHUNK;
        const y0 = cy * GROUND_CHUNK;
        const originX = (x0 - y0 - GROUND_CHUNK) * HALF_W;
        const originY = (x0 + y0) * HALF_H;
        const p = this.worldToScreen(originX, originY);
        // Half a chunk of overscan so a slow pan finds the next block already
        // baked, without keeping a second ring of retina-sized canvases alive.
        if (p.x + w < -w * 0.5 || p.y + h < -h * 0.5
          || p.x > this.viewW + w * 0.5 || p.y > this.viewH + h * 0.5) continue;
        const id = cy * GROUND_CHUNK_COLS + cx;
        let chunk = this.groundChunks.get(id);
        if (!chunk) {
          if (budget <= 0 || bakeBlocked) {
            this._drawChunkPlaceholder(cx, cy, state);
            continue;
          }
          budget -= 1;
          chunk = this._bakeGroundChunk(cx, cy, state);
          if (!chunk) continue;
          this.groundChunks.set(id, chunk);
        }
        keep.add(id);
        ctx.drawImage(chunk, p.x, p.y, w, h);
      }
    }

    this._auditGround();
    this._repairGround(state, fullBake);
    // Anything out of frame is droppable: touch webviews cap how much canvas
    // memory a page may keep, and holding the whole map is what gets the rest
    // of it reclaimed.
    for (const [id, chunk] of this.groundChunks) {
      if (keep.has(id)) continue;
      this._recycleChunk(chunk);
      this.groundChunks.delete(id);
    }

    // Soft daylight map: one warm pool near the town, cool falloff at the
    // island edges. Cheaper than per-tile gradients and it never bands. Built
    // once per camera/viewport state: creating a full-screen gradient object
    // every frame shows up as a real cost on a phone doing software raster.
    ctx.save();
    const poolKey = `${Math.round(this.viewW)}|${Math.round(this.viewH)}|${this.cam.zoom.toFixed(2)}`;
    if (!this._poolGrad || this._poolKey !== poolKey) {
      const c0 = this.tileToScreen(MAP_W / 2, MAP_H / 2);
      const pool = ctx.createRadialGradient(
        c0.x, c0.y - 110 * this.cam.zoom, 40 * this.cam.zoom,
        c0.x, c0.y, Math.max(this.viewW, this.viewH) * 0.85,
      );
      pool.addColorStop(0, 'rgba(255, 238, 160, 0.14)');
      pool.addColorStop(0.5, 'rgba(255, 240, 170, 0.03)');
      pool.addColorStop(1, 'rgba(36, 92, 58, 0.14)');
      this._poolGrad = pool;
      this._poolKey = poolKey;
    }
    ctx.fillStyle = this._poolGrad;
    ctx.fillRect(0, 0, this.viewW, this.viewH);
    ctx.restore();

    // Rim light on the island edge.
    ctx.save();
    ctx.strokeStyle = 'rgba(226, 229, 196, 0.13)';
    ctx.lineWidth = 1.3;
    this._diamondPath(0, 0, MAP_W, MAP_H);
    ctx.stroke();
    ctx.restore();
    return this.fieldTiles;
  }

  // A chunk the browser reclaimed under memory pressure comes back as a fully
  // transparent surface rather than throwing, which shows up as chunk-shaped
  // holes in the map while the rest of the game keeps running. Probe the cached
  // chunks on a timer and queue a fresh copy for any that lost its pixels.
  _auditGround() {
    const now = performance.now();
    if (now - this._chunkAuditAt < (TOUCH ? CHUNK_AUDIT_MS_TOUCH : CHUNK_AUDIT_MS)) return;
    this._chunkAuditAt = now;
    const ids = [...this._chunkKeep];
    const n = ids.length;
    if (!n) return;
    // A slice per cycle: reading a GPU-backed canvas forces a pipeline sync, so
    // sweeping the whole view at once would land as a visible hitch.
    const limit = Math.min(n, TOUCH ? CHUNK_AUDIT_MAX_TOUCH : CHUNK_AUDIT_MAX);
    for (let i = 0; i < limit; i++) {
      const id = ids[(this._chunkAuditCursor + i) % n];
      const chunk = this.groundChunks.get(id);
      if (chunk && !this._chunkBlank(chunk)) continue;
      if (!this._chunkRepair.includes(id)) this._chunkRepair.push(id);
    }
    this._chunkAuditCursor = (this._chunkAuditCursor + limit) % n;
  }

  // One repair per frame: a from-scratch bake is cheap, but when the atlas has
  // to be re-decoded a batch of them would read as a freeze. A scene rebuild
  // already pays the stall, so it clears the queue in one pass.
  _repairGround(state, all = false) {
    while (this._chunkRepair.length) {
      if (!this._repairChunk(state)) break;
      if (!all) break;
      if (this._bakeFailAt && performance.now() - this._bakeFailAt < CHUNK_BAKE_RETRY_MS) break;
    }
  }

  _repairChunk(state) {
    if (this._bakeFailAt && performance.now() - this._bakeFailAt < CHUNK_BAKE_RETRY_MS) return false;
    const id = this._chunkRepair.shift();
    if (!this._chunkKeep.has(id)) return true;
    const cx = id % GROUND_CHUNK_COLS;
    const cy = (id - cx) / GROUND_CHUNK_COLS;
    const fresh = this._bakeGroundChunk(cx, cy, state);
    if (!fresh) {
      // A canvas that failed to bake is worth another try later, not a chunk
      // that silently stays broken for the rest of the session.
      if (this._chunkKeep.has(id)) this._chunkRepair.push(id);
      return false;
    }
    this._repairs++;
    const stale = this.groundChunks.get(id);
    this.groundChunks.set(id, fresh);
    // The queue only ever holds a chunk the probe found empty, so this is a
    // surface the driver already took away once. Reusing it is how one eviction
    // turns into a repair loop, so it is released instead of pooled.
    if (stale && stale !== fresh) {
      stale.width = 1;
      stale.height = 1;
    }
    const p = this.worldToScreen(
      (cx * GROUND_CHUNK - cy * GROUND_CHUNK - GROUND_CHUNK) * HALF_W,
      (cx * GROUND_CHUNK + cy * GROUND_CHUNK) * HALF_H,
    );
    this.ctx.drawImage(fresh, p.x, p.y, GROUND_CHUNK_W * this.cam.zoom, GROUND_CHUNK_H * this.cam.zoom);
    return true;
  }

  // Chunk holes have to heal while the camera is parked too. The audit used to
  // run only inside a scene rebuild, so a reclaimed surface stayed a hole in the
  // cached composite until the next pan, and the healed chunk never reached the
  // screen because nothing rebuilt the stack that still had the hole in it.
  _healGround(state) {
    const queued = this._chunkRepair.length;
    this._auditGround();
    if (this._chunkRepair.length === queued) return;
    this._repairGround(state);
    this._sceneForce = true;
  }

  _chunkBlank(chunk) {
    // Downscale into a small software canvas instead of reading the chunk
    // directly: a GPU-backed canvas warns on every readback, and the blank case
    // is all-transparent anyway, so one centre sample is enough.
    let probe = this._chunkProbe;
    if (!probe) {
      probe = document.createElement('canvas');
      probe.width = 64;
      probe.height = 32;
      this._chunkProbe = probe;
      this._chunkProbeCtx = probe.getContext('2d', { willReadFrequently: true });
      if (!this._chunkProbeCtx) return false;
      // A cleared chunk draws as fully transparent, which source-over would
      // leave the previous probe untouched — copy replaces instead.
      this._chunkProbeCtx.globalCompositeOperation = 'copy';
    }
    const g = this._chunkProbeCtx;
    g.drawImage(chunk, 0, 0, chunk.width, chunk.height, 0, 0, probe.width, probe.height);
    // A healthy chunk's centre is opaque terrain; anything well under full alpha
    // means the surface was reclaimed or came back partial. An all-but-black
    // sample is the other way a lost atlas texture shows up — it baked a real
    // chunk, so alpha alone would keep it forever.
    const d = g.getImageData(probe.width >> 1, probe.height >> 1, 1, 1).data;
    return d[3] < 200 || d[0] + d[1] + d[2] < 24;
  }

  // Readback sweep for the on-screen diagnostics panel. Every probe is a GPU
  // sync, so the panel takes a rotating sample instead of the whole view: a
  // full sweep costs a few hundred ms on a phone and would show up as the very
  // frame drops it is supposed to explain.
  blankVisible(sample = 3) {
    const ids = [...this._chunkKeep];
    const n = ids.length;
    if (!n) return 0;
    const take = Math.min(n, sample);
    let blank = 0;
    for (let i = 0; i < take; i++) {
      const chunk = this.groundChunks.get(ids[(this._blankCursor + i) % n]);
      if (!chunk || this._chunkBlank(chunk)) blank++;
    }
    this._blankCursor = (this._blankCursor + take) % n;
    this._blankSample = take;
    return blank;
  }

  stats() {
    const pages = (this.data.pages || []).map((p) => `${p.width}x${p.height}`);
    const atlasPx = (this.data.pages || []).reduce((n, p) => n + p.width * p.height, 0);
    return {
      chunks: this.groundChunks.size,
      visible: this._chunkKeep.size,
      pool: this._chunkPool.length,
      atlasMB: Math.round((atlasPx * 4) / 1048576),
      bakes: this._bakes,
      repairs: this._repairs,
      allocs: this._chunkAllocs,
      queued: this._chunkRepair.length,
      blankSample: this._blankSample,
      sceneMB: this._sceneA
        ? Math.round((this._sceneA.width * this._sceneA.height * 4) / 1048576)
        : 0,
      sceneLost: this._sceneLost ? 1 : 0,
      gl: this.useGL ? 1 : 0,
      glLost: this.glStage.lost ? 1 : 0,
      // Whether WebGL ever ran, and how long the current silence has lasted: a
      // phone report has to separate "never came up" from "died after a minute",
      // because those need different fixes and only one video arrives per build.
      glUp: this.glStage.bornAt ? Math.round((performance.now() - this.glStage.bornAt) / 1000) : 0,
      glLostFor: this.glStage.lostAt ? Math.round((performance.now() - this.glStage.lostAt) / 1000) : 0,
      glRestores: this.glStage.restores,
      glSwaps: this.glStage.swaps,
      glDraws: this.glStage.drawCalls,
      glUpBytes: this.glStage.upBytes,
      glArrLayers: this.glStage.layerCount,
      canvas: `${this.canvas.width}x${this.canvas.height}`,
      view: `${Math.round(this.viewW)}x${Math.round(this.viewH)}`,
      dpr: this.dpr,
      zoom: this.cam.zoom,
      camX: Math.round(this.cam.x),
      camY: Math.round(this.cam.y),
      pages,
    };
  }

  // Water is baked into the ground chunks, so all motion is an overlay. Instead
  // of one random crest per tile (which read as scattered dashes), the overlay
  // traces contours of two smooth fields:
  //   crest = sin(shore distance * k + time)  -> wave lines rolling shoreward
  //   wash  = distance - animated offset      -> surf line advancing/retreating
  // Both fields are sampled on tile corners, so a marching-squares segment
  // crosses tile borders without a seam and never leaves its own diamond.
  _waterFxTiles() {
    if (this._waterTiles) return this._waterTiles;
    this._buildWaterFields();
    const tiles = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const terrain = terrainAt(x, y);
        if (terrain !== 'water' && terrain !== 'deep') continue;
        const d = this._waterField.dist[y * MAP_W + x];
        tiles.push({
          x,
          y,
          k: key(x, y),
          deep: terrain === 'deep',
          dist: d,
          flow: terrain === 'water' && x < 20,
          variant: Math.floor(hash(x, y, 71) * (terrain === 'deep' ? 2 : 3)),
          anim: x * 0.4 + y * 0.22,
        });
      }
    }
    this._waterTiles = tiles;
    return tiles;
  }

  // Multi-source BFS from every non-water tile gives each water tile its
  // distance to the nearest bank. Sampling the average of the four adjacent
  // tiles at each corner turns that integer field into a smooth one, which is
  // what keeps the wave lines parallel to the coast instead of snapped to the
  // grid. The wobble is a fixed trig field: continuous, cheap, no allocation.
  _buildWaterFields() {
    if (this._waterField) return;
    const dist = new Float32Array(MAP_W * MAP_H).fill(-1);
    const queue = [];
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const terrain = terrainAt(x, y);
        if (terrain === 'water' || terrain === 'deep') continue;
        dist[y * MAP_W + x] = 0;
        queue.push(y * MAP_W + x);
      }
    }
    for (let qi = 0; qi < queue.length; qi++) {
      const i = queue[qi];
      const x = i % MAP_W;
      const y = (i / MAP_W) | 0;
      const nd = dist[i] + 1;
      const visit = (j) => {
        if (dist[j] < 0 || dist[j] > nd) {
          dist[j] = nd;
          queue.push(j);
        }
      };
      if (x > 0) visit(i - 1);
      if (x < MAP_W - 1) visit(i + 1);
      if (y > 0) visit(i - MAP_W);
      if (y < MAP_H - 1) visit(i + MAP_W);
    }

    const W = MAP_W + 1;
    const H = MAP_H + 1;
    const size = W * H;
    let corner = new Float32Array(size);
    const wob = new Float32Array(size);
    for (let cy = 0; cy < H; cy++) {
      for (let cx = 0; cx < W; cx++) {
        let sum = 0;
        let n = 0;
        for (let oy = -1; oy <= 0; oy++) {
          for (let ox = -1; ox <= 0; ox++) {
            const tx = cx + ox;
            const ty = cy + oy;
            if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) continue;
            sum += dist[ty * MAP_W + tx];
            n++;
          }
        }
        const i = cy * W + cx;
        corner[i] = n ? sum / n : 0;
        wob[i] = Math.sin(cx * 0.31 + cy * 0.19 + 0.7) * 0.5
          + Math.sin(cx * 0.11 - cy * 0.27 + 2.1) * 0.34;
      }
    }
    // Relax the integer distance steps; without this the wave contours follow
    // the tile grid as visible right angles.
    for (let pass = 0; pass < 2; pass++) {
      const next = new Float32Array(size);
      for (let cy = 0; cy < H; cy++) {
        for (let cx = 0; cx < W; cx++) {
          let sum = 0;
          let n = 0;
          for (let oy = -1; oy <= 1; oy++) {
            for (let ox = -1; ox <= 1; ox++) {
              const tx = cx + ox;
              const ty = cy + oy;
              if (tx < 0 || ty < 0 || tx >= W || ty >= H) continue;
              sum += corner[ty * W + tx];
              n++;
            }
          }
          next[cy * W + cx] = sum / n;
        }
      }
      corner = next;
    }
    this._waterField = {
      dist,
      corner,
      wob,
      wash: new Float32Array(size),
    };
  }

  _updateWaterFields(t) {
    const f = this._waterField;
    const { corner, wob, wash } = f;
    for (let i = 0; i < corner.length; i++) {
      wash[i] = corner[i] - (1.15 + 0.34 * Math.sin(t * 1.8 + wob[i] * 0.9));
    }
  }

  // Soft moving light/dark patches. They are drawn through a water-only clip
  // path, so the gradient can be big and smooth and still never spill onto the
  // beach. The path only changes when the camera or a bridge/paint edit does.
  _waterClip(state) {
    const sig = `${this.cam.x.toFixed(1)}|${this.cam.y.toFixed(1)}|${this.cam.zoom.toFixed(3)}`
      + `|${this.viewW}|${this.viewH}|${this.groundRoads.size}|${this.groundPaint.size}`;
    if (this._waterClipSig === sig) return this._waterClipPath;
    const path = new Path2D();
    const hw = HALF_W * this.cam.zoom;
    const hh = HALF_H * this.cam.zoom;
    for (const tile of this._waterFxTiles()) {
      if (state.roads[tile.k] || state.paint[tile.k]) continue;
      const p = this.tileToScreen(tile.x, tile.y);
      if (!this.isOnScreen(p.x, p.y, 120)) continue;
      path.moveTo(p.x, p.y);
      path.lineTo(p.x + hw, p.y + hh);
      path.lineTo(p.x, p.y + hh * 2);
      path.lineTo(p.x - hw, p.y + hh);
      path.closePath();
    }
    this._waterClipSig = sig;
    this._waterClipPath = path;
    return path;
  }

  _drawWaterSheen(state) {
    const ctx = this.ctx;
    const t = this.time;
    const zoom = this.cam.zoom;
    const path = this._waterClip(state);
    ctx.save();
    ctx.clip(path);
    // Same trick as the cloud shadows: the four blobs differ only in colour,
    // alpha and radius, so the gradient objects are built once and scaled.
    const unitGrad = (light, alpha) => {
      const key = `${light ? 1 : 0}:${alpha}`;
      this._sheenGrads = this._sheenGrads || new Map();
      let g = this._sheenGrads.get(key);
      if (!g) {
        g = ctx.createRadialGradient(0, 0, 0.15, 0, 0, 1);
        const c = light ? '190, 236, 226' : '16, 62, 78';
        g.addColorStop(0, `rgba(${c}, ${alpha})`);
        g.addColorStop(0.6, `rgba(${c}, ${alpha * 0.55})`);
        g.addColorStop(1, `rgba(${c}, 0)`);
        this._sheenGrads.set(key, g);
      }
      return g;
    };
    const blob = (tx, ty, radius, light, alpha) => {
      const p = this.tileToScreen(tx, ty);
      const r = radius * HALF_W * zoom;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(r, r);
      ctx.fillStyle = unitGrad(light, alpha);
      ctx.fillRect(-1, -1, 2, 2);
      ctx.restore();
    };
    // Anchored in tile space so the patches stay with the water while the
    // camera pans; the slow sine drift keeps their edges moving.
    blob(56 + Math.sin(t * 0.16) * 5, 22 + Math.cos(t * 0.13) * 4, 15, true, 0.075);
    blob(67 + Math.cos(t * 0.11) * 6, 33 + Math.sin(t * 0.15) * 5, 13, false, 0.06);
    blob(48 + Math.sin(t * 0.12 + 2) * 4, 30 + Math.cos(t * 0.1 + 1) * 5, 10, true, 0.055);
    blob(8 + Math.sin(t * 0.14 + 1) * 2, 44 + Math.cos(t * 0.12) * 6, 6, true, 0.055);
    ctx.restore();
  }

  // Animated surface tiles. These are transparent 3-frame overlays, so the
  // motion costs one drawImage per visible water tile and never touches the
  // baked ground chunks or the save file. Coverage stays low so the open
  // shallows read as calm water instead of a field of identical tildes; the
  // river keeps a little more texture because it is narrow and in flow.
  _drawWaterSurface(state) {
    const ctx = this.ctx;
    const s = this.cam.zoom / this.data.scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const tile of this._waterFxTiles()) {
      if (state.roads[tile.k] || state.paint[tile.k]) continue;
      const cover = tile.flow ? 0.46 : tile.deep ? 0.4 : 0.24;
      if (hash(tile.x, tile.y, 73) > cover) continue;
      const p = this.tileToScreen(tile.x, tile.y);
      if (!this.isOnScreen(p.x, p.y, 96)) continue;
      const f = Math.floor(this.time * 4.5 + tile.anim) % 3;
      const meta = this._meta(tile.deep ? `fx:deep:${tile.variant}:${f}` : `fx:water:${tile.variant}:${f}`);
      if (!meta) continue;
      ctx.globalAlpha = tile.deep ? 0.85 : 1;
      ctx.drawImage(
        this.images[meta.p], meta.x, meta.y, meta.w, meta.h,
        p.x - meta.ax * s, p.y - meta.ay * s, meta.w * s, meta.h * s,
      );
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // Geometry for the coast dashes, shared by the canvas renderer and the GL
  // pre stage. Four parallel arrays of screen-space segments; the callers only
  // differ in how they paint them (round strokes vs. quads).
  _waterFxContours(state) {
    const tiles = this._waterFxTiles();
    const t = this.time;
    const zoom = this.cam.zoom;
    const wscale = clamp(zoom, 0.55, 1.4);
    const paths = this._waterPaths
      || (this._waterPaths = {
        foam: [], spark: [], flow: [], leaf: [],
      });
    for (const k of Object.keys(paths)) paths[k].length = 0;
    if (!tiles.length) return paths;

    this._updateWaterFields(t);
    const f = this._waterField;
    const W = MAP_W + 1;
    const pts = this._waterPts || (this._waterPts = new Float32Array(16));
    // Contours are cut into short dashes with a slowly drifting mask. A solid
    // line around the coast reads as a drawn outline; broken patches read as
    // foam and keep the wave direction without looking cartographic.
    const pushContour = (field, i0, i1, i2, i3, cx0, cy0, cx1, cy1, cx2, cy2, cx3, cy3, out, parts, keep) => {
      const f0 = field[i0];
      const f1 = field[i1];
      const f2 = field[i2];
      const f3 = field[i3];
      let n = 0;
      const edge = (fa, fb, ax, ay, bx, by) => {
        if ((fa <= 0) === (fb <= 0)) return;
        const q = fa / (fa - fb);
        pts[n++] = ax + (bx - ax) * q;
        pts[n++] = ay + (by - ay) * q;
      };
      edge(f0, f1, cx0, cy0, cx1, cy1);
      edge(f1, f2, cx1, cy1, cx2, cy2);
      edge(f2, f3, cx2, cy2, cx3, cy3);
      edge(f3, f0, cx3, cy3, cx0, cy0);
      const dash = (ax, ay, bx, by) => {
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy);
        if (len < 2) return;
        const ux = dx / len;
        const uy = dy / len;
        for (let i = 0; i < parts; i++) {
          const mid = (i + 0.5) / parts;
          const mx = ax + dx * mid;
          const my = ay + dy * mid;
          const mask = Math.sin(mx * 0.041 + my * 0.028 + t * 0.85)
            + Math.sin(mx * 0.019 - my * 0.047 + t * 0.55);
          if (mask < keep) continue;
          const span = (len / parts)
            * (0.42 + (Math.sin(mx * 0.19 + my * 0.23) * 0.5 + 0.5) * 0.34);
          out.push(mx - ux * span * 0.5, my - uy * span * 0.5,
            mx + ux * span * 0.5, my + uy * span * 0.5);
        }
      };
      if (n === 4) dash(pts[0], pts[1], pts[2], pts[3]);
      else if (n === 8) {
        dash(pts[0], pts[1], pts[2], pts[3]);
        dash(pts[4], pts[5], pts[6], pts[7]);
      }
    };

    for (const tile of tiles) {
      if (state.roads[tile.k] || state.paint[tile.k]) continue;
      const p = this.tileToScreen(tile.x + 0.5, tile.y + 0.5);
      if (!this.isOnScreen(p.x, p.y, 64)) continue;
      const x = tile.x;
      const y = tile.y;
      const i00 = y * W + x;
      const i10 = y * W + x + 1;
      const i11 = (y + 1) * W + x + 1;
      const i01 = (y + 1) * W + x;
      const cx0 = p.x;
      const cy0 = p.y - HALF_H * zoom;
      const cx1 = p.x + HALF_W * zoom;
      const cy1 = p.y;
      const cx2 = p.x;
      const cy2 = p.y + HALF_H * zoom;
      const cx3 = p.x - HALF_W * zoom;
      const cy3 = p.y;

      if (tile.dist < 1.8) {
        pushContour(f.wash, i00, i10, i11, i01, cx0, cy0, cx1, cy1, cx2, cy2, cx3, cy3,
          paths.foam, 4, 0.55);
      }

      // Twinkles: the static base art only hints at glints, the actual sparkle
      // comes from short screen-space dashes that fade with a slow sine.
      const sp = hash(x, y, 23);
      if (sp > 0.9) {
        const tw = Math.sin(t * 1.9 + sp * 40 + x * 0.7 + y * 0.4);
        if (tw > 0.82) {
          const gx = p.x + (hash(x, y, 31) - 0.5) * 34 * zoom;
          const gy = p.y + (hash(x, y, 32) - 0.5) * 16 * zoom;
          const len = (1.1 + hash(x, y, 33) * 1.6) * wscale;
          paths.spark.push(gx - len, gy, gx + len, gy);
        }
      }

      if (tile.flow) {
        // West river and dock basin: a few streaks and leaves drift downstream,
        // fading out before they reset at the tile border.
        const ph = (t * (0.16 + hash(x, y, 61) * 0.12) + hash(x, y, 62)) % 1;
        if (ph > 0.14 && ph < 0.86) {
          const fx = x + 0.15 + hash(x, y, 63) * 0.7;
          const a = this.tileToScreen(fx, y + ph);
          const b = this.tileToScreen(fx - 0.015, y + ph + 0.2);
          paths.flow.push(a.x, a.y, b.x, b.y);
        }
        if (hash(x, y, 64) > 0.91) {
          const lp = (t * 0.1 + hash(x, y, 65)) % 1;
          if (lp > 0.1 && lp < 0.9) {
            const lx = x + 0.3 + Math.sin(t * 0.7 + hash(x, y, 66) * 6) * 0.18;
            const q = this.tileToScreen(lx, y + lp);
            paths.leaf.push(q.x - 1.2 * wscale, q.y, q.x + 1.2 * wscale, q.y);
          }
        }
      }
    }
    return paths;
  }

  _drawWaterFx(state) {
    const paths = this._waterFxContours(state);
    if (!paths.foam.length && !paths.spark.length && !paths.flow.length && !paths.leaf.length) return;
    const ctx = this.ctx;
    const wscale = clamp(this.cam.zoom, 0.55, 1.4);

    const stroke = (arr, style, width) => {
      if (!arr.length) return;
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 4) {
        ctx.moveTo(arr[i], arr[i + 1]);
        ctx.lineTo(arr[i + 2], arr[i + 3]);
      }
      ctx.stroke();
    };

    ctx.save();
    ctx.lineCap = 'round';
    // Broken surf dashes near the bank; open water is owned by the animated
    // surface sprites, so no contour is ever drawn across the middle.
    stroke(paths.foam, 'rgba(248, 253, 248, 0.3)', Math.max(0.9, 1.3 * wscale));
    stroke(paths.spark, 'rgba(255, 252, 232, 0.45)', Math.max(0.8, 1 * wscale));
    stroke(paths.flow, 'rgba(228, 246, 238, 0.24)', Math.max(0.8, 1 * wscale));
    stroke(paths.leaf, 'rgba(142, 104, 56, 0.5)', Math.max(1, 1.2 * wscale));
    ctx.restore();
  }

  // Fish and gulls are ambient only: they never touch the save file, so they
  // can be rebuilt straight from the terrain the first time they are needed.
  _seaLife() {
    if (this._seaLifeReady) return;
    this._seaLifeReady = true;
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const bed = seabedAt(x, y);
        if (bed !== 'kelp' && bed !== 'reef') continue;
        if (hash(x, y, 41) < 0.79) continue;
        this._schools.push({
          x: x + 0.25 + hash(x, y, 46) * 0.5,
          y: y + 0.25 + hash(x, y, 47) * 0.5,
          n: 4 + Math.floor(hash(x, y, 42) * 3),
          phase: hash(x, y, 43) * TAU,
          speed: (0.35 + hash(x, y, 44) * 0.4) * (hash(x, y, 48) > 0.5 ? 1 : -1),
          radius: 0.1 + hash(x, y, 45) * 0.1,
          k: key(x, y),
        });
      }
    }
    // Gulls work the harbour cove, the coastal shallows and the dock basin.
    const anchors = [
      [50, 22, 3.2, 1.2],
      [54, 27, 2.6, 1.45],
      [47, 26, 2.2, 1.05],
      [60, 18, 3.6, 1.35],
      [66, 34, 2.8, 1.5],
      [11, 57, 3.0, 1.15],
    ];
    this._gulls = anchors.map(([x, y, radius, height], i) => ({
      x, y, radius, height,
      phase: i * 1.31,
      speed: (0.11 + (i % 3) * 0.024) * (i % 2 ? 1 : -1),
    }));
  }

  // A school is a loose ring of dark darts that keeps circling its weed bed.
  // Drawn in tile space so the motion follows the isometric floor.
  _drawSeaFx(state) {
    this._seaLife();
    if (!this._schools.length) return;
    const ctx = this.ctx;
    const t = this.time;
    const zoom = this.cam.zoom;
    const w = clamp(zoom, 0.55, 1.4);
    ctx.save();
    ctx.lineCap = 'round';
    for (const s of this._schools) {
      if (state.roads?.[s.k] || state.paint?.[s.k]) continue;
      const c = this.tileToScreen(s.x, s.y);
      if (!this.isOnScreen(c.x, c.y, 64)) continue;
      const fade = 0.42 + (Math.sin(t * 1.6 + s.phase) * 0.5 + 0.5) * 0.16;
      ctx.strokeStyle = `rgba(8, 40, 50, ${fade.toFixed(3)})`;
      ctx.lineWidth = Math.max(1, 1.35 * w);
      for (let i = 0; i < s.n; i++) {
        const a = t * s.speed + s.phase + (i / s.n) * TAU;
        const fx = s.x + Math.cos(a) * s.radius;
        const fy = s.y + Math.sin(a) * s.radius * 0.6;
        const p = this.tileToScreen(fx, fy);
        const q = this.tileToScreen(
          fx - Math.sin(a) * 0.09 * Math.sign(s.speed),
          fy + Math.cos(a) * 0.054 * Math.sign(s.speed),
        );
        const ang = Math.atan2(p.y - q.y, p.x - q.x);
        const len = 2.4 * w;
        const dx = Math.cos(ang) * len;
        const dy = Math.sin(ang) * len;
        ctx.beginPath();
        ctx.moveTo(p.x - dx, p.y - dy);
        ctx.lineTo(p.x + dx, p.y + dy);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  _drawGulls() {
    this._seaLife();
    const ctx = this.ctx;
    const t = this.time;
    const zoom = this.cam.zoom;
    const w = clamp(zoom, 0.55, 1.5);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const g of this._gulls) {
      const a = t * g.speed + g.phase;
      const gx = g.x + Math.cos(a) * g.radius;
      const gy = g.y + Math.sin(a) * g.radius * 0.62;
      const p = this.tileToScreen(gx, gy, g.height + Math.sin(t * 0.7 + g.phase) * 0.07);
      if (!this.isOnScreen(p.x, p.y, 60)) continue;
      const flap = Math.sin(t * 7.5 + g.phase * 2.3);
      const span = (5.6 + Math.abs(flap) * 1.1) * w;
      const lift = (1.1 + flap * 2.3) * w;
      ctx.beginPath();
      ctx.moveTo(p.x - span, p.y + lift * 0.45);
      ctx.quadraticCurveTo(p.x - span * 0.42, p.y - lift, p.x, p.y);
      ctx.quadraticCurveTo(p.x + span * 0.42, p.y - lift, p.x + span, p.y + lift * 0.45);
      ctx.strokeStyle = 'rgba(54, 76, 86, 0.42)';
      ctx.lineWidth = Math.max(1.4, 3.1 * w);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(252, 252, 242, 0.96)';
      ctx.lineWidth = Math.max(0.9, 1.5 * w);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Slow cloud shadows drift over the island. Screen-space gradients keep it
  // to three fills per frame and still give the map a living, breezy feel.
  _drawCloudShadows() {
    const ctx = this.ctx;
    const zoom = this.cam.zoom;
    const span = Math.max(this.viewW, this.viewH) * 1.8;
    // One unit-radius gradient, scaled per cloud: building three new gradient
    // objects a frame is the expensive part, the transform is free.
    if (!this._cloudGrad) {
      const g = ctx.createRadialGradient(0, 0, 0.12, 0, 0, 1);
      g.addColorStop(0, 'rgba(44, 66, 56, 0.05)');
      g.addColorStop(1, 'rgba(44, 66, 56, 0)');
      this._cloudGrad = g;
    }
    ctx.save();
    for (let i = 0; i < 3; i++) {
      const x = (this.time * (13 + i * 5) + (i * span) / 3) % (span * 1.4) - span * 0.2;
      const y = this.viewH * (0.24 + i * 0.26) + Math.sin(this.time * 0.08 + i * 2.1) * 16;
      const r = (110 + i * 46) * clamp(zoom, 0.7, 1.25);
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(r, r);
      ctx.fillStyle = this._cloudGrad;
      ctx.beginPath();
      ctx.ellipse(0, 0, 1.45, 0.72, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }

  _drawBeerAura(state) {
    const ctx = this.ctx;
    // Simulated time, not wall clock: it is the same number the GL aura reads,
    // so the ?uigl=0 comparison can freeze both on one frame.
    const now = this.time;
    for (const o of state.objects) {
      const buff = defOf(o.type)?.buff;
      if (!buff || !o.connected || (o.buffLeft || 0) <= 0) continue;
      const hx = o.x + o.w / 2;
      const hy = o.y + o.d / 2;
      const center = this.tileToScreen(hx, hy, 0.02);
      if (!this.isOnScreen(center.x, center.y, buff.radius * 40)) continue;
      const pts = [];
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * TAU;
        pts.push(this.tileToScreen(hx + Math.cos(a) * buff.radius, hy + Math.sin(a) * buff.radius, 0.02));
      }
      const pulse = 0.5 + Math.sin(now * 2.2) * 0.5;
      ctx.save();
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.closePath();
      const glow = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, buff.radius * 32);
      glow.addColorStop(0, `rgba(255, 196, 92, ${0.2 + pulse * 0.08})`);
      glow.addColorStop(0.72, 'rgba(255, 196, 92, 0.11)');
      glow.addColorStop(1, 'rgba(255, 196, 92, 0)');
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.setLineDash([7, 5]);
      ctx.lineDashOffset = -now * 14;
      ctx.strokeStyle = `rgba(255, 214, 121, ${0.5 + pulse * 0.25})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawPlots(state, skipVeil = false, skipLabels = false) {
    const ctx = this.ctx;
    const level = state.review?.level || 1;
    const shown = [];
    for (const p of PLOTS) {
      const pts = [
        this.tileToScreen(p.x, p.y),
        this.tileToScreen(p.x + p.w, p.y),
        this.tileToScreen(p.x + p.w, p.y + p.d),
        this.tileToScreen(p.x, p.y + p.d),
      ];
      const cx = (pts[0].x + pts[2].x) / 2;
      const cy = (pts[0].y + pts[2].y) / 2;
      if (!this.isOnScreen(cx, cy, 420)) continue;
      shown.push({ p, pts, cx, cy, locked: !plotUnlocked(state, p) });
    }

    if (!this._hatch) {
      const c = document.createElement('canvas');
      c.width = 16;
      c.height = 16;
      const g = c.getContext('2d');
      g.strokeStyle = 'rgba(70, 84, 70, 0.06)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(-4, 20);
      g.lineTo(20, -4);
      g.stroke();
      this._hatch = c;
      this._hatchByCtx = new WeakMap();
    }
    // The scene cache draws the veil on a second canvas, and a CanvasPattern
    // belongs to the context that made it, so each context gets its own.
    let hatch = this._hatchByCtx.get(ctx);
    if (!hatch) {
      hatch = ctx.createPattern(this._hatch, 'repeat');
      this._hatchByCtx.set(ctx, hatch);
    }

    // Pale mist, not a dark sheet: until the last plot unlocks most of the
    // island is locked, and one dark veil per plot turned a zoomed-out map
    // into what read as a black, broken screen. The terrain stays legible
    // under the fog; the amber dashed frame carries the "locked" message.
    // Every locked plot shares one path, so the fog costs two fills a frame
    // instead of two per plot.
    let anyLocked = false;
    if (!skipVeil) {
      ctx.save();
      ctx.beginPath();
      for (const s of shown) {
        if (!s.locked) continue;
        anyLocked = true;
        const { pts } = s;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
      }
      if (anyLocked) {
        ctx.fillStyle = 'rgba(222, 231, 214, 0.36)';
        ctx.fill();
        ctx.clip();
        ctx.fillStyle = hatch;
        ctx.fill();
      }
      ctx.restore();
    }

    const trace = (pts) => {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
      ctx.closePath();
    };
    ctx.save();
    ctx.setLineDash([7, 6]);
    ctx.strokeStyle = 'rgba(186, 143, 52, 0.62)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (const s of shown) if (s.locked) trace(s.pts);
    ctx.stroke();
    ctx.setLineDash([4, 7]);
    ctx.strokeStyle = 'rgba(242, 238, 221, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const s of shown) if (!s.locked) trace(s.pts);
    ctx.stroke();
    ctx.restore();

    if (skipLabels) return;
    for (const s of shown) {
      if (!s.locked) continue;
      const { p, cx, cy } = s;
      const label = t(`${p.name} · Lv.${p.rank}`);
      const sub = level + 1 >= p.rank ? t('举办美食节晋升后开放') : t(`小镇等级 ${p.rank} 解锁`);
      ctx.save();
      ctx.font = '600 12px "Fusion Pixel", "Microsoft YaHei", monospace';
      const tw = Math.ceil(ctx.measureText(label).width);
      ctx.font = '10px "Fusion Pixel", "Microsoft YaHei", monospace';
      const sw = Math.ceil(ctx.measureText(sub).width);
      const bw = Math.max(tw, sw) + 26;
      const bh = 40;
      const bx = Math.round(cx - bw / 2);
      const by = Math.round(cy - bh / 2 - 8);
      if (!this.isOnScreen(bx + bw / 2, by + bh / 2, 120)) {
        ctx.restore();
        continue;
      }
      ctx.fillStyle = 'rgba(11, 15, 22, 0.82)';
      ctx.fillRect(bx, by, bw, bh);
      ctx.strokeStyle = 'rgba(255, 224, 122, 0.55)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
      const p1 = this._uiTextPos(cx, by + 14, tw, 12, 'center');
      const p2 = this._uiTextPos(cx, by + 29, sw, 10, 'center');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#ffe07a';
      ctx.font = '600 12px "Fusion Pixel", "Microsoft YaHei", monospace';
      ctx.fillText(label, p1.x, p1.y);
      ctx.fillStyle = 'rgba(242, 238, 221, 0.7)';
      ctx.font = '10px "Fusion Pixel", "Microsoft YaHei", monospace';
      ctx.fillText(sub, p2.x, p2.y);
      ctx.restore();
    }
  }

  _drawGrid() {
    const ctx = this.ctx;
    const r = this._visibleTiles();
    const s = this.cam.zoom;
    ctx.save();
    ctx.strokeStyle = 'rgba(242, 238, 221, 0.055)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const a = this.tileToScreen(x, y);
        if (!this.isOnScreen(a.x, a.y, 120)) continue;
        const b = this.tileToScreen(x + 1, y);
        const c = this.tileToScreen(x + 1, y + 1);
        const d = this.tileToScreen(x, y + 1);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(c.x, c.y);
        ctx.lineTo(d.x, d.y);
        ctx.closePath();
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawFootprint(x, y, w, d, color, fillAlpha = 0.16, dash = false) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = fillAlpha;
    ctx.fillStyle = color;
    this._diamondPath(x, y, w, d);
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    if (dash) ctx.setLineDash([5, 4]);
    this._diamondPath(x, y, w, d);
    ctx.stroke();
    ctx.restore();
  }

  // A road ghost can be a whole straight run, so every cell that the run would
  // touch gets a preview sprite. Masks treat the planned line as already laid,
  // otherwise the middle of the preview would render as disconnected stubs.
  _roadGhostCells(state, g) {
    const cells = g.cells && g.cells.length ? g.cells : [[g.x, g.y]];
    const line = g.line && g.line.length ? g.line : cells;
    const planned = new Set(line.map(([x, y]) => key(x, y)));
    const isRoad = (x, y) => !!state.roads[key(x, y)] || planned.has(key(x, y));
    const style = g.style || 'asphalt';
    return cells.map(([x, y]) => {
      let mask = 0;
      if (isRoad(x, y - 1)) mask |= 1;
      if (isRoad(x + 1, y)) mask |= 2;
      if (isRoad(x, y + 1)) mask |= 4;
      if (isRoad(x - 1, y)) mask |= 8;
      const terrain = terrainAt(x, y);
      const skey = terrain === 'water'
        ? `g:bridge:${mask}`
        : terrain === 'ice'
          ? `g:iceRoad:${mask}`
          : roadSpriteKey(style, mask);
      return { x, y, skey };
    });
  }

  _drawGhostGround(state, ui) {
    const g = ui.ghost;
    if (!g) return;
    const ctx = this.ctx;
    const s = this.cam.zoom / this.data.scale;
    const tool = ui.tool;

    if (tool?.kind === 'road' || tool?.kind === 'pave') {
      const ok = g.ok;
      const color = ok ? '#a8dd8f' : '#ef8a67';
      if (tool.kind === 'road') {
        const cells = this._roadGhostCells(state, g);
        for (const c of cells) this._drawFootprint(c.x, c.y, 1, 1, color, 0.26);
        if (ok) {
          for (const c of cells) {
            const meta = this._meta(c.skey);
            if (!meta) continue;
            const a = this.tileToScreen(c.x, c.y);
            this._drawSprite(meta, a.x - meta.ax * s, a.y - meta.ay * s, s, 0.78);
          }
        }
      } else {
        this._drawFootprint(g.x, g.y, 1, 1, color, 0.26);
        const meta = ok ? this._meta('g:pave:0') : null;
        if (meta) {
          const a = this.tileToScreen(g.x, g.y);
          this._drawSprite(meta, a.x - meta.ax * s, a.y - meta.ay * s, s, 0.78);
        }
      }
      return;
    }

    if (tool?.kind === 'demolish') {
      const o = ui.demolishTarget;
      const color = '#ef8a67';
      if (o) this._drawFootprint(o.x, o.y, o.w, o.d, color, 0.3);
      else this._drawFootprint(g.x, g.y, 1, 1, color, 0.3);
      return;
    }

    if (tool?.kind === 'build' || tool?.kind === 'move') {
      const def = tool.kind === 'move'
        ? defOf(state.objects.find((o) => o.id === tool.id)?.type)
        : defOf(tool.type);
      if (!def) return;
      const color = g.ok ? '#a8dd8f' : '#ef8a67';
      this._drawFootprint(g.x, g.y, def.w, def.d, color, g.ok ? 0.2 : 0.3);
      if (def.kind === 'field' && g.ok) {
        const soil = this._meta('g:soil:0');
        if (soil) {
          for (let y = g.y; y < g.y + def.d; y++) {
            for (let x = g.x; x < g.x + def.w; x++) {
              const a = this.tileToScreen(x, y);
              this._drawSprite(soil, a.x - soil.ax * s, a.y - soil.ay * s, s, 0.45);
            }
          }
        }
      }
    }
  }

  // Buildings, fields and fences only change when something is placed or
  // edited. Hash that plus the field growth stage, then keep the sorted list
  // around; only walking customers, animals and the ghost are rebuilt.
  _sceneKey(state) {
    const objs = state.objects;
    let h = ((state.sceneRev || 0) * 31 + objs.length) | 0;
    for (let i = 0; i < objs.length; i++) {
      const o = objs[i];
      const def = defOf(o.type);
      if (!def) continue;
      h = (h * 31 + o.x * 7 + o.y * 13 + (o.rot || 0) * 17 + (o.variant || 0) * 23) | 0;
      h = (h * 31 + (o.built === false ? 0 : 1) * 41) | 0;
      if (def.kind === 'field') h = (h * 31 + fieldStage(o) + 1) | 0;
    }
    return h;
  }

  _fenceMetas(state, o) {
    const out = [];
    const style = RANGE_FENCE_STYLE[o.type] ?? 0;
    for (let side = 0; side < 4; side++) {
      if (this._rangeSideOpen(state, o, side)) continue;
      const meta = this._meta(`f:${o.type}:${style}:${side}`);
      if (meta) out.push(meta);
    }
    return out;
  }

  // A field is one flat patch of ground: bake all its crop tiles into one
  // canvas so a 10x10 field is a single draw instead of ~100. The canvas keeps
  // atlas resolution so crops stay as sharp as the per-tile path, and every
  // tile sprite is offset by its full margin inside it, otherwise the left
  // column gets clipped by the canvas edge.
  _fieldSprite(def, o) {
    const stage = fieldStage(o);
    const parity = (o.x * 3 + o.y * 5) % 2;
    const k = this.data.scale;
    const ck = `${def.crop}:${stage}:${o.w}x${o.d}:${parity}:${k}`;
    const cached = this._fieldSprites.get(ck);
    if (cached) return cached;
    const sample = this._meta(`c:${def.crop}:${stage}:${parity}`);
    if (!sample) return null;
    const mw = sample.w;
    const mh = sample.h;
    const ax = sample.ax;
    const ay = sample.ay;
    const spanW = (o.w + o.d - 2) * HALF_W;
    const spanH = (o.w + o.d - 2) * HALF_H;
    const cw = Math.ceil(spanW * k + mw);
    const ch = Math.ceil(spanH * k + mh);
    const c = document.createElement('canvas');
    c.width = cw;
    c.height = ch;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    for (let dy = 0; dy < o.d; dy++) {
      for (let dx = 0; dx < o.w; dx++) {
        const v = (parity + dx * 3 + dy * 5) % 2;
        const m = this._meta(`c:${def.crop}:${stage}:${v}`);
        if (!m) continue;
        g.drawImage(
          this.images[m.p], m.x, m.y, m.w, m.h,
          (o.d - 1 + dx - dy) * HALF_W * k,
          (dx + dy) * HALF_H * k,
          m.w, m.h,
        );
      }
    }
    const comp = {
      img: c,
      ax: (o.d - 1) * HALF_W + ax / k,
      ay: ay / k,
      iw: cw / k,
      ih: ch / k,
    };
    this._fieldSprites.set(ck, comp);
    return comp;
  }

  _buildStatic(state) {
    const list = [];
    const sales = [];
    for (const o of state.objects) {
      const def = defOf(o.type);
      if (!def) continue;
      if (def.sale) sales.push(o);
      if (def.kind === 'field') {
        // GL decomposes the field into per-tile crop crops (D5), so the baked
        // canvas would be a texture nobody samples. Skip it and keep a marker
        // in the list; the 2D path still needs the composite.
        if (this._glObjStream) {
          list.push({ x: o.x, y: o.y, w: o.w, d: o.d, bias: 0.3, obj: o, field: def });
          continue;
        }
        const comp = this._fieldSprite(def, o);
        if (comp) {
          list.push({
            img: comp.img, ax: comp.ax, ay: comp.ay, iw: comp.iw, ih: comp.ih,
            x: o.x, y: o.y, w: o.w, d: o.d, bias: 0.3, obj: o,
          });
        }
        continue;
      }
      // Only the first tile of a merged paddock shows the facilities; the
      // rest use the plain body so a big field is not four haystacks deep.
      const skey = def.kind === 'range' && !this._rangeIsPrimary(state, o)
        ? `b:${def.sprite}Plain:${o.variant || 0}`
        : spriteKeyFor(o);
      const meta = this._meta(skey);
      if (!meta) continue;
      const item = { meta, x: o.x, y: o.y, w: o.w, d: o.d, bias: 0, obj: o };
      if (def.kind === 'range') item.fences = this._fenceMetas(state, o);
      list.push(item);
    }
    list.sort(sortDrawables);
    this._sales = sales;
    return list;
  }

  _buildList(state, ui) {
    // The field marker only exists while the GL stream owns the sprites, so a
    // fallback to the canvas path must rebuild the static list.
    const key = `${this._sceneKey(state)}|${this._glObjStream ? 1 : 0}`;
    if (key !== this._staticKey) {
      this._staticKey = key;
      this._static = this._buildStatic(state);
    }

    const dyn = [];
    for (const c of state.customers || []) {
      const meta = this._meta(`m:${c.type}:${c.face || 0}:${c.frame}`);
      if (meta) dyn.push({ meta, x: c.x, y: c.y, w: 0.22, d: 0.22, bias: 0.42, customer: c });
    }

    for (const a of this.animals) {
      const meta = this._meta(a.dino ? `a:${a.kind}:${a.face ? 'r' : 'l'}:${a.frame}` : `a:${a.kind}:${a.frame}`);
      if (!meta) continue;
      // Livestock stands in the front yard, so it sorts just above its own
      // barn instead of behind the walls; street props further south still
      // occlude both. The ranch cast adds its local depth so the animals
      // layer correctly inside the enclosure.
      const sk = a.dino
        ? a.base + 0.02 + (a.x - a.ox + a.y - a.oy) * 0.001
        : a.sortBase + 0.02;
      dyn.push({ meta, x: a.x, y: a.y, w: 0.16, d: 0.16, sk });
    }

    const truck = this.ranchTruck;
    if (truck) {
      const q = truck.dir > 0 ? 2 : 0;
      const meta = this._meta(`a:safariTruck:${q}:${truck.frame}`);
      if (meta) {
        dyn.push({
          meta, x: truck.x, y: truck.y, w: 0.6, d: 1.3,
          sk: truck.base + 0.02 + (truck.x - truck.ox + truck.y - truck.oy) * 0.001,
        });
      }
    }

    // The worm is one dynamic drawable anchored to the hole so its tall body
    // sorts against neighbours. The explicit key places it just after the 6x6
    // hole sprite (which shares the same footprint) and before everything
    // south of it. Once the farm is built, the hole sprite moves with it so
    // the farm can stay open in the middle and the puppet still has its pit.
    for (const o of state.objects) {
      if (o.type === 'dinoRanch' || o.type === 'mammothRanch') {
        // The gate, dividers and the south/east rails stand in front of the
        // paddock. Repainting that layer after the cast lets an animal pass
        // behind a rail instead of always covering it.
        const frontKey = o.type === 'dinoRanch' ? 'b:dinoRanchFront:0' : 'b:mammothRanchFront:0';
        const front = this._meta(frontKey);
        if (front) {
          const base = o.x + o.w + o.y + o.d;
          dyn.push({ meta: front, x: o.x, y: o.y, w: o.w, d: o.d, sk: base + 0.5, obj: o });
        }
        continue;
      }
      if (o.type === 'giantOctopus') {
        dyn.push({ x: o.x, y: o.y, w: o.w, d: o.d, sk: o.x + o.w + o.y + o.d + 0.01, octopus: o });
        continue;
      }
      if (o.type === 'wormHole') {
        dyn.push({ x: o.x, y: o.y, w: o.w, d: o.d, sk: o.x + o.w + o.y + o.d + 0.01, worm: o });
        continue;
      }
      if (o.type !== 'wormFarm') continue;
      const holeMeta = this._meta('p:wormHole:0');
      if (holeMeta) {
        const hx = o.x + (o.w - 6) / 2;
        const hy = o.y + (o.d - 6) / 2;
        dyn.push({ meta: holeMeta, x: hx, y: hy, w: 6, d: 6, sk: hx + 6 + hy + 6 });
      }
      dyn.push({ x: o.x, y: o.y, w: o.w, d: o.d, sk: o.x + o.w + o.y + o.d + 0.01, worm: o });
    }

    // The trawler is a runtime overlay, not a saved object: it appears under
    // the lair once the deep-sea harbor is finished, with the hose that feeds
    // it, and vanishes again if the harbor is demolished.
    if (deepSeaHarborBuilt(state)) {
      const meta = this._meta('p:octoShip:0');
      if (meta) {
        const b = OCTO_SHIP_BERTH;
        dyn.push({ meta, x: b.x, y: b.y, w: b.w, d: b.d, sk: b.x + b.w + b.y + b.d, ship: true });
      }
      dyn.push({ x: OCTO_PIPE.x, y: OCTO_PIPE.y, w: 0, d: 0, sk: OCTO_PIPE.endX + OCTO_PIPE.runY - 1, pipe: true });
    }

    const g = ui.ghost;
    if (g && (ui.tool?.kind === 'build' || ui.tool?.kind === 'move') && g.ok) {
      const moving = ui.tool.kind === 'move'
        ? state.objects.find((o) => o.id === ui.tool.id)
        : null;
      const def = moving ? defOf(moving.type) : defOf(ui.tool.type);
      const rot = moving ? (moving.rot || 0) : ui.rot;
      if (def) {
        if (def.kind === 'field') {
          const stage = moving ? fieldStage(moving) : 2;
          for (let y = g.y; y < g.y + def.d; y++) {
            for (let x = g.x; x < g.x + def.w; x++) {
              const skey = `c:${def.crop}:${stage}:${(x * 3 + y * 5) % 2}`;
              const meta = this._meta(skey);
              if (meta) dyn.push({ meta, x, y, w: 1, d: 1, bias: 0.33, ghost: true, obj: null });
            }
          }
        } else {
          const skey = def.sprite ? buildingSpriteKey(def.sprite, 0, rot) : propSpriteKey(def.prop, 0, rot);
          const meta = this._meta(skey);
          if (meta) dyn.push({ meta, x: g.x, y: g.y, w: def.w, d: def.d, bias: 0.01, ghost: true, obj: null });
        }
      }
    }

    if (!dyn.length) return this._static;
    dyn.sort(sortDrawables);
    const stat = this._static;
    const merged = new Array(stat.length + dyn.length);
    let i = 0;
    let j = 0;
    let k = 0;
    while (i < stat.length && j < dyn.length) {
      merged[k++] = sortDrawables(stat[i], dyn[j]) <= 0 ? stat[i++] : dyn[j++];
    }
    while (i < stat.length) merged[k++] = stat[i++];
    while (j < dyn.length) merged[k++] = dyn[j++];
    return merged;
  }

  // A paddock edge is dropped when the tile outside it belongs to a range of
  // the same type, so two ranges join into one continuous field.
  _rangeSideOpen(state, o, side) {
    const same = (x, y) => {
      const v = objectAt(state, x, y);
      return !!(v && v.type === o.type);
    };
    if (side === 0) {
      for (let x = o.x; x < o.x + o.w; x++) if (same(x, o.y - 1)) return true;
    } else if (side === 2) {
      for (let x = o.x; x < o.x + o.w; x++) if (same(x, o.y + o.d)) return true;
    } else if (side === 3) {
      for (let y = o.y; y < o.y + o.d; y++) if (same(o.x - 1, y)) return true;
    } else {
      for (let y = o.y; y < o.y + o.d; y++) if (same(o.x + o.w, y)) return true;
    }
    return false;
  }

  // One look per species: neighbouring paddocks of the same type must match.
  _rangeIsPrimary(state, o) {
    const smaller = (x, y) => {
      const v = objectAt(state, x, y);
      return !!(v && v.type === o.type && (v.y < o.y || (v.y === o.y && v.x < o.x)));
    };
    for (let x = o.x; x < o.x + o.w; x++) {
      if (smaller(x, o.y - 1) || smaller(x, o.y + o.d)) return false;
    }
    for (let y = o.y; y < o.y + o.d; y++) {
      if (smaller(o.x - 1, y) || smaller(o.x + o.w, y)) return false;
    }
    return true;
  }

  // Live animals: two hens per chicken paddock, one cow per cattle paddock.
  // They wander inside their own tile with a 0.4-tile margin from the fence.
  ensureAnimals(state) {
    const ranges = state.objects.filter((o) => defOf(o.type)?.livestock);
    const ranches = state.objects.filter((o) => o.type === 'dinoRanch');
    const mammoths = state.objects.filter((o) => o.type === 'mammothRanch');
    const sig = [
      ...ranges.map((o) => `${o.id}:${o.x}:${o.y}:${o.connected ? 1 : 0}:${o.built === false ? 0 : 1}`),
      ...ranches.map((o) => `r${o.id}:${o.x}:${o.y}:${o.connected ? 1 : 0}:${o.built === false ? 0 : 1}`),
      ...mammoths.map((o) => `m${o.id}:${o.x}:${o.y}:${o.connected ? 1 : 0}:${o.built === false ? 0 : 1}`),
    ].join('|');
    if (sig === this._animalSig) return;
    this._animalSig = sig;
    const list = [];
    for (const o of ranges) {
      const def = defOf(o.type);
      // No animals until the farm is finished and road-connected: an empty
      // yard reads as still under construction.
      if (!o.connected || o.built === false) continue;
      // animalBounds is footprint-relative: it keeps livestock in the yard
      // instead of letting them walk through the barn or factory walls.
      const b = def.animalBounds || { x: 0.45, y: 0.45, w: o.w - 0.9, d: o.d - 0.9 };
      const rx = o.x + b.x;
      const ry = o.y + b.y;
      const rw = Math.max(0.2, b.w);
      const rd = Math.max(0.2, b.d);
      const kinds = new Array(def.animals || 2).fill(def.livestock);
      const sortBase = o.x + o.w + o.y + o.d;
      kinds.forEach((kind, i) => {
        list.push({
          kind,
          rx, ry, rw, rd,
          sortBase,
          x: rx + ((i + 0.4) / kinds.length) * rw,
          y: ry + ((i + 0.6) / kinds.length) * rd,
          tx: 0, ty: 0, walking: false,
          idle: 0.3 + Math.random() * 2.2,
          speed: kind === 'cow' ? 0.18 : 0.34,
          frame: 0, step: 0,
        });
      });
    }
    this.ranchTruck = null;
    for (const o of ranches) {
      if (!o.connected || o.built === false) continue;
      const base = o.x + o.w + o.y + o.d;
      // Paddock-relative boxes keep the cast out of the hatchery, pond, lookout
      // and power shed. The sauropod grazes the south-west corner so its long
      // neck never crosses the lookout cabin, and the carnivores stay east of
      // the divider signs. Local depth is folded into the sort key in _buildList.
      const cast = [
        ['sauropod', 1.55, 6.15, 1.80, 1.55, 0.20],
        ['triceratops', 3.30, 4.55, 1.35, 1.60, 0.24],
        ['theropod', 8.55, 2.90, 2.15, 1.70, 0.42],
        ['raptor', 8.55, 4.90, 2.15, 0.80, 0.56],
        ['raptor', 8.55, 5.95, 2.15, 0.80, 0.56],
      ];
      for (const [kind, bx, by, rw, rd, speed] of cast) {
        list.push({
          dino: true, kind,
          ox: o.x, oy: o.y, base,
          rx: o.x + bx, ry: o.y + by, rw, rd,
          x: o.x + bx + rw * 0.5, y: o.y + by + rd * 0.5,
          tx: 0, ty: 0, walking: false, face: 1,
          idle: 0.4 + Math.random() * 2.2,
          speed, frame: 0, step: 0,
        });
      }
      this.ranchTruck = {
        ox: o.x, oy: o.y, base,
        x: o.x + 6, y: o.y + 2.9,
        y0: o.y + 2.9, y1: o.y + 8.25,
        dir: 1, wait: 0.8, step: 0, frame: 1,
      };
    }
    for (const o of mammoths) {
      if (!o.connected || o.built === false) continue;
      const base = o.x + o.w + o.y + o.d;
      // Two adults and a calf, kept south of the shed and clear of the trough,
      // hay cache and gate lane.
      const cast = [
        ['mammoth', 5.10, 4.30, 3.60, 2.20, 0.26],
        ['mammoth', 0.85, 2.90, 3.60, 2.10, 0.28],
        ['mammothCalf', 4.20, 5.00, 1.90, 1.90, 0.38],
      ];
      for (const [kind, bx, by, rw, rd, speed] of cast) {
        list.push({
          dino: true, kind,
          ox: o.x, oy: o.y, base,
          rx: o.x + bx, ry: o.y + by, rw, rd,
          x: o.x + bx + rw * 0.5, y: o.y + by + rd * 0.5,
          tx: 0, ty: 0, walking: false, face: 1,
          idle: 0.4 + Math.random() * 2.2,
          speed, frame: 0, step: 0,
        });
      }
    }
    this.animals = list;
  }

  _updateAnimals(dt) {
    for (const a of this.animals) {
      if (a.idle > 0) {
        a.idle -= dt;
        if (a.idle <= 0) {
          const m = a.dino ? 0.35 : 0.4;
          a.tx = a.rx + m + Math.random() * Math.max(0.1, a.rw - m * 2);
          a.ty = a.ry + m + Math.random() * Math.max(0.1, a.rd - m * 2);
          a.walking = true;
          a.step = 0;
          a.frame = 0;
        }
        continue;
      }
      const dx = a.tx - a.x;
      const dy = a.ty - a.y;
      const d = Math.hypot(dx, dy);
      if (d < 0.05) {
        a.idle = a.dino ? 1.4 + Math.random() * 3.2 : 0.7 + Math.random() * 2.6;
        a.walking = false;
        a.frame = 0;
        continue;
      }
      const step = Math.min(d, a.speed * dt);
      a.x += (dx / d) * step;
      a.y += (dy / d) * step;
      if (a.dino && Math.abs(dx - dy) > 0.001) a.face = dx - dy > 0 ? 1 : 0;
      a.step += dt;
      if (a.dino) {
        // Three-beat cast: idle, then the two walk poses in alternation.
        if (a.step > 0.34) a.step -= 0.34;
        a.frame = a.step < 0.17 ? 1 : 2;
      } else if (a.step > 0.26) {
        a.step = 0;
        a.frame ^= 1;
      }
    }
  }

  _updateRanchTruck(dt) {
    const t = this.ranchTruck;
    if (!t) return;
    if (t.wait > 0) {
      t.wait -= dt;
      t.frame = 0;
      return;
    }
    const speed = 1.15;
    t.y += t.dir * speed * dt;
    if (t.y >= t.y1) {
      t.y = t.y1;
      t.dir = -1;
      t.wait = 1.1;
    } else if (t.y <= t.y0) {
      t.y = t.y0;
      t.dir = 1;
      t.wait = 1.1;
    }
    t.step += dt;
    if (t.step > 0.18) {
      t.step = 0;
      t.frame ^= 1;
    }
  }

  // ---- GL object stream ----------------------------------------------------
  // The 2D pass positions sprites in screen pixels; the shader already applies
  // the camera, so each sprite becomes a world quad and every screen-constant
  // offset (bob) is divided back out into world units. Runs are cut whenever
  // the atlas page changes, which is what keeps the strict sk order without
  // uploading the three atlas pages as one array (D1).
  get _glObjStream() {
    return this._glActive && this._objGL;
  }

  get _glUIStream() {
    return this._glActive && this._uiGL;
  }

  _glObjQuad(verts, meta, x0, y0, x1, y1, a, page) {
    const u0 = meta.x / page.width;
    const v0 = meta.y / page.height;
    const u1 = (meta.x + meta.w) / page.width;
    const v1 = (meta.y + meta.h) / page.height;
    verts.push(
      x0, y0, u0, v0, 0, 1, 1, 1, a,
      x1, y0, u1, v0, 0, 1, 1, 1, a,
      x1, y1, u1, v1, 0, 1, 1, 1, a,
      x0, y0, u0, v0, 0, 1, 1, 1, a,
      x1, y1, u1, v1, 0, 1, 1, 1, a,
      x0, y1, u0, v1, 0, 1, 1, 1, a,
    );
  }

  _glObjPts(verts, meta, pts, a, page) {
    const u0 = meta.x / page.width;
    const v0 = meta.y / page.height;
    const u1 = (meta.x + meta.w) / page.width;
    const v1 = (meta.y + meta.h) / page.height;
    const [ax, ay, bx, by, cx, cy, dx, dy] = pts;
    verts.push(
      ax, ay, u0, v0, 0, 1, 1, 1, a,
      bx, by, u1, v0, 0, 1, 1, 1, a,
      cx, cy, u1, v1, 0, 1, 1, 1, a,
      ax, ay, u0, v0, 0, 1, 1, 1, a,
      cx, cy, u1, v1, 0, 1, 1, 1, a,
      dx, dy, u0, v1, 0, 1, 1, 1, a,
    );
  }

  // Worm body and dust. The rings shrink toward the head and the head sprite
  // swaps to the open maw during the tower; both are plain atlas quads whose
  // world y carries the height (z * 32, the same lift tileToScreen applies).
  _glWorm(state, o, G) {
    const phase = wormPhase(state.simTime);
    const rise = wormRise(phase);
    const cx = o.x + o.w / 2;
    const cy = o.y + o.d / 2;
    const total = 3.05 * rise;
    const headZ = 0.1 + total * 0.96;
    const amp = phase.id === 'tower' ? 1 : phase.id === 'breach' ? 0.7 : phase.id === 'dive' ? 0.45 : 0;
    const anchor = this.tileToScreen(cx, cy, headZ + 0.5);
    const visible = this.isOnScreen(anchor.x, anchor.y, 320);

    if (rise > 0.002 && visible) {
      const sway = Math.sin(state.simTime * 2.15) * 0.85 * amp;
      const rings = 7;
      for (let i = 0; i < rings; i++) {
        const t = i / (rings - 1);
        const meta = this._meta(`fx:worm:ring:${i % 3 === 2 ? 1 : 0}`);
        if (!meta) continue;
        const bend = sway * 0.58 * Math.pow(t, 1.6)
          + Math.sin(state.simTime * 3.1 + i * 0.9) * 0.025 * amp * t;
        const z = 0.1 + total * (0.04 + 0.92 * t);
        // The bend slides along x and y by equal and opposite amounts, so the
        // world x shifts by 2 * bend while the world y only carries the height.
        const wx = (cx - cy + 2 * bend) * HALF_W;
        const wy = (cx + cy) * HALF_H - z * 32;
        G.sprite(meta, wx, wy, 1, meta, 1 - 0.28 * t);
      }
      const open = phase.id === 'tower' && Math.sin(state.simTime * 1.55) > -0.25;
      const head = this._meta(`fx:worm:head:${open ? 0 : 1}`);
      if (head) {
        const bend = sway * 0.58;
        const bob = Math.sin(state.simTime * 2.6) * 0.05 * amp;
        G.sprite(head, (cx - cy + 2 * bend) * HALF_W, (cx + cy) * HALF_H - (headZ + bob) * 32, 1);
      }
    }

    if (!visible || !this.wormDust.length) return;
    const v = G.white();
    for (const p of this.wormDust) {
      const q = this.tileToScreen(p.x, p.y, p.z);
      if (!this.isOnScreen(q.x, q.y, 80)) continue;
      const size = p.size;
      const wx = (p.x - p.y) * HALF_W;
      const wy = (p.x + p.y) * HALF_H - p.z * 32;
      glQuad(v, wx - size / 2, wy - size / 2, wx + size / 2, wy + size / 2,
        glColor(p.color, (1 - p.age / p.life) * 0.85));
    }
  }

  _glOctoPose(frame, wx, wy, breathe, alpha, G) {
    if (alpha <= 0.01) return;
    const meta = this._meta(`fx:octopus:pose:${frame}`);
    if (!meta) return;
    G.sprite(meta, wx, wy, alpha, meta, breathe);
  }

  // Same two slow rings and three sprite states as the canvas pass, in the same
  // order: foam under the body, bubbles over it.
  _glOctopus(state, o, G) {
    const t = state.simTime;
    const phase = octopusPhase(t);
    const cx = o.x + o.w / 2;
    const cy = o.y + o.d / 2;
    const anchor = this.tileToScreen(cx, cy, 2.2);
    if (!this.isOnScreen(anchor.x, anchor.y, 520)) return;

    const act = phase.id === 'spread' ? 1
      : phase.id === 'rise' ? 0.75
        : phase.id === 'fold' ? 0.6
          : phase.id === 'lurk' ? 0.22 : 0.35;
    const zoom = this.cam.zoom;
    const fx = (cx - cy) * HALF_W;
    const fy = (cx + cy) * HALF_H - 0.015 * 32;
    const v = G.white();
    for (let i = 0; i < 2; i++) {
      const k = ((t * 0.05 + i * 0.5) % 1 + 1) % 1;
      const rad = 2.0 + k * 1.15;
      glBand(v, fx, fy, rad * HALF_W, rad * HALF_H,
        Math.max(1, (1.4 - k * 0.6) * zoom) / zoom,
        glColor('#dfeee6', (1 - k) * 0.14 * act));
    }

    const frame = OCTOPUS_POSE[phase.id] ?? 0;
    const fade = this.octoPrevPose >= 0
      ? Math.min(1, Math.max(0, (t - this.octoSwapAt) / OCTOPUS_FADE))
      : 1;
    const breathe = 1 + Math.sin(t * 1.1) * 0.012;
    const bob = Math.sin(t * 0.7) * 0.03;
    const wx = (cx - cy) * HALF_W;
    const wy = (cx + cy) * HALF_H - (0.02 + bob) * 32;
    if (fade < 1) this._glOctoPose(this.octoPrevPose, wx, wy, breathe, 1 - fade, G);
    this._glOctoPose(frame, wx, wy, breathe, fade, G);

    if (!this.octoBubbles.length) return;
    const bv = G.white();
    for (const b of this.octoBubbles) {
      const p = this.tileToScreen(b.x, b.y, b.z);
      if (!this.isOnScreen(p.x, p.y, 80)) continue;
      const size = b.size;
      const bx = (b.x - b.y) * HALF_W;
      const by = (b.x + b.y) * HALF_H - b.z * 32;
      glQuad(bv, bx - size / 2, by - size / 2, bx + size / 2, by + size / 2,
        glColor(b.glow ? '#91c8b8' : '#dfeee6',
          (1 - b.age / b.life) * (b.glow ? 0.6 : 0.38)));
    }
  }

  // The hose: two stroked runs, a dashed coupling pattern riding the same path,
  // a dark drop shadow and cream float collars along the straight part.
  _glPipe(G) {
    const { x: ax, y: ay, runY, endX } = OCTO_PIPE;
    const p2 = this.tileToScreen(ax, runY, 0.02);
    if (!this.isOnScreen(p2.x, p2.y, 340)) return;
    const zoom = this.cam.zoom;
    // The canvas pass bobs 1.1 px on screen; world y needs that divided by the
    // zoom or the hose would lift more the further the camera pulls out.
    const bob = (Math.sin(this.time * 1.1) * 1.1) / zoom;
    const w = 0.16 * HALF_W;
    const pts = [
      [(ax - ay) * HALF_W, (ax + ay) * HALF_H - 0.02 * 32],
      [(ax - runY) * HALF_W, (ax + runY) * HALF_H - 0.02 * 32 + bob],
      [(endX - runY) * HALF_W, (endX + runY) * HALF_H - 0.02 * 32 + bob],
    ];
    const v = G.white();
    // The shadow offset is a screen constant, so it is already world pixels.
    glStroke(v, pts.map(([x, y]) => [x + w * 0.28, y + w * 0.5]), w * 1.6,
      glColor('#121c26', 0.34));
    glStroke(v, pts, w, glColor('#e39a2f'));
    glDash(v, pts, w * 0.5, w * 2.4, w * 0.92, glColor('#57352b'));
    for (let d = 0.9; d < endX - ax - 0.4; d += 0.9) {
      glDisk(v,
        (ax + d - runY) * HALF_W, (ax + d + runY) * HALF_H - 0.035 * 32 + bob,
        w * 0.52, w * 0.34, glColor('#f2eedd'), 16);
    }
  }

  _glShipWake(item, G) {
    const c = this.tileToScreen(item.x + item.w / 2, item.y + item.d / 2, 0.02);
    if (!this.isOnScreen(c.x, c.y, 260)) return;
    const zoom = this.cam.zoom;
    const t = this.time;
    const sx = (item.x + 0.8 - item.y - 1) * HALF_W;
    const sy = (item.x + 0.8 + item.y + 1) * HALF_H - 0.012 * 32;
    const bx = (item.x + 3.5 - item.y - 1) * HALF_W;
    const by = (item.x + 3.5 + item.y + 1) * HALF_H - 0.012 * 32;
    const v = G.white();
    for (let i = 0; i < 2; i++) {
      const k = ((t * 0.055 + i * 0.5) % 1 + 1) % 1;
      const rad = 0.5 + k * 0.85;
      glBand(v, sx, sy, rad * HALF_W, rad * HALF_H,
        Math.max(1, (1.2 - k * 0.5) * zoom) / zoom,
        glColor('#dfeee6', (1 - k) * 0.15));
    }
    glDisk(v, bx, by, 0.2 * HALF_W, 0.15 * HALF_H, glColor('#dfeee6', 0.16), 16);
  }

  // Wake first, sprite second: the canvas pass paints in that order and the
  // rings read as water under the hull, not foam on top of it.
  _glShip(item, G) {
    this._glShipWake(item, G);
    const bob = Math.sin(this.time * 0.85 + 0.7) * 1.1;
    G.sprite(item.meta, (item.x - item.y) * HALF_W, (item.x + item.y) * HALF_H - bob, 1);
  }

  _drawObjectsGL(state, list) {
    const runs = [];
    const pages = this.data.pages || [];
    const bs = 1 / this.data.scale;
    let cur = null;
    let curTex = '';
    const open = (tex) => {
      if (!cur || curTex !== tex) {
        cur = { tex, space: 'world', verts: [] };
        curTex = tex;
        runs.push(cur);
      }
      return cur.verts;
    };
    const sprite = (meta, wx, wy, alpha, anchor = meta, scale = 1) => {
      const page = pages[meta.p] || { width: 1, height: 1 };
      const x0 = wx - anchor.ax * bs * scale;
      const y0 = wy - anchor.ay * bs * scale;
      this._glObjQuad(open(`atlas${meta.p}`), meta,
        x0, y0, x0 + meta.w * bs * scale, y0 + meta.h * bs * scale, alpha, page);
    };
    const G = { sprite, white: () => open('white') };

    for (const item of list) {
      if (item.worm) {
        this._glWorm(state, item.worm, G);
        continue;
      }
      if (item.octopus) {
        this._glOctopus(state, item.octopus, G);
        continue;
      }
      if (item.pipe) {
        this._glPipe(G);
        continue;
      }
      if (item.ship) {
        this._glShip(item, G);
        continue;
      }

      if (item.field) {
        // D5: one crop quad per tile, so the composite canvas is never uploaded.
        // Crop variants do not share an anchor (potato v1 is a pixel shorter),
        // while the baked field places every tile at the sample anchor — use
        // that same anchor here or the two paths drift by a pixel per tile.
        const def = item.field;
        const o = item.obj;
        const stage = fieldStage(o);
        const parity = (o.x * 3 + o.y * 5) % 2;
        const anchor = this._meta(`c:${def.crop}:${stage}:${parity}`);
        if (!anchor) continue;
        for (let dy = 0; dy < o.d; dy++) {
          for (let dx = 0; dx < o.w; dx++) {
            const meta = this._meta(`c:${def.crop}:${stage}:${(parity + dx * 3 + dy * 5) % 2}`);
            if (!meta) continue;
            const tx = o.x + dx;
            const ty = o.y + dy;
            const p = this.tileToScreen(tx, ty);
            if (!this.isOnScreen(p.x, p.y, 180)) continue;
            sprite(meta, (tx - ty) * HALF_W, (tx + ty) * HALF_H, 1, anchor);
          }
        }
        continue;
      }

      const meta = item.meta;
      if (!meta) continue;
      let bob = 0;
      if (item.customer) {
        bob = Math.sin(this.time * 7 + item.customer.id * 1.7) * (item.customer.walking ? 1.6 : 0.5);
      }
      const wx = (item.x - item.y) * HALF_W;
      const wy = (item.x + item.y) * HALF_H;
      const c = this.worldToScreen(
        wx - meta.ax * bs + (meta.w * bs) / 2,
        wy - meta.ay * bs - bob + (meta.h * bs) / 2,
      );
      if (!this.isOnScreen(c.x, c.y, 180)) continue;
      // 2D skips fences whenever the body is translucent, so match that.
      const alpha = item.ghost ? 0.58 : item.obj && item.obj.built === false ? 0.45 : 1;

      let sway = 0;
      let shear = 0;
      if (item.obj && SWAY_PROPS.has(item.obj.type)) {
        const ph = ((item.x * 37 + item.y * 91) % 17) * 0.37;
        const gust = 0.55 + 0.45 * Math.sin(this.time * 0.5 + item.x * 0.07);
        const wave = Math.sin(this.time * 1.15 + ph);
        sway = wave * 0.022 * gust;
        shear = wave * Math.min(meta.h || 1, 110) * 0.00032 * gust;
      }

      if (!sway) {
        sprite(meta, wx, wy - bob, alpha);
      } else {
        // Same pivot, rotate and shear as the canvas transform: the sprite
        // leans around its anchor, and the shear makes the crown lead the
        // trunk. World and screen share the linear part, so the angles and the
        // shear amount carry over unchanged.
        const pvx = wx;
        const pvy = wy - bob;
        const x0 = pvx - meta.ax * bs;
        const y0 = pvy - meta.ay * bs;
        const x1 = x0 + meta.w * bs;
        const y1 = y0 + meta.h * bs;
        const cs = Math.cos(sway);
        const sn = Math.sin(sway);
        const pt = (x, y) => {
          const rx = cs * (x - pvx) - sn * (y - pvy);
          const ry = sn * (x - pvx) + cs * (y - pvy);
          return [pvx + rx - shear * ry, pvy + ry];
        };
        const a0 = pt(x0, y0);
        const b0 = pt(x1, y0);
        const c0 = pt(x1, y1);
        const d0 = pt(x0, y1);
        const page = pages[meta.p] || { width: 1, height: 1 };
        this._glObjPts(open(`atlas${meta.p}`), meta,
          [...a0, ...b0, ...c0, ...d0], alpha, page);
      }

      if (item.fences && alpha === 1) {
        for (const f of item.fences) sprite(f, wx, wy, 1);
      }
    }
    this.glStage.drawOrdered(runs);
    this._glObjRuns = runs.length;
  }

  // ---- GL UI pass ----------------------------------------------------------
  // Text is baked into a slice of the stage array at device resolution and
  // placed at the same CSS position the canvas pass used, so the shader only
  // has to translate. The cache is LRU: a construction timer mints one string
  // per second per site, and eviction keeps the layer count flat.
  _glTextClear() {
    for (const rec of this._glTexts.values()) this.glStage.freeLayer(rec.layer);
    this._glTexts.clear();
  }

  _uiText(rawText, font, size, color, stroke) {
    const text = t(rawText);
    const key = `${text}|${font}|${color}|${stroke || ''}`;
    const hit = this._glTexts.get(key);
    if (hit) {
      // LRU refresh: the oldest entry is the one safe to evict next.
      this._glTexts.delete(key);
      this._glTexts.set(key, hit);
      return hit;
    }
    if (!this._uiCtx) this._uiCtx = document.createElement('canvas').getContext('2d');
    const m = this._uiCtx;
    m.font = font;
    // Whole-pixel width: the slice then maps to exactly one texel per device
    // pixel, so the glyphs are not stretched by a fraction of a percent.
    const tw = Math.ceil(m.measureText(text).width);
    const pad = stroke ? 2 : 1;
    const w = tw + pad * 2;
    // Even height keeps the middle baseline on a whole pixel, which is what
    // lets the canvas fallback draw the same glyph raster as this bake.
    const h = 2 * Math.ceil((size * 1.34 + pad * 2) / 2);
    // Fit inside one 256x128 slice. Real labels are far narrower than that;
    // the cap exists so a longer string degrades to a soft bake, not a clipped
    // one.
    const bs = Math.min(this.dpr, 252 / w, 124 / h);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * bs));
    c.height = Math.max(1, Math.round(h * bs));
    const g = c.getContext('2d');
    g.scale(bs, bs);
    g.font = font;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    if (stroke) {
      g.lineJoin = 'round';
      g.lineWidth = 3;
      g.strokeStyle = stroke;
      g.strokeText(text, pad, h / 2);
    }
    g.fillStyle = color;
    g.fillText(text, pad, h / 2);
    const rec = {
      layer: this.glStage.allocLayer(c),
      tw, w, h, pad, bs, size,
      // Draw at exactly one texel per device pixel and snap the quad to that
      // grid in _uiLabel: a fractional quad makes LINEAR sample four texels and
      // turns 10 px pixel-font labels into mush.
      dw: c.width / bs,
      dh: c.height / bs,
      u: c.width / this.glStage.arrW,
      v: c.height / this.glStage.arrH,
    };
    this._glTexts.set(key, rec);
    if (this._glTexts.size > this._glTextLimit) {
      const oldest = this._glTexts.keys().next().value;
      const stale = this._glTexts.get(oldest);
      this._glTexts.delete(oldest);
      this.glStage.freeLayer(stale.layer);
    }
    return rec;
  }

  // (ax, ay) is the anchor the canvas drawText used: the middle baseline. Both
  // renderers go through here so a label lands on the same device pixel in the
  // baked GL run and in the canvas fallback; a half-pixel phase change rewrites
  // every glyph edge and makes the two shots differ across all text.
  _uiTextPos(ax, ay, tw, size, align, pad = 1) {
    tw = Math.ceil(tw);
    const w = tw + pad * 2;
    const h = 2 * Math.ceil((size * 1.34 + pad * 2) / 2);
    const k = this.dpr;
    const left = align === 'left' ? ax - pad
      : align === 'right' ? ax - w + pad : ax - w / 2;
    return {
      // Glyph origin, not box origin: textAlign 'left' at this point.
      x: Math.round(left * k) / k + pad,
      y: Math.round((ay - h / 2) * k) / k + h / 2,
      h, pad,
    };
  }

  _uiLabel(v, rec, x, y, align, alpha = 1) {
    const p = this._uiTextPos(x, y, rec.tw, rec.size, align, rec.pad);
    const x0 = p.x - rec.pad;
    const y0 = p.y - p.h / 2;
    uiQuad(v, x0, y0, x0 + rec.dw, y0 + rec.dh, 0, 0, rec.u, rec.v, rec.layer,
      [alpha, alpha, alpha, alpha]);
  }

  _uiRect(v, x0, y0, x1, y1, c) {
    uiQuad(v, x0, y0, x1, y1, 0, 0, 1, 1, 0, c);
  }

  // strokeRect(X+0.5, Y+0.5, W-1, H-1) with lineWidth 1 covers exactly the
  // outer one-pixel ring of the box, which is what these four strips are.
  _uiFrame(v, x, y, w, h, c) {
    this._uiRect(v, x, y, x + w, y + 1, c);
    this._uiRect(v, x, y + h - 1, x + w, y + h, c);
    this._uiRect(v, x, y + 1, x + 1, y + h - 1, c);
    this._uiRect(v, x + w - 1, y + 1, x + w, y + h - 1, c);
  }

  _glConstructionUI(v, state) {
    const zs = this.cam.zoom;
    const s = zs / this.data.scale;
    for (const o of state.objects) {
      if (o.built !== false) continue;
      const def = defOf(o.type);
      if (!def) continue;
      let bx;
      let by;
      if (def.kind === 'field') {
        const c = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
        bx = c.x;
        by = c.y - 16 * zs;
      } else {
        const meta = this._meta(spriteKeyFor(o));
        if (!meta) continue;
        const a = this.tileToScreen(o.x, o.y);
        bx = a.x - meta.ax * s + (meta.w * s) / 2;
        by = a.y - meta.ay * s - 6 * zs;
      }
      if (!this.isOnScreen(bx, by, 140)) continue;
      const total = Math.max(0.001, o.buildTotal || 1);
      const p = clamp(1 - (o.buildLeft || 0) / total, 0, 1);
      const rec = this._uiText(`施工 ${formatSeconds(o.buildLeft)}`, UI_FONT_10, 10, '#ffe07a');
      const w = Math.round(Math.max(58, rec.tw + 16));
      const h = 17;
      const x = Math.round(bx - w / 2);
      const y = Math.round(by - h);
      this._uiRect(v, x, y, x + w, y + h, glColorP('#0b0f16', 0.86));
      this._uiFrame(v, x, y, w, h, glColorP('#f0c98f', 0.8));
      this._uiRect(v, x + 5, y + h - 6, x + w - 5, y + h - 3, glColorP('#f2eedd', 0.18));
      this._uiRect(v, x + 5, y + h - 6, x + 5 + Math.round((w - 10) * p), y + h - 3,
        glColorP('#f0c98f', 1));
      this._uiLabel(v, rec, bx, y + 6.5, 'center');
    }
  }

  _glCustomerMarksUI(v, state) {
    const zs = this.cam.zoom;
    for (const c of state.customers || []) {
      if (c.phase === 'queue') {
        const p = clamp(c.patience / Math.max(1, c.maxPatience), 0, 1);
        const a = this.tileToScreen(c.x, c.y, 0.58);
        if (!this.isOnScreen(a.x, a.y, 80)) continue;
        const w = 20 * zs;
        const h = 3.5 * zs;
        const x = a.x - w / 2;
        const y = a.y - 5 * zs;
        this._uiRect(v, Math.round(x - 1), Math.round(y - 1),
          Math.round(x - 1) + Math.round(w + 2), Math.round(y - 1) + Math.round(h + 2),
          glColorP('#090d13', 0.72));
        this._uiRect(v, Math.round(x), Math.round(y),
          Math.round(x) + Math.round(w * p), Math.round(y) + Math.round(h),
          glColorP(p > 0.5 ? '#a8dd8f' : p > 0.25 ? '#f0c98f' : '#ef8a67', 1));
      } else if (c.phase === 'leave' && c.angry) {
        const a = this.tileToScreen(c.x, c.y, 0.72);
        if (!this.isOnScreen(a.x, a.y, 80)) continue;
        const r = 6 * Math.max(0.8, zs);
        glDisk(v, a.x, a.y - 4, r, r, glColorP('#ef8a67', 1), 20);
        const size = Math.round(9 * Math.max(0.8, zs));
        const rec = this._uiText('!', `700 ${size}px "Fusion Pixel", monospace`, size, '#2a120e');
        this._uiLabel(v, rec, a.x, a.y - 4, 'center');
      }
    }

    for (const o of this._sales) {
      const def = defOf(o.type);
      if (!def?.sale) continue;
      const q = queueAtShop(state, o.id).length;
      // The queue tag is a status read-out like the badges, so it disappears
      // with them in clean scene renders.
      if (!q || this.badgesHidden) continue;
      const meta = this._meta(spriteKeyFor(o));
      if (!meta) continue;
      const s = this.cam.zoom / this.data.scale;
      const a = this.tileToScreen(o.x, o.y);
      const bx = a.x - meta.ax * s + (meta.w * s) / 2;
      const by = a.y - meta.ay * s - 6 * this.cam.zoom;
      if (!this.isOnScreen(bx, by, 100)) continue;
      const rec = this._uiText(`排队 ${q}`, UI_FONT_10, 10, '#ffe07a');
      const pw = Math.round(rec.tw + 14);
      const x = Math.round(bx - rec.tw / 2 - 7);
      const y = Math.round(by - 13);
      this._uiRect(v, x, y, x + pw, y + 17, glColorP('#0b0f16', 0.85));
      this._uiFrame(v, x, y, pw, 17, glColorP('#ffe07a', 0.75));
      this._uiLabel(v, rec, bx, by - 4, 'center');
    }
  }

  _glFestivalUI(v, state) {
    const f = state.festival;
    if (!f) return;
    const hall = state.objects.find((o) => o.type === 'reviewHall');
    if (!hall) return;
    const a = this.tileToScreen(hall.x + hall.w / 2, hall.y + hall.d / 2, 3.35);
    if (!this.isOnScreen(a.x, a.y, 160)) return;
    const w = 148;
    const h = 38;
    const x = a.x - w / 2;
    const y = a.y - h;
    const pct = clamp(f.served / Math.max(1, f.target), 0, 1);
    const px = Math.round(x);
    const py = Math.round(y);
    this._uiRect(v, px, py, px + w, py + h, glColorP('#0b0f16', 0.88));
    this._uiFrame(v, px, py, w, h, glColorP('#ffe07a', 1));
    const title = this._uiText('美食节进行中', UI_FONT_11B, 11, '#ffe07a');
    this._uiLabel(v, title, x + 9, y + 12, 'left');
    const left = this._uiText(`${Math.ceil(f.remaining)}s`, UI_FONT_11B, 11, 'rgba(242, 238, 221, 0.8)');
    this._uiLabel(v, left, x + w - 9, y + 12, 'right');
    this._uiRect(v, px + 9, py + 22, px + w - 9, py + 28, glColorP('#f2eedd', 0.18));
    this._uiRect(v, px + 9, py + 22, px + 9 + Math.round((w - 18) * pct), py + 28,
      glColorP(pct >= 1 ? '#a8dd8f' : '#ef8a67', 1));
    const served = this._uiText(`${f.served} / ${f.target} 位顾客`, UI_FONT_9, 9, '#f2eedd');
    this._uiLabel(v, served, a.x, y + 34, 'center');
  }

  _glPlotsUI(v, state) {
    const level = state.review?.level || 1;
    for (const p of PLOTS) {
      if (plotUnlocked(state, p)) continue;
      const pts = [
        this.tileToScreen(p.x, p.y),
        this.tileToScreen(p.x + p.w, p.y),
        this.tileToScreen(p.x + p.w, p.y + p.d),
        this.tileToScreen(p.x, p.y + p.d),
      ];
      const cx = (pts[0].x + pts[2].x) / 2;
      const cy = (pts[0].y + pts[2].y) / 2;
      if (!this.isOnScreen(cx, cy, 420)) continue;
      const label = t(`${p.name} · Lv.${p.rank}`);
      const sub = level + 1 >= p.rank ? t('举办美食节晋升后开放') : t(`小镇等级 ${p.rank} 解锁`);
      const r1 = this._uiText(label, UI_FONT_12, 12, '#ffe07a');
      const r2 = this._uiText(sub, UI_FONT_10R, 10, 'rgba(242, 238, 221, 0.7)');
      const bwRaw = Math.max(r1.tw, r2.tw) + 26;
      const bw = Math.round(bwRaw);
      const bh = 40;
      const bx = Math.round(cx - bwRaw / 2);
      const by = Math.round(cy - bh / 2 - 8);
      if (!this.isOnScreen(cx, by + bh / 2, 120)) continue;
      this._uiRect(v, bx, by, bx + bw, by + bh, glColorP('#0b0f16', 0.82));
      this._uiFrame(v, bx, by, bw, bh, glColorP('#ffe07a', 0.55));
      this._uiLabel(v, r1, cx, by + 14, 'center');
      this._uiLabel(v, r2, cx, by + 29, 'center');
    }
  }

  _glBadgesUI(v, state, ui) {
    if (this.badgesHidden) return;
    const s = this.cam.zoom / this.data.scale;
    for (const o of state.objects) {
      if (o.id === ui.selectedId) continue;
      const def = defOf(o.type);
      if (!def) continue;
      if (!def.needsRoad && !def.prod && !def.sale && def.kind !== 'field' && def.kind !== 'gate' && def.kind !== 'review' && def.kind !== 'barn' && def.kind !== 'range') continue;
      const mid = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
      if (!this.isOnScreen(mid.x, mid.y, 240)) continue;
      if (def.kind === 'range' && !this._rangeIsPrimary(state, o)) continue;
      const st = statusOf(state, o);
      if (st.code !== 'road' && st.code !== 'lack' && st.code !== 'full' && st.code !== 'barn') continue;
      let bx;
      let by;
      if (def.kind === 'field') {
        const c = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
        bx = c.x;
        by = c.y - 50 * this.cam.zoom;
      } else if (o.w * o.d >= 24) {
        const c = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
        bx = c.x;
        by = c.y - 56 * this.cam.zoom;
      } else {
        const meta = this._meta(spriteKeyFor(o));
        if (!meta) continue;
        const a = this.tileToScreen(o.x, o.y);
        bx = a.x - meta.ax * s + (meta.w * s) / 2;
        by = a.y - meta.ay * s - 4;
      }
      if (!this.isOnScreen(bx, by, 100)) continue;
      const color = st.code === 'road' || st.code === 'barn' ? '#df6346' : st.code === 'lack' ? '#b8850f' : '#8a7358';
      const glyph = st.code === 'road' ? t('路') : st.code === 'barn' ? t('棚') : st.code === 'lack' ? t('缺') : t('满');
      const rx = Math.round(bx);
      const ry = Math.round(by);
      this._uiRect(v, rx - 9, ry - 18, rx + 9, ry, glColorP('#fffaf0', 0.94));
      this._uiFrame(v, rx - 9, ry - 18, 18, 18, glColorP(color, 1));
      const rec = this._uiText(glyph, UI_FONT_12, 12, color);
      this._uiLabel(v, rec, bx, by - 8.6, 'center');
    }
  }

  _glFloatersUI(v) {
    for (const f of this.floaters) {
      const t = f.age / f.life;
      const a = this.tileToScreen(f.x, f.y, f.z);
      const alpha = t < 0.72 ? 1 : 1 - (t - 0.72) / 0.28;
      const rec = this._uiText(f.text, UI_FONT_11, 11, f.color, 'rgba(9, 13, 19, 0.9)');
      this._uiLabel(v, rec, a.x + f.jitter, a.y - t * 30 - 6, 'center', alpha);
    }
  }

  _glSelectionLabelUI(v, state, ui) {
    const o = state.objects.find((x) => x.id === ui.selectedId);
    if (!o) return;
    const def = defOf(o.type);
    const s = this.cam.zoom / this.data.scale;
    let topX;
    let topY;
    if (def?.kind === 'field') {
      const c = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
      topX = c.x;
      topY = c.y - 66 * this.cam.zoom;
    } else {
      const meta = this._meta(spriteKeyFor(o));
      if (!meta) return;
      const a = this.tileToScreen(o.x, o.y);
      topX = a.x - meta.ax * s + (meta.w * s) / 2;
      topY = a.y - meta.ay * s - 8 * this.cam.zoom;
    }
    if (!this.isOnScreen(topX, topY, 200)) return;
    const st = statusOf(state, o);
    const text = t(`${def?.name || o.type} · ${t(st.label)}`);
    const rec = this._uiText(text, UI_FONT_11, 11, '#43301f');
    const bw = rec.tw + 18;
    const bh = 21;
    const bx = Math.round(topX - bw / 2);
    const by = Math.round(topY - bh);
    this._uiRect(v, bx, by, bx + bw, by + bh, glColorP('#fffaf0', 0.96));
    this._uiFrame(v, bx, by, bw, bh, glColorP('#c98c2a', 0.9));
    this._uiLabel(v, rec, topX, by + bh / 2, 'center');
  }

  // One run, one draw call, push order preserved. It is drawn after the canvas
  // overlay so labels stay legible over smoke and gulls.
  _drawUIGL(state, ui) {
    const v = [];
    this._glConstructionUI(v, state);
    this._glCustomerMarksUI(v, state);
    this._glFestivalUI(v, state);
    this._glPlotsUI(v, state);
    this._glBadgesUI(v, state, ui);
    if (ui.selectedId) this._glSelectionLabelUI(v, state, ui);
    this._glFloatersUI(v);
    this._glUIRuns = v.length / 54;
    if (!v.length) return;
    this.glStage.drawOrdered([{ array: true, blend: true, space: 'screen', verts: v }]);
  }

  // ---- GL effect layer -----------------------------------------------------
  // Smoke puffs and the beer aura are soft discs; a fan of triangles shows its
  // edges at these sizes, so both are baked once into the UI array and drawn as
  // tinted quads. Gulls stay geometry: two round-capped strokes, which is what
  // the capsule helper already draws.

  _glSoft(name, size, paint) {
    const key = `_glSoft_${name}`;
    if (this[key]) return this[key];
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    paint(c.getContext('2d'), size);
    const rec = {
      layer: this.glStage.allocLayer(c),
      u: size / this.glStage.arrW,
      v: size / this.glStage.arrH,
    };
    this[key] = rec;
    return rec;
  }

  _glPuffRec() {
    return this._glSoft('puff', 64, (g, size) => {
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(size / 2, size / 2, size / 2 - 0.5, 0, TAU);
      g.fill();
    });
  }

  // Same falloff as the canvas gradient, with the mid stop folded into the
  // tint: the pulse only moves the centre alpha, so one bake covers it.
  _glGlowRec() {
    return this._glSoft('glow', 128, (g, size) => {
      const r = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      r.addColorStop(0, 'rgba(255, 255, 255, 1)');
      r.addColorStop(0.72, 'rgba(255, 255, 255, 0.55)');
      r.addColorStop(1, 'rgba(255, 255, 255, 0)');
      g.fillStyle = r;
      g.fillRect(0, 0, size, size);
    });
  }

  _glPuffsGL(v) {
    const rec = this._glPuffRec();
    const zs = this.cam.zoom;
    for (const p of this.puffs) {
      const t = p.age / p.life;
      const a = this.tileToScreen(p.x, p.y, p.z + t * 0.85);
      const r = (p.size + t * 3.4) * zs;
      if (!this.isOnScreen(a.x, a.y, r + 8)) continue;
      const alpha = (1 - t) * (p.color ? 0.85 : 0.3);
      const cx = a.x + p.drift * t;
      uiQuad(v, cx - r, a.y - r, cx + r, a.y + r, 0, 0, rec.u, rec.v, rec.layer,
        glColorP(p.color || '#c9cec1', alpha));
    }
  }

  _glGullsGL(v) {
    this._seaLife();
    const t = this.time;
    const w = clamp(this.cam.zoom, 0.55, 1.5);
    const dark = [54 / 255, 76 / 255, 86 / 255, 0.42];
    const light = [252 / 255, 252 / 255, 242 / 255, 0.96];
    for (const g of this._gulls) {
      const a = t * g.speed + g.phase;
      const gx = g.x + Math.cos(a) * g.radius;
      const gy = g.y + Math.sin(a) * g.radius * 0.62;
      const p = this.tileToScreen(gx, gy, g.height + Math.sin(t * 0.7 + g.phase) * 0.07);
      if (!this.isOnScreen(p.x, p.y, 60)) continue;
      const flap = Math.sin(t * 7.5 + g.phase * 2.3);
      const span = (5.6 + Math.abs(flap) * 1.1) * w;
      const lift = (1.1 + flap * 2.3) * w;
      const pts = [];
      const walk = (x0, y0, cx, cy, x1, y1) => {
        for (let i = 0; i <= 5; i++) {
          const u = i / 5;
          const iu = 1 - u;
          pts.push([iu * iu * x0 + 2 * iu * u * cx + u * u * x1,
            iu * iu * y0 + 2 * iu * u * cy + u * u * y1]);
        }
      };
      walk(p.x - span, p.y + lift * 0.45, p.x - span * 0.42, p.y - lift, p.x, p.y);
      walk(p.x, p.y, p.x + span * 0.42, p.y - lift, p.x + span, p.y + lift * 0.45);
      glStroke(v, pts, Math.max(1.4, 3.1 * w), dark);
      glStroke(v, pts, Math.max(0.9, 1.5 * w), light);
    }
  }

  _drawBeerAuraGL(state) {
    const rec = this._glGlowRec();
    const now = this.time;
    const glow = [];
    const ring = [];
    for (const o of state.objects) {
      const buff = defOf(o.type)?.buff;
      if (!buff || !o.connected || (o.buffLeft || 0) <= 0) continue;
      const hx = o.x + o.w / 2;
      const hy = o.y + o.d / 2;
      const center = this.tileToScreen(hx, hy, 0.02);
      if (!this.isOnScreen(center.x, center.y, buff.radius * 40)) continue;
      const right = this.tileToScreen(hx + buff.radius, hy, 0.02);
      const down = this.tileToScreen(hx, hy + buff.radius, 0.02);
      // Same vertices as the canvas path: tile-space angles through the two
      // basis vectors. Sampling the ellipse by screen angle instead would move
      // the start point a quarter turn and slide every dash along the ring.
      const vx = right.x - center.x;
      const vy = right.y - center.y;
      const wx = down.x - center.x;
      const wy = down.y - center.y;
      const at = (a) => [center.x + Math.cos(a) * vx + Math.sin(a) * wx,
        center.y + Math.cos(a) * vy + Math.sin(a) * wy];
      const pulse = 0.5 + Math.sin(now * 2.2) * 0.5;
      const gr = buff.radius * 32;
      // The canvas clip is the aura ellipse, so the glow has to be cut the
      // same way: the fan follows the ellipse and its uv is the gradient
      // circle, which is what drawing the gradient inside that clip does.
      const col = glColorP('#ffc45c', 0.2 + pulse * 0.08);
      const grow = [];
      for (let i = 0; i <= 40; i++) {
        const p = at((i / 40) * TAU);
        grow.push([p[0], p[1],
          (0.5 + (p[0] - center.x) / (2 * gr)) * rec.u,
          (0.5 + (p[1] - center.y) / (2 * gr)) * rec.v]);
      }
      for (let i = 0; i < 40; i++) {
        const p = grow[i];
        const q = grow[i + 1];
        glow.push(center.x, center.y, 0.5 * rec.u, 0.5 * rec.v, rec.layer,
          col[0], col[1], col[2], col[3]);
        glow.push(p[0], p[1], p[2], p[3], rec.layer, col[0], col[1], col[2], col[3]);
        glow.push(q[0], q[1], q[2], q[3], rec.layer, col[0], col[1], col[2], col[3]);
      }
      const pts = [];
      for (let i = 0; i <= 40; i++) pts.push(at((i / 40) * TAU));
      glDash(ring, pts, 7, 5, 2,
        [255 / 255, 214 / 255, 121 / 255, 0.5 + pulse * 0.25], -now * 14);
    }
    const runs = [];
    if (glow.length) runs.push({ array: true, blend: true, space: 'screen', verts: glow });
    if (ring.length) runs.push({ space: 'screen', verts: ring });
    if (runs.length) this.glStage.drawOrdered(runs);
  }

  _drawFXGL() {
    const smoke = [];
    this._glPuffsGL(smoke);
    const bird = [];
    this._glGullsGL(bird);
    const runs = [];
    if (smoke.length) runs.push({ array: true, blend: true, space: 'screen', verts: smoke });
    if (bird.length) runs.push({ space: 'screen', verts: bird });
    if (runs.length) this.glStage.drawOrdered(runs);
  }

  // ---- GL tool layer -------------------------------------------------------
  // The grid, footprints and tool labels used to keep the overlay canvas alive
  // on every build frame. Outlines are one-period dash textures: an edge is a
  // single quad and the phase rides in u, so the rhythm of setLineDash survives
  // without one capsule per dash (a plot border alone has hundreds).

  _glDashTex(on, off) {
    const key = `_glDash_${on}_${off}`;
    if (this[key]) return this[key];
    const period = on + off;
    const w = 64;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = 2;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, (on / period) * w, 2);
    const name = `dash${on}_${off}`;
    this.glStage.setTexture(name, c, { linear: true, repeat: true });
    const rec = { name, period };
    this[key] = rec;
    return rec;
  }

  _glDashPath(v, rec, pts, width, c) {
    const hw = width / 2;
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0];
      const ay = pts[i - 1][1];
      const bx = pts[i][0];
      const by = pts[i][1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-4) continue;
      const nx = (-(by - ay) / len) * hw;
      const ny = ((bx - ax) / len) * hw;
      const u0 = d / rec.period;
      const u1 = (d + len) / rec.period;
      v.push(
        ax + nx, ay + ny, u0, 0, 0, c[0], c[1], c[2], c[3],
        bx + nx, by + ny, u1, 0, 0, c[0], c[1], c[2], c[3],
        bx - nx, by - ny, u1, 1, 0, c[0], c[1], c[2], c[3],
        ax + nx, ay + ny, u0, 0, 0, c[0], c[1], c[2], c[3],
        bx - nx, by - ny, u1, 1, 0, c[0], c[1], c[2], c[3],
        ax - nx, ay - ny, u0, 1, 0, c[0], c[1], c[2], c[3],
      );
      d += len;
    }
  }

  // Solid outline: each edge is a quad pushed out by half the width at both
  // ends, which is enough to close a miter corner at these line weights.
  _glLineLoop(v, pts, width, c) {
    const hw = width / 2;
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0];
      const ay = pts[i - 1][1];
      const bx = pts[i][0];
      const by = pts[i][1];
      const len = Math.hypot(bx - ax, by - ay);
      if (len < 1e-4) continue;
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const x0 = ax - ux * hw;
      const y0 = ay - uy * hw;
      const x1 = bx + ux * hw;
      const y1 = by + uy * hw;
      const nx = -uy * hw;
      const ny = ux * hw;
      glTri(v, x0 + nx, y0 + ny, x1 + nx, y1 + ny, x1 - nx, y1 - ny, c);
      glTri(v, x0 + nx, y0 + ny, x1 - nx, y1 - ny, x0 - nx, y0 - ny, c);
    }
  }

  _diamondPts(x, y, w, d) {
    return [
      this.tileToScreen(x, y),
      this.tileToScreen(x + w, y),
      this.tileToScreen(x + w, y + d),
      this.tileToScreen(x, y + d),
    ].map((p) => [p.x, p.y]);
  }

  _glFootprint(v, x, y, w, d, hex, fillAlpha, dash = false) {
    const pts = this._diamondPts(x, y, w, d);
    glFan(v, pts, glColor(hex, fillAlpha));
    const ring = [...pts, pts[0]];
    if (dash) this._glDashPath(v, this._glDashTex(5, 4), ring, 1.5, glColor(hex, 0.9));
    else this._glLineLoop(v, ring, 1.5, glColor(hex, 0.9));
  }

  // One quad for the whole lattice. A 1px line at 5.5% still has to land on the
  // same half-pixel as the canvas stroke, and aliased quads cannot: half the
  // columns fall one row off and each of those pixels is a visible seam. The
  // shader solves the lattice from the world position with a 1px box filter,
  // which is also cheaper than one quad per edge.
  _glGrid(run) {
    // The canvas strokes one diamond per tile in the visible range, so the
    // lattice has the shape of that range, not of the screen: it stops at the
    // map edge and never covers the sea.
    const r = this._visibleTiles();
    run.grid = { hw: HALF_W, hh: HALF_H, x0: r.x0, y0: r.y0, x1: r.x1 + 1, y1: r.y1 + 1 };
    const c = glColor('#f2eedd', 0.055);
    // The rect projected to screen is a diamond; its bounds are all the quad
    // needs, since the shader drops everything outside the tile rect.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [tx, ty] of [[r.x0, r.y0], [r.x1 + 1, r.y0], [r.x1 + 1, r.y1 + 1], [r.x0, r.y1 + 1]]) {
      const p = this.tileToScreen(tx, ty);
      if (p.x < x0) x0 = p.x;
      if (p.x > x1) x1 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.y > y1) y1 = p.y;
    }
    x0 = Math.max(0, x0 - 2);
    y0 = Math.max(0, y0 - 2);
    x1 = Math.min(this.viewW, x1 + 2);
    y1 = Math.min(this.viewH, y1 + 2);
    if (x1 <= x0 || y1 <= y0) return;
    glTri(run.verts, x0, y0, x1, y0, x1, y1, c);
    glTri(run.verts, x0, y0, x1, y1, x0, y1, c);
  }

  // One run list for everything that sits on the ground under the objects.
  _glToolGround(state, ui) {
    const runs = [];
    const pushRun = (tex, space) => {
      const last = runs[runs.length - 1];
      if (last && last.tex === tex && last.space === space) return last;
      const run = { tex, space, verts: [] };
      runs.push(run);
      return run;
    };
    const push = (tex, space) => pushRun(tex, space).verts;
    const white = () => push('white', 'screen');
    const sprite = (meta, tx, ty, alpha) => {
      const page = (this.data.pages || [])[meta.p] || { width: 1, height: 1 };
      const bs = 1 / this.data.scale;
      const x0 = (tx - ty) * HALF_W - meta.ax * bs;
      const y0 = (tx + ty) * HALF_H - meta.ay * bs;
      this._glObjQuad(push(`atlas${meta.p}`, 'world'), meta,
        x0, y0, x0 + meta.w * bs, y0 + meta.h * bs, alpha, page);
    };

    if (ui.tool) this._glGrid(pushRun('white', 'screen'));

    if (ui.selectedId) {
      const o = state.objects.find((v) => v.id === ui.selectedId);
      if (o) this._glFootprint(white(), o.x, o.y, o.w, o.d, '#f0c98f', 0.08, true);
    }

    const g = ui.ghost;
    const tool = ui.tool;
    if (g) {
      if (tool?.kind === 'road' || tool?.kind === 'pave') {
        const ok = g.ok;
        if (tool.kind === 'road') {
          const cells = this._roadGhostCells(state, g);
          for (const c of cells) {
            this._glFootprint(white(), c.x, c.y, 1, 1, ok ? '#a8dd8f' : '#ef8a67', 0.26);
          }
          if (ok) {
            for (const c of cells) {
              const meta = this._meta(c.skey);
              if (meta) sprite(meta, c.x, c.y, 0.78);
            }
          }
        } else {
          this._glFootprint(white(), g.x, g.y, 1, 1, ok ? '#a8dd8f' : '#ef8a67', 0.26);
          const meta = ok ? this._meta('g:pave:0') : null;
          if (meta) sprite(meta, g.x, g.y, 0.78);
        }
      } else if (tool?.kind === 'demolish') {
        const o = ui.demolishTarget;
        if (o) this._glFootprint(white(), o.x, o.y, o.w, o.d, '#ef8a67', 0.3);
        else this._glFootprint(white(), g.x, g.y, 1, 1, '#ef8a67', 0.3);
      } else if (tool?.kind === 'build' || tool?.kind === 'move') {
        const def = tool.kind === 'move'
          ? defOf(state.objects.find((o) => o.id === tool.id)?.type)
          : defOf(tool.type);
        if (def) {
          this._glFootprint(white(), g.x, g.y, def.w, def.d,
            g.ok ? '#a8dd8f' : '#ef8a67', g.ok ? 0.2 : 0.3);
          if (def.kind === 'field' && g.ok) {
            const soil = this._meta('g:soil:0');
            if (soil) {
              for (let y = g.y; y < g.y + def.d; y++) {
                for (let x = g.x; x < g.x + def.w; x++) sprite(soil, x, y, 0.45);
              }
            }
          }
        }
      }
    }

    if (ui.hover && !ui.tool) {
      const pts = this._diamondPts(ui.hover.x, ui.hover.y, 1, 1);
      this._glLineLoop(white(), [...pts, pts[0]], 1, glColor('#f2eedd', 0.3));
    }

    if (runs.length) this.glStage.drawOrdered(runs);
  }

  // Red cross plus its quote, drawn between the effects and the plot borders.
  _glDemolish(state, ui) {
    if (!ui.ghost || ui.tool?.kind !== 'demolish') return;
    const o = ui.demolishTarget;
    const x = o ? o.x + o.w / 2 : ui.ghost.x + 0.5;
    const y = o ? o.y + o.d / 2 : ui.ghost.y + 0.5;
    const a = this.tileToScreen(x, y);
    const r = 9 * this.cam.zoom;
    const c = glColor('#ef8a67');
    const hw = 1;
    const ring = [];
    const seg = (ax, ay, bx, by) => {
      const len = Math.hypot(bx - ax, by - ay);
      const ux = (bx - ax) / len;
      const uy = (by - ay) / len;
      const nx = -uy * hw;
      const ny = ux * hw;
      glTri(ring, ax + nx, ay + ny, bx + nx, by + ny, bx - nx, by - ny, c);
      glTri(ring, ax + nx, ay + ny, bx - nx, by - ny, ax - nx, ay - ny, c);
    };
    seg(a.x - r, a.y - r, a.x + r, a.y + r);
    seg(a.x + r, a.y - r, a.x - r, a.y + r);
    const runs = [{ space: 'screen', verts: ring }];
    if (o) {
      const quote = demolitionQuote(state, o);
      let label = '';
      let color = '#ffd9cc';
      if (quote.kind === 'locked') {
        label = t('不可拆除');
      } else if (quote.fee > 0) {
        label = t(`清理 -${quote.fee}`);
        color = quote.affordable ? '#ffd9cc' : '#ff8f72';
      } else if (quote.refund > 0) {
        label = t(`返还 +${quote.refund}`);
        color = '#c2ee95';
      }
      if (label) {
        const rec = this._uiText(label, UI_FONT_11, 11, color, 'rgba(9, 13, 19, 0.9)');
        const v = [];
        this._uiLabel(v, rec, a.x, a.y - r - 10, 'center');
        runs.push({ array: true, blend: true, space: 'screen', verts: v });
      }
    }
    this.glStage.drawOrdered(runs);
  }

  // Plot borders. Locked plots keep the amber [7,6] dash and open ones the
  // faint [4,7] dash; both are phase-zero at the diamond's first corner, which
  // is what each subpath of the canvas stroke did.
  _glPlots(state) {
    const locked = [];
    const open = [];
    const dashL = this._glDashTex(7, 6);
    const dashO = this._glDashTex(4, 7);
    for (const p of PLOTS) {
      const pts = this._diamondPts(p.x, p.y, p.w, p.d);
      const cx = (pts[0][0] + pts[2][0]) / 2;
      const cy = (pts[0][1] + pts[2][1]) / 2;
      if (!this.isOnScreen(cx, cy, 420)) continue;
      const ring = [...pts, pts[0]];
      // setLineDash restarts at every subpath, so each border starts at phase 0.
      if (plotUnlocked(state, p)) this._glDashPath(open, dashO, ring, 1, glColor('#f2eedd', 0.14));
      else this._glDashPath(locked, dashL, ring, 1.4, glColor('#ba8f34', 0.62));
    }
    const runs = [];
    if (locked.length) runs.push({ tex: dashL.name, space: 'screen', verts: locked });
    if (open.length) runs.push({ tex: dashO.name, space: 'screen', verts: open });
    if (runs.length) this.glStage.drawOrdered(runs);
  }

  _drawObjects(list, state) {
    // The GL stream draws every sprite and harbour special itself. This loop is
    // the fallback: no WebGL, a lost context, or ?objgl=0.
    if (this._glObjStream) return;
    const ctx = this.ctx;
    const zoom = this.cam.zoom;
    const s = zoom / this.data.scale;
    for (const item of list) {
      if (item.worm) {
        this._drawWorm(state, item.worm);
        continue;
      }
      if (item.octopus) {
        this._drawOctopus(state, item.octopus);
        continue;
      }
      if (item.pipe) {
        this._drawPipe(zoom);
        continue;
      }
      const a = this.tileToScreen(item.x, item.y);
      let bob = 0;
      if (item.ship) {
        bob = Math.sin(this.time * 0.85 + 0.7) * 1.1 * this.cam.zoom;
        this._drawShipWake(item, zoom);
      }
      if (item.customer) bob = Math.sin(this.time * 7 + item.customer.id * 1.7) * (item.customer.walking ? 1.6 : 0.5) * this.cam.zoom;
      // Trees and shrubs sway from the root, so the trunk stays planted while the
      // crown drifts. The pivot is the sprite's anchor, which is already at the
      // base, so this is a rotate around the correct point for free. The phase is
      // per-object so a row of trees doesn't move in lockstep, and the gust term
      // breathes slowly over the whole map so the wind has a rhythm instead of a
      // constant metronome. ~1.2 degrees at the crown of a 3-tile palm: visible in
      // motion, invisible in a still frame, which is what "restrained" means here.
      let sway = 0;
      let swayShear = 0;
      if (item.obj && SWAY_PROPS.has(item.obj.type)) {
        const ph = ((item.x * 37 + item.y * 91) % 17) * 0.37;
        const gust = 0.55 + 0.45 * Math.sin(this.time * 0.5 + item.x * 0.07);
        const wave = Math.sin(this.time * 1.15 + ph);
        sway = wave * 0.022 * gust;
        // Taller props lean more: a pine should not move exactly as much as a
        // bush. Derived from the sprite height rather than a per-type table.
        const tall = (item.img ? item.ih : item.meta.h) || 1;
        swayShear = wave * Math.min(tall, 110) * 0.00032 * gust;
      }
      let src;
      let sx = 0;
      let sy = 0;
      let sw;
      let sh;
      let px;
      let py;
      let w;
      let h;
      if (item.img) {
        sw = item.img.width;
        sh = item.img.height;
        src = item.img;
        px = a.x - item.ax * zoom;
        py = a.y - item.ay * zoom - bob;
        w = item.iw * zoom;
        h = item.ih * zoom;
      } else {
        const meta = item.meta;
        src = this.images[meta.p];
        sx = meta.x;
        sy = meta.y;
        sw = meta.w;
        sh = meta.h;
        px = a.x - meta.ax * s;
        py = a.y - meta.ay * s - bob;
        w = meta.w * s;
        h = meta.h * s;
      }
      if (!this.isOnScreen(px + w / 2, py + h / 2, 180)) continue;
      if (item.ghost) {
        ctx.save();
        ctx.globalAlpha = 0.58;
        ctx.drawImage(src, sx, sy, sw, sh, px, py, w, h);
        ctx.restore();
        continue;
      }
      if (item.obj && item.obj.built === false) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.drawImage(src, sx, sy, sw, sh, px, py, w, h);
        ctx.restore();
        continue;
      }
      if (sway !== 0) {
        // Pivot at the sprite anchor (the tree's base), not the image centre. The
        // rotation leans the whole sprite; the shear then adds the extra horizontal
        // travel up the trunk that makes the crown lead the base, which is what the
        // eye actually reads as "wind" rather than "the picture is rotating".
        const ax = px + (item.img ? item.ax * zoom : item.meta.ax * s);
        const ay = py + (item.img ? item.ay * zoom : item.meta.ay * s);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.transform(1, 0, -swayShear, 1, 0, 0);
        ctx.rotate(sway);
        ctx.translate(-ax, -ay);
        ctx.drawImage(src, sx, sy, sw, sh, px, py, w, h);
        ctx.restore();
      } else {
        ctx.drawImage(src, sx, sy, sw, sh, px, py, w, h);
      }
      if (item.fences) {
        for (const meta of item.fences) {
          ctx.drawImage(
            this.images[meta.p], meta.x, meta.y, meta.w, meta.h,
            a.x - meta.ax * s, a.y - meta.ay * s, meta.w * s, meta.h * s,
          );
        }
      }
    }
  }

  // Rise curve shared by the body and the dust: sand bursts out over 3 s,
  // holds while the worm towers, then drops back faster than it came up.
  _updateWorm(state, dt) {
    const hole = state.objects.find((o) => o.type === 'wormHole' || o.type === 'wormFarm');
    if (!hole) {
      if (this.wormDust.length) this.wormDust.length = 0;
      return;
    }
    const phase = wormPhase(state.simTime);
    const cx = hole.x + hole.w / 2;
    const cy = hole.y + hole.d / 2;
    const anchor = this.tileToScreen(cx, cy, 1.2);
    if (this.isOnScreen(anchor.x, anchor.y, 320)) {
      const rate = WORM_DUST_RATE[phase.id] || 1;
      const interval = 1 / rate;
      this._wormDustAcc += dt;
      while (this._wormDustAcc >= interval) {
        this._wormDustAcc -= interval;
        if (this.wormDust.length >= 24) {
          this._wormDustAcc = 0;
          break;
        }
        this.wormDust.push(this._wormParticle(phase, cx, cy));
      }
    }
    for (const p of this.wormDust) {
      p.age += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.vz -= p.gravity * dt;
    }
    this.wormDust = this.wormDust.filter((p) => p.age < p.life && p.z > -0.15);
  }

  _wormParticle(phase, cx, cy) {
    const a = Math.random() * Math.PI * 2;
    const rad = 0.55 + Math.random() * 1.05;
    const burst = phase.id === 'breach' || phase.id === 'dive';
    const fall = phase.id === 'tower';
    const p = {
      x: cx + Math.cos(a) * rad,
      y: cy + Math.sin(a) * rad * 0.9,
      z: 0.12 + Math.random() * 0.32,
      vx: Math.cos(a) * Math.random() * 0.18,
      vy: Math.sin(a) * Math.random() * 0.18,
      vz: 0.3 + Math.random() * 0.35,
      gravity: 1.5,
      age: 0,
      life: 0.9 + Math.random() * 0.8,
      size: 1.5 + Math.random() * 1.7,
      color: WORM_DUST_COLORS[Math.floor(Math.random() * WORM_DUST_COLORS.length)],
    };
    if (burst) {
      p.vx = Math.cos(a) * (0.5 + Math.random() * 0.7);
      p.vy = Math.sin(a) * (0.5 + Math.random() * 0.7);
      p.vz = 1.3 + Math.random() * 1.7;
      p.gravity = 4.4;
    } else if (fall) {
      p.z = 1.1 + Math.random() * 1.9;
      p.vz = -0.15 - Math.random() * 0.35;
      p.gravity = 0.55;
      p.life = 1.1 + Math.random() * 0.9;
    }
    return p;
  }

  _drawWorm(state, o) {
    const ctx = this.ctx;
    const zoom = this.cam.zoom;
    const s = zoom / this.data.scale;
    const phase = wormPhase(state.simTime);
    const rise = wormRise(phase);
    const cx = o.x + o.w / 2;
    const cy = o.y + o.d / 2;
    const total = 3.05 * rise;
    const headZ = 0.1 + total * 0.96;
    const amp = phase.id === 'tower' ? 1 : phase.id === 'breach' ? 0.7 : phase.id === 'dive' ? 0.45 : 0;
    const anchor = this.tileToScreen(cx, cy, headZ + 0.5);
    const visible = this.isOnScreen(anchor.x, anchor.y, 320);

    if (rise > 0.002 && visible) {
      const sway = Math.sin(state.simTime * 2.15) * 0.85 * amp;
      const rings = 7;
      for (let i = 0; i < rings; i++) {
        const t = i / (rings - 1);
        const meta = this._meta(`fx:worm:ring:${i % 3 === 2 ? 1 : 0}`);
        if (!meta) continue;
        const bend = sway * 0.58 * Math.pow(t, 1.6)
          + Math.sin(state.simTime * 3.1 + i * 0.9) * 0.025 * amp * t;
        const z = 0.1 + total * (0.04 + 0.92 * t);
        const p = this.tileToScreen(cx + bend, cy - bend, z);
        const k = 1 - 0.28 * t;
        ctx.drawImage(
          this.images[meta.p], meta.x, meta.y, meta.w, meta.h,
          p.x - meta.ax * s * k, p.y - meta.ay * s * k, meta.w * s * k, meta.h * s * k,
        );
      }
      const open = phase.id === 'tower' && Math.sin(state.simTime * 1.55) > -0.25;
      const head = this._meta(`fx:worm:head:${open ? 0 : 1}`);
      if (head) {
        const bend = sway * 0.58;
        const bob = Math.sin(state.simTime * 2.6) * 0.05 * amp;
        const p = this.tileToScreen(cx + bend, cy - bend, headZ + bob);
        ctx.drawImage(
          this.images[head.p], head.x, head.y, head.w, head.h,
          p.x - head.ax * s, p.y - head.ay * s, head.w * s, head.h * s,
        );
      }
    }

    // Airborne grit sits in front of the body. It is ambient only; the array
    // is rebuilt at runtime and never touches the save.
    if (!visible || !this.wormDust.length) return;
    ctx.save();
    for (const p of this.wormDust) {
      const q = this.tileToScreen(p.x, p.y, p.z);
      if (!this.isOnScreen(q.x, q.y, 80)) continue;
      const size = p.size * zoom;
      ctx.globalAlpha = (1 - p.age / p.life) * 0.85;
      ctx.fillStyle = p.color;
      ctx.fillRect(q.x - size / 2, q.y - size / 2, size, size);
    }
    ctx.restore();
  }

  // The octopus only makes surface noise while it is awake. Bubbles are
  // runtime-only like the worm dust and never enter the save.
  _updateOctopus(state, dt) {
    const o = state.objects.find((v) => v.type === 'giantOctopus');
    if (!o) {
      if (this.octoBubbles.length) this.octoBubbles.length = 0;
      this.octoPose = -1;
      this.octoPrevPose = -1;
      return;
    }
    const phase = octopusPhase(state.simTime);
    const frame = OCTOPUS_POSE[phase.id] ?? 0;
    if (frame !== this.octoPose) {
      this.octoPrevPose = this.octoPose;
      this.octoPose = frame;
      this.octoSwapAt = state.simTime;
    }
    const cx = o.x + o.w / 2;
    const cy = o.y + o.d / 2;
    const anchor = this.tileToScreen(cx, cy, 0.8);
    if (this.isOnScreen(anchor.x, anchor.y, 420)) {
      const rate = phase.id === 'spread' ? 7
        : phase.id === 'rise' || phase.id === 'fold' ? 5
          : phase.id === 'lurk' ? 1.4 : 2.6;
      this._octoBubbleAcc += dt;
      while (this._octoBubbleAcc >= 1 / rate) {
        this._octoBubbleAcc -= 1 / rate;
        if (this.octoBubbles.length >= 20) {
          this._octoBubbleAcc = 0;
          break;
        }
        this.octoBubbles.push(this._octoBubble(cx, cy));
      }
    }
    for (const b of this.octoBubbles) {
      b.age += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
    this.octoBubbles = this.octoBubbles.filter((b) => b.age < b.life);
  }

  _octoBubble(cx, cy) {
    const a = Math.random() * TAU;
    const r = 0.5 + Math.random() * 1.3;
    return {
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r * 0.9,
      vx: Math.cos(a) * (0.12 + Math.random() * 0.22),
      vy: Math.sin(a) * (0.12 + Math.random() * 0.22),
      z: 0.04 + Math.random() * 0.12,
      age: 0,
      life: 0.7 + Math.random() * 0.9,
      size: 1.4 + Math.random() * 1.8,
      glow: Math.random() < 0.28,
    };
  }

  // The lair sprite is static; this paints the baked pose over it. A short
  // crossfade on phase changes plus a slow breath keeps the 40 s loop alive.
  _drawOctopus(state, o) {
    const zoom = this.cam.zoom;
    const t = state.simTime;
    const phase = octopusPhase(t);
    const cx = o.x + o.w / 2;
    const cy = o.y + o.d / 2;
    const anchor = this.tileToScreen(cx, cy, 2.2);
    if (!this.isOnScreen(anchor.x, anchor.y, 520)) return;

    this._drawOctoFoam(cx, cy, t, phase, zoom);

    const frame = OCTOPUS_POSE[phase.id] ?? 0;
    const fade = this.octoPrevPose >= 0
      ? Math.min(1, Math.max(0, (t - this.octoSwapAt) / OCTOPUS_FADE))
      : 1;
    const breathe = 1 + Math.sin(t * 1.1) * 0.012;
    const bob = Math.sin(t * 0.7) * 0.03;
    const p = this.tileToScreen(cx, cy, 0.02 + bob);
    if (fade < 1) this._drawOctoPose(this.octoPrevPose, p, zoom, breathe, 1 - fade);
    this._drawOctoPose(frame, p, zoom, breathe, fade);
    this._drawOctoBubbles(state);
  }

  _drawOctoPose(frame, p, zoom, breathe, alpha) {
    if (alpha <= 0.01) return;
    const meta = this._meta(`fx:octopus:pose:${frame}`);
    if (!meta) return;
    const ctx = this.ctx;
    const s = (zoom / this.data.scale) * breathe;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      this.images[meta.p], meta.x, meta.y, meta.w, meta.h,
      p.x - meta.ax * s, p.y - meta.ay * s, meta.w * s, meta.h * s,
    );
    ctx.restore();
  }

  // A moored trawler only needs a thin breathing wake: two slow rings astern
  // and one small bow patch. Anything denser turns the anchor into a spider.
  // The harbor-to-trawler hose: one riser drop at the platform foot and one
  // straight run along y=9.95 to the stern. It is flat on the water, so it
  // draws as a stroked path with cream float collars instead of a sprite.
  _drawPipe(zoom) {
    const ctx = this.ctx;
    const { x: ax, y: ay, runY, endX } = OCTO_PIPE;
    const p1 = this.tileToScreen(ax, ay, 0.02);
    const p2 = this.tileToScreen(ax, runY, 0.02);
    const p3 = this.tileToScreen(endX, runY, 0.02);
    if (!this.isOnScreen(p2.x, p2.y, 340)) return;
    const w = 0.16 * HALF_W * zoom;
    const bob = Math.sin(this.time * 1.1) * 1.1;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y + bob);
      ctx.lineTo(p3.x, p3.y + bob);
    };
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(18,28,38,0.34)';
    ctx.lineWidth = w * 1.6;
    path();
    ctx.save();
    ctx.translate(w * 0.28, w * 0.5);
    path();
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = '#e39a2f';
    ctx.lineWidth = w;
    path();
    ctx.stroke();
    // Couplings every few metres, in the dark palette so they read as joints.
    ctx.strokeStyle = '#57352b';
    ctx.lineWidth = w * 0.92;
    ctx.setLineDash([w * 0.5, w * 2.4]);
    path();
    ctx.stroke();
    ctx.setLineDash([]);
    // Float collars: only along the straight run, never on the elbow.
    ctx.fillStyle = '#f2eedd';
    for (let d = 0.9; d < endX - ax - 0.4; d += 0.9) {
      const p = this.tileToScreen(ax + d, runY, 0.035);
      ctx.beginPath();
      ctx.ellipse(p.x, p.y + bob, w * 0.52, w * 0.34, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  _drawShipWake(item, zoom) {
    const c = this.tileToScreen(item.x + item.w / 2, item.y + item.d / 2, 0.02);
    if (!this.isOnScreen(c.x, c.y, 260)) return;
    const ctx = this.ctx;
    const t = this.time;
    const stern = this.tileToScreen(item.x + 0.8, item.y + 1, 0.012);
    const bow = this.tileToScreen(item.x + 3.5, item.y + 1, 0.012);
    ctx.save();
    ctx.strokeStyle = '#dfeee6';
    for (let i = 0; i < 2; i++) {
      const k = ((t * 0.055 + i * 0.5) % 1 + 1) % 1;
      ctx.globalAlpha = (1 - k) * 0.15;
      ctx.lineWidth = Math.max(1, (1.2 - k * 0.5) * zoom);
      ctx.beginPath();
      ctx.ellipse(stern.x, stern.y, (0.5 + k * 0.85) * HALF_W * zoom, (0.5 + k * 0.85) * HALF_H * zoom, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = '#dfeee6';
    ctx.beginPath();
    ctx.ellipse(bow.x, bow.y, 0.2 * HALF_W * zoom, 0.15 * HALF_H * zoom, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  _drawOctoFoam(cx, cy, simTime, phase, zoom) {
    const act = phase.id === 'spread' ? 1
      : phase.id === 'rise' ? 0.75
        : phase.id === 'fold' ? 0.6
          : phase.id === 'lurk' ? 0.22 : 0.35;
    const ctx = this.ctx;
    const base = this.tileToScreen(cx, cy, 0.015);
    ctx.save();
    ctx.strokeStyle = '#dfeee6';
    for (let i = 0; i < 2; i++) {
      const k = ((simTime * 0.05 + i * 0.5) % 1 + 1) % 1;
      const rad = 2.0 + k * 1.15;
      ctx.globalAlpha = (1 - k) * 0.14 * act;
      ctx.lineWidth = Math.max(1, (1.4 - k * 0.6) * zoom);
      ctx.beginPath();
      ctx.ellipse(base.x, base.y, rad * HALF_W * zoom, rad * HALF_H * zoom, 0, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawOctoBubbles(state) {
    if (!this.octoBubbles.length) return;
    const ctx = this.ctx;
    const zoom = this.cam.zoom;
    ctx.save();
    for (const b of this.octoBubbles) {
      const p = this.tileToScreen(b.x, b.y, b.z);
      if (!this.isOnScreen(p.x, p.y, 80)) continue;
      const size = b.size * zoom;
      ctx.globalAlpha = (1 - b.age / b.life) * (b.glow ? 0.6 : 0.38);
      ctx.fillStyle = b.glow ? '#91c8b8' : '#dfeee6';
      ctx.fillRect(p.x - size / 2, p.y - size / 2, size, size);
    }
    ctx.restore();
  }

  _drawSelectionGround(state, ui) {
    const o = state.objects.find((v) => v.id === ui.selectedId);
    if (!o) return;
    this._drawFootprint(o.x, o.y, o.w, o.d, '#f0c98f', 0.08, true);
  }

  _drawSelectionLabel(state, ui) {
    const o = state.objects.find((v) => v.id === ui.selectedId);
    if (!o) return;
    const def = defOf(o.type);
    const ctx = this.ctx;
    const s = this.cam.zoom / this.data.scale;
    let topX;
    let topY;
    if (def?.kind === 'field') {
      const c = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
      topX = c.x;
      topY = c.y - 66 * this.cam.zoom;
    } else {
      const meta = this._meta(spriteKeyFor(o));
      if (!meta) return;
      const a = this.tileToScreen(o.x, o.y);
      topX = a.x - meta.ax * s + (meta.w * s) / 2;
      topY = a.y - meta.ay * s - 8 * this.cam.zoom;
    }
    if (!this.isOnScreen(topX, topY, 200)) return;
    const st = statusOf(state, o);
    const text = t(`${def?.name || o.type} · ${t(st.label)}`);
    ctx.save();
    ctx.font = '11px "Fusion Pixel", "Microsoft YaHei", monospace';
    const tw = Math.ceil(ctx.measureText(text).width);
    const bw = tw + 18;
    const bh = 21;
    const bx = Math.round(topX - bw / 2);
    const by = Math.round(topY - bh);
    ctx.fillStyle = 'rgba(255, 250, 240, 0.96)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = 'rgba(201, 140, 42, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    const tp = this._uiTextPos(topX, by + bh / 2, tw, 11, 'center');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#43301f';
    ctx.fillText(text, tp.x, tp.y);
    ctx.restore();
  }

  _drawConstruction(state) {
    const ctx = this.ctx;
    const zs = this.cam.zoom;
    const s = this.cam.zoom / this.data.scale;
    for (const o of state.objects) {
      if (o.built !== false) continue;
      const def = defOf(o.type);
      if (!def) continue;
      let bx;
      let by;
      if (def.kind === 'field') {
        const c = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
        bx = c.x;
        by = c.y - 16 * zs;
      } else {
        const meta = this._meta(spriteKeyFor(o));
        if (!meta) continue;
        const a = this.tileToScreen(o.x, o.y);
        bx = a.x - meta.ax * s + (meta.w * s) / 2;
        by = a.y - meta.ay * s - 6 * zs;
      }
      if (!this.isOnScreen(bx, by, 140)) continue;
      const total = Math.max(0.001, o.buildTotal || 1);
      const p = Math.max(0, Math.min(1, 1 - (o.buildLeft || 0) / total));
      const text = `${t('施工')} ${formatSeconds(o.buildLeft)}`;
      ctx.save();
      ctx.font = '600 10px "Fusion Pixel", "Microsoft YaHei", monospace';
      const tw = Math.ceil(ctx.measureText(text).width);
      const w = Math.max(58, tw + 16);
      const h = 17;
      // Rounded once, exactly like the baked GL panel: the text anchor below is
      // derived from these numbers, and rounding it a second time would shift
      // the label by a pixel whenever by is fractional.
      const x = Math.round(bx - w / 2);
      const y = Math.round(by - h);
      ctx.fillStyle = 'rgba(11, 15, 22, 0.86)';
      ctx.fillRect(x, y, Math.round(w), h);
      ctx.strokeStyle = 'rgba(240, 201, 143, 0.8)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, y + 0.5, Math.round(w) - 1, h - 1);
      ctx.fillStyle = 'rgba(242, 238, 221, 0.18)';
      ctx.fillRect(x + 5, y + h - 6, Math.round(w) - 10, 3);
      ctx.fillStyle = '#f0c98f';
      ctx.fillRect(x + 5, y + h - 6, Math.round((w - 10) * p), 3);
      ctx.fillStyle = '#ffe07a';
      const tp = this._uiTextPos(bx, y + 6.5, tw, 10, 'center');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, tp.x, tp.y);
      ctx.restore();
    }
  }

  _drawBadges(state, ui) {
    if (this.badgesHidden) return;
    const ctx = this.ctx;
    const s = this.cam.zoom / this.data.scale;
    for (const o of state.objects) {
      if (o.id === ui.selectedId) continue;
      const def = defOf(o.type);
      if (!def) continue;
      if (!def.needsRoad && !def.prod && !def.sale && def.kind !== 'field' && def.kind !== 'gate' && def.kind !== 'review' && def.kind !== 'barn' && def.kind !== 'range') continue;
      const mid = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
      if (!this.isOnScreen(mid.x, mid.y, 240)) continue;
      // A merged paddock is one thing to the player: report it once, on its
      // primary tile, instead of stamping a badge on every tile.
      if (def.kind === 'range' && !this._rangeIsPrimary(state, o)) continue;
      const st = statusOf(state, o);
      if (st.code !== 'road' && st.code !== 'lack' && st.code !== 'full' && st.code !== 'barn') continue;
      let bx;
      let by;
      if (def?.kind === 'field') {
        const c = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
        bx = c.x;
        by = c.y - 50 * this.cam.zoom;
      } else if (o.w * o.d >= 24) {
        // A big building's sprite bounds put the old badge far outside the
        // footprint (the ranch's question mark landed on the lawn beside it),
        // so large plots report over their own centre instead.
        const c = this.tileToScreen(o.x + o.w / 2, o.y + o.d / 2);
        bx = c.x;
        by = c.y - 56 * this.cam.zoom;
      } else {
        const meta = this._meta(spriteKeyFor(o));
        if (!meta) continue;
        const a = this.tileToScreen(o.x, o.y);
        bx = a.x - meta.ax * s + (meta.w * s) / 2;
        by = a.y - meta.ay * s - 4;
      }
      if (!this.isOnScreen(bx, by, 100)) continue;
      const color = st.code === 'road' || st.code === 'barn' ? '#df6346' : st.code === 'lack' ? '#b8850f' : '#8a7358';
      // A word beats a symbol here: the old ! / ? / # stack was unreadable at
      // a glance. One character still fits the tiny tag and says what it means.
      const glyph = st.code === 'road' ? t('路') : st.code === 'barn' ? t('棚') : st.code === 'lack' ? t('缺') : t('满');
      ctx.save();
      ctx.fillStyle = 'rgba(255, 250, 240, 0.94)';
      ctx.fillRect(Math.round(bx) - 9, Math.round(by) - 18, 18, 18);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(bx) - 8.5, Math.round(by) - 17.5, 17, 17);
      ctx.fillStyle = color;
      ctx.font = '600 12px "Fusion Pixel", "Microsoft YaHei", monospace';
      const tp = this._uiTextPos(bx, by - 8.6, ctx.measureText(glyph).width, 12, 'center');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, tp.x, tp.y);
      ctx.restore();
    }
  }

  _drawPuffs() {
    const ctx = this.ctx;
    const zs = this.cam.zoom;
    for (const p of this.puffs) {
      const t = p.age / p.life;
      const a = this.tileToScreen(p.x, p.y, p.z + t * 0.85);
      ctx.save();
      ctx.globalAlpha = (1 - t) * (p.color ? 0.85 : 0.3);
      ctx.fillStyle = p.color || '#c9cec1';
      ctx.beginPath();
      ctx.arc(a.x + p.drift * t, a.y, (p.size + t * 3.4) * zs, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  _drawFloaters() {
    const ctx = this.ctx;
    const zs = this.cam.zoom;
    for (const f of this.floaters) {
      const t0 = f.age / f.life;
      const a = this.tileToScreen(f.x, f.y, f.z);
      const alpha = t0 < 0.72 ? 1 : 1 - (t0 - 0.72) / 0.28;
      const px = a.x + f.jitter;
      const py = a.y - t0 * 30 - 6;
      const label = t(f.text);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = '11px "Fusion Pixel", "Microsoft YaHei", monospace';
      const tp = this._uiTextPos(px, py, ctx.measureText(label).width, 11, 'center', 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(9, 13, 19, 0.9)';
      ctx.strokeText(label, tp.x, tp.y);
      ctx.fillStyle = f.color;
      ctx.fillText(label, tp.x, tp.y);
      ctx.restore();
    }
  }

  _drawHover(ui) {
    if (!ui.hover || ui.tool) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(242, 238, 221, 0.3)';
    ctx.lineWidth = 1;
    this._diamondPath(ui.hover.x, ui.hover.y);
    ctx.stroke();
    ctx.restore();
  }

  _drawDemolish(state, ui) {
    if (!ui.ghost || ui.tool?.kind !== 'demolish') return;
    const ctx = this.ctx;
    const o = ui.demolishTarget;
    const x = o ? o.x + o.w / 2 : ui.ghost.x + 0.5;
    const y = o ? o.y + o.d / 2 : ui.ghost.y + 0.5;
    const a = this.tileToScreen(x, y);
    const r = 9 * this.cam.zoom;
    ctx.save();
    ctx.strokeStyle = '#ef8a67';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(a.x - r, a.y - r);
    ctx.lineTo(a.x + r, a.y + r);
    ctx.moveTo(a.x + r, a.y - r);
    ctx.lineTo(a.x - r, a.y + r);
    ctx.stroke();
    if (o) {
      const quote = demolitionQuote(state, o);
      let label = '';
      let color = '#ffd9cc';
      if (quote.kind === 'locked') {
        label = t('不可拆除');
      } else if (quote.fee > 0) {
        label = t(`清理 -${quote.fee}`);
        color = quote.affordable ? '#ffd9cc' : '#ff8f72';
      } else if (quote.refund > 0) {
        label = t(`返还 +${quote.refund}`);
        color = '#c2ee95';
      }
      if (label) {
        ctx.font = '11px "Fusion Pixel", "Microsoft YaHei", monospace';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(9, 13, 19, 0.9)';
        const tw = Math.ceil(ctx.measureText(label).width);
        const tp = this._uiTextPos(a.x, a.y - r - 10, tw, 11, 'center', 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.strokeText(label, tp.x, tp.y);
        ctx.fillStyle = color;
        ctx.fillText(label, tp.x, tp.y);
      }
    }
    ctx.restore();
  }

  _drawCustomerMarks(state) {
    const ctx = this.ctx;
    const zs = this.cam.zoom;
    for (const c of state.customers || []) {
      if (c.phase === 'queue') {
        const p = clamp(c.patience / Math.max(1, c.maxPatience), 0, 1);
        const a = this.tileToScreen(c.x, c.y, 0.58);
        if (!this.isOnScreen(a.x, a.y, 80)) continue;
        const w = 20 * zs;
        const h = 3.5 * zs;
        const x = a.x - w / 2;
        const y = a.y - 5 * zs;
        ctx.fillStyle = 'rgba(9, 13, 19, 0.72)';
        ctx.fillRect(Math.round(x - 1), Math.round(y - 1), Math.round(w + 2), Math.round(h + 2));
        ctx.fillStyle = p > 0.5 ? '#a8dd8f' : p > 0.25 ? '#f0c98f' : '#ef8a67';
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(w * p), Math.round(h));
      } else if (c.phase === 'leave' && c.angry) {
        const a = this.tileToScreen(c.x, c.y, 0.72);
        if (!this.isOnScreen(a.x, a.y, 80)) continue;
        ctx.save();
        ctx.fillStyle = '#ef8a67';
        ctx.beginPath();
        ctx.arc(a.x, a.y - 4, 6 * Math.max(0.8, zs), 0, TAU);
        ctx.fill();
        ctx.fillStyle = '#2a120e';
        const fs = Math.round(9 * Math.max(0.8, zs));
        ctx.font = `700 ${fs}px "Fusion Pixel", monospace`;
        const tp = this._uiTextPos(a.x, a.y - 4, ctx.measureText('!').width, fs, 'center');
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', tp.x, tp.y);
        ctx.restore();
      }
    }

    for (const o of this._sales) {
      const def = defOf(o.type);
      if (!def?.sale) continue;
      const q = queueAtShop(state, o.id).length;
      // The queue tag is a status read-out like the badges, so it disappears
      // with them in clean scene renders.
      if (!q || this.badgesHidden) continue;
      const meta = this._meta(spriteKeyFor(o));
      if (!meta) continue;
      const s = this.cam.zoom / this.data.scale;
      const a = this.tileToScreen(o.x, o.y);
      const bx = a.x - meta.ax * s + (meta.w * s) / 2;
      const by = a.y - meta.ay * s - 6 * this.cam.zoom;
      if (!this.isOnScreen(bx, by, 100)) continue;
      const text = t(`排队 ${q}`);
      ctx.save();
      ctx.font = '600 10px "Fusion Pixel", "Microsoft YaHei", monospace';
      const tw = Math.ceil(ctx.measureText(text).width);
      ctx.fillStyle = 'rgba(11, 15, 22, 0.85)';
      ctx.fillRect(Math.round(bx - tw / 2 - 7), Math.round(by - 13), tw + 14, 17);
      ctx.strokeStyle = 'rgba(255, 224, 122, 0.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(Math.round(bx - tw / 2 - 7) + 0.5, Math.round(by - 13) + 0.5, tw + 13, 16);
      ctx.fillStyle = '#ffe07a';
      const tp = this._uiTextPos(bx, by - 4, tw, 10, 'center');
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, tp.x, tp.y);
      ctx.restore();
    }
  }

  _drawFestival(state) {
    const f = state.festival;
    if (!f) return;
    const hall = state.objects.find((o) => o.type === 'reviewHall');
    if (!hall) return;
    const a = this.tileToScreen(hall.x + hall.w / 2, hall.y + hall.d / 2, 3.35);
    if (!this.isOnScreen(a.x, a.y, 160)) return;
    const ctx = this.ctx;
    const w = 148;
    const h = 38;
    const x = a.x - w / 2;
    const y = a.y - h;
    const pct = clamp(f.served / Math.max(1, f.target), 0, 1);
    const px = Math.round(x);
    const py = Math.round(y);
    ctx.save();
    ctx.fillStyle = 'rgba(11, 15, 22, 0.88)';
    ctx.fillRect(px, py, w, h);
    ctx.strokeStyle = '#ffe07a';
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, w - 1, h - 1);
    ctx.fillStyle = '#ffe07a';
    ctx.font = '600 11px "Fusion Pixel", "Microsoft YaHei", monospace';
    const title = t('美食节进行中');
    const tTitle = this._uiTextPos(x + 9, y + 12, ctx.measureText(title).width, 11, 'left');
    const left = `${Math.ceil(f.remaining)}s`;
    const tLeft = this._uiTextPos(x + w - 9, y + 12, ctx.measureText(left).width, 11, 'right');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(title, tTitle.x, tTitle.y);
    ctx.fillStyle = 'rgba(242, 238, 221, 0.8)';
    ctx.fillText(left, tLeft.x, tLeft.y);
    ctx.fillStyle = 'rgba(242, 238, 221, 0.18)';
    ctx.fillRect(px + 9, py + 22, w - 18, 6);
    ctx.fillStyle = pct >= 1 ? '#a8dd8f' : '#ef8a67';
    ctx.fillRect(px + 9, py + 22, Math.round((w - 18) * pct), 6);
    ctx.fillStyle = '#f2eedd';
    ctx.font = '9px "Fusion Pixel", "Microsoft YaHei", monospace';
    const served = t(`${f.served} / ${f.target} 位顾客`);
    const tServed = this._uiTextPos(a.x, y + 34, ctx.measureText(served).width, 9, 'center');
    ctx.fillText(served, tServed.x, tServed.y);
    ctx.restore();
  }

  // --- WebGL static stack -------------------------------------------------
  //
  // Backdrop, island shelf, ground and the locked-plot veil as one set of
  // world-space meshes. Nothing here is rebuilt for a pan: the shader applies
  // the camera, so dragging costs one uniform update.

  _glAtlas() {
    const pages = this.data.pages || [];
    const key = `${pages.map((p) => `${p.width}x${p.height}`).join('|')}|${this.images.length}`;
    if (key === this._glAtlasKey) return;
    this._glAtlasKey = key;
    for (let i = 0; i < this.images.length; i++) {
      this.glStage.setTexture(`atlas${i}`, this.images[i]);
    }
  }

  // Sky stops, the dot dither, the warm halo, the veil hatch and the wind blob
  // are all painted once into small textures instead of being drawn per frame.
  _glScreenAssets() {
    const key = `${this.viewW}|${this.viewH}|${this.dpr}`;
    if (key === this._glScreenKey) return;
    this._glScreenKey = key;
    const stage = this.glStage;
    const dpr = this.dpr;

    const grad = document.createElement('canvas');
    grad.width = 1;
    grad.height = 256;
    const gg = grad.getContext('2d');
    const lin = gg.createLinearGradient(0, 0, 0, 256);
    lin.addColorStop(0, '#cfe9f5');
    lin.addColorStop(0.45, '#e6f2e4');
    lin.addColorStop(1, '#f7eccd');
    gg.fillStyle = lin;
    gg.fillRect(0, 0, 1, 256);
    stage.setTexture('bgGrad', grad, { linear: true });

    const dots = document.createElement('canvas');
    dots.width = 16 * dpr;
    dots.height = 16 * dpr;
    const dg = dots.getContext('2d');
    dg.fillStyle = 'rgba(242, 238, 221, 0.045)';
    dg.fillRect(0, 0, dpr, dpr);
    dg.fillRect(8 * dpr, 8 * dpr, dpr, dpr);
    dg.fillStyle = 'rgba(145, 200, 184, 0.04)';
    dg.fillRect(8 * dpr, 0, dpr, dpr);
    dg.fillRect(0, 8 * dpr, dpr, dpr);
    stage.setTexture('bgDots', dots, { repeat: true });

    const R = Math.max(this.viewW, this.viewH) * 0.62;
    const halo = document.createElement('canvas');
    halo.width = 256;
    halo.height = 256;
    const hg = halo.getContext('2d');
    const ring = hg.createRadialGradient(128, 128, Math.max(1, (20 * 128) / R), 128, 128, 128);
    ring.addColorStop(0, 'rgba(255, 246, 214, 0.28)');
    ring.addColorStop(0.55, 'rgba(255, 240, 200, 0.12)');
    ring.addColorStop(1, 'rgba(0, 0, 0, 0)');
    hg.fillStyle = ring;
    hg.fillRect(0, 0, 256, 256);
    stage.setTexture('bgHalo', halo, { linear: true });

    const hatch = document.createElement('canvas');
    hatch.width = 16 * dpr;
    hatch.height = 16 * dpr;
    const tg = hatch.getContext('2d');
    tg.strokeStyle = 'rgba(70, 84, 70, 0.06)';
    tg.lineWidth = dpr;
    tg.beginPath();
    tg.moveTo(-4 * dpr, 20 * dpr);
    tg.lineTo(20 * dpr, -4 * dpr);
    tg.stroke();
    stage.setTexture('hatch', hatch, { repeat: true });

    // The one multiply layer in the renderer lives here: the baker stores the
    // multiplier itself (white = untouched) so GL's dst*src blend matches what
    // canvas multiply did over the ground.
    const blob = document.createElement('canvas');
    blob.width = 128;
    blob.height = 128;
    const bg = blob.getContext('2d');
    const img = bg.createImageData(128, 128);
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const dx = (x + 0.5) / 64 - 1;
        const dy = (y + 0.5) / 64 - 1;
        const r = Math.min(1, Math.hypot(dx, dy));
        let a;
        let cr;
        let cg;
        let cb;
        if (r <= 0.55) {
          const t = r / 0.55;
          a = 0.1 + (0.045 - 0.1) * t;
          cr = 104 + (130 - 104) * t;
          cg = 140 + (166 - 140) * t;
          cb = 92 + (112 - 92) * t;
        } else {
          const t = (r - 0.55) / 0.45;
          a = 0.045 * (1 - t);
          cr = 130 + (255 - 130) * t;
          cg = 166 + (255 - 166) * t;
          cb = 112 + (255 - 112) * t;
        }
        const i = (y * 128 + x) * 4;
        img.data[i] = Math.round(255 * (1 - a + (a * cr) / 255));
        img.data[i + 1] = Math.round(255 * (1 - a + (a * cg) / 255));
        img.data[i + 2] = Math.round(255 * (1 - a + (a * cb) / 255));
        img.data[i + 3] = 255;
      }
    }
    bg.putImageData(img, 0, 0);
    stage.setTexture('blob', blob, { linear: true });
  }

  _glScreen() {
    this._glScreenAssets();
    if (this._glScreenMesh === this._glScreenKey) return;
    this._glScreenMesh = this._glScreenKey;
    const m = new Mesh('screen');
    m.quad('bgGrad', 0, 0, this.viewW, this.viewH);
    m.quad('bgDots', 0, 0, this.viewW, this.viewH, 0, 0, this.viewW / 16, this.viewH / 16,
      [1, 1, 1, 0.65]);
    const cx = this.viewW / 2;
    const cy = this.viewH / 2 + this.centerYOffset;
    const R = Math.max(this.viewW, this.viewH) * 0.62;
    m.quad('bgHalo', cx - R, cy - R, cx + R, cy + R);
    this.glStage.setLayer('screen', m);
  }

  _glSprite(m, meta, x, y, bs) {
    const page = (this.data.pages || [])[meta.p] || { width: 1, height: 1 };
    const px = (x - y) * HALF_W - meta.ax * bs;
    const py = (x + y) * HALF_H - meta.ay * bs;
    m.quad(
      `atlas${meta.p}`, px, py, px + meta.w * bs, py + meta.h * bs,
      meta.x / page.width, meta.y / page.height,
      (meta.x + meta.w) / page.width, (meta.y + meta.h) / page.height,
    );
  }

  // Island shelf: layered drop shadow, a turf/sand lip over the cliff face and
  // the strata lines. Everything is a world-space quad, so the vertical ramps
  // become per-vertex colours sampled from the same stops the canvas used.
  _glMapBase(m) {
    const ax = (0 - 0) * HALF_W;
    const ay = (0 + 0) * HALF_H;
    const bx = (MAP_W - 0) * HALF_W;
    const by = (MAP_W + 0) * HALF_H;
    const cx = (MAP_W - MAP_H) * HALF_W;
    const cy = (MAP_W + MAP_H) * HALF_H;
    const dx = (0 - MAP_H) * HALF_W;
    const dy = (0 + MAP_H) * HALF_H;
    const drop = 30;

    for (let i = 3; i >= 1; i--) {
      const off = i * 7;
      const al = 0.05 + i * 0.028;
      const c = [0.353, 0.275, 0.157, al];
      m.quadCols('white', [
        ax + off, ay + off * 1.35, bx + off, by + off * 1.35,
        cx + off, cy + off * 1.35, dx + off, dy + off * 1.35,
      ], 0, 0, 1, 1, [c, c, c, c]);
    }

    const lip = 6.6;
    const hex = (h) => [
      parseInt(h.slice(1, 3), 16) / 255,
      parseInt(h.slice(3, 5), 16) / 255,
      parseInt(h.slice(5, 7), 16) / 255,
      1,
    ];
    const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t,
      a[2] + (b[2] - a[2]) * t, 1];
    const runs = (count, tileAt, pointAt, east) => {
      let start = 0;
      let kind = null;
      const flush = (end) => {
        if (end <= start) return;
        const p0 = pointAt(start);
        const p1 = pointAt(end);
        const sandy = kind === 'sand';
        const top = hex(sandy ? (east ? '#e8d2a0' : '#dcc48e') : (east ? '#c48f55' : '#a97442'));
        const bottom = hex(sandy ? (east ? '#c2a46c' : '#ae8e5c') : (east ? '#8a5b33' : '#6a4529'));
        const y0 = Math.min(p0[1], p1[1]);
        const y1 = Math.max(p0[1], p1[1]) + drop;
        const ramp = (y) => lerp(top, bottom, y1 > y0 ? clamp((y - y0) / (y1 - y0), 0, 1) : 0);
        m.quadCols('white', [
          p0[0], p0[1], p1[0], p1[1],
          p1[0], p1[1] + drop, p0[0], p0[1] + drop,
        ], 0, 0, 1, 1, [ramp(p0[1]), ramp(p1[1]), ramp(p1[1] + drop), ramp(p0[1] + drop)]);
        const lipC = hex(sandy ? (east ? '#f2e3b8' : '#e4d0a0') : (east ? '#69b94a' : '#52a03c'));
        m.quadCols('white', [
          p0[0], p0[1], p1[0], p1[1],
          p1[0], p1[1] + lip, p0[0], p0[1] + lip,
        ], 0, 0, 1, 1, [lipC, lipC, lipC, lipC]);
      };
      for (let i = 0; i < count; i++) {
        const t = tileAt(i);
        const next = (t === 'coral' || t === 'sand') ? 'sand' : 'soil';
        if (next !== kind) {
          flush(i);
          kind = next;
          start = i;
        }
      }
      flush(count);
    };
    runs(MAP_H, (i) => terrainAt(MAP_W - 1, i),
      (i) => [(MAP_W - i) * HALF_W, (MAP_W + i) * HALF_H], true);
    runs(MAP_W, (i) => terrainAt(i, MAP_H - 1),
      (i) => [(i - MAP_H) * HALF_W, (i + MAP_H) * HALF_H], false);
  }

  _glCliffLines(m) {
    const bx = MAP_W * HALF_W;
    const by = MAP_W * HALF_H;
    const cx = (MAP_W - MAP_H) * HALF_W;
    const cy = (MAP_W + MAP_H) * HALF_H;
    const dx = -MAP_H * HALF_W;
    const dy = MAP_H * HALF_H;
    const drop = 30;
    const line = (coords, col) => {
      for (let i = 0; i + 3 < coords.length; i += 2) {
        const x0 = coords[i];
        const y0 = coords[i + 1];
        const x1 = coords[i + 2];
        const y1 = coords[i + 3];
        const len = Math.hypot(x1 - x0, y1 - y0) || 1;
        const nx = (-(y1 - y0) / len) * 0.5;
        const ny = ((x1 - x0) / len) * 0.5;
        m.quadCols('white', [
          x0 + nx, y0 + ny, x1 + nx, y1 + ny,
          x1 - nx, y1 - ny, x0 - nx, y0 - ny,
        ], 0, 0, 1, 1, [col, col, col, col]);
      }
    };
    for (const f of [0.34, 0.66]) {
      line([bx, by + drop * f, cx, cy + drop * f, dx, dy + drop * f], [0.478, 0.337, 0.173, 0.2]);
    }
    line([bx, by, cx, cy, dx, dy], [1, 0.98, 0.925, 0.55]);
  }

  // Whole map in one mesh, built in the same chunk-then-tile order the baked
  // chunks used so edge overlays still land on top of their own tile.
  _glGround(m, state) {
    const bs = 1 / this.data.scale;
    const transition = [];
    for (let cy = 0; cy < GROUND_CHUNK_ROWS; cy++) {
      for (let cx = 0; cx < GROUND_CHUNK_COLS; cx++) {
        const x0 = cx * GROUND_CHUNK;
        const y0 = cy * GROUND_CHUNK;
        transition.length = 0;
        for (let y = y0; y < Math.min(MAP_H, y0 + GROUND_CHUNK); y++) {
          for (let x = x0; x < Math.min(MAP_W, x0 + GROUND_CHUNK); x++) {
            const meta = this._meta(this._groundKey(state, x, y, this.fieldTiles));
            if (meta) this._glSprite(m, meta, x, y, bs);
            const decalKey = this._seabedDecal(state, x, y);
            const decal = decalKey && this._meta(decalKey);
            if (decal) this._glSprite(m, decal, x, y, bs);
            if (!state.roads[key(x, y)] && !state.paint[key(x, y)]
              && !this.fieldTiles.has(key(x, y))) {
              transition.push(x, y);
            }
          }
        }
        for (let i = 0; i < transition.length; i += 2) {
          const x = transition[i];
          const y = transition[i + 1];
          const from = terrainAt(x, y);
          let groups = null;
          for (const [nx, ny, bit] of [[x, y - 1, 1], [x + 1, y, 2], [x, y + 1, 4], [x - 1, y, 8]]) {
            if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
            const nk = key(nx, ny);
            if (state.roads[nk] || state.paint[nk] || this.fieldTiles.has(nk)) continue;
            const family = terrainEdgeFamily(from, terrainAt(nx, ny));
            if (!family) continue;
            if (!groups) groups = new Map();
            groups.set(family, (groups.get(family) || 0) | bit);
          }
          if (!groups) continue;
          for (const [family, mask] of groups) {
            const meta = this._meta(`g:edge:${family}:${mask}`);
            if (meta) this._glSprite(m, meta, x, y, bs);
          }
        }
      }
    }
  }

  // Daylight wash. The canvas gradient clamped to its last stop outside the
  // radius, so the quad is oversized and lets CLAMP_TO_EDGE reproduce that.
  _glPool(m) {
    const zoom = this.cam.zoom;
    const R = (Math.max(this.viewW, this.viewH) * 0.85) / zoom;
    const key = `${Math.round(R)}|${this.dpr}`;
    if (key !== this._glPoolKey) {
      this._glPoolKey = key;
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = 256;
      const g = c.getContext('2d');
      const px = 256 / (2 * R);
      const pool = g.createRadialGradient(
        128, 128 - 110 * px, Math.max(1, 40 * px),
        128, 128, 128,
      );
      pool.addColorStop(0, 'rgba(255, 238, 160, 0.14)');
      pool.addColorStop(0.5, 'rgba(255, 240, 170, 0.03)');
      pool.addColorStop(1, 'rgba(36, 92, 58, 0.14)');
      g.fillStyle = pool;
      g.fillRect(0, 0, 256, 256);
      this.glStage.setTexture('pool', c, { linear: true });
    }
    const cxw = ((MAP_W / 2) - (MAP_H / 2)) * HALF_W;
    const cyw = ((MAP_W / 2) + (MAP_H / 2)) * HALF_H;
    const S = R * 3;
    m.quad('pool', cxw - S, cyw - S, cxw + S, cyw + S, -1, -1, 2, 2);
  }

  // Locked plots: pale fog plus the screen-locked hatch. Only sixteen quads,
  // so it is rebuilt with the camera instead of adding a second cache.
  _glVeil(m, state) {
    const zoom = this.cam.zoom;
    const offX = this.viewW / 2 - this.cam.x * zoom;
    const offY = this.viewH / 2 + this.centerYOffset - this.cam.y * zoom;
    const fill = [0.871, 0.906, 0.839, 0.36];
    for (const p of PLOTS) {
      if (plotUnlocked(state, p)) continue;
      const q = [
        (p.x - p.y) * HALF_W, (p.x + p.y) * HALF_H,
        (p.x + p.w - p.y) * HALF_W, (p.x + p.w + p.y) * HALF_H,
        (p.x + p.w - p.y - p.d) * HALF_W, (p.x + p.w + p.y + p.d) * HALF_H,
        (p.x - p.y - p.d) * HALF_W, (p.x + p.y + p.d) * HALF_H,
      ];
      m.quadCols('white', q, 0, 0, 1, 1, [fill, fill, fill, fill]);
      const uvs = [];
      for (let i = 0; i < 8; i += 2) {
        uvs.push((q[i] * zoom + offX) / 16, (q[i + 1] * zoom + offY) / 16);
      }
      m.quadUV('hatch', q, uvs);
    }
  }

  _drawGrassWindGL() {
    if (!this._grassTiles || !this._grassTiles.length) return;
    const zoom = this.cam.zoom;
    if (zoom < 0.5) return;
    const t = this.time;
    const m = new Mesh('screen');
    const span = Math.max(this.viewW, this.viewH) * 1.6;
    const z = clamp(zoom, 0.75, 1.2);
    for (let i = 0; i < 3; i++) {
      const rx = (170 + i * 54) * z;
      const ry = (74 + i * 22) * z;
      const bx = ((t * (26 + i * 9) + (i * span) / 3) % (span * 1.3)) - span * 0.15;
      const by = this.viewH * (0.18 + i * 0.3) + (bx - this.viewW / 2) * 0.21
        + Math.sin(t * 0.11 + i * 1.7) * 22;
      const cos = Math.cos(0.46);
      const sin = Math.sin(0.46);
      const corner = (px, py) => [bx + px * cos - py * sin, by + px * sin + py * cos];
      const p0 = corner(-rx, -ry);
      const p1 = corner(rx, -ry);
      const p2 = corner(rx, ry);
      const p3 = corner(-rx, ry);
      m.quadPts('blob', p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1],
        0, 0, 1, 1, WHITE);
    }
    this.glStage.drawMesh(m, true);
  }

  // The same three cloud shadows, as a vertex-coloured fan. A 5% radial gradient
  // on the overlay canvas came out solid on the phone, and a texture would need
  // a premultiplied upload to keep its soft edge, so the falloff is carried by
  // the vertices instead: two rings, alpha 0.05 at the centre to 0 at the rim.
  _drawCloudsGL() {
    const t = this.time;
    const span = Math.max(this.viewW, this.viewH) * 1.8;
    const z = clamp(this.cam.zoom, 0.7, 1.25);
    const SEG = 24;
    const RINGS = [[0, 0.05], [0.55, 0.0256], [1, 0]];
    const tint = (a) => [44 / 255, 66 / 255, 56 / 255, a];
    const m = new Mesh('screen');
    for (let i = 0; i < 3; i++) {
      const x = (t * (13 + i * 5) + (i * span) / 3) % (span * 1.4) - span * 0.2;
      const y = this.viewH * (0.24 + i * 0.26) + Math.sin(t * 0.08 + i * 2.1) * 16;
      const r = (110 + i * 46) * z;
      const rx = r * 1.45;
      const ry = r * 0.72;
      const pt = (rr, th) => [x + Math.cos(th) * rx * rr, y + Math.sin(th) * ry * rr];
      for (let ring = 0; ring < RINGS.length - 1; ring++) {
        const [r0, a0] = RINGS[ring];
        const [r1, a1] = RINGS[ring + 1];
        const c0 = tint(a0);
        const c1 = tint(a1);
        for (let s = 0; s < SEG; s++) {
          const t0 = (s / SEG) * TAU;
          const t1 = ((s + 1) / SEG) * TAU;
          const p0 = pt(r0, t0);
          const p1 = pt(r0, t1);
          const p2 = pt(r1, t1);
          const p3 = pt(r1, t0);
          m.quadCols('white', [p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]],
            0, 0, 1, 1, [c0, c0, c1, c1]);
        }
      }
    }
    this.glStage.drawMesh(m);
  }

  // ---- water pre stage -----------------------------------------------------

  // Water/land mask for the sheen. The sheen quads are screen-space but the
  // mask is world-anchored, so the vertex shader hands the fragment stage the
  // world position to sample it with.
  //
  // Every diamond goes into one path and one fill: filling them separately
  // antialiased each shared edge, which at the old resolution dimmed the whole
  // mask to about half alpha and halved the sheen with it. Four texels per
  // tile across and two down keeps the coast edge inside half a tile.
  _glWaterMask(state) {
    const sig = `${this._groundSignature(state)}|${this.data.scale}`;
    if (sig === this._glWaterMaskKey) return this._glWaterMaskInfo;
    this._glWaterMaskKey = sig;
    const mw = (MAP_W + MAP_H) * 4;
    const mh = (MAP_W + MAP_H) * 2;
    const offX = -MAP_H * HALF_W;
    const ww = (MAP_W + MAP_H) * HALF_W;
    const wh = (MAP_W + MAP_H) * HALF_H;
    const sx = mw / ww;
    const sy = mh / wh;
    const c = document.createElement('canvas');
    c.width = mw;
    c.height = mh;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    const toC = (tx, ty) => [(tx - ty) * HALF_W * sx - offX * sx, (tx + ty) * HALF_H * sy];
    g.beginPath();
    for (const tile of this._waterFxTiles()) {
      if (state.roads[tile.k] || state.paint[tile.k]) continue;
      const a = toC(tile.x, tile.y);
      const b = toC(tile.x + 1, tile.y);
      const d = toC(tile.x + 1, tile.y + 1);
      const e = toC(tile.x, tile.y + 1);
      g.moveTo(a[0], a[1]);
      g.lineTo(b[0], b[1]);
      g.lineTo(d[0], d[1]);
      g.lineTo(e[0], e[1]);
      g.closePath();
    }
    g.fill();
    this.glStage.setTexture('waterMask', c, { linear: true });
    // The shader samples with normalized UVs, so the world-to-mask factor is
    // 1/worldSize — the pixel counts only matter when drawing the mask itself.
    this._glWaterMaskInfo = { tex: 'waterMask', off: [offX, 0], scale: [1 / ww, 1 / wh] };
    return this._glWaterMaskInfo;
  }

  // White radial profile, tinted per blob through the vertex colour. The canvas
  // version built a gradient object per colour/alpha pair; this is one texture
  // for all four patches.
  _glSheenTex() {
    if (this._glSheenReady) return;
    this._glSheenReady = true;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const g = c.getContext('2d');
    const img = g.createImageData(64, 64);
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const r = Math.min(1, Math.hypot((x + 0.5) / 32 - 1, (y + 0.5) / 32 - 1));
        let a;
        if (r <= 0.15) a = 1;
        else if (r <= 0.6) a = 1 - 0.45 * ((r - 0.15) / 0.45);
        else a = 0.55 * (1 - (r - 0.6) / 0.4);
        const i = (y * 64 + x) * 4;
        img.data[i] = 255;
        img.data[i + 1] = 255;
        img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * Math.max(0, a));
      }
    }
    g.putImageData(img, 0, 0);
    this.glStage.setTexture('sheen', c, { linear: true });
  }

  _waterSheenGL(runs, state) {
    const t = this.time;
    const zoom = this.cam.zoom;
    const mask = this._glWaterMask(state);
    this._glSheenTex();
    const verts = [];
    const blob = (tx, ty, radius, light, alpha) => {
      const p = this.tileToScreen(tx, ty);
      const r = radius * HALF_W * zoom;
      const c = light ? [190 / 255, 236 / 255, 226 / 255, alpha] : [16 / 255, 62 / 255, 78 / 255, alpha];
      const x0 = p.x - r;
      const y0 = p.y - r;
      const x1 = p.x + r;
      const y1 = p.y + r;
      verts.push(
        x0, y0, 0, 0, 0, c[0], c[1], c[2], c[3],
        x1, y0, 1, 0, 0, c[0], c[1], c[2], c[3],
        x1, y1, 1, 1, 0, c[0], c[1], c[2], c[3],
        x0, y0, 0, 0, 0, c[0], c[1], c[2], c[3],
        x1, y1, 1, 1, 0, c[0], c[1], c[2], c[3],
        x0, y1, 0, 1, 0, c[0], c[1], c[2], c[3],
      );
    };
    blob(56 + Math.sin(t * 0.16) * 5, 22 + Math.cos(t * 0.13) * 4, 15, true, 0.075);
    blob(67 + Math.cos(t * 0.11) * 6, 33 + Math.sin(t * 0.15) * 5, 13, false, 0.06);
    blob(48 + Math.sin(t * 0.12 + 2) * 4, 30 + Math.cos(t * 0.1 + 1) * 5, 10, true, 0.055);
    blob(8 + Math.sin(t * 0.14 + 1) * 2, 44 + Math.cos(t * 0.12) * 6, 6, true, 0.055);
    runs.push({ tex: 'sheen', space: 'screen', mask, verts });
  }

  // Crest decals stay screen-space: they animate through three atlas frames, so
  // they are rebuilt anyway and the canvas math carries over unchanged. Grouped
  // per atlas page; decals live inside their own tile diamond, so page order
  // never overlaps two of them.
  _waterSurfaceGL(runs, state) {
    const s = this.cam.zoom / this.data.scale;
    const groups = new Map();
    for (const tile of this._waterFxTiles()) {
      if (state.roads[tile.k] || state.paint[tile.k]) continue;
      const cover = tile.flow ? 0.46 : tile.deep ? 0.4 : 0.24;
      if (hash(tile.x, tile.y, 73) > cover) continue;
      const p = this.tileToScreen(tile.x, tile.y);
      if (!this.isOnScreen(p.x, p.y, 96)) continue;
      const f = Math.floor(this.time * 4.5 + tile.anim) % 3;
      const meta = this._meta(tile.deep ? `fx:deep:${tile.variant}:${f}` : `fx:water:${tile.variant}:${f}`);
      if (!meta) continue;
      const page = (this.data.pages || [])[meta.p] || { width: 1, height: 1 };
      let g = groups.get(meta.p);
      if (!g) {
        g = { tex: `atlas${meta.p}`, space: 'screen', verts: [] };
        groups.set(meta.p, g);
      }
      const a = tile.deep ? 0.85 : 1;
      const x0 = p.x - meta.ax * s;
      const y0 = p.y - meta.ay * s;
      const x1 = x0 + meta.w * s;
      const y1 = y0 + meta.h * s;
      const u0 = meta.x / page.width;
      const v0 = meta.y / page.height;
      const u1 = (meta.x + meta.w) / page.width;
      const v1 = (meta.y + meta.h) / page.height;
      g.verts.push(
        x0, y0, u0, v0, 0, 1, 1, 1, a,
        x1, y0, u1, v0, 0, 1, 1, 1, a,
        x1, y1, u1, v1, 0, 1, 1, 1, a,
        x0, y0, u0, v0, 0, 1, 1, 1, a,
        x1, y1, u1, v1, 0, 1, 1, 1, a,
        x0, y1, u0, v1, 0, 1, 1, 1, a,
      );
    }
    for (const g of groups.values()) runs.push(g);
  }

  // One quad per dash. At the widths the coast uses (about a pixel) a round cap
  // and a square end are the same pixel, so the solid white layer beats a
  // stretched glyph here and keeps the edges crisp.
  _glSeg(verts, x0, y0, x1, y1, w, c) {
    let dx = x1 - x0;
    let dy = y1 - y0;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = -dy * w * 0.5;
    const ny = dx * w * 0.5;
    const hx = dx * len * 0.5;
    const hy = dy * len * 0.5;
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    const ax = cx - hx;
    const ay = cy - hy;
    const bx = cx + hx;
    const by = cy + hy;
    verts.push(
      ax + nx, ay + ny, 0, 0, 0, c[0], c[1], c[2], c[3],
      bx + nx, by + ny, 1, 0, 0, c[0], c[1], c[2], c[3],
      bx - nx, by - ny, 1, 1, 0, c[0], c[1], c[2], c[3],
      ax + nx, ay + ny, 0, 0, 0, c[0], c[1], c[2], c[3],
      bx - nx, by - ny, 1, 1, 0, c[0], c[1], c[2], c[3],
      ax - nx, ay - ny, 0, 1, 0, c[0], c[1], c[2], c[3],
    );
  }

  _waterFxGL(runs, state) {
    const paths = this._waterFxContours(state);
    const wscale = clamp(this.cam.zoom, 0.55, 1.4);
    const verts = [];
    const seg = (arr, c, w) => {
      for (let i = 0; i < arr.length; i += 4) {
        this._glSeg(verts, arr[i], arr[i + 1], arr[i + 2], arr[i + 3], w, c);
      }
    };
    seg(paths.foam, [248 / 255, 253 / 255, 248 / 255, 0.3], Math.max(0.9, 1.3 * wscale));
    seg(paths.spark, [255 / 255, 252 / 255, 232 / 255, 0.45], Math.max(0.8, wscale));
    seg(paths.flow, [228 / 255, 246 / 255, 238 / 255, 0.24], Math.max(0.8, wscale));
    seg(paths.leaf, [142 / 255, 104 / 255, 56 / 255, 0.5], Math.max(1, 1.2 * wscale));
    if (verts.length) runs.push({ tex: 'white', space: 'screen', verts });
  }

  _seaLifeGL(runs, state) {
    this._seaLife();
    if (!this._schools.length) return;
    const t = this.time;
    const w = clamp(this.cam.zoom, 0.55, 1.4);
    const verts = [];
    for (const s of this._schools) {
      if (state.roads?.[s.k] || state.paint?.[s.k]) continue;
      const c = this.tileToScreen(s.x, s.y);
      if (!this.isOnScreen(c.x, c.y, 64)) continue;
      const fade = 0.42 + (Math.sin(t * 1.6 + s.phase) * 0.5 + 0.5) * 0.16;
      const col = [8 / 255, 40 / 255, 50 / 255, fade];
      for (let i = 0; i < s.n; i++) {
        const a = t * s.speed + s.phase + (i / s.n) * TAU;
        const fx = s.x + Math.cos(a) * s.radius;
        const fy = s.y + Math.sin(a) * s.radius * 0.6;
        const p = this.tileToScreen(fx, fy);
        const q = this.tileToScreen(
          fx - Math.sin(a) * 0.09 * Math.sign(s.speed),
          fy + Math.cos(a) * 0.054 * Math.sign(s.speed),
        );
        const ang = Math.atan2(p.y - q.y, p.x - q.x);
        const len = 2.4 * w;
        const dx = Math.cos(ang) * len;
        const dy = Math.sin(ang) * len;
        this._glSeg(verts, p.x - dx, p.y - dy, p.x + dx, p.y + dy,
          Math.max(1, 1.35 * w), col);
      }
    }
    if (verts.length) runs.push({ tex: 'white', space: 'screen', verts });
  }

  _drawWaterGL(state) {
    const runs = [];
    const on = (name) => !this._waterPasses || this._waterPasses.has(name);
    if (on('sheen')) this._waterSheenGL(runs, state);
    if (on('surface')) this._waterSurfaceGL(runs, state);
    if (on('fx')) this._waterFxGL(runs, state);
    if (on('sea')) this._seaLifeGL(runs, state);
    this._glWaterStats = runs.map((r) => `${r.tex}:${r.verts.length / 9}`);
    this.glStage.drawOrdered(runs);
  }

  _renderGL(state, ui) {
    const stage = this.glStage;
    stage.upBytes = 0;
    this._glAtlas();
    this._glScreen();

    const sig = this._groundSignature(state);
    const worldKey = `${sig}|${this.dpr}|${this.data.scale}`;
    if (worldKey !== this._glWorldKey) {
      if (sig !== this.groundSig) {
        this.groundSig = sig;
        this._syncGroundState(state);
      }
      const m = new Mesh('world');
      this._glMapBase(m);
      this._glCliffLines(m);
      this._glGround(m, state);
      stage.setLayer('world', m);
      this._glWorldKey = worldKey;
      this._glVeilKey = '';
    }

    const camKey = `${this.cam.x.toFixed(2)}|${this.cam.y.toFixed(2)}|${this.cam.zoom.toFixed(4)}`;
    if (camKey !== this._glVeilKey) {
      const m = new Mesh('world');
      this._glPool(m);
      this._glVeil(m, state);
      stage.setLayer('overlay', m);
      this._glVeilKey = camKey;
    }

    stage.frame({ x: this.cam.x, y: this.cam.y, zoom: this.cam.zoom, cy: this.centerYOffset });
    this._drawGrassWindGL();
    this._drawCloudsGL();
    if (this._waterGL) this._drawWaterGL(state);
    const list = this._buildList(state, ui);
    const uiGL = this._glUIStream;

    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.viewW, this.viewH);
    // Anything that still needs the 2D canvas lands here; when the switches are
    // all on, nothing does and the overlay is never uploaded.
    let canvasDrawn = false;
    if (!this._waterGL) {
      canvasDrawn = true;
      const on = (name) => !this._waterPasses || this._waterPasses.has(name);
      if (on('sheen')) this._drawWaterSheen(state);
      if (on('surface')) this._drawWaterSurface(state);
      if (on('fx')) this._drawWaterFx(state);
      if (on('sea')) this._drawSeaFx(state);
    }
    // The aura sits on the ground under its building, so it belongs before the
    // objects in both renderers.
    if (uiGL) this._drawBeerAuraGL(state);
    else {
      canvasDrawn = true;
      this._drawBeerAura(state);
    }
    if (ui.tool && !uiGL) {
      this._drawGrid();
      canvasDrawn = true;
    }
    if (!uiGL) {
      if (ui.selectedId) this._drawSelectionGround(state, ui);
      this._drawGhostGround(state, ui);
      this._drawHover(ui);
      canvasDrawn = true;
    }
    if (uiGL) this._glToolGround(state, ui);

    // The grid, the footprint fills and the ghost ground are paint on the
    // ground, so the object stream has to land on top of them — that is the
    // order the canvas arm gets for free and the ghost sprite sits inside its
    // own translucent fill.
    if (this._objGL) this._drawObjectsGL(state, list);

    this._drawObjects(list, state);
    // Labels, panels and badges are a single array run on top of the overlay;
    // the canvas twins stay as the ?uigl=0 arm and the no-WebGL fallback.
    if (!uiGL) {
      canvasDrawn = true;
      this._drawConstruction(state);
      this._drawCustomerMarks(state);
      this._drawFestival(state);
    }
    if (uiGL) {
      this._drawFXGL();
    } else {
      canvasDrawn = true;
      this._drawPuffs();
      this._drawGulls();
    }
    if (uiGL) {
      this._glDemolish(state, ui);
      this._glPlots(state);
    } else {
      canvasDrawn = true;
      this._drawDemolish(state, ui);
      this._drawPlots(state, true, false);
    }
    if (!uiGL) {
      canvasDrawn = true;
      this._drawBadges(state, ui);
      if (ui.selectedId) this._drawSelectionLabel(state, ui);
      this._drawFloaters();
    }
    this.glStage.overlay(canvasDrawn ? this.overlay : null);
    if (uiGL) this._drawUIGL(state, ui);
  }

  // Static stack: backdrop, sea shelf, ground chunks and the locked-plot veil.
  // On a phone these cost more than everything moving on top of them, and they
  // only change when the camera or the map does, so they are composited into
  // one viewport canvas and blitted. Everything animated still draws per frame
  // on top, in the same order as before — the veil ends up under the drifting
  // clouds, which is the one visual cost of keeping this to a single surface.
  // The animated layer is a texture while GL is alive, so it must not be in the
  // DOM. The canvas fallback has no way to show it otherwise, so it borrows the
  // element for as long as the context is gone.
  _showOverlay(on) {
    if (this.overlay === this.canvas || this._overlayShown === on) return;
    this._overlayShown = on;
    if (on) {
      this.overlay.className = 'frame-fallback';
      document.body.append(this.overlay);
    } else {
      this.overlay.remove();
    }
  }

  // A phone that lost WebGL keeps it lost on that surface: the driver never sends
  // the restore event and restoreContext() cannot undo an eviction it did not
  // cause — the 109 nudges in the first video proved that. The lever left is a new
  // element with a new context, and the second video's successor proved that works
  // too, just not always on the first try: the swap that ran while the kernel was
  // still holding the dead one got no context, and the next one drew the town. So
  // the gap grows instead of the attempts stopping, and a hidden page waits —
  // that is when a context is least likely to be granted and nothing is drawn.
  _recoverGL() {
    if (document.hidden) return;
    const stage = this.glStage;
    const now = performance.now();
    if (stage.swaps >= GL_SWAP_MAX) return;
    const wait = this._glSwapWait || 6000;
    if (now - (this._glSwapAt || stage.lostAt) < wait) return;
    this._glSwapAt = now;
    this._glSwapWait = Math.min(wait * 2, 60000);
    stage.replace();
    this.canvas = stage.canvas;
    // The node in the page changed whichever way that went: the old one is
    // detached, so sizing and the readout have to follow the live one.
    this.resize();
    // Input was bound to the node that just went away.
    this.onCanvasSwap?.();
  }

  render(state, ui = {}) {
    if (this.useGL) {
      if (this.glStage.tryRevive()) {
        this._glFellBack = false;
        // A context that has held for a while is worth the short gap again if it
        // goes, rather than the backoff a long session has built up.
        if (this.glStage.bornAt && performance.now() - this.glStage.bornAt > GL_SETTLE_MS) this._glSwapWait = 0;
        this._showOverlay(false);
        this._glActive = true;
        this._renderGL(state, ui);
        this._glActive = false;
        return;
      }
      this._recoverGL();
      // A lost context leaves nothing painted under the UI. The cached canvas
      // path finishes the frame instead, and GL takes the next one back as soon
      // as the context returns — the fallback is a bridge, not a demotion. It
      // is forced once: the cache keeps up with the camera on its own, and a
      // full re-bake per frame is exactly what the small GPU needs least.
      if (!this._glFellBack) {
        this._glFellBack = true;
        this._sceneForce = true;
      }
      this._showOverlay(true);
    }
    const skip = this.debugSkip || 0;
    if (skip) {
      this._renderDirect(state, ui, skip);
      return;
    }
    const now = performance.now();
    // The webview reclaims canvases under pressure; a cleared cache canvas is a
    // black town, which is worse than the slow path, so it steps aside after a
    // few bad builds and retries later.
    if (this._sceneLost) {
      if (now < this._sceneRetryAt) {
        this._renderDirect(state, ui, 0);
        return;
      }
      this._sceneLost = false;
      this._sceneFails = 0;
    }
    this._healGround(state);
    const ctx = this.ctx;
    const camKey = `${this.cam.zoom.toFixed(4)}|${Math.round(this.cam.x * 4)}|${Math.round(this.cam.y * 4)}|${Math.round(this.centerYOffset * 4)}`;
    const contentKey = `${this._groundSignature(state)}|${state.review?.level || 1}|${this._bakes}|${this._repairs}`;
    const moved = camKey !== this._sceneCamKey;
    const stale = contentKey !== this._sceneContent;
    // Checked on a timer, not only after a build: the webview can clear the
    // cache canvas at any moment, and a black town should last one check, not
    // the minute until the next refresh.
    if (!moved && this._sceneA && now - this._sceneCheckAt > SCENE_CHECK_MS) {
      this._sceneCheckAt = now;
      if (this._sceneAlive()) {
        this._sceneFails = 0;
      } else {
        this._sceneForce = true;
        if (++this._sceneFails >= 3) {
          this._sceneLost = true;
          this._sceneRetryAt = now + SCENE_RETRY_MS;
        }
      }
    }
    if (!this._sceneA || this._sceneForce || moved || stale
      || now - this._sceneAt > SCENE_REFRESH_MS) {
      this._sceneForce = false;
      // A camera that is already moving gets the budgeted bake so a pan does not
      // stall on a dozen chunks; standing still, the build finishes the map.
      this._buildScene(state, !moved);
      this._sceneCamKey = camKey;
      // Read the counters after the bake: it can add chunks and repairs, and a
      // key taken before it would make the next frame rebuild again.
      this._sceneContent = `${this._groundSignature(state)}|${state.review?.level || 1}|${this._bakes}|${this._repairs}`;
      this._sceneAt = now;
    }

    ctx.drawImage(this._sceneA, 0, 0, this.viewW, this.viewH);
    this._drawGrassWind();
    this._drawWaterSheen(state);
    this._drawWaterSurface(state);
    this._drawWaterFx(state);
    this._drawSeaFx(state);
    this._drawCloudShadows();
    this._drawBeerAura(state);
    if (ui.tool) this._drawGrid();
    if (ui.selectedId) this._drawSelectionGround(state, ui);
    this._drawGhostGround(state, ui);
    this._drawHover(ui);

    const list = this._buildList(state, ui);
    this._drawObjects(list, state);
    this._drawConstruction(state);
    this._drawCustomerMarks(state);
    this._drawFestival(state);
    this._drawPuffs();
    this._drawGulls();
    this._drawDemolish(state, ui);
    if (ui.selectedId) this._drawSelectionLabel(state, ui);
    this._drawBadges(state, ui);
    this._drawFloaters();
  }

  // Sampled through a small software canvas: reading the cache directly would
  // sync the GPU on every check, and this only has to answer "still opaque?".
  _sceneAlive() {
    let probe = this._sceneProbe;
    if (!probe) {
      probe = document.createElement('canvas');
      probe.width = 32;
      probe.height = 18;
      this._sceneProbe = probe;
    }
    const g = probe.getContext('2d', { willReadFrequently: true });
    if (!g) return true;
    g.globalCompositeOperation = 'copy';
    g.drawImage(this._sceneA, 0, 0, this._sceneA.width, this._sceneA.height, 0, 0, 32, 18);
    const pts = [[16, 9], [8, 4], [24, 4], [8, 14], [24, 14]];
    let live = 0;
    for (const [x, y] of pts) {
      const d = g.getImageData(x, y, 1, 1).data;
      if (d[3] > 200 && d[0] + d[1] + d[2] > 30) live++;
    }
    return live >= 3;
  }

  _buildScene(state, fullBake) {
    const W = Math.round(this.viewW * this.dpr);
    const H = Math.round(this.viewH * this.dpr);
    if (!this._sceneA) this._sceneA = document.createElement('canvas');
    if (this._sceneA.width !== W || this._sceneA.height !== H) {
      this._sceneA.width = W;
      this._sceneA.height = H;
    }
    const main = this.ctx;
    const a = this._sceneA.getContext('2d');
    a.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    a.imageSmoothingEnabled = false;
    this.ctx = a;
    this._drawBackdrop();
    this._drawMapBase();
    this._drawGround(state, fullBake);
    this._drawPlots(state);
    this.ctx = main;
    this._sceneBuilds++;
  }

  // Unchanged layer-by-layer path, kept for the device bisect (切层).
  _renderDirect(state, ui, skip) {
    // Device-side bisect: each step drops one more group of layers, so a phone
    // that cannot reach 60fps points at the expensive one without a rebuild.
    if (skip < 3) {
      this._drawBackdrop();
      this._drawMapBase();
    }
    if (skip < 4) this._drawGround(state);
    if (skip < 2) {
      this._drawGrassWind();
      this._drawWaterSheen(state);
      this._drawWaterSurface(state);
      this._drawWaterFx(state);
      this._drawSeaFx(state);
    }
    if (skip < 3) this._drawCloudShadows();
    if (skip < 1) this._drawPlots(state);
    this._drawBeerAura(state);
    if (ui.tool) this._drawGrid();
    if (ui.selectedId) this._drawSelectionGround(state, ui);
    this._drawGhostGround(state, ui);
    this._drawHover(ui);

    const list = this._buildList(state, ui);
    this._drawObjects(list, state);
    this._drawConstruction(state);
    this._drawCustomerMarks(state);
    this._drawFestival(state);
    this._drawPuffs();
    this._drawGulls();
    this._drawDemolish(state, ui);
    if (ui.selectedId) this._drawSelectionLabel(state, ui);
    this._drawBadges(state, ui);
    this._drawFloaters();
  }
}
