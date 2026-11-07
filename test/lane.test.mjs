import test from 'node:test';
import assert from 'node:assert/strict';
import { findLaneCandidates, pickEgoBoundaries, LANE_DEFAULTS } from '../js/recognizers/lane-core.js';
import { LaneTracker, createLaneRecognizer } from '../js/recognizers/lane.js';
import { STATES } from '../js/recognizers/states.js';

// --- 合成画像 -------------------------------------------------------------
const FRAME_W = 640;
const FRAME_H = 1138;
const Y0 = Math.floor(LANE_DEFAULTS.roi[0] * FRAME_H);
const Y1 = Math.floor(LANE_DEFAULTS.roi[1] * FRAME_H);

function makeRoi(w = FRAME_W, bg = 30) {
  const h = Math.round(((Y1 - Y0) * w) / FRAME_W);
  const rgba = new Uint8ClampedArray(w * h * 4);
  let seed = 12345;
  for (let i = 0; i < w * h; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const v = bg + (seed % 7) - 3; // 小さなノイズ
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = v;
    rgba[i * 4 + 3] = 255;
  }
  return { rgba, w, h };
}

/** 線分（太さ thick）を塗る。座標は幅 640 基準。 */
function drawLine(roi, x0, y0, x1, y1, thick, color = [235, 235, 235]) {
  const { rgba, w, h } = roi;
  const k = w / FRAME_W;
  const [ax, ay, bx, by] = [x0 * k, y0 * k, x1 * k, y1 * k];
  const half = (thick * k) / 2;
  const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t = ((x - ax) * dx + (y - ay) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
      if (d <= half) {
        const i = (y * w + x) * 4;
        rgba[i] = color[0]; rgba[i + 1] = color[1]; rgba[i + 2] = color[2];
      }
    }
  }
}

const VPX = LANE_DEFAULTS.vp[0] * FRAME_W;
const VPY = LANE_DEFAULTS.vp[1] * FRAME_H - Y0; // ROI 内
const ROI_H = Y1 - Y0;

/** ROI 下端の x=xb から消失点に向かう、近距離側の線を描く */
function drawLaneLine(roi, xb, thick = 10, color) {
  const t0 = 0.4; // 下端から消失点までの 40% の位置から下端まで
  const sx = xb + (VPX - xb) * t0;
  const sy = ROI_H + (VPY - ROI_H) * t0;
  drawLine(roi, sx, sy, xb, ROI_H, thick, color);
}

function run(roi) {
  const k = roi.w / FRAME_W; // 画像の幅が違うときは、高さ・ROI の位置も同じ比率で縮む
  const res = findLaneCandidates(roi.rgba, roi.w, roi.h, { frameH: FRAME_H * k, y0: Y0 * k });
  return { res, pick: pickEgoBoundaries(res) };
}

test('左右の白線を検出し、ROI 下端での位置が合う', () => {
  const roi = makeRoi();
  drawLaneLine(roi, 280);
  drawLaneLine(roi, 520);
  const { pick } = run(roi);
  assert.ok(pick.left, '左が検出される');
  assert.ok(pick.right, '右が検出される');
  assert.ok(Math.abs(pick.left.xb - 280) < 20, `左 xb=${pick.left.xb}`);
  assert.ok(Math.abs(pick.right.xb - 520) < 20, `右 xb=${pick.right.xb}`);
});

test('画像の幅が違っても、同じ比率の位置で検出する（拡縮に対応）', () => {
  const roi = makeRoi(320);
  drawLaneLine(roi, 280);
  drawLaneLine(roi, 520);
  const { pick } = run(roi);
  assert.ok(pick.left && pick.right);
  assert.ok(Math.abs(pick.left.xb / 320 - 280 / 640) < 0.04);
  assert.ok(Math.abs(pick.right.xb / 320 - 520 / 640) < 0.04);
});

test('何もない画像では検出しない', () => {
  const { pick } = run(makeRoi());
  assert.equal(pick.left, null);
  assert.equal(pick.right, null);
});

test('赤い光の反射（彩度が高い）は車線として扱わない', () => {
  const roi = makeRoi();
  drawLaneLine(roi, 520, 10, [255, 50, 50]);
  const { res, pick } = run(roi);
  assert.equal(pick.right, null);
  assert.ok(res.rej.sat >= 1, `彩度で除外された数=${res.rej.sat}`);
});

