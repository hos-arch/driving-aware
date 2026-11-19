import test from 'node:test';
import assert from 'node:assert/strict';
import { PATTERNS } from '../js/audio.js';

test('警告音: 注意と危険の 2 種類があり、くり返しの間隔の中に収まる', () => {
  for (const level of ['caution', 'danger']) {
    const p = PATTERNS[level];
    assert.ok(p.beeps.length >= 2, level);
    const last = p.beeps[p.beeps.length - 1];
    assert.ok(last.at * 1000 + last.ms < p.everyMs, `${level} が次のくり返しに重ならない`);
    let prevEnd = -1;
    for (const b of p.beeps) {
      assert.ok(b.at * 1000 >= prevEnd, `${level} の音どうしが重ならない`);
      prevEnd = b.at * 1000 + b.ms;
      assert.ok(b.hz >= 400 && b.hz <= 1500);
    }
  }
});

test('警告音: 危険は注意より音が多い（聞き分けられる）', () => {
  assert.ok(PATTERNS.danger.beeps.length > PATTERNS.caution.beeps.length);
});

test('警告音: 音色は帯域ノイズかピーという音のどちらか', () => {
  for (const level of ['caution', 'danger']) {
    for (const b of PATTERNS[level].beeps) {
      assert.ok(b.type === undefined || b.type === 'sine' || b.type === 'band' || b.type === 'square');
    }
  }
});
