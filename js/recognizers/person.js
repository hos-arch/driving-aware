// 人の検出モジュール。映像の「道路の高さの帯」を 416×416 のタイルに分け、1 回に 1 枚ずつ順番にモデルへ渡す。
// モデルの計算は時間がかかるので、結果を待たずに、いちばん新しい結果を返す。
//
// 注意: 「検出されず」は「人がいない」という意味ではない。見ているのは帯の中だけで、見落としもある。

import { STATES } from './states.js';
import { TILE, PERSON_DEFAULTS, planTiles, toInput, decodePersons, toFrame, PersonTracker } from './person-core.js';

/**
 * options.loadDetector(): Promise<{ run(Float32Array) -> Promise<Float32Array>, info }>
 * options.onScan({ index, crop, dets, time }): 1 枚のタイルの結果が出るたびに呼ぶ（学習用の保存に使う）
 */
export function createPersonRecognizer(options = {}) {
  const o = { ...PERSON_DEFAULTS, ...options };
  const tracker = new PersonTracker(o);
  let detector = null;
  let loadState = options.loadDetector ? 'loading' : 'none';
  let busy = false;
  let next = 0;
  let tiles = [];
  let sizeKey = '';
  let inferMs = 0;
  let failures = 0;

  if (options.loadDetector) {
    Promise.resolve()
      .then(() => options.loadDetector())
      .then((d) => {
        detector = d;
        loadState = 'ready';
      })
      .catch((err) => {
        loadState = 'failed';
        console.error('[pedestrian] モデルを読み込めません', err);
      });
  }

  function scan(frame, index) {
    const tile = tiles[index];
    const crop = frame.getCrop(tile.x, tile.y, tile.w, tile.h, TILE);
    const time = frame.timestamp;
    const t0 = performance.now();
    busy = true;
    detector
      .run(toInput(crop.data, crop.width, crop.height))
      .then((out) => {
        const dets = decodePersons(out, o);
        const dt = performance.now() - t0;
        inferMs = inferMs ? inferMs * 0.7 + dt * 0.3 : dt;
        failures = 0;
        if (index >= tiles.length || tiles[index] !== tile) return; // 途中で映像の大きさが変わった
        tracker.update(index, dets.map((d) => toFrame(d, crop, crop.width, crop.height)), time);
        if (o.onScan) o.onScan({ index, crop, dets, time });
      })
      .catch((err) => {
        failures++;
        console.error('[pedestrian]', err);
      })
      .finally(() => {
        busy = false;
      });
  }

  return {
    id: 'pedestrian',
    label: '歩行者',
    process(frame) {
      if (loadState !== 'ready') {
        const detail = loadState === 'loading' ? 'モデル読み込み中' : 'モデルを読み込めません';
        return { state: STATES.UNCHECKED, detail, person: null };
      }
      const vw = frame.videoWidth;
      const vh = frame.videoHeight;
      const key = `${vw}x${vh}`;
      if (key !== sizeKey) {
        sizeKey = key;
        tiles = planTiles(vw, vh, o);
        tracker.reset();
        next = 0;
      }
      if (!busy) {
        const i = next;
        next = (next + 1) % tiles.length;
        scan(frame, i);
      }

      const snap = tracker.snapshot(frame.timestamp, tiles.length);
      const person = { tiles, items: snap.items, inferMs, cycleMs: inferMs * tiles.length };
      if (!snap.any) {
        return { state: STATES.UNCHECKED, detail: failures > 2 ? '処理エラー' : '判定待ち', person };
      }
      const n = snap.items.filter((d) => d.confirmed).length;
      const speed = `${(person.cycleMs / 1000).toFixed(1)}秒ごと`;
      if (n > 0) return { state: STATES.DETECTED, detail: `${n}人・${speed}`, person };
      if (!snap.complete) return { state: STATES.UNCHECKED, detail: '一部のみ判定', person };
      return { state: STATES.NOT_DETECTED, detail: `範囲内のみ・${speed}`, person };
    },
  };
}
