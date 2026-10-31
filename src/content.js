// Public content API. Every raw value lives in src/data/*.js; this module only
// re-exports it, owns the procedural terrain, and provides lookup helpers.

import { MAP_W, MAP_H, PLOT_W, PLOT_H, PLOTS, PLOT_BY_ID, TERRAIN_BUILDABLE } from './data/world.js';
import { BUILD_DEFS, CATEGORIES, INDUSTRY_CHAINS } from './data/buildings.js';
import { ROAD_STYLES, ROAD_COST } from './data/economy.js';

export * from './data/world.js';
export * from './data/economy.js';
export * from './data/customers.js';
export * from './data/review.js';
export * from './data/buildings.js';
export * from './data/missions.js';

export function plotAt(x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return null;
  return PLOT_BY_ID[PLOTS[Math.floor(y / PLOT_H) * 4 + Math.floor(x / PLOT_W)]?.id] || null;
}

export function plotAtTile(x, y) {
  return plotAt(x, y);
}

// ---------------------------------------------------------------------------
// Organic terrain. Coasts, lakes and rock fields are radial blobs with a
// noise-warped rim, so shores curve across plot borders instead of snapping to
// rectangles. terrainAt is cached: placement checks touch the same tiles often.

const TERRAIN_CACHE = new Map();
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function smoothstep(a, b, v) {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function hash2i(x, y, s = 0) {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, s = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothstep(0, 1, x - x0);
  const ty = smoothstep(0, 1, y - y0);
  const a = hash2i(x0, y0, s);
  const b = hash2i(x0 + 1, y0, s);
  const c = hash2i(x0, y0 + 1, s);
  const d = hash2i(x0 + 1, y0 + 1, s);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function fbm(x, y, s = 0) {
  return valueNoise(x, y, s) * 0.62
    + valueNoise(x * 2.03, y * 2.03, s + 9) * 0.26
    + valueNoise(x * 4.01, y * 4.01, s + 17) * 0.12;
}

// < 1 inside the blob. The rim wobbles with angle, so no two shores repeat and
// no blob ends on a straight plot edge.
function blobField(x, y, cx, cy, rx, ry, seed = 0) {
  const px = (x + 0.5 - cx) / rx;
  const py = (y + 0.5 - cy) / ry;
  const a = Math.atan2(py, px);
  const wobble = 1
    + (fbm(Math.cos(a) * 1.6 + 9.1, Math.sin(a) * 1.6 + 4.3, seed) - 0.5) * 0.38
    + Math.sin(a * 3 + seed * 0.7) * 0.05;
  return Math.hypot(px, py) / wobble;
}

// A single east coast runs through every eastern plot: it dips into a bay by
// the harbour, sweeps back out through the shallows and leaves the map below
// the pasture. Because the shore is global, plot seams never show as a cliff.
function coastShore(y) {
  const yy = y + 0.5;
  let shore = 60.4;
  shore -= smoothstep(7, 25, yy) * 5.6;
  shore += smoothstep(25, 37, yy) * 9.8;
  shore += smoothstep(37, 47, yy) * 19.5;
  shore += Math.sin(yy * 0.21 + 0.4) * 1.25;
  shore += Math.sin(yy * 0.083 + 2.3) * 1.7;
  shore += (valueNoise(yy * 0.09, 3.7, 41) - 0.5) * 2.6;
  return shore;
}

// 炸浪湾 is a tropical sand cay rather than a ring atoll: one blunt triangle of
// coral sand whose base is the map's east rim and whose head reaches west
// toward 渔港. The rim side is a single continuous beach — sand runs straight
// into the floating island's edge, with no water in between — and the inland
// keeps a ragged grove of beach grass. The shape follows a real cuspate
// foreland: a wide base, a blunt head, one long accreting shore. Rows 16–17
// stay deep water so 深渊海沟 keeps its gap.
const CAY_TIP = 61;
const CAY_RIM = 79;
const CAY_MID = 24.5;

// Half-width at column x, measured north and south of the mid line. The head is
// blunt rather than a needle — a needle reads as a drawing, and the ferry pier
// needs four rows there. The two sides are not mirrors: the south side runs
// wider, so the cay leans into the lower half of the plot and reads fatter
// toward the bottom of the screen.
function cayHalf(x, south) {
  const t = (x - CAY_TIP) / (CAY_RIM - CAY_TIP);
  return south
    ? Math.min(6.9, 1.9 + t * 6.5)
    : Math.min(7.0, 1.2 + t * 5.9);
}

function resortCay(x, y, base) {
  if (y < 18 || y > 31) return base;
  // The plot's west margin stays open sea: the head never reaches 渔港.
  if (x < CAY_TIP || x > CAY_RIM) return base;

  // Per-tile wobble keeps neither shore on a ruler line. The south side gets a
  // slow outward bulge on top, which fattens the lower lobe without narrowing
  // the lagoon the villas float in.
  const south = y > CAY_MID;
  const wobble = (valueNoise(x * 0.61 + 1.9, y * 0.61 + 6.7, 351) - 0.5) * 1.15
    + (valueNoise(x * 1.33 + 7.1, y * 1.33 + 2.3, 352) - 0.5) * 0.5;
  const bulge = south ? Math.max(0, valueNoise(x * 0.19 + 3.3, 0.5, 353) - 0.4) * 2.4 : 0;
  const half = cayHalf(x, south) + wobble * (south ? 1 : 0.85) + bulge;
  // Warp the row before measuring it: a linear taper plus a small wobble still
  // drew two long chords, and the south shore flattened against the plot line.
  // Two octaves of warp make both beaches snake instead.
  const warp = (valueNoise(x * 0.23 + 1.3, y * 0.23 + 4.9, 365) - 0.5) * 1.5
    + (valueNoise(x * 0.51 + 6.7, y * 0.51 + 2.1, 366) - 0.5) * 0.6;
  const off = Math.abs(y + warp - CAY_MID);

  if (off > half) {
    // The turquoise shelf stays a thin ribbon against the beach instead of a
    // broad noisy apron; a little wobble keeps it from reading as a drawn ring.
    const shelf = 0.95
      + valueNoise(x * 0.29 + 3.7, y * 0.29 + 8.3, 354) * 0.45
      + valueNoise(x * 0.73 + 5.1, y * 0.73 + 1.7, 355) * 0.2;
    if (off < half + shelf) return 'water';
    // 潟湖：四间水上屋的泊位需要浅水。一条贴岸的窄浅带罩住四组 2×2 泊位，
    // 其余三面保持薄边；y16–17 的深水缓冲不受影响。
    const lagoon = ((x + 0.5 - 68.0) / 4.75) ** 2 + ((y + 0.5 - 19.5) / 1.5) ** 2;
    if (lagoon < 1) return 'water';
    return 'deep';
  }

  // The last few columns are one open beach against the map rim, so the cay
  // meets the floating island's edge in sand instead of turf. The reach of that
  // beach wanders per row: a fixed column would draw a straight grass line
  // across the middle of the cay.
  const rimReach = CAY_RIM - 3 - valueNoise(y * 0.57 + 2.1, 0.5, 362) * 2.0;
  if (x >= rimReach) return 'coral';

  // Elsewhere the beach follows the shore, and beach grass fills the middle.
  // Grass has to sit well inland: sampling a field on its own sprinkled grass
  // diamonds over the sand, each one reading as a stamped tile. Gating on the
  // distance from the shore instead keeps one body of grove behind a
  // continuous beach, with a rim that still wanders.
  const inland = half - off;
  const beach = 2.0 + (valueNoise(x * 0.45 + 2.9, y * 0.45 + 9.1, 357) - 0.5) * 1.3;
  if (inland < beach) return 'coral';
  const grove = fbm(x * 0.26 + 3.7, y * 0.26 + 8.1, 361);
  // The cay's terrain is deliberately left alone. 炸浪湾 is pale coral sand and
  // turf by contract (see tests/resort.test.mjs): the tan `sand` material is
  // banned here, and `rock` is unbuildable, which would fence off the interior
  // the resort line has to build on. Its derelict state is carried by scenery
  // instead — dead stall frames and sunken slabs in PLOT_SCENERY.deepsea — so
  // the beaches keep the clean white look the 度假 line sells.
  return inland > beach + 0.6 + grove * 1.1 ? 'grass' : 'coral';
}

// 深渊海沟's northern reef is an atoll, not a rock shelf: a pale coral crest
// rings a shallow lagoon and the harbor's four jacket legs drop straight into
// the water. The crest stays just outside the fixed 5x4 site, so no foot lands
// on sand; only a few seaward rock heads break the ring.
const ABYSS_ATOLL = { cx: 63.5, cy: 5.0, rx: 4.2, ry: 3.5, seed: 141 };
const ABYSS_ATOLL_LAGOON = 0.82;
const ABYSS_ATOLL_RIM = 1.08;

function abyssAtoll(x, y) {
  const { cx, cy, rx, ry, seed } = ABYSS_ATOLL;
  const px = (x + 0.5 - cx) / rx;
  const py = (y + 0.5 - cy) / ry;
  const a = Math.atan2(py, px);
  // Milder than blobField's rim: a reef crest has to stay one continuous ring,
  // while the lagoon edge still wanders enough not to read as a drawn ellipse.
  const wobble = 1
    + (fbm(Math.cos(a) * 1.5 + 6.2, Math.sin(a) * 1.5 + 2.4, seed) - 0.5) * 0.24
    + Math.sin(a * 3 + 2.1) * 0.04;
  const r = Math.hypot(px, py) / wobble;
  if (r >= ABYSS_ATOLL_RIM) return null;
  if (r < ABYSS_ATOLL_LAGOON) return 'water';
  const head = valueNoise(x * 0.63 + 3.7, y * 0.63 + 6.1, 143);
  return r > 0.93 && head > 0.73 ? 'rock' : 'coral';
}

function eastTerrain(x, y, p) {
  // The atoll straddles the abyss/plain sea border, so it is painted before the
  // per-plot branches; outside the ring it leaves the normal coast alone.
  const atoll = abyssAtoll(x, y);
  if (atoll) return atoll;
  const d = coastShore(y) - (x + 0.5);
  let base = null;
  if (d <= 5.2) {
    if (d > 3.9) base = 'sand';
    else if (d > -3.4) base = 'water';
    else base = 'deep';
  }

  if (p.id === 'harbor') {
    const cove = blobField(x, y, 51.2, 24, 6.2, 4.3, 131);
    if (cove < 1) return 'water';
    if (cove < 1.18 && !base) return 'sand';
    return base;
  }
  if (p.id === 'abyss') {
    // The second outcrop is scenery only; the harbor's atoll is handled above.
    const r = blobField(x, y, 76, 12.2, 1.8, 1.2, 142);
    if (r < 1) return 'rock';
    if (r < 1.3) return 'sand';
    return base;
  }
  if (p.id === 'deepsea') return resortCay(x, y, base);
  if (p.id === 'coast') {
    const bar = blobField(x, y, 73.6, 38.2, 2.7, 1.35, 145);
    if (bar < 1) return 'sand';
    if (bar < 1.24 && base === 'deep') return 'water';
    return base;
  }
  return base;
}

// River and dock share one meandering centreline, so the water flows straight
// through the y=48 plot border and widens into the harbour basin.
function westRiverTerrain(x, y, p) {
  const active = p.id === 'river' || p.id === 'dock' || (p.id === 'forest' && y >= 27);
  if (!active) return null;
  const t = y - 32;
  const cx = 7.2 + Math.sin(t * 0.34) * 2.1 + Math.sin(t * 0.13 + 1) * 1.1;
  const half = y < 32
    ? 1.0 + smoothstep(27, 32, y) * 0.75
    : 1.65 + smoothstep(43, 60, y) * 5.9;
  const d = Math.abs(x + 0.5 - cx);
  if (d < half) return 'water';
  if (d < half + 1.15) return 'sand';
  if (p.id === 'dock') {
    const bay = blobField(x, y, 4.2, 59, 11.6, 7.1, 151);
    if (bay < 1) return 'water';
    if (bay < 1.16) return 'sand';
  }
  return null;
}

// 赤沙荒原 and 恐龙谷 are one erg: overlapping lobes instead of a single
// ellipse, then a low-frequency wind warp so dune fingers and inlets alternate
// along the rim. A variable apron turns the sand into pale gravel before grass,
// wider on the downwind (east) side, so the plot line never shows.
const ERG_LOBES = [
  [27.6, 5.4, 6.4, 4.3, 166],
  [35.4, 8.2, 5.4, 4.5, 181],
  [24.8, 13.4, 5.6, 3.7, 182],
  [31.4, 20.4, 7.4, 4.7, 183],
  [35.6, 26.4, 4.6, 3.5, 184],
  [29.9, 15.4, 5.6, 8.6, 185],
];

function desertErg(x, y) {
  let erg = Infinity;
  for (const [cx, cy, rx, ry, seed] of ERG_LOBES) {
    const f = blobField(x, y, cx, cy, rx, ry, seed);
    if (f < erg) erg = f;
  }
  const swell = fbm(x * 0.11 + 2.3, y * 0.11 + 7.1, 191);
  const grain = valueNoise(x * 0.42, y * 0.42, 192);
  return erg * (1 + (swell - 0.5) * 0.26 + (grain - 0.5) * 0.08);
}

function desertApron(x, y) {
  const downwind = Math.max(0, x - 30) * 0.006;
  return 0.14
    + downwind
    + (valueNoise(x * 0.23 + 3.1, y * 0.23 + 6.4, 194) - 0.5) * 0.12;
}

// The ice field is one cold sheet spread across plot borders, not a white
// rectangle inside 冰原. Overlapping lobes, a wind-warped rim and a variable
// gravel apron let snow drift south into the spruce wood while stopping well
// short of the warm erg next door.
const ICE_LOBES = [
  [9.6, 6.8, 9.6, 6.4, 221],
  [3.2, 11.4, 4.6, 3.6, 222],
  [15.4, 4.6, 5.2, 3.8, 223],
  [6.4, 17.8, 3.5, 2.9, 224],
  [11.4, 18.2, 2.8, 2.1, 225],
];
const ICE_NUNATAKS = [
  [18.2, 4.2, 2.2, 1.6, 231],
  [19.1, 9.6, 1.5, 1.1, 232],
  [17.4, 13.4, 1.7, 1.2, 233],
];

function iceFieldAt(x, y) {
  let field = Infinity;
  for (const [cx, cy, rx, ry, seed] of ICE_LOBES) {
    const f = blobField(x, y, cx, cy, rx, ry, seed);
    if (f < field) field = f;
  }
  const swell = fbm(x * 0.12 + 4.7, y * 0.12 + 1.9, 226);
  const grain = valueNoise(x * 0.38, y * 0.38, 227);
  return field * (1 + (swell - 0.5) * 0.3 + (grain - 0.5) * 0.1);
}

// Wider downwind (south/east) so the snow reads as wind-deposited rather than
// as a symmetrical blob. The noise term keeps the apron from paralleling the
// lobe outline.
function iceApron(x, y) {
  const lee = Math.max(0, x - 11) * 0.012 + Math.max(0, y - 9) * 0.016;
  return 0.13 + lee + (valueNoise(x * 0.24 + 2.7, y * 0.24 + 8.3, 228) - 0.5) * 0.13;
}

function northIcefield(x, y) {
  if (x < 0 || y < 0 || x > 23 || y > 23) return null;
  const field = iceFieldAt(x, y);
  if (field > 1) {
    if (field > 1 + iceApron(x, y)) return null;
    // Broken moraine: bare till shows through only where the apron is scoured,
    // so the belt reads as ragged ground instead of a paved rim around the snow.
    return valueNoise(x * 0.3 + 7.2, y * 0.3 + 2.4, 235) > 0.38 ? 'gravel' : null;
  }
  // A broken moraine chain closes the eastern rim, so snow never meets the
  // desert and the plot border is hidden behind rock ribs.
  for (const [cx, cy, rx, ry, seed] of ICE_NUNATAKS) {
    const r = blobField(x, y, cx, cy, rx, ry, seed);
    if (r < 1) return 'crag';
    if (r < 1.16) return 'gravel';
  }
  // Thermokarst: meltwater ponds freeze into blue ice, with no sandy shore.
  const lake = blobField(x, y, 13.6, 10.6, 3.6, 2.2, 229);
  if (lake < 1) return 'ice';
  const pond = blobField(x, y, 4.0, 12.4, 1.7, 1.2, 234);
  if (pond < 1) return 'ice';
  // The cave sits in a shallow thaw slump, its floor exposed gravel.
  const sink = blobField(x, y, 9.4, 4.6, 2.8, 1.9, 230);
  if (sink < 1) return 'gravel';
  return 'snow';
}

function inlandTerrain(x, y, p) {
  switch (p.id) {
    case 'south':
      return blobField(x, y, 30, 62.3, 4.6, 1.9, 121) < 1 ? 'sand' : 'grass';
    case 'dino': {
      // A dry wadi cuts across the erg from west to east. Pale gravel marks the
      // channel, sandstone buttes stand on its banks, and the erg itself is an
      // undulating sand sheet that fades through a wind-graded apron instead of
      // filling the rectangle.
      const erg = desertErg(x, y);
      if (erg > 1.06 + desertApron(x, y)) return 'grass';
      if (erg > 1) return 'sand';
      const wadi = Math.abs(y + 0.5 - (11.6 + Math.sin((x - 19) * 0.24 + 1.1) * 1.7 + Math.sin((x - 19) * 0.09) * 1.0));
      if (wadi < 0.9 + (valueNoise(x * 0.3, y * 0.3, 176) - 0.5) * 0.6) return 'sand';
      const butte = blobField(x, y, 26.0, 3.8, 3.0, 2.2, 163);
      if (butte < 1) return 'rock';
      if (butte < 1.14) return 'sand';
      const butte2 = blobField(x, y, 37.2, 10.2, 1.7, 1.3, 175);
      if (butte2 < 1) return 'rock';
      if (butte2 < 1.14) return 'sand';
      return 'desert';
    }
    case 'forest': {
      const pond = blobField(x, y, 7.4, 25.6, 5.4, 3.5, 165);
      if (pond < 1) return 'water';
      if (pond < 1.2) return 'sand';
      return 'grass';
    }
    case 'dune': {
      // Same erg as 恐龙谷, continued south. The worm-hole pan sits in fine
      // sand, a pale interdune channel runs off to the south-east, and a
      // sandstone ridge breaks the south-west corner. Every rim is warped, so
      // no side of the plot reads as a straight desert edge.
      const erg = desertErg(x, y);
      if (erg > 1.06 + desertApron(x, y)) return 'grass';
      if (erg > 1) return 'sand';
      const pan = blobField(x, y, 30, 24, 2.9, 2.5, 173);
      if (pan < 1) return 'sand';
      const channel = Math.abs(y + 0.5 - (19.6 + (x - 20) * 0.26 + Math.sin((x - 19) * 0.31 + 0.6) * 1.3));
      if (channel < 0.72 + (valueNoise(x * 0.28, y * 0.28, 178) - 0.5) * 0.55) return 'sand';
      const ridge = blobField(x, y, 22.4, 28.4, 3.4, 2.1, 172);
      if (ridge < 1) return 'rock';
      if (ridge < 1.18) return 'sand';
      const isle = blobField(x, y, 36.8, 18.2, 2.3, 1.6, 174);
      if (isle < 1) return 'sand';
      return 'desert';
    }
    case 'plaza': {
      const stone = blobField(x, y, 49.6, 39.2, 8.2, 5.6, 167);
      // Shared neck so the central plaza and the east market read as one paved
      // surface across the y=48 plot border instead of two islands.
      const neck = blobField(x, y, 49.5, 48, 5.2, 4.6, 171);
      if (stone < 1 || neck < 1) return 'plaza';
      if (stone < 1.2 || neck < 1.2) return 'sand';
      return 'grass';
    }
    case 'market': {
      const stalls = blobField(x, y, 49.2, 55.6, 7.4, 5.0, 168);
      const neck = blobField(x, y, 49.5, 48, 5.2, 4.6, 171);
      if (stalls < 1 || neck < 1) return 'plaza';
      if (stalls < 1.22 || neck < 1.2) return 'sand';
      return 'grass';
    }
    case 'farm': {
      const pond = blobField(x, y, 25.5, 44, 2.5, 1.7, 169);
      if (pond < 1) return 'water';
      if (pond < 1.3) return 'sand';
      return 'grass';
    }
    case 'pasture': {
      const pond = blobField(x, y, 67.5, 57.2, 3.0, 1.9, 170);
      if (pond < 1) return 'water';
      if (pond < 1.28) return 'sand';
      return 'grass';
    }
    default:
      return 'grass';
  }
}

export function terrainAt(x, y) {
  const cacheKey = x * 128 + y;
  const hit = TERRAIN_CACHE.get(cacheKey);
  if (hit !== undefined) return hit;
  const p = plotAt(x, y);
  const terrain = p
    ? (northIcefield(x, y) || westRiverTerrain(x, y, p) || eastTerrain(x, y, p) || inlandTerrain(x, y, p))
    : 'void';
  TERRAIN_CACHE.set(cacheKey, terrain);
  return terrain;
}

// Seabed cover is drawn as a transparent decal on top of the water tile, so the
// shoreline, foam and animated ripples stay in charge of the coastline. A slow
// field starts the beds, a faster mask breaks them into clusters; without the
// second mask every bed would be one rectangular slab.
const SEABED_CACHE = new Map();

export function seabedAt(x, y) {
  const cacheKey = x * 128 + y;
  const hit = SEABED_CACHE.get(cacheKey);
  if (hit !== undefined) return hit;
  const terrain = terrainAt(x, y);
  let bed = null;
  if (terrain === 'water') {
    const patch = fbm(x * 0.14 + 11.3, y * 0.14 + 5.7, 201);
    const grain = valueNoise(x * 0.36 + 4.1, y * 0.36 + 9.2, 202);
    if (patch > 0.56 && grain > 0.5) bed = 'kelp';
    else if (patch < 0.44 && grain > 0.56) bed = 'reef';
  } else if (terrain === 'deep') {
    const patch = fbm(x * 0.13 + 3.7, y * 0.13 + 12.4, 211);
    const grain = valueNoise(x * 0.33 + 1.7, y * 0.33 + 6.4, 212);
    if (patch > 0.55 && grain > 0.48) bed = 'shoal';
  }
  SEABED_CACHE.set(cacheKey, bed);
  return bed;
}

// Which transition band to paint on a tile whose neighbour is a different
// material. Families are keyed by what the current tile becomes near the edge.
export function terrainEdgeFamily(from, to) {
  if (!from || !to || from === 'void' || to === 'void' || from === to) return null;
  const wet = (t) => t === 'water' || t === 'deep';
  if (from === 'deep' && to === 'water') return 'shallowfade';
  if (from === 'water' && to === 'deep') return 'deepfade';
  // Coral shores get a wider, more broken foam band than the tan beaches.
  if (from === 'water' && to === 'coral') return 'coralFoam';
  if (wet(from) && !wet(to)) return from === 'water' ? 'foam' : 'deepShore';
  if (!wet(from) && wet(to)) {
    if (from === 'sand') return 'shore';
    if (from === 'coral') return 'coralShore';
    if (from === 'rock') return 'rock';
    return 'bank';
  }
  if (to === 'coral' || from === 'coral') {
    // Sand and lawn bleed into each other from both sides: coral spills onto
    // the grass tile, and dune grass creeps back onto the coral tile.
    if (from === 'coral' && to === 'grass') return 'coralGrass';
    return 'coral';
  }
  if (to === 'snow' || to === 'ice' || to === 'gravel' || to === 'crag') return to;
  if (from === 'snow' || from === 'ice' || from === 'gravel' || from === 'crag') {
    if (to === 'grass') return 'tundra';
  }
  if (to === 'desert') return 'desert';
  if (to === 'sand') return 'sand';
  if (to === 'grass') return 'grass';
  if (to === 'rock') return 'rock';
  if (to === 'plaza') return 'plaza';
  return null;
}

export function terrainBuildable(t) {
  return TERRAIN_BUILDABLE.has(t);
}

// ---------------------------------------------------------------------------
// Lookup helpers. Data tables stay in src/data; only interpretation lives here.

export function chainOf(def) {
  return INDUSTRY_CHAINS.find((c) => c.id === def?.chain) || null;
}

// Anything drawn from a square sprite or prop can be turned a quarter at a
// time. Fields are tile-painted, and the wide gate is fixed to the south edge.
export function isRotatable(def) {
  return !!(def && (def.sprite || def.prop) && !def.unremovable && def.kind !== 'field' && def.w === def.d);
}

export function defOf(type) {
  return BUILD_DEFS[type] || null;
}

const ROAD_STYLE_BY_ID = Object.fromEntries(ROAD_STYLES.map((s) => [s.id, s]));

export function roadStyleOf(value) {
  if (!value || value === 1 || value === true) return ROAD_STYLE_BY_ID.asphalt;
  return ROAD_STYLE_BY_ID[value] || ROAD_STYLE_BY_ID.asphalt;
}

export function roadStyleCost(style) {
  return (ROAD_STYLE_BY_ID[style] || ROAD_STYLE_BY_ID.asphalt).cost || ROAD_COST;
}

export function roadSpriteKey(value, mask) {
  const style = roadStyleOf(value);
  return style.id === 'asphalt' ? `g:road:${mask}` : `g:road:${style.id}:${mask}`;
}

export function unlockLevelOf(def) {
  return def?.level || 1;
}

export function unlockedAtLevel(def, level) {
  return unlockLevelOf(def) <= (level || 1);
}

export function categoriesWithContent() {
  return CATEGORIES.filter((c) => Object.values(BUILD_DEFS).some((d) => d.cat === c.id && !d.hidden));
}

export function missionProgress(state, mission) {
  if (mission.flag) return state.flags?.[mission.flag] ? 1 : 0;
  if (mission.stat) return state.stats[mission.stat] || 0;
  const built = state.objects.filter((o) => o.built !== false);
  if (mission.count) return built.filter((o) => o.type === mission.count).length;
  if (mission.counts) {
    return mission.counts.filter((type) => built.some((o) => o.type === type)).length;
  }
  if (mission.countCat) {
    return built.filter((o) => !o.natural && defOf(o.type)?.cat === mission.countCat).length;
  }
  if (mission.review) return state.review?.points || 0;
  return 0;
}
