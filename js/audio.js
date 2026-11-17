// 警告音。Web Audio で短い音を鳴らす。
// iOS Safari では、利用者の操作（「開始」を押す）の中で一度鳴らす準備をしないと、音が出ない。
// 端末が消音（マナーモード）や音量 0 のときは鳴らない。

const PATTERNS = {
  // 注意: 低めの音を 1 回。2 秒ごとにくり返す
  caution: { everyMs: 2000, beeps: [{ at: 0, ms: 180, hz: 880 }] },
  // 危険: 高い音を 3 回。0.8 秒ごとにくり返す
  danger: { everyMs: 800, beeps: [{ at: 0, ms: 90, hz: 1320 }, { at: 0.14, ms: 90, hz: 1320 }, { at: 0.28, ms: 90, hz: 1320 }] },
};

export class Beeper {
  constructor() {
    this.ctx = null;
    this.level = 'none';
    this.timer = null;
  }

  /** 利用者の操作の中で呼ぶ。音を出せる状態にして、確認の音を 1 回鳴らす。 */
  unlock() {
    try {
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AC) return false;
      if (!this.ctx) this.ctx = new AC();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      this.tone(0, 120, 660, 0.25);
      return true;
    } catch (err) {
      console.error('[audio]', err);
      return false;
    }
  }

  get status() {
    return !this.ctx ? 'unavailable' : this.ctx.state === 'running' ? 'ok' : 'suspended';
  }

  tone(at, ms, hz, volume = 0.6) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = hz;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.setValueAtTime(volume, t0 + ms / 1000 - 0.02);
    gain.gain.linearRampToValueAtTime(0, t0 + ms / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  }

  play(level) {
    const p = PATTERNS[level];
    if (!p || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    for (const b of p.beeps) this.tone(b.at, b.ms, b.hz);
  }

  /** 'caution' と 'danger' のときだけ鳴らす。同じ段階が続く間は、決まった間隔でくり返す。 */
  setLevel(level) {
    const next = PATTERNS[level] ? level : 'none';
    if (next === this.level) return;
    this.level = next;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (next === 'none') return;
    this.play(next);
    this.timer = setInterval(() => this.play(next), PATTERNS[next].everyMs);
  }
}
