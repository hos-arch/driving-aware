// 学習用の画像の保存。モデルが「人かもしれない」と迷った場面（確からしさが中くらい）のタイルを、端末の中にためる。
// ためた画像は、停車中に ZIP にまとめて取り出す。端末の外へは自動で送らない。位置情報は記録しない。

import { zipParts } from './zip.js';

const DB_NAME = 'drivingAwareCapture';
const STORE = 'items';

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

export function stamp(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

/** この結果を保存するか。確からしさが low 以上 high 未満の枠が 1 つでもあれば保存する。 */
export function isUncertain(dets, low, high) {
  return dets.some((d) => d.s >= low && d.s < high);
}

export class Capture {
  constructor({ limit = 1000, minGapMs = 1000, low = 0.3, high = 0.5, onChange } = {}) {
    this.limit = limit;
    this.minGapMs = minGapMs;
    this.low = low;
    this.high = high;
    this.onChange = onChange ?? (() => {});
    this.count = 0;
    this.status = 'starting'; // starting | ready | unavailable
    this.db = null;
    this.lastAt = [];
    this.saving = false;
    this.canvas = null;
  }

  async init() {
    try {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { autoIncrement: true });
      this.db = await req(open);
      this.count = await req(this.db.transaction(STORE).objectStore(STORE).count());
      this.status = 'ready';
    } catch (err) {
      this.status = 'unavailable';
      console.error('[capture]', err);
    }
    this.onChange();
  }

  get full() {
    return this.count >= this.limit;
  }

  /** scan: { index, crop, dets, time }（人の検出モジュールから）。info: { model, video } */
  offer(scan, info = {}) {
    if (this.status !== 'ready' || this.saving || this.full) return;
    if (!isUncertain(scan.dets, this.low, this.high)) return;
    if (scan.time - (this.lastAt[scan.index] ?? -Infinity) < this.minGapMs) return;
    this.lastAt[scan.index] = scan.time;
    this.saving = true;
    this.save(scan, info)
      .catch((err) => console.error('[capture]', err))
      .finally(() => {
        this.saving = false;
        this.onChange();
      });
  }

  async save(scan, info) {
    const { crop } = scan;
    if (!this.canvas) this.canvas = document.createElement('canvas');
    this.canvas.width = crop.width;
    this.canvas.height = crop.height;
    this.canvas.getContext('2d').putImageData(new ImageData(crop.data, crop.width, crop.height), 0, 0);
    const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!blob) throw new Error('JPEG にできません');
    const now = new Date();
    const file = `p_${stamp(now)}_${pad(now.getMilliseconds(), 3)}_t${scan.index}.jpg`;
    const meta = {
      file,
      time: now.toISOString(),
      model: info.model ?? null,
      video: info.video ?? null,
      tile: { x: crop.x, y: crop.y, w: crop.w, h: crop.h }, // 映像全体に対する比
      size: [crop.width, crop.height],
      // 枠は画像の中の画素（x, y は左上）。score はモデルの確からしさ。正解ではない。
      boxes: scan.dets.map((d) => ({ x: +d.x.toFixed(1), y: +d.y.toFixed(1), w: +d.w.toFixed(1), h: +d.h.toFixed(1), score: +d.s.toFixed(3) })),
    };
    const jpg = await blob.arrayBuffer(); // 先に読む（保存の手続きを開いたまま待つと、手続きが閉じてしまう）
    await req(this.db.transaction(STORE, 'readwrite').objectStore(STORE).add({ meta, jpg }));
    this.count++;
  }

  async exportZip() {
    const items = await req(this.db.transaction(STORE).objectStore(STORE).getAll());
    const enc = new TextEncoder();
    const files = items.map((it) => ({ name: `images/${it.meta.file}`, data: new Uint8Array(it.jpg) }));
    files.push({ name: 'labels.json', data: enc.encode(JSON.stringify(items.map((it) => it.meta), null, 1)) });
    files.push({
      name: 'README.txt',
      data: enc.encode(
        '運転環境認識（試作）の学習用データ\n' +
          'images/     モデルが「人かもしれない」と迷った場面の画像（416×416）\n' +
          'labels.json 画像ごとの枠とモデルの確からしさ。正解ではありません（人が確認して直すための下書き）\n' +
          '通行人の顔や車のナンバーが写っていることがあります。取り扱いに注意してください。\n',
      ),
    });
    return {
      name: `driving-aware-${stamp(new Date())}.zip`,
      blob: new Blob(zipParts(files), { type: 'application/zip' }),
      count: items.length,
    };
  }

  async clear() {
    await req(this.db.transaction(STORE, 'readwrite').objectStore(STORE).clear());
    this.count = 0;
    this.onChange();
  }
}
