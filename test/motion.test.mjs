import test from 'node:test';
import assert from 'node:assert/strict';
import { MotionStart, MOTION_DEFAULTS } from '../js/motion-core.js';

// 60Hz で、from〜to（ms）の間、加速度 a を返す関数で流す
function feed(d, fromMs, toMs, accAt, { gravity = false } = {}) {
  for (let t = fromMs; t <= toMs; t += 1000 / 60) {
    const a = accAt(t);
    if (gravity) d.update(t, null, { x: a.x, y: a.y, z: a.z + 9.8 });
    else d.update(t, a, null);
  }
}

const still = () => ({ x: 0, y: 0, z: 0 });

test('動き出し: 止まっている間は、見つけない', () => {
  const d = new MotionStart();
  feed(d, 0, 5000, still);
  assert.equal(d.startAt, null);
  assert.equal(d.startedAfter(null, 5000), false);
});

test('動き出し: 0.1G ほどの加速が続くと、約 0.5 秒で見つける', () => {
  const d = new MotionStart();
  feed(d, 0, 2000, still);
  feed(d, 2000, 3500, () => ({ x: 0, y: 1.0, z: 0 }));
  assert.ok(d.startAt != null);
  assert.ok(d.startAt >= 2000 + MOTION_DEFAULTS.holdMs && d.startAt <= 3500);
  assert.equal(d.startedAfter(1000, 3600), true);
});

test('動き出し: エンジンの細かい揺れ（大きいが速く向きが変わる）では見つけない', () => {
  const d = new MotionStart();
  // 25Hz で ±1.5 m/s² の揺れ
  feed(d, 0, 5000, (t) => ({ x: 1.5 * Math.sin((2 * Math.PI * 25 * t) / 1000), y: 1.5 * Math.cos((2 * Math.PI * 25 * t) / 1000), z: 0 }));
  assert.equal(d.startAt, null);
});

test('動き出し: 一瞬の衝撃（ドアを閉める、段差 0.2 秒）では見つけない', () => {
  const d = new MotionStart();
  feed(d, 0, 1000, still);
  feed(d, 1000, 1200, () => ({ x: 3, y: 0, z: 0 }));
  feed(d, 1200, 3000, still);
  assert.equal(d.startAt, null);
});

test('動き出し: 重力を除いた値が取れない端末でも、重力を見積もって見つける', () => {
  const d = new MotionStart();
  feed(d, 0, 4000, still, { gravity: true });
  assert.equal(d.startAt, null);
  feed(d, 4000, 5500, () => ({ x: 1.0, y: 0, z: 0 }), { gravity: true });
  assert.ok(d.startAt != null);
});

test('動き出し: GPS が後から届いたら、もう「動き出し」としない。時間がたっても同じ', () => {
  const d = new MotionStart();
  feed(d, 0, 2000, () => ({ x: 0, y: 1.0, z: 0 }));
  const at = d.startAt;
  assert.ok(at != null);
  assert.equal(d.startedAfter(at - 1, at + 100), true); // GPS はその前
  assert.equal(d.startedAfter(at + 1, at + 100), false); // GPS がその後に届いた
  assert.equal(d.startedAfter(null, at + MOTION_DEFAULTS.validMs + 1), false); // 古い
});

test('動き出し: 値が届かないときは何もしない', () => {
  const d = new MotionStart();
  assert.equal(d.update(0, null, null), null);
  assert.equal(d.update(10, { x: null, y: null, z: null }, null), null);
});
