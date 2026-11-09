// 標識の「色と形」の候補を見つける（画像 → 候補の一覧）。
//
// ここでは、標識の意味（一時停止か、進入禁止か、など）は判定しない。
// 見つけるのは次の 4 種類の形だけで、それ以外の標識は「見ていない」。
//   red-circle     : 赤い丸（赤い輪、または赤く塗られた丸）。規制・禁止系の標識に多い形
//   red-triangle   : 赤い逆三角。一時停止の標識の形
//   yellow-diamond : 黄色いひし形。警戒（注意）系の標識の形
//   blue-sign      : 青い四角または丸。案内・指示系の標識の形
// 色と形が似ているだけのもの（赤い看板、青い屋根など）も候補に入ることがある。

export const SIGN_DEFAULTS = {
  band: [0, 0.6], // 見る範囲（画像の高さに対する比）。標識がある高さを想定
  baseW: 1280, // 以下の長さの基準にする画像の幅
  minSide: 14, // 候補の最小の辺（基準幅での px）
  maxFrac: 0.22, // 候補の最大の辺（画像の幅に対する比）
  vMin: 0.28, // これより暗い画素は色を見ない
  redHue: [8, 336], // 赤は、この角度以下か以上。雨でぼけた標識は、薄く（色相 346〜350°、彩度 0.45）写る
  redSat: 0.38,
  blueSat: 0.55,
  yellowHue: [28, 62], // 雨・曇りの黄色い標識は、橙色寄りに写る（色相 31〜44° を実測）
  yellowSat: 0.45,
  yellowVMin: 0.35,
  gap: 5, // 同じ色の間のこの幅（基準幅での px）までの隙間は埋める
  minLuma: 15, // 範囲の平均輝度がこれ未満なら暗くて判定不可
};

export const SIGN_KINDS = {
  'red-circle': '赤い丸',
  'red-triangle': '赤い逆三角',
  'yellow-diamond': '黄色いひし形',
  'blue-sign': '青い標識',
};

const RED = 1;
const BLUE = 2;
const YELLOW = 3;

/** 同じ色の画素の間にある小さな隙間（白い文字、雨粒、ぼけ）を、行方向と列方向に埋める */
function fillGaps(cls, w, h, g) {
  for (let y = 0; y < h; y++) {
    let lastC = 0;
    let lastX = -1;
    for (let x = 0; x < w; x++) {
      const c = cls[y * w + x];
      if (!c) continue;
      if (c === lastC && x - lastX > 1 && x - lastX - 1 <= g) {
        for (let k = lastX + 1; k < x; k++) if (!cls[y * w + k]) cls[y * w + k] = c;
      }
      lastC = c;
      lastX = x;
    }
  }
  for (let x = 0; x < w; x++) {
    let lastC = 0;
    let lastY = -1;
    for (let y = 0; y < h; y++) {
      const c = cls[y * w + x];
      if (!c) continue;
      if (c === lastC && y - lastY > 1 && y - lastY - 1 <= g) {
        for (let k = lastY + 1; k < y; k++) if (!cls[k * w + x]) cls[k * w + x] = c;
      }
      lastC = c;
      lastY = y;
    }
  }
}

/** 1 つの塊（画素の集まり）の形を調べる。形が合えば種類を返し、合わなければ null。 */
function whiteFraction(rgba, w, x0, y0, bw, bh) {
  let white = 0;
  for (let y = y0; y < y0 + bh; y++) {
    for (let x = x0; x < x0 + bw; x++) {
      const p = (y * w + x) * 4;
      const r = rgba[p];
      const g = rgba[p + 1];
      const b = rgba[p + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx >= 140 && mx - mn < 0.4 * mx) white++;
    }
  }
  return white / (bw * bh);
}

