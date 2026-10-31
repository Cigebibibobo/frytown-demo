import {
  BUILD_DEFS, CATEGORIES, RESOURCES, RES_ORDER, REVIEW_KEYS,
  PAVE_COST, BRIDGE_COST, PLOTS, PLOT_BY_ID, defOf, isRotatable, terrainAt,
  MAX_LEVEL, REVIEW_LEVEL_REQ, REVIEW_HALL_UNLOCK,
  FESTIVAL_COST, FESTIVAL_TIME, FESTIVAL_REWARD,
  AD_COIN_BY_LEVEL,
  chainOf, unlockLevelOf, ROAD_STYLES, roadStyleOf,
} from './content.js';
import {
  createInitialState, deserialize, serialize, tick, canPlace, placeObject,
  canMoveObject, moveObject,
  paintRoadRun, roadRunPlan, paintPave, roadPlan, demolishAt, objectAt, objectById, missionList,
  demolishObject, demolitionQuote, rotateObject, clockText, statusOf,
  inBounds, key as tileKey, queueAtShop, reviewPoints, reviewCap, nextLevelNeed,
  addReview, buffInfo,
  reviewHall, reviewHallReady, festivalTarget, canStartFestival, startFestival,
  levelChainStatus,
  unlockedPlots, plotUnlocked, lv1Guide, lv2Guide, lv3Guide, lv4Guide, lv5Guide, lv6Guide,
  lv7Guide, lv8Guide, lv9Guide, lv10Guide,
  isBuilt, buildProgress, finishConstruction, formatSeconds,
  boostLeftMs, speedMultiplier, nextSpeed, setSpeed, grantBoost, wormPhase, octopusPhase,
  canUpgradeLandmark, upgradeLandmark, entranceDefOf, entranceOpen, deepSeaHarborBuilt,
} from './rules.js';
import { TownEngine } from './engine.js';
import { AudioBus } from './audio.js';
import { RewardedAds } from './ads.js';
import {
  initPlatform, isPortal, platformLocale, platformMuted, onPlatformMute,
  loadingStart, loadingStop, gameplayStart, gameplayStop,
  requestAd, readStorage, writeStorage, removeStorage,
} from './platform.js';
import { initI18n, localizeContent, startDomI18n, t } from './i18n.js';
import { DEV, SAVE, SPEED, UI, INPUT } from './data/runtime.js';

const SAVE_KEY = SAVE.KEY;
const LEGACY_SAVE_KEY = SAVE.LEGACY_KEY;
// play.html hands off here with ?demo=1 so a phone recording a demo does not
// get the renderer diagnostics panel thrown over the first frame.
const DEMO = new URLSearchParams(window.location.search).get('demo') === '1';
const data = window.BURGER_ISO_DATA;
const $ = (id) => document.getElementById(id);
const canvas = $('game');
// A phone that loses WebGL gets a replacement surface back, so every path that
// has to talk to the live element reads it off the engine instead of holding on
// to the node found at boot.
const surface = () => engine?.canvas || canvas;

const els = {
  hud: $('hud'),
  coins: $('coins'),
  reviewVal: $('reviewVal'),
  reviewLevel: $('reviewLevel'),
  reviewCount: $('reviewCount'),
  btnSpeed: $('btnSpeed'),
  clockVal: $('clockVal'),
  dayVal: $('dayVal'),
  missionCount: $('missionCount'),
  questMain: $('questMain'),
  questNext: $('questNext'),
  festivalBanner: $('festivalBanner'),
  festTime: $('festTime'),
  festCount: $('festCount'),
  festBar: $('festBar'),
  inspector: $('inspector'),
  hint: $('hint'),
  hintText: $('hintText'),
  hintKey: document.querySelector('#hint .hint-key'),
  coach: $('coach'),
  coachRing: $('coachRing'),
  prologue: $('prologue'),
  prologueArt: $('prologueArt'),
  prologueCopy: document.querySelector('#prologue .prologue-copy'),
  prologueKicker: $('prologueKicker'),
  prologueTitle: $('prologueTitle'),
  prologueText: $('prologueText'),
  prologueNext: $('prologueNext'),
  toasts: $('toasts'),
  dock: $('dock'),
  catTabs: $('catTabs'),
  questTracker: $('questTracker'),
  questToggle: $('btnQuestToggle'),
  roadStyles: $('roadStyles'),
  cards: $('cards'),
  cancelTool: $('cancelTool'),
  placeBar: $('placeBar'),
  placeConfirm: $('placeConfirm'),
  placeCancel: $('placeCancel'),
  coinAd: $('btnCoinAd'),
  btnRotate: $('btnRotate'),
  zoomIn: $('zoomIn'),
  zoomOut: $('zoomOut'),
  recenter: $('btnRecenter'),
  scrim: $('scrim'),
  missionPanel: $('missionPanel'),
  missionList: $('missionList'),
  storePanel: $('storePanel'),
  storeList: $('storeList'),
  reviewPanel: $('reviewPanel'),
  reviewList: $('reviewList'),
  menuPanel: $('menuPanel'),
  devPanel: $('devPanel'),
  devStatus: $('devStatus'),
  musicState: $('musicState'),
  soundState: $('soundState'),
  modal: $('modal'),
  modalCard: $('modalCard'),
  boot: $('boot'),
  fatal: $('fatal'),
  fatalText: $('fatalText'),
};

const BRUSH_TOOLS = new Set(['pave', 'demolish']);
const DEFAULT_HINT = '拖拽空地移动视角 · 双指或滚轮缩放 · 从下方选择建筑';

let engine = null;
let state = null;
let audio = null;
let images = [];
let category = 'grow';
let booted = false;

const INTRO_STEPS = [
  '顾客都从南门牌楼的门洞进镇 · 沿道路走到餐馆，排不上队会掉头离开',
  '薯条小摊贴着道路才会开火 · 有顾客排队才会出餐赚钱',
  '卖餐涨口味、接客涨人气 · 评分满 40 后建大厅办美食节晋升',
];
const intro = { active: false, step: -1, pending: false, acc: 0 };

// 开场三幕：毕业、回乡、看见废墟。Shown once, before the coach marks, and only
// on a first run. The text is deliberately short — the opening's job is to
// explain WHY the square is a ruin, not to tell a story over the player's head.
// The opener is one screen, not a cutscene. The premise only has to land two
// facts — you lost the city job, you came home to revive the square — then get
// out of the way so the player can play. Anything longer tests whether people
// will sit through prose before they've decided they like the game, and most
// won't.
const PROLOGUE_SCENES = [
  {
    kicker: '城里 · 出租屋',
    title: '简历又没回音',
    text: '面试没几个，房租可一天没停。',
  },
  {
    kicker: '路上 · 末班车',
    title: '楼越来越矮',
    text: '楼退成田，田退成海。',
  },
  {
    kicker: '南门 · 油炸小镇',
    title: '找不到工作，就回镇当老板',
    text: '南门还是老样子。你挽起袖子，把旧油锅点上。',
  },
];
const PROLOGUE_SCENE_MS = 3400;
const prologue = { active: false, scene: 0, timer: 0 };


const ui = {
  tool: null,
  hover: null,
  ghost: null,
  pending: null,
  pendingAt: 0,
  selectedId: null,
  demolishTarget: null,
  rot: 0,
  roadStyle: 'asphalt',
  dockOpen: false,
};

// Rough visual height of a build ghost above its tile, used to keep the
// confirm bar clear of the spot the player is working on.
const GHOST_CLEAR_ABOVE = 96;
const GHOST_CLEAR_BELOW = 20;

const dev = {
  hideGuide: false,
  boostMs: 10 * 60 * 1000,
};

const pointers = new Map();
let gesture = null;
let lastPointer = null;
let openDrawerId = null;
let modalAction = null;
let closeOnBackdrop = true;
let adActive = false;
let adSeq = 0;
let adBreak = false;
let portal = false;
let systemMuted = false;
let inspectorHeld = false;

let lastFrame = 0;
let hudAcc = 0;
let questAcc = 0;
let inspectorAcc = 0;
let saveAcc = 0;
let lastCoins = -1;
let coinPulseTimer = 0;
let hintTimer = 0;
let hintIsGuide = false;
let hintMuted = '';
const guide = { key: '', text: '', focus: null };
let lastBrushSound = 0;
let warnedAt = 0;
let warnedMsg = '';
let lastOrientation = '';

const cardEls = new Map();
const htmlCache = new Map();

const fmt = (n) => Math.round(Number(n) || 0).toLocaleString('en-US');
const pct = (value, max) => Math.max(0, Math.min(100, (value / Math.max(1, max)) * 100));

// ---------------------------------------------------------------------------
// Boot

async function boot() {
  try {
    portal = await initPlatform();
    initI18n(portal ? platformLocale() : '');
    localizeContent();
    startDomI18n();
    loadingStart();
    if (!data || !data.sprites || !data.pages) {
      throw new Error(t('缺少预渲染图集数据（assets/atlas-data.js）。'));
    }
    images = await Promise.all(data.pages.map((page) => loadImage(`./assets/${page.file}`)));
    await loadFont();

    state = loadState();
    systemMuted = platformMuted();

    audio = new AudioBus({
      enabled: state.settings.sound !== false && !systemMuted,
      music: state.settings.music !== false,
    });
    if (portal) {
      onPlatformMute((muted) => {
        systemMuted = muted;
        applyAudioSettings();
        syncAudioButtons();
      });
    }

    engine = new TownEngine(canvas, data, images);
    // A phone that loses WebGL for good gets a replacement surface, and the
    // pointer and wheel handlers went away with the old node.
    engine.onCanvasSwap = () => bindInput();
    // A 4096px atlas is what a phone webview evicts canvases for, and the ground
    // bakes its own copies from it, so the cheap copy has to be in place before
    // the first bake rather than after the player finds the button.
    if (navigator.maxTouchPoints > 0) await setAtlasScale(0.5);
    setupUI();
    syncViewLayout();
    engine.cam.zoom = engine.defaultZoom();
    recenter(false);
    engine.render(state, ui);
    releaseAtlasWarmups();
    lastOrientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';

    bindInput();
    bindLifecycle();
    window.addEventListener('pointerdown', (e) => {
      if (!intro.active) return;
      if (e.target.closest && e.target.closest('#hint')) return;
      advanceIntro();
    }, { capture: true, passive: true });

    syncAudioButtons();
    renderMenuState();
    updateHud(true);
    renderQuest();
    updateInspector(true);
    save();

    const bootEl = $('boot');
    bootEl.classList.add('gone');
    setTimeout(() => { bootEl.hidden = true; }, UI.BOOT_FADE_MS);
    booted = true;
    startLoop();
    loadingStop();
    gameplayStart();
    showHint(DEFAULT_HINT, UI.HINT_WELCOME_MS);
    if (legacySaveFound) {
      setTimeout(() => toast('旧版九宫格存档已停用，16 地块世界重新开局', 'warn', UI.LEGACY_TOAST_MS), UI.LEGACY_TOAST_DELAY_MS);
    }

    // 3 步引导只在第一次进镇时出现。
    // The one-screen opener runs first and hands over to the coach marks when
    // dismissed. A save that already saw it skips straight to `startIntro`.
    if (!state.settings.prologueSeen || !state.settings.introSeen) {
      setTimeout(() => startPrologue(), UI.INTRO_DELAY_MS);
    }

    // ?dev=1 opens the test drawer for quick manual checks.
    if (DEV && new URLSearchParams(window.location.search).get('dev') === '1') {
      setTimeout(() => openDrawer('devPanel'), UI.BOOT_FADE_MS + 200);
    }

    // A phone that already runs at 4fps cannot be made to tap six times, so on
    // touch devices the panel opens itself: one screenshot then carries the
    // renderer name, the per-frame cost and the atlas switch.
    if (DEV && navigator.maxTouchPoints > 0 && !DEMO) {
      setTimeout(() => { if (!diag.on) toggleDiag(); }, UI.BOOT_FADE_MS + 400);
    }

    if (DEV) window.__town = {
      get state() { return state; },
      get engine() { return engine; },
      get ui() { return ui; },
      save,
      // Exposed so QA can ask "may I build this here?" without simulating a
      // pointer move. Same function the hover ghost uses, so it cannot drift.
      canPlace(type, x, y, free = true) { return canPlace(state, type, x, y, free); },
      step: stepGame,
      addCoins(n) { state.coins += n; updateHud(true); refreshAffordability(); },
      reset: resetGame,
      openDrawer,
      focusPlot,
      setAtlasScale: (k) => setAtlasScale(k),
      get atlasScale() { return atlasScale; },
      plots: PLOTS,
      review() {
        return {
          points: reviewPoints(state),
          level: state.review.level,
          need: nextLevelNeed(state),
          hall: !!reviewHall(state),
          hallReady: reviewHallReady(state),
          festival: state.festival,
          target: festivalTarget(state),
          canStart: canStartFestival(state),
          chain: levelChainStatus(state),
        };
      },
      startFestival: startFestivalFlow,
      speed() {
        return {
          chosen: state.speed,
          multiplier: speedMultiplier(state),
          boostLeft: boostLeftMs(state),
        };
      },
      // QA waits on this instead of guessing how long the portal's local mock ad
      // runs; both flags are module state and cannot be read from the DOM.
      ad() {
        return { active: adActive, break: adBreak };
      },
      completeBuild(id) {
        const o = objectById(state, id);
        const events = [];
        const ok = finishConstruction(state, o, events);
        handleEvents(events);
        updateHud(true);
        if (ui.selectedId === id) renderInspector(true);
        return ok;
      },
      intro: {
        get active() { return intro.active; },
        get step() { return intro.step; },
        start: startIntro,
        skip: finishIntro,
      },
      dev: {
        panel() { openDrawer('devPanel'); },
        get hiddenGuide() { return dev.hideGuide; },
        coins(n = 10000) {
          state.coins += Number(n) || 0;
          devRefresh(`金币 +${fmt(n)}`);
          return state.coins;
        },
        resources(n = 20) {
          devAddResources(Number(n) || 0);
          devRefresh(`全资源 +${fmt(n)}`);
          return { ...state.res };
        },
        review(n = 100) {
          devAddReview(Number(n) || 0);
          devRefresh(`评分 +${fmt(n)}`);
          return reviewPoints(state);
        },
        setLevel(level) {
          devSetLevel(level);
          return state.review.level;
        },
        finishBuilds: devFinishBuilds,
        spawn() {
          state.spawnTimer = 0;
          devRefresh('下一位顾客即将进镇');
        },
        boost(minutes = 10) {
          state.speed = 3;
          state.boostUntil = Date.now() + Math.max(1, Number(minutes) || 10) * 60000;
          afterSpeedChange('3× 加速已开启（开发者）');
          renderDevStatus();
          return boostLeftMs(state);
        },
        hideGuide(hidden = true) {
          dev.hideGuide = !!hidden;
          updateGuide();
          renderDevStatus();
          return dev.hideGuide;
        },
        reset: resetGame,
      },
    };
  } catch (err) {
    loadingStop();
    showFatal(err);
  }
}

// ---------------------------------------------------------------------------
// Atlas detail
//
// The three 4096px pages decode to ~149MB. A phone WebView will not keep that
// resident, so it evicts and re-uploads pages while the map is moving — and a
// chunk bake that lands on an evicted page waits for the whole page to upload
// again, which is the difference between a smooth pan and a 4fps one. Half-size
// pages bring the footprint to ~37MB. Baked chunks come out byte-identical
// either way (a chunk is baked at one world pixel per tile regardless), so only
// sprites drawn larger than 1:1 world scale lose detail.
let atlasScale = 1;
let atlasBaseRects = null;
let atlasBasePages = null;
let atlasBaseScale = 1;

async function setAtlasScale(k) {
  if (!data || !engine) return atlasScale;
  if (atlasScale === k) return atlasScale;
  if (!atlasBaseRects) {
    atlasBaseScale = data.scale;
    atlasBasePages = data.pages.map((p) => [p.width, p.height]);
    atlasBaseRects = {};
    for (const key in data.sprites) {
      const m = data.sprites[key];
      atlasBaseRects[key] = [m.x, m.y, m.w, m.h, m.ax, m.ay];
    }
  }
  if (k < 1) {
    const pages = [];
    for (let i = 0; i < images.length; i++) {
      const [w, h] = atlasBasePages[i];
      pages.push(await createImageBitmap(images[i], {
        resizeWidth: Math.max(1, Math.round(w * k)),
        resizeHeight: Math.max(1, Math.round(h * k)),
        resizeQuality: 'high',
      }));
    }
    // The full-size pages are dropped on purpose: holding them keeps the
    // decoded data alive and the texture pressure we are trying to remove.
    images.length = 0;
    for (const page of pages) images.push(page);
  }
  for (const key in atlasBaseRects) {
    const [x, y, w, h, ax, ay] = atlasBaseRects[key];
    const m = data.sprites[key];
    m.x = Math.round(x * k);
    m.y = Math.round(y * k);
    m.w = Math.max(1, Math.round(w * k));
    m.h = Math.max(1, Math.round(h * k));
    m.ax = Math.round(ax * k);
    m.ay = Math.round(ay * k);
  }
  data.pages.forEach((p, i) => {
    p.width = Math.max(1, Math.round(atlasBasePages[i][0] * k));
    p.height = Math.max(1, Math.round(atlasBasePages[i][1] * k));
  });
  data.scale = atlasBaseScale * k;
  atlasScale = k;
  htmlCache.clear();
  engine.dropGroundChunks();
  return atlasScale;
}

let atlasWarmups = [];

// The warm-up copy only exists for a desktop Chromium quirk (first draw can
// sample a half-uploaded texture). On touch devices it just doubles the atlas
// memory at boot, which is enough to get canvases evicted.
const ATLAS_WARMUP = navigator.maxTouchPoints === 0;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (ATLAS_WARMUP) {
        // The very first draws of a 4096px atlas can sample a low-res copy
        // before Chromium finishes uploading it. Ground chunks bake once, so
        // prime the atlas at native size and keep it alive until that bake.
        const warm = document.createElement('canvas');
        warm.width = img.naturalWidth;
        warm.height = img.naturalHeight;
        warm.getContext('2d')?.drawImage(img, 0, 0);
        atlasWarmups.push(warm);
      }
      resolve(img);
    };
    img.onerror = () => reject(new Error(`无法载入精灵图：${src}`));
    img.src = src;
  });
}

function releaseAtlasWarmups() {
  for (const c of atlasWarmups) {
    c.width = 1;
    c.height = 1;
  }
  atlasWarmups = [];
}

async function loadFont() {
  if (!document.fonts) return;
  try {
    await Promise.race([
      document.fonts.load('12px "Fusion Pixel"'),
      new Promise((resolve) => setTimeout(resolve, UI.FONT_TIMEOUT_MS)),
    ]);
  } catch {
    // The HUD falls back to a system monospace font.
  }
}

let legacySaveFound = false;

function loadState() {
  let raw = null;
  try {
    raw = readStorage(SAVE_KEY);
    if (!raw && readStorage(LEGACY_SAVE_KEY)) legacySaveFound = true;
  } catch {
    raw = null;
  }
  const loaded = raw ? deserialize(raw) : null;
  return loaded || createInitialState();
}

function showFatal(err) {
  console.error(err);
  $('boot')?.classList.add('gone');
  els.fatal.hidden = false;
  els.fatalText.textContent = err?.message || '未知错误，请刷新重试。';
}

// ---------------------------------------------------------------------------
// UI construction

