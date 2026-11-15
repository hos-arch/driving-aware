import test from 'node:test';
import assert from 'node:assert/strict';
import { TILE, planTiles, toInput, decodePersons, toFrame, PersonTracker } from '../js/recognizers/person-core.js';

test('planTiles: 横向き 1920×1080 は 3 枚で、幅全体を覆う', () => {
  const t = planTiles(1920, 1080);
  assert.equal(t.length, 3);
  assert.ok(Math.abs(t[0].x) < 1e-9);
  assert.ok(Math.abs(t[2].x + t[2].w - 1) < 1e-9);
  assert.ok(Math.abs(t[0].w * 1920 - 624) < 1); // 1280 相当で 416 → 元の映像で 624
  assert.ok(Math.abs(t[0].y * 1080 + 312 - 0.47 * 1080) < 1);
});

test('planTiles: 縦向き 1080×1920 は 2 枚', () => {
  const t = planTiles(1080, 1920);
  assert.equal(t.length, 2);
  assert.ok(Math.abs(t[1].x + t[1].w - 1) < 1e-9);
  assert.ok(t[0].y > 0.25 && t[0].y + t[0].h < 0.65);
});

test('planTiles: 小さい映像（640×480）でも範囲からはみ出さない', () => {
  for (const t of planTiles(640, 480)) {
    assert.ok(t.x >= 0 && t.y >= 0 && t.x + t.w <= 1 + 1e-9 && t.y + t.h <= 1 + 1e-9);
  }
});

test('toInput: RGBA を BGR・CHW にし、足りない所は 114', () => {
  const rgba = new Uint8ClampedArray(2 * 1 * 4);
  rgba.set([10, 20, 30, 255, 40, 50, 60, 255]);
  const x = toInput(rgba, 2, 1);
  const P = TILE * TILE;
  assert.deepEqual([x[0], x[P], x[2 * P]], [30, 20, 10]);
  assert.deepEqual([x[1], x[P + 1], x[2 * P + 1]], [60, 50, 40]);
  assert.equal(x[2], 114);
  assert.equal(x[TILE], 114);
});

function fakeOutput(boxes) {
  const N = 52 * 52 + 26 * 26 + 13 * 13;
  const out = new Float32Array(N * 85);
  for (const b of boxes) {
    // stride 8 のマス (gx, gy) に、中心がマスの中央、大きさ w×h の「人」を置く
    const p = (b.gy * 52 + b.gx) * 85;
    out[p] = 0.5;
    out[p + 1] = 0.5;
    out[p + 2] = Math.log(b.w / 8);
    out[p + 3] = Math.log(b.h / 8);
    out[p + 4] = b.obj;
    out[p + 5 + (b.cls ?? 0)] = 1;
  }
  return out;
}

test('decodePersons: 人だけを取り出し、重なった枠は 1 つにする', () => {
  const out = fakeOutput([
    { gx: 10, gy: 20, w: 40, h: 60, obj: 0.9 },
    { gx: 11, gy: 20, w: 40, h: 60, obj: 0.7 }, // ほぼ重なる → 消える
    { gx: 40, gy: 10, w: 20, h: 60, obj: 0.9, cls: 2 }, // 車 → 無視
    { gx: 30, gy: 30, w: 16, h: 40, obj: 0.2 }, // 低すぎる → 無視
    { gx: 30, gy: 40, w: 16, h: 40, obj: 0.35 },
  ]);
  const d = decodePersons(out);
  assert.equal(d.length, 2);
  assert.ok(Math.abs(d[0].x + d[0].w / 2 - 84) < 1e-3); // (10 + 0.5) × 8
  assert.ok(Math.abs(d[0].y + d[0].h / 2 - 164) < 1e-3);
  assert.ok(Math.abs(d[1].s - 0.35) < 1e-6);
});

test('toFrame: タイル内の枠を映像全体の比に直す', () => {
  const f = toFrame({ x: 208, y: 0, w: 104, h: 416, s: 0.8 }, { x: 0.5, y: 0.2, w: 0.25, h: 0.5 }, 416);
  assert.ok(Math.abs(f.x - 0.625) < 1e-9 && Math.abs(f.y - 0.2) < 1e-9);
  assert.ok(Math.abs(f.w - 0.0625) < 1e-9 && Math.abs(f.h - 0.5) < 1e-9);
});

test('PersonTracker: 続けて 2 回見つかった確かな枠だけが検出になる', () => {
  const tr = new PersonTracker();
  const box = { x: 0.3, y: 0.4, w: 0.02, h: 0.08, s: 0.7 };
  tr.update(0, [box], 1000);
  assert.equal(tr.snapshot(1000, 1).items[0].confirmed, false);
  tr.update(0, [{ ...box, x: 0.31 }], 1600);
  assert.equal(tr.snapshot(1600, 1).items[0].confirmed, true);
  // 確からしさが中くらいなら、続いても検出にしない
  tr.update(0, [{ ...box, s: 0.4 }], 2200);
  assert.equal(tr.snapshot(2200, 1).items[0].confirmed, false);
  // 離れた場所に急に出た枠は検出にしない
  tr.update(0, [{ ...box, x: 0.8, s: 0.9 }], 2800);
  assert.equal(tr.snapshot(2800, 1).items[0].confirmed, false);
});

test('PersonTracker: 古い結果は使わず、全部のタイルがそろったときだけ complete', () => {
  const tr = new PersonTracker();
  tr.update(0, [], 1000);
  assert.deepEqual(tr.snapshot(1100, 2), { items: [], complete: false, any: true });
  tr.update(1, [], 1200);
  assert.equal(tr.snapshot(1300, 2).complete, true);
  assert.equal(tr.snapshot(9000, 2).any, false);
  // 前の結果が古すぎるときは、続けて見つかったことにしない
  const box = { x: 0.3, y: 0.4, w: 0.02, h: 0.08, s: 0.7 };
  tr.update(0, [box], 10000);
  tr.update(0, [box], 20000);
  assert.equal(tr.snapshot(20000, 1).items[0].confirmed, false);
});

