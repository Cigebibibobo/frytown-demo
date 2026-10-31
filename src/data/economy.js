// Economy, storage and progression knobs. Every coin value, timers and
// per-day clock rate lives here so balancing never edits rules code.

export const STORAGE_BASE = 30;
export const STORAGE_PER_WAREHOUSE = 20;
export const ROAD_COST = 12;
export const PAVE_COST = 6;
// Every entry is a full road: customers path over it exactly like asphalt.
// Asphalt is stored as 1 so old saves and the starting town keep working.
export const ROAD_STYLES = [
  { id: 'asphalt', name: '柏油', short: '柏', color: '#5c6670', ground: '#3d444c', cost: ROAD_COST },
  { id: 'stone', name: '石板', short: '石', color: '#9a9c96', ground: '#6f736d', cost: 16 },
  { id: 'brick', name: '红砖', short: '砖', color: '#b06650', ground: '#7b4234', cost: 16 },
  { id: 'dirt', name: '土路', short: '土', color: '#a98455', ground: '#7a5e3c', cost: 8 },
  { id: 'plank', name: '木板', short: '木', color: '#b28350', ground: '#7d5834', cost: 14 },
];
// Wooden bridges are roads laid over fresh water. The river splits the west
// bank from the gate until Lv.6, so this is the only way guests reach it.
export const BRIDGE_COST = 80;
export const BRIDGE_LEVEL = 4;
export const BRIDGE_PLOTS = ['river', 'dock', 'farm'];
// A frozen lake takes a packed-snow track instead of a timber deck. It is still
// stored in state.roads, so pathfinding, access and demolition are unchanged.
export const ICE_ROAD_COST = 40;
export const GAME_MIN_PER_SEC = 1.5;
export const DAY_MINUTES = 24 * 60;
export const TOLL_FEE = 2;

// The north bridge is a second, slower stream of guests. Its fee is higher
// because every arrival has already walked the crossing.
export const NORTH_BRIDGE_TOLL = 4;
export const NORTH_BRIDGE_SPAWN_SCALE = 2.2;
export const NORTH_BRIDGE_COST = 9800;
export const NORTH_BRIDGE_BUILD_TIME = 1800;

// 炸浪湾 sits off the east coast with no road to it, so the ferry pier is the
// only way anyone gets there. Fewer, richer arrivals than the town gate.
export const RESORT_FERRY_TOLL = 6;
export const RESORT_FERRY_SPAWN_SCALE = 1.8;

export const REFUND_RATE = 0.25;
export const RESCUE_AFTER = 12;
export const RESCUE_COST_FALLBACK = 390;

export const FESTIVAL_COST = 300;
export const FESTIVAL_TIME = 180;
export const FESTIVAL_REWARD = 600;
export const FESTIVAL_TARGET_BASE = 8;
export const FESTIVAL_TARGET_PER_LEVEL = 4;

export const INITIAL_COINS = 900;

// Rewarded coin video, tuned against real build costs: one clip covers about
// half a same-level building, the priciest needs three, story landmarks 4-5.
export const AD_COIN_BY_LEVEL = [400, 400, 600, 650, 1000, 1100, 2400, 2500, 4000, 5000];

export const INITIAL_RESOURCES = {
  potato: 6, wheat: 0, egg: 0, chicken: 0, beef: 0, bun: 0, patty: 0, crayfish: 0, snail: 0,
  cactusFruit: 0, jujube: 0, wormMeat: 0, octoHorn: 0,
};