function setupUI() {
  buildTabs();
  buildCards();
  buildRoadStyles();

  $('btnStore').addEventListener('click', () => toggleDrawer('storePanel'));
  els.btnSpeed?.addEventListener('click', onSpeedClick);
  $('btnReview').addEventListener('click', () => toggleDrawer('reviewPanel'));
  $('btnMission').addEventListener('click', () => toggleDrawer('missionPanel'));
  $('btnAllMissions').addEventListener('click', () => openDrawer('missionPanel'));
  els.questToggle?.addEventListener('click', () => {
    const collapsed = els.questTracker.classList.toggle('collapsed');
    state.settings.questCollapsed = collapsed;
    els.questToggle.setAttribute('aria-expanded', String(!collapsed));
    audio?.play('click');
    save();
  });
  $('btnMenu').addEventListener('click', () => toggleDrawer('menuPanel'));
  if (DEV) {
    $('btnDev').addEventListener('click', () => openDrawer('devPanel'));
    els.devPanel.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-dev]');
      if (btn) handleDevAction(btn.dataset.dev);
    });
  } else {
    $('btnDev').remove();
    $('devPanel').remove();
  }
  els.festivalBanner.addEventListener('click', () => openDrawer('reviewPanel'));

  // Opener. One screen, one button — dismiss it on click or any of the usual
  // "I get it" keys, and mark it seen so it never plays twice.
  els.prologueNext?.addEventListener('click', () => finishPrologue());
  document.addEventListener('keydown', (e) => {
    if (!prologue.active) return;
    if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      finishPrologue();
    }
  });
  $('btnSound').addEventListener('click', () => toggleSound());
  $('btnToggleSound').addEventListener('click', () => toggleSound());
  $('btnToggleMusic').addEventListener('click', () => toggleMusic());
  if (DEV) bindDiagTaps();
  $('btnSave').addEventListener('click', () => {
    if (save()) {
      toast('进度已保存', 'good');
      audio?.play('click');
    } else {
      warn('保存失败：浏览器存储不可用');
    }
  });
  $('btnHelp').addEventListener('click', showHelp);
  $('btnReset').addEventListener('click', confirmReset);
  $('hintClose').addEventListener('click', () => {
    if (intro.active) {
      finishIntro();
      return;
    }
    clearTimeout(hintTimer);
    els.hint.classList.add('hidden');
    hintMuted = guide.key;
  });

  els.catTabs.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    if (tab.dataset.cat === category) {
      ui.dockOpen = !ui.dockOpen;
      syncViewLayout();
      audio?.play('click');
      return;
    }
    category = tab.dataset.cat;
    if (ui.tool) setTool(null);
    ui.dockOpen = true;
    els.catTabs.querySelectorAll('.tab').forEach((el) => {
      el.classList.toggle('active', el.dataset.cat === category);
    });
    buildCards();
    syncViewLayout();
    audio?.play('click');
  });

  els.cards.addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (!card) return;
    const type = card.dataset.type;
    const lock = cardLock(type, defOf(type));
    if (lock) {
      warn(lock.reason);
      return;
    }
    if (ui.tool?.kind === 'build' && ui.tool.type === type) setTool(null);
    else setTool({ kind: 'build', type });
  });

  els.reviewList.addEventListener('click', (e) => {
    const actBtn = e.target.closest('[data-act]');
    if (actBtn) {
      const act = actBtn.dataset.act;
      if (act === 'festival') startFestivalFlow();
      else if (act === 'buildHall') {
        closeDrawers();
        setCategorySilently('build');
        setTool({ kind: 'build', type: 'reviewHall' });
      } else if (act === 'road') {
        closeDrawers();
        setTool({ kind: 'road' });
        showHint('在评分大厅任意一边拖一格道路 · 大厅通路后才能办美食节', UI.HINT_TOOL_MS);
      } else if (act === 'hall') {
        const hall = reviewHall(state);
        if (hall) {
          closeDrawers();
          focusObject(hall);
        }
      }
      return;
    }
    const cell = e.target.closest('[data-plot]');
    if (cell) focusPlot(cell.dataset.plot);
  });

  els.cards.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
    e.preventDefault();
    els.cards.scrollLeft += e.deltaY;
  }, { passive: false });

  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const kind = btn.dataset.tool;
      if (ui.tool?.kind === kind) setTool(null);
      else setTool(kind === 'road' ? { kind, style: ui.roadStyle } : { kind });
    });
  });

  els.btnRotate?.addEventListener('click', () => rotateBy(1));

  $('zoomIn').addEventListener('click', () => zoomAroundCenter(INPUT.ZOOM_BUTTON_FACTOR));
  $('zoomOut').addEventListener('click', () => zoomAroundCenter(1 / INPUT.ZOOM_BUTTON_FACTOR));
  els.recenter.addEventListener('click', () => {
    recenter(true);
    audio?.play('click');
  });
  els.cancelTool.addEventListener('click', () => setTool(null));
  els.placeConfirm?.addEventListener('click', () => commitPending());
  els.placeCancel?.addEventListener('click', () => cancelPending());
  els.coinAd?.addEventListener('click', () => offerCoinAd());
  els.scrim.addEventListener('click', () => closeDrawers());
  els.modal.addEventListener('click', onModalClick);
  els.inspector.addEventListener('click', onInspectorClick);
  // Progress text re-renders every second; swapping nodes mid-press drops the click.
  els.inspector.addEventListener('pointerdown', () => { inspectorHeld = true; }, { passive: true });
  const releaseInspectorHold = () => { inspectorHeld = false; };
  window.addEventListener('pointerup', releaseInspectorHold, true);
  window.addEventListener('pointercancel', releaseInspectorHold, true);
  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeDrawers());
  });
}

function buildTabs() {
  els.catTabs.innerHTML = '';
  for (const cat of CATEGORIES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `tab${cat.id === category ? ' active' : ''}`;
    btn.dataset.cat = cat.id;
    btn.style.setProperty('--tab-accent', cat.accent);
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', cat.id === category ? 'true' : 'false');
    btn.innerHTML = `<span class="tab-cn">${cat.name}</span>`;
    els.catTabs.appendChild(btn);
  }
}

function buildCards() {
  els.cards.innerHTML = '';
  cardEls.clear();
  for (const [type, def] of Object.entries(BUILD_DEFS)) {
    if (def.cat !== category || def.hidden) continue;
    const lock = cardLock(type, def);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `card${lock ? ' locked' : ''}`;
    btn.dataset.type = type;
    btn.title = lock ? lock.reason : `${def.desc || def.name}${def.buildTime ? ` · 施工 ${formatSeconds(def.buildTime)}` : ''}`;
    btn.setAttribute('aria-label', `${def.name}，${def.cost} 金币${def.buildTime ? `，施工 ${formatSeconds(def.buildTime)}` : ''}${lock ? `，${lock.text}` : ''}`);

    const thumb = makeThumb(def);
    const corner = document.createElement('span');
    corner.className = 'corner';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = def.name;
    const cost = document.createElement('span');
    cost.className = 'cost';
    cost.textContent = fmt(def.cost);
    const lockEl = document.createElement('span');
    lockEl.className = 'lock';
    lockEl.textContent = lock ? lock.text : '';
    const btime = document.createElement('span');
    btime.className = 'btime';
    btime.textContent = def.buildTime ? formatSeconds(def.buildTime, true) : '';

    btn.append(thumb, corner, name, cost, lockEl, btime);
    els.cards.appendChild(btn);
    cardEls.set(type, btn);
  }
  refreshAffordability();
  syncToolUI();
}

function buildRoadStyles() {
  if (!els.roadStyles) return;
  els.roadStyles.innerHTML = '<span class="road-styles-label">路面</span>';
  for (const style of ROAD_STYLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'road-style';
    btn.dataset.style = style.id;
    btn.title = `${style.name}路面 · ${style.cost} 金币/格 · 顾客可以直接通行`;
    btn.setAttribute('aria-label', `${style.name}路面，${style.cost} 金币每格，可通行`);
    btn.innerHTML = `<i style="--swatch:${style.color};--swatch-dark:${style.ground}"></i><span>${style.name}</span><em>${style.cost}</em>`;
    els.roadStyles.appendChild(btn);
  }
  els.roadStyles.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-style]');
    if (btn) selectRoadStyle(btn.dataset.style);
  });
}

function roadHint(style = roadStyleOf(ui.roadStyle)) {
  return `${style.name}路面 ${style.cost}/格 · 点起点再拖出直线 · 顾客可直接通行 · 淡水水面自动架木桥 ${BRIDGE_COST}/格`;
}

function selectRoadStyle(id) {
  const style = roadStyleOf(id);
  ui.roadStyle = style.id;
  if (ui.tool?.kind === 'road') {
    ui.tool.style = style.id;
    showHint(roadHint(style), UI.HINT_TOOL_MS);
  }
  syncToolUI();
  audio?.play('click');
  if (lastPointer) updateGhostAt(lastPointer.x, lastPointer.y);
}

function drawDiamond(g, cx, cy, hw, hh) {
  g.beginPath();
  g.moveTo(cx, cy - hh);
  g.lineTo(cx + hw, cy);
  g.lineTo(cx, cy + hh);
  g.lineTo(cx - hw, cy);
  g.closePath();
}

function makeThumb(def) {
  const c = document.createElement('canvas');
  c.width = 144;
  c.height = 104;
  c.className = 'thumb';
  c.setAttribute('aria-hidden', 'true');
  const g = c.getContext('2d');
  g.imageSmoothingEnabled = false;

  if (def.kind === 'field') {
    drawFieldThumb(g, def);
    return c;
  }

  const skey = def.sprite ? `b:${def.sprite}:0` : `p:${def.prop}:0`;
  const meta = data.sprites[skey];
  if (!meta) return c;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  minX = Math.min(minX, -meta.ax);
  minY = Math.min(minY, -meta.ay);
  maxX = Math.max(maxX, meta.w - meta.ax);
  maxY = Math.max(maxY, meta.h - meta.ay);
  const bw = maxX - minX;
  const bh = maxY - minY;
  const s = Math.min(132 / bw, 94 / bh);
  const ox = (144 - bw * s) / 2 - minX * s;
  const oy = (104 - bh * s) / 2 - minY * s;
  if (images[meta.p]) {
    g.drawImage(
      images[meta.p], meta.x, meta.y, meta.w, meta.h,
      Math.round(ox - meta.ax * s), Math.round(oy - meta.ay * s),
      Math.round(meta.w * s), Math.round(meta.h * s),
    );
  }
  return c;
}

function drawFieldThumb(g, def) {
  const ox = 72;
  const oy = 37;
  const z = 0.76;
  const hw = 32 * z;
  const hh = 16 * z;
  const centers = [
    [ox, oy + hh],
    [ox + hw, oy + hh * 2],
    [ox - hw, oy + hh * 2],
    [ox, oy + hh * 3],
  ];
  const tones = ['#4a3625', '#523d2b', '#433020', '#4e3927'];
  centers.forEach(([cx, cy], i) => {
    g.fillStyle = tones[i];
    drawDiamond(g, cx, cy, hw, hh);
    g.fill();
  });
  g.strokeStyle = 'rgba(19, 13, 8, 0.65)';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(ox, oy);
  g.lineTo(ox + hw * 2, oy + hh * 2);
  g.lineTo(ox, oy + hh * 4);
  g.lineTo(ox - hw * 2, oy + hh * 2);
  g.closePath();
  g.stroke();

  const spots = [
    [ox, oy],
    [ox + hw, oy + hh],
    [ox - hw, oy + hh],
    [ox, oy + hh * 2],
  ];
  const s = 0.38;
  spots.forEach(([sx, sy], i) => {
    const meta = data.sprites[`c:${def.crop}:3:${i % 2}`];
    if (!meta || !images[meta.p]) return;
    g.drawImage(
      images[meta.p], meta.x, meta.y, meta.w, meta.h,
      Math.round(sx - meta.ax * s), Math.round(sy - meta.ay * s),
      Math.round(meta.w * s), Math.round(meta.h * s),
    );
  });

  g.fillStyle = 'rgba(242, 238, 221, 0.2)';
  g.fillRect(ox - hw * 2, oy + hh * 4 - 1, 2, 2);
  g.fillRect(ox + hw * 2 - 2, oy + hh * 2 - 1, 2, 2);
}

function cardLock(type, def) {
  if (!state || !def) return null;
  const level = state.review.level || 1;
  const needLevel = unlockLevelOf(def);
  if (needLevel > level) {
    return {
      text: `Lv.${needLevel}`,
      reason: `小镇达到 Lv.${needLevel} 后解锁${def.name}（当前 Lv.${level}）`,
    };
  }
  if (def.unlockPoints && reviewPoints(state) < def.unlockPoints) {
    return {
      text: `评分 ${def.unlockPoints}`,
      reason: `需要 ${def.unlockPoints} 评分才能建造${def.name}（当前 ${Math.floor(reviewPoints(state))}）`,
    };
  }
  if (def.requireFlag && !state.flags?.[def.requireFlag]) {
    return {
      text: '未解锁',
      reason: def.requireFlagReason || `尚未解锁${def.name}`,
    };
  }
  if (def.unique && state.objects.some((o) => o.type === type)) {
    return { text: '已建成', reason: `${def.name}全镇唯一，已经建好了` };
  }
  return null;
}

function refreshAffordability() {
  if (!state) return;
  for (const [type, el] of cardEls) {
    const def = defOf(type);
    if (!def) continue;
    const lock = cardLock(type, def);
    el.classList.toggle('locked', !!lock);
    el.classList.toggle('poor', !lock && state.coins < def.cost);
    const lockEl = el.querySelector('.lock');
    if (lockEl) {
      const text = lock ? lock.text : '';
      if (lockEl.textContent !== text) lockEl.textContent = text;
    }
    el.title = lock ? lock.reason : (def.desc || def.name);
    el.setAttribute('aria-label', `${def.name}，${def.cost} 金币${lock ? `，${lock.text}` : ''}`);
  }
}

function syncToolUI() {
  document.querySelectorAll('.tool-btn[data-tool]').forEach((btn) => {
    btn.classList.toggle('active', ui.tool?.kind === btn.dataset.tool);
  });
  if (els.roadStyles) {
    els.roadStyles.hidden = ui.tool?.kind !== 'road';
    const activeStyle = ui.tool?.kind === 'road' ? (ui.tool.style || ui.roadStyle) : ui.roadStyle;
    els.roadStyles.querySelectorAll('[data-style]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.style === activeStyle);
    });
    const roadBtn = document.querySelector('.tool-btn[data-tool="road"]');
    if (roadBtn) {
      const style = roadStyleOf(ui.roadStyle);
      roadBtn.querySelector('em').textContent = `${style.cost}·${BRIDGE_COST}`;
      roadBtn.title = `${style.name}路面 ${style.cost} / 木桥 ${BRIDGE_COST}`;
      roadBtn.setAttribute('aria-label', `${style.name}路面 ${style.cost} 金币，木桥 ${BRIDGE_COST} 金币`);
    }
  }
  for (const [type, el] of cardEls) {
    el.classList.toggle('active', ui.tool?.kind === 'build' && ui.tool.type === type);
  }
  const buildDef = ui.tool?.kind === 'build' ? defOf(ui.tool.type) : null;
  const sel = !ui.tool && ui.selectedId ? objectById(state, ui.selectedId) : null;
  const canRotate = isRotatable(buildDef) || isRotatable(defOf(sel?.type));
  if (els.btnRotate) {
    els.btnRotate.classList.toggle('enabled', canRotate);
    els.btnRotate.classList.toggle('unavailable', !!ui.tool && !canRotate);
    els.btnRotate.setAttribute('aria-disabled', canRotate ? 'false' : 'true');
    els.btnRotate.title = canRotate
      ? `旋转朝向（当前 ${((sel?.rot ?? ui.rot) || 0) * 90}°）· 快捷键 Q / E`
      : '先选择一个可转向的物件';
    const em = els.btnRotate.querySelector('em');
    if (em) em.textContent = canRotate ? `${((sel?.rot ?? ui.rot) || 0) * 90}°` : 'Q';
  }
  els.cancelTool.hidden = !ui.tool;
  if (els.cancelTool) {
    els.cancelTool.textContent = ui.tool?.kind === 'move' ? '退出移动 ×' : '退出建造 ×';
  }
  syncPlaceBar();
  surface().classList.toggle('brush', !!ui.tool);
}

function syncPlaceBar() {
  if (!els.placeBar) return;
  els.placeBar.hidden = !ui.pending;
  if (!ui.pending) {
    els.placeBar.classList.remove('lift');
    return;
  }
  refreshPlaceBarLabel();
  positionPlaceBar();
}

function refreshPlaceBarLabel() {
  if (!els.placeBar || !ui.pending) return;
  if (ui.pending.kind === 'road') {
    const cost = ui.ghost?.cost || 0;
    els.placeConfirm.textContent = cost > 0 ? `✓ 铺路 ${fmt(cost)}` : '✓ 铺路';
    els.placeCancel.textContent = '✗ 取消';
    return;
  }
  els.placeConfirm.textContent = ui.pending.kind === 'move' ? '✓ 移到这里' : '✓ 放置';
  els.placeCancel.textContent = '✗ 取消';
}

// The bar sits just above the dock, right where fingers tap the map. If the
// pending tile lands under it, lift the bar so it never covers the ghost (or
// the spot the same finger just tapped).
function positionPlaceBar() {
  if (!els.placeBar || !ui.pending || !engine) return;
  els.placeBar.classList.remove('lift');
  const road = ui.pending.kind === 'road';
  const cell = road ? { x: ui.pending.x1, y: ui.pending.y1 } : ui.pending;
  const rect = els.placeBar.getBoundingClientRect();
  const canvasRect = surface().getBoundingClientRect();
  const point = engine.tileToScreen(cell.x + 0.5, cell.y + 0.5);
  const ghostTop = canvasRect.top + point.y - (road ? 18 : GHOST_CLEAR_ABOVE);
  const ghostBottom = canvasRect.top + point.y + GHOST_CLEAR_BELOW;
  if (ghostBottom > rect.top - 16 && ghostTop < rect.bottom + 16) {
    els.placeBar.classList.add('lift');
  }
}

// A road run is a straight line. The four legal directions are the two tile
// axes plus the two screen diagonals; the drag picks whichever it points at
// most closely, then snaps to whole tiles.
function roadLineTiles(x0, y0, x1, y1) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  if (!dx && !dy) return [[x0, y0]];
  const dirs = [[1, 0], [0, 1], [1, -1], [1, 1]];
  let best = dirs[0];
  let bestLen = -1;
  for (const [ux, uy] of dirs) {
    const len = Math.abs((dx * ux + dy * uy) / Math.hypot(ux, uy));
    if (len > bestLen) {
      bestLen = len;
      best = [ux, uy];
    }
  }
  // Steps are counted in whole tiles along the chosen direction, so a finger
  // released on (x+2, y+2) ends the run there instead of one diagonal past it.
  const along = (dx * best[0] + dy * best[1]) / (best[0] * best[0] + best[1] * best[1]);
  const sign = along < 0 ? -1 : 1;
  const stepX = best[0] * sign;
  const stepY = best[1] * sign;
  const n = Math.round(Math.abs(along));
  const out = [[x0, y0]];
  for (let i = 1; i <= n; i += 1) out.push([x0 + stepX * i, y0 + stepY * i]);
  return out;
}

function startRoadRun(x, y) {
  if (!state || ui.tool?.kind !== 'road') return false;
  const style = ui.tool.style || ui.roadStyle;
  const plan = roadRunPlan(state, [[x, y]], style);
  if (!plan.ok) {
    warn(plan.reason || plan.blocked || '这里不能铺路');
    return false;
  }
  ui.pending = { kind: 'road', x0: x, y0: y, x1: x, y1: y, cost: 0 };
  ui.pendingAt = performance.now();
  setRoadEnd({ x, y });
  syncPlaceBar();
  audio?.play('click');
  showHint('拖动或点第二个位置拉直线 · ✓ 铺路 · ✗ 取消', UI.HINT_PLACE_MS);
  return true;
}

function setRoadEnd(t) {
  if (!ui.pending || ui.pending.kind !== 'road' || !state) return;
  const line = roadLineTiles(ui.pending.x0, ui.pending.y0, t.x, t.y);
  const style = ui.tool?.style || ui.roadStyle;
  const plan = roadRunPlan(state, line, style);
  const end = plan.line.length ? plan.line[plan.line.length - 1] : [ui.pending.x0, ui.pending.y0];
  ui.pending.x1 = end[0];
  ui.pending.y1 = end[1];
  ui.pending.cost = plan.cost;
  ui.hover = { x: end[0], y: end[1] };
  ui.ghost = {
    x: end[0],
    y: end[1],
    ok: plan.ok,
    reason: plan.reason || plan.blocked || '',
    cost: plan.cost,
    cells: plan.cells.map((c) => [c.x, c.y]),
    line: plan.line,
    style,
  };
  refreshPlaceBarLabel();
  positionPlaceBar();
}

function setTool(tool) {
  if (!state) return;
  const prev = ui.tool;
  if (tool?.kind === 'build' && isRotatable(defOf(tool.type))
    && (!prev || prev.kind !== 'build' || prev.type !== tool.type)) {
    ui.rot = 0;
  }
  ui.tool = tool;
  ui.pending = null;
  ui.selectedId = null;
  els.inspector.hidden = true;
  ui.ghost = null;
  ui.demolishTarget = null;
  syncToolUI();

  if (!tool) {
    ui.hover = null;
    showHint(DEFAULT_HINT, UI.HINT_STEP_MS);
    audio?.play('click');
    return;
  }

  const def = tool.kind === 'build' ? defOf(tool.type) : null;
  if (tool.kind === 'build' && def) {
    const turn = isRotatable(def) ? ' · Q/E 或“朝向”旋转' : '';
    showHint(`点击空地出现 ${def.name} 虚影（${fmt(def.cost)} 金币）· 拖动微调 · ✓ 放置${turn}`, UI.HINT_PLACE_MS);
  } else if (tool.kind === 'move') {
    const moving = objectById(state, tool.id);
    const name = moving ? defOf(moving.type)?.name : '';
    showHint(`${name ? `移动 ${name}` : '移动建筑'} · 点空地选新位置 · 拖动微调 · ✓ 确认 · ✗ 取消`, UI.HINT_PLACE_MS);
  } else if (tool.kind === 'road') {
    tool.style = ui.roadStyle;
    showHint(roadHint(roadStyleOf(tool.style)), UI.HINT_TOOL_MS);
  } else if (tool.kind === 'pave') {
    showHint(`铺地只改变外观 · 每格 ${PAVE_COST} 金币 · 不提供通路`, UI.HINT_TOOL_MS);
  } else if (tool.kind === 'demolish') {
    showHint('点击或拖动拆除 · 自建建筑返还 25% 造价 · 清理树木等自然物要付清理费 · 道路与铺地无返还', UI.HINT_DEMOLISH_MS);
  }
  audio?.play('click');
  if (lastPointer) updateGhostAt(lastPointer.x, lastPointer.y);
}

function rotateBy(step = 1) {
  if (!state) return;
  const buildDef = ui.tool?.kind === 'build' ? defOf(ui.tool.type) : null;
  if (buildDef) {
    if (!isRotatable(buildDef)) {
      warn(`${buildDef.name}没有可转向的外观`);
      return;
    }
    ui.rot = ((ui.rot + step) % 4 + 4) % 4;
    syncToolUI();
    audio?.play('click');
    showHint(`朝向 ${ui.rot * 90}° · 只是外观变化，不改变占地与道路判定`, UI.HINT_ROTATE_MS);
    if (lastPointer) updateGhostAt(lastPointer.x, lastPointer.y);
    return;
  }
  const o = !ui.tool && ui.selectedId ? objectById(state, ui.selectedId) : null;
  if (o) {
    const result = rotateObject(state, o, step);
    if (!result.ok) {
      warn(result.reason);
      return;
    }
    audio?.play('click');
    save();
    renderInspector(true);
    syncToolUI();
    if (lastPointer) updateGhostAt(lastPointer.x, lastPointer.y);
    return;
  }
  showHint('先选中一个物件，或进入建造模式后再转向', UI.HINT_ROTATE_WARN_MS);
}

function setCategorySilently(id) {
  category = id;
  els.catTabs.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.cat === id);
  });
  buildCards();
}

function showHint(text, ms = UI.HINT_DEFAULT_MS) {
  els.hintText.textContent = text;
  els.hint.classList.remove('hidden');
  clearTimeout(hintTimer);
  hintIsGuide = ms === 0;
  if (ms > 0) {
    hintTimer = setTimeout(() => {
      els.hint.classList.add('hidden');
      if (guide.key && hintMuted !== guide.key) showHint(guide.text, 0);
    }, ms);
  }
}