/** 中央の横帯が白く、その上下が白くない（進入禁止の白い棒）か */
function hasWhiteBar(rgba, w, x0, y0, bw, bh) {
  const frac = (ya, yb) => {
    let white = 0;
    let n = 0;
    for (let y = Math.max(y0, Math.round(ya)); y < Math.min(y0 + bh, Math.round(yb)); y++) {
      for (let x = Math.round(x0 + bw * 0.22); x < Math.round(x0 + bw * 0.78); x++) {
        const p = (y * w + x) * 4;
        const mx = Math.max(rgba[p], rgba[p + 1], rgba[p + 2]);
        const mn = Math.min(rgba[p], rgba[p + 1], rgba[p + 2]);
        if (mx >= 140 && mx - mn < 0.4 * mx) white++;
        n++;
      }
    }
    return n ? white / n : 0;
  };
  const cy = y0 + bh / 2;
  const half = bh * 0.1;
  return frac(cy - half, cy + half) >= 0.6 && frac(y0 + bh * 0.2, y0 + bh * 0.35) < 0.3 && frac(y0 + bh * 0.65, y0 + bh * 0.8) < 0.3;
}

function classify(color, pix, count, w, x0, y0, bw, bh, rgba) {
  const rowMin = new Int32Array(bh).fill(1e9);
  const rowMax = new Int32Array(bh).fill(-1);
  for (let k = 0; k < count; k++) {
    const i = pix[k];
    const y = Math.floor(i / w) - y0;
    const x = (i % w) - x0;
    if (x < rowMin[y]) rowMin[y] = x;
    if (x > rowMax[y]) rowMax[y] = x;
  }
  const aspect = bw / bh;
  const fill = count / (bw * bh);
  // 標識は、赤や青の中に白い部分（地、文字、記号）がある。コーンや尾灯などは白がほとんどない
  const white = color === YELLOW ? 1 : whiteFraction(rgba, w, x0, y0, bw, bh);
  const cx = (bw - 1) / 2;
  const cy = (bh - 1) / 2;
  const r = (bw + bh) / 4;

  // 丸かどうか: すべての画素が円の内側にあり、8 方向のどこにも画素がある
  const circleLike = () => {
    if (aspect < 0.8 || aspect > 1.25) return null;
    let outside = 0;
    let inner = 0;
    const sector = new Int32Array(8);
    for (let k = 0; k < count; k++) {
      const i = pix[k];
      const dx = (i % w) - x0 - cx;
      const dy = Math.floor(i / w) - y0 - cy;
      const d = Math.hypot(dx, dy);
      if (d > 1.15 * r) outside++;
      if (d < 0.35 * r) inner++;
      sector[Math.min(7, Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * 8))]++;
    }
    if (outside / count > 0.05) return null;
    const covered = [...sector].filter((c) => c / count > 0.04).length;
    if (covered < 7) return null;
    return { ringHole: inner / count < 0.03, fill };
  };

  // 行ごとの幅の形（理想の形との平均のずれ）。tri(y) は 0〜1 に正規化した高さ位置から理想の幅比を返す
  const profileError = (tri) => {
    let err = 0;
    let n = 0;
    for (let y = Math.floor(bh * 0.1); y < Math.ceil(bh * 0.9); y++) {
      if (rowMax[y] < 0) continue;
      const wr = (rowMax[y] - rowMin[y] + 1) / bw;
      err += Math.abs(wr - tri((y + 0.5) / bh));
      n++;
    }
    return n < bh * 0.5 ? Infinity : err / n;
  };

  if (color === RED) {
    const c = circleLike();
    if (c) {
      // 輪（中が空いている）か、塗りつぶし（白い棒がある進入禁止など）
      if (c.ringHole && fill >= 0.2 && fill <= 0.75 && white >= 0.12) return 'red-circle';
      // 塗りつぶしは、白い横棒がある形（進入禁止）だけ。コーンや尾灯の赤い塊は除く
      if (!c.ringHole && fill >= 0.45 && hasWhiteBar(rgba, w, x0, y0, bw, bh)) return 'red-circle';
    }
    if (aspect >= 0.95 && aspect <= 1.7 && fill >= 0.12 && fill <= 0.7) {
      if (white >= 0.1 && profileError((t) => 1 - t * 0.85) < 0.12) return 'red-triangle';
    }
    return null;
  }
  if (color === YELLOW) {
    if (aspect >= 0.7 && aspect <= 1.4 && fill >= 0.15 && fill <= 0.6) {
      if (profileError((t) => 1 - Math.abs(2 * t - 1)) < 0.14) return 'yellow-diamond';
    }
    return null;
  }
  if (color === BLUE) {
    // 白い文字や矢印で青い画素が減るので、画素の割合ではなく外形の広がりで見る
    if (white < 0.04 || fill < 0.3) return null;
    let rowSpan = 0;
    let rows = 0;
    for (let y = 0; y < bh; y++) {
      if (rowMax[y] < 0) continue;
      rowSpan += (rowMax[y] - rowMin[y] + 1) / bw;
      rows++;
    }
    if (rows < bh * 0.9) return null;
    const rectLike = aspect >= 0.5 && aspect <= 5 && rowSpan / rows >= 0.7; // 各行が幅の大半に届く
    const roundLike =
      aspect >= 0.8 &&
      aspect <= 1.25 &&
      profileError((t) => Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2))) < 0.1; // 中央が広く、上下端が狭い
    if (rectLike || roundLike) return 'blue-sign';
    return null;
  }
  return null;
}