test('消失点に向かわない水平な明るい帯は車線として扱わない', () => {
  const roi = makeRoi();
  drawLine(roi, 150, ROI_H * 0.7, 480, ROI_H * 0.7, 10);
  const { res, pick } = run(roi);
  assert.equal(pick.left, null);
  assert.equal(pick.right, null);
  assert.ok(res.rej.vp >= 1, `向きで除外された数=${res.rej.vp}`);
});

test('短い小さな点（水滴など）は車線として扱わない', () => {
  const roi = makeRoi();
  for (const [x, y] of [[100, 90], [250, 100], [400, 80], [520, 120]]) drawLine(roi, x, y, x + 3, y + 3, 4);
  const { pick } = run(roi);
  assert.equal(pick.left, null);
  assert.equal(pick.right, null);
});

test('車線の幅として不自然な左右の組は、長い方だけ残す', () => {
  const res = {
    w: 640,
    vp: [339, 57],
    cands: [
      { xb: 330, L: 80 },
      { xb: 345, L: 40 }, // 幅 15px: 狭すぎる
    ],
  };
  const p = pickEgoBoundaries(res);
  assert.ok(!(p.left && p.right));
});

// --- 時間方向の安定化 --------------------------------------------------------
const W = 640;

test('同じ位置に繰り返し出た線だけを採用する', () => {
  const tr = new LaneTracker();
  let out;
  for (let i = 0; i < 6; i++) out = tr.update(i * 100, { xb: 300 + (i % 2) * 5 }, null, W);
  assert.equal(out.left.detected, true);
  assert.ok(Math.abs(out.left.xb - 302) < 5);
  assert.equal(out.right.detected, false);
});

test('一瞬だけ出た線は採用しない', () => {
  const tr = new LaneTracker();
  let out;
  for (let i = 0; i < 8; i++) out = tr.update(i * 100, i === 3 ? { xb: 300 } : null, null, W);
  assert.equal(out.left.detected, false);
});

test('位置が毎回ばらつく線は採用しない', () => {
  const tr = new LaneTracker();
  let out;
  [100, 300, 480, 150, 420, 60, 350].forEach((x, i) => (out = tr.update(i * 100, { xb: x }, null, W)));
  assert.equal(out.left.detected, false);
});

test('見えなくなったら時間窓を過ぎた後に不検出へ戻る', () => {
  const tr = new LaneTracker({ windowMs: 1000 });
  for (let i = 0; i < 6; i++) tr.update(i * 100, { xb: 300 }, null, W);
  let out;
  for (let i = 6; i < 30; i++) out = tr.update(i * 100, null, null, W);
  assert.equal(out.left.detected, false);
});

// --- 認識モジュール全体 --------------------------------------------------------
function frameFrom(roi, t) {
  return {
    width: roi.w,
    height: FRAME_H,
    timestamp: t,
    getImageData: () => ({ data: roi.rgba, width: roi.w, height: roi.h }),
  };
}

test('白線が続けば「検出」、詳細は両側', () => {
  const rec = createLaneRecognizer();
  const roi = makeRoi();
  drawLaneLine(roi, 280);
  drawLaneLine(roi, 520);
  let r;
  for (let i = 0; i < 6; i++) r = rec.process(frameFrom(roi, i * 100));
  assert.equal(r.state, STATES.DETECTED);
  assert.equal(r.detail, '両側');
  assert.ok(r.lane.left && r.lane.right);
});

test('明るさは十分だが線がなければ「検出されず」', () => {
  const rec = createLaneRecognizer();
  const roi = makeRoi(FRAME_W, 60);
  let r;
  for (let i = 0; i < 6; i++) r = rec.process(frameFrom(roi, i * 100));
  assert.equal(r.state, STATES.NOT_DETECTED);
});

test('暗すぎる映像は「検出されず」ではなく「未確認」', () => {
  const rec = createLaneRecognizer();
  const roi = makeRoi(FRAME_W, 4);
  const r = rec.process(frameFrom(roi, 0));
  assert.equal(r.state, STATES.UNCHECKED);
  assert.match(r.detail, /暗/);
});
