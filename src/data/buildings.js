// Buildings, resources, categories, industry chains and default scenery.
// All costs, sizes, levels, build times, recipes and review rewards live here.

import {
  TOLL_FEE, NORTH_BRIDGE_TOLL, NORTH_BRIDGE_SPAWN_SCALE,
  NORTH_BRIDGE_COST, NORTH_BRIDGE_BUILD_TIME,
  RESORT_FERRY_TOLL, RESORT_FERRY_SPAWN_SCALE,
} from './economy.js';
import { REVIEW_HALL_UNLOCK } from './review.js';

export const RESOURCES = {
  potato: { name: '土豆', short: '土', color: '#e2b04a' },
  wheat: { name: '小麦', short: '麦', color: '#f0c98f' },
  egg: { name: '鸡蛋', short: '蛋', color: '#f2eedd' },
  chicken: { name: '鸡肉', short: '鸡', color: '#d8a06a' },
  beef: { name: '牛肉', short: '牛', color: '#ef8a67' },
  bun: { name: '面包', short: '包', color: '#e39a2f' },
  patty: { name: '肉饼', short: '饼', color: '#c27622' },
  sausage: { name: '香肠', short: '肠', color: '#c4654c' },
  crayfish: { name: '小龙虾', short: '虾', color: '#d9634b' },
  snail: { name: '田螺', short: '螺', color: '#a1c46b' },
  fish: { name: '鲜鱼', short: '鱼', color: '#7da3c9' },
  crab: { name: '海蟹', short: '蟹', color: '#d97a5a' },
  seafood: { name: '海鲜', short: '鲜', color: '#efb287' },
  milk: { name: '牛奶', short: '奶', color: '#f4f1e4' },
  cheese: { name: '奶酪', short: '酪', color: '#f0c94e' },
  cucumber: { name: '黄瓜', short: '瓜', color: '#7fae5a' },
  tomato: { name: '番茄', short: '茄', color: '#d9534f' },
  hops: { name: '啤酒花', short: '花', color: '#a7c76a' },
  beer: { name: '啤酒', short: '啤', color: '#e0a52e' },
  cactusFruit: { name: '仙人掌果', short: '仙', color: '#cf8bb0' },
  jujube: { name: '沙枣', short: '枣', color: '#b8433d' },
  wormMeat: { name: '蠕虫肉', short: '虫', color: '#c96b7a' },
  dinoMeat: { name: '恐龙肉', short: '恐', color: '#c2543a' },
  mammothMeat: { name: '猛犸肉', short: '猛', color: '#a85d3f' },
  octoHorn: { name: '巨大章鱼脚', short: '脚', color: '#d9c6a5' },
};

export const RES_ORDER = [
  'potato', 'wheat', 'egg', 'chicken', 'beef', 'bun', 'patty', 'sausage', 'crayfish', 'snail',
  'fish', 'crab', 'seafood', 'milk', 'cheese', 'cucumber', 'tomato', 'hops', 'beer',
  'cactusFruit', 'jujube', 'wormMeat', 'dinoMeat', 'mammothMeat', 'octoHorn',
];

export const CATEGORIES = [
  { id: 'grow', name: '种植', accent: '#c6d98f' },
  { id: 'raise', name: '畜牧', accent: '#e2b04a' },
  { id: 'process', name: '加工', accent: '#91c8b8' },
  { id: 'sell', name: '销售', accent: '#ef8a67' },
  { id: 'build', name: '基建', accent: '#7da3c9' },
  { id: 'decor', name: '景观', accent: '#eab5c5' },
];

