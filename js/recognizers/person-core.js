// 人の検出の、計算だけの部分（ブラウザの機能を使わない。単体テストできる）。
// モデルは YOLOX（学習済み、COCO）。入力は 416×416、BGR、0〜255。出力は 3549 行 × 85 列。

export const TILE = 416;
export const PERSON_DEFAULTS = {
  baseLong: 1280, // 映像の長い辺をこの大きさにそろえたつもりで、416 のタイルを切る（遠くの小さい人を見るため）
  centerY: { landscape: 0.47, portrait: 0.45 }, // タイルの中心の高さ（映像の高さに対する比）
  lowScore: 0.3, // これ以上を「候補」として扱う
  highScore: 0.5, // これ以上で、続けて見つかったものを「検出」とする
  nmsIou: 0.45,
  staleMs: 2500, // これより古い結果は使わない
  // 車（乗用車・バス・トラック）の枠の中に出た人の枠は外す（前の車の窓、車の中の人）
  vehicleScore: 0.3,
  vehicleInside: 0.9, // 人の枠のうち、これ以上の割合が車の枠の中にあり、
  vehicleBottom: 0.2, // 人の枠の下端が、車の枠の下端より（車の高さの）この割合以上は上にあるとき
};

/** 映像のどこを見るか。戻り値は映像全体に対する比（x, y, w, h）の配列。横向きで 3 枚、縦向きで 2 枚。 */
export function planTiles(vw, vh, opts = {}) {
  const o = { ...PERSON_DEFAULTS, ...opts };
  const s = Math.min(1, o.baseLong / Math.max(vw, vh));
  const side = Math.min(TILE / s, vw, vh); // 元の映像での 1 辺（画素）
  const n = Math.max(1, Math.round(vw / side));
  const cy = typeof o.centerY === 'number' ? o.centerY : vw >= vh ? o.centerY.landscape : o.centerY.portrait;
  const y0 = Math.min(Math.max(0, cy * vh - side / 2), vh - side);
  const tiles = [];
  for (let i = 0; i < n; i++) {
    const x0 = n === 1 ? (vw - side) / 2 : ((vw - side) * i) / (n - 1);
    tiles.push({ x: x0 / vw, y: y0 / vh, w: side / vw, h: side / vh });
  }
  return tiles;
}

/** RGBA の画像（w×h、416 以下）を、モデルの入力（BGR、CHW、余白は 114）にする。 */
export function toInput(rgba, w, h, out = new Float32Array(3 * TILE * TILE)) {
  const P = TILE * TILE;
  out.fill(114);
  const cw = Math.min(w, TILE);
  const ch = Math.min(h, TILE);
  for (let y = 0; y < ch; y++) {
    let s = y * w * 4;
    let d = y * TILE;
    for (let x = 0; x < cw; x++, s += 4, d++) {
      out[d] = rgba[s + 2];
      out[P + d] = rgba[s + 1];
      out[2 * P + d] = rgba[s];
    }
  }
  return out;
}

function iou(a, b) {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return i / (a.w * a.h + b.w * b.h - i + 1e-9);
}
export { iou };

const PERSON_CLASS = 0;
const VEHICLE_CLASSES = [2, 5, 7]; // COCO: 乗用車、バス、トラック

function nms(cands, limit) {
  cands.sort((a, b) => b.s - a.s);
  const keep = [];
  for (const c of cands) {
    if (keep.every((k) => iou(k, c) <= limit)) keep.push(c);
  }
  return keep;
}

/** モデルの出力から、人と車の枠（タイル内の画素。x, y は左上）を取り出す。 */
export function decodeAll(out, opts = {}) {
  const o = { ...PERSON_DEFAULTS, ...opts };
  const C = 85;
  const persons = [];
  const vehicles = [];
  let row = 0;
  for (const stride of [8, 16, 32]) {
    const g = TILE / stride;
    for (let gy = 0; gy < g; gy++) {
      for (let gx = 0; gx < g; gx++, row++) {
        const p = row * C;
        const obj = out[p + 4];
        if (obj < Math.min(o.lowScore, o.vehicleScore)) continue; // 物らしさが低ければ、どの種類でも届かない
        const ps = obj * out[p + 5 + PERSON_CLASS]; // 物らしさ × 「人」の確からしさ
        let vs = 0;
        for (const c of VEHICLE_CLASSES) vs = Math.max(vs, obj * out[p + 5 + c]);
        if (ps < o.lowScore && vs < o.vehicleScore) continue;
        const w = Math.exp(out[p + 2]) * stride;
        const h = Math.exp(out[p + 3]) * stride;
        const box = { x: (out[p] + gx) * stride - w / 2, y: (out[p + 1] + gy) * stride - h / 2, w, h };
        if (ps >= o.lowScore) persons.push({ ...box, s: ps });
        if (vs >= o.vehicleScore) vehicles.push({ ...box, s: vs });
      }
    }
  }
  return { persons: nms(persons, o.nmsIou), vehicles: nms(vehicles, o.nmsIou) };
}

