// Geolocation API による速度取得。状態は snapshot() で取り出す。
// 位置が変わるたびに受け取る（watchPosition）のではなく、POLL_MS ごとに 1 回だけ問い合わせる。
// 速さは表示せず、「止まっているか」と「人に着くまでの時間」の判定にだけ使う。
// 注意: 問い合わせの間隔をあけても、端末の GPS 自体が止まるとは限らない（電池への効果は未確認）。
// 動き出しの判定は、最大でこの間隔の分だけ遅れる。

export const POLL_MS = 3000;

export class Gps {
  constructor({ onChange } = {}) {
    this.onChange = onChange ?? (() => {});
    this.watchId = null;
    this.reset();
  }

  reset() {
    this.error = null;
    this.lastUpdateAt = null;
    this.speedMs = null;
    this.accuracyM = null;
  }

  snapshot() {
    return {
      error: this.error,
      lastUpdateAt: this.lastUpdateAt,
      speedMs: this.speedMs,
      accuracyM: this.accuracyM,
    };
  }

  start() {
    if (!('geolocation' in navigator)) {
      this.error = { code: 2 };
      this.onChange();
      return false;
    }
    this.stop();
    this.running = true;
    const next = () => {
      if (this.running) this.watchId = setTimeout(ask, POLL_MS);
    };
    const ask = () => {
      this.watchId = null;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (!this.running) return;
          this.error = null;
          this.lastUpdateAt = Date.now();
          // speed は取得できないと null。0 とは区別して扱う。
          this.speedMs = pos.coords.speed;
          this.accuracyM = pos.coords.accuracy;
          this.onChange();
          next();
        },
        (err) => {
          if (!this.running) return;
          this.error = { code: err.code };
          this.onChange();
          next();
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 8000 },
      );
    };
    ask();
    return true;
  }

  stop() {
    this.running = false;
    if (this.watchId !== null) {
      clearTimeout(this.watchId);
      this.watchId = null;
    }
  }
}
