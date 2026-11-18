// 警告音。Web Audio で短い音を鳴らす。
// iOS Safari では、利用者の操作（「開始」を押す）の中で一度鳴らす準備をしないと、音が出ない。
// 端末が消音（マナーモード）や音量 0 のときは鳴らない。

// 音色: 'band' は帯域を絞ったノイズ（サンプルの「ふくらみのある音」に近い）。
// 'square' は従来のピーという電子音。
export const PATTERNS = {
  // 注意: 中くらいの高さの短い音を 2 回（低め→少し高め）。2.5 秒ごとにくり返す
  caution: { everyMs: 2500, beeps: [{ at: 0, ms: 80, hz: 580, type: 'band' }, { at: 0.25, ms: 80, hz: 700, type: 'band' }] },
  // 危険: 注意の 2 回に、低めの短い音の連続 5 回がつづく。2.2 秒ごとにくり返す
  // （利用者が持ってきた警告音のサンプルを測って、高さと間隔を近づけた）
  danger: {
    everyMs: 2200,
    beeps: [
      { at: 0, ms: 80, hz: 580, type: 'band' },
      { at: 0.25, ms: 80, hz: 700, type: 'band' },
      { at: 0.7, ms: 60, hz: 460, type: 'band' },
      { at: 0.8, ms: 60, hz: 480, type: 'band' },
      { at: 0.95, ms: 60, hz: 520, type: 'band' },
      { at: 1.05, ms: 60, hz: 520, type: 'band' },
      { at: 1.2, ms: 60, hz: 560, type: 'band' },
    ],
  },
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
      this.tone(0, 120, 660, 0.25, 'band');
      return true;
    } catch (err) {
      console.error('[audio]', err);
      return false;
    }
  }

  get status() {
    return !this.ctx ? 'unavailable' : this.ctx.state === 'running' ? 'ok' : 'suspended';
  }

  /** 白いノイズの材料（1 回だけ作って使い回す）。 */
  noise() {
    if (this._noise) return this._noise;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 1, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  tone(at, ms, hz, volume = 0.6, type = 'square') {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const gain = ctx.createGain();
    let src;
    if (type === 'band') {
      // 帯域を絞ったノイズ: 中心の高さのまわりだけを通す
      src = ctx.createBufferSource();
      src.buffer = this.noise();
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = hz;
      filter.Q.value = 5;
      src.connect(filter).connect(gain);
      volume *= 2.5;
    } else {
      src = ctx.createOscillator();
      src.type = 'square';
      src.frequency.value = hz;
      src.connect(gain);
    }
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.01);
    gain.gain.setValueAtTime(volume, t0 + ms / 1000 - 0.02);
    gain.gain.linearRampToValueAtTime(0, t0 + ms / 1000);
    gain.connect(ctx.destination);
    src.start(t0);
    src.stop(t0 + ms / 1000 + 0.02);
  }

  play(level) {
    const p = PATTERNS[level];
    if (!p || !this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    for (const b of p.beeps) this.tone(b.at, b.ms, b.hz, 0.6, b.type);
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
