import test from 'node:test';
import assert from 'node:assert/strict';
import {
  msToKmh,
  formatSpeed,
  isOverspeed,
  describeGps,
  GPS_STALE_MS,
} from '../js/format.js';

test('msToKmh: m/s を km/h に変換する', () => {
  assert.equal(msToKmh(0), 0);
  assert.ok(Math.abs(msToKmh(13.8889) - 50) < 0.01);
});

test('msToKmh: 取得できない値は null（0 にしない）', () => {
  assert.equal(msToKmh(null), null);
  assert.equal(msToKmh(undefined), null);
  assert.equal(msToKmh(NaN), null);
  assert.equal(msToKmh(-1), null);
});

test('formatSpeed: 整数に丸め、null は "--"', () => {
  assert.equal(formatSpeed(49.6), '50');
  assert.equal(formatSpeed(0), '0');
  assert.equal(formatSpeed(null), '--');
});

test('isOverspeed: 制限速度が不明なら超過と判定しない', () => {
  assert.equal(isOverspeed(60, null), false);
  assert.equal(isOverspeed(null, 40), false);
});

test('isOverspeed: 表示値が制限を超えたときのみ true', () => {
  assert.equal(isOverspeed(40.4, 40), false); // 表示は 40
  assert.equal(isOverspeed(40.6, 40), true); // 表示は 41
  assert.equal(isOverspeed(48, 40), true);
});

const now = 100000;
const base = { error: null, lastUpdateAt: now - 1000, speedMs: 10, accuracyM: 8, now };

test('describeGps: まだ何も受信していない', () => {
  const r = describeGps({ ...base, lastUpdateAt: null, speedMs: null, accuracyM: null });
  assert.equal(r.kind, 'waiting');
});

test('describeGps: 正常', () => {
  const r = describeGps(base);
  assert.equal(r.kind, 'ok');
  assert.match(r.text, /±8m/);
});

test('describeGps: 位置は取れているが速度が null', () => {
  const r = describeGps({ ...base, speedMs: null });
  assert.equal(r.kind, 'no-speed');
  assert.match(r.text, /速度/);
});

test('describeGps: 更新が止まったら stale', () => {
  const r = describeGps({ ...base, lastUpdateAt: now - GPS_STALE_MS - 1 });
  assert.equal(r.kind, 'stale');
});

test('describeGps: 許可されていない', () => {
  const r = describeGps({ ...base, error: { code: 1 } });
  assert.equal(r.kind, 'denied');
});

test('describeGps: 位置情報が使えない・タイムアウト', () => {
  assert.equal(describeGps({ ...base, error: { code: 2 } }).kind, 'unavailable');
  assert.equal(describeGps({ ...base, error: { code: 3 } }).kind, 'unavailable');
});

test('describeGps: エラーが出ていても、その後に新しい受信があれば error を優先しない呼び出し側の責務', () => {
  // error は呼び出し側が受信成功時に null へ戻す前提
  const r = describeGps({ ...base, error: null });
  assert.equal(r.kind, 'ok');
});
