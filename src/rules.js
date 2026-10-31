import {
  BUILD_DEFS, MISSION_DEFS, MAP_W, MAP_H, STORAGE_BASE, STORAGE_PER_WAREHOUSE,
  RESOURCES,
  PAVE_COST, BRIDGE_COST, BRIDGE_LEVEL, BRIDGE_PLOTS, ICE_ROAD_COST,
  GAME_MIN_PER_SEC, DAY_MINUTES, RES_ORDER, SCENERY,
  PLOTS, PLOT_BY_ID, PLOT_SCENERY, plotAt, terrainAt, terrainBuildable, TERRAIN_NAME,
  TOLL_FEE, CUSTOMER_MAX, SPAWN_BASE, SPAWN_MIN, QUEUE_MAX, CUSTOMER_SPEED,
  PATIENCE_WALK, PATIENCE_QUEUE, PATIENCE_DRAIN, REVIEWER_EVERY, REVIEWER_BONUS,
  REVIEWER_REVIEW, REVIEW_HALL_UNLOCK, REVIEW_DIMS, FESTIVAL_PROMOTION_REVIEW,
  STROLL_RADIUS, STROLL_WAIT_MIN, STROLL_WAIT_MAX, STROLL_SECOND_CHANCE,
  STROLL_LOOK_FIRST_MIN, STROLL_LOOK_FIRST_SPREAD, STROLL_LOOK_MIN, STROLL_LOOK_SPREAD,
  CUSTOMER_STEP_TIME, CUSTOMER_TYPES, SHOP_DISTANCE_PULL, SHOP_QUEUE_PENALTY,
  SHOP_CRAVING_MIN, SHOP_CRAVING_SPREAD,
  SALE_TIMER_DECAY, SPAWN_JITTER_MIN, SPAWN_JITTER_SPREAD, SPAWN_FESTIVAL_RATE,
  SPAWN_FESTIVAL_MIN_RATE, SPAWN_RETRY_ROAD, SPAWN_RETRY_BLOCKED, SPAWN_TICK_FALLBACK,
  SPAWN_FIRST_DELAY, REFUND_RATE, RESCUE_AFTER, RESCUE_COST_FALLBACK,
  INITIAL_COINS, INITIAL_RESOURCES, INITIAL_TIME_MIN, INITIAL_ROADS, INITIAL_OBJECTS,
  SCENERY_TARGET, SCENERY_TRIES, SCENERY_KEEP_OPEN, SCENERY_KEEP_OPEN_BRIDGE, SCENERY_GROUND, SCENERY_PLOTS, BRIDGE_SITE, ABYSS_WELLHEAD_SITE, WORLD_SEED, INITIAL_REVIEW,
  REVIEW_LEVEL_REQ, MAX_LEVEL, FESTIVAL_COST, FESTIVAL_TIME, FESTIVAL_REWARD,
  FESTIVAL_TARGET_BASE, FESTIVAL_TARGET_PER_LEVEL,
  defOf, missionProgress, isRotatable, unlockLevelOf, unlockedAtLevel,
  roadStyleOf, LEVEL_CHAIN_REQS,
} from './content.js';
import { SAVE, SPEED } from './data/runtime.js';
import { isEnglish } from './i18n.js';

export const SAVE_VERSION = SAVE.VERSION;

// Old saves were generated when 赤沙荒原 was a festival plaza. When they load,
// natural town furniture on the two desert plots is swapped for desert scenery;
// anything the player built is left alone.
const DESERT_PLOTS = new Set(['dune', 'dino']);
// Keep in step with the desert rows of PLOT_SCENERY: anything the desert is
// allowed to grow has to survive a reload, otherwise the scenery silently
// disappears on the next load.
const DESERT_SCENERY_TYPES = new Set([
  'rock', 'cactus', 'dryBush', 'tumbleweed', 'bones', 'mesa', 'acacia',
  'wormHole', 'wormFarm', 'dinoGraveyard', 'paleoLab',
  'duneRibs', 'desertWell', 'duneSignpost', 'abyssRock', 'stumpStool',
]);

export const SPEED_BOOST_MS = SPEED.BOOST_MS;

export const key = (x, y) => `${x},${y}`;

// Ground rules, in one place. A scenery type may only be planted on a tile
// that passes three gates:
//   1. its own `terrain` list (this prop is made of ice),
//   2. the world's SCENERY_GROUND row (an acacia belongs to dry ground),
//   3. the world's SCENERY_PLOTS row (a snow pine belongs to the snowfield,
//      not to the lawn at the foot of it).
// Gate 3 exists because plots keep grassy fringes on purpose — the icefield has
// a lawn, the dunes have a green edge — so terrain alone still lets the wrong
// climate through.
export function mayGrow(type, terrain, plotId = null) {
  const def = defOf(type);
  if (!def) return false;
  if (Array.isArray(def.terrain) && !def.terrain.includes(terrain)) return false;
  const ground = SCENERY_GROUND[type];
  if (Array.isArray(ground) && !ground.includes(terrain)) return false;
  const plots = SCENERY_PLOTS[type];
  if (Array.isArray(plots) && plotId && !plots.includes(plotId)) return false;
  return true;
}

