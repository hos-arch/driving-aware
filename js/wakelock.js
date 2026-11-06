// 画面の自動消灯を防ぐ（Screen Wake Lock API）。
// status: unsupported | active | released | denied | idle

export class WakeLock {
  constructor({ onChange } = {}) {
    this.onChange = onChange ?? (() => {});
    this.sentinel = null;
    this.wanted = false;
    this.status = 'wakeLock' in navigator ? 'idle' : 'unsupported';
  }

  async request() {
    this.wanted = true;
    if (!('wakeLock' in navigator)) {
      this.set('unsupported');
      return;
    }
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
        this.set('released');
      });
      this.set('active');
    } catch (_) {
      this.sentinel = null;
      this.set('denied');
    }
  }

  /** 画面が再び表示されたときに取り直す */
  async reacquire() {
    if (this.wanted && !this.sentinel && this.status !== 'unsupported') {
      await this.request();
    }
  }

  set(status) {
    this.status = status;
    this.onChange(status);
  }
}
