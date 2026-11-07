// 車線候補の抽出（画像 → 白線らしい線分の候補）。DOM に依存しない純粋関数。
//
// 考え方:
//   1. 道路が写る帯（ROI）だけを見る。ダッシュボードや空は見ない。
//   2. 周りより明るい細長い塊を、白線の候補として取り出す。
//   3. 車線は遠くの 1 点（消失点）に向かって収束する。向きが合わない塊（路面の反射、窓枠など）は捨てる。
//   4. 赤・緑などの強い光の反射は、色の濃さで捨てる。
//
// 長さなどの閾値は「幅 640px の画像」を基準に書き、実際の幅に合わせて拡縮する。

export const LANE_DEFAULTS = Object.freeze({
  roi: [0.40, 0.535], // 画面の高さに対する探索範囲（上端, 下端）
  vp: [0.53, 0.45], // 消失点の初期値（幅, 高さに対する比）
  vpTolDeg: 26, // 候補の向きと「重心→消失点」の向きの許容差（度）
  minLen: 28, // 候補の最小の長さ（px）
  minArea: 25, // 候補の最小面積（px²）
  minAspect: 2.5, // 長さ / 太さ の下限
  maxSat: 0.45, // 色の濃さ（彩度）の上限
  bg: [81, 41], // 「周りの明るさ」を求める窓（px）
  nearFrac: 0.35, // ROI の上側 35% にある候補は遠すぎるので使わない
  xbRange: [-0.10, 1.10], // ROI 下端で線が交わる位置（幅に対する比）の許容範囲
  minLuma: 15, // ROI の平均輝度がこれ未満なら暗すぎて判定しない
});

const BASE_W = 640;

function clampIdx(v, hi) {
  return v < 0 ? 0 : v > hi ? hi : v;
}

function toGray(rgba, n) {
  const gray = new Uint8Array(n);
  let sum = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const v = (rgba[p] * 299 + rgba[p + 1] * 587 + rgba[p + 2] * 114) / 1000;
    gray[i] = v;
    sum += v;
  }
  return { gray, mean: n ? sum / n : 0 };
}

function blur3(src, w, h) {
  const tmp = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      tmp[row + x] =
        src[row + clampIdx(x - 1, w - 1)] + 2 * src[row + x] + src[row + clampIdx(x + 1, w - 1)];
    }
  }
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const up = clampIdx(y - 1, h - 1) * w;
    const mid = y * w;
    const dn = clampIdx(y + 1, h - 1) * w;
    for (let x = 0; x < w; x++) {
      out[mid + x] = (tmp[up + x] + 2 * tmp[mid + x] + tmp[dn + x] + 8) >> 4;
    }
  }
  return out;
}

function integral(src, w, h) {
  const W1 = w + 1;
  const I = new Float64Array(W1 * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += src[y * w + x];
      I[(y + 1) * W1 + (x + 1)] = I[y * W1 + (x + 1)] + rowSum;
    }
  }
  return I;
}

function morph(src, w, h, kw, kh, erode) {
  const ax = kw >> 1;
  const ay = kh >> 1;
  const dst = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = erode ? 1 : 0;
      outer: for (let ky = 0; ky < kh; ky++) {
        const yy = y + ky - ay;
        if (yy < 0 || yy >= h) continue;
        for (let kx = 0; kx < kw; kx++) {
          const xx = x + kx - ax;
          if (xx < 0 || xx >= w) continue;
          const on = src[yy * w + xx];
          if (erode ? !on : on) {
            v = erode ? 0 : 1;
            break outer;
          }
        }
      }
      dst[y * w + x] = v;
    }
  }
  return dst;
}

/**
 * @param rgba ROI の RGBA 画素（w × h）
 * @param ctx  { frameH, y0 } ROI の上端が画面全体の何行目か（消失点の座標変換に使う）
 * @returns { cands, rej, meanLuma, vp, w, h }  座標は ROI 内（x: 0..w, y: 0..h）
 */
