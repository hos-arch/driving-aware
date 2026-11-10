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
const CROP_MAX_W = 320; // 見直しで切り出す範囲の最大の幅（px）
const CROP_FACTOR = 3; // 種の大きさの何倍を切り出すか（周りの形も見るため）

const LAMP_BLUE_HUE = 199; // 青信号の灯は、青い標識より緑寄り（色相 191〜196°。標識は 202〜212°を実測）
const LAMP_RED_V = 0.8; // 赤信号の灯は、塗った赤より明るい（赤の部分の明るさの中央値 0.85 以上を実測）

/** 枠の中の、色の付いた画素（彩度 0.3 以上）の色相と明るさの中央値 */
function colorStats(img, c) {
  const hs = [];
  const vs = [];
  for (let y = c.y; y < c.y + c.h; y++) {
    for (let x = c.x; x < c.x + c.w; x++) {
      const p = (y * img.width + x) * 4;
      const r = img.data[p];
      const g = img.data[p + 1];
      const b = img.data[p + 2];
      const mx = Math.max(r, g, b);
      const d = mx - Math.min(r, g, b);
      if (!mx || d / mx < 0.3) continue;
      let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
      hs.push(h);
      vs.push(mx / 255);
    }
  }
  const med = (a) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1] : NaN);
  return { hue: med(hs), v: med(vs) };
}

/** 見直しで見つけた候補のうち、信号機の灯らしいもの（誤り）を除く */
function looksLikeLamp(img, c) {
  if (c.kind === 'blue-sign') return colorStats(img, c).hue < LAMP_BLUE_HUE;
  if (c.kind === 'red-circle') return colorStats(img, c).v >= LAMP_RED_V;
  return false;
}

/**
 * 小さすぎて形を判定できなかった色の塊（種）の周りだけを、映像の元の解像度で切り出して判定し直す。
 * 元の映像が探す幅（1280）より大きいときだけ効く（同じなら細部は増えない）。
 * 返す候補の座標は、探した帯（reg）の画素の座標にそろえる。
 */
function refineSeeds(frame, reg, band, seeds, options) {
  if (typeof frame.getCrop !== 'function' || !frame.videoWidth) return [];
  if (frame.videoWidth <= reg.width * 1.2) return []; // 元の映像がほぼ同じ大きさなら、見直しても変わらない
  const span = band[1] - band[0];
  const out = [];
  for (const sd of seeds) {
    const side = Math.max(sd.w, sd.h) * CROP_FACTOR;
    const cx = sd.x + sd.w / 2;
    const cy = sd.y + sd.h / 2;
    // 帯の画素 → 映像全体の比
    const xf = (cx - side / 2) / reg.width;
    const wf = side / reg.width;
    const yf = band[0] + ((cy - side / 2) / reg.height) * span;
    const hf = (side / reg.height) * span;
    const crop = frame.getCrop(xf, yf, wf, hf, CROP_MAX_W);
    // 切り出した画像の中では、元の解像度の 14px を最小の辺にし、塊が切り出し範囲の大半を占めてもよい
    const res = findSignCandidates(crop.data, crop.width, crop.height, {
      ...options,
      baseW: crop.nativeW, // 長さの基準を「元の解像度の画素」にする（切り出しを縮めたときは、その分だけ縮む）
      maxFrac: 0.95,
      maxSeeds: 0,
    });
    for (const c of res.cands) {
      if (looksLikeLamp(crop, c)) continue;
      // 切り出し画像の画素 → 映像全体の比 → 帯の画素
      const fx = crop.x + (c.x / crop.width) * crop.w;
      const fy = crop.y + (c.y / crop.height) * crop.h;
      const fw = (c.w / crop.width) * crop.w;
      const fh = (c.h / crop.height) * crop.h;
      out.push({
        kind: c.kind,
        x: Math.round(fx * reg.width),
        y: Math.round(((fy - band[0]) / span) * reg.height),
        w: Math.max(1, Math.round(fw * reg.width)),
        h: Math.max(1, Math.round((fh / span) * reg.height)),
        refined: true,
      });
    }
  }
  return out;
}

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
      const refined = options.refine === false ? [] : refineSeeds(frame, reg, band, res.seeds ?? [], options);
      const confirmed = tracker.update(frame.timestamp, [...res.cands, ...refined], scale);
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
