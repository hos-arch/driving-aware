import test from 'node:test';
import assert from 'node:assert/strict';
import { corridor, corridorAt, roughDistanceM, assess, WarnHolder, LEVELS } from '../js/danger-core.js';

// 横向き 640×360。消失点 (320, 166)、探索範囲の下端 270。車線は下端で 170〜470。
const lane = { frameW: 640, frameH: 360, roi: [162, 270], vp: [320, 166], left: { xb: 170 }, right: { xb: 470 } };
// 足元が (fx, fy) 画素、高さ hpx の人
const person = (fx, fy, hpx = 60, confirmed = true) => ({ x: (fx - 10) / 640, y: (fy - hpx) / 360, w: 20 / 640, h: hpx / 360, confirmed });

test('corridor: 両側が見つかればそのまま、片側だけ・なしのときは仮の幅で補う', () => {
  assert.equal(corridor(lane).basis, 'both');
  const one = corridor({ ...lane, right: null });
  assert.equal(one.basis, 'one');
  assert.ok(one.xr > one.xl + 200);
  const none = corridor({ ...lane, left: null, right: null });
  assert.equal(none.basis, 'assumed');
  assert.ok(Math.abs((none.xl + none.xr) / 2 - 320) < 1e-9);
});

test('corridorAt: 下端では車線より少し広く、遠くでは細くなり、地平線より上は null', () => {
  const c = corridor(lane);
  const b = corridorAt(c, 270, 640);
  assert.ok(b.left < 170 && b.right > 470);
  const far = corridorAt(c, 180, 640);
  assert.ok(far.right - far.left < 80 && far.right - far.left >= 2 * 0.015 * 640 - 1e-9);
  assert.equal(corridorAt(c, 160, 640), null);
});

test('roughDistanceM: 足元が下にあるほど近い', () => {
  const near = roughDistanceM(300, 166, 640, 360);
  const far = roughDistanceM(190, 166, 640, 360);
  assert.ok(near < far && near > 2 && far < 40);
  assert.equal(roughDistanceM(160, 166, 640, 360), Infinity);
});

test('assess: 車線の中の人は対象、歩道の人は対象外', () => {
  const inLane = person(320, 240);
  const sidewalk = person(60, 240);
  const r = assess([inLane, sidewalk], lane, 40);
  assert.equal(r.targets.length, 1);
  assert.ok(Math.abs(r.targets[0].x - inLane.x) < 1e-9);
  assert.equal(assess([sidewalk], lane, 40).level, LEVELS.NONE);
});

test('assess: 近くて速いと「危険」、遠いと「注意」', () => {
  assert.equal(assess([person(320, 260)], lane, 40).level, LEVELS.DANGER);
  assert.equal(assess([person(322, 176, 14)], lane, 20).level, LEVELS.CAUTION);
});

test('assess: 停車中（3 km/h 未満）は何も出さない', () => {
  assert.equal(assess([person(320, 260)], lane, 0).level, LEVELS.NONE);
  assert.equal(assess([person(320, 260)], lane, 2.9).level, LEVELS.NONE);
});

test('assess: 徐行（3〜10 km/h）は、音なしの「前方に人」だけ', () => {
  const r = assess([person(320, 260)], lane, 5);
  assert.equal(r.level, LEVELS.NEAR);
  assert.equal(r.reason, 'slow');
});

test('assess: 速さが分からないときは、音なしの「前方に人」だけ（動いているとは決めつけない）', () => {
  const r = assess([person(320, 260)], lane, null);
  assert.equal(r.level, LEVELS.NEAR);
  assert.equal(r.reason, 'nospeed');
});

test('assess: まだ確かでない枠（confirmed でない）は対象にしない。車線の結果が無ければ判定しない', () => {
  assert.equal(assess([person(320, 260, 60, false)], lane, 40).level, LEVELS.NONE);
  assert.equal(assess([person(320, 260)], null, 40).level, LEVELS.NONE);
});

test('assess: 車線が見つからないとき（駐車場など）は、速くても音は出さず、「前方に人（車線不明）」だけ', () => {
  const noLane = { ...lane, left: null, right: null };
  const r = assess([person(320, 260)], noLane, 40);
  assert.equal(r.basis, 'assumed');
  assert.equal(r.level, LEVELS.NEAR);
  assert.equal(r.reason, 'assumed');
  assert.equal(assess([person(320, 260)], noLane, 1).level, LEVELS.NONE); // 停車中は何も出さない
});

test('assess: 片側の車線だけでも見つかっていれば、音つきの警告を出す', () => {
  const r = assess([person(320, 260)], { ...lane, right: null }, 40);
  assert.equal(r.basis, 'one');
  assert.equal(r.level, LEVELS.DANGER);
});

test('WarnHolder: 上がるのはすぐ、下がるのは少し待ってから', () => {
  const h = new WarnHolder({ holdMs: 1500 });
  assert.equal(h.update(LEVELS.CAUTION, 0), LEVELS.CAUTION);
  assert.equal(h.update(LEVELS.DANGER, 100), LEVELS.DANGER);
  assert.equal(h.update(LEVELS.NONE, 500), LEVELS.DANGER);
  assert.equal(h.update(LEVELS.CAUTION, 1000), LEVELS.DANGER);
  assert.equal(h.update(LEVELS.NONE, 1700), LEVELS.NONE);
});

test('assess: 横断歩道が見えているときは、通り道を 1.5 倍に広げる（少し外の人も対象になる）', async () => {
  const { assess: a2, DANGER_DEFAULTS: D } = await import('../js/danger-core.js');
  const lane = { frameW: 640, frameH: 360, roi: [162, 270], vp: [320, 166], left: { xb: 200 }, right: { xb: 440 } };
  // 足元 y=270（0.75）。通り道は 200〜440、余裕 1.4 倍で 152〜488、1.5 倍にすると 2.1 倍で 68〜572
  const p = { x: 520 / 640, y: 0.55, w: 20 / 640, h: 0.2, confirmed: true };
  assert.equal(a2([p], lane, 30).level, 'none');
  const r = a2([p], lane, 30, { crosswalk: true });
  assert.notEqual(r.level, 'none');
  assert.ok(Math.abs(r.margin - D.margin * D.crosswalkWiden) < 1e-9);
});

test('assess: 加速度センサーで動き出しを見つけたとき（速さは不明）は、音なしの「前方に人（動き出し）」', () => {
  const r = assess([person(320, 260)], lane, null, { starting: true });
  assert.equal(r.level, LEVELS.NEAR);
  assert.equal(r.reason, 'starting');
});
