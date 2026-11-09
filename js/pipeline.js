// カメラ映像を一定間隔で取り出し、各認識モジュールに渡して結果を集める。

import { STATES } from './recognizers/index.js';

const TARGET_INTERVAL_MS = 100; // 最大 約10fps
const PROCESS_WIDTH = 640; // 認識用に縮小する幅（標識は getRegion でもっと高い解像度の一部を取る）

export class Pipeline {
  constructor(video, recognizers, { onResult } = {}) {
    this.video = video;
    this.recognizers = recognizers;
    this.onResult = onResult ?? (() => {});
    this.running = false;
    this.lastFrameAt = null; // 最後に処理したフレームの時刻
    this.lastProcessAt = 0;
    this.fps = 0;
    this.procMs = 0;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.handle = null;
    this.regionCanvas = document.createElement('canvas');
    this.regionCtx = this.regionCanvas.getContext('2d', { willReadFrequently: true });
  }

  /** 映像の高さの y0f〜y1f（0〜1）の帯を、幅 outW（映像の幅を超えない）で取り出す。標識など小さいものを見る用 */
  getRegion(y0f, y1f, outW) {
    const v = this.video;
    const vw = v.videoWidth;
    const vh = v.videoHeight;
    const sy = Math.round(y0f * vh);
    const sh = Math.max(1, Math.round((y1f - y0f) * vh));
    const dw = Math.min(outW, vw);
    const dh = Math.max(1, Math.round((sh * dw) / vw));
    if (this.regionCanvas.width !== dw || this.regionCanvas.height !== dh) {
      this.regionCanvas.width = dw;
      this.regionCanvas.height = dh;
    }
    this.regionCtx.drawImage(v, 0, sy, vw, sh, 0, 0, dw, dh);
    return this.regionCtx.getImageData(0, 0, dw, dh);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop() {
    this.running = false;
    this.lastFrameAt = null;
    this.fps = 0;
    this.procMs = 0;
  }

  schedule() {
    if (!this.running) return;
    const tick = (now) => {
      this.step(typeof now === 'number' ? now : performance.now());
      this.schedule();
    };
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.video.requestVideoFrameCallback(tick);
    } else {
      requestAnimationFrame(tick);
    }
  }

  step(now) {
    const v = this.video;
    if (!v.videoWidth || !v.videoHeight || v.readyState < 2) return;
    if (now - this.lastProcessAt < TARGET_INTERVAL_MS) return;

    const t0 = performance.now();
    const w = Math.min(PROCESS_WIDTH, v.videoWidth);
    const h = Math.round((v.videoHeight * w) / v.videoWidth);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.ctx.drawImage(v, 0, 0, w, h);

    const frame = {
      video: v,
      width: w,
      height: h,
      timestamp: now,
      getImageData: (x = 0, y = 0, rw = w, rh = h) => this.ctx.getImageData(x, y, rw, rh),
      getRegion: (y0f, y1f, outW) => this.getRegion(y0f, y1f, outW),
    };

    const results = {};
    for (const r of this.recognizers) {
      try {
        results[r.id] = r.process(frame);
      } catch (err) {
        // 1 つの認識モジュールの失敗で全体を止めない。失敗は「未確認」として扱う。
        results[r.id] = { state: STATES.UNCHECKED, detail: '処理エラー' };
        console.error(`[${r.id}]`, err);
      }
    }

    const t1 = performance.now();
    const dt = this.lastProcessAt ? now - this.lastProcessAt : 0;
    this.lastProcessAt = now;
    this.lastFrameAt = Date.now();
    this.procMs = this.procMs ? this.procMs * 0.8 + (t1 - t0) * 0.2 : t1 - t0;
    if (dt > 0) {
      const inst = 1000 / dt;
      this.fps = this.fps ? this.fps * 0.8 + inst * 0.2 : inst;
    }

    this.onResult(results, { fps: this.fps, procMs: this.procMs });
  }
}