/**
 * 車の枠の中に出た人の枠を外す。前の車の後ろの窓や、車の中の人を、歩行者として扱わないため。
 * 車の手前に立つ人は、足元が車の下端と同じかそれより下に写るので、外さない。
 * 注意: 車の向こう側にいて上半身だけ見える人は、外れてしまうことがある。
 */
export function dropInVehicles(persons, vehicles, opts = {}) {
  const o = { ...PERSON_DEFAULTS, ...opts };
  const kept = [];
  const dropped = [];
  for (const p of persons) {
    const hit = vehicles.some((v) => {
      const ix = Math.min(p.x + p.w, v.x + v.w) - Math.max(p.x, v.x);
      const iy = Math.min(p.y + p.h, v.y + v.h) - Math.max(p.y, v.y);
      if (ix <= 0 || iy <= 0) return false;
      return (ix * iy) / (p.w * p.h) >= o.vehicleInside && p.y + p.h < v.y + v.h * (1 - o.vehicleBottom);
    });
    (hit ? dropped : kept).push(p);
  }
  return { kept, dropped };
}

/** モデルの出力から、人の枠だけを取り出す（車の中に出た枠は外したあと）。 */
export function decodePersons(out, opts = {}) {
  const { persons, vehicles } = decodeAll(out, opts);
  return dropInVehicles(persons, vehicles, opts).kept;
}

/** タイル内の画素の枠を、映像全体に対する比に直す。tile は切り出した範囲（映像全体に対する比）、tileW・tileH は切り出した画像の大きさ。 */
export function toFrame(det, tile, tileW, tileH = tileW) {
  return {
    x: tile.x + (det.x / tileW) * tile.w,
    y: tile.y + (det.y / tileH) * tile.h,
    w: (det.w / tileW) * tile.w,
    h: (det.h / tileH) * tile.h,
    s: det.s,
  };
}

function near(a, b) {
  // 車が動くので、枠は少しずれる。重なるか、中心が枠の高さより近ければ同じ人とみなす。
  if (iou(a, b) > 0.2) return true;
  const dx = a.x + a.w / 2 - (b.x + b.w / 2);
  const dy = a.y + a.h / 2 - (b.y + b.h / 2);
  return Math.hypot(dx, dy) < Math.max(a.h, b.h);
}

/**
 * タイルごとの結果を覚えておき、「続けて 2 回見つかった、確からしさの高い枠」だけを検出とする。
 * 1 回だけの枠、確からしさが中くらいの枠は「候補」。
 */
export class PersonTracker {
  constructor(opts = {}) {
    this.o = { ...PERSON_DEFAULTS, ...opts };
    this.tiles = []; // [{ t, dets }]
  }

  reset() {
    this.tiles = [];
  }

  update(index, dets, t) {
    const prev = this.tiles[index];
    const fresh = prev && t - prev.t <= this.o.staleMs;
    this.tiles[index] = {
      t,
      dets: dets.map((d) => ({
        ...d,
        confirmed: d.s >= this.o.highScore && !!fresh && prev.dets.some((p) => near(p, d)),
      })),
    };
  }

  /** count: 見ているタイルの数。全部のタイルに新しい結果があるときだけ complete。 */
  snapshot(now, count) {
    const items = [];
    let freshCount = 0;
    for (let i = 0; i < count; i++) {
      const r = this.tiles[i];
      if (!r || now - r.t > this.o.staleMs) continue;
      freshCount++;
      items.push(...r.dets);
    }
    return { items, complete: count > 0 && freshCount === count, any: freshCount > 0 };
  }
}