// Chains are the content spine: one chain per ingredient route, with the
// review level that introduces it. Building defs carry the same chain id and
// their own level, so UI locks and docs cannot drift from the content table.
export const INDUSTRY_CHAINS = [
  {
    id: 'fries', name: '薯条', level: 1, accent: '#e2b04a',
    flow: '土豆田 → 薯条小摊', plots: ['south', 'farm'],
    stages: [
      { cat: 'grow', type: 'potatoField', label: '土豆' },
      { cat: 'sell', type: 'fryShack', label: '薯条' },
    ],
    note: '第一口生意：一块田、一个摊、一条路。',
  },
  {
    id: 'bread', name: '面包', level: 2, accent: '#f0c98f',
    flow: '小麦田 → 面包房 → 面包胚', plots: ['farm', 'market'],
    stages: [
      { cat: 'grow', type: 'wheatField', label: '小麦' },
      { cat: 'process', type: 'bakery', label: '面包胚' },
    ],
    note: '面包胚是汉堡的上层结构，也是第二条仓储压力。',
  },
  {
    id: 'poultry', name: '鸡蛋', level: 2, accent: '#f2eedd',
    flow: '鸡舍 → 鸡蛋', plots: ['farm', 'pasture'],
    stages: [
      { cat: 'raise', type: 'chickenFarmS', label: '蛋' },
      { cat: 'raise', type: 'chickenFarmM', label: '蛋' },
      { cat: 'raise', type: 'chickenFarmL', label: '蛋' },
    ],
    note: '鸡蛋直接进汉堡配方；三档鸡舍是产能升级，不是新配方。',
  },
  {
    id: 'friedChicken', name: '炸鸡', level: 2, accent: '#d8a06a',
    flow: '鸡舍 → 鸡肉 → 炸鸡铺 / 炸鸡店', plots: ['south', 'farm', 'market', 'plaza'],
    stages: [
      { cat: 'sell', type: 'friedChickenStand', label: '炸鸡' },
      { cat: 'sell', type: 'friedChickenShop', label: '炸鸡桶' },
    ],
    note: '鸡舍除了下蛋还出鸡肉：Lv.2 支起炸鸡铺，Lv.5 扩成炸鸡店。',
  },
  {
    id: 'beef', name: '牛肉', level: 3, accent: '#ef8a67',
    flow: '牛棚 → 牛肉 → 肉饼工厂 → 肉饼', plots: ['farm', 'market', 'pasture', 'river'],
    stages: [
      { cat: 'raise', type: 'cowFarmS', label: '牛肉' },
      { cat: 'raise', type: 'cowFarmM', label: '牛肉' },
      { cat: 'raise', type: 'cowFarmL', label: '牛肉' },
      { cat: 'process', type: 'pattyPlant', label: '肉饼' },
    ],
    note: '土豆混进肉饼，成本与怪趣都降不下来。',
  },
  {
    id: 'burger', name: '汉堡', level: 4, accent: '#d9634b',
    flow: '面包胚 + 肉饼 + 鸡蛋 → 汉堡', plots: ['plaza', 'market'],
    stages: [{ cat: 'sell', type: 'burgerStand', label: '汉堡' }],
    note: '首个三段式配方，检验前面三条供应线。',
  },
  {
    id: 'freshwater', name: '河鲜', level: 4, accent: '#61aaa0',
    flow: '小龙虾笼 + 田螺筏 → 小龙虾馆 / 螺蛳粉店', plots: ['river', 'dock', 'farm'],
    stages: [
      { cat: 'raise', type: 'crayfishTrap', label: '小龙虾' },
      { cat: 'raise', type: 'snailRaft', label: '田螺' },
      { cat: 'sell', type: 'crayfishHouse', label: '麻辣小龙虾' },
      { cat: 'sell', type: 'luosifenShop', label: '螺蛳粉' },
    ],
    note: '河湾一开就下水：虾笼配小龙虾馆，螺筏配螺蛳粉店，各做各的招牌。',
  },
  {
    id: 'hotdog', name: '热狗', level: 3, accent: '#c4654c',
    flow: '香肠工坊 → 热狗车', plots: ['farm', 'market', 'south', 'plaza'],
    stages: [
      { cat: 'process', type: 'sausageWorks', label: '香肠' },
      { cat: 'sell', type: 'hotdogCart', label: '热狗' },
    ],
    note: '牛肉和小麦先灌成香肠，再夹进面包胚；便宜、快、翻台高。',
  },
  {
    id: 'cheese', name: '奶酪', level: 5, accent: '#f0c94e',
    flow: '奶牛棚 → 牛奶 → 奶酪坊 → 奶酪', plots: ['farm', 'pasture', 'market'],
    stages: [
      { cat: 'raise', type: 'dairyBarn', label: '牛奶' },
      { cat: 'process', type: 'cheeseHouse', label: '奶酪' },
    ],
    note: 'Lv.5 备料链：牛奶不单卖，压成奶酪留给 Lv.6 熟食与 Lv.7 披萨。',
  },
  {
    id: 'combo', name: '套餐', level: 6, accent: '#eab5c5',
    flow: '双份汉堡 → 公路餐厅套餐', plots: ['plaza', 'market'],
    stages: [{ cat: 'sell', type: 'diner', label: '双人套餐' }],
    note: '一次卖两份，排队效率决定翻台。',
  },
  {
    id: 'mammoth', name: '猛犸', level: 6, accent: '#8fb8b0',
    flow: '猛犸洞窟 → 永冻土研究所 → 猛犸牧场 → 猛犸主题餐厅', plots: ['icefield'],
    stages: [
      { cat: 'raise', type: 'mammothRanch', label: '猛犸肉' },
      { cat: 'sell', type: 'mammothDiner', label: '猛犸套餐' },
    ],
    note: '冻土研究完工才开得了牧场；10×8 兽栏不限地块，每 20 秒产 3 份猛犸肉。主题餐厅只开在冰原，把肉、土豆和奶酪做成套餐。',
  },
  {
    id: 'resort', name: '度假村', level: 8, accent: '#42b3a6',
    flow: '渡轮码头 → 沙滩烧烤 / 灯塔酒店（摩天轮与泳池抬评分）', plots: ['deepsea'],
    stages: [
      { cat: 'build', type: 'ferryPier', label: '渡轮' },
      { cat: 'sell', type: 'beachGrill', label: '烤串' },
      { cat: 'sell', type: 'lighthouseHotel', label: '海景晚餐' },
      { cat: 'build', type: 'ferrisWheel', label: '观景' },
    ],
    note: '白沙湾没有陆路，只有渡轮上岛：码头东侧接一格路才有客人。两家店吃现有的肉饼 / 土豆和海鲜 / 啤酒 / 奶酪；泳池、摩天轮与南岬灯塔只抬评分，不带金币收入。',
  },
  {
    id: 'deli', name: '熟食', level: 6, accent: '#7fae5a',
    flow: '温室菜园 → 黄瓜 / 番茄 + 奶酪 → 熟食店', plots: ['farm', 'pasture', 'market'],
    stages: [
      { cat: 'grow', type: 'greenhouse', label: '黄瓜 / 番茄' },
      { cat: 'sell', type: 'deliShop', label: '熟食拼盘' },
    ],
    note: 'Lv.5 囤下的奶酪终于有买家：五样原料拼一盘，汉堡的配菜单飞了。',
  },
  {
    id: 'beer', name: '啤酒', level: 7, accent: '#e0a52e',
    flow: '啤酒花田 → 酿酒厂 → 啤酒馆（给附近餐馆上微醺）', plots: ['farm', 'market', 'plaza'],
    stages: [
      { cat: 'grow', type: 'hopsField', label: '啤酒花' },
      { cat: 'process', type: 'brewery', label: '啤酒' },
      { cat: 'sell', type: 'beerHall', label: '微醺光环' },
    ],
    note: '啤酒馆自己不卖酒：它把附近的餐馆喂成微醺，出餐更快、客单价更高。',
  },
  {
    id: 'seafood', name: '海鲜', level: 5, accent: '#61aaa0',
    flow: '渔船 + 蟹笼 → 海鲜加工厂 → 海鲜摊', plots: ['harbor', 'coast', 'dock'],
    stages: [
      { cat: 'raise', type: 'fishingBoat', label: '鲜鱼' },
      { cat: 'raise', type: 'crabTrap', label: '海蟹' },
      { cat: 'process', type: 'seafoodPlant', label: '海鲜' },
      { cat: 'sell', type: 'seafoodStall', label: '炸海鲜拼盘' },
    ],
    note: '海水终于能下水：渔船和蟹笼各捞各的，加工厂把它们装成海鲜箱，再进油锅。',
  },
  {
    id: 'pizza', name: '披萨', level: 7, accent: '#d9534f',
    flow: '小麦 + 奶酪 + 番茄 → 披萨窑', plots: ['market', 'plaza', 'farm'],
    stages: [{ cat: 'sell', type: 'pizzaOven', label: '披萨' }],
    note: '双份小麦撑起饼底，奶酪和番茄负责拉丝；三格宽的窑口不怕排队。',
  },
  {
    id: 'desert', name: '沙地种植', level: 6, accent: '#d8a25e',
    flow: '仙人掌果田 → 仙人掌冰室；Lv.8 沙枣田备料', plots: ['dune', 'dino'],
    stages: [
      { cat: 'grow', type: 'cactusField', label: '仙人掌果' },
      { cat: 'sell', type: 'cactusCafe', label: '仙人掌冰饮' },
      { cat: 'grow', type: 'jujubeField', label: '沙枣' },
    ],
    note: 'Lv.6 荒原开放就能卖冰饮；Lv.8 再种沙枣，为 Lv.9 沙丘烤肉备料。',
  },
  {
    id: 'worm', name: '蠕虫', level: 9, accent: '#c96b7a',
    flow: '点击蠕虫洞 → 蠕虫肉采集场 → 沙丘烤肉 / 蠕虫汉堡', plots: ['dune', 'dino'],
    stages: [
      { cat: 'raise', type: 'wormFarm', label: '蠕虫肉' },
      { cat: 'sell', type: 'duneGrill', label: '沙丘烤肉' },
      { cat: 'sell', type: 'wormBurger', label: '蠕虫汉堡' },
    ],
    note: '洞口改造出 10×10 采集场；每 26 秒钻回结算一次，肉只够一条线满载。',
  },
  {
    id: 'signature', name: '招牌汉堡', level: 9, accent: '#e2b04a',
    flow: '面包胚 + 肉饼 + 蛋 + 奶酪 + 黄瓜 + 番茄 → 快餐城', plots: ['plaza', 'market'],
    stages: [{ cat: 'sell', type: 'signatureBurger', label: '快餐城' }],
    note: '招牌汉堡要用六样食材。',
  },
  {
    id: 'dino', name: '恐龙', level: 10, accent: '#c2543a',
    flow: '研究所 → 白垩纪牧场（恐龙肉 + 观光）→ 白垩纪餐厅',
    plots: ['dino', 'dune'],
    stages: [
      { cat: 'raise', type: 'dinoRanch', label: '恐龙肉 / 观光' },
      { cat: 'sell', type: 'cretaceousDiner', label: '白垩纪套餐' },
    ],
    note: '研究完工才能建牧场（牧场不限地块）；牧场一边卖观光团，一边蜕下恐龙肉，餐厅再把肉做成套餐。',
  },
  {
    id: 'abyss', name: '章鱼', level: 10, accent: '#325a95',
    flow: '远海 → 远航海港 → 海边食堂',
    plots: ['abyss', 'plain'],
    stages: [
      { cat: 'build', type: 'deepSeaHarbor', label: '章鱼脚' },
      { cat: 'sell', type: 'abyssDiner', label: '炭烤章鱼脚' },
    ],
    note: '远海只有深水，远航海港不用通路。完工后捕捞舰停在涡流旁，每 60 秒取回一条巨大章鱼脚；北原东岸的海边食堂把脚做成现烤套餐。',
  },
];

// Every announced route has shipped. Keep the table so a future line can be
// scheduled without showing phantom cards in the build drawer.
export const PLANNED_CHAINS = [];

