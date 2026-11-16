import test from 'node:test';
import assert from 'node:assert/strict';
import { isUncertain, hasNewUncertain, stamp } from '../js/capture.js';

const box = (x, s) => ({ x, y: 100, w: 20, h: 40, s });

test('isUncertain: 確からしさが中くらいの枠があるときだけ', () => {
  assert.equal(isUncertain([box(0, 0.4)], 0.3, 0.5), true);
  assert.equal(isUncertain([box(0, 0.9)], 0.3, 0.5), false);
  assert.equal(isUncertain([], 0.3, 0.5), false);
});

test('hasNewUncertain: 前に保存したのと同じ場所の枠だけなら false、新しい場所なら true', () => {
  const prev = [box(100, 0.4)];
  assert.equal(hasNewUncertain([box(100, 0.4)], undefined, 0.3, 0.5), true); // 初めて
  assert.equal(hasNewUncertain([box(102, 0.35)], prev, 0.3, 0.5), false); // 少しずれただけ
  assert.equal(hasNewUncertain([box(102, 0.35), box(300, 0.45)], prev, 0.3, 0.5), true); // 別の場所にもう 1 つ
  assert.equal(hasNewUncertain([box(300, 0.9)], prev, 0.3, 0.5), false); // 新しい枠が確かなら、迷った場面ではない
});

test('stamp: 日時をファイル名用の文字にする', () => {
  assert.equal(stamp(new Date(2026, 10, 16, 8, 9, 5)), '20261116-080905');
});