export function findLaneCandidates(rgba, w, h, ctx, o = LANE_DEFAULTS) {
  const s = w / BASE_W;
  const n = w * h;
  const vpx = o.vp[0] * w;
  const vpy = o.vp[1] * ctx.frameH - ctx.y0;
  const out = {
    cands: [],
    rej: { size: 0, shape: 0, sat: 0, edge: 0, vp: 0, far: 0 },
    meanLuma: 0,
    vp: [vpx, vpy],
    w,
    h,
  };
  if (n === 0) return out;

  const { gray, mean } = toGray(rgba, n);
  out.meanLuma = mean;
  const g = blur3(gray, w, h);

  // 周りより明るい画素
  const I = integral(g, w, h);
  const W1 = w + 1;
  const rw = Math.max(1, Math.round((o.bg[0] * s) / 2));
  const rh = Math.max(1, Math.round((o.bg[1] * s) / 2));
  const diff = new Int16Array(n);
  let cnt = 0;
  let sum = 0;
  let sumsq = 0;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - rh);
    const y1 = Math.min(h - 1, y + rh);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - rw);
      const x1 = Math.min(w - 1, x + rw);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const tot = I[(y1 + 1) * W1 + (x1 + 1)] - I[y0 * W1 + (x1 + 1)] - I[(y1 + 1) * W1 + x0] + I[y0 * W1 + x0];
      const d = g[y * w + x] - Math.round(tot / area);
      diff[y * w + x] = d;
      if (d > 0) {
        cnt++;
        sum += d;
        sumsq += d * d;
      }
    }
  }
  const std = cnt ? Math.sqrt(Math.max(0, sumsq / cnt - (sum / cnt) ** 2)) : 0;
  const thr = Math.max(18, 0.5 * std);

  let mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = diff[i] > thr && g[i] > 70 ? 1 : 0;
  mask = morph(morph(mask, w, h, 2, 2, true), w, h, 2, 2, false); // open 2x2
  mask = morph(morph(mask, w, h, 3, 3, false), w, h, 3, 3, true); // close 3x3

  // 連結成分
  const label = new Uint8Array(n);
  const stack = new Int32Array(n);
  const yb = h;
  for (let start = 0; start < n; start++) {
    if (!mask[start] || label[start]) continue;
    let sp = 0;
    stack[sp++] = start;
    label[start] = 1;
    let m = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, satSum = 0;
    let minx = w, miny = h, maxx = 0, maxy = 0;
    while (sp) {
      const idx = stack[--sp];
      const x = idx % w;
      const y = (idx - x) / w;
      m++;
      sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      const p = idx * 4;
      const r = rgba[p], gg = rgba[p + 1], b = rgba[p + 2];
      const mx = r > gg ? (r > b ? r : b) : gg > b ? gg : b;
      const mn = r < gg ? (r < b ? r : b) : gg < b ? gg : b;
      satSum += mx ? (mx - mn) / mx : 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (!dx && !dy)) continue;
          const ni = yy * w + xx;
          if (mask[ni] && !label[ni]) {
            label[ni] = 1;
            stack[sp++] = ni;
          }
        }
      }
    }

    if (m < o.minArea * s * s) { out.rej.size++; continue; }

    const cx = sx / m;
    const cy = sy / m;
    const a = sxx / m - cx * cx;
    const b2 = sxy / m - cx * cy;
    const c = syy / m - cy * cy;
    const tr = a + c;
    const disc = Math.sqrt(Math.max(0, (tr * tr) / 4 - (a * c - b2 * b2)));
    const l1 = tr / 2 + disc + 1 / 12;
    const l2 = Math.max(0, tr / 2 - disc) + 1 / 12;
    const L = Math.sqrt(12 * l1);
    const T = Math.sqrt(12 * l2);
    if (L < o.minLen * s || L / T < o.minAspect) { out.rej.shape++; continue; }

    const sat = satSum / m;
    if (sat > o.maxSat) { out.rej.sat++; continue; }
    if (cx < 0.03 * w || cx > 0.97 * w) { out.rej.edge++; continue; }

    const theta = ((0.5 * Math.atan2(2 * b2, a - c) * 180) / Math.PI + 180) % 180;
    const toVp = ((Math.atan2(vpy - cy, vpx - cx) * 180) / Math.PI + 180) % 180;
    let d = Math.abs(theta - toVp);
    d = Math.min(d, 180 - d);
    if (d > o.vpTolDeg) { out.rej.vp++; continue; }
    if (Math.abs(vpy - cy) < 1e-3) continue;
    if (cy < o.nearFrac * h) { out.rej.far++; continue; }

    const xb = cx + ((yb - cy) * (vpx - cx)) / (vpy - cy);
    out.cands.push({ L, cx, cy, xb, sat, box: [minx, miny, maxx, maxy] });
  }
  return out;
}

/** 自車に最も近い左・右の境界候補を選ぶ。左右は消失点の x を基準に分ける。 */
export function pickEgoBoundaries(res, o = LANE_DEFAULTS) {
  const { w } = res;
  const vpx = res.vp[0];
  const ok = res.cands.filter((c) => c.xb >= o.xbRange[0] * w && c.xb <= o.xbRange[1] * w);
  const left = ok.filter((c) => c.xb < vpx - 0.02 * w);
  const right = ok.filter((c) => c.xb > vpx + 0.02 * w);
  let l = left.length ? left.reduce((a, c) => (c.xb > a.xb ? c : a)) : null;
  let r = right.length ? right.reduce((a, c) => (c.xb < a.xb ? c : a)) : null;
  if (l && r) {
    const width = r.xb - l.xb;
    if (!(width >= 0.15 * w && width <= 1.3 * w)) {
      // 車線の幅として不自然なら、長い方だけ残す
      if (l.L >= r.L) r = null;
      else l = null;
    }
  }
  return { left: l, right: r };
}
