// Runtime and presentation knobs: save identity, speed boost, UI refresh
// cadence, camera limits and pointer thresholds.

// Store packages flip this to false in tools/build-dist.mjs so the dev drawer,
// ?dev=1 and window.__town never reach players.
export const DEV = false;

export const SAVE = {
  VERSION: 4,
  KEY: 'iso-frytown-save-v4',
  LEGACY_KEY: 'iso-frytown-save-v3',
};

export const SPEED = {
  BOOST_MS: 5 * 60 * 1000,
  BOOST_LABEL: '5 分钟',
};

export const UI = {
  HUD_REFRESH: 0.12,
  GUIDE_REFRESH: 0.4,
  INSPECTOR_REFRESH: 0.28,
  INTRO_RING_REFRESH: 0.1,
  AUTOSAVE_SECONDS: 20,
  TOAST_MS: 2300,
  TOAST_MAX: 4,
  TOAST_OUT_MS: 260,
  MODAL_CLOSE_MS: 240,
  BOOT_FADE_MS: 480,
  INTRO_DELAY_MS: 1200,
  FONT_TIMEOUT_MS: 1400,
  LEGACY_TOAST_DELAY_MS: 2600,
  LEGACY_TOAST_MS: 4200,
  COIN_PULSE_MS: 430,
  WARN_DEDUPE_MS: 900,
  HINT_DEFAULT_MS: 7000,
  HINT_WELCOME_MS: 8000,
  HINT_STEP_MS: 6000,
  HINT_PLACE_MS: 12000,
  HINT_TOOL_MS: 10000,
  HINT_DEMOLISH_MS: 11000,
  HINT_ROTATE_MS: 3200,
  HINT_ROTATE_WARN_MS: 4200,
  HINT_BUILD_MS: 7000,
  FOCUS_ZOOM_MIN: 0.44,
  FOCUS_ZOOM_MAX: 0.9,
  FOCUS_OBJECT_ZOOM_MIN: 0.8,
  FOCUS_PAD_X: 160,
  FOCUS_PAD_Y: 80,
  FOCUS_PAD_D: 170,
  FRAME_CLAMP_SEC: 0.25,
  SIM_STEP_SEC: 0.2,
};

export const CAMERA = {
  MIN_ZOOM: 0.4,
  MAX_ZOOM: 2.1,
  CENTER_Y_OFFSET: -22,
  DEFAULT_FIT_W: 1120,
  DEFAULT_FIT_H_ADD: 60,
  DEFAULT_FIT_H: 600,
  DEFAULT_MIN: 0.55,
  DEFAULT_MAX: 1.1,
};

export const INPUT = {
  TAP_MOVE_PX: 7,
  TAP_MS: 700,
  CONFIRM_ARM_MS: 320,
  BRUSH_WARN_MS: 520,
  WHEEL_MIN_FACTOR: 0.86,
  WHEEL_MAX_FACTOR: 1.16,
  WHEEL_SENSITIVITY: 0.0014,
  ZOOM_BUTTON_FACTOR: 1.18,
  ZOOM_KEY_FACTOR: 1.16,
};