// Build timers run up to 30 minutes, so UI copy cannot assume seconds.
export function formatSeconds(value, short = false) {
  const total = Math.max(0, Math.ceil(Number(value) || 0));
  const en = isEnglish();
  const uSec = en ? 's' : '秒';
  const uMin = en ? 'm' : '分';
  const uHour = en ? 'h' : '小时';
  const part = (n, unit) => (short ? `${n}${unit}` : `${n} ${unit}`);
  if (total < 60) return part(total, uSec);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes < 60) return seconds ? `${part(minutes, uMin)} ${part(seconds, uSec)}` : part(minutes, uMin);
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${part(hours, uHour)} ${part(rest, uMin)}` : part(hours, uHour);
}

// The worm hole surfaces on simulated time, so 2x/3x speed up the whole loop
// and the phase needs no save field. Harvest (worm line) lands at the end of
// the dive, 22 s in.
export const WORM_CYCLE = 26;
export const WORM_HARVEST_AT = 22;

const WORM_PHASES = [
  { id: 'dormant', label: '潜伏', start: 0, end: 10 },
  { id: 'breach', label: '破沙', start: 10, end: 13 },
  { id: 'tower', label: '翻腾', start: 13, end: 19 },
  { id: 'dive', label: '钻回', start: 19, end: 22 },
  { id: 'settle', label: '沉降', start: 22, end: 26 },
];

export function wormPhase(simTime) {
  const t = ((Number(simTime) || 0) % WORM_CYCLE + WORM_CYCLE) % WORM_CYCLE;
  let phase = WORM_PHASES[WORM_PHASES.length - 1];
  for (const p of WORM_PHASES) {
    if (t >= p.start && t < p.end) {
      phase = p;
      break;
    }
  }
  const elapsed = t - phase.start;
  const span = phase.end - phase.start;
  const remaining = phase.end - t;
  return {
    id: phase.id,
    label: phase.label,
    t,
    elapsed,
    remaining,
    progress: elapsed / span,
    // Time to the next surfacing, counting from the current cycle's breach.
    nextBreach: t < WORM_PHASES[1].start
      ? WORM_PHASES[1].start - t
      : WORM_CYCLE - t + WORM_PHASES[1].start,
    nextHarvest: t < WORM_HARVEST_AT
      ? WORM_HARVEST_AT - t
      : WORM_CYCLE - t + WORM_HARVEST_AT,
    cycle: WORM_CYCLE,
  };
}

export function wormHarvestsBetween(prev, next) {
  if (!(next > prev)) return 0;
  let k = Math.floor((prev - WORM_HARVEST_AT) / WORM_CYCLE) + 1;
  let count = 0;
  while (WORM_HARVEST_AT + k * WORM_CYCLE <= next + 1e-9) {
    count += 1;
    k += 1;
  }
  return count;
}

// The giant octopus breathes on its own slower loop: it lurks with the mantle
// barely above the vortex, hauls itself up, spreads all eight arms, then folds
// back under. Like the worm the clock is simulated time, so speed-up applies
// and no phase field needs saving.
export const OCTOPUS_CYCLE = 40;

const OCTOPUS_PHASES = [
  { id: 'lurk', label: '潜伏', start: 0, end: 14 },
  { id: 'rise', label: '浮升', start: 14, end: 18 },
  { id: 'spread', label: '舒展', start: 18, end: 30 },
  { id: 'fold', label: '收拢', start: 30, end: 34 },
  { id: 'sink', label: '下潜', start: 34, end: 40 },
];

export function octopusPhase(simTime) {
  const t = ((Number(simTime) || 0) % OCTOPUS_CYCLE + OCTOPUS_CYCLE) % OCTOPUS_CYCLE;
  let phase = OCTOPUS_PHASES[OCTOPUS_PHASES.length - 1];
  for (const p of OCTOPUS_PHASES) {
    if (t >= p.start && t < p.end) {
      phase = p;
      break;
    }
  }
  const elapsed = t - phase.start;
  const span = phase.end - phase.start;
  return {
    id: phase.id,
    label: phase.label,
    t,
    elapsed,
    remaining: phase.end - t,
    progress: elapsed / span,
    nextSurge: t < OCTOPUS_PHASES[1].start
      ? OCTOPUS_PHASES[1].start - t
      : OCTOPUS_CYCLE - t + OCTOPUS_PHASES[1].start,
    cycle: OCTOPUS_CYCLE,
  };
}

export const inBounds = (x, y, w = 1, d = 1) =>
  Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x + w <= MAP_W && y + d <= MAP_H;

export function eachTile(o, fn) {
  for (let y = o.y; y < o.y + o.d; y++) {
    for (let x = o.x; x < o.x + o.w; x++) fn(x, y);
  }
}

export function objectAt(state, x, y) {
  for (let i = state.objects.length - 1; i >= 0; i--) {
    const o = state.objects[i];
    if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.d) return o;
  }
  return null;
}

export function objectById(state, id) {
  return state.objects.find((o) => o.id === id) || null;
}

export function gateOf(state) {
  return state.objects.find((o) => o.type === 'tollGate') || null;
}

// Any building whose def carries `entrance` feeds guests into the town. The
// south gate is a paved arch; the river bridge is a covered span that arrives
// from the west. Geometry and toll stay in the def so rules never need to know
// a specific building id.
export function entranceDefOf(def) {
  return def?.entrance || null;
}

export function entrancePassageTiles(entrance) {
  const out = [];
  if (!entrance || !entranceDefOf(defOf(entrance.type))?.roadPassage) return out;
  for (let y = entrance.y; y < entrance.y + entrance.d; y++) {
    for (let x = entrance.x + 1; x < entrance.x + entrance.w - 1; x++) out.push(key(x, y));
  }
  return out;
}

export function entranceDrivewayTiles(entrance) {
  const out = [];
  const e = entranceDefOf(defOf(entrance?.type));
  if (!entrance || !e) return out;
  if (e.driveway === 'east' || e.driveway === 'west') {
    const x = e.driveway === 'east' ? entrance.x + entrance.w : entrance.x - 1;
    for (let y = entrance.y + 1; y < entrance.y + entrance.d - 1; y++) out.push(key(x, y));
    return out;
  }
  const y = e.driveway === 'south' ? entrance.y + entrance.d : entrance.y - 1;
  for (let x = entrance.x + 1; x < entrance.x + entrance.w - 1; x++) out.push(key(x, y));
  return out;
}

export function isEntrancePassage(state, x, y) {
  for (const o of state.objects) {
    if (!entranceDefOf(defOf(o.type))?.roadPassage) continue;
    if (x >= o.x + 1 && x < o.x + o.w - 1 && y >= o.y && y < o.y + o.d) return true;
  }
  return false;
}

export function isGatePassage(state, x, y) {
  return isEntrancePassage(state, x, y);
}

export function gatePassageTiles(gate) {
  return entrancePassageTiles(gate);
}

function entranceRoadState(state, entrance) {
  const e = entranceDefOf(defOf(entrance?.type));
  if (!entrance || !e) return { passageOpen: false, drivewayOpen: false, ok: false };
  const passageOpen = !e.roadPassage
    || entrancePassageTiles(entrance).every((k) => !!state.roads[k]);
  const drivewayOpen = entranceDrivewayTiles(entrance).some((k) => !!state.roads[k]);
  return { passageOpen, drivewayOpen, ok: passageOpen && drivewayOpen && isBuilt(entrance) };
}

export function entranceOpen(state, entrance) {
  return !!entrance && entranceRoadState(state, entrance).ok;
}

export function entrancesOf(state, { built = false } = {}) {
  const list = state.objects.filter((o) => !!entranceDefOf(defOf(o.type)));
  return built ? list.filter((o) => isBuilt(o)) : list;
}

export function primaryEntrance(state) {
  return gateOf(state) || entrancesOf(state)[0] || null;
}

export function entranceById(state, id) {
  if (id === undefined || id === null) return null;
  return state.objects.find((o) => o.id === id && !!entranceDefOf(defOf(o.type))) || null;
}

export function gatePassageOpen(state, gate = gateOf(state)) {
  return !!gate && entranceRoadState(state, gate).ok;
}

// ---------------------------------------------------------------------------
// Plots & terrain

export function plotUnlocked(state, plot) {
  const p = typeof plot === 'string' ? PLOT_BY_ID[plot] : plot;
  return !!p && (state.review?.level || 1) >= p.rank;
}

export function unlockedPlots(state) {
  return PLOTS.filter((p) => plotUnlocked(state, p));
}

export function plotsUnlockedAt(level) {
  return PLOTS.filter((p) => p.rank === level);
}

export function plotOf(x, y) {
  return plotAt(x, y);
}

function terrainLabel(t) {
  return t === 'water' ? '水面' : (TERRAIN_NAME[t] || t);
}

// Most buildings take grass/sand/plaza. A def can replace that allowlist with
// its own terrain (river traps sit on water) and limit itself to certain plots.
// Footprints may straddle plot borders as long as every covered tile sits on an
// unlocked, allowed plot and on buildable terrain.
//
// `plots` is deliberately rare now (2026-10-27). Production, food and lodging
// buildings may go on any unlocked plot: the player asked for a rule of "fixed
// landmarks and water-only buildings aside, build anywhere", and the map is
// already gated by level (a plot you have not unlocked cannot take anything).
// What stays plot-bound, and why:
//   - ferryPier, the cay's only entrance — its driveway has to face the island.
//   - deepSeaHarbor, rebuilt from the wellhead, never hand-placed.
//   - the decor catalog, where plot membership is what makes a snow pine read
//     as belonging to the icefield and a street clock as belonging to the town.
// Water-only buildings keep their `terrain: ['water']` gate — that is a
// physical constraint, not a plot rule, so a fishing boat still cannot sit on
// grass.
function footprintCheck(state, x, y, w, d, def = null) {
  if (!inBounds(x, y, w, d)) return { ok: false, reason: '超出小镇边界' };
  const anchor = plotAt(x, y);
  if (!anchor) return { ok: false, reason: '超出小镇边界' };
  for (let ty = y; ty < y + d; ty++) {
    for (let tx = x; tx < x + w; tx++) {
      const plot = plotAt(tx, ty);
      if (!plot) return { ok: false, reason: '超出小镇边界' };
      if (!plotUnlocked(state, plot)) return { ok: false, reason: `${plot.name}尚未解锁（Lv.${plot.rank}）` };
      if (def?.plots && !def.plots.includes(plot.id)) {
        const names = def.plots.map((id) => PLOT_BY_ID[id]?.name).filter(Boolean).join(' / ');
        return { ok: false, reason: `${def.name}只能建在${names}` };
      }
      const t = terrainAt(tx, ty);
      const allowed = def?.terrain ? def.terrain.includes(t) : terrainBuildable(t);
      if (!allowed) {
        const reason = def?.terrain
          ? `${def.name}只能建在${def.terrain.map(terrainLabel).join(' / ')}`
          : `${t === 'rock' ? '岩地' : t === 'crag' ? '冰岩' : t === 'ice' ? '冰面' : '水面'}不能施工`;
        return { ok: false, reason };
      }
    }
  }
  return { ok: true, plot: anchor };
}

// Orthogonal edge contact only: a shared corner does not count as attached.
function findEdgeObject(state, x, y, w, d, match) {
  for (let tx = x; tx < x + w; tx++) {
    for (const ty of [y - 1, y + d]) {
      const o = objectAt(state, tx, ty);
      if (o && match(o)) return o;
    }
  }
  for (let ty = y; ty < y + d; ty++) {
    for (const tx of [x - 1, x + w]) {
      const o = objectAt(state, tx, ty);
      if (o && match(o)) return o;
    }
  }
  return null;
}

export function adjacentBarn(state, o, barnType) {
  if (!o || !barnType) return null;
  return findEdgeObject(state, o.x, o.y, o.w, o.d, (b) => b.type === barnType);
}

export function rangesAttachedTo(state, barn, rangeType) {
  return state.objects.filter((o) => o.type === rangeType && o.barnId === barn.id);
}

export function canPlace(state, type, x, y, free = false) {
  const def = defOf(type);
  if (!def) return { ok: false, reason: '未知建筑' };
  if (def.hidden) return { ok: false, reason: '这不是可建造建筑' };
  const level = state.review?.level || 1;
  if (!unlockedAtLevel(def, level)) {
    return { ok: false, reason: `需要小镇 Lv.${unlockLevelOf(def)}（当前 Lv.${level}）` };
  }
  if (def.requireFlag && !state.flags?.[def.requireFlag]) {
    return { ok: false, reason: def.requireFlagReason || `尚未解锁${def.name}` };
  }
  const foot = footprintCheck(state, x, y, def.w, def.d, def);
  if (!foot.ok) return foot;
  for (let ty = y; ty < y + def.d; ty++) {
    for (let tx = x; tx < x + def.w; tx++) {
      if (state.roads[key(tx, ty)]) return { ok: false, reason: '不能压在道路上' };
      if (objectAt(state, tx, ty)) return { ok: false, reason: '这里已经有东西了' };
    }
  }
  if (def.unique && state.objects.some((o) => o.type === type)) {
    return { ok: false, reason: `全镇只能有一座${def.name}` };
  }
  if (def.unlockPoints && (state.review?.points || 0) < def.unlockPoints) {
    return { ok: false, reason: `需要评分 ${def.unlockPoints}（当前 ${Math.floor(state.review?.points || 0)}）` };
  }
  if (def.needsBarn) {
    const barn = defOf(def.needsBarn);
    const attached = findEdgeObject(state, x, y, def.w, def.d, (o) => (
      o.type === def.needsBarn
      || (o.type === type && (!!o.barnId || !!adjacentBarn(state, o, def.needsBarn)))
    ));
    if (!attached) {
      return { ok: false, reason: `必须有一条边紧贴${barn?.name || '对应畜棚'}或同类型场地` };
    }
  }
  if (!free && state.coins < def.cost) return { ok: false, reason: '金币不够' };
  return { ok: true };
}

export function makeObject(state, type, x, y, opts = {}) {
  const def = defOf(type);
  if (!def) return null;
  const o = {
    id: state.nextId++,
    type,
    x,
    y,
    w: def.w,
    d: def.d,
    variant: opts.variant ?? Math.floor(Math.random() * (def.variants || 1)),
    rot: isRotatable(def) ? ((Number(opts.rot) || 0) % 4 + 4) % 4 : 0,
    timer: opts.timer || 0,
    growth: opts.growth || 0,
    natural: !!opts.natural,
    connected: true,
    built: true,
    buildLeft: 0,
    buildTotal: 0,
  };
  state.objects.push(o);
  state.sceneRev = (state.sceneRev || 0) + 1;
  recompute(state);
  return o;
}

export function reviewRaw(state) {
  const r = state?.review;
  if (!r) return 0;
  return Math.floor((r.taste || 0) + (r.crowd || 0) + (r.decor || 0) + (r.weird || 0));
}

export function reviewCap(state) {
  const level = state?.review?.level || 1;
  return level >= MAX_LEVEL ? Infinity : (REVIEW_LEVEL_REQ[level] || Infinity);
}

function normalizeReview(state) {
  const cap = reviewCap(state);
  if (!Number.isFinite(cap) || !state?.review) return;
  const r = state.review;
  const values = REVIEW_DIMS.map((k) => Math.max(0, Math.floor(r[k] || 0)));
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= cap) return;
  let used = 0;
  REVIEW_DIMS.forEach((k, i) => {
    r[k] = Math.floor((values[i] * cap) / total);
    used += r[k];
  });
  for (let i = 0; i < REVIEW_DIMS.length && used < cap; i++) {
    r[REVIEW_DIMS[i]] += 1;
    used += 1;
  }
  r.points = cap;
}

export function reviewPoints(state) {
  return Math.min(reviewRaw(state), reviewCap(state));
}

export function addReview(state, deltas) {
  if (!state.review) state.review = { taste: 0, crowd: 0, decor: 0, weird: 0, level: 1, festivals: 0, points: 0 };
  normalizeReview(state);
  let room = Math.max(0, reviewCap(state) - reviewRaw(state));
  for (const [k, v] of Object.entries(deltas || {})) {
    if (!(k in state.review)) continue;
    const delta = Number(v) || 0;
    const gain = delta > 0 ? Math.min(delta, room) : delta;
    state.review[k] = (state.review[k] || 0) + gain;
    if (delta > 0) room -= gain;
  }
  state.review.points = reviewPoints(state);
  return state.review.points;
}

export function placeObject(state, type, x, y, opts = {}) {
  const check = canPlace(state, type, x, y, !!opts.free);
  if (!check.ok) return check;
  const def = defOf(type);
  if (!opts.free) {
    state.coins -= def.cost;
    state.stats.spent = (state.stats.spent || 0) + def.cost;
  }
  const firstOfType = !state.objects.some((o) => o.type === type);
  const o = makeObject(state, type, x, y, opts);
  const buildTime = opts.instant || opts.free ? 0 : Math.max(0, Number(def.buildTime) || 0);
  if (buildTime > 0) {
    o.built = false;
    o.buildLeft = buildTime;
    o.buildTotal = buildTime;
  }
  if (!opts.free) {
    if (def.cat === 'decor') addReview(state, { decor: 1 });
    if (def.buildReview) {
      // Big attractions carry their own completion bonus instead of the generic
      // first-of-type point, so a ferris wheel is worth more than a bench.
      if (o.built) addReview(state, def.buildReview);
      else o.rewardReview = { ...def.buildReview };
    } else if (firstOfType && !def.hidden) {
      if (o.built) addReview(state, { weird: 2 });
      else o.rewardWeird = 2;
    }
  }
  return { ok: true, object: o, buildTime };
}

// Moving keeps the same object: id, rotation, growth and any construction
// timer travel with it, so queued customers and saves stay valid. The object
// steps out of the list while canPlace runs, otherwise it would block its own
// new footprint and trip the unique-building check.
export function canMoveObject(state, o, x, y) {
  const def = o && defOf(o.type);
  if (!def) return { ok: false, reason: '这个物件不能移动' };
  if (o.natural) return { ok: false, reason: '自然景物不能移动' };
  if (def.hidden) return { ok: false, reason: `${def.name}是地标，不能移动` };
  if (def.unremovable) return { ok: false, reason: `${def.name}不能移动` };
  const idx = state.objects.indexOf(o);
  if (idx < 0) return { ok: false, reason: '物件已经不存在了' };
  if (x === o.x && y === o.y) return { ok: false, reason: '它已经在这里了' };
  state.objects.splice(idx, 1);
  const check = canPlace(state, o.type, x, y, true);
  state.objects.splice(idx, 0, o);
  return check;
}

export function moveObject(state, o, x, y) {
  const check = canMoveObject(state, o, x, y);
  if (!check.ok) return check;
  o.x = x;
  o.y = y;
  state.sceneRev = (state.sceneRev || 0) + 1;
  recompute(state);
  return { ok: true, object: o };
}

// Story landmarks are replaced in place by the building that grows out of
// them. The object keeps its id, so saves, missions and the scene cache stay
// valid across the swap.
export const LANDMARK_UPGRADES = {
  wormHole: 'wormFarm',
  dinoGraveyard: 'paleoLab',
  mammothCave: 'permafrostLab',
  northBridgeSite: 'northBridge',
  abyssWellhead: 'deepSeaHarbor',
};

export function landmarkUpgradeOf(type) {
  return LANDMARK_UPGRADES[type] || null;
}

export function canUpgradeLandmark(state, hole, type = 'wormFarm') {
  const def = defOf(type);
  if (!def || !def.hidden) return { ok: false, reason: '未知地标建筑' };
  const base = hole ? defOf(hole.type) : null;
  const expected = hole ? LANDMARK_UPGRADES[hole.type] : null;
  if (!expected) return { ok: false, reason: '先找到可改造的地标' };
  if (expected !== type) return { ok: false, reason: '这个地标还不能改造' };
  if (state.objects.some((o) => o.type === type)) {
    return { ok: false, reason: `全镇只能有一座${def.name}` };
  }
  const level = state.review?.level || 1;
  if (level < unlockLevelOf(def)) {
    return { ok: false, reason: `需要小镇 Lv.${unlockLevelOf(def)}（当前 Lv.${level}）` };
  }
  if (def.requireFlag && !state.flags?.[def.requireFlag]) {
    return { ok: false, reason: def.requireFlagReason || '前置条件未完成' };
  }
  const x = Math.round(hole.x + hole.w / 2 - def.w / 2);
  const y = Math.round(hole.y + hole.d / 2 - def.d / 2);
  const foot = footprintCheck(state, x, y, def.w, def.d, def);
  if (!foot.ok) return foot;
  if (hole.x < x || hole.y < y || hole.x + hole.w > x + def.w || hole.y + hole.d > y + def.d) {
    return { ok: false, reason: `${base?.name || '原地标'}必须完整落在${def.name}范围内` };
  }
  const cleared = new Set();
  for (let ty = y; ty < y + def.d; ty++) {
    for (let tx = x; tx < x + def.w; tx++) {
      if (state.roads[key(tx, ty)]) return { ok: false, reason: '场地里有道路，先拆掉' };
      if (state.paint[key(tx, ty)]) return { ok: false, reason: '场地里有铺装，先铲掉' };
      const o = objectAt(state, tx, ty);
      if (!o || o === hole) continue;
      if (!o.natural) return { ok: false, reason: `场地里有${defOf(o.type)?.name || '建筑'}，先拆掉` };
      cleared.add(o);
    }
  }
  if (state.coins < def.cost) return { ok: false, reason: '金币不够' };
  return { ok: true, x, y, hole, cleared: [...cleared] };
}

// The worm hole becomes its farm, the bone bed becomes the paleo lab: same id,
// same footprint, still unremovable. Wild scenery inside the plot is cleared
// for free; player buildings, roads and paving block the upgrade.
export function upgradeLandmark(state, hole, type = 'wormFarm', opts = {}) {
  const check = canUpgradeLandmark(state, hole, type);
  if (!check.ok) return check;
  const def = defOf(type);
  state.coins -= def.cost;
  state.stats.spent = (state.stats.spent || 0) + def.cost;
  for (const o of check.cleared) {
    const idx = state.objects.indexOf(o);
    if (idx >= 0) state.objects.splice(idx, 1);
  }
  hole.type = type;
  hole.x = check.x;
  hole.y = check.y;
  hole.w = def.w;
  hole.d = def.d;
  hole.variant = 0;
  hole.rot = 0;
  hole.natural = true;
  hole.unremovable = true;
  hole.timer = 0;
  hole.growth = 0;
  const buildTime = opts.instant ? 0 : Math.max(0, Number(def.buildTime) || 0);
  hole.built = buildTime === 0;
  hole.buildLeft = buildTime;
  hole.buildTotal = buildTime;
  if (def.upgradeReview) {
    // Landmarks with their own completion bonus (the bridge) add it once, when
    // the works finish, instead of the generic landmark weirdness.
    if (buildTime > 0) hole.rewardReview = { ...def.upgradeReview };
    else addReview(state, def.upgradeReview);
  } else {
    addReview(state, { weird: 2 });
    if (buildTime > 0) hole.rewardWeird = 2;
    else addReview(state, { weird: 2 });
  }
  if (type === 'paleoLab' && hole.built) state.flags.dinoResearch = true;
  if (type === 'permafrostLab' && hole.built) state.flags.mammothResearch = true;
  state.sceneRev = (state.sceneRev || 0) + 1;
  recompute(state);
  return { ok: true, object: hole, buildTime, cleared: check.cleared.length };
}

export function isBuilt(o) {
  return !o || o.built !== false;
}

export function deepSeaHarborBuilt(state) {
  return !!state?.objects?.some((o) => o.type === 'deepSeaHarbor' && isBuilt(o));
}

export function buildProgress(o) {
  if (isBuilt(o)) return 1;
  const total = Math.max(0.001, o.buildTotal || 1);
  return Math.max(0, Math.min(1, 1 - (o.buildLeft || 0) / total));
}

export function finishConstruction(state, o, events = []) {
  if (!o || isBuilt(o)) return false;
  o.built = true;
  o.buildLeft = 0;
  o.buildTotal = 0;
  state.sceneRev = (state.sceneRev || 0) + 1;
  if (o.rewardWeird) {
    addReview(state, { weird: o.rewardWeird });
    delete o.rewardWeird;
  }
  if (o.rewardReview) {
    addReview(state, o.rewardReview);
    delete o.rewardReview;
  }
  events.push({ type: 'buildDone', id: o.id, name: defOf(o.type)?.name || o.type });
  if (o.type === 'paleoLab' && !state.flags.dinoResearch) {
    state.flags.dinoResearch = true;
    events.push({ type: 'dinoResearch', id: o.id });
  }
  if (o.type === 'permafrostLab' && !state.flags.mammothResearch) {
    state.flags.mammothResearch = true;
    events.push({ type: 'mammothResearch', id: o.id });
  }
  return true;
}

// Speed is a real-time toggle: 1x and 2x are free, 3x is a five-minute
// rewarded-ad boost. The boost clock survives reloads via boostUntil.
export function boostLeftMs(state, now = Date.now()) {
  return Math.max(0, (state?.boostUntil || 0) - now);
}

export function speedMultiplier(state, now = Date.now()) {
  const speed = state?.speed === 2 || state?.speed === 3 || state?.speed === 5 ? state.speed : 1;
  if (speed === 3 && boostLeftMs(state, now) <= 0) return 2;
  return speed;
}

export function nextSpeed(state) {
  const speed = state?.speed === 2 || state?.speed === 3 ? state.speed : 1;
  return speed === 1 ? 2 : speed === 2 ? 3 : 1;
}

export function setSpeed(state, speed) {
  state.speed = speed === 2 || speed === 3 || speed === 5 ? speed : 1;
  return state.speed;
}

export function grantBoost(state, now = Date.now()) {
  state.boostUntil = now + SPEED_BOOST_MS;
  state.speed = 3;
  return state.boostUntil;
}

export function normalizeSpeed(state, now = Date.now()) {
  const speed = state.speed === 2 || state.speed === 3 ? state.speed : 1;
  state.speed = speed === 3 && boostLeftMs(state, now) <= 0 ? 2 : speed;
  if (!Number.isFinite(state.boostUntil)) state.boostUntil = 0;
  return state.speed;
}

// Roads on land are plain asphalt; the same brush over fresh water lays a
// wooden bridge. Bridge tiles still live in state.roads, so guest pathfinding
// and shop access need no separate graph.
export function roadPlan(state, x, y, style = 'asphalt') {
  const surface = roadStyleOf(style);
  if (!inBounds(x, y)) return { ok: false, kind: 'none', cost: 0, reason: '超出小镇边界' };
  const plot = plotAt(x, y);
  if (!plot) return { ok: false, kind: 'none', cost: 0, reason: '超出小镇边界' };
  if (!plotUnlocked(state, plot)) {
    return { ok: false, kind: 'none', cost: 0, reason: `${plot.name}尚未解锁（Lv.${plot.rank}）` };
  }
  if (terrainAt(x, y) === 'water') {
    const level = state.review?.level || 1;
    if (level < BRIDGE_LEVEL) {
      return { ok: false, kind: 'bridge', cost: BRIDGE_COST, reason: `Lv.${BRIDGE_LEVEL} 解锁木桥` };
    }
    if (!BRIDGE_PLOTS.includes(plot.id)) {
      return { ok: false, kind: 'bridge', cost: BRIDGE_COST, reason: '木桥只能架在河湾 / 西码头 / 农田的淡水' };
    }
    return { ok: true, kind: 'bridge', cost: BRIDGE_COST };
  }
  // A frozen lake gets a packed-snow track. Like a bridge it is stored as a
  // road, so guests, shop access and demolition need no extra system.
  if (terrainAt(x, y) === 'ice') {
    return { ok: true, kind: 'iceRoad', cost: ICE_ROAD_COST };
  }
  const foot = footprintCheck(state, x, y, 1, 1);
  if (!foot.ok) return { ok: false, kind: 'road', cost: surface.cost, reason: foot.reason };
  return { ok: true, kind: 'road', cost: surface.cost };
}

export function paintRoad(state, x, y, style = 'asphalt') {
  const surface = roadStyleOf(style);
  const k = key(x, y);
  const existing = state.roads[k];
  const plan = roadPlan(state, x, y, surface.id);
  if (!plan.ok) return plan;
  const occupied = objectAt(state, x, y);
  if (occupied && !isEntrancePassage(state, x, y)) {
    return { ok: false, reason: '先移走地上的东西' };
  }
  if (existing) {
    if (terrainAt(x, y) === 'water') return { ok: false, reason: '水上木桥不能换路面' };
    if (terrainAt(x, y) === 'ice') return { ok: false, reason: '冰道不能换路面' };
    if (roadStyleOf(existing).id === surface.id) {
      return { ok: false, reason: surface.id === 'asphalt' ? '这里已经是道路' : '这里已经是这种路面' };
    }
    if (state.coins < plan.cost) return { ok: false, reason: '金币不够' };
    state.coins -= plan.cost;
    state.roads[k] = surface.id === 'asphalt' ? 1 : surface.id;
    state.roadRev = (state.roadRev || 0) + 1;
    recompute(state);
    return { ok: true, kind: plan.kind, cost: plan.cost, style: surface.id, restyled: true };
  }
  if (state.coins < plan.cost) return { ok: false, reason: '金币不够' };
  state.coins -= plan.cost;
  state.roads[k] = plan.kind === 'bridge' || plan.kind === 'iceRoad' || surface.id === 'asphalt' ? 1 : surface.id;
  state.stats.roadsBuilt = (state.stats.roadsBuilt || 0) + 1;
  if (plan.kind === 'bridge') state.stats.bridgesBuilt = (state.stats.bridgesBuilt || 0) + 1;
  delete state.paint[k];
  state.roadRev = (state.roadRev || 0) + 1;
  recompute(state);
  return { ok: true, kind: plan.kind, cost: plan.cost, style: surface.id };
}

// A dragged road previews as one straight run. Cells that already carry the
// same surface are skipped free of charge; the run stops at the first tile
// that cannot take a road instead of painting through it.
export function roadRunPlan(state, cells, style = 'asphalt') {
  const surface = roadStyleOf(style);
  const list = [];
  const line = [];
  let cost = 0;
  let blocked = '';
  for (const [x, y] of cells) {
    if (!inBounds(x, y)) {
      blocked = '超出小镇边界';
      break;
    }
    const k = key(x, y);
    const existing = state.roads[k];
    if (existing) {
      if (terrainAt(x, y) === 'water' || terrainAt(x, y) === 'ice'
        || roadStyleOf(existing).id === surface.id) {
        line.push([x, y]);
        continue;
      }
      const plan = roadPlan(state, x, y, surface.id);
      if (!plan.ok) {
        blocked = plan.reason;
        break;
      }
      line.push([x, y]);
      list.push({ x, y, cost: plan.cost, kind: plan.kind, restyle: true });
      cost += plan.cost;
      continue;
    }
    const plan = roadPlan(state, x, y, surface.id);
    if (!plan.ok) {
      blocked = plan.reason;
      break;
    }
    if (objectAt(state, x, y) && !isEntrancePassage(state, x, y)) {
      blocked = '先移走地上的东西';
      break;
    }
    line.push([x, y]);
    list.push({ x, y, cost: plan.cost, kind: plan.kind });
    cost += plan.cost;
  }
  const affordable = state.coins >= cost;
  return {
    ok: line.length > 0 && affordable,
    cells: list,
    line,
    cost,
    blocked,
    affordable,
    reason: !line.length ? blocked : affordable ? '' : '金币不够',
  };
}

export function paintRoadRun(state, cells, style = 'asphalt') {
  const run = roadRunPlan(state, cells, style);
  if (!run.ok) return run;
  const surface = roadStyleOf(style);
  for (const cell of run.cells) {
    const k = key(cell.x, cell.y);
    state.coins -= cell.cost;
    if (!cell.restyle) {
      state.stats.roadsBuilt = (state.stats.roadsBuilt || 0) + 1;
      if (cell.kind === 'bridge') state.stats.bridgesBuilt = (state.stats.bridgesBuilt || 0) + 1;
      delete state.paint[k];
    }
    state.roads[k] = cell.kind === 'bridge' || cell.kind === 'iceRoad' || surface.id === 'asphalt'
      ? 1
      : surface.id;
    state.roadRev = (state.roadRev || 0) + 1;
  }
  if (run.cells.length) recompute(state);
  return { ok: true, cells: run.cells, line: run.line, cost: run.cost };
}

export function paintPave(state, x, y) {  if (!inBounds(x, y)) return { ok: false, reason: '超出小镇边界' };
  const k = key(x, y);
  if (state.roads[k]) return { ok: false, reason: '这里是道路' };
  if (state.paint[k]) return { ok: false, reason: '这里已经铺过了' };
  const foot = footprintCheck(state, x, y, 1, 1);
  if (!foot.ok) return foot;
  const occupied = objectAt(state, x, y);
  if (occupied && !isEntrancePassage(state, x, y)) {
    return { ok: false, reason: '先移走地上的东西' };
  }
  if (state.coins < PAVE_COST) return { ok: false, reason: '金币不够' };
  state.coins -= PAVE_COST;
  state.paint[k] = 'pave';
  state.paintRev = (state.paintRev || 0) + 1;
  recompute(state);
  return { ok: true };
}

// Player-built structures come back at a quarter of their price. Wild
// scenery (trees, rocks, the starting pond) is the other way round: clearing
// it costs labour, so it has a fee and never refunds anything.
export function clearingFeeOf(o) {
  if (!o?.natural) return 0;
  return defOf(o.type)?.clearCost || 0;
}

export function demolitionQuote(state, o) {
  const def = defOf(o.type);
  if (!def) return { kind: 'none', fee: 0, refund: 0, affordable: false };
  if (def.unremovable) {
    return { kind: 'locked', name: def.name, fee: 0, refund: 0, affordable: false };
  }
  const fee = clearingFeeOf(o);
  const refund = o.natural ? 0 : Math.floor((def.cost || 0) * REFUND_RATE);
  return {
    kind: 'object',
    name: def.name,
    fee,
    refund,
    affordable: state.coins >= fee,
  };
}

export function removeObject(state, o, refundRate = REFUND_RATE) {
  const idx = state.objects.indexOf(o);
  if (idx < 0) return 0;
  const def = defOf(o.type);
  if (def?.unremovable) return 0;
  state.objects.splice(idx, 1);
  state.sceneRev = (state.sceneRev || 0) + 1;
  const refund = o.natural ? 0 : Math.floor((def?.cost || 0) * refundRate);
  state.coins += refund;
  recompute(state);
  return refund;
}

export function demolishObject(state, o, refundRate = REFUND_RATE) {
  const idx = state.objects.indexOf(o);
  if (idx < 0) return { ok: false, kind: 'none', name: '', fee: 0, refund: 0, reason: '已经不存在了' };
  const def = defOf(o.type);
  if (!def || def.unremovable) {
    return { ok: false, kind: 'locked', name: def?.name || o.type, fee: 0, refund: 0, reason: '这座建筑不能拆除' };
  }
  if (def.sale && state.objects.filter((x) => defOf(x.type)?.sale).length === 1 && state.coins < def.cost) {
    return {
      ok: false, kind: 'locked', name: def.name, fee: 0, refund: 0,
      reason: `这是唯一的收入来源，金币不足重建（需 ${def.cost}）`,
    };
  }
  const fee = clearingFeeOf(o);
  if (state.coins < fee) {
    return {
      ok: false, kind: 'poor', name: def.name, fee, refund: 0,
      reason: `清理 ${def.name} 需要 ${fee} 金币`,
    };
  }
  const refund = o.natural ? 0 : Math.floor((def.cost || 0) * refundRate);
  state.objects.splice(idx, 1);
  state.sceneRev = (state.sceneRev || 0) + 1;
  state.coins += refund - fee;
  recompute(state);
  return { ok: true, kind: 'object', name: def.name, fee, refund };
}

export function demolishAt(state, x, y) {
  const o = objectAt(state, x, y);
  if (o) return demolishObject(state, o);
  const k = key(x, y);
  if (state.roads[k]) {
    if (isEntrancePassage(state, x, y)) {
      return { ok: false, kind: 'locked', name: '门洞车道', fee: 0, refund: 0, reason: '门洞两格车道必须保留，不能拆' };
    }
    delete state.roads[k];
    state.roadRev = (state.roadRev || 0) + 1;
    recompute(state);
    return { ok: true, kind: 'road', fee: 0, refund: 0 };
  }
  if (state.paint[k]) {
    delete state.paint[k];
    state.paintRev = (state.paintRev || 0) + 1;
    return { ok: true, kind: 'pave', fee: 0, refund: 0 };
  }
  return { ok: false, kind: 'none', fee: 0, refund: 0 };
}

export function rotateObject(state, o, step = 1) {
  const def = defOf(o.type);
  if (!def || !isRotatable(def)) return { ok: false, reason: '这个物件不能转向' };
  o.rot = ((Number(o.rot) || 0) + step) % 4;
  if (o.rot < 0) o.rot += 4;
  state.sceneRev = (state.sceneRev || 0) + 1;
  return { ok: true, rot: o.rot };
}

export function roadMask(state, x, y) {
  let m = 0;
  if (state.roads[key(x, y - 1)]) m |= 1;
  if (state.roads[key(x + 1, y)]) m |= 2;
  if (state.roads[key(x, y + 1)]) m |= 4;
  if (state.roads[key(x - 1, y)]) m |= 8;
  return m;
}

// Plaza ground works as open street: guests can cross it, and a shop touching
// it counts as connected without laying a single road tile.
function plazaAccess(state, x, y) {
  if (!inBounds(x, y)) return false;
  if (terrainAt(x, y) !== 'plaza') return false;
  if (!plotUnlocked(state, plotAt(x, y))) return false;
  return !objectAt(state, x, y);
}

function hasAccessAt(state, x, y) {
  return !!state.roads[key(x, y)] || plazaAccess(state, x, y);
}

export function hasRoadBeside(state, o) {
  return hasAccessBeside(state, o);
}

export function hasAccessBeside(state, o) {
  for (let y = o.y - 1; y <= o.y + o.d; y++) {
    for (let x = o.x - 1; x <= o.x + o.w; x++) {
      if (x >= o.x && x < o.x + o.w && y >= o.y && y < o.y + o.d) continue;
      if (hasAccessAt(state, x, y)) return true;
    }
  }
  return false;
}

export function isConnected(state, o) {
  const def = defOf(o.type);
  if (!def || !def.needsRoad) return true;
  return hasRoadBeside(state, o);
}

export function storageCap(state) {
  const cold = state.objects.filter((o) => o.type === 'warehouse' && isBuilt(o) && isConnected(state, o)).length;
  return STORAGE_BASE + cold * STORAGE_PER_WAREHOUSE;
}

export function recompute(state) {
  for (const o of state.objects) {
    o.connected = isConnected(state, o);
    o.barnId = null;
    o.barnReady = false;
  }
  attachRanges(state);
  state.cap = storageCap(state);
  return state;
}

// Attach paddocks to a barn: directly by an orthogonal edge, or by extending
// another paddock of the same type that is already attached.
function attachRanges(state) {
  const ranges = state.objects.filter((o) => defOf(o.type)?.kind === 'range');
  for (const o of ranges) {
    o.barnId = null;
    o.barnReady = false;
  }
  for (const o of ranges) {
    const barn = adjacentBarn(state, o, defOf(o.type).needsBarn);
    if (!barn) continue;
    o.barnId = barn.id;
    o.barnReady = isBuilt(barn) && isConnected(state, barn);
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const o of ranges) {
      if (o.barnId) continue;
      const link = findEdgeObject(state, o.x, o.y, o.w, o.d, (v) => v.type === o.type && !!v.barnId);
      if (!link) continue;
      o.barnId = link.barnId;
      o.barnReady = link.barnReady;
      grew = true;
    }
  }
}

export function missingInputs(state, def) {
  const list = [];
  const inputs = def?.prod?.in || def?.sale?.in;
  if (!inputs) return list;
  for (const [res, n] of Object.entries(inputs)) {
    if ((state.res[res] || 0) < n) list.push({ res, need: n, have: state.res[res] || 0 });
  }
  return list;
}

function fullOutputs(state, def) {
  const out = def?.prod?.out;
  if (!out) return [];
  return Object.entries(out)
    .filter(([res, n]) => (state.res[res] || 0) + n > state.cap)
    .map(([res]) => res);
}

// A multi-output building only stops when every product is capped. A coop with
// full eggs but room for chicken keeps laying at its normal rate; the capped
// product simply has nowhere to go.
export function outputFull(state, def) {
  const out = def?.prod?.out;
  if (!out) return false;
  const entries = Object.entries(out);
  return entries.length > 0 && entries.every(([res, n]) => (state.res[res] || 0) + n > state.cap);
}

function partialFullLabel(state, def) {
  const full = fullOutputs(state, def);
  if (!full.length) return null;
  if (full.length === Object.keys(def.prod.out).length) return { code: 'full', label: '仓满' };
  const names = full.map((res) => RESOURCES[res]?.name || res).join('、');
  return { code: 'full', label: `${names}仓满 · 其余照常` };
}

export function queueAtShop(state, shopId) {
  return (state.customers || [])
    .filter((c) => c.shopId === shopId && c.phase === 'queue')
    .sort((a, b) => a.queueAt - b.queueAt);
}

// Restaurant buffs (currently the beer hall): a served-radius aura that spends
// a resource on an interval instead of selling anything itself.
export function buffTargets(state, hall) {
  const buff = defOf(hall.type)?.buff;
  if (!buff) return [];
  const hx = hall.x + hall.w / 2;
  const hy = hall.y + hall.d / 2;
  return state.objects.filter((o) => {
    const def = defOf(o.type);
    if (!def?.sale || !isBuilt(o) || !o.connected) return false;
    const dx = o.x + o.w / 2 - hx;
    const dy = o.y + o.d / 2 - hy;
    return Math.hypot(dx, dy) <= buff.radius;
  });
}

export function activeBuffs(state) {
  const map = new Map();
  for (const hall of state.objects) {
    const buff = defOf(hall.type)?.buff;
    if (!buff || !isBuilt(hall) || !hall.connected || (hall.buffLeft || 0) <= 0) continue;
    for (const shop of buffTargets(state, hall)) {
      const prev = map.get(shop.id);
      if (!prev || (buff.coins || 0) > (prev.coins || 0)) map.set(shop.id, buff);
    }
  }
  return map;
}

export function buffInfo(state, hall) {
  const buff = defOf(hall.type)?.buff;
  if (!buff) return null;
  const targets = buffTargets(state, hall);
  const remaining = Math.max(0, hall.buffLeft || 0);
  return {
    buff,
    active: isBuilt(hall) && hall.connected && remaining > 0,
    remaining,
    stock: state.res.beer || 0,
    need: buff.beer || 1,
    targets,
  };
}

export function statusOf(state, o) {
  const def = defOf(o.type);
  if (!def) return { code: 'idle', label: '?' };
  if (!isBuilt(o)) return { code: 'build', label: `建造中 ${formatSeconds(o.buildLeft)}` };
  if (def.kind === 'gate') {
    const roads = entranceRoadState(state, o);
    const entry = entranceDefOf(def) || {};
    if (!roads.passageOpen) return { code: 'road', label: '门洞下要铺满道路' };
    if (!roads.drivewayOpen) return { code: 'road', label: entry.drivewayHint || '北侧引道未接' };
    return { code: 'ok', label: `${entry.openLabel || '门洞通行'} · 过路费 +${def.toll || TOLL_FEE}` };
  }
  if (def.kind === 'review') {
    if (def.needsRoad && !o.connected) return { code: 'road', label: '需要道路' };
    if (state.festival) return { code: 'work', label: `美食节 ${Math.ceil(state.festival.remaining)} 秒` };
    const need = nextLevelNeed(state);
    return { code: 'ok', label: need ? `评分 ${state.review.points} / ${need}` : '已满级' };
  }
  if (o.type === 'wormFarm') {
    const wp = wormPhase(state.simTime);
    if ((state.res.wormMeat || 0) >= state.cap) {
      return { code: 'full', label: `仓满 · ${Math.ceil(wp.nextHarvest)} 秒后翻沙` };
    }
    return { code: 'ok', label: `${wp.label} · 下次采集 ${Math.ceil(wp.nextHarvest)} 秒` };
  }
  if (o.type === 'mammothCave') return { code: 'ok', label: '永冻土洞窟 · 可读取记录' };
  if (o.type === 'northBridgeSite') {
    return state.flags?.mammothResearch
      ? { code: 'ok', label: '冰湖旧桥头 · 可重建跨海大桥' }
      : { code: 'work', label: '冰湖旧桥头 · 需先完成永冻土研究' };
  }
  if (o.type === 'abyssWellhead') {
    return (state.review?.level || 1) >= 10
      ? { code: 'ok', label: '环礁井口 · 可改建远航海港' }
      : { code: 'work', label: '环礁井口 · 需小镇 Lv.10' };
  }
  if (o.type === 'dinoGraveyard') return { code: 'ok', label: '半埋化石 · 可读取记录' };
  if (o.type === 'paleoLab') {
    return state.flags.dinoResearch
      ? { code: 'ok', label: '研究完成 · 白垩纪牧场已解锁' }
      : { code: 'work', label: '研究待完成' };
  }
  if (o.type === 'permafrostLab') {
    return state.flags.mammothResearch
      ? { code: 'ok', label: '研究完成 · 猛犸档案已写入' }
      : { code: 'work', label: '冻土研究待完成' };
  }
  if (o.type === 'dinoRanch') {
    if (def.needsRoad && !o.connected) return { code: 'road', label: '需要道路' };
    const meatFull = (state.res[def.meat.res] || 0) + def.meat.amount > state.cap;
    const nextMeat = Math.max(0, def.meat.time - (o.meatTimer || 0));
    const q = queueAtShop(state, o.id).length;
    if (q > 0 && missingInputs(state, def).length) {
      return { code: 'lack', label: '饲料不足 · 观光车停运' };
    }
    if (meatFull) return { code: 'full', label: '恐龙肉仓满 · 观光照常' };
    if (q > 0) return { code: 'work', label: `观光 ${q} · 肉 ${Math.ceil(nextMeat)} 秒` };
    return { code: 'ok', label: `等客观光 · 肉 ${Math.ceil(nextMeat)} 秒` };
  }
  if (def.kind === 'field') {
    if (o.growth >= 1) {
      if ((state.res[def.res] || 0) >= state.cap) return { code: 'full', label: '仓满' };
      return { code: 'ripe', label: '成熟' };
    }
    return { code: 'grow', label: `生长 ${Math.floor(o.growth * 100)}%` };
  }
  if (def.kind === 'barn') {
    if (!o.connected) return { code: 'road', label: '需要道路' };
    const linked = rangesAttachedTo(state, o, def.rangeType).length;
    return linked
      ? { code: 'ok', label: `带动 ${linked} 片场地` }
      : { code: 'barn', label: '等待场地' };
  }
  if (def.kind === 'range') {
    const barn = o.barnId ? objectById(state, o.barnId) : adjacentBarn(state, o, def.needsBarn);
    if (!barn) return { code: 'barn', label: '未接畜棚' };
    if (!isBuilt(barn)) return { code: 'build', label: '畜棚建造中' };
    if (!barn.connected) return { code: 'road', label: '畜棚需道路' };
    const fullLabel = partialFullLabel(state, def);
    if (fullLabel) return fullLabel;
    const miss = missingInputs(state, def);
    if (miss.length) return { code: 'lack', label: '缺料' };
    return { code: 'work', label: '运转中' };
  }
  if (def.needsRoad && !o.connected) return { code: 'road', label: '需要道路' };
  if (def.buff) {
    const info = buffInfo(state, o);
    if (!info.targets.length) return { code: 'idle', label: `半径 ${info.buff.radius} 格内没有餐馆` };
    if (info.active) {
      return {
        code: 'ok',
        label: `${info.buff.label} ${Math.ceil(info.remaining)} 秒 · 覆盖 ${info.targets.length} 家`,
      };
    }
    if (info.stock < info.need) return { code: 'lack', label: '缺啤酒' };
    return { code: 'work', label: `待开桶 · 覆盖 ${info.targets.length} 家` };
  }
  if (def.prod) {
    const fullLabel = partialFullLabel(state, def);
    if (fullLabel) return fullLabel;
    const miss = missingInputs(state, def);
    if (miss.length) return { code: 'lack', label: '缺料' };
    return { code: 'work', label: '运转中' };
  }
  if (def.sale) {
    const miss = missingInputs(state, def);
    if (miss.length) return { code: 'lack', label: '缺料' };
    const q = queueAtShop(state, o.id).length;
    if (q > 0) return { code: 'work', label: `排队 ${q}` };
    return { code: 'ok', label: '等客上门' };
  }
  if (o.type === 'warehouse') return { code: o.connected ? 'ok' : 'road', label: o.connected ? '仓储 +20' : '需要道路' };
  return { code: 'ok', label: '' };
}

function addResource(state, res, amount) {
  const room = Math.max(0, state.cap - (state.res[res] || 0));
  const added = Math.min(room, amount);
  state.res[res] = (state.res[res] || 0) + added;
  return added;
}

function takeInputs(state, inputs = {}) {
  for (const [res, n] of Object.entries(inputs || {})) state.res[res] -= n;
}

// ---------------------------------------------------------------------------
// Review levels & food festival

export function nextLevelNeed(state) {
  const level = state.review?.level || 1;
  if (level >= MAX_LEVEL) return null;
  return REVIEW_LEVEL_REQ[level] || null;
}

export function reviewHall(state) {
  return state.objects.find((o) => o.type === 'reviewHall') || null;
}

export function reviewHallReady(state) {
  const hall = reviewHall(state);
  return !!(hall && isBuilt(hall) && hall.connected);
}

function shopReachable(state) {
  const shops = state.objects.filter((o) => {
    const def = defOf(o.type);
    return !!(def?.sale && isBuilt(o) && o.connected);
  });
  if (!shops.length) return false;
  for (const entrance of entrancesOf(state)) {
    if (!entranceOpen(state, entrance)) continue;
    const flow = ensureFlow(state, entrance);
    if (!flow.sources.length) continue;
    if (shops.some((o) => bestEntry(state, o, flow))) return true;
  }
  return false;
}

// Trade safety shared by the level guides: a broken gate lane or a shop that
// guests cannot reach blocks every other goal, so it always speaks first.
function tradeGuide(state, prefix = '') {
  const tag = (name) => (prefix ? `${prefix}-${name}` : name);
  const gate = gateOf(state);
  const alternate = entrancesOf(state).some((o) => o !== gate && entranceOpen(state, o));
  if (gate && !gatePassageOpen(state, gate) && !alternate) {
    return { key: tag('fix-gate'), text: '门洞车道断了 · 用「道路」把两格车道补回去', focus: 'road' };
  }
  if (!shopReachable(state)) {
    const shops = state.objects.filter((o) => defOf(o.type)?.sale);
    if (shops.some(isBuilt)) {
      return { key: tag('fix-road'), text: '顾客走不到店门口 · 检查门洞双车道与店前道路', focus: 'road' };
    }
    const building = shops.find((o) => !isBuilt(o));
    if (building) {
      const def = defOf(building.type);
      return {
        key: tag('shop-building'),
        text: `${def?.name || '店铺'}建造中 · 还需 ${formatSeconds(building.buildLeft)}`,
        focus: 'sell',
      };
    }
    return { key: tag('rebuild-shop'), text: '没有营业中的店 · 在「销售」页重建薯条小摊', focus: 'sell' };
  }
  return null;
}

// The festival is the only promotion path, so the current level's chain
// buildings have to finish construction before it can start. Progress reuses
// the mission readers, so a shop only counts once its build timer runs out.
export function levelChainStatus(state) {
  const level = state.review?.level || 1;
  const items = (LEVEL_CHAIN_REQS[level] || []).map((req) => {
    const cur = Math.min(req.target, missionProgress(state, req));
    return { ...req, cur, done: cur >= req.target };
  });
  return { level, items, done: items.every((item) => item.done) };
}

function chainGuide(state, prefix) {
  const chain = levelChainStatus(state);
  if (chain.done) return null;
  const next = chain.items.find((item) => !item.done);
  const progress = next.target > 1 || next.counts ? `（${next.cur}/${next.target}）` : '';
  return {
    key: `${prefix}-chain-${next.id}`,
    text: `办美食节前，还要${next.label}${progress}`,
    focus: next.focus || null,
  };
}

// Contextual Lv.1 pointer shown in the hint bar once the opening coach marks
// are over. Purely derived from state so it survives reloads and never stacks.
export function lv1Guide(state) {
  if (!state) return null;
  if ((state.review?.level || 1) !== 1 || state.festival) return null;
  const trade = tradeGuide(state);
  if (trade) return trade;
  const hall = reviewHall(state);
  if (!hall) {
    if (reviewPoints(state) < REVIEW_HALL_UNLOCK) return null;
    return { key: 'build-hall', text: '评分满 40 达成 · 去下方「基建」建评分大厅', focus: 'build' };
  }
  if (!isBuilt(hall)) {
    return {
      key: 'hall-building',
      text: `评分大厅建造中 · 还需 ${formatSeconds(hall.buildLeft)}（点大厅可看广告立即完成）`,
      focus: 'build',
    };
  }
  if (!hall.connected) {
    return { key: 'connect-hall', text: '评分大厅还没临路 · 用「道路」接一格到大厅门口', focus: 'road' };
  }
  const chain = chainGuide(state, 'lv1');
  if (chain) return chain;
  if (canStartFestival(state).ok) {
    return {
      key: 'festival-ready',
      text: `大厅就绪 · 点右上「评分」报名美食节（¥${FESTIVAL_COST}）`,
      focus: 'review',
    };
  }
  if (state.coins < FESTIVAL_COST) {
    return {
      key: 'festival-coins',
      text: `报名费还差 ${FESTIVAL_COST - Math.floor(state.coins)} 金币 · 继续卖薯条`,
      focus: 'sell',
    };
  }
  return null;
}

// Level guidance is limited to trade safety and promotion: it never tells the
// player which building to construct. Players run their own production plan.
function promotionGuide(state, prefix, readyText, sellText, coinText) {
  const hall = reviewHall(state);
  if (!hall) {
    return { key: `${prefix}-build-hall`, text: '评分大厅不在了 · 去「基建」重建评分大厅', focus: 'build' };
  }
  if (!isBuilt(hall)) {
    return {
      key: `${prefix}-hall-building`,
      text: `评分大厅建造中 · 还需 ${formatSeconds(hall.buildLeft)}（点大厅可看广告立即完成）`,
      focus: 'build',
    };
  }
  if (!hall.connected) {
    return { key: `${prefix}-connect-hall`, text: '评分大厅还没临路 · 用「道路」接一格到大厅门口', focus: 'road' };
  }
  const chain = chainGuide(state, prefix);
  if (chain) return chain;
  if (canStartFestival(state).ok) {
    return { key: `${prefix}-festival-ready`, text: readyText, focus: 'review' };
  }
  const need = nextLevelNeed(state);
  if ((state.review?.points || 0) < need) {
    return { key: `${prefix}-review`, text: sellText(need), focus: 'sell' };
  }
  if (state.coins < FESTIVAL_COST) {
    return {
      key: `${prefix}-festival-coins`,
      text: `报名费还差 ${FESTIVAL_COST - Math.floor(state.coins)} 金币 · ${coinText}`,
      focus: 'sell',
    };
  }
  return null;
}

function levelGuide(state, level, readyText, sellText, coinText) {
  if (!state) return null;
  if ((state.review?.level || 1) !== level || state.festival) return null;
  const prefix = `lv${level}`;
  const trade = tradeGuide(state, prefix);
  if (trade) return trade;
  return promotionGuide(state, prefix, readyText, sellText, coinText);
}

// Lv.2 opens the bread and egg lines; the hint only tracks the promotion chain
// and the 160 review points, never a specific building order.
export function lv2Guide(state) {
  return levelGuide(
    state,
    2,
    `可以办美食节了，点右上「评分」报名（¥${FESTIVAL_COST}）。`,
    (need) => `继续卖餐吧，下一级要 ${need} 分。`,
    '继续做生意',
  );
}

// Lv.3 opens the beef chain; the hint only tracks the promotion checklist and
// the 400 review points.
export function lv3Guide(state) {
  return levelGuide(
    state,
    3,
    `可以办美食节了，点右上「评分」报名（¥${FESTIVAL_COST}）。`,
    (need) => `店都开起来了，接着攒到 ${need} 分。`,
    '继续做生意',
  );
}

// Lv.4 turns the prepared beef, bread and eggs into a three-part burger recipe.
export function lv4Guide(state) {
  return levelGuide(
    state,
    4,
    `可以办美食节了，点右上「评分」报名（¥${FESTIVAL_COST}）。`,
    (need) => `多卖些汉堡，下一级要 ${need} 分。`,
    '继续卖汉堡',
  );
}

export function lv5Guide(state) {
  return levelGuide(
    state,
    5,
    `可以办美食节了，点右上「评分」报名（¥${FESTIVAL_COST}）。`,
    (need) => `炸鸡和海鲜接着卖，评分要到 ${need} 分。`,
    '继续卖炸鸡和海鲜',
  );
}

export function lv6Guide(state) {
  return levelGuide(
    state,
    6,
    `可以办美食节了，点右上「评分」报名（¥${FESTIVAL_COST}）。`,
    (need) => `菜单丰富了，下一级要 ${need} 分。`,
    '继续做生意',
  );
}

export function lv7Guide(state) {
  return levelGuide(
    state,
    7,
    `可以办美食节了，点右上「评分」报名（¥${FESTIVAL_COST}）。`,
    (need) => `继续招待客人吧，下一级要 ${need} 分。`,
    '继续做生意',
  );
}

export function lv8Guide(state) {
  return levelGuide(
    state,
    8,
    `可以办美食节了，点右上「评分」报名（¥${FESTIVAL_COST}）。`,
    (need) => `海边也开张了，接着攒到 ${need} 分。`,
    '继续经营度假村',
  );
}

// Lv.9 is the composite finish: every earlier chain feeds one six-input burger.
export function lv9Guide(state) {
  return levelGuide(
    state,
    9,
    `可以办美食节了，点右上「评分」报名（¥${FESTIVAL_COST}）。`,
    (need) => `多卖些招牌汉堡，下一级要 ${need} 分。`,
    '继续卖招牌汉堡',
  );
}

// Lv.10 has no promotion, so the only remaining pointer is trade safety.
export function lv10Guide(state) {
  if (!state) return null;
  if ((state.review?.level || 1) !== 10 || state.festival) return null;
  return tradeGuide(state, 'lv10');
}

function incomeSafety(state, events) {
  const flags = state.flags = state.flags || {};
  if ((state.review?.level || 1) !== 1 || flags.rescue) {
    flags.stuckSince = 0;
    return;
  }
  if (shopReachable(state)) {
    flags.stuckSince = 0;
    return;
  }
  // Rebuilding the only shop is not a softlock: wait for the crane instead of
  // handing out rescue money halfway through construction.
  if (state.objects.some((o) => defOf(o.type)?.sale && !isBuilt(o))) {
    flags.stuckSince = 0;
    return;
  }
  const cheapest = defOf('fryShack')?.cost || RESCUE_COST_FALLBACK;
  if (state.coins >= cheapest) {
    flags.stuckSince = 0;
    return;
  }
  const now = state.simTime || 0;
  if (!flags.stuckSince) {
    flags.stuckSince = now || 0.001;
    return;
  }
  if (now - flags.stuckSince < RESCUE_AFTER) return;
  flags.rescue = true;
  flags.stuckSince = 0;
  state.coins += cheapest;
  state.stats.coinsEarned = (state.stats.coinsEarned || 0) + cheapest;
  events.push({ type: 'rescue', coins: cheapest });
}

export function festivalTarget(state) {
  return FESTIVAL_TARGET_BASE + (state.review?.level || 1) * FESTIVAL_TARGET_PER_LEVEL;
}

export function canStartFestival(state) {
  if (state.festival) return { ok: false, reason: '美食节已经开始了' };
  const level = state.review?.level || 1;
  if (level >= MAX_LEVEL) return { ok: false, reason: '小镇已经是最高等级' };
  const hall = reviewHall(state);
  if (!hall) return { ok: false, reason: `先建造评分大厅（${REVIEW_HALL_UNLOCK} 分解锁）` };
  if (!isBuilt(hall)) return { ok: false, reason: '评分大厅还在建造中' };
  if (!hall.connected) return { ok: false, reason: '评分大厅需要贴着道路' };
  const chain = levelChainStatus(state);
  if (!chain.done) {
    const next = chain.items.find((item) => !item.done);
    return { ok: false, reason: `还没准备好：${next.label}（${next.cur}/${next.target}）` };
  }
  const need = nextLevelNeed(state);
  if ((state.review?.points || 0) < need) {
    return { ok: false, reason: `评分不足：${Math.floor(state.review?.points || 0)} / ${need}` };
  }
  if (state.coins < FESTIVAL_COST) return { ok: false, reason: `金币不足：需要 ${FESTIVAL_COST}` };
  return { ok: true };
}

export function startFestival(state, events = []) {
  const check = canStartFestival(state);
  if (!check.ok) return check;
  state.coins -= FESTIVAL_COST;
  state.stats.spent = (state.stats.spent || 0) + FESTIVAL_COST;
  const target = festivalTarget(state);
  state.festival = {
    remaining: FESTIVAL_TIME,
    total: FESTIVAL_TIME,
    target,
    served: 0,
  };
  state.stats.festivalsStarted = (state.stats.festivalsStarted || 0) + 1;
  events.push({ type: 'festivalStart', target, seconds: FESTIVAL_TIME });
  return { ok: true, festival: state.festival };
}

export function finishFestival(state, events = []) {
  const f = state.festival;
  if (!f) return null;
  const success = f.served >= f.target;
  state.festival = null;
  if (!success) {
    events.push({ type: 'festivalFail', served: f.served, target: f.target });
    return { success: false };
  }
  const before = state.review?.level || 1;
  const level = Math.min(MAX_LEVEL, before + 1);
  state.review.level = level;
  state.review.festivals = (state.review.festivals || 0) + 1;
  state.stats.festivals = (state.stats.festivals || 0) + 1;
  state.coins += FESTIVAL_REWARD;
  state.stats.coinsEarned = (state.stats.coinsEarned || 0) + FESTIVAL_REWARD;
  addReview(state, FESTIVAL_PROMOTION_REVIEW);
  const opened = plotsUnlockedAt(level);
  state.flags = state.flags || {};
  state.flags.promoteReadyFor = 0;
  events.push({
    type: 'festivalSuccess',
    level,
    reward: FESTIVAL_REWARD,
    plots: opened.map((p) => ({ id: p.id, name: p.name, theme: p.theme, rank: p.rank })),
  });
  return { success: true, level, plots: opened, reward: FESTIVAL_REWARD };
}

// ---------------------------------------------------------------------------
// Customer flow. Paths are derived from a cached BFS over roads, so changing a
// road invalidates the flow field once per build action instead of per guest.

function flowWalkable(state, x, y) {
  if (!inBounds(x, y)) return false;
  if (state.roads[key(x, y)]) return true;
  return plazaAccess(state, x, y);
}

function orthogonalRoadTiles(state, o) {
  const out = [];
  const push = (x, y) => {
    if (flowWalkable(state, x, y)) out.push(key(x, y));
  };
  for (let x = o.x; x < o.x + o.w; x++) {
    push(x, o.y - 1);
    push(x, o.y + o.d);
  }
  for (let y = o.y; y < o.y + o.d; y++) {
    push(o.x - 1, y);
    push(o.x + o.w, y);
  }
  return out;
}

function flowRev(state) {
  return `${state.roadRev || 0}:${state.sceneRev || 0}:${state.review?.level || 1}`;
}

export function ensureFlow(state, entrance = null) {
  // Callers that drop the legacy primary cache (QA snapshots) expect the next
  // lookup to rebuild every entrance, even when roadRev did not move.
  if (!state._flow) state._flows = null;
  const rev = flowRev(state);
  if (!state._flows || state._flows.rev !== rev) state._flows = { rev, byId: {} };
  const target = entrance || primaryEntrance(state);
  if (!target) {
    const empty = { rev, entranceId: null, dist: {}, parent: {}, sources: [] };
    state._flow = empty;
    return empty;
  }
  const cacheId = String(target.id);
  let flow = state._flows.byId[cacheId];
  if (!flow) {
    // Guests appear under the arch and step onto the driveway. Seeding the BFS
    // there keeps the entrance passage itself out of shop-distance maths.
    const sources = entranceOpen(state, target)
      ? entranceDrivewayTiles(target).filter((k) => !!state.roads[k])
      : [];
    const dist = {};
    const parent = {};
    const queue = [];
    for (const k of sources) {
      dist[k] = 0;
      parent[k] = null;
      queue.push(k);
    }
    for (let head = 0; head < queue.length; head++) {
      const k = queue[head];
      const [x, y] = k.split(',').map(Number);
      const d = dist[k] + 1;
      for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
        const nk = key(nx, ny);
        if (!flowWalkable(state, nx, ny) || dist[nk] !== undefined) continue;
        dist[nk] = d;
        parent[nk] = k;
        queue.push(nk);
      }
    }
    flow = { rev, entranceId: target.id, dist, parent, sources };
    state._flows.byId[cacheId] = flow;
  }
  if (target === primaryEntrance(state)) state._flow = flow;
  return flow;
}

function pathFromFlow(flow, targetKey) {
  if (flow.dist[targetKey] === undefined) return null;
  const keys = [];
  let k = targetKey;
  let guard = 0;
  while (k) {
    keys.push(k);
    k = flow.parent[k];
    if (++guard > MAP_W * MAP_H + 10) return null;
  }
  keys.reverse();
  return keys.map((cell) => {
    const [x, y] = cell.split(',').map(Number);
    return { x: x + 0.5, y: y + 0.5 };
  });
}

function bestEntry(state, shop, flow) {
  let best = null;
  for (const k of orthogonalRoadTiles(state, shop)) {
    const d = flow.dist[k];
    if (d === undefined) continue;
    if (!best || d < best.dist) {
      const [x, y] = k.split(',').map(Number);
      best = { k, dist: d, x: x + 0.5, y: y + 0.5 };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Leisure stroll. Served guests wander the nearest paving or plaza terrain,
// then walk back out through the arch. The walkable graph is separate from the
// shop road flow: roads, painted tiles and plaza ground count as one surface,
// so a paved square reads as an extension of the street.

function leisureKind(state, x, y) {
  if (!inBounds(x, y)) return null;
  if (!plotUnlocked(state, plotAt(x, y))) return null;
  const k = key(x, y);
  if (state.roads[k]) return 'road';
  if (objectAt(state, x, y)) return null;
  if (state.paint[k]) return 'pave';
  if (terrainAt(x, y) === 'plaza') return 'plaza';
  return null;
}

function leisureRev(state) {
  return `${state.roadRev || 0}:${state.paintRev || 0}:${state.sceneRev || 0}:${state.review?.level || 1}`;
}

function ensureLeisure(state, entrance = null) {
  if (!state._leisure) state._leisures = null;
  const rev = leisureRev(state);
  if (!state._leisures || state._leisures.rev !== rev) state._leisures = { rev, byId: {} };
  const target = entrance || primaryEntrance(state);
  if (!target) {
    const empty = { rev, entranceId: null, dist: {}, parent: {}, sources: [] };
    state._leisure = empty;
    return empty;
  }
  const cacheId = String(target.id);
  let flow = state._leisures.byId[cacheId];
  if (!flow) {
    const sources = entranceOpen(state, target)
      ? entranceDrivewayTiles(target).filter((k) => !!state.roads[k])
      : [];
    const dist = {};
    const parent = {};
    const queue = [];
    for (const k of sources) {
      dist[k] = 0;
      parent[k] = null;
      queue.push(k);
    }
    for (let head = 0; head < queue.length; head++) {
      const k = queue[head];
      const [x, y] = k.split(',').map(Number);
      for (const [nx, ny] of [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]) {
        if (!leisureKind(state, nx, ny)) continue;
        const nk = key(nx, ny);
        if (dist[nk] !== undefined) continue;
        dist[nk] = dist[k] + 1;
        parent[nk] = k;
        queue.push(nk);
      }
    }
    flow = { rev, entranceId: target.id, dist, parent, sources };
    state._leisures.byId[cacheId] = flow;
  }
  if (target === primaryEntrance(state)) state._leisure = flow;
  return flow;
}

function chooseStrollLeg(state, c, entrance) {
  const startX = Math.floor(c.x);
  const startY = Math.floor(c.y);
  const startKey = key(startX, startY);
  if (ensureLeisure(state, entrance).dist[startKey] === undefined) return null;
  const seen = new Map([[startKey, null]]);
  const queue = [{ x: startX, y: startY, d: 0 }];
  const targets = [];
  for (let head = 0; head < queue.length; head++) {
    const cell = queue[head];
    if (cell.d >= STROLL_RADIUS) continue;
    for (const [nx, ny] of [[cell.x, cell.y - 1], [cell.x + 1, cell.y], [cell.x, cell.y + 1], [cell.x - 1, cell.y]]) {
      const kind = leisureKind(state, nx, ny);
      if (!kind) continue;
      const nk = key(nx, ny);
      if (seen.has(nk)) continue;
      seen.set(nk, key(cell.x, cell.y));
      const d = cell.d + 1;
      queue.push({ x: nx, y: ny, d });
      if (d >= 2 && (kind === 'pave' || kind === 'plaza')) targets.push(nk);
    }
  }
  if (!targets.length) return null;
  const pick = targets[Math.floor(Math.random() * targets.length)];
  const chain = [];
  let k = pick;
  while (k) {
    chain.push(k);
    k = seen.get(k);
  }
  chain.reverse();
  const path = chain.map((cell) => {
    const [x, y] = cell.split(',').map(Number);
    return { x: x + 0.5, y: y + 0.5 };
  });
  const [tx, ty] = pick.split(',').map(Number);
  path.push({ x: tx + 0.3 + Math.random() * 0.4, y: ty + 0.3 + Math.random() * 0.4 });
  path[0] = { x: c.x, y: c.y };
  return path;
}

function entranceLeadIn(entrance) {
  const e = entranceDefOf(defOf(entrance.type)) || {};
  const cx = entrance.x + entrance.w / 2;
  const cy = entrance.y + entrance.d / 2;
  switch (e.driveway) {
    case 'east': return [{ x: entrance.x + 0.05, y: cy }, { x: cx, y: cy }];
    case 'west': return [{ x: entrance.x + entrance.w - 0.05, y: cy }, { x: cx, y: cy }];
    case 'south': return [{ x: cx, y: entrance.y + 0.05 }, { x: cx, y: cy }];
    default: return [{ x: cx, y: entrance.y + entrance.d - 0.05 }, { x: cx, y: cy }];
  }
}

function entranceEgress(entrance) {
  const e = entranceDefOf(defOf(entrance.type)) || {};
  const cx = entrance.x + entrance.w / 2;
  const cy = entrance.y + entrance.d / 2;
  switch (e.driveway) {
    case 'east': return [{ x: cx, y: cy }, { x: entrance.x + 0.05, y: cy }];
    case 'west': return [{ x: cx, y: cy }, { x: entrance.x + entrance.w - 0.05, y: cy }];
    case 'south': return [{ x: cx, y: cy }, { x: cx, y: entrance.y + 0.05 }];
    default: return [{ x: cx, y: cy }, { x: cx, y: entrance.y + entrance.d - 0.05 }];
  }
}

function entranceFeePoint(entrance) {
  const e = entranceDefOf(defOf(entrance.type)) || {};
  const cx = entrance.x + entrance.w / 2;
  const cy = entrance.y + entrance.d / 2;
  switch (e.driveway) {
    case 'east': return { x: entrance.x + entrance.w, y: cy };
    case 'west': return { x: entrance.x, y: cy };
    case 'south': return { x: cx, y: entrance.y };
    default: return { x: cx, y: entrance.y + entrance.d };
  }
}

const ENTRANCE_FACE = { south: 0, west: 1, north: 2, east: 3 };

function startStrollReturn(state, c) {
  const entrance = entranceById(state, c.entranceId) || primaryEntrance(state);
  const flow = ensureLeisure(state, entrance);
  const startKey = key(Math.floor(c.x), Math.floor(c.y));
  const back = entrance && flow.dist[startKey] !== undefined ? pathFromFlow(flow, startKey) : null;
  if (!back) {
    startLeaving(c, false);
    return;
  }
  back.reverse();
  const path = [{ x: c.x, y: c.y }, ...back, ...entranceEgress(entrance)];
  c.phase = 'leave';
  c.angry = false;
  c.node = 0;
  c.path = path;
  c.walking = true;
  c.q = 0;
}

function startCustomerExit(state, c, angry) {
  const entrance = entranceById(state, c.entranceId) || primaryEntrance(state);
  if (!angry && !state.festival) {
    const leg = chooseStrollLeg(state, c, entrance);
    if (leg) {
      c.phase = 'stroll';
      c.angry = false;
      c.path = leg;
      c.node = 0;
      c.walking = true;
      c.q = 0;
      c.strollLegs = 0;
      c.linger = 0;
      c.look = 0;
      return;
    }
  }
  startLeaving(c, angry);
}

function faceToward(c, dx, dy) {
  if (Math.abs(dx) > Math.abs(dy)) c.face = dx > 0 ? 3 : 1;
  else if (Math.abs(dy) > 0) c.face = dy > 0 ? 0 : 2;
}

function entranceSpawnScale(entrance) {
  return Math.max(0.1, Number(entranceDefOf(defOf(entrance?.type))?.spawnScale) || 1);
}

function spawnInterval(state, entrance = null) {
  const base = state.festival ? SPAWN_BASE * SPAWN_FESTIVAL_RATE : SPAWN_BASE;
  const jitter = SPAWN_JITTER_MIN + Math.random() * SPAWN_JITTER_SPREAD;
  return Math.max(SPAWN_MIN * (state.festival ? SPAWN_FESTIVAL_MIN_RATE : 1), base * jitter)
    * entranceSpawnScale(entrance);
}

function spawnTimerOf(state, entrance) {
  if (entrance === primaryEntrance(state)) {
    return Number.isFinite(state.spawnTimer) ? state.spawnTimer : SPAWN_TICK_FALLBACK;
  }
  const timer = state.spawnTimers?.[entrance.id];
  return Number.isFinite(timer) ? timer : SPAWN_FIRST_DELAY * entranceSpawnScale(entrance);
}

function setSpawnTimerOf(state, entrance, value) {
  if (entrance === primaryEntrance(state)) {
    state.spawnTimer = value;
  } else {
    state.spawnTimers = state.spawnTimers || {};
    state.spawnTimers[entrance.id] = value;
  }
}

export function spawnCustomer(state, events = [], entrance = null) {
  if (!state.customers) state.customers = [];
  if (state.customers.length >= CUSTOMER_MAX) return null;
  const target = entrance || primaryEntrance(state);
  if (!target || !entranceOpen(state, target)) return null;
  const targetDef = defOf(target.type);
  const entranceGeom = entranceDefOf(targetDef) || {};
  const flow = ensureFlow(state, target);
  if (!flow.sources.length) return null;

  const shops = [];
  for (const o of state.objects) {
    const def = defOf(o.type);
    if (!def?.sale || !isBuilt(o) || !o.connected) continue;
    const entry = bestEntry(state, o, flow);
    if (!entry) continue;
    const q = queueAtShop(state, o.id).length;
    // The drive-thru has two lanes and a counter kiosk, so it takes a longer
    // file than a hole-in-the-wall fry shack. Everything else keeps the
    // historical cap of three.
    if (q >= (def.sale.queue || QUEUE_MAX)) continue;
    // A shop with an empty larder would only make the guest wait out their
    // patience; skip it until production catches up.
    if (missingInputs(state, def).length) continue;
    // A destination restaurant can out-pull its distance: `draw` multiplies
    // the craving before the distance/queue divisor.
    const weight = (SHOP_CRAVING_MIN + Math.random() * SHOP_CRAVING_SPREAD)
      * (def.sale.draw || 1)
      / (1 + entry.dist * SHOP_DISTANCE_PULL + q * SHOP_QUEUE_PENALTY);
    shops.push({ o, entry, queue: q, weight });
  }
  if (!shops.length) return null;
  let roll = Math.random() * shops.reduce((sum, s) => sum + s.weight, 0);
  let pick = shops[shops.length - 1];
  for (const s of shops) {
    roll -= s.weight;
    if (roll <= 0) {
      pick = s;
      break;
    }
  }
  const path = pathFromFlow(flow, pick.entry.k);
  if (!path || !path.length) return null;

  // Step out of the arch itself before joining the road graph, so the guest is
  // always visible walking through the opening instead of popping in behind it.
  path.unshift(...entranceLeadIn(target));

  const c = {
    id: state.nextCustomerId++,
    type: CUSTOMER_TYPES[Math.floor(Math.random() * CUSTOMER_TYPES.length)],
    phase: 'walk',
    path,
    node: 0,
    x: path[0].x,
    y: path[0].y,
    shopId: pick.o.id,
    entranceId: target.id,
    patience: PATIENCE_WALK,
    maxPatience: PATIENCE_WALK,
    q: 0,
    queueAt: 0,
    walking: true,
    face: ENTRANCE_FACE[entranceGeom.driveway] ?? 0,
    frame: 0,
    step: 0,
    strollLegs: 0,
  };
  state.customers.push(c);

  const fee = targetDef?.toll || TOLL_FEE;
  const at = entranceFeePoint(target);
  state.coins += fee;
  state.stats.coinsEarned = (state.stats.coinsEarned || 0) + fee;
  state.stats.tollEarned = (state.stats.tollEarned || 0) + fee;
  events.push({ type: 'toll', id: c.id, coins: fee, entranceId: target.id, x: at.x, y: at.y });
  setSpawnTimerOf(state, target, spawnInterval(state, target));
  return c;
}

function startLeaving(c, angry) {
  c.phase = 'leave';
  c.angry = !!angry;
  c.node = 0;
  c.path = c.path.slice().reverse();
  if (c.path.length) {
    c.x = c.path[0].x;
    c.y = c.path[0].y;
  }
  c.walking = true;
  c.frame = 0;
  c.q = 0;
}

function moveCustomer(c, dt) {
  let remain = dt * CUSTOMER_SPEED;
  while (remain > 0) {
    const next = c.path[c.node + 1];
    if (!next) {
      c.walking = false;
      return true;
    }
    const dx = next.x - c.x;
    const dy = next.y - c.y;
    faceToward(c, dx, dy);
    const d = Math.hypot(dx, dy);
    if (d <= remain) {
      c.x = next.x;
      c.y = next.y;
      c.node += 1;
      remain -= d;
    } else {
      c.x += (dx / d) * remain;
      c.y += (dy / d) * remain;
      remain = 0;
    }
    c.step += dt;
    if (c.step > CUSTOMER_STEP_TIME) {
      c.step = 0;
      c.frame ^= 1;
    }
  }
  return !c.path[c.node + 1];
}

function tickCustomers(state, dt, events) {
  const customers = state.customers || [];
  for (const c of customers) {
    if (c.phase === 'walk') {
      const arrived = moveCustomer(c, dt);
      if (!arrived) continue;
      const shop = objectById(state, c.shopId);
      if (!shop) {
        startLeaving(c, true);
        continue;
      }
      c.phase = 'queue';
      c.walking = false;
      c.patience = PATIENCE_QUEUE;
      c.maxPatience = PATIENCE_QUEUE;
      c.queueAt = state.simTime || 0;
      faceToward(c, shop.x + shop.w / 2 - c.x, shop.y + shop.d / 2 - c.y);
    } else if (c.phase === 'queue') {
      const shop = objectById(state, c.shopId);
      if (!shop) {
        state.stats.customersLost = (state.stats.customersLost || 0) + 1;
        events.push({ type: 'angry', id: c.id, x: c.x, y: c.y, reason: 'closed' });
        startLeaving(c, true);
        continue;
      }
      const def = defOf(shop.type);
      const canServe = isConnected(state, shop) && !missingInputs(state, def).length;
      c.patience -= dt * (canServe ? 1 : PATIENCE_DRAIN);
      if (c.patience <= 0) {
        state.stats.customersLost = (state.stats.customersLost || 0) + 1;
        events.push({ type: 'angry', id: c.id, x: c.x, y: c.y, reason: canServe ? 'wait' : 'stock' });
        startLeaving(c, true);
      }
    } else if (c.phase === 'stroll') {
      const arrived = moveCustomer(c, dt);
      if (!arrived) continue;
      c.walking = false;
      c.phase = 'linger';
      c.linger = STROLL_WAIT_MIN + Math.random() * (STROLL_WAIT_MAX - STROLL_WAIT_MIN);
      c.look = STROLL_LOOK_FIRST_MIN + Math.random() * STROLL_LOOK_FIRST_SPREAD;
    } else if (c.phase === 'linger') {
      c.linger -= dt;
      c.look -= dt;
      if (c.look <= 0) {
        c.face = Math.floor(Math.random() * 4);
        c.look = STROLL_LOOK_MIN + Math.random() * STROLL_LOOK_SPREAD;
      }
      if (c.linger > 0) continue;
      if ((c.strollLegs || 0) < 1 && Math.random() < STROLL_SECOND_CHANCE) {
        const leg = chooseStrollLeg(state, c);
        if (leg) {
          c.strollLegs = 1;
          c.phase = 'stroll';
          c.path = leg;
          c.node = 0;
          c.walking = true;
          continue;
        }
      }
      startStrollReturn(state, c);
    } else if (c.phase === 'leave') {
      const arrived = moveCustomer(c, dt);
      if (arrived) c.phase = 'done';
    }
  }
  state.customers = customers.filter((c) => c.phase !== 'done');
}

function serviceBeerHalls(state, dt, events) {
  for (const o of state.objects) {
    const def = defOf(o.type);
    const buff = def?.buff;
    if (!buff) continue;
    if (!isBuilt(o) || !o.connected) {
      o.buffLeft = 0;
      o.tapTimer = 0;
      continue;
    }
    o.buffLeft = Math.max(0, (o.buffLeft || 0) - dt);
    const targets = buffTargets(state, o);
    if (!targets.length) {
      // Keep a keg ready so the first restaurant in range gets an immediate pour.
      o.tapTimer = buff.interval;
      continue;
    }
    if (o.tapTimer === undefined) o.tapTimer = buff.interval;
    o.tapTimer += dt;
    if (o.tapTimer < buff.interval) continue;
    const need = buff.beer || 1;
    if ((state.res.beer || 0) < need) {
      o.tapTimer = buff.interval;
      continue;
    }
    state.res.beer -= need;
    state.stats.beerTapped = (state.stats.beerTapped || 0) + 1;
    o.tapTimer = 0;
    o.buffLeft = buff.duration;
    events.push({ type: 'beerBuff', id: o.id, label: buff.label, remaining: buff.duration, targets: targets.length });
  }
}

function serviceShops(state, dt, events) {
  let servedThisTick = 0;
  const buffs = activeBuffs(state);
  for (const o of state.objects) {
    const def = defOf(o.type);
    if (!def?.sale) continue;
    if (!isBuilt(o)) continue;
    const queue = queueAtShop(state, o.id);
    if (!queue.length) {
      o.timer = Math.max(0, (o.timer || 0) - dt * SALE_TIMER_DECAY);
      continue;
    }
    if (def.needsRoad && !o.connected) continue;
    if (missingInputs(state, def).length) continue;
    const buff = buffs.get(o.id);
    const serveTime = def.sale.time * (buff ? 1 - (buff.time || 0) : 1);
    o.timer = (o.timer || 0) + dt;
    if (o.timer < serveTime) continue;
    o.timer -= serveTime;
    takeInputs(state, def.sale.in);
    const coins = Math.round(def.sale.coins * (buff ? 1 + (buff.coins || 0) : 1));
    state.coins += coins;
    state.stats.coinsEarned = (state.stats.coinsEarned || 0) + coins;
    state.stats[def.sale.stat] = (state.stats[def.sale.stat] || 0) + (def.sale.units || 1);
    state.stats.served = (state.stats.served || 0) + 1;
    const customer = queue[0];
    if (entranceById(state, customer.entranceId)?.type === 'northBridge') {
      state.stats.bridgeServed = (state.stats.bridgeServed || 0) + 1;
    }
    startCustomerExit(state, customer, false);
    addReview(state, def.sale.review || {
      taste: def.sale.taste || 1,
      crowd: 1,
      weird: def.sale.weird || 0,
    });
    servedThisTick += 1;
    events.push({ type: 'sale', id: o.id, customerId: customer.id, coins, label: def.sale.label, stat: def.sale.stat });
    if ((state.stats.served || 0) % REVIEWER_EVERY === 0 && reviewPoints(state) < reviewCap(state)) {
      addReview(state, REVIEWER_REVIEW);
      state.stats.reviewers = (state.stats.reviewers || 0) + 1;
      events.push({ type: 'reviewer', served: state.stats.served, bonus: REVIEWER_BONUS });
    }
    if (state.festival) {
      state.festival.served += 1;
      if (state.festival.served >= state.festival.target) {
        events.push({ type: 'festivalReached', served: state.festival.served, target: state.festival.target });
        finishFestival(state, events);
      }
    }
  }
  return servedThisTick;
}

export function tick(state, dt, events = []) {
  state.events = undefined;
  const prevTime = state.simTime || 0;
  const harvesters = state.objects.filter((o) => o.type === 'wormFarm' && isBuilt(o));
  state.simTime = prevTime + dt;
  state.timeMin += dt * GAME_MIN_PER_SEC;
  while (state.timeMin >= DAY_MINUTES) {
    state.timeMin -= DAY_MINUTES;
    state.day += 1;
  }
  recompute(state);

  for (const o of state.objects) {
    const def = defOf(o.type);
    if (!def) continue;
    if (!isBuilt(o)) {
      o.buildLeft = Math.max(0, (o.buildLeft || 0) - dt);
      if (o.buildLeft <= 0) finishConstruction(state, o, events);
      continue;
    }
    if (def.kind === 'field') {
      if (o.growth < 1) {
        o.growth = Math.min(1, o.growth + dt / def.grow);
      }
      if (o.growth >= 1) {
        const added = addResource(state, def.res, def.yield);
        if (added > 0) {
          o.growth = 0;
          events.push({ type: 'harvest', id: o.id, res: def.res, amount: added });
        }
      }
      continue;
    }
    if (def.prod) {
      if (def.kind === 'range' && !o.barnReady) continue;
      if (def.needsRoad && !o.connected) continue;
      if (outputFull(state, def)) continue;
      if (missingInputs(state, def).length) continue;
      o.timer += dt;
      if (o.timer >= def.prod.time) {
        o.timer -= def.prod.time;
        takeInputs(state, def.prod.in);
        const out = {};
        for (const [res, n] of Object.entries(def.prod.out)) out[res] = addResource(state, res, n);
        events.push({ type: 'produce', id: o.id, out });
        if (out.octoHorn) {
          state.stats.octoHornCollected = (state.stats.octoHornCollected || 0) + out.octoHorn;
          if (!state.flags.octoHornFound) {
            state.flags.octoHornFound = true;
            events.push({ type: 'octoHorn', id: o.id, amount: out.octoHorn });
          }
        }
      }
    }
    // The ranch sells tours on the shared sale timer, so meat production keeps
    // its own clock instead of fighting the queue for o.timer.
    if (def.meat) {
      if (def.needsRoad && !o.connected) continue;
      if ((state.res[def.meat.res] || 0) + def.meat.amount > state.cap) continue;
      o.meatTimer = (o.meatTimer || 0) + dt;
      if (o.meatTimer >= def.meat.time) {
        o.meatTimer -= def.meat.time;
        const added = addResource(state, def.meat.res, def.meat.amount);
        const stat = `${def.meat.res}Collected`;
        state.stats[stat] = (state.stats[stat] || 0) + added;
        events.push({ type: 'meat', id: o.id, res: def.meat.res, amount: added });
      }
    }
  }

  const harvestCycles = wormHarvestsBetween(prevTime, state.simTime);
  if (harvestCycles > 0 && harvesters.length) {
    const amount = defOf('wormFarm').harvest || 2;
    for (const farm of harvesters) {
      for (let i = 0; i < harvestCycles; i++) {
        if (state.cap - (state.res.wormMeat || 0) < amount) {
          events.push({ type: 'wormHarvest', id: farm.id, amount: 0, voided: true });
          continue;
        }
        state.res.wormMeat = (state.res.wormMeat || 0) + amount;
        state.stats.wormMeatCollected = (state.stats.wormMeatCollected || 0) + amount;
        events.push({ type: 'wormHarvest', id: farm.id, amount, voided: false });
      }
    }
  }

  tickCustomers(state, dt, events);
  serviceBeerHalls(state, dt, events);
  serviceShops(state, dt, events);
  incomeSafety(state, events);

  if (state.festival) {
    state.festival.remaining -= dt;
    if (state.festival && state.festival.remaining <= 0) {
      finishFestival(state, events);
    }
  }

  for (const entrance of entrancesOf(state, { built: true })) {
    const next = spawnTimerOf(state, entrance) - dt;
    if (next > 0) {
      setSpawnTimerOf(state, entrance, next);
      continue;
    }
    const spawned = spawnCustomer(state, events, entrance);
    if (!spawned) {
      setSpawnTimerOf(state, entrance, entranceOpen(state, entrance) ? SPAWN_RETRY_ROAD : SPAWN_RETRY_BLOCKED);
    }
  }

  const level = state.review?.level || 1;
  for (const m of MISSION_DEFS) {
    if (state.missions.done[m.id]) continue;
    if ((m.level || 1) > level) continue;
    if (missionProgress(state, m) >= m.target) {
      state.missions.done[m.id] = true;
      state.coins += m.reward;
      state.stats.coinsEarned = (state.stats.coinsEarned || 0) + m.reward;
      events.push({ type: 'mission', id: m.id, title: m.title, reward: m.reward });
    }
  }

  state.flags = state.flags || {};
  if (state.review.points >= REVIEW_HALL_UNLOCK && !state.flags.hallReady) {
    state.flags.hallReady = true;
    events.push({ type: 'hallReady', points: state.review.points });
  }
  const need = nextLevelNeed(state);
  if (need && state.review.points >= need && state.flags.promoteReadyFor !== state.review.level) {
    state.flags.promoteReadyFor = state.review.level;
    events.push({ type: 'promoteReady', level: state.review.level, need });
  }

  return events;
}

export function missionList(state) {
  const level = state.review?.level || 1;
  return MISSION_DEFS.map((m) => {
    const locked = (m.level || 1) > level;
    const cur = locked ? 0 : Math.min(m.target, missionProgress(state, m));
    return { ...m, cur, locked, done: !!state.missions.done[m.id] };
  });
}

export function nextMission(state) {
  return missionList(state).find((m) => !m.done && !m.locked) || null;
}

export function clockText(state) {
  const total = Math.floor(state.timeMin);
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Initial town

// Old saves never saw cactus, mesas or acacia, so a filtered desert would read
// as an empty lot. Reseed the two plots once, deterministically, on the sand
// and desert core only.
function seedDesertScenery(state, target = 100) {
  const rng = mulberry32(WORLD_SEED ^ 0x5e4e);
  const ids = ['dune', 'dino'];
  let count = 0;
  let tries = 0;
  while (count < target && tries < 8000) {
    tries++;
    const id = ids[Math.floor(rng() * ids.length)];
    const plot = PLOT_BY_ID[id];
    if (!plot) break;
    const x = plot.x + Math.floor(rng() * plot.w);
    const y = plot.y + Math.floor(rng() * plot.d);
    const t = terrainAt(x, y);
    if (t !== 'desert' && t !== 'sand') continue;
    if (state.roads[key(x, y)] || objectAt(state, x, y)) continue;
    const table = PLOT_SCENERY[id] || SCENERY;
    const weighted = [];
    for (const [type, n] of table) for (let i = 0; i < n; i++) weighted.push(type);
    const type = weighted[Math.floor(rng() * weighted.length)];
    const def = defOf(type);
    if (!def) continue;
    let fits = true;
    for (let dy = 0; dy < def.d && fits; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        const tt = terrainAt(xx, yy);
        const pp = plotAt(xx, yy);
        if (!pp || pp.id !== plot.id || (tt !== 'desert' && tt !== 'sand')
          || state.roads[key(xx, yy)] || objectAt(state, xx, yy)
          || !mayGrow(type, tt, plot.id)) {
          fits = false;
          break;
        }
      }
    }
    if (!fits) continue;
    makeObject(state, type, x, y, { natural: true });
    count++;
  }
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeScenery(state, rng) {
  let count = 0;
  let tries = 0;
  const keep = SCENERY_KEEP_OPEN;
  const keepBridge = SCENERY_KEEP_OPEN_BRIDGE;
  const startKeepOpen = (x, y) => (x >= keep.x1 && x <= keep.x2 && y >= keep.y1 && y <= keep.y2)
    || (x >= keepBridge.x1 && x <= keepBridge.x2 && y >= keepBridge.y1 && y <= keepBridge.y2);
  while (count < SCENERY_TARGET && tries < SCENERY_TRIES) {
    tries++;
    const x = 1 + Math.floor(rng() * (MAP_W - 2));
    const y = 1 + Math.floor(rng() * (MAP_H - 2));
    const plot = plotAt(x, y);
    if (!plot) continue;
    const t = terrainAt(x, y);
    if (t !== 'grass' && t !== 'sand' && t !== 'desert' && t !== 'snow' && t !== 'gravel') continue;
    if (state.roads[key(x, y)] || objectAt(state, x, y)) continue;
    if (startKeepOpen(x, y)) continue;
    const table = PLOT_SCENERY[plot.id] || SCENERY;
    const weighted = [];
    for (const [type, n] of table) for (let i = 0; i < n; i++) weighted.push(type);
    let type = weighted[Math.floor(rng() * weighted.length)];
    let def = defOf(type);
    // Ground gate. A type whose ground does not include this tile can never
    // grow here, so re-roll a few times instead of burning the whole attempt —
    // a snow field should sprout snow pines, not re-roll until it gets a rock.
    if (def && !mayGrow(type, t, plot.id)) {
      let picked = null;
      for (let k = 0; k < 8; k++) {
        const alt = weighted[Math.floor(rng() * weighted.length)];
        if (mayGrow(alt, t, plot.id)) { picked = alt; break; }
      }
      if (!picked) continue;
      type = picked;
      def = defOf(picked);
    }
    if (!def) continue;
    // Multi-tile scenery must also clear its full footprint, or a mesa can
    // swallow the worm hole rim or a road one tile behind the anchor.
    let fits = true;
    if (def.w > 1 || def.d > 1) {
      for (let dy = 0; dy < def.d && fits; dy++) {
        for (let dx = 0; dx < def.w; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          const tt = terrainAt(xx, yy);
          const pp = plotAt(xx, yy);
          if (!pp || pp.id !== plot.id || (tt !== 'grass' && tt !== 'sand' && tt !== 'desert' && tt !== 'snow' && tt !== 'gravel')
            || state.roads[key(xx, yy)] || objectAt(state, xx, yy) || startKeepOpen(xx, yy)
            || !mayGrow(type, tt, plot.id)) {
            fits = false;
            break;
          }
        }
      }
    } else if (!mayGrow(type, t, plot.id)) {
      fits = false;
    }
    if (!fits) continue;
    makeObject(state, type, x, y, { natural: true });
    count++;
  }
}

// 炸浪湾 is planted by hand instead of by the global pass: the global pass only
// accepts grass / sand / desert / snow / gravel, so a cay made of coral sand
// came out bare (two palms on the whole island). The cay keeps a palm grove and
// a few rocks along its beaches, and the same pass replants it after a terrain
// reshape — see the `resortSeeded` migration in deserialize.
const RESORT_SCENERY_TARGET = 20;

function seedResortScenery(state) {
  const plot = PLOT_BY_ID.deepsea;
  if (!plot) return;
  const table = PLOT_SCENERY.deepsea || SCENERY;
  const weighted = [];
  for (const [type, n] of table) for (let i = 0; i < n; i++) weighted.push(type);
  const rng = mulberry32(WORLD_SEED + 77);
  const ground = (t) => t === 'coral' || t === 'grass';
  let count = 0;
  let tries = 0;
  while (count < RESORT_SCENERY_TARGET && tries < 800) {
    tries++;
    const x = plot.x + Math.floor(rng() * plot.w);
    const y = plot.y + Math.floor(rng() * plot.d);
    if (!ground(terrainAt(x, y))) continue;
    if (state.roads[key(x, y)] || state.paint[key(x, y)] || objectAt(state, x, y)) continue;
    const type = weighted[Math.floor(rng() * weighted.length)];
    const def = defOf(type);
    if (!def) continue;
    // Ground gate, same rule as the global pass: a snow cairn does not grow on
    // coral sand. The cay is small, so re-rolling beats skipping the attempt.
    if (!mayGrow(type, terrainAt(x, y), plot.id)) continue;
    let fits = true;
    for (let dy = 0; dy < def.d && fits; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (plotAt(xx, yy)?.id !== plot.id || !ground(terrainAt(xx, yy))
          || state.roads[key(xx, yy)] || state.paint[key(xx, yy)] || objectAt(state, xx, yy)) {
          fits = false;
          break;
        }
      }
    }
    if (!fits) continue;
    makeObject(state, type, x, y, { natural: true });
    count++;
  }
}

// Region dressing arrived after the world was first seeded, so a save made
// before it has none of it. Rather than reseeding (which would shuffle the
// scenery a player has already learned to read), this pass only tops up a plot
// that is short on its own regional props: it counts what is there, plants the
// difference, and never touches anything that is not one of the region types.
const REGION_REGION_TARGET = 6;

function seedRegionDressing(state) {
  const rng = mulberry32(WORLD_SEED + 131);
  const ground = (t) => t === 'grass' || t === 'sand' || t === 'desert' || t === 'snow' || t === 'gravel' || t === 'coral';
  for (const plot of PLOTS) {
    const table = PLOT_SCENERY[plot.id] || [];
    const regionTypes = table
      .map(([type]) => type)
      .filter((type) => {
        const def = defOf(type);
        return def && Array.isArray(def.plots) && def.plots.includes(plot.id) && def.cat === 'decor' && !def.hidden;
      });
    if (!regionTypes.length) continue;
    let present = 0;
    for (const o of state.objects) {
      if (o.natural && regionTypes.includes(o.type) && plotAt(o.x, o.y)?.id === plot.id) present++;
    }
    let need = REGION_REGION_TARGET - present;
    if (need <= 0) continue;
    let tries = 0;
    while (need > 0 && tries < 600) {
      tries++;
      const x = plot.x + Math.floor(rng() * plot.w);
      const y = plot.y + Math.floor(rng() * plot.d);
      if (!ground(terrainAt(x, y))) continue;
      if (state.roads[key(x, y)] || state.paint[key(x, y)] || objectAt(state, x, y)) continue;
      const type = regionTypes[Math.floor(rng() * regionTypes.length)];
      const def = defOf(type);
      if (!def) continue;
      // Ground gate, or a snow pine lands in the middle of a desert plot.
      if (!mayGrow(type, terrainAt(x, y), plot.id)) continue;
      let fits = true;
      for (let dy = 0; dy < def.d && fits; dy++) {
        for (let dx = 0; dx < def.w; dx++) {
          const xx = x + dx;
          const yy = y + dy;
          if (plotAt(xx, yy)?.id !== plot.id || !ground(terrainAt(xx, yy))
            || state.roads[key(xx, yy)] || state.paint[key(xx, yy)] || objectAt(state, xx, yy)
            || !mayGrow(type, terrainAt(xx, yy), plot.id)) {
            fits = false;
            break;
          }
        }
      }
      if (!fits) continue;
      makeObject(state, type, x, y, { natural: true });
      need--;
    }
  }
  state.sceneRev = (state.sceneRev || 0) + 1;
}

export function createInitialState() {
  const state = {
    v: SAVE_VERSION,
    coins: INITIAL_COINS,
    res: { ...INITIAL_RESOURCES },
    objects: [],
    roads: {},
    paint: {},
    stats: {
      friesSold: 0, burgersSold: 0, friedChickenSold: 0, crayfishSold: 0, luosifenSold: 0,
      hotdogsSold: 0, deliSold: 0, pizzasSold: 0, beerTapped: 0, seafoodSold: 0,
      cactusSold: 0, wormMeatCollected: 0, duneGrillSold: 0, wormBurgersSold: 0,
      dinoMeatCollected: 0, dinoTours: 0, cretaceousSold: 0,
      mammothMeatCollected: 0, mammothSold: 0, bridgeServed: 0,
      beachGrillSold: 0, resortDinnerSold: 0, octoHornCollected: 0,
      signatureSold: 0, coinsEarned: 0, spent: 0, roadsBuilt: 0,
      bridgesBuilt: 0, served: 0, customersLost: 0, tollEarned: 0, reviewers: 0, festivals: 0,
      festivalsStarted: 0,
    },
    review: { ...INITIAL_REVIEW },
    flags: { reviewInviteSeen: false },
    cap: STORAGE_BASE,
    timeMin: INITIAL_TIME_MIN,
    day: 1,
    missions: { done: {} },
    nextId: 1,
    nextCustomerId: 1,
    customers: [],
    spawnTimer: SPAWN_FIRST_DELAY,
    spawnTimers: {},
    simTime: 0,
    roadRev: 1,
    paintRev: 1,
    sceneRev: 1,
    speed: 1,
    boostUntil: 0,
    savedAt: Date.now(),
    settings: { sound: true, music: true },
  };

  // Main street above the gate, then the two-lane drive that runs under the
  // arch. The gate itself sits on the southern map edge.
  for (const seg of INITIAL_ROADS) {
    for (let y = seg.y1; y <= seg.y2; y++) {
      for (let x = seg.x1; x <= seg.x2; x++) state.roads[key(x, y)] = 1;
    }
  }

  for (const o of INITIAL_OBJECTS) makeObject(state, o.type, o.x, o.y, o.opts);

  const rng = mulberry32(WORLD_SEED);
  makeScenery(state, rng);
  seedResortScenery(state);
  state.flags.desertSeeded = true;
  state.flags.resortSeeded = true;
  state.flags.regionDressingSeeded = true;
  recompute(state);
  state.review.points = reviewPoints(state);
  return state;
}

// ---------------------------------------------------------------------------
// Persistence

export function serialize(state) {
  return JSON.stringify({
    v: SAVE_VERSION,
    coins: state.coins,
    res: state.res,
    objects: state.objects,
    roads: state.roads,
    paint: state.paint,
    stats: state.stats,
    review: state.review,
    flags: state.flags,
    festival: state.festival || null,
    timeMin: state.timeMin,
    day: state.day,
    missions: state.missions,
    nextId: state.nextId,
    nextCustomerId: state.nextCustomerId,
    spawnTimers: state.spawnTimers || {},
    speed: state.speed || 1,
    boostUntil: state.boostUntil || 0,
    savedAt: Date.now(),
    settings: state.settings,
  });
}

export function deserialize(raw) {
  if (!raw) return null;
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!data || data.v !== SAVE_VERSION || !Array.isArray(data.objects) || !data.roads) return null;
  const base = createInitialState();
  const state = {
    ...base,
    ...data,
    v: SAVE_VERSION,
    res: { ...base.res, ...(data.res || {}) },
    stats: { ...base.stats, ...(data.stats || {}) },
    review: { ...base.review, ...(data.review || {}) },
    flags: { ...base.flags, ...(data.flags || {}) },
    missions: data.missions && data.missions.done ? data.missions : base.missions,
    settings: { ...base.settings, ...(data.settings || {}) },
    customers: [],
    simTime: 0,
    spawnTimer: 2,
    spawnTimers: { ...(data.spawnTimers || {}) },
    roadRev: (data.roadRev || 0) + 1,
    _flow: null,
    _flows: null,
    _leisure: null,
    _leisures: null,
  };
  state.objects = data.objects.filter((o) => defOf(o.type)).map((o) => {
    const def = defOf(o.type);
    return {
      ...o,
      rot: isRotatable(def) ? ((Number(o.rot) || 0) % 4 + 4) % 4 : 0,
      connected: true,
    };
  });
  state.objects = state.objects.filter((o) => {
    if (!o.natural) return true;
    // Ground gate on load. Saves written before the scenery ground table existed
    // can hold a snow pine on a lawn or a fishing net in a meadow; those props
    // are removed here so an old save ends up looking like a fresh one. Only
    // natural scenery is touched — anything the player placed survives.
    if (!mayGrow(o.type, terrainAt(o.x, o.y), plotAt(o.x, o.y)?.id || null)) return false;
    const plot = plotAt(o.x, o.y);
    return !plot || !DESERT_PLOTS.has(plot.id) || DESERT_SCENERY_TYPES.has(o.type);
  });
  state.nextId = Math.max(Number(data.nextId) || 1, ...state.objects.map((o) => (o.id || 0) + 1), 1);
  if (!state.objects.some((o) => o.type === 'wormHole' || o.type === 'wormFarm')) {
    let free = true;
    for (let y = 21; y < 27 && free; y++) {
      for (let x = 27; x < 33; x++) {
        if (objectAt(state, x, y)) { free = false; break; }
      }
    }
    if (free) {
      state.objects.push({
        id: state.nextId++, type: 'wormHole', x: 27, y: 21, w: 6, d: 6,
        variant: 0, rot: 0, timer: 0, growth: 0, natural: true, connected: true,
        built: true, buildLeft: 0, buildTotal: 0,
      });
      state.sceneRev = (state.sceneRev || 0) + 1;
    }
  }
  // The bone bed shipped after v4. Old saves get it back unless the paleo lab
  // already replaced it; wild props inside are cleared, but player roads,
  // paving and buildings block the insertion so nothing is destroyed.
  if (!state.objects.some((o) => o.type === 'dinoGraveyard' || o.type === 'paleoLab')) {
    const gx = 29;
    const gy = 2;
    const gw = 8;
    const gd = 5;
    let free = true;
    for (let ty = gy; ty < gy + gd && free; ty++) {
      for (let tx = gx; tx < gx + gw; tx++) {
        if (state.roads[key(tx, ty)] || state.paint[key(tx, ty)]) { free = false; break; }
        const o = objectAt(state, tx, ty);
        if (o && !o.natural) { free = false; break; }
      }
    }
    if (free) {
      state.objects = state.objects.filter((o) => !(o.natural
        && o.x < gx + gw && o.x + o.w > gx && o.y < gy + gd && o.y + o.d > gy));
      state.objects.push({
        id: state.nextId++, type: 'dinoGraveyard', x: gx, y: gy, w: gw, d: gd,
        variant: 0, rot: 0, timer: 0, growth: 0, natural: true, connected: true,
        built: true, buildLeft: 0, buildTotal: 0,
      });
      state.sceneRev = (state.sceneRev || 0) + 1;
    }
  }
  // The icefield cave shipped after v4. Old saves get it back unless the
  // research station already grew out of it; wild snow scenery inside is
  // cleared, but player roads, paving and buildings block the insertion.
  if (!state.objects.some((o) => o.type === 'mammothCave' || o.type === 'permafrostLab')) {
    const cx = 7;
    const cy = 3;
    const cw = 6;
    const cd = 4;
    let free = true;
    for (let ty = cy; ty < cy + cd && free; ty++) {
      for (let tx = cx; tx < cx + cw; tx++) {
        if (state.roads[key(tx, ty)] || state.paint[key(tx, ty)]) { free = false; break; }
        const o = objectAt(state, tx, ty);
        if (o && !o.natural) { free = false; break; }
      }
    }
    if (free) {
      state.objects = state.objects.filter((o) => !(o.natural
        && o.x < cx + cw && o.x + o.w > cx && o.y < cy + cd && o.y + o.d > cy));
      state.objects.push({
        id: state.nextId++, type: 'mammothCave', x: cx, y: cy, w: cw, d: cd,
        variant: 0, rot: 0, timer: 0, growth: 0, natural: true, connected: true,
        built: true, buildLeft: 0, buildTotal: 0,
      });
      state.sceneRev = (state.sceneRev || 0) + 1;
    }
  }
  // The crossing has lived at several earlier sites: the old icefield plateau
  // (2,0), the river mouth (13,58), the blue lake's south bank (12,13) and the
  // pre-edge frozen-stem spots (7,15), (5,15), (6,15). All are relocated to the
  // western map edge so the id, build state and mission progress survive.
  // Natural scenery at the new site is cleared; player roads, paving and
  // buildings there keep the old save put.
  const crossing = state.objects.find((o) => o.type === 'northBridgeSite' || o.type === 'northBridge');
  const legacyCrossing = crossing && crossing.w === 4 && crossing.d === 4
    && ((crossing.x === 2 && crossing.y === 0)
      || (crossing.x === 13 && crossing.y === 58)
      || (crossing.x === 12 && crossing.y === 13)
      || (crossing.x === 7 && crossing.y === 15)
      || (crossing.x === 5 && crossing.y === 15)
      || (crossing.x === 6 && crossing.y === 15));
  if (legacyCrossing) {
    const { x: bx, y: by, w: bw, d: bd } = BRIDGE_SITE;
    let free = true;
    for (let ty = by; ty < by + bd && free; ty++) {
      for (let tx = bx; tx < bx + bw; tx++) {
        if (state.roads[key(tx, ty)] || state.paint[key(tx, ty)]) { free = false; break; }
        const o = objectAt(state, tx, ty);
        if (o && o !== crossing && !o.natural) { free = false; break; }
      }
    }
    if (free) {
      state.objects = state.objects.filter((o) => !(o.natural && o !== crossing
        && o.x < bx + bw && o.x + o.w > bx && o.y < by + bd && o.y + o.d > by));
      crossing.x = bx;
      crossing.y = by;
      crossing.w = bw;
      crossing.d = bd;
      state.sceneRev = (state.sceneRev || 0) + 1;
    }
  }
  // The river crossing shipped after the mammoth line. Old saves get the
  // bridgehead back unless the crossing already stands; wild scenery inside is
  // cleared, but player roads, paving and buildings block the insertion.
  if (!state.objects.some((o) => o.type === 'northBridgeSite' || o.type === 'northBridge')) {
    const { x: bx, y: by, w: bw, d: bd } = BRIDGE_SITE;
    let free = true;
    for (let ty = by; ty < by + bd && free; ty++) {
      for (let tx = bx; tx < bx + bw; tx++) {
        if (state.roads[key(tx, ty)] || state.paint[key(tx, ty)]) { free = false; break; }
        const o = objectAt(state, tx, ty);
        if (o && !o.natural) { free = false; break; }
      }
    }
    if (free) {
      state.objects = state.objects.filter((o) => !(o.natural
        && o.x < bx + bw && o.x + o.w > bx && o.y < by + bd && o.y + o.d > by));
      state.objects.push({
        id: state.nextId++, type: 'northBridgeSite', x: bx, y: by, w: bw, d: bd,
        variant: 0, rot: 0, timer: 0, growth: 0, natural: true, connected: true,
        built: true, buildLeft: 0, buildTotal: 0,
      });
      state.sceneRev = (state.sceneRev || 0) + 1;
    }
  }
  // The giant octopus shipped after the resort. Old saves get the vortex back
  // on the abyss plot's open water; player roads, paving and buildings at the
  // site block the insertion instead of being destroyed.
  if (!state.objects.some((o) => o.type === 'giantOctopus')) {
    const ox = 71;
    const oy = 1;
    const ow = 8;
    const od = 8;
    let free = true;
    for (let ty = oy; ty < oy + od && free; ty++) {
      for (let tx = ox; tx < ox + ow; tx++) {
        if (state.roads[key(tx, ty)] || state.paint[key(tx, ty)]) { free = false; break; }
        const o = objectAt(state, tx, ty);
        if (o && !o.natural) { free = false; break; }
      }
    }
    if (free) {
      state.objects = state.objects.filter((o) => !(o.natural
        && o.x < ox + ow && o.x + o.w > ox && o.y < oy + od && o.y + o.d > oy));
      state.objects.push({
        id: state.nextId++, type: 'giantOctopus', x: ox, y: oy, w: ow, d: od,
        variant: 0, rot: 0, timer: 0, growth: 0, natural: true, connected: true,
        built: true, buildLeft: 0, buildTotal: 0,
      });
      state.sceneRev = (state.sceneRev || 0) + 1;
    }
  }
  // The harbor is assembled out of the lagoon's pilot well instead of being
  // dropped from the drawer. Old saves without either get the wellhead back at
  // the ring's centre; a save that already paid for the harbor keeps it.
  if (!state.objects.some((o) => o.type === 'abyssWellhead' || o.type === 'deepSeaHarbor')) {
    const { x: wx, y: wy, w: ww, d: wd } = ABYSS_WELLHEAD_SITE;
    let free = true;
    for (let ty = wy; ty < wy + wd && free; ty++) {
      for (let tx = wx; tx < wx + ww; tx++) {
        if (state.roads[key(tx, ty)] || state.paint[key(tx, ty)]) { free = false; break; }
        const o = objectAt(state, tx, ty);
        if (o && !o.natural) { free = false; break; }
      }
    }
    if (free) {
      state.objects = state.objects.filter((o) => !(o.natural
        && o.x < wx + ww && o.x + o.w > wx && o.y < wy + wd && o.y + o.d > wy));
      state.objects.push({
        id: state.nextId++, type: 'abyssWellhead', x: wx, y: wy, w: ww, d: wd,
        variant: 0, rot: 0, timer: 0, growth: 0, natural: true, connected: true,
        built: true, buildLeft: 0, buildTotal: 0,
      });
      state.sceneRev = (state.sceneRev || 0) + 1;
    }
  }
  // The flag is checked on the saved payload, not the merged state: fresh
  // states carry it in base.flags, and old saves must not inherit it.
  if (!data.flags || data.flags.desertSeeded !== true) {
    seedDesertScenery(state);
  }
  state.flags.desertSeeded = true;
  // 炸浪湾 went from a ring atoll to a single sand cay. Wild props the old shape
  // left standing in open water are dropped, then the cay is replanted. Player
  // buildings are deliberately left alone — a terrain reshape must not demolish
  // what the player paid for.
  if (!data.flags || data.flags.resortSeeded !== true) {
    state.objects = state.objects.filter((o) => !o.natural
      || plotAt(o.x, o.y)?.id !== 'deepsea'
      || terrainBuildable(terrainAt(o.x, o.y)));
    seedResortScenery(state);
  }
  state.flags.resortSeeded = true;
  // Region dressing: additive only, see seedRegionDressing.
  if (!data.flags || data.flags.regionDressingSeeded !== true) {
    seedRegionDressing(state);
  }
  state.flags.regionDressingSeeded = true;
  normalizeReview(state);
  normalizeSpeed(state);
  state.review.points = reviewPoints(state);
  state.flags.stuckSince = 0;
  state.nextCustomerId = Math.max(1, Number(data.nextCustomerId) || 1);
  recompute(state);
  return state;
}

export const MAP = { W: MAP_W, H: MAP_H };

export { RES_ORDER };