function guideFocusEl(focus) {
  if (focus === 'review') return $('btnReview');
  if (focus === 'road') return document.querySelector('.tool-btn[data-tool="road"]');
  if (focus === 'sell' || focus === 'build' || focus === 'grow' || focus === 'raise' || focus === 'process') {
    return document.querySelector(`#catTabs .tab[data-cat="${focus}"]`);
  }
  return null;
}

function updateGuide() {
  if (!state || intro.active) return;
  if (dev.hideGuide) {
    if (guide.key) {
      guide.key = '';
      guide.text = '';
      guide.focus = null;
      document.querySelectorAll('.needs-attention').forEach((el) => el.classList.remove('needs-attention'));
      if (hintIsGuide) showHint(DEFAULT_HINT, UI.HINT_STEP_MS);
    }
    return;
  }
  const level = state.review?.level || 1;
  const guideFor = { 1: lv1Guide, 2: lv2Guide, 3: lv3Guide, 4: lv4Guide, 5: lv5Guide, 6: lv6Guide, 7: lv7Guide, 8: lv8Guide, 9: lv9Guide, 10: lv10Guide };
  const next = guideFor[level]?.(state) || null;
  const key = next?.key || '';
  if (key === guide.key) {
    if (next && next.text !== guide.text) {
      guide.text = next.text;
      if (hintIsGuide) showHint(next.text, 0);
    }
    return;
  }
  guide.key = key;
  guide.text = next?.text || '';
  guide.focus = next?.focus || null;
  hintMuted = '';
  document.querySelectorAll('.needs-attention').forEach((el) => el.classList.remove('needs-attention'));
  const target = guideFocusEl(guide.focus);
  if (target) target.classList.add('needs-attention');
  if (next) showHint(next.text, 0);
  else if (hintIsGuide) showHint(DEFAULT_HINT, UI.HINT_STEP_MS);
}

// ---------------------------------------------------------------------------
// Onboarding coach marks. Three steps, non-blocking: the ring never takes
// pointer events and any pointerdown advances, so play continues underneath.

function introTarget(step) {
  if (!state) return null;
  if (step === 0) {
    const o = state.objects.find((x) => x.type === 'tollGate');
    return o ? { object: o } : null;
  }
  if (step === 1) {
    const o = state.objects.find((x) => x.type === 'fryShack');
    return o ? { object: o } : null;
  }
  const el = $('btnReview');
  if (el && el.offsetParent) return { el };
  const tracker = $('questTracker');
  return tracker ? { el: tracker } : null;
}

function introRect(step) {
  const target = introTarget(step);
  if (!target || !engine) return null;
  if (target.object) {
    const o = target.object;
    const pts = [
      engine.tileToScreen(o.x, o.y),
      engine.tileToScreen(o.x + o.w, o.y),
      engine.tileToScreen(o.x + o.w, o.y + o.d),
      engine.tileToScreen(o.x, o.y + o.d),
    ];
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }
  if (!target.el || !target.el.offsetParent) return null;
  const r = target.el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

function positionIntroRing() {
  if (!els.coach || !els.coachRing) return;
  if (!intro.active) {
    els.coach.hidden = true;
    return;
  }
  const rect = introRect(intro.step);
  if (!rect || rect.width < 6 || rect.height < 6) {
    els.coachRing.style.visibility = 'hidden';
    return;
  }
  const pad = 5;
  els.coach.hidden = false;
  els.coachRing.style.visibility = 'visible';
  els.coachRing.style.left = `${Math.round(rect.left - pad)}px`;
  els.coachRing.style.top = `${Math.round(rect.top - pad)}px`;
  els.coachRing.style.width = `${Math.round(rect.width + pad * 2)}px`;
  els.coachRing.style.height = `${Math.round(rect.height + pad * 2)}px`;
  const badge = els.coachRing.querySelector('.coach-step');
  if (badge) badge.textContent = `${intro.step + 1}/${INTRO_STEPS.length}`;
}

function showPrologueScene(index) {
  const last = PROLOGUE_SCENES.length - 1;
  const next = Math.max(0, Math.min(last, index));
  const scene = PROLOGUE_SCENES[next];
  prologue.scene = next;
  if (els.prologueArt) els.prologueArt.dataset.scene = String(next);
  if (els.prologueKicker) els.prologueKicker.textContent = scene.kicker;
  if (els.prologueTitle) els.prologueTitle.textContent = scene.title;
  if (els.prologueText) els.prologueText.textContent = scene.text;
  if (els.prologueCopy) {
    els.prologueCopy.classList.remove('is-in');
    void els.prologueCopy.offsetWidth;
    els.prologueCopy.classList.add('is-in');
  }
  if (els.prologueNext) {
    const done = next === last;
    els.prologueNext.textContent = done ? '开始' : '跳过';
    els.prologueNext.setAttribute('aria-label', done ? '开始游戏' : '跳过开场');
  }
}

function schedulePrologue() {
  window.clearTimeout(prologue.timer);
  if (!prologue.active || prologue.scene >= PROLOGUE_SCENES.length - 1) return;
  prologue.timer = window.setTimeout(() => {
    if (!prologue.active) return;
    showPrologueScene(prologue.scene + 1);
    schedulePrologue();
  }, PROLOGUE_SCENE_MS);
}

function startPrologue() {
  if (!state || prologue.active) return;
  if (!els.prologue) return;
  if (state.settings && state.settings.prologueSeen) {
    startIntro();
    return;
  }
  prologue.active = true;
  els.prologue.hidden = false;
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    showPrologueScene(PROLOGUE_SCENES.length - 1);
  } else {
    showPrologueScene(0);
    schedulePrologue();
  }
}

function finishPrologue() {
  const wasActive = prologue.active;
  window.clearTimeout(prologue.timer);
  prologue.timer = 0;
  prologue.active = false;
  prologue.scene = 0;
  if (els.prologue) els.prologue.hidden = true;
  if (state) {
    state.settings = state.settings || {};
    state.settings.prologueSeen = true;
    if (wasActive) save();
  }
  // Hand straight over to the three coach marks; the opener replaces them, it
  // does not replace the actual tutorial.
  if (wasActive) startIntro();
}

function startIntro() {
  if (!state || intro.active || !els.coach) return;
  if (state.settings && state.settings.introSeen) return;
  if (!els.modal.hidden) {
    intro.pending = true;
    return;
  }
  intro.pending = false;
  intro.active = true;
  intro.step = -1;
  els.coach.hidden = false;
  if (els.hintKey) els.hintKey.textContent = '引导';
  advanceIntro();
}

function advanceIntro() {
  if (!intro.active) return;
  intro.step += 1;
  if (intro.step >= INTRO_STEPS.length) {
    finishIntro();
    return;
  }
  showHint(INTRO_STEPS[intro.step], 0);
  positionIntroRing();
}

function finishIntro() {
  const wasActive = intro.active;
  intro.active = false;
  intro.pending = false;
  intro.step = -1;
  intro.acc = 0;
  if (els.coach) els.coach.hidden = true;
  if (els.hintKey) els.hintKey.textContent = '操作';
  if (state) {
    state.settings = state.settings || {};
    state.settings.introSeen = true;
    save();
  }
  if (wasActive) showHint(DEFAULT_HINT, UI.HINT_WELCOME_MS);
}

// ---------------------------------------------------------------------------
// HUD

function updateHud(force = false) {
  if (!state) return;
  const points = reviewPoints(state);
  const need = nextLevelNeed(state);
  els.coins.textContent = fmt(state.coins);
  els.reviewVal.textContent = fmt(points);
  els.reviewLevel.textContent = `Lv.${state.review.level} 评分`;
  els.reviewCount.textContent = need ? `${Math.floor(points)}/${need}` : `${Math.floor(points)} · 满级`;
  els.clockVal.textContent = clockText(state);
  els.dayVal.textContent = `第 ${state.day} 天`;
  if (els.coinAd) els.coinAd.title = `看广告领取 ${fmt(coinAdReward())} 金币`;
  updateSpeedButton();

  if (force) {
    lastCoins = state.coins;
  } else if (state.coins !== lastCoins) {
    if (state.coins > lastCoins) {
      els.coins.classList.remove('pulse');
      void els.coins.offsetWidth;
      els.coins.classList.add('pulse');
      clearTimeout(coinPulseTimer);
      coinPulseTimer = setTimeout(() => els.coins.classList.remove('pulse'), UI.COIN_PULSE_MS);
    }
    lastCoins = state.coins;
  }
  refreshAffordability();
  if (openDrawerId === 'devPanel') renderDevStatus();
}

function syncQuestPanel() {
  if (!els.questTracker) return;
  const collapsed = state?.settings?.questCollapsed === true;
  els.questTracker.classList.toggle('collapsed', collapsed);
  els.questToggle?.setAttribute('aria-expanded', String(!collapsed));
}

function renderQuest() {
  if (!state) return;
  syncQuestPanel();
  const list = missionList(state);
  const open = list.filter((m) => !m.locked);
  const done = open.filter((m) => m.done).length;
  els.missionCount.textContent = `${done}/${open.length}`;

  const current = open.find((m) => !m.done);
  if (!current) {
    const nextLock = list.find((m) => m.locked);
    setHTML(els.questMain, nextLock
      ? `<span class="quest-all-done">本等级目标完成 · Lv.${nextLock.level} 解锁「${nextLock.title}」</span>`
      : '<span class="quest-all-done">全部目标完成 · 小镇自由发展</span>');
    setHTML(els.questNext, '');
    return;
  }

  const bar = pct(current.cur, current.target);
  setHTML(
    els.questMain,
    `<span class="q-title">${current.title}</span>` +
    `<span class="q-reward">+${fmt(current.reward)}</span>` +
    `<div class="q-progress"><div class="q-bar"><i style="width:${bar.toFixed(1)}%"></i></div><span>${current.cur}/${current.target}</span></div>`,
  );
  const next = open.find((m) => !m.done && m.id !== current.id);
  setHTML(els.questNext, next ? `下个目标 · <b>${next.title}</b>` : '本等级目标已完成 · 晋升后继续');
}

function renderMissions() {
  if (!state) return;
  const list = missionList(state);
  const currentId = list.find((m) => !m.done && !m.locked)?.id || null;
  const html = list.map((m, i) => {
    const bar = pct(m.cur, m.target);
    const meta = m.locked
      ? `<div class="m-meta"><span>Lv.${m.level} 解锁</span><span>未开放</span></div>`
      : `<div class="m-bar"><i style="width:${bar.toFixed(1)}%"></i></div>
        <div class="m-meta"><span>${m.cur}/${m.target}</span><span class="${m.done ? 'done-tag' : ''}">${m.done ? '已完成' : m.cur >= m.target ? '结算中' : '进行中'}</span></div>`;
    return `<article class="mission${m.id === currentId ? ' current' : ''}${m.done ? ' done' : ''}${m.locked ? ' locked' : ''}">
      <span class="m-idx">${m.done ? '\u2713' : String(i + 1).padStart(2, '0')}</span>
      <div class="m-top"><b>${m.title}</b>${m.locked ? `<i class="m-lock">Lv.${m.level}</i>` : ''}<em>+${fmt(m.reward)}</em></div>
      <p>${m.hint}</p>
      ${meta}
    </article>`;
  }).join('');
  setHTML(els.missionList, html);
}

function renderStore() {
  if (!state) return;
  const warehouses = state.objects.filter((o) => o.type === 'warehouse' && o.connected).length;
  const restaurants = state.objects.filter((o) => defOf(o.type)?.sale && o.connected).length;
  const roads = Object.keys(state.roads).length;
  const built = state.objects.filter((o) => !o.natural).length;
  const points = Math.floor(reviewPoints(state));

  let html = `<div class="store-summary">
    <div><small>金币</small><b class="gold">${fmt(state.coins)}</b></div>
    <div><small>仓储上限</small><b>${state.cap}</b></div>
    <div><small>评分</small><b>${fmt(points)}</b></div>
  </div>
  <div class="store-caption"><span>原料 / 半成品</span><em>每格上限 ${state.cap}</em></div>`;

  for (const res of RES_ORDER) {
    const info = RESOURCES[res];
    const amount = state.res[res] || 0;
    const fill = pct(amount, state.cap);
    html += `<div class="res-row" style="--res-color:${info.color}">
      <span class="res-glyph">${info.short}</span>
      <span class="res-name">${info.name}</span>
      <div class="res-bar"><i style="width:${fill.toFixed(1)}%"></i></div>
      <span class="res-count"><b>${fmt(amount)}</b>/${state.cap}</span>
    </div>`;
  }

  html += `<div class="store-note"><b>冷库</b>每座通路冷库让所有原料上限 +20，目前有 ${warehouses} 座在运转。土豆田和小麦田会自动补货，餐馆要等顾客排队才会开火。</div>`;
  html += `<div class="store-caption"><span>小镇账本</span><em>本档累计</em></div>
  <div class="store-stats">
    <div><span>薯条销量</span><b>${fmt(state.stats.friesSold)}</b></div>
    <div><span>汉堡销量</span><b>${fmt(state.stats.burgersSold)}</b></div>
    <div><span>炸鸡销量</span><b>${fmt(state.stats.friedChickenSold)}</b></div>
    <div><span>热狗销量</span><b>${fmt(state.stats.hotdogsSold)}</b></div>
    <div><span>小龙虾销量</span><b>${fmt(state.stats.crayfishSold)}</b></div>
    <div><span>螺蛳粉销量</span><b>${fmt(state.stats.luosifenSold)}</b></div>
    <div><span>熟食销量</span><b>${fmt(state.stats.deliSold)}</b></div>
    <div><span>披萨销量</span><b>${fmt(state.stats.pizzasSold)}</b></div>
    <div><span>招牌汉堡销量</span><b>${fmt(state.stats.signatureSold)}</b></div>
    <div><span>累计收入</span><b>${fmt(state.stats.coinsEarned)}</b></div>
    <div><span>累计支出</span><b>${fmt(state.stats.spent)}</b></div>
    <div><span>接待顾客</span><b>${fmt(state.stats.served)}</b></div>
    <div><span>流失顾客</span><b>${fmt(state.stats.customersLost)}</b></div>
    <div><span>过路费</span><b>${fmt(state.stats.tollEarned)}</b></div>
    <div><span>评分官到访</span><b>${fmt(state.stats.reviewers)}</b></div>
    <div><span>营运餐馆</span><b>${restaurants}</b></div>
    <div><span>道路格数</span><b>${fmt(roads)}</b></div>
    <div><span>已建建筑</span><b>${fmt(built)}</b></div>
    <div><span>已办美食节</span><b>${fmt(state.stats.festivals)}</b></div>
  </div>`;
  setHTML(els.storeList, html);
}

// ---------------------------------------------------------------------------
// Review board: four dimensions, hall, festival, and the sixteen-plot map.

function renderReview() {
  if (!state) return;
  const points = Math.floor(reviewPoints(state));
  const level = state.review.level || 1;
  const need = nextLevelNeed(state);
  const hall = reviewHall(state);
  const check = canStartFestival(state);
  const capReached = !!need && reviewPoints(state) >= reviewCap(state);
  const dimMax = Math.max(
    REVIEW_HALL_UNLOCK,
    need || 0,
    ...REVIEW_KEYS.map((k) => state.review[k.key] || 0),
  );
  const levelBar = need ? pct(points, need) : 100;

  let html = `<div class="review-hero">
    <div class="rh-level"><b>${level}</b><small>小镇等级</small></div>
    <div class="rh-main">
      <div class="rh-line"><b id="rvPoints">${fmt(points)}</b><span>总评分${need ? ` · 下一级 ${need}` : ' · 已满级'}</span></div>
      <div class="rh-bar"><i id="rvLevelBar" style="width:${levelBar.toFixed(1)}%"></i></div>
      <div class="rh-next" id="rvNext">${need ? (capReached ? `本级上限 ${need} 已达 · 办美食节晋升 Lv.${level + 1}` : `距离 Lv.${level + 1} 还差 ${Math.max(0, need - points)} 分`) : '评委会已经无话可说，继续把小镇做大吧'}</div>
    </div>
  </div>

  <div class="review-dims">`;

  for (const key of REVIEW_KEYS) {
    const value = Math.floor(state.review[key.key] || 0);
    html += `<div class="review-dim" style="--dim:${key.color}">
      <div class="rd-top"><span>${key.name}</span><b id="rvDim-${key.key}">${fmt(value)}</b></div>
      <div class="rd-bar"><i id="rvBar-${key.key}" style="width:${pct(value, dimMax).toFixed(1)}%"></i></div>
      <small>${key.hint}</small>
    </div>`;
  }
  html += '</div>';

  const chain = levelChainStatus(state);
  if (chain.items.length) {
    const chainDone = chain.items.filter((item) => item.done).length;
    html += `<div id="rvChainSection" class="review-section ${chain.done ? 'ready' : 'warn'}">
      <div class="review-sec-head"><span>开店准备</span><em id="rvChainCount">${chainDone}/${chain.items.length}</em></div>
      <ul class="chain-list">`;
    for (const item of chain.items) {
      html += `<li id="rvChain-${item.id}" class="chain-item${item.done ? ' done' : ''}">
        <b>${item.label}</b><span id="rvChainVal-${item.id}">${item.cur}/${item.target}</span>
      </li>`;
    }
    html += `</ul>
      <p id="rvChainNote" class="review-note">${chain.done ? '这些都建好了。' : '报名美食节前，要把这些建好。'}</p>
    </div>`;
  }

  // Review hall
  let hallTone = 'ok';
  let hallTitle = '大厅运转中';
  let hallSub = `已举办 ${state.review.festivals || 0} 届美食节`;
  let hallAct = hall ? '<button class="btn" type="button" data-act="hall">查看大厅</button>' : '';
  if (!hall && points < REVIEW_HALL_UNLOCK) {
    hallTone = 'locked';
    hallTitle = `${REVIEW_HALL_UNLOCK} 分解锁`;
    hallSub = '评分达标后，评分大厅会出现在「基建」分类里。';
    hallAct = '';
  } else if (!hall) {
    hallTone = 'ready';
    hallTitle = '评分大厅已解锁';
    hallSub = '去「基建」建造 4×4 大厅，并把它接到道路边。';
    hallAct = '<button class="btn primary" type="button" data-act="buildHall">去建造大厅</button>';
  } else if (!hall.connected) {
    hallTone = 'warn';
    hallTitle = '大厅还没接上道路';
    hallSub = '铺一格道路贴住大厅任意一边，才能举办美食节。';
    hallAct = '<button class="btn primary" type="button" data-act="road">去铺路</button>';
  }

  html += `<div class="review-section ${hallTone}">
    <div class="review-sec-head"><span>评分大厅</span><em>${hallTone === 'ok' ? 'READY' : hallTone === 'warn' ? 'NO ROAD' : hallTone === 'ready' ? 'UNLOCKED' : 'LOCKED'}</em></div>
    <div class="hall-state"><b>${hallTitle}</b><p>${hallSub}</p>${hallAct}</div>
  </div>`;

  // Food festival
  const f = state.festival;
  html += `<div class="review-section ${f ? 'live' : ''}">
    <div class="review-sec-head"><span>美食节</span><em>${f ? 'LIVE' : level >= MAX_LEVEL ? 'MAX' : 'FESTIVAL'}</em></div>`;
  if (f) {
    html += `<div id="rvFestLive" class="festival-live">
      <div class="fl-head"><b>进行中</b><span id="rvTime">${Math.ceil(f.remaining)}s</span></div>
      <div class="fl-bar"><i id="rvBarLive" style="width:${pct(f.served, f.target).toFixed(1)}%"></i></div>
      <div class="fl-meta"><span id="rvCount">${f.served}/${f.target} 位</span><span>达标后倒计时结束晋升</span></div>
    </div>`;
  } else if (level >= MAX_LEVEL) {
    html += `<p class="review-note">已经是 Lv.${MAX_LEVEL}，评委会只想再来吃一份薯条。</p>`;
  } else {
    html += `<div class="festival-terms">
      <div><small>限时</small><b>${FESTIVAL_TIME}s</b></div>
      <div><small>目标</small><b>${festivalTarget(state)} 位</b></div>
      <div><small>报名费</small><b>${FESTIVAL_COST}</b></div>
      <div><small>奖励</small><b>${fmt(FESTIVAL_REWARD)} + Lv.${level + 1}</b></div>
    </div>
    <button id="rvStart" class="btn primary wide${check.ok ? '' : ' blocked'}" type="button" data-act="festival">开启美食节 · -${FESTIVAL_COST} 金币</button>
    <p id="rvStartReason" class="review-reason">${check.ok ? '达标后晋升，并开放对应等级的新地块' : check.reason}</p>`;
  }
  html += '</div>';

  // Plot map
  const open = unlockedPlots(state);
  html += `<div class="review-section">
    <div class="review-sec-head"><span>小岛地图</span><em>${open.length}/${PLOTS.length} 已开放</em></div>
    <div class="plot-map">`;
  for (const p of PLOTS) {
    const unlocked = plotUnlocked(state, p);
    html += `<button class="plot-cell${unlocked ? ' open' : ' locked'}${p.id === 'south' ? ' start' : ''}" type="button" data-plot="${p.id}">
      <span class="pc-top"><b>${p.name}</b></span>
      <span class="pc-state">${unlocked ? (p.id === 'south' ? '从这里起步' : '已开放') : `Lv.${p.rank} 开放`}</span>
    </button>`;
  }
  html += `</div>
    <div class="plot-note">点地名，去那边看看。升级后会开放更多地方。</div>
    <div class="level-ladder">`;
  for (let lv = 1; lv <= MAX_LEVEL; lv++) {
    const plotsAt = PLOTS.filter((p) => p.rank <= lv).length;
    html += `<div class="ladder-step${lv < level ? ' done' : ''}${lv === level ? ' now' : ''}">
      <b>Lv.${lv}</b><small>${lv === 1 ? '起点' : `${REVIEW_LEVEL_REQ[lv - 1]} 分`}</small><i>${plotsAt} 块</i>
    </div>`;
  }
  html += `</div>
  </div>`;

  setHTML(els.reviewList, html);
}

