// Customer flow, patience, queueing, stroll and spawn tuning.

export const CUSTOMER_TYPES = ['cyclops', 'blob', 'conehead', 'toast', 'mushroom', 'cactus', 'robot', 'ghost'];
export const CUSTOMER_MAX = 34;
export const CUSTOMER_SPEED = 1.15;
export const CUSTOMER_STEP_TIME = 0.22;

export const SPAWN_BASE = 6.4;
export const SPAWN_MIN = 2.6;
export const SPAWN_JITTER_MIN = 0.82;
export const SPAWN_JITTER_SPREAD = 0.36;
export const SPAWN_FESTIVAL_RATE = 0.42;
export const SPAWN_FESTIVAL_MIN_RATE = 0.5;
export const SPAWN_RETRY_ROAD = 1.4;
export const SPAWN_RETRY_BLOCKED = 3.5;
export const SPAWN_TICK_FALLBACK = 2;
export const SPAWN_FIRST_DELAY = 2.5;

export const QUEUE_MAX = 3;
export const PATIENCE_WALK = 34;
export const PATIENCE_QUEUE = 24;
export const PATIENCE_DRAIN = 1.8;

// Guests weigh every open shop with stock rather than always walking to the
// nearest one. Distance still pulls, but a random craving lets a farther shop
// win often enough that a street of shops all see traffic.
export const SHOP_DISTANCE_PULL = 0.05;
export const SHOP_QUEUE_PENALTY = 0.9;
export const SHOP_CRAVING_MIN = 0.45;
export const SHOP_CRAVING_SPREAD = 1.2;
export const SALE_TIMER_DECAY = 0.6;

// Served guests wander the nearest paving / plaza before heading home. The
// radius is path length, so a paved square beside the shop is enough.
export const STROLL_RADIUS = 8;
export const STROLL_WAIT_MIN = 1.6;
export const STROLL_WAIT_MAX = 3.8;
export const STROLL_SECOND_CHANCE = 0.35;
export const STROLL_LOOK_FIRST_MIN = 0.4;
export const STROLL_LOOK_FIRST_SPREAD = 0.6;
export const STROLL_LOOK_MIN = 0.7;
export const STROLL_LOOK_SPREAD = 0.8;
