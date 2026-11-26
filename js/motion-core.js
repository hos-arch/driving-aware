// 加速度から「動き出した」を見つける、計算だけの部分。
//
// GPS は 3 秒に 1 回しか問い合わせないので、止まっている → 動き出した、の切り替わりが最大 3 秒ほど遅れる。
// その間を、加速度センサーで補う。
//
// 見ているもの: 重力を除いた加速度の各成分を、なめらかにして（短い揺れを消して）から、大きさを取る。
// それが startMs2 以上の状態が holdMs 続いたら「動き出した」とする。
//
// 注意: 加速と、ブレーキ、段差、ドアの開け閉め、手で端末に触れた、などの区別はしない。
//       動き出しを見つけても、速さは分からない。分かるのは「動いたかもしれない」ことだけ。

export const MOTION_DEFAULTS = {
  tauMs: 300, // 揺れを消すための、なめらかにする時間
  gravityTauMs: 2000, // 重力を除いた値が取れない端末で、重力の向きを見積もる時間
  startMs2: 0.5, // これ以上の加速度（m/s²、約 0.05G）が続いたら動き出しとみなす
  holdMs: 500, // その状態が、これだけ続くこと
  validMs: 5000, // 動き出しを見つけてから、これだけの間は「動き出し」として扱う
};

const ema = (prev, v, dt, tau) => (prev == null ? v : prev + (v - prev) * (dt / (tau + dt)));

export class MotionStart {
  constructor(opts = {}) {
    this.o = { ...MOTION_DEFAULTS, ...opts };
    this.reset();
  }

  reset() {
    this.t = null;
    this.lp = [null, null, null];
    this.g = [null, null, null];
    this.since = null;
    this.startAt = null;
    this.mag = 0;
  }

  /**
   * @param {number} t 時刻（ms）
   * @param {{x,y,z}|null} acc 重力を除いた加速度（m/s²）。取れないときは null
   * @param {{x,y,z}|null} accG 重力を含む加速度（m/s²）。acc が取れないときに使う
   */
  update(t, acc, accG) {
    const o = this.o;
    const dt = this.t == null ? 16 : Math.max(1, Math.min(200, t - this.t));
    this.t = t;
    let v;
    if (acc && acc.x != null) {
      v = [acc.x, acc.y, acc.z];
    } else if (accG && accG.x != null) {
      const raw = [accG.x, accG.y, accG.z];
      this.g = this.g.map((g, i) => ema(g, raw[i], dt, o.gravityTauMs));
      v = raw.map((r, i) => r - this.g[i]);
    } else {
      return this.startAt;
    }
    this.lp = this.lp.map((p, i) => ema(p, v[i] || 0, dt, o.tauMs));
    this.mag = Math.hypot(...this.lp);
    if (this.mag >= o.startMs2) {
      if (this.since == null) this.since = t;
      if (t - this.since >= o.holdMs) this.startAt = t;
    } else {
      this.since = null;
    }
    return this.startAt;
  }

  /** after（ms）より後に動き出しを見つけ、それが now から見て新しいか */
  startedAfter(after, now) {
    if (this.startAt == null) return false;
    if (after != null && this.startAt <= after) return false;
    return now - this.startAt <= this.o.validMs;
  }
}
