import test from 'node:test';
import assert from 'node:assert/strict';
import { findCrosswalk, rowStripes, CrosswalkTracker, CROSSWALK_DEFAULTS } from '../js/recognizers/crosswalk-core.js';
import { createCrosswalkRecognizer } from '../js/recognizers/crosswalk.js';

const W = 640;
const H = 200;
/** 灰色の路面（明るさ base）を作り、paint(x, y) が true の画素を白（230）にする */
function road(paint, base = 90) {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = paint(x, y) ? 230 : base + ((x * 7 + y * 13) % 9);
      const p = (y * W + x) * 4;
      d[p] = d[p + 1] = d[p + 2] = v;
      d[p + 3] = 255;
    }
  }
  return d;
}
// 遠近: 下ほど幅が広い。y 100〜160 に横断歩道（しま 8 本）
function zebra(x, y) {
  if (y < 100 || y > 160) return false;
  const s = 0.6 + (y - 100) / 150; // 下ほど拡大
  const cx = W / 2;
  const u = (x - cx) / s; // 中央からの距離（拡大前）
  if (Math.abs(u) > 200) return false;
  return ((u + 200) % 50) < 25;
}
const laneLines = (x, y) => Math.abs(x - (200 - y * 0.5)) < 4 || Math.abs(x - (440 + y * 0.5)) < 4;
const stopLine = (x, y) => y > 120 && y < 135 && x > 150 && x < 490;

test('横断歩道: 遠近のついたしま模様を見つける', () => {
  const r = findCrosswalk(road(zebra), W, H);
  assert.equal(r.found, true);
  assert.ok(r.y0 >= 96 && r.y1 <= 164, `${r.y0}-${r.y1}`);
  assert.ok(r.x0 < 260 && r.x1 > 380);
});

test('横断歩道: 車線の線（2 本）だけでは見つけない', () => {
  assert.equal(findCrosswalk(road(laneLines), W, H).found, false);
});

test('横断歩道: 停止線（1 本の太い線）と車線だけでは見つけない', () => {
  assert.equal(findCrosswalk(road((x, y) => laneLines(x, y) || stopLine(x, y)), W, H).found, false);
});

test('横断歩道: 白線のない路面では見つけない', () => {
  assert.equal(findCrosswalk(road(() => false), W, H).found, false);
});

test('横断歩道: 細い 1〜2 行だけのしま（雨の反射など）は数えない', () => {
  const thin = (x, y) => y >= 100 && y < 103 && x > 160 && x < 480 && (x - 160) % 40 < 20;
  assert.equal(findCrosswalk(road(thin), W, H).found, false);
});

test('横断歩道: 暗い映像は判定しない（meanLuma で分かる）', () => {
  const r = findCrosswalk(road(zebra, 10).map((v, i) => (i % 4 === 3 ? v : v >> 3)), W, H);
  assert.ok(r.meanLuma < CROSSWALK_DEFAULTS.minLuma);
  assert.equal(r.found, false);
});

test('rowStripes: 間隔のばらばらな白い区間は、しまと数えない', () => {
  const row = new Uint8Array(W).fill(90);
  for (const [a, b] of [[50, 60], [100, 140], [300, 305], [500, 560], [600, 610]]) row.fill(230, a, b);
  assert.equal(rowStripes(row, W, CROSSWALK_DEFAULTS).ok, false);
});

test('CrosswalkTracker: 直近 4 回のうち 2 回で「あり」、一瞬だけなら「なし」', () => {
  const t = new CrosswalkTracker();
  assert.equal(t.update(true), false);
  assert.equal(t.update(false), false);
  assert.equal(t.update(true), true);
  t.update(false);
  t.update(false);
  assert.equal(t.update(false), false);
});

function frame(ts, data, luma) {
  return {
    timestamp: ts,
    getRegion: () => ({ data: luma ?? data, width: W, height: H }),
  };
}

test('認識モジュール: 続けて見つけると detected になり、範囲を返す', () => {
  const r = createCrosswalkRecognizer();
  const d = road(zebra);
  r.process(frame(0, d));
  const res = r.process(frame(300, d));
  assert.equal(res.state, 'detected');
  assert.equal(res.crosswalk.on, true);
  assert.ok(res.crosswalk.box.y > CROSSWALK_DEFAULTS.band[0] && res.crosswalk.box.y < CROSSWALK_DEFAULTS.band[1]);
});

test('認識モジュール: しまがなければ not_detected、暗ければ unchecked', () => {
  const r = createCrosswalkRecognizer();
  assert.equal(r.process(frame(0, road(() => false))).state, 'not_detected');
  const dark = road(() => false, 5).map((v, i) => (i % 4 === 3 ? v : 5));
  assert.equal(r.process(frame(300, dark)).state, 'unchecked');
});

test('認識モジュール: 映像を取得できなければ unchecked', () => {
  const r = createCrosswalkRecognizer();
  assert.equal(r.process({ timestamp: 0 }).state, 'unchecked');
});
