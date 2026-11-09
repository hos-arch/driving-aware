// カメラ映像の上に、探索範囲と検出した車線を重ねて描く。
// video は object-fit: cover で表示しているので、同じ変換で座標を合わせる。

const LINE_COLOR = '#4fe3ff';
const SIGN_COLORS = {
  'red-circle': '#ff5a4f',
  'red-triangle': '#ff5af0',
  'yellow-diamond': '#ffd23f',
  'blue-sign': '#4da3ff',
};

// 標識の候補（色と形だけ。意味は判定していない）。映像全体に対する比で位置が来る。
// 画面の左右の端の細い帯は、標識を探している高さを示す（それ以外の高さは見ていない）。
function drawSigns(ctx, signs, ox, oy, dw, dh, cw) {
  if (!signs) return;
  const top = oy + signs.band[0] * dh;
  const bottom = oy + signs.band[1] * dh;
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.fillRect(0, top, 3, bottom - top);
  ctx.fillRect(cw - 3, top, 3, bottom - top);
  ctx.lineWidth = 3;
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textBaseline = 'bottom';
  for (const it of signs.items) {
    const x = ox + it.x * dw;
    const y = oy + it.y * dh;
    const w = it.w * dw;
    const h = it.h * dh;
    ctx.strokeStyle = SIGN_COLORS[it.kind] ?? '#ffffff';
    ctx.strokeRect(x - 3, y - 3, w + 6, h + 6);
    const text = `${it.label}（候補）`;
    const tw = ctx.measureText(text).width + 8;
    const tx = Math.min(Math.max(0, x - 3), cw - tw);
    const ty = Math.max(16, y - 5);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(tx, ty - 16, tw, 16);
    ctx.fillStyle = SIGN_COLORS[it.kind] ?? '#ffffff';
    ctx.fillText(text, tx + 4, ty - 1);
  }
  ctx.restore();
}

export function drawOverlay(canvas, video, lane, carX, signs) {
  const dpr = window.devicePixelRatio || 1;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  if (!video.videoWidth || !video.videoHeight) return;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const sc = Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * sc) / 2;
  const oy = (ch - vh * sc) / 2;
  drawSigns(ctx, signs, ox, oy, vw * sc, vh * sc, cw);
  if (!lane) return;
  const mx = (fx) => ox + (fx / lane.frameW) * vw * sc;
  const my = (fy) => oy + (fy / lane.frameH) * vh * sc;

  // 探索範囲（どこを見て判定しているかを示す）
  const top = my(lane.roi[0]);
  const bottom = my(lane.roi[1]);
  ctx.save();
  ctx.setLineDash([6, 6]);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
  ctx.strokeRect(0.5, top, cw - 1, bottom - top);
  ctx.restore();

  // 検出した境界線。近い側（ROI 下端から消失点に向かう途中まで）だけを描く。
  const [vx, vy] = lane.vp;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = LINE_COLOR;
  for (const side of [lane.left, lane.right]) {
    if (!side) continue;
    const x0 = side.xb;
    const y0 = lane.roi[1];
    const x1 = x0 + (vx - x0) * 0.55;
    const y1 = y0 + (vy - y0) * 0.55;
    ctx.beginPath();
    ctx.moveTo(mx(x0), my(y0));
    ctx.lineTo(mx(x1), my(y1));
    ctx.stroke();
  }

  // 自車の位置（基準を設定済みで、左右が検出できているときだけ）
  if (carX != null && lane.left && lane.right) {
    const x = mx(carX);
    const y = bottom;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x - 9, y + 4);
    ctx.lineTo(x + 9, y + 4);
    ctx.closePath();
    ctx.fill();
  }
}
