import test from 'node:test';
import assert from 'node:assert/strict';
import { findSignCandidates } from '../js/recognizers/sign-core.js';
import { SignTracker, createSignRecognizer } from '../js/recognizers/sign.js';
import { STATES } from '../js/recognizers/states.js';

// --- 合成画像（幅 1280、標識がある高さの帯を想定） --------------------------------
const W = 1280;
const H = 400;

function makeImage(bg = [170, 175, 180]) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = bg[0];
    rgba[i * 4 + 1] = bg[1];
    rgba[i * 4 + 2] = bg[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** 条件 inside(dx, dy) を満たす画素を、中心 (cx, cy)・半径（半分の大きさ）r の範囲で塗る */
function paint(rgba, cx, cy, r, inside, color) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      if (inside((x - cx) / r, (y - cy) / r)) {
        const i = (y * W + x) * 4;
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
      }
    }
  }
}

const RED = [200, 30, 30];
const BLUE = [20, 80, 190];
const YELLOW = [225, 160, 30]; // 雨の日の黄色い標識は橙色寄りに写る
const WHITE = [245, 245, 245];
const DARK = [40, 40, 40];

const kinds = (rgba) => findSignCandidates(rgba, W, H).cands.map((c) => c.kind);

test('赤い輪（中が白い丸）→ 赤い丸', () => {
  const img = makeImage();
  paint(img, 300, 150, 40, (x, y) => x * x + y * y <= 1, RED);
  paint(img, 300, 150, 40, (x, y) => x * x + y * y <= 0.62, WHITE);
  assert.deepEqual(kinds(img), ['red-circle']);
});

test('赤い丸に白い横棒（進入禁止の形）→ 赤い丸', () => {
  const img = makeImage();
  paint(img, 300, 150, 40, (x, y) => x * x + y * y <= 1, RED);
  paint(img, 300, 150, 40, (x, y) => Math.abs(x) <= 0.7 && Math.abs(y) <= 0.14, WHITE);
  assert.deepEqual(kinds(img), ['red-circle']);
});

test('白い部分のない赤い丸（尾灯・コーンなど）は候補にしない', () => {
  const img = makeImage();
  paint(img, 300, 150, 40, (x, y) => x * x + y * y <= 1, RED);
  assert.deepEqual(kinds(img), []);
});

test('赤い逆三角（中が白い）→ 赤い逆三角', () => {
  const img = makeImage();
  // 逆三角: 上が広く、下が尖る。y は -1（上）〜 1（下）
  const tri = (k) => (x, y) => y >= -1 && y <= 1 && Math.abs(x) <= k * (1 - y) / 2;
  paint(img, 300, 150, 45, tri(1), RED);
  paint(img, 300, 150, 45, (x, y) => tri(0.62)(x, y + 0.12) && y >= -0.8, WHITE);
  assert.deepEqual(kinds(img), ['red-triangle']);
});

test('雨でぼけた薄い赤（色相 349°、彩度 0.45）の逆三角 → 赤い逆三角', () => {
  const img = makeImage();
  const PALE_RED = [140, 77, 88];
  const tri = (k) => (x, y) => y >= -1 && y <= 1 && Math.abs(x) <= k * (1 - y) / 2;
  paint(img, 300, 150, 45, tri(1), PALE_RED);
  paint(img, 300, 150, 45, (x, y) => tri(0.62)(x, y + 0.12) && y >= -0.8, WHITE);
  assert.deepEqual(kinds(img), ['red-triangle']);
});

test('明るい曇りで薄く写った赤い輪（色相 335°、彩度 0.3）→ 赤い丸。中の青い数字は別の候補にしない', () => {
  const img = makeImage([225, 238, 240]);
  const PALE = [200, 140, 165];
  const PALE_BLUE = [110, 170, 200]; // 色相 200°、彩度 0.45
  paint(img, 300, 150, 40, (x, y) => x * x + y * y <= 1, PALE);
  paint(img, 300, 150, 40, (x, y) => x * x + y * y <= 0.55, WHITE);
  paint(img, 300, 150, 40, (x, y) => Math.abs(x) <= 0.4 && Math.abs(y) <= 0.3, PALE_BLUE);
  paint(img, 300, 150, 40, (x, y) => Math.abs(x) <= 0.25 && Math.abs(y) <= 0.15, WHITE);
  assert.deepEqual(kinds(img), ['red-circle']);
});