function updateReviewLive() {
  if (!state || openDrawerId !== 'reviewPanel') return;
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el && el.textContent !== text) el.textContent = text;
  };
  const points = Math.floor(reviewPoints(state));
  const need = nextLevelNeed(state);
  const dimMax = Math.max(REVIEW_HALL_UNLOCK, need || 0, ...REVIEW_KEYS.map((k) => state.review[k.key] || 0));
  setText('rvPoints', fmt(points));
  setText('rvNext', need
    ? (points >= reviewCap(state)
      ? `本级上限 ${need} 已达 · 办美食节晋升 Lv.${state.review.level + 1}`
      : `距离 Lv.${state.review.level + 1} 还差 ${Math.max(0, need - points)} 分`)
    : '评委会已经无话可说，继续把小镇做大吧');
  const levelBar = document.getElementById('rvLevelBar');
  if (levelBar) levelBar.style.width = `${(need ? pct(points, need) : 100).toFixed(1)}%`;
  for (const key of REVIEW_KEYS) {
    const value = Math.floor(state.review[key.key] || 0);
    setText(`rvDim-${key.key}`, fmt(value));
    const bar = document.getElementById(`rvBar-${key.key}`);
    if (bar) bar.style.width = `${pct(value, dimMax).toFixed(1)}%`;
  }

  const chain = levelChainStatus(state);
  if (chain.items.length) {
    let done = 0;
    for (const item of chain.items) {
      if (item.done) done++;
      const li = document.getElementById(`rvChain-${item.id}`);
      if (li) li.classList.toggle('done', item.done);
      setText(`rvChainVal-${item.id}`, `${item.cur}/${item.target}`);
    }
    setText('rvChainCount', `${done}/${chain.items.length}`);
    const section = document.getElementById('rvChainSection');
    if (section) {
      section.classList.toggle('ready', chain.done);
      section.classList.toggle('warn', !chain.done);
    }
    setText('rvChainNote', chain.done ? '这些都建好了。' : '报名美食节前，要把这些建好。');
  }

  const f = state.festival;
  if (f) {
    setText('rvTime', `${Math.ceil(f.remaining)}s`);
    setText('rvCount', `${f.served}/${f.target} 位`);
    const bar = document.getElementById('rvBarLive');
    if (bar) bar.style.width = `${pct(f.served, f.target).toFixed(1)}%`;
    return;
  }
  const start = document.getElementById('rvStart');
  if (!start) return;
  const check = canStartFestival(state);
  start.classList.toggle('blocked', !check.ok);
  setText('rvStartReason', check.ok ? '达标后晋升，并开放对应等级的新地块' : check.reason);
  setText('rvStart', `开启美食节 · -${FESTIVAL_COST} 金币`);
}

function renderFestival() {
  if (!state) return;
  const f = state.festival;
  const on = !!f;
  if (els.festivalBanner.hidden === on) els.festivalBanner.hidden = !on;
  els.hud.classList.toggle('festival-on', on);
  if (!f) return;
  const time = `${Math.ceil(f.remaining)}s`;
  const count = `${f.served}/${f.target}`;
  if (els.festTime.textContent !== time) els.festTime.textContent = time;
  if (els.festCount.textContent !== count) els.festCount.textContent = count;
  els.festBar.style.width = `${pct(f.served, f.target).toFixed(1)}%`;
  els.festBar.classList.toggle('done', f.served >= f.target);
}

function focusPlot(id) {
  const p = PLOT_BY_ID[id];
  if (!p || !engine) return;
  const zoom = Math.max(UI.FOCUS_ZOOM_MIN, Math.min(UI.FOCUS_ZOOM_MAX, Math.min(
    engine.viewW / (p.w * 64 + UI.FOCUS_PAD_X),
    (engine.viewH + UI.FOCUS_PAD_Y) / (p.d * 32 + UI.FOCUS_PAD_D),
  )));
  engine.centerOnTile(p.x + p.w / 2, p.y + p.d / 2, zoom);
  closeDrawers();
  if (!plotUnlocked(state, p)) {
    toast(`${p.name}要到 Lv.${p.rank} 才开放。`, 'warn', 3000);
  } else {
    toast(p.name, '', 2400);
  }
  audio?.play('click');
}

function focusObject(o) {
  if (!engine || !o) return;
  engine.centerOnTile(o.x + o.w / 2, o.y + o.d / 2, Math.max(UI.FOCUS_OBJECT_ZOOM_MIN, engine.cam.zoom));
  selectObject(o);
}

function startFestivalFlow() {
  if (!state) return;
  const check = canStartFestival(state);
  if (!check.ok) {
    warn(check.reason);
    return;
  }
  const events = [];
  const result = startFestival(state, events);
  if (!result.ok) {
    warn(result.reason);
    return;
  }
  handleEvents(events);
  updateHud(true);
  renderReview();
  renderFestival();
  save();
  closeInspector();
  audio?.play('mission');
}

// ---------------------------------------------------------------------------
// Developer panel. Every mutation refreshes the same caches as normal play so
// QA and hand testing see what the next frame will render.

function handleDevAction(action) {
  if (!state) return;
  switch (action) {
    case 'coins-10k':
      state.coins += 10000;
      devRefresh('金币 +1 万');
      break;
    case 'coins-max':
      state.coins = 1000000;
      devRefresh('金币已拉满 100 万');
      break;
    case 'res-20':
      devAddResources(20);
      devRefresh('全部资源 +20');
      break;
    case 'res-max':
      devAddResources(100);
      devRefresh('全部资源 +100');
      break;
    case 'res-clear':
      for (const id of RES_ORDER) state.res[id] = 0;
      devRefresh('仓库已清空');
      break;
    case 'review-100':
      devAddReview(100);
      devRefresh('评分 +100');
      break;
    case 'review-1000':
      devAddReview(1000);
      devRefresh('评分 +1000');
      break;
    case 'level-down':
      devSetLevel(state.review.level - 1);
      break;
    case 'level-up':
      devSetLevel(state.review.level + 1);
      break;
    case 'level-max':
      devSetLevel(MAX_LEVEL);
      break;
    case 'review-reset':
      state.review.taste = 0;
      state.review.crowd = 0;
      state.review.decor = 0;
      state.review.weird = 0;
      state.review.points = 0;
      devRefresh('评分已清零');
      break;
    case 'finish-builds':
      devFinishBuilds();
      break;
    case 'spawn':
      state.spawnTimer = 0;
      devRefresh('下一位顾客即将从南门进镇');
      break;
    case 'speed-boost':
      state.speed = 3;
      state.boostUntil = Date.now() + dev.boostMs;
      afterSpeedChange('3× 加速已开启 · 10 分钟（开发者）');
      renderDevStatus();
      break;
    case 'speed-5':
      state.speed = 5;
      state.boostUntil = 0;
      afterSpeedChange('5× 加速已开启（开发者）');
      renderDevStatus();
      break;
    case 'skip-intro':
      finishIntro();
      intro.active = false;
      if (els.coach) els.coach.hidden = true;
      devRefresh('已跳过新手引导');
      break;
    case 'replay-intro':
      closeDrawers(true);
      state.settings.introSeen = false;
      startIntro();
      break;
    case 'toggle-guide':
      dev.hideGuide = !dev.hideGuide;
      updateGuide();
      renderDevStatus();
      toast(dev.hideGuide ? '引导提示已隐藏' : '引导提示已恢复', 'good');
      break;
    case 'clear-customers':
      state.customers = [];
      devRefresh('场上顾客已清空');
      break;
    case 'reset':
      closeDrawers(true);
      confirmReset();
      break;
    default:
      break;
  }
}

function devAddResources(amount) {
  for (const id of RES_ORDER) state.res[id] = (state.res[id] || 0) + amount;
}

function devAddReview(amount) {
  const share = Math.max(1, Math.ceil(amount / 4));
  addReview(state, { taste: share, crowd: share, decor: share, weird: share });
}

function devSetLevel(level) {
  const next = Math.max(1, Math.min(MAX_LEVEL, Math.round(level)));
  if (next === state.review.level) {
    toast(`已经是 Lv.${next}`, 'warn');
    return;
  }
  state.review.level = next;
  addReview(state, {});
  state.flags = state.flags || {};
  state.flags.promoteReadyFor = 0;
  devRefresh(`小镇等级已设为 Lv.${next}`);
}

function devFinishBuilds() {
  const events = [];
  let count = 0;
  for (const o of state.objects) {
    if (finishConstruction(state, o, events)) count += 1;
  }
  handleEvents(events);
  devRefresh(count ? `已完成 ${count} 处施工` : '当前没有施工中的建筑');
}

function devRefresh(message) {
  updateHud(true);
  renderQuest();
  refreshAffordability();
  if (openDrawerId === 'storePanel') renderStore();
  if (openDrawerId === 'missionPanel') renderMissions();
  if (openDrawerId === 'reviewPanel') {
    renderReview();
    renderFestival();
  }
  updateInspector(true);
  renderDevStatus();
  save();
  if (message) toast(message, 'good');
}

function renderDevStatus() {
  if (!state || !els.devStatus) return;
  const points = Math.floor(reviewPoints(state));
  const need = nextLevelNeed(state);
  const builds = state.objects.filter((o) => !isBuilt(o)).length;
  const guests = (state.customers || []).length;
  els.devStatus.innerHTML =
    `<div><b>Lv.${state.review.level}</b><span>评分 ${fmt(points)}${need ? ` / ${fmt(need)}` : ' · 满级'}</span></div>` +
    `<div><span>金币 ${fmt(state.coins)}</span><span>顾客 ${guests}</span><span>施工 ${builds}</span></div>`;
  const toggle = els.devPanel.querySelector('[data-dev="toggle-guide"]');
  if (toggle) toggle.textContent = dev.hideGuide ? '恢复引导提示' : '隐藏引导提示';
}

function renderMenuState() {
  if (!state) return;
  els.musicState.textContent = state.settings.music && !systemMuted ? '开' : '关';
  els.soundState.textContent = state.settings.sound !== false && !systemMuted ? '开' : '关';
}

function syncAudioButtons() {
  if (!state) return;
  const on = state.settings.sound !== false && !systemMuted;
  $('btnSound').classList.toggle('off', !on);
  $('btnSound').setAttribute('aria-label', on ? '关闭音效' : '开启音效');
  $('btnSound').title = on ? '关闭音效' : '开启音效';
  renderMenuState();
}

// The player's own toggles stay in the save; the portal's muteAudio setting
// overrides them without rewriting the save.
function applyAudioSettings() {
  if (!state) return;
  audio?.setEnabled(state.settings.sound !== false && !systemMuted);
  audio?.setMusic(state.settings.music !== false);
}

const WORM_PHASE_HINT = {
  dormant: '沙面轻轻震，洞口的细沙在往下滑。',
  breach: '它顶开沙层，把沙往四周抛。',
  tower: '它把底下的沙翻上来，口器一开一合。',
  dive: '它往洞里钻回去，沙尘慢慢落下。',
  settle: '沙尘落定，洞口留下新的沙纹和碎壳。',
};

const OCTOPUS_PHASE_HINT = {
  lurk: '涡心很平静，水下能看见腕足慢慢挪动。',
  rise: '它从涡心浮上来，海水顺着身子往下淌。',
  spread: '八条腕足一起展开，吸盘蹭过礁石。',
  fold: '腕足一条条收回去，涡流重新合拢。',
  sink: '它沉回海里，水面只剩一圈波纹。',
};

