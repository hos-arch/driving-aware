// Geolocation API による速度取得。状態は snapshot() で取り出す。

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
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        this.error = null;
        this.lastUpdateAt = Date.now();
        // speed は取得できないと null。0 とは区別して扱う。
        this.speedMs = pos.coords.speed;
        this.accuracyM = pos.coords.accuracy;
        this.onChange();
      },
      (err) => {
        this.error = { code: err.code };
        this.onChange();
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 },
    );
    return true;
  }

  stop() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }
}
