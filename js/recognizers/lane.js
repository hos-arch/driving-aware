// 車線認識モジュール。フレームごとの候補を、時間方向でまとめて安定させる。
//
// 状態の方針（js/recognizers/index.js の 3 状態）:
//   detected     : 左右のどちらか（または両方）の境界を、継続して検出できた
//   not_detected : 映像は確認できたが、境界が検出されなかった（車線がない、とは限らない）
//   unchecked    : 暗すぎるなど、判定できる映像ではない

import { STATES } from './states.js';
import { LANE_DEFAULTS, LANE_LANDSCAPE, findLaneCandidates, pickEgoBoundaries } from './lane-core.js';

const BASE_W = 640;

/**
 * 左右それぞれについて、直近の時間窓の中で「同じ位置に繰り返し出ている線」だけを採用する。
 * 一瞬だけ出る反射や、位置が毎回ばらつく誤検出を落とすため。
 */
export class LaneTracker {
  constructor({ windowMs = 1500, enter = 0.4, exit = 0.25, minHits = 3, tolPx = 50 } = {}) {
    this.windowMs = windowMs;
    this.enter = enter;
    this.exit = exit;
    this.minHits = minHits;
    this.tolPx = tolPx;
    this.history = [];
    this.active = { left: false, right: false };
  }

  reset() {
    this.history = [];
    this.active = { left: false, right: false };
  }

  /** @param t ミリ秒 @param w 閾値の縮尺に使う長さ（画像の短い辺, px） */
  update(t, left, right, w) {
    this.history.push({ t, left: left ? left.xb : null, right: right ? right.xb : null });
    while (this.history.length && t - this.history[0].t > this.windowMs) this.history.shift();
    const tol = (this.tolPx * w) / BASE_W;
    return {
      left: this.evaluate('left', tol),
      right: this.evaluate('right', tol),
    };
  }

  evaluate(side, tol) {
    const frames = this.history.length;
    const xs = this.history.map((e) => e[side]).filter((v) => v !== null);
    if (!xs.length) {
      this.active[side] = false;
      return { detected: false, xb: null };
    }
    const sorted = [...xs].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];
    const good = xs.filter((v) => Math.abs(v - med) <= tol);
    const ratio = good.length / frames;
    const need = this.active[side] ? this.exit : this.enter;
    const on = good.length >= this.minHits && ratio >= need;
    this.active[side] = on;
    if (!on) return { detected: false, xb: null };
    const gs = [...good].sort((a, b) => a - b);
    return { detected: true, xb: gs[gs.length >> 1] };
  }
}

/**
 * 映像の向きに合わせて探索範囲と消失点を選ぶ。URL などで指定された値があれば、それを優先する。
 */
export function laneGeometryFor(frameW, frameH, options = {}) {
  const landscape = frameW > frameH;
  return {
    landscape,
    roi: options.roi ?? (landscape ? LANE_LANDSCAPE.roi : LANE_DEFAULTS.roi),
    vp: options.vp ?? (landscape ? LANE_LANDSCAPE.vp : LANE_DEFAULTS.vp),
  };
}

export function createLaneRecognizer(options = {}) {
  const base = { ...LANE_DEFAULTS, ...options };
  const tracker = new LaneTracker(options.tracker);
  let lastDims = '';

  return {
    id: 'lane',
    label: '車線',
    process(frame) {
      // 向きや大きさが変わったら、過去の位置は使えないので捨てる
      const dims = `${frame.width}x${frame.height}`;
      if (dims !== lastDims) {
        tracker.reset();
        lastDims = dims;
      }
      const geo = laneGeometryFor(frame.width, frame.height, options);
      const o = { ...base, roi: geo.roi, vp: geo.vp };

      const y0 = Math.floor(o.roi[0] * frame.height);
      const y1 = Math.floor(o.roi[1] * frame.height);
      const h = y1 - y0;
      const w = frame.width;
      const img = frame.getImageData(0, y0, w, h);
      const res = findLaneCandidates(img.data, w, h, { frameH: frame.height, y0 }, o);
      const geometry = {
        frameW: w,
        frameH: frame.height,
        roi: [y0, y1],
        vp: [res.vp[0], res.vp[1] + y0],
      };

      if (res.meanLuma < o.minLuma) {
        tracker.reset();
        return { state: STATES.UNCHECKED, detail: '暗くて判定不可', lane: { ...geometry, left: null, right: null } };
      }

      const { left, right } = pickEgoBoundaries(res, o);
      const tr = tracker.update(frame.timestamp, left, right, Math.min(w, frame.height));
      const out = {
        ...geometry,
        left: tr.left.detected ? { xb: tr.left.xb, color: left?.color ?? null } : null,
        right: tr.right.detected ? { xb: tr.right.xb, color: right?.color ?? null } : null,
      };

      if (out.left && out.right) return { state: STATES.DETECTED, detail: '両側', lane: out };
      if (out.left) return { state: STATES.DETECTED, detail: '左のみ', lane: out };
      if (out.right) return { state: STATES.DETECTED, detail: '右のみ', lane: out };
      return { state: STATES.NOT_DETECTED, detail: '', lane: out };
    },
  };
}
