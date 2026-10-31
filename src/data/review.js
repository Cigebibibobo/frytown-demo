// Review dimensions, level ladder and festival promotion rewards.

export const REVIEW_KEYS = [
  { key: 'taste', name: '口味', color: '#ef8a67', hint: '卖出薯条和汉堡' },
  { key: 'crowd', name: '人气', color: '#f0c98f', hint: '接待进镇的顾客' },
  { key: 'decor', name: '环境', color: '#a8dd8f', hint: '摆放树木与装饰' },
  { key: 'weird', name: '创意', color: '#91c8b8', hint: '收集奇怪菜单与建筑' },
];

export const REVIEW_DIMS = REVIEW_KEYS.map((k) => k.key);

export const REVIEWER_EVERY = 8;
export const REVIEWER_BONUS = 4;
export const REVIEWER_REVIEW = { taste: 1, crowd: 1, decor: 1, weird: 1 };

export const REVIEW_HALL_UNLOCK = 40;
export const REVIEW_LEVEL_REQ = [0, 40, 160, 400, 900, 1600, 2600, 4000, 6000, 8500];
export const MAX_LEVEL = 10;

export const FESTIVAL_PROMOTION_REVIEW = { taste: 2, crowd: 2, decor: 2, weird: 2 };

export const INITIAL_REVIEW = {
  taste: 0, crowd: 0, decor: 4, weird: 0, level: 1, festivals: 0, points: 4,
};
