// 警告音。Web Audio で短い音を鳴らす。
// iOS Safari では、利用者の操作（「開始」を押す）の中で一度鳴らす準備をしないと、音が出ない。
// 端末が消音（マナーモード）や音量 0 のときは鳴らない。

// 音色: 'sine' は澄んだサイン波（2 倍音を少しだけ足す）。穏やかな電子音。
// hz から hz2 へ、音の高さを少しずつ変える。音の立ち上がりと消え方は丸くする。
// 時間と高さは、利用者が持ってきた録音（12）から測った形。高さは 0.8 倍（音程を下げた）。
// 'square' は従来のピーという電子音、'band' は帯域ノイズ（今は使っていない）。
const PITCH = 0.8;
const S = (at, ms, hz, hz2) => ({ at, ms, hz: hz * PITCH, hz2: hz2 * PITCH, type: 'sine' });

export const PATTERNS = {
  // 注意: 録音の最初の 2 つの音
  caution: {
    everyMs: 2500,
    beeps: [S(0, 50, 580, 530), S(0.25, 50, 660, 750)],
  },
  // 危険: 録音の音をすべて（1.5 秒ぶん）。2.2 秒ごとにくり返す
  danger: {
    everyMs: 2200,
    beeps: [
      S(0, 50, 580, 530),
      S(0.25, 50, 660, 750),
      S(0.67, 60, 510, 460),
      S(0.8, 50, 490, 570),
      S(1.05, 45, 540, 530),
      S(1.18, 40, 770, 920),
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
      this.tone(0, 120, 660, 0.25, "band");
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

  tone(at, ms, hz, volume = 0.6, type = 'square', hz2 = null) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime + at;
    const gain = ctx.createGain();
    let src;
    if (type === 'sine') {
      // 澄んだサイン波。2 倍音を少しだけ足す。音量の山は sin^1.5 の丸い形
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(hz, t0);
      if (hz2 && hz2 !== hz) osc.frequency.linearRampToValueAtTime(hz2, t0 + ms / 1000);
      const h2 = ctx.createOscillator();
      h2.type = 'sine';
      h2.frequency.setValueAtTime(hz * 2, t0);
      if (hz2 && hz2 !== hz) h2.frequency.linearRampToValueAtTime(hz2 * 2, t0 + ms / 1000);
      const h2gain = ctx.createGain();
      h2gain.gain.value = 0.15;
      osc.connect(gain);
      h2.connect(h2gain).connect(gain);
      const curve = new Float32Array(64);
      for (let i = 0; i < curve.length; i++) {
        curve[i] = volume * Math.sin(Math.PI * (i / (curve.length - 1))) ** 1.5;
      }
      gain.gain.setValueAtTime(0, t0);
      gain.gain.setValueCurveAtTime(curve, t0, ms / 1000);
      gain.connect(ctx.destination);
      osc.start(t0);
      h2.start(t0);
      osc.stop(t0 + ms / 1000 + 0.02);
      h2.stop(t0 + ms / 1000 + 0.02);
      return;
    }
    if (type === 'band') {
      // 帯域を絞ったノイズ: 中心の高さのまわりだけを通す
      src = ctx.createBufferSource();
      src.buffer = this.noise();
      src.loop = true;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(hz, t0);
      if (hz2 && hz2 !== hz) filter.frequency.linearRampToValueAtTime(hz2, t0 + ms / 1000);
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
    for (const b of p.beeps) this.tone(b.at, b.ms, b.hz, 0.6, b.type, b.hz2);
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