function renderInspector(force = false) {
  if (!state) return;
  const o = objectById(state, ui.selectedId);
  if (!o) {
    closeInspector();
    return;
  }
  const def = defOf(o.type);
  if (!def) {
    closeInspector();
    return;
  }
  const st = statusOf(state, o);
  const cat = CATEGORIES.find((c) => c.id === def.cat);
  const chain = chainOf(def);
  const buildingNow = !isBuilt(o);
  const wormUpgrade = o.type === 'wormHole' ? canUpgradeLandmark(state, o, 'wormFarm') : null;
  const dinoUpgrade = o.type === 'dinoGraveyard' ? canUpgradeLandmark(state, o, 'paleoLab') : null;
  const mammothUpgrade = o.type === 'mammothCave' ? canUpgradeLandmark(state, o, 'permafrostLab') : null;
  const bridgeUpgrade = o.type === 'northBridgeSite' ? canUpgradeLandmark(state, o, 'northBridge') : null;
  const harborUpgrade = o.type === 'abyssWellhead' ? canUpgradeLandmark(state, o, 'deepSeaHarbor') : null;
  let body = `<p class="insp-desc">${def.desc || ''}</p>`;
  if (chain) {
    body += `<div class="insp-row"><span>生意</span><b>${chain.name}</b></div>`;
  }

  if (buildingNow) {
    const done = buildProgress(o) * 100;
    body += `<div class="insp-section">
      <div class="insp-label"><span>施工进度</span><em>${formatSeconds(o.buildLeft)}</em></div>
      <div class="insp-progress"><i style="width:${done.toFixed(1)}%;background:var(--amber)"></i></div>
    </div>
    <div class="insp-note">完工后才会开工生产或接待顾客。施工期间可以看一次激励广告立即完成。</div>`;
  } else if (def.kind === 'gate') {
    const entry = entranceDefOf(def) || {};
    const open = entranceOpen(state, o);
    const isBridge = entry.roadPassage === false;
    const side = { south: '南侧', west: '西侧', north: '北侧', east: '东侧' }[entry.driveway] || '';
    const walking = (state.customers || []).filter((c) => c.entranceId === o.id
      && (c.phase === 'walk' || c.phase === 'queue')).length;
    const entered = isBridge
      ? (state.stats.bridgeServed || 0) + walking
      : (state.stats.served || 0) + (state.stats.customersLost || 0) + walking;
    body += `<div class="insp-row"><span>过路费</span><b class="good">+${def.toll || 2} 金币 / 位</b></div>
      <div class="insp-row"><span>累计过路费</span><b>${fmt(state.stats.tollEarned || 0)}</b></div>
      <div class="insp-row"><span>${isBridge ? '累计过桥客' : '进镇顾客'}</span><b>${fmt(entered)}</b></div>
      <div class="insp-row"><span>${isBridge ? `${side}引道` : '门洞道路'}</span><b class="${open ? 'good' : 'bad'}">${open ? '已连接' : (entry.drivewayHint || '需要道路')}</b></div>
      <div class="insp-note">${isBridge
        ? `从冻河对岸来的第二股客流，每 13–16 秒过桥一位。桥头${side}引道要接路，客人过桥后再沿路找餐馆。`
        : '顾客都从南门牌楼的门洞进镇，再沿路找有空位的餐馆；排不上队就原路回去。牌楼不能拆，门洞下要铺满路。'}</div>`;
  } else if (def.kind === 'review') {
    const points = Math.floor(reviewPoints(state));
    const need = nextLevelNeed(state);
    body += `<div class="insp-row"><span>总评分</span><b class="good">${fmt(points)}</b></div>
      <div class="insp-row"><span>当前等级</span><b>Lv.${state.review.level} / ${MAX_LEVEL}</b></div>
      <div class="insp-row"><span>下一门槛</span><b>${need ? `${need} 分` : '已满级'}</b></div>
      ${roadRow(o)}`;
    const f = state.festival;
    if (f) {
      body += `<div class="insp-section">
        <div class="insp-label"><span>美食节接待</span><em>${Math.ceil(f.remaining)} 秒</em></div>
        <div class="insp-progress"><i style="width:${pct(f.served, f.target).toFixed(1)}%;background:var(--gold)"></i></div>
        <div class="insp-row"><span>进度</span><b class="${f.served >= f.target ? 'good' : ''}">${f.served}/${f.target} 位</b></div>
      </div>`;
    } else {
      body += `<div class="insp-note">评分达到下一级门槛后，在这里开启美食节。限时内接待足够顾客即可晋升，并开放对应等级的新地块。</div>`;
    }
  } else if (def.kind === 'field') {
    const grow = Math.floor((o.growth || 0) * 100);
    const have = state.res[def.res] || 0;
    body += `<div class="insp-section">
      <div class="insp-label"><span>生长</span><em>${grow}%</em></div>
      <div class="insp-progress"><i style="width:${grow}%;background:var(--amber)"></i></div>
    </div>
    <div class="insp-row"><span>成熟产出</span><b>${RESOURCES[def.res].name} ×${def.yield}</b></div>
    <div class="insp-row"><span>仓库存量</span><b class="${have >= state.cap ? 'bad' : ''}">${have}/${state.cap}</b></div>
    <div class="insp-row"><span>收获方式</span><b class="good">自动</b></div>`;
  } else if (o.type === 'mammothCave') {
    const records = [
      ['soil', '冻土剖面', '洞口左侧塌下一段冻土，黑泥、蓝冰和灰砂层层叠着。最上面一层里还能看到草籽和一只甲虫。'],
      ['tusk', '猛犸象牙', '两根象牙从雪里露出来，弯向地面。牙尖磨得很平，它死前大概还在啃冻草根。'],
      ['molar', '臼齿', '冰碴里有一枚臼齿，齿板一层层的。牙根没有吸收，应该是正当壮年时死的。'],
    ];
    body += `<div class="insp-row"><span>占地</span><b>${def.w} × ${def.d}</b></div>
      <div class="insp-row"><span>类型</span><b>地标 · 不可拆除</b></div>
      <div class="insp-row"><span>研究所</span><b class="${mammothUpgrade.ok ? 'good' : 'bad'}">${mammothUpgrade.ok ? 'Lv.6 · 可以立项' : mammothUpgrade.reason}</b></div>`;
    body += records.map(([id, title, text]) => `<details class="insp-fossil">
      <summary>${title}</summary>
      <p>${text}</p>
    </details>`).join('');
    body += `<div class="insp-note">三段记录可以慢慢看，不影响研究所立项。研究所完工后得到猛犸研究结果，Lv.7 解锁猛犸牧场。</div>`;
  } else if (o.type === 'permafrostLab') {
    const researched = !!state.flags.mammothResearch;
    body += `<div class="insp-row"><span>研究状态</span><b class="${researched ? 'good' : 'bad'}">${researched ? '已完成' : '研究中'}</b></div>
      <div class="insp-row"><span>取样方式</span><b>冰芯 · 融水 · 冻土剖面</b></div>
      <div class="insp-row"><span>猛犸牧场</span><b class="${researched ? 'good' : ''}">${researched ? 'Lv.7 可建造' : '研究完成后解锁'}</b></div>
      <div class="insp-note">完工后研究会写入结果，猛犸牧场的图纸随之解锁。Lv.7 可在「畜牧」页建造 10×8 牧场。</div>`;
  } else if (o.type === 'northBridgeSite') {
    const research = !!state.flags?.mammothResearch;
    const bridgeDef = defOf('northBridge');
    body += `<div class="insp-row"><span>占地</span><b>${def.w} × ${def.d}</b></div>
      <div class="insp-row"><span>类型</span><b>地标 · 不可拆除</b></div>
      <div class="insp-row"><span>工程预算</span><b>${fmt(bridgeDef.cost)} 金币 · ${formatSeconds(bridgeDef.buildTime)}</b></div>
      <div class="insp-row"><span>前置研究</span><b class="${research ? 'good' : 'bad'}">${research ? '永冻土研究已完成' : '需先完成永冻土研究所'}</b></div>
      <div class="insp-row"><span>第二入口</span><b>每 13–16 秒过桥 1 位 · 过路费 +${bridgeDef.toll}</b></div>
      <div class="insp-note">旧桥墩还立在冰面上。重建后桥头东侧会多一条进镇的路；引道要接上道路，客人才会过桥。</div>`;
  } else if (o.type === 'dinoGraveyard') {
    const records = [
      ['ribs', '肋骨拱架', '三根肋骨连着脊椎，关节还保持原位。这只巨兽被埋住时是站着的。'],
      ['skull', '头骨', '下颌缺了半排牙，后脑有一道旧裂口。骨头上没有愈合痕迹，它可能是被更大的动物咬穿脖子后死的。'],
      ['tar', '焦油坑', '沥青里混着兽毛、种子和一小截爪尖。这里以前是水洼，也是困住动物的陷阱。'],
    ];
    body += `<div class="insp-row"><span>占地</span><b>${def.w} × ${def.d}</b></div>
      <div class="insp-row"><span>类型</span><b>地标 · 不可拆除</b></div>
      <div class="insp-row"><span>研究所</span><b class="${dinoUpgrade.ok ? 'good' : 'bad'}">${dinoUpgrade.ok ? 'Lv.9 · 可以立项' : dinoUpgrade.reason}</b></div>`;
    body += records.map(([id, title, text]) => `<details class="insp-fossil">
      <summary>${title}</summary>
      <p>${text}</p>
    </details>`).join('');
    body += `<div class="insp-note">三段记录可以慢慢看，不影响研究所立项。研究所完工后才解锁 Lv.10 的白垩纪牧场，牧场既卖观光团，也产恐龙肉。</div>`;
  } else if (o.type === 'paleoLab') {
    const researched = !!state.flags.dinoResearch;
    body += `<div class="insp-row"><span>研究状态</span><b class="${researched ? 'good' : 'bad'}">${researched ? '已完成' : '研究中'}</b></div>
      <div class="insp-row"><span>白垩纪牧场</span><b class="${researched ? 'good' : ''}">${researched ? '已解锁 · Lv.10' : '研究完成后解锁'}</b></div>
      <div class="insp-row"><span>参观方式</span><b>玻璃化石厅 · 原位保存</b></div>
      <div class="insp-note">完工后研究会写入结果，白垩纪牧场的图纸随之解锁。之后在「畜牧」页建造 12×9 牧场，既能接待观光团，也会产出恐龙肉。</div>`;
  } else if (o.type === 'dinoRanch') {
    const meat = def.meat;
    const have = state.res[meat.res] || 0;
    const full = have + meat.amount > state.cap;
    const next = Math.max(0, meat.time - (o.meatTimer || 0));
    const meatPct = pct(o.meatTimer || 0, meat.time);
    body += `<div class="insp-section">
      <div class="insp-label"><span>恐龙肉产出</span><em>${full ? '仓满 · 暂停' : `${Math.ceil(next)} 秒`}</em></div>
      <div class="insp-progress"><i style="width:${meatPct.toFixed(1)}%;background:var(--coral)"></i></div>
      <div class="insp-row"><span>每轮产出</span><b class="good">${RESOURCES[meat.res].name} ×${meat.amount}</b></div>
      <div class="insp-row"><span>恐龙肉库存</span><b class="${full ? 'bad' : ''}">${have} / ${state.cap}</b></div>
      <div class="insp-row"><span>累计采集</span><b>${fmt(state.stats.dinoMeatCollected || 0)}</b></div>
    </div>`;
    body += recipeMarkup(def);
    if (st.code === 'work') body += progressMarkup(def, o, '下一班观光车');
    const q = queueAtShop(state, o.id);
    body += `<div class="insp-row"><span>排队游客</span><b class="${q.length ? 'good' : ''}">${q.length} / 3</b></div>`;
    if (q.length) {
      const c = q[0];
      const patience = pct(c.patience, c.maxPatience || 1);
      const tone = patience < 35 ? 'var(--coral)' : patience < 65 ? 'var(--amber)' : 'var(--green)';
      body += `<div class="insp-section">
        <div class="insp-label"><span>队首耐心</span><em>${Math.ceil(c.patience)} 秒</em></div>
        <div class="insp-progress"><i style="width:${patience.toFixed(1)}%;background:${tone}"></i></div>
      </div>`;
    }
    body += roadRow(o);
    body += `<div class="insp-row"><span>累计观光团</span><b>${fmt(state.stats.dinoTours || 0)}</b></div>
      <div class="insp-note">观光团用仙人掌果和沙枣换票；恐龙肉每 ${meat.time} 秒自动入库，仓满时这一轮就不收了。断料只会停掉观光车，肉照常产。</div>`;
  } else if (o.type === 'mammothRanch') {
    const meat = def.meat;
    const have = state.res[meat.res] || 0;
    const full = have + meat.amount > state.cap;
    const next = Math.max(0, meat.time - (o.meatTimer || 0));
    const meatPct = pct(o.meatTimer || 0, meat.time);
    body += `<div class="insp-section">
      <div class="insp-label"><span>猛犸肉采集</span><em>${full ? '仓满 · 暂停' : `${Math.ceil(next)} 秒`}</em></div>
      <div class="insp-progress"><i style="width:${meatPct.toFixed(1)}%;background:#8fb8b0"></i></div>
      <div class="insp-row"><span>每轮产出</span><b class="good">${RESOURCES[meat.res].name} ×${meat.amount}</b></div>
      <div class="insp-row"><span>猛犸肉库存</span><b class="${full ? 'bad' : ''}">${have} / ${state.cap}</b></div>
      <div class="insp-row"><span>累计采集</span><b>${fmt(state.stats.mammothMeatCollected || 0)}</b></div>
    </div>`;
    body += roadRow(o);
    body += `<div class="insp-note">猛犸肉每 ${meat.time} 秒自动入库，仓满时这一轮就不收了。牧场不接待游客，肉留给 Lv.7 猛犸主题餐厅。</div>`;
  } else if (o.type === 'abyssWellhead') {
    const harborDef = defOf('deepSeaHarbor');
    const horn = state.res.octoHorn || 0;
    body += `<div class="insp-row"><span>占地</span><b>${def.w} × ${def.d}</b></div>
      <div class="insp-row"><span>类型</span><b>地标 · 不可拆除</b></div>
      <div class="insp-row"><span>工程预算</span><b>${fmt(harborDef.cost)} 金币 · ${formatSeconds(harborDef.buildTime)}</b></div>
      <div class="insp-row"><span>改建规模</span><b>${harborDef.w} × ${harborDef.d} 导管架码头</b></div>
      <div class="insp-row"><span>巨大章鱼脚库存</span><b class="${horn >= state.cap ? 'bad' : ''}">${horn} / ${state.cap}</b></div>
      <div class="insp-row"><span>立项状态</span><b class="${harborUpgrade.ok ? 'good' : 'bad'}">${harborUpgrade.ok ? 'Lv.10 · 可以动工' : harborUpgrade.reason}</b></div>
      <div class="insp-note">远航海港只能从这口黑水井改建，建造列表里买不到。动工后井口会架起平台和甲板，完工时软管接到涡流旁的捕捞舰。</div>`;
  } else if (o.type === 'deepSeaHarbor') {
    const horn = state.res.octoHorn || 0;
    const gotHorn = !!state.flags.octoHornFound;
    body += recipeMarkup(def);
    if (st.code === 'work') body += progressMarkup(def, o, '下一条章鱼脚');
    body += `<div class="insp-row"><span>远航捕捞舰</span><b class="good">已停靠涡流旁</b></div>
      <div class="insp-row"><span>巨大章鱼脚库存</span><b class="${horn >= state.cap ? 'bad' : ''}">${horn} / ${state.cap}</b></div>
      <div class="insp-row"><span>累计取得</span><b>${fmt(state.stats.octoHornCollected || 0)}</b></div>
      <div class="insp-row"><span>首条章鱼脚</span><b class="${gotHorn ? 'good' : 'bad'}">${gotHorn ? '已入库' : '等待第一趟'}</b></div>
      <div class="insp-note">海港只接收捕捞舰从涡流带回来的巨大章鱼脚，不用通路。仓库满时会停工，腾出仓位后自动继续。</div>`;
  } else if (def.prod) {
    body += recipeMarkup(def);
    if (st.code === 'work') body += progressMarkup(def, o, '生产进度');
    body += livestockRow(def);
    body += roadRow(o);
  } else if (def.sale) {
    body += recipeMarkup(def);
    if (st.code === 'work') body += progressMarkup(def, o, '下一单');
    const q = queueAtShop(state, o.id);
    body += `<div class="insp-row"><span>排队顾客</span><b class="${q.length ? 'good' : ''}">${q.length} / 3</b></div>`;
    if (q.length) {
      const c = q[0];
      const patience = pct(c.patience, c.maxPatience || 1);
      const tone = patience < 35 ? 'var(--coral)' : patience < 65 ? 'var(--amber)' : 'var(--green)';
      body += `<div class="insp-section">
        <div class="insp-label"><span>队首耐心</span><em>${Math.ceil(c.patience)} 秒</em></div>
        <div class="insp-progress"><i style="width:${patience.toFixed(1)}%;background:${tone}"></i></div>
      </div>`;
    }
    body += roadRow(o);
    body += `<div class="insp-row"><span>累计${def.sale.label}</span><b>${fmt(state.stats[def.sale.stat] || 0)}</b></div>
      <div class="insp-note">只有顾客在门口排队时才会开火出餐；队伍满了新顾客会另找餐馆。</div>`;
  } else if (def.buff) {
    const info = buffInfo(state, o);
    const left = info.buff.duration ? pct(info.remaining, info.buff.duration) : 0;
    body += `<div class="insp-section">
      <div class="insp-label"><span>${info.buff.label}</span><em>${info.active ? `${Math.ceil(info.remaining)} 秒` : '未生效'}</em></div>
      <div class="insp-progress"><i style="width:${left.toFixed(1)}%;background:var(--gold)"></i></div>
    </div>
    <div class="insp-row"><span>覆盖餐馆</span><b class="${info.targets.length ? 'good' : 'bad'}">${info.targets.length} 家 <em class="insp-sub">半径 ${info.buff.radius} 格</em></b></div>
    <div class="insp-row"><span>啤酒库存</span><b class="${info.stock >= info.need ? '' : 'bad'}">${fmt(info.stock)} 桶</b></div>
    <div class="insp-row"><span>开桶节奏</span><b>每 ${info.buff.interval} 秒 -${info.need} 桶</b></div>
    <div class="insp-row"><span>微醺效果</span><b class="good">售价 +${Math.round(info.buff.coins * 100)}% · 出餐 -${Math.round(info.buff.time * 100)}%</b></div>
    ${roadRow(o)}
    <div class="insp-note">啤酒馆自己不卖酒。附近没有营业的餐馆时不开桶；啤酒断供后，微醺还会持续 ${info.buff.duration} 秒。</div>`;
  } else if (o.type === 'warehouse') {
    body += `${roadRow(o)}
      <div class="insp-row"><span>全城仓储</span><b>${state.cap}</b></div>
      <div class="insp-row"><span>本库贡献</span><b class="${o.connected ? 'good' : 'bad'}">${o.connected ? '+20' : '无'}</b></div>`;
  } else if (o.type === 'wormFarm') {
    const wp = wormPhase(state.simTime);
    const stock = state.res.wormMeat || 0;
    const collected = state.stats.wormMeatCollected || 0;
    const harvestPct = (1 - wp.nextHarvest / wp.cycle) * 100;
    body += `<div class="insp-section">
      <div class="insp-label"><span>当前阶段 · ${wp.label}</span><em>${Math.ceil(wp.remaining)} 秒</em></div>
      <div class="insp-progress"><i style="width:${(wp.progress * 100).toFixed(1)}%;background:var(--amber)"></i></div>
      <div class="insp-row"><span>下一次采集</span><b>${Math.ceil(wp.nextHarvest)} 秒后 · 钻回结算</b></div>
      <div class="insp-progress"><i style="width:${harvestPct.toFixed(1)}%;background:var(--coral)"></i></div>
    </div>
    <div class="insp-row"><span>每轮产出</span><b class="good">蠕虫肉 ×${def.harvest || 2}</b></div>
    <div class="insp-row"><span>累计采集</span><b>${fmt(collected)}</b></div>
    <div class="insp-row"><span>蠕虫肉库存</span><b class="${stock >= state.cap ? 'bad' : ''}">${stock} / ${state.cap}</b></div>
    <div class="insp-note">采集场不挡洞口，翻沙动画一直在播；潜伏和翻腾时不算产量。仓库满了，这一轮翻沙就白翻了。</div>`;
  } else if (o.type === 'wormHole') {
    const wp = wormPhase(state.simTime);
    const hint = WORM_PHASE_HINT[wp.id] || '';
    body += `<div class="insp-section">
      <div class="insp-label"><span>当前阶段 · ${wp.label}</span><em>${Math.ceil(wp.remaining)} 秒</em></div>
      <div class="insp-progress"><i style="width:${(wp.progress * 100).toFixed(1)}%;background:var(--amber)"></i></div>
      <div class="insp-row"><span>下一次翻沙</span><b>${Math.ceil(wp.nextBreach)} 秒后</b></div>
    </div>
    <div class="insp-row"><span>占地</span><b>${def.w} × ${def.d}</b></div>
    <div class="insp-row"><span>类型</span><b>自然景观 · 不可拆除</b></div>
    <div class="insp-row"><span>采集场</span><b class="${wormUpgrade.ok ? 'good' : 'bad'}">${wormUpgrade.ok ? 'Lv.9 · 可修建' : wormUpgrade.reason}</b></div>
    <div class="insp-note">${hint}</div>`;
  } else if (o.type === 'giantOctopus') {
    const op = octopusPhase(state.simTime);
    const hint = OCTOPUS_PHASE_HINT[op.id] || '';
    const harbor = deepSeaHarborBuilt(state);
    const horn = state.res.octoHorn || 0;
    const gotHorn = !!state.flags.octoHornFound;
    body += `<div class="insp-section">
      <div class="insp-label"><span>当前阶段 · ${op.label}</span><em>${Math.ceil(op.remaining)} 秒</em></div>
      <div class="insp-progress"><i style="width:${(op.progress * 100).toFixed(1)}%;background:var(--coral)"></i></div>
      <div class="insp-row"><span>下一次浮升</span><b>${Math.ceil(op.nextSurge)} 秒后</b></div>
    </div>
    <div class="insp-row"><span>占地</span><b>${def.w} × ${def.d}</b></div>
    <div class="insp-row"><span>类型</span><b>海上景观 · 不可拆除</b></div>
    <div class="insp-row"><span>巨大章鱼脚</span><b class="${gotHorn ? 'good' : 'bad'}">${gotHorn ? `已取得 · 库存 ${horn}` : '未取得'}</b></div>
    <div class="insp-row"><span>远航海港</span><b class="${harbor ? 'good' : 'bad'}">${harbor ? '已建成 · 捕捞舰就位' : '尚未动工'}</b></div>
    <div class="insp-note">${harbor
      ? '远航捕捞舰停在涡流西南侧的锚地，海港每 60 秒从腕足上取回一条巨大章鱼脚。'
      : `${hint} 它还在等一条船：点环礁潟湖中间的黑水井口，改建成 5×4 的远航海港。完工后捕捞舰会停到涡流旁。`}</div>`;
  } else {
    body += `<div class="insp-row"><span>占地</span><b>${def.w} × ${def.d}</b></div>
      <div class="insp-row"><span>类型</span><b>${def.kind === 'nature' ? '自然装饰' : '小镇装饰'}</b></div>`;
  }

  const quote = demolitionQuote(state, o);
  if (isRotatable(def)) {
    body += `<div class="insp-row"><span>朝向</span><b>${((o.rot || 0) * 90)}° <em class="insp-sub">仅外观</em></b></div>`;
  }
  if (quote.fee > 0) {
    body += `<div class="insp-row"><span>清理费</span><b class="${quote.affordable ? '' : 'bad'}">${fmt(quote.fee)} 金币</b></div>`;
  }
  let actions = '';
  if (buildingNow) {
    actions += '<button class="btn primary" type="button" data-act="rush">立即完成（可选广告）</button>';
  }
  if (def.kind === 'review') {
    if (canStartFestival(state).ok) {
      actions += '<button class="btn primary" type="button" data-act="festival">开启美食节</button>';
    }
    actions += '<button class="btn" type="button" data-act="reviewPanel">评分面板</button>';
  }
  if (isRotatable(def)) {
    actions += '<button class="btn" type="button" data-act="rotate">旋转 90°</button>';
  }
  if (!o.natural && !def.unremovable && !def.hidden) {
    actions += '<button class="btn" type="button" data-act="move">移动位置</button>';
  }
  if (o.type === 'wormHole') {
    if (wormUpgrade.ok) {
      actions += `<button class="btn primary" type="button" data-act="wormFarm">修建蠕虫肉采集场 · -${fmt(defOf('wormFarm').cost)}</button>`;
    } else {
      actions += `<button class="btn" type="button" disabled title="${wormUpgrade.reason}">采集场 · ${wormUpgrade.reason}</button>`;
    }
  }
  if (o.type === 'mammothCave') {
    if (mammothUpgrade.ok) {
      actions += `<button class="btn primary" type="button" data-act="permafrostLab">建立永冻土研究所 · -${fmt(defOf('permafrostLab').cost)}</button>`;
    } else {
      actions += `<button class="btn" type="button" disabled title="${mammothUpgrade.reason}">研究所 · ${mammothUpgrade.reason}</button>`;
    }
  }
  if (o.type === 'northBridgeSite') {
    if (bridgeUpgrade.ok) {
      actions += `<button class="btn primary" type="button" data-act="northBridge">重建冰湖跨海大桥 · -${fmt(defOf('northBridge').cost)}</button>`;
    } else {
      actions += `<button class="btn" type="button" disabled title="${bridgeUpgrade.reason}">重建跨海大桥 · ${bridgeUpgrade.reason}</button>`;
    }
  }
  if (o.type === 'abyssWellhead') {
    if (harborUpgrade.ok) {
      actions += `<button class="btn primary" type="button" data-act="deepSeaHarbor">改建远航海港 · -${fmt(defOf('deepSeaHarbor').cost)}</button>`;
    } else {
      actions += `<button class="btn" type="button" disabled title="${harborUpgrade.reason}">改建远航海港 · ${harborUpgrade.reason}</button>`;
    }
  }
  if (o.type === 'dinoGraveyard') {
    if (dinoUpgrade.ok) {
      actions += `<button class="btn primary" type="button" data-act="paleoLab">建立古生物研究所 · -${fmt(defOf('paleoLab').cost)}</button>`;
    } else {
      actions += `<button class="btn" type="button" disabled title="${dinoUpgrade.reason}">研究所 · ${dinoUpgrade.reason}</button>`;
    }
  }
  if (o.type === 'paleoLab' && isBuilt(o) && state.flags.dinoResearch) {
    const ok = (state.review?.level || 1) >= 10;
    actions += `<button class="btn ${ok ? 'primary' : ''}" type="button" data-act="gotoRanch"${ok ? '' : ' disabled title="白垩纪牧场需要小镇 Lv.10"'}>去建造恐龙牧场${ok ? '' : ' · 需 Lv.10'}</button>`;
  }
  if (!def.unremovable) {
    const label = quote.fee > 0
      ? `清理 · -${fmt(quote.fee)}`
      : `拆除${quote.refund ? ` · +${fmt(quote.refund)}` : ''}`;
    const disabled = quote.fee > 0 && !quote.affordable
      ? ' disabled title="金币不够支付清理费"'
      : '';
    actions += `<button class="btn danger" type="button" data-act="demolish"${disabled}>${label}</button>`;
  }
  actions += '<button class="btn" type="button" data-act="close">关闭</button>';
  body += `<div class="insp-actions wrap">${actions}</div>`;

  const html = `<div class="insp-head">
    <button class="insp-close" type="button" data-act="close" aria-label="关闭">×</button>
    <span class="kicker">${cat ? cat.name : '小镇'} · ${def.w}×${def.d}</span>
    <h2>${def.name}</h2>
    <span class="status ${st.code}">${st.label || '就绪'}</span>
  </div>
  <div class="insp-body">${body}</div>`;

  if (!inspectorHeld && (force || htmlCache.get(els.inspector) !== html)) {
    htmlCache.set(els.inspector, html);
    els.inspector.innerHTML = html;
  }
  els.inspector.hidden = false;
}

function livestockRow(def) {
  if (!def.livestock) return '';
  const name = def.livestock === 'chicken' ? '鸡' : def.livestock === 'cow' ? '牛' : def.livestock;
  return `<div class="insp-row"><span>畜群</span><b>${name} ×${def.animals || 1}</b></div>`;
}

function recipeMarkup(def) {
  const inputs = def.prod?.in || def.sale?.in || {};
  const outputs = def.prod?.out;
  const time = def.prod?.time || def.sale?.time || 0;
  const chips = Object.entries(inputs).map(([res, need]) => {
    const info = RESOURCES[res];
    const have = state.res[res] || 0;
    return `<span class="res${have < need ? ' bad' : ''}"><i style="background:${info.color}">${info.short}</i>${info.name} ${have}/${need}</span>`;
  }).join('');
  let tail;
  if (outputs) {
    tail = Object.entries(outputs).map(([res, n]) => {
      const info = RESOURCES[res];
      return `<span class="res"><i style="background:${info.color}">${info.short}</i>${info.name} +${n}</span>`;
    }).join('');
  } else {
    const units = def.sale.units > 1 ? ` · ${def.sale.units} 份` : '';
    tail = `<span class="gain">+${fmt(def.sale.coins)} 金币${units}</span>`;
  }
  return `<div class="insp-section">
    <div class="insp-label"><span>${def.sale ? '消耗并卖出' : '配方'}</span><em>${time ? `${time} 秒 / 次` : ''}</em></div>
    <div class="recipe">${chips}<span class="arrow">→</span>${tail}</div>
  </div>`;
}

function progressMarkup(def, o, label) {
  const time = def.prod?.time || def.sale?.time || 1;
  const value = Math.max(0, Math.min(1, (o.timer || 0) / time)) * 100;
  return `<div class="insp-section">
    <div class="insp-label"><span>${label}</span><em>${Math.floor(value)}%</em></div>
    <div class="insp-progress"><i style="width:${value.toFixed(1)}%;background:${def.sale ? 'var(--gold)' : 'var(--teal)'}"></i></div>
  </div>`;
}

function roadRow(o) {
  const def = defOf(o.type);
  if (!def?.needsRoad) return '';
  return `<div class="insp-row"><span>道路</span><b class="${o.connected ? 'good' : 'bad'}">${o.connected ? '已连接' : '未连接'}</b></div>`;
}

function selectObject(o) {
  ui.selectedId = o.id;
  ui.dockOpen = true;
  renderInspector(true);
  els.inspector.hidden = false;
  syncToolUI();
  syncViewLayout();
  audio?.play('click');
  if (o.type === 'wormHole' && !state.flags.wormSeen) {
    state.flags.wormSeen = true;
    save();
    renderQuest();
    updateGuide();
    toast('洞底传来一声低鸣 · 采集场可以动工了', 'gold', 2800);
  }
  if (o.type === 'mammothCave' && !state.flags.mammothSeen) {
    state.flags.mammothSeen = true;
    save();
    renderQuest();
    updateGuide();
    toast('洞口雪里露出一截象牙 · 三段记录可以翻阅', 'gold', 3200);
  }
  if (o.type === 'dinoGraveyard' && !state.flags.dinoSeen) {
    state.flags.dinoSeen = true;
    save();
    renderQuest();
    updateGuide();
    toast('骨拱下压着三段记录 · 研究所可以在 Lv.9 立项', 'gold', 3200);
  }
  if (o.type === 'giantOctopus' && !state.flags.octopusSeen) {
    state.flags.octopusSeen = true;
    save();
    renderQuest();
    updateGuide();
    toast('涡流里睁开两只眼 · 远航海港已可立项', 'gold', 3200);
  }
}

function closeInspector() {
  ui.selectedId = null;
  ui.dockOpen = false;
  els.inspector.hidden = true;
  syncToolUI();
  syncViewLayout();
}

function onInspectorClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || !state) return;
  const action = btn.dataset.act;
  if (action === 'close') {
    closeInspector();
    audio?.play('click');
    return;
  }
  if (action === 'festival') {
    startFestivalFlow();
    return;
  }
  if (action === 'reviewPanel') {
    closeInspector();
    openDrawer('reviewPanel');
    return;
  }
  const o = objectById(state, ui.selectedId);
  if (!o) return;
  if (action === 'rush') {
    rushBuild(o);
    return;
  }
  if (action === 'rotate') {
    const result = rotateObject(state, o, 1);
    if (!result.ok) {
      warn(result.reason);
      return;
    }
    audio?.play('click');
    save();
    renderInspector(true);
    syncToolUI();
    return;
  }
  if (action === 'move') {
    setTool({ kind: 'move', id: o.id });
    return;
  }
  if (action === 'wormFarm') {
    const result = upgradeLandmark(state, o, 'wormFarm');
    if (!result.ok) {
      warn(result.reason);
      return;
    }
    audio?.play('click');
    engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 1.2, '#f0c98f');
    const extra = result.cleared ? ` · 清理 ${result.cleared} 处野景` : '';
    toast(`采集场开工 · 30 分钟后完工${extra}`, 'good', 3200);
    updateHud(true);
    renderQuest();
    updateGuide();
    save();
    renderInspector(true);
    syncToolUI();
    return;
  }
  if (action === 'permafrostLab') {
    const result = upgradeLandmark(state, o, 'permafrostLab');
    if (!result.ok) {
      warn(result.reason);
      return;
    }
    audio?.play('click');
    engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 1.2, '#cfe4e8');
    const extra = result.cleared ? ` · 清理 ${result.cleared} 处野景` : '';
    toast(`永冻土研究所开工 · 20 分钟后完工${extra}`, 'good', 3200);
    updateHud(true);
    renderQuest();
    updateGuide();
    save();
    renderInspector(true);
    syncToolUI();
    return;
  }
  if (action === 'northBridge') {
    const result = upgradeLandmark(state, o, 'northBridge');
    if (!result.ok) {
      warn(result.reason);
      return;
    }
    audio?.play('click');
    engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 1.2, '#cfe4e8');
    const extra = result.cleared ? ` · 清理 ${result.cleared} 处野景` : '';
    toast(`冰湖跨海大桥开工 · 30 分钟后通车${extra}`, 'good', 3200);
    updateHud(true);
    renderQuest();
    updateGuide();
    save();
    renderInspector(true);
    syncToolUI();
    return;
  }
  if (action === 'deepSeaHarbor') {
    const result = upgradeLandmark(state, o, 'deepSeaHarbor');
    if (!result.ok) {
      warn(result.reason);
      return;
    }
    audio?.play('click');
    engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 1.2, '#8fb8d8');
    const extra = result.cleared ? ` · 清理 ${result.cleared} 处野景` : '';
    toast(`远航海港开工 · 30 分钟后通航${extra}`, 'good', 3200);
    updateHud(true);
    renderQuest();
    updateGuide();
    save();
    renderInspector(true);
    syncToolUI();
    return;
  }
  if (action === 'paleoLab') {
    const result = upgradeLandmark(state, o, 'paleoLab');
    if (!result.ok) {
      warn(result.reason);
      return;
    }
    audio?.play('click');
    engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 1.2, '#d9c9a8');
    const extra = result.cleared ? ` · 清理 ${result.cleared} 处野景` : '';
    toast(`古生物研究所开工 · 30 分钟后完工${extra}`, 'good', 3200);
    updateHud(true);
    renderQuest();
    updateGuide();
    save();
    renderInspector(true);
    syncToolUI();
    return;
  }
  if (action === 'gotoRanch') {
    closeInspector();
    setCategorySilently('raise');
    ui.dockOpen = true;
    syncToolUI();
    syncViewLayout();
    const card = cardEls.get('dinoRanch');
    card?.classList.add('needs-attention');
    card?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    audio?.play('click');
    toast('白垩纪牧场已解锁 · 找一块 12×9 的空地', 'gold', 3200);
    return;
  }
  if (action !== 'demolish') return;
  const result = demolishObject(state, o);
  if (!result.ok) {
    warn(result.reason || '无法拆除');
    return;
  }
  closeInspector();
  audio?.play('demolish');
  const money = result.fee > 0
    ? `-${fmt(result.fee)}`
    : result.refund ? `+${fmt(result.refund)}` : '已拆除';
  engine.addFloater(o.x + o.w / 2, o.y + o.d / 2, money, result.fee > 0 ? '#ef8a67' : '#a8dd8f', 1.2);
  if (result.fee > 0) {
    toast(`已清理 ${result.name} · 支付 ${fmt(result.fee)} 金币`, 'warn');
  } else {
    toast(`已拆除 ${result.name}${result.refund ? ` · 返还 ${fmt(result.refund)} 金币` : ''}`, 'warn');
  }
  updateHud(true);
  if (lastPointer) updateGhostAt(lastPointer.x, lastPointer.y);
}

function setHTML(el, html) {
  if (!el) return;
  if (htmlCache.get(el) === html) return;
  htmlCache.set(el, html);
  el.innerHTML = html;
}

function toast(text, tone = '', ms = UI.TOAST_MS) {
  const div = document.createElement('div');
  div.className = `toast ${tone}`.trim();
  div.textContent = text;
  while (els.toasts.children.length >= UI.TOAST_MAX) els.toasts.firstElementChild.remove();
  els.toasts.appendChild(div);
  setTimeout(() => {
    div.classList.add('out');
    setTimeout(() => div.remove(), UI.TOAST_OUT_MS);
  }, ms);
}

function warn(message) {
  if (!message) return;
  const now = performance.now();
  if (message === warnedMsg && now - warnedAt < UI.WARN_DEDUPE_MS) return;
  warnedMsg = message;
  warnedAt = now;
  toast(message, 'warn');
  audio?.play('error');
}

// ---------------------------------------------------------------------------
// Input

function bindInput() {
  surface().addEventListener('pointerdown', onPointerDown, { passive: false });
  surface().addEventListener('pointermove', onPointerMove, { passive: false });
  surface().addEventListener('pointerup', onPointerUp);
  surface().addEventListener('pointercancel', onPointerCancel);
  surface().addEventListener('pointerleave', onPointerLeave);
  surface().addEventListener('wheel', onWheel, { passive: false });
  surface().addEventListener('contextmenu', (e) => e.preventDefault());
}

function bindLifecycle() {
  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKey);
  window.addEventListener('pagehide', () => {
    save();
    audio?.pause();
    gameplayStop();
  });
  window.addEventListener('pageshow', () => {
    audio?.resume();
    gameplayStart();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      save();
      audio?.pause();
      gameplayStop();
    } else {
      audio?.resume();
      if (!adBreak) gameplayStart();
    }
  });
  window.addEventListener('pointerdown', () => audio?.unlock(), { once: true, capture: true });
}

function toCanvas(x, y) {
  const rect = surface().getBoundingClientRect();
  return { x: x - rect.left, y: y - rect.top };
}

function onPointerDown(e) {
  if (!engine) return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  e.preventDefault();
  audio?.unlock();
  const x = e.clientX;
  const y = e.clientY;
  lastPointer = { x, y };
  try {
    surface().setPointerCapture(e.pointerId);
  } catch {
    // Pointer capture is best-effort.
  }

  pointers.set(e.pointerId, {
    x, y,
    startX: x,
    startY: y,
    startT: performance.now(),
    moved: false,
  });

  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    gesture = {
      mode: 'pinch',
      d: Math.hypot(a.x - b.x, a.y - b.y),
      mx: (a.x + b.x) / 2,
      my: (a.y + b.y) / 2,
    };
    if (!ui.pending) {
      ui.ghost = null;
      ui.demolishTarget = null;
    }
    surface().classList.remove('dragging');
    return;
  }

  // Roads are pulled as one straight run: the first press picks the start (or
  // keeps the one already picked), and the finger decides the far end.
  if (ui.tool?.kind === 'road') {
    if (!ui.pending) {
      const p0 = toCanvas(x, y);
      const tile = engine.screenToTile(p0.x, p0.y);
      if (!inBounds(tile.x, tile.y) || !startRoadRun(tile.x, tile.y)) return;
    }
    gesture = { mode: 'ghost', moved: false, startX: x, startY: y, startT: performance.now() };
    surface().classList.add('dragging');
    return;
  }

  // A picked but unconfirmed building follows the finger: the first tap only
  // chooses the spot, and dragging the ghost is how that spot gets adjusted.
  // Two fingers still pan and zoom while the ghost is pending.
  if (ui.pending && e.pointerType !== 'mouse'
    && (ui.tool?.kind === 'build' || ui.tool?.kind === 'move')) {
    gesture = { mode: 'ghost', moved: false, startX: x, startY: y, startT: performance.now() };
    surface().classList.add('dragging');
    return;
  }

  if (ui.tool && BRUSH_TOOLS.has(ui.tool.kind)) {
    gesture = {
      mode: 'brush',
      lastKey: null,
      didPaint: false,
      startT: performance.now(),
      startX: x,
      startY: y,
      moved: false,
    };
    updateGhostAt(x, y);
    brushAt(x, y);
  } else {
    gesture = {
      mode: 'drag',
      moved: false,
      startX: x,
      startY: y,
      startT: performance.now(),
    };
    surface().classList.add('dragging');
    updateGhostAt(x, y);
  }
}

function onPointerMove(e) {
  if (!engine) return;
  const rec = pointers.get(e.pointerId);
  if (!rec) {
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      lastPointer = { x: e.clientX, y: e.clientY };
      updateGhostAt(e.clientX, e.clientY);
    }
    return;
  }
  e.preventDefault();
  const prevX = rec.x;
  const prevY = rec.y;
  rec.x = e.clientX;
  rec.y = e.clientY;
  if (Math.hypot(rec.x - rec.startX, rec.y - rec.startY) > INPUT.TAP_MOVE_PX) rec.moved = true;
  lastPointer = { x: rec.x, y: rec.y };

  if (gesture?.mode === 'pinch') {
    if (pointers.size < 2) return;
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (gesture.d > 0) engine.zoomAt(d / gesture.d, mx, my);
    engine.panBy(mx - gesture.mx, my - gesture.my);
    gesture.d = d;
    gesture.mx = mx;
    gesture.my = my;
    return;
  }

  if (gesture?.mode === 'ghost') {
    if (rec.moved) gesture.moved = true;
    dragPendingTo(rec.x, rec.y);
    return;
  }

  if (gesture?.mode === 'brush') {
    gesture.moved = rec.moved;
    updateGhostAt(rec.x, rec.y);
    brushAt(rec.x, rec.y);
    return;
  }

  if (gesture?.mode === 'drag') {
    if (rec.moved) gesture.moved = true;
    if (gesture.moved) engine.panBy(rec.x - prevX, rec.y - prevY);
    updateGhostAt(rec.x, rec.y);
  }
}

function onPointerUp(e) {
  if (!engine) return;
  const rec = pointers.get(e.pointerId);
  const g = gesture;
  const wasSingle = pointers.size === 1;
  pointers.delete(e.pointerId);

  if (g?.mode === 'ghost' && wasSingle) {
    if (!g.moved && performance.now() - g.startT < INPUT.TAP_MS) {
      tapAt(e.clientX, e.clientY, e.pointerType);
    }
  } else if (g?.mode === 'drag' && wasSingle && !g.moved && performance.now() - g.startT < INPUT.TAP_MS) {
    tapAt(e.clientX, e.clientY, e.pointerType);
  } else if (g?.mode === 'brush' && wasSingle) {
    const elapsed = performance.now() - g.startT;
    if (!g.didPaint && !rec?.moved && elapsed < INPUT.BRUSH_WARN_MS && ui.ghost && ui.ghost.ok === false) {
      warn(ui.ghost.reason || '这里不能施工');
    }
  }

  if (pointers.size === 0) {
    gesture = null;
    surface().classList.remove('dragging');
    if (e.pointerType !== 'mouse') {
      ui.hover = null;
      if (ui.tool && !ui.pending) {
        ui.ghost = null;
        ui.demolishTarget = null;
      }
    } else if (lastPointer) {
      updateGhostAt(lastPointer.x, lastPointer.y);
    }
  } else if (pointers.size === 1) {
    const remaining = [...pointers.values()][0];
    gesture = {
      mode: 'drag',
      moved: true,
      startX: remaining.x,
      startY: remaining.y,
      startT: performance.now(),
    };
    surface().classList.add('dragging');
  }
}

function onPointerCancel(e) {
  pointers.delete(e.pointerId);
  if (pointers.size === 0) {
    gesture = null;
    surface().classList.remove('dragging');
  }
}

function onPointerLeave() {
  if (pointers.size > 0) return;
  lastPointer = null;
  ui.hover = null;
  if (ui.tool && !ui.pending) {
    ui.ghost = null;
    ui.demolishTarget = null;
  }
}

function onWheel(e) {
  if (!engine) return;
  e.preventDefault();
  const factor = Math.max(INPUT.WHEEL_MIN_FACTOR, Math.min(INPUT.WHEEL_MAX_FACTOR, Math.exp(-e.deltaY * INPUT.WHEEL_SENSITIVITY)));
  engine.zoomAt(factor, e.clientX, e.clientY);
  lastPointer = { x: e.clientX, y: e.clientY };
  updateGhostAt(e.clientX, e.clientY);
}

function zoomAroundCenter(factor) {
  if (!engine) return;
  engine.zoomAt(factor, engine.viewW / 2, engine.viewH / 2);
  if (lastPointer) updateGhostAt(lastPointer.x, lastPointer.y);
  audio?.play('click');
}

function placementCheck(tool, x, y) {
  if (tool?.kind === 'build') return canPlace(state, tool.type, x, y);
  if (tool?.kind === 'move') {
    const o = objectById(state, tool.id);
    if (!o) return { ok: false, reason: '物件已经不存在了' };
    return canMoveObject(state, o, x, y);
  }
  return { ok: false, reason: '' };
}

function updateGhostAt(clientX, clientY) {
  if (!engine || !state) return;
  // A pending spot is chosen, not hovered: it must stay on its tile while the
  // camera pans or the player drags to look around before confirming.
  if (ui.pending) {
    if (ui.pending.kind === 'road') return;
    const check = placementCheck(ui.pending, ui.pending.x, ui.pending.y);
    ui.ghost = { x: ui.pending.x, y: ui.pending.y, ok: check.ok, reason: check.reason };
    return;
  }
  const p = toCanvas(clientX, clientY);
  const t = engine.screenToTile(p.x, p.y);
  if (!inBounds(t.x, t.y)) {
    ui.hover = null;
    ui.ghost = null;
    ui.demolishTarget = null;
    return;
  }
  ui.hover = t;
  if (!ui.tool) {
    ui.ghost = null;
    ui.demolishTarget = null;
    return;
  }

  if (ui.tool.kind === 'build' || ui.tool.kind === 'move') {
    const check = placementCheck(ui.tool, t.x, t.y);
    ui.ghost = { x: t.x, y: t.y, ok: check.ok, reason: check.reason };
    ui.demolishTarget = null;
    return;
  }

  if (ui.tool.kind === 'demolish') {
    const o = objectAt(state, t.x, t.y);
    const road = !!state.roads[tileKey(t.x, t.y)];
    const pave = !!state.paint[tileKey(t.x, t.y)];
    const quote = o ? demolitionQuote(state, o) : null;
    ui.demolishTarget = o;
    const blocked = quote && (quote.kind === 'locked' || !quote.affordable);
    ui.ghost = {
      x: t.x,
      y: t.y,
      ok: !!(o || road || pave) && !blocked,
      reason: quote?.kind === 'locked'
        ? '这座建筑不能拆除'
        : quote && !quote.affordable
          ? `清理需要 ${quote.fee} 金币`
          : o || road || pave ? '' : '这里没有可拆除的东西',
    };
    return;
  }

  if (ui.tool.kind === 'road') {
    const style = ui.tool.style || ui.roadStyle;
    const plan = roadRunPlan(state, [[t.x, t.y]], style);
    ui.ghost = {
      x: t.x,
      y: t.y,
      ok: plan.ok,
      reason: plan.reason || plan.blocked || '',
      cost: plan.cost,
      cells: plan.cells.map((c) => [c.x, c.y]),
      line: plan.line,
      style,
    };
    ui.demolishTarget = null;
    return;
  }

  const k = tileKey(t.x, t.y);
  let ok = true;
  let reason = '';
  if (state.roads[k]) {
    ok = false;
    reason = '这里已经是道路';
  } else if (objectAt(state, t.x, t.y)) {
    ok = false;
    reason = '先移走地上的东西';
  } else if (state.paint[k]) {
    ok = false;
    reason = '这里已经铺过了';
  } else if (state.coins < PAVE_COST) {
    ok = false;
    reason = '金币不够';
  }
  ui.ghost = { x: t.x, y: t.y, ok, reason };
  ui.demolishTarget = null;
}

function tapAt(clientX, clientY, pointerType = 'mouse') {
  if (!engine || !state) return;
  const p = toCanvas(clientX, clientY);
  const t = engine.screenToTile(p.x, p.y);
  if (!inBounds(t.x, t.y)) {
    ui.hover = null;
    if (!ui.tool) closeInspector();
    return;
  }
  ui.hover = t;

  if (!ui.tool) {
    const o = objectAt(state, t.x, t.y);
    if (o) selectObject(o);
    else {
      closeInspector();
      audio?.play('click');
    }
    return;
  }

  if (ui.tool.kind === 'road') {
    if (ui.pending) {
      setRoadEnd(t);
      audio?.play('click');
    } else {
      startRoadRun(t.x, t.y);
    }
    return;
  }

  if (ui.tool.kind !== 'build' && ui.tool.kind !== 'move') {
    updateGhostAt(clientX, clientY);
    return;
  }

  const check = placementCheck(ui.tool, t.x, t.y);
  if (!check.ok) {
    warn(check.reason);
    return;
  }
  // A mouse hovers the exact tile before clicking, so it commits straight
  // away. A finger cannot hover: the first tap only picks the spot, and the
  // ✓/✗ bar asks for a second, deliberate yes. Tapping again before ✓ moves
  // the pending spot instead of committing it.
  if (pointerType === 'mouse') {
    if (commitPlacement(t.x, t.y)) updateGhostAt(clientX, clientY);
    return;
  }
  const firstPick = !ui.pending;
  ui.pending = { kind: ui.tool.kind, id: ui.tool.id, type: ui.tool.type, x: t.x, y: t.y };
  ui.pendingAt = performance.now();
  syncPlaceBar();
  updateGhostAt(clientX, clientY);
  audio?.play('click');
  if (firstPick) showHint('拖动虚影微调位置 · “朝向”/Q 翻转 · 点 ✓ 放置', UI.HINT_PLACE_MS);
}

function dragPendingTo(clientX, clientY) {
  if (!ui.pending || !engine) return;
  const p = toCanvas(clientX, clientY);
  const t = engine.screenToTile(p.x, p.y);
  if (!inBounds(t.x, t.y)) return;
  if (ui.pending.kind === 'road') {
    setRoadEnd(t);
    return;
  }
  const moved = t.x !== ui.pending.x || t.y !== ui.pending.y;
  if (moved) {
    ui.pending.x = t.x;
    ui.pending.y = t.y;
  }
  ui.hover = t;
  const check = placementCheck(ui.pending, t.x, t.y);
  ui.ghost = { x: t.x, y: t.y, ok: check.ok, reason: check.reason };
  if (moved) positionPlaceBar();
}

function commitPlacement(x, y) {
  if (ui.tool?.kind === 'move') return moveSelectedTo(x, y);
  return placeBuildingAt(x, y);
}

function placeBuildingAt(x, y) {
  const type = ui.tool.type;
  const def = defOf(type);
  if (!def) return false;
  const result = placeObject(state, type, x, y, { rot: ui.rot });
  if (!result.ok) {
    warn(result.reason);
    return false;
  }
  audio?.play('place');
  engine.addFloater(x + def.w / 2, y + def.d / 2, `-${fmt(def.cost)}`, '#ef8a67', 1.05);
  if (result.buildTime > 0) {
    engine.addPuff(x + def.w / 2, y + def.d / 2, 1.3, '#f0c98f');
    toast(`${def.name}开工 · 施工 ${formatSeconds(result.buildTime)}`, '', 2600);
    if (!state.settings.buildHintSeen) {
      state.settings.buildHintSeen = true;
      showHint('建筑需要施工时间 · 点建造中的建筑可看广告立即完成', UI.HINT_BUILD_MS);
      save();
    }
  }
  updateHud();
  renderQuest();
  return true;
}

function moveSelectedTo(x, y) {
  const o = objectById(state, ui.tool?.id);
  if (!o) {
    warn('物件已经不存在了');
    return false;
  }
  const result = moveObject(state, o, x, y);
  if (!result.ok) {
    warn(result.reason);
    return false;
  }
  const def = defOf(o.type);
  ui.pending = null;
  audio?.play('place');
  engine.addPuff(x + o.w / 2, y + o.d / 2, 1.1, '#f0c98f');
  updateHud(true);
  renderQuest();
  updateGuide();
  save();
  setTool(null);
  selectObject(o);
  if (def) toast(`${def.name}已移到新位置`, 'good', 2600);
  return true;
}

function commitPending() {
  // The same finger that picked the spot also produces a click right after
  // pointerup. If the bar appeared under it, that click lands on ✓ — ignore
  // clicks until the bar has been visible long enough to be a deliberate tap.
  if (performance.now() - ui.pendingAt < INPUT.CONFIRM_ARM_MS) return;
  const pending = ui.pending;
  if (!pending) return;
  if (pending.kind === 'road') {
    commitRoadRun(pending);
    return;
  }
  ui.pending = null;
  syncPlaceBar();
  if (!commitPlacement(pending.x, pending.y)) return;
  ui.ghost = null;
  if (pending.kind === 'build') {
    const def = defOf(pending.type);
    if (def) showHint(`已放置 ${def.name} · 继续点地面选位置`, UI.HINT_PLACE_MS);
  }
}

function commitRoadRun(pending) {
  const line = roadLineTiles(pending.x0, pending.y0, pending.x1, pending.y1);
  const style = ui.tool?.style || ui.roadStyle;
  const result = paintRoadRun(state, line, style);
  if (!result.ok) {
    warn(result.reason || '这里不能铺路');
    return;
  }
  ui.pending = null;
  syncPlaceBar();
  ui.ghost = null;
  const end = result.line[result.line.length - 1];
  if (result.cost > 0) {
    engine.addFloater(end[0] + 0.5, end[1] + 0.5, `-${fmt(result.cost)}`, '#ef8a67', 1.05);
    audio?.play('place');
  }
  updateHud();
  renderQuest();
  save();
  const built = result.cells.length;
  if (!built) showHint('这段已经有路了 · 继续点地面选起点', UI.HINT_PLACE_MS);
  else if (result.blocked) showHint(`已铺 ${built} 格 · ${result.blocked}`, UI.HINT_PLACE_MS);
  else showHint(`已铺 ${built} 格 · 继续点地面选起点`, UI.HINT_PLACE_MS);
}

