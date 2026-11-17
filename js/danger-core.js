// 人の危険判定の、計算だけの部分。
// 「検出した人の足元が、自分の車線（とその少し外側）の中にあるか」と「あと何秒くらいで届きそうか」を見る。
//
// 注意: カメラ 1 台の映像からの粗い目安。距離は、カメラの高さと画角を仮に決めて計算している（校正していない）。
//       車線は消失点へ向かう直線とみなすので、カーブでは外れる。警告が出ないことは、安全を意味しない。

export const DANGER_DEFAULTS = {
  margin: 1.4, // 車線の幅の何倍までを「車線の中か近く」とするか（1.0 = 車線ちょうど）
  minHalf: 0.015, // 遠くで車線が細くなりすぎないよう、最低でも映像の幅のこの割合を半幅にする
  camHeightM: 1.2, // カメラの高さ（仮の値）
  laneHalfM: 1.75, // 車線が見つからないときに使う、車線の半分の幅（仮の値）
  hfovDeg: 63, // カメラの横の画角（仮の値。映像の長い辺の方向）
  minSpeedKmh: 10, // これ未満の速さでは、音を鳴らさない（信号待ちや徐行）
  dangerSec: 4, // 届くまでの目安がこれ未満なら「危険」
  holdMs: 1500, // 条件を外れても、この時間は表示を続ける（ちらつき防止）
};

export const LEVELS = { NONE: 'none', NEAR: 'near', CAUTION: 'caution', DANGER: 'danger' };
const RANK = { none: 0, near: 1, caution: 2, danger: 3 };

/**
 * 車線の通り道（消失点へ向かう 2 本の直線）を作る。
 * lane: 車線認識の結果 { frameW, frameH, roi: [y0, y1], vp: [x, y], left: { xb } | null, right: { xb } | null }
 * 戻り値: { vx, vy, yb, xl, xr, basis }  xl・xr は高さ yb での左右の位置（画素）。basis は 'both' | 'one' | 'assumed'
 */
export function corridor(lane, opts = {}) {
  const o = { ...DANGER_DEFAULTS, ...opts };
  const [vx, vy] = lane.vp;
  const yb = lane.roi[1];
  // 車線が見つからない側は、カメラの高さと車線の幅を仮に決めて、あるはずの位置を置く
  const assumedHalf = (o.laneHalfM / o.camHeightM) * (yb - vy);
  const l = lane.left ? lane.left.xb : null;
  const r = lane.right ? lane.right.xb : null;
  if (l != null && r != null && r > l) return { vx, vy, yb, xl: l, xr: r, basis: 'both' };
  if (l != null) return { vx, vy, yb, xl: l, xr: l + 2 * assumedHalf, basis: 'one' };
  if (r != null) return { vx, vy, yb, xl: r - 2 * assumedHalf, xr: r, basis: 'one' };
  return { vx, vy, yb, xl: vx - assumedHalf, xr: vx + assumedHalf, basis: 'assumed' };
}

/** 高さ y（画素）での、通り道の左右の端（余裕を含む）。地平線より上なら null。 */
export function corridorAt(c, y, frameW, opts = {}) {
  const o = { ...DANGER_DEFAULTS, ...opts };
  const k = (y - c.vy) / (c.yb - c.vy);
  if (!(k > 0)) return null;
  const xl = c.vx + (c.xl - c.vx) * k;
  const xr = c.vx + (c.xr - c.vx) * k;
  const mid = (xl + xr) / 2;
  const half = Math.max(((xr - xl) / 2) * o.margin, o.minHalf * frameW);
  return { left: mid - half, right: mid + half };
}

/** 足元の高さから、距離の粗い目安（m）。地面が平らで、カメラの高さと画角が仮の値どおりのとき。 */
export function roughDistanceM(footY, vy, frameW, frameH, opts = {}) {
  const o = { ...DANGER_DEFAULTS, ...opts };
  const dy = footY - vy;
  if (!(dy > 0)) return Infinity;
  const f = Math.max(frameW, frameH) / 2 / Math.tan((o.hfovDeg * Math.PI) / 360);
  return (f * o.camHeightM) / dy;
}

/**
 * persons: [{ x, y, w, h, confirmed }]（映像全体に対する比）。confirmed のものだけを見る。
 * speedKmh: GPS の速さ。分からないときは null（そのときは、動いているものとして扱う）。
 * 戻り値: { level, targets: [{ ...person, level, seconds }], basis }
 */
export function assess(persons, lane, speedKmh, opts = {}) {
  const o = { ...DANGER_DEFAULTS, ...opts };
  if (!lane || !lane.vp || !lane.roi) return { level: LEVELS.NONE, targets: [], basis: null };
  const c = corridor(lane, o);
  const W = lane.frameW;
  const H = lane.frameH;
  const moving = speedKmh == null || speedKmh >= o.minSpeedKmh;
  const targets = [];
  let level = LEVELS.NONE;
  for (const p of persons ?? []) {
    if (!p.confirmed) continue;
    const fx = (p.x + p.w / 2) * W;
    const fy = (p.y + p.h) * H;
    const span = corridorAt(c, fy, W, o);
    // 枠の幅も考える（足元の中心が少し外でも、体が通り道にかかっていれば対象にする）
    if (!span || fx + (p.w * W) / 2 < span.left || fx - (p.w * W) / 2 > span.right) continue;
    let lv = LEVELS.NEAR;
    let seconds = null;
    if (moving) {
      lv = LEVELS.CAUTION;
      if (speedKmh != null && speedKmh > 0) {
        seconds = roughDistanceM(fy, c.vy, W, H, o) / (speedKmh / 3.6);
        if (seconds < o.dangerSec) lv = LEVELS.DANGER;
      }
    }
    targets.push({ ...p, level: lv, seconds });
    if (RANK[lv] > RANK[level]) level = lv;
  }
  return { level, targets, basis: c.basis, corridor: c };
}

/** 表示のちらつきを防ぐ。条件を外れても holdMs の間は、最後の段階を保つ（上がるのはすぐ）。 */
export class WarnHolder {
  constructor(opts = {}) {
    this.holdMs = opts.holdMs ?? DANGER_DEFAULTS.holdMs;
    this.level = LEVELS.NONE;
    this.until = 0;
  }

  update(level, now) {
    if (RANK[level] >= RANK[this.level]) {
      if (level !== LEVELS.NONE) this.until = now + this.holdMs;
      this.level = level;
    } else if (now >= this.until) {
      this.level = level;
      if (level !== LEVELS.NONE) this.until = now + this.holdMs;
    }
    return this.level;
  }

  reset() {
    this.level = LEVELS.NONE;
    this.until = 0;
  }
}
