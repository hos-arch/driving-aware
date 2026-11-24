// 横断歩道（路面の白いしま模様）を見つける、計算だけの部分。
//
// 見ているもの: 路面の帯の各行で、明るい区間（白線）が、ほぼ同じ幅・ほぼ同じ間隔で 4 本以上並んでいるか。
// そういう行が、上下にある程度まとまって続いていれば「横断歩道らしい」とする。
// 車線の線（1 行に 2〜3 本）や、停止線（1 本の太い線）は、本数が足りないので数えない。
//
// 注意: 映像の明るさの並びだけを見ている。駐車場の白線、影のしま、柵なども、同じ並びに見えることがある。
//       見つからないことは、横断歩道がないことを意味しない（遠い、かすれた、暗い、雨で光る、など）。

export const CROSSWALK_DEFAULTS = {
  band: [0.48, 0.92], // 見る範囲（画像の高さに対する比）。地平線のすぐ下から、車のボンネットの手前まで
  minLuma: 50, // 範囲の平均輝度がこれ未満なら、暗くて判定不可
  minContrast: 40, // 行の中の「明るい側（上位 5%）」と「中央値」の差がこれ未満の行は見ない（白線がない）
  minRunFrac: 0.004, // 白い区間の最小の幅（画像の幅に対する比）。遠くの横断歩道は、しまが細く写る
  maxRunFrac: 0.12, // 白い区間の最大の幅。これより太いもの（停止線、白い車など）は、しまの 1 本と数えない
  minStripes: 4, // 1 行に並ぶ白い区間の最低本数
  maxCv: 0.5, // 白い区間の幅と、間のすき間の、ばらつき（変動係数）の上限
  minSpanFrac: 0.2, // しまが並ぶ範囲の、最低の横幅（画像の幅に対する比）
  minRowsFrac: 0.025, // しまの行が、上下にこれだけ（帯の高さに対する比）まとまっていれば「らしい」
  gapRows: 2, // しまの行の間の、これまでの欠けは、つながっているとみなす
  minRows: 6, // 帯の高さによらず、しまの行はこれ以上（px）。雨の路面の反射は、細い 1〜2 行だけのしまに見えやすい
};

function cv(a) {
  if (a.length < 2) return 0;
  const m = a.reduce((s, v) => s + v, 0) / a.length;
  if (!m) return Infinity;
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
  return Math.sqrt(v) / m;
}

/**
 * 1 行の明るさから、しま模様かどうかを見る。
 * @returns {{ok:boolean, stripes:number, x0:number, x1:number}} x0〜x1 はしまの並ぶ範囲（px）
 */
export function rowStripes(row, w, o) {
  const s = Array.from(row).sort((a, b) => a - b);
  const med = s[s.length >> 1];
  const hi = s[Math.floor(s.length * 0.95)];
  const none = { ok: false, stripes: 0, x0: 0, x1: 0 };
  if (hi - med < o.minContrast) return none;
  const t = med + (hi - med) * 0.5;
  const minRun = Math.max(2, Math.round(o.minRunFrac * w));
  const maxRun = Math.round(o.maxRunFrac * w);
  // 白い区間を取り出す（1 画素の切れ目は埋める）
  const runs = [];
  let start = -1;
  let lastOn = -10;
  for (let x = 0; x <= w; x++) {
    const on = x < w && row[x] >= t;
    if (on) {
      if (start < 0 || x - lastOn > 2) {
        if (start >= 0) runs.push([start, lastOn + 1]);
        start = x;
      }
      lastOn = x;
    }
  }
  if (start >= 0) runs.push([start, lastOn + 1]);
  // 幅が合うものだけを、しまの候補にする。太すぎるものがあれば、そこで並びを区切る
  let best = null;
  let cur = [];
  const flush = () => {
    if (cur.length >= o.minStripes) {
      const widths = cur.map(([a, b]) => b - a);
      const gaps = cur.slice(1).map(([a], i) => a - cur[i][1]);
      const span = cur[cur.length - 1][1] - cur[0][0];
      if (cv(widths) <= o.maxCv && cv(gaps) <= o.maxCv && span >= o.minSpanFrac * w) {
        if (!best || cur.length > best.length) best = cur;
      }
    }
    cur = [];
  };
  for (const r of runs) {
    const wd = r[1] - r[0];
    if (wd > maxRun) {
      flush();
      continue;
    }
    if (wd < minRun) continue;
    // すき間が前のしまの幅の 4 倍を超えたら、別の並びとみなす
    if (cur.length) {
      const prev = cur[cur.length - 1];
      const gap = r[0] - prev[1];
      if (gap > 4 * Math.max(prev[1] - prev[0], wd)) flush();
    }
    cur.push(r);
  }
  flush();
  if (!best) return none;
  return { ok: true, stripes: best.length, x0: best[0][0], x1: best[best.length - 1][1] };
}

/**
 * 路面の帯（rgba, w×h）から、横断歩道らしいしま模様を探す。
 * @returns {{meanLuma:number, found:boolean, y0:number, y1:number, x0:number, x1:number, rows:number}}
 *   y0〜y1, x0〜x1 は見つけた範囲（帯の中の px）
 */
export function findCrosswalk(rgba, w, h, opts = {}) {
  const o = { ...CROSSWALK_DEFAULTS, ...opts };
  const n = w * h;
  const gray = new Uint8Array(n);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = (rgba[p] * 77 + rgba[p + 1] * 150 + rgba[p + 2] * 29) >> 8;
    gray[i] = v;
    sum += v;
  }
  const meanLuma = n ? sum / n : 0;
  const res = { meanLuma, found: false, y0: 0, y1: 0, x0: 0, x1: 0, rows: 0 };
  if (meanLuma < o.minLuma) return res;
  // 行ごとに見る（2 行おき。上下のまとまりを見るので十分）
  const step = 2;
  const hits = [];
  for (let y = 0; y < h; y += step) {
    const r = rowStripes(gray.subarray(y * w, (y + 1) * w), w, o);
    if (r.ok) hits.push({ y, ...r });
  }
  // 上下に続いている、いちばん長いまとまりを取る
  let best = [];
  let cur = [];
  for (const hit of hits) {
    if (cur.length && hit.y - cur[cur.length - 1].y > step * (o.gapRows + 1)) {
      if (cur.length > best.length) best = cur;
      cur = [];
    }
    cur.push(hit);
  }
  if (cur.length > best.length) best = cur;
  const rows = best.length * step;
  if (rows < Math.max(o.minRows, o.minRowsFrac * h)) return { ...res, rows };
  return {
    meanLuma,
    found: true,
    rows,
    y0: best[0].y,
    y1: best[best.length - 1].y + step,
    x0: Math.min(...best.map((b) => b.x0)),
    x1: Math.max(...best.map((b) => b.x1)),
  };
}

/** 直近 window 回のうち need 回以上見つかったら「横断歩道あり」とする（ちらつき・一瞬の誤りを減らす） */
export class CrosswalkTracker {
  constructor({ window = 4, need = 2 } = {}) {
    this.window = window;
    this.need = need;
    this.history = [];
  }

  reset() {
    this.history = [];
  }

  update(found) {
    this.history.push(!!found);
    if (this.history.length > this.window) this.history.shift();
    return this.history.filter(Boolean).length >= this.need;
  }
}
