// 横断歩道の認識モジュール（路面の白いしま模様）。
//
// 状態の方針（js/recognizers/index.js の 3 状態）:
//   detected     : 直近の数回のうち、しま模様を繰り返し見つけた
//   not_detected : 映像は確認できたが、しま模様は見つからなかった（横断歩道がない、とは限らない）
//   unchecked    : 暗すぎる、映像を取得できない
//
// 見つけたときは、人の危険判定の「通り道」の幅を広げる（main.js → danger-core.js）。

import { STATES } from './states.js';
import { CROSSWALK_DEFAULTS, CrosswalkTracker, findCrosswalk } from './crosswalk-core.js';

const REGION_WIDTH = 640;
const INTERVAL_MS = 250; // 約 4 回/秒

export function createCrosswalkRecognizer(config = {}) {
  const options = { ...CROSSWALK_DEFAULTS, ...config };
  const band = options.band;
  const tracker = new CrosswalkTracker();
  let lastAt = -Infinity;
  let last = { state: STATES.UNCHECKED, detail: '準備中', crosswalk: { on: false, box: null } };
  let lastBox = null;

  return {
    id: 'crosswalk',
    label: '横断歩道',
    process(frame) {
      if (frame.timestamp - lastAt < INTERVAL_MS) return last;
      lastAt = frame.timestamp;
      if (typeof frame.getRegion !== 'function') {
        tracker.reset();
        last = { state: STATES.UNCHECKED, detail: '映像を取得できない', crosswalk: { on: false, box: null } };
        return last;
      }
      const reg = frame.getRegion(band[0], band[1], REGION_WIDTH);
      const res = findCrosswalk(reg.data, reg.width, reg.height, options);
      if (res.meanLuma < options.minLuma) {
        tracker.reset();
        lastBox = null;
        last = { state: STATES.UNCHECKED, detail: '暗くて判定不可', crosswalk: { on: false, box: null } };
        return last;
      }
      if (res.found) {
        // 帯の画素 → 映像全体に対する比
        const span = band[1] - band[0];
        lastBox = {
          x: res.x0 / reg.width,
          y: band[0] + (res.y0 / reg.height) * span,
          w: (res.x1 - res.x0) / reg.width,
          h: ((res.y1 - res.y0) / reg.height) * span,
        };
      }
      const on = tracker.update(res.found);
      if (!on) lastBox = null;
      last = on
        ? { state: STATES.DETECTED, detail: '人の判定を広げています', crosswalk: { on: true, box: lastBox } }
        : { state: STATES.NOT_DETECTED, detail: 'しま模様なし', crosswalk: { on: false, box: null } };
      return last;
    },
  };
}
