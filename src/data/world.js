// World layout: map size, plots, terrain materials, deterministic starting
// town and the per-plot scenery tables. No rules or rendering logic here.

export const MAP_W = 80;
export const MAP_H = 64;
export const PLOT_W = 20;
export const PLOT_H = 16;

// Visual order is map order (north row first) so the plot map reads like the actual island.
export const PLOTS = [
  { id: 'icefield', name: '冰原', theme: '冰原 / 永冻土', industry: '史前', x: 0, y: 0, w: PLOT_W, d: PLOT_H, rank: 6, accent: '#a9d2f5', desc: '风把雪吹成一道道长脊，冻土下面压着完整的猛犸骨架。蓝冰湖在中间亮着。' },
  { id: 'dino', name: '恐龙谷', theme: '沙漠 / 史前', industry: '史前', x: 20, y: 0, w: PLOT_W, d: PLOT_H, rank: 8, accent: '#c9a15e', desc: '沙丘埋着巨大的骨架，干河床里还留着比人高的脚印。恐龙墓场就在北侧。' },
  { id: 'plain', name: '北原', theme: '平原 / 草甸', industry: '通用', x: 40, y: 0, w: PLOT_W, d: PLOT_H, rank: 10, accent: '#c6d98f', desc: '一片平平整整的开阔草地，没有河也没有石头。想建什么就建什么。' },
  { id: 'abyss', name: '远海', theme: '深海', industry: '海鲜', x: 60, y: 0, w: PLOT_W, d: PLOT_H, rank: 10, accent: '#325a95', desc: '离岸很远的一片海，涡流里住着一只大章鱼。' },
  { id: 'forest', name: '杉木林', theme: '森林 / 景观', industry: '景观', x: 0, y: 16, w: PLOT_W, d: PLOT_H, rank: 6, accent: '#78a856', desc: '密林、林间水塘和一条向南流的小河。这片林子只负责好看。' },
  { id: 'dune', name: '红沙地', theme: '沙漠', industry: '种植', x: 20, y: 16, w: PLOT_W, d: PLOT_H, rank: 6, accent: '#d8a25e', desc: '长着仙人掌的沙地，中间有个很大的蠕虫洞。' },
  { id: 'harbor', name: '渔港', theme: '港口 / 渔获', industry: '水产', x: 40, y: 16, w: PLOT_W, d: PLOT_H, rank: 5, accent: '#61aaa0', desc: '一个向西凹进来的天然海湾。渔船从这里出海，带回鱼虾蟹。' },
  { id: 'deepsea', name: '白沙湾', theme: '海滩', industry: '度假', x: 60, y: 16, w: PLOT_W, d: PLOT_H, rank: 8, accent: '#42b3a6', desc: '白沙滩和棕榈树，坐渡轮过去可以住几天。' },
  { id: 'river', name: '河湾', theme: '河流 / 水电', industry: '加工', x: 0, y: 32, w: PLOT_W, d: PLOT_H, rank: 4, accent: '#91c8b8', desc: '一条河从北边林子流进来，在草地上拐了两道弯。水车的好地方。' },
  { id: 'farm', name: '农田', theme: '种植 / 谷物', industry: '种植', x: 20, y: 32, w: PLOT_W, d: PLOT_H, rank: 2, accent: '#c6d98f', desc: '平坦的农地和小水塘，第二波开放。土豆与小麦在这里铺开。' },
  { id: 'plaza', name: '中央广场', theme: '商业 / 人流', industry: '销售', x: 40, y: 32, w: PLOT_W, d: PLOT_H, rank: 4, accent: '#f0c98f', desc: '小镇的正中心。石板广场天生适合旗舰餐厅和大型招牌。' },
  { id: 'coast', name: '浅湾', theme: '海岸 / 渔获', industry: '水产', x: 60, y: 32, w: PLOT_W, d: PLOT_H, rank: 5, accent: '#7da3c9', desc: '沙滩、浅海和一条沙洲。渔船与鱼虾蟹养殖从这里开始。' },
  { id: 'dock', name: '西码头', theme: '港湾 / 水产', industry: '水产 / 加工', x: 0, y: 48, w: PLOT_W, d: PLOT_H, rank: 4, accent: '#7da3c9', desc: '河流入海处被冲出一个大港湾。木栈桥和加工厂都挤在这里。' },
  { id: 'south', name: '南门镇', theme: '城镇起点', industry: '薯条 / 起点', x: 20, y: 48, w: PLOT_W, d: PLOT_H, rank: 1, accent: '#e2b04a', desc: '南门牌楼就在镇子最南端，顾客从门洞进镇。你的第一个薯条小摊也开在这里。' },
  { id: 'market', name: '东市集', theme: '市集 / 批发', industry: '销售', x: 40, y: 48, w: PLOT_W, d: PLOT_H, rank: 2, accent: '#eab5c5', desc: '一块被踩得发亮的集市场。摊位、批发和外卖窗口都适合。' },
  { id: 'pasture', name: '牧草坡', theme: '牧场 / 巨兽', industry: '畜牧', x: 60, y: 48, w: PLOT_W, d: PLOT_H, rank: 3, accent: '#c6d98f', desc: '一整片开阔草坡，中间有一汪水。牛群先来，之后是谁就不好说了。' },
];

