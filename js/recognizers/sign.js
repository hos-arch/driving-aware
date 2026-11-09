// 標識認識モジュール（手順1: 色と形の候補だけ）。
//
// 見つけるのは、赤い丸・赤い逆三角・黄色いひし形・青い標識の「色と形」だけで、標識の意味は判定しない。
// 状態の方針（js/recognizers/index.js の 3 状態）:
//   detected     : 上の形の候補を、継続して検出できた
//   not_detected : 映像は確認できたが、候補は見つからなかった（標識がない、とは限らない。他の種類の標識は見ていない）
//   unchecked    : 暗すぎる、高解像度の映像が取れない など

import { STATES } from './states.js';
import { SIGN_DEFAULTS, SIGN_KINDS, findSignCandidates } from './sign-core.js';

const REGION_WIDTH = 1280; // 標識は小さく写るので、車線より高い解像度で見る
const INTERVAL_MS = 300; // 処理の間隔（約 3 回/秒）。重いので毎フレームは行わない

/**
 * 同じ種類の候補が、直近の時間窓の中で同じ場所に繰り返し出たものだけを採用する。
 * 一瞬だけ出る誤検出（木の葉、反射など）を落とすため。
 */
export class SignTracker {
  constructor({ windowMs = 1500, minHits = 2 } = {}) {
    this.windowMs = windowMs;
    this.minHits = minHits;
    this.history = [];
  }

  reset() {
    this.history = [];
  }

  /** @param cands その回の候補（x,y,w,h は同じ座標系） @param scale 位置の許容幅を、画像の大きさに合わせる係数 */
  update(t, cands, scale = 1) {
    this.history.push({ t, cands });
    while (this.history.length && t - this.history[0].t > this.windowMs) this.history.shift();
    return cands.filter((c) => {
      const cx = c.x + c.w / 2;
      const cy = c.y + c.h / 2;
      const tol = Math.max(c.w, c.h) * 1.2 + 20 * scale;
      let hits = 0;
      for (const e of this.history) {
        if (e.cands.some((d) => d.kind === c.kind && Math.abs(d.x + d.w / 2 - cx) <= tol && Math.abs(d.y + d.h / 2 - cy) <= tol)) hits++;
      }
      return hits >= this.minHits;
    });
  }
}

function summarize(signs) {
  const count = {};
  for (const s of signs) count[s.kind] = (count[s.kind] ?? 0) + 1;
  return Object.entries(count)
    .map(([k, n]) => `${SIGN_KINDS[k]}${n > 1 ? ` ${n}` : ''}`)
    .join('・');
}

export function createSignRecognizer(options = {}) {
  const band = options.band ?? SIGN_DEFAULTS.band;
  const tracker = new SignTracker(options.tracker);
  let lastAt = -Infinity;
  let last = { state: STATES.UNCHECKED, detail: '準備中', sign: { band, items: [] } };
  let lastDims = '';

  return {
    id: 'sign',
    label: '標識',
    process(frame) {
      const dims = `${frame.width}x${frame.height}`;
      if (dims !== lastDims) {
        tracker.reset();
        lastDims = dims;
        lastAt = -Infinity;
      }
      if (frame.timestamp - lastAt < INTERVAL_MS) return last; // 前回の結果をそのまま返す
      lastAt = frame.timestamp;

      if (typeof frame.getRegion !== 'function') {
        last = { state: STATES.UNCHECKED, detail: '映像を取得できない', sign: { band, items: [] } };
        return last;
      }
      const reg = frame.getRegion(band[0], band[1], REGION_WIDTH);
      const res = findSignCandidates(reg.data, reg.width, reg.height, { ...options, band });
      if (res.meanLuma < (options.minLuma ?? SIGN_DEFAULTS.minLuma)) {
        tracker.reset();
        last = { state: STATES.UNCHECKED, detail: '暗くて判定不可', sign: { band, items: [] } };
        return last;
      }

      const scale = reg.width / SIGN_DEFAULTS.baseW;
      const confirmed = tracker.update(frame.timestamp, res.cands, scale);
      // 位置は、映像全体に対する比（0〜1）にして返す
      const span = band[1] - band[0];
      const items = confirmed.map((c) => ({
        kind: c.kind,
        label: SIGN_KINDS[c.kind],
        x: c.x / reg.width,
        y: band[0] + (c.y / reg.height) * span,
        w: c.w / reg.width,
        h: (c.h / reg.height) * span,
      }));
      const sign = { band, items };
      last = items.length
        ? { state: STATES.DETECTED, detail: summarize(confirmed), sign }
        : { state: STATES.NOT_DETECTED, detail: '丸・逆三角・ひし形・青のみ確認', sign };
      return last;
    },
  };
}
