// Rewarded video through the Poki SDK. Outside the portal the request
// resolves with `{ ok: false, error: 'unsupported' }` and the caller keeps the
// player on the free path; no third-party ad network is involved.
import { isPortal, requestAd } from './platform.js';

export const REWARDED_AD_SECONDS = 0;

export const RewardedAds = {
  isNative() {
    return isPortal();
  },

  show(options) {
    return requestAd('rewarded', options);
  },
};