// kind: field | production | food | gate | review | service | decor | nature
export const BUILD_DEFS = {
  potatoField: {
    name: '土豆田', cat: 'grow', kind: 'field', w: 2, d: 2, cost: 130, level: 1, chain: 'fries',
    crop: 'potato', grow: 30, yield: 4, res: 'potato', buildTime: 15,
    desc: '种些土豆，收了拿去炸薯条。不用接路，熟了自动入库。',
  },
  wheatField: {
    name: '小麦田', cat: 'grow', kind: 'field', w: 2, d: 2, cost: 160, level: 2, chain: 'bread',
    crop: 'wheat', grow: 34, yield: 4, res: 'wheat', buildTime: 120,
    desc: '麦子熟了会自动收进仓库，面包房用得上。',
  },
  greenhouse: {
    name: '温室菜园', cat: 'grow', kind: 'production', w: 3, d: 3, cost: 620, level: 6, chain: 'deli',
    sprite: 'greenhouse', variants: 1, needsRoad: true, buildTime: 660,
    prod: { out: { cucumber: 2, tomato: 2 }, time: 22 },
    desc: '棚里种黄瓜和番茄，给店里添点新鲜菜。记得接路。',
  },
  chickenFarmS: {
    name: '小鸡舍', cat: 'raise', kind: 'production', w: 2, d: 2, cost: 480, level: 2, chain: 'poultry',
    sprite: 'chickenFarm1', variants: 1, needsRoad: true, livestock: 'chicken', animals: 2, buildTime: 180,
    animalBounds: { x: 0.3, y: 1.06, w: 1.4, d: 0.8 },
    prod: { out: { egg: 2, chicken: 1 }, time: 14 },
    desc: '先从一个小院养起。接上路，就能供应鸡蛋和鸡肉。',
  },
  chickenFarmM: {
    name: '鸡舍', cat: 'raise', kind: 'production', w: 4, d: 4, cost: 900, level: 4, chain: 'poultry',
    sprite: 'chickenFarm2', variants: 1, needsRoad: true, livestock: 'chicken', animals: 4, buildTime: 540,
    animalBounds: { x: 0.4, y: 1.85, w: 3.2, d: 1.7 },
    prod: { out: { egg: 2, chicken: 1 }, time: 10 },
    desc: '院子宽敞了，鸡蛋和鸡肉也比小鸡舍出得快。',
  },
  chickenFarmL: {
    name: '鸡场·工厂', cat: 'raise', kind: 'production', w: 4, d: 8, cost: 2100, level: 6, chain: 'poultry',
    sprite: 'chickenFarm3', variants: 1, needsRoad: true, livestock: 'chicken', animals: 6, buildTime: 1020,
    animalBounds: { x: 0.85, y: 5.4, w: 2.85, d: 2.3 },
    prod: { out: { egg: 3, chicken: 2 }, time: 7 },
    desc: '成批供应鸡蛋和鸡肉的大鸡场，占地也大。',
  },
  friedChickenStand: {
    name: '炸鸡铺', cat: 'sell', kind: 'food', w: 2, d: 2, cost: 620, level: 2, chain: 'friedChicken',
    sprite: 'friedChickenStand', variants: 1, needsRoad: true, buildTime: 240,
    sale: { in: { chicken: 1, wheat: 1 }, coins: 8, time: 8, label: '炸鸡', stat: 'friedChickenSold', units: 1, taste: 3, weird: 1 },
    desc: '鸡肉裹好面，下锅现炸。小铺子先卖单份。',
  },
  friedChickenShop: {
    name: '炸鸡店', cat: 'sell', kind: 'food', w: 3, d: 2, cost: 1780, level: 5, chain: 'friedChicken',
    sprite: 'friedChickenShop', variants: 1, needsRoad: true, buildTime: 780,
    sale: { in: { chicken: 2, wheat: 1 }, coins: 16, time: 10, label: '炸鸡桶', stat: 'friedChickenSold', units: 2, taste: 4, weird: 2 },
    desc: '炸鸡改用桶装，一桶有两份。',
  },
  cowFarmS: {    name: '简易牛棚', cat: 'raise', kind: 'production', w: 2, d: 2, cost: 910, level: 3, chain: 'beef',
    sprite: 'cowFarm1', variants: 1, needsRoad: true, livestock: 'cow', animals: 1, buildTime: 360,
    animalBounds: { x: 0.28, y: 1.02, w: 1.44, d: 0.86 },
    prod: { out: { beef: 2 }, time: 18 },
    desc: '搭个棚子养牛，给肉饼工厂供应牛肉。',
  },
  cowFarmM: {
    name: '牛舍', cat: 'raise', kind: 'production', w: 4, d: 4, cost: 1610, level: 6, chain: 'beef',
    sprite: 'cowFarm2', variants: 1, needsRoad: true, livestock: 'cow', animals: 2, buildTime: 900,
    animalBounds: { x: 0.36, y: 1.95, w: 3.24, d: 1.62 },
    prod: { out: { beef: 2 }, time: 13 },
    desc: '带院子的牛舍，牛肉供应比简易牛棚快一些。',
  },
  dairyBarn: {
    name: '奶牛棚', cat: 'raise', kind: 'production', w: 3, d: 3, cost: 1150, level: 5, chain: 'cheese',
    sprite: 'dairyBarn', variants: 1, needsRoad: true, livestock: 'cow', animals: 2, buildTime: 720,
    animalBounds: { x: 0.35, y: 1.95, w: 2.3, d: 0.9 },
    prod: { out: { milk: 3 }, time: 15 },
    desc: '这里养的是奶牛，只产牛奶，不产牛肉。',
  },
  cowFarmL: {
    name: '牛场·工厂', cat: 'raise', kind: 'production', w: 4, d: 8, cost: 3410, level: 8, chain: 'beef',
    sprite: 'cowFarm3', variants: 1, needsRoad: true, livestock: 'cow', animals: 4, buildTime: 1320,
    animalBounds: { x: 1.7, y: 5.45, w: 1.95, d: 2.2 },
    prod: { out: { beef: 3 }, time: 9 },
    desc: '料塔和牛棚连在一起，牛肉出得更快了。',
  },
  bakery: {
    name: '面包房', cat: 'process', kind: 'production', w: 2, d: 2, cost: 590, level: 2, chain: 'bread',
    sprite: 'bakery', variants: 2, needsRoad: true, buildTime: 240,
    prod: { in: { wheat: 2 }, out: { bun: 1 }, time: 9 },
    desc: '把小麦烤成面包胚，汉堡和热狗都少不了它。',
  },
  pattyPlant: {
    name: '肉饼工厂', cat: 'process', kind: 'production', w: 2, d: 2, cost: 980, level: 3, chain: 'beef',
    sprite: 'pattyPlant', variants: 2, needsRoad: true, buildTime: 480,
    prod: { in: { beef: 1, potato: 1 }, out: { patty: 2 }, time: 11 },
    desc: '牛肉加土豆，压成一块块汉堡肉饼。',
  },
  warehouse: {
    name: '冷库', cat: 'build', kind: 'service', w: 2, d: 2, cost: 520, level: 2,
    sprite: 'warehouse', variants: 2, needsRoad: true, storage: 20, buildTime: 120,
    desc: '接上路后，每种食材都能多存 20 份。多建几座可以叠加。',
  },
  reviewHall: {
    name: '评分大厅', cat: 'build', kind: 'review', w: 4, d: 4, cost: 800, level: 1,
    sprite: 'reviewHall', variants: 1, needsRoad: true, unique: true, buildTime: 60,
    unlockPoints: REVIEW_HALL_UNLOCK,
    desc: '美食节在这里办。先看看评分和准备清单，条件齐了就能报名升级。',
  },
  burgerStand: {
    name: '汉堡摊', cat: 'sell', kind: 'food', w: 2, d: 2, cost: 1170, level: 4, chain: 'burger',
    sprite: 'burgerStand', variants: 2, needsRoad: true, buildTime: 600,
    sale: { in: { bun: 1, patty: 1, egg: 1 }, coins: 9, time: 8, label: '汉堡', stat: 'burgersSold', units: 1, taste: 3, weird: 1 },
    desc: '肉饼加煎蛋，夹进面包里。客人来了再做。',
  },
  crayfishTrap: {
    name: '小龙虾笼', cat: 'raise', kind: 'production', w: 2, d: 2, cost: 520, level: 4, chain: 'freshwater',
    sprite: 'crayfishTrap', variants: 1, terrain: ['water'], buildTime: 600,
    prod: { out: { crayfish: 2 }, time: 16 },
    desc: '放在水里收小龙虾，不用接路。',
  },
  snailRaft: {
    name: '田螺筏', cat: 'raise', kind: 'production', w: 2, d: 2, cost: 480, level: 4, chain: 'freshwater',
    sprite: 'snailRaft', variants: 1, terrain: ['water'], buildTime: 600,
    prod: { out: { snail: 2 }, time: 18 },
    desc: '筏下挂着螺篓，收来的田螺直接入库。放水上就行，不用接路。',
  },
  fishingBoat: {
    name: '渔船', cat: 'raise', kind: 'production', w: 2, d: 2, cost: 1450, level: 5, chain: 'seafood',
    sprite: 'fishingBoat', variants: 1, terrain: ['water'], buildTime: 600,
    prod: { out: { fish: 2 }, time: 18 },
    desc: '找片水面放下渔船，鲜鱼会自动送进仓库，不用接路。',
  },
  crabTrap: {
    name: '蟹笼', cat: 'raise', kind: 'production', w: 2, d: 2, cost: 1180, level: 5, chain: 'seafood',
    sprite: 'crabTrap', variants: 1, terrain: ['water'], buildTime: 600,
    prod: { out: { crab: 2 }, time: 20 },
    desc: '浮标下面挂着蟹笼，专收海蟹。要放在水上，不用接路。',
  },
  crayfishHouse: {
    name: '小龙虾馆', cat: 'sell', kind: 'food', w: 2, d: 2, cost: 1120, level: 4, chain: 'freshwater',
    sprite: 'crayfishHouse', variants: 1, needsRoad: true, buildTime: 600,
    sale: { in: { crayfish: 2, potato: 1 }, coins: 15, time: 9, label: '麻辣小龙虾', stat: 'crayfishSold', units: 1, taste: 3, weird: 2 },
    desc: '一盆麻辣小龙虾，里面还垫着土豆。',
  },
  luosifenShop: {
    name: '螺蛳粉店', cat: 'sell', kind: 'food', w: 2, d: 2, cost: 1180, level: 4, chain: 'freshwater',
    sprite: 'luosifenShop', variants: 1, needsRoad: true, buildTime: 600,
    sale: { in: { snail: 2, wheat: 1 }, coins: 15, time: 10, label: '螺蛳粉', stat: 'luosifenSold', units: 1, taste: 3, weird: 2 },
    desc: '一碗热螺蛳粉，路过就能闻见味儿。',
  },
  sausageWorks: {
    name: '香肠工坊', cat: 'process', kind: 'production', w: 2, d: 2, cost: 980, level: 3, chain: 'hotdog',
    sprite: 'sausageWorks', variants: 1, needsRoad: true, buildTime: 480,
    prod: { in: { beef: 1, wheat: 1 }, out: { sausage: 2 }, time: 10 },
    desc: '把牛肉和小麦做成香肠，备着卖热狗。',
  },
  hotdogCart: {
    name: '热狗车', cat: 'sell', kind: 'food', w: 2, d: 1, cost: 1050, level: 3, chain: 'hotdog',
    sprite: 'hotdogCart', variants: 1, needsRoad: true, buildTime: 480,
    sale: { in: { bun: 1, sausage: 1 }, coins: 6, time: 6, label: '热狗', stat: 'hotdogsSold', units: 1, taste: 2, weird: 1 },
    desc: '路边摆个小车，面包夹上香肠就能卖。',
  },
  cheeseHouse: {
    name: '奶酪坊', cat: 'process', kind: 'production', w: 2, d: 2, cost: 980, level: 5, chain: 'cheese',
    sprite: 'cheeseHouse', variants: 1, needsRoad: true, buildTime: 660,
    prod: { in: { milk: 2 }, out: { cheese: 1 }, time: 10 },
    desc: '用牛奶做奶酪，披萨和不少套餐都要用。',
  },
  hopsField: {
    name: '啤酒花田', cat: 'grow', kind: 'field', w: 2, d: 2, cost: 240, level: 7, chain: 'beer',
    crop: 'hops', grow: 32, yield: 4, res: 'hops', buildTime: 540,
    desc: '架上种的是啤酒花，收了留给酿酒厂。',
  },
  cactusField: {
    name: '仙人掌果田', cat: 'grow', kind: 'field', w: 2, d: 2, cost: 260, level: 6, chain: 'desert',
    crop: 'cactusFruit', grow: 32, yield: 4, res: 'cactusFruit', buildTime: 480,
    desc: '仙人掌也能结果子，摘下来可以做冰饮。熟了自动收，不用接路。',
  },
  jujubeField: {
    name: '沙枣田', cat: 'grow', kind: 'field', w: 2, d: 2, cost: 280, level: 8, chain: 'desert',
    crop: 'jujube', grow: 36, yield: 4, res: 'jujube', buildTime: 600,
    desc: '一片沙枣树，果子熟了自动入库，留着配烤肉。',
  },
  brewery: {
    name: '酿酒厂', cat: 'process', kind: 'production', w: 3, d: 3, cost: 1500, level: 7, chain: 'beer',
    sprite: 'brewery', variants: 1, needsRoad: true, buildTime: 840,
    prod: { in: { hops: 2, wheat: 1 }, out: { beer: 2 }, time: 10 },
    desc: '用小麦和啤酒花酿酒，酿好一桶桶入库。',
  },
  seafoodPlant: {
    name: '海鲜加工厂', cat: 'process', kind: 'production', w: 3, d: 3, cost: 2380, level: 5, chain: 'seafood',
    sprite: 'seafoodPlant', variants: 1, needsRoad: true, buildTime: 840,
    prod: { in: { fish: 1, crab: 1 }, out: { seafood: 2 }, time: 12 },
    desc: '把鲜鱼和海蟹处理好，装箱送给餐馆。',
  },
  beerHall: {
    name: '啤酒馆', cat: 'sell', kind: 'service', w: 3, d: 3, cost: 1680, level: 7, chain: 'beer',
    sprite: 'beerHall', variants: 1, needsRoad: true, unique: true, buildTime: 960,
    buff: { radius: 5, beer: 1, interval: 12, duration: 24, coins: 0.2, time: 0.15, label: '微醺' },
    desc: '不直接卖酒赚钱。有啤酒供应时，附近餐馆售价提高 20%，出餐时间缩短 15%。',
  },
  fryShack: {
    name: '薯条小摊', cat: 'sell', kind: 'food', w: 2, d: 1, cost: 390, level: 1, chain: 'fries',
    sprite: 'friesStall', variants: 2, needsRoad: true, buildTime: 30,
    sale: { in: { potato: 1 }, coins: 3, time: 6, label: '薯条', stat: 'friesSold', units: 1, taste: 1, weird: 0 },
    desc: '土豆切条下锅，炸好了趁热卖。',
  },
  diner: {
    name: '公路餐厅', cat: 'sell', kind: 'food', w: 3, d: 3, cost: 2470, level: 6, chain: 'combo',
    sprite: 'diner', variants: 2, needsRoad: true, buildTime: 840,
    sale: { in: { bun: 2, patty: 2, egg: 1 }, coins: 25, time: 10, label: '双人套餐', stat: 'burgersSold', units: 2, taste: 4, weird: 2 },
    desc: '路边的汉堡餐厅，主卖双人套餐，一份装两个汉堡。',
  },
  deliShop: {
    name: '熟食店', cat: 'sell', kind: 'food', w: 2, d: 2, cost: 1980, level: 6, chain: 'deli',
    sprite: 'deliShop', variants: 1, needsRoad: true, buildTime: 720,
    sale: { in: { bun: 1, cheese: 1, cucumber: 1, tomato: 1, egg: 1 }, coins: 18, time: 10, label: '熟食拼盘', stat: 'deliSold', units: 1, taste: 4, weird: 3 },
    desc: '面包配上奶酪、蛋和蔬菜，装成一盘卖。',
  },
  pizzaOven: {
    name: '披萨窑', cat: 'sell', kind: 'food', w: 3, d: 3, cost: 2650, level: 7, chain: 'pizza',
    sprite: 'pizzaOven', variants: 1, needsRoad: true, buildTime: 900,
    sale: { in: { wheat: 2, cheese: 1, tomato: 1 }, coins: 22, time: 12, label: '披萨', stat: 'pizzasSold', units: 1, taste: 4, weird: 2 },
    desc: '番茄和奶酪铺上饼底，送进砖窑烤。',
  },
  cactusCafe: {
    name: '仙人掌冰室', cat: 'sell', kind: 'food', w: 2, d: 2, cost: 2180, level: 6, chain: 'desert',
    sprite: 'cactusCafe', variants: 1, needsRoad: true, buildTime: 720,
    sale: { in: { cactusFruit: 2, wheat: 1 }, coins: 10, time: 8, label: '仙人掌冰饮', stat: 'cactusSold', units: 1, taste: 2, weird: 2 },
    desc: '卖仙人掌果做的冰饮，逛热了来一杯。',
  },
  seafoodStall: {
    name: '海鲜摊', cat: 'sell', kind: 'food', w: 3, d: 2, cost: 2960, level: 5, chain: 'seafood',
    sprite: 'seafoodStall', variants: 1, needsRoad: true, buildTime: 780,
    sale: { in: { seafood: 2, potato: 1 }, coins: 23, time: 10, label: '炸海鲜拼盘', stat: 'seafoodSold', units: 1, taste: 4, weird: 2 },
    desc: '海鲜配土豆，现炸一大盘。先备好加工厂送来的海鲜。',
  },
  wormFarm: {
    name: '蠕虫肉采集场', cat: 'raise', kind: 'production', w: 10, d: 10, cost: 4200, level: 9, chain: 'worm',
    sprite: 'wormFarm', variants: 1, hidden: true, unremovable: true, unique: true,
    buildTime: 1800, terrain: ['desert', 'sand', 'grass'], harvest: 2,
    desc: '在蠕虫洞上改建。等蠕虫钻回地下，就能收一批肉，不用接路。',
  },
  duneGrill: {
    name: '沙丘烤肉', cat: 'sell', kind: 'food', w: 3, d: 3, cost: 3400, level: 9, chain: 'worm',
    sprite: 'duneGrill', variants: 1, needsRoad: true, buildTime: 1020,
    sale: { in: { wormMeat: 1, jujube: 1 }, coins: 19, time: 12, label: '沙丘烤肉', stat: 'duneGrillSold', units: 1, taste: 3, weird: 2 },
    desc: '蠕虫肉串上沙枣，放炭火上烤。',
  },
  wormBurger: {
    name: '蠕虫汉堡店', cat: 'sell', kind: 'food', w: 2, d: 2, cost: 3600, level: 9, chain: 'worm',
    sprite: 'wormBurger', variants: 1, needsRoad: true, buildTime: 960,
    sale: { in: { bun: 1, wormMeat: 1, cactusFruit: 1 }, coins: 21, time: 10, label: '蠕虫汉堡', stat: 'wormBurgersSold', units: 1, taste: 4, weird: 4 },
    desc: '把牛肉换成蠕虫肉，再抹点仙人掌果酱。',
  },
  dinoGraveyard: {
    name: '恐龙墓场', cat: 'decor', kind: 'nature', w: 8, d: 5, cost: 0, level: 8,
    sprite: 'dinoGraveyard', variants: 1, hidden: true, unremovable: true,
    desc: '沙里露出一大副恐龙骨架，可以在这里建古生物研究所。',
  },
  mammothCave: {
    name: '猛犸洞窟', cat: 'decor', kind: 'nature', w: 6, d: 4, cost: 0, level: 6,
    sprite: 'mammothCave', variants: 1, hidden: true, unremovable: true,
    desc: '雪里露出了猛犸象牙。在洞口建座研究所，看看还能找到什么。',
  },
  permafrostLab: {
    name: '永冻土研究所', cat: 'build', kind: 'research', w: 8, d: 5, cost: 4200, level: 6,
    sprite: 'permafrostLab', variants: 1, hidden: true, unremovable: true, unique: true, buildTime: 1200,
    desc: '在猛犸洞窟旁做研究。建成就算完成研究，不用另外等。',
  },
  mammothRanch: {
    name: '猛犸牧场', cat: 'raise', kind: 'production', w: 10, d: 8, cost: 7200, level: 7, chain: 'mammoth',
    sprite: 'mammothRanch', variants: 1, needsRoad: true, buildTime: 1200,
    // The raised snow pad can bridge the frozen lakes at the lab apron.
    terrain: ['grass', 'sand', 'desert', 'plaza', 'snow', 'gravel', 'ice'],
    requireFlag: 'mammothResearch', requireFlagReason: '先在猛犸洞窟建成永冻土研究所',
    meat: { res: 'mammothMeat', amount: 3, time: 20 },
    desc: '养长毛象的大牧场，定时供应猛犸肉。先留出一大块空地。',
  },
  mammothDiner: {
    name: '猛犸主题餐厅', cat: 'sell', kind: 'food', w: 3, d: 4, cost: 3600, level: 7, chain: 'mammoth',
    sprite: 'mammothDiner', variants: 1, needsRoad: true, buildTime: 1020,
    sale: {
      in: { mammothMeat: 2, potato: 2, cheese: 1 },
      coins: 26, time: 13, label: '猛犸套餐', stat: 'mammothSold', units: 1, taste: 5, weird: 4,
    },
    desc: '门口挂着象牙，店里卖猛犸套餐，配土豆和奶酪。',
  },
  ferryPier: {
    name: '渡轮码头', cat: 'build', kind: 'gate', w: 4, d: 3, cost: 3600, level: 8, chain: 'resort',
    sprite: 'ferryPier', variants: 1, unique: true,
    plots: ['deepsea'], buildTime: 1020, toll: RESORT_FERRY_TOLL,
    entrance: {
      driveway: 'east',
      roadPassage: false,
      spawnScale: RESORT_FERRY_SPAWN_SCALE,
      drivewayHint: '码头东侧未接路 · 在码头东面铺一格路，接上岛上的步道',
      openLabel: '渡轮通航',
    },
    desc: '把客人接到白沙湾，船票每人 6 块。码头东侧要接上岛上的路。',
  },
  beachGrill: {
    name: '沙滩烧烤', cat: 'sell', kind: 'food', w: 3, d: 3, cost: 3200, level: 8, chain: 'resort',
    sprite: 'beachGrill', variants: 1, needsRoad: true, buildTime: 900,
    sale: {
      in: { patty: 2, potato: 1 },
      coins: 17, time: 9, label: '沙滩烤串', stat: 'beachGrillSold', units: 1, taste: 3, weird: 2,
    },
    desc: '支起烤炉，把肉饼和土豆烤成串。',
  },
  lighthouseHotel: {
    name: '灯塔酒店', cat: 'sell', kind: 'food', w: 5, d: 4, cost: 6800, level: 8, chain: 'resort',
    sprite: 'lighthouseHotel', variants: 1, needsRoad: true, buildTime: 1380,
    sale: {
      in: { seafood: 2, beer: 1, cheese: 1 },
      coins: 34, time: 14, label: '海景晚餐', stat: 'resortDinnerSold', units: 1, taste: 6, weird: 2,
    },
    buildReview: { crowd: 3, decor: 2 },
    desc: '带灯塔的海边酒店，靠供应海景晚餐赚钱。海鲜、啤酒和奶酪都得备上。',
  },
  infinityPool: {
    name: '无边泳池', cat: 'build', kind: 'attraction', w: 4, d: 3, cost: 4200, level: 8, chain: 'resort',
    sprite: 'infinityPool', variants: 1, buildTime: 1080,
    buildReview: { decor: 6, crowd: 2 },
    desc: '池边望出去就是海。建好能增加评分，不收门票。',
  },
  ferrisWheel: {
    name: '观景摩天轮', cat: 'build', kind: 'attraction', w: 4, d: 3, cost: 7400, level: 8, chain: 'resort',
    sprite: 'ferrisWheel', variants: 1, buildTime: 1200,
    buildReview: { decor: 8, weird: 4, crowd: 3 },
    desc: '转到高处能看见整片沙滩。只增加评分，没有门票收入。',
  },
  southLighthouse: {
    name: '南岬灯塔', cat: 'build', kind: 'attraction', w: 2, d: 2, cost: 2600, level: 8, chain: 'resort',
    sprite: 'southLighthouse', variants: 1, buildTime: 780,
    buildReview: { decor: 3, weird: 4 },
    desc: '红白条纹的小灯塔，给海边添一道景，也加些评分。',
  },
  waterVilla: {
    name: '水上屋', cat: 'decor', kind: 'lodging', w: 2, d: 2, cost: 1800, level: 8, chain: 'resort',
    sprite: 'waterVilla', variants: 1, terrain: ['water'], buildTime: 840,
    buildReview: { decor: 2, weird: 1 },
    desc: '搭在水上的茅顶小屋，用来布置水面、增加评分，不收房费。',
  },
  paleoLab: {
    name: '古生物研究所', cat: 'build', kind: 'research', w: 8, d: 5, cost: 5200, level: 9,
    sprite: 'paleoLab', variants: 1, hidden: true, unremovable: true, unique: true, buildTime: 1800,
    desc: '在恐龙墓场上建研究所，完工就完成研究。到 Lv.10 可以建白垩纪牧场。',
  },
  dinoRanch: {
    name: '白垩纪牧场', cat: 'raise', kind: 'production', w: 12, d: 9, cost: 9800, level: 10, chain: 'dino',
    sprite: 'dinoRanch', variants: 1, needsRoad: true, buildTime: 1800,
    requireFlag: 'dinoResearch', requireFlagReason: '先在恐龙墓场建成古生物研究所',
    meat: { res: 'dinoMeat', amount: 2, time: 24 },
    sale: {
      in: { cactusFruit: 2, jujube: 2 }, coins: 31, time: 20, label: '观光团', stat: 'dinoTours', units: 1,
      review: { taste: 0, crowd: 3, decor: 2, weird: 3 },
    },
    desc: '能看恐龙，也能收恐龙肉。接待观光团要备好仙人掌果和沙枣。',
  },
  cretaceousDiner: {
    name: '白垩纪餐厅', cat: 'sell', kind: 'food', w: 3, d: 3, cost: 4600, level: 10, chain: 'dino',
    sprite: 'cretaceousDiner', variants: 1, needsRoad: true, buildTime: 1800,
    sale: {
      in: { dinoMeat: 1, bun: 1, egg: 1, cheese: 1, cactusFruit: 1, jujube: 1 },
      coins: 32, time: 14, label: '白垩纪套餐', stat: 'cretaceousSold', units: 1, taste: 5, weird: 4,
    },
    desc: '招牌是恐龙肉套餐，用料多，开张前得备齐。',
  },
  signatureBurger: {
    name: '快餐城', cat: 'sell', kind: 'food', w: 6, d: 6, cost: 12000, level: 9, chain: 'signature',
    sprite: 'signatureBurger', variants: 1, needsRoad: true, buildTime: 1560,
    sale: { in: { bun: 1, patty: 1, egg: 1, cheese: 1, cucumber: 1, tomato: 1 }, coins: 24, time: 11, label: '招牌汉堡', stat: 'signatureSold', units: 1, taste: 5, weird: 3, draw: 4.2, queue: 6 },
    desc: '招牌汉堡里肉、蛋、奶酪和蔬菜都加满，客人走到窗口取餐。',
  },
  tollGate: {
    name: '南门牌楼', cat: 'build', kind: 'gate', w: 4, d: 2, cost: 0, level: 1,
    sprite: 'tollGate', variants: 1, unremovable: true, hidden: true, toll: TOLL_FEE, buildTime: 0,
    entrance: { driveway: 'north', roadPassage: true },
    desc: '客人从这里进镇，每来一位收一份过路费。门洞下的两条通道都要铺路。',
  },
  northBridgeSite: {
    name: '冰湖旧桥头', cat: 'decor', kind: 'nature', w: 4, d: 4, cost: 0, level: 7,
    sprite: 'northBridgeSite', variants: 1, hidden: true, unremovable: true,
    desc: '旧桥断了，桥墩还在。修好以后，对岸的客人也能过来。',
  },
  northBridge: {
    name: '冰湖跨海大桥', cat: 'build', kind: 'gate', w: 4, d: 4, cost: NORTH_BRIDGE_COST, level: 7,
    sprite: 'northBridge', variants: 1, hidden: true, unremovable: true, unique: true,
    toll: NORTH_BRIDGE_TOLL, buildTime: NORTH_BRIDGE_BUILD_TIME,
    terrain: ['grass', 'sand', 'snow', 'gravel'],
    requireFlag: 'mammothResearch', requireFlagReason: '先在猛犸洞窟建成永冻土研究所',
    upgradeReview: { decor: 10, crowd: 6, weird: 2 },
    entrance: {
      driveway: 'east',
      roadPassage: false,
      spawnScale: NORTH_BRIDGE_SPAWN_SCALE,
      drivewayHint: '东侧引道未接 · 在桥头东面铺一格路',
      openLabel: '冰湖桥通行',
    },
    desc: '多一条迎客的路，每位收 4 块过路费。桥头东侧接上路才能通行。',
  },
  pond: {
    name: '池塘', cat: 'decor', kind: 'decor', w: 2, d: 2, cost: 180,
    sprite: 'pond', variants: 2, clearCost: 40,
    desc: '有荷叶和鸭子的小池塘。',
  },
  oak: { name: '橡树', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 28, prop: 'oak', variants: 3, clearCost: 18, desc: '一棵树。夏天有树荫。' },
  pine: { name: '松树', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 30, prop: 'pine', variants: 2, clearCost: 20, desc: '一棵松树。冬天也绿。' },
  birch: { name: '白桦', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 26, prop: 'birch', variants: 1, clearCost: 16, desc: '细白的树干，适合种在路边。' },
  palm: { name: '棕榈', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 42, prop: 'palm', variants: 2, clearCost: 24, desc: '叶子像把大扇子，种在海边很合适。' },
  rock: { name: '石头', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 8, prop: 'rock', variants: 2, clearCost: 6, desc: '一块石头。清理要花钱。' },
  bush: { name: '灌木', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 14, prop: 'bush', variants: 3, clearCost: 10, desc: '低矮的绿化，不挡招牌。' },
  flowers: { name: '野花', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 10, prop: 'flowers', variants: 3, clearCost: 6, desc: '一小片野花。便宜，好看。' },
  lamp: { name: '路灯', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 45, prop: 'lamp', variants: 1, clearCost: 14, desc: '沿着路摆，路口也可以放一盏。' },
  bench: { name: '长椅', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 35, prop: 'bench', variants: 2, clearCost: 12, desc: '给走累的顾客坐一会儿。' },
  planter: { name: '花箱', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 32, prop: 'planter', variants: 2, clearCost: 11, desc: '街角绿化。' },
  billboard: { name: '广告牌', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 150, prop: 'billboard', variants: 2, clearCost: 45, desc: '立在路边的汉堡广告牌。' },
  dumpster: { name: '垃圾箱', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 20, prop: 'dumpster', variants: 2, clearCost: 8, desc: '摆在店后的小巷里。' },
  crates: { name: '货箱', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 24, prop: 'crates', variants: 2, clearCost: 9, desc: '摞好的木箱，放仓库旁当摆设。' },
  fence: { name: '木栅栏', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 12, prop: 'fence', variants: 1, clearCost: 5, desc: '可以转向，围一圈就是个小院。' },
  hayBale: { name: '草垛', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 24, prop: 'hayBale', variants: 2, clearCost: 8, desc: '晒干扎好的草，搁在田边或牛棚旁。' },
  scarecrow: { name: '稻草人', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 60, prop: 'scarecrow', variants: 1, clearCost: 15, desc: '戴着旧草帽，站在田里。' },
  waterTower: { name: '水塔', cat: 'decor', kind: 'decor', w: 2, d: 2, cost: 420, prop: 'waterTower', variants: 1, clearCost: 120, desc: '高高的水塔，隔着田也看得见。' },
  barrel: { name: '木桶', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 18, prop: 'barrel', variants: 2, clearCost: 6, desc: '旧木桶，放在酒厂或店铺旁当装饰。' },
  pallet: { name: '托盘', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 20, prop: 'pallet', variants: 2, clearCost: 7, desc: '卸货用的木托盘，摆在工厂后面。' },
  fountain: { name: '喷泉', cat: 'decor', kind: 'decor', w: 2, d: 2, cost: 520, prop: 'fountain', variants: 1, clearCost: 150, desc: '在广场中间放座喷泉，旁边再摆几张长椅。' },
  marketStall: { name: '市集摊', cat: 'decor', kind: 'decor', w: 2, d: 2, cost: 180, prop: 'marketStall', variants: 2, clearCost: 50, desc: '搭着条纹雨棚的摊位，只作装饰，不卖货。' },
  flowerBed: { name: '花坛', cat: 'decor', kind: 'decor', w: 2, d: 2, cost: 60, prop: 'flowerBed', variants: 3, clearCost: 18, desc: '一整坛花，给路边添点颜色。' },
  topiary: { name: '造型灌木', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 45, prop: 'topiary', variants: 2, clearCost: 12, desc: '修剪整齐的小树，适合摆在门口两边。' },
  cactus: { name: '仙人掌', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 36, level: 6, prop: 'cactus', variants: 2, clearCost: 18, terrain: ['desert', 'sand'], plots: ['dune', 'dino'], desc: '长在沙地上的仙人掌。这棵是景观，不收果子。' },
  dryBush: { name: '枯灌木', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 10, prop: 'dryBush', variants: 2, clearCost: 6, hidden: true, desc: '叶子落光了，只剩一团干枝。' },
  tumbleweed: { name: '风滚草', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 12, prop: 'tumbleweed', variants: 1, clearCost: 6, hidden: true, desc: '一团跟着风走的干草球。' },
  bones: { name: '兽骨', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 8, prop: 'bones', variants: 2, clearCost: 5, hidden: true, desc: '沙里埋着的旧骨头。' },
  // 砂岩台地 doubles as wilderness scenery and a buildable landmark: it is the
  // only 2x2 nature piece the player can buy back after clearing one. Priced
  // between 水塔 (420) and 喷泉 (520) because it is a skyline prop, and its
  // clearCost stays at 90 so clearing a wild one is still cheaper than building.
  mesa: { name: '砂岩台地', cat: 'decor', kind: 'nature', w: 2, d: 2, cost: 460, prop: 'mesa', variants: 2, clearCost: 90, terrain: ['desert', 'sand'], plots: ['dune', 'dino'], desc: '层层叠起的红砂岩。清走后，还能再花钱摆一座。' },
  acacia: { name: '金合欢', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 40, prop: 'acacia', variants: 2, clearCost: 18, hidden: true, terrain: ['desert', 'sand'], plots: ['dune', 'dino'], desc: '树冠撑得很开，给沙地留下一片荫。' },

  // --- Region dressing -----------------------------------------------------
  // One set per plot theme. These are pure decoration: they score decor +1 like
  // any other prop and change no production rule. Each is limited to the plots
  // that own it, so a snow cairn can never end up on a beach. Prices follow the
  // existing prop ladder (small clutter 24-45, statement pieces 60-95).
  netRack: { name: '渔网架', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 38, prop: 'netRack', variants: 1, terrain: ['grass', 'sand'], clearCost: 12, plots: ['harbor', 'coast', 'dock', 'deepsea'], desc: '渔网挂在木架上晾着。' },
  buoys: { name: '浮球堆', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 26, prop: 'buoys', variants: 2, terrain: ['grass', 'sand', 'water'], clearCost: 9, plots: ['harbor', 'coast', 'dock', 'deepsea'], desc: '绳子捆着几只橘红浮球。' },
  fishCrates: { name: '渔获木箱', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 32, prop: 'fishCrates', variants: 1, terrain: ['grass', 'sand'], clearCost: 11, plots: ['harbor', 'coast', 'dock'], desc: '装着鱼的木箱，只摆着看，不增加库存。' },
  mooringPosts: { name: '系缆桩', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 30, prop: 'mooringPosts', variants: 1, terrain: ['grass', 'sand', 'water'], clearCost: 10, plots: ['harbor', 'dock', 'river', 'deepsea'], desc: '岸边系船的木桩，上面还缠着绳子。' },
  barrelFloat: { name: '木桶浮台', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 24, prop: 'barrelFloat', variants: 1, terrain: ['grass', 'sand', 'water'], clearCost: 8, plots: ['coast', 'dock', 'river'], desc: '木板底下绑两个空桶，拼成一个小浮台。' },

  snowCairn: { name: '雪顶标石', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 30, prop: 'snowCairn', variants: 1, terrain: ['snow', 'gravel'], clearCost: 10, plots: ['icefield'], desc: '雪地里垒的石头路标，顶上插着小红旗。' },
  iceBlocks: { name: '冰砖堆', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 34, prop: 'iceBlocks', variants: 1, terrain: ['snow', 'gravel', 'ice'], clearCost: 11, plots: ['icefield'], desc: '从冰湖里切下来的冰块，码成一摞。' },
  deadPine: { name: '雪松', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 32, prop: 'deadPine', variants: 1, terrain: ['snow', 'gravel', 'grass'], clearCost: 16, plots: ['icefield', 'plain'], desc: '松枝上积了厚厚一层雪。' },
  iceSled: { name: '雪橇', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 40, prop: 'iceSled', variants: 1, terrain: ['snow', 'gravel'], clearCost: 13, plots: ['icefield'], desc: '装着货的木雪橇，上面落了些雪。' },

  duneRibs: { name: '兽骨拱', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 28, prop: 'duneRibs', variants: 1, terrain: ['desert', 'sand'], clearCost: 9, plots: ['dune', 'dino', 'abyss'], desc: '一排弯弯的肋骨，半截埋在沙里。' },
  desertWell: { name: '枯井', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 44, prop: 'desertWell', variants: 1, terrain: ['desert', 'sand'], clearCost: 14, plots: ['dune', 'dino'], desc: '早就没水的老井，绳子还垂在井口。' },
  duneSignpost: { name: '荒原路牌', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 36, prop: 'duneSignpost', variants: 1, terrain: ['desert', 'sand'], clearCost: 12, plots: ['dune', 'dino'], desc: '风吹旧了的路牌，字已经看不清了。' },

  hayWagon: { name: '干草车', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 48, prop: 'hayWagon', variants: 1, terrain: ['grass', 'sand', 'coral'], clearCost: 15, plots: ['plain', 'pasture', 'forest', 'farm'], desc: '满满一车干草，停在田边。' },
  pastureTrough: { name: '饮水槽', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 26, prop: 'pastureTrough', variants: 1, terrain: ['grass', 'sand'], clearCost: 9, plots: ['plain', 'pasture', 'forest'], desc: '盛着清水的木槽，放在牧场旁很合适。' },

  clockPost: { name: '街钟', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 95, prop: 'clockPost', variants: 1, clearCost: 28, plots: ['plaza', 'market', 'south'], desc: '立在街角的一面老式钟。' },
  kiosk: { name: '售报亭', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 78, prop: 'kiosk', variants: 1, clearCost: 24, plots: ['plaza', 'market', 'south'], desc: '小报亭，窗前摞着报纸。只是街景，不营业。' },
  pigeonPlinth: { name: '鸽群矮台', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 30, prop: 'pigeonPlinth', variants: 1, clearCost: 10, plots: ['plaza', 'south'], desc: '几只鸽子挤在矮石台上。' },
  marketBunting: { name: '市集彩旗', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 34, prop: 'marketBunting', variants: 1, clearCost: 11, plots: ['plaza', 'market'], desc: '给摊位间挂上一串小彩旗。' },
  marketScale: { name: '市集磅秤', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 42, prop: 'marketScale', variants: 1, clearCost: 13, plots: ['market'], desc: '带两个铜盘的老秤，摆在摊边当装饰。' },

  // Ruins. These are the "before" of the story: the square and the market went
  // derelict, and what is left on the ground is what the player walks past in
  // the first minute. Cheap to clear, cheap to place — they are scenery, not a
  // sink — and every one of them is buildable ground, so nothing traps the player.
  brokenPillar: { name: '断裂柱础', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 24, prop: 'brokenPillar', variants: 2, clearCost: 8, terrain: ['grass', 'plaza'], plots: ['plaza', 'market'], desc: '草里倒着半截石柱，还能看见旧花纹。' },
  collapsedSlab: { name: '塌陷地砖', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 18, prop: 'collapsedSlab', variants: 2, clearCost: 6, terrain: ['grass', 'plaza'], plots: ['plaza', 'market', 'deepsea'], desc: '地砖陷下去了，缝里长着草。' },
  deadStall: { name: '废弃摊位', cat: 'decor', kind: 'nature', w: 2, d: 2, cost: 68, prop: 'deadStall', variants: 2, clearCost: 22, terrain: ['grass', 'plaza', 'sand'], plots: ['plaza', 'market', 'deepsea'], desc: '摊子塌了半边，很久没人用了。' },

  busStop: { name: '候车亭', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 66, prop: 'busStop', variants: 1, clearCost: 20, plots: ['south'], desc: '带长凳的红顶小亭，摆在路边作装饰。' },
  mailboxCluster: { name: '邮筒组', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 32, prop: 'mailboxCluster', variants: 1, clearCost: 10, plots: ['south'], desc: '两只并排的绿色邮筒。' },

  logPile: { name: '原木堆', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 30, prop: 'logPile', variants: 1, terrain: ['grass', 'sand'], clearCost: 10, plots: ['forest', 'river', 'plain', 'pasture'], desc: '锯好的木头整齐码在一起。' },
  stumpStool: { name: '树桩', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 18, prop: 'stumpStool', variants: 1, terrain: ['grass', 'sand', 'desert'], clearCost: 6, plots: ['forest', 'farm', 'pasture', 'dino'], desc: '一大一小两个老树桩，大的那个坐上去正好。' },

  waterPump: { name: '手压水泵', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 46, prop: 'waterPump', variants: 1, terrain: ['grass', 'sand'], clearCost: 14, plots: ['farm', 'river'], desc: '老式手压水泵，摆在田边作装饰。' },
  seedSacks: { name: '种子袋', cat: 'decor', kind: 'decor', w: 1, d: 1, cost: 24, prop: 'seedSacks', variants: 1, terrain: ['grass', 'sand', 'coral'], clearCost: 8, plots: ['farm', 'market'], desc: '几袋扎好口的种子，靠墙摆着。' },

  abyssRock: { name: '黑玄武岩', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 22, prop: 'abyssRock', variants: 1, terrain: ['grass', 'sand', 'coral', 'desert'], clearCost: 8, plots: ['abyss'], desc: '岸边一簇黑色岩石。' },
  abyssTentacle: { name: '触手石', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 58, prop: 'abyssTentacle', variants: 1, terrain: ['coral', 'sand', 'grass'], clearCost: 17, plots: ['abyss'], desc: '弯弯的石头，看着像章鱼腕足。' },
  abyssShell: { name: '苍白甲壳', cat: 'decor', kind: 'nature', w: 1, d: 1, cost: 34, prop: 'abyssShell', variants: 1, terrain: ['coral', 'sand', 'grass'], clearCost: 11, plots: ['abyss', 'deepsea'], desc: '沙里露出半片白色大壳。' },

  wormHole: {
    name: '巨型蠕虫的洞', cat: 'decor', kind: 'nature', w: 6, d: 6, cost: 0, level: 1,
    prop: 'wormHole', variants: 1, hidden: true, unremovable: true, clearCost: 0,
    desc: '红沙地中间的大洞，蠕虫住在里面。以后可以在这里建采集场。',
  },
  deepSeaHarbor: {
    name: '远航海港', cat: 'build', kind: 'production', w: 5, d: 4, cost: 12000, level: 10, chain: 'abyss',
    sprite: 'deepSeaHarbor', variants: 1, unique: true, hidden: true, unremovable: true,
    terrain: ['water', 'deep'], plots: ['abyss'], buildTime: 1800,
    upgradeReview: { decor: 7, weird: 8 },
    prod: { out: { octoHorn: 1 }, time: 60 },
    desc: '点远海的黑水井口改建。完工后定时送回巨大章鱼脚，不用接路。',
  },
  abyssWellhead: {
    name: '环礁黑水井口', cat: 'decor', kind: 'nature', w: 3, d: 3, cost: 0, level: 10,
    prop: 'abyssWellhead', variants: 1, hidden: true, unremovable: true, clearCost: 0,
    desc: '环礁里废弃的勘探井口，可以改建成远航海港。',
  },
  abyssDiner: {
    name: '海边食堂', cat: 'sell', kind: 'food', w: 4, d: 3, cost: 8600, level: 10, chain: 'abyss',
    sprite: 'abyssDiner', variants: 1, unique: true, needsRoad: true, buildTime: 1800,
    terrain: ['grass', 'sand', 'water', 'coral'],
    buildReview: { decor: 6, weird: 8 },
    sale: {
      in: { octoHorn: 1, potato: 2, cheese: 1 },
      coins: 112, time: 16, label: '炭烤章鱼脚', stat: 'octoDishSold', units: 1, taste: 6, weird: 5,
      draw: 3.2,
    },
    desc: '开在北原海边的食堂，卖炭烤章鱼脚。靠岸建好，再接上路就能开张。',
  },
  giantOctopus: {
    name: '巨型章鱼', cat: 'decor', kind: 'nature', w: 8, d: 8, cost: 0, level: 10,
    prop: 'giantOctopus', variants: 1, hidden: true, unremovable: true, clearCost: 0,
    desc: '涡流里住着一只大章鱼，偶尔会伸出腕足。',
  },
};

// Deterministic scenery types and rough weights for plots without an override.
export const SCENERY = [
  ['oak', 5], ['pine', 5], ['birch', 2], ['bush', 4], ['rock', 2],
  ['flowers', 5], ['palm', 1], ['lamp', 1], ['bench', 1],
];