test('赤い輪の中が青い標識（駐車禁止の形）→ 赤い丸だけ（青い標識にはしない）', () => {
  const img = makeImage();
  paint(img, 300, 150, 40, (x, y) => x * x + y * y <= 1, RED);
  paint(img, 300, 150, 40, (x, y) => x * x + y * y <= 0.6, BLUE);
  paint(img, 300, 150, 40, (x, y) => Math.abs(x + y) <= 0.16 && x * x + y * y <= 1, RED);
  assert.deepEqual(kinds(img), ['red-circle']);
});

test('薄く水色寄りに写った青い四角（色相 200°、彩度 0.45）→ 青い標識', () => {
  const img = makeImage([225, 238, 240]);
  paint(img, 400, 120, 60, (x, y) => Math.abs(x) <= 1 && Math.abs(y) <= 0.7, [110, 170, 200]);
  paint(img, 400, 120, 60, (x, y) => Math.abs(x) <= 0.7 && Math.abs(y - 0.1) <= 0.12, WHITE);
  assert.deepEqual(kinds(img), ['blue-sign']);
});

test('黄色（橙色寄り）のひし形 → 黄色いひし形', () => {
  const img = makeImage();
  paint(img, 300, 150, 45, (x, y) => Math.abs(x) + Math.abs(y) <= 1, YELLOW);
  paint(img, 300, 150, 45, (x, y) => (Math.abs(x) <= 0.5 && Math.abs(y) <= 0.06) || (Math.abs(y) <= 0.5 && Math.abs(x) <= 0.06), DARK);
  assert.deepEqual(kinds(img), ['yellow-diamond']);
});

test('黄色い四角（ひし形ではない）は候補にしない', () => {
  const img = makeImage();
  paint(img, 300, 150, 45, (x, y) => Math.abs(x) <= 1 && Math.abs(y) <= 1, YELLOW);
  assert.deepEqual(kinds(img), []);
});

test('白い文字のある青い四角（案内標識）→ 青い標識。文字で青が分かれても 1 つ', () => {
  const img = makeImage();
  paint(img, 400, 120, 60, (x, y) => Math.abs(x) <= 1 && Math.abs(y) <= 0.7, BLUE);
  // 白い文字の帯（青を左右に分ける）
  paint(img, 400, 120, 60, (x, y) => Math.abs(x) <= 0.7 && Math.abs(y - 0.1) <= 0.12, WHITE);
  paint(img, 400, 120, 60, (x, y) => Math.abs(x - 0.1) <= 0.05 && Math.abs(y) <= 0.5, WHITE);
  const found = findSignCandidates(img, W, H).cands;
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'blue-sign');
});

test('白のない青い塊（青い屋根・シートなど）は候補にしない', () => {
  const img = makeImage();
  paint(img, 400, 120, 60, (x, y) => Math.abs(x) <= 1 && Math.abs(y) <= 0.7, BLUE);
  assert.deepEqual(kinds(img), []);
});

test('何もない灰色の画像・小さすぎる塊・画像の端で切れた塊は候補にしない', () => {
  const gray = makeImage();
  assert.deepEqual(kinds(gray), []);

  const small = makeImage();
  paint(small, 300, 150, 5, (x, y) => x * x + y * y <= 1, RED); // 直径 10px（最小の辺 14px 未満）
  assert.deepEqual(kinds(small), []);

  const cut = makeImage();
  paint(cut, 30, 150, 40, (x, y) => x * x + y * y <= 1, RED);
  paint(cut, 30, 150, 40, (x, y) => x * x + y * y <= 0.62, WHITE);
  // 中心が左端から 30px、半径 40px なので、左端（x < 0）で切れて形を判断できない
  assert.deepEqual(kinds(cut), []);
});

test('画像が大きさ違い（幅 640）でも、同じ標識を見つける（長さの基準が縮む）', () => {
  const w = 640;
  const h = 200;
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 170;
    rgba[i * 4 + 1] = 175;
    rgba[i * 4 + 2] = 180;
    rgba[i * 4 + 3] = 255;
  }
  const put = (cx, cy, r, inside, c) => {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (inside((x - cx) / r, (y - cy) / r)) {
          const i = (y * w + x) * 4;
          rgba[i] = c[0];
          rgba[i + 1] = c[1];
          rgba[i + 2] = c[2];
        }
      }
    }
  };
  put(150, 75, 20, (x, y) => x * x + y * y <= 1, RED);
  put(150, 75, 20, (x, y) => x * x + y * y <= 0.62, WHITE);
  assert.deepEqual(findSignCandidates(rgba, w, h).cands.map((c) => c.kind), ['red-circle']);
});