/**
 * @param rgba 画像の RGBA（範囲 band を切り出したもの）
 * @param w,h  その幅と高さ
 * @returns {{meanLuma:number, cands:Array<{kind,x,y,w,h}>}} x,y,w,h は rgba 内の px
 */
export function findSignCandidates(rgba, w, h, opts = {}) {
  const o = { ...SIGN_DEFAULTS, ...opts };
  const s = w / o.baseW;
  const n = w * h;
  const cls = new Uint8Array(n);
  let lumaSum = 0;

  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = rgba[p];
    const g = rgba[p + 1];
    const b = rgba[p + 2];
    const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
    const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
    lumaSum += (r * 299 + g * 587 + b * 114) / 1000;
    if (mx < o.vMin * 255) continue;
    const d = mx - mn;
    if (d === 0) continue;
    const sat = d / mx;
    if (sat < o.redSat) continue;
    let hue;
    if (mx === r) hue = ((g - b) / d) % 6;
    else if (mx === g) hue = (b - r) / d + 2;
    else hue = (r - g) / d + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
    if ((hue <= o.redHue[0] || hue >= o.redHue[1]) && sat >= o.redSat) cls[i] = RED;
    else if (hue >= 205 && hue <= 245 && sat >= o.blueSat) cls[i] = BLUE;
    else if (hue >= o.yellowHue[0] && hue <= o.yellowHue[1] && sat >= o.yellowSat && mx >= o.yellowVMin * 255) cls[i] = YELLOW;
  }

  fillGaps(cls, w, h, Math.max(1, Math.round(o.gap * s)));

  const minSide = Math.max(4, Math.round(o.minSide * s));
  const maxSide = Math.round(o.maxFrac * w);
  const visited = new Uint8Array(n);
  const stack = new Int32Array(n);
  const pix = new Int32Array(n);
  const cands = [];
  const debug = o.debug ? [] : null;

  for (let start = 0; start < n; start++) {
    const color = cls[start];
    if (!color || visited[start]) continue;
    let sp = 0;
    let count = 0;
    stack[sp++] = start;
    visited[start] = 1;
    let minx = w;
    let maxx = 0;
    let miny = h;
    let maxy = 0;
    while (sp) {
      const i = stack[--sp];
      pix[count++] = i;
      const x = i % w;
      const y = (i - x) / w;
      if (x < minx) minx = x;
      if (x > maxx) maxx = x;
      if (y < miny) miny = y;
      if (y > maxy) maxy = y;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (dx === 0 && dy === 0)) continue;
          const j = yy * w + xx;
          if (cls[j] === color && !visited[j]) {
            visited[j] = 1;
            stack[sp++] = j;
          }
        }
      }
    }
    const bw = maxx - minx + 1;
    const bh = maxy - miny + 1;
    if (bw < minSide || bh < minSide || bw > maxSide || bh > maxSide) continue;
    if (count < 0.1 * bw * bh) continue;
    // 範囲の左右・下の端で切れている塊は、形を判断できないので除く（上端は画像の上端なので許す）
    if (minx === 0 || maxx === w - 1 || maxy === h - 1) continue;
    const kind = classify(color, pix, count, w, minx, miny, bw, bh, rgba);
    if (debug) debug.push({ color, x: minx, y: miny, w: bw, h: bh, count, fill: +(count / (bw * bh)).toFixed(2), white: +whiteFraction(rgba, w, minx, miny, bw, bh).toFixed(2), kind });
    if (kind) cands.push({ kind, x: minx, y: miny, w: bw, h: bh });
  }
  return { meanLuma: lumaSum / n, cands, debug };
}