export const PLOT_BY_ID = Object.fromEntries(PLOTS.map((p) => [p.id, p]));
export const PLOT_GRID = [0, 1, 2, 3].map((row) => PLOTS.filter((p) => p.y === row * PLOT_H));
export const UNLOCK_RANKS = [1, 2, 3, 4, 5, 6, 8, 10];

export const TERRAIN_BUILDABLE = new Set(['grass', 'sand', 'coral', 'desert', 'plaza', 'snow', 'gravel']);
export const TERRAIN_NAME = {
  grass: '草地',
  sand: '沙地',
  coral: '白沙',
  desert: '沙漠',
  rock: '岩地',
  water: '水域',
  deep: '深海',
  plaza: '广场',
  snow: '雪原',
  ice: '冰面',
  gravel: '冰碛',
  crag: '冰岩',
  void: '边界',
};

// Deterministic scenery tables. PLOT_SCENERY overrides the generic SCENERY
// pool per plot; every entry is [build type, weight].
export const PLOT_SCENERY = {
  forest: [['pine', 9], ['oak', 5], ['birch', 4], ['bush', 4], ['rock', 3], ['logPile', 3], ['stumpStool', 2]],
  coast: [['palm', 6], ['bush', 3], ['rock', 3], ['flowers', 2], ['buoys', 2], ['netRack', 2], ['barrelFloat', 2]],
  deepsea: [['palm', 6], ['bush', 3], ['flowers', 2], ['rock', 2], ['abyssShell', 2], ['deadStall', 2], ['collapsedSlab', 1]],
  abyss: [['rock', 3], ['abyssRock', 5], ['abyssTentacle', 2], ['abyssShell', 2], ['duneRibs', 1]],
  // The icefield used to spawn plain oaks and pines on snow; the snow pine is
  // its own tree now, and the rest of the kit is ice and cairns.
  icefield: [['rock', 2], ['deadPine', 6], ['snowCairn', 3], ['iceBlocks', 3], ['iceSled', 1]],
  dino: [['rock', 4], ['cactus', 3], ['dryBush', 4], ['bones', 2], ['mesa', 2], ['acacia', 2], ['duneRibs', 3], ['duneSignpost', 2], ['desertWell', 1]],
  plain: [['oak', 2], ['bush', 2], ['flowers', 4], ['hayWagon', 2], ['pastureTrough', 2], ['logPile', 2]],
  harbor: [['palm', 4], ['crates', 2], ['bush', 2], ['flowers', 2], ['netRack', 3], ['fishCrates', 3], ['buoys', 2], ['mooringPosts', 2]],
  pasture: [['oak', 3], ['bush', 3], ['flowers', 4], ['pastureTrough', 3], ['hayWagon', 2], ['stumpStool', 2]],
  dune: [['rock', 2], ['cactus', 3], ['dryBush', 4], ['tumbleweed', 3], ['bones', 2], ['mesa', 2], ['acacia', 2], ['duneRibs', 3], ['desertWell', 2], ['duneSignpost', 2]],
  // The three town plots are paved districts, not wilderness — but they are also
  // the derelict ones. Their dressing is mostly what the town left behind:
  // broken columns, sunken slabs, a dead stall frame. A few civic pieces survive
  // intact (lamps, benches) because the story is that the town fell apart, not
  // that it was erased, and those survivors are what the player repairs around.
  plaza: [['lamp', 2], ['bench', 2], ['brokenPillar', 4], ['collapsedSlab', 4], ['deadStall', 2], ['pigeonPlinth', 2], ['flowers', 2]],
  market: [['lamp', 2], ['bench', 2], ['brokenPillar', 4], ['collapsedSlab', 4], ['deadStall', 3], ['marketScale', 1], ['crates', 2]],
  river: [['oak', 4], ['bush', 4], ['flowers', 3], ['rock', 2], ['mooringPosts', 3], ['barrelFloat', 2], ['waterPump', 2], ['logPile', 2]],
  dock: [['crates', 3], ['palm', 3], ['bush', 2], ['rock', 2], ['mooringPosts', 3], ['barrelFloat', 2], ['fishCrates', 2], ['netRack', 2]],
  farm: [['oak', 2], ['bush', 2], ['flowers', 3], ['waterPump', 3], ['seedSacks', 3], ['hayWagon', 2], ['stumpStool', 2]],
  south: [['oak', 2], ['bush', 2], ['flowers', 4], ['busStop', 2], ['mailboxCluster', 2], ['kiosk', 1], ['pigeonPlinth', 2]],
};

