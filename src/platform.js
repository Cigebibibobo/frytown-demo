// Poki SDK v2 bridge. The game also runs outside the portal (local QA, plain
// static hosting), where init fails or never happens and every call degrades to
// a no-op or to localStorage.

const sdk = () => globalThis.PokiSDK || null;

const SDK_TIMEOUT_MS = 8000;

let active = false;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function initPlatform() {
  const api = sdk();
  if (!api || typeof api.init !== 'function') return false;
  const loc = globalThis.location;
  if (!loc || loc.protocol === 'file:') return false;
  // Off poki.com the SDK only runs in debug mode, which is what local QA and
  // the reviewer demo link need; on Poki itself debug must stay off.
  const offPortal = !/(^|\.)poki\.com$/.test(loc.hostname || '');
  try {
    if (offPortal && typeof api.setDebug === 'function') api.setDebug(true);
    await Promise.race([api.init(), wait(SDK_TIMEOUT_MS)]);
    active = true;
  } catch (err) {
    console.warn('[platform] Poki SDK init failed', err);
    active = false;
  }
  return active;
}

export function isPortal() {
  return active;
}

export function platformLocale() {
  return globalThis.navigator?.language || '';
}

export function platformMuted() {
  return false;
}

export function onPlatformMute() {}

function gameCall(name, arg) {
  if (!active) return;
  try {
    sdk()?.[name]?.(arg);
  } catch (err) {
    console.warn(`[platform] ${name} failed`, err);
  }
}

// Poki has no loading-start call: the boot overlay is the loading screen and
// gameLoadingFinished is what releases the portal's own overlay.
export const loadingStart = () => {};
export const loadingStop = () => gameCall('gameLoadingFinished');
export const gameplayStart = () => gameCall('gameplayStart');
export const gameplayStop = () => gameCall('gameplayStop');
export const happytime = () => gameCall('happyTime', 1);

export function requestAd(type, { onStart, onEnd } = {}) {
  if (!active) return Promise.resolve({ ok: false, error: 'unsupported', started: false });
  const api = sdk();
  const run = type === 'rewarded' ? api.rewardedBreak : api.commercialBreak;
  if (typeof run !== 'function') return Promise.resolve({ ok: false, error: 'unsupported', started: false });
  try {
    onStart?.();
  } catch (err) {
    console.warn('[platform] ad start hook failed', err);
  }
  return run.call(api).then((rewarded) => {
    try { onEnd?.(); } catch (err) { console.warn('[platform] ad end hook failed', err); }
    // A rewarded break resolves true only when the player watched it through;
    // false covers both an early close and no fill, so it keeps the neutral
    // "no ad right now" path instead of blaming the player.
    if (type === 'rewarded') return { ok: rewarded === true, started: rewarded === true, ended: rewarded === true };
    return { ok: true, started: true, ended: true };
  }, (err) => {
    try { onEnd?.(); } catch {}
    console.warn('[platform] ad break failed', err);
    return { ok: false, error: 'other', started: false };
  });
}

export function readStorage(key) {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeStorage(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeStorage(key) {
  try { globalThis.localStorage?.removeItem(key); } catch { /* ignore */ }
}
