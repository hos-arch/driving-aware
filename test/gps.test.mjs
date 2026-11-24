import test from 'node:test';
import assert from 'node:assert/strict';
import { Gps, POLL_MS } from '../js/gps.js';

// Node にも navigator（読み取り専用）があるので、テストの間だけ差し替える
function withNavigator(value, fn) {
  const orig = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
  try {
    fn();
  } finally {
    if (orig) Object.defineProperty(globalThis, 'navigator', orig);
    else delete globalThis.navigator;
  }
}

test('GPS: 3 秒ごとに 1 回だけ問い合わせる（位置が変わるたびには受け取らない）', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const geo = {
    getCurrentPosition(ok) {
      calls++;
      ok({ coords: { speed: 5, accuracy: 8 } });
    },
    watchPosition() {
      throw new Error('watchPosition は使わない');
    },
  };
  withNavigator({ geolocation: geo }, () => {
    const g = new Gps();
    g.start();
    assert.equal(POLL_MS, 3000);
    assert.equal(calls, 1);
    assert.equal(g.speedMs, 5);
    t.mock.timers.tick(2999);
    assert.equal(calls, 1);
    t.mock.timers.tick(1);
    assert.equal(calls, 2);
    g.stop();
    t.mock.timers.tick(10000);
    assert.equal(calls, 2);
  });
});

test('GPS: 失敗しても、次の問い合わせを続ける', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const geo = {
    getCurrentPosition(_ok, ng) {
      calls++;
      ng({ code: 3 });
    },
  };
  withNavigator({ geolocation: geo }, () => {
    const g = new Gps();
    g.start();
    assert.deepEqual(g.error, { code: 3 });
    t.mock.timers.tick(3000);
    assert.equal(calls, 2);
    g.stop();
  });
});