// Land a scenery type is allowed to grow on. Kept here rather than on every
// building so the wilderness rules read as one table instead of being smeared
// across ninety definitions. A type missing from this map is unrestricted.
//
// This is half of the "don't put it where it doesn't belong" contract. The
// seeder asks `mayGrow(type, terrain, plotId)` before it plants; the plot half
// lives in SCENERY_PLOTS below, because a snow pine on grass at the foot of the
// snowfield is just as wrong as one on a beach.
export const SCENERY_GROUND = {
  // Trees and shrubs follow their climate.
  oak: ['grass'],
  birch: ['grass'],
  pine: ['grass', 'snow', 'gravel'],
  palm: ['grass', 'sand', 'coral'],
  cactus: ['desert', 'sand'],
  acacia: ['desert', 'sand'],
  dryBush: ['desert', 'sand'],
  tumbleweed: ['desert', 'sand'],
  bush: ['grass', 'sand', 'coral'],
  flowers: ['grass', 'sand', 'coral'],
  // Rock formations only stand on bare ground.
  rock: ['grass', 'sand', 'desert', 'snow', 'gravel', 'coral'],
  mesa: ['desert', 'sand'],
  bones: ['desert', 'sand'],
  deadPine: ['snow', 'gravel'],
  // Town furniture needs a paved surface to belong to.
  lamp: ['grass', 'sand', 'plaza'],
  bench: ['grass', 'sand', 'plaza'],
  planter: ['grass', 'sand', 'plaza'],
  crates: ['grass', 'sand'],
  // Ruins sit on whatever the dereliction left: turf where the slabs were taken
  // up, coral on the cay's shore. Never on water.
  brokenPillar: ['grass', 'plaza', 'sand', 'coral'],
  collapsedSlab: ['grass', 'plaza', 'sand', 'coral'],
  deadStall: ['grass', 'plaza', 'sand', 'coral'],
};

// A prop also has to fit the PLOT's climate, not just its ground. The icefield
// keeps a band of open lawn along its south edge and the desert plots keep a
// grassy fringe, so a ground check alone still lets a snow pine stand on grass
// at the foot of the snowfield, or an acacia sit on a lawn in the dunes. This
// table says which plots may grow which piece of climate-bound scenery.
export const SCENERY_PLOTS = {
  deadPine: ['icefield', 'forest', 'plain'],
  snowCairn: ['icefield'],
  iceBlocks: ['icefield'],
  iceSled: ['icefield'],
  cactus: ['dune', 'dino'],
  acacia: ['dune', 'dino'],
  mesa: ['dune', 'dino'],
  bones: ['dune', 'dino'],
  dryBush: ['dune', 'dino'],
  tumbleweed: ['dune', 'dino'],
  duneRibs: ['dune', 'dino', 'abyss'],
  desertWell: ['dune', 'dino'],
  duneSignpost: ['dune', 'dino'],
  palm: ['coast', 'harbor', 'dock', 'deepsea'],
  abyssRock: ['abyss'],
  abyssTentacle: ['abyss'],
  abyssShell: ['abyss', 'deepsea'],
  netRack: ['harbor', 'coast', 'dock'],
  buoys: ['harbor', 'coast', 'dock'],
  fishCrates: ['harbor', 'coast', 'dock'],
  mooringPosts: ['harbor', 'coast', 'dock', 'river'],
  barrelFloat: ['harbor', 'coast', 'dock', 'river'],
  // Town furniture belongs to pavement, so it is only planted where the player
  // can actually build: a bus shelter in an untouched meadow is only clutter.
  clockPost: ['plaza', 'market', 'south'],
  kiosk: ['plaza', 'market', 'south'],
  pigeonPlinth: ['plaza', 'south'],
  marketBunting: ['plaza', 'market'],
  marketScale: ['market'],
  busStop: ['south'],
  mailboxCluster: ['south'],
  lamp: ['plaza', 'market', 'south'],
  bench: ['plaza', 'market', 'south'],
  planter: ['plaza', 'market', 'south'],
  // Ruins only make sense where something used to stand, so they are pinned to
  // the three derelict plots. Putting a broken column in a virgin meadow would
  // read as random rubble instead of history.
  brokenPillar: ['plaza', 'market'],
  collapsedSlab: ['plaza', 'market', 'deepsea'],
  deadStall: ['plaza', 'market', 'deepsea'],
};

// Plots the game opens derelict. The story is that the player comes home to a
// town that fell apart, so these three start paved-but-cracked with ruins on
// them, and the first thing the player does is clear ground to build on.
export const RUINED_PLOTS = new Set(['plaza', 'market', 'deepsea']);