function cancelPending() {
  if (performance.now() - ui.pendingAt < INPUT.CONFIRM_ARM_MS) return;
  if (!ui.pending) return;
  const moving = ui.pending.kind === 'move' ? objectById(state, ui.tool?.id) : null;
  ui.pending = null;
  syncPlaceBar();
  ui.ghost = null;
  ui.demolishTarget = null;
  setTool(null);
  if (moving) selectObject(moving);
}

function brushAt(clientX, clientY) {
  if (!engine || !state || !ui.tool) return;
  const p = toCanvas(clientX, clientY);
  const t = engine.screenToTile(p.x, p.y);
  if (!inBounds(t.x, t.y)) return;
  const k = tileKey(t.x, t.y);
  if (gesture?.mode === 'brush') {
    if (gesture.lastKey === k) return;
    gesture.lastKey = k;
  }

  if (ui.tool.kind === 'pave') {
    const result = paintPave(state, t.x, t.y);
    if (!result.ok) {
      if (result.reason === '金币不够') warn(result.reason);
      return;
    }
    const now = performance.now();
    if (now - lastBrushSound > 85) {
      audio?.play('click');
      lastBrushSound = now;
    }
    if (gesture?.mode === 'brush') gesture.didPaint = true;
    updateHud();
    updateGhostAt(clientX, clientY);
    return;
  }

  if (ui.tool.kind === 'demolish') {
    const result = demolishAt(state, t.x, t.y);
    if (!result.ok) {
      if (result.kind === 'poor' || result.kind === 'locked') warn(result.reason);
      return;
    }
    if (gesture?.mode === 'brush') gesture.didPaint = true;
    const now = performance.now();
    if (now - lastBrushSound > 85) {
      audio?.play(result.kind === 'object' ? 'demolish' : 'click');
      lastBrushSound = now;
    }
    if (result.kind === 'object') {
      const money = result.fee > 0
        ? `-${fmt(result.fee)}`
        : result.refund ? `+${fmt(result.refund)}` : '已拆除';
      engine.addFloater(
        t.x + 0.5, t.y + 0.5, money,
        result.fee > 0 ? '#ef8a67' : '#a8dd8f', 1.1,
      );
    }
    updateHud();
    updateGhostAt(clientX, clientY);
  }
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (adActive) {
    if (e.key === 'Escape') e.preventDefault();
    return;
  }
  if (ui.pending && e.key === 'Enter') {
    commitPending();
    e.preventDefault();
    return;
  }
  if (e.key === 'Escape') {
    if (ui.pending) cancelPending();
    else if (!els.modal.hidden) closeModal();
    else if (openDrawerId) closeDrawers();
    else if (ui.tool) setTool(null);
    else if (!els.inspector.hidden) closeInspector();
    return;
  }
  if (!els.modal.hidden) return;
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

  switch (e.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      engine.panBy(0, 38);
      e.preventDefault();
      break;
    case 'ArrowDown':
    case 's':
    case 'S':
      engine.panBy(0, -38);
      e.preventDefault();
      break;
    case 'ArrowLeft':
    case 'a':
    case 'A':
      engine.panBy(38, 0);
      e.preventDefault();
      break;
    case 'ArrowRight':
    case 'd':
    case 'D':
      engine.panBy(-38, 0);
      e.preventDefault();
      break;
    case '+':
    case '=':
      zoomAroundCenter(INPUT.ZOOM_KEY_FACTOR);
      break;
    case '-':
    case '_':
      zoomAroundCenter(1 / INPUT.ZOOM_KEY_FACTOR);
      break;
    case 'q':
    case 'Q':
      rotateBy(-1);
      e.preventDefault();
      break;
    case 'e':
    case 'E':
      rotateBy(1);
      e.preventDefault();
      break;
    case 'm':
    case 'M':
      toggleDrawer('missionPanel');
      break;
    case 'h':
    case 'H':
      showHelp();
      break;
    default:
      break;
  }
}

function onResize() {
  if (!engine) return;
  engine.resize();
  syncViewLayout();
  positionIntroRing();
  const orientation = window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  if (lastOrientation && lastOrientation !== orientation) {
    engine.cam.zoom = engine.defaultZoom();
    recenter(false);
  }
  lastOrientation = orientation;
  if (lastPointer) updateGhostAt(lastPointer.x, lastPointer.y);
}

function syncDockMode() {
  if (!els.dock) return;
  els.dock.classList.toggle('is-collapsed', !ui.dockOpen);
}

function syncViewLayout() {
  if (!engine) return;
  syncDockMode();
  const top = $('topbar')?.offsetHeight || 40;
  const dock = $('dock')?.offsetHeight || 118;
  // The compact dock is measured instead of hard-coded, so hint, inspector
  // and zoom controls sit exactly above it on every screen.
  document.documentElement.style.setProperty('--dock-h', `${dock}px`);
  engine.centerYOffset = Math.round((top - dock) / 2);
}

// ---------------------------------------------------------------------------
// Drawers & modal

function toggleDrawer(id) {
  if (openDrawerId === id) closeDrawers();
  else openDrawer(id);
}

function openDrawer(id) {
  if (!state) return;
  if (openDrawerId && openDrawerId !== id) closeDrawers(true);
  const el = $(id);
  if (!el) return;
  if (id === 'missionPanel') renderMissions();
  if (id === 'storePanel') renderStore();
  if (id === 'reviewPanel') {
    renderReview();
    renderFestival();
  }
  if (id === 'menuPanel') renderMenuState();
  if (id === 'devPanel') renderDevStatus();
  openDrawerId = id;
  els.scrim.hidden = false;
  el.hidden = false;
  void el.offsetWidth;
  el.classList.add('open');
  audio?.play('click');
}

function closeDrawers(immediate = false) {
  const id = openDrawerId;
  openDrawerId = null;
  els.scrim.hidden = true;
  if (!id) return;
  const el = $(id);
  if (!el) return;
  el.classList.remove('open');
  if (immediate) {
    el.hidden = true;
  } else {
    setTimeout(() => {
      if (!el.classList.contains('open')) el.hidden = true;
    }, UI.MODAL_CLOSE_MS);
  }
}

function showModal(html, onAction, { backdrop = true } = {}) {
  modalAction = onAction || null;
  closeOnBackdrop = backdrop;
  els.modalCard.innerHTML = html;
  els.modal.hidden = false;
}

function closeModal() {
  els.modal.hidden = true;
  if (intro.pending) startIntro();
  modalAction = null;
}

function onModalClick(e) {
  if (e.target === els.modal) {
    if (closeOnBackdrop) closeModal();
    return;
  }
  const btn = e.target.closest('[data-modal]');
  if (!btn) return;
  const action = btn.dataset.modal;
  const fn = modalAction;
  closeModal();
  if (fn) fn(action);
}

// ---------------------------------------------------------------------------
// Speed & rewarded ads

function speedClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function updateSpeedButton() {
  if (!state || !els.btnSpeed) return;
  const left = boostLeftMs(state);
  const active = state.speed === 3 && left > 0;
  const mult = speedMultiplier(state);
  els.btnSpeed.textContent = active ? `3× ${speedClock(left)}` : `${mult}×`;
  els.btnSpeed.classList.toggle('boost', active);
  els.btnSpeed.title = active
    ? `3× 加速剩余 ${speedClock(left)}，点击切回 1×`
    : `当前 ${mult}×，点击切换速度`;
}

function onSpeedClick() {
  if (!state || adActive) return;
  const next = nextSpeed(state);
  if (next === 3) {
    if (boostLeftMs(state) > 0) {
      setSpeed(state, 3);
      afterSpeedChange(`继续 3× 加速 · 剩余 ${speedClock(boostLeftMs(state))}`);
      return;
    }
    showModal(`<div class="modal-kicker">SPEED BOOST</div>
      <h2>开启 3× 加速？</h2>
      <p>观看一段激励广告，解锁 ${SPEED.BOOST_LABEL}的 3× 游戏速度。不看广告也可以继续用免费的 2×。</p>
      <div class="modal-actions">
        <button class="btn wide" type="button" data-modal="stay">保持 2×</button>
        <button class="btn primary wide" type="button" data-modal="watch">看广告 · 3×</button>
      </div>`, (action) => {
      if (action !== 'watch') return;
      showRewardedAd({
        onReward() {
          grantBoost(state);
          afterSpeedChange(`3× 加速已开启 · ${SPEED.BOOST_LABEL}`);
        },
      });
    });
    return;
  }
  setSpeed(state, next);
  afterSpeedChange(next === 2 ? '2× 速度 · 免费' : '1× 速度');
}

function afterSpeedChange(message) {
  updateSpeedButton();
  updateHud(true);
  save();
  audio?.play('click');
  if (message) toast(message, 'good', 2400);
}

// The portal asks for a muted, paused game while a video runs.
function beginAdBreak() {
  if (adBreak) return;
  adBreak = true;
  audio?.pause();
  gameplayStop();
}

function endAdBreak() {
  if (!adBreak) return;
  adBreak = false;
  audio?.resume();
  gameplayStart();
}

async function showRewardedAd({ onReward }) {
  if (adActive) return;
  adActive = true;
  const seq = ++adSeq;
  beginAdBreak();
  let res;
  try {
    res = await RewardedAds.show();
  } finally {
    endAdBreak();
  }
  if (seq !== adSeq) return;
  adActive = false;
  if (res?.ok) {
    onReward?.();
    return;
  }
  const reason = res?.error;
  if (reason === 'adblock' || reason === 'adsDisabled') {
    toast('广告被拦截或当前不可用，奖励未发放', 'warn', 3200);
  } else if (!res?.started) {
    // No fill, basic-launch QA, or a portal that cannot serve video: the player
    // never saw an ad, so don't blame them for closing it early.
    toast('广告暂时无法播放，请稍后再试', 'warn', 3000);
  } else {
    toast('需完整观看广告才能获得奖励', 'warn', 3000);
  }
}

async function showMidgameAd() {
  if (adActive) return;
  adActive = true;
  const seq = ++adSeq;
  beginAdBreak();
  try {
    await requestAd('midgame');
  } finally {
    endAdBreak();
  }
  if (seq === adSeq) adActive = false;
}

function coinAdReward() {
  const level = state?.review?.level || 1;
  return AD_COIN_BY_LEVEL[Math.min(level, AD_COIN_BY_LEVEL.length) - 1];
}

function offerCoinAd() {
  if (!state || adActive) return;
  const level = state.review?.level || 1;
  const reward = coinAdReward();
  showModal(`<div class="modal-kicker">REWARDED AD</div>
    <h2>看广告领金币？</h2>
    <p>看完可获得 <b>${fmt(reward)}</b> 金币。当前小镇 Lv.${level}，这些差不多是半栋同级建筑。</p>
    <div class="modal-actions">
      <button class="btn wide" type="button" data-modal="close">先不看</button>
      <button class="btn primary wide" type="button" data-modal="watch">看广告 · +${fmt(reward)}</button>
    </div>`, (action) => {
    if (action !== 'watch') return;
    showRewardedAd({
      onReward() {
        state.coins += reward;
        state.stats.adCoins = (state.stats.adCoins || 0) + reward;
        updateHud(true);
        audio?.play('coin');
        toast(`广告奖励 +${fmt(reward)} 金币`, 'good');
        save();
      },
    });
  });
}

function rushBuild(o) {
  if (!o || isBuilt(o)) return;
  const id = o.id;
  const def = defOf(o.type);
  showModal(`<div class="modal-kicker">FINISH BUILD</div>
    <h2>立即完成建造？</h2>
    <p>观看一段激励广告可立即完成 ${def?.name || '建筑'}，省下 ${formatSeconds(o.buildLeft)}施工时间；不看广告也可以继续等待。</p>
    <div class="modal-actions">
      <button class="btn wide" type="button" data-modal="wait">继续等待</button>
      <button class="btn primary wide" type="button" data-modal="watch">看广告 · 立即完成</button>
    </div>`, (action) => {
    if (action !== 'watch') return;
    showRewardedAd({
      onReward() {
        const target = objectById(state, id);
        if (!target || isBuilt(target)) return;
        const events = [];
        finishConstruction(state, target, events);
        handleEvents(events);
        updateHud(true);
        renderQuest();
        updateGuide();
        if (ui.selectedId === id) renderInspector(true);
        save();
        toast(`${def?.name || '建筑'}已完工`, 'good', 2600);
      },
    });
  });
}

function showHelp() {
  closeDrawers(true);
  showModal(`<div class="modal-kicker">FIELD MANUAL</div>
    <h2>怎么玩</h2>
    <p>你有一座十六块地的美食小岛。顾客从南门牌楼的门洞进镇，沿着道路找有空位的餐馆；吃不到就会掉头离开。冰湖跨海大桥通车后，冰原还会多一条过桥客流。</p>
    <div class="help-block"><b>视角</b><p>拖拽空地平移，滚轮或双指缩放；右下角“中”回到小镇。</p></div>
    <div class="help-block"><b>顾客与道路</b><p>牌楼门洞、餐馆和生产建筑都要贴着道路。顾客按道路寻路，排队会消耗耐心；队伍最多 3 人，满了就换一家。</p></div>
    <div class="help-block"><b>食材怎么来</b><p>地里种、棚里养，收下来的食材会进仓库。面包房和工厂负责加工，餐馆有料、有客人才会出餐。冷库能多放些东西。</p></div>
    <div class="help-block"><b>评分晋升</b><p>卖餐涨口味，接客涨人气，种树种装饰涨环境，奇怪建筑涨创意。评分满 40 后在“基建”建评分大厅；评分达到下一级门槛，再花 300 金币办美食节，限时接待足够顾客就能晋升。</p></div>
    <div class="help-block"><b>施工与加速</b><p>建筑开工后要等施工完成才会生产或接待顾客。点建造中的建筑，可看激励广告立即完成。右上角速度按钮在 1× / 2× / 3× 之间切换：2× 免费，3× 会先询问，选择看广告才解锁 ${SPEED.BOOST_LABEL}。</p></div>
    <div class="help-block"><b>去别处看看</b><p>小镇升级后，会陆续开放新的地方。想知道哪里能去，打开「评分」里的小岛地图。</p></div>
    <div class="help-grid">
      <span>拖拽 / WASD</span><b>移动视角</b>
      <span>滚轮 / 双指</span><b>缩放</b>
      <span>右上速度</span><b>1× / 2× / 3×</b>
      <span>M</span><b>目标列表</b>
      <span>H</span><b>这份说明</b>
    </div>
    <div class="modal-actions"><button class="btn primary wide" type="button" data-modal="ok">知道了</button></div>`, () => {
    audio?.play('click');
  });
}

function confirmReset() {
  showModal(`<div class="modal-kicker">RESET SAVE</div>
    <h2>重新开始？</h2>
    <p>当前小镇、金币、仓库与目标进度会全部清空，无法恢复。</p>
    <div class="modal-actions">
      <button class="btn wide" type="button" data-modal="cancel">再想想</button>
      <button class="btn danger wide" type="button" data-modal="reset">清空重来</button>
    </div>`, (action) => {
    if (action === 'reset') resetGame();
  });
}

function resetGame() {
  const settings = { ...state.settings };
  adActive = false;
  adSeq += 1;
  removeStorage(SAVE_KEY);
  state = createInitialState();
  state.settings = settings;
  htmlCache.clear();
  engine.floaters = [];
  engine.puffs = [];
  engine.smokeTimers.clear();
  lastCoins = -1;
  ui.tool = null;
  ui.selectedId = null;
  ui.hover = null;
  ui.ghost = null;
  ui.demolishTarget = null;
  closeDrawers(true);
  closeInspector();
  category = 'grow';
  setCategorySilently('grow');
  setTool(null);
  engine.cam.zoom = engine.defaultZoom();
  recenter(false);
  updateHud(true);
  renderQuest();
  renderFestival();
  renderReview();
  syncAudioButtons();
  save();
  toast('小镇已重新开始', 'good');
}

// ---------------------------------------------------------------------------
// Sound

function toggleSound() {
  if (!state) return;
  state.settings.sound = !state.settings.sound;
  applyAudioSettings();
  if (state.settings.sound && !systemMuted) audio?.play('click');
  syncAudioButtons();
  save();
  if (state.settings.sound && systemMuted) {
    toast('游戏当前处于静音状态，请先打开声音', 'warn', 3600);
    return;
  }
  toast(state.settings.sound ? '音效已开启' : '音效已关闭', state.settings.sound ? 'good' : '');
}

function toggleMusic() {
  if (!state) return;
  state.settings.music = !state.settings.music;
  applyAudioSettings();
  renderMenuState();
  save();
  if (state.settings.music && systemMuted) {
    toast('游戏当前处于静音状态，请先打开声音', 'warn', 3600);
    return;
  }
  toast(state.settings.music ? '背景音乐已开启' : '背景音乐已关闭', state.settings.music ? 'good' : '');
}

// ---------------------------------------------------------------------------
// Simulation & events

function recenter(withSound = false) {
  if (!engine || !state) return;
  const built = state.objects.filter((o) => !o.natural);
  const source = built.length ? built : state.objects;
  let sx = 0;
  let sy = 0;
  for (const o of source) {
    sx += o.x + o.w / 2;
    sy += o.y + o.d / 2;
  }
  const denom = Math.max(1, source.length);
  engine.centerOnTile(sx / denom, sy / denom, engine.cam.zoom || engine.defaultZoom());
  if (lastPointer) updateGhostAt(lastPointer.x, lastPointer.y);
  if (withSound) toast('已回到小镇中心', '');
}

function handleEvents(events) {
  if (!events.length || !engine) return;
  let missionDone = false;
  let reviewDirty = false;
  let reviewFull = false;
  let wormFull = false;
  for (const ev of events) {
    if (ev.type === 'toll') {
      engine.addFloater(ev.x, ev.y, `+${fmt(ev.coins)}`, '#f0c98f', 0.9);
      audio?.play('coin');
    } else if (ev.type === 'sale') {
      const o = objectById(state, ev.id);
      if (o) engine.addFloater(o.x + o.w / 2, o.y + o.d / 2, `+${fmt(ev.coins)}`, '#f0c98f', 1.35);
      reviewDirty = true;
      audio?.play('coin');
    } else if (ev.type === 'harvest') {
      const o = objectById(state, ev.id);
      const info = RESOURCES[ev.res];
      if (o && info) {
        engine.addFloater(o.x + o.w / 2, o.y + o.d / 2, `+${ev.amount} ${info.short}`, '#a8dd8f', 1.05);
        audio?.play('harvest');
      }
    } else if (ev.type === 'wormHarvest') {
      const o = objectById(state, ev.id);
      if (ev.voided) {
        if (!wormFull) {
          wormFull = true;
          toast('仓库已满 · 本次翻沙未采集', 'warn', 2400);
        }
      } else if (o) {
        engine.addFloater(o.x + o.w / 2, o.y + o.d / 2, `+${ev.amount} 虫`, '#a8dd8f', 1.1);
        audio?.play('harvest');
      }
    } else if (ev.type === 'meat') {
      const o = objectById(state, ev.id);
      if (o) {
        const res = RESOURCES[ev.res];
        engine.addFloater(o.x + o.w / 2, o.y + o.d / 2, `+${ev.amount} ${res.short}`, res.color, 1.05);
        audio?.play('harvest');
      }
    } else if (ev.type === 'octoHorn') {
      const o = objectById(state, ev.id);
      if (o) engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 1.05, '#ffe07a');
      toast('远航带回第一条巨大章鱼脚 · 已入库', 'gold', 3600);
      audio?.play('mission');
      updateGuide();
    } else if (ev.type === 'dinoResearch') {
      const o = objectById(state, ev.id);
      if (o) engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 1.15, '#ffe07a');
      reviewDirty = true;
      toast('研究完成 · 白垩纪牧场已解锁（Lv.10 建造）', 'gold', 3600);
      audio?.play('mission');
      updateGuide();
    } else if (ev.type === 'mammothResearch') {
      const o = objectById(state, ev.id);
      if (o) engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 1.15, '#cfe4e8');
      toast('冻土研究完成 · 猛犸牧场将在 Lv.7 开放', 'gold', 3600);
      audio?.play('mission');
      updateGuide();
    } else if (ev.type === 'produce') {
      const o = objectById(state, ev.id);
      if (o) {
        const first = Object.entries(ev.out || {}).find(([, n]) => n > 0);
        if (first) {
          const info = RESOURCES[first[0]];
          engine.addFloater(o.x + o.w / 2, o.y + o.d / 2, `+${first[1]} ${info?.short || ''}`, '#91c8b8', 1);
        }
      }
    } else if (ev.type === 'beerBuff') {
      const o = objectById(state, ev.id);
      if (o) {
        engine.addFloater(o.x + o.w / 2, o.y + o.d / 2, `${ev.label} ${ev.remaining}s`, '#ffd479', 1.1);
        engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 0.85, '#ffd479');
      }
    } else if (ev.type === 'buildDone') {
      const o = objectById(state, ev.id);
      if (o) engine.addPuff(o.x + o.w / 2, o.y + o.d / 2, 1.15, '#ffe07a');
      reviewDirty = true;
      audio?.play('mission');
      if (o?.type === 'reviewHall') {
        reviewFull = true;
        toast('评分大厅建成 · 点右上「评分」查看晋升', 'gold', 3600);
      } else if (o?.type === 'deepSeaHarbor') {
        toast('远航海港建成 · 远航捕捞舰已停到涡流旁', 'gold', 3600);
        updateGuide();
      } else if (o?.type !== 'paleoLab' && o?.type !== 'permafrostLab') {
        toast(`${ev.name}建成`, 'good', 2200);
      }
    } else if (ev.type === 'reviewer') {
      reviewDirty = true;
      reviewFull = true;
      toast(`评分官到访 · 已接待 ${ev.served} 位顾客  +${ev.bonus} 评分`, 'gold', 3200);
      audio?.play('mission');
    } else if (ev.type === 'angry') {
      const tone = ev.reason === 'stock' ? '外卖没备好' : '等太久了';
      engine.addFloater(ev.x, ev.y, '顾客走了', '#ef8a67', 0.95);
      if (ev.reason === 'stock' || ev.reason === 'closed') toast(`顾客离开：${tone}`, 'warn', 2000);
    } else if (ev.type === 'mission') {
      missionDone = true;
      toast(`目标完成 · ${ev.title}  +${fmt(ev.reward)} 金币`, 'gold', 3200);
      audio?.play('mission');
    } else if (ev.type === 'hallReady') {
      reviewDirty = true;
      reviewFull = true;
      toast('评分大厅已解锁 · 在「基建」页建造', 'gold', 3600);
      audio?.play('mission');
    } else if (ev.type === 'promoteReady') {
      reviewDirty = true;
      reviewFull = true;
      if (!state.festival && reviewHallReady(state)) {
        toast(`评分达标 · 去评分大厅开启美食节（需 ${FESTIVAL_COST} 金币）`, 'gold', 3800);
        audio?.play('mission');
      }
    } else if (ev.type === 'rescue') {
      updateGuide();
      toast(`小镇救济金 +${fmt(ev.coins)} · 先把店和路补回来`, 'gold', 5200);
      audio?.play('mission');
    } else if (ev.type === 'festivalStart') {
      reviewDirty = true;
      reviewFull = true;
      toast(`美食节开始 · ${ev.seconds} 秒内接待 ${ev.target} 位顾客`, 'gold', 3400);
      engine.addPuff(...hallPuffPoint(), '#ffe07a');
      audio?.play('mission');
    } else if (ev.type === 'festivalSuccess') {
      reviewDirty = true;
      reviewFull = true;
      handleFestivalSuccess(ev);
    } else if (ev.type === 'festivalFail') {
      reviewDirty = true;
      reviewFull = true;
      toast(`美食节结束 · 接待 ${ev.served}/${ev.target}，未达成目标`, 'warn', 3600);
      audio?.play('error');
    }
  }
  if (missionDone) {
    renderQuest();
    if (openDrawerId === 'missionPanel') renderMissions();
  }
  if (reviewDirty) {
    updateHud(true);
    refreshAffordability();
    if (openDrawerId === 'reviewPanel') {
      if (reviewFull) renderReview();
      else updateReviewLive();
    }
  }
}

