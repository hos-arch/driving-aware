// 加速度センサー（DeviceMotion）を受け取り、MotionStart に渡す。
// iPhone の Safari では、ボタンを押したときに許可を求める必要がある（requestPermission）。
// 許可されない、または対応していないときは、今までどおり GPS だけで判定する。

import { MotionStart } from './motion-core.js';

export class Motion {
  constructor(opts = {}) {
    this.detector = new MotionStart(opts);
    this.status = 'idle'; // idle | waiting | active | denied | unsupported
    this.onEvent = (e) => {
      const a = e.acceleration;
      const g = e.accelerationIncludingGravity;
      // 値の入っていない通知だけが届く端末もある。値が届いてはじめて「有効」とする
      if (!(a && a.x != null) && !(g && g.x != null)) return;
      this.status = 'active';
      this.detector.update(Date.now(), a, g);
    };
  }

  /** ボタンを押した処理の中で呼ぶ */
  async start() {
    if (typeof window === 'undefined' || typeof window.DeviceMotionEvent === 'undefined') {
      this.status = 'unsupported';
      return false;
    }
    const DME = window.DeviceMotionEvent;
    if (typeof DME.requestPermission === 'function') {
      try {
        const r = await DME.requestPermission();
        if (r !== 'granted') {
          this.status = 'denied';
          return false;
        }
      } catch {
        this.status = 'denied';
        return false;
      }
    }
    this.status = 'waiting'; // 最初の値が届くまで
    window.addEventListener('devicemotion', this.onEvent);
    return true;
  }

  stop() {
    if (typeof window !== 'undefined') window.removeEventListener('devicemotion', this.onEvent);
    this.detector.reset();
    if (this.status === 'active' || this.status === 'waiting') this.status = 'idle';
  }

  startedAfter(after, now) {
    return this.status === 'active' && this.detector.startedAfter(after, now);
  }
}