// The starting town is data too: roads are filled rectangles, objects carry
// their variant/growth/rot options exactly as placeObject would receive them.
// The ruined bridgehead sits on the western map edge where the frozen
// meltwater stream drains the blue lake into the spruce wood. The site itself
// hugs the boundary; the bridge sprite reaches farther west and is clipped at
// the island edge, so the crossing reads as arriving from beyond the map.
// The eastern approach is where the town road arrives.
export const BRIDGE_SITE = { x: 0, y: 15, w: 4, d: 4 };

// The lagoon's sealed pilot well. It is a 3x3 click target dead centre of the
// atoll, and the 5x4 harbor is assembled around it: the upgrade rounds back to
// x=61, y=3, exactly the old fixed site.
export const ABYSS_WELLHEAD_SITE = { x: 62, y: 3, w: 3, d: 3 };

export const INITIAL_TIME_MIN = 8 * 60 + 20;
export const INITIAL_ROADS = [
  { x1: 23, y1: 57, x2: 45, y2: 57 },
  { x1: 29, y1: 58, x2: 30, y2: 63 },
];
export const INITIAL_OBJECTS = [
  { type: 'tollGate', x: 28, y: 62, opts: { variant: 0 } },
  { type: 'fryShack', x: 31, y: 56, opts: { variant: 0 } },
  { type: 'potatoField', x: 24, y: 55, opts: { growth: 0.82 } },
  { type: 'pond', x: 35, y: 50, opts: { variant: 1, natural: true } },
  { type: 'billboard', x: 24, y: 59, opts: { variant: 0, natural: true } },
  { type: 'lamp', x: 27, y: 58, opts: { variant: 0, natural: true } },
  { type: 'flowers', x: 33, y: 59, opts: { variant: 2, natural: true } },
  // The old festival plaza is now a sand waste; its centrepiece is a worm hole.
  { type: 'wormHole', x: 27, y: 21, opts: { variant: 0, natural: true } },
  // A permanent bone bed on the north edge of 恐龙谷. The paleo lab later
  // replaces it in place, so both share the same 8x5 footprint.
  { type: 'dinoGraveyard', x: 29, y: 2, opts: { variant: 0, natural: true } },
  // The permafrost cave in 冰原. The research station later replaces it in
  // place, so the 6x4 footprint must stay clear of roads and scenery.
  { type: 'mammothCave', x: 7, y: 3, opts: { variant: 0, natural: true } },
  // The ruined crossing over the frozen stream. The bridge later grows out of
  // it in place; its eastern approach and the ice under the span stay clear.
  { type: 'northBridgeSite', x: BRIDGE_SITE.x, y: BRIDGE_SITE.y, opts: { variant: 0, natural: true } },
  // The giant octopus coils in the north-east corner of 深渊海沟. Its lair is
  // on open deep water, well clear of the y16–19 abyss buffer and the resort.
  { type: 'giantOctopus', x: 71, y: 1, opts: { variant: 0, natural: true } },
  // The sealed pilot well sits dead centre of the atoll lagoon. The harbor is
  // built out of it in place, so both share the lagoon's water footprint.
  { type: 'abyssWellhead', x: ABYSS_WELLHEAD_SITE.x, y: ABYSS_WELLHEAD_SITE.y, opts: { variant: 0, natural: true } },
];
export const SCENERY_TARGET = 240;
export const SCENERY_TRIES = 5200;
export const SCENERY_KEEP_OPEN = { x1: 22, y1: 52, x2: 38, y2: 63 };
export const SCENERY_KEEP_OPEN_BRIDGE = { x1: 0, y1: 13, x2: 11, y2: 20 };
export const WORLD_SEED = 0xBEEF123;

// The far-fishing trawler anchors under the vortex, directly below the lair's
// 8x8 footprint, so the boat reads as moored at the octopus's feet. It is a
// runtime overlay, not an object: no save entry, no footprint.
export const OCTO_SHIP_BERTH = { x: 73, y: 9, w: 4, d: 2 };

// The harbor's jacket legs stand in the atoll lagoon. The site is fixed to the
// ring's centre so the SE downcomer stays directly over the floating hose.
export const ABYSS_HARBOR_SITE = { x: 61, y: 3, w: 5, d: 4 };

// 深渊食堂 sits on the west lip of the atoll: a grass/sand shore column, one
// column of stilts in the channel and one on the reef crest itself. The fixed
// site keeps the jetty pointing between the harbor and the octopus.
export const ABYSS_DINER_SITE = { x: 56, y: 1, w: 4, d: 3 };

// Floating hose from the platform's south downcomer, then one straight run
// along y=9.95 to the trawler's stern. Drawn only while the harbor is built,
// same as the boat.
export const OCTO_PIPE = { x: 65.35, y: 6.72, runY: 9.95, endX: 73.35 };