function hallPuffPoint() {
  const hall = reviewHall(state);
  return hall ? [hall.x + hall.w / 2, hall.y + hall.d / 2, 1.6] : [30, 57, 1.6];
}

function handleFestivalSuccess(ev) {
  const plotText = ev.plots?.length
    ? `现在可以去${ev.plots.map((p) => p.name).join('、')}了。`
    : '岛上的地方都能去了。';
  showModal(`<div class="modal-kicker">PROMOTION</div>
    <h2>晋升 Lv.${ev.level}</h2>
    <p>美食节办成了，小镇又升了一级。</p>
    <div class="modal-reward"><span class="ico ico-coin"></span><b>+${fmt(ev.reward)}</b><small>金币</small></div>
    <p class="modal-note">${plotText}</p>
    <div class="modal-actions"><button class="btn primary wide" type="button" data-modal="ok">继续经营</button></div>`, () => {
    audio?.play('mission');
    // A promotion is a natural level boundary; the portal caps midgame ads at
    // one every three minutes, so a fast player never sees a second one.
    if (isPortal()) showMidgameAd();
  });
  renderFestival();
}

function simSpeed() {
  const now = Date.now();
  if (state.speed === 3 && boostLeftMs(state, now) <= 0) {
    setSpeed(state, 2);
    updateSpeedButton();
    toast('3× 加速已结束 · 回到 2×', 'warn', 2600);
    save();
  }
  return speedMultiplier(state, now);
}

// ---------------------------------------------------------------------------
// Device diagnostics
//
// The uploaded build stalls on a phone in a way no desktop run reproduces, and
// nothing on screen says which number went bad. This overlay reports the few
// that could: frame time, heap, canvas size and the ground chunk cache. It is
// plain DOM, which matters — it keeps printing after the canvas has stopped
// presenting, and a frozen number is itself the reading.

const DIAG_TAPS = 6;
const DIAG_TAP_MS = 4000;
const DIAG_REFRESH_MS = 500;
const diag = {
  on: false, el: null, text: null, frames: 0, spanAt: 0, lastAt: 0,
  sumMs: 0, worstMs: 0, fps: 0, avgMs: 0, blank: -1, blankAt: 0, errors: [],
};
let diagTaps = 0;
let diagTapAt = 0;

// A crash on the phone can take the canvas down without stopping the loop; the
// last uncaught message then explains more than any frame counter.
window.addEventListener('error', (e) => {
  diag.errors.push(String(e.error?.message || e.message || 'error').slice(0, 160));
  if (diag.errors.length > 4) diag.errors.shift();
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  diag.errors.push(String(reason?.message || reason || 'rejection').slice(0, 160));
  if (diag.errors.length > 4) diag.errors.shift();
});

function bindDiagTaps() {
  const el = $('coins');
  el.style.pointerEvents = 'auto';
  el.addEventListener('pointerdown', () => {
    const now = performance.now();
    if (now - diagTapAt > DIAG_TAP_MS) diagTaps = 0;
    diagTapAt = now;
    if (++diagTaps < DIAG_TAPS) return;
    diagTaps = 0;
    toggleDiag();
  });
}

function toggleDiag() {
  diag.on = !diag.on;
  const el = diagEl();
  el.hidden = !diag.on;
  const atlasBtn = $('diagAtlas');
  if (atlasBtn) atlasBtn.hidden = !diag.on;
  diag.frames = 0;
  diag.sumMs = 0;
  diag.worstMs = 0;
  diag.blank = -1;
  diag.spanAt = performance.now();
  diag.lastAt = diag.spanAt;
  if (diag.on) renderDiag();
}

// Every frame we draw is also a frame the webview has to composite, and the
// two costs are invisible to each other: the loop can finish in 3ms and the
// page still sticks at 10fps. The probe runs two phases: first nothing is
// drawn, which leaves the webview's own frame clock; then one flat fill of the
// canvas per frame, which keeps the whole presentation path busy for the price
// of a single rectangle. What survives tells apart "our draw calls cost too
// much" from "any canvas update costs too much".
const rafProbe = {
  idleFrom: 0, idleTo: 0, fillFrom: 0, fillTo: 0,
  idleFrames: 0, fillFrames: 0, idleFps: 0, fillFps: 0,
};
function startRafProbe() {
  const t = performance.now();
  rafProbe.idleFrom = t;
  rafProbe.idleTo = t + 1200;
  rafProbe.fillFrom = t + 1200;
  rafProbe.fillTo = t + 2400;
  rafProbe.idleFrames = 0;
  rafProbe.fillFrames = 0;
  rafProbe.idleFps = -1;
  rafProbe.fillFps = -1;
  renderDiag();
}

// Whether canvas raster is on the GPU decides which fix is worth anything:
// a dead GPU process falls back to software raster for the whole page, and
// then texture memory is irrelevant while fill rate is everything.
let gpuLabel = null;
function gpuName() {
  if (gpuLabel) return gpuLabel;
  try {
    // A second WebGL context is one way to lose the first: the context limit on
    // a phone driver is small and the newest canvas wins, so probing with a
    // throwaway canvas can take the stage's context down with it — permanently,
    // because the browser only restores the one it was told to drop. Ask the
    // live context instead, and probe only when there never was one (GL off or
    // unsupported). While a stage context exists but is lost, a probe is exactly
    // the competitor that can cost us the restore, so the panel says "waiting".
    const stage = engine?.glStage?.gl;
    if (stage?.isContextLost()) {
      gpuLabel = 'waiting for restore';
      return gpuLabel;
    }
    let gl = stage || null;
    if (!gl) {
      const probe = document.createElement('canvas');
      gl = probe.getContext('webgl') || probe.getContext('experimental-webgl');
    }
    if (!gl) {
      gpuLabel = 'webgl unavailable';
      return gpuLabel;
    }
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    gpuLabel = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    if (!stage) gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch (err) {
    gpuLabel = `probe failed: ${err.message}`;
  }
  return gpuLabel;
}

function diagEl() {
  if (diag.el) return diag.el;
  const el = document.createElement('div');
  el.id = 'diagPanel';
  el.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:86px', 'margin:0', 'padding:7px 9px',
    'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#e8f4e0', 'background:rgba(8,18,12,.86)',
    'border:1px solid rgba(255,255,255,.2)', 'border-radius:8px',
    'max-width:min(94vw,560px)',
    'z-index:9999', 'pointer-events:auto',
  ].join(';');
  el.hidden = true;
  const text = document.createElement('pre');
  text.id = 'diagText';
  text.style.cssText = 'margin:0;padding-right:104px;font:inherit;white-space:pre-wrap;word-break:break-all;cursor:pointer';
  // Tapping the text walks the backing-store scale down and back up, so a
  // phone that cannot fill 2400x1080 can be compared in the same run instead
  // of across uploads.
  const scales = [1, 0.75, 0.625];
  text.addEventListener('pointerdown', () => {
    const i = scales.indexOf(engine.renderScale);
    engine.setRenderScale(scales[(i + 1) % scales.length]);
    renderDiag();
  });
  el.appendChild(text);
  diag.text = text;

  // A phone that cannot reach 60fps can be limited by our drawing or by the
  // webview's own frame clock; the idle probe stops drawing for a moment and
  // measures the cadence that is left, which tells the two apart.
  const probeBtn = document.createElement('button');
  probeBtn.id = 'diagRaf';
  probeBtn.textContent = '测rAF';
  probeBtn.style.cssText = [
    'position:absolute', 'top:3px', 'right:48px', 'padding:1px 4px',
    'font:10px/1.3 ui-monospace,monospace', 'color:#ffe9a8',
    'background:rgba(255,255,255,.08)', 'border:1px solid rgba(255,255,255,.25)',
    'border-radius:4px', 'cursor:pointer',
  ].join(';');
  probeBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    startRafProbe();
  });
  el.appendChild(probeBtn);

  const layerBtn = document.createElement('button');
  layerBtn.id = 'diagLayer';
  layerBtn.textContent = '切层';
  layerBtn.style.cssText = [
    'position:absolute', 'top:3px', 'right:26px', 'padding:1px 4px',
    'font:10px/1.3 ui-monospace,monospace', 'color:#bfe8c0',
    'background:rgba(255,255,255,.08)', 'border:1px solid rgba(255,255,255,.25)',
    'border-radius:4px', 'cursor:pointer',
  ].join(';');
  layerBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    engine.debugSkip = ((engine.debugSkip || 0) + 1) % 6;
    renderDiag();
  });
  el.appendChild(layerBtn);

  const closeBtn = document.createElement('button');
  closeBtn.id = 'diagClose';
  closeBtn.textContent = '✕';
  closeBtn.style.cssText = [
    'position:absolute', 'top:2px', 'right:4px', 'width:20px', 'height:18px',
    'font:12px/1 ui-monospace,monospace', 'color:#ffd9a0',
    'background:rgba(255,255,255,.08)', 'border:1px solid rgba(255,255,255,.25)',
    'border-radius:4px', 'cursor:pointer',
  ].join(';');
  closeBtn.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    toggleDiag();
  });
  el.appendChild(closeBtn);

  document.body.appendChild(el);
  diag.el = el;

  const btn = document.createElement('div');
  btn.id = 'diagAtlas';
  btn.style.cssText = [
    'position:fixed', 'left:8px', 'bottom:56px', 'padding:5px 9px',
    'font:11px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#ffe9a8', 'background:rgba(8,18,12,.86)',
    'border:1px solid rgba(255,255,255,.2)', 'border-radius:8px',
    'z-index:9999', 'cursor:pointer',
  ].join(';');
  btn.hidden = true;
  btn.addEventListener('pointerdown', async (e) => {
    e.stopPropagation();
    if (atlasScale < 1) {
      // Going back up needs the full-size pages, which were dropped on purpose.
      location.reload();
      return;
    }
    btn.textContent = '图集压缩中…';
    await setAtlasScale(0.5);
    renderDiag();
    renderAtlasBtn();
  });
  document.body.appendChild(btn);
  return el;
}

function renderAtlasBtn() {
  const btn = $('diagAtlas');
  if (!btn || !engine) return;
  const mb = engine.stats().atlasMB;
  btn.textContent = atlasScale < 1
    ? `图集 ${mb}MB（1×）· 点我刷新回 2×`
    : `图集 ${mb}MB（2×）· 点我压到 1× 看 FPS`;
}

function diagFrame(ms) {
  diag.frames++;
  diag.sumMs += ms;
  if (ms > diag.worstMs) diag.worstMs = ms;
  const now = performance.now();
  if (now - diag.lastAt < DIAG_REFRESH_MS) return;
  const span = Math.max(1, now - diag.spanAt);
  diag.fps = (diag.frames * 1000) / span;
  diag.avgMs = diag.sumMs / Math.max(1, diag.frames);
  diag.frames = 0;
  diag.sumMs = 0;
  diag.spanAt = now;
  diag.lastAt = now;
  renderDiag();
  diag.worstMs = 0;
}

function renderDiag() {
  if (!diag.on || !engine) return;
  if (!diag.text) diagEl();
  const s = engine.stats();
  const now = performance.now();
  if (now - diag.blankAt > 1000) {
    diag.blankAt = now;
    diag.blank = engine.blankVisible();
  }
  const mem = performance.memory;
  const heap = mem
    ? `${Math.round(mem.usedJSHeapSize / 1048576)}/${Math.round(mem.jsHeapSizeLimit / 1048576)}MB`
    : 'n/a';
  const probeFps = (v) => (v === -1 ? '测中…' : v > 0 ? `${v.toFixed(0)}/s` : '未测');
  diag.text.textContent = [
    `FPS ${diag.fps.toFixed(0)}  avg ${diag.avgMs.toFixed(1)}ms  worst ${diag.worstMs.toFixed(1)}ms  停画 ${probeFps(rafProbe.idleFps)}  空画布 ${probeFps(rafProbe.fillFps)}`,
    `heap ${heap}  device ${navigator.deviceMemory || '?'}GB  touch ${navigator.maxTouchPoints}`,
    `view ${s.view} @${s.dpr}  canvas ${s.canvas}`,
    `chunks ${s.visible}/${s.chunks}  pool ${s.pool}  allocs ${s.allocs}  bakes ${s.bakes}  repairs ${s.repairs}  queued ${s.queued}  ${s.gl ? (s.glLost ? `gl lost s${s.glSwaps}` : `gl static up ${(s.glUpBytes / 1048576).toFixed(2)}MB/f ${s.glDraws}d`) : `scene ${s.sceneLost ? 'off' : `${s.sceneMB}MB`}`}`,
    `blank ${diag.blank < 0 ? '?' : diag.blank}/${s.blankSample}  zoom ${s.zoom.toFixed(2)}  cam ${s.camX},${s.camY}`,
    `atlas ${s.atlasMB}MB  ${s.pages.join(' ') || 'n/a'}`,
    `render ${(engine.renderScale * 100).toFixed(0)}% 点面板切换（看 FPS 变化）  层 ${engine.debugSkip || 0}`,
    `errors ${diag.errors.length}${diag.errors.length ? `  ${diag.errors[diag.errors.length - 1]}` : ''}`,
    `gpu ${gpuName().slice(0, 72)}`,
    navigator.userAgent.slice(0, 96),
    '点 ✕ 或连点金币 6 次关闭',
  ].join('\n');
  renderAtlasBtn();
}

// Lightweight always-on readout for the dev build: the phone reports come back
// as video, so the numbers have to be on screen without anyone tapping first.
let devPerfEl = null;
let devPerfAcc = 0;
let devPerfFrames = 0;
let frameWorkMs = 0;
let devPrevAllocs = 0;
let devPrevRepairs = 0;
function devPerfTick(dt) {
  devPerfAcc += dt;
  devPerfFrames++;
  if (devPerfAcc < 1) return;
  const fps = Math.round(devPerfFrames / devPerfAcc);
  devPerfAcc = 0;
  devPerfFrames = 0;
  const s = engine.stats();
  const mem = performance.memory;
  const heap = mem ? Math.round(mem.usedJSHeapSize / 1048576) : '?';
  if (!devPerfEl) {
    devPerfEl = document.createElement('div');
    devPerfEl.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:3px', 'transform:translateX(-50%)',
      'font:10px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace',
      'color:#eaf6e4', 'background:rgba(0,0,0,.62)', 'padding:1px 7px',
      'border-radius:4px', 'white-space:nowrap', 'pointer-events:none', 'z-index:9999',
    ].join(';');
    document.body.appendChild(devPerfEl);
  }
  // Work time separates "the main thread is busy" from "the browser cannot
  // present frames" — the two need different fixes, and a screenshot can carry
  // both numbers at once.
  // The GL tag answers what a single phone video cannot: did WebGL ever run, how
  // long has it been silent, and `s2` how many times the surface was thrown away
  // and rebuilt to get it back.
  const glTag = !s.gl
    ? 'GL off'
    : s.glLost
      ? `GL dead ${s.glLostFor}s${s.glSwaps ? ` s${s.glSwaps}` : ''}`
      : `GL ok ${s.glUp}s ${s.glDraws}d up ${(s.glUpBytes / 1048576).toFixed(1)}M/f a${s.glArrLayers}${s.glSwaps ? ` s${s.glSwaps}` : ''}`;
  // Canvas churn per second, i.e. how many surfaces the webview reclaimed and
  // how many the game had to repaint. A white band that appears while panning is
  // that story, and only these two numbers can tell it from a video.
  const newAllocs = s.allocs - devPrevAllocs;
  const repairs = s.repairs - devPrevRepairs;
  devPrevAllocs = s.allocs;
  devPrevRepairs = s.repairs;
  devPerfEl.textContent = `${fps}fps · ${frameWorkMs.toFixed(0)}ms · heap ${heap}MB · ${s.canvas} · atlas ${s.atlasMB}MB · ${glTag} · ${s.visible}v/${s.chunks}c +${newAllocs}a ${repairs}r${s.sceneLost ? ' · scene lost' : ''}`;
}

function startLoop() {
  requestAnimationFrame((t) => {
    lastFrame = t;
    requestAnimationFrame(loop);
  });
}

function loop(now) {
  if (!booted || !state) return;
  const diagStart = diag.on ? performance.now() : 0;
  const dt = Math.min(UI.FRAME_CLAMP_SEC, Math.max(0, (now - lastFrame) / 1000));
  lastFrame = now;

  // A video ad covers the canvas; freezing simulation keeps the town from
  // running (and paying out) behind it.
  if (adBreak) {
    requestAnimationFrame(loop);
    return;
  }

  if (now < rafProbe.idleTo) {
    rafProbe.idleFrames++;
    requestAnimationFrame(loop);
    return;
  }
  if (now < rafProbe.fillTo) {
    const c = engine.ctx;
    c.fillStyle = '#20342a';
    c.fillRect(0, 0, surface().width, surface().height);
    rafProbe.fillFrames++;
    requestAnimationFrame(loop);
    return;
  }
  if (rafProbe.idleTo) {
    rafProbe.idleFps = (rafProbe.idleFrames * 1000) / Math.max(1, rafProbe.idleTo - rafProbe.idleFrom);
    rafProbe.fillFps = (rafProbe.fillFrames * 1000) / Math.max(1, rafProbe.fillTo - rafProbe.fillFrom);
    rafProbe.idleFrom = 0;
    rafProbe.idleTo = 0;
    rafProbe.fillFrom = 0;
    rafProbe.fillTo = 0;
    if (diag.on) renderDiag();
  }

  const events = [];
  const workAt = performance.now();
  tick(state, dt * simSpeed(), events);
  handleEvents(events);
  engine.update(dt, state, ui);
  engine.render(state, ui);
  frameWorkMs = performance.now() - workAt;

  if (intro.active) {
    intro.acc += dt;
    if (intro.acc >= UI.INTRO_RING_REFRESH) {
      positionIntroRing();
      intro.acc = 0;
    }
  }

  hudAcc += dt;
  if (hudAcc >= UI.HUD_REFRESH) {
    updateHud();
    renderFestival();
    hudAcc = 0;
  }

  questAcc += dt;
  if (questAcc >= UI.GUIDE_REFRESH) {
    updateGuide();
    renderQuest();
    if (openDrawerId === 'missionPanel') renderMissions();
    if (openDrawerId === 'storePanel') renderStore();
    if (openDrawerId === 'reviewPanel') updateReviewLive();
    questAcc = 0;
  }

  inspectorAcc += dt;
  if (inspectorAcc >= UI.INSPECTOR_REFRESH) {
    if (ui.selectedId) updateInspector();
    inspectorAcc = 0;
  }

  saveAcc += dt;
  if (saveAcc >= UI.AUTOSAVE_SECONDS) {
    save();
    saveAcc = 0;
  }

  if (DEV && !DEMO) devPerfTick(dt);
  if (diagStart) diagFrame(performance.now() - diagStart);

  requestAnimationFrame(loop);
}

function updateInspector() {
  if (!ui.selectedId) return;
  const o = objectById(state, ui.selectedId);
  if (!o) {
    closeInspector();
    return;
  }
  renderInspector(false);
}

function stepGame(seconds) {
  if (!state) return;
  const steps = Math.max(1, Math.ceil(seconds / UI.SIM_STEP_SEC));
  const dt = seconds / steps;
  const events = [];
  for (let i = 0; i < steps; i++) tick(state, dt, events);
  handleEvents(events);
  updateGuide();
  updateHud(true);
  renderQuest();
  renderFestival();
  if (openDrawerId === 'storePanel') renderStore();
  if (openDrawerId === 'missionPanel') renderMissions();
  if (openDrawerId === 'reviewPanel') renderReview();
  if (ui.selectedId) updateInspector();
}

// ---------------------------------------------------------------------------
// Persistence

function save() {
  if (!state) return false;
  try {
    const raw = serialize(state);
    if (!writeStorage(SAVE_KEY, raw)) return false;
    state.savedAt = Date.now();
    return true;
  } catch (err) {
    console.warn('Save failed', err);
    return false;
  }
}

boot();