// --- 時間方向の確認 ---------------------------------------------------------
test('SignTracker: 1 回だけ出た候補は採用せず、同じ場所に続けて出たら採用する', () => {
  const tr = new SignTracker({ windowMs: 1500, minHits: 2 });
  const c = { kind: 'blue-sign', x: 100, y: 100, w: 40, h: 30 };
  assert.equal(tr.update(0, [c]).length, 0);
  assert.equal(tr.update(300, [{ ...c, x: 110 }]).length, 1); // 少し動いても同じ標識
});

test('SignTracker: 別の場所・別の種類・時間が空いたものは、同じ候補として数えない', () => {
  const tr = new SignTracker({ windowMs: 1500, minHits: 2 });
  tr.update(0, [{ kind: 'blue-sign', x: 100, y: 100, w: 40, h: 30 }]);
  assert.equal(tr.update(300, [{ kind: 'blue-sign', x: 900, y: 100, w: 40, h: 30 }]).length, 0);
  assert.equal(tr.update(600, [{ kind: 'red-circle', x: 900, y: 100, w: 40, h: 30 }]).length, 0);
  const tr2 = new SignTracker({ windowMs: 1500, minHits: 2 });
  tr2.update(0, [{ kind: 'blue-sign', x: 100, y: 100, w: 40, h: 30 }]);
  assert.equal(tr2.update(3000, [{ kind: 'blue-sign', x: 100, y: 100, w: 40, h: 30 }]).length, 0);
});

// --- 認識モジュール -----------------------------------------------------------
function frameFrom(rgba, t, withRegion = true) {
  return {
    width: 640,
    height: 360,
    timestamp: t,
    getRegion: withRegion ? () => ({ data: rgba, width: W, height: H }) : undefined,
  };
}

test('認識モジュール: 標識の候補があれば「検出」、なければ「検出されず」。位置は映像全体の比で返す', () => {
  const rec = createSignRecognizer();
  const empty = makeImage();
  assert.equal(rec.process(frameFrom(empty, 0)).state, STATES.NOT_DETECTED);

  const img = makeImage();
  paint(img, 640, 120, 60, (x, y) => Math.abs(x) <= 1 && Math.abs(y) <= 0.7, BLUE);
  paint(img, 640, 120, 60, (x, y) => Math.abs(x) <= 0.7 && Math.abs(y - 0.1) <= 0.12, WHITE);
  const r1 = rec.process(frameFrom(img, 1000)); // 1 回目: まだ採用しない
  assert.equal(r1.state, STATES.NOT_DETECTED);
  const r2 = rec.process(frameFrom(img, 1400)); // 2 回目: 採用
  assert.equal(r2.state, STATES.DETECTED);
  assert.match(r2.detail, /青い標識/);
  const item = r2.sign.items[0];
  assert.ok(item.x > 0.4 && item.x < 0.6, `x=${item.x}`);
  assert.ok(item.y >= r2.sign.band[0] && item.y <= r2.sign.band[1]);
});

test('認識モジュール: 前回から 300ms 未満なら再計算せず、前回の結果を返す', () => {
  const rec = createSignRecognizer();
  let calls = 0;
  const img = makeImage();
  const frame = (t) => ({
    width: 640,
    height: 360,
    timestamp: t,
    getRegion: () => {
      calls++;
      return { data: img, width: W, height: H };
    },
  });
  const a = rec.process(frame(0));
  const b = rec.process(frame(100));
  assert.equal(calls, 1);
  assert.equal(a, b);
  rec.process(frame(400));
  assert.equal(calls, 2);
});

test('認識モジュール: 暗い映像・映像が取れないときは「未確認」（「検出されず」にしない）', () => {
  const dark = makeImage([5, 5, 5]);
  assert.equal(createSignRecognizer().process(frameFrom(dark, 0)).state, STATES.UNCHECKED);
  // 夜（空が黒く、範囲の平均が暗い）は、灯りを標識と間違えやすいので判定しない
  const night = makeImage([40, 40, 45]);
  paint(night, 300, 150, 40, (x, y) => x * x + y * y <= 1, RED);
  paint(night, 300, 150, 40, (x, y) => x * x + y * y <= 0.62, WHITE);
  const rn = createSignRecognizer();
  rn.process(frameFrom(night, 0));
  assert.equal(rn.process(frameFrom(night, 400)).state, STATES.UNCHECKED);
  assert.equal(createSignRecognizer().process(frameFrom(makeImage(), 0, false)).state, STATES.UNCHECKED);
});