// --- 認識モジュール全体（モデルは偽物に差し替える） ---
import { createPersonRecognizer } from '../js/recognizers/person.js';
import { STATES } from '../js/recognizers/states.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
function fakeFrame(t) {
  return {
    timestamp: t,
    videoWidth: 1920,
    videoHeight: 1080,
    getCrop: (x, y, w, h) => ({ data: new Uint8ClampedArray(416 * 416 * 4), width: 416, height: 416, x, y, w, h }),
  };
}

test('createPersonRecognizer: 読み込み中は未確認、全部の範囲を見てから「検出されず」、続けて見つかれば「検出」', async () => {
  let person = false;
  const scans = [];
  const rec = createPersonRecognizer({
    loadDetector: async () => ({ run: async () => fakeOutput(person ? [{ gx: 10, gy: 20, w: 20, h: 60, obj: 0.9 }] : []) }),
    onScan: (s) => scans.push(s),
  });
  assert.equal(rec.process(fakeFrame(0)).state, STATES.UNCHECKED);
  await tick();
  let r;
  for (let t = 100; t <= 300; t += 100) {
    r = rec.process(fakeFrame(t));
    await tick();
  }
  assert.equal(r.state, STATES.UNCHECKED); // まだ 3 枚そろっていない
  r = rec.process(fakeFrame(400));
  await tick();
  assert.equal(r.state, STATES.NOT_DETECTED);
  person = true;
  for (let t = 500; t <= 1100; t += 100) {
    r = rec.process(fakeFrame(t));
    await tick();
  }
  assert.equal(r.state, STATES.DETECTED);
  assert.equal(r.person.tiles.length, 3);
  assert.ok(scans.length >= 9);
  // 結果が古くなったら未確認に戻る
  assert.equal(rec.process(fakeFrame(60000)).state, STATES.UNCHECKED);
});

test('createPersonRecognizer: モデルを読み込めないときは未確認のまま', async () => {
  const rec = createPersonRecognizer({ loadDetector: async () => { throw new Error('x'); } });
  const orig = console.error;
  console.error = () => {};
  await tick();
  await tick();
  console.error = orig;
  const r = rec.process(fakeFrame(0));
  assert.equal(r.state, STATES.UNCHECKED);
  assert.match(r.detail, /読み込めません/);
});

test('reload: モデルを切り替えると、前の結果を捨て、新しいモデルで判定し、古いモデルは解放する', async () => {
  const loaded = [];
  const disposed = [];
  const mk = (name, hasPerson) => {
    const d = { name, run: async () => fakeOutput(hasPerson ? [{ gx: 10, gy: 20, w: 20, h: 60, obj: 0.9 }] : []), dispose: () => disposed.push(name) };
    loaded.push(name);
    return d;
  };
  const rec = createPersonRecognizer({ loadDetector: async (name) => mk(name ?? 'nano', name !== 'tiny') });
  await tick();
  assert.equal(rec.modelState(), 'ready');
  let r;
  for (let t = 100; t <= 1200; t += 100) {
    r = rec.process(fakeFrame(t));
    await tick();
  }
  assert.equal(r.state, STATES.DETECTED);

  const done = rec.reload('tiny');
  assert.equal(rec.modelState(), 'loading');
  assert.equal(rec.process(fakeFrame(1300)).state, STATES.UNCHECKED); // 読み込み中は未確認。前の結果は出さない
  await done;
  await tick();
  assert.equal(rec.modelState(), 'ready');
  assert.deepEqual(loaded, ['nano', 'tiny']);
  assert.deepEqual(disposed, ['nano']);
  for (let t = 1400; t <= 2600; t += 100) {
    r = rec.process(fakeFrame(t));
    await tick();
  }
  assert.equal(r.state, STATES.NOT_DETECTED); // 新しいモデルは人を見つけない（偽物）。前のモデルの結果は残っていない
});

test('reload: 読み込み中にまた切り替えたら、遅れて届いた古い方は使わず解放する', async () => {
  const disposed = [];
  const resolvers = {};
  const rec = createPersonRecognizer({
    loadDetector: (name) =>
      name === undefined
        ? Promise.resolve({ run: async () => fakeOutput([]), dispose: () => disposed.push('first') })
        : new Promise((res) => (resolvers[name] = () => res({ run: async () => fakeOutput([]), dispose: () => disposed.push(name), tag: name }))),
  });
  await tick();
  const a = rec.reload('tiny');
  const b = rec.reload('nano');
  await tick(); // 読み込みの手続きが始まるのを待つ
  resolvers.nano();
  await b;
  resolvers.tiny(); // 古い読み込みが後から終わる
  await a;
  await tick();
  assert.equal(rec.modelState(), 'ready');
  assert.deepEqual(disposed.sort(), ['first', 'tiny']);
});

test('reload: 読み込みに失敗したら failed で、もう一度 reload すれば直る', async () => {
  let fail = true;
  const rec = createPersonRecognizer({ loadDetector: async () => { if (fail) throw new Error('x'); return { run: async () => fakeOutput([]) }; } });
  const orig = console.error;
  console.error = () => {};
  await tick();
  await tick();
  assert.equal(rec.modelState(), 'failed');
  fail = false;
  await rec.reload('nano');
  console.error = orig;
  assert.equal(rec.modelState(), 'ready');
});
